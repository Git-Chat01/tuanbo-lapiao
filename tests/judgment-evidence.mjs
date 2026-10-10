import assert from 'node:assert/strict';
import {quoteBelongsToSource,hasTwoPersonaQuotes,getJudgmentEvidenceIssue,getNoviceRequirementIssue} from '../worker/judgment-evidence.js';
import {normalizeReport,applyReportSafetyGates,splitHardSentences,getReportQualityIssue,validateRecoveredReview,withoutUnverifiedExample,hasCertainAudienceClaim} from '../worker/index.js';
import {parseRecoveryAssessment} from '../worker/review-recovery.js';
import {NOVICE_SCENARIO} from '../worker/current-review.js';
import {detectRedline} from '../worker/redlines.js';

for (const [quote,source] of [
 ['身后没家人','我身后没有别的家人，全靠榜上的哥哥姐姐来帮我。'],
 ['给我一个词','给我一个词。'], ['先左边。再右边。','先左边。再右边。'],
 ['我慢慢说\n你们慢慢听','我慢慢说\n你们慢慢听'],
]) assert.equal(quoteBelongsToSource(quote,source),true,quote);
for (const [quote,source] of [
 ['我会唱歌','我不会唱歌，也不会跳舞。'],
 ['你已答应支持','你如果已答应支持，可以先等主持口令。'],
 ['还差十票','还差一百十票。'],
 ['你答应了','你说，另一个人答应了。'],
 ['我会唱歌','我会说话。她会唱歌。'],
 ['我会唱歌','我会\n唱歌'],
]) assert.equal(quoteBelongsToSource(quote,source),false,quote);
const source='你们先给我一个词，我接一句招呼。想听的朋友帮我上点复活票。';
const diagnosis={card_type:'logic',ai_flavor:'',verdict_reason:'原稿“你们先给我一个词”给出了具体互动入口。'};
assert.equal(getJudgmentEvidenceIssue(diagnosis,source),'');
assert.equal(getJudgmentEvidenceIssue({...diagnosis,coaching:{action:'可以说“先听这一段”，再递邀请。',why:'改后“愿意的帮我上点复活票”说清当下动作。'}},source),'','教学新说法不是原稿引文');
assert.equal(getJudgmentEvidenceIssue({...diagnosis,verdict_reason:'原稿比如“可以说新句”'},source),'','显式举例不假装原句');
assert.equal(getJudgmentEvidenceIssue({...diagnosis,verdict_reason:'你还在说“我会唱歌”'},'我不会唱歌，也不会跳舞。'),'点评引用了当前稿或现场不存在的原句');
assert.equal(getJudgmentEvidenceIssue({...diagnosis,verdict_reason:'对方说“我想听冷笑话”，你已经接住。'},source,{userSignal:'我想听冷笑话'}),'');
const details=[];
assert.match(getJudgmentEvidenceIssue({card_type:'persona',ai_flavor:'像作文'},source,null,details),/两处/);
assert.equal(details[0].field,'ai_flavor');
assert.equal(hasTwoPersonaQuotes('“你们先给我一个词”和“给我一个词”',source),false,'重叠片段不是两处证据');
assert.equal(hasTwoPersonaQuotes('“你们先给我一个词”和“你们先给我一个词”',source),false,'重复同一引文不是两处证据');
assert.equal(hasTwoPersonaQuotes('“你们先给我一个词”和“想听的朋友帮我上点复活票”',source),true);
assert.doesNotThrow(()=>getJudgmentEvidenceIssue({card_type:'logic',ai_flavor:42,line_reviews:{},structure_checks:null},source),'证据检查不因畸形非评分字段直接崩溃');

