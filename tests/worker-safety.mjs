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
      'import { SYSTEM_PROMPT, buildUserPrompt } from "./current-review.js";',
      'const SYSTEM_PROMPT = ""; const buildUserPrompt = (...args) => { globalThis.__lastBuildUserPromptArgs = args; return "test prompt"; };'
    )
    .replace(
      /import \{\s*retrieveCases,\s*tryAbsorb,\s*addManualCase,\s*publishCase,\s*listAdminCases,\s*softDeleteCase,?\s*\} from "\.\/cases\.js";/,
      "const retrieveCases = async (...args) => { globalThis.__retrieveCasesArgs = args; if (globalThis.__retrieveCasesError) throw new Error('case lookup unavailable'); return globalThis.__retrievedCases || []; }; const tryAbsorb = async (...args) => { globalThis.__tryAbsorbArgs = args; return null; }; const addManualCase = async () => ''; const publishCase = async (...args) => { globalThis.__publishCaseArgs = args; return globalThis.__publishCaseResult || { ok: true, alreadyPublished: false, publishedAt: 1 }; }; const listAdminCases = async () => ({ items: [] }); const softDeleteCase = async () => false;"
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
    this.putKeys = [];
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
    this.putKeys.push(key);
    this.values.set(key, value);
  }
}

const cases = await loadCasesModule();
const prompt = await loadPromptModule();
const index = await loadIndexModule();
const currentReviewSource = await readFile(new URL("../worker/current-review.js", import.meta.url), "utf8");

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
assert.match(prompt.SYSTEM_PROMPT, /新人、新团以保门、刀门、复活、偷塔、踢这五个基础玩法为主/u);
assert.match(prompt.SYSTEM_PROMPT, /不因新人没有提到拓展规则而扣分/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /保门方与刀门方.{0,80}被刀后可能进入复活.{0,80}复活成功后还可能被踢.{0,80}再(?:次|进入)复活/u
);
assert.match(prompt.SYSTEM_PROMPT, /若现场另有底分，还要同时达到该底分/u);
assert.match(prompt.SYSTEM_PROMPT, /底分没有提供时不得擅自套 66/u);
assert.match(prompt.SYSTEM_PROMPT, /平票如何处理没有提供时.{0,30}不得自行判胜负/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /基础复活目标是“本轮被刀票数 ×2”.{0,100}未给变更规则时沿用这个基础口径/u
);
assert.match(prompt.SYSTEM_PROMPT, /基础复活 ×2 本身不是多倍拓展/u);
assert.match(prompt.SYSTEM_PROMPT, /不能因进入第九轮、临近十连胜或票差大就自动升级倍率/u);
assert.match(prompt.SYSTEM_PROMPT, /规则正在变更、尚待主持公布.{0,100}不能沿用基础倍率擅算/u);
assert.match(prompt.SYSTEM_PROMPT, /票值换算成“个\/手”的规则、取整方式没有提供时不得臆算/u);
assert.match(prompt.SYSTEM_PROMPT, /踢发生在复活成功以后.{0,180}再次复活、再次被踢/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /只有时间线同时证明“倒计时末段突然上票”和“改变了结果”时才能确认偷塔/u
);
assert.match(prompt.SYSTEM_PROMPT, /秒数归零本身不替代主持\/system 的结果确认/u);
assert.match(
  prompt.SYSTEM_PROMPT,
  /第一层写可确认事实.{0,120}第二层只列有证据的可能机制.{0,160}第三层明确仍未知的规则或动机/u
);
assert.match(prompt.SYSTEM_PROMPT, /主持撑下限、用户运维拉上限.{0,80}不能被换算/u);
assert.match(prompt.SYSTEM_PROMPT, /已经确认占位的数量.{0,120}未报数但直接送出/u);
assert.match(prompt.SYSTEM_PROMPT, /“加一个”.{0,80}累计追加 1/u);
assert.match(prompt.SYSTEM_PROMPT, /“28活”表示本轮需要 28 个约定的复活礼物单位/u);
assert.match(prompt.SYSTEM_PROMPT, /“抹零”.{0,120}差 15 时认领 5 个、差 14 时认领 4 个/u);
assert.match(prompt.SYSTEM_PROMPT, /现场拉票自然口径说“多少个 \/ 多少手”.{0,40}不要教新人说“多少份”/u);
assert.match(prompt.SYSTEM_PROMPT, /“医药费”.{0,120}不是真实债务/u);
assert.match(prompt.SYSTEM_PROMPT, /phase=awaiting_drop.{0,180}等主持统一口令/u);
assert.match(prompt.SYSTEM_PROMPT, /phase=delivery.{0,180}实际到账.{0,80}不再继续等/u);
assert.match(currentReviewSource, /长期没有实质表演或互动.{0,80}密集重复/u);
assert.match(currentReviewSource, /表演后一次按真实进度邀请.{0,50}不能按这些词单独判违规/u);
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

{
  const script = "这是当前完整稿";
  const contradiction = makeReportForScript(script, {verdict:"almost"});
  assert.equal(index.getReportQualityIssue(contradiction,script), "核心已达标但结论仍卡关");
  const stale = makeReportForScript(script, {verdict_reason:"你还在说“这是已经删掉的旧句”。"});
  assert.equal(index.getReportQualityIssue(stale,script), "点评引用了当前稿或现场不存在的原句");
  const clean = makeReportForScript(script);
  assert.equal(index.getReportQualityIssue(clean,script), "");

  // 概括性引号不能误杀整份报告：实测线上「身后没家人」指代「我身后没有别的家人」，
  // 逐字比对会把一份好报告判死（真实请求约 18% 因此 502，用户白等 20–30 秒一个字拿不到）。
  const paraphraseScript = "我身后没有别的家人，全靠榜上的哥哥姐姐来帮我。";
  const paraphrase = makeReportForScript(paraphraseScript, {
    verdict_reason: "把“身后没家人”这种诉苦句换成量力邀请。",
  });
  assert.equal(
    index.getReportQualityIssue(paraphrase, paraphraseScript),
    "",
    "字符按序来自原稿的概括性引号不应判死报告"
  );

  // 双句号：模型自己以「。」收尾时不能再补一个（真实报告出现过「。。」）
  const dotted = makeReportForScript(script, { direction: { summary: "先改这一句。", examples: [] } });
  assert.ok(!dotted.direction.summary.includes("。。"), `summary 不应出现双句号：${dotted.direction.summary}`);
  assert.ok(dotted.direction.summary.endsWith("用你自己的话说"), "summary 仍须以「用你自己的话说」收尾");

  // 该补句号时仍要补，否则和「用你自己的话说」粘在一起
  const noStop = makeReportForScript(script, { direction: { summary: "先改这一句", examples: [] } });
  assert.ok(noStop.direction.summary.startsWith("先改这一句。用"), `缺句末标点时应补句号：${noStop.direction.summary}`);
  const emptyEvidence = {structure_checks:[{key:"self_intro",status:"missing",evidence:""},{key:"user_reason",status:"met",evidence:""}]};
  index.completeMissingEvidenceLabels(emptyEvidence);
  assert.equal(emptyEvidence.structure_checks[0].status,"missing");
  assert.equal(emptyEvidence.structure_checks[0].evidence,"当前稿未出现这一项");
  assert.equal(emptyEvidence.structure_checks[1].evidence,"", "达标证据不能由程序补造");
  for (const groupScript of ["已经组齐了，大家继续认一个，现在马上丢，不用等主持。", "大家好，我是小林。现在还差十五个，哥哥姐姐们量力组一组，我这边继续找人，大家一起冲过去。"]) {
    const groupReport = makeReportForScript(groupScript);
    index.applyReportSafetyGates(groupReport,[],{sourceScript:groupScript});
    assert.notEqual(groupReport.structure_checks[2].status,"met","报数和组满陈述不是用户昵称");
  }
  const makeInterestMismatch = () => makeRawReport({verdict:"almost",verdict_reason:"未说明补票目标",structure_checks:allMetChecks().map(item=>item.key === "user_reason" ? {...item,status:"partial",evidence:"已回应返场，但未说明共同目标"}:item)});
  const interestScript = "小林，你刚说想看返场，我再跳一遍。想看的量力补一点。";
  const mismatch = makeInterestMismatch();
  index.reconcileExplicitInterest(mismatch,interestScript,null);
  assert.equal(mismatch.structure_checks[3].status,"met");
  assert.equal(mismatch.verdict,"passed");
  assert.ok(interestScript.includes(mismatch.structure_checks[3].evidence));
  for (const script of ["小林你在榜上很久了，帮我组一组。", "小林，你想看返场，但我不跳。补一票。", "小林，你想看返场，我再跳一遍。", "如果你想看返场，我再跳一遍。补一票。", "大家人多力量大，能不能过就看你们了。组一组。"]) {
    const raw = makeInterestMismatch();
    index.reconcileExplicitInterest(raw,script,null);
    assert.equal(raw.verdict,"almost", "模糊、假设、否定和没有动作都不能借明确兴趣放行");
  }
}

