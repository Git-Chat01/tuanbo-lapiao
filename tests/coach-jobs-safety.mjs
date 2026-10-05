import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coachJobClass,JOB_TTL_MS} from '../worker/coach-jobs.js';
import worker,{CoachJob,CoachRateLimiter} from '../worker/index.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';

function state() {
  const values=new Map(); let queue=Promise.resolve();
  const storage={alarm:null,async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},
    async setAlarm(at){storage.alarm=at;},async deleteAll(){values.clear();},
    transaction(fn){const p=queue.then(()=>fn(storage));queue=p.catch(()=>{});return p;}};
  return {storage,waitUntil(p){p.catch(()=>{});}};
}
const id=crypto.randomUUID(),payload={voteGap:'far',script:'这是一份虚构测试稿。',scenario:null,revision:null};
const input={id,owner:'owner',ipHash:'hashed-ip',payload};
const put=data=>new Request('https://internal/task',{method:'PUT',body:JSON.stringify(data)});
const get=()=>new Request('https://internal/task');
let calls=0,release,limits=0;
const Job=coachJobClass({digest:async x=>JSON.stringify(x),authorize:async()=>true,rateLimit:async()=>{limits++;return null;},
  generate:async()=>{calls++;return new Promise(resolve=>release=()=>resolve({ok:true,report:{verdict:'passed',report_id:crypto.randomUUID()}}));}});
const ctx=state(),job=new Job(ctx,{});
const created=await Promise.all([job.fetch(put(input)),job.fetch(put(input))]);
assert.deepEqual(created.map(r=>r.status),[202,202]);assert.ok(ctx.storage.alarm);
assert.equal((await job.fetch(put({...input,payload:{...payload,script:'另一份'}}))).status,409);
const running=job.alarm();
while(!release)await new Promise(r=>setTimeout(r,1));
assert.equal((await (await job.fetch(get())).json()).state,'running');
for(let i=0;i<4;i++)await job.fetch(put(input));
assert.equal(calls,1);assert.equal(limits,1,'查询和丢包重发不重复占用限流');
release();await running;
const done=await (await job.fetch(get())).json();
assert.equal(done.state,'done');
const restored=new Job(ctx,{});
assert.deepEqual(await (await restored.fetch(get())).json(),done,'重建对象后取回同一份报告');
await restored.alarm();assert.equal(calls,1,'重复 alarm 不重新生成');
const stored=await ctx.storage.get('job');assert.equal(stored.payload,undefined);assert.equal(stored.ipHash,undefined);
assert.ok(stored.expiresAt-Date.now()<=JOB_TTL_MS);
await ctx.storage.put('job',{...stored,expiresAt:Date.now()-1});await restored.alarm();assert.equal((await restored.fetch(get())).status,404);
// Ambiguous provider execution after a host crash must stop instead of double billing.
await ctx.storage.put('job',{...input,state:'running',expiresAt:Date.now()+10000});await restored.alarm();
assert.equal((await (await restored.fetch(get())).json()).state,'failed');assert.equal(calls,1);
for(const kind of ['revoked','limited','generation']){
 let generated=0;
 const F=coachJobClass({digest:async x=>JSON.stringify(x),authorize:async()=>kind!=='revoked',
  rateLimit:async()=>kind==='limited'?{status:429,message:'稍后再试'}:null,
  generate:async()=>{generated++;throw Object.assign(new Error('private provider detail'),{status:502,publicMessage:'教练暂时未完成'});}});
 const c=state(),f=new F(c,{});await f.fetch(put(input));await f.alarm();
 const data=await (await f.fetch(get())).json();assert.equal(data.state,'failed');assert.equal(data.report,undefined);
 assert.equal(generated,kind==='generation'?1:0);assert.doesNotMatch(JSON.stringify(data),/private provider detail/);
}
// Public routes must authenticate every lookup and validate before persistence.
const states=new Map(),objects=new Map();const env={ACCESS_CODE:'synthetic-local-code',COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter)};
env.COACH_JOBS={idFromName:n=>n,get(n){if(!states.has(n))states.set(n,state());if(!objects.has(n))objects.set(n,new CoachJob(states.get(n),env));return objects.get(n);}};
const req=(path,body)=>worker.fetch(new Request('https://local.test'+path,{method:'POST',headers:{Origin:'https://git-chat01.github.io','CF-Connecting-IP':'127.0.0.1'},body:JSON.stringify(body)}),env,{waitUntil(){}});
assert.equal((await req('/api/coach/jobs',{...payload,jobId:id,accessCode:'bad'})).status,401);
assert.equal((await req('/api/coach/jobs',{...payload,jobId:'bad',accessCode:env.ACCESS_CODE})).status,400);
assert.equal((await req('/api/coach/jobs',{...payload,script:'',jobId:id,accessCode:env.ACCESS_CODE})).status,400);
assert.equal(states.size,0);
const response=await req('/api/coach/jobs',{...payload,jobId:id,accessCode:env.ACCESS_CODE});assert.equal(response.status,202);
assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),'https://git-chat01.github.io');
const serialized=JSON.stringify(await states.values().next().value.storage.get('job'));
assert.ok(!serialized.includes(env.ACCESS_CODE));assert.ok(!serialized.includes('127.0.0.1'));
assert.equal((await req('/api/coach/jobs/'+id,{accessCode:'bad'})).status,401);
env.ACCESS_CODE='rotated-local-code';assert.equal((await req('/api/coach/jobs/'+id,{accessCode:env.ACCESS_CODE})).status,404);
assert.equal((await req('/api/coach/jobs/'+crypto.randomUUID(),{accessCode:env.ACCESS_CODE})).status,404);
// A delayed limiter must not start spending tokens after the overall task deadline.
{
 const source=readFileSync(new URL('../worker/coach-jobs.js',import.meta.url),'utf8').replace('JOB_RUN_MS = 150000','JOB_RUN_MS = 20');
 const short=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let release,generated=0;
 const Slow=short.coachJobClass({digest:async x=>JSON.stringify(x),authorize:async()=>true,
  rateLimit:()=>new Promise(r=>release=r),generate:async()=>{generated++;return {report:{verdict:'passed'}};}});
 const c=state(),f=new Slow(c,{});await f.fetch(put(input));await f.alarm();
 assert.equal((await (await f.fetch(get())).json()).failure.status,504);
 release(null);await new Promise(r=>setTimeout(r,5));assert.equal(generated,0);
}
console.log('PASS durable job admission, immutable payloads, restart recovery, privacy, auth isolation, alarms and rate limits');
