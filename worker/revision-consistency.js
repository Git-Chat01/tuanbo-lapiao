// Adoption is evidence for reviewing a coach contradiction, never a passing grade.
// Keep question marks, quotations, numbers and operators: they can change meaning.
export function normalizeCoachingText(value) {
  const chars = Array.from(String(value ?? "").normalize("NFC").trim());
  let result = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (/\s/u.test(char)) {
      const previous = chars[i - 1] || "";
      let next = i + 1;
      while (next < chars.length && /\s/u.test(chars[next])) next++;
      const following = chars[next] || "";
      // Chinese spacing and layout around punctuation do not split words. Keep
      // spaces within Latin words/numbers, e.g. "now here" versus "nowhere".
      if (!(isHan(previous) && isHan(following)) && !isPunctuation(previous) && !isPunctuation(following)) result += " ";
      i = next - 1;
      continue;
    }
    if (char === "，" || char === ",") {
      result += /[0-9]/u.test(chars[i - 1] || "") && /[0-9]/u.test(chars[i + 1] || "") ? "," : "。";
    } else if (char === "；" || char === ";" || char === "。") {
      result += "。";
    } else if (char === "." && !/[A-Za-z0-9]/u.test(chars[i - 1] || "") && !/[A-Za-z0-9]/u.test(chars[i + 1] || "")) {
      result += "。";
    } else {
      result += ({"？":"?", "！":"!", "：":":"})[char] || char;
    }
  }
  return result.trim();
}

function isHan(value) { return /\p{Script=Han}/u.test(value); }
function isPunctuation(value) { return /[，,；;。？！?!：:、“”‘’「」『』（）()]/u.test(value); }
function isBoundary(value) { return !value || /[。?!:]/u.test(value); }

function occurrences(text, quote) {
  const found = [];
  if (!quote) return found;
  for (let index = text.indexOf(quote); index >= 0; index = text.indexOf(quote, index + 1)) found.push(index);
  return found;
}

function result(status, reason) { return { status, reason }; }

function editPlan(previousScript, lesson) {
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson) ||
      (lesson.related_edits != null && (!Array.isArray(lesson.related_edits) || lesson.related_edits.length > 4))) return null;
  const edits = [{ original: lesson.original, example: lesson.example }, ...(lesson.related_edits || [])];
  const ranges = [];
  for (const edit of edits) {
    if (!edit || typeof edit.original !== "string" || !edit.original.trim() || Array.from(edit.original).length > 200 ||
        typeof edit.example !== "string" || Array.from(edit.example).length > 160) return null;
    const matches = occurrences(previousScript, edit.original);
    if (matches.length !== 1) return null;
    ranges.push({ ...edit, start: matches[0], end: matches[0] + edit.original.length });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) return null;
  let expected = "", cursor = 0;
  for (const range of ranges) {
    expected += previousScript.slice(cursor, range.start);
    range.expectedStart = expected.length;
    expected += range.example;
    range.expectedEnd = expected.length;
    cursor = range.end;
  }
  expected += previousScript.slice(cursor);
  return expected.trim() && expected.length <= 500 ? { ranges, expected } : null;
}

// If a quotation was embedded in an original clause, retain the immediately
// adjacent words. An occurrence under a new negation/quotation is not adoption.
function sameLocalContext(expected, current, example, expectedStart, currentStart) {
  if (!isBoundary(example[0])) {
    const beforeExpected = expected.slice(0, expectedStart);
    const beforeCurrent = current.slice(0, currentStart);
    if (isBoundary(beforeExpected.at(-1))) {
      if (!isBoundary(beforeCurrent.at(-1))) return false;
    } else {
      const anchor = beforeExpected.split(/[。?!:]/u).at(-1).slice(-12);
      if (!beforeCurrent.endsWith(anchor)) return false;
    }
  }
  if (!isBoundary(example.at(-1))) {
    const afterExpected = expected.slice(expectedStart + example.length);
    const afterCurrent = current.slice(currentStart + example.length);
    if (isBoundary(afterExpected[0])) {
      // A statement changed into a question/exclamation is not a formatting edit.
      const oldBoundary = afterExpected[0] || "";
      const newBoundary = afterCurrent[0] || "";
      if (!isBoundary(newBoundary) || ((/[?!:]/u.test(oldBoundary) || /[?!:]/u.test(newBoundary)) && oldBoundary !== newBoundary)) return false;
    } else {
      const anchor = afterExpected.split(/[。?!:]/u)[0].slice(0, 12);
      if (!afterCurrent.startsWith(anchor)) return false;
    }
  }
  return true;
}

