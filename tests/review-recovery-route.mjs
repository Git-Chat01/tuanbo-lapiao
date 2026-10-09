import assert from 'node:assert/strict';
import worker,{CoachJob,CoachRateLimiter,splitHardSentences,saveDeliveredReview,readDeliveredReview,reviewRecordKey,reuseReview,sanitizeScenario} from '../worker/index.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';

// All model calls and persistence are synthetic and local. Never loads environment secrets.
const script='我是新人小禾，复活差很多，大家帮我上复活票吧。';
const ask='大家帮我上复活票吧。';
const example='你们给个普通词，我接一句打招呼，想听的朋友帮我上点复活票。';
const scene=sanitizeScenario(NOVICE_SCENARIO);
const waits=[];
const ctx={waitUntil:promise=>waits.push(Promise.resolve(promise))};
async function settle(){await Promise.all(waits.splice(0));}
function environment(){
 const records=new Map(),binding=createRateLimiterBinding(CoachRateLimiter);
 return {records,binding,ACCESS_CODE:'synthetic-recovery-code',ADMIN_CODE:'synthetic-admin-code',DEEPSEEK_API_KEY:'synthetic-key',COACH_LIMITER:binding,
  CASES:{async get(key,type){const value=records.get(key);return value==null?null:type==='json'?JSON.parse(value):value;},async put(key,value){records.set(key,value);},async delete(key){records.delete(key);},
   async list({prefix='',limit=1000,cursor}={}){const all=[...records.keys()].filter(key=>key.startsWith(prefix)).sort(),start=Number(cursor)||0;
    return {keys:all.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=all.length,cursor:String(start+limit)};}}};
}
function mainReport(current=script,original=ask){return {card_type:'logic',card_why:'只有自己的需要，还没给观众可参与的内容。',audience:'刚进房的观众',
 verdict:'almost',verdict_reason:'还需说明观众可以参与的具体内容。',echo:'复活请求已经说清。',one_thing:'补具体互动',ai_flavor:'',redline_note:'',
 structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:key==='user_reason'?'partial':'met',evidence:current})),
 line_reviews:splitHardSentences(current).map(original=>({original,mark:'good',comment:'说明处境和邀请。'})),
 interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'向陌生观众发出复活邀请。',why:'还缺具体参与内容。',next_check:'看回应'},
 round_dynamics:{flow_read:'说明处境并请求复活',human_drivers:[{driver:'other',evidence:current,mechanism:'直接请求支持'}],response_read:'没有实际回应',next_move:'补参与内容'},
 coaching:{focus_key:'user_reason',keep:'保留复活请求。',original,action:'补一个能当下接的互动。',example,why:'原来只有你的需要，改后说明观众做什么、你接什么。'}};}