function raw(script,overrides={}) {
 return {card_type:'logic',verdict:'off',verdict_reason:'请改清这一处。',card_why:'只需调整这处表达。',ai_flavor:'',redline_note:'',
  structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:key==='user_reason'?'partial':'met',evidence:script})),
  line_reviews:splitHardSentences(script).map(original=>({original,mark:'good',comment:'已核对原话。'})),
  interaction_review:{signal_refs:['script:0'],script_refs:[0],judgment:'aligned',reading:'按当前原话判断。',why:'未提供实际反馈。',next_check:'看真实回应。'},
  round_dynamics:{flow_read:'提出复活邀请。',human_drivers:[],response_read:'没有已知回应。',next_move:'调整问题句。'},
  coaching:{focus_key:'mentality',original:splitHardSentences(script)[0],example:'想看的朋友方便就帮一点。',action:'修改这处不当表达。',why:'保持平等邀请。',keep:'保留请求。'},
  direction:{summary:'修改这处表达。',examples:[]},...overrides};
}
function recovered(script,kind,quote,reason,extra={}) {
 const core=[{key:'user_reason',status:'partial',quote,reason:'尚需说明参与的具体内容。'},{key:'vote_instruction',status:'met',quote,reason:'提出了复活请求。'}];
 const focusKey={posture:'mentality',pressure:'mentality',redline:'redline',misread:'line_angle',persona:'persona'}[kind];
 const input={script,voteGap:'far',scenario:NOVICE_SCENARIO};
 const value={core,risks:[{kind,quote,reason,...extra}],awaiting_response:false,
  focus:{focus_key:focusKey,original:quote,keep:'保留原有内容。',action:'针对这处原话修改，不替观众承诺。',why:reason},
  interaction:{reading:'按当前原稿核对。',why:'不编造支持与回应。',next_check:'看真实回应。'}};
 return validateRecoveredReview(parseRecoveryAssessment(value,input),input);
}
const cases=[
 {kind:'posture',script:'求求你帮我上点复活票吧。',quote:'求求你',reason:'这处有显性乞求。',expected:'almost'},
 {kind:'pressure',script:'求求你可怜可怜我，今天别让我走。',quote:'求求你可怜可怜我',reason:'乞求叠加乞怜。',expected:'off'},
 {kind:'redline',script:'没钱也去借钱刷礼物支持我。',quote:'借钱刷礼物',reason:'明确要求借钱消费。',expected:'off'},
 {kind:'misread',script:'老粉们，你们刚才已经答应帮我复活了，把答应的复活票都上了吧。',quote:'你们刚才已经答应帮我复活了',reason:'已知背景没有老用户承诺，却宣称已经答应。',expected:'almost'},
];
for(const c of cases) {
 const report=raw(c.script);
 if(['redline','pressure'].includes(c.kind))report.redline_note='“'+c.quote+'”'+c.reason;
 if(c.kind==='misread')report.interaction_review.judgment='misread';
 const full=normalizeReport(report,c.script);
 applyReportSafetyGates(full,detectRedline(c.script),{sourceScript:c.script,scenario:NOVICE_SCENARIO,voteGap:'far'});
 assert.equal(full.verdict,c.expected,'full '+c.kind);
 assert.equal(recovered(c.script,c.kind,c.quote,c.reason).verdict,full.verdict,'full/recovery '+c.kind);
}
const unsupported=normalizeReport(raw(source,{card_type:'persona',ai_flavor:'像作文',coaching:{...raw(source).coaching,focus_key:'persona'}}),source);
assert.equal(unsupported.ai_flavor,'像作文','不从词表制造证据');
assert.match(getReportQualityIssue(unsupported,source),/两处/,'没有两处原文依据的整稿否定不能交付');
const noviceAdvice=normalizeReport(raw(source,{verdict:'almost',direction:{summary:'保留内容',examples:['我来跳舞。']},line_reviews:splitHardSentences(source).map(original=>({original,mark:'good',comment:'建议加一个跳舞节目。'}))}),source);
applyReportSafetyGates(noviceAdvice,[],{sourceScript:source,scenario:NOVICE_SCENARIO,voteGap:'far'});
assert.deepEqual(noviceAdvice.direction.examples,[],'没有可靠替代示范时不留下空字符串');
assert.ok(noviceAdvice.line_reviews.every(line=>line.comment.includes('没有实际支持时')),'兜底确实改为固定新人场景');
assert.ok(noviceAdvice.line_reviews.every(line=>!line.comment.includes('已经发生的支持')),'固定新人不被教去感谢不存在的支持');


