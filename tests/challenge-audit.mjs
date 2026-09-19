// Manual audit against the real configured model; no production KV writes.
// node tests/challenge-audit.mjs --live
import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";
if (!process.argv.includes("--live")) throw new Error("Pass --live to call the configured model");
const root = new URL("../", import.meta.url);
const asUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const knowledge = asUrl(await readFile(new URL("worker/prompt.js", root), "utf8"));
const current = asUrl((await readFile(new URL("worker/current-review.js", root), "utf8")).replace('from "./prompt.js";', `from "${knowledge}";`));
const redlines = asUrl(await readFile(new URL("worker/redlines.js", root), "utf8"));
let source = await readFile(new URL("worker/index.js", root), "utf8");
source = source.replace('from "./current-review.js";', `from "${current}";`)
  .replace('from "./redlines.js";', `from "${redlines}";`)
  .replace(/import \{\s*retrieveCases,[\s\S]*?\} from "\.\/cases\.js";/, "const retrieveCases=()=>[],tryAbsorb=()=>null,addManualCase=()=>null,publishCase=()=>null,listAdminCases=()=>[],softDeleteCase=()=>false;")
  .replace('throw new HttpError(502, "教练这次判断不一致，未给你判分。原稿已保留，请重试。", qualityIssue);', 'throw Object.assign(new Error(qualityIssue), {auditReport:checked});');
const worker = await import(asUrl(source + "\nexport {callDeepSeek};"));
const { detectRedline } = await import(redlines);
const vars = await readFile(new URL(".dev.vars", root), "utf8");
const key = vars.split(/\r?\n/).find(line => line.startsWith("DEEPSEEK_API_KEY="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
if (!key) throw new Error("Missing configured model key");
const context = vm.createContext({ console, URL, location: { hostname:"localhost", search:"" }, App:{state:{}} });
context.window = context;
context.URLSearchParams = URLSearchParams;
vm.runInContext(await readFile(new URL("site/js/config.js", root),"utf8"), context);
vm.runInContext(await readFile(new URL("site/js/report.js", root),"utf8"), context);
const scenario = worker.sanitizeScenario(context.TRAINING_SCENARIOS.find(s => s.id === "revival-closing-last-two"));
const samples = [
  {id:"baseline",script:"观众乙，刚才你认了四个，现在又加一个，这五个我记下了。还差最后一个了，哥哥姐姐谁能帮我补上，我想继续留在台上。"},
  {id:"joint-goal",script:"观众乙，刚才你认了四个，现在又加一个，这五个我记下了。还差最后一个，愿意一起把这轮组起来的哥哥姐姐，方便就认一个，我继续组人，差多少随时报。"},
];
const followups = process.argv.includes("--followups");
const outcomes = followups ? JSON.parse(await readFile(new URL("tests/tmp_results/challenge-audit.json",root),"utf8")).outcomes : [];
await mkdir(new URL("tests/tmp_results/",root),{recursive:true});
const output = new URL("tests/tmp_results/challenge-audit.json",root);
let saving = Promise.resolve();
async function run(id, script, revision = null) {
  const started = Date.now();
  const hits = detectRedline(script);
  let report, error;
  try {
    const result = await worker.callDeepSeek({DEEPSEEK_API_KEY:key},{voteGap:"close",script,cases:[],redlineHits:hits,scenario,revision});
    report = worker.normalizeReport(result.report,script);
    worker.applyReportSafetyGates(report,hits,{sourceScript:script,voteGap:"close",scenario});
    worker.applyRevisionFeedback(report,revision,script);
  } catch (err) { report=err.auditReport; error=err.message; }
  let ui;
  if (report && !error) {
    context.App.state.lastRequest={script,scenario,voteGap:"close"};
    const checks = context.Report._checks(report);
    const focus = report.verdict === "passed" ? null : context.Report._focusCheck(checks,report);
    ui={focus,solution:focus ? context.Report._solutionFor(report,focus) : null};
  }
  const item={id,script,revision,ms:Date.now()-started,error,report,ui};
  outcomes.push(item);
  const snapshot=JSON.stringify({at:new Date().toISOString(),scope:"Current local production code and real model; no retrieved cases; no automatic retries",scenario,outcomes},null,2);
  saving=saving.then(()=>writeFile(output,snapshot));
  await saving;
  console.log(JSON.stringify({id,ms:item.ms,error,verdict:report?.verdict,core:report?.structure_checks?.filter(c=>["user_reason","vote_instruction"].includes(c.key)),coaching:report?.coaching,ui}));
  return item;
}
// Same script, scene and rubric. Keep each raw attempt visible, including rejected reports.
for (const sample of followups ? [] : samples) {
  await Promise.all(Array.from({length:3},(_,i)=>run(`${sample.id}#${i+1}`,sample.script)));
}
// Follow one coach's own local replacement, preserving the rest of the script.
let previous = !followups && outcomes.find(item=>item.id === "baseline#1" && !item.error && item.report?.verdict !== "passed");
for(let step=1; previous && step<=3; step++) {
  const coaching=previous.report.coaching;
  if (!coaching?.original || !coaching.example || !previous.script.includes(coaching.original)) {
    console.log(JSON.stringify({chainStopped:"Coach's quoted original cannot be directly located",id:previous.id,coaching}));
    break;
  }
  const revised=previous.script.replace(coaching.original,coaching.example);
  if(revised===previous.script || revised.length>500) break;
  const revision={previousScript:previous.script,focusKey:coaching.focus_key,instruction:coaching.action};
  const batch=await Promise.all(Array.from({length:3},(_,i)=>run(`revision-${step}#${i+1}`,revised,revision)));
  previous=batch.find(item=>!item.error && item.report?.verdict !== "passed");
}
if (followups) {
  const original=outcomes.find(item=>item.id==="baseline#3");
  const c=original.report.coaching;
  const teacherScript=original.script.replace(c.original,c.example);
  const revision={previousScript:original.script,focusKey:c.focus_key,instruction:c.action};
  const extra=[
    {id:"alternate-teacher-edit",script:teacherScript,revision},
    {id:"existing-closing-fixture",script:"观众乙刚才原来认了四个，现在又加一个，我接住了。还差最后一个，谁愿意把这个收口位置抓一下，和前面二十七个一起把这一关走完，愿意的帮我认一个。"},
    {id:"natural-joint-goal",script:"观众乙，你加的一个我记下了，咱们现在就差最后一个位置。谁来把最后这一个补上，跟前面的人一起把这轮走完？愿意的认一个，我们凑齐等主持口令。"},
  ];
  for(const item of extra) await Promise.all(Array.from({length:3},(_,i)=>run(`${item.id}#${i+1}`,item.script,item.revision)));
}
if(outcomes.some(item=>item.error)) process.exitCode=1;
