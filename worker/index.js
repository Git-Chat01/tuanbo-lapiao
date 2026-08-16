// 团播拉票话术教练 — Cloudflare Worker
// 职责：CORS → 入口码鉴权 → 参数白名单校验 → 调 DeepSeek → 返回结构化批改报告
// 安全设计沿用 cide wardrobe-api-v2 的模式：Origin 白名单回显、fail-closed 鉴权、
// 统一 {error:true, message} 错误结构。
// 注意：所有错误响应都由入口统一 jsonResponse 构造，保证 CORS 头始终存在
// （浏览器侧缺 CORS 头时连错误文案都读不到，前端只能显示"网络错误"）。

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

// CORS Origin 白名单：命中则回显该 Origin，未命中回退到第一个
// （CORS 只约束浏览器跨域读响应，真正的安全门槛是入口码，不是这里）
const ALLOWED_ORIGINS = [
  "https://git-chat01.github.io", // GitHub Pages 默认域名（自定义域名上线后追加）
  "http://127.0.0.1:8080", // 本地前端联调
  "http://localhost:8080",
];

// 场况枚举白名单——前端传英文枚举值，这里逐项校验，不信任任何自由输入
const ENUMS = {
  voteGap: ["far", "close", "secured"],
  timeLeft: ["early", "counting", "final"],
  host: ["pressuring", "cooperative", "neutral", "challenging"],
  chat: ["quiet", "hype", "doubt", "waiting", "leading"],
  rivalVotes: ["ahead", "close", "behind"],
  rivalFans: ["separate", "poachable", "hostile"],
};

// 文本长度限制（前后端双重限制，后端兜底）
const LIMITS = {
  scriptMin: 20, // 话术最短 20 字（少于这个没法批）
  scriptMax: 500,
  noteMax: 50,
  bodyMaxBytes: 10 * 1024, // 请求体上限 10KB，防超大 payload
};

// DeepSeek 调用参数
const DEEPSEEK_CONFIG = {
  url: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  temperature: 0.7,
  // 教训（2026-08-16）：话术接近 500 字时逐句点评输出会逼近 1200 token 上限，
  // 触发 JSON 截断 → 502"报告格式出错"。上限提到 3000（max_tokens 是上限，
  // 成本按实际输出计，短话术不更贵；500 字话术最坏约 ¥0.03/次，可接受）
  maxTokens: 3000,
  timeoutMs: 45000, // 输出更长耗时更久；前端 60s，此处留 15s 余量
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    // CORS 预检：入口顶部先处理，避免后面的业务逻辑拦到 OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 健康检查：不碰 DeepSeek，用于验证部署成功与 CORS 正确
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "tuanbo-lapiao-coach" }, 200, corsHeaders);
    }

    // 唯一业务接口：POST /api/coach
    if (request.method !== "POST" || url.pathname !== "/api/coach") {
      return jsonResponse({ error: true, message: "接口不存在" }, 404, corsHeaders);
    }

    const startedAt = Date.now();
    try {
      // ---- 1. 请求体大小与 JSON 解析 ----
      const raw = await request.text();
      if (raw.length > LIMITS.bodyMaxBytes) {
        return jsonResponse({ error: true, message: "内容太长，精简一下" }, 400, corsHeaders);
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return jsonResponse({ error: true, message: "请求格式不对" }, 400, corsHeaders);
      }

      // ---- 2. 入口码鉴权（fail-closed）----
      const authError = checkAccessCode(body, env);
      if (authError) return jsonResponse({ error: true, message: authError.message }, authError.status, corsHeaders);

      // ---- 3. 参数白名单校验 ----
      const paramsError = validateParams(body);
      if (paramsError) return jsonResponse({ error: true, message: paramsError.message }, paramsError.status, corsHeaders);

      // ---- 4. 调 DeepSeek 批改 ----
      const result = await callDeepSeek(env, body);

      // 日志只记元信息，不记入口码与话术全文（学员内容隐私 + 省日志成本）
      console.log(
        `coach ok: ${Date.now() - startedAt}ms, ` +
          `tokens in=${result.usage.prompt_tokens} out=${result.usage.completion_tokens}`
      );
      return jsonResponse({ ok: true, report: result.report, usage: result.usage }, 200, corsHeaders);
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
 * 参数校验：所有枚举值白名单校验 + 文本长度限制。
 * 前端已做同样限制，这里兜底——不信任客户端。
 * @returns {{status:number, message:string}|null} 校验通过返回 null
 */
function validateParams(body) {
  const bad = (message) => ({ status: 400, message });

  // 场况结构
  const stage = body.stage;
  if (!stage || typeof stage !== "object") return bad("场况信息不完整");
  if (!ENUMS.voteGap.includes(stage.voteGap)) return bad("场况信息不合法");
  if (!ENUMS.timeLeft.includes(stage.timeLeft)) return bad("场况信息不合法");

  // 多选数组（可空数组，元素必须在枚举内、数量封顶）
  const multiOk = (arr, enumList) =>
    Array.isArray(arr) && arr.length <= 5 && arr.every((x) => enumList.includes(x));
  if (!multiOk(body.host, ENUMS.host)) return bad("场况信息不合法");
  if (!multiOk(body.chat, ENUMS.chat)) return bad("场况信息不合法");

  // 别家情况
  const rival = body.rival;
  if (!rival || typeof rival !== "object") return bad("场况信息不完整");
  if (!ENUMS.rivalVotes.includes(rival.votes)) return bad("场况信息不合法");
  if (!ENUMS.rivalFans.includes(rival.fans)) return bad("场况信息不合法");

  // 自由补充（可空字符串）
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > LIMITS.noteMax)) {
    return bad("补充内容太长");
  }

  // 话术
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
 * 调 DeepSeek：非流式 + JSON mode，30 秒超时。
 * 错误分类：上游非 2xx → 502；输出解析失败 → 502；超时 → 504。
 */
async function callDeepSeek(env, body) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new HttpError(503, "服务未配置", "DeepSeek key 未配置");
  }

  const userPrompt = buildUserPrompt(
    body.stage,
    body.host,
    body.chat,
    body.rival,
    body.note || "",
    body.script
  );

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
