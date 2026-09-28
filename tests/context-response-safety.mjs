import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker, {normalizeReport, applyReportSafetyGates, splitHardSentences, getReportQualityIssue, getInteractionReviewIssue, sanitizeScenario} from '../worker/index.js';
import {detectRedline} from '../worker/redlines.js';

const waitingScene = {phase:'awaiting_drop',hostCue:'队伍已组满，等待主持统一发令。'};
function reportFor(script, overrides={}) {
  return normalizeReport({card_type:'logic',card_why:'当前表达符合现场',audience:'观众',verdict:'passed',verdict_reason:'可以开口',echo:'接住当前一拍',one_thing:'看回应',direction:{summary:'保持当前表达',examples:[]},ai_flavor:'',redline_note:'',
    structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:'met',evidence:script})),
    line_reviews:splitHardSentences(script).map(original=>({original,mark:'good',comment:'符合当前阶段'})),
    interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'回应当前观众',why:'保留对方选择',next_check:'看下一拍回应'},
    round_dynamics:{flow_read:'回应当前一拍',human_drivers:[{driver:'belonging',evidence:script,mechanism:'接住共同参与'}],response_read:'尚未看到新反馈',next_move:'等回应'},
    coaching:{focus_key:'user_reason',keep:'询问了兴趣',original:script,action:'等观众回应',example:script,why:'不替观众猜偏好'},...overrides},script);
}
function gated(script, scenario=waitingScene, overrides={}) {
  const report=reportFor(script,overrides);
  assert.equal(getInteractionReviewIssue(report,script,scenario,'secured'),'');
  return applyReportSafetyGates(report,detectRedline(script),{sourceScript:script,scenario,voteGap:'secured'});
}

for(const script of [
  '未成年人不要刷礼物，大家开心看就好。',
  '学生党别刷礼物，留好生活费，陪我看就行。',
  '不要借钱刷礼物，咱们开心看节目就好。',
  '别说“借钱刷礼物”这种话。',
  '不要拿生活费刷礼物。',
]) assert.deepEqual(detectRedline(script),[],script);
for(const script of ['贷款刷礼物支持我','未成年也来刷礼物','学生党给我打赏','拿生活费刷礼物','不要借钱刷，但你可以贷款刷礼物','借钱刷礼物吧']) {
  assert.ok(detectRedline(script).length,script);
  assert.equal(gated(script).verdict,'off');
}
for(const script of [
  '大家组齐了，谢谢你们！等主持喊完再一起丢。',
  '大家组齐了，谢谢你们！等主持喊完，现在先别动，口令一到大家一起丢。',
  '大家组齐了，谢谢你们！我先上一段舞，大家等主持口令。',
  '大家组齐了，谢谢你们！口令一到大家马上一起丢。',
  '组满了，谢谢大家，等主持口令。',
  '大家组齐了！未成年人不要刷礼物，大家等主持口令。',
]) assert.equal(gated(script).verdict,'passed',script);
for(const script of [
  '大家组齐了，谢谢你们！大家现在一起丢。',
  '大家组齐了！等主持口令，大家现在一起丢。',
  '大家组齐了！不用等主持，大家一起丢。',
  '大家组齐了！我先上一票，大家等主持口令。',
  '大家组齐了！等主持喊完再一起丢，再认一个。',
]) assert.notEqual(gated(script).verdict,'passed',script);

const probe='刚来的朋友，你想看什么？跟我说说。';
const overrides={verdict:'almost',practice_status:'awaiting_response',structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:'partial',evidence:'已询问，尚待回应'}))};
const waiting=gated(probe,null,overrides);
assert.equal(waiting.practice_status,'awaiting_response');
assert.equal(waiting.verdict,'almost','不能把尚待回应抬成付费理由通过');
assert.equal(getReportQualityIssue(waiting,probe,null),'');
for(const patch of [
  {redline_note:'仍有强迫消费'}, {ai_flavor:'重复空喊'},
  {line_reviews:splitHardSentences(probe).map(original=>({original,mark:'wrong',comment:'另有真实问题'}))},
  {interaction_review:{...waiting.interaction_review,judgment:'misread'}},
]) assert.notEqual(gated(probe,null,{...overrides,...patch}).practice_status,'awaiting_response');
assert.notEqual(gated(probe+'来投一票。',null,overrides).practice_status,'awaiting_response');
assert.notEqual(gated(probe,waitingScene,overrides).practice_status,'awaiting_response');

