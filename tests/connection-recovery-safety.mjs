import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker,{CoachRateLimiter,reviewRecordKey,readReviewRecord,sanitizeScenario} from '../worker/index.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const good=()=>({ok:true,status:200,text:async()=>JSON.stringify({ok:true,report:{verdict:'almost',report_id:'local-test'}})});
function client(fetch,online=true){
 const timers=new Map(),events={success:[],error:[],retry:[],finished:0};let seq=0,clock=0;
 const c=vm.createContext({console,Promise,Error,API_BASE:'https://local.test',navigator:{onLine:online},
 Date:class extends Date{static now(){return clock;}},
 setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq;},clearTimeout(id){timers.delete(id);},
 App:{getAccessCode:()=> 'test-code',toast(){}},fetch});c.window=c;
 vm.runInContext(readFileSync(new URL('../site/js/api.js',import.meta.url),'utf8'),c);
 const body={voteGap:'far',script:'虚构的新人口语稿',revision:{previousScript:'上一份原稿',reportId:'11111111-1111-4111-8111-111111111111',focusKey:'user_reason',instruction:'沿原话修改'}};
 return {c,timers,events,advance(ms){clock+=ms;},start(){c.Api.submit(body,{onSuccess:r=>events.success.push(r),onError:(status,message)=>events.error.push({status,message}),onRetry:s=>events.retry.push(s),onFinish:()=>events.finished++});},
 fire(ms){for(const [id,t] of timers)if(t.ms===ms){timers.delete(id);t.fn();return true;}return false;}};
}
const failures=[
 ()=>Promise.reject(new TypeError('Failed to fetch')),
 ()=>{throw new TypeError('Network request failed');},
 ()=>Promise.resolve({ok:true,status:200,text:()=>Promise.reject(new TypeError('Load failed'))}),
 ()=>Promise.resolve({ok:true,status:200,text:async()=>'{"t":"ping"}\n'}),
 ()=>Promise.resolve({ok:true,status:200,text:async()=>'{"t":"ping"}\n{"ok":true,"report":'}),
 ()=>Promise.resolve({ok:true,status:200,text:async()=>''}),
 ()=>Promise.resolve({ok:true,status:200,text:async()=>'{"ok":true}'}),
];
for(const fail of failures){
 const bodies=[];const s=client((_url,options)=>{bodies.push(options.body);return bodies.length===1?fail():Promise.resolve(good());});
 s.start();await flush();assert.equal(s.events.success.length,0,'不完整响应不可交付');assert.equal(s.events.retry.length,1);assert.match(s.events.retry[0],/自动重连/);
 assert.ok(s.fire(1500));await flush();assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1],'重连保持原稿、背景和原报告编号');
 assert.equal(s.events.success.length,1);assert.equal(s.events.error.length,0);assert.equal(s.events.finished,1);assert.equal(s.c.Api._inFlight,false);
}
{
 let count=0;const s=client(()=>{count++;return Promise.reject(new TypeError('Load failed'));});s.start();await flush();s.fire(1500);await flush();
 assert.equal(count,2,'反复断连也只自动恢复一次');assert.equal(s.events.error.length,1);assert.match(s.events.error[0].message,/连接中断/);assert.equal(s.events.finished,1);
}
for(const mode of ['offline','late','cancel','deadline']){
 let count=0;let s;s=client(()=>{count++;if(mode==='late')s.advance(61000);return Promise.reject(new TypeError('Load failed'));},mode!=='offline');s.start();await flush();
 if(mode==='cancel'){s.c.Api.cancel();s.fire(1500);await flush();assert.equal(s.events.error.length,0);}
 if(mode==='deadline'){s.fire(105000);await flush();s.fire(1500);await flush();assert.match(s.events.error[0].message,/时限/);}
 if(mode==='offline')assert.match(s.events.error[0].message,/离线/);
 if(mode==='late')assert.equal(s.events.retry.length,0,'剩余时间不足，不让新人白等一次生成');
 assert.equal(count,1);assert.equal(s.events.finished,1);assert.equal(s.c.Api._inFlight,false);
}
// Retry feedback updates the waiting message without resetting the clock or losing the draft.
{
 const message={textContent:''};const c=vm.createContext({document:{getElementById:id=>id==='loading-message'?message:null}});
 vm.runInContext(readFileSync(new URL('../site/js/report.js',import.meta.url),'utf8'),c);
 c.Report.showRetrying('连接刚刚中断，正在自动重连。');assert.match(message.textContent,/自动重连/);
}

