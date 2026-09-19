// Replays saved real reports through current validation; does not call a model.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import * as worker from "../worker/index.js";
import { detectRedline } from "../worker/redlines.js";
const label=process.argv[2] || "semantic-acceptance";
if(!/^[a-z0-9_-]+$/u.test(label))throw new Error("Invalid result label");
const dir=new URL("tmp_results/",import.meta.url);
const saved=JSON.parse(await readFile(new URL(`${label}.json`,dir),"utf8"));
const outcomes=saved.outcomes.map(item=>{
  try{
    assert.ok(item.report,"No saved report to replay");
    const scenario=worker.sanitizeScenario(item.scenario);
    assert.equal(worker.getInteractionReviewIssue(item.report,item.script,scenario,"close"),"");
    const report=worker.normalizeReport(item.report,item.script);
    worker.applyReportSafetyGates(report,detectRedline(item.script),{sourceScript:item.script,scenario,voteGap:"close"});
    assert.equal(worker.getReportQualityIssue(report,item.script,scenario),"");
    assert.equal(report.verdict==="passed",item.passed);
    if(item.gratitude)assert.equal(report.structure_checks.find(c=>c.key==="gratitude").status,item.gratitude);
    return {id:item.id,run:item.run,ok:true,verdict:report.verdict};
  }catch(error){return {id:item.id,run:item.run,ok:false,error:error.message};}
});
await writeFile(new URL(`${label}-replay.json`,dir),JSON.stringify({at:new Date().toISOString(),scope:"Offline validation replay of saved reports; no new model generation",outcomes},null,2));
console.log(JSON.stringify({total:outcomes.length,passed:outcomes.filter(o=>o.ok).length,failures:outcomes.filter(o=>!o.ok)},null,2));
if(outcomes.some(o=>!o.ok))process.exitCode=1;
