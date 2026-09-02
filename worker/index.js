// 团播拉票话术教练 v4 — Cloudflare Worker
// 职责：CORS → 鉴权 → 参数白名单校验 → 红线检测 → 检索案例 → 调 DeepSeek
//       → 契约校验 → 红线/吸收闸门 → 返回结构化批改报告 + 教练后台管理接口
// 安全设计沿用 cide wardrobe-api-v2 的模式：Origin 白名单回显、fail-closed 鉴权、
// 统一 {error:true, message} 错误结构。
// 注意：所有错误响应都由入口统一 jsonResponse 构造，保证 CORS 头始终存在
// （浏览器侧缺 CORS 头时连错误文案都读不到，前端只能显示"网络错误"）。

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import {
  retrieveCases,
  tryAbsorb,
  addManualCase,
  publishCase,
  listAdminCases,
  softDeleteCase,
} from "./cases.js";
import { detectRedline } from "./redlines.js";

// CORS Origin 白名单：命中则回显该 Origin，未命中回退到第一个
// （CORS 只约束浏览器跨域读响应，真正的安全门槛是入口码/管理密码，不是这里）
const ALLOWED_ORIGINS = [
  "https://git-chat01.github.io", // GitHub Pages
  "http://127.0.0.1:8080", // 本地前端联调
  "http://localhost:8080",
];

// 基础票况枚举；可再附加可选现场情境。
const VOTE_GAP_ENUM = ["far", "close", "secured"];

// 文本长度限制（前后端双重限制，后端兜底）
const LIMITS = {
  scriptMin: 20, // 话术最短 20 字（少于这个没法批）
  scriptMax: 500, // 批改话术上限：500 字逐句点评已逼近 max_tokens 3000，再长 JSON 会截断（502）
  feedScriptMax: 800, // 投喂话术上限（1.6×）：投喂只存 KV 不调模型，可以更长
  whyGoodMin: 1, // 投喂理由必填——"为什么好"是 manual 案例的灵魂（给 AI 的判断尺子）
  whyGoodMax: 320, // 投喂理由上限（1.6×200）：给 AI 的判断尺子，太长检索时也读不动
  structureEvidenceMax: 80, // 五项结构证据只保留短句，避免模型在证据栏写小作文
  roundDynamicsTextMax: 180, // 本轮流动判断/反馈判断/下一拍都只保留短复盘
  driverEvidenceMax: 80, // 人性驱动证据必须落到原稿或现场里的短证据
  driverMechanismMax: 160, // 机制允许比证据多解释一层，但禁止写成长篇心理分析
  timelineMax: 24, // 一轮只保留足够还原因果链的关键事件，避免弹幕噪音撑爆 prompt
  timelineCharsMax: 3600, // 时间线所有可见文字的总预算，防止多条合法短文本叠加膨胀
  bodyMaxBytes: 10 * 1024, // 请求体上限 10KB，防超大 payload（800 字话术 + 320 字理由 < 4KB，安全）
};

// 批改报告的枚举白名单（不信任模型输出，逃逸枚举 → 502 让前端重试）
const VERDICT_ENUM = ["passed", "almost", "off"];
const CARD_TYPE_ENUM = ["logic", "expression", "mentality", "persona"];
const MARK_ENUM = ["good", "partial", "wrong"];
const STRUCTURE_STATUS_ENUM = ["met", "partial", "missing"];
const STRUCTURE_CHECK_KEYS = [
  "self_intro",
  "gratitude",
  "target_user",
  "user_reason",
  "vote_instruction",
];
const HUMAN_DRIVER_ENUM = [
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
];

// 可选现场情境只接受这些字段。未知字段直接丢弃；已知字段类型/范围非法则 400。
const SCENARIO_NUMBER_RULES = {
  secondsLeft: { max: 3600, decimals: 0 }, // 团播倒计时按最多 1 小时兜底
  votesNeeded: { max: 10000000, decimals: 0 },
  // 组队单位允许 0.5 这类半手认领，但拒绝无限小数和非有限数。
  targetUnits: { max: 10000000, decimals: 2 },
  pledgedUnits: { max: 10000000, decimals: 2 },
  openRemaining: { max: 10000000, decimals: 2 },
  deliveredUnits: { max: 10000000, decimals: 2 },
};
const SCENARIO_TEXT_LIMITS = {
  id: 64,
  roleContext: 160,
  goalUnit: 48,
  hostCue: 160,
  targetUser: 80,
  userSignal: 160,
  recentGift: 120,
  trainingGoal: 120,
};
const SCENARIO_PHASE_ENUM = [
  "elimination",
  "revival_offer",
  "pledging",
  "closing",
  "awaiting_drop",
  "delivery",
  "result",
  "post_round",
];
const TIMELINE_ROLE_ENUM = [
  "host",
  "active_streamer",
  "offstage_streamer",
  "viewer",
  "system",
];
const TIMELINE_KIND_ENUM = [
  "chat",
  "host_cue",
  "pledge",
  "condition",
  "pledge_increment",
  "direct_gift",
  "drop_cue",
  "gift",
  "rank",
  "status",
];
const TIMELINE_EFFECT_ENUM = ["down", "revive", "neutral", "unknown"];
const TIMELINE_TEXT_LIMITS = {
  at: 32,
  speaker: 80,
  text: 200,
};
const SCENARIO_FIELD_ORDER = [
  "id",
  "roleContext",
  "phase",
  "goalUnit",
  "targetUnits",
  "pledgedUnits",
  "openRemaining",
  "deliveredUnits",
  "secondsLeft",
  "votesNeeded",
  "hostCue",
  "targetUser",
  "userSignal",
  "recentGift",
  "trainingGoal",
  "timeline",
];

// DeepSeek 调用参数
const DEEPSEEK_CONFIG = {
  url: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  // 温度演进：0.7 → 0.3 → 0。
  // 0.7：同一稿每次换新挑剔点，好稿永远 almost；
  // 0.3：本地 3/3 稳定，但线上空案例库时 case2 仍小概率翻车
  // （复活"就差你了是求情卖惨"旧误判，会误导学员把好句改坏）；
  // 0：判定完全确定——批改质量靠 prompt 规则，不靠随机发挥。
  // 文案多样性由不同稿子内容自然产生，教学工具判定正确 > 文案多样。
  temperature: 0,
  // 教训（2026-08-16）：话术接近 500 字时逐句点评输出会逼近 1200 token 上限，
  // 触发 JSON 截断 → 502"报告格式出错"。上限提到 3000（max_tokens 是上限，
  // 成本按实际输出计，短话术不更贵）
  maxTokens: 3000,
  timeoutMs: 45000, // 输出更长耗时更久；前端 60s，此处留 15s 余量
};

export default {
  // v2 起带 ctx：吸收走 ctx.waitUntil，与批改响应解耦（KV 写失败不影响学员体验）
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      // X-Admin-Code 是管理接口鉴权头，缺了浏览器对带自定义头的请求预检直接失败
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Code",
      "Access-Control-Max-Age": "86400",
    };

    // CORS 预检：入口顶部先处理，避免后面的业务逻辑拦到 OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 健康检查：不碰 DeepSeek，用于验证部署成功与 CORS 正确
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "tuanbo-lapiao-coach",
        },
        200,
        corsHeaders
      );
    }

    // 根路径：API 域名不是给人看的，直接打开时跳到前端页面
    // （主播/教练会从微信里打开链接，输错域名时落到这里也比看到 JSON 好）
    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect("https://git-chat01.github.io/tuanbo-lapiao/", 302);
    }

    // ---- 教练后台管理接口（隐藏 coach.html 专用）----
    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdmin(request, env, url, corsHeaders);
    }

    // ---- 主播批改接口：POST /api/coach ----
    if (request.method !== "POST" || url.pathname !== "/api/coach") {
      return jsonResponse({ error: true, message: "接口不存在" }, 404, corsHeaders);
    }

    const startedAt = Date.now();
    try {
      const body = await readBody(request);

      // 入口码鉴权（fail-closed）
      const authError = checkAccessCode(body, env);
      if (authError) return jsonResponse({ error: true, message: authError.message }, authError.status, corsHeaders);

      // 参数白名单校验（v2 极简：票况 + 话术）
      const paramsError = validateParams(body);
      if (paramsError) return jsonResponse({ error: true, message: paramsError.message }, paramsError.status, corsHeaders);

      // scenario 是可选增强字段；旧请求不传时返回 null，行为完全不变。
      // 未知字段丢弃，已知字段类型/范围非法由 sanitizeScenario 抛 400。
      const scenario = sanitizeScenario(body.scenario);

      // 红线检测（纯词表，不调模型）——命中不拒批，作用在判定与吸收两个闸门
      const redlineHits = detectRedline(body.script);

      // 检索参照案例：失败降级 cases=[] 继续批（批改是主价值，案例是增量）
      let cases = [];
      try {
        cases = await retrieveCases(env, {
          voteGap: body.voteGap,
          script: body.script,
          scenario,
        });
      } catch (err) {
        console.log(`cases retrieve fail (degraded): ${err.message}`);
      }

      // 调 DeepSeek 批改
      const result = await callDeepSeek(env, {
        voteGap: body.voteGap,
        script: body.script,
        cases,
        redlineHits,
        scenario,
      });

      // 契约校验 + 缺失字段补默认值
      const report = normalizeReport(result.report, body.script);

      // 后端安全闸门：不信任模型对红线与人设卡的最终判定。
      // 必须在学习候选闸门之前执行，避免不合格稿进入候选池。
      applyReportSafetyGates(report, redlineHits, {
        sourceScript: body.script,
        scenario,
        voteGap: body.voteGap,
      });

      // 学习候选闸门：只有「过关 + 无红线 + 非人设卡」的稿子才进入候选池。
      // 自动稿不会直接参与后续检索；只有教练发布的案例才是当前判断尺子。
      if (report.verdict === "passed" && redlineHits.length === 0 && report.card_type !== "persona") {
        ctx.waitUntil(
          (async () => {
            try {
              const id = await tryAbsorb(env, {
                script: body.script,
                voteGap: body.voteGap,
                report,
                scenario,
              });
              if (id) console.log(`absorb ok: ${id}`);
            } catch (err) {
              console.log(`absorb fail: ${err.message}`);
            }
          })()
        );
      }

      // 日志只记元信息，不记入口码与话术全文（学员内容隐私 + 省日志成本）
      console.log(
        `coach ok: ${Date.now() - startedAt}ms, verdict=${report.verdict}, card=${report.card_type}, ` +
          `cases=${cases.length}, redline=${redlineHits.length}, ` +
          `tokens in=${result.usage.prompt_tokens} out=${result.usage.completion_tokens}`
      );
      return jsonResponse({ ok: true, report, usage: result.usage }, 200, corsHeaders);
    } catch (err) {
      const status = err.status || 500;
      console.log(`coach error: ${Date.now() - startedAt}ms, status=${status}, ${err.message}`);
      return jsonResponse(
        { error: true, message: err.publicMessage || "出错了，请重试" },
        status,
        corsHeaders
      );
    }
  },
};

const GENERIC_TARGET_PATTERN =
  /^(?:大哥|哥哥|小哥哥|帅哥|美女|小美女|靓仔|宝宝|宝贝|宝子|姐姐|小姐姐|大姐|老板|老师|大叔|叔叔|阿姨|哥们|兄弟们?|姐妹们?|老铁|大佬|家人们?|朋友们?|大家|各位|宝宝们?|粉丝们?|观众们?|你们?|我们?|他们?|她们?|它们?|主持|拜托大家|这一轮|这轮|现在|刚才|谢谢|感谢|我是|我想|我还|我刚|我准备|想看|愿意)/u;
const AI_FLAVOR_SOURCE_PHRASES = [
  "怀揣舞台梦想",
  "热爱点亮",
  "每一次投票",
  "梦想的助力",
  "见证奇迹",
  "点燃这个舞台",
  "托举我的梦想",
  "助力梦想",
  "点燃舞台",
  // 作文朗诵型证据：只在模型已判 persona/AI 味时补足原句，不作为词面硬闸。
  "既然站在这里",
  "努力到最后一刻",
  "每一票",
  "每一颗星辰",
  "都能感受到",
  "推着我往前的力量",
  "专门来照亮我的",
  "守护后援第一位成员",
  "好运陪我闯关到底",
  "见证这一刻",
];
const EXPLICIT_BEGGING_SIGNALS = [
  "就当我求你",
  "真的求你",
  "求一求大家",
  "求一求家人",
  "求一求你",
  "求求大家",
  "求求家人",
  "求求你",
  "跪求",
];
const PITY_OR_DEPENDENCY_SIGNALS = [
  "可怜可怜我",
  "可怜我",
  "行行好",
  "全靠你救我",
  "没有你我就完了",
  "没你我就完了",
  "救救我",
];
const SELF_ABASEMENT_SIGNALS = [
  "我给你跪下",
  "给你跪下",
  "给你磕头",
  "施舍我",
  "施舍一票",
  "给你当牛做马",
  "我给你当牛做马",
  "给你当孙子",
  "你让我干什么都行",
];
const BEGGING_REINFORCEMENT_SIGNALS = [
  "帮帮我",
  "不想被淘汰",
  "这轮真的不能走",
  "我真的不能走",
];

