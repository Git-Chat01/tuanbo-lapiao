import assert from "node:assert/strict";
import {checkRevisionPreservation,completeRevisionMessages,generateRevisionDraft,introducedRevisionFact,revisionPreservationSegments} from "../worker/complete-revision.js";
import {NOVICE_SCENARIO} from "../worker/current-review.js";

// Synthetic learner content; no external service, user data, credentials, or case store.
const source="我是新来的小满，刚被刀下去了，复活还差很多。我不擅长临场接词，也不会唱跳，我说话慢，但喜欢把今天的小糗事讲给人听。大家帮帮我，我想回台。";
const invented="我是新人小满，刚被刀下去了。今天上台前我把水杯当话筒举了半天，自己还没发现。想听后面更糗的，就帮我补一票。";
const revised="我是新来的小满，复活还差很多。我说话慢，喜欢讲自己的小糗事；你们选先听开头还是结果，我按你们选的讲自己的小糗事，想听的帮我补一票。";
const issue={key:"user_reason",original:"大家帮帮我，我想回台。",why:"需要补清具体参与过程。",action:"沿用说话慢与自己的糗事方向补互动。"};
const env={DEEPSEEK_API_KEY:"synthetic-key"},until=()=>Date.now()+45000;
const config={url:"https://local.test/model",model:"mock",reasoningEffort:"high",maxTokens:16000};
const response=value=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
const checks=input=>revisionPreservationSegments(input.revisedScript).map(segment=>({segment:segment.index,
  kind:input.originalScript.includes(segment.text)?"source":"proposal",
  sourceQuote:input.originalScript.includes(segment.text)?segment.text:"",
  reason:input.originalScript.includes(segment.text)?"原稿逐字保留的事实。":"保留原稿内容方向并提出普通人能当下尝试的互动，不声明新经历。"}));