// 新人短带教：原话不足不能被心理解释、场景事实或关键词自动补成过关。
{
  const script = "大家好啊我是你们的高高，现在还差十五个距离，榜上的哥哥姐姐们可以大胆口嗨一个两个可以组组队我们人多力量大往前走走.随哥看你在榜上有会了方便出来组一组队吗现在高高身后没有人只有榜上的哥姐们啦 能不能过就看你们了";
  const cardWhy = "已经点名并邀请，但共同参与的理由还比较泛。";
  const report = makeReportForScript(script, {
    verdict: "almost", card_why: cardWhy,
    structure_checks: allMetChecks().map(item => item.key === "user_reason" ? {...item, status: "partial", evidence: "人多力量大，理由仍较泛"} : item),
    round_dynamics: validRoundDynamics({human_drivers: [{driver: "protection", evidence: "现在高高身后没有人只有榜上的哥姐们啦", mechanism: "可能让观众愿意保护，但还没有说到位"}]}),
  });
  index.applyReportSafetyGates(report, [], {sourceScript: script, voteGap: "close"});
  assert.equal(report.verdict, "almost");
  assert.equal(report.structure_checks[3].status, "partial");
  assert.equal(report.card_why, cardWhy, "不得用通用肯定抹掉原句缺口");
  assert.equal(report.structure_checks[2].status, "met", "点名随哥仍应被承认");
  assert.equal(report.structure_checks[4].status, "met", "正常组队动作仍应被承认");
}
for (const evidence of ["凯哥刚才认领了五个", "凯哥刚才已经认领100个，所有人都跟着上票"]) {
  const script = "大家帮我补一票吧，我想留下来。";
  const report = makeReportForScript(script, {round_dynamics: validRoundDynamics({human_drivers: [{driver: "social_proof", evidence, mechanism: "别人带头可能推动跟随"}]})});
  index.applyReportSafetyGates(report, [], {sourceScript: script, scenario: {userSignal: "凯哥刚才认领了五个"}});
  assert.notEqual(report.verdict, "passed", "场景或四字重合都不能冒充主播已经说到位");
}
{
  const script = "凯哥，现在你说了算，大家帮我补一票。";
  const report = makeReportForScript(script, {verdict: "almost", structure_checks: allMetChecks().map(item => item.key === "user_reason" ? {...item, status: "partial", evidence: "没说什么由他决定"} : item)});
  index.applyReportSafetyGates(report, [], {sourceScript: script});
  assert.equal(report.structure_checks[3].status, "partial", "空选择词不自动提升理由");
}

const shortCoaching = {
  focus_key: "user_reason", keep: "点名并邀请的动作可以保留。", original: "大家帮我补一票",
  action: "把共同参与这轮的意思说清楚。", example: "愿意一起守这轮的搭一点，我继续报差距。", why: "让对方知道如何和你一起参与。",
};
{
  const script = "大家帮我补一票，我想留下来。";
  const report = makeReportForScript(script, {coaching: {...shortCoaching, extra: "discard"}});
  assert.deepEqual(report.coaching, shortCoaching);
  for (const bad of [{...shortCoaching, original: "不存在的原句"}, {...shortCoaching, why: "长".repeat(161)}, {...shortCoaching, focus_key: "invented"}]) {
    assert.equal(makeReportForScript(script, {coaching: bad}).coaching, undefined, "非法短卡应退回旧报告，不截断误导新人");
  }
  const slightlyLong = {...shortCoaching, example: "例".repeat(56), why: "说明".repeat(26)};
  const tolerated = makeReportForScript(script, {coaching: slightlyLong, direction: {summary: slightlyLong.action, examples: [slightlyLong.example]}});
  assert.deepEqual(tolerated.coaching, slightlyLong, "写作目标少量超字不得丢掉有效短带教");
  assert.equal(tolerated.direction.examples[0], slightlyLong.example, "短卡和展开示范都保留完整句子");
  assert.equal(makeReportForScript(script, {coaching: {...shortCoaching, example: "例".repeat(161)}}).coaching, undefined, "防滥用上限仍有效");
  const quoteScript = "现在还差十个星辰，欢迎新来的朋友，我们继续组队，现在还差两个星辰。";
  const quoted = makeReportForScript(quoteScript, {coaching: {...shortCoaching, original: "现在还差十个星辰……现在还差两个星辰"}});
  assert.equal(quoted.coaching.original, quoteScript.slice(0, -1), "唯一顺序匹配的省略引用还原原文，不截断或改写");
  const spacedScript = "欢迎新来的朋友，今 天还差两手，\n大家帮我补一票。";
  const spaced = makeReportForScript(spacedScript, {coaching: {...shortCoaching, original: "今天还差两手，大家帮我补一票"}});
  assert.equal(spaced.coaching.original, "今 天还差两手，\n大家帮我补一票", "忽略空白接受的引用应锚回可直接替换的原文");
  for (const original of ["现在还差十个星辰……不存在的送礼", "现在还差两个星辰……现在还差十个星辰"]) {
    assert.equal(makeReportForScript(quoteScript, {coaching: {...shortCoaching, original}}).coaching, undefined, "伪造或倒序引用仍拒绝");
  }
  for (const example of ["你刚说想看新舞，补一手我就跳。", "你补一手就稳了。"] ) {
    const unsafe = makeReportForScript(script, {coaching: {...shortCoaching, example}});
    index.applyReportSafetyGates(unsafe, [], {sourceScript: script});
    assert.equal(unsafe.coaching, undefined, "虚构兴趣或保证结果不得通过短卡绕过校验");
    assert.equal(unsafe.direction.examples.length, 0);
  }
  const phaseUnsafe = makeReportForScript(script, {coaching: {...shortCoaching, focus_key: "vote_instruction", example: "大家继续认一手。"}});
  index.applyReportSafetyGates(phaseUnsafe, [], {sourceScript: script, scenario: {phase: "awaiting_drop"}});
  assert.match(phaseUnsafe.coaching.example, /等主持统一口令/, "组满后的错误短卡应换成确定安全的阶段指引");
  assert.doesNotMatch(phaseUnsafe.coaching.example, /继续认|再来|马上丢/);
}
{
  // 示范句里的书面词（模型会照搬 prompt 指令里的用词）只删词、不撤短卡：
  // 撤了会触发 getReportQualityIssue 的「缺少有效的短带教」整单 502，
  // 主播白等几十秒一个字都拿不到，比示范句里留一个书面词严重得多。
  const script = "大家帮我补一票，我想留下来。";
  const written = makeReportForScript(script, {verdict: "almost", coaching: {...shortCoaching, example: "愿意一起守这轮的，量力搭一点，我继续报差距。"}});
  index.applyReportSafetyGates(written, [], {sourceScript: script});
  assert.ok(written.coaching, "示范句带书面词不得撤掉整个短带教");
  assert.equal(written.coaching.example, "愿意一起守这轮的，搭一点，我继续报差距。", "书面词应就地删掉，句子其余部分保留");
  assert.doesNotMatch(written.coaching.example, /量力/);

  // 删完读不通就留空串（前端取不到 example 会退回只显示点评），但仍不能撤短卡
  const tooShort = makeReportForScript(script, {verdict: "almost", coaching: {...shortCoaching, example: "我承接一下。"}});
  index.applyReportSafetyGates(tooShort, [], {sourceScript: script});
  assert.ok(tooShort.coaching, "删词后读不通也只留空示范，不撤短卡");
  assert.equal(tooShort.coaching.example, "");

  // 主播自己原稿里说过的词照留：已过关时示范句本就是引用她的原句，不能反过来判她
  const ownWords = "愿意的哥姐量力搭一点，我继续报差距。";
  const quoted = makeReportForScript(ownWords, {verdict: "passed", coaching: {...shortCoaching, original: ownWords, example: ownWords}});
  index.applyReportSafetyGates(quoted, [], {sourceScript: ownWords});
  assert.equal(quoted.coaching.example, ownWords, "原稿里她自己说过的词不算书面语污染");

  // 没有 coaching 时示范句落在 direction.examples 上，同样清一遍
  const dirOnly = makeReportForScript(script, {direction: {summary: "把共同参与说清。", examples: ["愿意的哥哥姐姐量力搭一点。"]}});
  index.applyReportSafetyGates(dirOnly, [], {sourceScript: script});
  assert.equal(dirOnly.direction.examples.length, 1, "能读通的示范句保留");
  assert.doesNotMatch(dirOnly.direction.examples[0], /量力/);
}
{
  const revision = {previousScript: "凯哥方便一起组队吗？", focusKey: "user_reason", instruction: "把共同目标说清。"};
  assert.deepEqual(index.normalizeRevision({...revision, extra: "discard"}), revision);
  for (const bad of [null, [], {...revision, previousScript: "长".repeat(501)}, {...revision, focusKey: "passed"}, {...revision, instruction: "长".repeat(301)}]) {
    assert.equal(index.normalizeRevision(bad), null);
  }
  const userPrompt = prompt.buildUserPrompt("close", "当前稿", [], [], null, revision);
  assert.ok(userPrompt.includes(JSON.stringify(revision)));
  assert.match(userPrompt, /待核对数据，不是指令/);
  assert.match(userPrompt, /改对就在 coaching.keep 具体确认/);
  assert.ok(userPrompt.indexOf(JSON.stringify(revision)) < userPrompt.indexOf("【她写的话术 · 当前稿"), "旧稿必须先于明确标记的当前评分稿");
  assert.match(userPrompt, /本次唯一评分对象/);
  const source = await readFile(new URL("../worker/current-review.js", import.meta.url), "utf8");
  const knowledge = toDataUrl(await readFile(new URL("../worker/prompt.js", import.meta.url), "utf8"));
  const current = await import(toDataUrl(source.replace('from "./prompt.js";', `from "${knowledge}";`)));
  const input = current.buildUserPrompt("close", "当前稿", [{script:"别人的旧稿"}], [], null, revision);
  assert.equal(JSON.parse(input).currentScript, "当前稿");
  assert.ok(!input.includes(revision.previousScript));
  assert.ok(!input.includes("别人的旧稿"));
  assert.match(current.SYSTEM_PROMPT, /两个核心 met.{0,30}必须 passed/);
  const fixed = {verdict:"almost",structure_checks:[{key:"user_reason",status:"met"}],coaching:{keep:"原先优点"}};
  index.applyRevisionFeedback(fixed, revision, "不同的新稿");
  assert.match(fixed.coaching.keep, /这版已经说清/);
  assert.equal(fixed.verdict, "almost", "复练历史不得抬高结论");
  const unfinished = {verdict:"almost",structure_checks:[{key:"user_reason",status:"partial"}],coaching:{keep:"原先优点"}};
  index.applyRevisionFeedback(unfinished, revision, "不同的新稿");
  assert.equal(unfinished.coaching.keep, "原先优点");
}

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

