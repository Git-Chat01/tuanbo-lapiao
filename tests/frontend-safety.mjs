import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createBrowserContext(overrides = {}) {
  const sandbox = {
    console,
    Promise,
    Error,
    JSON,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    setTimeout,
    clearTimeout,
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

function loadScript(context, relativePath) {
  const filename = resolve(projectRoot, relativePath);
  const source = readFileSync(filename, "utf8");
  vm.runInContext(source, context, { filename });
}

function testAccessCodeSurvivesStorageFailure() {
  const storageError = new Error("storage disabled");
  const context = createBrowserContext({
    STORAGE_KEYS: { accessCode: "test-access-code" },
    localStorage: {
      getItem() {
        throw storageError;
      },
      setItem() {
        throw storageError;
      },
    },
    document: {
      addEventListener() {},
    },
  });

  loadScript(context, "site/js/app.js");
  context.App.saveAccessCode("current-session-code");

  assert.equal(
    context.App.getAccessCode(),
    "current-session-code",
    "入口码应在 localStorage 不可用时保留于当前页面会话"
  );
}

function testApiOverrideCannotExfiltrateCodes() {
  const productionContext = createBrowserContext({
    URL,
    URLSearchParams,
    location: {
      hostname: "git-chat01.github.io",
      search: "?api=https%3A%2F%2Fevil.example",
    },
  });
  loadScript(productionContext, "site/js/config.js");
  assert.equal(
    productionContext.API_BASE,
    "https://lapiao.aivar.cc",
    "线上页面必须忽略任意 api 查询参数"
  );

  const localContext = createBrowserContext({
    URL,
    URLSearchParams,
    location: {
      hostname: "127.0.0.1",
      search: "?api=http%3A%2F%2Flocalhost%3A8787",
    },
  });
  loadScript(localContext, "site/js/config.js");
  assert.equal(localContext.API_BASE, "http://localhost:8787", "本机循环地址应仍可联调");

  const localEvilContext = createBrowserContext({
    URL,
    URLSearchParams,
    location: {
      hostname: "localhost",
      search: "?api=https%3A%2F%2Fevil.example",
    },
  });
  loadScript(localEvilContext, "site/js/config.js");
  assert.equal(localEvilContext.API_BASE, "https://lapiao.aivar.cc", "本地页也不得把密码发往外部域名");
}

async function testApiWithoutAbortController() {
  let successReport = null;
  let finishCount = 0;
  let fetchCount = 0;

  const context = createBrowserContext({
    API_BASE: "https://coach.example.test",
    App: {
      getAccessCode() {
        return "current-session-code";
      },
      toast() {},
    },
    fetch(url, options) {
      fetchCount += 1;
      assert.equal(url, "https://coach.example.test/api/coach");
      assert.equal(options.method, "POST");
      return Promise.resolve({
        ok: true,
        status: 200,
        json() {
          return Promise.resolve({ report: { verdict: "almost" } });
        },
      });
    },
  });

  assert.equal(
    vm.runInContext("typeof AbortController", context),
    "undefined",
    "测试沙箱不应提供 AbortController"
  );

  loadScript(context, "site/js/api.js");

  await new Promise((resolvePromise, rejectPromise) => {
    context.Api.submit(
      { voteGap: "close", script: "这是一段足够长的测试话术", scenario: null },
      {
        onSuccess(report) {
          successReport = report;
        },
        onError(status, message) {
          rejectPromise(new Error(`不应进入错误回调：${status} ${message}`));
        },
        onFinish() {
          finishCount += 1;
          resolvePromise();
        },
      }
    );
  });

  assert.equal(fetchCount, 1, "缺少 AbortController 时仍应发出请求");
  assert.equal(successReport && successReport.verdict, "almost", "成功响应应正常交给调用方");
  assert.equal(finishCount, 1, "请求结束回调应执行一次");
  assert.equal(context.Api._inFlight, false, "请求结束后必须释放 _inFlight 锁");
}

function testBusySubmissionDoesNotReplaceLastRequest() {
  const previousRequest = { script: "已经发出的旧稿" };
  const toastMessages = [];
  let submitCount = 0;

  const context = createBrowserContext({
    App: {
      state: {
        form: previousRequest,
        lastRequest: previousRequest,
      },
      toast(message) {
        toastMessages.push(message);
      },
      unlockStage() {},
      showView() {},
    },
    Api: {
      _inFlight: true,
      submit() {
        submitCount += 1;
      },
    },
    Report: {
      showLoading() {},
      showPassed() {},
      showContent() {},
      showError() {},
    },
  });

  loadScript(context, "site/js/form.js");
  context.Form._submitData({
    voteGap: "far",
    script: "请求进行中时不应覆盖状态的新稿",
    scenario: null,
    mode: "free",
  });

  assert.strictEqual(
    context.App.state.lastRequest,
    previousRequest,
    "忙碌时必须保留正在请求所对应的 lastRequest"
  );
  assert.equal(submitCount, 0, "忙碌时不应静默发起或伪装第二次提交");
  assert.ok(toastMessages.length > 0, "忙碌时应给用户明确 toast 反馈");
}

function testUnchangedDraftCannotRestartTheSameChallenge() {
  const submitLabel = { textContent: "帮我看这版" };
  const submitButton = {
    disabled: false,
    querySelector() { return submitLabel; },
  };
  const scriptCount = { textContent: "" };
  const context = createBrowserContext({
    LIMITS: { scriptMax: 500 },
    document: {
      getElementById(id) {
        if (id === "btn-submit") return submitButton;
        if (id === "script-count") return scriptCount;
        return null;
      },
    },
    App: {
      state: {
        lastRequest: { script: "上一份已经批改过的话术" },
        lastReport: { verdict: "almost" },
      },
    },
  });
  loadScript(context, "site/js/form.js");
  assert.equal(
    context.Form._isSameAsLast({ script: "上一份已经批改过的话术" }),
    true,
    "从报告返回初稿页时也不能原样重复提交"
  );
  assert.equal(
    context.Form._isSameAsLast({ script: "上一份已经改动过的话术" }),
    false,
    "有真实改动后应允许继续挑战"
  );

  context.Form.collect = () => ({ script: "上一份已经批改过的话术" });
  context.Form.validate = () => null;
  context.Form._updateInputState();
  assert.equal(submitButton.disabled, true, "返回初稿页时原文提交按钮应真实禁用");
  assert.equal(submitLabel.textContent, "先改动一处");

  context.Form.collect = () => ({ script: "上一份已经改动过的话术" });
  context.Form._updateInputState();
  assert.equal(submitButton.disabled, false, "改动原话后提交按钮应恢复");
  assert.equal(submitLabel.textContent, "帮我看这版");
}

function testNewSubmissionInvalidatesOldPass() {
  const passedScript = { textContent: "上一轮已过关的旧稿" };
  const lockedStages = [];
  let voiceResetCount = 0;
  const context = createBrowserContext({
    document: {
      getElementById(id) {
        return id === "passed-script" ? passedScript : null;
      },
    },
    App: {
      state: {
        form: { script: "旧稿" },
        lastRequest: { script: "旧稿" },
        lastReport: { verdict: "passed" },
      },
      toast() {},
      lockStage(stage) { lockedStages.push(stage); },
      unlockStage() {},
      showView() {},
    },
    Api: {
      _inFlight: false,
      submit() {},
    },
    Report: {
      showLoading() {},
      showPassed() {},
      showContent() {},
      showError() {},
    },
    VoiceCoach: {
      reset() { voiceResetCount += 1; },
    },
  });

  loadScript(context, "site/js/form.js");
  const newRequest = { voteGap: "close", script: "这是新一轮话术，必须重新通过才能开口练", scenario: null, mode: "free" };
  context.Form._submitData(newRequest);

  assert.equal(context.App.state.lastReport, null, "新稿提交时应立即清除旧 passed 报告");
  assert.deepEqual(lockedStages, ["voice"], "新稿批改前必须重新锁住开口练");
  assert.equal(passedScript.textContent, "", "旧过关稿不应继续留在开口练入口");
  assert.equal(voiceResetCount, 1, "旧录音会话应一起释放");
}

function testReviewFocusDoesNotBlameCompletedStructure() {
  const context = createBrowserContext();
  loadScript(context, "site/js/report.js");
  const completeChecks = [
    { key: "self_intro", label: "认识我", status: "met", evidence: "已完成" },
    { key: "gratitude", label: "接礼物", status: "met", evidence: "已完成" },
    { key: "target_user", label: "点到人", status: "met", evidence: "已完成" },
    { key: "user_reason", label: "给理由", status: "met", evidence: "已完成" },
    { key: "vote_instruction", label: "票数指令", status: "met", evidence: "已完成" },
  ];

  const personaFocus = context.Report._focusCheck(completeChecks, {
    card_type: "persona",
    ai_flavor: "像一套谁都能念的舞台腔",
    line_reviews: [],
  });
  assert.equal(personaFocus.key, "persona", "结构全齐时人设问题应成为真实焦点");
  assert.notEqual(personaFocus.key, "self_intro", "不应误导学员反复改已完成的自我介绍");

  const angleFocus = context.Report._focusCheck(completeChecks, {
    card_type: "logic",
    ai_flavor: "",
    line_reviews: [{ original: "求求你们帮帮我", mark: "wrong", comment: "站错角度" }],
  });
  assert.equal(angleFocus.key, "line_angle", "结构全齐但某句错了时应聚焦该句角度");
}

function makeChallengeReport(statuses, overrides = {}) {
  const keys = ["self_intro", "gratitude", "target_user", "user_reason", "vote_instruction"];
  return {
    card_type: "logic",
    card_why: "当前只差一个具体支点",
    structure_checks: keys.map((key, index) => ({
      key,
      status: statuses[index],
      evidence: `${key}-${statuses[index]}`,
    })),
    verdict: "almost",
    verdict_reason: "已经接住了人，这一关只差一个具体理由。",
    line_reviews: [],
    round_dynamics: {
      flow_read: "票数正在下降，说明前一拍有人接住",
      human_drivers: [
        {
          driver: "social_proof",
          evidence: "已经有人先补一手",
          mechanism: "真实跟进会降低其他观众的行动门槛",
        },
      ],
      response_read: "已经看到补票反馈",
      next_move: "接住最新出手的人，再递下一拍",
    },
    ai_flavor: "",
    redline_note: "",
    ...overrides,
  };
}

function testChallengeProgressTracksRealLearning() {
  const context = createBrowserContext({
    App: {
      state: { coaching: null },
      resetCoachingProgress() {
        this.state.coaching = {
          totalAttempts: 0,
          focusAttempts: 0,
          currentFocusKey: "",
          previousReport: null,
          currentReport: null,
          lastProgress: null,
          masteredKeys: {},
        };
      },
    },
  });
  loadScript(context, "site/js/report.js");

  const first = makeChallengeReport(["met", "met", "met", "missing", "partial"]);
  const firstProgress = context.Report._recordResult(first);
  assert.equal(firstProgress.totalAttempts, 1, "首份成功报告应计为第 1 次挑战");
  assert.equal(firstProgress.focus.key, "user_reason", "应只聚焦第一个真实结构缺口");
  assert.equal(firstProgress.focusAttempts, 1);
  assert.equal(firstProgress.metCount, 3);

  const duplicate = context.Report._recordResult(first);
  assert.equal(duplicate.totalAttempts, 1, "同一份报告重复渲染不得重复累计挑战次数");

  const second = makeChallengeReport(["met", "met", "met", "partial", "partial"]);
  const secondProgress = context.Report._recordResult(second);
  assert.equal(secondProgress.totalAttempts, 2);
  assert.equal(secondProgress.focus.key, "user_reason");
  assert.equal(secondProgress.focusAttempts, 2, "同一关第二次出现时应解锁教练扶一步");
  assert.equal(context.Report._shouldOpenHelp(secondProgress), true);

  const third = makeChallengeReport(["met", "met", "met", "met", "missing"]);
  const thirdProgress = context.Report._recordResult(third);
  assert.equal(thirdProgress.focus.key, "vote_instruction", "上一关达标后应切到下一关");
  assert.equal(thirdProgress.focusAttempts, 1, "切换关卡后本关尝试次数应重新计算");
  assert.equal(thirdProgress.newlyMastered.length, 1);
  assert.equal(thirdProgress.newlyMastered[0].key, "user_reason", "只庆祝这次真正新掌握的能力");

  const regressed = makeChallengeReport(["met", "met", "missing", "met", "missing"]);
  const regressedProgress = context.Report._recordResult(regressed);
  assert.equal(regressedProgress.focus.key, "target_user");
  assert.equal(regressedProgress.needsReinforcement.length, 1, "修改时不小心删掉已掌握项应被识别为需要补稳");
  assert.match(
    context.Report._progressMessage(regressedProgress, regressedProgress.focus),
    /补稳/,
    "能力回退时不应误说上一关已经结束"
  );

  const recovered = makeChallengeReport(["met", "met", "met", "met", "missing"]);
  const recoveredProgress = context.Report._recordResult(recovered);
  assert.equal(
    recoveredProgress.newlyMastered.length,
    0,
    "已掌握能力回退后再补稳，不应被重复包装成第一次学会"
  );

  const directContext = createBrowserContext({
    App: {
      state: { coaching: null },
      resetCoachingProgress() {
        this.state.coaching = {
          totalAttempts: 0,
          focusAttempts: 0,
          currentFocusKey: "",
          previousReport: null,
          currentReport: null,
          lastProgress: null,
          masteredKeys: {},
        };
      },
    },
  });
  loadScript(directContext, "site/js/report.js");
  const directPass = makeChallengeReport(
    ["partial", "partial", "partial", "met", "met"],
    { verdict: "passed" }
  );
  const directProgress = directContext.Report._recordResult(directPass);
  assert.equal(directProgress.focus, null, "两个核心 met 的 passed 报告不应继续生成结构关卡");
  assert.equal(directProgress.metCount, 2, "非核心项 partial 时应如实保留能力地图，而不是伪装成5/5");
  assert.doesNotMatch(
    directContext.Report._passAchievement(directProgress),
    /五项全部|五关|5\/5/,
    "新门槛通过后不得宣称五项全部完成"
  );
}

function testPassedUiDoesNotHardcodeFiveOfFive() {
  const reportSource = readFileSync(resolve(projectRoot, "site/js/report.js"), "utf8");
  const htmlSource = readFileSync(resolve(projectRoot, "site/index.html"), "utf8");
  assert.doesNotMatch(
    reportSource,
    /话术闯关\s*·\s*5\/5|五关全部拿下|五项结构都接住了/,
    "通过页脚本不能把两个核心过关写成五项全满"
  );
  assert.doesNotMatch(
    htmlSource,
    /话术闯关\s*·\s*5\/5|五关拿下|五项话术结构均已达标/,
    "通过页静态文案不能继续承诺5/5"
  );
}

function testSafetyAndRootCauseTakePriorityOverChecklist() {
  const context = createBrowserContext();
  loadScript(context, "site/js/report.js");
  const missingChecks = context.Report._checks(
    makeChallengeReport(["missing", "missing", "missing", "missing", "missing"])
  );

  const redlineFocus = context.Report._focusCheck(missingChecks, {
    verdict: "off",
    card_type: "logic",
    redline_note: "这一句不能播",
  });
  assert.equal(redlineFocus.key, "redline", "红线必须优先于普通结构缺口");

  const personaFocus = context.Report._focusCheck(missingChecks, {
    verdict: "off",
    card_type: "persona",
    ai_flavor: "整段像同一套模板",
    redline_note: "",
  });
  assert.equal(personaFocus.key, "persona", "人设方向问题必须优先于机械补结构");

  const logicFocus = context.Report._focusCheck(missingChecks, {
    verdict: "off",
    card_type: "logic",
    card_why: "整段只有求情，没有上票支点",
    ai_flavor: "",
    redline_note: "",
  });
  assert.equal(logicFocus.key, "logic", "整体方向错误时应先教根因，不机械指向第一项结构");
}

function testFiveStructureItemsDoNotMasqueradeAsFullPass() {
  const context = createBrowserContext();
  loadScript(context, "site/js/report.js");
  const status = context.Report._mapStatus(
    { metCount: 5 },
    { key: "persona", label: "自己的语气" }
  );
  assert.equal(status, "五项结构已齐 · 还有加练关");
  assert.doesNotMatch(status, /通关|全部拿下/, "加练关未过时不得伪装成完整通关");
}

function testChallengeSolutionCannotDriftToAnotherProblem() {
  const context = createBrowserContext();
  loadScript(context, "site/js/report.js");
  const report = {
    direction: {
      summary: "把请求说完整，不要刚开口就退缩。用你自己的话说。",
      examples: ["别松口，把请求说完"],
    },
  };
  const structureFocus = { key: "self_intro", label: "认识我" };
  const structureSolution = context.Report._solutionFor(report, structureFocus);
  assert.match(structureSolution, /名字|看点/, "结构关必须给本关解法");
  assert.doesNotMatch(structureSolution, /退缩|请求/, "不能把模型对另一卡点的方向塞进当前结构关");
  assert.deepEqual(
    Array.from(context.Report._helpItemsFor(report, structureFocus)),
    ["在名字后补：这一轮你具体有什么看点？", "只补一句，不要重新介绍一遍。"],
    "结构关扶助也必须与当前关一致"
  );

  const mentalityFocus = { key: "mentality", label: "开口底气" };
  assert.match(
    context.Report._solutionFor(report, mentalityFocus),
    /请求说完整/,
    "加练关应继续使用模型针对主卡点给出的方向"
  );
}

function testDefaultScenarioGuidanceIsConcreteAndHuman() {
  const scenario = {
    targetUser: "凯哥",
    userSignal: "你撒个娇，我考虑一下。",
  };
  const context = createBrowserContext({
    App: {
      state: {
        lastRequest: {
          script: "我是小满，谢谢凯哥刚才的小心心。凯哥，谢谢你刚才的小心心。",
          scenario,
        },
      },
    },
  });
  loadScript(context, "site/js/report.js");

  const targetFocus = { key: "target_user", label: "点到人", evidence: "还没有点到人" };
  const targetProgress = {
    checks: [
      { key: "self_intro", label: "认识我", status: "met" },
      { key: "gratitude", label: "接礼物", status: "met" },
      { key: "target_user", label: "点到人", status: "partial" },
      { key: "user_reason", label: "给理由", status: "missing" },
      { key: "vote_instruction", label: "票数指令", status: "missing" },
    ],
  };
  const targetGuidance = context.Report._guidanceFor({}, targetFocus, targetProgress);
  assert.match(targetGuidance.completed, /原话里已经出现了“凯哥”/, "应先承认新人已经找对目标用户");
  assert.match(targetGuidance.gap, /“凯哥，……”/, "应给出能直接核对的称呼方式");
  assert.match(targetGuidance.gap, /不考理由、票差或上票动作/, "点到人不得偷偷重复考理由或动作");
  assert.match(context.Report.CHALLENGES.target_user.standard, /只看有没有明确对本轮递球的具体用户说话/);
  assert.match(context.Report.CHALLENGES.target_user.standard, /具体感谢也算/);
  assert.doesNotMatch(
    context.Report.CHALLENGES.target_user.standard,
    /继续递出|递一个/,
    "“凯哥，谢谢你刚才的小心心”已经是在对目标用户说话，前端不得再要求额外递动作"
  );
  const targetHelp = Array.from(context.Report._helpItemsFor({}, targetFocus));
  assert.match(targetHelp.join(" "), /凯哥/, "二次扶助必须直接使用当轮目标用户，而不是抽象说“某个人”");
  assert.match(targetHelp.join(" "), /不用补理由、票差或上票动作/);

  context.App.state.lastRequest.script = "凯哥，你不是说想看我撒娇吗？我现在就回应你。";
  const reasonFocus = { key: "user_reason", label: "给理由", evidence: "理由还不明确" };
  const reasonProgress = {
    checks: targetProgress.checks.map((check) => ({
      ...check,
      status: check.key === "target_user" ? "met" : check.status,
    })),
  };
  const reasonGuidance = context.Report._guidanceFor({}, reasonFocus, reasonProgress);
  assert.match(reasonGuidance.completed, /已经把话递给“凯哥”了/, "上一关过了就明确告诉新人称呼不用再改");
  assert.match(reasonGuidance.gap, /你撒个娇，我考虑一下/, "给理由必须直接接住现场真实用户信号");
  assert.match(reasonGuidance.gap, /回应、得到什么乐趣或选择权/, "应把抽象的“给理由”翻译成可检查成分");
  assert.match(reasonGuidance.gap, /不检查票差和上票动作/, "给理由关不得重复考票数指令");
  const reasonHelp = Array.from(context.Report._helpItemsFor({}, reasonFocus));
  assert.match(reasonHelp.join(" "), /你撒个娇，我考虑一下/, "二次扶助必须引用当轮信号");
  assert.match(reasonHelp.join(" "), /凯哥，你刚说想看我撒娇，那我现在撒一个给你看/, "二次扶助应给完全新人可照着自检的最小骨架");
  assert.match(reasonHelp.join(" "), /不用照抄整段/, "最小骨架必须明确要求换回自己的词");

  const positiveSignal = scenario.userSignal;
  for (const negativeSignal of ["别撒娇", "不想看撒娇", "你不用撒娇了", "没说想看返场"]) {
    context.App.state.lastRequest.scenario.userSignal = negativeSignal;
    const negativeGuidance = context.Report._guidanceFor({}, reasonFocus, reasonProgress);
    const negativeHelp = Array.from(context.Report._helpItemsFor({}, reasonFocus)).join(" ");
    assert.match(negativeGuidance.gap, /不想要|拒绝|尊重/, `负向信号必须按拒绝解释：${negativeSignal}`);
    assert.match(negativeHelp, /不要反着理解|不要照着做/, `二次扶助不能把拒绝说成兴趣：${negativeSignal}`);
    assert.doesNotMatch(negativeHelp, /你刚说想看我撒娇|那我现在撒一个|你刚说想看返场/, `负向信号不能生成反向骨架：${negativeSignal}`);
  }
  context.App.state.lastRequest.scenario.userSignal = "别撒娇";
  assert.equal(
    context.Report._specificDirectionFor(
      { direction: { summary: "接住凯哥想看撒娇的信号，现在撒一个给他看。" } },
      reasonFocus
    ),
    "",
    "模型方向也不能把负向现场信号反说成正向兴趣"
  );
  context.App.state.lastRequest.scenario.userSignal = positiveSignal;

  const related = {
    direction: { summary: "接住凯哥想看撒娇的信号，说清他参与后会得到什么回应。" },
  };
  assert.match(
    context.Report._specificDirectionFor(related, reasonFocus),
    /凯哥.*撒娇/,
    "模型结合原话且属于本关的具体方向不应被编号关隐藏"
  );
  const unrelated = {
    direction: { summary: "还差320票，请让凯哥马上补票。" },
  };
  assert.equal(
    context.Report._specificDirectionFor(unrelated, reasonFocus),
    "",
    "模型方向若偷带票差和动作，不得显示在给理由关造成跨关矛盾"
  );
  for (const crossLevelDirection of [
    "点到凯哥，让他扣1回应你。",
    "接住撒娇信号，让凯哥在公屏扣1。",
    "接住撒娇信号，让凯哥去评论区给反馈。",
    "点到凯哥，让他补一点、跟一点。",
    "点到凯哥，再让他帮我组一组。",
  ]) {
    const crossLevelFocus = crossLevelDirection.indexOf("点到凯哥") === 0
      ? targetFocus
      : reasonFocus;
    assert.equal(
      context.Report._specificDirectionFor(
        { direction: { summary: crossLevelDirection } },
        crossLevelFocus
      ),
      "",
      `评论或上票动作不能作为当前原子关的隐藏条件：${crossLevelDirection}`
    );
  }

  assert.equal(
    context.Report._specificOneThingFor(
      { one_thing: "记得说还差320票，再让凯哥马上补票。" },
      reasonFocus
    ),
    "",
    "旧的 one_thing 若属于票数关，也不得在给理由关制造第二套标准"
  );
  assert.match(
    context.Report._specificOneThingFor(
      { one_thing: "接住凯哥想看撒娇的信号，给他一个明确回应。" },
      reasonFocus
    ),
    /撒娇.*回应/,
    "真正属于当前关的一句话提醒应保留"
  );

  assert.equal(
    context.Report._reviewCommentFor("虽然提到凯哥，但没有让他扣1回应", targetFocus),
    "这句还没有明确说给当前目标用户；本关只核对称呼，不检查理由、票差或动作。",
    "完整复盘的逐句评论也必须消除点到人隐藏门槛"
  );
  assert.equal(
    context.Report._reviewCommentFor("没有让凯哥扣1或上票反馈", reasonFocus),
    "这句还没说清对方参与后能得到的回应、乐趣或选择；本关不检查评论或上票动作。",
    "完整复盘的逐句评论也必须消除给理由隐藏门槛"
  );
  for (const hiddenTargetComment of [
    "虽然喊了凯哥，但还没递出一个互动动作",
    "点到凯哥后还需要给出一个可回应的动作",
    "虽然说了凯哥，但没有让对方接话",
  ]) {
    assert.match(
      context.Report._reviewCommentFor(hiddenTargetComment, targetFocus),
      /本关只核对称呼，不检查理由、票差或动作/,
      `点到人完整复盘必须过滤隐藏动作同义词：${hiddenTargetComment}`
    );
  }
  for (const hiddenReasonComment of [
    "有兴趣点，但缺少可执行动作",
    "说了返场，还没有邀请对方回应",
  ]) {
    assert.match(
      context.Report._reviewCommentFor(hiddenReasonComment, reasonFocus),
      /本关不检查评论或上票动作/,
      `给理由完整复盘必须过滤隐藏动作同义词：${hiddenReasonComment}`
    );
  }
}

async function testCoachTabResponsesStayInTheirOwnTab() {
  const context = createBrowserContext({
    document: { addEventListener() {} },
  });
  loadScript(context, "site/js/coach.js");

  let resolveAuto;
  let resolveManual;
  const rendered = [];
  context.Coach._showListLoading = function () {};
  context.Coach._refreshLoadMore = function () {};
  context.Coach._toast = function () {};
  context.Coach._renderList = function (items) {
    rendered.push({ tab: context.Coach._tab, items });
  };
  context.Coach._request = function (path) {
    return new Promise((resolvePromise) => {
      if (path.includes("source=auto")) resolveAuto = resolvePromise;
      else resolveManual = resolvePromise;
    });
  };

  context.Coach._tab = "auto";
  context.Coach.loadList();
  context.Coach._tab = "manual";
  context.Coach.loadList();

  resolveAuto({ items: [{ id: "auto-old" }], hasMore: false });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(rendered.length, 0, "旧 tab 的迟到响应不得渲染到当前 tab");

  resolveManual({ items: [{ id: "manual-current" }], hasMore: false });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].tab, "manual");
  assert.equal(rendered[0].items[0].id, "manual-current");
}

