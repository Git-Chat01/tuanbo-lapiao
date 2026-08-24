// 团播拉票话术教练 v3 — Cloudflare Worker
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

// 基础票况枚举；v3 可再附加可选现场情境。
const VOTE_GAP_ENUM = ["far", "close", "secured"];

// 文本长度限制（前后端双重限制，后端兜底）
const LIMITS = {
  scriptMin: 20, // 话术最短 20 字（少于这个没法批）
  scriptMax: 500, // 批改话术上限：500 字逐句点评已逼近 max_tokens 3000，再长 JSON 会截断（502）
  feedScriptMax: 800, // 投喂话术上限（1.6×）：投喂只存 KV 不调模型，可以更长
  whyGoodMin: 1, // 投喂理由必填——"为什么好"是 manual 案例的灵魂（给 AI 的判断尺子）
  whyGoodMax: 320, // 投喂理由上限（1.6×200）：给 AI 的判断尺子，太长检索时也读不动
  structureEvidenceMax: 80, // 五项结构证据只保留短句，避免模型在证据栏写小作文
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

// 可选现场情境只接受这些字段。未知字段直接丢弃；已知字段类型/范围非法则 400。
const SCENARIO_NUMBER_LIMITS = {
  secondsLeft: 3600, // 团播倒计时按最多 1 小时兜底
  votesNeeded: 10000000,
};
const SCENARIO_TEXT_LIMITS = {
  id: 64,
  hostCue: 160,
  targetUser: 80,
  userSignal: 160,
  recentGift: 120,
  trainingGoal: 120,
};
const SCENARIO_FIELD_ORDER = [
  "id",
  "secondsLeft",
  "votesNeeded",
  "hostCue",
  "targetUser",
  "userSignal",
  "recentGift",
  "trainingGoal",
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

const TARGET_INTERACTION_PATTERN =
  /你(?:要|愿|想|说|刚|都|会|还|能)|要不要|愿不愿|考虑|扣(?:个|一)|打个|补(?:一|几|票|上)|上票|投票|给我|冲(?:啊|一|起来|票)|跟上|帮我|求求|偏心|返场|算不算|别(?:装|可怜)|喜欢|点舞|点个|整活|接不接|看我|想看/u;
const TARGET_INTERACTION_START_PATTERN =
  /^(?:你(?!们)|刚才(?:主持说)?你(?!们)|要是你(?!们)|如果你(?!们)|假如你(?!们)|这个(?:新舞|节目|整活)?你(?!们)|这支舞你(?!们)|这段(?:舞|表演|才艺)?你(?!们)|主持(?:刚|刚才)?说你(?!们)|那你(?!们)|这轮你(?!们)|现在你(?!们)|接下来你(?!们)|然后你(?!们)|愿意|要不要|想看|觉得|求求你|再偏心|给我|帮我|补|上票|投票|冲|跟上|别(?:装|可怜)|让我们|看我|算不算|喜欢|我给你|我马上)/u;
const GENERIC_TARGET_PATTERN =
  /^(?:大哥|哥哥|小哥哥|帅哥|美女|小美女|靓仔|宝宝|宝贝|宝子|姐姐|小姐姐|大姐|老板|老师|大叔|叔叔|阿姨|哥们|兄弟们?|姐妹们?|老铁|大佬|家人们?|朋友们?|大家|各位|宝宝们?|粉丝们?|观众们?|主持|拜托大家|这一轮|这轮|现在|刚才|谢谢|感谢|我是|我想|我还|我刚|我准备|想看|愿意)/u;
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
];
const POSITIVE_FEEDBACK_PATTERN =
  /(?:公屏|评论区)?(?:扣|打)(?:个)?(?:[01一零]|叉)|(?:给我)?(?:补|上)(?:一|几|点)?(?:票|张|脚)|投(?:一|几|点)?票|评论(?:一下|告诉我|说一声)|公屏(?:说|打|扣)|(?:你(?:来)?选|让你选)(?:一个|节目|舞|歌)?|(?:你(?:来)?决定|由你决定)|跟上(?:一|几|点)?(?:票|张|脚)?|一人(?:补|上)(?:一|几|点)(?:票|张|脚)?/gu;
const NEGATED_ACTION_PREFIX_PATTERN =
  /(?:不|别|没|未|无需|无须|不用|不要|不必|没必要|没有必要|不由|轮不到).{0,3}$/u;
const ENTERTAINMENT_VALUE_PATTERN =
  /(?:撒个?娇|整(?:个)?活|跳(?:舞|一段(?:舞)?|一支(?:舞)?|支舞|一个舞|个舞)|唱(?:歌|一段(?:歌)?|一首(?:歌)?|首歌|一个歌|个歌)|返场|新舞|才艺|表演)/gu;
const NEGATED_ENTERTAINMENT_PREFIX_PATTERN =
  /(?:不|别|没|未|不会|不想|不愿|不要|不能|不打算|拒绝|不再|并非|不是).{0,6}$/u;

function hasPositiveFeedbackAction(text) {
  POSITIVE_FEEDBACK_PATTERN.lastIndex = 0;
  for (const action of String(text || "").matchAll(POSITIVE_FEEDBACK_PATTERN)) {
    const prefix = String(text || "")
      .slice(Math.max(0, action.index - 8), action.index)
      .replace(/\s+/g, "");
    if (NEGATED_ACTION_PREFIX_PATTERN.test(prefix)) continue;
    return true;
  }
  return false;
}

function hasPositiveEntertainmentContext(text) {
  const source = String(text || "");
  ENTERTAINMENT_VALUE_PATTERN.lastIndex = 0;
  for (const cue of source.matchAll(ENTERTAINMENT_VALUE_PATTERN)) {
    const prefix = source
      .slice(Math.max(0, cue.index - 10), cue.index)
      .replace(/\s+/g, "");
    const suffix = source
      .slice(cue.index + cue[0].length, cue.index + cue[0].length + 8)
      .replace(/\s+/g, "")
      .replace(/^[，,。.!！？?；;：:“”"'（）()]+/u, "");
    if (NEGATED_ENTERTAINMENT_PREFIX_PATTERN.test(prefix)) continue;
    if (/^(?:才怪|不可能|不行|算了|没门|免了)/u.test(suffix)) continue;
    return true;
  }
  return false;
}

function splitHardSentences(value) {
  const matches = String(value || "").match(
    /[^。！？!?；;.]+(?:[。！？!?；;.]+[”’"'）】》]*)?|[。！？!?；;.]+[”’"'）】》]*/gu
  );
  return (matches || []).filter((item) => item.trim().length > 0);
}

function hasInteractiveAddressBody(rawBody, target) {
  const body = String(rawBody || "").replace(/^[，,:：\s]+/u, "").trim();
  if (!body) return false;

  // 只说“谢谢你刚才送礼”仍属于感谢项；感谢之后又继续递动作，才算真的 Q 到。
  if (/^(?:谢谢|感谢|多谢)/u.test(body)) {
    let nextTurn = (body.match(/[，,；;](.+)$/u)?.[1] || "").trim();
    if (!nextTurn) return false;
    if (target && nextTurn.startsWith(target)) {
      nextTurn = nextTurn.slice(target.length).replace(/^[，,:：\s]+/u, "");
    }
    // 后续若转向家人们或另一个昵称，下面的受限开头校验会拒绝。
    return TARGET_INTERACTION_START_PATTERN.test(nextTurn) && TARGET_INTERACTION_PATTERN.test(nextTurn);
  }

  // 非感谢句也必须让动作紧接在这个对象后面，不能借前面的名字承接后方群体动作。
  return TARGET_INTERACTION_START_PATTERN.test(body) && TARGET_INTERACTION_PATTERN.test(body);
}

function freeModeTargetToken(segment, hasFollowingSegment) {
  const text = String(segment || "").trim();
  if (!text || GENERIC_TARGET_PATTERN.test(text)) return "";

  const atTarget = text.match(/^@[\p{L}\p{N}_·-]{1,24}/u)?.[0];
  if (atTarget) return atTarget;

  const rankTarget = text.match(/^榜(?:一|二|三|1|2|3)(?:大哥|哥|姐姐|姐)?/u)?.[0];
  if (rankTarget) return rankTarget;

  const titledTarget = text.match(
    /^[\p{L}\p{N}_·-]{1,10}(?:哥|姐|爷|叔|姨|总|老板|老师)/u
  )?.[0];
  if (titledTarget && !GENERIC_TARGET_PATTERN.test(titledTarget)) return titledTarget;

  // 没有固定后缀的昵称只在“昵称，后续互动”这种直接呼语里接受。
  if (hasFollowingSegment && /^[\p{L}\p{N}_·-]{1,10}$/u.test(text)) return text;
  return "";
}

function hasConcreteTargetAddress(sourceScript, scenarioTarget = "") {
  const requiredTarget = String(scenarioTarget || "").trim();

  for (const sentence of splitHardSentences(sourceScript)) {
    const segments = sentence.split(/[，,:：]/u).map((item) => item.trim());
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment) continue;

      let target = "";
      if (requiredTarget) {
        if (!segment.startsWith(requiredTarget)) continue;
        if (segment.slice(requiredTarget.length).startsWith("们")) continue;
        target = requiredTarget;
      } else {
        target = freeModeTargetToken(segment, index < segments.length - 1);
      }
      if (!target) continue;

      const body = [segment.slice(target.length), ...segments.slice(index + 1)].join("，");
      if (hasInteractiveAddressBody(body, target)) return true;
    }
  }
  return false;
}

function hasUnnegatedSignal(sourceScript, term) {
  let fromIndex = 0;
  while (fromIndex < sourceScript.length) {
    const index = sourceScript.indexOf(term, fromIndex);
    if (index < 0) return false;
    const prefix = sourceScript.slice(Math.max(0, index - 5), index).replace(/\s+/g, "");
    if (!/(?:不|别|不要|不用|才不|绝不|并不|不是|不想)$/u.test(prefix)) return true;
    fromIndex = index + term.length;
  }
  return false;
}

function hasExplicitViewerReasonWithFeedback(sourceScript) {
  const reasonPattern =
    /(?:你|家人们?|大家|榜(?:一|二|三|1|2|3)|@[\p{L}\p{N}_·-]+|[\p{L}\p{N}_·-]{1,8}(?:哥|姐)).{0,12}(?:想看|愿意看).{0,12}(?:新舞|返场|跳完|才艺|表演|整活)/gu;
  const negativePattern = /(?:不|别|没|未|并不|不太|不怎么).{0,3}(?:想看|愿意看)|不愿意看/gu;

  for (const sentence of splitHardSentences(sourceScript)) {
    negativePattern.lastIndex = 0;
    const negativeRanges = Array.from(sentence.matchAll(negativePattern))
      .filter((match) => {
        const previous = sentence.slice(Math.max(0, match.index - 1), match.index);
        // “想不想看 / 愿不愿意看”是互动提问，不是负面信号。
        return !(
          (previous === "想" && match[0].includes("不想看")) ||
          (previous === "愿" && match[0].includes("不愿意看"))
        );
      })
      .map((match) => [match.index, match.index + match[0].length]);
    reasonPattern.lastIndex = 0;
    for (const match of sentence.matchAll(reasonPattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const overlapsNegative = negativeRanges.some(
        ([negativeStart, negativeEnd]) => negativeStart < end && negativeEnd > start
      );
      if (overlapsNegative) continue;
      if (hasPositiveFeedbackAction(sentence.slice(end))) return true;
    }
  }
  return false;
}

function hasExplicitUserValueCue(sourceScript) {
  const patterns = [
    /(?:复活后|上票后|过了以后).{0,12}(?:你)?(?:点舞|点歌|点节目|选节目|提要求)/u,
    /你(?:来)?点(?:舞|歌|节目)|你来选|你说跳什么|你定(?:节目|舞|歌|数量|几张|要不要)|你定(?=[。！？!?；;]|$)/u,
    /你(?:上几张|说个数|说了算|来决定|自己定|愿意上多少|看着补)/u,
    /满意(?:了|的话)?(?:你)?再(?:补|上票|上(?:一|几|点)(?:票|张|脚)?)|不满意.{0,8}(?:不补|打叉|再说)/u,
  ];
  for (const pattern of patterns) {
    const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`);
    for (const match of sourceScript.matchAll(matcher)) {
      const prefix = sourceScript
        .slice(Math.max(0, match.index - 8), match.index)
        .replace(/\s+/g, "");
      const suffix = sourceScript
        .slice(match.index + match[0].length, match.index + match[0].length + 8)
        .replace(/\s+/g, "")
        .replace(/^[，,。.!！？?；;：:“”"'（）()]+/u, "");
      if (NEGATED_ACTION_PREFIX_PATTERN.test(prefix)) continue;
      if (/^(?:才怪|不算|不行|没用|也没用|都是假的|逗你的)/u.test(suffix)) continue;
      return true;
    }
  }
  return splitHardSentences(sourceScript).some(
    (sentence) =>
      hasPositiveEntertainmentContext(sentence) && hasPositiveFeedbackAction(sentence)
  );
}

/**
 * 对模型报告应用后端硬规则。
 * - 红线：无论模型原判 passed/almost/off，一律 off。
 * - 人设/AI 味：不得 passed，按不合格稿降为 off。
 * - 五项结构未全 met 或逐句仍有 wrong：passed 降为 almost。
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

  // “Q 用户”是毕业硬门槛：必须直接喊到正确对象，并在同一句继续递互动或上票动作。
  // 只在感谢里提到名字、喊泛称、或 Q 到 scenario 之外的人都不算完成。
  const targetCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "target_user")
    : null;
  if (sourceScript && targetCheck && targetCheck.status === "met") {
    const scenarioTarget = typeof scenario?.targetUser === "string"
      ? scenario.targetUser.trim()
      : "";
    if (!hasConcreteTargetAddress(sourceScript, scenarioTarget)) {
      targetCheck.status = "partial";
      targetCheck.evidence = scenarioTarget
        ? `还没有直接喊到${scenarioTarget}并递出互动动作`
        : "还没有直接喊到一个可识别用户并递出互动动作";
    }
  }

  const userReasonCheck = Array.isArray(report.structure_checks)
    ? report.structure_checks.find((item) => item && item.key === "user_reason")
    : null;
  if (
    sourceScript &&
    userReasonCheck?.status === "partial" &&
    hasExplicitViewerReasonWithFeedback(sourceScript)
  ) {
    // 明确把“你想看的具体节目/返场”与动作连起来，本身就是用户侧支点；
    // 同一句还必须有评论/选择/上票等反馈动作；单纯提问或否定语境不能触发校正。
    userReasonCheck.status = "met";
  }
  const hasSupportEvidence = userReasonCheck?.status === "met";

  // 撒娇或“求你啦”只是一种表现形式。三种以上强卖惨信号直接判方向错误；
  // 两种信号只有在原稿没有可独立验证的用户交换价值时才拦，不能循环信任模型 status。
  if (sourceScript) {
    const unquotedScript = sourceScript.replace(/“[^”]*”|"[^"]*"/gu, "");
    const pleadingSignals = [
      "求求你",
      "求求大家",
      "求求家人",
      "可怜我",
      "帮帮我",
      "不想被淘汰",
      "救救我",
    ].filter((term) => hasUnnegatedSignal(unquotedScript, term)).length;
    const hasExplicitUserValue = hasExplicitUserValueCue(unquotedScript);
    if (pleadingSignals >= 3 || (pleadingSignals >= 2 && !hasExplicitUserValue)) {
      report.verdict = "off";
      report.card_type = "logic";
      report.verdict_reason = `这版把票建立在求情和卖惨上，用户没有得到参与台阶，方向要重新立。${report.verdict_reason || ""}`.trim();
    }
  }

  const allStructureMet =
    Array.isArray(report.structure_checks) &&
    report.structure_checks.length === STRUCTURE_CHECK_KEYS.length &&
    report.structure_checks.every(
      (item, index) =>
        item && item.key === STRUCTURE_CHECK_KEYS[index] && item.status === "met"
    );
  const wrongCount = Array.isArray(report.line_reviews)
    ? report.line_reviews.filter((item) => item && item.mark === "wrong").length
    : 0;
  const hasWrong = wrongCount > 0;
  // user_reason=met 已经代表她给出了站在用户角度的上票理由，可作为支点硬证据。
  const structureGapCount = Array.isArray(report.structure_checks)
    ? report.structure_checks.filter((item) => !item || item.status !== "met").length
    : STRUCTURE_CHECK_KEYS.length;
  const lineReviewsContractValid = report._lineReviewsContractValid === true;
  const structureContractValid = report._structureContractValid === true;
  const safetyFieldsContractValid = report._safetyFieldsContractValid === true;
  const qualifiesForPassed =
    allStructureMet &&
    hasSupportEvidence &&
    !hasWrong &&
    lineReviewsContractValid &&
    structureContractValid &&
    safetyFieldsContractValid &&
    !hasPersonaIssue &&
    !hasDetectedRedline &&
    !hasReportedRedline;

  if (report.verdict === "passed") {
    if (!allStructureMet || !hasSupportEvidence || hasWrong || !lineReviewsContractValid || !structureContractValid || !safetyFieldsContractValid) {
      report.verdict = "almost";
      const issues = [];
      if (!allStructureMet) issues.push("五项结构还没齐");
      if (allStructureMet && !hasSupportEvidence) issues.push("还没有有效上票支点");
      if (hasWrong) issues.push("还有站错角度的句子");
      if (!lineReviewsContractValid) issues.push("逐句判断还不完整");
      if (!structureContractValid) issues.push("五项结构证据还不完整");
      if (!safetyFieldsContractValid) issues.push("安全字段还不完整");
      report.verdict_reason = `${issues.join("，")}，先补好再过关。${report.verdict_reason || ""}`.trim();
    }
  }

  // 没有用户支点且同时缺两项以上，说明不是一句局部修改能救回来的稿子。
  // 一项局部缺口仍保留 almost，避免把正在形成正确思路的新人直接打回不合格。
  if (
    report.verdict === "almost" &&
    !hasSupportEvidence &&
    (structureGapCount >= 2 || wrongCount >= 2)
  ) {
    report.verdict = "off";
    report.verdict_reason = `这版还没有站到用户角度，而且不止一处需要重做，先把上票支点和整体方向重新立住。${report.verdict_reason || ""}`.trim();
  }

  // 文字毕业门槛是机械规则，不是模型的审美打分。若模型只因“还能更好”给 almost，
  // 但五项、支点、逐句证据和安全门槛均已满足，后端必须稳定晋级为 passed。
  if (report.verdict === "almost" && qualifiesForPassed) {
    report.verdict = "passed";
    report.verdict_reason = "五项结构齐全，上票理由落到了用户身上，逐句没有站错角度，这版达到文字稿门槛。";
  }

  // 同一份稿在不同票况下必须给新人不同策略锚点，避免模型偶尔输出通用点评。
  // 仅在模型漏掉对应语义时补一句，不覆盖它已经给出的具体判断。
  if (report.direction && typeof report.direction.summary === "string") {
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

    if (Object.prototype.hasOwnProperty.call(SCENARIO_NUMBER_LIMITS, key)) {
      const max = SCENARIO_NUMBER_LIMITS[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
        throw new HttpError(400, "现场情境里的数字不合法", `scenario.${key} 超出范围`);
      }
      cleaned[key] = value;
      continue;
    }

    if (typeof value !== "string") {
      throw new HttpError(400, "现场情境里的文字格式不对", `scenario.${key} 非字符串`);
    }
    const compact = value
      .trim()
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/\s+/g, " ");
    if (!compact) continue;
    if (compact.length > SCENARIO_TEXT_LIMITS[key]) {
      throw new HttpError(400, "现场情境文字太长了", `scenario.${key} 超长`);
    }
    cleaned[key] = compact;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
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
  const reviewedScript = rawLineReviews
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
    rawLineReviews.map((item) => (item && typeof item.original === "string" ? item.original : ""))
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
    structure_checks: structureChecks,
    verdict: report.verdict,
    verdict_reason: str(report.verdict_reason),
    echo: str(report.echo),
    line_reviews: rawLineReviews.map((r) => ({
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