function splitHardSentences(value) {
  const matches = String(value || "").match(
    /[^。！？!?；;.]+(?:[。！？!?；;.]+[”’"'）】》]*)?|[。！？!?；;.]+[”’"'）】》]*/gu
  );
  return (matches || []).filter((item) => item.trim().length > 0);
}

const DIRECT_CONTINUATION_PATTERN =
  /^(?:(?:那|这轮|现在|接下来|然后|刚才|主持(?:刚|刚才)?说)[，,\s]*)?(?:你(?!们)|要是你(?!们)|如果你(?!们)|这个(?:新舞|节目|整活)?你(?!们)|这支舞你(?!们)|这段(?:舞|表演|才艺)?你(?!们)|愿不愿意|想不想|要不要|是不是|能不能|可不可以|方便(?:的话)?|请你|麻烦你|帮我|给我|来帮我|再帮我|听我|看一下|别走|我给你|我来给你|我问你|听你的)/u;
const AUDIENCE_SWITCH_PATTERN =
  /^(?:家人们?|朋友们?|大家|各位|宝宝们?|粉丝们?|观众们?|你们|兄弟们?|姐妹们?)(?:[，,:：\s]|$)/u;
const GENERIC_AUDIENCE_THANKS_PATTERN =
  /^(?:先)?(?:谢谢|感谢|多谢)(?:大家|家人们?|朋友们?|各位|宝宝们?|粉丝们?|观众们?|你们|兄弟们?|姐妹们?)/u;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeAnotherAddressee(rawBody, target) {
  const body = String(rawBody || "")
    .replace(/^[，,:：\s]+/u, "")
    .replace(/^(?:刚才|主持(?:刚|刚才)?说|我(?:再)?确认(?:下|一下)?)[，,:：\s]*/u, "")
    .trim();
  if (
    !body ||
    AUDIENCE_SWITCH_PATTERN.test(body) ||
    GENERIC_AUDIENCE_THANKS_PATTERN.test(body)
  ) {
    return Boolean(body);
  }
  if (DIRECT_CONTINUATION_PATTERN.test(body)) return false;

  const other = body.match(
    /^(?:请|让|麻烦)?([\p{L}\p{N}_·-]{1,12}?)(?:你(?!们)|能不能|可不可以|愿不愿意|想不想|来帮我)/u
  )?.[1];
  if (!other) return false;
  return ![String(target || "").trim(), "那", "现在", "这轮", "接下来"].includes(other);
}

function isNaturalNoDelimiterAddress(rawTail) {
  const sentence = String(rawTail || "").split(/[。！？!?；;]/u)[0].trim();
  if (!sentence) return false;

  // 先排除“凯哥刚说/送了/告诉我他……”这类在谈论凯哥的叙述。反问式的
  // “凯哥刚才不是说……吗”仍然是在当面对话，不属于这里。
  if (
    /^(?:(?:刚|刚才|刚刚|之前|当时|已经)?(?:说|讲|表示|提到|送了|刷了|投了|发了|给了)|告诉我(?:他|她|自己)|(?:是|在|成为)(?:榜|直播间))/u.test(
      sentence
    ) &&
    !/^(?:刚才|刚刚)?不是说.{0,20}(?:吗|么|呢|嘛)/u.test(sentence)
  ) {
    return false;
  }

  // 新人常省略呼语后的逗号。这里按“对话语气”识别，而不是限定某几个完整句式：
  // 有一/二人称、请求/命令动词或疑问语气，都说明名字是在被直接呼叫。
  if (/(?:[！？!?]|(?:吗|么|呢|嘛|吧|呀|啊)[。！!?]?$)/u.test(sentence)) return true;
  if (/^.{0,8}(?:你(?!们)|我(?!们)|咱)/u.test(sentence)) return true;
  return /^(?:请|麻烦|帮|给|来|再|先|别|不要|不用|听|看|等|留|走|告诉|问|谢谢|感谢|多谢|现在|这轮|接下来|还差|想看|愿意|要不要|是不是|能否|能不能|可不可以|方便)/u.test(
    sentence
  );
}

function hasAddressedContent(rawTail, target, usedCallingParticle = false) {
  let tail = String(rawTail || "");
  const rawTrimmedTail = tail.trimStart();
  const particle = tail.match(/^\s*(啊|呀|呢|哈|哎|欸|嘛)/u)?.[1] || "";
  if (particle) tail = tail.slice(tail.indexOf(particle) + particle.length);

  const leadingDelimiter = tail.match(/^\s*([，,:：。！？!?；;]*)/u)?.[1] || "";
  tail = tail.replace(/^\s*[，,:：。！？!?；;]*\s*/u, "");
  // 只有一个孤立昵称还没有形成一句对话，不能因为模型猜测就算过关。
  if (!tail) return false;

  // “凯哥刚说……”是在叙述凯哥，不是在叫凯哥；直接呼语可无逗号，但后面通常会接
  // 二人称、自己的回应、感谢、票差或当轮安排。
  if (
    !particle &&
    !leadingDelimiter &&
    !usedCallingParticle &&
    !isNaturalNoDelimiterAddress(rawTrimmedTail)
  ) {
    return false;
  }

  const crossedHardStop = /[。！？!?；;]/u.test(leadingDelimiter);
  const currentSentence = tail.split(/[。！？!?；;]/u)[0].trim();

  // “凯哥。你……”是自然的跨句承接；孤立称呼后若立刻转向群体/别人，则不算。
  if (crossedHardStop) {
    return !looksLikeAnotherAddressee(currentSentence, target);
  }

  // “凯哥，谢谢你……”既是感谢，也确实在对凯哥说话；原子能力允许同一句同时满足两项。
  if (/^(?:先)?(?:谢谢|感谢|多谢)/u.test(currentSentence)) {
    return !GENERIC_AUDIENCE_THANKS_PATTERN.test(currentSentence);
  }

  if (looksLikeAnotherAddressee(currentSentence, target)) return false;

  // 直接呼名后，只要还有一句实际内容，就已经明确在对这个人说话；
  // 动作和票差分别交给 user_reason / vote_instruction，不再偷偷并入这一关。
  return currentSentence.length > 0;
}

function isAttributedTargetMention(sourceScript, targetStart) {
  const prefix = String(sourceScript || "")
    .slice(Math.max(0, targetStart - 28), targetStart)
    .replace(/\s+/g, "");
  const clauses = prefix.split(/[。！？!?；;，,]/u).filter(Boolean);
  const clause = clauses[clauses.length - 1] || "";
  if (
    /^(?:主持|他|她|用户|别人|有人|旁人)(?:刚|刚才)?(?:说|讲|问|提到|表示)[：:“”"']*$/u.test(
      clause
    )
  ) {
    return true;
  }
  return (
    !/^我/u.test(clause) &&
    /^[\p{L}\p{N}_·-]{2,8}(?:刚|刚才)?(?:说|讲|问|提到|表示)[：:“”"']*$/u.test(
      clause
    )
  );
}

function freeModeTargetToken(segment, hasFollowingSegment) {
  const text = String(segment || "")
    .trim()
    .replace(/^(?:那|然后|所以|这轮|这一轮|现在|刚才|刚刚)[，,\s]*/u, "")
    .replace(/^我(?:想|来|再)?(?:问|确认)(?:下|一下)?[，,\s]*/u, "");
  if (!text || GENERIC_TARGET_PATTERN.test(text)) return "";
  if (
    /^(?:(?:刚|刚才|刚刚|之前)?(?:主持|他|她|用户|别人|有人|旁人)|[\p{L}\p{N}_·-]{2,8})(?:刚|刚才)?(?:说|讲|问|提到|表示|告诉(?:我)?)(?:的)?$/u.test(
      text
    )
  ) {
    return "";
  }

  const atTarget = text.match(/^@[\p{L}\p{N}_·-]{1,24}/u)?.[0];
  if (atTarget) return atTarget;

  const rankTarget = text.match(/^榜(?:一|二|三|1|2|3)(?:大哥|哥|姐姐|姐)?/u)?.[0];
  if (rankTarget) return rankTarget;

  const titledTarget = text.match(
    /^[\p{L}\p{N}_·-]{1,10}(?:哥|姐|爷|叔|姨|总|老板|老师)/u
  )?.[0];
  if (titledTarget && !GENERIC_TARGET_PATTERN.test(titledTarget)) return titledTarget;

  // 口语里昵称后经常直接接“你/能不能”，不一定写逗号，也不一定带哥姐后缀。
  const directNickname = text.match(
    /^([\p{L}\p{N}_·-]{1,10}?)(?=你(?!们)|能不能|可不可以|愿不愿意|想不想|要不要|来帮我|帮我)/u
  )?.[1];
  if (directNickname && !GENERIC_TARGET_PATTERN.test(directNickname)) return directNickname;

  // 没有固定后缀的昵称只在“昵称，后续互动”这种直接呼语里接受。
  if (hasFollowingSegment && /^[\p{L}\p{N}_·-]{1,10}$/u.test(text)) return text;
  return "";
}

function hasPostposedDirectAddress(sourceScript, target) {
  const escapedTarget = escapeRegExp(target);
  const targetAtEnd = new RegExp(
    `${escapedTarget}(?!们)(?:啊|呀|呢|哈|嘛|啦)?\\s*[。！？!?；;]*$`,
    "u"
  );
  for (const sentence of splitHardSentences(sourceScript)) {
    const match = sentence.match(targetAtEnd);
    if (!match) continue;
    const targetIndex = sentence.lastIndexOf(target);
    const prefix = sentence.slice(0, targetIndex).replace(/\s+/g, "").replace(/[，,:：]+$/u, "");
    if (!prefix) continue;
    if (
      /^(?:(?:刚|刚才|刚刚|之前)?(?:听|听到))?(?:主持|他|她|用户|别人|有人|旁人|[\p{L}\p{N}_·-]{2,8})(?:刚|刚才)?(?:说|讲|问|提到|表示|告诉)/u.test(
        prefix
      )
    ) {
      continue;
    }
    if (
      /(?:你(?!们)|谢谢你|感谢你|多谢你|想不想|要不要|是不是|愿不愿意|能不能|可不可以|方便吗|帮我|听我|告诉我|[吗么呢嘛][，,]?$|[？?][，,]?$)/u.test(
        prefix
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasConcreteTargetAddress(sourceScript, scenarioTarget = "") {
  const requiredTarget = String(scenarioTarget || "").trim();

  if (requiredTarget) {
    const escapedTarget = escapeRegExp(requiredTarget);
    const source = String(sourceScript || "");
    const postposedThanks = new RegExp(
      `(?:谢谢|感谢|多谢)(?:你)?(?:啊|呀|呢|哈|啦)?[，,\\s]*${escapedTarget}(?!们)(?=$|[。！？!?；;，,:：])`,
      "gu"
    );
    for (const match of source.matchAll(postposedThanks)) {
      const thanksOffset = match[0].search(/(?:谢谢|感谢|多谢)/u);
      const thanksStart = (match.index || 0) + Math.max(0, thanksOffset);
      if (!isAttributedTargetMention(source, thanksStart)) return true;
    }
    if (hasPostposedDirectAddress(source, requiredTarget)) return true;

    const patterns = [
      new RegExp(
        `(?:^|[。！？!?；;，,:：])\\s*(?:(?:那|然后|所以|这轮|这一轮)[，,\\s]*)?${escapedTarget}(?!们)`,
        "gu"
      ),
      new RegExp(
        `(?:^|[。！？!?；;，,:：])\\s*我(?:想|来|再)?(?:问|确认)(?:下|一下)?[，,\\s]*${escapedTarget}(?!们)`,
        "gu"
      ),
    ];

    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const targetOffset = match[0].lastIndexOf(requiredTarget);
        const targetStart = (match.index || 0) + targetOffset;
        if (isAttributedTargetMention(sourceScript, targetStart)) continue;
        const tailStart = (match.index || 0) + targetOffset + requiredTarget.length;
        if (hasAddressedContent(source.slice(tailStart), requiredTarget)) {
          return true;
        }
      }
    }
    return false;
  }

  for (const sentence of splitHardSentences(sourceScript)) {
    const segments = sentence.split(/[，,:：]/u).map((item) => item.trim());
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) continue;

      // “主持说：凯哥，你帮我补一下”是在转述主持，不是主播正对凯哥说话。
      // 自由模式也要看称呼前的说话人，不能因为冒号后恰好是昵称就误判 direct address。
      const precedingSpeaker = segments.slice(0, index).join("").replace(/\s+/g, "");
      if (
        /(?:(?:刚|刚才|刚刚|之前)?(?:主持|他|她|用户|别人|有人|旁人)|[\p{L}\p{N}_·-]{2,8})(?:刚|刚才)?(?:说|讲|问|提到|表示|告诉(?:我)?)(?:的)?$/u.test(
          precedingSpeaker
        )
      ) {
        continue;
      }

      // 已经先直接叫过一个人后，“主持刚说小王你……”常是在顺势转向小王；
      // 只有这种已有对话上下文才去掉主持引语。句首“主持说凯哥……”仍是纯转述。
      const targetSegment =
        index > 0 && /^主持(?:刚|刚才)?说/u.test(segment)
          ? segment.replace(/^主持(?:刚|刚才)?说[，,\s]*/u, "")
          : segment;
      let target = "";
      target = freeModeTargetToken(targetSegment, index < segments.length - 1);
      if (!target) continue;

      const targetIndex = segment.indexOf(target);
      const body = [
        segment.slice(targetIndex >= 0 ? targetIndex + target.length : target.length),
        ...segments.slice(index + 1),
      ].join("，");
      if (hasAddressedContent(body, target)) return true;
    }
  }
  return false;
}

function hasNegatingPrefix(sourceScript, index) {
  const prefix = String(sourceScript || "")
    .slice(Math.max(0, index - 16), index)
    .replace(/\s+/g, "");
  const modifiers = "(?:再|去|会|要|想|真的|继续|在|说|讲){0,3}";
  const negationCue =
    "(?:不|没|未|别|不要|不用|无需|不必|不能|不该|并不|绝不|从不|从来不|从没|从来没|没有|并没有|才不|不会|才不会|不是|不是在|不想|没必要|没有必要|不需要)";
  const negatingTail = new RegExp(`${negationCue}${modifiers}(?:我|自己|主播)?$`, "u");
  // “不得不/不能不”等本身是双重否定；但若外层是“不会说不得不……”，
  // 外层否定仍支配整段被提及的话，不能只看离信号最近的“不”。
  const doubleNegative = prefix.match(
    new RegExp(`(?:不得不|不能不|不是不|不会不|并非不|没有不|未尝不|无不)${modifiers}$`, "u")
  );
  if (doubleNegative) {
    const outerPrefix = prefix.slice(0, doubleNegative.index);
    return negatingTail.test(outerPrefix);
  }
  return negatingTail.test(prefix);
}

function hasUnnegatedSignal(sourceScript, term) {
  let fromIndex = 0;
  while (fromIndex < sourceScript.length) {
    const index = sourceScript.indexOf(term, fromIndex);
    if (index < 0) return false;
    if (!hasNegatingPrefix(sourceScript, index)) return true;
    fromIndex = index + term.length;
  }
  return false;
}

function withoutAttributedQuotedText(value) {
  const source = String(value || "");
  const quotePattern = /“([^”]*)”|"([^"]*)"|‘([^’]*)’|'([^']*)'|「([^」]*)」|『([^』]*)』/gu;
  let result = "";
  let cursor = 0;
  for (const match of source.matchAll(quotePattern)) {
    const index = match.index || 0;
    result += source.slice(cursor, index);
    const content = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? "";
    const prefix = source.slice(Math.max(0, index - 24), index).replace(/\s+/g, "");
    const suffix = source
      .slice(index + match[0].length, index + match[0].length + 18)
      .replace(/\s+/g, "");
    const currentSpeakerAddressingSomeone =
      /(?:跟|对|向|和|给|同|冲)(?:你|他|她|主持|观众|用户|家人|大哥|[\p{L}\p{N}_·-]{1,10}(?:哥|姐|总|老板|老师))(?:刚|刚才|之前|当时)?(?:说|讲|问)(?:的|过|是|了|那句|这句)*$/u.test(
        prefix
      );
    const attributedToSomeoneElse =
      (!currentSpeakerAddressingSomeone &&
        /(?:你|他|她|主持|观众|用户|家人|大哥|[\p{L}\p{N}_·-]{1,10}(?:哥|姐|总|老板|老师))(?:刚|刚才|之前|当时)?(?:(?:说|问|写|发|刷|提过|讲过)(?:的|过|是|了|那句|这句)*|(?:的)?(?:原话|那句|这句))$/u.test(
          prefix
        )) ||
      /(?:引用|原话|比如|例如|举例|(?:别|不要|不能|不该)(?:再)?(?:说|讲))(?:是|了|这句|那句)*$/u.test(
        prefix
      ) ||
      /^(?:这|那)(?:几|三|两|两个)?个字|^(?:才|这才)(?:算|是)/u.test(suffix);
    result += attributedToSomeoneElse ? " " : content;
    cursor = index + match[0].length;
  }
  return result + source.slice(cursor);
}

function firstUnnegatedSignal(sourceScript, terms) {
  return terms.find((term) => hasUnnegatedSignal(sourceScript, term)) || "";
}

function firstSelfAbasementSignal(sourceScript) {
  const fixedSignal = firstUnnegatedSignal(sourceScript, SELF_ABASEMENT_SIGNALS);
  if (fixedSignal) return fixedSignal;

  // “我不配”是明确自贬，但“我不配合……”里的“不配”只是“不合作”的词内重合。
  for (const match of String(sourceScript || "").matchAll(/我不配(?!合)/gu)) {
    if (!hasNegatingPrefix(sourceScript, match.index || 0)) return match[0];
  }
  return "";
}

const VIEWER_CONTENT_PATTERN =
  /(?:撒娇|撒一个|撒个娇|新舞|返场|跳完|跳舞|舞蹈|才艺|表演|整活|节目|唱歌|点歌|点舞|复活后的兑现)/u;