function testCoachCodeIsSessionScoped() {
  const values = new Map();
  let localStorageTouched = false;
  const context = createBrowserContext({
    document: { addEventListener() {} },
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
    localStorage: {
      getItem() { localStorageTouched = true; return null; },
      setItem() { localStorageTouched = true; },
      removeItem() { localStorageTouched = true; },
    },
  });
  loadScript(context, "site/js/coach.js");
  context.Coach.saveAdminCode("tab-only-admin-code");
  assert.equal(context.Coach.getAdminCode(), "tab-only-admin-code");
  context.Coach.clearAdminCode();
  assert.equal(context.Coach.getAdminCode(), "");
  assert.equal(localStorageTouched, false, "管理码不应写入跨会话 localStorage");
}

try {
  testApiOverrideCannotExfiltrateCodes();
  testAccessCodeSurvivesStorageFailure();
  await testApiWithoutAbortController();
  testBusySubmissionDoesNotReplaceLastRequest();
  testUnchangedDraftCannotRestartTheSameChallenge();
  testNewSubmissionInvalidatesOldPass();
  testReviewFocusDoesNotBlameCompletedStructure();
  testChallengeProgressTracksRealLearning();
  testPassedUiDoesNotHardcodeFiveOfFive();
  testSafetyAndRootCauseTakePriorityOverChecklist();
  testFiveStructureItemsDoNotMasqueradeAsFullPass();
  testChallengeSolutionCannotDriftToAnotherProblem();
  testDefaultScenarioGuidanceIsConcreteAndHuman();
  await testCoachTabResponsesStayInTheirOwnTab();
  testCoachCodeIsSessionScoped();
  console.log("PASS");
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
