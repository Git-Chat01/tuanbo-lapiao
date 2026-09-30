import assert from "node:assert/strict";
import worker, { CoachRateLimiter, checkCoachRateLimit, readBody } from "../worker/index.js";
import { retrieveCases, listAdminCases, tryAbsorb, addManualCase, publishCase, softDeleteCase, reindexCases } from "../worker/cases.js";
import { createRateLimiterBinding } from "./helpers/rate-limiter.mjs";

class BudgetKV {
  constructor() { this.values = new Map(); this.calls = 0; }
  count() { if (++this.calls > 1000) throw new Error("KV subrequest budget exhausted"); }
  reset() { this.calls = 0; }
  seed(key, value, metadata) { this.values.set(key, { raw: JSON.stringify(value), metadata }); }
  async list({ prefix, limit, cursor } = {}) {
    this.count();
    const keys = [...this.values.keys()].filter(k => k.startsWith(prefix)).sort();
    const offset = cursor ? Number(cursor.slice(7)) : 0;
    assert.ok(!cursor || /^cursor:\d+$/u.test(cursor), "游标保持不透明，不能把它当 offset");
    const batch = keys.slice(offset, offset + limit);
    return { keys: batch.map(name => ({ name, metadata: this.values.get(name).metadata })), list_complete: offset + batch.length >= keys.length,
      cursor: offset + batch.length < keys.length ? `cursor:${offset + batch.length}` : undefined };
  }
  async get(key, type) { this.count(); const v = this.values.get(key); return !v ? null : type === "json" ? JSON.parse(v.raw) : v.raw; }
  async put(key, raw, options) { this.count(); this.values.set(key, { raw, metadata: options?.metadata }); }
  async delete(key) { this.count(); this.values.delete(key); }
}

// 200 个并发请求只放行 60 个；DO 重启、IP 维度与下一分钟分别保持正确。
{
  const now = Date.now;
  let time = 6000000;
  Date.now = () => time;
  try {
    const binding = createRateLimiterBinding(CoachRateLimiter);
    const env = { COACH_LIMITER: binding, CASES: { async put() { throw new Error("429 KV write limit"); } } };
    const results = await Promise.all(Array.from({ length: 200 }, () => checkCoachRateLimit(env, "synthetic-code", "203.0.113.2")));
    assert.equal(results.filter(r => r === null).length, 60);
    assert.equal(results.filter(r => r?.status === 429).length, 140);
    assert.ok([...binding.states.keys()].every(key => !key.includes("synthetic-code") && !key.includes("203.0.113")));
    binding.restart();
    assert.equal((await checkCoachRateLimit(env, "synthetic-code", "203.0.113.2")).status, 429, "重启不能重置已消费额度");
    assert.equal((await checkCoachRateLimit(env, "new-code", "203.0.113.2")).status, 429, "IP 维度不能靠换码逃过");
    assert.equal(await checkCoachRateLimit(env, "other-code", "203.0.113.3"), null);
    time += 60000;
    assert.equal(await checkCoachRateLimit(env, "synthetic-code", "203.0.113.2"), null);
  } finally { Date.now = now; }
}

// 缺绑定、DO 故障或错误响应不能触发模型调用。
{
  const original = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls++; throw new Error("model must not be called"); };
  try {
    for (const binding of [undefined,
      { idFromName: x => x, get: () => ({ async fetch() { throw new Error("offline"); } }) },
      { idFromName: x => x, get: () => ({ async fetch() { return Response.json({}); } }) },
      { idFromName: x => x, get: () => ({ async fetch() { return new Response("unavailable", { status: 503 }); } }) }]) {
      const response = await worker.fetch(new Request("https://local.test/api/coach", { method: "POST", body: JSON.stringify({ accessCode: "boundary-code", voteGap: "close", script: "凯哥，想看哪段？" }) }),
        { ACCESS_CODE: "boundary-code", COACH_LIMITER: binding }, { waitUntil() {} });
      assert.equal(response.status, 503);
    }
    assert.equal(modelCalls, 0);
  } finally { globalThis.fetch = original; }
}

