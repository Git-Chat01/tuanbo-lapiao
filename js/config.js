// 全局配置：API 地址与场况枚举的中文标签
// 注意：DEFAULT_API 部署时填 Worker 真实域名（部署任务会更新此文件 + CSP）

// 部署时把 Worker 真实域名填到这里（如 "https://xxx.workers.dev"）
var DEFAULT_API = "";

// 支持 URL 参数覆盖，用于本地联调：http://localhost:8080/?api=http://127.0.0.1:8787
var API_BASE = (function () {
  var params = new URLSearchParams(window.location.search);
  return params.get("api") || DEFAULT_API || "";
})();

// 场况枚举 → 中文标签（与 worker/prompt.js 的映射保持一致）
var LABELS = {
  voteGap: { far: "差一大截", close: "差一点点", secured: "已达标保位" },
  timeLeft: { early: "刚进环节", counting: "倒计时中", final: "最后几秒" },
  host: {
    pressuring: "施压催票",
    cooperative: "配合给台阶",
    neutral: "中立看戏",
    challenging: "挑刺质疑",
  },
  chat: {
    quiet: "冷清没人说话",
    hype: "起哄看戏",
    doubt: "有人唱衰拆台",
    waiting: "有大哥在观望",
    leading: "已有人带头喊救",
  },
  rivalVotes: { ahead: "别家领先", close: "和我差不多", behind: "别家落后" },
  rivalFans: { separate: "各刷各的", poachable: "能挖", hostile: "在唱衰我" },
};

// 文本长度限制（与 worker/index.js 的 LIMITS 保持一致）
var LIMITS = { scriptMin: 20, scriptMax: 500, noteMax: 50 };

// localStorage 键名
var STORAGE_KEYS = { accessCode: "tuanbo_access_code" };
