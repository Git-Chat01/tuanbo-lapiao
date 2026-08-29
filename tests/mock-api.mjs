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

const structure = ({ targetMet, reasonMet, voteMet }) => [
  { key: "self_intro", status: "met", evidence: "“我是首播的小满，今天想把新舞留给你们看”" },
  { key: "gratitude", status: "met", evidence: "“谢谢凯哥刚才的小心心”" },
  {
    key: "target_user",
    status: targetMet ? "met" : "partial",
    evidence: targetMet ? "话术明确是在对凯哥说" : "已经写到现场人物，但还没有明确对凯哥说话",
  },
  {
    key: "user_reason",
    status: reasonMet ? "met" : "missing",
    evidence: reasonMet ? "接住撒娇互动，并给了观看、选择或回应价值" : "已经把请求说出来，只差凯哥参与后能得到的回应",
  },
  {
    key: "vote_instruction",
    status: voteMet ? "met" : "partial",
    evidence: voteMet ? "明确说还差 320 票并给出补票动作" : "还缺准确票差或可执行的上票动作",
  },
];

const reportFor = (script) => {
  // 本地假接口也按三个原子能力判断，避免浏览器回归掩盖生产上的交叉门槛。
  const targetMet = /(?:^|[，。！？!?；;])(?:那|我问下)?凯哥(?:啊|呀|嘛|呢)?(?=[，。！？!?：:你])/u.test(script);
  const reasonMet =
    !/(?:不|别|没|不想|不愿).{0,4}(?:撒娇|返场|新舞|表演|回应)/u.test(script) &&
    /(?:撒娇|返场|新舞|跳完|才艺|表演|整活|好玩|有意思|你来选|你决定|你说了算|当导演|复活后|点的节目)/u.test(script);
  const voteMet = /还差\s*320\s*票/u.test(script) && /(?:补|上票|投票|跟上|跟一点)/u.test(script);
  const passed = targetMet && reasonMet && voteMet;
  const checks = structure({ targetMet, reasonMet, voteMet });
  const focus = !targetMet ? "target" : (!reasonMet ? "reason" : "vote");
  return {
    card_type: "logic",
    card_why: passed
      ? "五项结构都落到了当前现场。"
      : (focus === "target"
          ? "你已经写出人物，只差让凯哥听出这句话是在对他说。"
          : (focus === "reason"
              ? "你已经对准凯哥，只差接住他想看撒娇的现场信号。"
              : "前四项已经齐了，只差准确票差和上票动作。")),
    audience: "在对刚刚送礼并接梗的凯哥说，也给看戏的人留了参与入口。",
    structure_checks: checks,
    verdict: passed ? "passed" : "almost",
    verdict_reason: passed
      ? "认识你、接礼物、点人、给理由和票数指令都齐了。"
      : (focus === "target"
          ? "感谢已经接住了，这次只把一句话明确说给凯哥。"
          : (focus === "reason"
              ? "点到凯哥已经过关，这次只说他参与后能看到什么回应。"
              : "前四项不用再改，只补准确票差和上票动作。")),
    echo: "你想接住刚才送礼物的凯哥，再请大家帮你补最后一段票。",
    line_reviews: [
      { original: script, mark: passed ? "good" : "partial", comment: passed ? "这次把互动和补票动作接到了一起。" : "感谢接住了，但观众还没听到参与后能得到什么。" },
    ],
    one_thing: passed
      ? "上票理由要落到观众能参与、能得到的情绪反馈上。"
      : (focus === "target"
          ? "点到人只看话是不是明确说给这个人。"
          : (focus === "reason"
              ? "给理由只看用户参与后能得到什么。"
              : "票数指令只看准确票差和可执行动作。")),
    direction: {
      summary: focus === "target"
        ? "让凯哥一听就知道这句话是在对他说，不用重写整段。用你自己的话说。"
        : (focus === "reason"
            ? "接住凯哥想看撒娇的信号，只补他参与后能看到的回应或乐趣。用你自己的话说。"
            : "保留原话，只补准确票差和一个马上能做的上票动作。用你自己的话说。"),
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
