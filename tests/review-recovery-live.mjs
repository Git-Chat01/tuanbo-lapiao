import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import worker,{CoachRateLimiter,validateRecoveredReview} from '../worker/index.js';
import {parseRecoveryAssessment} from '../worker/review-recovery.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {noviceCoachingFixtures} from './novice-coaching-fixtures.mjs';
if(!process.argv.includes('--live'))throw Error('Use --live for synthetic model recovery checks; production data is never accessed.');
const vars=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const key=vars.split(/\r?\n/u).find(line=>line.startsWith('DEEPSEEK_API_KEY='))?.slice(17).trim().replace(/^['"]|['"]$/gu,'');
if(!key)throw Error('Configured model key missing');
const chosen=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',') || ['need-only','specific-content-invitation','specific-content-no-action','invented-loyalty','question-only','budget-respected','borrow-pressure','empty-comment-reward','preserve-capability-boundary'];
const fixtures=noviceCoachingFixtures.filter(item=>chosen.includes(item.id));
const originalFetch=globalThis.fetch;let calls=0;const traces=[];
globalThis.fetch=async(url,options)=>{
 const input=JSON.parse(JSON.parse(options.body).messages[1].content);
 if(input.task!=='recover_current_review')return Response.json({choices:[{finish_reason:'stop',message:{content:'{"broken":true}'}}]});
 calls++;const response=await originalFetch(url,options);
 const data=await response.clone().json();const trace={script:input.currentScript,raw:data.choices?.[0]?.message?.content};
 try{validateRecoveredReview(parseRecoveryAssessment(JSON.parse(trace.raw),{script:input.currentScript,voteGap:input.voteGap,scenario:input.scenario}),{script:input.currentScript,voteGap:input.voteGap,scenario:input.scenario});}
 catch(error){trace.validationIssue=error.recoveryIssue||error.message;}
 traces.push(trace);return response;
};
const results=[];await mkdir(new URL('tmp_results/recovery',import.meta.url),{recursive:true});
async function run(fixture){
 const entries=new Map(),pending=[];const env={ACCESS_CODE:'synthetic-recovery',DEEPSEEK_API_KEY:key,COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),CASES:{async list(){return {keys:[],list_complete:true};},async get(k,type){const value=entries.get(k);return value==null?null:type==='json'?JSON.parse(value):value;},async put(k,v){entries.set(k,v);},async delete(k){entries.delete(k);}}};
 const start=Date.now();const result={id:fixture.id};
 try {
  const response=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:'far',script:fixture.script,scenario:NOVICE_SCENARIO})}),env,{waitUntil:p=>pending.push(p)});
  result.status=response.status;result.body=await response.json();
  assert.equal(response.status,200,result.body.message);const report=result.body.report;
  assert.equal(report.verdict==='passed',fixture.passed,report.verdict_reason);
  assert.equal(report.practice_status==='awaiting_response',!!fixture.waiting);
  if(fixture.risk)assert.equal(report.verdict,'off');
  assert.equal(report.review_mode,'focused');assert.ok(report.report_id);
  assert.equal(report.coaching.mode,'guidance');assert.equal(report.coaching.example,'');
  assert.ok(report.coaching.action);assert.ok(report.coaching.why);assert.deepEqual(report.line_reviews,[]);
  if(fixture.forbiddenSuggestion)assert.doesNotMatch(report.coaching.action,new RegExp(fixture.forbiddenSuggestion,'u'));
  result.ok=true;
 } catch(error){result.ok=false;result.error=error.message;}
 await Promise.allSettled(pending);result.ms=Date.now()-start;results.push(result);
 console.log(JSON.stringify({id:result.id,ok:result.ok,status:result.status,verdict:result.body?.report?.verdict,ms:result.ms,error:result.error}));
}
try {for(let i=0;i<fixtures.length;i+=3)await Promise.all(fixtures.slice(i,i+3).map(run));}
finally {globalThis.fetch=originalFetch;await writeFile(new URL('tmp_results/recovery/live.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),calls,results,traces},null,2));}
if(results.some(result=>!result.ok))process.exitCode=1;
