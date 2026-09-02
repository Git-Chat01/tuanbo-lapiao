import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const toDataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;

async function loadCasesModule() {
  const source = await readFile(new URL("../worker/cases.js", import.meta.url), "utf8");
  return import(toDataUrl(source));
}

async function loadPromptModule() {
  const source = await readFile(new URL("../worker/prompt.js", import.meta.url), "utf8");
  return import(toDataUrl(source));
}

async function loadIndexModule() {
  let source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
  source = source
    .replace(
      'import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";',
      'const SYSTEM_PROMPT = ""; const buildUserPrompt = (...args) => { globalThis.__lastBuildUserPromptArgs = args; return "test prompt"; };'
    )
    .replace(
      /import \{\s*retrieveCases,\s*tryAbsorb,\s*addManualCase,\s*publishCase,\s*listAdminCases,\s*softDeleteCase,?\s*\} from "\.\/cases\.js";/,
      "const retrieveCases = async (...args) => { globalThis.__retrieveCasesArgs = args; return []; }; const tryAbsorb = async (...args) => { globalThis.__tryAbsorbArgs = args; return null; }; const addManualCase = async () => ''; const publishCase = async (...args) => { globalThis.__publishCaseArgs = args; return globalThis.__publishCaseResult || { ok: true, alreadyPublished: false, publishedAt: 1 }; }; const listAdminCases = async () => ({ items: [] }); const softDeleteCase = async () => false;"
    )
    .replace(
      'import { detectRedline } from "./redlines.js";',
      "const detectRedline = () => [];"
    );
  return import(toDataUrl(source));
}

class MemoryKV {
  constructor(entries = []) {
    this.values = new Map(entries.map(([key, value]) => [key, JSON.stringify(value)]));
  }

  async list({ prefix = "" } = {}) {
    const keys = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }

  async get(key, type) {
    const raw = this.values.get(key);
    if (raw === undefined) return null;
    return type === "json" ? JSON.parse(raw) : raw;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

const cases = await loadCasesModule();
const prompt = await loadPromptModule();
const index = await loadIndexModule();

assert.match(prompt.SYSTEM_PROMPT, /姿态判断与用户支点判断是两条独立轴/u);
assert.match(prompt.SYSTEM_PROMPT, /“?帮我组一组“?.{0,80}不是求情/u);
assert.match(prompt.SYSTEM_PROMPT, /求一求你了/u);
assert.match(prompt.SYSTEM_PROMPT, /我给你跪下了/u);
assert.match(prompt.SYSTEM_PROMPT, /案例不能推翻硬边界/u);
assert.match(prompt.SYSTEM_PROMPT, /再把局部书面和整篇作文朗诵分开/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /两个及以上点名片段反复使用.{0,120}点名.{0,120}解读昵称\/主页.{0,120}漂亮收口/u
);
assert.match(prompt.SYSTEM_PROMPT, /点名片段或意群横向比较，不要求原稿真的换行分段/u);
assert.match(prompt.SYSTEM_PROMPT, /单次出现"既然\/每一\/到底".{0,40}不能单独触发/u);
assert.match(prompt.SYSTEM_PROMPT, /ai_flavor 至少逐字引用两处原句/u);
assert.match(prompt.SYSTEM_PROMPT, /原稿是“A；B。”.{0,80}“A；”和“B。”/u);
assert.match(prompt.SYSTEM_PROMPT, /(?:组一个|帮一把|投一票).{0,120}vote_instruction.{0,80}met/u);
assert.match(prompt.SYSTEM_PROMPT, /recentGift 或 timeline 里的 gift 只证明可观察到的送礼\/付费参与/u);
assert.match(prompt.SYSTEM_PROMPT, /不能自动推成支持、喜欢或关系态度/u);
assert.match(prompt.SYSTEM_PROMPT, /不能把过去动作直接当 user_reason/u);
assert.match(prompt.SYSTEM_PROMPT, /20.{0,80}18.{0,80}8.{0,160}(?:整轮|递减|进展|反馈)/u);
assert.match(prompt.SYSTEM_PROMPT, /target_user \/ user_reason \/ vote_instruction 是三项彼此独立的原子能力/u);
assert.match(prompt.SYSTEM_PROMPT, /第 3 项只看有没有明确对到人.{0,80}第 4 项只看有没有给用户侧价值.{0,100}第 5 项看有没有递出“当前阶段能执行的动作”/u);
assert.match(prompt.SYSTEM_PROMPT, /“刀 \/ 刺 \/ 刺客 \/ 刀门”是本轮给主播上“下去票”的玩法动作/u);
assert.match(prompt.SYSTEM_PROMPT, /已经确认占位的数量.{0,120}未报数但直接送出/u);
assert.match(prompt.SYSTEM_PROMPT, /“加一个”.{0,80}累计追加 1/u);
assert.match(prompt.SYSTEM_PROMPT, /“28活”表示本轮需要 28 个约定的复活礼物单位/u);
assert.match(prompt.SYSTEM_PROMPT, /“抹零”.{0,120}差 15 时认领 5 个、差 14 时认领 4 个/u);
assert.match(prompt.SYSTEM_PROMPT, /现场拉票自然口径说“多少个 \/ 多少手”.{0,40}不要教新人说“多少份”/u);
assert.match(prompt.SYSTEM_PROMPT, /“医药费”.{0,120}不是真实债务/u);
assert.match(prompt.SYSTEM_PROMPT, /phase=awaiting_drop.{0,180}等主持统一口令/u);
assert.match(prompt.SYSTEM_PROMPT, /phase=delivery.{0,180}实际到账.{0,80}不再继续等/u);
assert.match(prompt.SYSTEM_PROMPT, /复活倒计时由主持.{0,100}动态把控/u);
assert.match(prompt.SYSTEM_PROMPT, /rank\/TOP 公告只是榜单结果播报/u);
assert.match(prompt.SYSTEM_PROMPT, /(?:多个用户|切换用户|人名切换|轮流点名).{0,160}(?:不能|不得).{0,80}(?:错人|不匹配|降级)/u);
assert.match(prompt.SYSTEM_PROMPT, /"凯哥，谢谢你刚才的小心心".{0,60}两项都可判 met/u);
assert.match(prompt.SYSTEM_PROMPT, /不要求再加"扣1"或"补一票"/u);
assert.match(prompt.SYSTEM_PROMPT, /round_dynamics/u);
assert.match(prompt.SYSTEM_PROMPT, /flow_read/u);
assert.match(prompt.SYSTEM_PROMPT, /human_drivers/u);
assert.match(prompt.SYSTEM_PROMPT, /response_read/u);
assert.match(prompt.SYSTEM_PROMPT, /next_move/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /原稿没有才艺、节目或整活.{0,120}不要把.{0,40}才艺诱饵.{0,40}默认答案/u
);
assert.doesNotMatch(prompt.SYSTEM_PROMPT, /verdict=passed 必须同时满足：五项全 met/u);
assert.doesNotMatch(prompt.SYSTEM_PROMPT, /vote_instruction 必须同时有主播原话中的准确票差/u);
assert.deepEqual(cases.extractTags("帮帮忙，拜托大家帮我组一组"), []);
assert.deepEqual(cases.extractTags("求一求你了，我给你跪下了"), ["求一求", "跪下"]);

const structureKeys = [
  "self_intro",
  "gratitude",
  "target_user",
  "user_reason",
  "vote_instruction",
];
const allMetChecks = () =>
  structureKeys.map((key) => ({ key, status: "met", evidence: `${key}证据` }));
const validRoundDynamics = (overrides = {}) => ({
  flow_read: "票数从20追到8，整轮在持续推进",
  human_drivers: [
    {
      driver: "social_proof",
      evidence: "月月姐先补一手，其他人开始跟",
      mechanism: "已有真实行动降低了其他观众跟票的犹豫",
    },
  ],
  response_read: "点名后的补票说明观众接住了这一拍",
  next_move: "继续接住最新出手的人，再把下一手递给愿意跟的观众",
  ...overrides,
});
const makeRawReport = (overrides = {}) => ({
  card_type: "logic",
  card_why: "结构与方向正确",
  audience: "榜一和散户",
  structure_checks: allMetChecks(),
  verdict: "passed",
  verdict_reason: "可以过关",
  echo: "你想给两边都递戏",
  line_reviews: [{ original: "测试原句", mark: "good", comment: "方向正确" }],
  one_thing: "先对准人",
  direction: { summary: "保持方向，用你自己的话说", examples: [] },
  round_dynamics: validRoundDynamics(),
  ai_flavor: "",
  redline_note: "",
  ...overrides,
});
const makeReportForScript = (script, overrides = {}) =>
  index.normalizeReport(
    makeRawReport({
      ...overrides,
      line_reviews: overrides.line_reviews || [
        { original: script, mark: "good", comment: "方向正确" },
      ],
    }),
    script
  );

// 红线不论模型原判什么都必须 off；persona 不得 passed。
const redlineAlmost = {
  card_type: "logic",
  verdict: "almost",
  verdict_reason: "方向差一点",
  redline_note: "",
};
index.applyReportSafetyGates(redlineAlmost, ["下注"]);
assert.equal(redlineAlmost.verdict, "off");
assert.match(redlineAlmost.redline_note, /下注/);

const modelRedlineAlmost = {
  card_type: "logic",
  verdict: "almost",
  verdict_reason: "方向差一点",
  redline_note: "这句存在平台风险，不能播",
};
index.applyReportSafetyGates(modelRedlineAlmost, []);
assert.equal(modelRedlineAlmost.verdict, "off");

const personaPassed = index.normalizeReport(
  makeRawReport({ card_type: "persona", verdict_reason: "结构完整" })
);
index.applyReportSafetyGates(personaPassed, []);
assert.equal(personaPassed.verdict, "off");

const cleanPassed = index.normalizeReport(makeRawReport({ verdict_reason: "方向正确" }));
index.applyReportSafetyGates(cleanPassed, []);
assert.equal(cleanPassed.verdict, "passed");
assert.equal(cleanPassed._lineReviewsContractValid, true);
assert.equal(JSON.stringify(cleanPassed).includes("_lineReviewsContractValid"), false);

// 模型仅因“还能更好”保守给 almost，但五项与安全硬门槛全部满足时，后端应稳定晋级。
const conservativeAlmost = index.normalizeReport(
  makeRawReport({ verdict: "almost", verdict_reason: "互动还可以更强" }),
  "测试原句"
);
index.applyReportSafetyGates(conservativeAlmost, []);
assert.equal(conservativeAlmost.verdict, "passed");
assert.match(conservativeAlmost.verdict_reason, /达到文字稿门槛/);

const partialButQualifiedAlmost = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    line_reviews: [{ original: "测试原句", mark: "partial", comment: "可以再口语一点" }],
  }),
  "测试原句"
);
index.applyReportSafetyGates(partialButQualifiedAlmost, []);
assert.equal(partialButQualifiedAlmost.verdict, "passed");

const normalizedRoundDynamics = index.normalizeReport(makeRawReport(), "测试原句");
assert.deepEqual(normalizedRoundDynamics.round_dynamics, validRoundDynamics());

const invalidRoundDynamicsCases = [
  ["缺少整个字段", undefined],
  ["flow_read 为空", validRoundDynamics({ flow_read: "" })],
  ["human_drivers 为空", validRoundDynamics({ human_drivers: [] })],
  [
    "human_drivers 超过3项",
    validRoundDynamics({
      human_drivers: [
        ...validRoundDynamics().human_drivers,
        { driver: "status", evidence: "成为关键人物", mechanism: "关键一手带来地位感" },
        { driver: "belonging", evidence: "老朋友一起守", mechanism: "共同经历形成归属" },
        { driver: "urgency", evidence: "最后十秒", mechanism: "时间窗口推动立即行动" },
      ],
    }),
  ],
  [
    "driver 枚举非法",
    validRoundDynamics({
      human_drivers: [{ driver: "keyword_only", evidence: "保护欲", mechanism: "因为写了保护欲" }],
    }),
  ],
  [
    "driver evidence 为空",
    validRoundDynamics({
      human_drivers: [{ driver: "protection", evidence: "", mechanism: "新人紧张让观众愿意照顾" }],
    }),
  ],
  [
    "driver mechanism 为空",
    validRoundDynamics({
      human_drivers: [{ driver: "visibility", evidence: "全场都看见你补最后一手", mechanism: "" }],
    }),
  ],
  ["response_read 为空", validRoundDynamics({ response_read: "" })],
  ["next_move 为空", validRoundDynamics({ next_move: "" })],
];

