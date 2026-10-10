import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coachJobClass} from '../worker/coach-jobs.js';

// Transactions use isolated snapshots: a failed write cannot appear committed.
function state() {
  let values = new Map(), queue = Promise.resolve();
  const ctx = {writes:0, failState:null, retryNext:false, alarm:null, waitUntil(p){p.catch(()=>{});}};
  ctx.storage = {
    async get(key){return structuredClone(values.get(key));},
    async put(key,value){values.set(key,structuredClone(value));ctx.writes++;},
    async setAlarm(at){ctx.alarm=at;}, async deleteAll(){values.clear();},
    transaction(fn){
      const run=async commit => {
        const draft=new Map([...values].map(([key,value])=>[key,structuredClone(value)]));
        let alarm=ctx.alarm,writes=0;
        const result=await fn({
          async get(key){return structuredClone(draft.get(key));},
          async put(key,value){
            if(ctx.failState===value.state)throw new Error('PRIVATE_STORAGE_ERROR');
            draft.set(key,structuredClone(value));writes++;
          },async setAlarm(at){alarm=at;}
        });
        if(commit){values=draft;ctx.alarm=alarm;ctx.writes+=writes;}
        return result;
      };
      const operation=queue.then(async()=>{if(ctx.retryNext){ctx.retryNext=false;await run(false);}return run(true);});
      queue=operation.catch(()=>{});return operation;
    }
  };
  return ctx;
}
const put=input=>new Request('https://internal/task',{method:'PUT',body:JSON.stringify(input)});
const get=()=>new Request('https://internal/task');
const input=()=>({id:crypto.randomUUID(),owner:'PRIVATE_OWNER',ipHash:'PRIVATE_IP_HASH',
  payload:{script:'PRIVATE_LEARNER_SCRIPT',revision:{script:'PRIVATE_PREVIOUS_SCRIPT'},voteGap:'far'}});
const environment={ACCESS_CODE:'PRIVATE_ACCESS_CODE'};
const defaults={digest:async()=> 'PRIVATE_PAYLOAD_FINGERPRINT',authorize:async()=>true,rateLimit:async()=>null,
  serviceVersion:'2026-10-09-diagnostics-1',generate:async()=>({report:{verdict:'passed',private:'PRIVATE_REPORT'}})};
