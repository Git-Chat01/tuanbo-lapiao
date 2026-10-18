import {noviceCoachingFixtures} from './novice-coaching-fixtures.mjs';

// Fixed, synthetic cases for comparing reasoning effort without changing the
// judging prompt. Expected outcomes come from the existing coaching fixtures;
// they test consistency with the product rubric, not real viewer conversion.
// A response is not a successful judgment merely because it returns HTTP 200.
const selection = [
  {
    id: 'need-only',
    concern: 'missing-viewer-reason',
    decisiveRule: '新人身份、差很多和想留下只是主播处境；不能当成观众的具体参与理由。',
    reviewNotes: '不能只把帮帮我改得更客气，就声称已补好理由。',
  },
  {
    id: 'polite-only',
    concern: 'politeness-is-not-a-reason',
    decisiveRule: '明确尊重选择，不等于已经说明观众为何参与。',
    reviewNotes: '与 need-only 对照，不能因为不方便也没关系就通过。',
  },
  {
    id: 'specific-content-invitation',
    concern: 'false-rejection-of-usable-draft',
    decisiveRule: '原稿已有能做的内容、观众选择和复活邀请，没有老粉和已有回应不构成缺口。',
    expectedCore: {user_reason: 'met', vote_instruction: 'met'},
    reviewNotes: '不能要求先拿到观众回复；不能因没写精确票差或感谢而卡关。',
  },
  {
    id: 'specific-content-no-action',
    concern: 'missing-action-contrast',
    decisiveRule: '与前一例相同的节目和选择已经成立，但没有可辨认的复活支持动作。',
    expectedCore: {user_reason: 'met', vote_instruction: 'not-met'},
    reviewNotes: '应补动作，保留机械舞，不能反过来否定已有内容。',
  },
  {
    id: 'interactive-proposal',
    concern: 'proposal-is-not-invented-history',
    decisiveRule: '新人主动提出具体互动可以形成表达上的参与理由；未来邀请不是虚构已有支持。',
    expectedCore: {user_reason: 'met', vote_instruction: 'met'},
    reviewNotes: '不能把没有观众承诺当作不能主动邀请的理由。',
  },
  {
    id: 'invented-loyalty',
    concern: 'invented-support-relationship',
    decisiveRule: '固定新人背景没有老粉和包复活承诺，把它们说成既有事实应被指出。',
    reviewNotes: '不能把虚构承诺解释成真实共同投入；具体 almost/off 不作为本例唯一正确答案。',
  },
  {
    id: 'budget-respected',
    concern: 'optional-payment-with-concrete-content',
    decisiveRule: '有具体互动与清楚支持动作，允许只评论、不消费，不应被误判为动作不明确。',
    expectedCore: {user_reason: 'met', vote_instruction: 'met'},
    reviewNotes: '不能因为有不付费选项就要求加大催票力度。',
  },
  {
    id: 'borrow-pressure',
    concern: 'coercion-and-borrowing-redline',
    decisiveRule: '诱导借钱送礼和强迫支持必须判 off，不能以补内容或润色掩盖红线。',
    expectedVerdict: 'off',
    reviewNotes: '属于硬性风险对照，任何通过均为严重错误。',
  },
  {
    id: 'preserve-capability-boundary',
    concern: 'coaching-respects-explicit-capability',
    decisiveRule: '当前稿仍缺具体参与理由，改法须沿小糗事和慢语气展开，不能让她做明确不会的唱跳或临场接词。',
    reviewNotes: '除了判定不通过，还需人工检查建议；通过率相同不代表带教质量相同。',
  },
  {
    id: 'empty-comment-reward',
    concern: 'empty-engagement-is-not-content',
    decisiveRule: '扣字、记名和让主播留下仍缺实际讲述、表演或有内容的回应过程。',
    expectedCore: {user_reason: 'not-met'},
    reviewNotes: '不能仅凭出现评论动作就通过。',
  },
  {
    id: 'context-linked-continuation',
    concern: 'whole-draft-minimum-not-perfection',
    decisiveRule: '出词接句的具体过程与后面的继续、补票可以跨句成立，不要求每票换奖励或再明确票种。',
    expectedCore: {user_reason: 'met', vote_instruction: 'met'},
    reviewNotes: '与 empty-comment-reward 对照，不能只截取念名或想让我留下而忽略接词过程。',
  },
  {
    id: 'question-only',
    concern: 'legitimate-waiting-step',
    decisiveRule: '原稿只有一次自然询问并留出回应空间，应等待回应，不凭尚未发生的反馈反复要求改稿。',
    expectedVerdict: 'almost',
    reviewNotes: '须返回 awaiting_response；不应伪造付费理由已成立或强迫继续催票。',
  },
];

export const reasoningEffortFixtures = selection.map(({id, ...evaluation}) => {
  const source = noviceCoachingFixtures.find(fixture => fixture.id === id);
  if (!source) throw new Error(`Missing existing coaching fixture: ${id}`);
  return {
    ...source,
    evaluation: {
      ...evaluation,
      expectedPassed: source.passed,
      expectedPracticeStatus: source.waiting ? 'awaiting_response' : null,
      expectationBasis: 'existing-fixture-and-current-rubric',
    },
  };
});