const INTRODUCED_CONTENT_ADVICE_PATTERN =
  /(?:撒个?娇|返场|跳(?:一支|一段|个)?(?:舞|舞蹈)|才艺|表演|整活|节目|唱(?:一首|首)?歌|点歌|点舞|解锁(?:舞|节目|才艺)|做什么.{0,8}(?:马上|立刻|当场)安排)/u;
const VIEWER_SUBJECT_SOURCE =
  "(?:你(?!们)|家人们?|大家|榜(?:一|二|三|1|2|3)|@[\\p{L}\\p{N}_·-]+|[\\p{L}\\p{N}_·-]{1,8}(?:哥|姐))";
const PURE_HOST_NEED_PATTERN =
  /(?:我(?:真的)?(?:想|要|需要)(?:留下|复活|晋级|票)|我不想(?:走|被淘汰|淘汰)|帮帮我|帮我(?:补|上|投|冲|组|丢)|救救我|可怜我|还差\s*(?:\d+|[零〇一二两三四五六七八九十百千万]+)\s*票)/u;

function hasClearlyNegatedViewerValue(sentence) {
  const text = String(sentence || "").replace(/\s+/g, "");
  if (!text) return false;

  const interactiveQuestion = new RegExp(
    `${VIEWER_SUBJECT_SOURCE}.{0,4}(?:想不想|愿不愿意|要不要)看`,
    "u"
  ).test(text);
  const negativeViewing = new RegExp(
    `${VIEWER_SUBJECT_SOURCE}.{0,4}(?:(?:并不|不太|不怎么|不|没)(?:想|愿意|喜欢)?看|(?:没|没有|未)说(?:过)?(?:想|愿意|喜欢)?看)`,
    "u"
  ).test(text);
  if (negativeViewing && !interactiveQuestion) return true;

  if (
    /(?:不|别|没|未|并不|不会|不想|不要)(?:再|给你|来|去)?(?:撒娇|撒一个|撒个娇|返场|跳(?!过)|跳舞|跳完|表演|整活|兑现|安排)/u.test(
      text
    )
  ) {
    return true;
  }
  if (
    /(?:想看|愿意看|喜欢看).{0,16}(?:但|可是|不过|可我).{0,8}(?:不行|不跳|不演|不唱|不给看|算了)/u.test(
      text
    )
  ) {
    return true;
  }
  return /(?:想看|愿意看|喜欢看).{0,16}(?:我决定不|我不(?:跳|演|唱)|不给你看)/u.test(text);
}

function hasIntroducedContentAdvice(advice, sourceScript) {
  return (
    !VIEWER_CONTENT_PATTERN.test(String(sourceScript || "")) &&
    INTRODUCED_CONTENT_ADVICE_PATTERN.test(String(advice || ""))
  );
}

function feedbackLedAdvice(ticketProgressSummary) {
  if (/暂未看到新的票差变化/u.test(String(ticketProgressSummary || ""))) {
    return {
      nextMove:
        "这一拍的票差暂时没再动；下一拍换一个人性支点，把带头、选择或共同闯关的位置递给仍在观望的人，再看有没有新反馈。",
      examples: [
        "刚才有人带头了，剩下还在看的家人，谁愿意接下一脚？",
        "这一拍先不重复喊，你们想换个人带头，还是一起把这一关收掉？",
      ],
    };
  }
  if (ticketProgressSummary) {
    return {
      nextMove:
        "票差已经在动；下一拍先具体接住刚才的有效反馈，再沿着已经生效的人性驱动，把参与位置递给仍在观望的人。",
      examples: [
        "刚才这一手我看见了，你让这轮真的往前走了。",
        "还有谁愿意接下一脚，跟我们一起把这一关走完？",
      ],
    };
  }
  return {
    nextMove:
      "下一拍先观察当前对象的真实反应，再决定强化同一驱动、换对象还是换角度，不默认另造内容交换。",
    examples: [
      "刚才这一拍你们接到了吗？接到的家人给我一个信号。",
      "谁愿意来带这一脚，我们一起看看这一轮怎么走？",
    ],
  };
}

function positiveClauseAfterNegation(sentence) {
  const text = String(sentence || "");
  const contrasts = Array.from(text.matchAll(/(?:但(?:是)?|不过|可是|可(?=我|现在|马上|这就|复活))/gu));
  if (contrasts.length) {
    const last = contrasts[contrasts.length - 1];
    return text.slice((last.index || 0) + last[0].length).replace(/^[，,:：\s]+/u, "");
  }

  // 直播口语经常省略“但是”：“我不返场，给你撒个娇吧”。只要后一个
  // 逗号分句不再是否定，就继续核对它有没有真实的正向替代。
  const clauses = text.split(/[，,:：]/u).map((item) => item.trim()).filter(Boolean);
  for (let index = 1; index < clauses.length; index += 1) {
    const candidate = clauses.slice(index).join("，");
    if (!hasClearlyNegatedViewerValue(candidate)) return candidate;
  }
  return "";
}

function isNegatedScenarioViewerSignal(signal) {
  const text = String(signal || "").replace(/\s+/g, "");
  if (!text) return false;
  // “你不是说想看……吗”是确认正向意愿，不按字面上的“不”处理。
  if (/(?:不是说|没说过?).{0,10}(?:想看|要看|喜欢看).{0,10}(?:吗|么|呢|嘛|？|\?)/u.test(text)) {
    return false;
  }
  return new RegExp(
    `(?:不想|不愿意?|不要|不用|不必|无需|无须|不需要|用不着|不喜欢|不想听|不想看|别|没想|没有想|没说|没有说|未说).{0,10}${VIEWER_CONTENT_PATTERN.source}`,
    "u"
  ).test(text);
}

function isAttributedViewerInterest(sentence) {
  const text = String(sentence || "").replace(/\s+/g, "");
  if (!text) return false;
  const viewingCue = "(?:想看|愿意看|喜欢看|要看)";
  const directHostQuestion = new RegExp(
    `^我(?:想|来|再)?问(?:下|一下)?${VIEWER_SUBJECT_SOURCE}[，,:：]你(?!们).{0,10}(?:想不想看|愿不愿意看|要不要看|想看|愿意看|喜欢看)`,
    "u"
  );
  if (directHostQuestion.test(text)) return false;
  const narratorFirst = new RegExp(
    `^(?:刚|刚才|刚刚|之前)?(?:听|听到)?(?:主持|他|她|用户|别人|有人|旁人|我|[\\p{L}\\p{N}_·-]{2,8})(?:刚|刚才)?(?:说|讲|问|提到|表示|告诉我)[：:,，]?${VIEWER_SUBJECT_SOURCE}.{0,12}${viewingCue}`,
    "u"
  );
  const viewerSelfReport = new RegExp(
    `^${VIEWER_SUBJECT_SOURCE}(?:刚|刚才)?(?:说|讲|表示)(?:他|她|自己)?${viewingCue}`,
    "u"
  );
  const heardViewerSelfReport = new RegExp(
    `^(?:刚|刚才|刚刚|之前)?(?:听|听到)${VIEWER_SUBJECT_SOURCE}(?:说|讲|表示)(?:他|她|自己)?${viewingCue}`,
    "u"
  );
  return narratorFirst.test(text) || viewerSelfReport.test(text) || heardViewerSelfReport.test(text);
}

/**
 * 识别“才艺/选择权”之外的用户参与理由。
 *
 * 这里刻意要求至少两类相互印证的上下文（真实处境或共同经历 + 用户可自主
 * 接住的角色/明确回馈），而不是见到“保护、家人、谢谢”这类表面词就贴标签。
 * 这样既不会把纯粹的“我好难、我不想下去”洗成保护欲，也不会让旧的
 * PURE_HOST_NEED_PATTERN 把真正的保护、归属、互惠与共同闯关误压成 partial。
 */
function detectContextualHumanReason(sourceScript) {
  const text = withoutAttributedQuotedText(String(sourceScript || "")).replace(/\s+/g, "");
  if (!text) return { state: "unknown", evidence: "" };

  const voluntaryCue =
    /(?:你愿意|愿不愿意|如果你愿意|你要是愿意|能不能|可不可以|可以吗|好吗|要不要|你来|交给你|听你的|帮我|陪我|咱们|我们一起|一起)/u;

  const realProtectionContext =
    /(?:第一次|新人|刚上(?:麦|十连|台)|手(?:还在)?抖|紧张|最后一轮|临门一脚|守位|快掉下去|差一脚|十连)/u;
  const protectionRole =
    /(?:托住|接住|守住|保住|护住|带我过|陪我(?:把|将)?(?:这|最后)?(?:一轮)?(?:走完|守完)|一起(?:走完|守住|过关))/u;
  if (realProtectionContext.test(text) && protectionRole.test(text) && voluntaryCue.test(text)) {
    return {
      state: "met",
      evidence: "真实处境给了对方一个可自主接住的守护位置",
    };
  }

  const sharedHistory =
    /(?:陪我|跟我|和我|咱们|我们).{0,16}(?:守过|走过|闯过|过了|拿过|打过|前面|上一轮|这么久|一路)|(?:前面|上一轮|前几轮).{0,12}(?:一起|陪我|跟我|咱们|我们)/u;
  const sharedNextStep =
    /(?:这轮|这一轮|接下来|最后一轮).{0,16}(?:咱们|我们|一起|继续).{0,12}(?:走完|守住|过关|拿下|闯|打完)|(?:咱们|我们|一起|继续).{0,16}(?:走完|守住|过关|拿下|闯完|打完)/u;
  if (sharedHistory.test(text) && sharedNextStep.test(text) && voluntaryCue.test(text)) {
    return {
      state: "met",
      evidence: "共同经历把这一拍变成双方继续完成同一轮",
    };
  }

  const seenConcreteSupport =
    /(?:你|@[\p{L}\p{N}_·-]+|[\p{L}\p{N}_·-]{1,8}(?:哥|姐|总|老板|老师)).{0,16}(?:刚才|刚刚|上一手|那一手|前面).{0,12}(?:支持|补|投|组|送|守|陪)|(?:刚才|刚刚|上一手|那一手|前面).{0,16}(?:支持|补|投|组|送|守|陪).{0,12}(?:我看见|我接住|我记得|没漏掉)/u;
  const concreteReturn =
    /(?:我看见|我接住|我记得|没漏掉).{0,24}(?:马上|当场|现在|这一轮).{0,18}(?:点名|回应|接回来|谢|兑现|安排)|(?:马上|当场|现在).{0,18}(?:点名|回应|接回来|兑现).{0,14}(?:你|支持|这一手)/u;
  if (seenConcreteSupport.test(text) && concreteReturn.test(text) && voluntaryCue.test(text)) {
    return {
      state: "met",
      evidence: "已经看见对方的具体付出，并给出即时可兑现的回应",
    };
  }

  const recognizedRole =
    /(?:你来拍板|你说了算|这一轮听你的|交给你定|就差你来定|你来决定|你来带队)/u;
  const liveSituation = /(?:这轮|这一轮|现在|接下来|榜上|守位|十连|过关|怎么打)/u;
  if (recognizedRole.test(text) && liveSituation.test(text)) {
    return {
      state: "met",
      evidence: "把现场决定权和被看见的位置交给了对方",
    };
  }

  return { state: "unknown", evidence: "" };
}

/**
 * 把模型已经完成的“证据 → 人性机制”判断接回 user_reason，避免报告自相矛盾：
 * 一边说归属/互惠/共同闯关在驱动参与，一边又把理由判 missing。
 * urgency 只能说明“为什么现在”，不能单独回答“为什么参与”。保护欲另加一层
 * 关系/角色校验，防止纯“我好难”被一个 protection 标签洗白。
 */
