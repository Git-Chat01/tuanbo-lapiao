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
  testNewSubmissionInvalidatesOldPass();
  testReviewFocusDoesNotBlameCompletedStructure();
  await testCoachTabResponsesStayInTheirOwnTab();
  testCoachCodeIsSessionScoped();
  console.log("PASS");
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
