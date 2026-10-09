import assert from 'node:assert/strict';
import worker, {CoachRateLimiter, saveDeliveredReview, readDeliveredReview, normalizeRevision, unwrapModelEnvelope, reviewRecordKey, reuseReview} from '../worker/index.js';
import {createRateLimiterBinding} from './helpers/rate-limiter.mjs';
const store=new Map();
const binding=createRateLimiterBinding(CoachRateLimiter);
const env={ACCESS_CODE:'shared-class',COACH_LIMITER:binding,CASES:{
 async list(){return {keys:[],list_complete:true};},async get(key,type){const value=store.get(key);return value===undefined?null:type==='json'?JSON.parse(value):value;},async put(key,value){store.set(key,value);}
}};
const old='我是新人小禾，刚被刀下去，大家帮帮我吧。';
const current='我是新人小禾，刚被刀下去，想看我说冷笑话的帮我上复活票。';
const first={verdict:'almost',coaching:{focus_key:'user_reason',original:'大家帮帮我吧。',example:'想看我说冷笑话的帮我上复活票。'}};
const second={verdict:'almost',coaching:{focus_key:'vote_instruction',original:'大家帮帮我吧。',example:'帮我上复活票吧。'}};
const [firstId,secondId]=await Promise.all([saveDeliveredReview(env,env.ACCESS_CODE,'far',old,null,first),saveDeliveredReview(env,env.ACCESS_CODE,'far',old,null,second)]);
assert.notEqual(firstId,secondId);
binding.restart();
const read=id=>readDeliveredReview(env,env.ACCESS_CODE,id,'far',old,null);
assert.deepEqual((await read(firstId)).report,first,'重启后仍返回第一位学员实际看到的报告');
assert.deepEqual((await read(secondId)).report,second,'相同原稿的第二份报告单独保存');
first.coaching.focus_key='redline';
assert.equal((await read(firstId)).report.coaching.focus_key,'user_reason','返回给调用方的对象不能篡改已存报告');
assert.equal(await readDeliveredReview(env,'another-class',firstId,'far',old,null),null,'跨入口码不能拿到报告');
assert.equal(await readDeliveredReview(env,env.ACCESS_CODE,undefined,'far',old,null),null);
await assert.rejects(()=>readDeliveredReview(env,env.ACCESS_CODE,firstId,'close',old,null),e=>e.status===400);
await assert.rejects(()=>readDeliveredReview(env,env.ACCESS_CODE,firstId,'far',old+'改过',null),e=>e.status===400);
await assert.rejects(()=>readDeliveredReview(env,env.ACCESS_CODE,firstId,'far',old,{phase:'interaction'}),e=>e.status===400);
const [name,state]=[...binding.states].find(([,s])=>s.values.get('report')?.report.report_id===firstId);
const record=structuredClone(state.values.get('report'));
assert.equal(state.alarm,record.expiresAt);
const overwrite=await binding.get(name).fetch(new Request('https://internal/report',{method:'PUT',body:JSON.stringify({...record,report:second})}));
assert.equal(overwrite.status,409,'报告不能被覆盖');
assert.equal((await read(firstId)).report.coaching.focus_key,'user_reason');
await binding.get(name).alarm();
assert.ok(state.values.has('report'),'提前唤醒不能删掉仍有效的报告');
const failing={...env,COACH_LIMITER:{idFromName:n=>n,get(){throw Error('outage');}}};
await assert.rejects(()=>readDeliveredReview(failing,env.ACCESS_CODE,firstId,'far',old,null),e=>e.status===503);
await assert.rejects(()=>saveDeliveredReview(failing,env.ACCESS_CODE,'far',old,null,{verdict:'passed'}),e=>e.status===503);
const revision={previousScript:old,focusKey:'redline',instruction:'客户端伪造历史'};
for(const id of ['bad-id',[firstId],null,123])assert.throws(()=>normalizeRevision({...revision,reportId:id}),e=>e.status===400);

// Seed only model results, never trusted revision history. The route must bind each exact receipt.
const report={verdict:'almost',structure_checks:[{key:'user_reason',status:'partial',evidence:'参与理由仍不足'},{key:'vote_instruction',status:'met',evidence:'有上票邀请'}],coaching:{original:'想看我说冷笑话的帮我上复活票。'}};
await reuseReview(env,await reviewRecordKey(env.ACCESS_CODE,'far',current,null,[]),async()=>({ok:true,report,usage:{}}));
// The old latest-key lookup would choose the other learner's vote_instruction report.
await reuseReview(env,await reviewRecordKey(env.ACCESS_CODE,'far',old,null),async()=>({ok:true,report:second,usage:{}}));
async function submit(reportId,stream=false){
 const response=await worker.fetch(new Request('https://local.test/api/coach',{method:'POST',headers:{'Content-Type':'application/json',Accept:stream?'application/x-ndjson':'application/json'},body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:'far',script:current,revision:{...revision,...(reportId?{reportId}:{})}})}),env,{waitUntil(){}});
 const body=JSON.parse((await response.text()).trim().split('\n').at(-1));
 return {status:stream?(body.status||response.status):response.status,body};
}
for(const stream of [false,true]){
 const firstReply=await submit(firstId,stream);
 assert.equal(firstReply.status,200,'第一位采纳原示范后仍能拿到当前稿判断');
 assert.equal(firstReply.body.report.verdict,'almost','不能因采用示范自动升分');
 assert.equal(firstReply.body.report.revision_check.focus_key,'user_reason','必须绑定第一位学员的确切凭证，不能取另一份报告');
 assert.equal(firstReply.body.report.revision_check.status,'unverified','无法裁决的历史冲突不记为学员再次失败');
 assert.match(firstReply.body.report.revision_note,/不计重复卡关/);
 assert.ok(firstReply.body.report.report_id);
 const reply=await submit(secondId,stream);
 assert.equal(reply.status,200);
 assert.equal(reply.body.report.revision_check.focus_key,'vote_instruction','忽略客户端伪造方向');
 assert.equal(reply.body.report.revision_check.status,'resolved');
 assert.ok(reply.body.report.report_id);
 assert.equal(reply.body.report.verdict,'almost','复练对照不得自动升分');
 const legacy=await submit(undefined,stream);
 assert.equal(legacy.status,200);
 assert.equal(legacy.body.report.revision_check,undefined,'旧客户端不得套用另一人的历史');
 assert.match(legacy.body.report.revision_note,/独立检查/);
}
const expired=state.values.get('report');expired.expiresAt=Date.now()-1;
assert.equal(await read(firstId),null,'过期报告不能继续比较');
const missing=await submit(firstId);
assert.equal(missing.body.report.revision_check,undefined);
assert.match(missing.body.report.revision_note,/过期/);
await binding.get(name).alarm();
assert.equal(state.values.size,0,'到期释放报告对象存储');
assert.ok(await read(secondId),'清理一份报告不影响另一份');
const inner={line_reviews:[],verdict:'passed'};
assert.equal(unwrapModelEnvelope({type:'json_object',content:inner}),inner);
for(const value of [inner,{type:'json_object',content:'{}'},{type:'json_object',content:inner,verdict:'off'},null,[]])assert.equal(unwrapModelEnvelope(value),value,'不猜测其他结构或绕过字段校验');
console.log('PASS immutable report identity, shared-code isolation, expiry, outage, streaming revision binding and model envelope handling');
