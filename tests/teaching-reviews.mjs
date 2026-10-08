import assert from 'node:assert/strict';
import {
  TEACHING_REVIEW_TTL, TEACHING_REVIEW_LIMIT, enqueueTeachingReview, listTeachingReviews,
  resolveTeachingReview, deleteTeachingReview, nextTeachingProgress,
} from '../worker/teaching-reviews.js';

class MemoryKV {
  values = new Map(); expirations = new Map(); writes = []; listCalls = [];
  async get(key, type) {
    if (this.expirations.has(key) && this.expirations.get(key) * 1000 <= Date.now()) return null;
    const value = this.values.get(key);
    return value == null ? null : (type === 'json' ? JSON.parse(value) : value);
  }
  async put(key, value, options = {}) {
    this.values.set(key, value); this.writes.push({key, options:structuredClone(options)});
    if (options.expiration) this.expirations.set(key, options.expiration);
    if (options.expirationTtl) this.expirations.set(key, Math.ceil(Date.now() / 1000) + options.expirationTtl);
  }
  async delete(key) { this.values.delete(key); this.expirations.delete(key); }
  async list(options = {}) {
    this.listCalls.push(options);
    const {prefix = '', limit = 1000, cursor} = options;
    const offset = cursor ? Number(cursor) : 0;
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix) &&
      (!this.expirations.has(key) || this.expirations.get(key) * 1000 > Date.now())).sort();
    return {keys:keys.slice(offset, offset + limit).map(name => ({name})), list_complete:offset + limit >= keys.length,
      cursor:offset + limit < keys.length ? String(offset + limit) : undefined};
  }
}
const lesson = {focus_key:'user_reason',original:'我需要复活，帮帮我。',example:'想看机械舞的朋友，帮我上点复活票。',
  keep:'保留机械舞',action:'补出观众可参与的内容',why:'把内容和复活连起来',related_edits:[{original:'你们答应了。',example:''}]};
const input = {reason:'revision_conflict',scenario:{id:'novice-revival'},previousScript:'我会机械舞。我需要复活，帮帮我。你们答应了。',
  script:'我会机械舞。想看机械舞的朋友，帮我上点复活票。',previousReport:{verdict:'almost',coaching:lesson},
  report:{verdict:'almost',card_why:'仍然否定之前的示范',verdict_reason:'参与理由待调整',coaching:{...lesson,original:lesson.example},revision_note:'还需调整'},detail:'上次示范与本次判断冲突'};
