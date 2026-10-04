import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function session(storage=new Map()) {
  const elements=new Map(),timers=new Map();let timer=0;
  function node(tag='div') {
    const el={tag,children:[],events:{},value:'',textContent:'',hidden:false,disabled:false,style:{},dataset:{},attributes:{},
      classList:{add(){},remove(){},toggle(){}},get firstChild(){return this.children[0];},
      appendChild(child){this.children.push(child);child.parentNode=this;return child;},
      insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);return child;},
      removeChild(child){this.children.splice(this.children.indexOf(child),1);},
      setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
      getAttribute(key){return this.attributes[key];},addEventListener(key,fn){this.events[key]=fn;},
      querySelector(){return null;},querySelectorAll(){return [];},focus(){},setSelectionRange(){}};
    Object.defineProperty(el,'id',{set(value){this._id=value;elements.set(value,this);},get(){return this._id;}});
    return el;
  }
  const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const setTimer=fn=>{timers.set(++timer,fn);return timer;};
  const c=vm.createContext({console,URL,URLSearchParams,
    setTimeout:setTimer,setInterval:setTimer,clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id),
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:get,createElement:node,createTextNode:text=>({textContent:text}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}}});
  c.window=c;c.location={hostname:'127.0.0.1',search:''};c.scrollTo=()=>{};
  for(const name of ['config','app','form','report'])vm.runInContext(readFileSync(new URL('../site/js/'+name+'.js',import.meta.url),'utf8'),c);
  const f=c.Form;
  f._scenario=c.TRAINING_SCENARIOS[0];
  f._renderScenarioPicker=()=>{};
  f._renderScenario=()=>{f._replayCompleted=false;}; // Rendering a different scene starts an unwatched replay.
  f._renderSceneGuidance=()=>{};f._applyProgress=()=>{};f._showSceneHistory=()=>{};
  f._selectedVoteGap=()=> 'close';
  let callbacks;
  c.Api={_inFlight:false,submit(data,value){callbacks=value;},cancel(){}};
  return {c,get,storage,success:report=>callbacks.onSuccess(report),error:(status,message)=>callbacks.onError(status,message)};
}
function report(script,waiting=false,passed=false) {
  return {report_id:'11111111-1111-4111-8111-111111111111',verdict:passed?'passed':'almost',practice_status:waiting?'awaiting_response':undefined,
    card_type:'logic',card_why:'接住眼前回应',audience:'观众丙',verdict_reason:'保持这句的选择权',echo:'已接住回应',one_thing:'留出回应空隙',
    ai_flavor:'',redline_note:'',interaction_review:{judgment:'aligned',reading:'已问出兴趣，等待反馈',next_check:'看下一拍'},
    structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:!passed&&key==='user_reason'?'partial':'met',evidence:script})),
    line_reviews:[{original:script,mark:passed?'good':'partial',comment:'尊重选择'}],direction:{summary:'给出回应位置',examples:[]},
    coaching:{focus_key:'user_reason',keep:'已点到人',original:script,action:'给对方一个选择',example:'你想听什么？',why:'能接住回应'}};
}
const s=session();const {App:a,Form:f,Report:r}=s.c;
s.get('input-script').value='观众丙，你想听什么？';f._replayCompleted=true;
f._submitData(f.collect());s.success(report(a.state.lastRequest.script,true));
assert.equal(JSON.parse(s.storage.get(r._workspaceKey)).type,'edit','结果返回时即持久化，不必等再次输入');
let response=s.get('response-script'),choice=s.get('response-choice');
response.value='第一分支接话';response.events.input();choice.value='1';choice.events.change();
response.value='第二分支接话';response.events.input();
r._onBackEdit();f._saveDraft();
let saved=JSON.parse(s.storage.get(r._workspaceKey));
assert.equal(saved.responses['0'],'第一分支接话');assert.equal(saved.responses['1'],'第二分支接话');
assert.equal(saved.type,'edit','返回现场不能把报告工作区改成 pending');
let refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();
assert.equal(refreshed.c.App.state.currentView,'form');
assert.equal(refreshed.c.App.state.lastReport.report_id,saved.report.report_id,'刷新必须保留报告编号');
assert.equal(refreshed.get('btn-submit').disabled,true,'原稿未变化时刷新仍阻止重复提交');
assert.equal(refreshed.c.Report._workspace.responses['1'],'第二分支接话');
refreshed.c.App._openStage('report');assert.equal(refreshed.get('response-script').value,'第二分支接话');
// Changing scenes and refreshing must retain the new form without unlocking an unseen replay.
f._selectScenario(s.c.TRAINING_SCENARIOS[1].id);s.get('input-script').value='新场景尚未播放';f._saveDraft();
refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();
assert.equal(refreshed.c.Form._scenario.id,s.c.TRAINING_SCENARIOS[1].id);
assert.equal(refreshed.c.Form._replayCompleted,false);assert.equal(refreshed.get('btn-submit').disabled,true);
assert.equal(refreshed.c.Report._workspace.responses['0'],'第一分支接话');
// A successful derived response needs its own script and interaction context after reload.
a.state.lastRequest=saved.request;a.state.lastReport=saved.report;
f.submitResponse('好，你先看着，我不催你送礼物。',1);
s.success(report(a.state.lastRequest.script));
refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();
assert.equal(refreshed.c.App.state.lastRequest.script,'好，你先看着，我不催你送礼物。');
assert.equal(refreshed.c.Form._scenario.phase,'interaction');
assert.equal(refreshed.c.Form._scenario.id,undefined);
assert.equal(refreshed.c.App.state.coaching.totalAttempts,a.state.coaching.totalAttempts,'恢复报告不能再加一次挑战');
// Passing also preserves the derived script before the user begins another edit.
f.submitRevision('好，你先看着。');s.success(report(a.state.lastRequest.script,false,true));
refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();
assert.equal(refreshed.c.App.state.currentView,'passed');assert.equal(refreshed.get('passed-script').textContent,'好，你先看着。');
assert.equal(refreshed.c.App.state.coaching.totalAttempts,a.state.coaching.totalAttempts);
// If an access code expires during a derived response, canceling the modal retains that response in the form.
a.state.lastReport=report(a.state.lastRequest.script,true);f.submitResponse('那我先介绍自己。',0);
a.showAccessModal=()=>{};s.error(401,'入口码不对');
assert.equal(s.get('input-script').value,'那我先介绍自己。');assert.equal(f._scenario.phase,'interaction');
f._saveDraft();refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();
assert.equal(refreshed.get('input-script').value,'那我先介绍自己。');
// Cancel, failure/back, and refresh retain the previous response branches alongside the latest submitted draft.
for (const exit of ['cancel','failure','refresh']) {
  const old=session();const {App:oa,Form:of,Report:or}=old.c;
  old.get('input-script').value='先问兴趣';of._replayCompleted=true;of._submitData(of.collect());old.success(report('先问兴趣',true));
  old.get('response-choice').value='0';old.get('response-script').value='分支零保留';old.get('response-script').events.input();
  old.get('response-choice').value='1';old.get('response-choice').events.change();old.get('response-script').value='分支一提交';old.get('response-script').events.input();
  of.submitResponse('分支一提交',1);
  let recovered=old;
  if(exit==='cancel')or._cancelWait();
  if(exit==='failure'){old.error(503,'稍后再试');or._onBackEdit();}
  if(exit==='refresh'){recovered=session(old.storage);recovered.c.Report._restoreWorkspace();}
  assert.equal(recovered.get('input-script').value,'分支一提交',exit+'保留提交稿');
  assert.equal(recovered.c.Report._workspace.responses['0'],'分支零保留',exit+'保留未提交分支');
  recovered.c.App._openStage('report');assert.equal(recovered.get('response-script').value,'分支一提交');
}
// A newer form in the same scene wins over a previously rendered review input.
const same=session();const {App:sa,Form:sf,Report:sr}=same.c;
same.get('input-script').value='旧原稿';sf._replayCompleted=true;sf._submitData(sf.collect());same.success(report('旧原稿'));
sr._onBackEdit();same.get('input-script').value='同场景较新稿';sf._saveDraft();sa._openStage('report');sr._onBackEdit();
assert.equal(same.get('input-script').value,'同场景较新稿');
sa._openStage('report');same.get('revision-script').value='复盘中主动修改';same.get('revision-script').events.input();sr._onBackEdit();
assert.equal(same.get('input-script').value,'复盘中主动修改','有实际编辑时采用新复盘稿');
// A newer scene form remains separate when reopening an older non-waiting review.
const two=session();const {App:aa,Form:ff,Report:rr}=two.c;
two.get('input-script').value='A 原稿';ff._replayCompleted=true;ff._submitData(ff.collect());two.success(report('A 原稿'));
rr._onBackEdit();ff._selectScenario(two.c.TRAINING_SCENARIOS[1].id);two.get('input-script').value='B 全新话术';ff._saveDraft();
aa._openStage('report');rr._onBackEdit();
assert.equal(ff._scenario.id,two.c.TRAINING_SCENARIOS[1].id);assert.equal(two.get('input-script').value,'B 全新话术');
assert.equal(ff._replayCompleted,false,'旧复盘不能解锁新现场回放');
console.log('PASS workspace recovery: independent branches, fresh scene replay gate, response/passed checkpoints, progress and expired access code');
