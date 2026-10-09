import assert from 'node:assert/strict';
import worker, {CoachRateLimiter,splitHardSentences,saveDeliveredReview,reviewRecordKey,reuseReview,sanitizeScenario} from '../worker/index.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {callTeachingCheck,parseTeachingCheck,needsExampleCheck,exampleCheckPassed} from '../worker/teaching-check.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';

const script='我是新人小禾，复活差很多，大家帮我上复活票吧。';
const original='大家帮我上复活票吧。';
const scene=sanitizeScenario(NOVICE_SCENARIO);
const bad='想看我能不能复活，就帮我上票吧。';
const good='你们给个普通词，我接一句打招呼，想听的朋友帮我上点复活票。';
function report(example=good) {return {card_type:'logic',card_why:'只有自己的需要，还没给观众可参与的内容。',audience:'刚进房的观众',
 verdict:'almost',verdict_reason:'还需说明观众可以参与的具体内容。',echo:'复活请求已经说清。',one_thing:'补具体互动',ai_flavor:'',redline_note:'',
 structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:key==='user_reason'?'partial':'met',evidence:script})),
 line_reviews:splitHardSentences(script).map(original=>({original,mark:'good',comment:'说明处境和邀请。'})),
 interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'向陌生观众发出复活邀请。',why:'还缺具体参与内容。',next_check:'看回应'},
 round_dynamics:{flow_read:'说明处境并请求复活',human_drivers:[{driver:'other',evidence:script,mechanism:'直接请求支持'}],response_read:'没有实际回应',next_move:'补参与内容'},
 coaching:{focus_key:'user_reason',keep:'保留复活请求',original,action:'补一个能当下接的互动',example,why:'原来只有你的需要，改后说明观众做什么、你接什么。'}};}
