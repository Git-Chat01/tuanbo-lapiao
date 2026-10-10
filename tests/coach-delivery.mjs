import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {coachJobClass} from '../worker/coach-jobs.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await pause(2);}throw Error('condition did not settle');};
const report={verdict:'passed',report_id:crypto.randomUUID()},payload={voteGap:'far',script:'仅用于本地回执测试的虚构稿。'};
function client({map=new Map(),hidden=false,receipt,throwRender=false}={}){
 const calls=[],events={success:0,error:0,finish:0},listeners={};
 const c=vm.createContext({console,crypto,Promise,Error,TextEncoder,Uint8Array,AbortController,API_BASE:'https://local.test',navigator:{onLine:true},
  setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,1),addEventListener:(key,fn)=>listeners[key]=fn,
  document:{visibilityState:hidden?'hidden':'visible',addEventListener:(key,fn)=>listeners[key]=fn,getElementById:()=>({getClientRects:()=>[{}]})},
  localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},
  Report:{_visibleReportId:null},App:{state:{currentView:'report',lastReport:null},getAccessCode:()=> 'PRIVATE_TEST_CODE',toast(){}},
  fetch:async(url,o)=>{const body=JSON.parse(o.body);calls.push({url,body});
   if(url.endsWith('/displayed'))return receipt?receipt(body):{ok:true,status:200,json:async()=>({ok:true,displayConfirmed:true})};
   return {ok:true,status:200,text:async()=>JSON.stringify({jobId:body.jobId,state:'done',report,deliverySupported:true})};
  }});
 c.window=c;
 for(const name of ['coach-delivery','coach-jobs','api'])vm.runInContext(readFileSync(new URL('../site/js/'+name+'.js',import.meta.url),'utf8'),c);
 c.CoachDelivery.requestMs=20;c.CoachDelivery.retryMs=30;
 return {c,map,calls,events,listeners,start(){c.Api.submit(payload,{onSuccess:r=>{if(throwRender)throw Error('render failed');events.success++;c.App.state.lastReport=r;c.Report._visibleReportId=r.report_id;c.App.state.currentView='passed';},onError:()=>events.error++,onFinish:()=>events.finish++});},
  close(){c.CoachDelivery.retries=100;clearTimeout(c.CoachDelivery.timer);}};
}
{
 const a=client();a.start();await until(()=>a.events.finish===1);await until(()=>a.calls.some(x=>x.url.endsWith('/displayed')));await until(()=>a.c.CoachDelivery.read().length===0);
 assert.equal(a.events.success,1);assert.equal(a.events.error,0);assert.equal(a.calls.filter(x=>x.url.endsWith('/jobs')).length,1);
 const receipt=a.calls.find(x=>x.url.endsWith('/displayed'));assert.equal(receipt.body.reportId,report.report_id);assert.ok(receipt.body.clientElapsedMs>=0);
 assert.equal(a.c.CoachJobs.read(),null);a.close();
}
{
 const a=client({hidden:true});a.start();await until(()=>a.events.finish===1);await pause(12);
 assert.equal(a.calls.length,1,'hidden page is not a display confirmation');assert.equal(a.c.CoachDelivery.read()[0].rendered,false);
 assert.doesNotMatch(JSON.stringify([...a.map]),/PRIVATE_TEST_CODE|虚构稿/,'receipt storage contains neither code nor draft');
 a.c.document.visibilityState='visible';a.listeners.visibilitychange();await until(()=>a.calls.length===2);a.close();
}
{
 const a=client({throwRender:true});a.start();await until(()=>a.events.finish===1);await pause(10);
 assert.equal(a.events.error,1);assert.equal(a.calls.length,1);assert.equal(a.c.CoachDelivery.read().length,0);assert.ok(a.c.CoachJobs.read());a.close();
}
{
 const a=client({receipt:()=>new Promise(()=>{})});a.start();await until(()=>a.events.finish===1);
 assert.equal(a.events.success,1,'hanging telemetry cannot delay completed grading');await until(()=>a.calls.length===2);
 await until(()=>!a.c.CoachDelivery.busy);assert.ok(a.c.CoachDelivery.read()[0].rendered);a.close();
}
{
 const a=client({hidden:true});a.start();await until(()=>a.events.finish===1);await pause(10);a.close();
 const b=client({map:a.map});b.c.App.state.lastReport=report;b.c.Report._visibleReportId=report.report_id;b.c.App.state.currentView='passed';b.listeners.DOMContentLoaded();
 await until(()=>b.calls.length===1);assert.ok(b.calls[0].url.endsWith('/displayed'),'reload flushes receipt without creating a model task');b.close();
}
{
 const a=client({hidden:true});a.start();await until(()=>a.events.finish===1);await pause(10);
 a.c.App.state.lastReport={report_id:crypto.randomUUID()};a.c.document.visibilityState='visible';a.listeners.visibilitychange();await pause(15);
 assert.equal(a.calls.length,1,'another report must not acknowledge this one');
 a.c.App.state.lastReport=report;a.c.Report._visibleReportId='';a.listeners.visibilitychange();await pause(15);assert.equal(a.calls.length,1,'loading/error panel is not an old report display');a.c.Report._visibleReportId=report.report_id;a.c.navigator.onLine=false;a.listeners.visibilitychange();await pause(15);assert.equal(a.calls.length,1);
 a.c.navigator.onLine=true;a.c.App.getAccessCode=()=> 'DIFFERENT_CODE';a.listeners.online();await pause(15);assert.equal(a.calls.length,1,'new entry code cannot flush another owner receipt');
 a.c.App.getAccessCode=()=> 'PRIVATE_TEST_CODE';a.listeners.online();await until(()=>a.calls.length===2);a.close();
}
{
 const a=client();a.c.localStorage.getItem=()=>{throw Error('unavailable');};a.c.localStorage.setItem=()=>{throw Error('unavailable');};a.c.localStorage.removeItem=()=>{throw Error('unavailable');};
 a.start();await until(()=>a.events.finish===1);await until(()=>a.calls.length===2);assert.equal(a.events.success,1);a.close();
}
// A committed receipt is idempotent, version-stable and cannot change a report.
{
 const values=new Map();let queue=Promise.resolve(),writes=0,fail=false;
 const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{if(fail)throw Error('PRIVATE_STORAGE');writes++;values.set(k,structuredClone(v));},setAlarm:async()=>{},
  transaction(fn){const result=queue.then(()=>fn(storage));queue=result.catch(()=>{});return result;}};
 const id=crypto.randomUUID();const original={id,state:'done',serviceVersion:'admission-version',createdAt:Date.now()-1000,startedAt:Date.now()-900,expiresAt:Date.now()+60000,result:{report:{...report,private:'PRIVATE_REPORT'}}};
 await storage.put('job',original);const logs=[],realLog=console.log;console.log=x=>logs.push(x);
 const Job=coachJobClass({serviceVersion:'later-version'}),job=new Job({storage},{});
 const send=body=>job.fetch(new Request('https://internal/displayed',{method:'POST',body:JSON.stringify(body)}));
 try{
  assert.equal((await send({reportId:crypto.randomUUID(),clientElapsedMs:50})).status,409);assert.equal(logs.length,0);
  fail=true;await assert.rejects(send({reportId:report.report_id,clientElapsedMs:50}));assert.equal(logs.length,0);fail=false;
  const before=writes;const out=await Promise.all([send({reportId:report.report_id,clientElapsedMs:50}),send({reportId:report.report_id,clientElapsedMs:100})]);
  assert.deepEqual(out.map(x=>x.status),[200,200]);assert.equal(writes,before+1);assert.equal(logs.length,1);
  assert.equal(logs[0].lifecycle,'displayed');assert.equal(logs[0].serviceVersion,'admission-version');assert.equal(logs[0].clientElapsedMs,50);
  assert.deepEqual((await storage.get('job')).result,original.result);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_|report_id/);
  await storage.put('job',{...original,state:'failed'});assert.equal((await send({reportId:report.report_id})).status,409);
  await storage.put('job',{...original,expiresAt:1});assert.equal((await send({reportId:report.report_id})).status,404);
 }finally{console.log=realLog;}
}
console.log('PASS delivery receipts: visible matching render, offline/reload, owner isolation, no blocked grading, safe storage, dedupe and committed diagnostics');