const context=vm.createContext({console,URL,URLSearchParams,location:{hostname:'localhost',search:'?api=http://localhost:8787'}});
context.window=context;
for(const file of ['config','form','report']) vm.runInContext(readFileSync(new URL('../site/js/'+file+'.js',import.meta.url),'utf8'),context);
assert.equal(context.Form.validate({voteGap:'secured',script:'组满了，谢谢大家，等主持口令。'}),null);
assert.ok(context.Form.validate({voteGap:'secured',script:'  '}));
const base={voteGap:'close',script:probe,scenario:{id:'original-scene',phase:'pledging',userSignal:'暂无兴趣线索',timeline:[]}};
for(let i=0;i<3;i++) {
 const request=context.Form.responseRequest(base,'好，先安心看着。',i);
 assert.equal(request.scenario.id,undefined);
 assert.equal(request.scenario.phase,'interaction');
 assert.match(request.scenario.userSignal,/模拟反馈/);
 assert.ok(sanitizeScenario(request.scenario));
 assert.equal(base.scenario.id,'original-scene','不修改原现场');
 assert.equal(base.scenario.timeline.length,0);
}
const nodes={};
function element(tag){return {tagName:tag,children:[],events:{},value:'',textContent:'',appendChild(n){this.children.push(n);return n;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};}
context.document={createElement:element,getElementById(id){return nodes[id]||(nodes[id]=element('div'));}};
context.App={state:{lastReport:waiting,lastRequest:base,coaching:{totalAttempts:2,focusAttempts:2}},showView(){},unlockStage(){}};
const root=element('div');
context.Report._showWaitingResponse(waiting,root);
assert.equal(context.App.state.coaching.totalAttempts,2,'等待回应页不增加挑战次数');
const desk=root.children[0].children.at(-1);
const select=desk.children.find(n=>n.tagName==='select');
const input=desk.children.find(n=>n.tagName==='textarea');
const submit=desk.children.find(n=>n.tagName==='button');
let submitted;
context.Form.submitResponse=(script,branch)=>{submitted={script,branch};};
input.value='好的，先安心看。';input.events.input();
assert.equal(submit.disabled,false);
select.value='1';submit.events.click();
assert.deepEqual(submitted,{script:input.value,branch:1});
select.events.change();assert.equal(input.value,'');assert.equal(submit.disabled,true);
let voiceOptions;
context.VoiceCoach={open(value){voiceOptions=value;}};
context.Report._onStartVoice();assert.equal(voiceOptions.script,probe);

const derived=context.Form.responseRequest(base,'好，那你先安心看。',1);
context.Form._renderScenarioPicker=()=>{};
context.Form._renderScenario=()=>{};
context.Form._setFreeMode=enabled=>{context.App.state.freeMode=enabled;};
context.Form._setVoteGap=()=>{};
context.Form._updateInputState=()=>{};
context.Form.restore(derived);
const restored=context.Form.collect();
assert.equal(restored.mode,'response');assert.equal(restored.voteGap,derived.voteGap);
assert.equal(context.Form._scenarioKey(restored.scenario),context.Form._scenarioKey(derived.scenario));
context.App.state.lastRequest=derived;
assert.equal(context.Form._isSameAsLast(restored),true);

// Exercise real routing with a stub upstream: short input reaches the model, empty input does not.
const savedFetch=globalThis.fetch;let calls=0;
try {
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reportFor('组满了，谢谢大家，等主持口令。'))}}],usage:{prompt_tokens:1,completion_tokens:1}}));};
 const env={ACCESS_CODE:'local-context-test',DEEPSEEK_API_KEY:'fake-key'};
 const request=script=>worker.fetch(new Request('https://test.local/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:'secured',script,scenario:waitingScene})}),env,{waitUntil(){}});
 const short=await request('组满了，谢谢大家，等主持口令。');
 assert.equal(short.status,200,JSON.stringify(await short.clone().json()));assert.ok(calls);
 const before=calls;const empty=await request('  ');assert.equal(empty.status,400);assert.equal(calls,before);
} finally {globalThis.fetch=savedFetch;}
console.log('PASS context guards, short-script route, waiting state and simulated-response flow');
