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
assert.match(prompt.SYSTEM_PROMPT, /"给我补一脚\/跟上一点\/帮我补上\/上几张\/投一票".{0,80}必须判 met/u);
assert.match(prompt.SYSTEM_PROMPT, /recentGift 只证明这个用户刚才支持过.{0,120}不能把过去送礼直接当 user_reason/u);
assert.match(prompt.SYSTEM_PROMPT, /"补一点\/上几张\/一人一票".{0,80}不是当前还差的准确票数/u);
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
  "partial"
);
assert.equal(actionWithoutExactVoteGap.verdict, "almost");

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
assert.equal(twoStructureGapsWithoutSupport.verdict, "off");

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
  assert.equal(genericAudienceTarget.verdict, "almost");
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
  "partial",
  "有现场目标时不能用另一个昵称替代"
);

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
  "partial",
  "只在感谢里提到目标用户不算 Q 用户"
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

for (const commaLeakScript of [
  "凯哥，谢谢你刚才的小心心，家人们现在补一点。",
  "凯哥，谢谢你，小王你愿意就补一点。",
  "凯哥，谢谢你，那你们想看的都补一票。",
  "凯哥，谢谢你，你们一起补一票。",
]) {
  const commaLeakTarget = makeReportForScript(commaLeakScript);
  index.applyReportSafetyGates(commaLeakTarget, [], {
    sourceScript: commaLeakScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    commaLeakTarget.structure_checks.find((item) => item.key === "target_user").status,
    "partial",
    `感谢后的群体或他人动作不能算作 Q 凯哥：${commaLeakScript}`
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

for (const guidedWrongPersonScript of [
  "凯哥，刚才小王你愿意就补一点。",
  "凯哥，主持刚说小王你想看返场就扣1。",
  "凯哥，谢谢你，刚才小王你愿意就补一点。",
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
    "partial",
    `引导词中夹入别人时不能算 Q 凯哥：${guidedWrongPersonScript}`
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
  "凯哥，你想看新舞吗？",
  "凯哥，你想看新舞也别补票。",
  "凯哥，你想看返场，但没必要扣1。",
  "凯哥，你想看返场，但没有必要扣1。",
  "凯哥，你想看返场，也不由你来决定。",
  "凯哥，你想看新舞，我先补点妆。",
  "凯哥，你想看新舞就给我倒杯水。",
  "凯哥，你想看新舞，我决定不跳。",
  "凯哥，你想看新舞，我选节目。",
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
assert.match(noScenarioPrompt, /五项全 met、line_reviews 中 0 个 wrong/);

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

// passed 硬门槛：结构缺口或 wrong → almost；AI 味/人设问题 → off。
const structureGap = index.normalizeReport(
  makeRawReport({
    structure_checks: allMetChecks().map((item, itemIndex) =>
      itemIndex === 1 ? { ...item, status: "partial" } : item
    ),
  })
);
index.applyReportSafetyGates(structureGap, []);
assert.equal(structureGap.verdict, "almost");

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
const baseScript = "我是小夏，凯哥谢谢你刚才的小心心，凯哥你愿意就上几张，我还差十票，家人们一人补一点。";
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
