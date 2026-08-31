#!/usr/bin/env node

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const ACCESS_CODE = process.env.ACCESS_CODE;
const STRUCTURE_KEYS = [
  "self_intro",
  "gratitude",
  "target_user",
  "user_reason",
  "vote_instruction",
];
const CONTRACT_KEYS = [
  "card_type",
  "card_why",
  "audience",
  "round_dynamics",
  "structure_checks",
  "verdict",
  "verdict_reason",
  "echo",
  "line_reviews",
  "one_thing",
  "direction",
  "ai_flavor",
  "redline_note",
];
const HUMAN_DRIVER_ENUM = new Set([
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
]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function parseSafeBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("BASE 不是合法 URL");
  }
  requireCondition(
    url.protocol === "http:" || url.protocol === "https:",
    "BASE 只能使用 http/https"
  );
  requireCondition(
    LOOPBACK_HOSTS.has(url.hostname),
    "安全拒绝：模型质量套件只允许 loopback BASE，严禁连接生产 Worker"
  );
  requireCondition(!url.username && !url.password, "BASE 不应包含 URL 凭据");
  return url;
}

const baseUrl = parseSafeBase(BASE);
if (typeof ACCESS_CODE !== "string" || ACCESS_CODE.length === 0) {
  fail("请设置 ACCESS_CODE；脚本不会打印它");
}

const fullScenario = {
  id: "qa-v3-full-pass-20260824",
  secondsLeft: 38,
  votesNeeded: 320,
  hostCue: "小满，凯哥说你撒个娇就考虑，接不接得住看你了。",
  targetUser: "凯哥",
  userSignal: "凯哥：你撒个娇，我考虑一下。",
  recentGift: "凯哥刚送了小心心",
  trainingGoal: "接主持递球，用一次试探换反馈",
};

const fullPassScript =
  "我是今天第一次上复活台的小满，前面那支舞我还没跳过瘾。凯哥，谢谢你刚才送的小心心。主持把你那句“撒个娇就考虑”递给我了。凯哥，你都把小心心送到门口了，就再偏心我一下嘛——这句算不算过关？觉得有意思就在公屏扣个1，不吃这套就打个叉，我马上换招。现在还差320票，凯哥你愿意就先补几张，想看我跳完的家人们一人补一点。";

const farSecuredScript =
  "我是刚跳完开场舞的小满，想把新舞完整跳给你们看。刚才帮我亮灯的家人，谢谢你们。凯哥，你要是还想看我返场，就给我补一脚；其他想看的家人跟上一点。这轮目标还差320票，愿意看新舞的现在帮我补上。";

const postureBoundaryScenario = {
  id: "qa-v3-posture-boundary-20260825",
  votesNeeded: 320,
  targetUser: "凯哥",
  userSignal: "凯哥刚问这轮还差多少票",
  recentGift: "凯哥刚送了小心心",
};

const postureWithoutUserReasonScenario = {
  id: "qa-v3-posture-no-reason-20260825",
  votesNeeded: 320,
  targetUser: "凯哥",
  recentGift: "凯哥刚送了小心心",
};

const neutralPoliteScript =
  "我是刚跳完新舞的小满，还想把返场完整跳给你们看。凯哥，谢谢你刚才送的小心心。凯哥，你刚问这轮还差多少，我再确认一下，能不能帮我组一组、帮我丢一丢？你上几张看着来，想看我返场的家人们跟一点。现在还差320票，愿意看的现在补上。";

const neutralWithoutUserReasonScript =
  "我是今天第一次上复活台的小满。凯哥，谢谢你刚才送的小心心。凯哥，我再确认一下，能不能帮我组一组？现在还差320票，你愿意就帮我丢一丢。";

const scriptedSpeechScenario = {
  id: "qa-v3-scripted-speech-20260826",
  votesNeeded: 18,
  targetUser: "月月姐",
  userSignal: "月月姐刚说想看后面那段舞",
  recentGift: "月月姐刚送了小心心",
};

