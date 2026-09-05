#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const toDataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;

async function loadPromptModule() {
  const source = await readFile(new URL("../worker/prompt.js", import.meta.url), "utf8");
  return import(toDataUrl(source));
}

async function loadIndexModule() {
  let source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
  source = source
    .replace(
      'import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";',
      'const SYSTEM_PROMPT = ""; const buildUserPrompt = () => "";'
    )
    .replace(
      /import \{\s*retrieveCases,\s*tryAbsorb,\s*addManualCase,\s*publishCase,\s*listAdminCases,\s*softDeleteCase,?\s*\} from "\.\/cases\.js";/,
      "const retrieveCases = async () => []; const tryAbsorb = async () => null; const addManualCase = async () => ''; const publishCase = async () => ({ ok: true }); const listAdminCases = async () => ({ items: [] }); const softDeleteCase = async () => false;"
    )
    .replace(
      'import { detectRedline } from "./redlines.js";',
      "const detectRedline = () => [];"
    );
  return import(toDataUrl(source));
}

async function localDeepSeekKey() {
  const raw = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  const line = raw.split(/\r?\n/u).find((item) => item.trim().startsWith("DEEPSEEK_API_KEY="));
  if (!line) throw new Error("本地 .dev.vars 缺少 DEEPSEEK_API_KEY");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/gu, "");
}

const prompt = await loadPromptModule();
const index = await loadIndexModule();
const apiKey = await localDeepSeekKey();

const closingScenario = {
  id: "revival-closing-last-two",
  roleContext: "你是台上正在拉票复活的新人主播",
  phase: "closing",
  goalUnit: "个（1个=价值99票的复活礼物）",
  targetUnits: 28,
  pledgedUnits: 27,
  openRemaining: 1,
  deliveredUnits: 0,
  hostCue: "主持根据组队是否还有希望控制倒计时，尚未发出统一丢票口令。",
  targetUser: "仍在场的观众",
  userSignal: "台下主播连续报最后两个；观众乙在原认领4个上打出加一个。",
  recentGift: "尚未统一丢；观众乙累计认领5个",
  trainingGoal: "识别追加认领并更新为只差1个。",
  timeline: [
    { at: 0, role: "offstage_streamer", kind: "status", speaker: "台下主播A", text: "28个，已占位26个，还差2个。", effect: "revive" },
    { at: 1, role: "viewer", kind: "pledge_increment", speaker: "观众乙", text: "加一个。", effect: "revive" },
    { at: 2, role: "offstage_streamer", kind: "status", speaker: "台下主播B", text: "最后1个了！", effect: "revive" },
  ],
};

const awaitingDropScenario = {
  id: "revival-awaiting-drop-01",
  roleContext: "你是台上正在拉票复活的新人主播",
  phase: "awaiting_drop",
  goalUnit: "个（1个=价值99票的复活礼物）",
  targetUnits: 28,
  pledgedUnits: 28,
  openRemaining: 0,
  deliveredUnits: 1,
  hostCue: "主持尚未发出那就丢；组满后由主持切音乐并统一发令。",
  targetUser: "已占位的复活队伍",
  userSignal: "观众甲未先打字认领，直接送出最后1个；其余27个仍待统一兑现。",
  recentGift: "实际到账1个；其余27个是公开认领",
  trainingGoal: "确认组满、区分占位与到账、等待主持口令。",
  timeline: [
    { at: 0, role: "offstage_streamer", kind: "status", speaker: "台下主播B", text: "最后1个了！", effect: "revive" },
    { at: 1, role: "system", kind: "direct_gift", speaker: "礼物", text: "观众甲直接送出复活礼物×1", effect: "revive" },
    { at: 2, role: "viewer", kind: "chat", speaker: "观众丙", text: "你自己抓了。", effect: "neutral" },
    { at: 3, role: "system", kind: "status", speaker: "组队记录", text: "已占位28个：公开认领27个、已到账1个；其余等待主持统一发令。", effect: "revive" },
  ],
};

