// Read user-provided drafts; actual current Worker + configured model, local KV only.
// --initial runs each unchanged draft twice with isolated records (no hidden retry).
// --revise uses revisions.json prepared from the first review, retaining its saved record.
import {readFile,writeFile,mkdir} from "node:fs/promises";
const arg=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const label=arg("out","novice-audit");
if(!/^[a-z0-9_-]+$/u.test(label))throw new Error("Invalid output label");
const root=new URL("../",import.meta.url), out=new URL(`tests/tmp_results/${label}/`,root);
if(!process.argv.includes("--live"))throw new Error("Use --live to call the configured model");
const asUrl=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const knowledge=asUrl(await readFile(new URL("worker/prompt.js",root),"utf8"));
const current=asUrl((await readFile(new URL("worker/current-review.js",root),"utf8")).replace('from "./prompt.js";',`from "${knowledge}";`));
const redlines=asUrl(await readFile(new URL("worker/redlines.js",root),"utf8"));
const source=(await readFile(new URL("worker/index.js",root),"utf8"))
  .replace('from "./current-review.js";',`from "${current}";`).replace('from "./redlines.js";',`from "${redlines}";`)
  .replace(/import \{\s*retrieveCases,[\s\S]*?\} from "\.\/cases\.js";/,"const retrieveCases=()=>[],tryAbsorb=()=>null,addManualCase=()=>null,publishCase=()=>null,listAdminCases=()=>[],softDeleteCase=()=>false;");
const worker=await import(asUrl(source));
const vars=await readFile(new URL(".dev.vars",root),"utf8");
const key=vars.split(/\r?\n/u).find(l=>l.startsWith("DEEPSEEK_API_KEY="))?.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/gu,"");
if(!key)throw new Error("Missing model key");
await mkdir(out,{recursive:true});
const realFetch=globalThis.fetch;
let call=0;
// Preserve raw model responses, including any rejected by contract/gates. Never save credentials.
globalThis.fetch=async(...args)=>{
  const n=++call;
  const request=JSON.parse(args[1].body);
  const input=JSON.parse(request.messages[1].content);
  const response=await realFetch(...args);
  const phase=process.argv.includes("--revise")?"revision":process.argv.includes("--retry")?"retry":"initial";
  await writeFile(new URL(`raw-${phase}-${n}.json`,out),JSON.stringify({currentScript:input.currentScript,httpStatus:response.status,body:await response.clone().text()},null,2));
  return response;
};
const makeEnv=()=>{const map=new Map();return {ACCESS_CODE:"local-novice-audit",DEEPSEEK_API_KEY:key,CASES:{
  async get(k,type){const v=map.get(k);return v===undefined?null:type==="json"?JSON.parse(v):v;},
  async put(k,v){map.set(k,v);},
}};};
const submit=async(env,input)=>{
  const pending=[],start=Date.now();
  const response=await worker.default.fetch(new Request("https://local.test/api/coach",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",...input})}),env,{waitUntil:p=>pending.push(p)});
  const body=await response.json();await Promise.all(pending);
  return {ms:Date.now()-start,status:response.status,body};
};
try{
  if(process.argv.includes("--initial")){
    const filename=arg("file","");
    if(!filename)throw new Error("Provide --file=path to the two drafts");
    const text=await readFile(filename,"utf8");
    const scripts=text.split(/(?:\r?\n[ \t]*){3,}/u).map(s=>s.trim()).filter(Boolean);
    if(scripts.length!==2)throw new Error("Expected two drafts");
    await writeFile(new URL("inputs.json",out),JSON.stringify({voteGap:"close",scenario:null,labels:["主播一","主播二"],scripts},null,2));
    for(const run of [1,2]){
      await Promise.all(scripts.map(async(script,i)=>{
        const env=makeEnv();const result=await submit(env,{script});
        const outcome={label:["主播一","主播二"][i],run,script,...result};
        if(run===1&&result.status===200){
          const repeat=await submit(env,{script});
          // Other draft can be generating concurrently; compare report directly, not shared counter.
          outcome.cachedRepeat={same:JSON.stringify(repeat.body)===JSON.stringify(result.body),ms:repeat.ms};
        }
        await writeFile(new URL(`draft-${i+1}-run-${run}.json`,out),JSON.stringify(outcome,null,2));
        console.log(JSON.stringify({label:outcome.label,run,status:result.status,verdict:result.body.report?.verdict,intro:result.body.report?.structure_checks?.[0],optional:result.body.report?.optional_polish,error:result.body.message,cachedRepeat:outcome.cachedRepeat}));
      }));
    }
  }else if(process.argv.includes("--revise")){
    const revisions=JSON.parse(await readFile(new URL("revisions.json",out),"utf8"));
    await Promise.all(revisions.map(async revision=>{
      const initial=JSON.parse(await readFile(new URL(`draft-${revision.index}-run-1.json`,out),"utf8"));
      const env=makeEnv();
      const cacheKey=await worker.reviewRecordKey(env.ACCESS_CODE,"close",initial.script,null);
      await worker.reuseReview(env,cacheKey,async()=>initial.body);
      const lesson=initial.body.report.coaching;
      // Match the real frontend: a passed report does not create a mandatory revision task.
      const context=initial.body.report.verdict!=="passed"?{previousScript:initial.script,focusKey:lesson.focus_key,instruction:lesson.action}:undefined;
      const result=await submit(env,{script:revision.script,revision:context});
      await writeFile(new URL(`draft-${revision.index}-revised.json`,out),JSON.stringify({...revision,...result},null,2));
      console.log(JSON.stringify({index:revision.index,status:result.status,verdict:result.body.report?.verdict,reason:result.body.report?.verdict_reason,revision:result.body.report?.revision_check,coaching:result.body.report?.coaching,error:result.body.message}));
    }));
  }else if(process.argv.includes("--retry")){
    const initial=JSON.parse(await readFile(new URL("draft-2-run-2.json",out),"utf8"));
    if(initial.status!==502)throw new Error("No eligible failed request");
    const result=await submit(makeEnv(),{script:initial.script});
    await writeFile(new URL("draft-2-retry.json",out),JSON.stringify({reason:"One retry allowed by the actual frontend after a 502 within the remaining budget",...result},null,2));
    console.log(JSON.stringify({label:"主播二",retry:true,status:result.status,verdict:result.body.report?.verdict,error:result.body.message,ms:result.ms}));
  }else throw new Error("Choose --initial, --revise or --retry");
}finally{globalThis.fetch=realFetch;}
