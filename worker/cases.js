// 案例库模块（v4 受控自成长系统核心）
// 职责：
//   - retrieveCases：批改时只检索已发布案例注入 prompt
//   - tryAbsorb：过关稿写入学习候选池（不直接参与检索）
//   - addManualCase / publishCase / listAdminCases / softDeleteCase：投喂、发布、清单、拒绝
// 存储：Cloudflare KV（binding: CASES）。
// key 两种格式：
//   - 教练投喂：case:manual:{voteGap}:{内容+理由指纹}（旧随机 key 仍兼容）
//   - 自动吸收：case:absorb:{voteGap}:{稿子归一化hash}——确定性 key，
//     同稿同票况永远落同一个 key；key 已存在（包括 rejected）就跳过。
//     list 去重仍用于发现随机 key 的 manual 同稿；确定性 key 负责幂等兜底。
// 生命周期：candidate（自动候选）/ published（教练发布）/ rejected（删除或拒绝）。
// 兼容旧数据：无 status 的 manual 视为 published；无 status 的 auto 视为 candidate。
// KV 无模糊查询：检索优先扫描最近发布索引；旧库只读固定兼容窗口。
// 后台使用 KV 的真实游标分页，旧库可由管理员显式分批回填索引。

const REFERENCE_PREFIX = "reference:v1:";
const REFERENCE_SCAN_LIMIT = 200;
const LEGACY_SCAN_LIMIT = 120;
const REFERENCE_READ_LIMIT = 16;

function caseMetadata(c) {
  return {
    indexed: true, id: c.id, source: c.source, status: getCaseStatus(c),
    voteGap: c.voteGap, createdAt: c.createdAt || 0, tags: extractTags(c.script || ""),
    ...(c.scenario && typeof c.scenario === "object" && !Array.isArray(c.scenario) && Object.keys(c.scenario).length
      ? { scenario: { id: scenarioId(c.scenario) || "" } } : {}),
  };
}

function referenceKey(c) {
  // KV list 按 key 正序，倒置发布时间让刚审核的旧候选也能进入窗口。
  const epoch = Math.max(0, Math.min(9999999999999, Math.floor(c.publishedAt || c.createdAt || 0)));
  return `${REFERENCE_PREFIX}${String(9999999999999 - epoch).padStart(13, "0")}:${c.id}`;
}

async function storeCase(env, value) {
  await env.CASES.put(value.id, JSON.stringify(value), { metadata: caseMetadata(value) });
}

async function syncReferenceIndex(env, value) {
  if (isPublishedCase(value)) {
    if (await env.CASES.get(referenceKey(value)) !== "1") {
      await env.CASES.put(referenceKey(value), "1", { metadata: caseMetadata(value) });
    }
  } else {
    if (await env.CASES.get(referenceKey(value))) await env.CASES.delete(referenceKey(value));
  }
}

async function manualFingerprintKey(voteGap, norm) {
  return `manual-fingerprint:v1:${voteGap}:${await scriptHash(norm)}`;
}

async function rememberManual(env, value) {
  const key = await manualFingerprintKey(value.voteGap, normalizeScript(value.script));
  // 被拒绝的 manual 也保留去重标记，不因下次过关复活；同键避免重复 PUT。
  if (!await env.CASES.get(key)) await env.CASES.put(key, value.id);
}

// ---- 术语表：写 tags 与检索共用，全部 ≥2 字组合词避免单字误伤 ----
// 覆盖三类关键信号：乞求/自贬（坏方向）/ 条件谈判（好方向）/ 递台阶（好方向）
export const TERMS = [
  // 乞求/自贬类；“帮帮忙、拜托”本身可能只是礼貌请求，不在这里按坏方向打标签。
  "求求", "求一求", "可怜", "救救", "跪下", "磕头", "施舍",
  // 条件谈判类
  "上票", "保位", "差一点", "最后", "倒计时", "整活", "说到做到", "不怂",
  // 递台阶类
  "大哥", "家人们", "兄弟", "首播", "第一次", "今晚", "亮一手", "带一带",
];

const CASE_STATUS = {
  candidate: "candidate",
  published: "published",
  rejected: "rejected",
};

/** 兼容旧案例的生命周期归一化。 */
function getCaseStatus(c) {
  if (c && c.deleted) return CASE_STATUS.rejected;
  if (c && Object.values(CASE_STATUS).includes(c.status)) return c.status;
  return c && c.source === "manual" ? CASE_STATUS.published : CASE_STATUS.candidate;
}

