// 案例库模块（v3 受控自成长系统核心）
// 职责：
//   - retrieveCases：批改时只检索已发布案例注入 prompt
//   - tryAbsorb：过关稿写入学习候选池（不直接参与检索）
//   - addManualCase / publishCase / listAdminCases / softDeleteCase：投喂、发布、清单、拒绝
// 存储：Cloudflare KV（binding: CASES）。
// key 两种格式：
//   - 教练投喂：case:{epochMs}:{8位hex随机}
//   - 自动吸收：case:absorb:{voteGap}:{稿子归一化hash}——确定性 key，
//     同稿同票况永远落同一个 key；key 已存在（包括 rejected）就跳过。
//     list 去重仍用于发现随机 key 的 manual 同稿；确定性 key 负责幂等兜底。
// 生命周期：candidate（自动候选）/ published（教练发布）/ rejected（删除或拒绝）。
// 兼容旧数据：无 status 的 manual 视为 published；无 status 的 auto 视为 candidate。
// KV 没有模糊查询 → list 全量 + 内存过滤打分（案例量级几百条，读量远低于免费额度）

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
  "secondsLeft",
  "votesNeeded",
  "hostCue",
  "targetUser",
  "userSignal",
  "recentGift",
  "trainingGoal",
];

/** 只保存 Worker 已清洗过的场景白名单字段，并生成独立快照。 */
function snapshotScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return null;
  const snapshot = {};
  for (const key of SCENARIO_FIELDS) {
    const value = scenario[key];
    if (typeof value === "number" && Number.isFinite(value)) snapshot[key] = value;
    if (typeof value === "string" && value.trim()) snapshot[key] = value;
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
 * 生成教练投喂案例 key：时间戳前缀保证 list 可近似按创建序扫描，随机段防碰撞。
 * @returns {string} 形如 case:1755410000000:a1b2c3d4
 */
function makeCaseId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `case:${Date.now()}:${hex}`;
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

/**
 * 全量拉取案例库（list 分页循环 + 每页并发 get）。
 * @param {object} env - Worker env（含 CASES KV binding）
 * @returns {Promise<object[]>} 全部案例 value（损坏条目被过滤）
 */
async function listAllCases(env) {
  const values = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: "case:", limit: 1000, cursor });
    const batch = await Promise.all(page.keys.map((k) => env.CASES.get(k.name, "json")));
    values.push(...batch.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return values;
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
  const all = await listAllCases(env);
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
      const kwOverlap = (c.tags || []).filter((t) => incomingTerms.includes(t)).length;
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

  // 每篇 script 截 200 字控制 prompt 体积
  return scored.slice(0, 3).map(({ c }) => {
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

  // 全库去重覆盖 manual 随机 key；deleted/rejected 也算重复，这是持久负反馈。
  const all = await listAllCases(env);
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
  await env.CASES.put(id, JSON.stringify(value));
  return id;
}

/**
 * 教练手动投喂优秀话术：直接视为 published，可参与检索。
 * @param {object} env
 * @param {{voteGap: string, script: string, whyGood: string}} param1
 * @returns {Promise<string>} 新案例 id
 */
export async function addManualCase(env, { voteGap, script, whyGood }) {
  const id = makeCaseId();
  const value = {
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
  await env.CASES.put(id, JSON.stringify(value));
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
  await env.CASES.put(id, JSON.stringify(value));
  return { ok: true, alreadyPublished: false, publishedAt: value.publishedAt };
}

/**
 * 教练后台清单：全量拉取 → 过滤 → 按创建时间倒序 → offset 游标分页。
 * @param {object} env
 * @param {{source: string, includeDeleted: boolean, limit: number, cursor: string|null}} param1
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean, total: number}>}
 */
export async function listAdminCases(env, { source = "auto", includeDeleted = false, limit = 50, cursor }) {
  const all = await listAllCases(env);
  const filtered = all
    .filter((c) => {
      if (source !== "all" && c.source !== source) return false;
      if (!includeDeleted && (c.deleted || getCaseStatus(c) === CASE_STATUS.rejected)) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
  // 给旧数据补一个只读 status，保持其余 API 字段完全兼容。
  const items = filtered.slice(offset, offset + limit).map((c) => ({
    ...c,
    status: getCaseStatus(c),
  }));
  return {
    items,
    nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    hasMore: offset + limit < filtered.length,
    total: filtered.length,
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
  await env.CASES.put(id, JSON.stringify(v));
  return true;
}