function hasDeletionSeam(expectedRaw, current, edit) {
  const left = normalizeCoachingText(expectedRaw.slice(0, edit.expectedStart)).slice(-12);
  const right = normalizeCoachingText(expectedRaw.slice(edit.expectedStart)).slice(0, 12);
  if ((left + right).replace(/[^\p{L}\p{N}]/gu, "").length < 6) return false;
  const matches = occurrences(current, left + right);
  if (matches.length !== 1) return false;
  if (!left && matches[0] !== 0) return false;
  if (!right && matches[0] + left.length !== current.length) return false;
  return true;
}

/**
 * Compare only a server-verified previous lesson with the current draft.
 * adopted: every local edit is clearly present, including deletions.
 * not_adopted: no change, or at least one original problem quotation remains.
 * needs_review: paraphrase, missing context, invalid plan or ambiguous occurrence.
 * This deliberately neither claims semantic equivalence nor changes the grade.
 */
export function assessCoachingAdoption(previousScript, currentScript, lesson) {
  if (typeof previousScript !== "string" || typeof currentScript !== "string" ||
      !previousScript.trim() || !currentScript.trim() || previousScript.length > 500 || currentScript.length > 500) return result("needs_review", "invalid_script");
  const plan = editPlan(previousScript, lesson);
  if (!plan) return result("needs_review", "invalid_or_ambiguous_plan");
  if (plan.expected.trim() === previousScript.trim()) return result("not_adopted", "no_effective_edit");
  if (currentScript.trim() === previousScript.trim()) return result("not_adopted", "unchanged");
  if (currentScript.trim() === plan.expected.trim()) return result("adopted", "exact_plan");
  const current = normalizeCoachingText(currentScript);
  const expected = normalizeCoachingText(plan.expected);
  if (current === expected) return result("adopted", "formatting_only");
  const located = [];
  let uncertain = "";
  for (const edit of plan.ranges) {
    const example = normalizeCoachingText(edit.example);
    if (!example) continue;
    const matches = occurrences(current, example);
    const expectedMatches = occurrences(expected, example);
    if (matches.length !== 1 || expectedMatches.length !== 1) {
      uncertain ||= matches.length > 1 || expectedMatches.length > 1 ? "ambiguous_example" : "changed_example";
      continue;
    }
    const start = matches[0];
    located.push({ start, end: start + example.length });
    if (!sameLocalContext(expected, current, example, expectedMatches[0], start)) uncertain ||= "changed_local_context";
    // A very short match can be coincidental; only accept it with the unchanged
    // immediate surroundings, even when a distant paragraph was edited.
    if (example.replace(/[^\p{L}\p{N}]/gu, "").length < 6) {
      const prefix = expected.slice(Math.max(0, expectedMatches[0] - 12), expectedMatches[0]);
      const suffix = expected.slice(expectedMatches[0] + example.length, expectedMatches[0] + example.length + 12);
      if (prefix.length + suffix.length < 6 || !current.slice(0, start).endsWith(prefix) || !current.slice(start + example.length).startsWith(suffix)) uncertain ||= "short_example_context";
    }
  }
  for (const edit of plan.ranges) {
    const original = normalizeCoachingText(edit.original);
    if (occurrences(current, original).some(start => !located.some(span => start >= span.start && start + original.length <= span.end))) return result("not_adopted", "original_remains");
    if (!normalizeCoachingText(edit.example) && !hasDeletionSeam(plan.expected, current, edit)) uncertain ||= "unverified_deletion";
  }
  const sorted = located.sort((a, b) => a.start - b.start);
  if (sorted.some((span, i) => i > 0 && span.start < sorted[i - 1].end)) uncertain ||= "overlapping_examples";
  return uncertain ? result("needs_review", uncertain) : result("adopted", "all_local_edits");
}