const realLog=console.log, realNow=Date.now;
const logs=[]; let now=1000;
console.log=value=>logs.push(structuredClone(value));Date.now=()=>now;
const forJob=id=>logs.filter(item=>item.jobId===id);
try {
  // Admission retries, callback retries, query traffic and repeated alarms do
  // not produce duplicate lifecycle events or new diagnostic storage writes.
  {
    const ctx=state(),data=input();ctx.retryNext=true;
    let calls=0;
    const Job=coachJobClass({...defaults,generate:async()=>{calls++;now=1900;return {report:{verdict:'passed'}};}});
    const job=new Job(ctx,environment);
    await Promise.all([job.fetch(put(data)),job.fetch(put(data))]);
    assert.deepEqual(forJob(data.id).map(item=>item.lifecycle),['admitted']);
    assert.equal(ctx.writes,1,'logging does not add a persistence write');
    now=1250;await job.alarm();
    const finished=forJob(data.id);
    assert.deepEqual(finished.map(item=>item.lifecycle),['admitted','started','terminal']);
    assert.deepEqual(finished.map(item=>item.state),['queued','running','done']);
    assert.deepEqual(finished.map(item=>item.reason),['accepted','execution_started','completed']);
    assert.equal(finished[2].queueMs,250);assert.equal(finished[2].executionMs,650);assert.equal(finished[2].totalMs,900);
    assert.equal(finished[2].status,200);assert.equal(finished[2].phase,'reviewing');
    assert.equal(finished[2].serviceVersion,defaults.serviceVersion);
    const writes=ctx.writes;
    for(let i=0;i<20;i++){assert.equal((await job.fetch(get())).status,200);await job.fetch(put(data));}
    await new Job(ctx,environment).alarm();
    assert.equal(forJob(data.id).length,3);assert.equal(ctx.writes,writes);assert.equal(calls,1);
    const saved=await ctx.storage.get('job');assert.equal(saved.payload,undefined);assert.equal(saved.ipHash,undefined);
  }
  for(const kind of ['revoked','rate_limit','admission','generation','recovery']) {
    now=2000;
    const ctx=state(),data=input();let calls=0;
    const Job=coachJobClass({...defaults,authorize:async()=>kind!=='revoked',
      rateLimit:async()=>kind==='rate_limit'?{status:429,message:'PRIVATE_LIMIT_ERROR'}:
        kind==='admission'?{status:503,message:'PRIVATE_LIMIT_ERROR'}:null,
      generate:async(_payload,_env,_ctx,_deadline,setPhase)=>{
        calls++;if(kind==='recovery')await setPhase('recovering');now=2500;
        throw Object.assign(new Error('PRIVATE_PROVIDER_ERROR'),{status:502,publicMessage:'safe failure'});
      }});
    const job=new Job(ctx,environment);await job.fetch(put(data));now=2100;await job.alarm();
    const response=await job.fetch(get());assert.equal(response.status,200,'HTTP success is not a grading success');
    assert.equal((await response.json()).state,'failed');
    const terminal=forJob(data.id).filter(item=>item.lifecycle==='terminal');assert.equal(terminal.length,1);
    assert.equal(terminal[0].state,'failed');
    assert.equal(terminal[0].phase,{revoked:'authorizing',rate_limit:'rate_limit',admission:'rate_limit',generation:'reviewing',recovery:'recovering'}[kind]);
    assert.equal(terminal[0].reason,{revoked:'access_revoked',rate_limit:'rate_limited',admission:'admission_failed',generation:'generation_failed',recovery:'generation_failed'}[kind]);
    assert.equal(terminal[0].status,{revoked:401,rate_limit:429,admission:503,generation:502,recovery:502}[kind]);
    assert.equal(calls,['generation','recovery'].includes(kind)?1:0);
    assert.equal(terminal[0].queueMs,100);
  }
  // A host restart reports its saved running phase and start time and never
  // charges for a second generation. Legacy tasks have unknown, not zero, time.
  for(const legacy of [false,true]) {
    const ctx=state(),data=input();let calls=0;
    const Job=coachJobClass({...defaults,generate:async()=>{calls++;return {};}});
    now=4000;
    await ctx.storage.put('job',{...data,state:'running',phase:'checking_advice',expiresAt:9000,
      ...(legacy?{}:{createdAt:3000,startedAt:3200})});
    const job=new Job(ctx,environment);await job.alarm();await job.alarm();
    const events=forJob(data.id);assert.equal(events.length,1);assert.equal(events[0].lifecycle,'terminal');
    assert.equal(events[0].reason,'interrupted');assert.equal(events[0].phase,'checking_advice');assert.equal(events[0].state,'failed');
    assert.equal(events[0].queueMs,legacy?null:200);assert.equal(events[0].executionMs,legacy?null:800);
    assert.equal(events[0].totalMs,legacy?null:1000);assert.equal(calls,0);
  }
  // Result write failure cannot inflate success. A later alarm settles the
  // persisted running task as interrupted without generating again.
  {
    const ctx=state(),data=input();let calls=0;
    const Job=coachJobClass({...defaults,generate:async()=>{calls++;return {report:{verdict:'passed'}};}});
    const job=new Job(ctx,environment);await job.fetch(put(data));ctx.failState='done';
    await assert.rejects(job.alarm(),/PRIVATE_STORAGE_ERROR/);
    assert.equal((await ctx.storage.get('job')).state,'running');
    let events=forJob(data.id);assert.equal(events.some(item=>item.lifecycle==='terminal'),false);
    assert.equal(events.at(-1).lifecycle,'persistence_failed');assert.equal(events.at(-1).reason,'result_storage_failed');
    assert.equal(events.at(-1).phase,'saving_result');assert.equal(events.at(-1).state,'running');
    ctx.failState=null;await new Job(ctx,environment).alarm();
    events=forJob(data.id);assert.equal(events.filter(item=>item.lifecycle==='terminal').length,1);
    assert.equal(events.at(-1).state,'failed');assert.equal(events.at(-1).reason,'interrupted');assert.equal(calls,1);
  }
  for(const failState of ['queued','running']) {
    const ctx=state(),data=input();let calls=0;
    const Job=coachJobClass({...defaults,generate:async()=>{calls++;return {};}}),job=new Job(ctx,environment);
    if(failState==='running')await job.fetch(put(data));
    ctx.failState=failState;
    await assert.rejects(failState==='queued'?job.fetch(put(data)):job.alarm(),/PRIVATE_STORAGE_ERROR/);
    const events=forJob(data.id);assert.equal(events.at(-1).lifecycle,'persistence_failed');
    assert.equal(events.at(-1).reason,failState==='queued'?'admission_storage_failed':'start_storage_failed');
    assert.equal(events.some(item=>item.lifecycle==='started'||item.lifecycle==='terminal'),false);assert.equal(calls,0);
  }
  // Overall timeout preserves the stage where waiting actually stopped.
  {
    const source=readFileSync(new URL('../worker/coach-jobs.js',import.meta.url),'utf8').replace('JOB_RUN_MS = 150000','JOB_RUN_MS = 15');
    const short=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const ctx=state(),data=input();
    const Job=short.coachJobClass({...defaults,generate:async(_a,_b,_c,_d,setPhase)=>{await setPhase('recovering');return new Promise(()=>{});}});
    const job=new Job(ctx,environment);await job.fetch(put(data));await job.alarm();
    const terminal=forJob(data.id).at(-1);assert.equal(terminal.reason,'generation_timeout');assert.equal(terminal.phase,'recovering');assert.equal(terminal.status,504);
  }
  // Untrusted IDs and diagnostic dependencies cannot escape the allowlist or
  // break delivery; private data must not appear even on storage/provider errors.
  {
    const ctx=state(),data={...input(),id:'PRIVATE_MALFORMED_ID'};
    const Job=coachJobClass({...defaults,serviceVersion:'PRIVATE_VERSION\nSECRET'}),job=new Job(ctx,environment);
    await job.fetch(put(data));await job.alarm();
    assert.equal(logs.at(-1).jobId,null);assert.equal(logs.at(-1).serviceVersion,null);
    const noLogs=state(),plain=new Job(noLogs,environment);
    console.log=()=>{throw new Error('logging unavailable');};
    await plain.fetch(put(input()));await plain.alarm();assert.equal((await noLogs.storage.get('job')).state,'done');
    console.log=value=>logs.push(structuredClone(value));
  }
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_/,'logs never include content, identity, codes, fingerprints or raw errors');
  const allowed=['event','schemaVersion','lifecycle','serviceVersion','jobId','state','phase','reason','status','queueMs','executionMs','totalMs'].sort();
  for(const event of logs){assert.equal(typeof event,'object');assert.deepEqual(Object.keys(event).sort(),allowed);}
} finally {console.log=realLog;Date.now=realNow;}
console.log('PASS durable job lifecycle evidence: admission dedupe, real terminal outcome, timing, restart, storage failure, quiet polling and privacy');
