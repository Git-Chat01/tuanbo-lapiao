// Offline regression: active-step navigation, audio session isolation and admin submissions.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../site/js/'+name+'.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function node(tag='div') {
  return {tag,children:[],attributes:{},dataset:{},style:{},value:'',textContent:'',disabled:false,hidden:false,
    className:'',classList:{add(){},remove(){},toggle(){}},
    get firstChild(){return this.children[0]||null;},
    appendChild(n){n.parentNode=this;this.children.push(n);return n;},
    insertBefore(n,b){n.parentNode=this;const i=this.children.indexOf(b);this.children.splice(i<0?0:i,0,n);return n;},
    removeChild(n){this.children.splice(this.children.indexOf(n),1);n.parentNode=null;},
    remove(){if(this.parentNode)this.parentNode.removeChild(this);},
    setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},
    querySelectorAll(selector){return this.children.filter(n=>n.className.split(' ').includes(selector.slice(1)));},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
    addEventListener(){},focus(){},pause(){},load(){}};
}
function context(extra={}) {const c=vm.createContext({console,Promise,Error,JSON,Math,Float32Array,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},...extra});c.window=c;c.self=c;c.top=c;return c;}
function load(c,name){vm.runInContext(source(name),c,{filename:name+'.js'});}
// Re-selecting the active step must not restart the voice coach and delete its recording.
{
  let starts=0,backs=0,views=0;
  const c=context({document:{addEventListener(){},querySelector:()=>({disabled:false})},
    Report:{_onStartVoice(){starts++;},_onBackEdit(){backs++;}}});
  load(c,'app');c.App.showView=()=>{views++;};
  for(const [view,stage]of [['voice','voice'],['form','form'],['report','report'],['passed','report']]) {
    c.App.state.currentView=view;c.App.state.lastReport={verdict:'passed'};c.App._openStage(stage);
  }
  assert.deepEqual([starts,backs,views],[0,0,0],'active stage must be a no-op');
  c.App.state.currentView='report';c.App._openStage('voice');assert.equal(starts,1,'switching to a different unlocked stage still works');
  const formDraft={request:{script:'尚未提交的新场景稿'},replayCompleted:false};
  c.Report._workspace={formActive:true,formDraft};let saved;
  c.Report._saveWorkspace=value=>{saved=value;};c.App.state.currentView='form';c.App._openStage('report');
  assert.equal(saved.formActive,false,'explicitly returning to the report records that view for refresh');
  assert.equal(saved.formDraft,formDraft,'report navigation keeps the separate form draft');
}
function voiceHarness() {
  const contexts=[],streams=[];
  function AudioContext() {
    this.state='suspended';this.resumeTask=deferred();this.decodeTask=deferred();this.closed=0;
    this.resume=()=>this.resumeTask.promise;this.close=()=>{this.closed++;return Promise.resolve();};
    this.decodeAudioData=()=>this.decodeTask.promise;
    this.createMediaStreamSource=()=>({connect(){},disconnect(){}});
    this.createAnalyser=()=>({disconnect(){}});contexts.push(this);
  }
  const c=context({isSecureContext:true,AudioContext,MediaRecorder:function(){},
    navigator:{mediaDevices:{async getUserMedia(){
      const track={stopped:false,events:{},stop(){this.stopped=true;},addEventListener(k,fn){this.events[k]=fn;},removeEventListener(k){delete this.events[k];}};
      const stream={track,getAudioTracks:()=>[track],getTracks:()=>[track]};streams.push(stream);return stream;
    }}},document:{hidden:false},URL:{revokeObjectURL(){}},cancelAnimationFrame(){}});
  const hooks='window.__voiceTest = {state:state,request:requestAndCountdown,cancel:cancelPreparation,analyze:analyzeRecording,clear:clearCurrentRecording};\n  ';
  vm.runInContext(source('voice').replace('window.VoiceCoach = {',hooks+'window.VoiceCoach = {'),c);
  const test=c.__voiceTest;test.state.script='已完成文字稿';
  test.state.els=new Proxy({}, {get:(o,key)=>o[key]||(o[key]=node())});
  return {c,test,contexts,streams};
}
for(const delayedOutcome of ['reject','resolve']) {
  const {test,contexts,streams}=voiceHarness();
  const first=test.request();await flush();assert.equal(contexts.length,1);
  const oldEnded=streams[0].track.events.ended;
  test.cancel();const second=test.request();await flush();assert.equal(contexts.length,2);
  oldEnded();assert.equal(test.state.phase,'requesting','queued old track-ended event cannot cancel a new session');
  if(delayedOutcome==='reject')contexts[0].resumeTask.reject(new Error('old resume failed'));
  else contexts[0].resumeTask.resolve();
  await first;
  assert.equal(test.state.captureContext,contexts[1],'old resume must not clear the new AudioContext');
  assert.equal(test.state.stream,streams[1]);assert.equal(streams[1].track.stopped,false,'old completion cannot stop the new microphone');
  assert.equal(contexts[1].closed,0);assert.equal(test.state.phase,'requesting');
  contexts[1].resumeTask.resolve();await second;assert.equal(test.state.phase,'countdown');
  test.cancel();assert.equal(streams[1].track.stopped,true,'explicit cancel still releases current microphone');
}
// A current request failure must release its own microphone and recover with a retry UI.
{
  const {test,contexts,streams}=voiceHarness();const request=test.request();await flush();
  contexts[0].resumeTask.reject(new Error('cannot resume'));await request;
  assert.equal(streams[0].track.stopped,true);assert.equal(test.state.captureContext,null);assert.equal(test.state.phase,'error');
}
const audioBuffer={duration:4,sampleRate:100,length:400,numberOfChannels:1,getChannelData:()=>new Float32Array(400)};
for(const delayedOutcome of ['resolve','reject']) {
  const {test,contexts}=voiceHarness();
  test.state.blob={arrayBuffer:async()=>new ArrayBuffer(8)};test.state.sessionId=1;
  const first=test.analyze(1);await flush();
  test.state.sessionId=2;test.clear();test.state.blob={arrayBuffer:async()=>new ArrayBuffer(8)};
  const second=test.analyze(2);await flush();
  if(delayedOutcome==='resolve')contexts[0].decodeTask.resolve(audioBuffer);else contexts[0].decodeTask.reject(new Error('old decode failed'));
  await first;assert.equal(test.state.analysisContext,contexts[1],'old analysis finally cannot close a new analysis context');
  assert.equal(contexts[1].closed,0);
  contexts[1].decodeTask.resolve(audioBuffer);await second;assert.equal(test.state.phase,'recorded');assert.equal(contexts[1].closed,1);
}
function coachHarness() {
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const chips=['close','far'].map(value=>{const n=node('button');n.dataset.value=value;n.setAttribute('aria-pressed',String(value==='close'));return n;});
  const c=context({LIMITS:{scriptMin:1,feedScriptMax:800,feedWhyGoodMax:320},
    document:{getElementById:get,querySelector:()=>chips.find(n=>n.getAttribute('aria-pressed')==='true')||null,
      querySelectorAll:()=>chips,createElement:node,addEventListener(){}}});
  load(c,'coach');const calls=[],cards=[],notices=[];
  c.Coach._request=(path,options)=>{const task=deferred();calls.push({path,options,...task});return task.promise;};
  c.Coach._insertLocalCard=item=>cards.push(item);c.Coach._toast=message=>notices.push(message);
  get('input-script').value='第一条投喂稿';get('input-whygood').value='有具体对象';
  return {c,get,chips,calls,cards,notices};
}
{
  const {c,get,chips,calls,cards}=coachHarness();
  const first=c.Coach._feed();assert.equal(c.Coach._feedBusy,true);await flush();
  get('input-script').value='第二条尚未提交';get('input-whygood').value='第二条理由';
  chips[0].setAttribute('aria-pressed','false');chips[1].setAttribute('aria-pressed','true');
  c.Coach._updateCounts();assert.equal(get('btn-feed').disabled,true,'editing cannot unlock a pending submission');
  c.Coach._feed();await flush();assert.equal(calls.length,1,'busy lock blocks duplicate POST even if invoked directly');
  assert.equal(JSON.parse(calls[0].options.body).voteGap,'close');
  calls[0].resolve({id:'first'});await first;
  assert.equal(get('input-script').value,'第二条尚未提交','old success cannot erase new script');
  assert.equal(get('input-whygood').value,'第二条理由');assert.equal(chips[1].getAttribute('aria-pressed'),'true');
  assert.equal(cards[0].voteGap,'close','optimistic card uses submitted vote-gap snapshot');
  assert.equal(cards[0].script,'第一条投喂稿');assert.equal(c.Coach._feedBusy,false);assert.equal(get('btn-feed').disabled,false);
  const second=c.Coach._feed();await flush();assert.equal(calls.length,2);calls[1].resolve({id:'second'});await second;
  assert.equal(get('input-script').value,'','unchanged successfully submitted form is cleared');assert.equal(chips[1].getAttribute('aria-pressed'),'false');
}
for(const failure of ['async','sync','401']) {
  const {c,get,calls}=coachHarness();
  if(failure==='sync')c.Coach._request=()=>{throw new Error('network failure');};
  const pending=c.Coach._feed();await flush();if(failure!=='sync')calls[0].reject(new Error(failure==='401'?'401':'network failure'));
  await pending;assert.equal(c.Coach._feedBusy,false,'all failure paths release submission lock');
  assert.equal(get('input-script').value,'第一条投喂稿');assert.equal(get('btn-feed').disabled,false);
}
// KV filtering may return an empty page with a usable next cursor; retain pagination.
{
  const {c,get,calls}=coachHarness();
  c.Coach._caseCard=item=>{const card=node('article');card.className='case-card';card.dataset.id=item.id;return card;};
  c.Coach.loadList();
  calls[0].resolve({items:[],hasMore:true,nextCursor:'opaque+/=next',total:null,totalIsExact:false});await flush();
  assert.equal(c.Coach._cursor.auto,'opaque+/=next');
  assert.match(get('list-container').firstChild.textContent,/继续加载/);assert.equal(get('btn-load-more').hidden,false);
  assert.match(get('btn-load-more').textContent,/已加载 0 条/);assert.doesNotMatch(get('btn-load-more').textContent,/null/);
  c.Coach.loadMore();assert.match(calls[1].path,/cursor=opaque%2B%2F%3Dnext$/);
  calls[1].resolve({items:[{id:'visible'}],hasMore:false,nextCursor:null,total:null,totalIsExact:false});await flush();
  assert.equal(get('list-container').querySelector('.list-empty'),null,'visible next-page items remove stale empty state');
  assert.equal(get('list-container').querySelectorAll('.case-card').length,1);assert.equal(get('btn-load-more').hidden,true);
}
// Idempotent manual retries and later KV pages cannot insert the same card twice.
{
  const {c,get}=coachHarness();c.Coach._tab='manual';
  c.Coach._caseCard=item=>{const card=node('article');card.className='case-card';card.dataset.id=item.id;return card;};
  const fresh=context({document:{getElementById:get,createElement:node,addEventListener(){}},LIMITS:{scriptMin:1,feedScriptMax:800,feedWhyGoodMax:320}});
  load(fresh,'coach');fresh.Coach._tab='manual';fresh.Coach._caseCard=c.Coach._caseCard;
  fresh.Coach._insertLocalCard({id:'case:manual:close:repeat'});fresh.Coach._insertLocalCard({id:'case:manual:close:repeat'});
  fresh.Coach._renderList([{id:'case:manual:close:repeat'},{id:'case:new'}],false,false);
  assert.equal(get('list-container').querySelectorAll('.case-card').length,2);
}
console.log('PASS voice/admin safety: active-step no-op, capture/analysis session isolation, queued track events, feed lock/snapshots/recovery, filtered KV pagination');