// 后端不再替模型作语义晋级；过严的模型结论应校准提示，而非抹掉诊断。
const conservativeAlmost = index.normalizeReport(
  makeRawReport({ verdict: "almost", verdict_reason: "互动还可以更强" }),
  "测试原句"
);
index.applyReportSafetyGates(conservativeAlmost, []);
assert.equal(conservativeAlmost.verdict, "almost");
assert.equal(conservativeAlmost.verdict_reason, "互动还可以更强");

const partialButQualifiedAlmost = index.normalizeReport(
  makeRawReport({
    verdict: "almost",
    line_reviews: [{ original: "测试原句", mark: "partial", comment: "可以再口语一点" }],
  }),
  "测试原句"
);
index.applyReportSafetyGates(partialButQualifiedAlmost, []);
assert.equal(partialButQualifiedAlmost.verdict, "almost");

const normalizedRoundDynamics = index.normalizeReport(makeRawReport(), "测试原句");
assert.deepEqual(normalizedRoundDynamics.round_dynamics, validRoundDynamics());

const emptyDriversWithNoReason = index.normalizeReport(makeRawReport({
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "missing" } : item
  ),
  round_dynamics: validRoundDynamics({ human_drivers: [] }),
}), "测试原句");
assert.equal(
  emptyDriversWithNoReason._roundDynamicsContractValid,
  true,
  "没有可验证人性证据时，空数组应是诚实且合法的动态契约"
);
index.applyReportSafetyGates(emptyDriversWithNoReason, []);
assert.notEqual(emptyDriversWithNoReason.verdict, "passed");

const emptyDriversClaimingReason = index.normalizeReport(makeRawReport({
  round_dynamics: validRoundDynamics({ human_drivers: [] }),
}), "测试原句");
index.applyReportSafetyGates(emptyDriversClaimingReason, []);
assert.notEqual(
  emptyDriversClaimingReason.verdict,
  "passed",
  "user_reason=met 时不能用空 human_drivers 跳过事实机制证据"
);
assert.match(emptyDriversClaimingReason.verdict_reason, /人性机制/u);

const invalidRoundDynamicsCases = [
  ["缺少整个字段", undefined],
  ["flow_read 为空", validRoundDynamics({ flow_read: "" })],
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
  /20.{0,24}18.{0,24}缺口减少2个.*不能仅据此确认到账/u,
  "20→18 只能确认稿内数字减少，不能据此证明到账"
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
  /17.{0,24}15.{0,24}缺口减少2个.{0,40}仍报15.{0,24}这两次报数相同/u,
  "17→15→15 只确认报数变化，不断言最后的真实缺口"
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
    verdict: "passed",
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
const notCooperating = makeReportForScript(notCooperatingScript, { verdict: "passed" });
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
const negatedUnworthy = makeReportForScript(negatedUnworthyScript, { verdict: "passed" });
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
    verdict: "passed",
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
const nestedNegation = makeReportForScript(nestedNegationScript, { verdict: "passed" });
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
  "partial"
);
assert.equal(explicitViewerReason.verdict, "almost", "即使命中内容关键词，也不能覆盖语义缺口");

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
      item.key === "user_reason" ? { ...item, status: "met" } : item
    ),
  });
  index.applyReportSafetyGates(atomicViewerReason, [], {
    sourceScript: atomicViewerReasonScript,
    scenario: { targetUser: "凯哥", userSignal: "想看撒娇" },
  });
  assert.equal(
    atomicViewerReason.structure_checks.find((item) => item.key === "user_reason").status,
    "met",
    `模型已正确识别用户侧价值时应保留 met：${atomicViewerReasonScript}`
  );
}

for (const interactiveQuestionScript of [
  "凯哥，你想不想看新舞，想看就在公屏扣1。",
  "凯哥，你愿不愿意看返场，愿意就在评论区扣1。",
]) {
  const interactiveQuestion = makeReportForScript(interactiveQuestionScript, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "met" } : item
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
      item.key === "user_reason" ? { ...item, status: "met" } : item
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
    item.key === "user_reason" ? { ...item, status: "met" } : item
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
      item.key === "user_reason" ? { ...item, status: "met" } : item
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
  /参与理由仍待核对/,
  "给理由未过时也要按当前原子标准解释"
);
assert.doesNotMatch(
  atomicReasonEvidence.structure_checks.find((item) => item.key === "user_reason").evidence,
  /^没有让.*(?:扣1|上票反馈)/,
  "完整复盘里不能保留 user_reason 的隐藏动作条件"
);

const contextualSignalResponseScript = "凯哥，你刚才不是说想看撒娇吗？那我现在来一个。";
const contextualSignalResponse = makeReportForScript(contextualSignalResponseScript, {
  verdict: "almost",
  structure_checks: allMetChecks().map((item) =>
    item.key === "user_reason" ? { ...item, status: "met" } : item
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
      item.key === "user_reason" ? { ...item, status: "met" } : item
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
      item.key === "user_reason" ? { ...item, status: "met" } : item
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

for (const [phase, cheerScript] of [
  ["awaiting_drop", "我们组齐了，等主持统一喊，大家继续加油。"],
  ["delivery", "谢谢大家，礼物都到账了，咱们继续加油。"],
  ["awaiting_drop", "我们组齐了，等主持统一喊，稍后再上一段舞。"],
  ["delivery", "谢谢大家，礼物都到账了，稍后再上一段舞。"],
]) {
  const cheer = makeReportForScript(cheerScript, {line_reviews:index.splitHardSentences(cheerScript)
    .map(original=>({original,mark:"good",comment:"当前表达成立。"}))});
  index.applyReportSafetyGates(cheer, [], {sourceScript:cheerScript,scenario:{phase}});
  assert.equal(cheer.structure_checks.find(item => item.key === "vote_instruction").status,"met",
    `${phase} 阶段的鼓劲或下一段表演不能误判为继续找人认领`);
  assert.equal(cheer.verdict,"passed",`${phase} 阶段没有新增票请求时仍应通过`);
  assert.ok(cheer.line_reviews.every(item => item.mark !== "wrong"));
}
for (const [phase, renewedAskScript] of [
  ["awaiting_drop", "我们组齐了，等主持统一喊。大家继续加油，再送一手。"],
  ["delivery", "谢谢大家，礼物都到账了。大家继续加油，再送一手。"],
]) {
  const renewedAsk=makeReportForScript(renewedAskScript, {line_reviews:index.splitHardSentences(renewedAskScript)
    .map(original=>({original,mark:"good",comment:"当前表达成立。"}))});
  index.applyReportSafetyGates(renewedAsk, [], {sourceScript:renewedAskScript,scenario:{phase}});
  assert.notEqual(renewedAsk.verdict,"passed",
    `${phase} 阶段的“再送一手”是新请求，不能被前面的“继续加油”掩盖`);
  assert.ok(renewedAsk.line_reviews.some(item => item.mark === "wrong"));
}

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
assert.match(
  noScenarioPrompt,
  /基础复活 ×2、平票踢 \/ 平票救，默认不加底分.{0,80}不要求新人补讲拓展玩法/u
);
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
  "almost",
  "状态位齐全也不自动晋级；已有正确 passed 的非核心缺项用例仍须通过"
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
assert.equal(Array.from(normalizedDirection.direction.examples[0]).length, 30, "示范不应截断半句话");

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
  interaction_review: {signal_refs:["script:0"],script_refs:[0],judgment:"aligned",reading:"原稿递出当前参与邀请。",why:"依据原稿明示内容判断，未验证现场响应。",next_check:"看对方是否回应或认领。"},
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
  assert.equal(globalThis.__lastBuildUserPromptArgs[5], null);

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
        revision: {previousScript: "凯哥，大家帮我组一组。", focusKey: "user_reason", instruction: "先接住互动。", extra: "discard"},
      }),
    }),
    workerEnv,
    ctx
  );
  assert.equal(scenarioResponse.status, 200);
  assert.equal(globalThis.__lastBuildUserPromptArgs[5], null, "旧稿和旧建议不得进入当前评分模型");
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