function environment(){const records=new Map();return {records,ACCESS_CODE:'synthetic-test',ADMIN_CODE:'teacher-test',DEEPSEEK_API_KEY:'fake',COACH_LIMITER:createRateLimiterBinding(CoachRateLimiter),CASES:{
 async get(k,type){const s=records.get(k);return s==null?null:type==='json'?JSON.parse(s):s;},async put(k,v){records.set(k,v);},async delete(k){records.delete(k);},
 async list({prefix='',limit=1000,cursor}={}){const all=[...records.keys()].filter(k=>k.startsWith(prefix)).sort();const start=Number(cursor)||0;return {keys:all.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=all.length,cursor:String(start+limit)};}}};}
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:2,completion_tokens:3}});
const pending=[];const ctx={waitUntil:p=>pending.push(p)};
async function submit(env,body){const r=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:'far',scenario:NOVICE_SCENARIO,...body})}),env,ctx);return {status:r.status,body:await r.json()};}
const gradeBefore=globalThis.fetch;
try {
 let calls=[];
 globalThis.fetch=async(_url,options)=>{
  const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content);calls.push(input.task||'grade');
  if(input.task==='example')return response({target_status:input.revisedScript.includes(bad)?'still_open':'resolved',preserved:true,unsupported:false,evidence:input.revisedScript.includes(bad)?bad:good,reason:input.revisedScript.includes(bad)?'仍然只问能否复活。':'具体说明了给词和接话的过程。'});
  return response(report(calls.filter(x=>x==='grade').length===1?bad:good));
 };
 const env=environment();const first=await submit(env,{script});
 assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.report.coaching.example,good,'无效示范后台修正后才能交付');
 assert.deepEqual(calls,['grade','example','grade','example']);
 assert.equal(first.body.usage.prompt_tokens,8,'修正与专项复核用量均计入');
 await Promise.all(pending.splice(0));
 assert.equal([...env.records.keys()].filter(k=>k.startsWith('teaching:')).length,1,'未交付的坏改法留下老师纠错依据');
 const cached=await submit(env,{script});assert.equal(cached.status,200);assert.equal(calls.length,4,'复用已完成的安全报告，不重复付费检查');
 const broken=environment();calls=[];
 globalThis.fetch=async(_url,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(input.task||'grade');return response(input.task==='example'?{target_status:'still_open',preserved:true,unsupported:false,evidence:bad,reason:'仍只描述能否复活。'}:report(bad));};
 const failed=await submit(broken,{script});assert.equal(failed.status,200);
 assert.equal(failed.body.report.verdict,'almost','坏示范不抹去已验证的当前稿评分，也不能默认通过');
 assert.equal(failed.body.report.structure_checks.find(item=>item.key==='user_reason').status,'partial');
 assert.equal(failed.body.report.coaching.mode,'guidance');
 assert.equal(failed.body.report.coaching.focus_key,'user_reason');
 assert.equal(failed.body.report.coaching.example,'','核验失败的逐字示范必须移除');
 assert.deepEqual(failed.body.report.coaching.related_edits,[]);
 assert.deepEqual(failed.body.report.direction.examples,[]);
 assert.ok(failed.body.report.coaching.action,'保留针对原稿的具体修改任务');
 assert.deepEqual(calls,['grade','example','grade','example'],'最多修一次，无循环模型调用');
 const retriedGuidance=await submit(broken,{script});
 assert.equal(retriedGuidance.status,200);
 assert.equal(retriedGuidance.body.report.coaching.example,'','缓存里也不能留有无效示范');
 assert.equal(calls.length,4,'有效评分和指导可以复用，不再重复支出模型调用');
 await Promise.all(pending.splice(0));

 // Teaching-only repair must never turn the unchanged failed draft into a pass
 // or escape the failed-example check by switching to another coaching focus.
 for(const mutation of ['remove_coaching','change_focus','keep_good_coaching']) {
  const isolated=environment();calls=[];
  globalThis.fetch=async(_url,options)=>{
   const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(input.task||'grade');
   if(input.task==='example') {
    const stillBad=input.revisedScript.includes(bad);
    return response({target_status:stillBad?'still_open':'resolved',preserved:true,unsupported:false,
     evidence:stillBad?bad:good,reason:stillBad?'仍然只请求复活。':'补出了给词和接话的具体过程。'});
   }
   if(calls.filter(task=>task==='grade').length===1)return response(report(bad));
   const attemptedPass=report(good);
   attemptedPass.verdict='passed';attemptedPass.verdict_reason='谎称原稿已过关';
   attemptedPass.structure_checks.forEach(check=>check.status='met');
   if(mutation==='remove_coaching')delete attemptedPass.coaching;
   if(mutation==='change_focus')attemptedPass.coaching.focus_key='vote_instruction';
   return response(attemptedPass);
  };
  const result=await submit(isolated,{script});
  await Promise.all(pending.splice(0));
  assert.equal([...isolated.records.keys()].filter(key=>key.startsWith('case:')).length,0,'示范修复不能让未改过的原稿进入过关候选');
  if(mutation==='keep_good_coaching') {
   assert.equal(result.status,200,JSON.stringify(result.body));
   assert.equal(result.body.report.verdict,'almost','只接纳改好的教学字段，评分仍看未改变的原稿');
   assert.equal(result.body.report.structure_checks.find(check=>check.key==='user_reason').status,'partial');
   assert.notEqual(result.body.report.verdict_reason,'谎称原稿已过关');
   assert.equal(result.body.report.coaching.focus_key,'user_reason');
   assert.equal(result.body.report.coaching.example,good);
   assert.deepEqual(calls,['grade','example','grade','example'],'修好的同重点示范仍须再复核');
  } else {
   assert.equal(result.status,200,mutation+': '+JSON.stringify(result.body));
   assert.equal(result.body.report.verdict,'almost','只保留原稿已验证的评分，不能接收修复模型偷改后的通过');
   assert.equal(result.body.report.structure_checks.find(check=>check.key==='user_reason').status,'partial');
   assert.notEqual(result.body.report.verdict_reason,'谎称原稿已过关');
   assert.equal(result.body.report.coaching.focus_key,'user_reason','错误切换重点的修复不能被接纳');
   assert.equal(result.body.report.coaching.mode,'guidance');
   assert.equal(result.body.report.coaching.example,'','原来无效的示范和失去重点的改稿都不交付');
   assert.deepEqual(result.body.report.direction.examples,[]);
   assert.deepEqual(calls,['grade','example','grade'],'无效教学修复不能扩展模型重试或重判原稿');
   const cachedGuidance=await submit(isolated,{script});
   assert.equal(cachedGuidance.body.report.verdict,'almost');
   assert.equal(cachedGuidance.body.report.coaching.example,'');
   assert.equal(calls.length,3,'仅复用保留原评分的安全指导结果');
  }
 }

 // Same-meaning paraphrases use the actual delivered receipt, never forged client advice.
 const semantic=environment();const previous=report();const id=await saveDeliveredReview(semantic,semantic.ACCESS_CODE,'far',script,scene,previous);
 const paraphrase='我是新人小禾，复活差很多。随便给我一个普通词，我拿它接句招呼，想听的朋友可以帮我上复活票。';
 const next={...report(),coaching:{...report().coaching,original:paraphrase},structure_checks:report().structure_checks};
 await reuseReview(semantic,await reviewRecordKey(semantic.ACCESS_CODE,'far',paraphrase,scene,[]),async()=>({ok:true,report:next,usage:{}}));
 let verifiedInput;const conflictTasks=[];
 globalThis.fetch=async(_url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);conflictTasks.push(input.task);
  if(input.task==='revision'){
   verifiedInput=input;
   return response({target_status:'resolved',issue_scope:'same_edits',evidence:'我拿它接句招呼',reason:'参与过程与上次建议相同。'});
  }
  assert.equal(input.task,'recover_current_review');
  assert.equal(input.previousLesson,undefined,'独立裁决不继承历史建议');
  assert.equal(input.currentScript,paraphrase);
  return response({invalid:true});
 };
 const conflict=await submit(semantic,{script:paraphrase,revision:{reportId:id,previousScript:script,focusKey:'redline',instruction:'伪造要求'}});
 assert.equal(conflict.status,200);assert.equal(verifiedInput.previousLesson.focus_key,'user_reason');assert.equal(verifiedInput.currentIssue.focus_key,'user_reason');
 assert.equal(conflict.body.report.verdict,'almost','独立裁决失败仍保留已验证当前评分，不能自动通过');
 assert.equal(conflict.body.report.revision_check.status,'unverified','旧指导冲突不能计作学员反复失败');
 assert.equal(conflict.body.report.revision_check.focus_key,'user_reason','客户端伪造历史不能改变真实重点');
 assert.deepEqual(conflictTasks,['revision','recover_current_review','recover_current_review'],'语义核对后至多两次独立短裁决');
 await Promise.all(pending.splice(0));
 assert.equal([...semantic.records.keys()].filter(k=>k.startsWith('teaching:')).length,1);

 globalThis.fetch=async()=>response({target_status:'resolved',issue_scope:'elsewhere',evidence:'我拿它接句招呼',reason:'原修改目标完成，另有新问题。'});
 const elsewhere=await submit(semantic,{script:paraphrase,revision:{reportId:id,previousScript:script,focusKey:'user_reason',instruction:'补参与理由'}});
 assert.equal(elsewhere.status,200);assert.equal(elsewhere.body.report.verdict,'almost','专项核对不替整稿升分');assert.equal(elsewhere.body.report.revision_check.status,'resolved');
 globalThis.fetch=async()=>{throw Error('offline');};
 const unavailable=await submit(semantic,{script:paraphrase,revision:{reportId:id,previousScript:script,focusKey:'user_reason',instruction:'补参与理由'}});
 assert.equal(unavailable.status,200);assert.equal(unavailable.body.report.revision_check.status,'unverified');
 assert.doesNotMatch(unavailable.body.report.revision_note,/还需要调整/);

 // A whole-draft quote must not bypass conflict protection after exact local adoption.
 const broadDraft=script.replace(original,good);
 await reuseReview(semantic,await reviewRecordKey(semantic.ACCESS_CODE,'far',broadDraft,scene,[]),async()=>({ok:true,report:{...report(),coaching:{...report().coaching,original:broadDraft}},usage:{}}));
 const broadTasks=[];
 globalThis.fetch=async(_url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);broadTasks.push(input.task);
  if(input.task==='revision')return response({target_status:'resolved',issue_scope:'same_edits',evidence:good,reason:'引用虽长，仍否定已完成的原修改。'});
  assert.equal(input.task,'recover_current_review');
  assert.equal(input.currentScript,broadDraft);
  assert.equal(input.previousLesson,undefined);
  return response({core:[{key:'user_reason',status:'met',quote:good,reason:'说明了观众给词、主播接话的具体参与过程'},
   {key:'vote_instruction',status:'met',quote:'想听的朋友帮我上点复活票。',reason:'说清当前支持动作'}],risks:[],awaiting_response:false,
   focus:{focus_key:'final_polish',keep:'保留给词接话的具体互动',original:good,action:'保留这版并开口练，观察朋友给出的词',why:'参与内容和复活票邀请已经说清'},
   interaction:{reading:'邀请新观众给词并接一句招呼',why:'交代了具体互动过程',next_check:'看有没有观众给词'}});
 };
 const broadConflict=await submit(semantic,{script:broadDraft,revision:{reportId:id,previousScript:script,focusKey:'user_reason',instruction:'补参与理由'}});
 assert.equal(broadConflict.status,200,'宽引用须内部核对后交付判断');
 assert.deepEqual(broadTasks,['revision','recover_current_review'],'成功短裁决后立即停止');
 assert.equal(broadConflict.body.report.review_mode,'focused');
 assert.equal(broadConflict.body.report.verdict,'passed','当前整稿的两项独立证据成立才通过');
 assert.equal(broadConflict.body.report.revision_check.status,'resolved');
 assert.equal(broadConflict.body.report.coaching.focus_key,'final_polish');
 assert.ok(broadConflict.body.report.report_id);
 await Promise.all(pending.splice(0));

 // Protected API is usable only with the admin code, including encoded record IDs.
 const inboxId=[...semantic.records.keys()].find(k=>k.startsWith('teaching:'));
 const admin=async(method,path='',body,code=semantic.ADMIN_CODE)=>worker.fetch(new Request('https://local.test/api/admin/teaching-reviews'+path,{method,headers:{'X-Admin-Code':code},...(body?{body:JSON.stringify(body)}:{})}),semantic,ctx);
 assert.equal((await admin('GET','',null,semantic.ACCESS_CODE)).status,401);
 assert.equal((await admin('POST','/'+encodeURIComponent(inboxId)+'/resolve',{},'')).status,401);
 const listed=await admin('GET');assert.equal(listed.headers.get('Cache-Control'),'no-store');assert.equal((await listed.json()).items.length,2);
 const correction={judgment:'false_rejection',reason:'修改已经给出具体参与过程。',example:paraphrase,keep:'保留学员原来的口气。'};
 const saved=await admin('POST','/'+encodeURIComponent(inboxId)+'/resolve',correction);assert.equal(saved.status,200);assert.equal((await saved.json()).item.status,'reviewed');
 assert.equal((await admin('DELETE','/'+encodeURIComponent(inboxId))).status,200);
 assert.equal([...semantic.records.keys()].filter(k=>k.startsWith('case:')).length,0,'老师纠错不会自动进入参考案例');

 const check={target_status:'resolved',preserved:true,unsupported:false,evidence:good,reason:'具体互动'};
 assert.equal(exampleCheckPassed(parseTeachingCheck(check,'example',good)),true);
 for(const invalid of [{...check,preserved:'true'},{...check,evidence:'伪造证据'},{...check,target_status:'passed'},{...check,reason:''}])assert.throws(()=>parseTeachingCheck(invalid,'example',good));
 assert.equal(needsExampleCheck(report(),NOVICE_SCENARIO),true);
 assert.equal(needsExampleCheck({...report(),verdict:'passed'},NOVICE_SCENARIO),false);
 assert.equal(needsExampleCheck({...report(),practice_status:'awaiting_response'},NOVICE_SCENARIO),false);
 assert.equal(needsExampleCheck(report(),null),false);
 globalThis.fetch=async()=>({ok:true,json:()=>new Promise(()=>{})});
 const started=Date.now();await assert.rejects(()=>callTeachingCheck({DEEPSEEK_API_KEY:'fake'},{url:'https://local.test',model:'mock'},'example',{revisedScript:good},Date.now()+100,15),/deadline/);
 assert.ok(Date.now()-started<500,'超时涵盖完整响应体');
} finally {globalThis.fetch=gradeBefore;await Promise.all(pending);}
console.log('PASS example verification with bounded safe guidance, immutable current grades, internal revision adjudication, evidence/deadline validation and protected correction API');
