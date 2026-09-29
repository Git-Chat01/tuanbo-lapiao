// Offline regression: cancellation races, quote targeting and recoverable editing.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const load=(context,name)=>vm.runInContext(readFileSync(new URL('../site/js/'+name+'.js',import.meta.url),'utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const response=report=>({ok:true,status:200,text:async()=>JSON.stringify({report})});
for(const abortAvailable of [false,true]) {
  const calls=[],delivered=[],errors=[],finished=[];
  const c=vm.createContext({console,Promise,setTimeout,clearTimeout,API_BASE:'http://local.test',
    App:{getAccessCode:()=>'',toast(){}},fetch:(_url,options)=>new Promise(resolve=>calls.push({resolve,options}))});
  c.window=c;if(abortAvailable)c.AbortController=AbortController;
  load(c,'api');
  const cb=id=>({onSuccess:r=>delivered.push(r.id),onError:e=>errors.push(e),onFinish:()=>finished.push(id)});
  c.Api.submit({script:'旧稿',voteGap:'close'},cb('old'));
  c.Api.cancel();
  if(abortAvailable)assert.equal(calls[0].options.signal.aborted,true);
  c.Api.submit({script:'新稿',voteGap:'close'},cb('new'));
  calls[0].resolve(response({id:'old'}));await flush();
  assert.equal(c.Api._inFlight,true,'旧请求结束不能释放新请求的锁');
  assert.deepEqual(delivered,[],'取消后的迟到结果不得渲染');
  assert.deepEqual(errors,[],'主动取消不得误报错误');
  calls[1].resolve(response({id:'new'}));await flush();
  assert.deepEqual(delivered,['new']);assert.deepEqual(finished,['old','new']);assert.equal(c.Api._inFlight,false);
}
// Cancellation while waiting for a gateway retry must not launch another fetch.
{
  const timers=new Map();let seq=0,calls=0;
  const c=vm.createContext({console,Promise,API_BASE:'http://local.test',App:{getAccessCode:()=>'',toast(){}},
    setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    fetch:async()=>{calls++;return {ok:false,status:503,text:async()=>'{"error":true}'};}});
  c.window=c;load(c,'api');c.Api.submit({script:'稿子',voteGap:'close'},{});await flush();
  c.Api.cancel();for(const {fn,ms} of timers.values())if(ms===1500)fn();await flush();
  assert.equal(calls,1,'取消后不得再启动自动重试');
}
function node(tag){return {tag,children:[],events:{},textContent:'',value:'',hidden:false,attributes:{},
  get firstChild(){return this.children[0];},appendChild(n){this.children.push(n);return n;},
  insertBefore(n,b){this.children.splice(this.children.indexOf(b),0,n);},removeChild(n){this.children.splice(this.children.indexOf(n),1);},
  setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.events[k]=fn;},focus(){this.focused=true;},
  setSelectionRange(start,end){this.selection=[start,end];}};}
const storage=new Map(),elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,node('div'));return elements.get(id);};
const c=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,
  LIMITS:{scriptMin:1,scriptMax:500},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{createElement:node,getElementById:get,querySelector:()=>null},
  App:{state:{lastRequest:{script:'前面的话。\n凯哥，你来看看。\n结尾保留。',mode:'free',voteGap:'close'},lastReport:{}},toast(){},showView(){},unlockStage(){}},
  Form:{RESPONSE_BRANCHES:[{label:'回应一'},{label:'回应二'},{label:'沉默'}]}});