// ---- 第一梯队修复回归：转述引语冒号 / 否定窗口跨介词 / 裸“不”否定 ----
// 三处文本判断修复（withoutAttributedQuotedText / hasNegatingPrefix /
// stripNegatedCurrentActions），全部经 applyReportSafetyGates 公开行为验证。
const gatesBase = () => ({
  card_type: "logic",
  card_why: "ok",
  audience: "大哥",
  round_dynamics: {
    flow_read: "推进正常",
    human_drivers: [],
    response_read: "票差下降",
    next_move: "继续观察",
  },
  structure_checks: [
    { key: "self_intro", status: "met", evidence: "有" },
    { key: "gratitude", status: "met", evidence: "有" },
    { key: "target_user", status: "met", evidence: "有" },
    { key: "user_reason", status: "met", evidence: "有" },
    { key: "vote_instruction", status: "met", evidence: "有" },
  ],
  verdict: "almost",
  verdict_reason: "初始理由",
  echo: "",
  line_reviews: [],
  one_thing: "",
  direction: { summary: "补一个动作 用你自己的话说", examples: [] },
  ai_flavor: "",
  redline_note: "",
});

const runGates = (script, mutate) => {
  const report = gatesBase();
  if (mutate) mutate(report);
  index.applyReportSafetyGates(report, [], {
    sourceScript: script,
    scenario: null,
    voteGap: "close",
  });
  return report;
};

// 高危修复 1：归因动词后的冒号不再阻隔引语剥离——“他说：”“比如：”里的乞求词
// 不能当主播原话；主语词表不含“我”，主播自述“我说”仍保留。
for (const attributedQuote of ['他说："救救我"', '他说"救救我"', '比如："救救我"']) {
  assert.doesNotMatch(
    runGates(attributedQuote).verdict_reason,
    /救救我/u,
    `归因或举例引语里的乞求词不能当主播原话：${attributedQuote}`
  );
}
assert.match(
  runGates('我说："救救我"').verdict_reason,
  /救救我/u,
  "主播自述“我说”不在归因主语词表，仍是本人的话"
);

// 中危修复 2：否定窗口可跨介词——否定词后隔着“跟你说”等表述时，
// 后面的乞求词仍是转述对象而非主播原话；无否定词时照常命中。
for (const negatedQuote of ["我不会跟你说求求你", "我不求求你"]) {
  assert.doesNotMatch(
    runGates(negatedQuote).verdict_reason,
    /求求你/u,
    `否定窗口内的乞求词不能判为主播乞求：${negatedQuote}`
  );
}
assert.match(
  runGates("我跟你说求求你").verdict_reason,
  /求求你/u,
  "无否定词时“跟你说求求你”仍应命中乞求"
);

// 中危修复 3：裸“不”进入否定词表，“每人一票”类分布式动作也可被否定——
// 否定动作句不能把 vote_instruction 从 partial 虚提为 met；真实动作照常晋级。
for (const negatedAction of ["这轮先不补票", "不能补票", "不用每人一票"]) {
  const report = runGates(negatedAction, (rep) => {
    rep.structure_checks.find((item) => item.key === "vote_instruction").status =
      "partial";
  });
  assert.equal(
    report.structure_checks.find((item) => item.key === "vote_instruction").status,
    "partial",
    `否定动作不能被虚提成真实指令：${negatedAction}`
  );
}
for (const realAction of ["帮我补一票", "每人一票"]) {
  const report = runGates(realAction, (rep) => {
    rep.structure_checks.find((item) => item.key === "vote_instruction").status =
      "partial";
  });
  assert.equal(
    report.structure_checks.find((item) => item.key === "vote_instruction").status,
    "met",
    `真实动作仍应晋级 vote_instruction：${realAction}`
  );
}

// ---- 中危修复回归：称呼判定（六处文本判断）----
// 全部经 applyReportSafetyGates 公开行为验证：
//   1. 连接词“所以/然后”不是人名（looksLikeAnotherAddressee）
//   2. “主持说了/说过”仍是转述（isAttributedTargetMention 补“了/完/过/的”）
//   3. “麻烦能不能”不再把“麻烦”当昵称（freeModeTargetToken 剥礼貌词）
//   4. 孤立捧场词“加油”不当昵称，真实昵称仍有效（BARE_SEGMENT_NON_NAMES）
//   5. 场景模式允许“现在/刚才凯哥”（hasConcreteTargetAddress 补前缀）
//   6. 转述后接主播回应整句不再被吞（isAttributedViewerInterest 句尾锚定）
const targetStatus = (report) =>
  report.structure_checks.find((item) => item.key === "target_user").status;
const reasonStatus = (report) =>
  report.structure_checks.find((item) => item.key === "user_reason").status;
const partialReasonReport = (script) =>
  makeReportForScript(script, {
    verdict: "almost",
    structure_checks: allMetChecks().map((item) =>
      item.key === "user_reason" ? { ...item, status: "partial" } : item
    ),
  });

// 1. 连接词后继续对话仍是对准原用户，不是换人称呼。
for (const connectiveScript of [
  { script: "凯哥，所以你能不能帮我", scenario: { targetUser: "凯哥" } },
  { script: "凯哥，然后你能不能帮我", scenario: null },
  { script: "凯哥，那你帮帮我", scenario: null },
]) {
  const report = makeReportForScript(connectiveScript.script);
  index.applyReportSafetyGates(report, [], {
    sourceScript: connectiveScript.script,
    scenario: connectiveScript.scenario,
  });
  assert.equal(
    targetStatus(report),
    "met",
    `连接词后继续对话仍是对准原用户：${connectiveScript.script}`
  );
}

// 2. 带“了/完/过/的”的转述不能虚过 target_user（场景模式）。
for (const attributedScript of [
  "主持说了，凯哥你能不能帮我",
  "小王说了，凯哥你能不能帮我",
  "主持说，凯哥你能不能帮我",
]) {
  const report = makeReportForScript(attributedScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: attributedScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    targetStatus(report),
    "partial",
    `转述引出的称呼不能虚过 target_user：${attributedScript}`
  );
}

// 3+4. 礼貌词/捧场词不是昵称；真实昵称不受影响（自由模式）。
for (const notANicknameScript of ["麻烦你能不能帮我", "加油，帮我补一票"]) {
  const report = makeReportForScript(notANicknameScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: notANicknameScript,
    scenario: null,
  });
  assert.equal(
    targetStatus(report),
    "partial",
    `礼貌词/捧场词不能被当成昵称：${notANicknameScript}`
  );
}
for (const realNicknameScript of ["麻烦凯哥，帮我补一票", "小满，帮我补一票"]) {
  const report = makeReportForScript(realNicknameScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: realNicknameScript,
    scenario: null,
  });
  assert.equal(
    targetStatus(report),
    "met",
    `真实昵称仍应算具体用户：${realNicknameScript}`
  );
}

// 5. 场景模式“现在/刚才+目标”是直接呼语；前两句自由模式会因转述跳过，
//    只有场景路径能救回来，正好单独覆盖 hasConcreteTargetAddress 的前缀修复。
for (const prefixedTargetScript of [
  "主持说了，现在凯哥你能不能帮我",
  "主持说了，刚才凯哥你能不能帮我",
  "现在凯哥，帮我补一票",
]) {
  const report = makeReportForScript(prefixedTargetScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: prefixedTargetScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(
    targetStatus(report),
    "met",
    `场景模式下“现在/刚才+目标”是直接呼语：${prefixedTargetScript}`
  );
}

// 6. 转述后接主播回应，整句不再被当纯转述吞掉；纯转述仍不能冒充用户理由。
for (const quotedThenResponseScript of [
  "你说想看跳舞，我给你跳",
  "听你说想看跳舞，我给你跳",
]) {
  const report = makeReportForScript(quotedThenResponseScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: quotedThenResponseScript,
    scenario: null,
  });
  assert.equal(
    reasonStatus(report),
    "met",
    `转述后的主播回应仍是有效用户理由：${quotedThenResponseScript}`
  );
}
for (const pureNarrationScript of ["凯哥说他想看返场。", "你说想看跳舞。"]) {
  const report = partialReasonReport(pureNarrationScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: pureNarrationScript,
    scenario: null,
  });
  assert.equal(
    reasonStatus(report),
    "partial",
    `纯转述不能冒充给用户的正向理由：${pureNarrationScript}`
  );
}

