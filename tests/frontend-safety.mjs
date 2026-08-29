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
    ["met", "met", "met", "met", "met"],
    { verdict: "passed" }
  );
  const directProgress = directContext.Report._recordResult(directPass);
  assert.equal(
    directContext.Report._passAchievement(directProgress),
    "第一次挑战就把五项全部说齐了。",
    "首稿通关应庆祝一次完成，而不是误称最后补上五项"
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
  testSafetyAndRootCauseTakePriorityOverChecklist();
  testFiveStructureItemsDoNotMasqueradeAsFullPass();
  testChallengeSolutionCannotDriftToAnotherProblem();
  await testCoachTabResponsesStayInTheirOwnTab();
  testCoachCodeIsSessionScoped();
  console.log("PASS");
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
