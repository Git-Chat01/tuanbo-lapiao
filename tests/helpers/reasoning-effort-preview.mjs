// Remote preview only: fixed synthetic fixtures, inherited model secret, memory storage.
// Never deploy this entrypoint or bind production KV/DO resources to it.
import {AsyncLocalStorage} from 'node:async_hooks';
import worker, {CoachRateLimiter, generateCompleteRevisionReview} from '../../worker/index.js';
import {NOVICE_SCENARIO} from '../../worker/current-review.js';
import {createRateLimiterBinding} from './rate-limiter.mjs';
import {reasoningEffortFixtures} from '../reasoning-effort-fixtures.mjs';

const context = new AsyncLocalStorage();
const upstreamFetch = globalThis.fetch.bind(globalThis);
const efforts = new Set(['low', 'high', 'max']);
globalThis.fetch = async (url, init) => {
  const run = context.getStore();
  if (!run) throw Error('Synthetic evaluation context required');
  if (String(url) !== 'https://api.deepseek.com/chat/completions') throw Error('Unexpected evaluation upstream');
  const body = JSON.parse(init.body);
  if (body.thinking?.type === 'enabled') body.reasoning_effort = run.effort;
  let input = {}; try { input = JSON.parse(body.messages[1].content); } catch {}
  const trace = {stage:run.stage, task:input.task || (input.currentScript ? 'grade' : 'recovery'),
    effort:body.thinking?.type === 'enabled' ? body.reasoning_effort : 'disabled',
    repair:body.messages.length > 2, model:body.model, startedAt:Date.now()};
  run.traces.push(trace);
  try {
    const response = await upstreamFetch(url, {...init, body:JSON.stringify(body)});
    trace.status = response.status;
    // Consume exactly once, while retaining the production caller's deadline/abort signal.
    const raw = await response.text();
    if (response.ok) {
      const data = JSON.parse(raw);
      trace.finish = data.choices?.[0]?.finish_reason;
      trace.usage = data.usage;
      // Keep the answer for quality review, never the private reasoning trace or headers.
      try { trace.answer = JSON.parse(data.choices?.[0]?.message?.content); } catch { trace.invalidJson = true; }
    }
    return new Response(raw, {status:response.status, headers:{'Content-Type':'application/json'}});
  } catch (error) {
    trace.error = ['AbortError','TimeoutError'].includes(error?.name) ? error.name : 'upstream_error';
    throw error;
  } finally { trace.ms = Date.now() - trace.startedAt; }
};

function environment(cloudflareEnv) {
  const values = new Map();
  return {DEEPSEEK_API_KEY:cloudflareEnv.DEEPSEEK_API_KEY,
    ACCESS_CODE:'synthetic-effort-' + crypto.randomUUID(),
    COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),
    CASES:{async get(key,type){const value=values.get(key);return value==null?null:type==='json'?JSON.parse(value):value;},
      async put(key,value){values.set(key,value);},async delete(key){values.delete(key);},
      async list(){return {keys:[],list_complete:true};}}};
}
async function review(script, env, ctx) {
  const start=Date.now();
  const response=await worker.fetch(new Request('https://synthetic.test/api/coach', {
    method:'POST', headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.175'},
    body:JSON.stringify({accessCode:env.ACCESS_CODE,script,voteGap:'far',scenario:NOVICE_SCENARIO})}),env,ctx);
  return {status:response.status,ms:Date.now()-start,body:await response.json()};
}
export default {
  async fetch(request, cloudflareEnv) {
    const url=new URL(request.url);
    if (url.pathname === '/health') return Response.json({synthetic:true,secretAvailable:Boolean(cloudflareEnv.DEEPSEEK_API_KEY)});
    if (request.method !== 'POST' || url.pathname !== '/__synthetic/effort') return new Response(null,{status:404});
    const text=await request.text();
    if(text.length>1024)return new Response(null,{status:413});
    let input;try{input=JSON.parse(text);}catch{return new Response(null,{status:400});}
    if(!cloudflareEnv.EVALUATION_TOKEN || input.token!==cloudflareEnv.EVALUATION_TOKEN)return new Response(null,{status:401});
    const fixture=reasoningEffortFixtures.find(f=>f.id===input.fixture);
    if(!fixture||!efforts.has(input.effort)||!['grade','flow'].includes(input.mode))return new Response(null,{status:400});
    if(!cloudflareEnv.DEEPSEEK_API_KEY)return Response.json({error:'missing_model_secret'},{status:503});
    const run={effort:input.effort,traces:[],stage:'initial'};
    return context.run(run,async()=>{
      const env=environment(cloudflareEnv),pending=[],ctx={waitUntil:p=>pending.push(p)};
      const result={fixture:fixture.id,effort:input.effort,mode:input.mode,expectedPassed:fixture.passed,
        expectedWaiting:Boolean(fixture.waiting),synthetic:true,traces:run.traces,startedAt:Date.now()};
      result.initial=await review(fixture.script,env,ctx);
      if(input.mode==='flow' && result.initial.status===200 && !fixture.passed && !fixture.waiting){
        run.stage='complete';const start=Date.now();
        try{
          const body=await generateCompleteRevisionReview({accessCode:env.ACCESS_CODE,script:fixture.script,voteGap:'far',scenario:NOVICE_SCENARIO,
            completeRevision:{reportId:result.initial.body.report.report_id}},env,ctx);
          result.complete={status:200,ms:Date.now()-start,body};
          const script=body.report?.ready_revision?.script;
          if(script){
            // Fresh receipt/cache scope: independently rejudge exact delivered text.
            run.stage='recheck'; result.recheck=await review(script,environment(cloudflareEnv),ctx);
          }
        }catch(error){result.complete={status:Number(error?.status)||500,ms:Date.now()-start};}
      }
      await Promise.allSettled(pending);
      result.ms=Date.now()-result.startedAt;
      return Response.json(result);
    });
  },
};