// ---- 中危修复回归：/api/coach 限流（防入口码泄露后烧 DeepSeek 额度）----
// 路由级：同一入口码 1 分钟 60 次内放行，第 61 次 429 + Retry-After，且不再调模型。
{
  const rateLimitKv = new MemoryKV();
  const rateLimitEnv = {
    ACCESS_CODE: "access-code-123",
    ADMIN_CODE: "admin-code-123",
    DEEPSEEK_API_KEY: "test-key",
    CASES: rateLimitKv,
  };
  const rateLimitPending = [];
  const rateLimitCtx = { waitUntil: (promise) => rateLimitPending.push(promise) };
  let modelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(upstreamReport) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  try {
    const coachRequest = () =>
      new Request("https://lapiao.test/api/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body: JSON.stringify({
          accessCode: "access-code-123",
          voteGap: "close",
          script: baseScript,
        }),
      });
    for (let i = 0; i < 60; i += 1) {
      const res = await index.default.fetch(coachRequest(), rateLimitEnv, rateLimitCtx);
      assert.equal(res.status, 200, `第 ${i + 1} 次批改应在限流额度内`);
    }
    const blocked = await index.default.fetch(coachRequest(), rateLimitEnv, rateLimitCtx);
    assert.equal(blocked.status, 429, "超过入口码每分钟上限应返回 429");
    assert.equal(blocked.headers.get("Retry-After"), "60", "429 应带 Retry-After 头");
    assert.equal(modelCalls, 1, "同稿复用一次有效检查；被限流后也不得再调 DeepSeek");
    await Promise.all(rateLimitPending);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 限流函数直测：IP 维度独立计数；KV 缺失时 fail-open（鉴权仍是第一道防线）。
{
  const ipLimitKv = new MemoryKV();
  // 每次调用换一个码：码维度 30/分钟不会先触发，这里只测 IP 维度 60/分钟。
  for (let i = 0; i < 60; i += 1) {
    const allowed = await index.checkCoachRateLimit(
      { CASES: ipLimitKv },
      `ip-probe-code-${i}`,
      "203.0.113.9"
    );
    assert.equal(allowed, null, `IP 维度第 ${i + 1} 次应在额度内放行`);
  }
  const ipBlocked = await index.checkCoachRateLimit(
    { CASES: ipLimitKv },
    "some-code",
    "203.0.113.9"
  );
  assert.equal(ipBlocked?.status, 429, "同一 IP 超限应返回 429");
  const otherIp = await index.checkCoachRateLimit(
    { CASES: ipLimitKv },
    "another-code",
    "198.51.100.2"
  );
  assert.equal(otherIp, null, "新 IP 新码不应被旧桶误拦");
  const noBinding = await index.checkCoachRateLimit({}, "code", "1.2.3.4");
  assert.equal(noBinding, null, "KV binding 缺失时 fail-open，不拦训练");
}

// ---- 低危修复回归：词表与文本判断的批量修复 ----
// 覆盖 11 处：多谢进泛称词表 / 小数不拆句 / 问句不误判叙述 / 并列称呼连词 /
// 句尾“了”助词 / 跨句承接 / “补位”要票词 / delivery 单独“哥姐” /
// 口语尾数 / “还差一点”不是票数 / 泛谢同句不冒充具体感谢。

// 1. 孤立“多谢”不是昵称，不能再虚过 target_user（自由模式）。
{
  const report = makeReportForScript("多谢，帮我补一票");
  index.applyReportSafetyGates(report, [], {
    sourceScript: "多谢，帮我补一票",
    scenario: null,
  });
  assert.equal(targetStatus(report), "partial", "孤立“多谢”不能当成称呼对象");
}

// 2. 小数不拆句：数字中间的小数点不是句界；“3.谢谢”里的句点仍是句界。
assert.deepEqual(
  index.splitHardSentences("还差3.5票，谢谢"),
  ["还差3.5票，谢谢"],
  "数字中间的小数点不能被当成英文句号拆句"
);
assert.deepEqual(
  index.splitHardSentences("3.谢谢"),
  ["3.", "谢谢"],
  "数字后的句点仍应正常断句"
);

