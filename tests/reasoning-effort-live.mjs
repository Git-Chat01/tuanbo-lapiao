// Fixed synthetic A/B/C comparison through an isolated remote preview. No local secrets.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {reasoningEffortFixtures} from './reasoning-effort-fixtures.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live to use the configured model for synthetic evaluation');
const option=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const base=new URL(option('base','http://127.0.0.1:8793'));
if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('Loopback preview required');
const config=JSON.parse(await readFile(new URL('tmp_results/reasoning-effort/wrangler.json',import.meta.url),'utf8'));
const token=config.vars.EVALUATION_TOKEN;
const rounds=Number(option('rounds','2')),concurrency=Number(option('concurrency','2'));
const efforts=option('efforts','low,high,max').split(','),mode=option('mode','grade');
const only=option('only','').split(',').filter(Boolean),label=option('label','comparison');
if(![1,2,3].includes(rounds)||![1,2,3].includes(concurrency)||efforts.some(x=>!['low','high','max'].includes(x))||!['grade','flow'].includes(mode)||!/^[-a-z0-9]+$/.test(label))throw Error('Invalid evaluation options');
const fixtures=reasoningEffortFixtures.filter(f=>!only.length||only.includes(f.id));
if(!fixtures.length)throw Error('No matching fixtures');
const dir=new URL('tmp_results/reasoning-effort/',import.meta.url);
await mkdir(dir,{recursive:true});
const jobs=[];
// Rotate order by case and repeat so a single effort does not always get the cold start.
for(let round=1;round<=rounds;round++)for(let i=0;i<fixtures.length;i++)for(let j=0;j<efforts.length;j++){
  jobs.push({fixture:fixtures[i].id,round,effort:efforts[(j+i+round-1)%efforts.length],mode});
}
let next=0,finished=0;
const results=[];
async function consume(){
  while(next<jobs.length){
    const job=jobs[next++],startedAt=Date.now();let result;
    try{
      const response=await fetch(new URL('/__synthetic/effort',base),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...job,token}),signal:AbortSignal.timeout(mode==='flow'?310000:105000)});
      result={...job,httpStatus:response.status,...await response.json()};
    }catch(error){result={...job,httpStatus:0,error:['TimeoutError','AbortError'].includes(error?.name)?error.name:'preview_request_failed'};}
    result.clientMs=Date.now()-startedAt;
    const report=result.initial?.body?.report,fixture=fixtures.find(f=>f.id===job.fixture);
    result.completed=result.initial?.status===200&&['passed','almost','off'].includes(report?.verdict);
    result.correct=result.completed&&Boolean(report.verdict==='passed')===fixture.passed&&Boolean(report.practice_status==='awaiting_response')===Boolean(fixture.waiting)&&(!fixture.risk||report.verdict==='off');
    // Automatic flow acceptance is separate from human review of factual fidelity.
    if(mode==='flow')result.flowAccepted=result.correct&&(fixture.passed||fixture.waiting||(
      result.complete?.status===200&&result.complete.body?.report?.revision_plan?.status==='ready'&&
      result.complete.body?.report?.ready_revision?.report?.verdict==='passed'&&
      result.recheck?.status===200&&result.recheck.body?.report?.verdict==='passed'));
    const filename=`${label}-${mode}-${job.fixture}-${job.effort}-${job.round}.json`;
    await writeFile(new URL(filename,dir),JSON.stringify(result,null,2));
    const compact={fixture:job.fixture,effort:job.effort,round:job.round,correct:result.correct,status:result.initial?.status||result.httpStatus,
      verdict:report?.verdict,waiting:report?.practice_status,reviewMode:report?.review_mode||'full',ms:result.initial?.ms||result.clientMs,
      calls:result.traces?.length,completeStatus:result.complete?.body?.report?.revision_plan?.status,
      recheckVerdict:result.recheck?.body?.report?.verdict,flowAccepted:result.flowAccepted,file:filename};
    results.push(compact);finished++;console.log(JSON.stringify({finished,total:jobs.length,...compact}));
  }
}
await Promise.all(Array.from({length:concurrency},consume));
await writeFile(new URL(`${label}-summary.json`,dir),JSON.stringify({at:new Date().toISOString(),mode,rounds,efforts,results},null,2));
console.log(JSON.stringify({complete:true,count:results.length,correct:results.filter(x=>x.correct).length}));
