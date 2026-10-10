import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boundedDependency} from '../worker/deadline.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 .replace('cases:1500, cacheRead:750, cacheWrite:500, receipt:1200, progress:200, admission:1500','cases:20, cacheRead:20, cacheWrite:20, receipt:20, progress:20, admission:20')
 .replace('async function writeReviewRecord(','export async function writeReviewRecord(')
 .replace('async function generateCoachReview(','export async function generateCoachReview(')
 .replace(/from "(\.\/[^\"]+)";/g,(_all,path)=>'from "'+new URL('../worker/'+path,import.meta.url).href+'";');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const never=()=>new Promise(()=>{}),pause=ms=>new Promise(r=>setTimeout(r,ms));
const within=async(p,ms=1500)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test operation hung')),ms);})]);}finally{clearTimeout(timer);}};
const script='我是新人小禾，复活差很多，大家帮我上复活票吧。',quote='大家帮我上复活票吧。';
const assessment={core:[{key:'user_reason',status:'partial',quote,reason:'只有自己的复活需要，还没有说明观众参与什么。'},
 {key:'vote_instruction',status:'met',quote,reason:'已经邀请观众上复活票。'}],risks:[],awaiting_response:false,
 focus:{focus_key:'user_reason',keep:'保留新人身份和复活请求。',original:quote,action:'先说你能当场接什么内容，再接回自愿的复活邀请。',why:'观众知道参与能得到怎样的回应，才更容易决定是否加入。'},
 interaction:{reading:'向刚认识的观众发出复活邀请。',why:'本稿说清了请求，还缺具体互动内容。',next_check:'观察观众是否回应。'}};
const result=verdict=>({ok:true,report:{verdict},usage:{prompt_tokens:0,completion_tokens:0}});
function environment(){const values=new Map(),binding=createRateLimiterBinding(mod.CoachRateLimiter);return {ACCESS_CODE:'synthetic-storage-code',DEEPSEEK_API_KEY:'synthetic-model-key',values,COACH_LIMITER:binding,
 CASES:{list:async()=>({keys:[],list_complete:true}),get:async(key,type)=>{const value=values.get(key);return value===undefined?null:type==='json'?JSON.parse(value):value;},put:async(key,value)=>{values.set(key,value);}}};}
