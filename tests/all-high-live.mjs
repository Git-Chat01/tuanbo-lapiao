import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {revisionFidelityLiveFixtures} from './revision-fidelity-live-fixtures.mjs';
if(!process.argv.includes('--live'))throw Error('Pass --live for fixed synthetic model tests');
const option=(name,fallback)=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const mode=option('mode','preserve'),rounds=Number(option('rounds','1')),concurrency=Number(option('concurrency','2')),
  label=option('label','all-high'),only=option('only','').split(',').filter(Boolean);
if(!['preserve','grade','flow','recovery','recovery-window'].includes(mode)||![1,2,3].includes(rounds)||![1,2,3].includes(concurrency)||!/^[-a-z0-9]+$/.test(label))throw Error('Invalid test options');
const defaults=mode==='preserve'?revisionFidelityLiveFixtures.map(x=>x.id):mode==='flow'?['preserve-capability-boundary','specific-content-no-action']:['specific-content-invitation','borrow-pressure','question-only','empty-comment-reward'];
const fixtures=only.length?only:defaults;
const dir=new URL('tmp_results/all-high-fidelity/',import.meta.url);await mkdir(dir,{recursive:true});
const config=JSON.parse(await readFile(new URL('wrangler.json',dir),'utf8'));
const jobs=[];for(let round=1;round<=rounds;round++)for(const fixture of fixtures)jobs.push({mode,fixture,round});
const results=[];let index=0;
async function consume(){while(index<jobs.length){const job=jobs[index++],started=Date.now();let result;
  try{const reply=await fetch('http://127.0.0.1:8794/__synthetic/high',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...job,token:config.vars.EVALUATION_TOKEN}),signal:AbortSignal.timeout(mode==='flow'?310000:110000)});
    result={...job,httpStatus:reply.status,...await reply.json()};
  }catch{result={...job,ok:false,error:'preview_request_failed'};}
  result.clientMs=Date.now()-started;
  await writeFile(new URL(`${label}-${mode}-${job.fixture}-${job.round}.json`,dir),JSON.stringify(result,null,2));
  const summary={...job,ok:result.ok,allHigh:result.allHigh,ms:result.ms||result.clientMs,calls:result.traces?.length,
    accepted:result.accepted,expected:result.expected,originalVerdict:result.initial?.body?.report?.verdict,
    completeStatus:result.complete?.body?.report?.revision_plan?.status,recheck:result.recheck?.body?.report?.verdict,error:result.error};
  results.push(summary);console.log(JSON.stringify({finished:results.length,total:jobs.length,...summary}));
}}
await Promise.all(Array.from({length:concurrency},consume));
await writeFile(new URL(`${label}-${mode}-summary.json`,dir),JSON.stringify({at:new Date().toISOString(),results},null,2));
if(results.some(x=>!x.ok||!x.allHigh))process.exitCode=1;
