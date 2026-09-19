// Real model, actual /api/coach lifecycle, local memory KV only. Never retries failures.
// node tests/coaching-flow-live.mjs --live
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {semanticFixtures} from "./semantic-fixtures.mjs";
if (!process.argv.includes("--live")) throw new Error("Pass --live to use the configured model");
const asUrl=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const root=new URL("../",import.meta.url);
const knowledge=asUrl(await readFile(new URL("worker/prompt.js",root),"utf8"));
const current=asUrl((await readFile(new URL("worker/current-review.js",root),"utf8")).replace('from "./prompt.js";',`from "${knowledge}";`));
const redlines=asUrl(await readFile(new URL("worker/redlines.js",root),"utf8"));
const source=(await readFile(new URL("worker/index.js",root),"utf8"))
  .replace('from "./current-review.js";',`from "${current}";`).replace('from "./redlines.js";',`from "${redlines}";`)
  .replace(/import \{\s*retrieveCases,[\s\S]*?\} from "\.\/cases\.js";/,"const retrieveCases=()=>[],tryAbsorb=()=>null,addManualCase=()=>null,publishCase=()=>null,listAdminCases=()=>[],softDeleteCase=()=>false;");
const worker=await import(asUrl(source));
const vars=await readFile(new URL(".dev.vars",root),"utf8");
const key=vars.split(/\r?\n/u).find(l=>l.startsWith("DEEPSEEK_API_KEY="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/gu,"");
if(!key)throw new Error("Missing configured model key");
const data=new Map();
const env={ACCESS_CODE:"local-flow-check",DEEPSEEK_API_KEY:key,CASES:{
  async get(k,type){const value=data.get(k);return value===undefined?null:type==="json"?JSON.parse(value):value;},
  async put(k,v){data.set(k,v);},
}};
const pending=[]; const ctx={waitUntil:p=>pending.push(p)};
let modelCalls=0;
const realFetch=globalThis.fetch;
globalThis.fetch=(...args)=>{modelCalls++;return realFetch(...args);};
const submit=async fixture=>{
  const response=await worker.default.fetch(new Request("https://local.test/api/coach",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",script:fixture.script,scenario:fixture.scenario,revision:fixture.revision}),
  }),env,ctx);
  return {status:response.status,body:await response.json()};
};
const results=[];
try {
  for(const id of ["playful-wrong-person","conditional-not-accepted","acknowledge-without-thanks"]){
    const fixture=semanticFixtures.find(f=>f.id===id);
    const outcome={id,script:fixture.script};
    try{
      outcome.initial=await submit(fixture);
      assert.equal(outcome.initial.status,200,JSON.stringify(outcome.initial.body));
      assert.equal(outcome.initial.body.report.verdict==="passed",fixture.passed);
      const before=modelCalls;
      outcome.repeat=await submit(fixture);
      assert.deepEqual(outcome.repeat,outcome.initial,"same script must return the saved report");
      assert.equal(modelCalls,before,"repeat must not invoke the model");
      if(!fixture.passed){
        const lesson=outcome.initial.body.report.coaching;
        assert.ok(lesson?.original&&lesson.example&&fixture.script.includes(lesson.original),"local example must be replaceable");
        outcome.revisedScript=fixture.script.replace(lesson.original,lesson.example);
        assert.notEqual(outcome.revisedScript,fixture.script);
        outcome.revised=await submit({...fixture,script:outcome.revisedScript,revision:{previousScript:fixture.script,focusKey:lesson.focus_key,instruction:lesson.action}});
        assert.equal(outcome.revised.status,200,JSON.stringify(outcome.revised.body));
        assert.equal(outcome.revised.body.report.revision_check?.status,"resolved","the suggested edit must resolve its stated issue");
        assert.equal(outcome.revised.body.report.verdict,"passed","these fixtures each contain one actual problem");
      }
      outcome.ok=true;
    }catch(error){outcome.ok=false;outcome.error=error.message;}
    results.push(outcome);
    console.log(JSON.stringify({id,ok:outcome.ok,initial:outcome.initial?.body.report?.verdict,revised:outcome.revised?.body.report?.verdict,error:outcome.error}));
    await mkdir(new URL("tests/tmp_results/",root),{recursive:true});
    await writeFile(new URL("tests/tmp_results/coaching-flow-live.json",root),JSON.stringify({at:new Date().toISOString(),modelCalls,results},null,2));
  }
  await Promise.all(pending);
} finally {globalThis.fetch=realFetch;}
if(results.some(r=>!r.ok))process.exitCode=1;