const scriptedSpeechScript =
  "大家好，现在台上的是新人主播小满，今天是我第一次站上十连舞台。虽然手有点抖，但既然站在这里，我就会努力到最后一刻。月月姐，谢谢你刚才送的小心心。月月姐，你刚说想看后面的舞，那要不要陪我拼一下？现在距离复活还差18票，你愿意就帮我补一补。你投的每一票，我都能感受到，都是推着我往前的力量。月月姐，你名字里有月亮，我就当你是专门来照亮我的。以后你就是守护后援第一位成员，让你的好运陪我闯关到底。星星姐，你名字里有星星，和这个舞台太合适了。来都来了，帮我投一票，咱们一起见证这一刻。";

const naturalSpeechScript =
  "大家好，我是第一次上十连的小满，手确实有点抖。既然都站这儿了，我先把这轮跳完。月月姐，谢谢你刚才的小心心，我看见了。月月姐，你刚说想看我后面那段舞，对吧？现在还差18票，你愿意就帮我补一点，每一票我都能看到是谁补的。星星姐，你这名字跟台上还挺搭，你也想看后面那段不？想看就跟一点，不想看就说你想看啥。";

const wholeRoundScenario = {
  id: "qa-v4-whole-round-20260830",
  secondsLeft: 40,
  votesNeeded: 20,
  targetUser: "凯哥",
  trainingGoal: "读懂递减票差和连续换人后的真实反馈",
};

const wholeRoundScript =
  "大家好，我是第一次上十连的跳跳糖，今天把压箱底的新舞带来了。多多哥，谢谢你先帮我补了一手。刚开口还差20个星辰，月月姐组一个后到18个，现在小唐哥又接上一手，只差8个。00姐姐，你想看我把十连才艺跳完，就帮我搭把手；小明哥也可以投一票，喜欢新舞的家人们一起跟一下。谁补到最后一手，下一段舞让你来选。";

const contextualDriversScript =
  "大家好，我是第一次上十连的小满，手还有点抖，但我想把准备的新舞跳完。月月姐，谢谢你刚才先补的那一手，我看见了。榜上已经有三个人跟着月月姐，想看返场的家人们也投一票。久皇哥，最后这一手你要是接上，全场都知道是你把我送过线；老朋友们陪我守过前面几轮，这一轮咱们一起走完。";

const driverKeywordTrapScript =
  "我是今天来守十连的小满，想把没跳过的新舞留给你们看。凯哥，谢谢你刚才的小心心。凯哥，我先念几个词：保护欲、存在感、归属感、从众。想看新舞就帮我补一手，愿意看的家人们投一票。";

