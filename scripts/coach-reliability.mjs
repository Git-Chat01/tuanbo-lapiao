// Read-only operational report. Uses the existing Wrangler login; never saves
// raw events, credentials, scripts, reports or provider responses.
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const WORKER='tuanbo-lapiao-coach';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION=/^[a-z0-9._-]{1,80}$/i;
const PHASES=new Set(['queued','authorizing','rate_limit','reviewing','recovering','checking_advice','saving_result']);
const REASONS=new Set(['accepted','execution_started','completed','access_revoked','rate_limited','admission_failed','generation_timeout','generation_failed','interrupted','result_storage_failed','start_storage_failed','admission_storage_failed']);
const LIFE=new Set(['admitted','started','terminal','persistence_failed']);
const NOTES=['仅统计留存日志中观察到的后台任务，按任务和服务版本去重；不是浏览器成功取回率，也不是严格审计账本。',
 '窗口边界、日志延迟/丢失、采样或配额可能造成记录缺失。无终态记为未知，不当作成功或失败；没有数据不能认定零故障。'];
const duration=x=>Number.isFinite(x)&&x>=0?x:null;
export function projectEvent(raw){
 let x=raw?.source??raw;
 if(typeof x==='string'){try{x=JSON.parse(x);}catch{return null;}}
 if(x?.event!=='coach_job'||x.schemaVersion!==1||!UUID.test(x.jobId||'')||!LIFE.has(x.lifecycle))return null;
 const state=['queued','running','done','failed'].includes(x.state)?x.state:null;
 const status=Number.isInteger(x.status)&&x.status>=100&&x.status<=599?x.status:null;
 if(!state||!status)return null;
 if(x.lifecycle==='terminal'&&!((state==='done'&&status===200)||(state==='failed'&&status>=400)))return null;
 return {jobId:x.jobId,serviceVersion:typeof x.serviceVersion==='string'&&VERSION.test(x.serviceVersion)?x.serviceVersion:'unknown',
  lifecycle:x.lifecycle,state,status,phase:PHASES.has(x.phase)?x.phase:'unknown',reason:REASONS.has(x.reason)?x.reason:'unknown',
  queueMs:duration(x.queueMs),executionMs:duration(x.executionMs),totalMs:duration(x.totalMs),timestamp:duration(raw?.timestamp)??0};
}
export function summarizeEvents(rawEvents,{complete=true,serviceVersion=null}={}){
 const jobs=new Map();let ignored=0;
 for(const raw of rawEvents){const x=projectEvent(raw);if(!x){ignored++;continue;}if(serviceVersion&&x.serviceVersion!==serviceVersion)continue;
  const key=x.serviceVersion+':'+x.jobId;let job=jobs.get(key);if(!job){job={admitted:false,started:false,terminal:null,conflict:false,persistence:false};jobs.set(key,job);}
  if(x.lifecycle==='admitted')job.admitted=true;
  if(x.lifecycle==='started')job.started=true;
  if(x.lifecycle==='persistence_failed')job.persistence=true;
  if(x.lifecycle==='terminal'){
   if(job.terminal&&[ 'state','status','reason' ].some(k=>job.terminal[k]!==x[k]))job.conflict=true;
   if(!job.terminal||x.timestamp>=job.terminal.timestamp)job.terminal=x;
  }
 }
 let succeeded=0,failed=0,unknown=0,conflicting=0,withoutAdmission=0,persistence=0;const durations=[],failures={};
 for(const job of jobs.values()){
  if(job.persistence)persistence++;
  if(job.conflict){conflicting++;unknown++;continue;}
  if(!job.terminal){unknown++;continue;}
  if(!job.admitted)withoutAdmission++;
  const x=job.terminal;
  if(x.state==='done'){succeeded++;if(x.totalMs!==null)durations.push(x.totalMs);}
  else {failed++;const key=x.phase+'/'+x.reason;failures[key]=(failures[key]||0)+1;}
 }
 durations.sort((a,b)=>a-b);const percentile=p=>durations.length?durations[Math.max(0,Math.ceil(durations.length*p)-1)]:null;
 const terminal=succeeded+failed;
 return {status:complete?(jobs.size?'observed':'no_data'):'incomplete',complete,observedJobs:jobs.size,observedTerminal:terminal,succeeded,failed,unknown,
  conflictingTerminal:conflicting,terminalWithoutAdmission:withoutAdmission,persistenceFailureJobs:persistence,ignoredEvents:ignored,
  observedTerminalSuccessRate:terminal?succeeded/terminal:null,
  successTiming:{count:durations.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:percentile(1),over60s:durations.filter(x=>x>60000).length},
  failures,notes:NOTES};
}
export async function queryReliability({request,accountId,hours=24,serviceVersion=null,now=Date.now(),pageSize=500,maxPages=20}){
 if(!/^[a-f0-9]{32}$/i.test(accountId)||!Number.isFinite(hours)||hours<1||hours>168||serviceVersion&&!VERSION.test(serviceVersion))throw Error('Invalid diagnostic options');
 const timeframe={from:now-hours*3600000,to:now},base='/accounts/'+accountId+'/workers';
 const settings=await request(base+'/scripts/'+WORKER+'/settings');
 const obs=settings.result?.observability,enabled=obs?.logs?.enabled??obs?.enabled;
 if(!enabled||obs.logs?.persist===false)return {status:'unavailable',reason:'historical_logging_not_enabled',timeframe,notes:NOTES};
 const filters=[{key:'$metadata.service',operation:'eq',type:'string',value:WORKER},{key:'event',operation:'eq',type:'string',value:'coach_job'}];
 if(serviceVersion)filters.push({key:'serviceVersion',operation:'eq',type:'string',value:serviceVersion});
 const events=[],seenCursors=new Set();let offset,complete=false,reportedCount=null;
 for(let page=0;page<maxPages;page++){
  const response=await request(base+'/observability/telemetry/query',{queryId:'coach-reliability',timeframe,dry:true,view:'events',limit:pageSize,
   parameters:{filterCombination:'and',filters},...(offset?{offset,offsetDirection:'next'}:{})});
  const container=response.result?.events;if(!Array.isArray(container?.events))throw Error('Unexpected telemetry format');
  if(Number.isFinite(container.count))reportedCount=Math.max(reportedCount??0,container.count);
  const rows=container.events;
  // Keep only the permitted projection, not arbitrary raw telemetry.
  for(const row of rows){const projected=projectEvent(row);events.push(projected?{...projected,event:'coach_job',schemaVersion:1}:null);}
  if(rows.length<pageSize){complete=reportedCount===null||reportedCount<=events.length;break;}
  const next=rows.at(-1)?.$metadata?.id;
  if(typeof next!=='string'||!next||seenCursors.has(next))break;
  seenCursors.add(next);offset=next;
 }
 const sampling=obs.logs?.head_sampling_rate??obs.head_sampling_rate??1;
 return {...summarizeEvents(events,{complete,serviceVersion}),timeframe,samplingRate:sampling,reportedEventCount:reportedCount,
  ...(sampling<1?{samplingWarning:'日志采用采样，结果仅描述被采样到的任务，不能作为总体成功率。'}:{})};
}
export function authHeaders(exec=execFileSync){
 try {
  const result=JSON.parse(exec(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:20000}));
  if(typeof result.token==='string'&&result.token)return {Authorization:'Bearer '+result.token};
  if(result.type==='api_key'&&typeof result.key==='string'&&typeof result.email==='string')return {'X-Auth-Key':result.key,'X-Auth-Email':result.email};
 }catch{}
 throw Error('Wrangler authentication unavailable; use the existing Cloudflare login.');
}
async function main(){
 const args=process.argv.slice(2);if(args.includes('--help')){console.log('node scripts/coach-reliability.mjs [--hours 24] [--service-version VERSION]\nRead-only Cloudflare task outcomes. No model calls.');return;}
 let hours=24,serviceVersion=null;
 for(let i=0;i<args.length;i++){if(args[i]==='--hours')hours=Number(args[++i]);else if(args[i]==='--service-version')serviceVersion=args[++i];else throw Error('Invalid options');}
 if(!Number.isFinite(hours)||hours<1||hours>168||serviceVersion!==null&&(!serviceVersion||!VERSION.test(serviceVersion)))throw Error('Invalid diagnostic options');
 const headers={...authHeaders(),'Content-Type':'application/json'};
 const request=async(path,body)=>{
  if(!/^\/(accounts(?:\/|$))/.test(path))throw Error('Invalid Cloudflare API path');
  let response,data;
  try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});data=await response.json();}catch{throw Error('Cloudflare diagnostic request unavailable');}
  if(!response.ok||data.success===false||data.errors?.length)throw Error('Cloudflare diagnostic API failed (HTTP '+response.status+'); check login and observability permissions.');
  return data;
 };
 let accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
 if(!accountId){const accounts=await request('/accounts');if(!Array.isArray(accounts.result)||accounts.result.length!==1)throw Error('Set CLOUDFLARE_ACCOUNT_ID to the project account.');accountId=accounts.result[0].id;}
 const summary=await queryReliability({request,accountId,hours,serviceVersion});console.log(JSON.stringify(summary,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(error=>{console.error(error.message);process.exitCode=1;});}