/** 只有未删除且已发布的案例才能成为模型参照。 */
function isPublishedCase(c) {
  return Boolean(c && !c.deleted && getCaseStatus(c) === CASE_STATUS.published);
}

function normalizeScript(script) {
  return typeof script === "string" ? script.replace(/\s+/g, "") : "";
}

const SCENARIO_FIELDS = [
  "id",
  "roleContext",
  "phase",
  "goalUnit",
  "targetUnits",
  "pledgedUnits",
  "openRemaining",
  "deliveredUnits",
  "secondsLeft",
  "votesNeeded",
  "hostCue",
  "targetUser",
  "userSignal",
  "recentGift",
  "trainingGoal",
];

const TIMELINE_FIELDS = ["at", "role", "kind", "speaker", "text", "effect"];

/** 只保存 Worker 已清洗过的场景白名单字段，并生成独立快照。 */
function snapshotScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return null;
  const snapshot = {};
  for (const key of SCENARIO_FIELDS) {
    const value = scenario[key];
    if (typeof value === "number" && Number.isFinite(value)) snapshot[key] = value;
    if (typeof value === "string" && value.trim()) snapshot[key] = value;
  }
  if (Array.isArray(scenario.timeline)) {
    const timeline = scenario.timeline.slice(0, 24).map((event) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) return null;
      const copy = {};
      for (const key of TIMELINE_FIELDS) {
        const value = event[key];
        if (typeof value === "number" && Number.isFinite(value)) copy[key] = value;
        if (typeof value === "string" && value.trim()) copy[key] = value;
      }
      return Object.keys(copy).length > 0 ? copy : null;
    }).filter(Boolean);
    if (timeline.length > 0) snapshot.timeline = timeline;
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function scenarioId(scenario) {
  return scenario && typeof scenario.id === "string" && scenario.id
    ? scenario.id
    : null;
}

/** manual 不受场景限制；带 scenario.id 的 auto 只能在同一场景命中。 */
function matchesIncomingScenario(c, incomingScenario) {
  if (!c || c.source !== "auto") return true;
  const hasStoredScenario =
    c.scenario &&
    typeof c.scenario === "object" &&
    !Array.isArray(c.scenario) &&
    Object.keys(c.scenario).length > 0;
  if (!hasStoredScenario) return true; // 真正无场景的 auto 沿用通用检索逻辑
  const caseScenarioId = scenarioId(c.scenario);
  if (!caseScenarioId) return false; // 有具体现场却无 id，无法证明同场，fail-closed
  return caseScenarioId === scenarioId(incomingScenario);
}

/** 注入 prompt 的案例场景再做一次短化，避免旧脏数据撑大上下文。 */
function compactReferenceScenario(scenario) {
  const snapshot = snapshotScenario(scenario);
  if (!snapshot) return null;
  const compact = {};
  for (const key of SCENARIO_FIELDS) {
    const value = snapshot[key];
    if (typeof value === "number") compact[key] = value;
    if (typeof value === "string") {
      const max = key === "id" ? 64 : 80;
      compact[key] = Array.from(value).slice(0, max).join("");
    }
  }
  // 参照案例只带紧凑的阶段与数值快照；完整弹幕时间线属于旧场景，
  // 不注入当前 prompt，避免模型把别场原话迁移为当轮事实。
  return compact;
}

/**
 * 从话术提取术语标签（写入案例 tags 字段，检索时取交集算重叠度）。
 * @param {string} script - 话术全文
 * @returns {string[]}
 */
export function extractTags(script) {
  return TERMS.filter((t) => script.includes(t));
}

/**
 * 稿子归一化指纹：去空白后的 SHA-256 前 8 字节 hex。
 * 用于吸收 key 的确定性段——同稿同票况指纹相同，吸收幂等。
 * @param {string} norm - 已归一化（去空白）的话术
 * @returns {Promise<string>} 16 位 hex
 */
async function scriptHash(norm) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** 未回填记录的固定兼容窗口；不会随总案例数增长读量。 */
async function readStoredCase(env, key) {
  const raw = await env.CASES.get(key);
  if (!raw) return null;
  // 只跳过坏JSON，KV服务错误必须向上传递以复用已服务报告。
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? { ...value, id: key } : null;
  } catch { return null; }
}

