// 团播拉票话术教练 v2 — Cloudflare Worker
// 职责：CORS → 鉴权 → 参数白名单校验 → 红线检测 → 检索案例 → 调 DeepSeek
//       → 契约校验 → 红线/吸收闸门 → 返回结构化批改报告 + 教练后台管理接口
// 安全设计沿用 cide wardrobe-api-v2 的模式：Origin 白名单回显、fail-closed 鉴权、
// 统一 {error:true, message} 错误结构。
// 注意：所有错误响应都由入口统一 jsonResponse 构造，保证 CORS 头始终存在
// （浏览器侧缺 CORS 头时连错误文案都读不到，前端只能显示"网络错误"）。

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { retrieveCases, tryAbsorb, addManualCase, listAdminCases, softDeleteCase } from "./cases.js";
import { detectRedline } from "./redlines.js";

// CORS Origin 白名单：命中则回显该 Origin，未命中回退到第一个
// （CORS 只约束浏览器跨域读响应，真正的安全门槛是入口码/管理密码，不是这里）
const ALLOWED_ORIGINS = [
  "https://git-chat01.github.io", // GitHub Pages
  "http://127.0.0.1:8080", // 本地前端联调
  "http://localhost:8080",
];

// v2 唯一保留的场况枚举（主播零思考的事实性选择）
const VOTE_GAP_ENUM = ["far", "close", "secured"];

// 文本长度限制（前后端双重限制，后端兜底）
const LIMITS = {
  scriptMin: 20, // 话术最短 20 字（少于这个没法批）
  scriptMax: 500,
  whyGoodMin: 1, // 投喂理由必填——"为什么好"是 manual 案例的灵魂（给 AI 的判断尺子）
  whyGoodMax: 200,
  bodyMaxBytes: 10 * 1024, // 请求体上限 10KB，防超大 payload
};

// 批改报告的枚举白名单（不信任模型输出，逃逸枚举 → 502 让前端重试）
const VERDICT_ENUM = ["passed", "almost", "off"];
const CARD_TYPE_ENUM = ["logic", "expression", "mentality", "persona"];
const MARK_ENUM = ["good", "partial", "wrong"];

