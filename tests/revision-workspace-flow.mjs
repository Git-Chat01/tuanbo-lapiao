import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {fixtureReport,originalScript,revisedScript} from "./helpers/revision-fixtures.mjs";

function session(storage=new Map()) {
  const elements=new Map(),calls=[],voice=[],timers=new Map();let next=0;
  function node(tag="div") {
    const item={tag,children:[],events:{},attributes:{},style:{},dataset:{},value:"",hidden:false,disabled:false,
      classList:{add(){},remove(){},toggle(){}},get firstChild(){return this.children[0]||null;},
      appendChild(child){this.children.push(child);child.parentNode=this;return child;},
      insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);child.parentNode=this;return child;},
      removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;},
      setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k];},removeAttribute(k){delete this.attributes[k];},
      addEventListener(k,fn){this.events[k]=fn;},querySelector(){return null;},querySelectorAll(){return [];},
      focus(){this.focused=true;},setSelectionRange(){},click(){if(!this.disabled)this.events.click?.();}};
    let content="";
    Object.defineProperty(item,"textContent",{get(){return content+this.children.map(x=>x.textContent).join("");},set(v){content=String(v);this.children=[];}});
    Object.defineProperty(item,"innerHTML",{set(){throw Error("do not render model HTML");}});
    Object.defineProperty(item,"id",{get(){return this._id;},set(v){this._id=v;elements.set(v,this);}});
    return item;
  }
  const get=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const c=vm.createContext({console,URL,URLSearchParams,
    setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),setInterval:()=>++next,clearInterval(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{createElement:node,createTextNode:t=>({textContent:t}),getElementById:get,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
  });
  c.window=c;c.location={hostname:"127.0.0.1",search:"?api=http://localhost:8787"};c.scrollTo=()=>{};
  for(const name of ["config","app","form","report","revision-workspace"])vm.runInContext(readFileSync(new URL("../site/js/"+name+".js",import.meta.url),"utf8"),c);
  c.Form._scenario=c.TRAINING_SCENARIOS.find(x=>x.id==="novice-revival-far-v1");
  c.Form._renderScenarioPicker=()=>{};c.Form._renderScenario=()=>{};c.Form._renderSceneGuidance=()=>{};c.Form._applyProgress=()=>{};c.Form._showSceneHistory=()=>{};
  c.Api={_inFlight:false,submit(data,callbacks){calls.push({data,callbacks});},cancel(){this._inFlight=false;}};
  c.VoiceCoach={open:data=>voice.push(data),suspend(){},reset(){}};
  const all=item=>[item,...item.children.flatMap(all)];
  const byClass=cls=>all(get("report-content")).find(x=>(x.className||"").split(" ").includes(cls));
  return {c,get,storage,calls,voice,all,byClass,node,edit(value){const input=get("revision-script");input.value=value;input.events.input();}};
}
function readyReport() {
  const report=fixtureReport();report.report_id="11111111-1111-4111-8111-111111111111";
  const approved=fixtureReport(revisedScript,true);approved.report_id="22222222-2222-4222-8222-222222222222";
  report.revision_plan={status:"ready",script:revisedScript,issues:[
    {key:"user_reason",original:"大家帮我上复活票吧。",why:"原稿缺少观众参与的内容。",action:"补上给词接话的互动。"},
    {key:"line_angle",original:"我是新人小禾，复活差很多。",why:"仅用于检查第二个问题是否完整展示。",action:"核对这处措辞。"},
  ]};report.ready_revision={script:revisedScript,report:approved};return report;
}
function render(s,report=readyReport()) {
  s.c.App.state.lastRequest={script:originalScript,voteGap:"far",mode:"guided",scenario:s.c.Form._scenario};
  s.c.App.state.form=s.c.App.state.lastRequest;s.c.App.state.lastReport=report;
  s.c.Report.showContent(report);return report;
}
const s=session(),report=render(s),R=s.c.RevisionWorkspace;
assert.equal(s.get("revision-script").value,revisedScript);assert.equal(s.get("revision-script").hidden,true);
assert.equal(s.c.App.state.lastReport.verdict,"almost","a ready reference must never pass the original script");
assert.equal(s.byClass("revision-submit").textContent,"用这版开始练习");
assert.equal(s.get("btn-back-edit").hidden,true,"one editor replaces the competing back-to-original editor");
assert.equal(s.all(s.get("report-content")).filter(x=>x.tag==="textarea").length,1);
assert.equal(s.all(s.get("report-content")).filter(x=>x.className==="revision-issue").length,2,"all required issues remain visible");
s.byClass("revision-submit").click();assert.equal(s.voice.length,1);assert.equal(s.voice[0].script,revisedScript);assert.equal(s.calls.length,0,"exact approved text needs no new model call");
s.voice[0].onBack();s.byClass("revision-tweak").click();assert.equal(s.get("revision-script").hidden,false);
const own=revisedScript.replace("普通词","日常用的词");s.edit(own);
assert.equal(s.c.Report._workspace.revision,own);assert.equal(s.get("input-script").value,own);
assert.equal(s.byClass("revision-submit").textContent,"检查这版完整话术");
s.c.Report._onStartVoice();assert.equal(s.voice.length,1,"a tweak cannot reuse approval of another string");
s.c.Report._onBackEdit();assert.equal(s.c.App.state.currentView,"report");assert.equal(s.get("revision-script").value,own);
const refreshed=session(s.storage);refreshed.c.Report._restoreWorkspace();assert.equal(refreshed.get("revision-script").value,own);
assert.equal(refreshed.c.App.state.currentView,"report");
refreshed.byClass("revision-submit").click();assert.equal(refreshed.calls.length,1);assert.equal(refreshed.calls[0].data.script,own);
assert.equal(refreshed.get("report-loading").hidden,false);assert.ok(refreshed.get("revision-pending-context").textContent.includes(own));
assert.ok(refreshed.get("revision-pending-context").textContent.includes("原稿缺少观众参与的内容"));
refreshed.c.Report._cancelWait();assert.equal(refreshed.get("revision-script").value,own);assert.equal(refreshed.c.App.state.currentView,"report");
assert.equal(refreshed.c.App.state.lastReport.verdict,"almost");
for(const kind of ["missing-receipt","mismatched-script","not-passed","awaiting","no-history","draft"]) {
  const x=session(),bad=readyReport();
  if(kind==="missing-receipt")delete bad.ready_revision.report.report_id;
  if(kind==="mismatched-script")bad.ready_revision.script+="不一样。";
  if(kind==="not-passed")bad.ready_revision.report.verdict="almost";
  if(kind==="awaiting")bad.ready_revision.report.practice_status="awaiting_response";
  if(kind==="no-history")bad.ready_revision.report.history_available=false;
  if(kind==="draft")bad.revision_plan.status="draft";
  render(x,bad);assert.equal(x.c.RevisionWorkspace.approval(bad,x.c.App.state.lastRequest,revisedScript),null,kind);
  x.c.Report._onStartVoice();assert.equal(x.voice.length,0);
}
// Passing original text has the same optional edit route; a real edit must be re-evaluated.
{
  const x=session(),good=fixtureReport(originalScript,true);render(x,good);
  assert.equal(x.byClass("revision-submit").disabled,false);x.byClass("revision-tweak").click();x.edit("我换了意思，需要再核对。");
  assert.equal(x.byClass("revision-submit").textContent,"检查这版完整话术");x.byClass("revision-revert").click();
  assert.equal(x.get("revision-script").value,originalScript);assert.equal(x.byClass("revision-submit").textContent,"用这版开始练习");
}
// Repeated focus does not append the old duplicated help block or lose the learner's draft.
{
  const x=session();render(x);x.edit(own);x.c.App.state.coaching.focusAttempts=5;x.c.Report.showContent(x.c.App.state.lastReport);
  assert.equal(x.get("revision-script").value,own);assert.equal(x.byClass("challenge-help"),undefined);
  assert.equal(x.byClass("revision-issues").children.length,2);
}
// Malicious model text stays text, and storage failure never blocks editing or checking.
{
  const x=session(),bad=readyReport();bad.revision_plan.issues[0].why="<img src=x onerror=alert(1)>";render(x,bad);
  assert.ok(x.get("report-content").textContent.includes(bad.revision_plan.issues[0].why));
  x.c.localStorage.setItem=()=>{throw Error("quota");};x.byClass("revision-tweak").click();x.edit(own);
  assert.equal(x.byClass("revision-submit").disabled,false);assert.match(x.get("revision-state").textContent,/无法保存/);
}
console.log("PASS revision workspace: exact-text approval, free micro-edits, all issues, one draft, refresh/cancel preservation, waiting context, no duplicate help, safe text rendering");