const oldLog=console.log,oldFetch=globalThis.fetch,logs=[];console.log=x=>logs.push(x);
let calls=0;
globalThis.fetch=async(_url,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{content:input.task==='recover_current_review'?JSON.stringify(assessment):'{'}}],usage:{prompt_tokens:1,completion_tokens:1}});};
const request=()=>new Request('https://local.test/api/coach',{method:'POST',body:JSON.stringify({accessCode:'synthetic-storage-code',voteGap:'far',script,scenario:NOVICE_SCENARIO})});
try {
 // Deadline skips work entirely; an ignored AbortSignal still cannot prolong the await.
 let started=0,signal;
 await assert.rejects(boundedDependency('cache_read',()=>{started++;},10,Date.now()-1));assert.equal(started,0);
 await assert.rejects(within(boundedDependency('cache_read',s=>{signal=s;return never();},15)),{name:'DependencyTimeoutError'});assert.equal(signal.aborted,true);
 const seen=console.log;console.log=()=>{throw Error('logger failed');};
 await assert.rejects(boundedDependency('cache_read',never,10),{name:'DependencyTimeoutError'});console.log=seen;
 // Both hanging cache reads and writes are optional, and same-key concurrency remains merged.
 {
  const e=environment();e.CASES.get=never;e.CASES.put=never;let generated=0;
  const produce=async()=>{generated++;return result('almost');};
  const [a,b]=await within(Promise.all([mod.reuseReview(e,'same',produce),mod.reuseReview(e,'same',produce)]));
  assert.equal(generated,1);assert.equal(a.report.verdict,'almost');assert.deepEqual(a,b);
  assert.equal((await mod.reuseReview(e,'same',produce)).report.verdict,'almost');assert.equal(generated,1);
 }
 // An old remote read cannot overwrite a newly completed local result.
 {
  const e=environment();let resolve;e.CASES.get=()=>new Promise(r=>resolve=r);
  const pending=mod.readReviewRecord(e,'late');await pause(1);
  await mod.writeReviewRecord(e,'late',result('passed'));
  const health=await(await mod.default.fetch(new Request('https://local.test/health'),e,{})).json();
  resolve({version:health.reviewVersion,expiresAt:Date.now()+60000,result:result('off')});
  assert.equal((await pending).report.verdict,'passed');assert.equal((await mod.readReviewRecord(e,'late')).report.verdict,'passed');
 }
 // A timed-out old PUT must finish before a new corrected PUT of that key starts.
 {
  const e=environment(),writes=[];let release;
  e.CASES.put=async(key,value)=>{writes.push(JSON.parse(value).result.report.verdict);if(writes.length===1)await new Promise(r=>release=r);e.values.set(key,value);};
  await within(mod.writeReviewRecord(e,'ordered',result('almost')));
  await within(mod.writeReviewRecord(e,'ordered',result('passed')));
  assert.deepEqual(writes,['almost']);assert.equal((await mod.readReviewRecord(e,'ordered')).report.verdict,'passed');
  release();await pause(5);assert.deepEqual(writes,['almost','passed']);assert.equal(JSON.parse(e.values.get('ordered')).result.report.verdict,'passed');
 }
 // A late receipt response never changes the already-delivered fallback ID.
 {
  const e=environment();let resolve;
  e.COACH_LIMITER={idFromName:x=>x,get:()=>({fetch:()=>new Promise(r=>resolve=r)})};
  const report={verdict:'almost'};
  await assert.rejects(within(mod.saveDeliveredReview(e,e.ACCESS_CODE,'far',script,null,report)),err=>err.status===503);
  report.report_id='delivered-fallback';report.history_available=false;
  resolve(new Response(null,{status:201}));await pause(5);
  assert.equal(report.report_id,'delivered-fallback');assert.equal(report.history_available,false);
 }
 // Body reads, not just response headers, must be bounded for history and admission.
 {
  const e=environment();e.COACH_LIMITER={idFromName:x=>x,get:()=>({fetch:async()=>({status:200,ok:true,json:never})})};
  await assert.rejects(within(mod.readDeliveredReview(e,e.ACCESS_CODE,crypto.randomUUID(),'far',script,null)),err=>err.status===503);
  assert.equal((await within(mod.checkCoachRateLimit(e,e.ACCESS_CODE,'127.0.0.1'))).status,503);
  const before=calls;const response=await within(mod.default.fetch(request(),e,{waitUntil(){}}));assert.equal(response.status,503);assert.equal(calls,before,'limiter outage cannot spend tokens');
 }
 // The whole public flow returns a validated result despite hanging retrieval,
 // cache IO and receipt IO; it does not just pass isolated helper tests.
 {
  const e=environment();e.CASES.list=never;e.CASES.get=never;e.CASES.put=never;
  const binding=e.COACH_LIMITER;e.COACH_LIMITER={idFromName:x=>x,get:name=>name.startsWith('report:')?{fetch:never}:binding.get(name)};
  const before=calls,start=Date.now();const response=await within(mod.default.fetch(request(),e,{waitUntil(){}}));const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.report.verdict,'almost');assert.equal(data.report.review_mode,'focused');
  assert.equal(data.report.history_available,false);assert.match(data.report.report_id,/^[\da-f-]{36}$/);assert.equal(calls-before,2);
  assert.ok(Date.now()-start<1500,'optional dependencies cannot consume the 150s task limit');
 }
 // Optional progress persistence cannot block generation, and expired work cannot start a model call.
 {
  const e=environment(),body={accessCode:e.ACCESS_CODE,voteGap:'far',script,scenario:NOVICE_SCENARIO};
  const data=await within(mod.generateCoachReview(body,e,{waitUntil(){}},Date.now(),Date.now()+1000,never));
  assert.equal(data.report.verdict,'almost');
  const before=calls;await assert.rejects(mod.generateCoachReview({...body,script:script+'请大家支持。'},e,{waitUntil(){}},Date.now(),Date.now()-1,never),err=>err.status===504);
  assert.equal(calls,before);
 }
 assert.ok(logs.some(x=>x?.event==='coach_dependency_degraded'&&x.operation==='receipt_write'));
 assert.ok(logs.some(x=>x?.event==='coach_dependency_degraded'&&x.operation==='case_retrieval'));
 assert.doesNotMatch(JSON.stringify(logs),/synthetic-storage-code|synthetic-model-key|新人小禾/,'retained logs must not contain secrets or scripts');
} finally {globalThis.fetch=oldFetch;console.log=oldLog;}
console.log('PASS bounded storage: never-returning dependencies, late reads/writes/receipts, independent body deadlines, fail-closed admission, same-draft reuse and complete report delivery');
