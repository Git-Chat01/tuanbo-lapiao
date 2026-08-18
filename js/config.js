// 全局配置：API 地址与票况枚举的中文标签
// 注意：DEFAULT_API 部署时填 Worker 真实域名（部署任务会更新此文件 + CSP）

// 线上 Worker 地址：自定义域名，绕开国内对 workers.dev 的访问干扰
// （cide 项目 api.aivar.cc 同款方案；本地联调可用 ?api= 参数覆盖）
var DEFAULT_API = "https://lapiao.aivar.cc";

// 支持 URL 参数覆盖，用于本地联调：http://localhost:8080/?api=http://127.0.0.1:8787
var API_BASE = (function () {
  var params = new URLSearchParams(window.location.search);
  return params.get("api") || DEFAULT_API || "";
})();

// 票况枚举 → 中文标签（v2 极简表单唯一事实性选择，与 worker 的 VOTE_GAP_ENUM 保持一致）
var LABELS = {
  voteGap: { far: "差一大截", close: "快够了", secured: "在保位" },
};

// 文本长度限制（与 worker/index.js 的 LIMITS 保持一致）
// scriptMax=500 只约束主播端批改（DeepSeek 输出边界）；教练后台投喂不调模型，上限更宽
var LIMITS = { scriptMin: 20, scriptMax: 500, feedScriptMax: 800, feedWhyGoodMax: 320 };

// localStorage 键名
var STORAGE_KEYS = { accessCode: "tuanbo_access_code" };
