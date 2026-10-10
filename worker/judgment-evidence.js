// Validate citations, never manufacture an argument from a keyword list.
const compact = value => String(value || '').replace(/\s+/gu, '');
const array = value => Array.isArray(value) ? value : [];
export function quotedEvidence(text) {
  return [...String(text || '').matchAll(/[“「]([^”」]{2,})[”」]/gu)].map(m => compact(m[1]));
}
export function quoteBelongsToSource(quote, source) {
  const target = compact(quote);
  if (!target) return false;
  const inline = value => String(value || '').replace(/[^\S\r\n]+/gu, '');
  if (inline(source).includes(inline(quote))) return true;
  // Preserve sentence boundaries before removing whitespace. Only grammatical
  // omissions are allowed; an arbitrary subsequence can reverse the meaning.
  const filler = /^(?:(?:别的|刚才|刚刚)|[的地得了着啊呀呢吧嘛呐哦嗯哈有，,、])*$/u;
  for (const sentence of String(source || '').split(/[。！？!?；;\r\n]/u).map(compact)) {
    const cleanTarget = target.replace(/[。！？!?；;]+$/u, '');
    if (!cleanTarget) continue;
    if (sentence.includes(cleanTarget)) return true;
    for (let start = sentence.indexOf(cleanTarget[0]); start >= 0; start = sentence.indexOf(cleanTarget[0], start + 1)) {
      let at = start + 1, valid = true;
      for (const char of cleanTarget.slice(1)) {
        const next = sentence.indexOf(char, at);
        if (next < 0 || !filler.test(sentence.slice(at, next))) { valid = false; break; }
        at = next + char.length;
      }
      if (valid) return true;
    }
  }
  // Full verbatim multi-sentence quotes are legitimate; invented joins are not.
  return false;
}
export function hasTwoPersonaQuotes(text, source) {
  const whole = compact(source), ranges = [];
  for (const quote of new Set(quotedEvidence(text))) {
    const start = whole.indexOf(quote);
    if (start < 0 || whole.indexOf(quote, start + 1) >= 0) continue;
    ranges.push({start, end:start + quote.length});
  }
  return ranges.some((a, i) => ranges.some((b, j) => i !== j && (a.end <= b.start || b.end <= a.start)));
}
export function getJudgmentEvidenceIssue(report, source, scenario = null, details = []) {
  if ((report.card_type === 'persona' || (typeof report.ai_flavor === 'string' && report.ai_flavor.trim())) &&
      !hasTwoPersonaQuotes(report.ai_flavor, source)) {
    details.push({field:'ai_flavor', correction:'必须用两处不同位置的真实原句说明同一种重复机制；证据不足请重新审视人设判断，不要按关键词补批评。'});
    return '人设判断必须引用两处不同位置的真实原句，不能凭单个词或自动补证据';
  }
  const scene = [scenario?.roleContext, scenario?.hostCue, scenario?.targetUser, scenario?.userSignal,
    scenario?.recentGift, scenario?.trainingGoal, ...array(scenario?.timeline).map(x => x?.text)]
    .filter(x => typeof x === 'string');
  // Proposed wording and next-step instructions are not claims about the source.
  // Their accuracy is checked against the complete revised script separately.
  const fields = [['verdict_reason',report.verdict_reason], ['card_why',report.card_why],
    ['ai_flavor',report.ai_flavor], ['redline_note',report.redline_note],
    ...array(report.line_reviews).map((x,i) => ['line_reviews['+i+'].comment',x?.comment])];
  let invalid = false;
  for (const [field, text] of fields) for (const match of String(text || '').matchAll(/[“「]([^”」]{4,})[”」]/gu)) {
    const quote = match[1];
    if (quoteBelongsToSource(quote,source) || scene.some(fact => quoteBelongsToSource(quote,fact))) continue;
    // Explicit comparisons/examples must not be mistaken for learner quotations.
    const prefix = String(text).slice(0,match.index);
    if (/(?:例如|比如|不同于|可以改成|可改为|示范(?:为|：|:))\s*$/u.test(prefix)) continue;
    invalid = true;
    details.push({field,quote,correction:'请引用当前稿或已给现场的真实原话；概括改用不带引号的准确说明，不能删改否定、条件、数字、对象或跨句拼接。'});
  }
  return invalid ? '点评引用了当前稿或现场不存在的原句' : '';
}

// Reject explicit invented requirements, never promote a draft by keyword.
export function getNoviceRequirementIssue(report,scenario) {
  if (scenario?.id !== 'novice-revival-far-v1') return '';
  const action = array(report.structure_checks).find(item => item?.key === 'vote_instruction');
  if (!action || action.status === 'met') return '';
  const text = String(action.evidence || '');
  const omitted = /(?:没(?:有|说清|交代|报)|未(?:交代|说明|报)|缺少|未给出)[^。！？!?；;]{0,18}(?:票种|单位|具体(?:票数|数量|金额)|当前缺口|还差多少|补到哪)/u;
  const unclear = /(?:票种|单位|具体(?:票数|数量|金额)|当前缺口|还差多少)[^。！？!?；;]{0,12}(?:不清楚|不明确|未交代|未说明|没有说明)/u;
  const mistakenRequirement = text.split(/[。！？!?；;]/u).some(clause => {
    if (!omitted.test(clause) && !unclear.test(clause)) return false;
    if (/(?:不是因为|不因为|不因|不以|不要求|无需|不必|不用|无须)/u.test(clause) ||
        /(?:不影响|不构成|不是问题|没关系|不是缺口|不作为|不应卡关)/u.test(clause)) return false;
    return true;
  });
  if (mistakenRequirement) return '新人复活动作不得因未给票种、单位或精确缺口而降级；结合整稿核对实际邀请，缺少这些信息不是必改门槛。';
  return '';
}
