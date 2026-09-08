// 手动真实验收：会调用已配置的 DeepSeek 并消耗额度，不调用 Worker/KV。
// node tests/live-coaching.mjs --live；仅使用下列虚构测试稿，不读取线上学员记录。
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
if (!process.argv.includes("--live")) throw new Error("真实模型测试须显式传 --live");
const root = new URL("../", import.meta.url);
const asUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const knowledge = asUrl(await readFile(new URL("worker/prompt.js", root), "utf8"));
const current = asUrl((await readFile(new URL("worker/current-review.js", root), "utf8")).replace('from "./prompt.js";', `from "${knowledge}";`));
const redlines = asUrl(await readFile(new URL("worker/redlines.js", root), "utf8"));
let source = await readFile(new URL("worker/index.js", root), "utf8");
source = source.replace('from "./current-review.js";', `from "${current}";`)
  .replace('from "./redlines.js";', `from "${redlines}";`)
  .replace(/import \{\s*retrieveCases,[\s\S]*?\} from "\.\/cases\.js";/, "const retrieveCases=()=>[],tryAbsorb=()=>null,addManualCase=()=>null,publishCase=()=>null,listAdminCases=()=>[],softDeleteCase=()=>false;");
// 只在测试进程保留被拒绝的报告用于定位，不改变失败判定或生产日志。
source = source.replace('throw new HttpError(502, "教练这次判断不一致，未给你判分。原稿已保留，请重试。", qualityIssue);', 'throw Object.assign(new Error(qualityIssue), {auditReport:checked, auditRaw:report});');
const worker = await import(asUrl(source + "\nexport {callDeepSeek};"));
const {detectRedline} = await import(redlines);
const vars = await readFile(new URL(".dev.vars", root), "utf8");
const key = vars.split(/\r?\n/).find(line => line.startsWith("DEEPSEEK_API_KEY="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
if (!key) throw new Error("未配置 DeepSeek key");
const samples = [
  {id:"empty-slogan", script:"大家一起冲啊，人多力量大，能不能过就看大家了。", passed:false},
  {id:"joint-progress", script:"愿意一起守这轮的哥哥姐姐量力搭一搭，我继续组人报差距。", passed:true},
  {id:"interest-response", script:"小林，你刚说想看返场，我再跳一遍。想一起看的量力补一点，我继续报差距。", passed:true},
  {id:"no-action", script:"小林，你刚才想看返场，我再跳一遍给你看。", passed:false},
  {id:"negated-response", script:"小林，虽然你想看返场，但我不会跳给你看。你补一票吧。", passed:false},
  {id:"coercion", script:"小林，求求你了，可怜可怜我，我给你跪下了，必须给我补一票。", passed:false},
  {id:"awaiting-drop", script:"大家已经组齐了，谢谢一起守这轮。先别提前丢，我们等主持统一口令。", scenario:{phase:"awaiting_drop",targetUnits:15,pledgedUnits:15,openRemaining:0,deliveredUnits:0}, passed:true},
  {id:"awaiting-wrong", script:"已经组齐了，大家继续认一个，现在马上丢，不用等主持。", scenario:{phase:"awaiting_drop",targetUnits:15,pledgedUnits:15,openRemaining:0,deliveredUnits:0}, passed:false},
];
const outcomes = [];
const only = process.argv.find(arg=>arg.startsWith("--only="))?.slice(7).split(",");
const selected = only ? samples.filter(sample=>only.includes(sample.id)) : samples;
const repeat = Math.min(3, Math.max(1, Number(process.argv.find(arg=>arg.startsWith("--repeat="))?.slice(9)) || 1));
const queue = Array.from({length:repeat}, (_,run)=>selected.map(sample=>({...sample,id:`${sample.id}#${run+1}`}))).flat();
// 每批最多四条，仍只运行明确列出的样本。
for (let offset=0; offset<queue.length; offset+=4) {
  await Promise.all(queue.slice(offset, offset+4).map(async sample => {
    const start = Date.now();
    let observedReport;
    let attempts = 0;
    try {
      const hits = detectRedline(sample.script);
      let result;
      for (;;) {
        attempts++;
        try {
          result = await worker.callDeepSeek({DEEPSEEK_API_KEY:key}, {voteGap:"close",script:sample.script,cases:[],redlineHits:hits,scenario:sample.scenario||null});
          break;
        } catch(error) {
          // 与前端一致：只对教练/网络错误重试一次；判定不符合预期不会重试“刷通过”。
          if (attempts >= 2 || Date.now()-start >= 90000) throw error;
        }
      }
      const report = worker.normalizeReport(result.report, sample.script);
      worker.applyReportSafetyGates(report,hits,{sourceScript:sample.script,voteGap:"close",scenario:sample.scenario||null});
      observedReport = report;
      assert.equal(report.verdict === "passed", sample.passed, sample.id);
      assert.equal(worker.getReportQualityIssue(report, sample.script), "");
      assert.ok(Date.now()-start < 105000,"超出前端总等待预算");
      const outcome = {id:sample.id,ok:true,ms:Date.now()-start,attempts,report};
      outcomes.push(outcome); console.log(JSON.stringify({id:sample.id,ok:true,ms:outcome.ms,attempts,verdict:report.verdict}));
    } catch(error) {
      outcomes.push({id:sample.id,ok:false,ms:Date.now()-start,attempts,error:error.message,report:error.auditReport || observedReport,raw:error.auditRaw});
      console.log(JSON.stringify({id:sample.id,ok:false,ms:Date.now()-start,error:error.message}));
    }
  }));
}
await mkdir(new URL("tests/tmp_results/",root),{recursive:true});
await writeFile(new URL("tests/tmp_results/release-live.json",root),JSON.stringify({at:new Date().toISOString(),outcomes},null,2));
if(outcomes.some(item=>!item.ok)) process.exitCode=1;