// DeepSeek 调用参数
const DEEPSEEK_CONFIG = {
  url: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  // 0.7 时模型每次批同一篇稿都在换新挑剔点（好稿被反复判 almost），
  // 降到 0.3 锚定 prompt 判定规则——批改质量靠规则不靠随机发挥
  temperature: 0.3,
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

      // 红线检测（纯词表，不调模型）——命中不拒批，作用在判定与吸收两个闸门
      const redlineHits = detectRedline(body.script);

      // 检索参照案例：失败降级 cases=[] 继续批（批改是主价值，案例是增量）
      let cases = [];
      try {
        cases = await retrieveCases(env, { voteGap: body.voteGap, script: body.script });
      } catch (err) {
        console.log(`cases retrieve fail (degraded): ${err.message}`);
      }

      // 调 DeepSeek 批改
      const result = await callDeepSeek(env, {
        voteGap: body.voteGap,
        script: body.script,
        cases,
        redlineHits,
      });

      // 契约校验 + 缺失字段补默认值
      const report = normalizeReport(result.report);

      // 红线硬规则：一票否决作用在过关上，且横幅必须显示
      if (redlineHits.length > 0) {
        // 模型判 passed 也要强制改 off（绝不发过关页）
        if (report.verdict === "passed") {
          report.verdict = "off";
          report.verdict_reason = `里面有踩红线的词，先改掉。${report.verdict_reason}`.trim();
        }
        // 实测模型会漏写 redline_note——横幅是主播唯一能看到哪句不能播的通道，硬兜底
        if (!report.redline_note) {
          report.redline_note = `稿子里出现了不能播的词：${redlineHits.join("、")}，先改掉再谈过关。`;
        }
      }

      // 吸收闸门：只有「过关 + 无红线 + 非人设卡」的稿子才自动进案例库
      // （坏方向/AI 味/违规稿永不进库，防"弱智 AI 教弱智 AI"的恶性循环）
      if (report.verdict === "passed" && redlineHits.length === 0 && report.card_type !== "persona") {
        ctx.waitUntil(
          (async () => {
            try {
              const id = await tryAbsorb(env, {
                script: body.script,
                voteGap: body.voteGap,
                report,
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

/**
 * 教练后台管理接口（header X-Admin-Code 鉴权，GET/DELETE 不方便带 body，统一走 header）。
 * 路由：POST/GET /api/admin/cases、DELETE /api/admin/cases/{id}
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
 * 主播批改参数校验（v2 极简）：票况枚举 + 话术长度。
 * 前端已做同样限制，这里兜底——不信任客户端。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function validateParams(body) {
  const bad = (message) => ({ status: 400, message });

  if (!body || typeof body !== "object") return bad("请求格式不对");
  if (!VOTE_GAP_ENUM.includes(body.voteGap)) return bad("票数情况不合法");

  const script = body.script;
  if (typeof script !== "string" || script.trim().length < LIMITS.scriptMin) {
    return bad("话术太短了，至少写一句完整的话");
  }
  if (script.length > LIMITS.scriptMax) {
    return bad("话术太长，精简到 500 字以内");
  }
  return null;
}

/**
 * 投喂参数校验：票况枚举 + 话术长度 + 为什么好（必填——manual 案例的灵魂）。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function validateManual(body) {
  const base = validateParams(body);
  if (base) return base;

  const whyGood = body.whyGood;
  if (typeof whyGood !== "string" || whyGood.trim().length < LIMITS.whyGoodMin) {
    return { status: 400, message: "填一下为什么好——这是给 AI 的判断尺子" };
  }
  if (whyGood.length > LIMITS.whyGoodMax) {
    return { status: 400, message: "为什么好写太长了，精简到 200 字以内" };
  }
  return null;
}

/**
 * 调 DeepSeek：非流式 + JSON mode，45 秒超时。
 * 错误分类：上游非 2xx → 502；输出解析失败 → 502；超时 → 504。
 * @param {object} env
 * @param {{voteGap:string, script:string, cases:object[], redlineHits:string[]}} params
 * @returns {Promise<{report:object, usage:{prompt_tokens:number, completion_tokens:number}}>}
 */
async function callDeepSeek(env, { voteGap, script, cases, redlineHits }) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new HttpError(503, "服务未配置", "DeepSeek key 未配置");
  }

  const userPrompt = buildUserPrompt(voteGap, script, cases, redlineHits);

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
 * @returns {object} 归一化后的报告（字段齐全、枚举合法）
 */
function normalizeReport(report) {
  const str = (v, d = "") => (typeof v === "string" ? v : d);

  if (!VERDICT_ENUM.includes(report.verdict)) {
    throw new HttpError(502, "报告格式出错，请重试", `verdict 非法: ${report.verdict}`);
  }
  if (!CARD_TYPE_ENUM.includes(report.card_type)) {
    throw new HttpError(502, "报告格式出错，请重试", `card_type 非法: ${report.card_type}`);
  }

  const direction =
    report.direction && typeof report.direction === "object"
      ? {
          summary: str(report.direction.summary),
          examples: Array.isArray(report.direction.examples)
            ? report.direction.examples.filter((x) => typeof x === "string").slice(0, 3)
            : [],
        }
      : { summary: "", examples: [] };

  return {
    card_type: report.card_type,
    card_why: str(report.card_why),
    audience: str(report.audience),
    verdict: report.verdict,
    verdict_reason: str(report.verdict_reason),
    echo: str(report.echo),
    line_reviews: report.line_reviews.map((r) => ({
      original: str(r && r.original),
      mark: MARK_ENUM.includes(r && r.mark) ? r.mark : "partial",
      comment: str(r && r.comment),
    })),
    one_thing: str(report.one_thing),
    direction,
    ai_flavor: str(report.ai_flavor),
    redline_note: str(report.redline_note),
  };
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