function groundedHumanDriverReason(roundDynamics, sourceScript, scenario) {
  const drivers = Array.isArray(roundDynamics?.human_drivers)
    ? roundDynamics.human_drivers
    : [];
  const surfaceLabels = /(?:保护欲|存在感|归属感|从众|互惠|紧迫感|好奇心|掌控感)/gu;
  const evidenceSource = [String(sourceScript || ""), scenarioEvidenceText(scenario)]
    .join("")
    .replace(/[\s\p{P}]+/gu, "");

  const isAnchoredInFacts = (evidence) => {
    if (!evidenceSource) return false;
    const compactEvidence = evidence.replace(/[\s\p{P}]+/gu, "");
    for (let index = 0; index <= compactEvidence.length - 4; index += 1) {
      if (evidenceSource.includes(compactEvidence.slice(index, index + 4))) return true;
    }
    return false;
  };

  for (const item of drivers) {
    if (!item || typeof item !== "object" || item.driver === "urgency") continue;
    const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    const mechanism = typeof item.mechanism === "string" ? item.mechanism.trim() : "";
    if (!evidence || !mechanism) continue;
    if (!isAnchoredInFacts(evidence)) continue;

    // 只把心理名词抄进 evidence 不是现场证据。
    const factualRemainder = evidence
      .replace(surfaceLabels, "")
      .replace(/[\s、，,。；;：:（）()“”"'·/-]+/gu, "");
    if (factualRemainder.length < 4) continue;

    if (item.driver === "protection") {
      const relationalContext =
        /(?:你|哥|姐|总|老板|老朋友|家人|一起|咱们|我们|守|托|接|陪|帮|最后一轮|临门一脚|十连)/u.test(
          `${evidence}${mechanism}`
        );
      const actionableRole =
        /(?:位置|角色|守住|托住|接住|陪着|一起|共同|参与|行动|出手|自主|愿意)/u.test(
          mechanism
        );
      if (!relationalContext || !actionableRole) continue;
    }

    return { driver: item.driver, evidence };
  }
  return null;
}

function detectViewerReason(sourceScript, scenario = null) {
  const unquotedScript = withoutAttributedQuotedText(sourceScript);
  const contextualHumanReason = detectContextualHumanReason(unquotedScript);
  const scenarioSignal = typeof scenario?.userSignal === "string"
    ? scenario.userSignal.trim()
    : "";
  const scenarioSignalIsNegated = isNegatedScenarioViewerSignal(scenarioSignal);
  const scenarioWantsCoquetry =
    !scenarioSignalIsNegated && /(?:想看|要看|喜欢看)?.{0,4}撒娇/u.test(scenarioSignal);
  const scenarioHasViewerContent =
    !scenarioSignalIsNegated && VIEWER_CONTENT_PATTERN.test(scenarioSignal);
  let sawInvalidValue = false;

  for (const rawSentence of splitHardSentences(unquotedScript)) {
    const sentence = rawSentence.replace(/\s+/g, "");
    if (!sentence) continue;
    let candidateSentence = sentence;
    if (hasClearlyNegatedViewerValue(sentence)) {
      sawInvalidValue = true;
      candidateSentence = positiveClauseAfterNegation(sentence);
      // “不返场，但现在撒个娇”仍给了一个真实替代；只有后半句也是否定或没有
      // 正向内容时，才把整句当作无效理由。
      if (!candidateSentence || hasClearlyNegatedViewerValue(candidateSentence)) continue;
    }

    if (isAttributedViewerInterest(candidateSentence)) {
      sawInvalidValue = true;
      continue;
    }

    const viewingInterest = new RegExp(
      `${VIEWER_SUBJECT_SOURCE}.{0,12}(?:想不想看|愿不愿意看|要不要看|想看|愿意看|喜欢看).{0,16}${VIEWER_CONTENT_PATTERN.source}`,
      "u"
    );
    if (viewingInterest.test(candidateSentence)) {
      return { state: "met", evidence: "已经接住对方想看的内容" };
    }

    const contentOffer = new RegExp(
      `(?:那我|现在我|我现在|我马上|我这就|这就|马上|待会我|复活后我).{0,8}(?:撒娇|撒一个|撒个娇|返场|跳(?:完|舞|个|一段|一支)|唱歌|表演|整活)|${VIEWER_CONTENT_PATTERN.source}.{0,10}(?:给你看|给你安排|我来一个|我走一个|马上来|这就来)|(?:给你|让你|陪你).{0,8}(?:撒娇|撒一个|撒个娇|新舞|返场|跳(?:完|舞|个|一段|一支)|唱歌|表演|整活)`,
      "u"
    );
    if (/跳票/u.test(candidateSentence)) {
      sawInvalidValue = true;
      continue;
    }
    if (contentOffer.test(candidateSentence)) {
      return { state: "met", evidence: "已经给了对方可以看的内容" };
    }
    if (
      scenarioWantsCoquetry &&
      /(?:(?:那我|我)?(?:现在|马上|这就).{0,4}(?:来|走)(?:一个|个|一下)?(?:了|啦|吧)?[。！？!?]*$|(?:我|那我).{0,6}撒(?:娇|一个|个|一下))/u.test(
        candidateSentence
      )
    ) {
      return { state: "met", evidence: "已经接住对方想看撒娇的信号" };
    }

    const vaguePerformanceResponse =
      /(?:那我|我)?(?:现在|马上|这就).{0,5}(?:来|走)(?:一个|一下)?/u;
    const genericArrangementMention =
      /(?:那我|我)(?:现在|马上|这就)?.{0,3}(?:给你安排|给你看)/u;
    const genericArrangementResolved =
      /(?:那我|我)(?:现在|马上|这就)?.{0,3}(?:给你安排|给你看)(?:一下|一个|上|好|了|啦|吧|呀|啊|哈)?[。！？!?]*$/u;
    const voteOnlyResponse =
      /(?:补票|上票|投票|票差|还差|多少票|几票|票数|补一脚|跟一点|组一组|任务|按钮)/u;
    if (vaguePerformanceResponse.test(candidateSentence)) {
      const resolvedPerformance =
        /(?:那我|我)?(?:现在|马上|这就).{0,5}(?:来|走)(?:一个|一下)?(?:了|啦|吧)?[。！？!?]*$/u.test(
          candidateSentence
        );
      if (scenarioHasViewerContent && resolvedPerformance && !voteOnlyResponse.test(candidateSentence)) {
        return { state: "met", evidence: "已经用现场信号说明了要给对方的回应" };
      }
      sawInvalidValue = true;
      continue;
    }
    if (genericArrangementMention.test(candidateSentence)) {
      if (
        scenarioHasViewerContent &&
        genericArrangementResolved.test(candidateSentence) &&
        !voteOnlyResponse.test(candidateSentence)
      ) {
        return { state: "met", evidence: "已经用现场信号说明了要给对方的回应" };
      }
      sawInvalidValue = true;
      continue;
    }

    if (
      /(?:你(?:来)?(?:选|挑|点(?:舞|歌|节目)|当导演)|你说了算|听你的|(?:由|让)你(?:来)?(?:选|决定|当导演)|交给你(?:来)?定|你定(?:吧|呀|啊|哪个|哪一个|节目|舞|歌|了|一下|，|,|。|$)|你(?:愿意)?(?:上|补|投)(?:多少|几张|几票).{0,6}(?:看着来|你定|随你))/u.test(
        candidateSentence
      )
    ) {
      return { state: "met", evidence: "已经把选择权交给对方" };
    }

    if (
      /(?:逗你|哄你|让你).{0,4}(?:笑|开心|乐)|给你看个乐|(?:好玩|有意思|满意|喜欢).{0,8}(?:你再|你就|再决定|再说)|你觉得.{0,10}(?:好玩|有意思|怎么样)/u.test(
        candidateSentence
      )
    ) {
      return { state: "met", evidence: "已经给了对方观看或互动的乐趣" };
    }

    if (
      /复活(?:后|了|回来).{0,18}(?:给你|我就|马上|一定|兑现|安排|撒娇|撒一个|返场|跳|唱|表演|整活|点舞|点歌)|(?:答应你|给你兑现|说到做到).{0,12}(?:撒娇|返场|跳|唱|表演|整活|节目)/u.test(
        candidateSentence
      )
    ) {
      return { state: "met", evidence: "已经给了对方复活后的兑现" };
    }

    if (/(?:不由你|轮不到你|不听你的|不让你选)/u.test(candidateSentence)) {
      sawInvalidValue = true;
    }
  }

  // 强上下文的人性机制也是用户为什么愿意参与的理由。它不是用 driver 标签
  // 反推出来的，而是直接由原话中的共同经历、可自主角色和具体回馈相互印证。
  if (contextualHumanReason.state === "met") return contextualHumanReason;
  if (sawInvalidValue) {
    return { state: "invalid", evidence: "提到了互动内容，但还没有形成给对方的明确正向理由" };
  }
  if (PURE_HOST_NEED_PATTERN.test(unquotedScript)) {
    return { state: "invalid", evidence: "现在说的是自己的需要，还没给对方观看或参与的理由" };
  }
  return { state: "unknown", evidence: "" };
}

/**
 * 只核对主播有没有递出观众当下能执行的要票动作。
 * 当前差额是现场反馈，不再是毕业门槛：同一轮从 20 降到 8、再降到 5，
 * 说明请求正在得到响应，而不是数字互相矛盾。
 */
function hasExplicitVoteInstruction(sourceScript) {
  const source = withoutAttributedQuotedText(String(sourceScript || ""));
  const directAction =
    /(?:补(?:一补|一脚|一下|一点|一些|(?:一|两|几)(?:张|票|手|个|份)|上|齐|票)|跟(?:上一点|一下|一脚|上)|上(?:多少|一票|几票|几张|一张|一点|点票|票)|投(?:一票|几票|一下|一点|点票|票)|组(?:一组|一下|一手|一个|两个|几组|几个)|认(?:一手|一份|一下|一个|几个|领(?:一手|一份|一下|一个|几个)?)|抓(?:一下|一手|一份|一个|最后一(?:手|份|个))|加(?:一|两|几)(?:个|手|份)|抹(?:个|一下)?零|接(?:一下|一半|半手|半个)|丢(?:一丢|一下|一点|几张|几票)|刷(?:一票|一下|一点|几张|几票)|送(?:一颗|一个|一张|一点)|助力(?:一下|一把)?|搭把手|帮(?:我)?一把)/u;
  const distributedAction =
    /(?:一人|每人|一个人)(?:来|上|投|补|组|送|刷|丢)?(?:一|两|几)?(?:个|颗|张|票|手|组)/u;
  const requestCue =
    /(?:帮(?:我|忙)?|给我|替我|能不能|可不可以|方便的话|麻烦|请|来|再|继续|谁来|谁能|有没有|大家|家人们?|哥哥姐姐|好哥哥|好姐姐)/u;
  const completedPastAction =
    /(?:刚|刚才|刚刚|已经|刚送|送出).{0,12}(?:上了|投了|补了|组了|认了|认一(?:个|手)|抓了|抓一下|加了|加一(?:个|手)|抹了|抹零|接了|丢了|刷了|送了|助力了)/u;

  for (const sentence of splitHardSentences(source)) {
    const compact = stripNegatedCurrentActions(sentence.replace(/\s+/g, ""));
    if (!compact) continue;
    if (distributedAction.test(compact)) return true;
    if (!directAction.test(compact)) continue;
    // “谢谢你刚刚上了一票”是在读过去反馈；除非同句又明确递出“再/继续/帮我”等下一拍。
    if (completedPastAction.test(compact) && !requestCue.test(compact)) continue;
    return true;
  }
  return false;
}

/** 去掉明确被否定的动作片段，同时保留同句后半段真实的新动作。 */
function stripNegatedCurrentActions(value) {
  return String(value || "")
    .replace(
      /(?:先)?(?:不用|不要|别|无需|无须|不必|不再|不用再|别再)(?:去|找人|让人|继续|再|马上|现在|直接|提前|急着){0,3}(?:拉票|要票|上票|投票|补(?:位|一脚|一下|一点|一个|一手)?|组(?:一个|一手|一下)?|认(?:领|一个|一手|一下)?|抓(?:一下|一个|一手)?|加(?:一个|一手|一下)?|抹(?:个|一下)?零|接(?:一半|半手|半个)?|丢|送|上)/gu,
      " "
    )
    .replace(/(?:先)?(?:别|不要|不用|无需|不必|不急着|别急着)(?:马上|现在|直接|提前|急着){0,2}(?:丢|送|上)/gu, " ")
    .replace(/\s+/g, "");
}

/** 组满未发令时的正确动作是等主持，而不是主播自己发令。 */
function hasDeliveryCoordinationInstruction(sourceScript) {
  const source = withoutAttributedQuotedText(String(sourceScript || ""));
  const compact = source.replace(/\s+/g, "");
  const waitForHost =
    /(?:(?:先)?别|不要|不急着|别急着).{0,12}(?:提前)?(?:丢|送|上).{0,20}(?:等|听|按).{0,8}主持.{0,10}(?:口令|喊|说|发令)|(?:等|听|按).{0,8}主持.{0,10}(?:口令|喊|说|发令).{0,12}(?:再|一起|统一)?(?:丢|送|上)/u;
  const holdForHostCue =
    /(?:先)?(?:等|听|按).{0,8}主持.{0,10}(?:统一)?(?:口令|喊|说|发令)(?:再行动|就行|即可|为准)?/u;
  return waitForHost.test(compact) || holdForHostCue.test(compact);
}

/** 主持已经发令后的正确动作：按原认领兑现、核对实际到账并接住参与。 */
function hasDeliveryExecutionInstruction(sourceScript) {
  const compact = withoutAttributedQuotedText(String(sourceScript || "")).replace(/\s+/g, "");
  const fulfillExisting =
    /(?:按|照).{0,8}(?:刚才|之前|各自|大家)?(?:约定|认领).{0,12}(?:丢|送|上|兑现)|(?:刚才|之前)(?:认|组).{0,12}(?:现在|一起|统一)?(?:丢|送|上|兑现)/u;
  const acknowledgeArrival =
    /(?:谢谢|感谢|收到|收到了|到账|接住).{0,24}(?:大家|你们|哥哥|姐姐|哥|姐|认领|礼物|出手|这(?:一|几|些|个|手))|(?:大家|你们|哥哥|姐姐|哥|姐).{0,12}(?:谢谢|感谢|收到|接住)/u;
  return fulfillExisting.test(compact) || acknowledgeArrival.test(compact);
}

/** 结果落地后的正确动作是确认共同结果、感谢并承接关系。 */
function hasResultConnectionInstruction(sourceScript) {
  const compact = withoutAttributedQuotedText(String(sourceScript || "")).replace(/\s+/g, "");
  return /(?:谢谢|感谢).{0,24}(?:大家|你们|哥哥|姐姐|哥|姐|出手|礼物|一起)|(?:这轮|这一关|复活|拿下).{0,20}(?:大家|你们|我们|咱们|一起).{0,12}(?:完成|拿下|赢|抬|救|守)|(?:我都记住|我记住了|我接住了|不会让你们白上|没让你们白上)/u.test(compact);
}

/** 组满后仍寻找新认领人，会破坏已形成的兑现阶段。 */
function hasNewClaimPressure(sourceScript) {
  const extraClaim =
    /(?:还差.{0,12}(?:谁|有没有|再)|(?:谁来|谁能|有没有人|(?:还有|有)?谁(?:愿意|可以|想|能|来)?).{0,12})(?:补|组|认领|认一|抓|加|上|投|抹|接)|(?:继续|再来|还要).{0,8}(?:拉|要|组|认领|认一|抓|补|加|抹|接)|(?:愿不愿意|是否愿意|要不要|能不能).{0,12}(?:补位|再补|认领|认一|抓|加一个|加一手|再上|抹零|接一半)|(?:我|那我)(?:来|再|也)?(?:认一(?:个|手|份)|抓一下|抓最后一(?:个|手|份)|加一(?:个|手|份)|抹(?:个)?零|接一半)|(?:再|继续)(?:认一(?:个|手|份)|抓一下|抓最后一(?:个|手|份)|加一(?:个|手|份)|抹(?:个)?零|接一半)|(?:帮我|麻烦|来)(?:补|组|认|抓|加|抹|接).{0,8}|(?:加一(?:个|手|份)|认一(?:个|手|份)|抓一下|抹(?:个)?零|接一半)(?:吧|呀|啊)?$/u;
  return splitHardSentences(withoutAttributedQuotedText(String(sourceScript || ""))).some((sentence) => {
    const compact = stripNegatedCurrentActions(sentence.replace(/\s+/g, ""));
    return Boolean(compact && extraClaim.test(compact));
  });
}

/** 主持发令前催提前兑现或主播抢发口令，同样是阶段冲突。 */
function hasPrematureDeliveryPressure(sourceScript) {
  const prematureDelivery =
    /(?:现在|赶紧|马上|直接|先|提前).{0,8}(?:丢|送|上)(?:出来|出去|礼物|票)?|(?:不用|不要|别).{0,8}(?:等|听|按).{0,8}主持.{0,12}(?:丢|送|上)|(?:我来|听我的|我喊|我说).{0,8}(?:那就丢|一起丢|统一丢)|(?:那就|可以|开始)(?:一起|统一)?(?:丢|送|上)|(?:大家|你们|咱们|都)(?:赶紧|马上|现在|直接|就|一起|统一){1,3}(?:丢|送|上)|(?:按|照)(?:(?!主持).){0,8}(?:约定|认领)(?:(?!主持).){0,10}(?:一起|统一)?(?:丢|送|上)/u;
  const completedPastAction =
    /(?:刚|刚才|刚刚|已经|刚送|送出|到账).{0,12}(?:丢了|送了|上了|送出|到账)/u;
  return splitHardSentences(withoutAttributedQuotedText(String(sourceScript || ""))).some((sentence) => {
    let compact = stripNegatedCurrentActions(sentence.replace(/\s+/g, ""));
    if (!compact) return false;
    compact = compact.replace(completedPastAction, "");
    return prematureDelivery.test(compact);
  });
}

function hasAdditionalClaimPressure(sourceScript) {
  return hasNewClaimPressure(sourceScript) || hasPrematureDeliveryPressure(sourceScript);
}

function hasCurrentPhaseInstruction(sourceScript, phase) {
  if (phase === "awaiting_drop") return hasDeliveryCoordinationInstruction(sourceScript);
  if (phase === "delivery") return hasDeliveryExecutionInstruction(sourceScript);
  if (phase === "result" || phase === "post_round") return hasResultConnectionInstruction(sourceScript);
  return hasExplicitVoteInstruction(sourceScript);
}

function parseSpokenCount(token) {
  const value = String(token || "").trim();
  if (/^\d+$/u.test(value)) return Number(value);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (Object.prototype.hasOwnProperty.call(digits, value)) return digits[value];

  let total = 0;
  let current = 0;
  for (const character of value) {
    if (Object.prototype.hasOwnProperty.call(digits, character)) {
      current = digits[character];
    } else if (character === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (character === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else if (character === "千") {
      total += (current || 1) * 1000;
      current = 0;
    } else {
      return null;
    }
  }
  return total + current;
}

/**
 * 票差是时间轴反馈，不是模型可以自由发挥的心理判断。
 * 例如 20→18 只能说明期间确认收到 2 个；17→15→15 说明先收到 2 个，
 * 随后暂时没有新变化，绝不能写成“前两拍各收到 2 个”。
 */
function summarizeTicketProgress(sourceScript) {
  const observations = [];
  const pattern =
    /(?:还(?:需|差)|差|要(?:啦|拉|拿)?)(?:最后)?\s*(\d{1,8}|[零〇一二两三四五六七八九十百千]{1,8})\s*(?:个|颗|手|票|张|组|星辰)?/gu;
  for (const match of String(sourceScript || "").matchAll(pattern)) {
    const count = parseSpokenCount(match[1]);
    if (Number.isFinite(count)) observations.push({ raw: match[1], count });
  }
  if (observations.length < 2) return "";

  const changes = [];
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    if (current.count < previous.count) {
      changes.push(
        `从${previous.raw}降到${current.raw}，确认这期间收到${previous.count - current.count}个上票反馈`
      );
    } else if (current.count === previous.count) {
      changes.push(`随后仍是${current.raw}，暂未看到新的票差变化`);
    } else {
      changes.push(
        `从${previous.raw}变为${current.raw}，可能发生换轮或重置，需要结合现场确认`
      );
    }
  }
  return `票差按原稿${changes.join("；")}。`;
}

function hasSpecificScenarioGratitude(sourceScript, scenario) {
  const target = typeof scenario?.targetUser === "string" ? scenario.targetUser.trim() : "";
  const recentGift = typeof scenario?.recentGift === "string" ? scenario.recentGift.trim() : "";
  if (!recentGift) return true;

  const giftCue = recentGift
    .replaceAll(target, "")
    .replace(/(?:刚才|刚刚|刚|送给|送了|送的|送来|刷了|刷的|投了|给了|一份|一个)/gu, "")
    .replace(/[^\p{L}\p{N}×xX]/gu, "");
  const sentences = splitHardSentences(sourceScript);
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!/(?:谢谢|感谢|多谢)/u.test(sentence)) continue;
    if (target && sentence.includes(target)) return true;
    if (giftCue.length >= 2 && sentence.includes(giftCue)) return true;

    // “凯哥。谢谢你刚才的礼物。”仍是清楚承接；后一句才喊凯哥则不能倒推给前面的泛谢。
    const previousAddress = String(sentences[index - 1] || "").replace(/[\s\p{P}]/gu, "");
    if (target && previousAddress === target) return true;
  }
  return false;
}

/**
 * 对模型报告应用后端硬规则。
 * - 红线：无论模型原判 passed/almost/off，一律 off。
 * - 人设/AI 味：不得 passed，按不合格稿降为 off。
 * - 两个核心能力、逐句/结构/动态契约任一不完整：passed 降级。
 *
 * 导出仅用于无网络单元测试；Worker 主流程仍由本文件直接调用。
 * @param {object} report - normalizeReport 后的报告
 * @param {string[]} redlineHits - 纯规则命中的红线词
 * @param {{sourceScript?:string, scenario?:object|null, voteGap?:string}} [context] - 当前原稿与已清洗现场事实
 * @returns {object} 原对象（已原地应用安全规则）
 */
export function applyReportSafetyGates(report, redlineHits, context = {}) {
  const hasDetectedRedline = Array.isArray(redlineHits) && redlineHits.length > 0;
  if (hasDetectedRedline) {
    // 红线是一票否决，不只拦 passed；almost 同样不能保留。
    report.verdict = "off";
    report.verdict_reason = `里面有踩红线的词，先改掉。${report.verdict_reason || ""}`.trim();

    // 实测模型会漏写 redline_note——横幅是主播唯一能看到哪句不能播的通道，硬兜底。
    if (!report.redline_note) {
      report.redline_note = `稿子里出现了不能播的词：${redlineHits.join("、")}，先改掉再谈过关。`;
    }
  }

  const hasReportedRedline =
    typeof report.redline_note === "string" && report.redline_note.trim().length > 0;
  if (hasReportedRedline && !hasDetectedRedline) {
    // 模型可能识别到词表外的平台风险；只要写入 redline_note，同样一票否决。
    report.verdict = "off";
    report.verdict_reason = `这段话还有不能播的内容，先改掉再过关。${report.verdict_reason || ""}`.trim();
  }

  const hasPersonaIssue =
    report.card_type === "persona" ||
    (typeof report.ai_flavor === "string" && report.ai_flavor.trim().length > 0);
  if (hasPersonaIssue) {
    // 只要模型明确写出人设/AI 腔问题，就不是局部微调，不能保留 almost。
    report.verdict = "off";
    report.verdict_reason = `这段话还没有你的个人味道，先去掉套话再过关。${report.verdict_reason || ""}`.trim();
  }

  const sourceScript = typeof context.sourceScript === "string" ? context.sourceScript : "";
  const scenario = context.scenario && typeof context.scenario === "object"
    ? context.scenario
    : null;

  // 模型常把泛称“支持/出手”顺手写成“礼物”。只有原稿或现场真的出现礼物事实
  // 才能保留这个词；否则统一退回可观察的“支持”，避免复盘给新人编现场。
  const observableContext = `${sourceScript}${scenarioEvidenceText(scenario)}`;
  if (
    !/(?:礼物|送了|送来|送的|刷了|小心心|火箭|嘉年华)/u.test(observableContext) &&
    Array.isArray(report.round_dynamics?.human_drivers)
  ) {
    for (const driver of report.round_dynamics.human_drivers) {
      if (!driver || typeof driver !== "object") continue;
      if (typeof driver.evidence === "string") {
        driver.evidence = driver.evidence.replace(/礼物/gu, "支持");
      }
      if (typeof driver.mechanism === "string") {
        driver.mechanism = driver.mechanism.replace(/礼物/gu, "支持");
      }
    }
  }

  const ticketProgressSummary = summarizeTicketProgress(sourceScript);
  if (ticketProgressSummary && report.round_dynamics) {
    const modelFlow = typeof report.round_dynamics.flow_read === "string"
      ? report.round_dynamics.flow_read
      : "";
    const flowWithoutModelArithmetic = modelFlow
      .replace(/(?:票差|数量)(?:从|由|按)[^。！？]*?(?:反馈|变化|响应)[。！？]?$/u, "")
      .trim();
    report.round_dynamics.flow_read = Array.from(
      `${ticketProgressSummary}${flowWithoutModelArithmetic ? ` ${flowWithoutModelArithmetic}` : ""}`
    ).slice(0, LIMITS.roundDynamicsTextMax).join("");
    report.round_dynamics.response_read = Array.from(ticketProgressSummary)
      .slice(0, LIMITS.roundDynamicsTextMax)
      .join("");
  }

  // 新人稿里没有建立才艺/节目期待时，模型容易条件反射地把“加个才艺诱饵”
  // 当作万能答案。只改模型后来添加的建议，不碰原稿；把下一拍重新锚定在
  // 已发生的反馈和人性驱动上。原稿本来就有才艺时则完整保留顺势承接。
  const feedbackAdvice = feedbackLedAdvice(ticketProgressSummary);
  if (
    report.round_dynamics &&
    hasIntroducedContentAdvice(report.round_dynamics.next_move, sourceScript)
  ) {
    report.round_dynamics.next_move = feedbackAdvice.nextMove;
  }
  if (report.direction && typeof report.direction === "object") {
    if (hasIntroducedContentAdvice(report.direction.summary, sourceScript)) {
      report.direction.summary = `${feedbackAdvice.nextMove} 用你自己的话说。`;
    }
    if (Array.isArray(report.direction.examples)) {
      report.direction.examples = report.direction.examples.map((example, index) =>
        hasIntroducedContentAdvice(example, sourceScript)
          ? feedbackAdvice.examples[index % feedbackAdvice.examples.length]
          : example
      );
    }
  }
  if (Array.isArray(report.line_reviews)) {
    for (const review of report.line_reviews) {
      if (!review || !hasIntroducedContentAdvice(review.comment, sourceScript)) continue;
      review.comment =
        "这句的调整重点是先把已经发生的支持说具体，再把下一拍递给仍在观望的人，不必另造内容交换。";
    }
  }

  // 现场明确给了礼物事实时，“谢谢大家”只能算泛谢，不能让模型虚判为接住具体支持。
  // 这是只降不升的事实兜底：模型漏判具体感谢时仍由模型报告负责，不在这里擅自补 met。
  const gratitudeCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "gratitude")
    : null;
  if (
    sourceScript &&
    gratitudeCheck?.status === "met" &&
    typeof scenario?.recentGift === "string" &&
    scenario.recentGift.trim() &&
    !hasSpecificScenarioGratitude(sourceScript, scenario)
  ) {
    gratitudeCheck.status = "partial";
    const scenarioTarget = typeof scenario?.targetUser === "string"
      ? scenario.targetUser.trim()
      : "目标用户";
    gratitudeCheck.evidence = `只有泛泛感谢，还没接住${scenarioTarget}这次具体支持`;
  }

  // target_user 只检查“有没有明确在对一个可识别对象说话”。感谢、用户价值和上票动作
  // 分属其他原子能力，不再把它们藏进这一项。场景目标是起始观察点，不是姓名考题；
  // 同一轮扫到其他用户、根据反馈换人递话都属于正常流动，不能因未命中特定姓名降级。
  const targetCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "target_user")
    : null;
  if (sourceScript && targetCheck) {
    const scenarioTarget = typeof scenario?.targetUser === "string"
      ? scenario.targetUser.trim()
      : "";
    const hasAnyConcreteTarget =
      hasConcreteTargetAddress(sourceScript) ||
      (scenarioTarget && hasConcreteTargetAddress(sourceScript, scenarioTarget));
    if (hasAnyConcreteTarget) {
      targetCheck.status = "met";
      targetCheck.evidence = "已经直接称呼至少一个可识别的用户";
      if (
        typeof report.audience === "string" &&
        /(?:点名太多|人名太多|对象太散|喊得(?:很)?散|撒网式点名|没有对准任何|没对准任何|没有明确对准|没明确对准|喊错人|逐个求熟人|逐个求人|虽然点名.{0,24}(?:没给|没有).{0,12}(?:角色|理由)|点名了.{0,24}(?:但|却).{0,16}(?:没给|没有).{0,12}(?:角色|理由)|喊了但没点着)/u.test(
          report.audience
        )
      ) {
        report.audience =
          "她已经明确对到具体用户；同轮换人是正常扫场，重点看每一拍有没有接住现场反馈。";
      }
    } else {
      if (targetCheck.status === "met") targetCheck.status = "partial";
      targetCheck.evidence =
        "还没有直接称呼一个可识别的用户；这一项不检查理由、票差或上票动作";
    }
  }

  const userReasonCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "user_reason")
    : null;
  const viewerReason = sourceScript
    ? detectViewerReason(sourceScript, scenario)
    : { state: "unknown", evidence: "" };
  const humanDriverReason = groundedHumanDriverReason(
    report.round_dynamics,
    sourceScript,
    scenario
  );
  if (userReasonCheck && viewerReason.state === "met") {
    // 观看内容、互动乐趣、选择权或兑现本身就是用户侧价值；评论/上票动作
    // 由 vote_instruction 单独检查，不能因为缺动作把这一项再卡一次。
    userReasonCheck.status = "met";
    userReasonCheck.evidence = viewerReason.evidence;
  } else if (userReasonCheck && humanDriverReason) {
    // 才艺、选择权不是唯一支点。模型若已用事实讲清归属、身份、保护、互惠等
    // 参与机制，就不能再被旧的“只找内容诱饵”规则压成 partial。
    userReasonCheck.status = "met";
    userReasonCheck.evidence = humanDriverReason.evidence;
  } else if (userReasonCheck && viewerReason.state === "invalid") {
    if (userReasonCheck.status === "met") userReasonCheck.status = "partial";
    userReasonCheck.evidence = `${viewerReason.evidence}；还没有形成有事实支撑的人性参与支点`;
  } else if (userReasonCheck && userReasonCheck.status !== "met") {
    userReasonCheck.evidence =
      "还没形成有事实支撑的人性参与支点；才艺、保护、归属、身份、互惠等都可以成立";
  }
  if (
    humanDriverReason &&
    typeof report.card_why === "string" &&
    /(?:(?:没有|没给|缺少|欠缺|不足|偏弱|缺一个).{0,32}(?:用户.{0,20}理由|参与理由|行动理由|参与支点|用户支点|支点|由头|诱饵|钩子)|为什么上票.{0,24}(?:停在|缺))/u.test(
      report.card_why
    )
  ) {
    report.card_why =
      "本轮已经有事实支撑的人性参与支点；下一步重点是根据真实反馈判断继续强化、换人还是换角度，而不是机械补一个才艺交易。";
  }
  const hasSupportEvidence = userReasonCheck?.status === "met";

  // 数字只用于读取本轮反馈，不再是毕业门槛。这里只核对是否有明确、可立即执行的要票动作；
  // “还差很多/冲一冲”若没有补、投、组、上等动作，仍不能被模型虚判为 met。
  const voteInstructionCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "vote_instruction")
    : null;
  const scenarioPhase = typeof scenario?.phase === "string" ? scenario.phase : "";
  if (sourceScript && voteInstructionCheck) {
    if (hasCurrentPhaseInstruction(sourceScript, scenarioPhase)) {
      // 可执行动作是可以从原话确定性核验的事实：模型漏判时向上纠正，避免数字门槛借尸还魂。
      voteInstructionCheck.status = "met";
      voteInstructionCheck.evidence = scenarioPhase === "awaiting_drop"
        ? "组满后已明确让占位用户等待主持统一口令"
        : scenarioPhase === "delivery"
          ? "主持已发令后，已明确接住到账或协调原占位兑现"
          : scenarioPhase === "result" || scenarioPhase === "post_round"
            ? "结果落地后，已明确接住共同结果并承接关系"
            : "原话已经递出观众能立即执行的要票动作";
    } else if (voteInstructionCheck.status === "met") {
      voteInstructionCheck.status = "partial";
      voteInstructionCheck.evidence = scenarioPhase === "awaiting_drop"
        ? "已经组满但主持尚未发令，还没有明确让大家等主持统一口令"
        : scenarioPhase === "delivery"
          ? "主持已经发令，当前还没有接住实际到账或协调原占位兑现"
          : scenarioPhase === "result" || scenarioPhase === "post_round"
            ? "结果已经落地，当前还没有确认共同结果、感谢或关系承接"
            : "提到了票况，但还没有递出观众能立即执行的要票动作";
    }
  }
  const phaseActionConflict =
    (scenarioPhase === "awaiting_drop" && hasAdditionalClaimPressure(sourceScript)) ||
    (scenarioPhase === "delivery" && hasNewClaimPressure(sourceScript)) ||
    (["result", "post_round"].includes(scenarioPhase) && hasExplicitVoteInstruction(sourceScript));
  if (phaseActionConflict && voteInstructionCheck) {
    voteInstructionCheck.status = "partial";
    voteInstructionCheck.evidence = ["result", "post_round"].includes(scenarioPhase)
      ? "结果已经确认，当前应接住兑现和感谢，不该继续拉票"
      : scenarioPhase === "delivery"
        ? "主持已经发令，当前应核对兑现，不该重新找人占位"
        : "组队已经满额且主持尚未发令，当前应等待统一兑现，不该追加或催提前丢";
  }
  const hasVoteInstruction = voteInstructionCheck?.status === "met" && !phaseActionConflict;

  // 委婉请求与放低姿态是两条不同语义：普通“帮我+具体动作”不命中；
  // 显性乞求至少不能毕业，乞求叠加乞怜/依赖或明确自贬时再判整体方向错误。
  // 用户侧交换价值不能洗掉“跪下、施舍”等自贬语义。
  let hasLowPosture = false;
  if (sourceScript) {
    const unquotedScript = withoutAttributedQuotedText(sourceScript);
    const beggingSignal = firstUnnegatedSignal(unquotedScript, EXPLICIT_BEGGING_SIGNALS);
    const pitySignal = firstUnnegatedSignal(unquotedScript, PITY_OR_DEPENDENCY_SIGNALS);
    const selfAbasementSignal = firstSelfAbasementSignal(unquotedScript);
    const reinforcementSignal = firstUnnegatedSignal(
      unquotedScript,
      BEGGING_REINFORCEMENT_SIGNALS
    );
    hasLowPosture = Boolean(beggingSignal || pitySignal || selfAbasementSignal);
    const severeLowPosture = Boolean(
      selfAbasementSignal || (beggingSignal && (pitySignal || reinforcementSignal))
    );

    // 模型若把明确乞求误标为 good，后端按原话证据纠正；否定与引用已在上面排除。
    if (hasLowPosture && Array.isArray(report.line_reviews)) {
      for (const review of report.line_reviews) {
        if (!review || typeof review.original !== "string") continue;
        const line = withoutAttributedQuotedText(review.original);
        const lineSelfAbasement = firstSelfAbasementSignal(line);
        const lineBegging = firstUnnegatedSignal(line, EXPLICIT_BEGGING_SIGNALS);
        const linePity = firstUnnegatedSignal(line, PITY_OR_DEPENDENCY_SIGNALS);
        const lineSignal = lineSelfAbasement || lineBegging || linePity;
        if (!lineSignal || review.mark === "wrong") continue;
        review.mark = "wrong";
        review.comment = lineSelfAbasement
          ? `“${lineSignal}”是在自贬或求施舍，确实把自己放低了。`
          : `“${lineSignal}”是显性乞求或乞怜，不同于“帮我组一组”这种委婉确认。`;
      }
    }

    if (hasLowPosture && !hasPersonaIssue && !hasDetectedRedline && !hasReportedRedline) {
      report.card_type = "logic";
      const signal = selfAbasementSignal || beggingSignal || pitySignal;
      report.card_why = selfAbasementSignal
        ? `“${signal}”把主播摆成自贬或等施舍的一方，主卡点是姿态逻辑。`
        : `“${signal}”已经是显性乞求或乞怜，主卡点是姿态逻辑。`;
    }
    if (severeLowPosture) {
      report.verdict = "off";
      const signal = selfAbasementSignal || pitySignal || beggingSignal;
      report.verdict_reason = `“${signal}”连同上下文已经构成明确乞求或自贬，这不是委婉请求，整体姿态要重新立。`;
    } else if (hasLowPosture && report.verdict !== "off") {
      const signal = beggingSignal || pitySignal;
      report.verdict = "almost";
      report.verdict_reason = `“${signal}”属于显性乞求或乞怜，把这一处换回平等请求再过关。`;
    }
  }

  // “新人难/不想早下去”是可能触发保护欲的脆弱线索，不等于求施舍。
  // 模型若仍沿用旧口径道德化，按原话中的显性乞求证据纠偏；效果好坏交给票差反馈判断。
  if (sourceScript && !hasLowPosture) {
    const vulnerabilityCue =
      /(?:平时(?:我)?(?:连)?(?:一个|一票|一颗).{0,6}(?:拿不到|拉不出)|新人.{0,8}(?:难|不容易)|(?:这|这些|\d+个?).{0,8}(?:对我)?(?:真的)?好难|我不想.{0,8}(?:下去|走|被淘汰))/u;
    if (vulnerabilityCue.test(sourceScript)) {
      if (
        typeof report.card_why === "string" &&
        /(?:低姿态|自贬|卖惨|等施舍|求人帮忙|求施舍)/u.test(report.card_why)
      ) {
        report.card_why =
          "这轮要看人性支点、明确动作和真实反馈是否衔接；脆弱线索本身不是自贬，只有显性乞求或求施舍才是姿态问题。";
      }
      if (Array.isArray(report.line_reviews)) {
        for (const review of report.line_reviews) {
          if (
            !review ||
            typeof review.original !== "string" ||
            !vulnerabilityCue.test(review.original) ||
            typeof review.comment !== "string" ||
            !/(?:低姿态|自贬|卖惨|等施舍|求施舍|求人的一方)/u.test(review.comment)
          ) {
            continue;
          }
          if (review.mark === "wrong") review.mark = "partial";
          review.comment =
            "这句是在递保护欲线索，不等于自贬；看后续票差是否继续下降，停住后再换角度。";
        }
      }
    }
  }

  // 动作按整轮检查，不要求每一句都重复。模型若只因为某个收尾气氛句没有再次
  // 说“组/投/补”就标 wrong，降为局部 partial；真正的强迫、乞求和红线仍保留 wrong。
  if (hasVoteInstruction && Array.isArray(report.line_reviews)) {
    for (const review of report.line_reviews) {
      if (
        !review ||
        review.mark !== "wrong" ||
        typeof review.comment !== "string" ||
        !/(?:不是要票动作|没有.{0,8}(?:要票|上票|明确).{0,4}动作|动作丢了|泛泛.{0,6}喊话|观众不知道.{0,6}(?:做什么|怎么接))/u.test(
          review.comment
        )
      ) {
        continue;
      }
      review.mark = "partial";
      review.comment =
        "整轮已经有明确要票动作；这句只是承接偏泛，可以结合最新反馈把下一拍递得更具体。";
    }
  }

  // 阶段冲突是现场逻辑错误：即使句面存在“补/组/上”等动作，也不能借旧动作门槛毕业。
  if (phaseActionConflict) {
    report.card_type = "logic";
    report.card_why = ["result", "post_round"].includes(scenarioPhase)
      ? "现场已经宣布结果，继续拉票会越过感谢和关系回收这一拍。"
      : scenarioPhase === "delivery"
        ? "主持已经发令、原占位正在兑现，重新找人加量会把现场拉回上一拍。"
        : "现场已经组满待发令，继续找人加量或催提前丢会打乱主持统一发令和用户承诺。";
    if (Array.isArray(report.line_reviews)) {
      const conflictMatcher = ["result", "post_round"].includes(scenarioPhase)
        ? (line) => hasExplicitVoteInstruction(line)
        : scenarioPhase === "delivery"
          ? (line) => hasNewClaimPressure(line)
          : (line) => hasAdditionalClaimPressure(line);
      for (const review of report.line_reviews) {
        if (!review || typeof review.original !== "string" || !conflictMatcher(review.original)) continue;
        review.mark = "wrong";
        review.comment = ["result", "post_round"].includes(scenarioPhase)
          ? "结果已经确认，这一拍应接住兑现与感谢，不能再继续拉票。"
          : scenarioPhase === "delivery"
            ? "主持已经发令，这一拍应接住原占位兑现，不能重新找人占位。"
            : "队伍已经组满但主持尚未发令，这一拍应让大家等统一口令，不能追加或催提前丢。";
      }
    }
    if (report.verdict === "passed") report.verdict = "almost";
    report.verdict_reason = ["result", "post_round"].includes(scenarioPhase)
      ? "结果已经落地，先停止拉票并接住本轮兑现，再谈下一轮。"
      : scenarioPhase === "delivery"
        ? "主持已经发令，停止新增占位，按真实到账接住原承诺兑现后再过关。"
        : "队伍已经组满，停止追加与提前催丢，把统一口令交还主持后再过关。";
  }

  const wrongCount = Array.isArray(report.line_reviews)
    ? report.line_reviews.filter((item) => item && item.mark === "wrong").length
    : 0;
  const hasWrong = wrongCount > 0;
  // 五项继续完整返回给旧前端做能力地图，但毕业只看两个现场核心：
  // 用户为什么愿意参与，以及主播有没有递出可执行的要票动作。
  const coreGapCount = [hasSupportEvidence, hasVoteInstruction].filter((met) => !met).length;
  const lineReviewsContractValid = report._lineReviewsContractValid === true;
  const structureContractValid = report._structureContractValid === true;
  const safetyFieldsContractValid = report._safetyFieldsContractValid === true;
  const roundDynamicsContractValid = report._roundDynamicsContractValid === true;
  const qualifiesForPassed =
    hasSupportEvidence &&
    hasVoteInstruction &&
    !hasWrong &&
    lineReviewsContractValid &&
    structureContractValid &&
    safetyFieldsContractValid &&
    roundDynamicsContractValid &&
    !hasLowPosture &&
    !hasPersonaIssue &&
    !hasDetectedRedline &&
    !hasReportedRedline;

  if (report.verdict === "passed") {
    if (!qualifiesForPassed) {
      report.verdict = "almost";
      const issues = [];
      if (!hasSupportEvidence) issues.push("还没有站在用户侧的参与理由");
      if (!hasVoteInstruction) issues.push("还没有明确可执行的要票动作");
      if (hasWrong) issues.push("还有站错角度的句子");
      if (!lineReviewsContractValid) issues.push("逐句判断还不完整");
      if (!structureContractValid) issues.push("五项结构证据还不完整");
      if (!safetyFieldsContractValid) issues.push("安全字段还不完整");
      if (!roundDynamicsContractValid) issues.push("本轮动态与人性驱动判断还不完整");
      report.verdict_reason = `${issues.join("，")}，先补好再过关。`;
    }
  }

  // 两个现场核心都没形成，或缺用户理由且还有多句站错角度，才说明整体方向要重立。
  // 自我介绍、感谢、点名仍进入能力地图，但不再因为这些非核心项缺失把稿子打成 off。
  if (
    report.verdict === "almost" &&
    !hasSupportEvidence &&
    (coreGapCount >= 2 || wrongCount >= 2)
  ) {
    report.verdict = "off";
    report.verdict_reason = `这版还没有站到用户角度，而且不止一处需要重做，先把上票支点和整体方向重新立住。${report.verdict_reason || ""}`.trim();
  }

  // 文字毕业门槛是机械规则，不是模型的审美打分。只要两个核心能力、动态闭环、
  // 逐句与安全契约全部满足，模型若仅因非核心结构或“还能更好”给 almost，
  // 后端稳定晋级。模型明确判 off 仍保留，避免深层逻辑问题被两个状态位洗掉。
  if (report.verdict === "almost" && qualifiesForPassed) {
    report.verdict = "passed";
    report.verdict_reason = "上票理由落到了用户身上，也递出了明确动作；本轮反馈和人性驱动读得完整，这版达到文字稿门槛。";
  }
  if (report.verdict === "passed" && ticketProgressSummary && humanDriverReason) {
    report.one_thing =
      "先看哪种人性驱动已经让票差发生变化；票差停住时再换驱动、换对象或换角度，不要机械重复同一句。";
  }

  // 同一份稿在不同票况下必须给新人不同策略锚点，避免模型偶尔输出通用点评。
  // 仅在模型漏掉对应语义时补一句，不覆盖它已经给出的具体判断。
  if (
    report.direction &&
    typeof report.direction.summary === "string" &&
    !["delivery", "awaiting_drop", "result", "post_round"].includes(scenarioPhase)
  ) {
    const summary = report.direction.summary;
    const hasPositiveFocus = (keywordPattern) => {
      const hasKeyword = keywordPattern.test(summary);
      const hasOnlyNegativeMention =
        /(?:没有|没给|缺少|欠缺|不够|还没|未能|不能只|别只).{0,10}(?:追票|翻盘|追上|现在出手|稳票|守住|保位|白投|已上票|临门一脚|最后一脚|补一脚|补齐|收口)/u.test(summary);
      return hasKeyword && !hasOnlyNegativeMention;
    };
    if (context.voteGap === "far" && !hasPositiveFocus(/追票|翻盘|追上|现在出手/u)) {
      report.direction.summary = `现在是追票阶段，先给观众一个现在出手的理由。${report.direction.summary}`;
    } else if (
      context.voteGap === "secured" &&
      !hasPositiveFocus(/稳票|守住|保位|白投|已上票/u)
    ) {
      report.direction.summary = `现在是稳票保位阶段，先让已上票的人觉得没有白投。${report.direction.summary}`;
    } else if (
      context.voteGap === "close" &&
      !hasPositiveFocus(/临门一脚|最后一脚|补一脚|补齐|收口/u)
    ) {
      report.direction.summary = `现在是临门一脚，先把最后的动作说清楚。${report.direction.summary}`;
    }
  }

  // 组满未发令时，建议必须停在“等主持”，不能让主播抢口令或继续找人。
  if (scenarioPhase === "awaiting_drop") {
    const deliveryNextMove = "确认组满与实际到账状态，提醒其余占位按约定等主持统一口令，不再找新补位。";
    if (
      !report.round_dynamics ||
      !hasDeliveryCoordinationInstruction(report.round_dynamics.next_move) ||
      hasAdditionalClaimPressure(report.round_dynamics.next_move)
    ) {
      if (report.round_dynamics) report.round_dynamics.next_move = deliveryNextMove;
    }
    if (report.direction && typeof report.direction === "object") {
      if (
        !hasDeliveryCoordinationInstruction(report.direction.summary) ||
        hasAdditionalClaimPressure(report.direction.summary)
      ) {
        report.direction.summary = `${deliveryNextMove} 用你自己的话说。`;
      }
      if (Array.isArray(report.direction.examples)) {
        report.direction.examples = report.direction.examples.filter(
          (example) =>
            hasDeliveryCoordinationInstruction(example) &&
            !hasAdditionalClaimPressure(example)
        );
      }
    }
    if (
      typeof report.one_thing !== "string" ||
      hasAdditionalClaimPressure(report.one_thing) ||
      !/(?:组满|认领|到账|主持|口令|统一)/u.test(report.one_thing)
    ) {
      report.one_thing = "组满以后动作会反转：停止拉新认领，核对到账并等主持统一发令。";
    }
  }

  // 主持已经发令后进入实际兑现；这一拍不能还停留在“继续等口令”。
  if (scenarioPhase === "delivery") {
    const fulfillmentNextMove = "主持已经发令，按实际到账接住原占位兑现并感谢；不再拉新占位，也不把未到账承诺说成已到账。";
    if (
      !report.round_dynamics ||
      !hasDeliveryExecutionInstruction(report.round_dynamics.next_move) ||
      hasNewClaimPressure(report.round_dynamics.next_move)
    ) {
      if (report.round_dynamics) report.round_dynamics.next_move = fulfillmentNextMove;
    }
    if (report.direction && typeof report.direction === "object") {
      if (
        !hasDeliveryExecutionInstruction(report.direction.summary) ||
        hasNewClaimPressure(report.direction.summary)
      ) {
        report.direction.summary = `${fulfillmentNextMove} 用你自己的话说。`;
      }
      if (Array.isArray(report.direction.examples)) {
        report.direction.examples = report.direction.examples.filter(
          (example) => hasDeliveryExecutionInstruction(example) && !hasNewClaimPressure(example)
        );
      }
    }
    if (
      typeof report.one_thing !== "string" ||
      hasNewClaimPressure(report.one_thing) ||
      !/(?:到账|兑现|感谢|接住|主持.{0,6}发令)/u.test(report.one_thing)
    ) {
      report.one_thing = "主持发令后只核对真实到账、接住原占位兑现并感谢，不再新增占位。";
    }
  }

  if (["result", "post_round"].includes(scenarioPhase)) {
    const resultNextMove = "结果已经落地，感谢大家这一轮的真实参与，接住共同完成并把关系自然带到下一轮；不再继续拉票。";
    if (
      !report.round_dynamics ||
      !hasResultConnectionInstruction(report.round_dynamics.next_move) ||
      hasExplicitVoteInstruction(report.round_dynamics.next_move)
    ) {
      if (report.round_dynamics) report.round_dynamics.next_move = resultNextMove;
    }
    if (report.direction && typeof report.direction === "object") {
      if (
        !hasResultConnectionInstruction(report.direction.summary) ||
        hasExplicitVoteInstruction(report.direction.summary)
      ) {
        report.direction.summary = `${resultNextMove} 用你自己的话说。`;
      }
      if (Array.isArray(report.direction.examples)) {
        report.direction.examples = report.direction.examples.filter(
          (example) => hasResultConnectionInstruction(example) && !hasExplicitVoteInstruction(example)
        );
      }
    }
    if (
      typeof report.one_thing !== "string" ||
      hasExplicitVoteInstruction(report.one_thing) ||
      !/(?:结果|感谢|共同|关系|下一轮|记住)/u.test(report.one_thing)
    ) {
      report.one_thing = "结果落地后停止拉票，先感谢真实参与并接住这轮共同完成。";
    }
  }

  return report;
}