const correction = {judgment:'invalid_advice',reason:'上次给的参与内容不够清楚',example:'这是老师认可的有效改法。',keep:'机械舞内容保留'};
const rejectsStatus = (fn, status) => assert.rejects(fn, error => error.status === status && typeof error.publicMessage === 'string');
const oldNow = Date.now;
let now = 2_000_000_000_000;
Date.now = () => now;
try {
  const kv = new MemoryKV(), env = {CASES:kv};
  await kv.put('case:manual:far:untouched', 'existing reference');
  await kv.put('reference:v1:untouched', 'existing index');
  const id = await enqueueTeachingReview(env,input);
  assert.match(id,/^teaching:[a-f0-9]{64}$/u);
  const initial = await kv.get(id,'json');
  assert.equal(initial.expiresAt,now + TEACHING_REVIEW_TTL * 1000);
  assert.equal(kv.expirations.get(id),Math.floor(initial.expiresAt/1000));
  const count = kv.writes.length;
  now += 12_000;
  assert.equal(await enqueueTeachingReview(env,{...input,detail:'重试产生不同诊断说明'}),id);
  assert.equal(kv.writes.length,count,'相同故障重试不再次写入');
  assert.deepEqual(await kv.get(id,'json'),initial,'去重不刷新时间或状态');

  const saved = await resolveTeachingReview(env,id,{...correction,accessCode:'secret',status:'published'});
  assert.equal(saved.status,'reviewed'); assert.deepEqual(saved.correction,correction);
  assert.equal(saved.expiresAt,initial.expiresAt);
  assert.equal(kv.expirations.get(id),Math.floor(initial.expiresAt/1000),'教师保存不延长实际KV保留期');
  assert.equal(await enqueueTeachingReview(env,input),id);
  assert.equal((await kv.get(id,'json')).status,'reviewed','重试不能覆盖教师结论');
  assert.equal(await kv.get('case:manual:far:untouched'),'existing reference');
  assert.equal(await kv.get('reference:v1:untouched'),'existing index');
  assert.ok(kv.writes.slice(2).every(write=>write.key.startsWith('teaching:')),'纠错只能写自己的命名空间，不进入案例库或参考索引');

  for (const value of [null,{}, {...input,reason:'published'}, {...input,script:' '}, {...input,script:'甲'.repeat(501)}]) {
    await rejectsStatus(()=>enqueueTeachingReview(env,value),400);
  }
  for (const value of [null,[],{...correction,judgment:'publish'}, {...correction,reason:' '}, {...correction,reason:'甲'.repeat(601)},
    {...correction,example:'甲'.repeat(501)}, {...correction,keep:'甲'.repeat(301)}, {...correction,keep:null}, {...correction,example:''}]) {
    await rejectsStatus(()=>resolveTeachingReview(env,id,value),400);
  }
  for (const judgment of ['false_rejection','false_acceptance']) await rejectsStatus(()=>resolveTeachingReview(env,id,{...correction,judgment,example:' '}),400);
  for (const judgment of ['correct','unclear']) assert.equal((await resolveTeachingReview(env,id,{...correction,judgment,example:''})).correction.judgment,judgment);
  const recordBeforeFinalMinute = await kv.get(id,'json'), writesBeforeFinalMinute = kv.writes.length;
  now = initial.expiresAt - 30_000;
  await rejectsStatus(()=>resolveTeachingReview(env,id,correction),404);
  assert.equal(kv.writes.length,writesBeforeFinalMinute,'临近到期不通过延长60秒重写');
  assert.deepEqual(await kv.get(id,'json'),recordBeforeFinalMinute,'保存失败不改变原记录');
  now = initial.expiresAt;
  assert.deepEqual((await listTeachingReviews(env)).items,[]);
  await rejectsStatus(()=>resolveTeachingReview(env,id,correction),404);

  // Both incoming snapshots and data read from KV must remain bounded and allowlisted.
  const boundedKV = new MemoryKV(), boundedEnv = {CASES:boundedKV};
  const boundedId = await enqueueTeachingReview(boundedEnv,{...input,reason:'example_invalid',accessCode:'PRIVATE',
    detail:'查验失败'.repeat(200),previousScript:'甲'.repeat(700),scenario:{id:'场景'.repeat(90),accessCode:'PRIVATE'},
    previousReport:{...input.previousReport,accessCode:'PRIVATE',coaching:{...lesson,apiKey:'PRIVATE',example:'乙'.repeat(300),related_edits:Array(9).fill({original:'丙'.repeat(250),example:'丁'.repeat(170),token:'PRIVATE'})}},
    report:{...input.report,apiKey:'PRIVATE',rawResponse:'PRIVATE'}});
  const bounded = await boundedKV.get(boundedId,'json');
  assert.equal(bounded.previousScript.length,500);assert.equal(bounded.detail.length,500);assert.equal(bounded.scenarioId.length,64);
  assert.equal(bounded.previousCoaching.example.length,160);assert.equal(bounded.previousCoaching.related_edits.length,4);
  assert.equal(bounded.previousCoaching.related_edits[0].original.length,200);assert.equal(bounded.previousCoaching.related_edits[0].example.length,160);
  assert.ok(!JSON.stringify(bounded).includes('PRIVATE'));
  assert.equal(bounded.reason,'example_invalid');assert.equal(bounded.currentReport.verdict,'almost','示范检查失败保留报告证据供老师查看');
  bounded.apiKey='PRIVATE';bounded.currentReport.apiKey='PRIVATE';bounded.previousCoaching.apiKey='PRIVATE';
  bounded.correction={...correction,secret:'PRIVATE'};
  await boundedKV.put(boundedId,JSON.stringify(bounded));
  const publicItems = (await listTeachingReviews(boundedEnv)).items;
  assert.equal(publicItems.length,1);assert.ok(!JSON.stringify(publicItems).includes('PRIVATE'),'读取侧也执行白名单');
  assert.ok(!JSON.stringify(await resolveTeachingReview(boundedEnv,boundedId,correction)).includes('PRIVATE'));
  const otherId='teaching:'+'a'.repeat(64);
  await boundedKV.put(otherId,JSON.stringify({...bounded,id:boundedId}));
  assert.equal((await listTeachingReviews(boundedEnv)).items.length,1,'key/id 不匹配的数据不返回');
  await rejectsStatus(()=>resolveTeachingReview(boundedEnv,otherId,correction),404);
  for(const malformed of [{...bounded,id:otherId,expiresAt:Infinity},{...bounded,id:otherId,expiresAt:now+TEACHING_REVIEW_TTL*2000},
    {...bounded,id:otherId,status:'published'},{...bounded,id:otherId,reason:'unexpected'}]) {
    await boundedKV.put(otherId,JSON.stringify(malformed));
    assert.equal((await listTeachingReviews(boundedEnv)).items.length,1);
  }
  await deleteTeachingReview(boundedEnv,boundedId);assert.equal(await boundedKV.get(boundedId),null);
  await deleteTeachingReview(boundedEnv,boundedId); // Idempotent teacher removal.
  for (const badId of ['case:manual:far:untouched','../case:manual','teaching:xyz',null,{}]) {
    await rejectsStatus(()=>deleteTeachingReview(env,badId),400);
    await rejectsStatus(()=>resolveTeachingReview(env,badId,correction),400);
  }

  const pagedKV=new MemoryKV(),pagedEnv={CASES:pagedKV},ids=[];
  for(let i=0;i<7;i++) { now+=1000;ids.push(await enqueueTeachingReview(pagedEnv,{...input,script:input.script+String(i)})); }
  const seen=[];let cursor;
  do { const page=await listTeachingReviews(pagedEnv,{limit:2,cursor});seen.push(...page.items.map(item=>item.id));cursor=page.nextCursor;
    assert.equal(page.hasMore,!!cursor);assert.ok(page.items.length<=2); } while(cursor);
  assert.deepEqual(seen.sort(),ids.sort(),'真实游标分页不漏项不重复');
  await listTeachingReviews(pagedEnv,{limit:999});assert.equal(pagedKV.listCalls.at(-1).limit,50);
  await listTeachingReviews(pagedEnv,{limit:-3});assert.equal(pagedKV.listCalls.at(-1).limit,1);
  await listTeachingReviews(pagedEnv,{limit:NaN});assert.equal(pagedKV.listCalls.at(-1).limit,30);
  await rejectsStatus(()=>listTeachingReviews(pagedEnv,{cursor:9}),400);
  await rejectsStatus(()=>listTeachingReviews(pagedEnv,{cursor:'a'.repeat(2049)}),400);

  const fullKV=new MemoryKV(),fullEnv={CASES:fullKV};let first;
  for(let i=0;i<TEACHING_REVIEW_LIMIT;i++) { const queued=await enqueueTeachingReview(fullEnv,{...input,script:input.script+String(i)});assert.ok(queued);first||=queued; }
  assert.equal(await enqueueTeachingReview(fullEnv,{...input,script:input.script+'overflow'}),null,'达到容量停止收集，不删除教师记录');
  assert.equal(await enqueueTeachingReview(fullEnv,{...input,script:input.script+'0'}),first,'满队列也可安全去重');
  assert.equal(fullKV.values.size,TEACHING_REVIEW_LIMIT);
  for(const unavailable of [{}, {CASES:{get(){},put(){}}},null]) {
    await rejectsStatus(()=>enqueueTeachingReview(unavailable,input),503);
    await rejectsStatus(()=>listTeachingReviews(unavailable),503);
  }

  // Only the authenticated server receipt's separate progress can contribute.
  const report={verdict:'almost',coaching:{focus_key:'user_reason'}};
  const revision={previousScript:'上一版',currentScript:'这一版',attempts:98,teachingProgress:{focusKey:'user_reason',attempts:98}};
  const previous={report,teachingProgress:{focusKey:'user_reason',attempts:2}};
  assert.deepEqual(nextTeachingProgress(report,revision,previous),{focusKey:'user_reason',attempts:3});
  assert.equal(nextTeachingProgress(report,revision,null).attempts,1,'客户端计数没有上次服务端回执不能累加');
  assert.equal(nextTeachingProgress(report,revision,{report:{...report,teachingProgress:{focusKey:'user_reason',attempts:98}}}).attempts,2,'旧报告正文的伪计数不被信任');
  assert.equal(nextTeachingProgress({...report,teachingProgress:{focusKey:'user_reason',attempts:98}},revision,previous).attempts,3,'当前缓存报告中的计数不影响历史');
  assert.equal(nextTeachingProgress(report,{previousScript:'同稿',currentScript:' 同稿 '},previous).attempts,1,'仅外围空格不得堆叠次数');
  assert.equal(nextTeachingProgress(report,{previousScript:'上一版'},previous).attempts,1,'缺失可信当前稿不得续算');
  assert.equal(nextTeachingProgress(report,revision,{...previous,report:{verdict:'passed',coaching:report.coaching}}).attempts,1,'上一点通过后不累加失败');
  assert.equal(nextTeachingProgress(report,revision,{...previous,report:{...report,practice_status:'awaiting_response'}}).attempts,1,'等待现场回应不是失败');
  for(const status of ['resolved','unverified']) assert.equal(nextTeachingProgress({...report,revision_check:{status}},revision,previous).attempts,1,`复练状态 ${status} 不作为同点失败`);
  assert.equal(nextTeachingProgress(report,revision,{...previous,teachingProgress:{focusKey:'expression',attempts:50}}).attempts,2,'不同任务计数不能继承');
  for(const attempts of [-1,NaN,Infinity,'98',1.5]) assert.equal(nextTeachingProgress(report,revision,{...previous,teachingProgress:{focusKey:'user_reason',attempts}}).attempts,1,'异常服务端历史保守重置');
  assert.equal(nextTeachingProgress(report,revision,{...previous,teachingProgress:{focusKey:'user_reason',attempts:99}}).attempts,99);
  assert.equal(nextTeachingProgress({...report,verdict:'passed'},revision,previous),null);
  assert.equal(nextTeachingProgress({...report,practice_status:'awaiting_response'},revision,previous),null);
  assert.equal(nextTeachingProgress({verdict:'almost',coaching:{focus_key:'forged'}},revision,previous),null);
  console.log('PASS teacher correction queue: idempotency, immutable expiry, capacity, pagination, snapshots, corrections, deletion, namespace isolation and server progress');
} finally { Date.now = oldNow; }