const fixtures = [
  {
    id: "1a",
    label: "核心真好稿·第1次",
    voteGap: "far",
    scenario: fullScenario,
    script: fullPassScript,
    check: checkScenarioPass,
  },
  {
    id: "1b",
    label: "核心真好稿·第2次",
    voteGap: "far",
    scenario: fullScenario,
    script: fullPassScript,
    check: checkScenarioPass,
  },
  {
    id: "2",
    label: "卖惨外壳",
    voteGap: "far",
    scenario: {
      id: "qa-v3-pity-20260824",
      votesNeeded: 320,
      targetUser: "凯哥",
      recentGift: "凯哥刚送了小心心",
    },
    script:
      "我是第一次上复活台的小满，今天要是走了就太丢人了。凯哥，谢谢你刚才送的小心心。凯哥求求你可怜可怜我，我真的不想被淘汰。现在还差320票，大家帮帮我都给我上票吧。",
    check(report) {
      requireCondition(report.verdict === "off", "卖惨稿必须 off");
      requireCondition(report.card_type === "logic", "卖惨稿主卡点必须是 logic");
      requireCondition(statusOf(report, "user_reason") !== "met", "卖惨不能算用户理由 met");
      requireCondition(wrongCount(report) >= 1, "卖惨稿至少应有一条 wrong");
    },
  },
  {
    id: "3",
    label: "点名空喊",
    voteGap: "close",
    scenario: {
      id: "qa-v3-slogan-20260824",
      votesNeeded: 320,
      targetUser: "凯哥",
      recentGift: "凯哥刚送了小心心",
    },
    script:
      "我是今天第一天来的小满，想继续留在台上。谢谢大家！凯哥，冲啊！一起创造奇迹！现在还差320票，大家给我上票，我一定能行！",
    check(report) {
      requireCondition(report.verdict === "off", "空喊稿必须 off");
      requireCondition(report.card_type === "logic", "空喊稿主卡点必须是 logic");
      requireCondition(statusOf(report, "user_reason") !== "met", "空喊不能算用户理由 met");
      requireCondition(statusOf(report, "gratitude") !== "met", "泛谢不能接住具体礼物");
    },
  },
  {
    id: "4",
    label: "主持与信号误读",
    voteGap: "far",
    scenario: fullScenario,
    script:
      "我是第一次上复活台的小满，跳舞是我最拿手的。凯哥，谢谢你刚才的小心心。主持你别教我，凯哥肯定就是喜欢我撒娇，凯哥别装了，赶紧把320票给我补齐，家人们都跟上。",
    check(report) {
      requireCondition(report.verdict !== "passed", "误读主持与信号的稿子不得 passed");
      requireCondition(wrongCount(report) >= 1, "误读稿至少应有一条 wrong");
      requireCondition(statusOf(report, "user_reason") !== "met", "固定贴标签不能算用户理由 met");
    },
  },
  {
    id: "5",
    label: "自由模式不猜事实",
    voteGap: "close",
    script:
      "我是今天第一次上复活台的小满，刚才愿意停下来看我的朋友谢谢你们。我准备了一段没跳过的新舞，想看的家人们就在公屏扣个1，也可以给我补一点让我看看有多少人想看。",
    check(report) {
      requireCondition(report.verdict === "passed", "两个核心成立时，不得因自由模式没有固定点名挡住通过");
      requireCondition(statusOf(report, "target_user") !== "met", "没有具体用户不得 target_user=met");
      requireCondition(statusOf(report, "vote_instruction") === "met", "“给我补一点”已经是明确要票动作");
      const forbiddenFacts = ["凯哥", "小心心", "火箭", "320", "38", "撒娇"];
      const reportText = JSON.stringify(report);
      for (const fact of forbiddenFacts) {
        requireCondition(!reportText.includes(fact), `自由模式凭空出现事实：${fact}`);
      }
    },
  },
  {
    id: "6",
    label: "全篇AI腔",
    voteGap: "far",
    scenario: {
      id: "qa-v3-ai-20260824",
      votesNeeded: 320,
      targetUser: "凯哥",
      recentGift: "凯哥刚送了小心心",
    },
    script:
      "我是怀揣舞台梦想的小满，想用热爱点亮每一次表演。感谢凯哥刚才送的小心心，你的每一次投票都是对我梦想的助力。凯哥，让我们一起见证奇迹的诞生，用热情点燃这个舞台。现在还差320票，请凯哥和家人们一起投票托举我的梦想。",
    check(report) {
      requireCondition(report.verdict === "off", "重度 AI 腔必须 off");
      requireCondition(report.card_type === "persona", "重度 AI 腔必须是 persona 主卡点");
      requireCondition(report.ai_flavor.trim().length > 0, "AI 腔必须填写 ai_flavor");
      const sourcePhrases = [
        "怀揣舞台梦想",
        "热爱点亮",
        "每一次投票",
        "梦想的助力",
        "见证奇迹",
        "点燃这个舞台",
        "托举我的梦想",
      ];
      const hitCount = sourcePhrases.filter((phrase) => report.ai_flavor.includes(phrase)).length;
      requireCondition(hitCount >= 2, "ai_flavor 至少应点名两个原稿舞台腔词组");
    },
  },
  {
    id: "7",
    label: "红线一票否决",
    voteGap: "close",
    scenario: {
      id: "qa-v3-redline-20260824",
      votesNeeded: 320,
      targetUser: "凯哥",
      userSignal: "凯哥说想看新舞",
      recentGift: "凯哥刚送了小心心",
    },
    script:
      "我是今天来守复活位的小满，谢谢凯哥刚才的小心心。凯哥，你刚说想看我跳新舞，那就看完再决定。现在还差320票，大家都下注了吗，凯哥愿意就先补几张，想看的家人们一人补一点。",
    check(report) {
      requireCondition(report.verdict === "off", "红线稿必须 off");
      requireCondition(report.redline_note.includes("下注"), "redline_note 必须点名下注");
    },
  },
  {
    id: "8a",
    label: "同稿far",
    voteGap: "far",
    script: farSecuredScript,
    check: checkFullPass,
  },
  {
    id: "8b",
    label: "同稿secured",
    voteGap: "secured",
    script: farSecuredScript,
    check: checkFullPass,
  },
  {
    id: "9a",
    label: "姿态边界·委婉确认",
    voteGap: "close",
    scenario: postureBoundaryScenario,
    script: neutralPoliteScript,
    check(report) {
      checkFullPass(report);
      const requestReview = report.line_reviews.find((item) =>
        item.original.includes("帮我组一组")
      );
      requireCondition(requestReview, "逐句点评没有覆盖“帮我组一组”所在句");
      requireCondition(requestReview.mark !== "wrong", "委婉确认不得被标为 wrong");
    },
  },
  {
    id: "9b",
    label: "姿态边界·委婉但缺支点",
    voteGap: "close",
    scenario: postureWithoutUserReasonScenario,
    script: neutralWithoutUserReasonScript,
    check(report) {
      requireCondition(report.verdict === "almost", "只缺用户理由的委婉请求应为 almost");
      requireCondition(statusOf(report, "user_reason") !== "met", "弱请求不应虚构用户理由");
      const requestReview = report.line_reviews.find((item) =>
        item.original.includes("帮我组一组")
      );
      requireCondition(requestReview, "逐句点评没有覆盖弱请求所在句");
      requireCondition(
        requestReview.mark !== "wrong",
        "缺用户理由可以扣支点，但不得把委婉请求本身标为 wrong"
      );
    },
  },
  {
    id: "9c",
    label: "姿态边界·乞求自贬",
    voteGap: "close",
    scenario: postureBoundaryScenario,
    script:
      "我是刚跳完新舞的小满，还想把返场完整跳给你们看。凯哥，谢谢你刚才送的小心心。凯哥，求一求你了，我给你跪下了，可怜可怜我，救救我这一次。现在还差320票，凯哥帮我补齐，家人们跟上。",
    check(report) {
      requireCondition(report.verdict === "off", "明确乞求和自贬必须 off");
      requireCondition(report.card_type === "logic", "乞求自贬主卡点必须是 logic");
      requireCondition(wrongCount(report) >= 1, "乞求自贬至少应有一条 wrong");
      requireCondition(
        /求一求你|跪下|可怜可怜我|救救我/u.test(JSON.stringify(report)),
        "反馈必须引用原稿里的真实乞求或自贬证据"
      );
    },
  },
  {
    id: "10a",
    label: "口语边界·作文朗诵",
    voteGap: "close",
    scenario: scriptedSpeechScenario,
    script: scriptedSpeechScript,
    check(report) {
      requireCondition(metCount(report) === 5, "作文朗诵稿应先被识别为五项结构齐全");
      requireCondition(report.verdict === "off", "跨段重复作文闭环必须 off");
      requireCondition(report.card_type === "persona", "跨段重复作文闭环主卡点必须是 persona");
      requireCondition(report.ai_flavor.trim().length > 0, "作文朗诵稿必须填写 ai_flavor");
      requireCondition(wrongCount(report) >= 1, "作文朗诵稿至少应点出一条代表性 wrong");
      const sourcePhrases = [
        "既然站在这里",
        "努力到最后一刻",
        "每一票",
        "推着我往前的力量",
        "专门来照亮我的",
        "守护后援第一位成员",
        "好运陪我闯关到底",
        "见证这一刻",
      ];
      const hitCount = sourcePhrases.filter((phrase) => report.ai_flavor.includes(phrase)).length;
      requireCondition(hitCount >= 2, "ai_flavor 至少应逐字引用两处作文朗诵原句");
      requireCondition(
        /模板|工整|朗诵|小作文|升华|收口|念稿/u.test(report.ai_flavor),
        "ai_flavor 必须说明共同的作文模板机制"
      );
    },
  },
  {
    id: "10b",
    label: "口语边界·同事实自然说法",
    voteGap: "close",
    scenario: scriptedSpeechScenario,
    script: naturalSpeechScript,
    check(report) {
      checkFullPass(report);
      const requestReview = report.line_reviews.find((item) =>
        item.original.includes("帮我补一点")
      );
      requireCondition(requestReview, "自然口语逐句点评没有覆盖委婉请求");
      requireCondition(requestReview.mark !== "wrong", "自然口语里的委婉请求不得标 wrong");
      const singleCueReviews = report.line_reviews.filter(
        (item) => item.original.includes("既然") || item.original.includes("每一票")
      );
      requireCondition(singleCueReviews.length >= 2, "自然口语逐句点评应覆盖单次“既然/每一票”");
      requireCondition(
        singleCueReviews.every((item) => item.mark !== "wrong"),
        "单次“既然/每一票”不得脱离全稿结构被误判为作文朗诵"
      );
      const secondUserReview = report.line_reviews.find((item) =>
        item.original.includes("星星姐")
      );
      requireCondition(secondUserReview, "自然口语逐句点评应覆盖第二位用户的昵称玩梗");
      requireCondition(secondUserReview.mark !== "wrong", "一次昵称玩梗不得直接判 persona");
    },
  },
  {
    id: "11",
    label: "整轮递减票差与多用户切换",
    voteGap: "far",
    scenario: wholeRoundScenario,
    script: wholeRoundScript,
    check(report) {
      checkFullPass(report);
      requireCondition(statusOf(report, "target_user") === "met", "切换多个具体用户仍应 target_user=met");
      requireCondition(statusOf(report, "vote_instruction") === "met", "组一个/搭把手/投一票应满足明确动作");
      requireCondition(
        /20.{0,40}18.{0,40}8|递减|下降|缩小|追到|推进/u.test(report.round_dynamics.flow_read),
        "flow_read 必须把20→18→8读成整轮推进，不能当数字矛盾"
      );
      requireCondition(
        !/矛盾|冲突|数字不一致/u.test(report.round_dynamics.flow_read),
        "递减票差不得被解释为自相矛盾"
      );
    },
  },
  {
    id: "12a",
    label: "人性驱动必须落到现场机制",
    voteGap: "close",
    script: contextualDriversScript,
    check(report) {
      checkFullPass(report);
      const driverNames = report.round_dynamics.human_drivers.map((item) => item.driver);
      requireCondition(driverNames.includes("social_proof"), "三个人跟票的上下文应识别 social_proof");
      requireCondition(
        driverNames.includes("status") || driverNames.includes("visibility"),
        "最后一手被全场看见的上下文应识别 status/visibility"
      );
      for (const item of report.round_dynamics.human_drivers) {
        const explanation = `${item.evidence} ${item.mechanism}`;
        if (item.driver === "social_proof") {
          requireCondition(/三个人|跟着|月月姐|已出手/u.test(explanation), "social_proof 必须解释真实跟票上下文");
        }
        if (item.driver === "status" || item.driver === "visibility") {
          requireCondition(/最后一手|全场|送过线|关键/u.test(explanation), "status/visibility 必须解释关键人物机制");
        }
        if (item.driver === "protection") {
          requireCondition(/第一次|手抖|新人|托住|守住/u.test(explanation), "protection 必须有脆弱处境和可行动位置");
        }
        if (item.driver === "belonging") {
          requireCondition(/老朋友|前面几轮|一起/u.test(explanation), "belonging 必须有共同经历或共同身份");
        }
      }
    },
  },
  {
    id: "12b",
    label: "人性关键词不能代替机制",
    voteGap: "close",
    script: driverKeywordTrapScript,
    check(report) {
      const driverNames = report.round_dynamics.human_drivers.map((item) => item.driver);
      for (const keywordOnlyDriver of ["protection", "visibility", "status", "belonging", "social_proof"]) {
        requireCondition(
          !driverNames.includes(keywordOnlyDriver),
          `原稿只念心理词，不得机械贴 ${keywordOnlyDriver}`
        );
      }
      requireCondition(
        report.round_dynamics.human_drivers.every((item) => item.evidence.trim() && item.mechanism.trim()),
        "关键词陷阱稿也必须返回有事实和机制的有效驱动契约"
      );
    },
  },
];