for (const [label, roundDynamics] of invalidRoundDynamicsCases) {
  const raw = makeRawReport({ round_dynamics: roundDynamics });
  if (roundDynamics === undefined) delete raw.round_dynamics;
  const normalizedInvalidRound = index.normalizeReport(raw, "测试原句");
  index.applyReportSafetyGates(normalizedInvalidRound, []);
  assert.notEqual(
    normalizedInvalidRound.verdict,
    "passed",
    `round_dynamics 契约无效时不得 passed：${label}`
  );
}

for (const driver of [
  "visibility",
  "status",
  "protection",
  "belonging",
  "control",
  "curiosity",
  "competition",
  "social_proof",
  "reciprocity",
  "urgency",
  "other",
]) {
  const raw = makeRawReport({
    round_dynamics: validRoundDynamics({
      human_drivers: [{ driver, evidence: `${driver}现场证据`, mechanism: `${driver}作用机制` }],
    }),
  });
  const normalizedValidDriver = index.normalizeReport(raw, "测试原句");
  index.applyReportSafetyGates(normalizedValidDriver, []);
  assert.equal(normalizedValidDriver.verdict, "passed", `合法 driver 应保留 passed：${driver}`);
}

const actionWithoutExactVoteGap = index.normalizeReport(
  makeRawReport(),
  "大家愿意就帮我补一点。"
);
index.applyReportSafetyGates(actionWithoutExactVoteGap, [], {
  sourceScript: "大家愿意就帮我补一点。",
});
assert.equal(
  actionWithoutExactVoteGap.structure_checks.find((item) => item.key === "vote_instruction")
    ?.status,
  "met",
  "已有明确补票动作时 vote_instruction 应 met，不再把准确差额当作隐藏门槛"
);
assert.equal(
  actionWithoutExactVoteGap.structure_checks.find((item) => item.key === "user_reason")
    ?.status,
  "partial"
);
assert.equal(
  actionWithoutExactVoteGap.verdict,
  "almost",
  "只缺 user_reason 是一个核心缺口，应留在可局部修正的 almost"
);

const actionWithExactChineseVoteGap = index.normalizeReport(
  makeRawReport(),
  "现在还差十票，大家愿意就帮我补一点。"
);
index.applyReportSafetyGates(actionWithExactChineseVoteGap, [], {
  sourceScript: "现在还差十票，大家愿意就帮我补一点。",
});
assert.equal(
  actionWithExactChineseVoteGap.structure_checks.find((item) => item.key === "vote_instruction")
    ?.status,
  "met"
);

for (const explicitVoteActionScript of [
  "凯哥，想看返场就帮我组一个。",
  "凯哥，想看新舞就帮我一把。",
  "凯哥，想看这段才艺就投一票。",
]) {
  const explicitVoteAction = makeReportForScript(explicitVoteActionScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "vote_instruction" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(explicitVoteAction, [], {
    sourceScript: explicitVoteActionScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    explicitVoteAction.structure_checks.find((item) => item.key === "vote_instruction")
      ?.status,
    "met",
    `明确动作无需再报准确差额：${explicitVoteActionScript}`
  );
}

const exactTwoTicketFeedbackScript =
  "刚开口还差20个，月月姐组了两个，现在还差18个，小唐哥你愿意就接下一手。";
const exactTwoTicketFeedback = makeReportForScript(exactTwoTicketFeedbackScript, {
  round_dynamics: validRoundDynamics({
    flow_read: "票差有变化",
    response_read: "有人响应",
  }),
});
index.applyReportSafetyGates(exactTwoTicketFeedback, [], {
  sourceScript: exactTwoTicketFeedbackScript,
});
assert.match(
  exactTwoTicketFeedback.round_dynamics.response_read,
  /20.{0,24}18.{0,24}2个上票反馈/u,
  "20→18 必须确定性读成期间收到2个上票反馈"
);

const stalledTicketFeedbackScript =
  "现在还差17个，多多哥能组一组吗？谢谢久皇哥，现在还差15个，老朋友们再冲一冲，现在还差15个。";
const stalledTicketFeedback = makeReportForScript(stalledTicketFeedbackScript, {
  round_dynamics: validRoundDynamics({
    flow_read: "票差从17到15再到15，前两拍各收到2个反馈。",
    response_read: "前两拍各收到2个反馈。",
  }),
});
index.applyReportSafetyGates(stalledTicketFeedback, [], {
  sourceScript: stalledTicketFeedbackScript,
});
assert.match(
  stalledTicketFeedback.round_dynamics.response_read,
  /17.{0,24}15.{0,24}2个上票反馈.{0,40}仍是15.{0,24}暂未看到新的票差变化/u,
  "17→15→15 只能确认一次减少2，随后应读成暂时没变化"
);
assert.doesNotMatch(
  `${stalledTicketFeedback.round_dynamics.flow_read}${stalledTicketFeedback.round_dynamics.response_read}`,
  /前两拍各收到2/u,
  "模型的错误算术不得残留在报告"
);

const qualifiedAlmostWithDetectedRedline = index.normalizeReport(
  makeRawReport({ verdict: "almost" }),
  "测试原句"
);
index.applyReportSafetyGates(qualifiedAlmostWithDetectedRedline, ["下注"]);
assert.equal(qualifiedAlmostWithDetectedRedline.verdict, "off");

const qualifiedAlmostWithPersona = index.normalizeReport(
  makeRawReport({ verdict: "almost", card_type: "persona", ai_flavor: "像套话" }),
  "测试原句"
);
index.applyReportSafetyGates(qualifiedAlmostWithPersona, []);
assert.equal(qualifiedAlmostWithPersona.verdict, "off");

const modelOffStaysOff = index.normalizeReport(
  makeRawReport({ verdict: "off" }),
  "测试原句"
);
index.applyReportSafetyGates(modelOffStaysOff, []);
assert.equal(modelOffStaysOff.verdict, "off");

const missingAiFlavorAlmost = index.normalizeReport(
  makeRawReport({ verdict: "almost", ai_flavor: undefined }),
  "测试原句"
);
index.applyReportSafetyGates(missingAiFlavorAlmost, []);
assert.equal(missingAiFlavorAlmost.verdict, "almost");
assert.equal(missingAiFlavorAlmost._safetyFieldsContractValid, false);

const nullRedlinePassed = index.normalizeReport(
  makeRawReport({ redline_note: null }),
  "测试原句"
);
index.applyReportSafetyGates(nullRedlinePassed, []);
assert.equal(nullRedlinePassed.verdict, "almost");
assert.equal(JSON.stringify(nullRedlinePassed).includes("_safetyFieldsContractValid"), false);

const twoStructureGapsWithoutSupport = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "gratitude" || item.key === "user_reason"
        ? { ...item, status: "partial" }
        : item
    ),
  }),
  "测试原句"
);
index.applyReportSafetyGates(twoStructureGapsWithoutSupport, []);
assert.equal(
  twoStructureGapsWithoutSupport.verdict,
  "almost",
  "gratitude 是非核心项，和一个 user_reason 缺口叠加也不应误判成整体 off"
);

const oneUserReasonGap = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  }),
  "测试原句"
);
index.applyReportSafetyGates(oneUserReasonGap, []);
assert.equal(oneUserReasonGap.verdict, "almost");

const oneGapWithTwoWrongLines = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
    line_reviews: [
      { original: "第一句。", mark: "wrong", comment: "第一处方向错" },
      { original: "第二句。", mark: "wrong", comment: "第二处方向错" },
    ],
  }),
  "第一句。第二句。"
);
index.applyReportSafetyGates(oneGapWithTwoWrongLines, []);
assert.equal(oneGapWithTwoWrongLines.verdict, "off");

const oneGapWithOneWrongLine = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
    line_reviews: [{ original: "测试原句", mark: "wrong", comment: "一处局部错误" }],
  }),
  "测试原句"
);
index.applyReportSafetyGates(oneGapWithOneWrongLine, []);
assert.equal(oneGapWithOneWrongLine.verdict, "almost");

for (const genericTargetScript of [
  "家人们，你们想看就补一点。",
  "大哥，你愿意就补一点。",
  "宝宝，你愿意就补一点。",
  "哥哥，你愿意就补一点。",
  "帅哥，你愿意就补一点。",
  "美女，想看就扣1。",
  "小美女，你愿意就补一点。",
  "靓仔，你愿意就补一点。",
  "哥们，你愿意就补一点。",
  "兄弟，你愿意就补一点。",
  "姐妹，你愿意就补一点。",
  "宝子，你愿意就补一点。",
  "老铁，你愿意就补一点。",
  "大佬，你愿意就补一点。",
  "拜托大家，你们想看就补一点。",
  "兄弟们，你们想看就补一点。",
  "各位，你们想看就补一点。",
  "这一轮，你们想看就补一点。",
]) {
  const genericAudienceTarget = makeReportForScript(genericTargetScript);
  index.applyReportSafetyGates(genericAudienceTarget, [], {
    sourceScript: genericTargetScript,
    scenario: null,
  });
  assert.equal(
    genericAudienceTarget.structure_checks.find((item) => item.key === "target_user").status,
    "partial",
    `泛称不能算具体用户：${genericTargetScript}`
  );
  assert.equal(
    genericAudienceTarget.verdict,
    genericTargetScript.includes("扣1") ? "almost" : "passed",
    `泛称本身不挡通过；只有“扣1”这类非要票动作仍应保留核心缺口：${genericTargetScript}；${genericAudienceTarget.verdict_reason}`
  );
}

for (const namedTargetScript of [
  "凯哥，你愿意就补一点。",
  "明哥，你愿意就补一点。",
  "小王，你愿意就补一点。",
  "榜一，冲啊，愿意就补一点。",
  "@orange，你想看就补一点。",
]) {
  const namedTarget = makeReportForScript(namedTargetScript);
  index.applyReportSafetyGates(namedTarget, [], {
    sourceScript: namedTargetScript,
    scenario: null,
  });
  assert.equal(
    namedTarget.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `直接昵称应算具体用户：${namedTargetScript}`
  );
}