/**
 * 教练后台管理接口（header X-Admin-Code 鉴权，GET/DELETE 不方便带 body，统一走 header）。
 * 路由：POST/GET /api/admin/cases、POST /api/admin/cases/{id}/publish、
 * DELETE /api/admin/cases/{id}
 */
async function handleAdmin(request, env, url, corsHeaders) {
  // 管理密码鉴权（fail-closed，模式与入口码一致）
  const authError = checkAdminCode(request, env);
  if (authError) return jsonResponse({ error: true, message: authError.message }, authError.status, corsHeaders);

  try {
    // 投喂优秀话术
    if (request.method === "POST" && url.pathname === "/api/admin/cases") {
      const body = await readBody(request);
      const err = validateManual(body);
      if (err) return jsonResponse({ error: true, message: err.message }, err.status, corsHeaders);
      const id = await addManualCase(env, body);
      console.log(`manual case added: ${id}`);
      return jsonResponse({ ok: true, id }, 201, corsHeaders);
    }

    // 清单（自动吸收清单 / 教练投喂清单 / 全部，游标分页）
    if (request.method === "GET" && url.pathname === "/api/admin/cases") {
      const source = ["auto", "manual", "all"].includes(url.searchParams.get("source"))
        ? url.searchParams.get("source")
        : "auto";
      const includeDeleted = url.searchParams.get("includeDeleted") === "1";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
      const cursor = url.searchParams.get("cursor");
      const result = await listAdminCases(env, { source, includeDeleted, limit, cursor });
      return jsonResponse({ ok: true, ...result }, 200, corsHeaders);
    }

    // 发布自动学习候选：重复发布幂等成功；manual/rejected/不存在返回稳定 4xx。
    const publishMatch = url.pathname.match(
      /^\/api\/admin\/cases\/(case:[A-Za-z0-9:]+)\/publish$/
    );
    if (request.method === "POST" && publishMatch) {
      const result = await publishCase(env, publishMatch[1]);
      if (result.ok) {
        return jsonResponse(
          {
            ok: true,
            alreadyPublished: result.alreadyPublished,
            publishedAt: result.publishedAt,
          },
          200,
          corsHeaders
        );
      }

      const errors = {
        not_found: { status: 404, message: "这条不存在" },
        manual: { status: 409, message: "教练投喂案例已经发布，不需要再次发布" },
        rejected: { status: 409, message: "这条已删除或拒绝，不能发布" },
        invalid_status: { status: 409, message: "这条当前状态不能发布" },
      };
      const error = errors[result.reason] || errors.invalid_status;
      return jsonResponse({ error: true, message: error.message }, error.status, corsHeaders);
    }

    // 软删除
    const delMatch = url.pathname.match(/^\/api\/admin\/cases\/(case:[A-Za-z0-9:]+)$/);
    if (request.method === "DELETE" && delMatch) {
      const ok = await softDeleteCase(env, delMatch[1]);
      if (!ok) return jsonResponse({ error: true, message: "这条不存在" }, 404, corsHeaders);
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    return jsonResponse({ error: true, message: "接口不存在" }, 404, corsHeaders);
  } catch (err) {
    console.log(`admin error: ${err.message}`);
    return jsonResponse({ error: true, message: "后台出错了，稍后再试" }, 500, corsHeaders);
  }
}

/**
 * 读取并解析 JSON 请求体（教练接口与管理接口共用）。
 * @returns {Promise<object>}
 */
async function readBody(request) {
  const raw = await request.text();
  if (raw.length > LIMITS.bodyMaxBytes) {
    throw new HttpError(400, "内容太长，精简一下", "body 超限");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "请求格式不对", "JSON 解析失败");
  }
}