const valid=input=>({preserved:true,unsupported:false,evidence:input.revisedScript.slice(0,190),reason:"逐句核对原稿事实和未来互动。",checks:checks(input)});
const input={originalScript:source,revisedScript:revised,scenario:NOVICE_SCENARIO,issues:[issue]};
const priorFetch=globalThis.fetch;
let calls=0,lastBody,rejected;
try {
  for(const candidate of [invented,"我刚才把麦克风拿反了。","昨天我跟姐姐聊到半夜。","小时候我经常忘记带作业。","我曾经在舞台上摔过一跤。"]) {
    const result=introducedRevisionFact(source,candidate);
    assert.ok(result,candidate);assert.ok(candidate.includes(result.evidence));assert.match(result.reason,/原稿没有提供.*已发生经历/);
  }
  for(const candidate of [revised,"要是我把水杯当话筒举了半天，你们会怎么提醒我？","我们来编一个假设：我把水杯当话筒举了半天。","今天我被刀下去了，复活还差很多。","你们选先听开头还是结果，我按你们选的讲。","今天我想给你们讲自己的小糗事。","我今天想把自己的小糗事慢慢讲。","我们玩个假设游戏，昨天我把水杯当话筒举了一下，你们会怎么接？"]) {
    assert.equal(introducedRevisionFact(source,candidate),null,candidate);
  }
  const realEvent="今天上台前我把水杯当话筒举了半天，自己还没发现。";
  assert.equal(introducedRevisionFact(realEvent,"今天我把水杯当话筒举了半天。"),null,"provided events survive a harmless reordered time phrase");
  assert.equal(introducedRevisionFact("今天我上台前把水杯当话筒举了一下。","我今天上台前把水杯当成话筒举了一下。"),null,"minor wording for the same provided event reaches the semantic check");
  assert.equal(introducedRevisionFact("昨天我跟姐姐聊到半夜。","昨天我和姐姐聊到半夜。"),null,"a clear connective synonym for the same provided conversation reaches the semantic check");
  assert.equal(introducedRevisionFact("昨天我把水杯当话筒，举了半天。","昨天我把水杯当话筒举了半天。"),null,"moving a comma within the same provided event reaches the semantic check");
  for(const original of ["昨天我没有跟姐姐聊到半夜。","如果我跟姐姐聊到半夜，会怎样？"])
    assert.ok(introducedRevisionFact(original,"昨天我和姐姐聊到半夜。"),"connective normalization must not turn a denied or hypothetical event into evidence");
  for(const original of ["昨天我没有把水杯当话筒，举了半天。","如果我把水杯当话筒，举了半天会怎样？","我们玩个假设游戏，我把水杯当话筒，举了半天。"])
    assert.ok(introducedRevisionFact(original,"昨天我把水杯当话筒举了半天。"),"comma normalization preserves the source's denial and hypothetical boundary");
  assert.ok(introducedRevisionFact("昨天我把水杯当话筒，举了半天。","昨天我把手机当话筒举了半天。"),"moving punctuation cannot ground a different event object");
  assert.ok(introducedRevisionFact("今天我上台前把水杯当话筒举了一下。","我今天上台前把手机当成话筒举了一下。"),"a new event object is not a harmless wording variant");
  assert.ok(introducedRevisionFact(source,"如果你们想听，我昨天把水杯当话筒举了半天。"),"a conditional invitation must not disguise a factual past event");
  for(const original of ["如果我把水杯当话筒举了半天，你们会提醒吗？","我没有把水杯当话筒举了半天。","我们玩个假设游戏，我把水杯当话筒举了半天。"])
    assert.ok(introducedRevisionFact(original,"我把水杯当话筒举了半天。"),"hypothetical or denied evidence cannot prove that an event happened");

  globalThis.fetch=async(_url,options)=>{calls++;lastBody=JSON.parse(options.body);return response(valid(input));};
  assert.equal(await checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},{...input,revisedScript:invented},until()),false);
  assert.equal(calls,0,"the reproduced fabricated anecdote is rejected before any model can approve it");
  assert.match(rejected.reason,/水杯当话筒/);

  assert.equal(await checkRevisionPreservation(env,config,input,until()),true,"source content and optional bounded future interaction can pass");
  assert.equal(lastBody.thinking.type,"enabled");assert.equal(lastBody.reasoning_effort,"high");assert.equal(lastBody.max_tokens,16000);
  const request=JSON.parse(lastBody.messages[1].content);
  assert.deepEqual(request.revisedSegments,revisionPreservationSegments(revised));
  assert.ok(request.scenarioEvidence.includes(NOVICE_SCENARIO.roleContext));
  assert.match(lastBody.messages[0].content,/普通人可能遇到.*不能证明某事真的发生/);
  assert.match(lastBody.messages[0].content,/不强制复述.*不会唱跳.*不擅长临场接词.*我说话慢/);
  assert.match(lastBody.messages[0].content,/没有反向声称会、没有安排不擅长活动.*省略这些句子不等于丢失原意/);
  const omissionInput={...input,revisedScript:"我是小满，复活差很多。今天我想给你们讲自己的小糗事，你们选先听开头还是结果，想听的帮我补一票。"};
  globalThis.fetch=async()=>response({...valid(omissionInput),checks:[
    {segment:0,kind:"source",sourceQuote:"我是新来的小满，刚被刀下去了，复活还差很多。",reason:"名字和差距均来自原稿。"},
    {segment:1,kind:"mixed",sources:[{kind:"source",quote:"喜欢把今天的小糗事讲给人听"}],reason:"保留原稿内容方向，仅补听开头或结果的选择；省略能力限制句，没有安排唱跳或临场接词。"},
  ]});
  assert.equal(await checkRevisionPreservation(env,config,omissionInput,until()),true,"omitting negative ability/background sentences is safe when the rewrite respects those limits");

  // Every changed sentence needs a check, and every grounding quote must exist.
  const broken=[
    value=>{delete value.checks;},
    value=>{value.checks.pop();},
    value=>{value.checks[1].segment=value.checks[0].segment;},
    value=>{value.checks[0]={segment:0,kind:"source",sourceQuote:"我是来自成都的小满。",reason:"具体身份。"};},
    value=>{value.checks[0]={segment:0,kind:"scenario",sourceQuote:"复活还差三百票。",reason:"具体数字。"};},
    value=>{value.checks[0].kind="proposal";value.checks[0].sourceQuote="原稿引用不能代替判断。";},
  ];
  for(const breakContract of broken) {
    const value=valid(input);breakContract(value);rejected=null;
    globalThis.fetch=async()=>response(value);
    assert.equal(await checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},input,until()),false);
    assert.ok(rejected?.reason,"missing or invented evidence supplies a specific repair reason");
    assert.match(rejected.reason,/原稿|场景|逐句/);assert.ok(revised.includes(rejected.evidence));
  }
  // The code derives rejection from per-sentence checks even if a model's outer boolean is inconsistent.
  for(const kind of ["unsupported","uncertain"]) {
    const value=valid(input);value.checks[1]={segment:1,kind,sourceQuote:"",reason:"原稿没有给出这项已发生经历，不能因听起来生活化就采用。"};rejected=null;
    globalThis.fetch=async()=>response(value);
    assert.equal(await checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},input,until()),false);
    assert.equal(rejected.reason,value.checks[1].reason);assert.equal(rejected.evidence,revisionPreservationSegments(revised)[1].text);
  }
  const sceneInput={...input,revisedScript:"我是新人，刚被刀下去了，复活差很多。"};
  globalThis.fetch=async()=>response({...valid(sceneInput),checks:[{segment:0,kind:"scenario",sourceQuote:NOVICE_SCENARIO.roleContext,reason:"固定新人复活背景已明确。"}]});
  assert.equal(await checkRevisionPreservation(env,config,sceneInput,until()),true,"known scenario facts need not be repeated in the source");

  const mixedInput={...input,revisedScript:"我是新来的小满，刚被刀下去了，复活差很多，想听自己的小糗事先选开头还是结果，帮我补一票。"};
  const mixedCheck={segment:0,kind:"mixed",sources:[{kind:"source",quote:"我是新来的小满"},{kind:"scenario",quote:NOVICE_SCENARIO.roleContext}],reason:"名字来自原稿，被刀差很多来自场景，听开头还是结果与补票是普通未来邀请，没有新增经历。"};
  globalThis.fetch=async()=>response({...valid(mixedInput),checks:[mixedCheck]});
  assert.equal(await checkRevisionPreservation(env,config,mixedInput,until()),true,"one sentence may combine source facts, fixed context and a future proposal");
  const sourcePlusProposal={...input,revisedScript:"我是新来的小满，你们选先听开头还是结果，我慢慢讲自己的小糗事。"};
  globalThis.fetch=async()=>response({...valid(sourcePlusProposal),checks:[{segment:0,kind:"mixed",sources:[{kind:"source",quote:"我是新来的小满"}],reason:"原稿提供名字，后半句只是沿原稿已有糗事方向提出选择，没有新增过去事件。"}]});
  assert.equal(await checkRevisionPreservation(env,config,sourcePlusProposal,until()),true,"mixed need not fabricate a second grounding source for a pure proposal");
  for(const supports of [[],[{kind:"source",quote:"小满的妈妈今天来支持了。"}],[{kind:"scenario",quote:"复活还差三百票。"}],[{kind:"proposal",quote:"想听的上票。"}]]) {
    globalThis.fetch=async()=>response({...valid(mixedInput),checks:[{...mixedCheck,sources:supports}]});rejected=null;
    assert.equal(await checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},mixedInput,until()),false);
    assert.match(rejected.reason,/混合来源/);
  }

  // Network failures stay transient; they must not accuse the learner draft of fabrication.
  rejected=null;globalThis.fetch=async()=>{throw Error("synthetic connection interrupted");};
  await assert.rejects(()=>checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},input,until()),/synthetic connection interrupted/);
  assert.equal(rejected,null);
  for(const answer of ["not json",null]) {
    globalThis.fetch=async()=>Response.json({choices:[{finish_reason:"stop",message:{content:answer}}]});rejected=null;
    assert.equal(await checkRevisionPreservation(env,{...config,onRejected:value=>{rejected=value;}},input,until()),false);
    assert.ok(rejected?.reason,"unverifiable fidelity output feeds a repair reason instead of blind retries");
  }

  const generated=script=>({script,changes:[{issue:0,revised:script,why:"补清具体参与过程并保留原稿事实。"}]});
  globalThis.fetch=async(_url,options)=>{lastBody=JSON.parse(options.body);return response(generated(invented));};
  await assert.rejects(()=>generateRevisionDraft(env,config,{source,scenario:NOVICE_SCENARIO,issues:[issue]},until()),error=>{
    assert.equal(error.revisionRepair.script,invented);assert.match(error.revisionRepair.remainingIssues[0].why,/水杯当话筒/);
    assert.equal(error.revisionRepair.remainingIssues[0].key,"revision_preservation");return true;
  });
  assert.equal(lastBody.thinking.type,"enabled");assert.equal(lastBody.reasoning_effort,"high");assert.equal(lastBody.max_tokens,16000);
  globalThis.fetch=async()=>response(generated(revised));
  assert.equal((await generateRevisionDraft(env,config,{source,scenario:NOVICE_SCENARIO,issues:[issue]},until())).script,revised);
  const retryMessages=completeRevisionMessages({source,scenario:NOVICE_SCENARIO,issues:[issue],previousDraft:invented,remainingIssues:[{key:"revision_preservation",original:"今天上台前我把水杯当话筒举了半天",why:"原稿没有这件已发生的经历。"}]});
  const retry=JSON.parse(retryMessages[1].content);
  assert.equal(retry.previousDraft,invented);assert.match(retry.remainingIssues[0].why,/已发生的经历/);
  assert.match(retryMessages[0].content,/喜欢讲糗事不等于已经提供了一件糗事/);
  assert.match(retryMessages[0].content,/通常80～180字.*不作为通过门槛.*不能为了凑短稿删漏问题或有效内容/);
  assert.match(retryMessages[0].content,/同一求票邀请不反复说/);
  console.log("revision fact preservation: passed (offline, synthetic content only)");
} finally {globalThis.fetch=priorFetch;}