const wrongScenarioTargetScript = "小王，你愿意就补一点。";
const wrongScenarioTarget = makeReportForScript(wrongScenarioTargetScript);
index.applyReportSafetyGates(wrongScenarioTarget, [], {
  sourceScript: wrongScenarioTargetScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(
  wrongScenarioTarget.structure_checks.find((item) => item.key === "target_user").status,
  "met",
  "整轮话术切到另一个具体用户时仍完成了点到人，不能被单一场景名降级"
);

const decreasingRoundScript =
  "我是第一次上十连的跳跳糖，想把新舞跳完。多多哥，谢谢你先帮我补了一手。刚开口还差20个星辰，月月姐接上后到18个，现在小唐哥又帮一把，只差8个。00姐姐想看返场就帮我组一个，小明哥也可以投一票，其他想看的家人们跟一下。";
const decreasingRound = makeReportForScript(decreasingRoundScript, {
  line_reviews: [
    { original: "我是第一次上十连的跳跳糖，想把新舞跳完。", mark: "good", comment: "新人和看点清楚" },
    { original: "多多哥，谢谢你先帮我补了一手。", mark: "good", comment: "接住具体支持" },
    { original: "刚开口还差20个星辰，月月姐接上后到18个，现在小唐哥又帮一把，只差8个。", mark: "good", comment: "数字是在复述整轮进展" },
    { original: "00姐姐想看返场就帮我组一个，小明哥也可以投一票，其他想看的家人们跟一下。", mark: "good", comment: "给不同用户递出明确动作" },
  ],
  round_dynamics: validRoundDynamics({
    flow_read: "从20到18再到8，多个数字是在复述整轮递减进展",
    human_drivers: [
      {
        driver: "social_proof",
        evidence: "月月姐和小唐哥先后接上",
        mechanism: "连续有人出手会带动其他观众跟进",
      },
    ],
  }),
});
index.applyReportSafetyGates(decreasingRound, [], {
  sourceScript: decreasingRoundScript,
  scenario: { targetUser: "凯哥", votesNeeded: 20 },
});
assert.equal(
  decreasingRound.structure_checks.find((item) => item.key === "target_user").status,
  "met",
  "多个人名和用户切换不能因不匹配场景 targetUser 而降级"
);
assert.equal(
  decreasingRound.structure_checks.find((item) => item.key === "vote_instruction").status,
  "met",
  "20→18→8 是整轮反馈，且组一个/帮一把/投一票已给出明确动作"
);
assert.equal(decreasingRound.verdict, "passed", "递减数字本身不能阻止完整好稿通过");

const gratitudeOnlyTargetScript = "凯哥，谢谢你刚才的小心心。家人们现在补一点。";
const gratitudeOnlyTarget = makeReportForScript(gratitudeOnlyTargetScript, {
  line_reviews: [
    { original: "凯哥，谢谢你刚才的小心心。", mark: "good", comment: "感谢正确" },
    { original: "家人们现在补一点。", mark: "good", comment: "群体指令" },
  ],
});
index.applyReportSafetyGates(gratitudeOnlyTarget, [], {
  sourceScript: gratitudeOnlyTargetScript,
  scenario: { targetUser: "凯哥", recentGift: "凯哥刚送了小心心" },
});
assert.equal(
  gratitudeOnlyTarget.structure_checks.find((item) => item.key === "gratitude").status,
  "met",
  "点名并接住具体礼物的感谢应保留 met"
);
assert.equal(
  gratitudeOnlyTarget.structure_checks.find((item) => item.key === "target_user").status,
  "met",
  "直接称呼式感谢既完成 gratitude，也确实在对目标用户说话"
);

const genericGratitudeScript =
  "我是今天第一天来的小满。谢谢大家！凯哥，冲啊！现在还差320票，大家上票。";
const genericGratitude = makeReportForScript(genericGratitudeScript);
index.applyReportSafetyGates(genericGratitude, [], {
  sourceScript: genericGratitudeScript,
  scenario: { targetUser: "凯哥", recentGift: "凯哥刚送了小心心" },
});
assert.equal(
  genericGratitude.structure_checks.find((item) => item.key === "gratitude").status,
  "partial",
  "现场有具体礼物时，泛泛的“谢谢大家”不能虚判为接住礼物"
);

for (const directlyThankedTargetScript of [
  "凯哥，谢谢你刚才的小心心，家人们现在补一点。",
  "凯哥，谢谢你，小王你愿意就补一点。",
  "凯哥，谢谢你，那你们想看的都补一票。",
  "凯哥，谢谢你，你们一起补一票。",
]) {
  const directlyThankedTarget = makeReportForScript(directlyThankedTargetScript);
  index.applyReportSafetyGates(directlyThankedTarget, [], {
    sourceScript: directlyThankedTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    directlyThankedTarget.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `直接向凯哥道谢本身就是对凯哥说话，后句动作不归本项：${directlyThankedTargetScript}`
  );
}

const thankedAndAddressedScript = "凯哥，谢谢你刚才的小心心，这轮你愿意就补一点。";
const thankedAndAddressed = makeReportForScript(thankedAndAddressedScript);
index.applyReportSafetyGates(thankedAndAddressed, [], {
  sourceScript: thankedAndAddressedScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(
  thankedAndAddressed.structure_checks.find((item) => item.key === "target_user").status,
  "met"
);

for (const naturalTargetScript of [
  "凯哥，刚才你不是说想看我撒娇吗，那我来一个。",
  "凯哥，要是你想看返场就补一票。",
  "凯哥，这个新舞你想看吗，想看就扣1。",
  "凯哥，我再确认一下，能不能帮我组一组？",
  "凯哥，我再确认一下，能不能请你帮我组一组？",
  "凯哥，我再确认一下，能不能请凯哥来帮我组一组？",
]) {
  const naturalTarget = makeReportForScript(naturalTargetScript);
  index.applyReportSafetyGates(naturalTarget, [], {
    sourceScript: naturalTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    naturalTarget.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `有限引导词后的直接二人称仍应算 Q 用户：${naturalTargetScript}`
  );
}

for (const naturalTargetWithoutCommaScript of [
  "凯哥帮我补一下。",
  "凯哥给我补一脚。",
  "凯哥来帮我一下。",
  "凯哥再帮我一把。",
  "凯哥听我说一句。",
  "凯哥看一下这个新舞。",
  "凯哥别走，听我说。",
  "凯哥麻烦你帮我一下。",
  "凯哥是不是想看撒娇？",
  "凯哥想看我撒娇吗？",
  "凯哥要不要看返场？",
  "凯哥刚才不是说想看撒娇吗？",
]) {
  const naturalTargetWithoutComma = makeReportForScript(naturalTargetWithoutCommaScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "target_user" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(naturalTargetWithoutComma, [], {
    sourceScript: naturalTargetWithoutCommaScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    naturalTargetWithoutComma.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `自然口语不应只因没写逗号就卡住：${naturalTargetWithoutCommaScript}`
  );
}

for (const postposedTargetScript of [
  "谢谢你呀凯哥，刚才的小心心我收到了。",
  "谢谢你凯哥。",
  "感谢凯哥，刚才的支持我收到了。",
  "想看返场吗凯哥？",
  "你想看撒娇吗，凯哥？",
  "这一脚能不能帮我，凯哥？",
]) {
  const postposedTarget = makeReportForScript(postposedTargetScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "target_user" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(postposedTarget, [], {
    sourceScript: postposedTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    postposedTarget.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `自然的后置称呼也应算在对凯哥说话：${postposedTargetScript}`
  );
}

// target_user 是原子能力：只看有没有明确对到人，不能再暗中要求互动或上票动作。
// A2/A3 语义相同，仅标点不同，必须得到一致结果。
for (const atomicTargetScript of [
  "凯哥，现在还差320票。",
  "凯哥。你刚才说想看我撒娇，我听见了。",
  "那凯哥，我们先聊一下。",
  "凯哥啊，我记住了。",
  "我问下凯哥，你想看什么？",
  "凯哥，谢谢你刚才的小心心。",
]) {
  const atomicTarget = makeReportForScript(atomicTargetScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "target_user" ? { ...item, status: "missing" } : item
    ),
  });
  index.applyReportSafetyGates(atomicTarget, [], {
    sourceScript: atomicTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    atomicTarget.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `明确对凯哥说话时应纠正模型漏判：${atomicTargetScript}`
  );
}

for (const narratedOrWrongTargetScript of [
  "凯哥",
  "凯哥刚说想看撒娇。",
  "主持说凯哥想看撒娇。",
  "主持说：凯哥，你帮我补一下。",
  "主持说，凯哥，你帮我补一下。",
  "凯哥。谢谢大家支持。",
  "家人们，你们想看撒娇吗？",
]) {
  const narratedOrWrongTarget = makeReportForScript(narratedOrWrongTargetScript);
  index.applyReportSafetyGates(narratedOrWrongTarget, [], {
    sourceScript: narratedOrWrongTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    narratedOrWrongTarget.structure_checks.find((item) => item.key === "target_user").status,
    "partial",
    `叙述、错人或群体不能冒充在对凯哥说话：${narratedOrWrongTargetScript}`
  );
}

const atomicTargetEvidenceScript = "主持说凯哥想看撒娇。";
const atomicTargetEvidence = makeReportForScript(atomicTargetEvidenceScript, {
  structure_checks: allMetChecks().map((item) =>
    item.key === "target_user"
      ? { ...item, evidence: "虽然提到凯哥，但没有让他扣1回应" }
      : item
  ),
});
index.applyReportSafetyGates(atomicTargetEvidence, [], {
  sourceScript: atomicTargetEvidenceScript,
  scenario: { targetUser: "凯哥" },
});
assert.match(
  atomicTargetEvidence.structure_checks.find((item) => item.key === "target_user").evidence,
  /只检查|不检查理由、票差或上票动作/,
  "后端必须覆盖模型偷带的 target_user 隐藏动作条件"
);
assert.doesNotMatch(
  atomicTargetEvidence.structure_checks.find((item) => item.key === "target_user").evidence,
  /扣1/,
  "完整复盘里不能继续显示与当前关矛盾的旧证据"
);

for (const switchedUserScript of [
  "小王，你想看撒娇吗？",
  "月月姐先帮我组一个，小唐哥想看新舞也可以投一票。",
  "00姐姐谢谢你刚才帮我，小明哥你愿意就接下一手。",
]) {
  const switchedUser = makeReportForScript(switchedUserScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "target_user" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(switchedUser, [], {
    sourceScript: switchedUserScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    switchedUser.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `整轮切换到其他具体用户仍应算明确点到人：${switchedUserScript}`
  );
}

const switchedAudience = makeReportForScript(
  "月月姐先组一个，小唐哥愿意就接下一手。",
  { audience: "月月姐、小唐哥轮流点了一遍，但喊得很散，像在撒网。" }
);
index.applyReportSafetyGates(switchedAudience, [], {
  sourceScript: "月月姐先组一个，小唐哥愿意就接下一手。",
  scenario: { targetUser: "凯哥" },
});
assert.doesNotMatch(
  switchedAudience.audience,
  /点名太多|对象太散|喊得(?:很)?散|没有对准/u,
  "模型不得在 audience 里把正常扫场写成点名错误"
);

const noDefaultTalentScript =
  "月月哥，还差20个，你刚才这一手我看见了；现在还差8个，帮我再组一组，我们一起拿下。";
const noDefaultTalent = makeReportForScript(noDefaultTalentScript, {
  round_dynamics: validRoundDynamics({
    next_move: "下一拍承诺票够就跳舞，用才艺诱饵继续追票",
  }),
  direction: {
    summary: "加一个跳舞节目，再用才艺换下一手，用你自己的话说",
    examples: ["票够我就跳一支舞", "你们想看节目就再补一脚"],
  },
  line_reviews: [{
    original: noDefaultTalentScript,
    mark: "partial",
    comment: "这里最好加一个跳舞才艺作为交换",
  }],
});
index.applyReportSafetyGates(noDefaultTalent, [], {
  sourceScript: noDefaultTalentScript,
  scenario: null,
});
assert.doesNotMatch(
  JSON.stringify({
    nextMove: noDefaultTalent.round_dynamics.next_move,
    direction: noDefaultTalent.direction,
    comments: noDefaultTalent.line_reviews.map((item) => item.comment),
  }),
  /跳舞|才艺|节目/u,
  "原稿没有内容交换时，模型不得把新加才艺当成默认下一拍"
);

const inventedGiftDriver = makeReportForScript(
  "久皇哥，谢谢你刚才的支持，你愿意就再补一脚。",
  {
    round_dynamics: validRoundDynamics({
      human_drivers: [{
        driver: "reciprocity",
        evidence: "久皇哥刚才的礼物",
        mechanism: "具体感谢他的礼物，让付出有来有回",
      }],
    }),
  }
);
index.applyReportSafetyGates(inventedGiftDriver, [], {
  sourceScript: "久皇哥，谢谢你刚才的支持，你愿意就再补一脚。",
  scenario: null,
});
assert.doesNotMatch(
  JSON.stringify(inventedGiftDriver.round_dynamics),
  /礼物/u,
  "原稿只说支持时，人性机制不得擅自编成送礼物"
);

for (const guidedWrongPersonScript of [
  "凯哥，刚才小王你愿意就补一点。",
  "凯哥，主持刚说小王你想看返场就扣1。",
  "凯哥，我再确认一下，小王能不能帮我组一组？",
  "凯哥，我再确认一下，能不能请小王帮我组一组？",
]) {
  const guidedWrongPerson = makeReportForScript(guidedWrongPersonScript);
  index.applyReportSafetyGates(guidedWrongPerson, [], {
    sourceScript: guidedWrongPersonScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    guidedWrongPerson.structure_checks.find((item) => item.key === "target_user").status,
    "met",
    `整轮话术明确转向另一个具体用户时不能因场景名不匹配降级：${guidedWrongPersonScript}`
  );
}

const pleadingScript = "凯哥求求你可怜可怜我，我真的不想被淘汰。";
const hardBegging = makeReportForScript(pleadingScript, {
  verdict: "almost",
});
index.applyReportSafetyGates(hardBegging, [], {
  sourceScript: pleadingScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(hardBegging.verdict, "off");
assert.equal(hardBegging.card_type, "logic");

const twoSignalBeggingScript = "凯哥求求你帮帮我，这轮真的不能走。";
const twoSignalBegging = makeReportForScript(twoSignalBeggingScript, { verdict: "almost" });
index.applyReportSafetyGates(twoSignalBegging, [], {
  sourceScript: twoSignalBeggingScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(twoSignalBegging.verdict, "off", "两个求情信号且无独立用户价值时也不能误过");

const fakeChoiceCueScript = "凯哥求求你帮帮我，你定力真好。";
const fakeChoiceCue = makeReportForScript(fakeChoiceCueScript, { verdict: "almost" });
index.applyReportSafetyGates(fakeChoiceCue, [], {
  sourceScript: fakeChoiceCueScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(fakeChoiceCue.verdict, "off", "“你定力”不能被识别成把决定权交给用户");

const negatedChoiceCueScript = "凯哥求求你帮帮我，你说了算，才怪。";
const negatedChoiceCue = makeReportForScript(negatedChoiceCueScript, { verdict: "almost" });
index.applyReportSafetyGates(negatedChoiceCue, [], {
  sourceScript: negatedChoiceCueScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(negatedChoiceCue.verdict, "off", "被否定的决定权不能绕过纯求情硬闸");

const punctuatedFakeChoiceScript = "凯哥求求你帮帮我，你定。逗你的。";
const punctuatedFakeChoice = makeReportForScript(punctuatedFakeChoiceScript, {
  verdict: "almost",
  line_reviews: [
    { original: "凯哥求求你帮帮我，你定。", mark: "good", comment: "模型误报" },
    { original: "逗你的。", mark: "good", comment: "模型误报" },
  ],
});
index.applyReportSafetyGates(punctuatedFakeChoice, [], {
  sourceScript: punctuatedFakeChoiceScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(punctuatedFakeChoice.verdict, "off", "标点后的‘逗你的’不能绕过求情硬闸");

const playfulSinglePlea = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    line_reviews: [
      {
        original: "凯哥，求求你啦，这句算不算过关？",
        mark: "good",
        comment: "这是一次轻量试探",
      },
    ],
  }),
  "凯哥，求求你啦，这句算不算过关？"
);
index.applyReportSafetyGates(playfulSinglePlea, [], {
  sourceScript: "凯哥，求求你啦，这句算不算过关？",
  scenario: { targetUser: "凯哥" },
});
assert.equal(playfulSinglePlea.verdict, "almost", "单次显性乞求也不能当作普通委婉请求毕业");
assert.equal(playfulSinglePlea.card_type, "logic");
assert.equal(playfulSinglePlea.line_reviews[0].mark, "wrong");
assert.match(playfulSinglePlea.line_reviews[0].comment, /不同于“帮我组一组”/u);
assert.match(playfulSinglePlea.card_why, /显性乞求|姿态逻辑/u);
assert.match(playfulSinglePlea.verdict_reason, /显性乞求|平等请求/u);
assert.doesNotMatch(playfulSinglePlea.verdict_reason, /可以过关/u);

const supportedPleaScript = "凯哥，求求你补最后一票，复活后你点舞，我不想被淘汰。";
const supportedPlea = makeReportForScript(supportedPleaScript, { verdict: "almost" });
index.applyReportSafetyGates(supportedPlea, [], {
  sourceScript: supportedPleaScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(supportedPlea.verdict, "off", "用户侧交换价值不能洗掉显性乞求姿态");

for (const supportedEntertainmentPleaScript of [
  "凯哥，求求你帮帮我，你上几张你说了算。",
  "凯哥，求求你帮帮我，我撒个娇，满意你再补。",
  "凯哥，求求你帮帮我，想看返场就在公屏扣1。",
]) {
  const supportedEntertainmentPlea = makeReportForScript(
    supportedEntertainmentPleaScript,
    { verdict: "almost" }
  );
  index.applyReportSafetyGates(supportedEntertainmentPlea, [], {
    sourceScript: supportedEntertainmentPleaScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    supportedEntertainmentPlea.verdict,
    "off",
    `娱乐交换可以算用户支点，但不能洗掉“求求你帮帮我”的明确乞求：${supportedEntertainmentPleaScript}`
  );
}

for (const neutralPoliteRequestScript of [
  "现在还差十票，凯哥，能不能帮我组一组，你上几张你说了算。",
  "现在还差十票，凯哥，帮我丢一丢，我撒个娇，满意你再补。",
  "现在还差十票，凯哥，方便的话帮我补一补，想看返场就在公屏扣1。",
  "现在还差十票，凯哥，帮帮我，你愿意上多少看着来。",
]) {
  const neutralPoliteRequest = makeReportForScript(neutralPoliteRequestScript, {
    verdict: "almost",
  });
  index.applyReportSafetyGates(neutralPoliteRequest, [], {
    sourceScript: neutralPoliteRequestScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    neutralPoliteRequest.verdict,
    "passed",
    `普通或委婉的“帮我+具体动作”不得按低姿态拦截：${neutralPoliteRequestScript}`
  );
  assert.equal(neutralPoliteRequest.line_reviews[0].mark, "good");
}

const alternateBeggingScript = "凯哥，求一求你了，你愿意就补一张。";
const alternateBegging = makeReportForScript(alternateBeggingScript);
index.applyReportSafetyGates(alternateBegging, [], {
  sourceScript: alternateBeggingScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(alternateBegging.verdict, "almost");
assert.equal(alternateBegging.line_reviews[0].mark, "wrong");

const kneelingScript = "凯哥，我给你跪下了，你愿意就救救我这一次。";
const kneeling = makeReportForScript(kneelingScript);
index.applyReportSafetyGates(kneeling, [], {
  sourceScript: kneelingScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(kneeling.verdict, "off");
assert.equal(kneeling.card_type, "logic");
assert.equal(kneeling.line_reviews[0].mark, "wrong");
assert.match(kneeling.line_reviews[0].comment, /自贬|施舍/u);
assert.match(kneeling.card_why, /自贬|姿态逻辑/u);
assert.doesNotMatch(kneeling.verdict_reason, /可以过关/u);

const notCooperatingScript = "现在还差十票，凯哥，你想看返场就补一张，我不配合硬要票。";
const notCooperating = makeReportForScript(notCooperatingScript, { verdict: "almost" });
index.applyReportSafetyGates(notCooperating, [], {
  sourceScript: notCooperatingScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(notCooperating.verdict, "passed", "“我不配合”不能被“我不配”子串误判为自贬");
assert.equal(notCooperating.line_reviews[0].mark, "good");

const unworthyScript = "凯哥，你想看返场就补一张，我不配。";
const unworthy = makeReportForScript(unworthyScript);
index.applyReportSafetyGates(unworthy, [], {
  sourceScript: unworthyScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(unworthy.verdict, "off", "独立的“我不配”必须按明确自贬处理");
assert.equal(unworthy.card_type, "logic");
assert.equal(unworthy.line_reviews[0].mark, "wrong");

const negatedUnworthyScript = "现在还差十票，凯哥，你想看返场就补一张，我才不会说我不配。";
const negatedUnworthy = makeReportForScript(negatedUnworthyScript, { verdict: "almost" });
index.applyReportSafetyGates(negatedUnworthy, [], {
  sourceScript: negatedUnworthyScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(negatedUnworthy.verdict, "passed", "被明确否定的“我不配”不能当成主播自贬");
assert.equal(negatedUnworthy.line_reviews[0].mark, "good");

for (const negatedEntertainmentPleaScript of [
  "凯哥求求你帮帮我，我不撒娇，大家上票。",
  "凯哥求求你帮帮我，我不整活，大家投票。",
  "凯哥求求你帮帮我，我不想看返场，家人们上票。",
  "凯哥求求你帮帮我，我心跳好快，大家上票。",
  "凯哥求求你帮帮我，我先跳过这个话题，大家上票。",
]) {
  const negatedEntertainmentPlea = makeReportForScript(
    negatedEntertainmentPleaScript,
    { verdict: "almost" }
  );
  index.applyReportSafetyGates(negatedEntertainmentPlea, [], {
    sourceScript: negatedEntertainmentPleaScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    negatedEntertainmentPlea.verdict,
    "off",
    `被否定的娱乐内容不能与普通要票动作拼成用户价值：${negatedEntertainmentPleaScript}`
  );
}

const negatedPleaScript = "现在还差十票，凯哥，别可怜我，我才不求求大家，你想看就补一票。";
const negatedPlea = makeReportForScript(negatedPleaScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "partial" } : item
  ),
});
index.applyReportSafetyGates(negatedPlea, [], {
  sourceScript: negatedPleaScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(negatedPlea.verdict, "almost", "否定语境中的求情词不能触发卖惨硬闸");

const quotedPleaScript = "现在还差十票，凯哥，你刚说“求求你可怜我”，这轮你愿意就补一点。";
const quotedPlea = makeReportForScript(quotedPleaScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "partial" } : item
  ),
});
index.applyReportSafetyGates(quotedPlea, [], {
  sourceScript: quotedPleaScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(quotedPlea.verdict, "almost", "引用观众的求情话不能当成主播卖惨");

for (const otherQuotedPleaScript of [
  "现在还差十票，凯哥，你刚说「求求你可怜我」，这轮你愿意就补一点。",
  "现在还差十票，凯哥，你愿意就补一点，不要再说‘求求你’。",
]) {
  const otherQuotedPlea = makeReportForScript(otherQuotedPleaScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(otherQuotedPlea, [], {
    sourceScript: otherQuotedPleaScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(otherQuotedPlea.verdict, "almost", `引用或制止语境不能算主播乞求：${otherQuotedPleaScript}`);
  assert.equal(otherQuotedPlea.line_reviews[0].mark, "good");
}

const attributedPhraseScript = "现在还差十票，凯哥，你那句“求求你”我听见了，这轮你愿意就补一点。";
const attributedPhrase = makeReportForScript(attributedPhraseScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "partial" } : item
  ),
});
index.applyReportSafetyGates(attributedPhrase, [], {
  sourceScript: attributedPhraseScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(attributedPhrase.verdict, "almost", "明确归属于用户的原话不能当成主播本人乞求");

const emphasizedPleaScript = "凯哥，帮帮我，‘求求你’，这轮真的不能走。";
const emphasizedPlea = makeReportForScript(emphasizedPleaScript, { verdict: "almost" });
index.applyReportSafetyGates(emphasizedPlea, [], {
  sourceScript: emphasizedPleaScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(emphasizedPlea.verdict, "off", "主播用引号强调自己的乞求时不能当成引用豁免");
assert.equal(emphasizedPlea.line_reviews[0].mark, "wrong");

const addressedQuotedPleaScript = "凯哥，帮帮我，我只能跟你说‘求求你’，这轮真的不能走。";
const addressedQuotedPlea = makeReportForScript(addressedQuotedPleaScript);
index.applyReportSafetyGates(addressedQuotedPlea, [], {
  sourceScript: addressedQuotedPleaScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(addressedQuotedPlea.verdict, "off", "主播对用户说出的引号内容仍是主播本人的乞求");
assert.equal(addressedQuotedPlea.line_reviews[0].mark, "wrong");

for (const negatedBeggingScript of [
  "现在还差十票，凯哥，你想看返场就补一张，我没有求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我没求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我未求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我无需去求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我没必要求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我不需要再求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我才不会求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我不是在求求你。",
  "现在还差十票，凯哥，你想看返场就补一张，我没有真的求求你。",
]) {
  const negatedBegging = makeReportForScript(negatedBeggingScript, {
    verdict: "almost",
  });
  index.applyReportSafetyGates(negatedBegging, [], {
    sourceScript: negatedBeggingScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    negatedBegging.verdict,
    "passed",
    `明确否定的乞求词不能被当作主播正在乞求：${negatedBeggingScript}`
  );
  assert.equal(negatedBegging.line_reviews[0].mark, "good");
}

const nestedNegationScript = "现在还差十票，凯哥，你想看返场就补一张，我不会说不得不求求你。";
const nestedNegation = makeReportForScript(nestedNegationScript, { verdict: "almost" });
index.applyReportSafetyGates(nestedNegation, [], {
  sourceScript: nestedNegationScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(nestedNegation.verdict, "passed", "外层明确否定必须覆盖内层“不得不求求你”");
assert.equal(nestedNegation.line_reviews[0].mark, "good");

for (const doubleNegativeBeggingScript of [
  "凯哥，我不得不求求你，帮帮我。",
  "凯哥，我不能不求求你，帮帮我。",
  "凯哥，我不是不求求你，帮帮我。",
  "凯哥，我不会不求求你，帮帮我。",
]) {
  const doubleNegativeBegging = makeReportForScript(doubleNegativeBeggingScript);
  index.applyReportSafetyGates(doubleNegativeBegging, [], {
    sourceScript: doubleNegativeBeggingScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    doubleNegativeBegging.verdict,
    "off",
    `双重否定仍表达正在乞求，不能按否定语境豁免：${doubleNegativeBeggingScript}`
  );
  assert.equal(doubleNegativeBegging.line_reviews[0].mark, "wrong");
}

for (const contextualHumanDriverCase of [
  {
    driver: "protection",
    script: "月月姐，我第一次上十连手还在抖，这最后一轮你愿意托住我、帮我补一脚吗？",
    evidence: "第一次上十连手还在抖；月月姐可以托住最后一轮",
    mechanism: "真实的新人与临门一轮给了具体用户一个可执行的守护位置",
  },
  {
    driver: "belonging",
    script: "小豹总，你陪我守过前面两轮，这一轮咱们也一起走完，再帮我补一脚好吗？",
    evidence: "陪我守过前面两轮；这轮咱们一起走完",
    mechanism: "共同经历把补票变成继续完成我们这一轮，而不是单向施舍",
  },
  {
    driver: "reciprocity",
    script: "久皇哥，你刚才那一手我看见了，这轮你再帮我补一脚，我马上把这份支持接回来、当场点名谢谢你。",
    evidence: "看见刚才那一手，并承诺当场点名接回支持",
    mechanism: "用户的付出得到即时、明确的回应，形成有来有回",
  },
]) {
  const report = makeReportForScript(contextualHumanDriverCase.script, {
    round_dynamics: validRoundDynamics({
      flow_read: "主播在同一轮接住已有关系，再递出下一拍",
      human_drivers: [
        {
          driver: contextualHumanDriverCase.driver,
          evidence: contextualHumanDriverCase.evidence,
          mechanism: contextualHumanDriverCase.mechanism,
        },
      ],
      response_read: "原稿只提供既有支持或共同经历，不虚构新的上票结果",
      next_move: "先等对方是否接这一脚，再根据真实反馈换人或继续",
    }),
  });
  index.applyReportSafetyGates(report, [], {
    sourceScript: contextualHumanDriverCase.script,
    scenario: null,
  });
  assert.equal(
    report.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `有上下文和机制的人性支点不能仅因没有才艺承诺被旧规则压掉：${contextualHumanDriverCase.driver}`
  );
  assert.equal(report.verdict, "passed", `有效 ${contextualHumanDriverCase.driver} 支点应满足新通过门槛`);
}

const keywordOnlyProtectionScript = "我不想这么早下去，我真的好难，大家帮我补一脚。";
const keywordOnlyProtection = makeReportForScript(keywordOnlyProtectionScript, {
  round_dynamics: validRoundDynamics({
    flow_read: "主播表达自己不想下去",
    human_drivers: [
      {
        driver: "protection",
        evidence: "我不想这么早下去，我真的好难",
        mechanism: "因为说自己很难，所以观众会保护她",
      },
    ],
    response_read: "没有看到用户已经回应或上票",
    next_move: "先给观众一个平等、可参与的理由",
  }),
});
index.applyReportSafetyGates(keywordOnlyProtection, [], {
  sourceScript: keywordOnlyProtectionScript,
  scenario: null,
});
assert.notEqual(
  keywordOnlyProtection.structure_checks.find((item) => item.key === "user_reason").status,
  "met",
  "纯粹‘我不想下去/我好难’不能靠 protection 标签洗成用户理由"
);
assert.notEqual(keywordOnlyProtection.verdict, "passed", "关键词式保护欲不得放过纯主播需要");

const explicitViewerReasonScript = "现在还差十票，凯哥，你要是想看我返场就补一票。";
const explicitViewerReason = makeReportForScript(explicitViewerReasonScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "partial" } : item
  ),
});
index.applyReportSafetyGates(explicitViewerReason, [], {
  sourceScript: explicitViewerReasonScript,
  scenario: { targetUser: "凯哥" },
});
assert.equal(
  explicitViewerReason.structure_checks.find((item) => item.key === "user_reason").status,
  "met"
);
assert.equal(explicitViewerReason.verdict, "passed");

// user_reason 也是原子能力：观看、互动、选择或兑现价值成立就过，不再要求扣数/上票动作。
// B2/B3 只改标点，两个判断必须一致。
for (const atomicViewerReasonScript of [
  "凯哥，你不是说想看我撒娇吗？我现在撒一个。",
  "凯哥。你不是说想看我撒娇吗？我现在撒一个，好玩你再决定。",
  "凯哥，你想看返场吗？",
  "凯哥，这次你来选，你当导演。",
  "凯哥，复活后我给你把新舞跳完。",
  "凯哥，我撒个娇给你看。",
]) {
  const atomicViewerReason = makeReportForScript(atomicViewerReasonScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "missing" } : item
    ),
  });
  index.applyReportSafetyGates(atomicViewerReason, [], {
    sourceScript: atomicViewerReasonScript,
    scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
  });
  assert.equal(
    atomicViewerReason.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `已有用户侧价值时应纠正模型的 missing：${atomicViewerReasonScript}`
  );
}

for (const interactiveQuestionScript of [
  "凯哥，你想不想看新舞，想看就在公屏扣1。",
  "凯哥，你愿不愿意看返场，愿意就在评论区扣1。",
]) {
  const interactiveQuestion = makeReportForScript(interactiveQuestionScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(interactiveQuestion, [], {
    sourceScript: interactiveQuestionScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    interactiveQuestion.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `带反馈入口的“想不想看”应是有效试探：${interactiveQuestionScript}`
  );
}

for (const invalidViewerReasonScript of [
  "凯哥，你不想看新舞，就别补票。",
  "凯哥，你不愿意看返场，就别补票。",
  "凯哥，你想看我返场但不行。",
  "凯哥，你想看新舞，我决定不跳。",
]) {
  const invalidViewerReason = makeReportForScript(invalidViewerReasonScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(invalidViewerReason, [], {
    sourceScript: invalidViewerReasonScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    invalidViewerReason.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `否定/无反馈入口不能升级用户理由：${invalidViewerReasonScript}`
  );
}

for (const negatedOrNarratedViewerReasonScript of [
  "凯哥不想看返场。",
  "凯哥没说想看返场。",
  "大家不想看新舞。",
  "主持说凯哥想看撒娇。",
  "刚才主持说凯哥想看撒娇。",
  "听主持说凯哥想看撒娇。",
  "小王说凯哥想看返场。",
  "主持告诉我凯哥想看撒娇。",
  "凯哥说他想看返场。",
]) {
  const negatedOrNarratedViewerReason = makeReportForScript(
    negatedOrNarratedViewerReasonScript
  );
  index.applyReportSafetyGates(negatedOrNarratedViewerReason, [], {
    sourceScript: negatedOrNarratedViewerReasonScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    negatedOrNarratedViewerReason.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `否定或转述不能冒充给用户的正向理由：${negatedOrNarratedViewerReasonScript}`
  );
}

for (const positiveAlternativeScript of [
  "凯哥，我不返场，但我现在撒个娇给你看。",
  "我不撒娇，不过复活后给你跳新舞。",
  "我不返场，给你撒个娇吧。",
  "我不撒娇，给你跳个新舞。",
]) {
  const positiveAlternative = makeReportForScript(positiveAlternativeScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(positiveAlternative, [], {
    sourceScript: positiveAlternativeScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    positiveAlternative.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `先否定一种内容、再给明确替代时应承认后半句价值：${positiveAlternativeScript}`
  );
}

for (const vagueOfferScript of [
  "凯哥，我马上来一个。",
  "凯哥，那我给你安排。",
]) {
  const vagueOffer = makeReportForScript(vagueOfferScript);
  index.applyReportSafetyGates(vagueOffer, [], {
    sourceScript: vagueOfferScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    vagueOffer.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `没有现场信号时，含糊的“来一个/安排”不能凭空补成用户理由：${vagueOfferScript}`
  );
}

const contextualGenericOfferScript = "凯哥，那我给你安排。";
const contextualGenericOffer = makeReportForScript(contextualGenericOfferScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "partial" } : item
  ),
});
index.applyReportSafetyGates(contextualGenericOffer, [], {
  sourceScript: contextualGenericOfferScript,
  scenario: { targetUser: "凯哥", userSignal: "想看返场" },
});
assert.equal(
  contextualGenericOffer.structure_checks.find((item) => item.key === "user_reason").status,
  "met",
  "现场已经明确想看返场时，“那我给你安排”有清楚指代，不应被机械卡住"
);

for (const negatedSignalCase of [
  { signal: "不想看撒娇", script: "凯哥，那我现在来一个。" },
  { signal: "别撒娇", script: "凯哥，那我现在来一个。" },
  { signal: "没说想看返场", script: "凯哥，那我给你安排。" },
  { signal: "不想听唱歌", script: "凯哥，那我现在走一个。" },
  { signal: "你不用撒娇了", script: "凯哥，那我现在来一个。" },
  { signal: "不必撒娇", script: "凯哥，那我现在来一个。" },
  { signal: "无需返场", script: "凯哥，那我给你安排。" },
  { signal: "我没想看撒娇", script: "凯哥，那我现在来一个。" },
  { signal: "你不用给我跳新舞", script: "凯哥，那我现在走一个。" },
]) {
  const negatedSignal = makeReportForScript(negatedSignalCase.script);
  index.applyReportSafetyGates(negatedSignal, [], {
    sourceScript: negatedSignalCase.script,
    scenario: { targetUser: "凯哥", userSignal: negatedSignalCase.signal },
  });
  assert.equal(
    negatedSignal.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `否定现场信号不能把含糊回应升级为用户理由：${negatedSignalCase.signal}`
  );
}

for (const voteOnlyScenarioResponseScript of [
  "凯哥，我给你安排一个补票任务。",
  "凯哥，那我给你安排补票。",
  "凯哥，我给你看一下现在还差多少票。",
  "凯哥，我马上给你安排上票。",
  "凯哥，我给你跳票了。",
]) {
  const voteOnlyScenarioResponse = makeReportForScript(voteOnlyScenarioResponseScript);
  index.applyReportSafetyGates(voteOnlyScenarioResponse, [], {
    sourceScript: voteOnlyScenarioResponseScript,
    scenario: { targetUser: "凯哥", userSignal: "你撒个娇，我考虑一下" },
  });
  assert.equal(
    voteOnlyScenarioResponse.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `票务动作不能借撒娇场景冒充用户理由：${voteOnlyScenarioResponseScript}`
  );
}

for (const viewerValueWithoutVoteActionScript of [
  "凯哥，你想看新舞也别补票。",
  "凯哥，你想看返场，但没必要扣1。",
  "凯哥，你想看返场，但没有必要扣1。",
  "凯哥，你想看返场，也不由你来决定。",
  "凯哥，你想看新舞，我先补点妆。",
  "凯哥，你想看新舞就给我倒杯水。",
  "凯哥，你想看新舞，我选节目。",
]) {
  const viewerValueWithoutVoteAction = makeReportForScript(viewerValueWithoutVoteActionScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(viewerValueWithoutVoteAction, [], {
    sourceScript: viewerValueWithoutVoteActionScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    viewerValueWithoutVoteAction.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `上票/反馈动作是否成立不能反向抹掉已有观看价值：${viewerValueWithoutVoteActionScript}`
  );
}

for (const hostNeedOrNegatedValueScript of [
  "凯哥，我不撒娇，我现在只需要你帮我。",
  "凯哥，你想看返场，但我不跳。",
  "凯哥，我不想被淘汰，你帮帮我。",
  "凯哥，现在还差十票，帮我补一票。",
  "我是新人小满，准备了一支新舞。凯哥帮我补票。",
  "我是新人小满，我现在准备了一支新舞。凯哥帮我补票。",
]) {
  const hostNeedOrNegatedValue = makeReportForScript(hostNeedOrNegatedValueScript);
  index.applyReportSafetyGates(hostNeedOrNegatedValue, [], {
    sourceScript: hostNeedOrNegatedValueScript,
    scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
  });
  assert.equal(
    hostNeedOrNegatedValue.structure_checks.find((item) => item.key === "user_reason").status,
    "partial",
    `否定用户价值或只说主播需要时不能误判为用户理由：${hostNeedOrNegatedValueScript}`
  );
}

const atomicReasonEvidenceScript = "凯哥，我会努力。";
const atomicReasonEvidence = makeReportForScript(atomicReasonEvidenceScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason"
      ? { ...item, status: "partial", evidence: "没有让凯哥扣1或上票反馈" }
      : item
  ),
});
index.applyReportSafetyGates(atomicReasonEvidence, [], {
  sourceScript: atomicReasonEvidenceScript,
  scenario: { targetUser: "凯哥" },
});
assert.match(
  atomicReasonEvidence.structure_checks.find((item) => item.key === "user_reason").evidence,
  /人性参与支点|才艺、保护、归属、身份、互惠/,
  "给理由未过时也要按当前原子标准解释"
);
assert.doesNotMatch(
  atomicReasonEvidence.structure_checks.find((item) => item.key === "user_reason").evidence,
  /扣1|上票反馈/,
  "完整复盘里不能保留 user_reason 的隐藏动作条件"
);

const contextualSignalResponseScript = "凯哥，你刚才不是说想看撒娇吗？那我现在来一个。";
const contextualSignalResponse = makeReportForScript(contextualSignalResponseScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "missing" } : item
  ),
});
index.applyReportSafetyGates(contextualSignalResponse, [], {
  sourceScript: contextualSignalResponseScript,
  scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
});
assert.equal(
  contextualSignalResponse.structure_checks.find((item) => item.key === "user_reason").status,
  "met",
  "接住现场撒娇信号后说“那我现在来一个”应识别为用户侧回应"
);

for (const naturalSignalResponseScript of [
  "凯哥，那我现在就撒娇。",
  "凯哥，你不是说让我撒个娇吗？我这就来。",
]) {
  const naturalSignalResponse = makeReportForScript(naturalSignalResponseScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(naturalSignalResponse, [], {
    sourceScript: naturalSignalResponseScript,
    scenario: { targetUser: "凯哥", userSignal: "你撒个娇，我考虑一下" },
  });
  assert.equal(
    naturalSignalResponse.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `接住明确撒娇信号后的自然回应应过关：${naturalSignalResponseScript}`
  );
}

for (const directHostQuestionScript of [
  "我问凯哥，你想看撒娇吗？",
  "我问下凯哥，你想看撒娇吗？",
  "我来问凯哥，你要不要看返场？",
]) {
  const directHostQuestion = makeReportForScript(directHostQuestionScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });
  index.applyReportSafetyGates(directHostQuestion, [], {
    sourceScript: directHostQuestionScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    directHostQuestion.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `主播直接问目标用户想看什么，不能被当成第三方转述：${directHostQuestionScript}`
  );
}

const farFocus = index.normalizeReport(makeRawReport(), "测试原句");
index.applyReportSafetyGates(farFocus, [], { sourceScript: "测试原句", voteGap: "far" });
assert.match(farFocus.direction.summary, /追票|现在出手/);

const securedFocus = index.normalizeReport(makeRawReport(), "测试原句");
index.applyReportSafetyGates(securedFocus, [], {
  sourceScript: "测试原句",
  voteGap: "secured",
});
assert.match(securedFocus.direction.summary, /稳票|保位|白投/);

const closeFocus = index.normalizeReport(makeRawReport(), "测试原句");
index.applyReportSafetyGates(closeFocus, [], { sourceScript: "测试原句", voteGap: "close" });
assert.match(closeFocus.direction.summary, /临门一脚/);

const existingFarFocus = makeReportForScript("测试原句", {
  direction: { summary: "这轮先追票，让凯哥现在出手，用你自己的话说", examples: [] },
});
index.applyReportSafetyGates(existingFarFocus, [], {
  sourceScript: "测试原句",
  voteGap: "far",
});
assert.doesNotMatch(existingFarFocus.direction.summary, /^现在是追票阶段/u);

const negativeFarMention = makeReportForScript("测试原句", {
  direction: { summary: "现在还没有追票策略，用你自己的话说", examples: [] },
});
index.applyReportSafetyGates(negativeFarMention, [], {
  sourceScript: "测试原句",
  voteGap: "far",
});
assert.match(negativeFarMention.direction.summary, /^现在是追票阶段/u);

const existingCloseFocus = makeReportForScript("测试原句", {
  direction: { summary: "让凯哥补一脚就收口，用你自己的话说", examples: [] },
});
index.applyReportSafetyGates(existingCloseFocus, [], {
  sourceScript: "测试原句",
  voteGap: "close",
});
assert.doesNotMatch(existingCloseFocus.direction.summary, /^现在是临门一脚/u);

// scenario：旧请求缺省为 null；未知字段丢弃；已知字段严格清洗并限制范围。
assert.equal(index.sanitizeScenario(undefined), null);
assert.equal(index.sanitizeScenario(null), null);
assert.equal(index.sanitizeScenario({ unknown: "drop me" }), null);
assert.deepEqual(
  index.sanitizeScenario({
    id: "  scene-1  ",
    secondsLeft: 0,
    votesNeeded: 128,
    hostCue: "主持先递球\n让主播接",
    targetUser: "  榜一大哥 ",
    userSignal: "评论区说\t想看撒娇",
    recentGift: "小心心×10",
    trainingGoal: "练习接住主持",
    injected: "unknown field",
  }),
  {
    id: "scene-1",
    secondsLeft: 0,
    votesNeeded: 128,
    hostCue: "主持先递球 让主播接",
    targetUser: "榜一大哥",
    userSignal: "评论区说 想看撒娇",
    recentGift: "小心心×10",
    trainingGoal: "练习接住主持",
  }
);
assert.throws(() => index.sanitizeScenario("bad"), (err) => err.status === 400);
assert.throws(
  () => index.sanitizeScenario({ secondsLeft: -1 }),
  (err) => err.status === 400
);
assert.throws(
  () => index.sanitizeScenario({ votesNeeded: "100" }),
  (err) => err.status === 400
);
assert.throws(
  () => index.sanitizeScenario({ hostCue: "话".repeat(161) }),
  (err) => err.status === 400
);

const structuredScenario = index.sanitizeScenario({
  id: " revival-last-one ",
  roleContext: " 你是台上复活主播 ",
  phase: "awaiting_drop",
  goalUnit: "个（1个=99票复活礼物）",
  targetUnits: 28,
  pledgedUnits: 28,
  openRemaining: 0,
  deliveredUnits: 0.5,
  timeline: [
    {
      at: 1,
      role: "viewer",
      kind: "direct_gift",
      speaker: " 神秘人A ",
      text: " 直接送出最后半个 ",
      effect: "revive",
      progress: { injected: true },
    },
  ],
});
assert.deepEqual(structuredScenario, {
  id: "revival-last-one",
  roleContext: "你是台上复活主播",
  phase: "awaiting_drop",
  goalUnit: "个（1个=99票复活礼物）",
  targetUnits: 28,
  pledgedUnits: 28,
  openRemaining: 0,
  deliveredUnits: 0.5,
  timeline: [
    {
      at: 1,
      role: "viewer",
      kind: "direct_gift",
      speaker: "神秘人A",
      text: "直接送出最后半个",
      effect: "revive",
    },
  ],
});
assert.doesNotMatch(index.scenarioEvidenceText(structuredScenario), /\[object Object\]/u);
assert.match(index.scenarioEvidenceText(structuredScenario), /神秘人A/u);
assert.throws(
  () => index.sanitizeScenario({ phase: "invented" }),
  (err) => err.status === 400
);
assert.throws(
  () => index.sanitizeScenario({ targetUnits: 28, pledgedUnits: 20, openRemaining: 9 }),
  (err) => err.status === 400
);
assert.throws(
  () => index.sanitizeScenario({ targetUnits: 28, pledgedUnits: 10, deliveredUnits: 11 }),
  (err) => err.status === 400
);
assert.throws(
  () => index.sanitizeScenario({
    timeline: Array.from({ length: 25 }, (_, i) => ({
      at: i,
      role: "viewer",
      kind: "chat",
      speaker: "用户",
      text: "现场",
    })),
  }),
  (err) => err.status === 400
);

const structuredPrompt = prompt.buildUserPrompt(
  "close",
  "队已经组齐，大家先别提前丢，等主持口令统一丢。",
  [],
  [],
  structuredScenario
);
assert.match(structuredPrompt, /当前阶段：组满等待发令/u);
assert.match(structuredPrompt, /已确认占位：28/u);
assert.match(structuredPrompt, /实际已到账：0.5/u);
assert.match(structuredPrompt, /\[1\]\[观众｜直接送出｜复活方向\] 神秘人A/u);
assert.match(structuredPrompt, /公开认领和未报数直接送出都可占位/u);

const deliveryGood = makeRawReport();
index.applyReportSafetyGates(deliveryGood, [], {
  sourceScript: "队伍组齐了，大家先别提前丢，按刚才认领等主持口令统一丢。",
  scenario: { phase: "awaiting_drop" },
});
assert.equal(
  deliveryGood.structure_checks.find((item) => item.key === "vote_instruction").status,
  "met",
  "组满后明确等待主持统一发令，才是当前阶段正确动作"
);

const deliveryWaitOnly = makeRawReport();
index.applyReportSafetyGates(deliveryWaitOnly, [], {
  sourceScript: "队伍组满了，大家等主持统一口令。",
  scenario: { phase: "awaiting_drop" },
});
assert.equal(
  deliveryWaitOnly.structure_checks.find((item) => item.key === "vote_instruction").status,
  "met",
  "组满后明确等主持统一口令本身就是当前可执行动作"
);

for (const closingAction of [
  "现在还差最后一个，愿意的帮我认一个。",
  "最后一手了，谁愿意帮我抓一下最后位置。",
  "现在差十五个，哥帮我抹个零。",
  "还有一半，谁愿意把这一半接一下。",
]) {
  const closingActionReport = makeRawReport();
  index.applyReportSafetyGates(closingActionReport, [], {
    sourceScript: closingAction,
    scenario: { phase: "closing" },
  });
  assert.equal(
    closingActionReport.structure_checks.find((item) => item.key === "vote_instruction").status,
    "met",
    `“${closingAction}”已经递出了收口阶段可执行的认领动作`
  );
}

const deliveryContradictoryAdvice = makeRawReport({
  one_thing: "再问一个人能不能补位。",
  direction: {
    summary: "先等主持口令，同时看看还有谁愿意再补位。",
    examples: [
      "大家按刚才认领等主持口令统一丢。",
      "观众丙要不要再补一个？",
    ],
  },
  round_dynamics: validRoundDynamics({
    next_move: "确认观众甲已到账一个，并再次强调其余人等主持口令，同时试探观众丙是否愿意补位。",
  }),
});
index.applyReportSafetyGates(deliveryContradictoryAdvice, [], {
  sourceScript: "队伍已经组齐，大家按刚才认领等主持口令统一丢。",
  voteGap: "secured",
  scenario: { phase: "awaiting_drop" },
});
assert.match(deliveryContradictoryAdvice.round_dynamics.next_move, /组满.{0,40}主持统一口令/u);
assert.doesNotMatch(deliveryContradictoryAdvice.round_dynamics.next_move, /试探|谁愿意|继续.{0,6}补位/u);
assert.match(deliveryContradictoryAdvice.direction.summary, /组满.{0,40}主持统一口令/u);
assert.doesNotMatch(deliveryContradictoryAdvice.direction.summary, /稳票保位|谁愿意|继续.{0,6}补位/u);
assert.deepEqual(deliveryContradictoryAdvice.direction.examples, [
  "大家按刚才认领等主持口令统一丢。",
]);
assert.match(deliveryContradictoryAdvice.one_thing, /停止拉新认领.{0,30}主持统一发令/u);

for (const wrongDeliveryAction of [
  "先等主持统一口令，谁来抓一下最后一个。",
  "组满了，我再认一手。",
  "不用等主持了，大家现在直接丢。",
  "队组齐了，大家按刚才认领一起丢。",
  "最后一个抓到了，那就丢。",
  "组满了，大家一起丢。",
]) {
  const wrongDeliveryReport = makeRawReport();
  index.applyReportSafetyGates(wrongDeliveryReport, [], {
    sourceScript: wrongDeliveryAction,
    scenario: { phase: "awaiting_drop" },
  });
  assert.equal(
    wrongDeliveryReport.structure_checks.find((item) => item.key === "vote_instruction").status,
    "partial",
    `“${wrongDeliveryAction}”与组满待主持发令的阶段冲突`
  );
  assert.match(wrongDeliveryReport.card_why, /组满待发令/u);
}

const deliveryConflict = makeRawReport();
index.applyReportSafetyGates(deliveryConflict, [], {
  sourceScript: "现在已经组满了，看看还有谁来再补一个。",
  scenario: { phase: "awaiting_drop" },
});
assert.equal(
  deliveryConflict.structure_checks.find((item) => item.key === "vote_instruction").status,
  "partial"
);
assert.match(deliveryConflict.card_why, /组满待发令/u);

const activeDeliveryGood = makeRawReport({
  round_dynamics: validRoundDynamics({ next_move: "主持已经发令，继续接住实际到账并感谢。" }),
  direction: { summary: "按实际到账接住原占位兑现并感谢。", examples: [] },
  one_thing: "只认真实到账，接住原占位兑现。",
});
index.applyReportSafetyGates(activeDeliveryGood, [], {
  sourceScript: "主持口令已经到了，刚才认好的现在按约定丢；谢谢大家，我按实际到账一个个接住。",
  scenario: { phase: "delivery" },
});
assert.equal(
  activeDeliveryGood.structure_checks.find((item) => item.key === "vote_instruction").status,
  "met",
  "主持发令后应接住原占位的实际兑现"
);
assert.doesNotMatch(activeDeliveryGood.round_dynamics.next_move, /继续等.{0,8}主持/u);

const activeDeliveryStillWaiting = makeRawReport({
  round_dynamics: validRoundDynamics({ next_move: "继续等主持口令。" }),
  direction: { summary: "大家继续等主持口令。", examples: [] },
});
index.applyReportSafetyGates(activeDeliveryStillWaiting, [], {
  sourceScript: "主持已经喊了那就丢，刚才占位的按约定兑现，我接住大家的到账。",
  scenario: { phase: "delivery" },
});
assert.match(activeDeliveryStillWaiting.round_dynamics.next_move, /主持已经发令.{0,60}实际到账/u);
assert.doesNotMatch(activeDeliveryStillWaiting.round_dynamics.next_move, /继续等/u);

for (const completedPhase of ["result", "post_round"]) {
  const completedReport = makeRawReport();
  index.applyReportSafetyGates(completedReport, [], {
    sourceScript: "谢谢大家刚才一起把这一关拿下了，你们的出手我都记住了。",
    scenario: { phase: completedPhase },
  });
  assert.equal(
    completedReport.structure_checks.find((item) => item.key === "vote_instruction").status,
    "met",
    `${completedPhase} 阶段的当前动作是结果与关系承接，不是继续拉票`
  );
}

const referencePrompt = prompt.buildUserPrompt(
  "close",
  "我是小夏，我还差十票，大哥你上几张，家人们一人补一点。",
  [
    {
      source: "auto",
      voteGap: "close",
      script: "案例话术",
      whyGood: "案例理由",
      scenario: { id: "round-1", secondsLeft: 30, hostCue: "主持递了最后一脚" },
    },
  ],
  [],
  null
);
assert.match(referencePrompt, /案例现场事实（仅解释案例，禁止当作当前事实）/);
assert.match(referencePrompt, /场景编号=round-1/);
assert.match(referencePrompt, /绝不能迁移成当前现场事实/);

const noScenarioPrompt = prompt.buildUserPrompt("close", "测试原句", [], [], null);
assert.match(noScenarioPrompt, /没有 hostCue 时不得用“没接住主持”扣分/);
assert.match(noScenarioPrompt, /user_reason.{0,80}vote_instruction.{0,160}(?:两项|核心).{0,80}met/u);
assert.match(noScenarioPrompt, /self_intro.{0,80}gratitude.{0,80}target_user.{0,160}partial/u);

// structure_checks：无论模型乱序、缺项或非法枚举，后端固定重建五项。
const normalized = index.normalizeReport({
  card_type: "logic",
  card_why: "测试",
  audience: "榜一",
  verdict: "passed",
  verdict_reason: "模型说可过",
  echo: "收到",
  structure_checks: [
    { key: "target_user", status: "met", evidence: "榜一" + "很".repeat(100) },
    { key: "self_intro", status: "partial", evidence: "只说了\n名字" },
    { key: "gratitude", status: "invalid", evidence: "谢谢礼物" },
    { key: "self_intro", status: "met", evidence: "重复项应忽略" },
    { key: "unknown", status: "met", evidence: "未知项" },
  ],
  line_reviews: [],
  one_thing: "测试",
  direction: { summary: "测试", examples: [] },
  ai_flavor: "",
  redline_note: "",
});
assert.deepEqual(
  normalized.structure_checks.map((item) => item.key),
  structureKeys
);
assert.deepEqual(
  normalized.structure_checks.map((item) => item.status),
  ["partial", "missing", "met", "missing", "missing"]
);
assert.ok(normalized.structure_checks.every((item) => item.evidence.length <= 80));
assert.ok(normalized.structure_checks.every((item) => !/[\r\n\t]/.test(item.evidence)));

// passed 硬门槛只把 user_reason + vote_instruction 视为两项核心；
// self_intro / gratitude / target_user 可以 partial，wrong 与安全问题仍会拦截。
const optionalStructurePartials = index.normalizeReport(
  makeRawReport({
    structure_checks: allMetChecks().map((item) =>
      ["self_intro", "gratitude", "target_user"].includes(item.key)
        ? { ...item, status: "partial" }
        : item
    ),
  })
);
index.applyReportSafetyGates(optionalStructurePartials, []);
assert.equal(
  optionalStructurePartials.verdict,
  "passed",
  "三个非核心项为 partial 时，只要两项核心和其余安全门槛有效就应通过"
);

for (const coreKey of ["user_reason", "vote_instruction"]) {
  const coreGap = index.normalizeReport(
    makeRawReport({
      structure_checks: allMetChecks().map((item) =>
        item.key === coreKey ? { ...item, status: "partial" } : item
      ),
    })
  );
  index.applyReportSafetyGates(coreGap, []);
  assert.notEqual(coreGap.verdict, "passed", `核心项 ${coreKey} 未 met 时不得通过`);
}

const promotableOptionalPartials = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      ["self_intro", "gratitude", "target_user"].includes(item.key)
        ? { ...item, status: "partial" }
        : item
    ),
  })
);
index.applyReportSafetyGates(promotableOptionalPartials, []);
assert.equal(
  promotableOptionalPartials.verdict,
  "passed",
  "模型仅因非核心项 partial 给 almost 时，后端应按新门槛稳定晋级"
);

const wrongPassed = index.normalizeReport(
  makeRawReport({
    line_reviews: [{ original: "站错角度", mark: "wrong", comment: "会吃亏" }],
  })
);
index.applyReportSafetyGates(wrongPassed, []);
assert.equal(wrongPassed.verdict, "almost");

const aiFlavorPassed = index.normalizeReport(
  makeRawReport({ ai_flavor: "这句像套话" })
);
index.applyReportSafetyGates(aiFlavorPassed, []);
assert.equal(aiFlavorPassed.verdict, "off");

// line_reviews fail-closed：空数组、非法 mark 均不能 passed；非法 mark 仍归一为 partial。
const emptyReviewsPassed = index.normalizeReport(makeRawReport({ line_reviews: [] }));
assert.equal(emptyReviewsPassed._lineReviewsContractValid, false);
index.applyReportSafetyGates(emptyReviewsPassed, []);
assert.equal(emptyReviewsPassed.verdict, "almost");

const invalidMarkPassed = index.normalizeReport(
  makeRawReport({
    line_reviews: [{ original: "测试原句", mark: "excellent", comment: "模型乱枚举" }],
  })
);
assert.equal(invalidMarkPassed.line_reviews[0].mark, "partial");
assert.equal(invalidMarkPassed._lineReviewsContractValid, false);
index.applyReportSafetyGates(invalidMarkPassed, []);
assert.equal(invalidMarkPassed.verdict, "almost");

const emptyStructureEvidence = index.normalizeReport(
  makeRawReport({
    structure_checks: allMetChecks().map((item, itemIndex) =>
      itemIndex === 3 ? { ...item, evidence: "   " } : item
    ),
  })
);
assert.equal(emptyStructureEvidence._structureContractValid, false);
index.applyReportSafetyGates(emptyStructureEvidence, []);
assert.equal(
  emptyStructureEvidence.verdict,
  "almost",
  "模型把结构标为 met 却不给证据时必须 fail-closed"
);
assert.equal(JSON.stringify(emptyStructureEvidence).includes("_structureContractValid"), false);

const incompleteLineCoverage = index.normalizeReport(
  makeRawReport({
    line_reviews: [{ original: "只覆盖前半句", mark: "good", comment: "方向正确" }],
  }),
  "只覆盖前半句，后半句其实漏掉了"
);
assert.equal(incompleteLineCoverage._lineReviewsContractValid, false);
index.applyReportSafetyGates(incompleteLineCoverage, []);
assert.equal(
  incompleteLineCoverage.verdict,
  "almost",
  "逐句 original 未覆盖完整原稿时不能 passed"
);

const mergedSentenceReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [{ original: "第一句。第二句！", mark: "good", comment: "整篇一起判断" }],
  }),
  "第一句。第二句！"
);
assert.equal(mergedSentenceReviews._lineReviewsContractValid, false);
index.applyReportSafetyGates(mergedSentenceReviews, []);
assert.equal(
  mergedSentenceReviews.verdict,
  "almost",
  "模型把多个句子合并成一条 good 时不能绕过逐句硬门槛"
);

const paragraphLineReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "第一拍收到反馈。接着换人！", mark: "good", comment: "第一段方向正确" },
      { original: "第二拍暂时没动？下一拍换角度。", mark: "partial", comment: "第二段需要调整" },
    ],
  }),
  "第一拍收到反馈。接着换人！第二拍暂时没动？下一拍换角度。"
);
assert.equal(
  paragraphLineReviews._lineReviewsContractValid,
  true,
  "模型已按多个自然段独立判断时，可机械拆开段内硬标点"
);
assert.equal(paragraphLineReviews.line_reviews.length, 4);
assert.deepEqual(
  paragraphLineReviews.line_reviews.map((item) => item.mark),
  ["good", "good", "partial", "partial"]
);

const exactSentenceReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "第一句。", mark: "good", comment: "第一句方向正确" },
      { original: "第二句！", mark: "good", comment: "第二句方向正确" },
    ],
  }),
  "第一句。第二句！"
);
assert.equal(exactSentenceReviews._lineReviewsContractValid, true);

const exactSemicolonReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "第一句；", mark: "good", comment: "第一句方向正确" },
      { original: "第二句。", mark: "partial", comment: "第二句可以微调" },
    ],
  }),
  "第一句；第二句。"
);
assert.equal(exactSemicolonReviews._lineReviewsContractValid, true);

const exactAsciiPeriodReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "First sentence.", mark: "good", comment: "第一句方向正确" },
      { original: "Second sentence.", mark: "good", comment: "第二句方向正确" },
    ],
  }),
  "First sentence.Second sentence."
);
assert.equal(exactAsciiPeriodReviews._lineReviewsContractValid, true);

const finerClauseReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "长句第一段，", mark: "good", comment: "先看第一段" },
      { original: "长句第二段。", mark: "partial", comment: "再看第二段" },
      { original: "下一句！", mark: "good", comment: "下一句单独看" },
    ],
  }),
  "长句第一段，长句第二段。下一句！"
);
assert.equal(finerClauseReviews._lineReviewsContractValid, true);

const missingSoftCommaReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "长句第一段", mark: "good", comment: "第一段方向正确" },
      { original: "长句第二段。", mark: "good", comment: "第二段方向正确" },
    ],
  }),
  "长句第一段，长句第二段。"
);
assert.equal(missingSoftCommaReviews._lineReviewsContractValid, true);
assert.equal(
  missingSoftCommaReviews.line_reviews.map((item) => item.original).join(""),
  "长句第一段，长句第二段。",
  "模型拆分时只漏软逗号，后端应按原稿位置无损补回"
);

const missingAllPunctuationReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "第一句", mark: "good", comment: "第一句方向正确" },
      { original: "第二句", mark: "good", comment: "第二句方向正确" },
    ],
  }),
  "第一句。第二句！"
);
assert.equal(missingAllPunctuationReviews._lineReviewsContractValid, true);
assert.deepEqual(
  missingAllPunctuationReviews.line_reviews.map((item) => item.original),
  ["第一句。", "第二句！"],
  "模型只漏原稿标点时可以按原位置补回，并保留逐句边界"
);

const movedCommaReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      {
        original: "凯哥，你想看返场，大家不，要投票。",
        mark: "good",
        comment: "模型错误移动了逗号",
      },
    ],
  }),
  "凯哥，你想看返场，大家不要投票。"
);
assert.equal(
  movedCommaReviews._lineReviewsContractValid,
  false,
  "模型新增或移动标点可能改变句意，不能借自动修复通过逐字覆盖门槛"
);

const rewrittenLineReviews = index.normalizeReport(
  makeRawReport({
    line_reviews: [
      { original: "长句第一段，", mark: "good", comment: "第一段方向正确" },
      { original: "模型改写了。", mark: "good", comment: "第二段被改写" },
    ],
  }),
  "长句第一段，长句第二段。"
);
assert.equal(
  rewrittenLineReviews._lineReviewsContractValid,
  false,
  "正文被改写时不能借软标点修复绕过逐字覆盖门槛"
);

const normalizedDirection = index.normalizeReport(
  makeRawReport({
    direction: { summary: "先对准凯哥", examples: ["例".repeat(30)] },
  })
);
assert.match(normalizedDirection.direction.summary, /用你自己的话说/);
assert.equal(Array.from(normalizedDirection.direction.examples[0]).length, 25);

const aiPhraseSource = "我是怀揣舞台梦想的小满，想用热情点燃这个舞台。";
const normalizedAiEvidence = index.normalizeReport(
  makeRawReport({
    card_type: "persona",
    ai_flavor: "整体像舞台腔",
    line_reviews: [{ original: aiPhraseSource, mark: "wrong", comment: "缺个人味" }],
  }),
  aiPhraseSource
);
assert.match(normalizedAiEvidence.ai_flavor, /怀揣舞台梦想/);
assert.match(normalizedAiEvidence.ai_flavor, /点燃这个舞台/);