// 正文上限按字节，读到超限块立即取消；剩余上传不再读。
{
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify({ text: "中文😀" }));
  const body = new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.deepEqual(await readBody({ body }), { text: "中文😀" }, "跨块 UTF8 字符不能损坏");
  assert.ok(await readBody({ body: new Blob([JSON.stringify({ text: "x".repeat(10229) })]).stream() }), "恰好 10KB 合法对象允许");
  let reads = 0, cancelled = false, released = false;
  const reader = { async read() { reads++; return { value: encoder.encode("中".repeat(2000)), done: false }; }, async cancel() { cancelled = true; }, releaseLock() { released = true; } };
  await assert.rejects(readBody({ body: { getReader: () => reader } }), e => e.status === 400);
  assert.equal(reads, 2, "仅6000字节两块已经超限，不读后面的无限数据");
  assert.equal(cancelled, true); assert.equal(released, true);
  for (const value of ["null", "[]", "123", '"str"', "{bad", new Uint8Array([123,34,120,34,58,34,255,34,125])]) {
    await assert.rejects(readBody({ body: new Blob([value]).stream() }), e => e.status === 400);
  }
  const admin = await worker.fetch(new Request("https://local.test/api/admin/cases", { method: "POST", headers: { "X-Admin-Code": "boundary-admin" }, body: "null" }), { ADMIN_CODE: "boundary-admin" }, {});
  assert.equal(admin.status, 400, "后台正文错误也返回稳定400文案");
  assert.equal((await admin.json()).message, "请求格式不对");
}

