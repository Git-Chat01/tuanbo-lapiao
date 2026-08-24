import http from "node:http";

const PORT = 8787;
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Code",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const candidate = {
  id: "case:absorb:close:demo1234",
  source: "auto",
  status: "candidate",
  script: "我是首播的小满，谢谢凯哥的小心心，凯哥你想看撒娇就补一脚，还差320票。",
  voteGap: "close",
  whyGood: "接住具体用户的当轮信号，并把互动反馈和票数指令连起来。",
  scenario: {
    id: "revival-sajiao-01",
    secondsLeft: 38,
    votesNeeded: 320,
    targetUser: "凯哥",
    userSignal: "你撒个娇，我考虑一下。",
    hostCue: "她不好意思，凯哥你再逗逗她。",
    recentGift: "凯哥送出 小心心 ×5",
    trainingGoal: "把上票理由说到凯哥身上",
  },
  createdAt: Date.now(),
  deleted: false,
};

const structure = (passed) => [
  { key: "self_intro", status: "met", evidence: "“我是首播的小满，今天想把新舞留给你们看”" },
  { key: "gratitude", status: "met", evidence: "“谢谢凯哥刚才的小心心”" },
  { key: "target_user", status: "met", evidence: "话术明确点到凯哥" },
  {
    key: "user_reason",
    status: passed ? "met" : "missing",
    evidence: passed ? "接住撒娇互动，并把复活后的反馈说清楚" : "只说自己想复活，没给凯哥参与的乐趣",
  },
  {
    key: "vote_instruction",
    status: passed ? "met" : "partial",
    evidence: passed ? "明确说还差 320 票并给出补票动作" : "说了冲一冲，但没告诉大家还差多少票",
  },
];

const reportFor = (script) => {
  const passed = script.includes("还差320票") && script.includes("撒娇");
  return {
    card_type: "logic",
    card_why: passed ? "五项结构都落到了当前现场。" : "你感谢了人，但上票理由还停在自己的需要上。",
    audience: "在对刚刚送礼并接梗的凯哥说，也给看戏的人留了参与入口。",
    structure_checks: structure(passed),
    verdict: passed ? "passed" : "almost",
    verdict_reason: passed ? "认识你、接礼物、点人、给理由和票数指令都齐了。" : "方向没错，先把凯哥为什么愿意参与说出来。",
    echo: "你想接住刚才送礼物的凯哥，再请大家帮你补最后一段票。",
    line_reviews: [
      { original: script, mark: passed ? "good" : "partial", comment: passed ? "这次把互动和补票动作接到了一起。" : "感谢接住了，但观众还没听到参与后能得到什么。" },
    ],
    one_thing: passed ? "上票理由要落到观众能参与、能得到的情绪反馈上。" : "别只说你想复活，要说他为什么会觉得这一票上得好玩。",
    direction: {
      summary: "接住凯哥的撒娇梗，说清复活后怎么回应，再落到 320 票的具体动作。用你自己的话说。",
      examples: ["凯哥，你这五颗心把我胆子送上来了", "还差320票，想看我撒娇的补一脚"],
    },
    ai_flavor: "",
    redline_note: "",
  };
};

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/api/admin/")) {
    if (request.headers["x-admin-code"] !== "demo-admin") {
      response.writeHead(401, headers);
      response.end(JSON.stringify({ error: true, message: "管理密码不对" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/cases") {
      const source = url.searchParams.get("source") || "auto";
      const items = source === "auto" && !candidate.deleted ? [candidate] : [];
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, items, nextCursor: null, hasMore: false, total: items.length }));
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/admin/cases/${candidate.id}/publish`) {
      if (candidate.deleted || candidate.status === "rejected") {
        response.writeHead(409, headers);
        response.end(JSON.stringify({ error: true, message: "这条已删除或拒绝，不能发布" }));
        return;
      }
      candidate.status = "published";
      candidate.publishedAt = Date.now();
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, alreadyPublished: false, publishedAt: candidate.publishedAt }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/admin/cases/${candidate.id}`) {
      candidate.status = "rejected";
      candidate.deleted = true;
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, headers);
    response.end(JSON.stringify({ error: true, message: "not found" }));
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/api/coach") {
    response.writeHead(404, headers);
    response.end(JSON.stringify({ error: true, message: "not found" }));
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    let body;
    try { body = JSON.parse(raw); } catch {
      response.writeHead(400, headers);
      response.end(JSON.stringify({ error: true, message: "bad json" }));
      return;
    }
    if (body.accessCode !== "demo-access") {
      response.writeHead(401, headers);
      response.end(JSON.stringify({ error: true, message: "入口码不对" }));
      return;
    }
    const send = () => {
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, report: reportFor(String(body.script || "")) }));
    };
    // 为浏览器回归保留足够的 loading 窗口，用来验证请求中不能返回改旧稿。
    if (String(body.script || "").includes("慢一点")) setTimeout(send, 2500);
    else send();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock coach api: http://127.0.0.1:${PORT}`);
});