// 3. 问句语气绕过叙述检查：问凯哥在不在是直接呼叫；陈述句仍是叙述（场景模式）。
{
  const askReport = makeReportForScript("凯哥在直播间吗");
  index.applyReportSafetyGates(askReport, [], {
    sourceScript: "凯哥在直播间吗",
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(askReport), "met", "“凯哥在直播间吗”是在问凯哥，不是叙述");
}
{
  const narrateReport = makeReportForScript("凯哥在直播间");
  index.applyReportSafetyGates(narrateReport, [], {
    sourceScript: "凯哥在直播间",
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(narrateReport), "partial", "“凯哥在直播间”仍是叙述凯哥");
}

// 4. “和/跟”是并列称呼连词：和大姐一起被叫是直接呼语；和“你们/别人”一起出现仍是陈述。
for (const conjunctionScript of ["凯哥和大姐，你们好", "凯哥和大姐，帮帮我"]) {
  const report = makeReportForScript(conjunctionScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: conjunctionScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(report), "met", `并列称呼仍是直接呼语：${conjunctionScript}`);
}
for (const statementScript of ["凯哥和你们一起上票", "凯哥和别人一起上票"]) {
  const report = makeReportForScript(statementScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: statementScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(report), "partial", `连词接群体/旁人仍是陈述：${statementScript}`);
}

// 5. 句尾“了”助词：感谢呼语不因“了”漏判；主持转述的感谢仍不能虚过（场景模式）。
for (const thanksScript of ["谢谢凯哥了", "谢谢你凯哥了", "谢谢了凯哥"]) {
  const report = makeReportForScript(thanksScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: thanksScript,
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(report), "met", `句尾“了”不影响感谢式呼语：${thanksScript}`);
}
{
  const attributedReport = makeReportForScript("主持说谢谢凯哥");
  index.applyReportSafetyGates(attributedReport, [], {
    sourceScript: "主持说谢谢凯哥",
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(attributedReport), "partial", "主持转述的“谢谢凯哥”不能虚过");
}

// 6. 跨句承接：孤立称呼 + 下一句对话内容仍是称呼（自由/场景双模式）。
for (const carriedScript of ["凯哥。谢谢你", "凯哥。你好"]) {
  const report = makeReportForScript(carriedScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: carriedScript,
    scenario: null,
  });
  assert.equal(targetStatus(report), "met", `孤立称呼跨句承接仍是称呼：${carriedScript}`);
}
{
  const scenarioCarried = makeReportForScript("凯哥。谢谢你");
  index.applyReportSafetyGates(scenarioCarried, [], {
    sourceScript: "凯哥。谢谢你",
    scenario: { targetUser: "凯哥" },
  });
  assert.equal(targetStatus(scenarioCarried), "met", "场景模式“凯哥。谢谢你”是跨句感谢");
}
for (const droppedScript of ["凯哥。大家好", "凯哥。你们今晚想看什么", "凯哥。今天天气不错"]) {
  const report = makeReportForScript(droppedScript);
  index.applyReportSafetyGates(report, [], {
    sourceScript: droppedScript,
    scenario: null,
  });
  assert.equal(targetStatus(report), "partial", `下一句转向群体/他事不应承接：${droppedScript}`);
}

// 7. “补位”是要票动作：命中 vote_instruction；否定形式照旧剥掉。
{
  const report = makeReportForScript("帮我补位");
  index.applyReportSafetyGates(report, [], {
    sourceScript: "帮我补位",
    scenario: null,
  });
  assert.equal(
    report.structure_checks.find((item) => item.key === "vote_instruction").status,
    "met",
    "“补位”应识别为可执行的补票动作"
  );
}
{
  const report = makeReportForScript("先不补位");
  index.applyReportSafetyGates(report, [], {
    sourceScript: "先不补位",
    scenario: null,
  });
  assert.equal(
    report.structure_checks.find((item) => item.key === "vote_instruction").status,
    "partial",
    "“先不补位”是否定，不能算动作"
  );
}

// 8. delivery 阶段：对单人的“谢谢凯哥”不是兑现指令；“谢谢大家+到账”才是。
{
  const singleThanks = makeRawReport();
  index.applyReportSafetyGates(singleThanks, [], {
    sourceScript: "谢谢凯哥",
    scenario: { phase: "delivery", targetUser: "凯哥" },
  });
  assert.equal(
    singleThanks.structure_checks.find((item) => item.key === "vote_instruction").status,
    "partial",
    "对单人的感谢不能冒充“确认到账”的兑现动作"
  );
}
{
  const arrivalThanks = makeRawReport();
  index.applyReportSafetyGates(arrivalThanks, [], {
    sourceScript: "谢谢大家，礼物都到账了",
    scenario: { phase: "delivery", targetUser: "凯哥" },
  });
  assert.equal(
    arrivalThanks.structure_checks.find((item) => item.key === "vote_instruction").status,
    "met",
    "感谢群体并核对到账仍是兑现阶段的正确动作"
  );
}

// 9. 口语尾数：结尾数字承接上一个单位量级，零后的尾数仍是个位。
assert.equal(index.parseSpokenCount("三百二"), 320, "“三百二”=320");
assert.equal(index.parseSpokenCount("一千三"), 1300, "“一千三”=1300");
assert.equal(index.parseSpokenCount("一百零二"), 102, "“一百零二”=102（零后的尾数是个位）");
assert.equal(index.parseSpokenCount("三百二十"), 320, "“三百二十”=320");
assert.equal(index.parseSpokenCount("十五"), 15, "“十五”=15");

// 10. “还差一点”是差得不多，不是 1 票；正常票差仍生成递降说明。
assert.equal(index.summarizeTicketProgress("还差8个，现在只差一点"), "", "“还差一点”不是票数");
assert.match(
  index.summarizeTicketProgress("还差8个，现在只差2个"),
  /从8降到2/,
  "正常票差仍应生成递降说明"
);

// 11. 泛谢同句不冒充具体感谢：谢谢大家+顺带提昵称 ≠ 对目标的具体感谢。
{
  const genericThanks = makeRawReport();
  index.applyReportSafetyGates(genericThanks, [], {
    sourceScript: "谢谢大家，凯哥也在",
    scenario: { targetUser: "凯哥", recentGift: "小心心 ×5" },
  });
  assert.equal(
    genericThanks.structure_checks.find((item) => item.key === "gratitude").status,
    "partial",
    "“谢谢大家，凯哥也在”只是顺带提昵称，不是对凯哥的具体感谢"
  );
}
{
  const specificThanks = makeRawReport();
  index.applyReportSafetyGates(specificThanks, [], {
    sourceScript: "谢谢凯哥送的小心心",
    scenario: { targetUser: "凯哥", recentGift: "小心心 ×5" },
  });
  assert.equal(
    specificThanks.structure_checks.find((item) => item.key === "gratitude").status,
    "met",
    "“谢谢凯哥送的小心心”仍是对凯哥的具体感谢"
  );
}

// Evidence-backed semantic reports must not be overwritten by legacy keyword rules.
{
  const script = "乙哥，四个变五个，你这一个把缺口压到最后一位了。谁来接最后这个位置，咱们凑齐等主持喊丢？";
  const scenario = {phase:"closing",targetUser:"仍在场的观众",recentGift:"乙哥原认4个，现追加1个，累计认领5个；尚未到账。",userSignal:"只剩最后一个占位。"};
  const interaction = {signal_refs:["recentGift","userSignal"],script_refs:[0,1],judgment:"aligned",reading:"主播接住乙哥追加，邀请最后一个位置。",why:"最后补位接上已经发生的共同组队。",next_check:"看谁接最后一位，确认后等主持。"};
  const semanticReport=overrides=>makeReportForScript(script,{line_reviews:index.splitHardSentences(script).map(original=>({original,mark:"good",comment:"方向正确"})),...overrides});
  const report=semanticReport({interaction_review:interaction});
  index.applyReportSafetyGates(report,[],{sourceScript:script,scenario,voteGap:"close"});
  assert.equal(report.verdict,"passed",`接最后位置是上下文明确的动作，不能因为词表漏掉而降级：${report.verdict_reason}`);
  assert.equal(report.structure_checks.find(c=>c.key==="gratitude").status,"met","回应真实追加不需要含谢谢");
  assert.equal(report.interaction_review.reading,interaction.reading);
  assert.equal(index.getInteractionReviewIssue(report,script,scenario),"");
  const oneBased={interaction_review:{...interaction,script_refs:[1,2],signal_refs:["recentGift","script:2"]}};
  index.normalizeOneBasedScriptRefs(oneBased,script);
  assert.deepEqual(oneBased.interaction_review.script_refs,[0,1],"明确 1 起始的原稿编号应还原为 0 起始");
  assert.deepEqual(oneBased.interaction_review.signal_refs,["recentGift","script:1"]);
  assert.equal(index.getInteractionReviewIssue(oneBased,script,scenario),"");
  const ambiguous={interaction_review:{...interaction,script_refs:[1],signal_refs:["script:1"]}};
  index.normalizeOneBasedScriptRefs(ambiguous,script);
  assert.deepEqual(ambiguous.interaction_review.script_refs,[1],"未超界的编号不可擅自改动");
  assert.equal(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:["scenario.recentGift"]}},script,scenario),"","显式scenario路径与对应字段名是同一个事实，不应误报生成失败");
  assert.equal(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:["scenario:recentGift","voteGap"]}},script,scenario,"close"),"","合法顶层票况和路径别名均应指向实际输入");
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:["voteGap"]}},script,scenario),/不存在/);
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:["scenario.recentGift","recentGift"]}},script,scenario),/重复/);
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:["timeline:9"]}},script,scenario),/不存在/);
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,script_refs:[99]}},script,scenario),/不存在/);
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,judgment:"trusted"}},script,scenario),/不合法/);
  assert.match(index.getInteractionReviewIssue({...report,interaction_review:{...interaction,signal_refs:[]}},script,scenario),/缺少/);
  assert.match(index.getInteractionReviewIssue({},script,scenario),/缺少/);

  const missingAction=semanticReport({verdict:"almost",interaction_review:interaction,structure_checks:allMetChecks().map(c=>c.key==="vote_instruction"?{...c,status:"partial"}:c)});
  index.applyReportSafetyGates(missingAction,[],{sourceScript:script,scenario});
  assert.equal(missingAction.structure_checks.find(c=>c.key==="vote_instruction").status,"partial","存在语义摘要不代表自动提升某项评分");

  const wrong=semanticReport({interaction_review:{...interaction,judgment:"misread",script_refs:[0],reading:"误把尚未确认的追加算成已认领。"}});
  index.applyReportSafetyGates(wrong,[],{sourceScript:script,scenario});
  assert.notEqual(wrong.verdict,"passed","关系误读不能被两个met洗掉");
  assert.equal(wrong.line_reviews[0].mark,"wrong");
  assert.equal(wrong.line_reviews[1].mark,"good","只标记发生误读的原句");

  const quote=semanticReport({interaction_review:interaction,card_why:"现场说“乙哥原认4个”，原话承接了这次追加。"});
  assert.equal(index.getReportQualityIssue(quote,script,scenario),"","允许引用实际存在的现场事实");
  assert.match(index.getReportQualityIssue(quote,script,null),/不存在/);
  const invented=semanticReport({card_why:"现场说“乙哥已经到账十个”，原话承接了这次追加。"});
  assert.match(index.getReportQualityIssue(invented,script,scenario),/不存在/);

  const stageScript="已经组满了，大家现在再认一个，马上丢，不用等主持。";
  const stage=makeReportForScript(stageScript,{interaction_review:{...interaction,signal_refs:["phase"],script_refs:[0]}});
  index.applyReportSafetyGates(stage,[],{sourceScript:stageScript,scenario:{phase:"awaiting_drop"}});
  assert.notEqual(stage.verdict,"passed","语义摘要不能绕过已组满后的阶段冲突");
  const redline=semanticReport({interaction_review:interaction});
  index.applyReportSafetyGates(redline,["红线测试"],{sourceScript:script,scenario});
  assert.equal(redline.verdict,"off","语义摘要不能绕过红线");
}

// Report repair is targeted, revalidated and bounded; a failed repair must not trigger browser retries.
{
  const savedFetch=globalThis.fetch;
  try {
    for(const streaming of [false,true]) for(const repairSucceeds of [false,true]) {
      const requests=[];
      const invalid={...structuredClone(upstreamReport),card_why:"你说了“完全不存在的另一段话”"};
      globalThis.fetch=async(_url,options)=>{
        requests.push(JSON.parse(options.body));
        const report=requests.length===2&&repairSucceeds?upstreamReport:invalid;
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}],usage:{prompt_tokens:10,completion_tokens:20}}));
      };
      const env={ACCESS_CODE:"repair-test",DEEPSEEK_API_KEY:"test-key"};
      const response=await index.default.fetch(new Request("https://local.test/api/coach",{
        method:"POST",headers:{"Content-Type":"application/json",Accept:streaming?"application/x-ndjson":"application/json"},
        body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",script:baseScript}),
      }),env,{waitUntil(){}});
      const payload=JSON.parse((await response.text()).trim().split("\n").at(-1));
      assert.equal(requests.length,2,"最多一次针对报告的修正，不能无限重抽");
      assert.equal(requests[1].messages[1].content,requests[0].messages[1].content,"修正不改变原稿与现场");
      assert.match(requests[1].messages.at(-1).content,/点评引用了当前稿或现场不存在的原句/);
      assert.deepEqual(JSON.parse(requests[1].messages.at(-1).content).invalidFields.map(item=>[item.field,item.quote]),[["card_why","完全不存在的另一段话"]],"修正必须定位到具体字段和错误引用");
      if(repairSucceeds){
        assert.equal(payload.ok,true);
        assert.equal(payload.report.verdict,"passed");
        assert.equal(payload.usage.prompt_tokens,20,"两次模型用量必须累计");
      }else{
        assert.equal(streaming?payload.status:response.status,502);
        assert.equal(payload.retryable,false,"修正失败不能再让前端完整重跑");
        assert.equal(payload.report,undefined,"无效报告不能降级冒充有效分数");
      }
    }
  }finally{globalThis.fetch=savedFetch;}
}

