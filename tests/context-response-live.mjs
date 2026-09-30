import { createRateLimiterBinding } from "./helpers/rate-limiter.mjs";
// Synthetic regression against the configured model; never reads production KV.
// node tests/context-response-live.mjs --live
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import { CoachRateLimiter } from '../worker/index.js';
import worker from '../worker/index.js';
if(!process.argv.includes('--live'))throw new Error('Use --live to call the configured model');
const vars=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const key=vars.split(/\r?\n/u).find(l=>l.startsWith('DEEPSEEK_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/gu,'');
if(!key)throw new Error('Missing configured model key');
const values=new Map();
const env={COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),ACCESS_CODE:'context-live-test',DEEPSEEK_API_KEY:key,CASES:{async list(){return {keys:[],list_complete:true};},async get(k,type){const v=values.get(k);return v===undefined?null:type==='json'?JSON.parse(v):v;},async put(k,v){values.set(k,v);}}};
const pending=[];
const context=vm.createContext({});
vm.runInContext(await readFile(new URL('../site/js/form.js',import.meta.url),'utf8'),context);
const scene={phase:'awaiting_drop',targetUnits:28,pledgedUnits:28,openRemaining:0,deliveredUnits:0,hostCue:'已确认28个位置全部组满，主持尚未发出统一丢票口令。',userSignal:'大家已经认领完28个位置。'};
const only=process.argv.find(x=>x.startsWith("--only="))?.slice(7);
const fixtures=[
 {id:'short-host-wait',script:'组满了，谢谢大家，等主持口令。',scenario:scene,passed:true},
 {id:'conditional-host-wait',script:'大家组齐了，谢谢你们！等主持喊完，现在先别动，口令一到大家一起丢。',scenario:scene,passed:true},
 {id:'protect-viewers',script:'大家组齐了，谢谢你们！未成年人不要刷礼物，大家等主持口令。',scenario:scene,passed:true},
 {id:'premature-delivery',script:'大家组齐了，谢谢你们！不用等主持，大家现在一起丢。',scenario:scene,passed:false},
 {id:'await-response',script:'刚来的朋友，你想看什么？跟我说说。',scenario:null,waiting:true,passed:false},
];
const results=[];
const out=new URL('tmp_results/context-response-live.json',import.meta.url);
await mkdir(new URL('tmp_results/',import.meta.url),{recursive:true});
async function submit(f){
 const start=Date.now();let result;
 try{
  const response=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:'secured',script:f.script,scenario:f.scenario})}),env,{waitUntil:p=>pending.push(p)});
  const body=await response.json();
  result={...f,status:response.status,body,ms:Date.now()-start};
  assert.equal(response.status,200,body.message);
  assert.equal(body.report.verdict==='passed',f.passed);
  assert.equal(body.report.practice_status==='awaiting_response',Boolean(f.waiting));
  result.ok=true;
 }catch(error){result={...result,id:f.id,ok:false,error:error.message,ms:Date.now()-start};}
 results.push(result);
 console.log(JSON.stringify({id:f.id,ok:result.ok,verdict:result.body?.report?.verdict,practice:result.body?.report?.practice_status,ms:result.ms,error:result.error}));
 await writeFile(out,JSON.stringify({at:new Date().toISOString(),results},null,2));
 return result;
}
for(let offset=0;offset<fixtures.length;offset+=3)await Promise.all(fixtures.slice(offset,offset+3).filter(f=>!only||only.split(",").includes(f.id)).map(submit));
const probe=fixtures.find(f=>f.waiting);
for(const [branch,script] of [[0,'我是小满，今天刚来，先陪你聊聊，你怎么称呼？'],[1,'好，那你安心看着，不用送，咱们聊聊天。'],[2,'没关系，你先看看，想聊的时候再跟我说。']]) {
 if(only&&!only.split(',').includes('response-branch-'+branch))continue;
 const next=context.Form.responseRequest({voteGap:'close',script:probe.script,scenario:probe.scenario},script,branch);
 await submit({id:'response-branch-'+branch,script:next.script,scenario:next.scenario,passed:true});
}
await Promise.all(pending);
if(results.some(r=>!r.ok))process.exitCode=1;