const ready=raw(source,{verdict:'passed',card_why:'只差一句怎么告诉你，必须补评论按钮。'});
ready.structure_checks.forEach(item=>item.status='met');
ready.round_dynamics.human_drivers=[{driver:'control',evidence:'你们先给我一个词',mechanism:'观众选择普通词，主播接招呼。'}];
const readyReport=normalizeReport(ready,source);
applyReportSafetyGates(readyReport,[],{sourceScript:source,scenario:NOVICE_SCENARIO,voteGap:'far'});
assert.equal(readyReport.verdict,'passed');
assert.doesNotMatch(readyReport.card_why,/只差|必须|按钮/,'可选润色不能在通过卡片上变成必改门槛');
assert.equal(readyReport.coaching.focus_key,'final_polish');

const badAction=raw(source,{one_thing:'加一段新才艺',coaching:{...raw(source).coaching,focus_key:'user_reason',action:'学一段新舞，每人来选。'}});
const safeAction=withoutUnverifiedExample(badAction);
assert.equal(safeAction.verdict,badAction.verdict);
assert.equal(safeAction.card_why,badAction.card_why);
assert.doesNotMatch(safeAction.coaching.action,/学一段新舞/,'示范复核失败不能仍留下同一个未经核实的指令');
assert.equal(safeAction.coaching.why,badAction.card_why);
assert.equal(safeAction.round_dynamics.next_move,safeAction.coaching.action);

for(const text of ['观众可能只感到被逼，是否转化未知。','观众也许只会安静看着，仍需观察。','观众或许只感到压力。'])
 assert.equal(hasCertainAudienceClaim(text),false,'不能把带可能性的解释误挡成必然心理：'+text);
for(const text of ['观众一定会上票。','观众只会觉得无聊。','观众可能犹豫，但一定会来支持。'])
 assert.equal(hasCertainAudienceClaim(text),true,'明确必然心理仍必须拦住：'+text);
assert.equal(getJudgmentEvidenceIssue({...diagnosis,structure_checks:[{key:'target_user',evidence:'照顾“没预算的”这一类观众。'}],coaching:{keep:'保留“听糗事”的内容点。'}},source),'','内容概括与人群标签不冒充严格原句证据');



const needlessNumbers={structure_checks:[{key:'vote_instruction',status:'partial',evidence:'把票补上能听出上票，但复活目标、票种和当前缺口都未交代。'}]};
assert.match(getNoviceRequirementIssue(needlessNumbers,NOVICE_SCENARIO),/不得/);
assert.equal(getNoviceRequirementIssue(needlessNumbers,{phase:'pledging'}),'','有具体认领账目的其他场景不套新人规则');
assert.equal(getNoviceRequirementIssue({structure_checks:[{key:'vote_instruction',status:'partial',evidence:'只有看节目和帮一下，未说当前希望观众怎样参与复活。'}]},NOVICE_SCENARIO),'','没有实际动作仍需修改');
assert.throws(()=>validateRecoveredReview({...raw(source),structure_checks:needlessNumbers.structure_checks},{script:source,scenario:NOVICE_SCENARIO}),e=>/不得/.test(e.recoveryIssue),'恢复流程不能用额外数字门槛卡关');

for(const evidence of ['没报具体票数不影响理解，真正问题是没说怎么参与。','不是因为没报票种，而是整稿只有看节目。','没有票种没关系，但补一下不明确要做什么。'])
 assert.equal(getNoviceRequirementIssue({structure_checks:[{key:'vote_instruction',status:'partial',evidence}]},NOVICE_SCENARIO),'','不能把否定额外门槛误当额外门槛');

console.log('PASS judgment evidence, local risk consistency, qualified audience claims, pass summaries and safe teaching fallback');