async function readLegacyWindow(env) {
  const page = await env.CASES.list({ prefix: "case:", limit: LEGACY_SCAN_LIMIT });
  const values = await Promise.all(page.keys.filter((key) => !key.metadata?.indexed)
    .slice(0, LEGACY_SCAN_LIMIT).map((key) => readStoredCase(env, key.name)));
  return values.filter((value) => value && typeof value.script === "string");
}

/**
 * 检索批改参照案例。
 * 打分：关键词重叠 ×20 + 时间衰减（180 天线性归零）；manual 整体排前（教练投喂权威最高）。
 * 冷启动兜底：精确票况无结果时放宽到全部票况，但要求关键词重叠 ≥1（标注了票况不会误导模型）。
 * @param {object} env
 * 带 scenario.id 的 auto published 只允许在相同 incoming scenario.id 下使用；
 * manual 与无场景 auto 不受该限制。
 * @param {{voteGap: string, script: string, scenario?:object|null}} param1
 * @returns {Promise<{source:string, voteGap:string, script:string, whyGood:string, scenario?:object}[]>} 最多 3 篇
 */
export async function retrieveCases(env, { voteGap, script, scenario = null }) {
  const page = await env.CASES.list({ prefix: REFERENCE_PREFIX, limit: REFERENCE_SCAN_LIMIT });
  const references = page.keys.map((key) => key.metadata).filter((c) => c && typeof c.id === "string");
  const legacy = await readLegacyWindow(env);
  const all = [...references, ...legacy];
  const now = Date.now();

  // 硬过滤：只有 published 能参与检索；auto 候选即使是旧数据也不会进入 prompt。
  const eligible = all.filter(
    (c) => isPublishedCase(c) && matchesIncomingScenario(c, scenario)
  );
  let pool = eligible.filter((c) => c.voteGap === voteGap);
  let relaxed = false;
  if (pool.length === 0) {
    pool = eligible;
    relaxed = true;
  }

  const incomingTerms = TERMS.filter((t) => script.includes(t));
  const scored = pool
    .map((c) => {
      const kwOverlap = (Array.isArray(c.tags) ? c.tags : []).filter((t) => incomingTerms.includes(t)).length;
      if (relaxed && kwOverlap < 1) return null; // 放宽模式下仍要求至少一个词重叠
      const ageDays = (now - (c.createdAt || 0)) / 86400000;
      const recency = Math.max(0, 10 - ageDays / 18);
      return { c, score: kwOverlap * 20 + recency };
    })
    .filter(Boolean);

  scored.sort((a, b) => {
    const sa = a.c.source === "manual" ? 0 : 1;
    const sb = b.c.source === "manual" ? 0 : 1;
    if (sa !== sb) return sa - sb; // manual 整体排前
    if (b.score !== a.score) return b.score - a.score;
    return (b.c.createdAt || 0) - (a.c.createdAt || 0);
  });

  // 索引可能因 KV 最终一致性短暂残留；读取最新案例再次确认发布/同场状态。
  // 最多额外直读 16 条，不让大量已拒绝的残留索引吃完单次调用预算。
  const selected = [];
  const seen = new Set();
  let reads = 0;
  for (const item of scored) {
    let c = item.c;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (typeof c.script !== "string") {
      if (reads >= REFERENCE_READ_LIMIT) continue;
      reads += 1;
      c = await readStoredCase(env, c.id);
    }
    if (!c || typeof c.script !== "string" || !isPublishedCase(c) || !matchesIncomingScenario(c, scenario)) continue;
    if (!relaxed && c.voteGap !== voteGap) continue;
    selected.push(c);
    if (selected.length === 3) break;
  }
  // 每篇 script 截 200 字控制 prompt 体积。
  return selected.map((c) => {
    const item = {
      source: c.source,
      voteGap: c.voteGap,
      script: c.script.length > 200 ? c.script.slice(0, 200) + "…" : c.script,
      whyGood: c.whyGood || "",
    };
    const caseScenario = compactReferenceScenario(c.scenario);
    if (caseScenario) item.scenario = caseScenario;
    return item;
  });
}