// 5000 条旧库：后台按真实KV游标遍历，不超过当前页的预算；筛选空页仍有下一页。
const kv = new BudgetKV();
for (let i = 0; i < 5000; i++) {
  const id = `case:${String(i).padStart(13, "0")}:abcd`;
  kv.seed(id, { id, source: i % 2 ? "auto" : "manual", script: `大哥，最后补一点，第${i}条`, voteGap: "close", whyGood: "清楚邀请", tags: ["大哥", "最后"], createdAt: i, ...(i % 2 ? { status: "candidate" } : {}) });
}
{
  let cursor, total = 0;
  const seen = new Set();
  do {
    kv.reset();
    const page = await listAdminCases({ CASES: kv }, { source: "all", includeDeleted: true, limit: 50, cursor });
    assert.ok(kv.calls <= 51); assert.equal(page.total, null);
    assert.equal(page.items.length, 50);
    for (const item of page.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    total += page.items.length; cursor = page.nextCursor;
  } while (cursor);
  assert.equal(total, 5000);
  kv.reset();
  const filtered = await listAdminCases({ CASES: kv }, { source: "auto", limit: 1 });
  assert.equal(filtered.items.length, 0); assert.equal(filtered.hasMore, true); assert.ok(filtered.nextCursor);
  const next = await listAdminCases({ CASES: kv }, { source: "auto", limit: 1, cursor: filtered.nextCursor });
  assert.equal(next.items[0].source, "auto");
}

// 发布索引不被候选/拒绝淹没；旧库兼容窗口、全库回填及 manual 去重均有界。
{
  kv.reset();
  assert.ok((await retrieveCases({ CASES: kv }, { voteGap: "close", script: "大哥，最后补一点" })).length > 0);
  assert.ok(kv.calls <= 138);
  kv.reset();
  const manual = await addManualCase({ CASES: kv }, { voteGap: "close", script: "大哥，今晚最后补一点，我说到做到", whyGood: "新经验" });
  kv.reset();
  let references = await retrieveCases({ CASES: kv }, { voteGap: "close", script: "大哥今晚最后说到做到" });
  assert.ok(references.some(c => c.whyGood === "新经验"), "窗口外的新投喂必须从索引命中");
  assert.ok(kv.calls <= 138);
  kv.reset();
  assert.equal(await tryAbsorb({ CASES: kv }, { voteGap: "close", script: "大哥，今晚最后补一点，我说到做到", report: {} }), null);
  assert.ok(kv.calls < 5);

  kv.reset();
  const candidate = await tryAbsorb({ CASES: kv }, { voteGap: "far", script: "兄弟们今晚亮一手，愿意的补一点", report: {} });
  kv.reset();
  assert.ok(!(await retrieveCases({ CASES: kv }, { voteGap: "far", script: "兄弟们今晚亮一手" })).some(c => c.script.includes("兄弟们")));
  kv.reset(); await publishCase({ CASES: kv }, candidate);
  kv.reset();
  assert.ok((await retrieveCases({ CASES: kv }, { voteGap: "far", script: "兄弟们今晚亮一手" })).some(c => c.script.includes("兄弟们")));
  kv.reset(); await softDeleteCase({ CASES: kv }, candidate);
  kv.reset();
  assert.ok(!(await retrieveCases({ CASES: kv }, { voteGap: "far", script: "兄弟们今晚亮一手" })).some(c => c.script.includes("兄弟们")));
  kv.reset(); assert.equal(await tryAbsorb({ CASES: kv }, { voteGap: "far", script: "兄弟们今晚亮一手，愿意的补一点", report: {} }), null);

  // 分批回填全部旧数据；每次最多100条，调用失败可用原游标重试。
  let cursor, indexed = 0;
  do {
    kv.reset();
    const page = await reindexCases({ CASES: kv }, { cursor, limit: 100 });
    assert.ok(kv.calls <= 601, "回填单页预算固定，不靠全量读");
    indexed += page.indexed; cursor = page.nextCursor;
  } while (cursor);
  assert.equal(indexed, 5002);
  kv.reset();
  const repeated = await reindexCases({ CASES: kv }, { limit: 100 });
  assert.equal(repeated.indexed, 100); assert.ok(kv.calls <= 251, "已回填页不重复改写业务数据");
  kv.reset();
  const outsideLegacyScript = "大哥，最后补一点，第4998条";
  assert.equal(await tryAbsorb({ CASES: kv }, { voteGap: "close", script: outsideLegacyScript, report: {} }), null, "回填后窗口外manual也能直读去重");
  kv.reset(); await softDeleteCase({ CASES: kv }, manual);
  kv.reset();
  references = await retrieveCases({ CASES: kv }, { voteGap: "close", script: "大哥今晚最后说到做到" });
  assert.ok(references.every(c => c.whyGood !== "新经验"));
  assert.ok(kv.calls <= 138);
}

// 发布和投喂在案例写入后索引瞬时失败：重试只补缺失索引，不能复制案例。
{
  const storage = new BudgetKV();
  const candidate = "case:absorb:far:retry";
  storage.seed(candidate, { id: candidate, source: "auto", status: "candidate", script: "今晚亮一手，想看的补一点", tags: ["今晚", "亮一手"], voteGap: "far", createdAt: 1 });
  const put = storage.put.bind(storage);
  let failReference = true;
  storage.put = async (key, value, options) => {
    if (failReference && key.startsWith("reference:")) { failReference = false; throw new Error("transient index PUT failure"); }
    return put(key, value, options);
  };
  await assert.rejects(publishCase({ CASES: storage }, candidate), /transient/u);
  const publishedAt = (await storage.get(candidate, "json")).publishedAt;
  const repaired = await publishCase({ CASES: storage }, candidate);
  assert.equal(repaired.alreadyPublished, true); assert.equal(repaired.publishedAt, publishedAt);
  const count = storage.calls;
  await publishCase({ CASES: storage }, candidate);
  assert.equal(storage.calls - count, 2, "正常重复发布仅get案例+get既有索引，不能重新PUT");
  assert.equal((await retrieveCases({ CASES: storage }, { voteGap: "far", script: "今晚亮一手" })).length, 1);

  failReference = true;
  const manual = { voteGap: "close", script: "大哥，今晚最后补一点", whyGood: "有明确邀请" };
  await assert.rejects(addManualCase({ CASES: storage }, manual), /transient/u);
  const sameId = await addManualCase({ CASES: storage }, manual);
  assert.match(sameId, /^case:manual:close:[a-f0-9]{16}$/u);
  assert.equal([...storage.values.keys()].filter(k => k.startsWith("case:manual:")).length, 1);
  assert.equal(await addManualCase({ CASES: storage }, manual), sameId);
  assert.ok((await retrieveCases({ CASES: storage }, { voteGap: "close", script: "大哥今晚最后" })).some(c => c.whyGood === manual.whyGood));
  await softDeleteCase({ CASES: storage }, sameId);
  await assert.rejects(addManualCase({ CASES: storage }, manual), e => e.status === 409);
}

// 回填跳过坏JSON，保留同页有效记录；KV服务故障仍抛出，不假装完整成功。
{
  const storage = new BudgetKV();
  storage.values.set("case:0:bad", { raw: "{bad", metadata: undefined });
  storage.seed("case:1:good", { source: "manual", script: "大哥，最后补一点", voteGap: "close", whyGood: "有效旧案例", createdAt: 1 });
  const page = await reindexCases({ CASES: storage }, { limit: 100 });
  assert.equal(page.indexed, 1); assert.equal(page.scanned, 2); assert.equal(page.hasMore, false);
  assert.equal((await storage.get("case:1:good", "json")).id, "case:1:good");
  assert.equal((await retrieveCases({ CASES: storage }, { voteGap: "close", script: "大哥最后" })).length, 1);
  const get = storage.get.bind(storage);
  storage.get = async key => { if (key.startsWith("case:")) throw new Error("KV offline"); return get(key); };
  await assert.rejects(reindexCases({ CASES: storage }), /KV offline/u);
}

console.log("PASS concurrent durable limits, bounded body parsing, 5000-case pagination and recoverable indexing");

// A rejected idempotent manual retry is a stable HTTP conflict.
{
  const store = new BudgetKV();
  const payload = {voteGap:"close",script:"明确的手工投喂",whyGood:"老师审核理由"};
  const id = await addManualCase({CASES:store},payload);
  await softDeleteCase({CASES:store},id);
  const response = await worker.fetch(new Request("https://local.test/api/admin/cases",{method:"POST",headers:{"X-Admin-Code":"boundary-admin"},body:JSON.stringify(payload)}),{ADMIN_CODE:"boundary-admin",CASES:store},{});
  assert.equal(response.status,409);
  assert.match((await response.json()).message,/删除或拒绝/);
}