/**
 * 入口码校验：body.accessCode 与 env.ACCESS_CODE 比对。
 * fail-closed：secret 未配置或太短 → 全部 503"服务未配置"，
 * 绝不出现"没配 secret 反而放行"的情况（沿用 wardrobe SYNC_SECRET 思路）。
 * 只返回错误描述对象，响应构造交给入口（保证 CORS 头）。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function checkAccessCode(body, env) {
  const expected = env.ACCESS_CODE;
  if (!expected || typeof expected !== "string" || expected.length < 8) {
    return { status: 503, message: "服务未配置" };
  }
  const provided = typeof body.accessCode === "string" ? body.accessCode : "";
  if (provided !== expected) {
    return { status: 401, message: "入口码不对" };
  }
  return null;
}

/**
 * 管理密码校验：header X-Admin-Code 与 env.ADMIN_CODE 比对（fail-closed，同入口码模式）。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function checkAdminCode(request, env) {
  const expected = env.ADMIN_CODE;
  if (!expected || typeof expected !== "string" || expected.length < 8) {
    return { status: 503, message: "服务未配置" };
  }
  const provided = request.headers.get("X-Admin-Code") || "";
  if (provided !== expected) {
    return { status: 401, message: "管理密码不对" };
  }
  return null;
}

/**
 * 清洗可选现场情境。未知字段静默丢弃，避免前端迭代时破坏旧接口；
 * 已知字段一旦提供就必须满足固定类型、长度与数值范围。
 * 文本折叠为单行，避免把换行伪装成新的 prompt 段落。
 * @param {unknown} raw
 * @returns {object|null}
 */