function compact(value) {
  return String(value || "").replace(/\s+/gu, "");
}

function splitSentences(value) {
  const matches = String(value || "").match(
    /[^。！？!?；;.]+(?:[。！？!?；;.]+[”’"'）】》]*)?|[。！？!?；;.]+[”’"'）】》]*/gu
  );
  return (matches || []).filter((item) => compact(item).length > 0);
}

function statusOf(report, key) {
  return report.structure_checks.find((item) => item.key === key)?.status;
}

function evidenceOf(report, key) {
  return report.structure_checks.find((item) => item.key === key)?.evidence || "";
}

function assertRoundDynamicsContract(report) {
  const dynamics = report.round_dynamics;
  requireCondition(
    dynamics && typeof dynamics === "object" && !Array.isArray(dynamics),
    "round_dynamics 必须是对象"
  );
  for (const key of ["flow_read", "response_read", "next_move"]) {
    requireCondition(
      typeof dynamics[key] === "string" && dynamics[key].trim().length > 0,
      `round_dynamics.${key} 不能为空`
    );
  }
  requireCondition(Array.isArray(dynamics.human_drivers), "round_dynamics.human_drivers 必须是数组");
  requireCondition(
    dynamics.human_drivers.length >= 1 && dynamics.human_drivers.length <= 3,
    "round_dynamics.human_drivers 必须有1-3项"
  );
  dynamics.human_drivers.forEach((item, index) => {
    requireCondition(item && typeof item === "object" && !Array.isArray(item), `第${index + 1}项 driver 无效`);
    requireCondition(HUMAN_DRIVER_ENUM.has(item.driver), `第${index + 1}项 driver 枚举非法`);
    requireCondition(
      typeof item.evidence === "string" && item.evidence.trim().length > 0,
      `第${index + 1}项 driver evidence 为空`
    );
    requireCondition(
      typeof item.mechanism === "string" && item.mechanism.trim().length > 0,
      `第${index + 1}项 driver mechanism 为空`
    );
  });
}

function metCount(report) {
  return report.structure_checks.filter((item) => item.status === "met").length;
}

function wrongCount(report) {
  return report.line_reviews.filter((item) => item.mark === "wrong").length;
}

function checkFullPass(report) {
  requireCondition(report.verdict === "passed", "真好稿必须 passed");
  requireCondition(statusOf(report, "user_reason") === "met", "通过稿 user_reason 必须 met");
  requireCondition(statusOf(report, "vote_instruction") === "met", "通过稿 vote_instruction 必须 met");
  requireCondition(wrongCount(report) === 0, "真好稿不能有 wrong");
  requireCondition(report.card_type !== "persona", "真好稿不能判 persona");
  requireCondition(report.ai_flavor.trim() === "", "真好稿 ai_flavor 必须为空");
  requireCondition(report.redline_note.trim() === "", "真好稿 redline_note 必须为空");
}

function checkScenarioPass(report) {
  checkFullPass(report);
  requireCondition(statusOf(report, "gratitude") === "met", "具体感谢凯哥/小心心时 gratitude 应为 met");
  requireCondition(statusOf(report, "target_user") === "met", "明确呼叫凯哥时 target_user 应为 met");
  requireCondition(statusOf(report, "vote_instruction") === "met", "已有明确上票动作时 vote_instruction 应为 met");
}

function assertGlobalContract(report, script) {
  requireCondition(report && typeof report === "object" && !Array.isArray(report), "report 缺失");
  for (const key of CONTRACT_KEYS) {
    requireCondition(Object.prototype.hasOwnProperty.call(report, key), `报告缺少字段 ${key}`);
  }
  assertRoundDynamicsContract(report);
  requireCondition(["passed", "almost", "off"].includes(report.verdict), "verdict 非法");
  requireCondition(
    ["logic", "expression", "mentality", "persona"].includes(report.card_type),
    "card_type 非法"
  );
  for (const key of [
    "card_why",
    "audience",
    "verdict_reason",
    "echo",
    "one_thing",
    "ai_flavor",
    "redline_note",
  ]) {
    requireCondition(typeof report[key] === "string", `${key} 非字符串`);
  }

  requireCondition(Array.isArray(report.structure_checks), "structure_checks 不是数组");
  requireCondition(
    report.structure_checks.length === STRUCTURE_KEYS.length,
    "structure_checks 必须恰好五项"
  );
  report.structure_checks.forEach((item, index) => {
    requireCondition(item && typeof item === "object", `第 ${index + 1} 项结构无效`);
    requireCondition(item.key === STRUCTURE_KEYS[index], `第 ${index + 1} 项结构 key/顺序错误`);
    requireCondition(
      ["met", "partial", "missing"].includes(item.status),
      `${item.key} status 非法`
    );
    requireCondition(
      typeof item.evidence === "string" && item.evidence.trim().length > 0,
      `${item.key} evidence 为空`
    );
  });

  requireCondition(
    Array.isArray(report.line_reviews) && report.line_reviews.length > 0,
    "line_reviews 必须非空"
  );
  report.line_reviews.forEach((item, index) => {
    requireCondition(item && typeof item === "object", `第 ${index + 1} 条逐句点评无效`);
    requireCondition(
      ["good", "partial", "wrong"].includes(item.mark),
      `第 ${index + 1} 条 mark 非法`
    );
    requireCondition(
      typeof item.original === "string" && item.original.trim().length > 0,
      `第 ${index + 1} 条 original 为空`
    );
    requireCondition(
      typeof item.comment === "string" && item.comment.trim().length > 0,
      `第 ${index + 1} 条 comment 为空`
    );
  });
  const reviewedScript = report.line_reviews.map((item) => item.original).join("");
  requireCondition(
    compact(reviewedScript) === compact(script),
    "line_reviews.original 未完整逐字覆盖全稿"
  );
  const sourceSentences = splitSentences(script);
  const cumulativeOffsets = (items) => {
    let offset = 0;
    return items.map((item) => {
      offset += compact(item).length;
      return offset;
    });
  };
  const sourceHardBoundaries = cumulativeOffsets(sourceSentences).slice(0, -1);
  const reviewBoundaries = cumulativeOffsets(
    report.line_reviews.map((item) => item.original)
  );
  requireCondition(
    sourceHardBoundaries.every((boundary) => reviewBoundaries.includes(boundary)),
    "line_reviews 跨越句号/问号/感叹号/分号合并了完整句子"
  );

  requireCondition(report.direction && typeof report.direction === "object", "direction 缺失");
  requireCondition(typeof report.direction.summary === "string", "direction.summary 非字符串");
  requireCondition(
    report.direction.summary.includes("用你自己的话说"),
    "direction.summary 缺少防照抄提醒"
  );
  requireCondition(Array.isArray(report.direction.examples), "direction.examples 不是数组");
  requireCondition(report.direction.examples.length <= 3, "direction.examples 超过三条");
  report.direction.examples.forEach((example, index) => {
    requireCondition(typeof example === "string", `第 ${index + 1} 条 example 非字符串`);
    requireCondition(
      Array.from(example).length <= 25,
      `第 ${index + 1} 条 example 超过25字`
    );
  });

  if (report.verdict === "passed") {
    requireCondition(statusOf(report, "user_reason") === "met", "passed 但 user_reason 未 met");
    requireCondition(statusOf(report, "vote_instruction") === "met", "passed 但 vote_instruction 未 met");
    requireCondition(wrongCount(report) === 0, "passed 但仍有 wrong");
    requireCondition(report.card_type !== "persona", "passed 但 card_type=persona");
    requireCondition(report.ai_flavor.trim() === "", "passed 但 ai_flavor 非空");
    requireCondition(report.redline_note.trim() === "", "passed 但 redline_note 非空");
  }
}

async function requestReport(fixture) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const body = {
    accessCode: ACCESS_CODE,
    voteGap: fixture.voteGap,
    script: fixture.script,
  };
  if (fixture.scenario) body.scenario = fixture.scenario;

  let response;
  try {
    response = await fetch(new URL("/api/coach", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") fail("请求超过60秒");
    fail("请求失败或本地 Worker 不可达");
  } finally {
    clearTimeout(timeout);
  }

  requireCondition(response.status === 200, `HTTP 状态应为200，实际为${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail("响应不是合法 JSON");
  }
  requireCondition(payload?.ok === true, "响应 ok 不为 true");
  return payload.report;
}

function comparisonText(report) {
  return [
    report.card_why,
    report.verdict_reason,
    report.one_thing,
    report.direction.summary,
  ].join(" ");
}

console.log(`模型质量发布门槛：${fixtures.length} 次请求，仅允许本机 Worker/测试 KV`);

const results = new Map();
const failures = [];
for (const fixture of fixtures) {
  try {
    const report = await requestReport(fixture);
    assertGlobalContract(report, fixture.script);
    fixture.check(report);
    results.set(fixture.id, report);
    console.log(
      `PASS ${fixture.id} ${fixture.label}: verdict=${report.verdict} structure=${metCount(report)}/5 wrong=${wrongCount(report)}`
    );
  } catch (error) {
    failures.push({ id: fixture.id, message: error.message });
    console.log(`FAIL ${fixture.id} ${fixture.label}: ${error.message}`);
  }
}

const farReport = results.get("8a");
const securedReport = results.get("8b");
if (farReport && securedReport) {
  try {
    const farText = comparisonText(farReport);
    const securedText = comparisonText(securedReport);
    requireCondition(farText !== securedText, "far 与 secured 的关键诊断完全相同");
    requireCondition(
      /追票|翻盘|追上|现在出手/u.test(farText),
      "far 报告未落到追票/翻盘语义"
    );
    requireCondition(
      /稳票|守住|保位|白投|已上票/u.test(securedText),
      "secured 报告未落到稳票/守位语义"
    );
    console.log("PASS 8-pair 同稿票况差异: far=追票 secured=稳票");
  } catch (error) {
    failures.push({ id: "8-pair", message: error.message });
    console.log(`FAIL 8-pair 同稿票况语义差异: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.log(
    `总结果: FAIL (${results.size}/${fixtures.length} 请求通过，${failures.length} 个门槛失败)`
  );
  process.exitCode = 1;
} else {
  console.log(
    `总结果: PASS (${fixtures.length}/${fixtures.length} 请求通过，10类质量门槛全部满足)`
  );
}