const scriptedSpeechSource =
  "虽然有点紧张，但既然站在这里，我就会努力到最后一刻。你投的每一票，都是推着我往前的力量。";
const normalizedScriptedSpeechEvidence = index.normalizeReport(
  makeRawReport({
    card_type: "persona",
    ai_flavor: "整段像事先写好的小作文",
    line_reviews: [
      { original: scriptedSpeechSource, mark: "wrong", comment: "反复铺前提再升华" },
    ],
  }),
  scriptedSpeechSource
);
assert.match(normalizedScriptedSpeechEvidence.ai_flavor, /既然站在这里/);
assert.match(normalizedScriptedSpeechEvidence.ai_flavor, /努力到最后一刻/);

// 完整走一次 /api/coach：旧 body 仍 200；新 scenario 作为清洗后的第 5 参传给 prompt。
const baseScript = "我是小夏，凯哥谢谢你刚才的小心心，凯哥你想看撒娇我现在来一个，你愿意就上几张，我还差十票，家人们一人补一点。";
const upstreamReport = {
  card_type: "logic",
  card_why: "结构与方向正确",
  audience: "榜一和散户",
  structure_checks: allMetChecks(),
  verdict: "passed",
  verdict_reason: "可以过关",
  echo: "你想给两边都递戏",
  line_reviews: [{ original: baseScript, mark: "good", comment: "方向正确" }],
  one_thing: "先对准人",
  direction: { summary: "保持方向，用你自己的话说", examples: [] },
  round_dynamics: validRoundDynamics(),
  ai_flavor: "",
  redline_note: "",
};
const originalFetch = globalThis.fetch;
let upstreamCalls = 0;
globalThis.fetch = async () => {
  upstreamCalls += 1;
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(upstreamReport) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

try {
  const workerEnv = {
    ACCESS_CODE: "access-code-123",
    ADMIN_CODE: "admin-code-123",
    DEEPSEEK_API_KEY: "test-key",
  };
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const oldResponse = await index.default.fetch(
    new Request("https://lapiao.test/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessCode: workerEnv.ACCESS_CODE,
        voteGap: "close",
        script: baseScript,
      }),
    }),
    workerEnv,
    ctx
  );
  assert.equal(oldResponse.status, 200);
  const oldBody = await oldResponse.json();
  assert.equal(oldBody.report.structure_checks.length, 5);
  assert.equal(oldBody.report.verdict, "passed");
  assert.equal(globalThis.__lastBuildUserPromptArgs[4], null);

  const scenarioResponse = await index.default.fetch(
    new Request("https://lapiao.test/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessCode: workerEnv.ACCESS_CODE,
        voteGap: "close",
        script: baseScript,
        scenario: {
          id: " round-2 ",
          secondsLeft: 30,
          votesNeeded: 10,
          hostCue: "主持说\n就差最后一脚",
          unknown: "discard",
        },
      }),
    }),
    workerEnv,
    ctx
  );
  assert.equal(scenarioResponse.status, 200);
  assert.deepEqual(globalThis.__lastBuildUserPromptArgs[4], {
    id: "round-2",
    secondsLeft: 30,
    votesNeeded: 10,
    hostCue: "主持说 就差最后一脚",
  });
  assert.deepEqual(globalThis.__retrieveCasesArgs[1].scenario, {
    id: "round-2",
    secondsLeft: 30,
    votesNeeded: 10,
    hostCue: "主持说 就差最后一脚",
  });
  assert.deepEqual(globalThis.__tryAbsorbArgs[1].scenario, {
    id: "round-2",
    secondsLeft: 30,
    votesNeeded: 10,
    hostCue: "主持说 就差最后一脚",
  });

  const callsBeforeInvalid = upstreamCalls;
  const invalidResponse = await index.default.fetch(
    new Request("https://lapiao.test/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessCode: workerEnv.ACCESS_CODE,
        voteGap: "close",
        script: baseScript,
        scenario: { secondsLeft: -1 },
      }),
    }),
    workerEnv,
    ctx
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(upstreamCalls, callsBeforeInvalid);

  // 发布路由沿用管理密码；无鉴权不调用业务函数，成功与 4xx 映射稳定。
  const publishId = "case:absorb:close:abc123";
  delete globalThis.__publishCaseArgs;
  const unauthenticatedPublish = await index.default.fetch(
    new Request(`https://lapiao.test/api/admin/cases/${publishId}/publish`, {
      method: "POST",
    }),
    workerEnv,
    ctx
  );
  assert.equal(unauthenticatedPublish.status, 401);
  assert.equal(globalThis.__publishCaseArgs, undefined);

  globalThis.__publishCaseResult = {
    ok: true,
    alreadyPublished: false,
    publishedAt: 123,
  };
  const publishedResponse = await index.default.fetch(
    new Request(`https://lapiao.test/api/admin/cases/${publishId}/publish`, {
      method: "POST",
      headers: { "X-Admin-Code": workerEnv.ADMIN_CODE },
    }),
    workerEnv,
    ctx
  );
  assert.equal(publishedResponse.status, 200);
  assert.equal(globalThis.__publishCaseArgs[1], publishId);
  assert.deepEqual(await publishedResponse.json(), {
    ok: true,
    alreadyPublished: false,
    publishedAt: 123,
  });

  globalThis.__publishCaseResult = { ok: false, reason: "not_found" };
  const missingPublish = await index.default.fetch(
    new Request("https://lapiao.test/api/admin/cases/case:absorb:far:missing/publish", {
      method: "POST",
      headers: { "X-Admin-Code": workerEnv.ADMIN_CODE },
    }),
    workerEnv,
    ctx
  );
  assert.equal(missingPublish.status, 404);

  const deletePublishPath = await index.default.fetch(
    new Request(`https://lapiao.test/api/admin/cases/${publishId}/publish`, {
      method: "DELETE",
      headers: { "X-Admin-Code": workerEnv.ADMIN_CODE },
    }),
    workerEnv,
    ctx
  );
  assert.equal(deletePublishPath.status, 404);
  await Promise.all(pending);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__lastBuildUserPromptArgs;
  delete globalThis.__retrieveCasesArgs;
  delete globalThis.__tryAbsorbArgs;
  delete globalThis.__publishCaseArgs;
  delete globalThis.__publishCaseResult;
}