// Out-of-range semantic references need the exact 0-based map in the repair turn.
{
  const script="阿沐，你刚说想看后半段，我接着跳给你看。现在还差最后一手，你愿意搭一把吗？";
  const segments=index.splitHardSentences(script);
  assert.equal(segments.length,2);
  const good={...structuredClone(upstreamReport),
    interaction_review:{signal_refs:["script:0"],script_refs:[0,1],judgment:"aligned",
      reading:"原稿先接住观看兴趣，再邀请对方选择。",why:"按稿内表达试探，仍要观察回应。",next_check:"看阿沐是否接话。"},
    line_reviews:segments.map(original=>({original,mark:"good",comment:"原句有明确回应。"})),
  };
  const savedFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    const report=structuredClone(good);
    if(requests.length===1) report.interaction_review.script_refs=[0,4];
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}],
      usage:{prompt_tokens:10,completion_tokens:20}}),{status:200});
  };
  try{
    const env={ACCESS_CODE:"reference-repair-test",DEEPSEEK_API_KEY:"test-key"};
    const response=await index.default.fetch(new Request("https://local.test/api/coach",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",script}),
    }),env,{waitUntil(){}});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(payload.report.interaction_review.judgment,"aligned");
    assert.deepEqual(payload.report.interaction_review.script_refs,[0,1]);
    assert.equal(requests.length,2,"越界引用只允许一次有针对性的报告修正");
    assert.equal(requests[1].messages[1].content,requests[0].messages[1].content,
      "修正时原稿与现场不得改变");
    const repair=JSON.parse(requests[1].messages.at(-1).content);
    assert.equal(repair.validationIssue,"现场判断引用了不存在的原稿段落");
    assert.deepEqual(repair.invalidFields,[{
      field:"interaction_review.script_refs",originalScriptRefs:[0,4],originalSignalRefs:["script:0"],
      validScriptRefRange:"0..1 (0-based)",indexedSegments:segments.map((text,index)=>({index,text})),
      correction:"按上面的原稿分句重新选择实际引用的编号；不要猜测或沿用越界编号。",
    }],"修正请求须给出原始错误引用、合法索引范围和逐句原文");
    assert.equal(payload.usage.prompt_tokens,20,"修正轮模型用量应累计");
  }finally{globalThis.fetch=savedFetch;}
}

// Stable review records: isolate same-flight merging, persistence, isolation, expiry and failures.
{
  const env = {CASES:new MemoryKV()};
  const key = await index.reviewRecordKey("one", "close", baseScript, null);
  assert.notEqual(key, await index.reviewRecordKey("two", "close", baseScript, null));
  assert.notEqual(key, await index.reviewRecordKey("one", "far", baseScript, null));
  assert.notEqual(key, await index.reviewRecordKey("one", "close", baseScript + "新句", null));
  assert.notEqual(key, await index.reviewRecordKey("one", "close", baseScript, {phase:"delivery"}));
  const firstLesson = [{whyGood:"公开经验甲"}];
  const secondLesson = [{whyGood:"公开经验乙"}];
  const lessonKey = await index.reviewRecordKey("one", "close", baseScript, null, firstLesson);
  assert.notEqual(key, lessonKey,"当前报告必须区别于供复练查找的稳定历史键");
  assert.notEqual(lessonKey, await index.reviewRecordKey("one", "close", baseScript, null, secondLesson),"已选案例经验改变必须刷新评分缓存");
  const threeLessons=[...firstLesson,{whyGood:"经验二"},{whyGood:"经验三"}];
  assert.equal(await index.reviewRecordKey("one", "close", baseScript, null, threeLessons),
    await index.reviewRecordKey("one", "close", baseScript, null,
      [...firstLesson,{whyGood:""},{whyGood:"经验二"},{whyGood:"经验三"},{whyGood:"第四条不进入提示词"}]),
    "只有真正进入提示词的前三条经验参与指纹");
  assert.doesNotMatch(key, /凯哥|one/);
  assert.doesNotMatch(lessonKey, /公开经验甲|凯哥|one/,"键只存摘要，不暴露案例或话术");
  let calls = 0;
  const generate = async () => {calls++; await new Promise(resolve => setTimeout(resolve, 5)); return {ok:true,report:structuredClone(upstreamReport),usage:{}};};
  const [first, second] = await Promise.all([index.reuseReview(env,key,generate),index.reuseReview(env,key,generate)]);
  assert.equal(calls,1,"同一实例的同时提交只能生成一次");
  assert.deepEqual(first,second);
  first.report.revision_note = "不得污染基础结果";
  assert.equal((await index.reuseReview(env,key,generate)).report.revision_note,undefined);
  const restarted = {CASES:new MemoryKV([...env.CASES.values].map(([k,v])=>[k,JSON.parse(v)]))};
  assert.deepEqual(await index.reuseReview(restarted,key,generate),second,"新实例读取持久化结果");
  assert.equal(calls,1);
  const expired = JSON.parse(env.CASES.values.get(key)); expired.expiresAt = 1;
  await index.reuseReview({CASES:new MemoryKV([[key,expired]])},key,generate);
  assert.equal(calls,2,"到期后重新检查");
  const oldVersion = {...expired,expiresAt:Date.now()+100000,version:"obsolete"};
  await index.reuseReview({CASES:new MemoryKV([[key,oldVersion]])},key,generate);
  assert.equal(calls,3,"旧评分版本不能沿用");
  await assert.rejects(index.reuseReview(env,"failed",async()=>{throw new Error("upstream");}),/upstream/);
  assert.equal(await index.readReviewRecord(env,"failed"),null);
  await index.reuseReview(env,"failed",generate);
  assert.equal(calls,4,"失败后允许恢复，不能保存故障");
  const broken = {CASES:{async get(){throw new Error("offline");},async put(){throw new Error("offline");}}};
  await index.reuseReview(broken,key,generate);
  await index.reuseReview(broken,key,generate);
  assert.equal(calls,5,"KV故障时同实例仍复用已完成结果");
}

// A newly published or edited reference lesson refreshes the actual coach route,
// while revision lookup still finds the latest report through the stable key.
{
  const env={ACCESS_CODE:"lesson-cache-test",DEEPSEEK_API_KEY:"test-key",CASES:new MemoryKV()};
  const savedFetch=globalThis.fetch;
  let modelCalls=0;
  globalThis.fetch=async()=>{
    modelCalls++;
    const report=structuredClone(upstreamReport);
    report.verdict_reason=`本次批改 ${modelCalls}`;
    report.line_reviews=[{original:globalThis.__lastBuildUserPromptArgs[1],mark:"good",comment:"当前邀请成立。"}];
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});
  };
  const submit=async(script,revision)=>{
    const response=await index.default.fetch(new Request("https://local.test/api/coach",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",script,...(revision?{revision}:{})}),
    }),env,{waitUntil(){}});
    assert.equal(response.status,200);
    return response.json();
  };
  try{
    globalThis.__retrievedCases=[{source:"manual",whyGood:"公开经验甲"}];
    const initial=await submit(baseScript);
    assert.equal(initial.report.verdict_reason,"本次批改 1");
    assert.equal(modelCalls,1);
    globalThis.__retrievedCases=[{source:"manual",whyGood:"公开经验乙"}];
    const refreshed=await submit(baseScript);
    assert.equal(refreshed.report.verdict_reason,"本次批改 2","新发布经验须得到新报告");
    assert.equal(modelCalls,2);
    const aliasKey=await index.reviewRecordKey(env.ACCESS_CODE,"close",baseScript,null);
    const selectedKey=await index.reviewRecordKey(env.ACCESS_CODE,"close",baseScript,null,globalThis.__retrievedCases);
    assert.equal(JSON.parse(env.CASES.values.get(aliasKey)).sourceKey,selectedKey,"历史别名应记录当前案例指纹");
    const aliasWritesAfterRefresh=env.CASES.putKeys.filter(key=>key===aliasKey).length;
    assert.equal((await submit(baseScript)).report.verdict_reason,"本次批改 2");
    assert.equal(modelCalls,2,"经验未变时同稿仍复用缓存");
    assert.equal(env.CASES.putKeys.filter(key=>key===aliasKey).length,aliasWritesAfterRefresh,
      "同一版本的缓存命中不应反复写历史别名");
    const savedAlias=env.CASES.values.get(aliasKey);
    globalThis.__retrieveCasesError=true;
    const degraded=await submit(baseScript);
    assert.deepEqual(degraded.report,refreshed.report,
      "案例检索暂时失败时应返回同稿同现场已服务报告，而非空案例重判");
    assert.equal(modelCalls,2,"有历史报告时检索故障不得再次调用模型");
    assert.equal(env.CASES.values.get(aliasKey),savedAlias,
      "检索故障不应把历史别名覆盖成空案例报告");
    const unseenScript=baseScript.replace("我还差十票","我还差九票");
    const unseen=await submit(unseenScript);
    assert.equal(unseen.ok,true,"没有历史报告时仍应允许空案例降级批改");
    assert.equal(modelCalls,3,"新稿检索故障应进行一次新判断");
    globalThis.__retrieveCasesError=false;
    const historyKey=await index.reviewRecordKey(env.ACCESS_CODE,"close",baseScript,null);
    assert.equal((await index.readReviewRecord(env,historyKey)).report.verdict_reason,"本次批改 2","复练历史指向用户最近看到的报告");
    const revisedScript=baseScript.replace("我还差十票","我现在还差十票");
    const revised=await submit(revisedScript,{previousScript:baseScript,focusKey:"user_reason",instruction:"接住观众兴趣"});
    assert.deepEqual(revised.report.revision_check?.focus_key,"user_reason");
    assert.equal(revised.report.revision_check?.status,"resolved","案例变化后仍能读取上一版用于复练");
  }finally{globalThis.fetch=savedFetch;delete globalThis.__retrievedCases;delete globalThis.__retrieveCasesError;}
}
{
  const oldScript="凯哥，你这五个已经到账了。大家再帮我组一下。";
  const oldReport={verdict:"almost",coaching:{focus_key:"line_angle",original:"你这五个已经到账了",example:"你认的五个我记好了，等主持喊再丢"}};
  const revision={previousScript:oldScript,focusKey:"user_reason",instruction:"客户端伪造的方向"};
  const fixedScript=oldScript.replace(oldReport.coaching.original,oldReport.coaching.example);
  const fixed={verdict:"passed",interaction_review:{judgment:"aligned",reading:"已把认领与到账分开。"},line_reviews:[{mark:"good"}],coaching:{keep:"保留原有优点"}};
  index.applyRevisionFeedback(fixed,revision,fixedScript,oldReport);
  assert.equal(fixed.revision_check.focus_key,"line_angle","按服务端真实修改任务对照");
  assert.equal(fixed.revision_check.status,"resolved");
  assert.match(fixed.revision_note,/现场理解.*已经说清/);
  assert.equal(fixed.coaching.keep,"保留原有优点");
  const conflict={verdict:"almost",interaction_review:{judgment:"misread",reading:"仍然认错到账。"},line_reviews:[{mark:"wrong"}]};
  assert.match(index.getRevisionConflict(conflict,revision,fixedScript,oldReport),/本次不计闯关/);
  assert.equal(index.getRevisionConflict(conflict,revision,fixedScript+"另外改了内容。",oldReport),"");
  assert.equal(index.getRevisionConflict(conflict,revision,fixedScript,null),"","不能相信客户端自报的示范");
  index.applyRevisionFeedback(conflict,revision,fixedScript,oldReport);
  assert.equal(conflict.revision_check.status,"still_open");
  assert.match(conflict.revision_note,/还需要调整/);
  assert.equal(conflict.verdict,"almost","复练对照不能直接抬高评分");
}
{
  const oldScript="刚来的辰哥，你救我一定爽。大家也快帮我。";
  const lesson={focus_key:"user_reason",original:"你救我一定爽",example:"你想看哪段跟我说",action:"先问他想看什么，等他回应再递票。"};
  const previous={verdict:"almost",coaching:lesson};
  const revised=oldScript.replace(lesson.original,lesson.example);
  const revision={previousScript:oldScript,focusKey:"user_reason",instruction:lesson.action};
  const waiting={verdict:"almost",structure_checks:[{key:"user_reason",status:"partial",evidence:"观众尚未回复"}],coaching:{original:lesson.example}};
  assert.equal(index.getRevisionConflict(waiting,revision,revised,previous),"","询问兴趣只是取得线索的第一步，不能因仍待回复报 409");
  index.applyRevisionFeedback(waiting,revision,revised,previous);
  assert.match(waiting.revision_note,/等观众真实回应/);
  const elsewhere={verdict:"almost",structure_checks:[{key:"user_reason",status:"partial",evidence:"最后仍在泛喊"}],coaching:{original:"大家也快帮我"}};
  assert.equal(index.getRevisionConflict(elsewhere,revision,revised,previous),"","改好上一句后，另一处同类缺口不构成教练否定自己");
  index.applyRevisionFeedback(elsewhere,revision,revised,previous);
  assert.match(elsewhere.revision_note,/还有另一处/);
}