function assessment(current=script,verdict='almost',quote=ask){
 const passed=verdict==='passed';
 return {core:[{key:'user_reason',status:passed?'met':'partial',quote,reason:passed?'清楚说明观众给词、主播接话的参与过程。':'只有复活请求，还没说明观众能参与的内容。'},
  {key:'vote_instruction',status:'met',quote,reason:'说清了想让观众上复活票。'}],risks:[],awaiting_response:false,
  focus:{focus_key:passed?'final_polish':'user_reason',keep:'保留新人身份和自愿的复活请求。',original:quote,
   action:passed?'保留这版内容，开口练并观察观众回应。':'把复活后具体接什么内容说清，再接回自愿的复活邀请。',why:'观众知道参与能得到怎样的回应，才更容易决定是否加入。'},
  interaction:{reading:'向尚不熟悉的新观众说明处境并发出邀请。',why:'根据本稿判断参与内容和邀请动作。',next_check:'看观众是否接词，再按回应继续。'}};
}
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}],usage:{prompt_tokens:2,completion_tokens:3}});
const originalFetch=globalThis.fetch,originalLog=console.log;
let calls=[],logs=[];
function model(fn){calls=[];globalThis.fetch=async(url,options)=>{
 assert.ok(options?.body,'only synthetic model POSTs expected');
 const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content),task=input.task||'grade';calls.push({task,input,payload});
 return fn(task,input,calls.length);
};}
async function request(env,path,body,stream=false){
 const result=await worker.fetch(new Request('https://local.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:stream?'application/x-ndjson':'application/json','CF-Connecting-IP':'127.0.0.77'},body:JSON.stringify({accessCode:env.ACCESS_CODE,...body})}),env,ctx);
 const text=await result.text(),value=JSON.parse(text.trim().split('\n').at(-1));
 return {httpStatus:result.status,status:value.status||result.status,body:value,contentType:result.headers.get('content-type')};
}
const submit=(env,body={},stream=false)=>request(env,'/api/coach',{voteGap:'far',scenario:NOVICE_SCENARIO,script,...body},stream);
function currentResult(result,verdict){assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.report.verdict,verdict);assert.match(result.body.report.report_id,/^[\da-f-]{36}$/);assert.equal(result.body.error,undefined);}
function wrapReceipts(env,fail){
 const binding=env.binding;
 env.COACH_LIMITER={idFromName:name=>binding.idFromName(name),get(name){const object=binding.get(name);return {fetch:request=>fail(request)?Promise.resolve(new Response(null,{status:503})):object.fetch(request)};}};
}
function jobBinding(env){
 const states=new Map(),objects=new Map(),phases=[];
 const binding={states,objects,phases,idFromName:name=>name,get(name){
  if(!objects.has(name)){
   const values=new Map();let queue=Promise.resolve();
   const storage={async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));if(key==='job'&&value.state==='running')phases.push(value.phase);},async setAlarm(at){storage.alarm=at;},async deleteAll(){values.clear();},
    transaction(fn){const task=queue.then(()=>fn(storage));queue=task.catch(()=>{});return task;}};
   const state={storage,values,waitUntil:ctx.waitUntil};states.set(name,state);objects.set(name,new CoachJob(state,env));
  }return objects.get(name);
 }};return binding;
}
async function until(predicate){for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('async condition did not settle');}
console.log=value=>logs.push(String(value));
try {
 // Broken full JSON is repaired through the small independent contract in either transport.
 for(const stream of [false,true]){
  const env=environment();model(task=>response(task==='recover_current_review'?assessment():'{"line_reviews":'));
  const result=await submit(env,{},stream);currentResult(result,'almost');
  assert.equal(result.body.report.review_mode,'focused');assert.equal(result.body.report.coaching.mode,'guidance');
  assert.equal(result.body.report.coaching.example,'');assert.deepEqual(result.body.report.line_reviews,[]);
  assert.deepEqual(result.body.report.structure_checks.map(item=>item.key),['user_reason','vote_instruction']);
  assert.deepEqual(calls.map(call=>call.task),['grade','recover_current_review']);
  assert.equal(calls[1].payload.thinking.type,'disabled');
  assert.equal(JSON.stringify(calls[1].input).includes('coaching'),false,'recovery has no old judgment to copy');
  if(stream)assert.match(result.contentType,/ndjson/);
  const count=calls.length;currentResult(await submit(env,{},stream),'almost');assert.equal(calls.length,count,'recovery result cached once');
  await settle();
 }

 // A full report with an unusable auxiliary contract and its failed repair still reaches a real judgment.
 {
  const env=environment();model(task=>{if(task==='recover_current_review')return response(assessment());const report=mainReport();delete report.interaction_review;return response(report);});
  const result=await submit(env);currentResult(result,'almost');
  assert.deepEqual(calls.map(call=>call.task),['grade','grade','recover_current_review']);assert.deepEqual(result.body.usage,{prompt_tokens:6,completion_tokens:9},'discarded full report and repair still count toward usage');await settle();
 }

 // No route may manufacture a grade when every model connection fails.
 for(const stream of [false,true]){
  const env=environment();model(()=>{throw Error('synthetic disconnected model');});
  const result=await submit(env,{},stream);assert.equal(result.status,503);assert.equal(result.body.report,undefined);
  assert.ok(calls.length<=4);assert.equal(calls.filter(call=>call.task==='recover_current_review').length,2);
  assert.equal([...env.records.keys()].filter(key=>key.startsWith('review:')).length,0);await settle();
 }

 // Missing risk fields, invented quotes and an omitted actual redline cannot become a passing fallback.
 for(const kind of ['missing-risk-list','fake-quote','omitted-local-risk']){
  const env=environment(),current=kind==='omitted-local-risk'?script+'借钱刷礼物支持我。':script;
  model(task=>{if(task!=='recover_current_review')return response('{');const value=assessment(current,'passed');
   if(kind==='missing-risk-list')delete value.risks;
   if(kind==='fake-quote')value.core[0].quote='这一句不在当前稿';
   return response(value);
  });
  const result=await submit(env,{script:current});assert.equal(result.status,503,kind+': '+JSON.stringify(result.body));assert.equal(result.body.report,undefined);
  assert.equal(calls.length,3,'one broken main call and two bounded recovery attempts');await settle();
 }

 // A damaged teaching card does not erase a fully evidenced judgment on the second short attempt.
 {
  const env=environment();model(task=>{if(task!=='recover_current_review')return response('{');const value=assessment();value.focus.focus_key='redline';return response(value);});
  const result=await submit(env);currentResult(result,'almost');assert.equal(result.body.report.coaching.focus_key,'user_reason');assert.equal(result.body.report.coaching.mode,'guidance');assert.equal(calls.length,3);await settle();
 }

 // A verified current assessment survives an unavailable optional example checker.
 {
  const env=environment();model(task=>{if(task==='example')throw Error('synthetic example check unavailable');assert.equal(task,'grade');return response(mainReport());});
  const result=await submit(env);currentResult(result,'almost');
  assert.equal(result.body.report.structure_checks.find(check=>check.key==='user_reason').status,'partial');
  assert.equal(result.body.report.coaching.mode,'guidance');assert.equal(result.body.report.coaching.example,'');assert.deepEqual(result.body.report.coaching.related_edits,[]);
  assert.ok(result.body.report.coaching.action);assert.ok(result.body.report.coaching.why);assert.deepEqual(result.body.report.direction.examples,[]);
  assert.deepEqual(calls.map(call=>call.task),['grade','example']);await settle();
 }

 // Failed arbitration is also cached per exact history receipt, without promoting the draft.
 {
  const env=environment(),previous=mainReport(),previousId=await saveDeliveredReview(env,env.ACCESS_CODE,'far',script,scene,previous);
  const current=script.replace(ask,example),cached=mainReport(current,example);
  await reuseReview(env,await reviewRecordKey(env.ACCESS_CODE,'far',current,scene,[]),async()=>({ok:true,report:cached,usage:{}}));
  model(()=>{throw Error('synthetic arbitration outage');});
  const body={script:current,revision:{reportId:previousId,previousScript:script,focusKey:'user_reason',instruction:'补参与理由'}};
  const first=await submit(env,body);currentResult(first,'almost');assert.equal(first.body.report.revision_check.status,'unverified');assert.equal(calls.length,2);
  const next=await submit(env,body);currentResult(next,'almost');assert.equal(calls.length,2,'same receipt does not re-spend after an unavailable arbitration');
  assert.doesNotMatch(next.body.report.revision_note,/上次.*(?:错误|不够到位)/);await settle();
 }

 // Resolve a cached repeat rejection without mutating the learner's original immutable receipt.
 for(const verdict of ['passed','almost']){
  const env=environment(),previous=mainReport(),previousId=await saveDeliveredReview(env,env.ACCESS_CODE,'far',script,scene,previous);
  const originalReceipt=await readDeliveredReview(env,env.ACCESS_CODE,previousId,'far',script,scene);
  const current=script.replace(ask,example),cached=mainReport(current,example);
  const key=await reviewRecordKey(env.ACCESS_CODE,'far',current,scene,[]);
  await reuseReview(env,key,async()=>({ok:true,report:cached,usage:{prompt_tokens:7,completion_tokens:9}}));
  model(task=>{assert.equal(task,'recover_current_review','a cached exact conflict goes directly to independent adjudication');return response(assessment(current,verdict,example));});
  const body={script:current,revision:{reportId:previousId,previousScript:script,focusKey:'redline',instruction:'untrusted client instruction'}};
  const first=await submit(env,body);currentResult(first,verdict);assert.equal(first.body.report.review_mode,'focused');
  assert.equal(first.body.report.revision_check.status,verdict==='passed'?'resolved':'unverified');
  assert.equal(first.body.report.revision_check.focus_key,'user_reason','trust the delivered receipt, not client focus');
  assert.equal(calls.length,1);
  const second=await submit(env,body,true);currentResult(second,verdict);assert.equal(calls.length,1,'the corrected cached report never repeats 409 or calls the model again');
  assert.deepEqual(await readDeliveredReview(env,env.ACCESS_CODE,previousId,'far',script,scene),originalReceipt);
  assert.equal(previous.report_id,previousId);await settle();
 }

 // Optional history outages must not discard the current result or bypass rate limiting.
 for(const kind of ['read','write']){
  const env=environment(),old=mainReport(),previousId=await saveDeliveredReview(env,env.ACCESS_CODE,'far',script,scene,old);
  wrapReceipts(env,request=>new URL(request.url).pathname==='/report'&&request.method===(kind==='read'?'GET':'PUT'));
  const current=kind==='read'?script.replace(ask,example):script;
  model(task=>response(task==='recover_current_review'?assessment(current,'almost',kind==='read'?example:ask):'{'));
  const result=await submit(env,kind==='read'?{script:current,revision:{reportId:previousId,previousScript:script,focusKey:'user_reason',instruction:'补参与内容'}}:{});
  currentResult(result,'almost');
  if(kind==='write')assert.equal(result.body.report.history_available,false);
  assert.ok([...env.binding.states.values()].some(state=>state.values.get('window')?.count===1),'admission protection still used');
  assert.equal(calls.length,2);await settle();
 }

 // Durable work transitions through recovery and finishes at the same UUID, using one quota admission.
 {
  const env=environment();env.COACH_JOBS=jobBinding(env);let release;
  model(task=>task==='recover_current_review'?new Promise(resolve=>release=()=>resolve(response(assessment()))):response('{'));
  const id=crypto.randomUUID(),body={jobId:id,voteGap:'far',script,scenario:NOVICE_SCENARIO};
  const created=await request(env,'/api/coach/jobs',body);assert.equal(created.status,202);assert.equal(created.body.jobId,id);
  const object=[...env.COACH_JOBS.objects.values()][0],running=object.alarm();await until(()=>release);
  const recovering=await request(env,'/api/coach/jobs/'+id,{});assert.equal(recovering.body.state,'running');assert.equal(recovering.body.phase,'recovering');
  for(let i=0;i<3;i++){const retry=await request(env,'/api/coach/jobs',body);assert.equal(retry.body.jobId,id);assert.equal(retry.body.state,'running');}
  release();await running;
  const done=await request(env,'/api/coach/jobs/'+id,{});assert.equal(done.body.state,'done');assert.equal(done.body.jobId,id);assert.equal(done.body.report.verdict,'almost');
  assert.ok(env.COACH_JOBS.phases.includes('reviewing'));assert.ok(env.COACH_JOBS.phases.includes('recovering'));
  const windows=[...env.binding.states.values()].map(state=>state.values.get('window')).filter(Boolean);
  assert.equal(windows.length,2,'one code bucket and one IP bucket');assert.ok(windows.every(window=>window.count===1));
  const deliveredId=done.body.report.report_id;await object.alarm();
  const again=await request(env,'/api/coach/jobs/'+id,{});assert.equal(again.body.report.report_id,deliveredId);assert.equal(calls.length,2);
  assert.equal([...env.COACH_JOBS.states.values()][0].values.get('job').payload,undefined,'completed task removes source draft');await settle();
 }
} finally {globalThis.fetch=originalFetch;console.log=originalLog;await settle();}
console.log('PASS recovery routes: JSON/NDJSON, bounded real assessment, rejected invalid evidence, retained grading without examples, cached conflict resolution, immutable receipts, history outages and same-job recovery');
