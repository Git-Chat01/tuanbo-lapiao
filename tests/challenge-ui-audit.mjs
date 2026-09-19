// Read-only follow-up to the UI audit, with fake timers and the saved original model output.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
const root=new URL("../",import.meta.url);
const audit=JSON.parse(await readFile(new URL("tests/tmp_results/challenge-audit.json",root),"utf8"));
const first=audit.outcomes.find(item=>item.id==="baseline#1");
const timers=[];
let fetchCount=0;
const api=vm.createContext({console,Promise,Date,JSON,Error,API_BASE:"https://test.invalid",App:{getAccessCode:()=>"fake",toast(){}},
  setTimeout(fn,ms){timers.push({fn,ms,cleared:false});return timers.length;},
  clearTimeout(id){if(timers[id-1]) timers[id-1].cleared=true;},
  fetch(){fetchCount++;return fetchCount===1?Promise.resolve({ok:false,status:502,text:()=>Promise.resolve('{"error":true,"message":"test gateway failure"}')}):new Promise(()=>{});},
});
api.window=api;
vm.runInContext(await readFile(new URL("site/js/api.js",root),"utf8"),api);
api.Api.submit({script:first.script,voteGap:"close"},{});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
await flush();
const retryTimer=timers.find(t=>t.ms===1500);
assert.ok(retryTimer);
retryTimer.fn();retryTimer.cleared=true;
await flush();
assert.equal(fetchCount,2);
const retryTimeout={fetchCount,inFlight:api.Api._inFlight,watchdogCleared:timers.find(t=>t.ms===105000).cleared,activeTimers:timers.filter(t=>!t.cleared).length};
assert.equal(retryTimeout.activeTimers,1,"Retry must retain its total deadline timer");
const ctx=vm.createContext({console,App:{state:{lastRequest:{scenario:audit.scenario,script:first.script}}}});
vm.runInContext(await readFile(new URL("site/js/report.js",root),"utf8"),ctx);
const focus=ctx.Report._focusCheck(ctx.Report._checks(first.report),first.report);
const helperHints=ctx.Report._helpItemsFor(first.report,focus);
// Replay real same-text ratings in an order that exhibits the UI's regression wording.
const partial=audit.outcomes.find(o=>o.id.startsWith("baseline")&&o.report.structure_checks.find(c=>c.key==="gratitude").status==="partial");
const missing=audit.outcomes.find(o=>o.id.startsWith("baseline")&&o.report.structure_checks.find(c=>c.key==="gratitude").status==="missing");
const p1=ctx.Report._recordResult(partial.report);
const p2=ctx.Report._recordResult(missing.report);
const result={retryTimeout,helperHints,secondAttemptHelpEligible:ctx.Report._shouldOpenHelp(p2),note:"Historical ratings replayed against current helpers; direct visibility is covered by frontend-safety.mjs",sameTextStatusDrift:{first:partial.report.structure_checks.find(c=>c.key==="gratitude"),second:missing.report.structure_checks.find(c=>c.key==="gratitude")}};
await writeFile(new URL("tests/tmp_results/challenge-ui-current.json",root),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
