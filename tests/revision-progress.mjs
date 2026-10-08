import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {applyRevisionFeedback,getRevisionConflict,coachingTargetScope} from '../worker/index.js';
import {nextTeachingProgress} from '../worker/teaching-reviews.js';

const previousScript='我是新人。快帮我。谢谢大家。';
const lesson={focus_key:'user_reason',original:'快帮我。',example:'你们给个普通词，我接一句招呼，想听的朋友帮我上点复活票。',action:'补出具体互动',why:'说明观众做什么，主播接什么'};
const previous={report:{verdict:'almost',coaching:lesson},teachingProgress:{focusKey:'user_reason',attempts:2}};
const makeReport=()=>({verdict:'almost',coaching:{focus_key:'user_reason',original:'其他人都得给我面子。'},structure_checks:['self_intro','gratitude','target_user','user_reason','vote_instruction'].map(key=>({key,status:key==='user_reason'?'partial':'met',evidence:key==='user_reason'?'其他人都得给我面子。':'原有内容'}))});
for(const transform of [text=>text,text=>text.replaceAll('，','；'),text=>'大家好。'+text]) {
  const currentScript=transform(previousScript.replace(lesson.original,lesson.example))+'其他人都得给我面子。';
  const revision={previousScript,currentScript,focusKey:'user_reason',instruction:lesson.action};
  const report=makeReport();
  assert.equal(getRevisionConflict(report,revision,currentScript,previous.report),'');
  applyRevisionFeedback(report,revision,currentScript,previous.report);
  assert.equal(report.revision_check.status,'resolved','完成旧修改与当前另一处同类问题分开记录');
  assert.equal(report.verdict,'almost','不能把整稿晋级');
  assert.equal(report.structure_checks.find(item=>item.key==='user_reason').status,'partial','保留当前问题');
  assert.ok(currentScript.includes(report.revision_check.evidence),'完成依据只用当前稿真实文字');
  assert.match(report.revision_note,/还有另一处/);
  assert.equal(nextTeachingProgress(report,revision,previous).attempts,1,'新问题不累加旧任务失败');
}
const unfinished=makeReport(), unchanged=previousScript+'其他人都得给我面子。';
applyRevisionFeedback(unfinished,{previousScript,focusKey:'user_reason',instruction:lesson.action},unchanged,previous.report);
assert.equal(unfinished.revision_check.status,'still_open','旧原句仍在不能宣布完成');

function session(){
  const context=vm.createContext({console,App:{state:{lastRequest:{scenario:{id:'novice-revival-far-v1'}}}}});
  context.window=context;
  vm.runInContext(readFileSync(new URL('../site/js/report.js',import.meta.url),'utf8'),context);
  return context.Report;
}
for(const status of ['resolved','unverified']) {
  const R=session();
  assert.equal(R._recordResult(makeReport()).focusAttempts,1);
  assert.equal(R._recordResult(makeReport()).focusAttempts,2);
  const report={...makeReport(),revision_check:{focus_key:'user_reason',status}};
  const progress=R._recordResult(report);
  assert.equal(progress.focusAttempts,1,`${status}不得成为第三次卡在同一点`);
  assert.equal(progress.totalAttempts,3,'真实提交次数仍保留');
  assert.equal(progress.focus.key,'user_reason','当前问题仍可继续练');
  assert.equal(R._recordResult(report).focusAttempts,1,'重复渲染不能累加');
  assert.equal(R._recordResult(makeReport()).focusAttempts,2,'下一次真实未解决继续计数');
  const first=session()._recordResult(report);
  assert.equal(first.focusAttempts,1,'重新打开时初次结果为第一轮');
}
for(const revision_check of [{focus_key:'user_reason',status:'still_open'},{focus_key:'user_reason',status:'unexpected'},{focus_key:'expression',status:'resolved'},null]) {
  const R=session();R._recordResult(makeReport());R._recordResult(makeReport());
  assert.equal(R._recordResult({...makeReport(),revision_check}).focusAttempts,3,'其他状态不能误清理真实重复问题');
}
const R=session();R._recordResult(makeReport());
assert.equal(R._recordResult({...makeReport(),verdict:'passed'}).focusAttempts,0);
console.log('PASS revision progress: completed local edits, untouched current grade, truthful evidence, server queue reset and UI resolved/unverified attempt accounting');

// A broad quote touching the adopted edit cannot be treated as a new, separate issue.
{
 const currentScript=previousScript.replace(lesson.original,lesson.example)+'其他人都得给我面子。';
 const broad={...makeReport(),coaching:{focus_key:'user_reason',original:currentScript}};
 const revision={previousScript,currentScript,focusKey:'user_reason',instruction:lesson.action};
 assert.equal(coachingTargetScope(broad,lesson,currentScript),'uncertain');
 applyRevisionFeedback(broad,revision,currentScript,previous.report);
 assert.equal(broad.revision_check.status,'unverified');
 assert.doesNotMatch(broad.revision_note,/还有另一处/);
 const overlap={...makeReport(),coaching:{original:lesson.example.slice(-8)+'谢谢大家。'}};
 assert.equal(coachingTargetScope(overlap,lesson,currentScript),'uncertain','跨过示范边界的引用需要专项核对');
 assert.equal(coachingTargetScope({coaching:{original:'其他人都得给我面子。'}},lesson,currentScript),'elsewhere');
 assert.equal(coachingTargetScope({coaching:{original:lesson.example.replaceAll('，','；')}},lesson,currentScript),'same_edits');
}