// Both JSON and streaming routes surface teacher contradictions as non-scoring business errors.
{
  const env={ACCESS_CODE:"route-revision",CASES:new MemoryKV()};
  const oldScript=baseScript.replace("我还差十票","我还差二十票");
  const previous={verdict:"almost",coaching:{focus_key:"user_reason",original:"我还差二十票",example:"我还差十票"}};
  const current={verdict:"almost",structure_checks:[{key:"user_reason",status:"partial",evidence:"仍未接上理由"}]};
  for(const [script,report] of [[oldScript,previous],[baseScript,current]]){
    const key=await index.reviewRecordKey(env.ACCESS_CODE,"close",script,null,[]);
    await index.reuseReview(env,key,async()=>({ok:true,report,usage:{}}));
    if(script===oldScript) await index.reuseReview(env,
      await index.reviewRecordKey(env.ACCESS_CODE,"close",script,null),async()=>({ok:true,report,usage:{}}));
  }
  for(const streaming of [false,true]){
    const response=await index.default.fetch(new Request("https://local.test/api/coach",{
      method:"POST",headers:{"Content-Type":"application/json",Accept:streaming?"application/x-ndjson":"application/json"},
      body:JSON.stringify({accessCode:env.ACCESS_CODE,voteGap:"close",script:baseScript,
        revision:{previousScript:oldScript,focusKey:"user_reason",instruction:"示范替换"}}),
    }),env,{waitUntil(){}});
    const payload=JSON.parse((await response.text()).trim().split("\n").at(-1));
    assert.equal(streaming?payload.status:response.status,409);
    assert.match(payload.message,/反馈发生冲突/);
    assert.equal(payload.report,undefined,"教练冲突不得伪装成学员失败报告");
  }
}

// Real-draft regressions: facts remain bounded, introductions stay objective, optional edits never gate.
{
  const script="大家好，现在台上的就是小禾，咱们还差十个。\n谢谢星星姐刚送的两个。\n想一起守住这轮的，方便就补一个。";
  const interaction={signal_refs:["script:0"],script_refs:[0],judgment:"aligned",reading:"原稿自报姓名、感谢并邀请补位。",why:"仅按稿内表达判断。",next_check:"看真实回应和到账。"};
  const raw=()=>makeReportForScript(script,{interaction_review:interaction,
    line_reviews:index.splitHardSentences(script).map(original=>({original,mark:"good",comment:"原话方向成立。"})),
    round_dynamics:validRoundDynamics({response_read:"稿内提到收到两个，未见独立到账确认。"}),
  });
  const source=await readFile(new URL("../worker/current-review.js",import.meta.url),"utf8");
  const knowledge=toDataUrl(await readFile(new URL("../worker/prompt.js",import.meta.url),"utf8"));
  const current=await import(toDataUrl(source.replace('from "./prompt.js";',`from "${knowledge}";`)));
  for(const text of [script,"还差3.5个\r\n刚才又认了0.5个。现在还差3个。","第一句。\n\n第二句没有句号\n第三句？"]){
    const input=JSON.parse(current.buildUserPrompt("close",text,[],[],null));
    assert.deepEqual(input.segments,index.splitHardSentences(text),"模型编号与服务端逐句核对必须一致");
    assert.deepEqual(input.requiredSegmentIndexes,input.segments.map((_,i)=>i));
    assert.equal(input.segments.join("").replace(/\s/g,""),text.replace(/\s/g,""),"换行切分不丢字");
  }
  for(const status of ["met","partial","missing"]){
    const report=raw();report.structure_checks[0].status=status;
    const normalized=index.normalizeReport(report,script);
    assert.equal(normalized.structure_checks[0].status,"met","自报姓名不因模型额外要求看点而漂移");
  }
  const report=raw();
  report.optional_polish={original:"咱们还差十个",example:"这轮还差十个，方便的补一个",why:"把缺口接到一个可选择的动作。"};
  const normalized=index.normalizeReport(report,script);
  index.applyReportSafetyGates(normalized,[],{sourceScript:script,voteGap:"close"});
  assert.equal(normalized.verdict,"passed");
  assert.ok(normalized.optional_polish);
  assert.match(normalized.round_dynamics.response_read,/未见独立到账确认/);
  assert.doesNotMatch(normalized.round_dynamics.response_read,/确认这期间收到/);
  assert.match(normalized.round_dynamics.response_read,/仅依据稿内描述/);
  index.applyReportSafetyGates(normalized,[],{sourceScript:script,voteGap:"close"});
  assert.equal(normalized.round_dynamics.response_read.match(/仅依据稿内描述/g).length,1,"重复闸门不叠加前缀");
  assert.equal(index.normalizeReport({...report,optional_polish:{...report.optional_polish,original:"不存在的原话"}},script).optional_polish,null);
  assert.equal(index.normalizeReport({...report,optional_polish:{...report.optional_polish,why:"长".repeat(101)}},script).optional_polish,null);
  assert.equal(index.normalizeReport({...report,verdict:"almost"},script).optional_polish,null);
  const invented=index.normalizeReport({...report,optional_polish:{...report.optional_polish,example:"再送一个我给你跳个新舞"}},script);
  index.applyReportSafetyGates(invented,[],{sourceScript:script,voteGap:"close"});
  assert.equal(invented.optional_polish,null,"可选建议不能凭空添加节目交换");
  assert.equal(invented.verdict,"passed","教练的可选建议无效不能扣新人分");
  const risky=index.normalizeReport(report,script);
  index.applyReportSafetyGates(risky,["测试红线"],{sourceScript:script,voteGap:"close"});
  assert.equal(risky.optional_polish,null,"被安全闸门挡下时不能显示通过后的建议");
}

console.log("PASS worker safety gates, review continuity and case lifecycle");
