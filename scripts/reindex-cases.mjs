// 管理员显式分批回填；不读 .dev.vars、不导出案例正文、不改变业务状态。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

if (!process.argv.includes("--execute")) {
  console.log("用法：设置 ADMIN_CODE 环境变量后执行 node scripts/reindex-cases.mjs --execute [--max-pages=1] [--api=https://lapiao.aivar.cc] [--restart]。默认只处理一页；再次执行从检查点继续。");
  process.exit(0);
}
const argument = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const api = new URL(argument("api", "https://lapiao.aivar.cc"));
if (api.username || api.password || api.search || api.hash || api.pathname !== "/" ||
  (api.protocol !== "https:" && !(api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)))) {
  throw new Error("API 必须是 HTTPS origin，或本地回环 HTTP origin");
}
const code = process.env.ADMIN_CODE;
if (!code || code.length < 8) throw new Error("请先设置 ADMIN_CODE 环境变量（不打印密码）");
const maxPages = Number(argument("max-pages", "1"));
if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) throw new Error("max-pages 必须在 1–1000 之间");
const checkpoint = resolve(argument("checkpoint", "tests/tmp_results/case-index-v1.json"));
let state = { version: 1, origin: api.origin, nextCursor: null, done: false, indexed: 0 };
if (!process.argv.includes("--restart")) {
  try {
    state = JSON.parse(await readFile(checkpoint, "utf8"));
    if (state.version !== 1 || state.origin !== api.origin || (state.nextCursor != null && typeof state.nextCursor !== "string")) throw new Error("检查点不匹配当前 API");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (state.done) {
  console.log("回填已完成；如需重新扫描，显式传 --restart。");
  process.exit(0);
}
await mkdir(dirname(checkpoint), { recursive: true });
for (let page = 0; page < maxPages; page++) {
  // 先保存本页游标；失败时再次运行仍处理本页，不跳过未完成的记录。
  await writeFile(checkpoint, JSON.stringify(state, null, 2));
  const response = await fetch(new URL("/api/admin/cases/reindex", api), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Code": code },
    body: JSON.stringify({ cursor: state.nextCursor, limit: 100 }), signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`本页未完成（HTTP ${response.status}），保留游标，可稍后重新运行。`);
  if (typeof result.hasMore !== "boolean" || (result.hasMore && typeof result.nextCursor !== "string")) throw new Error("服务返回了不合法的分页结果，未推进检查点");
  state.nextCursor = result.nextCursor;
  state.done = !result.hasMore;
  state.indexed += result.indexed || 0;
  await writeFile(checkpoint, JSON.stringify(state, null, 2));
  console.log(`本页回填 ${result.indexed} 条；累计 ${state.indexed} 条；${state.done ? "完成" : "可继续"}。`);
  if (state.done) break;
  await new Promise(resolve => setTimeout(resolve, 1100));
}
