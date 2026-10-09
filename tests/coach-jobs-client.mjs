import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const payload={voteGap:'far',script:'用于浏览器恢复验证的虚构稿',revision:{previousScript:'旧稿',focusKey:'user_reason',instruction:'沿原稿修改',reportId:crypto.randomUUID()}};
const report={verdict:'passed',report_id:crypto.randomUUID()};
const storage=new Map();
const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('condition did not settle');};
function client(fetch,map=new Map()){
 const events={success:[],errors:[],messages:[],finish:0};
 const c=vm.createContext({console,Promise,Error,TextEncoder,Uint8Array,crypto,AbortController,API_BASE:'https://local.test',navigator:{onLine:true},
  setTimeout:(fn,ms)=>setTimeout(fn,ms>=100?2:ms),clearTimeout,
  localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},fetch,
  App:{getAccessCode:()=> 'synthetic-client-code',toast(){}}});c.window=c;
 for(const name of ['coach-jobs','api'])vm.runInContext(readFileSync(new URL('../site/js/'+name+'.js',import.meta.url),'utf8'),c);
 c.CoachJobs.waitMs=3000;c.CoachJobs.requestMs=50;
 return {c,events,start(p=payload){c.Api.submit(p,{onSuccess:r=>events.success.push(r),onError:(status,message)=>events.errors.push({status,message}),onRetry:m=>events.messages.push(m),onFinish:()=>events.finish++});}};
}
const answer=(body,status=200)=>Promise.resolve({ok:status<400,status,text:async()=>JSON.stringify(body)});
// The server accepted the create but its response was lost; refresh before retry.
{
 const tasks=new Map(),ids=[];let first=true;
 const fetch=async(url,options)=>{const body=JSON.parse(options.body);const id=body.jobId||url.split('/').at(-1);ids.push(id);
  if(body.jobId){if(!tasks.has(id))tasks.set(id,{payload:body});if(first){first=false;throw Error('lost create response');}}
  return answer({jobId:id,state:'done',report});};
 const a=client(fetch,storage);a.start();await until(()=>!first);a.c.Api.cancel();
 assert.equal(a.events.success.length,0);assert.equal(a.events.finish,1);assert.ok(storage.size);
 const b=client(fetch,storage);b.start();await until(()=>b.events.finish===1);
 assert.equal(b.events.success.length,1);assert.equal(tasks.size,1,'同一 UUID 只生成一次');assert.equal(new Set(ids).size,1);
 assert.equal(tasks.values().next().value.payload.revision.reportId,payload.revision.reportId);
 assert.equal(storage.size,0,'交付报告后清除恢复指针');
}
// Accepted work reloads as a lookup, never a new submission.
{
 const map=new Map(),urls=[];let completed=false;
 const fetch=(url,options)=>{urls.push(url);const b=JSON.parse(options.body);return answer({jobId:b.jobId||url.split('/').at(-1),state:completed?'done':'running',...(completed?{report}:{})});};
 const a=client(fetch,map);a.start();await until(()=>a.c.CoachJobs.read()?.acknowledged);a.c.Api.cancel();completed=true;
 const b=client(fetch,map);b.start();await until(()=>b.events.finish===1);
 assert.equal(urls.filter(u=>u.endsWith('/jobs')).length,1);assert.equal(b.events.success.length,1);
}
// Explicit job failure is terminal. A deliberate retry gets a new ID.
{
 const ids=[];const a=client((_u,o)=>{const id=JSON.parse(o.body).jobId;ids.push(id);return answer({jobId:id,state:'failed',failure:{status:502,message:'批改失败'}});});
 a.start();await until(()=>a.events.finish===1);assert.equal(ids.length,1);assert.equal(a.events.errors[0].status,502);
 a.start();await until(()=>a.events.finish===2);assert.notEqual(ids[0],ids[1]);
}
// Offline is a waiting condition; no request is sent until network returns.
{
 let calls=0;const a=client((_u,o)=>{calls++;return answer({jobId:JSON.parse(o.body).jobId,state:'done',report});});
 a.c.navigator.onLine=false;a.start();await until(()=>a.events.messages.length>0);assert.equal(calls,0);
 a.c.navigator.onLine=true;await until(()=>a.events.finish===1);assert.equal(a.events.success.length,1);
}
// Query timeout keeps the pointer. Reconnect reads the same completed task.
{
 let done=false;const ids=[];const a=client((u,o)=>{const b=JSON.parse(o.body),id=b.jobId||u.split('/').at(-1);ids.push(id);return answer({jobId:id,state:done?'done':'running',...(done?{report}:{})});});
 a.c.CoachJobs.waitMs=15;a.start();await until(()=>a.events.finish===1);assert.match(a.events.errors[0].message,/继续查询/);assert.ok(a.c.CoachJobs.read());
 done=true;a.c.CoachJobs.waitMs=3000;a.start();await until(()=>a.events.finish===2);assert.equal(a.events.success.length,1);assert.equal(new Set(ids).size,1);
}
// Cancel/new draft guards against a late success overwriting newer editing state.
{
 let release,oldId;const a=client((_u,o)=>{const b=JSON.parse(o.body);if(b.script===payload.script){oldId=b.jobId;return new Promise(r=>release=()=>r({ok:true,status:200,text:async()=>JSON.stringify({jobId:oldId,state:'done',report})}));}return answer({jobId:b.jobId,state:'done',report:{...report,report_id:'new-report'}});});
 a.start();await until(()=>release);a.c.Api.cancel();a.start({...payload,script:'新稿'});await until(()=>a.events.finish===2);release();await new Promise(r=>setTimeout(r,10));
 assert.equal(a.events.success.length,1);assert.equal(a.events.success[0].report_id,'new-report');assert.equal(a.c.Api._inFlight,false);
}
// Body read failure and a mismatched task response recover without delivering it.
for(const mode of ['body','wrong-id','render']){
 let calls=0;const a=client((url,o)=>{calls++;const b=JSON.parse(o.body),id=b.jobId||url.split('/').at(-1);
  if(calls===1&&mode==='body')return Promise.resolve({ok:true,status:200,text:async()=>{throw Error('broken body');}});
  return answer({jobId:calls===1&&mode==='wrong-id'?crypto.randomUUID():id,state:'done',report});});
 if(mode==='render'){
  a.c.Api.submit(payload,{onSuccess(){throw Error('render failure');},onError:(_s,m)=>a.events.errors.push(m),onFinish:()=>a.events.finish++});
  await until(()=>a.events.finish===1);assert.ok(a.c.CoachJobs.read());assert.match(a.events.errors[0],/显示失败/);
 }else{a.start();await until(()=>a.events.finish===1);assert.equal(calls,2);assert.equal(a.events.success.length,1);}
}
{
 const a=client(()=>{throw Error('not used');});
 const older={id:crypto.randomUUID(),payload,expiresAt:Date.now()+100000};
 const newer={...older,id:crypto.randomUUID()};
 a.c.CoachJobs.save(older);a.c.CoachJobs.save(newer);
 assert.equal(a.c.CoachJobs.save(older,true),false);a.c.CoachJobs.clear(older.id);
 assert.equal(a.c.CoachJobs.read().id,newer.id,'旧标签页不能覆盖或清除新任务指针');
}
// Internal review stages keep one immutable task and resolve to the actual report.
{
 const phases=['reviewing','recovering','checking_advice','future_phase','__proto__'];
 const ids=[],urls=[];let calls=0;
 const a=client((url,options)=>{const body=JSON.parse(options.body),id=body.jobId||url.split('/').at(-1);
  ids.push(id);urls.push(url);const phase=phases[calls++];
  return answer(phase?{jobId:id,state:'running',phase}:{jobId:id,state:'done',report});});
 a.start();await until(()=>a.events.finish===1);
 assert.equal(a.events.success.length,1);assert.equal(a.events.errors.length,0);
 assert.equal(new Set(ids).size,1);assert.equal(urls.filter(url=>url.endsWith('/jobs')).length,1);
 assert.match(a.events.messages[0],/正在批改这版话术/);
 assert.match(a.events.messages[1],/正在核对这版的判断/);
 assert.match(a.events.messages[2],/正在核对修改建议/);
 assert.match(a.events.messages[3],/后台正在处理/);
 assert.match(a.events.messages[4],/后台正在处理/);
 assert.doesNotMatch(a.events.messages.join(' '),/不一致|未判分|冲突|object Object/);
}
console.log('PASS browser task recovery: lost acceptance, reload, offline, timeout, terminal failure, immutable revision context, cancellation and stale responses');