const medicalScenario = {
  id: "revival-medical-condition-01",
  roleContext: "你是台上正在拉票复活的新人主播",
  phase: "pledging",
  goalUnit: "个（1个=价值99票的复活礼物）",
  targetUnits: 28,
  pledgedUnits: 23,
  openRemaining: 5,
  deliveredUnits: 0,
  hostCue: "主持尚未发出那就丢。",
  targetUser: "观众丙",
  userSignal: "观众丙的搭子离场后，从条件参与转为报数5。",
  recentGift: "观众丙只认领5个，尚未到账",
  trainingGoal: "接住5个认领，不替离场用户承诺。",
  timeline: [
    { at: 0, role: "system", kind: "status", speaker: "场况", text: "上一轮观众丙和观众乙都给你上过下去票。", effect: "down" },
    { at: 1, role: "viewer", kind: "condition", speaker: "观众丙", text: "观众乙给我就给。", effect: "neutral" },
    { at: 2, role: "offstage_streamer", kind: "chat", speaker: "台下主播A", text: "观众乙离场了。", effect: "neutral" },
    { at: 3, role: "viewer", kind: "chat", speaker: "观众丙", text: "……", effect: "neutral" },
    { at: 4, role: "viewer", kind: "pledge", speaker: "观众丙", text: "5", effect: "revive" },
  ],
};

const unknownRuleScenario = {
  id: "revival-rule-not-announced-01",
  roleContext: "你是刚被刀下、正在等待主持公布本轮变更规则的主播",
  phase: "revival_offer",
  goalUnit: "票（本轮倍率与礼物换算尚未公布）",
  hostCue: "主持明确本轮复活规则要变更，暂不按基础两倍计算；已确认刀票累计1000票，新倍率、目标和取整规则尚待公布。",
  targetUser: "刚参与刀门的观众与仍在场观众",
  userSignal: "有人参与刀门，但没有人说明自己的动机，也没有复活认领。",
  recentGift: "本轮出现1000票刀门票；复活方向尚无到账",
  trainingGoal: "分清已知刀票与未知复活规则，不擅算目标、不替用户定动机。",
  timeline: [
    { at: 0, role: "system", kind: "status", speaker: "场况", text: "本轮刀门累计1000票。", effect: "down" },
    { at: 1, role: "host", kind: "host_cue", speaker: "主持", text: "这轮规则有变，先不按基础两倍算，等我公布。", effect: "neutral" },
  ],
};

