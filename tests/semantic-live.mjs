// Real model contrast-pair regression; no production data or KV access.
// node tests/semantic-live.mjs --live --suite=independent --label=before [--repeat=2] [--only=id,id]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { semanticFixtures } from "./semantic-fixtures.mjs";
import { independentFixtures } from "./independent-fixtures.mjs";
if(!process.argv.includes("--live"))throw new Error("Pass --live to call the configured model");
const root=new URL("../",import.meta.url);
const asUrl=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const knowledge=asUrl(await readFile(new URL("worker/prompt.js",root),"utf8"));
const current=asUrl((await readFile(new URL("worker/current-review.js",root),"utf8")).replace('from "./prompt.js";',`from "${knowledge}";`));
const redlines=asUrl(await readFile(new URL("worker/redlines.js",root),"utf8"));
let source=await readFile(new URL("worker/index.js",root),"utf8");
source=source.replace('from "./current-review.js";',`from "${current}";`).replace('from "./redlines.js";',`from "${redlines}";`)
  .replace(/import \{\s*retrieveCases,[\s\S]*?\} from "\.\/cases\.js";/,"const retrieveCases=()=>[],tryAbsorb=()=>null,addManualCase=()=>null,publishCase=()=>null,listAdminCases=()=>[],softDeleteCase=()=>false;")
  .replace('throw new HttpError(502, "教练这次判断不一致，未给你判分。原稿已保留，请重试。", qualityIssue);','throw Object.assign(new Error(qualityIssue),{auditReport:checked});')
  .replace('throw new HttpError(502, "教练没有核对清楚现场，这次未判分。原稿已保留，请重试。", interactionIssue);','throw Object.assign(new Error(interactionIssue),{auditReport:report});');
const worker=await import(asUrl(source+"\nexport {callDeepSeek};"));
const {detectRedline}=await import(redlines);
const vars=await readFile(new URL(".dev.vars",root),"utf8");
const key=vars.split(/\r?\n/u).find(l=>l.startsWith("DEEPSEEK_API_KEY="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/gu,"");
if(!key)throw new Error("Missing configured model key");
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.split("=").slice(1).join("=")||fallback;
const label=arg("label","semantic");
if(!/^[a-z0-9_-]+$/u.test(label))throw new Error("Invalid label");
const suite=arg("suite","semantic");
if(!["semantic","independent"].includes(suite))throw new Error("Invalid suite");
const only=arg("only","").split(",").filter(Boolean);
const repeat=Math.max(1,Math.min(3,Number(arg("repeat","1"))||1));
const sourceFixtures=suite==="independent"?independentFixtures:semanticFixtures;
const fixtures=sourceFixtures.filter(f=>!only.length||only.includes(f.id));
const queue=Array.from({length:repeat},(_,i)=>fixtures.map(f=>({...f,run:i+1}))).flat();
const outcomes=[];
await mkdir(new URL("tests/tmp_results/",root),{recursive:true});
for(let offset=0;offset<queue.length;offset+=3){
  await Promise.all(queue.slice(offset,offset+3).map(async f=>{
    const start=Date.now();let report,error;
    try{
      const scenario=worker.sanitizeScenario(f.scenario),hits=detectRedline(f.script);
      const r=await worker.callDeepSeek({DEEPSEEK_API_KEY:key},{voteGap:"close",script:f.script,cases:[],redlineHits:hits,scenario});
      report=worker.normalizeReport(r.report,f.script);
      worker.applyReportSafetyGates(report,hits,{sourceScript:f.script,scenario,voteGap:"close"});
    }catch(e){error=e.message;report=e.auditReport;}
    const action=report?.coaching?.action||"";
    const contentBeforeAsk = f.coachingNeed!=="content-before-ask" ||
      (/(?:停|收住|暂停|先不).{0,8}(?:催|喊|要票)/u.test(action) &&
       /(?:表演|内容|互动|先跳|先唱|问.{0,8}(?:想看|想听|想玩))/u.test(action) &&
       /(?:无实质|没实质|没有实质|只.{0,6}(?:喊|催)|反复.{0,6}(?:喊|催)|密集.{0,6}(?:喊|催))/u.test([report?.verdict_reason,report?.interaction_review?.why,report?.coaching?.why].join(" ")));
    const ok=!error&&Boolean(report?.verdict==="passed")===f.passed&&(!f.verdict||report?.verdict===f.verdict)&&
      (!f.gratitude||report.structure_checks.find(c=>c.key==="gratitude")?.status===f.gratitude)&&
      (!f.judgment||report.interaction_review?.judgment===f.judgment)&&contentBeforeAsk;
    const outcome={...f,ok,error,ms:Date.now()-start,report};outcomes.push(outcome);
    console.log(JSON.stringify({id:f.id,run:f.run,ok,ms:outcome.ms,error,verdict:report?.verdict,reason:report?.verdict_reason,interaction:report?.interaction_review,coaching:report?.coaching}));
  }));
  await writeFile(new URL(`tests/tmp_results/${label}.json`,root),JSON.stringify({at:new Date().toISOString(),suite,label,outcomes},null,2));
}
if(outcomes.some(o=>!o.ok))process.exitCode=1;