// 旧 manual 没 status 也视为 published；旧 auto 没 status 视为 candidate，不参与检索。
const kv = new MemoryKV([
  [
    "case:1:manual",
    {
      id: "case:1:manual",
      source: "manual",
      script: "大哥你上几张，剩下家人们一人补一点",
      voteGap: "far",
      whyGood: "给大哥递台阶，也给散户参与感",
      tags: ["大哥", "家人们", "上票"],
      createdAt: 1,
      deleted: false,
    },
  ],
  [
    "case:absorb:far:legacy",
    {
      id: "case:absorb:far:legacy",
      source: "auto",
      script: "今晚给大家亮一手，大哥带一带",
      voteGap: "far",
      whyGood: "旧自动过关稿",
      tags: ["今晚", "大哥", "带一带"],
      createdAt: 2,
      deleted: false,
    },
  ],
]);
const env = { CASES: kv };
const retrieved = await cases.retrieveCases(env, {
  voteGap: "far",
  script: "大哥家人们今晚帮我上票",
});
assert.equal(retrieved.length, 1);
assert.equal(retrieved[0].source, "manual");

// 无场景 auto 发布后仍按旧逻辑检索；manual 在任何 incoming scenario 下都可用。
const legacyPublish = await cases.publishCase(env, "case:absorb:far:legacy");
assert.equal(legacyPublish.ok, true);
const freeLegacyRetrieval = await cases.retrieveCases(env, {
  voteGap: "far",
  script: "今晚给大家亮一手，大哥带一带",
});
assert.ok(freeLegacyRetrieval.some((item) => item.script.includes("今晚给大家亮一手")));
const manualAcrossScenario = await cases.retrieveCases(env, {
  voteGap: "far",
  script: "大哥家人们帮我上票",
  scenario: { id: "another-round" },
});
assert.ok(manualAcrossScenario.some((item) => item.source === "manual"));