c.window=c;load(c,'report');
const R=c.Report;
assert.deepEqual(JSON.parse(JSON.stringify(R._quoteRange('开头。\n凯哥， 你来看看。结尾','凯哥，你来看看。'))),{start:4,end:13});
assert.equal(R._quoteRange('我支持你','根本不存在'),null);
R._coachingFor=()=>({original:'凯哥，你来看看。'});
let desk=R._revisionDesk({key:'target_user',evidence:''},{focusAttempts:1});
let input=desk.children.find(n=>n.tag==='textarea');
const locate=desk.children.find(n=>n.className?.includes('revision-locate'));
locate.events.click();assert.equal(input.value.slice(...input.selection),'凯哥，你来看看。');
input.value='前面的话。\n凯哥，你想听什么？\n结尾保留。';input.events.input();
assert.equal(JSON.parse(storage.get(R._workspaceKey)).revision,input.value);
desk=R._revisionDesk({key:'target_user',evidence:''},{focusAttempts:1});
assert.equal(desk.children.find(n=>n.tag==='textarea').value,input.value,'重新渲染保留局部修改');
let restored;
c.Form.restore=data=>{restored=data;};
get('revision-script').value=input.value;
R._onBackEdit();assert.equal(restored.script,input.value,'返回现场不丢改稿');
// Refresh pending request restores submitted text, without automatically sending it again.
R._workspace=null;R._restoreWorkspace();assert.equal(restored.script,input.value);
R._clearWorkspace();
c.App.state.lastReport={practice_status:'awaiting_response',interaction_review:{reading:'等回应'}};
let root=node('div');R._showWaitingResponse(c.App.state.lastReport,root);
desk=root.children[0].children.find(n=>n.className==='revision-desk');
input=desk.children.find(n=>n.tag==='textarea');let choices=desk.children.find(n=>n.tag==='select');
input.value='第一分支稿';input.events.input();choices.value='1';choices.events.change();assert.equal(input.value,'');
input.value='第二分支稿';input.events.input();choices.value='0';choices.events.change();assert.equal(input.value,'第一分支稿');
root=node('div');R._showWaitingResponse(c.App.state.lastReport,root);
desk=root.children[0].children.find(n=>n.className==='revision-desk');
assert.equal(desk.children.find(n=>n.tag==='textarea').value,'第一分支稿');
// Disabled local storage is reported honestly and does not break editing.
c.localStorage.setItem=()=>{throw new Error('quota');};
assert.equal(R._saveWorkspace(R._workspace),false);
R._clearWorkspace();assert.equal(storage.has(R._workspaceKey),false);
console.log('PASS UI flow: cancellation races, retry cancellation, exact quote selection, revision recovery, response branch drafts, storage failure');


// Playback can pause without losing its place and finishes without opening the keyboard.
{
  const nodes=new Map(),timers=new Map();let timerId=0;
  const get=id=>{if(!nodes.has(id)){const n=node('div');n.classList={add(){},remove(){}};n.querySelector=()=>n.label||(n.label=node('span'));nodes.set(id,n);}return nodes.get(id);};
  const items=[0,1].map(i=>{const n=node('li');n.dataset={at:String(i)};n.classList={add(){},remove(){}};return n;});
  const c=vm.createContext({console,document:{getElementById:get,querySelectorAll:()=>items},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
  c.window=c;load(c,'form');const f=c.Form;
  f._scenario={timeline:[{text:'第一条现场信息。'},{text:'最后一条现场信息。'}]};
  f._renderSceneGuidance=()=>{};f._updateInputState=()=>{};f._applyProgress=()=>{};
  f._playScene({currentTarget:get('btn-play-scene')});
  assert.equal(items[0].hidden,false);assert.equal(items[1].hidden,true);
  f._toggleScenePause();assert.equal(timers.size,0);assert.equal(f._replayCompleted,false);
  f._toggleScenePause();assert.equal(items[1].hidden,false);
  const callback=[...timers.values()][0];timers.clear();callback();
  assert.equal(f._replayCompleted,true);assert.equal(get('btn-scene-ready').hidden,false);
  assert.equal(get('input-script').focused,undefined,'回放结束不得自动聚焦输入框');
  f._showSceneHistory(true);assert.ok(items.every(n=>!n.hidden));
  f._showSceneHistory(false);assert.equal(items[0].hidden,true);
  f._playScene({currentTarget:get('btn-play-scene')});f.stopSceneReplay();
  assert.equal(timers.size,0);assert.equal(get('btn-scene-pause').hidden,true);
}
console.log('PASS pausable replay and explicit writing transition');
// Restoring a saved report must not count the same review twice.
{
  const report={verdict:'almost'};
  c.App.state.coaching={totalAttempts:4,focusAttempts:2,currentReport:report,lastProgress:{totalAttempts:4,focusAttempts:2},masteredKeys:{}};
  R._saveWorkspace({type:'edit',request:c.App.state.lastRequest,report,revision:'恢复的草稿',responses:{},branch:'0'});
  // The previous failure test disabled writes; put the serialized checkpoint into the fake disk directly.
  storage.set(R._workspaceKey,JSON.stringify(R._workspace));
  c.App.state.coaching=null;
  const show=R.showContent;let progress;
  R.showContent=r=>{progress=R._recordResult(r);};R._restoreWorkspace();R.showContent=show;
  assert.equal(progress.totalAttempts,4);assert.equal(c.App.state.coaching.totalAttempts,4);
}
console.log('PASS restored coaching progress is not counted twice');
