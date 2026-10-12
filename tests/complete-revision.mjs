import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {revisionIssues,prepareCompleteRevision,revisionCandidate,checkRevisionPreservation} from "../worker/complete-revision.js";
import worker,{CoachRateLimiter,readDeliveredReview,sanitizeScenario} from "../worker/index.js";
import {NOVICE_SCENARIO} from "../worker/current-review.js";
import {createRateLimiterBinding} from "./helpers/rate-limiter.mjs";
import {originalScript,revisedScript,fixtureReport} from "./helpers/revision-fixtures.mjs";

// This experience change must not alter the established content, action, risk or graduation rules.
assert.equal(createHash("sha256").update(readFileSync(new URL("../worker/current-review.js",import.meta.url),"utf8").replace(/\r\n/g,"\n")).digest("hex"),"bb1762c0735637e4ca511d70bf0f8d011165234f2f8cf638db293a13227085e5");
const report=fixtureReport(),copy=structuredClone(report),until=()=>Date.now()+40000;
const valid=()=>({source:originalScript,deadline:until(),grade:async()=>fixtureReport(revisedScript,true),preserve:async()=>true});
let result=await prepareCompleteRevision(report,{script:revisedScript},valid());
assert.equal(result.ready.report.verdict,"passed");assert.equal(result.plan.status,"draft","ready is not published before the immutable receipt exists");
assert.deepEqual(report,copy,"draft preparation never changes original grading");
for(const options of [
  {grade:async()=>fixtureReport(revisedScript,false)},
  {grade:async()=>({...fixtureReport(revisedScript,true),practice_status:"awaiting_response"})},
  {grade:async()=>{throw Error("grade unavailable");}},
  {preserve:async()=>false},{preserve:async()=>{throw Error("check unavailable");}},
]) {
  result=await prepareCompleteRevision(report,{script:revisedScript},{...valid(),...options});
  assert.equal(result.ready,undefined,"both independent checks must pass");
  if(options.preserve)assert.equal(result.plan.script,"","unverified invented material cannot be offered as a reference draft");
}
let calls=0;
result=await prepareCompleteRevision(report,{script:revisedScript},{...valid(),deadline:Date.now()+1000,grade:async()=>{calls++;},preserve:async()=>{calls++;}});
assert.equal(calls,0,"optional teaching cannot consume the final delivery budget");assert.ok(result.plan.issues.length);
assert.equal(revisionCandidate({script:"字".repeat(501)},originalScript),"");
const multi=fixtureReport();multi.structure_checks[4].status="missing";multi.redline_note="实际风险";multi.line_reviews.push({original:"大家帮我上复活票吧。",mark:"wrong",comment:"这句的实际错误"});
assert.deepEqual(new Set(revisionIssues(multi,originalScript).map(x=>x.key)),new Set(["user_reason","vote_instruction","redline","line_angle"]));
assert.equal(revisionIssues({...multi,verdict:"passed"},originalScript).length,0);

const priorFetch=globalThis.fetch,priorLog=console.log,logs=[];
const jobs=[];const ctx={waitUntil:p=>jobs.push(p)};
function environment() {
  const records=new Map(),binding=createRateLimiterBinding(CoachRateLimiter);
  return {ACCESS_CODE:"synthetic-revision-code",ADMIN_CODE:"synthetic-admin",DEEPSEEK_API_KEY:"synthetic-key",COACH_LIMITER:binding,
    CASES:{get:async(k,type)=>{const value=records.get(k);return value==null?null:type==="json"?JSON.parse(value):value;},
      put:async(k,v)=>records.set(k,v),delete:async k=>records.delete(k),list:async()=>({keys:[],list_complete:true})}};
}
const response=value=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:2,completion_tokens:3}});
try {
  console.log=value=>logs.push(String(value));
  for(const problem of [null,"rejected","invented","storage"]) {
    const env=environment(),requests=[];
    if(problem==="storage") { const real=env.COACH_LIMITER;env.COACH_LIMITER={idFromName:n=>n,get(n){const obj=real.get(n);return {fetch:r=>r.method==="PUT"&&new URL(r.url).pathname==="/report"?Promise.resolve(new Response(null,{status:503})):obj.fetch(r)};}}; }
    globalThis.fetch=async(_url,o)=>{
      const body=JSON.parse(o.body),input=JSON.parse(body.messages[1].content);requests.push({input,body});
      if(input.task==="example")return response({target_status:"resolved",preserved:true,unsupported:false,evidence:input.revisedScript,reason:"补上给词接话的具体参与内容。"});
      if(input.task==="revision_preservation")return response({preserved:true,unsupported:problem==="invented",evidence:input.revisedScript,reason:"核对原稿与改稿的实际内容。"});
      assert.ok(input.currentScript,"only expected local mock calls");
      const passed=input.currentScript===revisedScript && problem!=="rejected";
      const value=fixtureReport(input.currentScript,passed);
      if(input.currentScript===originalScript)value.revision_draft={script:revisedScript};
      return response(value);
    };
    const reply=await worker.fetch(new Request("https://local.test/api/coach",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"127.0.0.75"},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript})}),env,ctx);
    const data=await reply.json();assert.equal(reply.status,200,JSON.stringify(data));assert.equal(data.report.verdict,"almost");
    assert.ok(data.report.revision_plan.issues.some(x=>x.key==="user_reason"));
    if(!problem){
      assert.equal(data.report.revision_plan.status,"ready");const ready=data.report.ready_revision;
      assert.equal(ready.script,revisedScript);assert.equal(ready.report.verdict,"passed");assert.notEqual(ready.report.report_id,data.report.report_id);
      const receipt=await readDeliveredReview(env,env.ACCESS_CODE,ready.report.report_id,"far",revisedScript,sanitizeScenario(NOVICE_SCENARIO));assert.equal(receipt.report.verdict,"passed");
      await assert.rejects(()=>readDeliveredReview(env,env.ACCESS_CODE,ready.report.report_id,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO)),/./);
      const grading=requests.filter(r=>r.input.currentScript);assert.equal(grading.length,2,"one original assessment and one complete draft assessment");
      assert.ok(grading[0].body.messages[0].content.startsWith(grading[1].body.messages[0].content),"revised text uses exactly the existing grading prompt without the teaching appendix");
      assert.equal(grading[1].body.messages[0].content.includes("整稿修改交付"),false,"independent check cannot recurse into draft generation");
    } else assert.equal(data.report.ready_revision,undefined,problem+" must not produce approval");
    if(problem==="invented")assert.equal(data.report.revision_plan.script,"");
    await Promise.all(jobs.splice(0));
  }
  globalThis.fetch=async()=>response({preserved:true,unsupported:false,evidence:"凭空造的原文",reason:"不可信"});
  await assert.rejects(()=>checkRevisionPreservation({DEEPSEEK_API_KEY:"synthetic"},{url:"https://local.test",model:"mock"},{revisedScript},until()));
} finally {globalThis.fetch=priorFetch;console.log=priorLog;}
assert.equal(logs.some(x=>x.includes(originalScript)||x.includes(revisedScript)||x.includes("synthetic-key")),false);
console.log("PASS complete revision: unchanged original verdict, all blocking findings, independent same-standard assessment, fact preservation, bounded optional work, exact immutable receipt, no recursion");
