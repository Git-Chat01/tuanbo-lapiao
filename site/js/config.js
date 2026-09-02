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
// timeline 只记录可观察事实：角色、事件类型、原话和票的玩法作用。
// effect 只说明本轮票的方向，不代表用户喜欢或讨厌主播。
var TRAINING_SCENARIOS = [
  {
    id: "revival-medical-condition-01",
    selectorLabel: "医药费条件",
    voteGap: "close",
    phase: "pledging",
    phaseLabel: "复活组队 · 谈条件",
    timeLabel: "主持控时",
    roleContext: "你是台上正在拉票复活的新人主播",
    goalUnit: "个（1个=价值99票的复活礼物）",
    unitShort: "个",
    targetUnits: 28,
    pledgedUnits: 23,
    openRemaining: 5,
    deliveredUnits: 0,
    initialProgress: { pledgedUnits: 18, openRemaining: 10, deliveredUnits: 0 },
    title: "听懂条件变化，再接住这次认领",
    preReplayTitle: "先听完这段条件变化",
    initialPhaseLabel: "复活组队 · 条件未明",
    targetUser: "观众丙",
    recentGift: "尚无礼物到账；观众丙口头认领5个",
    userSignal: "观众丙先提出共同下票的观众乙也参与；得知观众乙离场后，随后报数“5”。",
    hostCue: "主持仍在根据组队进度控时，尚未发出“那就丢”。",
    trainingGoal: "区分条件、占位和到账；接住观众丙报出的5个，不替离场用户承诺。",
    preReplayHint: "先按顺序听，不要只看单条弹幕下结论；留意条件中间发生了什么变化。",
    coachHint: "这里的“刀”指上一轮下去票。把同一用户的碎片弹幕按顺序合起来，看条件有没有变化；认领不是到账，先读完再接最新缺口。",
    timeline: [
      { at: 0, role: "offstage_streamer", kind: "status", effect: "revive", speaker: "台下主播A", text: "28个复活组队，已占位18个，还差10个。" },
      { at: 1, role: "system", kind: "status", effect: "down", speaker: "场况", text: "上一轮，观众丙与观众乙都给你上过下去票。" },
      { at: 2, role: "active_streamer", kind: "chat", effect: "neutral", speaker: "你（台上）", text: "刚刚用“医药费”玩法梗向观众丙发出邀请（未提供原口播）。" },
      { at: 3, role: "viewer", kind: "condition", effect: "neutral", speaker: "观众丙", text: "找刚才和我一起刀的那个。" },
      { at: 4, role: "viewer", kind: "condition", effect: "neutral", speaker: "观众丙", text: "@观众乙，他给我就给。" },
      { at: 5, role: "offstage_streamer", kind: "chat", effect: "neutral", speaker: "台下主播B", text: "观众乙刚离开直播间了。" },
      { at: 6, role: "viewer", kind: "chat", effect: "neutral", speaker: "观众丙", text: "……" },
      {
        at: 7,
        role: "viewer",
        kind: "pledge",
        effect: "revive",
        speaker: "观众丙",
        text: "5",
        progress: { pledgedUnits: 23, openRemaining: 5, deliveredUnits: 0 },
      },
      { at: 8, role: "system", kind: "status", effect: "revive", speaker: "组队记录", text: "观众丙认领5个；尚未到账，等待组满后统一丢。" },
    ],
  },
  {
    id: "revival-closing-last-two",
    selectorLabel: "最后两个",
    voteGap: "close",
    phase: "closing",
    phaseLabel: "复活组队 · 临门补位",
    timeLabel: "主持控时",
    roleContext: "你是台上正在拉票复活的新人主播",
    goalUnit: "个（1个=价值99票的复活礼物）",
    unitShort: "个",
    targetUnits: 28,
    pledgedUnits: 27,
    openRemaining: 1,
    deliveredUnits: 0,
    initialProgress: { pledgedUnits: 26, openRemaining: 2, deliveredUnits: 0 },
    title: "只差最后一个，把临门一脚接稳",
    preReplayTitle: "最后位置在变化，先看发生了什么",
    initialPhaseLabel: "复活组队 · 最后两个",
    targetUser: "仍在场的观众",
    recentGift: "尚未统一丢；观众乙在原认领4个上追加1个",
    userSignal: "多位台下主播持续报“最后两个”；观众乙随后打出“加一个”。",
    hostCue: "主持正在根据组队是否还有希望控制倒计时，尚未发出统一丢票口令。",
    trainingGoal: "识别追加认领并更新为只差1个，用短话给最后位置一个清晰入口。",
    preReplayHint: "先看每条信息是谁发的；有人回应后，现场缺口可能会马上变化。",
    coachHint: "留意“加一个”前面有没有这个人的原认领。每次有人回应后先更新缺口；临门时保持短、准、密，组满就停止继续拉。",
    timeline: [
      { at: 0, role: "offstage_streamer", kind: "chat", effect: "neutral", speaker: "台下主播A", text: "最后两个啦！！！" },
      { at: 1, role: "offstage_streamer", kind: "status", effect: "revive", speaker: "台下主播B", text: "28个，已占位26个，还差2个。" },
      { at: 2, role: "viewer", kind: "chat", effect: "neutral", speaker: "观众乙", text: "真能忍。" },
      { at: 3, role: "offstage_streamer", kind: "chat", effect: "neutral", speaker: "台下主播C", text: "谁能抓一下？" },
      { at: 4, role: "viewer", kind: "chat", effect: "neutral", speaker: "观众丁", text: "快倒计时。" },
      {
        at: 5,
        role: "viewer",
        kind: "pledge_increment",
        effect: "revive",
        speaker: "观众乙",
        text: "加一个。",
        progress: { pledgedUnits: 27, openRemaining: 1, deliveredUnits: 0 },
      },
      { at: 6, role: "offstage_streamer", kind: "status", effect: "revive", speaker: "台下主播B", text: "最后1个了！" },
      { at: 7, role: "offstage_streamer", kind: "chat", effect: "neutral", speaker: "台下主播C", text: "1个抓28个！" },
    ],
  },
  {
    id: "revival-awaiting-drop-01",
    selectorLabel: "最后一个",
    voteGap: "secured",
    phase: "awaiting_drop",
    phaseLabel: "复活组队 · 组满待发令",
    timeLabel: "等待主持",
    roleContext: "你是台上正在拉票复活的新人主播",
    goalUnit: "个（1个=价值99票的复活礼物）",
    unitShort: "个",
    targetUnits: 28,
    pledgedUnits: 28,
    openRemaining: 0,
    deliveredUnits: 1,
    initialProgress: { pledgedUnits: 27, openRemaining: 1, deliveredUnits: 0 },
    title: "组队刚满，把发令权交还主持",
    preReplayTitle: "最后一个位置，先看谁接了",
    initialPhaseLabel: "复活组队 · 最后一个",
    targetUser: "已占位的复活队伍",
    recentGift: "观众甲未先打字认领，直接送出最后1个；其余27个是公开认领，尚未统一到账",
    userSignal: "观众甲直接送出最后1个后，现场确认组队已满；主持尚未发出“那就丢”。",
    hostCue: "当前画面里主持尚未发出“那就丢”；组满后会由主持切胜利音乐并统一发令。",
    trainingGoal: "确认组满，分清已占位与已到账，提醒等待主持口令并停止继续拉票。",
    coachHint: "留意最后位置是先报数还是直接送出。位置一旦占满，先分清占位与到账，不再喊人补位，把统一发令交给主持。",
    preReplayHint: "先看完最后一个位置发生了什么，再判断现在该继续拉，还是该停下来。",
    timeline: [
      { at: 0, role: "offstage_streamer", kind: "status", effect: "revive", speaker: "台下主播B", text: "最后1个了！" },
      {
        at: 1,
        role: "system",
        kind: "direct_gift",
        effect: "revive",
        speaker: "礼物",
        text: "观众甲直接送出复活礼物 ×1个",
        progress: { pledgedUnits: 28, openRemaining: 0, deliveredUnits: 1 },
      },
      { at: 2, role: "viewer", kind: "chat", effect: "neutral", speaker: "观众丙", text: "你自己抓了。" },
      { at: 3, role: "offstage_streamer", kind: "status", effect: "revive", speaker: "台下主播A", text: "队组齐了！" },
      { at: 4, role: "system", kind: "status", effect: "revive", speaker: "组队记录", text: "已占位28个：公开认领27个、直接到账1个；其余按约定等待主持统一发令。" },
    ],
    nextFlow: "下一拍由主持切胜利/拿下音乐并喊“那就丢” → 用户按约定集中兑现 → 主持确认复活并感谢 → 台上主播再接住共同完成的结果。",
  },
  {
    id: "guided-user-signal-01",
    selectorLabel: "原场景 · 互动",
    voteGap: "close",
    phase: "revival_offer",
    phaseLabel: "复活拉票 · 互动递球",
    timeLabel: "00:38",
    roleContext: "你是台上正在拉票的新人主播",
    goalUnit: "票（按直播间实时票数）",
    unitShort: "票",
    targetUnits: 320,
    pledgedUnits: null,
    openRemaining: null,
    deliveredUnits: null,
    pledgedLabel: "本场不组队",
    remainingLabel: "看实时票差",
    deliveredLabel: "票值待换算",
    initialProgress: { pledgedUnits: null, openRemaining: null, deliveredUnits: null },
    secondsLeft: 38,
    votesNeeded: 320,
    title: "把上票理由说到凯哥身上",
    targetUser: "凯哥",
    recentGift: "小心心 ×5",
    userSignal: "你撒个娇，我考虑一下。",
    hostCue: "她不好意思，凯哥你再逗逗她。",
    trainingGoal: "接住用户已经给出的互动信号，把复活后的反馈说具体。",
    coachHint: "主持已经把球递到“撒娇互动”上了。先接住凯哥，再看他愿不愿意继续参与。",
    timeline: [
      { at: 0, role: "host", kind: "host_cue", effect: "neutral", speaker: "主持", text: "最后四十秒，她还差320票。" },
      { at: 2, role: "system", kind: "gift", effect: "unknown", speaker: "礼物", text: "凯哥送出 小心心 ×5（票值未提供）" },
      { at: 5, role: "viewer", kind: "chat", effect: "neutral", speaker: "凯哥", text: "你撒个娇，我考虑一下。" },
      { at: 7, role: "host", kind: "host_cue", effect: "neutral", speaker: "主持", text: "她不好意思，凯哥你再逗逗她。" },
    ],
  },
];

var DEFAULT_TRAINING_SCENARIO_ID = "revival-closing-last-two";

// 文本长度限制（与 worker/index.js 的 LIMITS 保持一致）
// scriptMax=500 只约束主播端批改（DeepSeek 输出边界）；教练后台投喂不调模型，上限更宽
var LIMITS = { scriptMin: 20, scriptMax: 500, feedScriptMax: 800, feedWhyGoodMax: 320 };

// localStorage 键名
var STORAGE_KEYS = {
  accessCode: "tuanbo_access_code",
  draft: "tuanbo_training_draft_v3",
};