/**
 * 把自动过关稿写成学习候选（主流程在 ctx.waitUntil 里调用）。
 * 前置闸门由调用方保证：verdict=passed 且无红线且非人设卡。
 * 候选不参与 retrieveCases；同稿无论当前是 candidate/published/rejected 都不重复写，
 * 因而教练删除或拒绝的稿子不会被下一次自动过关“复活”。
 * @param {object} env
 * @param {{script: string, voteGap: string, report: object, scenario?:object|null}} param1
 * report 为归一化后的批改报告；scenario 为 Worker 清洗后的当轮事实快照
 * @returns {Promise<string|null>} 新案例 id，去重跳过返回 null
 */
export async function tryAbsorb(env, { script, voteGap, report, scenario = null }) {
  const norm = normalizeScript(script);
  const scenarioSnapshot = snapshotScenario(scenario);
  const incomingScenarioId = scenarioId(scenarioSnapshot);
  // 有具体现场却没有稳定 id 时无法做安全的同场复用，不自动吸收。
  // 自由话术的 scenario 是 null，仍保留原有通用候选逻辑。
  if (scenarioSnapshot && !incomingScenarioId) return null;
  // 无场景沿用旧 key；有场景把 id 纳入指纹，允许同稿在不同训练场分别积累证据。
  const fingerprint = incomingScenarioId
    ? `${norm}\nscenario:${incomingScenarioId}`
    : norm;
  const id = `case:absorb:${voteGap}:${await scriptHash(fingerprint)}`;

  // 先直读确定性 key：即使刚软删后 list 还没收敛，读到旧候选或新 rejected
  // 都会跳过，而不是再次 PUT deleted:false 覆盖它。
  const existingAtId = await env.CASES.get(id, "json");
  if (existingAtId) return null;

  // 新库/已回填库的 manual 同稿直读指纹标记；旧库只读兼容窗口。
  // 重复候选即使在旧库窗口外也仍是 candidate，绝不直接注入模型。
  if (await env.CASES.get(await manualFingerprintKey(voteGap, norm))) return null;
  const all = await readLegacyWindow(env);
  const dup = all.some(
    (c) =>
      c &&
      c.voteGap === voteGap &&
      normalizeScript(c.script) === norm &&
      (c.source === "manual" || scenarioId(c.scenario) === incomingScenarioId)
  );
  if (dup) return null;

  // verdict_reason / one_thing 本身可能以句号结尾，先去掉尾部标点再拼接，避免"。。"
  const reason = (report.verdict_reason || "").replace(/[。！!]+$/, "");
  const learned = (report.one_thing || "").replace(/[。！!]+$/, "");
  const value = {
    id,
    source: "auto",
    status: CASE_STATUS.candidate,
    script,
    voteGap,
    whyGood: `过关理由：${reason}。这次她学会：${learned}`,
    tags: extractTags(script),
    createdAt: Date.now(),
    deleted: false,
  };
  if (scenarioSnapshot) value.scenario = scenarioSnapshot;
  await storeCase(env, value);
  return id;
}

/**
 * 教练手动投喂优秀话术：直接视为 published，可参与检索。
 * @param {object} env
 * @param {{voteGap: string, script: string, whyGood: string}} param1
 * @returns {Promise<string>} 新案例 id
 */
export async function addManualCase(env, { voteGap, script, whyGood }) {
  const id = `case:manual:${voteGap}:${await scriptHash(`${normalizeScript(script)}\nreason:${whyGood.trim()}`)}`;
  const existing = await env.CASES.get(id, "json");
  if (existing && !isPublishedCase(existing)) {
    throw Object.assign(new Error("manual case previously rejected"), { status: 409, publicMessage: "这条投喂已删除或拒绝，不能重复提交恢复" });
  }
  const value = existing || {
    id,
    source: "manual",
    status: CASE_STATUS.published,
    script,
    voteGap,
    whyGood,
    tags: extractTags(script),
    createdAt: Date.now(),
    deleted: false,
  };
  if (!existing) await storeCase(env, value);
  await rememberManual(env, value);
  await syncReferenceIndex(env, value);
  return id;
}

/**
 * 发布自动学习候选。只有未删除的 auto candidate 能首次发布；
 * 已发布的 auto 重复调用按幂等成功处理，且不刷新 publishedAt。
 * @param {object} env
 * @param {string} id - 完整案例 key
 * @returns {Promise<
 *   {ok:true, alreadyPublished:boolean, publishedAt:number}|
 *   {ok:false, reason:"not_found"|"manual"|"rejected"|"invalid_status"}
 * >}
 */