function env(){const values=new Map();return {ACCESS_CODE:'local-connection-test',DEEPSEEK_API_KEY:'not-real',COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),CASES:{async list(){return {keys:[],list_complete:true};},async get(k,type){const v=values.get(k);return v==null?null:type==='json'?JSON.parse(v):v;},async put(k,v){values.set(k,v);}}};}
const script='我会机械舞，复活回台后你们选方向，想看就帮我上点复活票。';
function request(stream=false){return new Request('https://local.test/api/coach',{method:'POST',headers:{Accept:stream?'application/x-ndjson':'application/json'},body:JSON.stringify({accessCode:'local-connection-test',voteGap:'far',script,scenario:NOVICE_SCENARIO})});}
const beforeFetch=globalThis.fetch;
try{
 for(const streaming of [false,true])for(const [kind,status] of [['headers',503],['body-network',503],['body-timeout',504],['body-json',503],['upstream-status',503]]){
  globalThis.fetch=async()=>{
   if(kind==='headers')throw new TypeError('socket disconnected');
   if(kind==='upstream-status')return {ok:false,status:429,body:{cancel:async()=>{}},text(){throw Error('must not read upstream error bodies');}};
   return {ok:true,json:async()=>{const error=kind==='body-json'?new SyntaxError('incomplete JSON'):new Error('body disconnected');if(kind==='body-timeout')error.name='TimeoutError';throw error;}};
  };
  const response=await worker.fetch(request(streaming),env(),{waitUntil(){}});const body=JSON.parse((await response.text()).trim().split('\n').at(-1));
  assert.equal(streaming?body.status:response.status,status,kind);assert.equal(body.error,true);assert.equal(body.report,undefined);
  if(kind==='body-timeout')assert.match(body.message,/超过等待时限/);
  else assert.doesNotMatch(body.message,/检查.*网络/,'上游错误不能归咎学员手机');
 }
 // Even a body reader that ignores AbortSignal cannot evade the shared deadline.
 const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8').replace('timeoutMs: 90000','timeoutMs: 100').replace('deadline - 27000','deadline - 20').replace(/from "(\.\/[^\"]+)";/g,(_all,path)=>'from "'+new URL('../worker/'+path,import.meta.url).href+'";');
 const short=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let signal;globalThis.fetch=async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(()=>{})};};
 const start=Date.now();const timed=await short.default.fetch(request(),env(),{waitUntil(){}});
 assert.equal(timed.status,504);assert.ok(signal.aborted);assert.ok(Date.now()-start<2000,'卡在正文也必须结束等待');
 // An interrupted browser stream still registers the same generation for bounded waitUntil recovery.
 let release,calls=0;globalThis.fetch=()=>{calls++;return new Promise(resolve=>release=resolve);};const e=env(),pending=[];
 const response=await worker.fetch(request(true),e,{waitUntil:p=>pending.push(p)});
 assert.equal(response.headers.get('cache-control'),'no-store, no-transform');assert.equal(pending.length,1);
 const reader=response.body.getReader();await reader.read();await reader.cancel();
 for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(release);
 const report={interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'提出机械舞和选择方向的邀请。',why:'内容和参与动作有原句依据。',next_check:'看观众是否回应。'},card_type:'logic',card_why:'内容与动作清楚。',audience:'陌生观众',verdict:'passed',verdict_reason:'参与理由和动作已说清。',echo:'保留原有内容。',one_thing:'观察真实回应。',ai_flavor:'',redline_note:'',structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:['user_reason','vote_instruction'].includes(key)?'met':'partial',evidence:script})),line_reviews:[{original:script,mark:'good',comment:'原话有具体内容和动作。'}],round_dynamics:{flow_read:'提出机械舞内容。',human_drivers:[{driver:'control',evidence:'你们选方向',mechanism:'让观众可以参与内容选择。'}],response_read:'尚未看到实际反馈。',next_move:'观察回应。'},coaching:{focus_key:'final_polish',keep:'保留内容。',original:script,action:'保留原稿。',example:script,why:'参与方式清楚。'}};
 release(Response.json({choices:[{message:{content:JSON.stringify(report)}}],usage:{prompt_tokens:1,completion_tokens:1}}));
 await Promise.all(pending);
 const key=await reviewRecordKey(e.ACCESS_CODE,'far',script,sanitizeScenario(NOVICE_SCENARIO),[]);
 assert.equal((await readReviewRecord(e,key)).report.verdict,'passed','断开后的完成结果应进入既有缓存');
 const again=await worker.fetch(request(),e,{waitUntil(){}});assert.equal(again.status,200);assert.equal(calls,1,'重新连接读取完成结果，不重复调模型');
}finally{globalThis.fetch=beforeFetch;}
console.log('PASS mobile connection recovery, incomplete streams, cancellation, shared deadlines, provider body failures and bounded cache recovery');
