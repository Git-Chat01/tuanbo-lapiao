#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const BASE = new URL(process.env.BASE || "http://127.0.0.1:8787");
const TEMPLATE_FILE = process.env.TEMPLATE_FILE || process.argv[2];

if (!LOOPBACK_HOSTS.has(BASE.hostname)) {
  throw new Error("安全拒绝：范本体验只允许连接本机 Worker");
}
if (!TEMPLATE_FILE) {
  throw new Error("请通过 TEMPLATE_FILE 指定 UTF-8 范本文件");
}

async function localAccessCode() {
  if (process.env.ACCESS_CODE) return process.env.ACCESS_CODE;
  const raw = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const line = raw
    .split(/\r?\n/u)
    .find((item) => item.trim().startsWith("ACCESS_CODE="));
  if (!line) throw new Error("本地 .dev.vars 缺少 ACCESS_CODE");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/gu, "");
}

const raw = await readFile(TEMPLATE_FILE, "utf8");
const scripts = raw
  // 范本之间至少空两行；同一新人内部允许用一个空行分拍。
  .split(/(?:\r?\n[ \t]*){3,}/u)
  .map((item) => item.trim())
  .filter(Boolean);

if (scripts.length !== 3) {
  throw new Error(`预期 3 段范本，实际拆出 ${scripts.length} 段`);
}

const accessCode = await localAccessCode();
const labels = ["跳跳糖", "虎子大王", "泡芙"];
const requestedIndex = process.argv[3] ? Number(process.argv[3]) - 1 : null;
const selectedIndexes = Number.isInteger(requestedIndex)
  ? [requestedIndex]
  : scripts.map((_, index) => index);
if (selectedIndexes.some((index) => index < 0 || index >= scripts.length)) {
  throw new Error("可选的范本序号只能是 1、2 或 3");
}

async function requestReport(script, index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(new URL("/api/coach", BASE), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode, voteGap: "far", script }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(`HTTP ${response.status}: ${payload?.message || "请求失败"}`);
    }
    return { label: labels[index], report: payload.report };
  } finally {
    clearTimeout(timeout);
  }
}

const settled = await Promise.allSettled(
  selectedIndexes.map((index) => requestReport(scripts[index], index))
);

for (let index = 0; index < settled.length; index += 1) {
  const result = settled[index];
  const sourceIndex = selectedIndexes[index];
  if (result.status === "rejected") {
    console.log(JSON.stringify({ label: labels[sourceIndex], error: result.reason?.message || "请求失败" }));
    continue;
  }

  const { label, report } = result.value;
  console.log(
    JSON.stringify({
      label,
      verdict: report.verdict,
      verdict_reason: report.verdict_reason,
      card_type: report.card_type,
      card_why: report.card_why,
      audience: report.audience,
      core: Object.fromEntries(
        report.structure_checks
          .filter((item) => item.key === "user_reason" || item.key === "vote_instruction")
          .map((item) => [item.key, { status: item.status, evidence: item.evidence }])
      ),
      round_dynamics: report.round_dynamics,
      needs_attention: report.line_reviews
        .filter((item) => item.mark !== "good")
        .map((item) => ({ mark: item.mark, original: item.original, comment: item.comment })),
      contract_debug: /逐句判断还不完整/u.test(report.verdict_reason)
        ? report.line_reviews
        : undefined,
      one_thing: report.one_thing,
      direction: report.direction,
    })
  );
}