// 有具体场景但没有稳定 id 的 auto 无法证明“同场”，不得跨场检索或新增。
await kv.put(
  "case:absorb:close:no-scene-id",
  JSON.stringify({
    id: "case:absorb:close:no-scene-id",
    source: "auto",
    status: "published",
    script: "凯哥你想看撒娇就再逗逗我",
    voteGap: "close",
    whyGood: "具体场景经验",
    tags: ["撒娇"],
    scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
    createdAt: 3,
    deleted: false,
  })
);
const unidentifiedScenarioRetrieval = await cases.retrieveCases(env, {
  voteGap: "close",
  script: "凯哥想看撒娇",
  scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
});
assert.ok(
  unidentifiedScenarioRetrieval.every((item) => item.script !== "凯哥你想看撒娇就再逗逗我")
);
const unidentifiedAbsorb = await cases.tryAbsorb(env, {
  script: "凯哥你想看撒娇就再逗逗我",
  voteGap: "close",
  report: { verdict_reason: "有具体上下文", one_thing: "不能跨场学" },
  scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
});
assert.equal(unidentifiedAbsorb, null);

// 自动过关只创建 candidate，且 candidate 不会反向进入检索。
const candidateScript = "还差一点，大哥你上几张，家人们一人补一点，我马上亮一手";
const candidateScenario = {
  id: "round-close-1",
  secondsLeft: 30,
  votesNeeded: 10,
  hostCue: "主持递了最后一脚",
};
const candidateId = await cases.tryAbsorb(env, {
  script: candidateScript,
  voteGap: "close",
  report: { verdict_reason: "有明确支点", one_thing: "给观众递台阶" },
  scenario: candidateScenario,
});
assert.ok(candidateId);
const candidate = await kv.get(candidateId, "json");
assert.equal(candidate.source, "auto");
assert.equal(candidate.status, "candidate");
assert.deepEqual(candidate.scenario, candidateScenario);

