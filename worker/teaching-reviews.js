// Teacher-only correction inbox. These records never enter retrieveCases or scoring.
export const TEACHING_REVIEW_TTL = 30 * 24 * 60 * 60;
export const TEACHING_REVIEW_LIMIT = 200;
const PREFIX = "teaching:";
const ID = /^teaching:[a-f0-9]{64}$/u;
const REASONS = ["revision_conflict", "repeated_focus", "example_invalid"];
const JUDGMENTS = ["correct", "false_rejection", "false_acceptance", "invalid_advice", "unclear"];
const FOCUS_KEYS = ["self_intro", "gratitude", "target_user", "user_reason", "vote_instruction", "logic", "expression", "mentality", "persona", "redline", "line_angle", "final_polish"];
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

function error(status, publicMessage) {
  return Object.assign(new Error(publicMessage), {status, publicMessage});
}
function kvFor(env) {
  if (!env?.CASES?.get || !env.CASES?.put || !env.CASES?.list || !env.CASES?.delete) {
    throw error(503, "纠错记录存储暂时不可用");
  }
  return env.CASES;
}
function lessonSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {focus_key:text(value.focus_key,32), original:text(value.original,200), example:text(value.example,160),
    keep:text(value.keep,300), action:text(value.action,300), why:text(value.why,500),
    related_edits:(Array.isArray(value.related_edits) ? value.related_edits : []).slice(0,4)
      .map(edit => ({original:text(edit?.original,200), example:text(edit?.example,160)}))};
}
function reportSnapshot(value) {
  return {verdict:text(value?.verdict,16), card_why:text(value?.card_why,500),
    verdict_reason:text(value?.verdict_reason,500), coaching:lessonSnapshot(value?.coaching),
    revision_note:text(value?.revision_note,500)};
}
async function fingerprint(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,"0")).join("");
}
function live(value, expectedId) {
  return value?.schema === 1 && ID.test(value.id || "") && (!expectedId || value.id === expectedId) &&
    Number.isSafeInteger(value.createdAt) && Number.isSafeInteger(value.updatedAt) && Number.isSafeInteger(value.expiresAt) &&
    value.createdAt <= value.updatedAt && value.updatedAt <= value.expiresAt && value.expiresAt > Date.now() &&
    value.expiresAt <= value.createdAt + TEACHING_REVIEW_TTL * 1000 &&
    ["pending","reviewed"].includes(value.status) && REASONS.includes(value.reason);
}
function publicRecord(value, expectedId) {
  if (!live(value, expectedId)) return null;
  const correction = value.correction && JUDGMENTS.includes(value.correction.judgment)
    ? {judgment:value.correction.judgment, reason:text(value.correction.reason,600),
      example:text(value.correction.example,500), keep:text(value.correction.keep,300)} : null;
  return {schema:1, id:value.id, reason:value.reason, status:value.status, createdAt:value.createdAt,
    updatedAt:value.updatedAt, expiresAt:value.expiresAt, scenarioId:text(value.scenarioId,64), focusKey:text(value.focusKey,32),
    previousScript:text(value.previousScript,500), script:text(value.script,500), previousCoaching:lessonSnapshot(value.previousCoaching),
    currentReport:reportSnapshot(value.currentReport), detail:text(value.detail,500), correction};
}
async function store(kv, item) {
  // KV requires at least 60 seconds until expiry. Do not extend retention when a
  // teacher happens to save in that final minute; leave the original record alone.
  const expiration = Math.floor(item.expiresAt / 1000);
  if (expiration <= Math.ceil(Date.now() / 1000) + 60) throw error(404,"这条纠错记录即将自动清理，无法再保存");
  await kv.put(item.id, JSON.stringify(item), {expiration,
    metadata:{createdAt:item.createdAt, status:item.status, reason:item.reason}});
}

