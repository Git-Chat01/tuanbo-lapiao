import assert from 'node:assert/strict';
import { assessCoachingAdoption, normalizeCoachingText } from '../worker/revision-consistency.js';

let checks = 0;
const assess = (source, current, lesson, status, description) => {
  const actual = assessCoachingAdoption(source, current, lesson);
  assert.equal(actual.status, status, `${description}: ${JSON.stringify(actual)}`);
  checks++;
  return actual;
};
const source = '我是新人小满。我需要复活，快帮帮我。我会机械舞。谢谢大家听我说。';
const lesson = { original: '我需要复活，快帮帮我。', example: '想看机械舞的朋友，你们选方向；帮我上一点复活票。' };
const revised = source.replace(lesson.original, lesson.example);
assess(source, revised, lesson, 'adopted', '完整采纳');
assess(source, revised.replace('，', '。').replace('；', '，'), lesson, 'adopted', '非语义分句标点互换');
assess(source, revised.replace('你们选方向', '你 们\n选 方 向'), lesson, 'adopted', '中文布局空白');
assess(source, revised.replace('我是新人小满。', '大家好，我是小满。'), lesson, 'adopted', '无关自我介绍修改');
assess(source, revised + '我先听听大家的回应。', lesson, 'adopted', '无关末段添加');
assess(source, source, lesson, 'not_adopted', '原稿未动');
assess(source, source + lesson.example, lesson, 'not_adopted', '只追加示范而未删除原问题');
assess(source, revised.replace('你们选方向', '方向交给大家选'), lesson, 'needs_review', '同义改写交给专项复核');
assess(source, revised.replace(lesson.example, '不要' + lesson.example), lesson, 'needs_review', '不能把被否定的示范当采纳');
assess(source, revised.replace(lesson.example, '“' + lesson.example + '”'), lesson, 'needs_review', '新增引述不能直接当行动');
assess(source, revised + lesson.example, lesson, 'needs_review', '示范重复出现保守处理');
assess(source + lesson.original, revised, lesson, 'needs_review', '旧稿重复原句不能消歧');
assess(source, revised, { ...lesson, related_edits: [{ original: '快帮帮我', example: '请大家看看' }] }, 'needs_review', '拒绝重叠原句');
assess(source, revised, { ...lesson, related_edits: [{ original: '虚构的原句', example: '新句' }] }, 'needs_review', '拒绝不存在的原句');

const multiSource = '你们已经答应支持了。我会机械舞。把答应我的票上了吧。谢谢大家听我说。';
const multiLesson = { original: '你们已经答应支持了。', example: '我是新人小满。', related_edits: [{ original: '把答应我的票上了吧。', example: '想看机械舞的朋友，帮我上点复活票。' }] };
const multiRevised = '我是新人小满。我会机械舞。想看机械舞的朋友，帮我上点复活票。谢谢大家听我说。';
assess(multiSource, multiRevised + '我先听听回应。', multiLesson, 'adopted', '所有关联修改完成且其他内容变化');
assess(multiSource, multiSource.replace(multiLesson.original, multiLesson.example), multiLesson, 'not_adopted', '漏掉关联修改');
assess(multiSource, multiSource.replace(multiLesson.related_edits[0].original, multiLesson.related_edits[0].example), multiLesson, 'not_adopted', '漏掉主修改');
const deleteLesson = { ...multiLesson, related_edits: [{ original: '把答应我的票上了吧。', example: '' }] };
const deleted = '我是新人小满。我会机械舞。谢谢大家听我说。';
assess(multiSource, deleted, deleteLesson, 'adopted', '删除型关联修改');
assess(multiSource, deleted + '愿意的朋友可以回应一下。', deleteLesson, 'adopted', '删除接缝保留且远处增加内容');
assess(multiSource, multiSource.replace(multiLesson.original, multiLesson.example), deleteLesson, 'not_adopted', '不能漏删');
assess(multiSource, deleted.replace('我会机械舞。', '你们必须给我投票。'), deleteLesson, 'needs_review', '删除处被别的内容替代不能确认完成');
assess(multiSource, deleted + '把答应我的票上了吧。', deleteLesson, 'not_adopted', '原问题移动到末尾不算删除');

const questionSource = '大家好。你们救我就有面子。谢谢大家。';
const questionLesson = { original: '你们救我就有面子。', example: '你们想看机械舞吗？' };
const questionRevised = questionSource.replace(questionLesson.original, questionLesson.example);
assess(questionSource, questionRevised.replace('？', '?') + '我听听回应。', questionLesson, 'adopted', '中英文问号等价');
assess(questionSource, questionRevised.replace('？', '。'), questionLesson, 'needs_review', '问句改陈述不得视作标点格式');
const partialQuestion = { original: '你们救我就有面子', example: '你们想看机械舞' };
assess(questionSource, questionSource.replace(partialQuestion.original, partialQuestion.example).replace('机械舞。', '机械舞？') + '我听听回应。', partialQuestion, 'needs_review', '引用末尾外的问号仍影响含义');
const numberSource = '大家好。我希望得到十票。谢谢大家听我说。';
for (const [example, mutated, description] of [
  ['这次还差1.5票。', '这次还差15票。', '小数点'],
  ['这一轮变化是-5票。', '这一轮变化是5票。', '负号'],
  ['这一轮变化是+5票。', '这一轮变化是-5票。', '正负号'],
  ['复活还差1,000票。', '复活还差1000票。', '数字内逗号保守保留'],
]) {
  const numeric = { original: '我希望得到十票。', example };
  assess(numberSource, numberSource.replace(numeric.original, mutated), numeric, 'needs_review', `${description}不能被忽略`);
}
const shortSource = '我是新人小满。我说：来吧。谢谢大家愿意听我说。';
const shortLesson = { original: '来吧', example: '想看吗' };
const shortRevised = shortSource.replace(shortLesson.original, shortLesson.example);
assess(shortSource, shortRevised, shortLesson, 'adopted', '短示范完整采纳仍兼容');
assess(shortSource, shortRevised + '我先听听大家。', shortLesson, 'adopted', '短示范有足够不变局部上下文');
assess(shortSource, '大家好。想看吗。谢谢你。', shortLesson, 'needs_review', '短示范缺少定位上下文');
const fragmentSource = '凯哥，你这五个已经到账了。大家再帮我组一下。';
const fragmentLesson = { original: '你这五个已经到账了', example: '你认的五个我记好了，等主持喊再丢' };
assess(fragmentSource, fragmentSource.replace(fragmentLesson.original, fragmentLesson.example) + '另外改了内容。', fragmentLesson, 'adopted', '原有局部示范容许无关附加句');
assert.notEqual(normalizeCoachingText('不，支持'), normalizeCoachingText('不支持'), '不删除会改变断句的标点');
assert.notEqual(normalizeCoachingText('now here'), normalizeCoachingText('nowhere'), '不合并英文词');
assert.equal(normalizeCoachingText('想看就来.我先听听。'), normalizeCoachingText('想看就来。我先听听。'), '中文句内英文句号兼容');
assert.deepEqual(assessCoachingAdoption(source, revised, lesson), { status: 'adopted', reason: 'exact_plan' }, '函数只报告采纳证据，不返回或改变通过分数');
console.log(`PASS revision consistency (${checks} adoption cases plus punctuation/meaning boundaries)`);
