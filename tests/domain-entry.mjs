import assert from "node:assert/strict";
import {readFileSync, readdirSync, lstatSync, existsSync} from "node:fs";
import {resolve, relative, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import worker from "../worker/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://lapiao.aivar.cc";
const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
assert.deepEqual(config.assets, {
  directory: "./site", binding: "ASSETS", run_worker_first: true, not_found_handling: "none",
}, "only the public site directory is uploaded, with APIs routed through the Worker first");
const publicRoot = resolve(root, config.assets.directory);
assert.equal(relative(root, publicRoot), "site");
function checkPublicTree(directory) {
  for (const item of readdirSync(directory, {withFileTypes:true})) {
    const path = resolve(directory, item.name);
    assert.equal(lstatSync(path).isSymbolicLink(), false, "public assets cannot link outside site/");
    assert.doesNotMatch(item.name, /^(?:\.dev\.vars|\.git|\.env(?:\..*)?|worker|outputs|node_modules)$/i);
    if (item.isDirectory()) checkPublicTree(path);
  }
}
checkPublicTree(publicRoot);
for (const page of ["index.html", "coach.html"]) {
  const html = readFileSync(resolve(publicRoot, page), "utf8");
  assert.match(html, /connect-src 'self' https:\/\/lapiao\.aivar\.cc/);
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)) {
    const resource = resolve(publicRoot, match[1]);
    assert.ok(!relative(publicRoot, resource).startsWith(".."));
    assert.ok(existsSync(resource), `${page}: missing ${match[1]}`);
  }
}
const browser = {URL, URLSearchParams, location:{hostname:"lapiao.aivar.cc", search:"?api=https%3A%2F%2Fevil.example"}};
browser.window = browser;
vm.runInNewContext(readFileSync(resolve(publicRoot, "js/config.js"), "utf8"), browser);
assert.equal(browser.API_BASE, origin, "the new hostname must still ignore arbitrary API overrides");

// This tiny fake represents only public assets. It never reads local secrets,
// production storage, or a provider; requests reaching it are recorded exactly.
const files = new Map([
  ["/", ["text/html; charset=utf-8", "<title>synthetic presenter</title>"]],
  ["/index.html", ["text/html; charset=utf-8", "<title>synthetic presenter</title>"]],
  ["/coach.html", ["text/html; charset=utf-8", "<title>synthetic coach</title>"]],
  ["/js/config.js", ["application/javascript; charset=utf-8", "var synthetic = true;"]],
  ["/css/common.css", ["text/css; charset=utf-8", "body { margin: 0; }"]],
]);
const assets = [];
const env = {
  ACCESS_CODE:"synthetic-domain-entry-code", ADMIN_CODE:"synthetic-domain-admin-code",
  ASSETS:{async fetch(request) {
    assets.push(request);
    const file = files.get(new URL(request.url).pathname);
    return new Response(request.method === "HEAD" ? null : (file?.[1] || "missing synthetic asset"), {
      status:file ? 200 : 404,
      headers:{"Content-Type":file?.[0] || "text/plain; charset=utf-8", "X-Synthetic-Asset":"yes"},
    });
  }},
};
const call = (path, method="GET", body) => worker.fetch(new Request(origin + path, {
  method, headers:{Origin:origin, ...(body === undefined ? {} : {"Content-Type":"application/json"})},
  ...(body === undefined ? {} : {body:JSON.stringify(body)}),
}), env, {waitUntil(){}});
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("domain entry test must never call a provider"); };
try {
  for (const [path, [type, text]] of files) {
    for (const method of ["GET", "HEAD"]) {
      const query = "?v=synthetic-test&keep=%2F";
      const requestPath = path + query;
      const response = await call(requestPath, method);
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.headers.get("Content-Type"), type);
      assert.equal(response.headers.get("X-Synthetic-Asset"), "yes");
      assert.equal(response.headers.get("Location"), null, "the public entry must stay on the chosen hostname");
      assert.equal(await response.text(), method === "HEAD" ? "" : text);
      assert.equal(assets.at(-1).url, origin + requestPath, "query strings reach the asset binding intact");
      assert.equal(assets.at(-1).method, method);
    }
  }
  const beforeProtected = assets.length;
  const health = await call("/health?probe=synthetic");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(health.headers.get("Access-Control-Allow-Origin"), origin);
  for (const [path, method, body] of [
    ["/api/coach", "POST", {voteGap:"far", script:"这是一份虚构测试稿。"}],
    ["/api/coach/jobs", "POST", {jobId:"c03940c1-25e9-4d47-a1c4-cce1bb169072"}],
    ["/api/admin/cases", "GET", undefined],
  ]) {
    const response = await call(path, method, body);
    assert.equal(response.status, 401, `${path} still requires its credential`);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal((await response.json()).error, true);
    assert.equal(response.headers.get("X-Synthetic-Asset"), null);
  }
  for (const path of ["/api", "/api/", "/api/unknown", "/health"]) {
    const method = path === "/health" ? "HEAD" : "GET";
    const response = await call(path, method);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal((await response.json()).error, true);
  }
  for (const path of ["/", "/api/coach", "/api/coach/jobs", "/api/admin/cases", "/health"]) {
    const response = await call(path, "OPTIONS");
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(response.headers.get("Access-Control-Allow-Headers"), /X-Admin-Code/);
  }
  assert.equal(assets.length, beforeProtected, "health, APIs, and preflights must never fall through to static assets");
  for (const path of ["/missing.js", "/apix", "/worker/index.js", "/.dev.vars", "/outputs/private.txt"]) {
    const response = await call(path);
    assert.equal(response.status, 404, "unknown files must not receive the presenter HTML");
    assert.doesNotMatch(await response.text(), /synthetic presenter/);
  }
  const beforePost = assets.length;
  assert.equal((await call("/", "POST", {})).status, 404);
  assert.equal(assets.length, beforePost, "asset delegation is limited to GET and HEAD");
  const fallback = await worker.fetch(new Request(origin), {}, {});
  assert.equal(fallback.status, 302, "API-only test/dev environments retain the previous entry fallback");
  assert.equal(fallback.headers.get("Location"), "https://git-chat01.github.io/tuanbo-lapiao/");
  assert.equal(externalCalls, 0);
} finally { globalThis.fetch = originalFetch; }
console.log("PASS same-domain site scope, GET/HEAD asset routing, query preservation, API auth, health, CORS and static 404 boundaries");