export function sanitizeScenario(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "现场情境格式不对", "scenario 非对象");
  }

  const cleaned = {};
  for (const key of SCENARIO_FIELD_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;

    if (Object.prototype.hasOwnProperty.call(SCENARIO_NUMBER_RULES, key)) {
      const { max, decimals } = SCENARIO_NUMBER_RULES[key];
      const scale = 10 ** decimals;
      const hasAllowedPrecision =
        typeof value === "number" &&
        Number.isFinite(value) &&
        Math.abs(value * scale - Math.round(value * scale)) < 1e-9;
      if (!hasAllowedPrecision || value < 0 || value > max) {
        throw new HttpError(400, "现场情境里的数字不合法", `scenario.${key} 超出范围`);
      }
      cleaned[key] = value;
      continue;
    }

    if (key === "phase") {
      if (typeof value !== "string" || !SCENARIO_PHASE_ENUM.includes(value)) {
        throw new HttpError(400, "现场阶段不合法", "scenario.phase 非白名单枚举");
      }
      cleaned.phase = value;
      continue;
    }

    if (key === "timeline") {
      cleaned.timeline = sanitizeTimeline(value);
      if (cleaned.timeline.length === 0) delete cleaned.timeline;
      continue;
    }

    if (typeof value !== "string") {
      throw new HttpError(400, "现场情境里的文字格式不对", `scenario.${key} 非字符串`);
    }
    const compact = compactScenarioText(value);
    if (!compact) continue;
    if (compact.length > SCENARIO_TEXT_LIMITS[key]) {
      throw new HttpError(400, "现场情境文字太长了", `scenario.${key} 超长`);
    }
    cleaned[key] = compact;
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(cleaned, key);
  if (has("targetUnits")) {
    for (const key of ["pledgedUnits", "openRemaining", "deliveredUnits"]) {
      if (has(key) && cleaned[key] > cleaned.targetUnits) {
        throw new HttpError(400, "现场组队数字彼此矛盾", `scenario.${key} 大于 targetUnits`);
      }
    }
  }
  if (has("pledgedUnits") && has("deliveredUnits") && cleaned.deliveredUnits > cleaned.pledgedUnits) {
    throw new HttpError(400, "现场到账数不能大于已占位数", "scenario.deliveredUnits 大于 pledgedUnits");
  }
  if (has("targetUnits") && has("pledgedUnits") && has("openRemaining")) {
    const accounted = cleaned.pledgedUnits + cleaned.openRemaining;
    if (Math.abs(accounted - cleaned.targetUnits) > 0.001) {
      throw new HttpError(400, "现场组队数字没有对齐", "已占位数 + 待占位数不等于目标数");
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/** 单行化现场文字；长度校验由各字段自己的上限负责。 */
function compactScenarioText(value) {
  return value
    .trim()
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * 严格清洗一轮时间线。每条必须有 at/role/kind/speaker/text；未知字段丢弃，
 * effect 是可选的玩法结果方向，避免把“送礼”自动等同成保台支持。
 */
function sanitizeTimeline(raw) {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "现场时间线格式不对", "scenario.timeline 非数组");
  }
  if (raw.length > LIMITS.timelineMax) {
    throw new HttpError(
      400,
      `现场时间线最多保留 ${LIMITS.timelineMax} 条关键事件`,
      "scenario.timeline 事件过多"
    );
  }

  let totalChars = 0;
  return raw.map((item, index) => {
    const path = `scenario.timeline[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "现场时间线事件格式不对", `${path} 非对象`);
    }

    const at = item.at;
    let cleanedAt;
    if (typeof at === "number") {
      if (!Number.isInteger(at) || at < 0 || at > 1000000000) {
        throw new HttpError(400, "现场时间点不合法", `${path}.at 超出范围`);
      }
      cleanedAt = at;
    } else if (typeof at === "string") {
      cleanedAt = compactScenarioText(at);
      if (!cleanedAt || cleanedAt.length > TIMELINE_TEXT_LIMITS.at) {
        throw new HttpError(400, "现场时间点不合法", `${path}.at 为空或超长`);
      }
    } else {
      throw new HttpError(400, "现场时间点不合法", `${path}.at 类型错误`);
    }

    if (typeof item.role !== "string" || !TIMELINE_ROLE_ENUM.includes(item.role)) {
      throw new HttpError(400, "现场角色不合法", `${path}.role 非白名单枚举`);
    }
    if (typeof item.kind !== "string" || !TIMELINE_KIND_ENUM.includes(item.kind)) {
      throw new HttpError(400, "现场事件类型不合法", `${path}.kind 非白名单枚举`);
    }

    const speaker = typeof item.speaker === "string"
      ? compactScenarioText(item.speaker)
      : "";
    const text = typeof item.text === "string" ? compactScenarioText(item.text) : "";
    if (!speaker || speaker.length > TIMELINE_TEXT_LIMITS.speaker) {
      throw new HttpError(400, "现场发言人格式不对", `${path}.speaker 为空或超长`);
    }
    if (!text || text.length > TIMELINE_TEXT_LIMITS.text) {
      throw new HttpError(400, "现场事件文字格式不对", `${path}.text 为空或超长`);
    }
    totalChars += String(cleanedAt).length + speaker.length + text.length;
    if (totalChars > LIMITS.timelineCharsMax) {
      throw new HttpError(400, "现场时间线文字太多了", "scenario.timeline 超出总文字预算");
    }

    const event = {
      at: cleanedAt,
      role: item.role,
      kind: item.kind,
      speaker,
      text,
    };
    if (item.effect !== undefined && item.effect !== null && item.effect !== "") {
      if (typeof item.effect !== "string" || !TIMELINE_EFFECT_ENUM.includes(item.effect)) {
        throw new HttpError(400, "现场票的作用方向不合法", `${path}.effect 非白名单枚举`);
      }
      event.effect = item.effect;
    }
    return event;
  });
}

/**
 * 把已经清洗的结构化现场转换成证据文本。递归读取对象数组中的原子值，
 * 不使用 String(object)，因此不会把 timeline 降成“[object Object]”。
 */
export function scenarioEvidenceText(scenario) {
  const parts = [];
  const visit = (value, depth = 0) => {
    if (depth > 4 || value === undefined || value === null) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, LIMITS.timelineMax)) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(scenario);
  return parts.join(" ");
}

/**
 * 主播批改参数校验（v2 极简）：票况枚举 + 话术长度。
 * 前端已做同样限制，这里兜底——不信任客户端。
 * @param {object} body
 * @param {number} [maxLen] - 话术上限，批改用 scriptMax；投喂传 feedScriptMax（投喂不调模型，可放宽）
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function validateParams(body, maxLen = LIMITS.scriptMax) {
  const bad = (message) => ({ status: 400, message });

  if (!body || typeof body !== "object") return bad("请求格式不对");
  if (!VOTE_GAP_ENUM.includes(body.voteGap)) return bad("票数情况不合法");

  const script = body.script;
  if (typeof script !== "string" || script.trim().length < LIMITS.scriptMin) {
    return bad("话术太短了，至少写一句完整的话");
  }
  if (script.length > maxLen) {
    return bad(`话术太长，精简到 ${maxLen} 字以内`);
  }
  return null;
}

/**
 * 投喂参数校验：票况枚举 + 话术长度 + 为什么好（必填——manual 案例的灵魂）。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function validateManual(body) {
  const base = validateParams(body, LIMITS.feedScriptMax);
  if (base) return base;

  const whyGood = body.whyGood;
  if (typeof whyGood !== "string" || whyGood.trim().length < LIMITS.whyGoodMin) {
    return { status: 400, message: "填一下为什么好——这是给 AI 的判断尺子" };
  }
  if (whyGood.length > LIMITS.whyGoodMax) {
    return { status: 400, message: `为什么好写太长了，精简到 ${LIMITS.whyGoodMax} 字以内` };
  }
  return null;
}

/**
 * 调 DeepSeek：非流式 + JSON mode，45 秒超时。
 * 错误分类：上游非 2xx → 502；输出解析失败 → 502；超时 → 504。
 * @param {object} env
 * @param {{voteGap:string, script:string, cases:object[], redlineHits:string[], scenario:object|null}} params
 * @returns {Promise<{report:object, usage:{prompt_tokens:number, completion_tokens:number}}>}
 */
async function callDeepSeek(env, { voteGap, script, cases, redlineHits, scenario }) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new HttpError(503, "服务未配置", "DeepSeek key 未配置");
  }

  const userPrompt = buildUserPrompt(voteGap, script, cases, redlineHits, scenario);

  let resp;
  try {
    resp = await fetch(DEEPSEEK_CONFIG.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_CONFIG.model,
        temperature: DEEPSEEK_CONFIG.temperature,
        max_tokens: DEEPSEEK_CONFIG.maxTokens,
        response_format: { type: "json_object" }, // 结构化输出，前端逐字段 textContent 渲染
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(DEEPSEEK_CONFIG.timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new HttpError(504, "教练想太久了，重试一次", "DeepSeek 超时");
    }
    throw new HttpError(502, "连不上教练，稍后重试", `DeepSeek 网络错误: ${err.message}`);
  }

  if (!resp.ok) {
    // 上游错误：不透传细节给前端，只记日志（上游 message 可能含敏感信息）
    const upstreamText = await resp.text().catch(() => "");
    console.log(`deepseek upstream ${resp.status}: ${upstreamText.slice(0, 200)}`);
    throw new HttpError(502, "教练那边出错了，稍后重试", `上游 ${resp.status}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  let report;
  try {
    report = JSON.parse(content);
  } catch {
    // JSON mode 偶发截断导致解析失败 → 让前端重试
    throw new HttpError(502, "报告格式出错，请重试", "JSON 解析失败");
  }
  if (!report || typeof report !== "object" || !Array.isArray(report.line_reviews)) {
    throw new HttpError(502, "报告格式出错，请重试", "报告字段缺失");
  }

  return {
    report,
    usage: {
      prompt_tokens: data?.usage?.prompt_tokens || 0,
      completion_tokens: data?.usage?.completion_tokens || 0,
    },
  };
}

/**
 * 契约归一化：枚举白名单硬校验（逃逸 → 502 重试）+ 缺失字段补默认值。
 * 不信任模型输出——verdict/card_type 逃逸枚举说明这轮输出不可用，宁可让前端重试。
 * @param {object} report - DeepSeek 返回的原始报告
 * @param {string} [sourceScript] - 当轮主播原话；提供时校验逐句 original 是否完整覆盖
 * @returns {object} 归一化后的报告（字段齐全、枚举合法）
 */
export function normalizeReport(report, sourceScript) {
  const str = (v, d = "") => (typeof v === "string" ? v : d);
  const boundedText = (value, maxLength) =>
    Array.from(
      str(value)
        .trim()
        .replace(/[\u0000-\u001F\u007F]+/g, " ")
        .replace(/\s+/g, " ")
    ).slice(0, maxLength).join("");
  const compactWhitespace = (value) => String(value || "").replace(/\s+/g, "");
  const splitSentences = (value) => {
    const matches = String(value || "").match(
      /[^。！？!?；;.]+(?:[。！？!?；;.]+[”’"'）】》]*)?|[。！？!?；;.]+[”’"'）】》]*/gu
    );
    return (matches || []).filter((item) => compactWhitespace(item).length > 0);
  };

  // 在任何兜底归一化之前记录逐句契约是否真实有效。非法 mark 后面仍会转 partial
  // 供前端安全渲染，但内部标记保留失败事实，绝不允许因此误过关。
  const rawLineReviews = Array.isArray(report.line_reviews) ? report.line_reviews : [];
  const lineReviewsShapeValid =
    rawLineReviews.length > 0 &&
    rawLineReviews.every(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        MARK_ENUM.includes(item.mark) &&
        typeof item.original === "string" &&
        item.original.trim().length > 0 &&
        typeof item.comment === "string" &&
        item.comment.trim().length > 0
    );
  const expectedScript = typeof sourceScript === "string"
    ? compactWhitespace(sourceScript)
    : null;
  const reviewSeparator = /[\s\p{P}]/u;
  const isSeparatorDeletionOnly = (reviewed, source) => {
    const reviewedCharacters = Array.from(String(reviewed || "")).filter(
      (character) => !/\s/u.test(character)
    );
    const sourceCharacters = Array.from(String(source || "")).filter(
      (character) => !/\s/u.test(character)
    );
    let reviewedIndex = 0;
    let sourceIndex = 0;
    while (reviewedIndex < reviewedCharacters.length && sourceIndex < sourceCharacters.length) {
      if (reviewedCharacters[reviewedIndex] === sourceCharacters[sourceIndex]) {
        reviewedIndex += 1;
        sourceIndex += 1;
      } else if (reviewSeparator.test(sourceCharacters[sourceIndex])) {
        // 只允许模型漏掉原稿中的标点；新增、移动或替换标点都不能通过修复。
        sourceIndex += 1;
      } else {
        return false;
      }
    }
    if (reviewedIndex < reviewedCharacters.length) return false;
    return sourceCharacters
      .slice(sourceIndex)
      .every((character) => reviewSeparator.test(character));
  };
  let effectiveLineReviews = rawLineReviews;

  // DeepSeek 偶尔在拆点评时漏掉原稿标点。仅当模型正文是原稿的“只删标点”版本时，
  // 才按原稿位置补回；新增/移动标点、正文改写仍 fail-closed。补回后继续检查硬句边界，
  // 因而把多句合成一条 good 仍不能绕过逐句门槛。
  if (
    lineReviewsShapeValid &&
    typeof sourceScript === "string" &&
    compactWhitespace(rawLineReviews.map((item) => item.original).join("")) !== expectedScript &&
    isSeparatorDeletionOnly(
      rawLineReviews.map((item) => item.original).join(""),
      sourceScript
    )
  ) {
    const sourceCharacters = Array.from(sourceScript);
    const repaired = [];
    let sourceIndex = 0;
    let repairValid = true;

    for (let index = 0; index < rawLineReviews.length; index += 1) {
      const item = rawLineReviews[index];
      const start = sourceIndex;
      if (index === rawLineReviews.length - 1) {
        sourceIndex = sourceCharacters.length;
      } else {
        let remaining = Array.from(item.original).filter(
          (character) => !reviewSeparator.test(character)
        ).length;
        while (sourceIndex < sourceCharacters.length && remaining > 0) {
          const character = sourceCharacters[sourceIndex];
          sourceIndex += 1;
          if (!reviewSeparator.test(character)) remaining -= 1;
        }
        if (remaining > 0) {
          repairValid = false;
          break;
        }
        while (
          sourceIndex < sourceCharacters.length &&
          reviewSeparator.test(sourceCharacters[sourceIndex])
        ) {
          sourceIndex += 1;
        }
      }
      if (sourceIndex <= start) {
        repairValid = false;
        break;
      }
      repaired.push({
        ...item,
        original: sourceCharacters.slice(start, sourceIndex).join(""),
      });
    }

    if (
      repairValid &&
      compactWhitespace(repaired.map((item) => item.original).join("")) === expectedScript
    ) {
      effectiveLineReviews = repaired;
    }
  }

  // DeepSeek 有时按主播的自然段点评：每段判断和原文都完整，却把段内问号/感叹号
  // 留在同一个 item。至少已经给出两个独立点评时，可以机械按硬标点拆开并沿用同一
  // mark/comment；单条点评吞整篇仍保持 fail-closed，不能靠这一修复绕过逐句检查。
  if (
    lineReviewsShapeValid &&
    typeof sourceScript === "string" &&
    effectiveLineReviews.length >= 2
  ) {
    const splitReviews = effectiveLineReviews.flatMap((item) => {
      const parts = splitSentences(item.original);
      return parts.length > 1
        ? parts.map((original) => ({ ...item, original }))
        : [item];
    });
    if (
      compactWhitespace(splitReviews.map((item) => item.original).join("")) ===
      expectedScript
    ) {
      effectiveLineReviews = splitReviews;
    }
  }

  const reviewedScript = effectiveLineReviews
    .map((item) => (item && typeof item.original === "string" ? item.original : ""))
    .join("")
    .replace(/\s+/g, "");
  // Prompt 要求 original 按句号/问号/感叹号/分号逐句引用：不仅要合起来覆盖全稿，
  // 条数和边界也必须对应，避免模型把整篇塞进一条 good 后绕过逐句判断。
  // 生产主流程会传 sourceScript；导出函数的旧单元测试不传时仍只校验形状。
  const lineReviewsCoverSource = expectedScript === null || reviewedScript === expectedScript;
  const sourceSentences = expectedScript === null ? [] : splitSentences(sourceScript);
  const cumulativeOffsets = (items) => {
    let offset = 0;
    return items.map((item) => {
      offset += compactWhitespace(item).length;
      return offset;
    });
  };
  const sourceHardBoundaries = cumulativeOffsets(sourceSentences).slice(0, -1);
  const reviewBoundaries = cumulativeOffsets(
    effectiveLineReviews.map((item) =>
      item && typeof item.original === "string" ? item.original : ""
    )
  );
  const lineReviewsMatchSentenceBoundaries =
    expectedScript === null ||
    sourceHardBoundaries.every((boundary) => reviewBoundaries.includes(boundary));
  const lineReviewsContractValid =
    lineReviewsShapeValid && lineReviewsCoverSource && lineReviewsMatchSentenceBoundaries;

  // 模型不能只打 met 却不给证据。五项必须数量、顺序、枚举和证据都合法，
  // 否则前端虽然仍能安全渲染归一化结果，后端也绝不允许判为 passed。
  const rawStructureChecks = Array.isArray(report.structure_checks)
    ? report.structure_checks
    : [];
  const structureContractValid =
    rawStructureChecks.length === STRUCTURE_CHECK_KEYS.length &&
    rawStructureChecks.every(
      (item, index) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.key === STRUCTURE_CHECK_KEYS[index] &&
        STRUCTURE_STATUS_ENUM.includes(item.status) &&
        typeof item.evidence === "string" &&
        item.evidence.trim().length > 0
    );

  // 这两个字段承担后端安全闸门：字段缺失或类型错误不能静默当成“明确无问题”。
  // 模型只有显式返回字符串（无问题时为空串），报告才有资格通过或被晋级。
  const safetyFieldsContractValid =
    typeof report.ai_flavor === "string" && typeof report.redline_note === "string";

  // round_dynamics 是新增兼容字段：旧前端会自然忽略，更新后的前端可以直接渲染。
  // 原始契约必须真实完整才有资格 passed；归一化只负责安全输出，不能替模型补证据。
  const rawRoundDynamics =
    report.round_dynamics &&
    typeof report.round_dynamics === "object" &&
    !Array.isArray(report.round_dynamics)
      ? report.round_dynamics
      : {};
  const rawHumanDrivers = Array.isArray(rawRoundDynamics.human_drivers)
    ? rawRoundDynamics.human_drivers
    : [];
  const roundDynamicsContractValid =
    typeof rawRoundDynamics.flow_read === "string" &&
    rawRoundDynamics.flow_read.trim().length > 0 &&
    rawHumanDrivers.length >= 1 &&
    rawHumanDrivers.length <= 3 &&
    rawHumanDrivers.every(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        HUMAN_DRIVER_ENUM.includes(item.driver) &&
        typeof item.evidence === "string" &&
        item.evidence.trim().length > 0 &&
        typeof item.mechanism === "string" &&
        item.mechanism.trim().length > 0
    ) &&
    typeof rawRoundDynamics.response_read === "string" &&
    rawRoundDynamics.response_read.trim().length > 0 &&
    typeof rawRoundDynamics.next_move === "string" &&
    rawRoundDynamics.next_move.trim().length > 0;

  const roundDynamics = {
    flow_read: boundedText(rawRoundDynamics.flow_read, LIMITS.roundDynamicsTextMax),
    human_drivers: rawHumanDrivers
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .slice(0, 3)
      .map((item) => ({
        driver: HUMAN_DRIVER_ENUM.includes(item.driver) ? item.driver : "other",
        evidence: boundedText(item.evidence, LIMITS.driverEvidenceMax),
        mechanism: boundedText(item.mechanism, LIMITS.driverMechanismMax),
      })),
    response_read: boundedText(rawRoundDynamics.response_read, LIMITS.roundDynamicsTextMax),
    next_move: boundedText(rawRoundDynamics.next_move, LIMITS.roundDynamicsTextMax),
  };

  if (!VERDICT_ENUM.includes(report.verdict)) {
    throw new HttpError(502, "报告格式出错，请重试", `verdict 非法: ${report.verdict}`);
  }
  if (!CARD_TYPE_ENUM.includes(report.card_type)) {
    throw new HttpError(502, "报告格式出错，请重试", `card_type 非法: ${report.card_type}`);
  }

  const rawDirection =
    report.direction && typeof report.direction === "object" ? report.direction : {};
  const rawDirectionSummary = str(rawDirection.summary).trim();
  const direction = {
    summary: rawDirectionSummary.includes("用你自己的话说")
      ? rawDirectionSummary
      : `${rawDirectionSummary ? `${rawDirectionSummary}。` : "先按本轮关键方向修改，"}用你自己的话说`,
    examples: Array.isArray(rawDirection.examples)
      ? rawDirection.examples
          .filter((x) => typeof x === "string")
          .map((x) => Array.from(x.trim()).slice(0, 25).join(""))
          .filter(Boolean)
          .slice(0, 3)
      : [],
  };

  // 不相信模型给出的顺序与完整性：按固定 key 重建恰好五项。
  // 缺项或非法 status 一律按 missing 处理，保证不会误放 passed。
  const structureByKey = new Map();
  if (Array.isArray(report.structure_checks)) {
    for (const item of report.structure_checks) {
      if (!item || typeof item !== "object") continue;
      if (!STRUCTURE_CHECK_KEYS.includes(item.key) || structureByKey.has(item.key)) continue;
      structureByKey.set(item.key, item);
    }
  }
  const structureChecks = STRUCTURE_CHECK_KEYS.map((key) => {
    const item = structureByKey.get(key);
    const status = STRUCTURE_STATUS_ENUM.includes(item && item.status) ? item.status : "missing";
    const evidenceRaw = str(item && item.evidence)
      .trim()
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/\s+/g, " ");
    return {
      key,
      status,
      evidence:
        Array.from(evidenceRaw).slice(0, LIMITS.structureEvidenceMax).join("") ||
        "未提供有效证据",
    };
  });

  let normalizedAiFlavor = str(report.ai_flavor).trim();
  if (typeof sourceScript === "string" && (report.card_type === "persona" || normalizedAiFlavor)) {
    const sourcePhrases = AI_FLAVOR_SOURCE_PHRASES.filter((phrase) => sourceScript.includes(phrase));
    const missingPhrases = sourcePhrases.filter((phrase) => !normalizedAiFlavor.includes(phrase));
    if (sourcePhrases.length >= 2 && missingPhrases.length > 0) {
      const namedPhrases = sourcePhrases.slice(0, 2).map((phrase) => `“${phrase}”`).join("、");
      normalizedAiFlavor = `${normalizedAiFlavor ? `${normalizedAiFlavor}；` : ""}原稿里的${namedPhrases}都是谁念都一样的舞台腔`;
    }
  }

  const normalized = {
    card_type: report.card_type,
    card_why: str(report.card_why),
    audience: str(report.audience),
    round_dynamics: roundDynamics,
    structure_checks: structureChecks,
    verdict: report.verdict,
    verdict_reason: str(report.verdict_reason),
    echo: str(report.echo),
    line_reviews: effectiveLineReviews.map((r) => ({
      original: str(r && r.original),
      mark: MARK_ENUM.includes(r && r.mark) ? r.mark : "partial",
      comment: str(r && r.comment),
    })),
    one_thing: str(report.one_thing),
    direction,
    ai_flavor: normalizedAiFlavor,
    redline_note: str(report.redline_note),
  };

  // 内部安全元数据不进入 JSON 响应、不进入案例 value，也不增加前端契约字段。
  Object.defineProperty(normalized, "_lineReviewsContractValid", {
    value: lineReviewsContractValid,
    enumerable: false,
  });
  Object.defineProperty(normalized, "_structureContractValid", {
    value: structureContractValid,
    enumerable: false,
  });
  Object.defineProperty(normalized, "_safetyFieldsContractValid", {
    value: safetyFieldsContractValid,
    enumerable: false,
  });
  Object.defineProperty(normalized, "_roundDynamicsContractValid", {
    value: roundDynamicsContractValid,
    enumerable: false,
  });
  return normalized;
}

/** 带状态码的内部错误类型，publicMessage 是给用户看的文案 */
class HttpError extends Error {
  constructor(status, publicMessage, logMessage) {
    super(logMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

/**
 * 统一 JSON 响应助手（沿用 wardrobe 模式）。
 * @param {object} data - 响应体
 * @param {number} status - HTTP 状态码
 * @param {object} corsHeaders - CORS 头（所有出口统一带上）
 */
function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}