const fixtures = [
  {
    id: "closing-good",
    voteGap: "close",
    scenario: closingScenario,
    script: "观众乙刚才原来认了四个，现在又加一个，我接住了。还差最后一个，谁愿意把这个收口位置抓一下，和前面二十七个一起把这一关走完，愿意的帮我认一个。",
    check(report) {
      assert.equal(statusOf(report, "vote_instruction"), "met");
      assert.match(report.round_dynamics.flow_read, /加一|追加|27|最后一/u);
    },
  },
  {
    id: "awaiting-drop-good",
    voteGap: "secured",
    scenario: awaitingDropScenario,
    script: "队伍已经组齐了，这二十八个是大家一起凑起来的，我都记着。先都别提前丢，按刚才各自认领的等主持口令，我们再一起统一丢。",
    check(report) {
      assert.equal(statusOf(report, "vote_instruction"), "met");
      assert.notEqual(report.verdict, "off");
      assert.match(report.round_dynamics.next_move, /主持|口令|统一|兑现/u);
    },
  },
  {
    id: "awaiting-drop-wrong-stage",
    voteGap: "secured",
    scenario: awaitingDropScenario,
    script: "虽然已经组满二十八个了，但还有谁能再来补一个，大家现在直接丢，不用等主持了，我们多拉一点更稳。",
    check(report) {
      assert.notEqual(statusOf(report, "vote_instruction"), "met");
      assert.notEqual(report.verdict, "passed");
      assert.match(`${report.card_why} ${report.verdict_reason}`, /组满|主持|阶段|兑现/u);
    },
  },
  {
    id: "medical-pledge-not-delivery",
    voteGap: "close",
    scenario: medicalScenario,
    script: "观众丙，刚才一起刀的搭子已经走了，你最后还是愿意认五个，我把这五个记上了。现在还剩五个，给还在场的人留位置，愿意一起走完的帮我认一个。",
    check(report) {
      assert.equal(statusOf(report, "vote_instruction"), "met");
      const text = JSON.stringify(report);
      assert.doesNotMatch(text, /观众丙.{0,12}(?:已经送|已经到账|送了五个)/u);
      assert.doesNotMatch(text, /(?:讨厌|不支持).{0,8}(?:主播|你)/u);
      assert.doesNotMatch(text, /观众丙.{0,10}(?:就是|肯定|一定).{0,10}(?:喜欢|讨厌|逗|引起注意)/u);
    },
  },
  {
    id: "unknown-rule-no-invented-math",
    voteGap: "far",
    scenario: unknownRuleScenario,
    script: "刚才这一千票是已经发生的刀门票，主持还没公布这轮复活倍率和目标，我先不替大家算。等规则说清楚，我再按现场接下一拍，也不因为谁刀了我就替他定态度。",
    check(report) {
      const text = JSON.stringify(report);
      assert.doesNotMatch(text, /(?:需要|目标|还差|应为|就是)\s*(?:2000|两千|3000|三千)\s*票/u);
      assert.doesNotMatch(text, /(?:已经|确认|这就是).{0,8}偷塔/u);
      assert.doesNotMatch(text, /(?:刀门|刀票).{0,12}(?:说明|证明|代表).{0,12}(?:讨厌|不支持)/u);
      assert.match(text, /(?:未知|未公布|没公布|不能算|不替.{0,4}算|等.{0,6}规则)/u);
    },
  },
];

function statusOf(report, key) {
  return report.structure_checks.find((item) => item.key === key)?.status;
}

async function requestRaw(fixture) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt.SYSTEM_PROMPT },
          {
            role: "user",
            content: prompt.buildUserPrompt(
              fixture.voteGap,
              fixture.script,
              [],
              [],
              index.sanitizeScenario(fixture.scenario)
            ),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const payload = await response.json();
    return JSON.parse(payload.choices?.[0]?.message?.content || "");
  } finally {
    clearTimeout(timeout);
  }
}

const failures = [];
for (const fixture of fixtures) {
  try {
    const raw = await requestRaw(fixture);
    const report = index.normalizeReport(raw, fixture.script);
    index.applyReportSafetyGates(report, [], {
      sourceScript: fixture.script,
      voteGap: fixture.voteGap,
      scenario: index.sanitizeScenario(fixture.scenario),
    });
    assert.doesNotMatch(
      JSON.stringify(report),
      /(?:\d+|[一二两三四五六七八九十半几])份|多少份|最后一份|份票/u,
      "模型给新人的数量口径必须使用个/手，不能使用份"
    );
    fixture.check(report);
    console.log(JSON.stringify({
      id: fixture.id,
      ok: true,
      verdict: report.verdict,
      card: report.card_type,
      userReason: statusOf(report, "user_reason"),
      action: statusOf(report, "vote_instruction"),
      flow: report.round_dynamics.flow_read,
      next: report.round_dynamics.next_move,
    }));
  } catch (error) {
    failures.push({ id: fixture.id, error: error?.message || String(error) });
    console.log(JSON.stringify({ id: fixture.id, ok: false, error: error?.message || String(error) }));
  }
}

if (failures.length) {
  console.error(JSON.stringify({ result: "FAIL", failures }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ result: "PASS", total: fixtures.length }));
}