export async function enqueueTeachingReview(env, input) {
  const kv = kvFor(env);
  if (!REASONS.includes(input?.reason) || typeof input.script !== "string" || !input.script.trim() || input.script.length > 500) {
    throw error(400, "纠错记录内容不完整");
  }
  const now = Date.now();
  const item = {schema:1, reason:input.reason, status:"pending", createdAt:now, updatedAt:now,
    expiresAt:now+TEACHING_REVIEW_TTL*1000, scenarioId:text(input.scenario?.id,64),
    focusKey:text(input.previousReport?.coaching?.focus_key || input.report?.coaching?.focus_key,32),
    previousScript:text(input.previousScript,500), script:input.script,
    previousCoaching:lessonSnapshot(input.previousReport?.coaching), currentReport:reportSnapshot(input.report),
    detail:text(input.detail,500), correction:null};
  // Identical failures do not refill the queue on browser retries or cached responses.
  item.id = PREFIX + await fingerprint([item.reason,item.scenarioId,item.previousScript,item.script,
    item.previousCoaching,item.currentReport.coaching,item.currentReport.verdict]);
  if (live(await kv.get(item.id,"json"),item.id)) return item.id;
  const window = await kv.list({prefix:PREFIX,limit:TEACHING_REVIEW_LIMIT+1});
  // KV is eventually consistent: concurrent first writes can briefly exceed this cap.
  // Per-request limits still bound each item; don't delete teacher work to make space.
  if (window.keys.length >= TEACHING_REVIEW_LIMIT || !window.list_complete) {
    console.log(JSON.stringify({event:"teaching_review_skipped", reason:"queue_full"}));
    return null;
  }
  await store(kv,item);
  return item.id;
}

export async function listTeachingReviews(env, {limit=30,cursor}={}) {
  const kv = kvFor(env);
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 2048)) throw error(400,"分页位置不对");
  limit = Math.max(1,Math.min(Number.isInteger(limit) ? limit : 30,50));
  const page = await kv.list({prefix:PREFIX,limit,...(cursor ? {cursor} : {})});
  const items = (await Promise.all(page.keys.map(async key=>publicRecord(await kv.get(key.name,"json"),key.name)))).filter(Boolean)
    .sort((a,b)=>a.status.localeCompare(b.status) || b.createdAt-a.createdAt);
  return {items,hasMore:!page.list_complete,nextCursor:page.list_complete ? null : page.cursor};
}

export async function resolveTeachingReview(env, id, input) {
  const kv = kvFor(env);
  if (typeof id !== "string" || !ID.test(id)) throw error(400,"纠错记录编号无效");
  const item = publicRecord(await kv.get(id,"json"),id);
  if (!item) throw error(404,"这条纠错记录已过期或不存在");
  if (!input || Array.isArray(input) || !JUDGMENTS.includes(input.judgment)) throw error(400,"请选择核对结论");
  for (const [key,max] of [["reason",600],["example",500],["keep",300]]) {
    if (typeof input[key] !== "string" || input[key].length > max) throw error(400,"核对说明长度或格式不对");
  }
  if (!input.reason.trim()) throw error(400,"请写清判断依据");
  if (["false_rejection","false_acceptance","invalid_advice"].includes(input.judgment) && !input.example.trim()) {
    throw error(400,"请补上你认可的有效改法");
  }
  item.correction = {judgment:input.judgment,reason:input.reason.trim(),example:input.example.trim(),keep:input.keep.trim()};
  item.status = "reviewed";
  item.updatedAt = Date.now();
  await store(kv,item);
  return item;
}

export async function deleteTeachingReview(env, id) {
  const kv = kvFor(env);
  if (typeof id !== "string" || !ID.test(id)) throw error(400,"纠错记录编号无效");
  await kv.delete(id);
}

// Attempts are derived only from the immutable, server-issued previous receipt.
// Client counters and cached draft reports cannot forge a learning history.
export function nextTeachingProgress(report, revision, previous) {
  const focus = report?.coaching?.focus_key;
  if (!FOCUS_KEYS.includes(focus) || report.verdict === "passed" || report.practice_status === "awaiting_response") return null;
  // previous must come from readDeliveredReview, not a request body or draft cache.
  const same = typeof revision?.previousScript === "string" && typeof revision?.currentScript === "string" &&
    revision.previousScript.trim() && revision.currentScript.trim() && revision.previousScript.trim() !== revision.currentScript.trim() &&
    !["resolved", "unverified"].includes(report.revision_check?.status) &&
    previous?.report?.verdict !== "passed" && previous?.report?.practice_status !== "awaiting_response" &&
    previous?.report?.coaching?.focus_key === focus;
  const count = same && previous?.teachingProgress?.focusKey === focus ? previous.teachingProgress.attempts : (same ? 1 : 0);
  return {focusKey:focus,attempts:Math.min(99, Number.isSafeInteger(count) && count >= 0 ? count+1 : 1)};
}
