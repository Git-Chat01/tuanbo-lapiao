import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {revisionIssues,prepareCompleteRevision,revisionCandidate,checkRevisionPreservation,completeRevisionMessages,generateRevisionDraft,introducedRevisionCapability,revisionPreservationSegments} from "../worker/complete-revision.js";
import worker,{CoachRateLimiter,readDeliveredReview,sanitizeScenario,saveDeliveredReview,generateCompleteRevisionReview} from "../worker/index.js";
import {NOVICE_SCENARIO,SYSTEM_PROMPT} from "../worker/current-review.js";
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

// This narrow generated-only guard rejects invented activities, not ordinary interaction or wording.
const inventedActivities="想听我唱一句，还是说一句方言？想听的朋友帮我补一票。";
const introduced=introducedRevisionCapability(originalScript,inventedActivities);
assert.match(introduced.reason,/唱歌.*方言/);assert.ok(inventedActivities.includes(introduced.evidence));
for(const candidate of ["我跳一段给你们看。","我用英语说一句问候。","我用东北口音接一句招呼。"])assert.ok(introducedRevisionCapability(originalScript,candidate));
for(const candidate of [revisedScript,"你给个普通词，我接一句招呼。想听的帮我补票。","别唱反调啦，你们给个词我接一句。","我不会唱歌，也不想跳舞，给个普通词我接一句。"])assert.equal(introducedRevisionCapability(originalScript,candidate),null,candidate);
assert.equal(introducedRevisionCapability("我能用家乡话接一句问候。","你给个普通词，我用家乡口音接一句问候。"),null);
assert.equal(introducedRevisionCapability("我会唱歌，可以唱一句。","你们出个词，我唱一句已有歌曲。"),null);
const priorFetch=globalThis.fetch,priorLog=console.log,logs=[];
const jobs=[];const ctx={waitUntil:p=>jobs.push(p)};
function environment() {
  const records=new Map(),binding=createRateLimiterBinding(CoachRateLimiter);
  return {ACCESS_CODE:"synthetic-revision-code",ADMIN_CODE:"synthetic-admin",DEEPSEEK_API_KEY:"synthetic-key",COACH_LIMITER:binding,
    CASES:{get:async(k,type)=>{const value=records.get(k);return value==null?null:type==="json"?JSON.parse(value):value;},
      put:async(k,v)=>records.set(k,v),delete:async k=>records.delete(k),list:async()=>({keys:[],list_complete:true})}};
}
const response=value=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:2,completion_tokens:3}});
// Original grading uses the complete report; generated candidates use the actual
// independent short contract, with source quotations rather than a fake report.
const gradingPrefix=SYSTEM_PROMPT.slice(0,SYSTEM_PROMPT.indexOf("【一次解决一类问题，而且改法必须有效】"));
function modelResponse(input,report) {
  if(input.task!=="recover_current_review")return response(report);
  const core=["user_reason","vote_instruction"].map(key=>{
    const check=report.structure_checks.find(item=>item.key===key);
    return {key,status:check.status,quote:check.status==="missing"?"":input.currentScript,reason:check.status==="met"?"原稿明确说明了这项参与内容或支持动作。":"当前稿尚未说明观众可参与的具体内容。"};
  });
  return response({core,risks:[],awaiting_response:false,
    focus:{focus_key:report.verdict==="passed"?"final_polish":"user_reason",keep:report.coaching.keep,original:report.coaching.original,
      action:report.coaching.action,why:report.coaching.why},
    interaction:{reading:report.interaction_review.reading,why:report.interaction_review.why,next_check:report.interaction_review.next_check}});
}
const preservationChecks=input=>revisionPreservationSegments(input.revisedScript).map(({index,text})=>({
  segment:index,kind:input.originalScript.includes(text)?"source":"proposal",
  sourceQuote:input.originalScript.includes(text)?text:"",reason:"保留已知事实或补当下可执行的有限互动。",
}));
try {
  console.log=value=>logs.push(String(value));
  for(const problem of [null,"rejected","invented","unavailable","storage"]) {
    const env=environment(),requests=[];let recovered=false;
    // A rejected candidate must itself carry a valid negative review. The normal
    // successful candidate lacks fixtureReport(false).coaching.original.
    const candidateScript=problem==="rejected" ? originalScript+"谢谢大家。" : revisedScript;
    if(problem==="storage") { const real=env.COACH_LIMITER;env.COACH_LIMITER={idFromName:n=>n,get(n){const obj=real.get(n);return {fetch:r=>r.method==="PUT"&&new URL(r.url).pathname==="/report"?Promise.resolve(new Response(null,{status:503})):obj.fetch(r)};}}; }
    globalThis.fetch=async(_url,o)=>{
      const body=JSON.parse(o.body),input=JSON.parse(body.messages[1].content);requests.push({input,body});
      if(input.task==="complete_revision")return response({script:candidateScript,changes:input.issues.map(item=>({issue:item.issue,revised:candidateScript,why:"补上具体内容并保留复活邀请。"}))});
      if(input.task==="example")return response({target_status:"resolved",preserved:true,unsupported:false,evidence:input.revisedScript,reason:"补上给词接话的具体参与内容。"});
      if(input.task==="revision_preservation")return response({preserved:true,unsupported:problem==="invented",evidence:input.revisedScript,reason:"核对原稿与改稿的实际内容。",checks:preservationChecks(input)});
      assert.ok(input.currentScript,"only expected local mock calls");
      if(problem==="unavailable" && input.currentScript===candidateScript && !recovered)throw Error("synthetic review unavailable");
      const passed=input.currentScript===revisedScript && problem!=="rejected";
      const value=fixtureReport(input.currentScript,passed);
      if(input.currentScript===originalScript)value.revision_draft={script:revisedScript};
      return modelResponse(input,value);
    };
    const reply=await worker.fetch(new Request("https://local.test/api/coach",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"127.0.0.75"},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript})}),env,ctx);
    const originalData=await reply.json();assert.equal(reply.status,200,JSON.stringify(originalData));assert.equal(originalData.report.verdict,"almost");
    assert.equal(originalData.report.ready_revision,undefined,"grading never waits for or silently substitutes a partial rewrite");
    // History unavailable keeps the grading result, without pretending the reference is approved.
    const data=problem==="storage" ? originalData : await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,completeRevision:{reportId:originalData.report.report_id}},env,ctx);
    assert.equal(data.report.report_id,originalData.report.report_id,"complete-script task preserves original receipt and verdict");
    assert.ok(data.report.revision_plan.issues.some(x=>x.key==="user_reason"));
    if(!problem){
      assert.equal(data.report.revision_plan.status,"ready");const ready=data.report.ready_revision;
      assert.equal(ready.script,revisedScript);assert.equal(ready.report.verdict,"passed");assert.notEqual(ready.report.report_id,data.report.report_id);
      const receipt=await readDeliveredReview(env,env.ACCESS_CODE,ready.report.report_id,"far",revisedScript,sanitizeScenario(NOVICE_SCENARIO));assert.equal(receipt.report.verdict,"passed");
      await assert.rejects(()=>readDeliveredReview(env,env.ACCESS_CODE,ready.report.report_id,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO)),/./);
      const grading=requests.filter(r=>r.input.currentScript);assert.equal(grading.length,2,"one original assessment and one complete draft assessment");
      assert.ok(grading.every(r=>r.body.thinking?.type==="enabled"&&r.body.reasoning_effort==="high"),"original and independent review both use the evaluated high effort");
      assert.ok(requests.every(r=>r.body.thinking?.type==="enabled"&&r.body.reasoning_effort==="high"),"every production model stage uses high, including generation and checks");
      assert.equal(grading[1].input.task,"recover_current_review","the generated candidate is independently judged through the short evidence contract");
      assert.ok(grading.every(request=>request.body.messages[0].content.startsWith(gradingPrefix)),"both manuscripts keep the exact same unchanged scoring rules");
      assert.equal(grading[1].input.previousLesson,undefined);assert.equal(grading[1].input.issues,undefined,"original teaching advice cannot bias candidate approval");
      assert.equal(grading[1].body.messages[0].content.includes("整稿修改交付"),false,"independent check cannot recurse into draft generation");
    } else assert.equal(data.report.ready_revision,undefined,problem+" must not produce approval");
    if(problem==="rejected") {
      const plan=data.report.revision_plan,attemptId=plan.attempt_report_id;
      assert.match(attemptId,/^[0-9a-f-]{36}$/i,"unfinished complete drafts have a retrievable immutable attempt receipt");
      assert.ok(plan.remaining_issues.length,"a rejected complete draft records the actual remaining problems");
      const attempt=await readDeliveredReview(env,env.ACCESS_CODE,attemptId,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO));
      assert.equal(attempt.report.complete_parent_report_id,originalData.report.report_id);
      assert.equal(attempt.report.revision_plan.script,plan.script);
      assert.deepEqual(attempt.report.revision_plan.remaining_issues,plan.remaining_issues);
      const beforeRetry=requests.length;
      const retried=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
        completeRevision:{reportId:originalData.report.report_id,attemptReportId:attemptId}},env,ctx);
      const nextDraft=requests.slice(beforeRetry).find(request=>request.input.task==="complete_revision");
      assert.ok(nextDraft,"retry continues the full rewrite after an independently rejected draft");
      assert.equal(nextDraft.input.previousDraft,plan.script,"retry starts from the exact prior complete draft");
      assert.deepEqual(nextDraft.input.remainingIssues,plan.remaining_issues,"retry receives validated remaining issues from the stored attempt");
      assert.equal(retried.report.report_id,originalData.report.report_id);
      assert.equal(retried.report.verdict,originalData.report.verdict,"teaching retries never change the original assessment");
      assert.equal(retried.report.ready_revision,undefined,"a rejected retry cannot gain approval from its attempt receipt");
      assert.notEqual(retried.report.revision_plan.attempt_report_id,attemptId,"each attempted result receives a fresh immutable receipt");
      const unchanged=await readDeliveredReview(env,env.ACCESS_CODE,attemptId,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO));
      assert.deepEqual(unchanged,attempt,"continuing the rewrite must not mutate the previous attempt record");
      const anotherParent=structuredClone(originalData.report);
      await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),anotherParent);
      const beforeReject=requests.length;
      await assert.rejects(()=>generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
        completeRevision:{reportId:anotherParent.report_id,attemptReportId:attemptId}},env,ctx),error=>error.status===400,
        "same script and scene do not authorize reusing an attempt from a different parent report");
      assert.equal(requests.length,beforeReject,"cross-parent attempts are rejected before spending model tokens");
      await assert.rejects(()=>generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
        completeRevision:{reportId:originalData.report.report_id,attemptReportId:originalData.report.report_id}},env,ctx),error=>error.status===400,
        "an ordinary original receipt cannot masquerade as a complete-draft attempt");
    }
    if(problem==="unavailable") {
      const plan=data.report.revision_plan;
      assert.equal(plan.script,revisedScript,"a fidelity-checked full draft survives temporary independent-review unavailability");
      assert.equal(plan.status,"draft");assert.equal(plan.remaining_issues,undefined);
      assert.match(plan.attempt_report_id,/^[0-9a-f-]{36}$/i);
      recovered=true;const beforeRetry=requests.length;
      const retried=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
        completeRevision:{reportId:originalData.report.report_id,attemptReportId:plan.attempt_report_id}},env,ctx);
      assert.equal(requests.slice(beforeRetry).filter(request=>request.input.task==="complete_revision").length,0,
        "retry rechecks the preserved draft instead of paying to regenerate identical wording");
      assert.equal(retried.report.revision_plan.status,"ready");assert.equal(retried.report.ready_revision.script,revisedScript);
      assert.equal(retried.report.report_id,originalData.report.report_id);
    }
    if(problem==="invented")assert.equal(data.report.revision_plan.script,"");
    await Promise.all(jobs.splice(0));
  }
  // Both new talents are rejected together and stay blocked when a saved candidate is rechecked.
  {
    const env=environment(),issues=revisionIssues(fixtureReport(),originalScript);let calls=0,rejected;
    globalThis.fetch=async()=>{calls++;return response({script:inventedActivities,changes:issues.map((_,issue)=>({issue,revised:inventedActivities,why:"集中改完整稿。"}))});};
    await assert.rejects(()=>generateRevisionDraft(env,{url:"https://local.test",model:"mock"},{source:originalScript,issues},until()),error=>{
      assert.equal(error.revisionRepair.script,inventedActivities);
      assert.match(error.revisionRepair.remainingIssues[0].why,/唱歌.*方言/);
      assert.ok(inventedActivities.includes(error.revisionRepair.remainingIssues[0].original));return true;
    });
    assert.equal(calls,1);
    const preserved=await checkRevisionPreservation(env,{url:"https://local.test",model:"mock",onRejected:value=>{rejected=value;}},
      {originalScript,revisedScript:inventedActivities,issues},until());
    assert.equal(preserved,false);assert.equal(calls,1,"a previously saved unsupported activity cannot bypass the local check by model approval");
    assert.match(rejected.reason,/唱歌.*方言/);
  }
  // Full-script checks always use the real short independent grading contract.
  for(const kind of ["passed","not-passed","bad-evidence","safety-rejected"]) {
    const env=environment(),parent=fixtureReport(),recoveryRequests=[];let primaryCalls=0;
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    const candidate=kind==="not-passed" ? originalScript+"谢谢大家。" :
      kind==="safety-rejected" ? revisedScript+"求求你，跪下求你们给我上票。" : revisedScript;
    const participation="你们给个普通词，我接一句打招呼",ask="大家帮我上复活票吧。";
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
      if(input.task==="complete_revision")return response({script:candidate,changes:input.issues.map(item=>({issue:item.issue,revised:candidate,why:"集中调整原稿的参与内容。"}))});
      if(input.task==="revision_preservation")return response({preserved:true,unsupported:false,evidence:candidate,reason:"按原稿事实核对完整改稿。",checks:preservationChecks(input)});
      if(input.task==="recover_current_review") {
        recoveryRequests.push({input,body});
        const notPassed=kind==="not-passed",original=notPassed?ask:participation;
        return response({verdict:"passed",core:[
          {key:"user_reason",status:notPassed?"partial":"met",quote:kind==="bad-evidence"?"不存在的证据":original,
            reason:notPassed?"只有复活请求，还没有观众能参与的具体内容。":"观众给普通词，主播接一句招呼，参与过程具体。"},
          {key:"vote_instruction",status:"met",quote:notPassed?ask:"想听的朋友帮我上点复活票。",reason:"说清了现在邀请观众帮助复活。"}],
          risks:[],awaiting_response:false,
          focus:{focus_key:notPassed?"user_reason":"final_polish",keep:"保留新人身份和复活邀请。",original,
            action:notPassed?"沿新人名字补一个给词接招呼的互动，再接复活邀请。":"保留这版并观察真实回应。",why:notPassed?"原来只有自己的需要，要让观众听懂可以怎样参与。":"具体参与内容和当下动作已经说清。"},
          interaction:{reading:"新人向不熟悉的观众发出复活邀请。",why:notPassed?"请求清楚，参与内容尚未说明。":"观众给词，主播接一句招呼。",next_check:"看是否有人给词，再接话。"}});
      }
      primaryCalls++;return response({incomplete:true});
    };
    const data=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
      completeRevision:{reportId:parent.report_id}},env,ctx);
    assert.equal(primaryCalls,0,"candidate approval does not spend time generating a duplicate long teaching report");assert.ok(recoveryRequests.length>0,"candidate judgment invokes the actual short evidence contract");
    for(const recovery of recoveryRequests) {
      assert.equal(recovery.input.currentScript,candidate,"recovery judges only the complete current candidate");
      assert.equal(recovery.input.previousDraft,undefined);assert.equal(recovery.input.issues,undefined,"teaching history cannot bias independent approval");
      assert.ok(recovery.body.messages[0].content.startsWith(SYSTEM_PROMPT.slice(0,SYSTEM_PROMPT.indexOf("【一次解决一类问题，而且改法必须有效】"))));
    }
    assert.equal(data.report.report_id,parent.report_id);assert.equal(data.report.verdict,parent.verdict);
    if(kind==="passed") {
      assert.equal(data.report.revision_plan.status,"ready");assert.equal(data.report.ready_revision.report.verdict,"passed");
      assert.equal(data.report.ready_revision.report.review_mode,"focused");assert.equal(data.report.ready_revision.script,candidate);
    } else {
      assert.equal(data.report.ready_revision,undefined,kind+" cannot become an approved draft");
      assert.equal(data.report.revision_plan.status,"draft");
      if(kind==="not-passed")assert.ok(data.report.revision_plan.remaining_issues.some(issue=>issue.key==="user_reason"),"valid negative recovery preserves the actual gap, ignoring model-supplied passed");
      if(kind==="safety-rejected")assert.ok(recoveryRequests.length>=2,"the unchanged deterministic safety validator rejects an invented pass over severe self-abasement");
    }
  }
  // Malformed change explanations repair the complete candidate instead of repeating the same blind request.
  for(const kind of ["ellipsis","missing-changes","wrong-count"]) {
    const env=environment(),parent=fixtureReport(),draftRequests=[];let graded=0;
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    globalThis.fetch=async(_url,options)=>{
      const input=JSON.parse(JSON.parse(options.body).messages[1].content);
      if(input.task==="complete_revision") {
        draftRequests.push(input);
        const value={script:revisedScript,changes:input.issues.map(item=>({issue:item.issue,revised:revisedScript,why:"补上可参与的具体内容。"}))};
        if(draftRequests.length===1) {
          if(kind==="ellipsis")value.changes[0].revised="我是新人小禾……想听的朋友帮我上点复活票。";
          if(kind==="missing-changes")delete value.changes;
          if(kind==="wrong-count")value.changes=[];
        }
        return response(value);
      }
      if(input.task==="revision_preservation")return response({preserved:true,unsupported:false,evidence:revisedScript,reason:"保留新人身份和正常复活邀请。",checks:preservationChecks(input)});
      graded++;return modelResponse(input,fixtureReport(input.currentScript,true));
    };
    const data=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,
      completeRevision:{reportId:parent.report_id}},env,ctx);
    assert.equal(draftRequests.length,2,kind+" receives a bounded full-draft repair");
    assert.equal(draftRequests[1].previousDraft,revisedScript);
    assert.deepEqual(draftRequests[1].issues,draftRequests[0].issues);
    assert.equal(draftRequests[1].remainingIssues[0].key,"revision_format");
    assert.match(draftRequests[1].remainingIssues[0].why,/恰好覆盖.*连续原文/);
    assert.equal(graded,1,"malformed explanations are repaired before independent approval is requested");
    assert.equal(data.report.revision_plan.status,"ready");assert.equal(data.report.ready_revision.script,revisedScript);
    assert.equal(data.report.report_id,parent.report_id);assert.equal(data.report.verdict,parent.verdict);
  }
  // A fidelity rejection supplies actual repair feedback, including across durable retry requests.
  for(const mode of ["automatic","cross-request"]) {
    const env=environment(),parent=fixtureReport(),draftRequests=[];
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    const rejectedDraft=revisedScript+"你们昨天都来支持过我。",reason="原稿没有过去支持记录，不能编造老粉支持关系。";
    let repairAllowed=mode==="automatic";
    globalThis.fetch=async(_url,options)=>{
      const input=JSON.parse(JSON.parse(options.body).messages[1].content);
      if(input.task==="complete_revision") {
        draftRequests.push(input);
        const script=draftRequests.length>1 && repairAllowed ? revisedScript : rejectedDraft;
        return response({script,changes:input.issues.map(item=>({issue:item.issue,revised:script,why:"补足原稿缺口并保持事实边界。"}))});
      }
      if(input.task==="revision_preservation")return response({preserved:input.revisedScript!==rejectedDraft,unsupported:input.revisedScript===rejectedDraft,
        evidence:input.revisedScript===rejectedDraft?"你们昨天都来支持过我。":revisedScript,reason,checks:preservationChecks(input)});
      return modelResponse(input,fixtureReport(input.currentScript,true));
    };
    const body={accessCode:env.ACCESS_CODE,voteGap:"far",scenario:NOVICE_SCENARIO,script:originalScript,completeRevision:{reportId:parent.report_id}};
    let data=await generateCompleteRevisionReview(body,env,ctx);
    assert.equal(draftRequests.length,2,"a fidelity failure gets one bounded automatic repair");
    assert.equal(draftRequests[1].previousDraft,rejectedDraft);
    assert.deepEqual(draftRequests[1].issues,draftRequests[0].issues,"all original findings remain in the repair contract");
    assert.equal(draftRequests[1].remainingIssues[0].key,"revision_preservation");
    assert.equal(draftRequests[1].remainingIssues[0].original,"你们昨天都来支持过我。");
    assert.equal(draftRequests[1].remainingIssues[0].why,reason);
    if(mode==="cross-request") {
      assert.equal(data.report.revision_plan.script,"");assert.equal(data.report.ready_revision,undefined);
      assert.equal(data.report.complete_retry_context,undefined,"private rejected drafts cannot leak into learner output");
      assert.equal(JSON.stringify(data).includes(rejectedDraft),false);
      const attemptId=data.report.revision_plan.attempt_report_id;
      const privateAttempt=await readDeliveredReview(env,env.ACCESS_CODE,attemptId,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO));
      assert.equal(privateAttempt.report.complete_retry_context.script,rejectedDraft);
      assert.equal(privateAttempt.report.complete_retry_context.remaining_issues[0].why,reason);
      repairAllowed=true;
      data=await generateCompleteRevisionReview({...body,completeRevision:{...body.completeRevision,attemptReportId:attemptId}},env,ctx);
      assert.equal(draftRequests.length,3,"retry repairs the saved rejected candidate rather than starting blind");
      assert.equal(draftRequests[2].previousDraft,rejectedDraft);
      assert.equal(draftRequests[2].remainingIssues[0].why,reason);
      const unchanged=await readDeliveredReview(env,env.ACCESS_CODE,attemptId,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO));
      assert.deepEqual(unchanged,privateAttempt);
    }
    assert.equal(data.report.revision_plan.status,"ready");assert.equal(data.report.ready_revision.script,revisedScript);
    assert.equal(data.report.report_id,parent.report_id);assert.equal(data.report.verdict,parent.verdict);
    assert.equal(data.report.complete_retry_context,undefined);
  }
  // The public durable route keeps only receipt identifiers, never a client-supplied verdict/draft.
  {
    const env=environment(),forwarded=[];
    env.COACH_JOBS={idFromName:name=>name,get:()=>({fetch:async request=>{
      forwarded.push(await request.json());return Response.json({ok:true,jobId:forwarded.at(-1).id,state:"queued"},{status:202});
    }})};
    const completeRevision={reportId:crypto.randomUUID(),attemptReportId:crypto.randomUUID()};
    const body={accessCode:env.ACCESS_CODE,jobId:crypto.randomUUID(),script:originalScript,voteGap:"near",
      scenario:{...NOVICE_SCENARIO,phase:"result",timeline:[{text:"client-provided fake scene"}]},
      completeRevision:{...completeRevision,script:"client-provided fake draft",report:{verdict:"passed"}}};
    const send=value=>worker.fetch(new Request("https://local.test/api/coach/jobs",{method:"POST",body:JSON.stringify(value)}),env,ctx);
    assert.equal((await send(body)).status,202);
    assert.deepEqual(forwarded[0].payload.completeRevision,completeRevision);
    assert.deepEqual(forwarded[0].payload.scenario,sanitizeScenario(NOVICE_SCENARIO));
    assert.equal(forwarded[0].payload.voteGap,"far");
    assert.equal((await send({...body,accessCode:"wrong"})).status,401);
    assert.equal((await send({...body,completeRevision:{...completeRevision,attemptReportId:"malformed"}})).status,400);
    assert.equal((await send({...body,scenario:null})).status,400);
    assert.equal(forwarded.length,1,"invalid or unauthorized rewrite tasks never reach execution");
  }
  // A plausible invented anecdote is repaired automatically before independent approval.
  {
    const env=environment(),parent=fixtureReport(),drafts=[],graded=[];
    const inventedStory="我是新人小禾，复活差很多。今天上台前我把水杯当话筒举了半天，自己还没发现。想听后面更糗的，就帮我补一票。";
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    globalThis.fetch=async(_url,options)=>{
      const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content);
      assert.equal(payload.thinking.type,"enabled");assert.equal(payload.reasoning_effort,"high");
      if(input.task==="complete_revision"){
        drafts.push(input);const script=drafts.length===1?inventedStory:revisedScript;
        return response({script,changes:input.issues.map(issue=>({issue:issue.issue,revised:script,why:"沿原稿事实补清参与内容和支持动作。"}))});
      }
      if(input.task==="revision_preservation")return response({preserved:true,unsupported:false,evidence:input.revisedScript,
        reason:"只补未来有限互动，未添加已发生经历。",checks:preservationChecks(input)});
      graded.push(input.currentScript);return modelResponse(input,fixtureReport(input.currentScript,true));
    };
    const result=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",script:originalScript,
      scenario:NOVICE_SCENARIO,completeRevision:{reportId:parent.report_id}},env,ctx);
    assert.equal(drafts.length,2,"a known fabricated experience gets one automatic full-script repair");
    assert.equal(drafts[1].previousDraft,inventedStory);
    assert.match(drafts[1].remainingIssues[0].why,/原稿没有提供.*已发生经历/);
    assert.deepEqual(graded,[revisedScript],"no model can approve a locally rejected invented anecdote");
    assert.equal(result.report.revision_plan.status,"ready");assert.equal(result.report.ready_revision.script,revisedScript);
    assert.equal(result.report.report_id,parent.report_id);assert.equal(result.report.verdict,parent.verdict);
    assert.equal(JSON.stringify(result).includes(inventedStory),false,"the rejected candidate never reaches learner output");
  }
  // A transient fidelity outage retries only that check, never a completed judgment.
  {
    const env=environment(),parent=fixtureReport();let generated=0,graded=0,preserved=0;
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    globalThis.fetch=async(_url,options)=>{
      const input=JSON.parse(JSON.parse(options.body).messages[1].content);
      if(input.task==="complete_revision"){
        generated++;return response({script:revisedScript,changes:input.issues.map(issue=>({issue:issue.issue,revised:revisedScript,why:"补清原有内容和支持动作。"}))});
      }
      if(input.task==="revision_preservation"){
        if(++preserved===1)throw Error("synthetic transient fidelity outage");
        return response({preserved:true,unsupported:false,evidence:revisedScript,reason:"沿原稿补有限互动。",checks:preservationChecks(input)});
      }
      graded++;return modelResponse(input,fixtureReport(input.currentScript,true));
    };
    const data=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",script:originalScript,
      scenario:NOVICE_SCENARIO,completeRevision:{reportId:parent.report_id}},env,ctx);
    assert.equal(generated,1);assert.equal(graded,1,"only the validated exact candidate judgment is reused within this task");
    assert.equal(preserved,2,"fidelity must actually pass after its transient outage");
    assert.equal(data.report.revision_plan.status,"ready");assert.equal(data.report.ready_revision.script,revisedScript);
    assert.equal(data.report.report_id,parent.report_id);assert.equal(data.report.verdict,parent.verdict);
  }
  // Symmetrically, a completed fidelity check survives a transient grading outage.
  // The first short-review call exhausts its two internal network attempts; the
  // outer task retries that same candidate instead of handing back an early draft.
  {
    const env=environment(),parent=fixtureReport(),originalParent=structuredClone(parent);
    let generated=0,graded=0,preserved=0;
    await saveDeliveredReview(env,env.ACCESS_CODE,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO),parent);
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
      assert.equal(body.thinking.type,"enabled");assert.equal(body.reasoning_effort,"high");
      if(input.task==="complete_revision"){
        generated++;return response({script:revisedScript,changes:input.issues.map(issue=>({issue:issue.issue,revised:revisedScript,why:"补清原稿已有内容和复活动作。"}))});
      }
      if(input.task==="revision_preservation"){
        preserved++;assert.equal(input.revisedScript,revisedScript);
        return response({preserved:true,unsupported:false,evidence:revisedScript,reason:"沿用原稿事实并补普通当下互动。",checks:preservationChecks(input)});
      }
      assert.equal(input.task,"recover_current_review");assert.equal(input.currentScript,revisedScript);
      graded++;
      if(graded<=2)throw Error("synthetic transient independent judgment outage");
      return modelResponse(input,fixtureReport(input.currentScript,true));
    };
    const data=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",script:originalScript,
      scenario:NOVICE_SCENARIO,completeRevision:{reportId:parent.report_id}},env,ctx);
    assert.equal(generated,1,"a transient judgment failure must not regenerate the exact candidate");
    assert.equal(preserved,1,"only an already successful fidelity check may be reused for the exact same candidate within this task");
    assert.equal(graded,3,"two failed internal recovery attempts leave the outer retry to obtain a real independent judgment");
    assert.equal(data.report.revision_plan.status,"ready");assert.equal(data.report.ready_revision.script,revisedScript);
    assert.equal(data.report.ready_revision.report.verdict,"passed");
    assert.equal(data.report.report_id,parent.report_id);assert.equal(data.report.verdict,originalParent.verdict);
    const saved=await readDeliveredReview(env,env.ACCESS_CODE,parent.report_id,"far",originalScript,sanitizeScenario(NOVICE_SCENARIO));
    assert.equal(saved.report.verdict,originalParent.verdict,"retrying advice does not replace the immutable original judgment");
  }
  // Real multiple-category task: both missing core requirements plus a separate risky sentence.
  const env=environment(); const source="我是新人小禾，复活差很多。你们都是我的老粉，不帮我就是不喜欢我。";
  const all=fixtureReport(source,false);all.structure_checks[3].status="missing";all.structure_checks[4].status="missing";
  all.redline_note="不能把不付费说成不喜欢主播。";all.line_reviews=[{original:"你们都是我的老粉，不帮我就是不喜欢我。",mark:"wrong",comment:"把陌生观众说成老粉并施压。"}];
  all.coaching.original="我是新人小禾，复活差很多。";
  await saveDeliveredReview(env,env.ACCESS_CODE,"far",source,sanitizeScenario(NOVICE_SCENARIO),all);
  let generationCount=0;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    if(input.task==="complete_revision"){
      generationCount++;
      assert.deepEqual(new Set(input.issues.map(i=>i.key)),new Set(["user_reason","vote_instruction","redline","line_angle"]));
      assert.equal(body.messages[0].content.includes("【一次解决一类问题"),false);
      assert.equal(JSON.stringify(input).includes('"focus_key"'),false,"single-focus teaching is not passed to the rewrite task");
      return response({script:revisedScript,changes:input.issues.map(i=>({issue:i.issue,revised:revisedScript,why:"逐项修复这一问题，同时保留正常互动和邀请。"}))});
    }
    if(input.task==="revision_preservation") {
      assert.deepEqual(input.issues,revisionIssues(all,source),"fidelity sees every validated original issue, including pressure and false relationships");
      assert.match(body.messages[0].content,/删除压力、错误关系.*必要修改/);
      assert.match(body.messages[0].content,/普通上票邀请不等于编造精确票制/);
      assert.match(body.messages[0].content,/新增身份、个人经历.*精确数字.*规则或结果/);
      return response({preserved:true,unsupported:false,evidence:revisedScript,reason:"保留新人身份并删去虚构关系和压力。",checks:preservationChecks(input)});
    }
    return modelResponse(input,fixtureReport(input.currentScript,true));
  };
  const complete=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",script:source,scenario:NOVICE_SCENARIO,completeRevision:{reportId:all.report_id}},env,ctx);
  assert.equal(generationCount,1);assert.equal(complete.report.revision_plan.changes.length,4);assert.equal(complete.report.revision_plan.status,"ready");
  assert.equal(complete.report.verdict,"almost");
  await assert.rejects(()=>generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,voteGap:"far",script:originalScript,scenario:NOVICE_SCENARIO,completeRevision:{reportId:all.report_id}},env,ctx),e=>e.status===400);
  const issues=revisionIssues(all,source),input={source,issues,scenario:NOVICE_SCENARIO};
  for(const changes of [[],[{issue:0,revised:revisedScript,why:"只改一个"}],issues.map(()=>({issue:0,revised:revisedScript,why:"重复编号"})),issues.map((_,issue)=>({issue,revised:"不是改稿原文",why:"编造定位"}))]) {
    globalThis.fetch=async()=>response({script:revisedScript,changes});
    await assert.rejects(()=>generateRevisionDraft(env,{url:"https://local.test",model:"mock"},input,until()),/coverage/);
  }
  assert.equal(completeRevisionMessages(input)[0].content.split("【本次任务：")[0].trim(),SYSTEM_PROMPT.split("【一次解决一类问题，而且改法必须有效】")[0].trim(),"all grading and content standards remain exact");
  globalThis.fetch=async()=>response({preserved:true,unsupported:false,evidence:"凭空造的原文",reason:"不可信"});
  let malformedRejection;
  assert.equal(await checkRevisionPreservation({DEEPSEEK_API_KEY:"synthetic"},{url:"https://local.test",model:"mock",onRejected:value=>{malformedRejection=value;}},{originalScript,revisedScript},until()),false);
  assert.match(malformedRejection.reason,/证据|依据|原文/);
} finally {globalThis.fetch=priorFetch;console.log=priorLog;}
assert.equal(logs.some(x=>x.includes(originalScript)||x.includes(revisedScript)||x.includes("synthetic-key")),false);
console.log("PASS complete revision: unchanged original verdict, all blocking findings, independent same-standard assessment, fact preservation, bounded optional work, exact immutable receipt, no recursion");
