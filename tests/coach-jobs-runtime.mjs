import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {reviewRecordKey} from '../worker/index.js';
const bundle=await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'browser',write:false});
const code='synthetic-runtime-code';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,
 compatibilityDate:'2026-08-16',bindings:{ACCESS_CODE:code},kvNamespaces:['CASES'],
 durableObjects:{COACH_LIMITER:{className:'CoachRateLimiter',useSQLite:true},COACH_JOBS:{className:'CoachJob',useSQLite:true}},cf:false}));
try {
 const kv=await mf.getKVNamespace('CASES');
 const health=await (await mf.dispatchFetch('https://local.test/health')).json();
 const script='只用于本地任务恢复验证的虚构原稿。';
 // Seed a completed validated-cache result. Runtime test needs no provider secret/network.
 const key=await reviewRecordKey(code,'far',script,null,[]);
 await kv.put(key,JSON.stringify({version:health.reviewVersion,expiresAt:Date.now()+60000,result:{ok:true,report:{verdict:'passed'},usage:{prompt_tokens:0,completion_tokens:0}}}));
 const id=crypto.randomUUID(),body={accessCode:code,jobId:id,voteGap:'far',script};
 const send=(path,body)=>mf.dispatchFetch('https://local.test'+path,{method:'POST',body:JSON.stringify(body)});
 const created=await send('/api/coach/jobs',body);assert.equal(created.status,202);
 assert.ok((await created.json()).jobId===id);
 // No connected browser waits on generation. Alarm must finish without another request.
 await new Promise(r=>setTimeout(r,1200));
 let result;
 for(let i=0;i<25;i++){
   result=await (await send('/api/coach/jobs/'+id,{accessCode:code})).json();
   if(['done','failed'].includes(result.state))break;
   await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(result.state,'done',JSON.stringify(result));assert.equal(result.report.verdict,'passed');assert.ok(result.report.report_id);
 const repeat=await (await send('/api/coach/jobs',body)).json();assert.deepEqual(repeat,result,'响应丢失后重发返回同一回执');
 const ns=await mf.getDurableObjectNamespace('COACH_LIMITER');
 const hash=async x=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x)))).toString('hex');
 const receipt=await ns.get(ns.idFromName('report:'+await hash([code,result.report.report_id]))).fetch('https://internal/report');
 assert.equal(receipt.status,200,'异步报告仍有不可变的后续改稿回执');
 assert.equal((await send('/api/coach/jobs/'+id,{accessCode:'wrong-code'})).status,401);
 assert.equal((await send('/api/coach/jobs',{...body,script:'不同原稿'})).status,409);
 // Missing model configuration becomes a stable failed job rather than endless polling.
 const badId=crypto.randomUUID();await send('/api/coach/jobs',{...body,jobId:badId,script:'另一份没有缓存的测试稿'});
 await new Promise(r=>setTimeout(r,1000));
 const failed=await (await send('/api/coach/jobs/'+badId,{accessCode:code})).json();assert.equal(failed.state,'failed');assert.equal(failed.failure.status,503);
 console.log('PASS actual workerd: SQLite task/alarm transaction, disconnected completion, immutable receipt recovery, no-network cached reuse and failure settlement');
} finally {await mf.dispose();}
