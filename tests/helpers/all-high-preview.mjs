// Isolated remote preview only. No production KV/DO bindings or local secret files.
import {AsyncLocalStorage} from 'node:async_hooks';
import worker,{CoachRateLimiter,generateCompleteRevisionReview,validateRecoveredReview} from '../../worker/index.js';
import {NOVICE_SCENARIO} from '../../worker/current-review.js';
import {checkRevisionPreservation} from '../../worker/complete-revision.js';
import {callReviewRecovery,RECOVERY_MAX_WINDOW_MS} from '../../worker/review-recovery.js';
import {createRateLimiterBinding} from './rate-limiter.mjs';
import {reasoningEffortFixtures} from '../reasoning-effort-fixtures.mjs';
import {revisionFidelityLiveFixtures} from '../revision-fidelity-live-fixtures.mjs';
const context=new AsyncLocalStorage(),realFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(url,init)=>{
  const run=context.getStore();
  if(!run||String(url)!=='https://api.deepseek.com/chat/completions')throw Error('Unexpected synthetic upstream');
  const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content);
  if(body.thinking?.type!=='enabled'||body.reasoning_effort!=='high')throw Error('Non-high production model request');
  const trace={stage:run.stage,task:input.task||'grade',effort:body.reasoning_effort,thinking:body.thinking.type,
    maxTokens:body.max_tokens,model:body.model,repair:body.messages.length>2};
  run.traces.push(trace);const started=Date.now();
  try{
    const response=await realFetch(url,init);trace.status=response.status;
    const raw=await response.text();
    if(response.ok){const data=JSON.parse(raw);trace.finish=data.choices?.[0]?.finish_reason;trace.usage=data.usage;
      try{trace.answer=JSON.parse(data.choices?.[0]?.message?.content);}catch{trace.invalidJson=true;}}
    return new Response(raw,{status:response.status,headers:{'Content-Type':'application/json'}});
  }catch(error){trace.error=['TimeoutError','AbortError'].includes(error?.name)?error.name:'model_request_error';throw error;}
  finally{trace.ms=Date.now()-started;}
};
function environment(remote){
  const values=new Map();return {DEEPSEEK_API_KEY:remote.DEEPSEEK_API_KEY,ACCESS_CODE:'synthetic-high-'+crypto.randomUUID(),
    COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),CASES:{
      async get(k,type){const v=values.get(k);return v==null?null:type==='json'?JSON.parse(v):v;},
      async put(k,v){values.set(k,v);},async delete(k){values.delete(k);},async list(){return {keys:[],list_complete:true};}}};
}
const config={url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',reasoningEffort:'high',maxTokens:16000};
async function review(script,env,ctx){
  const started=Date.now(),reply=await worker.fetch(new Request('https://synthetic.test/api/coach',{method:'POST',
    headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.175'},
    body:JSON.stringify({accessCode:env.ACCESS_CODE,script,voteGap:'far',scenario:NOVICE_SCENARIO})}),env,ctx);
  return {status:reply.status,ms:Date.now()-started,body:await reply.json()};
}
export default {async fetch(request,remote){
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({synthetic:true,secretAvailable:Boolean(remote.DEEPSEEK_API_KEY)});
  if(request.method!=='POST'||url.pathname!=='/__synthetic/high')return new Response(null,{status:404});
  const text=await request.text();if(text.length>1024)return new Response(null,{status:413});
  let input;try{input=JSON.parse(text);}catch{return new Response(null,{status:400});}
  if(!remote.EVALUATION_TOKEN||input.token!==remote.EVALUATION_TOKEN)return new Response(null,{status:401});
  if(!['preserve','grade','flow','recovery','recovery-window'].includes(input.mode))return new Response(null,{status:400});
  const fixture=(input.mode==='preserve'?revisionFidelityLiveFixtures:reasoningEffortFixtures).find(x=>x.id===input.fixture);
  if(!fixture)return new Response(null,{status:400});
  const run={stage:input.mode,traces:[]};
  return context.run(run,async()=>{
    const started=Date.now(),env=environment(remote),pending=[],ctx={waitUntil:p=>pending.push(p)};
    const result={synthetic:true,mode:input.mode,fixture:fixture.id,traces:run.traces};
    try{
      if(input.mode==='preserve'){
        result.expected=fixture.expected;
        result.accepted=await checkRevisionPreservation(env,{...config,onRejected:value=>{result.rejected=value;}},
          {originalScript:fixture.source,revisedScript:fixture.script,scenario:NOVICE_SCENARIO,issues:fixture.issues||[]},Date.now()+40000);
        result.ok=result.accepted===fixture.expected;
      }else if(['recovery','recovery-window'].includes(input.mode)){
        // Exercise the same bounded extended window used after an early primary failure.
        const windowMs=input.mode==='recovery-window'?RECOVERY_MAX_WINDOW_MS:25000;
        const value=await callReviewRecovery(env,{...config,validateReport:validateRecoveredReview,recoveryWindowMs:windowMs},
          {script:fixture.script,voteGap:'far',scenario:NOVICE_SCENARIO,cases:[]},Date.now()+windowMs);
        result.report=value.report;result.ok=(value.report.verdict==='passed')===fixture.passed&&
          (value.report.practice_status==='awaiting_response')===Boolean(fixture.waiting)&&(!fixture.risk||value.report.verdict==='off');
      }else{
        run.stage='initial';result.initial=await review(fixture.script,env,ctx);
        const report=result.initial.body.report;
        result.ok=result.initial.status===200&&(report?.verdict==='passed')===fixture.passed&&
          (report?.practice_status==='awaiting_response')===Boolean(fixture.waiting)&&(!fixture.risk||report.verdict==='off');
        if(result.ok&&input.mode==='flow'&&!fixture.passed&&!fixture.waiting){
          run.stage='complete';const begin=Date.now();
          const value=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,script:fixture.script,voteGap:'far',scenario:NOVICE_SCENARIO,
            completeRevision:{reportId:report.report_id}},env,ctx);
          result.complete={ms:Date.now()-begin,body:value};
          const candidate=value.report?.ready_revision?.script;
          if(candidate){run.stage='recheck';result.recheck=await review(candidate,environment(remote),ctx);}
          result.ok=value.report?.revision_plan?.status==='ready'&&result.recheck?.status===200&&result.recheck.body.report?.verdict==='passed';
        }
      }
    }catch(error){result.ok=false;result.error=['TimeoutError','AbortError'].includes(error?.name)?error.name:'stage_unavailable';}
    await Promise.allSettled(pending);result.ms=Date.now()-started;
    result.allHigh=run.traces.every(x=>x.thinking==='enabled'&&x.effort==='high');
    return Response.json(result);
  });
}};