export async function publishCase(env, id) {
  const value = await env.CASES.get(id, "json");
  if (!value) return { ok: false, reason: "not_found" };

  const status = getCaseStatus(value);
  if (value.deleted || status === CASE_STATUS.rejected) {
    return { ok: false, reason: "rejected" };
  }
  if (value.source !== "auto") return { ok: false, reason: "manual" };
  if (status === CASE_STATUS.published) {
    // 上次案例状态写入成功但索引写入失败时，重试只补缺失索引。
    await syncReferenceIndex(env, value);
    return {
      ok: true,
      alreadyPublished: true,
      publishedAt: value.publishedAt || value.createdAt || 0,
    };
  }
  if (status !== CASE_STATUS.candidate) {
    return { ok: false, reason: "invalid_status" };
  }

  value.status = CASE_STATUS.published;
  value.publishedAt = Date.now();
  await storeCase(env, value);
  await syncReferenceIndex(env, value);
  return { ok: true, alreadyPublished: false, publishedAt: value.publishedAt };
}

/**
 * 教练后台清单：仅读取当前 KV 页，保持原 items/nextCursor/hasMore 字段。
 * 游标是 KV 不透明游标，按存储 key 顺序分页；不伪造全库精确总数。
 * @param {object} env
 * @param {{source: string, includeDeleted: boolean, limit: number, cursor: string|null}} param1
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean, total: null, totalIsExact:false}>}
 */
export async function listAdminCases(env, { source = "auto", includeDeleted = false, limit = 50, cursor }) {
  const size = Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 50));
  const page = await env.CASES.list({ prefix: "case:", limit: size, ...(cursor ? { cursor } : {}) });
  const values = await Promise.all(page.keys.slice(0, size).filter((key) => {
    const meta = key.metadata;
    if (!meta || !meta.indexed) return true;
    if (source !== "all" && meta.source !== source) return false;
    return includeDeleted || meta.status !== CASE_STATUS.rejected;
  }).map((key) => readStoredCase(env, key.name)));
  const filtered = values.filter(Boolean)
    .filter((c) => {
      if (source !== "all" && c.source !== source) return false;
      if (!includeDeleted && (c.deleted || getCaseStatus(c) === CASE_STATUS.rejected)) return false;
      return true;
    });

  // 给旧数据补一个只读 status，保持其余 API 字段完全兼容。
  const items = filtered.map((c) => ({
    ...c,
    status: getCaseStatus(c),
  }));
  return {
    items,
    nextCursor: page.list_complete ? null : page.cursor,
    hasMore: !page.list_complete,
    total: null,
    totalIsExact: false,
    scanned: page.keys.length,
    order: "storage-key",
  };
}

/**
 * 软删除即拒绝：同时写 deleted:true + status:rejected，形成不会被自动吸收覆盖的负反馈。
 * @param {object} env
 * @param {string} id - 完整 key（case: 开头）
 * @returns {Promise<boolean>} false = key 不存在
 */
export async function softDeleteCase(env, id) {
  const v = await env.CASES.get(id, "json");
  if (!v) return false;
  v.deleted = true;
  v.status = CASE_STATUS.rejected;
  v.rejectedAt = Date.now();
  await storeCase(env, v);
  await syncReferenceIndex(env, v);
  if (v.source === "manual") await rememberManual(env, v);
  return true;
}

/**
 * 旧库显式回填：每页最多 100 条，最多 601 次 KV 操作，失败可原游标重试。
 * 原 value 不改业务状态；metadata、发布索引及 manual 指纹都可重复生成。
 */
export async function reindexCases(env, { cursor, limit = 100 } = {}) {
  const size = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 100));
  const page = await env.CASES.list({ prefix: "case:", limit: size, ...(cursor ? { cursor } : {}) });
  let indexed = 0;
  for (const key of page.keys.slice(0, size)) {
    const value = await readStoredCase(env, key.name);
    if (!value || typeof value.script !== "string") continue;
    // 历史 value 缺 id 时使用实际存储 key，不生成新案例。
    value.id = key.name;
    if (!key.metadata?.indexed) await storeCase(env, value);
    await syncReferenceIndex(env, value);
    if (value.source === "manual") await rememberManual(env, value);
    indexed += 1;
  }
  return { indexed, scanned: page.keys.length, hasMore: !page.list_complete, nextCursor: page.list_complete ? null : page.cursor };
}
