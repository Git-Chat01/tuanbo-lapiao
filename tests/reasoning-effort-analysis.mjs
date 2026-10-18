import {readFile,readdir,writeFile} from 'node:fs/promises';
import {reasoningEffortFixtures} from './reasoning-effort-fixtures.mjs';
const dir=new URL('tmp_results/reasoning-effort/',import.meta.url);
const label=process.argv.find(x=>x.startsWith('--label='))?.slice(8)||'abc';
if(!/^[-a-z0-9]+$/.test(label))throw Error('Invalid label');
const files=(await readdir(dir)).filter(n=>n.startsWith(label+'-grade-')&&n.endsWith('.json'));
const results=await Promise.all(files.map(async file=>({file,...JSON.parse(await readFile(new URL(file,dir),'utf8'))})));
const timing=values=>{
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y),p=q=>a.length?a[Math.ceil(a.length*q)-1]:null;
  return {count:a.length,meanMs:a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null,p50Ms:p(.5),p95Ms:p(.95),maxMs:p(1),over60s:a.filter(x=>x>60000).length};
};
const tokens=values=>{
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y),p=q=>a.length?a[Math.ceil(a.length*q)-1]:null;
  return {count:a.length,mean:a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null,p50:p(.5),p95:p(.95),max:p(1)};
};
function evaluate(result){
  const fixture=reasoningEffortFixtures.find(f=>f.id===result.fixture),report=result.initial?.body?.report;
  const received=result.initial?.status===200&&['passed','almost','off'].includes(report?.verdict),issues=[];
  if(!received)issues.push('no_result');
  else{
    if((report.verdict==='passed')!==fixture.passed)issues.push(fixture.passed?'false_rejection':'false_acceptance');
    if((report.practice_status==='awaiting_response')!==Boolean(fixture.waiting))issues.push('waiting_mismatch');
    if(fixture.evaluation.expectedVerdict&&report.verdict!==fixture.evaluation.expectedVerdict)issues.push('verdict_mismatch');
    for(const [key,value] of Object.entries(fixture.evaluation.expectedCore||{})){
      const actual=report.structure_checks?.find(x=>x.key===key)?.status;
      if(value==='not-met'?!['partial','missing'].includes(actual):value!==actual)issues.push('core_'+key);
    }
  }
  return {...result,received,issues,report,decisionCorrect:received&&!issues.some(x=>!x.startsWith('core_'))};
}
const rows=results.map(evaluate),groups={};
for(const effort of ['low','high','max']){
  const a=rows.filter(r=>r.effort===effort),completed=a.filter(r=>r.received),byFixture={};
  for(const r of completed){(byFixture[r.fixture]??=[]).push(r.report.verdict==='passed'?'passed':r.report.practice_status==='awaiting_response'?'waiting':'needs_revision');}
  const calls=a.flatMap(r=>r.traces||[]),main=calls.filter(c=>c.effort===effort);
  groups[effort]={count:a.length,received:completed.length,decisionCorrect:a.filter(r=>r.decisionCorrect).length,
    expectedCoreAndDecisionCorrect:a.filter(r=>!r.issues.length).length,
    falseReject:a.filter(r=>r.issues.includes('false_rejection')).length,falseAccept:a.filter(r=>r.issues.includes('false_acceptance')).length,
    focusedRecovery:completed.filter(r=>r.report.review_mode==='focused').length,
    fullReport:completed.filter(r=>r.report.review_mode!=='focused').length,
    sameDraftDecisionChanges:Object.entries(byFixture).filter(([,v])=>new Set(v).size>1).map(([id])=>id),
    taskTiming:timing(a.map(r=>r.initial?.ms||r.clientMs)),modelCalls:calls.length,
    primaryCalls:main.length,primaryUnfinished:main.filter(c=>!c.answer).length,primaryRepairCalls:main.filter(c=>c.repair).length,
    reasoningTokens:tokens(main.map(c=>c.usage?.completion_tokens_details?.reasoning_tokens)),
    issues:a.filter(r=>r.issues.length).map(r=>({fixture:r.fixture,round:r.round,issues:r.issues,reason:r.report?.verdict_reason,file:r.file}))};
}
const summary={at:new Date().toISOString(),label,total:rows.length,groups};
if(process.argv.includes('--save'))await writeFile(new URL(label+'-analysis.json',dir),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
