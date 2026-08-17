// 案例库模块（v2 自成长系统核心）
// 职责：
//   - retrieveCases：批改时检索相似案例注入 prompt——系统越用越懂
//   - tryAbsorb：过关稿自动吸收（永不抛错，失败只记日志，不阻塞响应）
//   - addManualCase / listAdminCases / softDeleteCase：教练后台投喂、清单、软删除
// 存储：Cloudflare KV（binding: CASES），key 格式 case:{epochMs}:{8位hex随机}
// KV 没有模糊查询 → list 全量 + 内存过滤打分（案例量级几百条，读量远低于免费额度）

// ---- 术语表：写 tags 与检索共用，全部 ≥2 字组合词避免单字误伤 ----
// 覆盖三类关键信号：求情卖惨（坏方向）/ 条件谈判（好方向）/ 递台阶（好方向）
export const TERMS = [
  // 求情卖惨类
  "求求", "可怜", "帮帮忙", "拜托", "救救",
  // 条件谈判类
  "上票", "保位", "差一点", "最后", "倒计时", "整活", "说到做到", "不怂",
  // 递台阶类
  "大哥", "家人们", "兄弟", "首播", "第一次", "今晚", "亮一手", "带一带",
];

/**
 * 从话术提取术语标签（写入案例 tags 字段，检索时取交集算重叠度）。
 * @param {string} script - 话术全文
 * @returns {string[]}
 */
export function extractTags(script) {
  return TERMS.filter((t) => script.includes(t));
}

/**
 * 生成案例 key：时间戳前缀保证 list 可近似按创建序扫描，随机段防碰撞。
 * @returns {string} 形如 case:1755410000000:a1b2c3d4
 */
function makeCaseId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `case:${Date.now()}:${hex}`;
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
 * @param {{voteGap: string, script: string}} param1
 * @returns {Promise<{source:string, voteGap:string, script:string, whyGood:string}[]>} 最多 3 篇
 */
export async function retrieveCases(env, { voteGap, script }) {
  const all = await listAllCases(env);
  const now = Date.now();

  // 硬过滤：未删除 + 票况匹配
  let pool = all.filter((c) => !c.deleted && c.voteGap === voteGap);
  let relaxed = false;
  if (pool.length === 0) {
    pool = all.filter((c) => !c.deleted);
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
  return scored.slice(0, 3).map(({ c }) => ({
    source: c.source,
    voteGap: c.voteGap,
    script: c.script.length > 200 ? c.script.slice(0, 200) + "…" : c.script,
    whyGood: c.whyGood || "",
  }));
}

/**
 * 自动吸收过关稿（主流程在 ctx.waitUntil 里调用，KV 写失败不影响批改响应）。
 * 前置闸门由调用方保证：verdict=passed 且无红线且非人设卡。
 * 同稿去重：script 归一化（去空白）相同且票况相同 → 跳过。
 * @param {object} env
 * @param {{script: string, voteGap: string, report: object}} param1 - report 为归一化后的批改报告
 * @returns {Promise<string|null>} 新案例 id，去重跳过返回 null
 */
export async function tryAbsorb(env, { script, voteGap, report }) {
  const norm = script.replace(/\s+/g, "");
  const all = await listAllCases(env);
  const dup = all.some(
    (c) => !c.deleted && c.voteGap === voteGap && c.script.replace(/\s+/g, "") === norm
  );
  if (dup) return null;

  const id = makeCaseId();
  // verdict_reason / one_thing 本身可能以句号结尾，先去掉尾部标点再拼接，避免"。。"
  const reason = (report.verdict_reason || "").replace(/[。！!]+$/, "");
  const learned = (report.one_thing || "").replace(/[。！!]+$/, "");
  const value = {
    id,
    source: "auto",
    script,
    voteGap,
    whyGood: `过关理由：${reason}。这次她学会：${learned}`,
    tags: extractTags(script),
    createdAt: Date.now(),
    deleted: false,
  };
  await env.CASES.put(id, JSON.stringify(value));
  return id;
}

/**
 * 教练手动投喂优秀话术（权威最高，检索时排在 auto 前面）。
 * @param {object} env
 * @param {{voteGap: string, script: string, whyGood: string}} param1
 * @returns {Promise<string>} 新案例 id
 */
export async function addManualCase(env, { voteGap, script, whyGood }) {
  const id = makeCaseId();
  const value = {
    id,
    source: "manual",
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
      if (!includeDeleted && c.deleted) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    hasMore: offset + limit < filtered.length,
    total: filtered.length,
  };
}

/**
 * 软删除：覆写 deleted:true（不用 KV delete——可反悔、可溯源、最终一致性下更稳）。
 * @param {object} env
 * @param {string} id - 完整 key（case: 开头）
 * @returns {Promise<boolean>} false = key 不存在
 */
export async function softDeleteCase(env, id) {
  const v = await env.CASES.get(id, "json");
  if (!v) return false;
  v.deleted = true;
  await env.CASES.put(id, JSON.stringify(v));
  return true;
}