const candidateRetrieval = await cases.retrieveCases(env, {
  voteGap: "close",
  script: candidateScript,
  scenario: candidateScenario,
});
assert.ok(candidateRetrieval.every((item) => item.script !== candidateScript));

// 只有发布后 candidate 才参与检索；重复发布幂等且不刷新 publishedAt。
const firstPublish = await cases.publishCase(env, candidateId);
assert.equal(firstPublish.ok, true);
assert.equal(firstPublish.alreadyPublished, false);
assert.ok(firstPublish.publishedAt > 0);
assert.equal((await kv.get(candidateId, "json")).status, "published");

const freePublishedRetrieval = await cases.retrieveCases(env, {
  voteGap: "close",
  script: candidateScript,
});
assert.ok(freePublishedRetrieval.every((item) => item.script !== candidateScript));

const wrongScenarioRetrieval = await cases.retrieveCases(env, {
  voteGap: "close",
  script: candidateScript,
  scenario: { id: "round-close-2" },
});
assert.ok(wrongScenarioRetrieval.every((item) => item.script !== candidateScript));

const publishedRetrieval = await cases.retrieveCases(env, {
  voteGap: "close",
  script: candidateScript,
  scenario: { id: candidateScenario.id },
});
const matchedPublished = publishedRetrieval.find((item) => item.script === candidateScript);
assert.ok(matchedPublished);
assert.deepEqual(matchedPublished.scenario, candidateScenario);

const repeatedPublish = await cases.publishCase(env, candidateId);
assert.deepEqual(repeatedPublish, {
  ok: true,
  alreadyPublished: true,
  publishedAt: firstPublish.publishedAt,
});

// 删除即拒绝；拒绝后不能发布，同稿再次过关也不会自动复活。
assert.equal(await cases.softDeleteCase(env, candidateId), true);
const rejected = await kv.get(candidateId, "json");
assert.equal(rejected.deleted, true);
assert.equal(rejected.status, "rejected");
assert.deepEqual(await cases.publishCase(env, candidateId), {
  ok: false,
  reason: "rejected",
});

const revivedId = await cases.tryAbsorb(env, {
  script: candidateScript,
  voteGap: "close",
  report: { verdict_reason: "再次过关", one_thing: "不应复活" },
  scenario: candidateScenario,
});
assert.equal(revivedId, null);
assert.equal((await kv.get(candidateId, "json")).status, "rejected");

// 手动投喂直接发布；后台清单对旧/新数据都补齐兼容 status。
const manualId = await cases.addManualCase(env, {
  script: "家人们最后补一脚，今晚说到做到",
  voteGap: "close",
  whyGood: "指令明确",
});
assert.equal((await kv.get(manualId, "json")).status, "published");
assert.deepEqual(await cases.publishCase(env, manualId), {
  ok: false,
  reason: "manual",
});
assert.deepEqual(await cases.publishCase(env, "case:absorb:far:notfound"), {
  ok: false,
  reason: "not_found",
});

const autoList = await cases.listAdminCases(env, {
  source: "auto",
  includeDeleted: true,
  limit: 50,
  cursor: null,
});
assert.ok(autoList.items.some((item) => item.status === "published"));
assert.ok(autoList.items.some((item) => item.status === "rejected"));

console.log("PASS worker safety gates and case lifecycle");
