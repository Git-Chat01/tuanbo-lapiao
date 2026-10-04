import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import worker, {CoachRateLimiter, applyCoachingEdits, hasCertainAudienceClaim} from '../worker/index.js';
import {detectRedline} from '../worker/redlines.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
import {noviceCoachingFixtures} from './novice-coaching-fixtures.mjs';
if(!process.argv.includes('--live'))throw Error('Use --live to send the synthetic fixtures to the configured model; production KV is never read.');
const vars=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const key=vars.split(/\r?\n/u).find(l=>l.startsWith('DEEPSEEK_API_KEY='))?.slice('DEEPSEEK_API_KEY='.length).trim().replace(/^['"]|['"]$/gu,'');
if(!key)throw Error('Configured model key missing');
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7).split(',');
const fixtures=noviceCoachingFixtures.filter(f=>!only||only.includes(f.id));
if(!fixtures.length)throw Error("No matching synthetic fixtures");
const label=process.argv.find(x=>x.startsWith("--label="))?.slice(8) || "";
if(label && !/^[a-z0-9-]+$/u.test(label))throw Error("Invalid run label");
let baselinePrompt=null;
if(process.argv.includes('--baseline')){
 const old=execFileSync('git',['show','HEAD:worker/current-review.js'],{encoding:'utf8'}).replace('from "./prompt.js";', 'from "'+new URL('../worker/prompt.js',import.meta.url).href+'";');
 baselinePrompt=(await import('data:text/javascript;base64,'+Buffer.from(old).toString('base64'))).SYSTEM_PROMPT;
}
const results=[];
const traceLabels=new Map(fixtures.map(f=>[f.script,f.id]));
const originalFetch=globalThis.fetch,rawCounts=new Map();
globalThis.fetch=async(url,options)=>{
 if(baselinePrompt){const body=JSON.parse(options.body);body.messages[0].content=baselinePrompt;options={...options,body:JSON.stringify(body)};}
 if(process.argv.includes("--no-thinking")){const body=JSON.parse(options.body);body.thinking={type:"disabled"};delete body.reasoning_effort;options={...options,body:JSON.stringify(body)};}
 const modelStarted=Date.now();
 const response=await originalFetch(url,options);
 const prompt=JSON.parse(JSON.parse(options.body).messages[1].content);
 const traceLabel=traceLabels.get(prompt.currentScript);
 const fixture=traceLabel?{id:traceLabel,script:prompt.currentScript}:null;
 if(fixture){
  const n=(rawCounts.get(fixture.id)||0)+1;rawCounts.set(fixture.id,n);
  const data=await response.clone().json();
  await writeFile(new URL('tmp_results/novice-raw-'+(label?label+'-':'')+fixture.id+'-'+n+'.json',import.meta.url),JSON.stringify({script:fixture.script,report:data.choices?.[0]?.message?.content,ms:Date.now()-modelStarted,usage:data.usage},null,2));
 }
 return response;
};
const output=new URL('tmp_results/novice-coaching-live'+(label?'-'+label:'')+'.json',import.meta.url);
await mkdir(new URL('tmp_results/',import.meta.url),{recursive:true});
async function run(f){
 const store=new Map();const pending=[];
 const env={ACCESS_CODE:'local-novice-calibration',DEEPSEEK_API_KEY:key,COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),CASES:{
  async list(){return {keys:[],list_complete:true};},async get(k,type){const v=store.get(k);return v===undefined?null:type==='json'?JSON.parse(v):v;},async put(k,v){store.set(k,v);},async delete(k){store.delete(k);}}};
 const started=Date.now();let result={id:f.id,expectedPassed:f.passed,lesson:f.lesson};
 try{
  const response=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode:env.ACCESS_CODE,script:f.script,voteGap:'far',scenario:NOVICE_SCENARIO})}),env,{waitUntil:p=>pending.push(p)});
  const body=await response.json();result={...result,status:response.status,body,firstReviewMs:Date.now()-started};
  assert.equal(response.status,200,body.message);
  assert.equal(body.report.verdict==='passed',f.passed,JSON.stringify({verdict:body.report.verdict,reason:body.report.verdict_reason}));
  assert.equal(body.report.practice_status==='awaiting_response',Boolean(f.waiting));
  if(!f.passed&&!f.waiting){assert.ok(body.report.coaching?.example);assert.ok(body.report.coaching?.why);assert.ok(body.report.card_why);}
  if(f.risk)assert.equal(body.report.verdict,'off');
  const descriptions=[body.report.card_why,body.report.coaching?.why,...body.report.line_reviews.map(x=>x.comment)];
  assert.ok(!descriptions.some(hasCertainAudienceClaim),'不能把观众心理说成必然');
  if(f.recheck || ['need-only','polite-only','specific-content-no-action'].includes(f.id)){
   const lesson=body.report.coaching;
   const revised=applyCoachingEdits(f.script,lesson);
   assert.ok(revised,'示范与关联修改应准确定位且不重叠');
   if(f.preserve){assert.match(revised,new RegExp(f.preserve,'u'),'保留本稿已有的内容');assert.doesNotMatch(revised,/开场白|机械舞|机器人/u.test(f.script)?/$^/u:/开场白|机械舞|机器人/u,'不换成无关模板');}
   if(f.forbiddenSuggestion)assert.doesNotMatch(revised,new RegExp(f.forbiddenSuggestion,"u"),"改法不能越过本稿明确的能力边界");
   assert.deepEqual(detectRedline(revised),[],"整稿不能残留诱导借钱等风险，保护性劝阻可以保留");
   if(f.removed)assert.doesNotMatch(revised,new RegExp(f.removed,'u'),'整稿不能残留同类错误');
   traceLabels.set(revised,f.id+'-revision');
   const revisionStarted=Date.now();
   const next=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode:env.ACCESS_CODE,script:revised,voteGap:'far',scenario:NOVICE_SCENARIO,revision:{reportId:body.report.report_id,previousScript:f.script,focusKey:lesson.focus_key,instruction:lesson.action}})}),env,{waitUntil:p=>pending.push(p)});
   const nextBody=await next.json();result.revision={script:revised,status:next.status,body:nextBody,ms:Date.now()-revisionStarted};
   assert.equal(next.status,200,'采用示范后不能出现教练冲突或报告错误');
   assert.equal(nextBody.report.revision_check?.status,'resolved','示范必须解决它自己指出的缺口');
   assert.equal(nextBody.report.verdict,'passed','单一缺口的校准样本采用有效示范后应可用');
  }
  result.ok=true;
 }catch(error){result.ok=false;result.error=error.message;}
 await Promise.allSettled(pending);result.ms=Date.now()-started;results.push(result);
 console.log(JSON.stringify({id:f.id,ok:result.ok,status:result.status,verdict:result.body?.report?.verdict,revisedVerdict:result.revision?.body?.report?.verdict,ms:result.ms,error:result.error}));
}
for(let i=0;i<fixtures.length;i+=3){
 await Promise.all(fixtures.slice(i,i+3).map(run));
 await writeFile(output,JSON.stringify({at:new Date().toISOString(),results},null,2));
}
if(results.some(r=>!r.ok))process.exitCode=1;
