// 全局配置：API 地址与票况枚举的中文标签
// 注意：DEFAULT_API 部署时填 Worker 真实域名（部署任务会更新此文件 + CSP）

// 线上 Worker 地址：自定义域名，绕开国内对 workers.dev 的访问干扰
// （cide 项目 api.aivar.cc 同款方案；本地联调可用 ?api= 参数覆盖）
var DEFAULT_API = "https://lapiao.aivar.cc";

// 只允许在 loopback 页面上用 loopback API 覆盖做本地联调。
// 线上页面即使被诱导打开 ?api=https://evil.example 也会忽略，
// 避免把主播入口码或教练管理码发给任意地址。
var API_BASE = (function () {
  var pageHost = window.location.hostname;
  var isLocalPage = pageHost === "127.0.0.1" || pageHost === "localhost";
  if (!isLocalPage) return DEFAULT_API || "";

  var params = new URLSearchParams(window.location.search);
  var override = params.get("api");
  if (!override) return DEFAULT_API || "";
  try {
    var parsed = new URL(override);
    var isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    var isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    var hasOnlyOrigin = (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash;
    if (isLoopback && isHttp && hasOnlyOrigin && !parsed.username && !parsed.password) {
      return parsed.origin;
    }
  } catch (error) {
    // 非法 URL 直接回退正式 API。
  }
  return DEFAULT_API || "";
})();

// 票况枚举 → 中文标签（自由话术的基础事实选择，与 Worker 保持一致）
var LABELS = {
  voteGap: { far: "差一大截", close: "快够了", secured: "在保位" },
};

// 新人默认从一轮完整现场开始，而不是面对空白表单。
// 首版先内置一轮可控场景；后续由老师后台下发同一数据结构，不增加主播操作。
var TRAINING_SCENARIOS = [
  {
    id: "guided-user-signal-01",
    voteGap: "close",
    secondsLeft: 38,
    votesNeeded: 320,
    title: "把上票理由说到凯哥身上",
    targetUser: "凯哥",
    recentGift: "小心心 ×5",
    userSignal: "你撒个娇，我考虑一下。",
    hostCue: "她不好意思，凯哥你再逗逗她。",
    trainingGoal: "接住用户已经给出的互动信号，把复活后的反馈说具体。",
    coachHint: "主持已经把球递到“撒娇互动”上了。先接住凯哥，再看他愿不愿意继续参与。",
    events: [
      { at: 0, source: "主持", tone: "host", text: "最后四十秒，她还差 320 票。" },
      { at: 2, source: "礼物", tone: "gift", text: "凯哥送出 小心心 ×5" },
      { at: 5, source: "凯哥", tone: "user", text: "你撒个娇，我考虑一下。" },
      { at: 7, source: "主持", tone: "host", text: "她不好意思，凯哥你再逗逗她。" },
    ],
  },
];

// 文本长度限制（与 worker/index.js 的 LIMITS 保持一致）
// scriptMax=500 只约束主播端批改（DeepSeek 输出边界）；教练后台投喂不调模型，上限更宽
var LIMITS = { scriptMin: 20, scriptMax: 500, feedScriptMax: 800, feedWhyGoodMax: 320 };

// localStorage 键名
var STORAGE_KEYS = {
  accessCode: "tuanbo_access_code",
  draft: "tuanbo_training_draft_v3",
};
