// 文字复盘：五项结构看进度，一轮只改一个关键缺口。
// 所有模型内容都通过 textContent 写入，避免把模型输出当成 HTML。

var Report = {
  STRUCTURE: [
    { key: "self_intro", label: "认识我" },
    { key: "gratitude", label: "接住参与" },
    { key: "target_user", label: "点到人" },
    { key: "user_reason", label: "给参与理由" },
    { key: "vote_instruction", label: "当下动作" },
  ],

  DRIVER_LABELS: {
    visibility: "被看见",
    status: "身份与排面",
    protection: "守护欲",
    belonging: "归属感",
    control: "掌控感",
    curiosity: "好奇心",
    competition: "胜负欲",
    social_proof: "跟随与从众",
    reciprocity: "互惠感",
    urgency: "紧迫感",
    other: "其他驱动",
  },

  CHALLENGES: {
    self_intro: {
      number: 1,
      title: "让人记住你",
      standard: "开头不只报名字，还说出一个让观众愿意继续看的具体信息。",
      why: "如果只报名字，观众还不知道为什么要继续看你，后面的要票就没有落脚点。",
      method: "保留你的名字，再补一句你这一轮有什么内容、状态或看点。",
      hints: ["在名字后补：这一轮你具体有什么看点？", "只补一句，不要重新介绍一遍。"],
    },
    gratitude: {
      number: 2,
      title: "接住真实参与",
      standard: "先辨认对方刚刚做的是下台、复活、认领还是送礼，再用符合这轮关系的方式接住。",
      why: "具体接住一次参与，对方才会感觉你看见了这次互动；但把下台票硬谢成保台支持，也是在误读玩法关系。",
      method: "把泛泛回应落到一个人和一次真实动作上，动作方向不清时不要替用户定性。",
      hints: ["先从现场找：谁刚刚做了什么、作用方向是什么？", "按真实动作接关系，不把下台票说成保台支持。"],
    },
    target_user: {
      number: 3,
      title: "把话递到一个人",
      standard: "这关只看有没有明确对本轮递球的具体用户说话；具体感谢也算，不考理由、票差或上票动作。",
      why: "话没有递到具体的人，就容易变成对全场空喊，谁都不觉得下一拍该由自己来接。",
      method: "直接叫到本轮递球的那个人；具体感谢已经是在对他说，不必为了过关额外造一句。",
      hints: ["使用现场给出的目标称呼，直接对他说一句话。", "读一遍确认这句话是在对他说；具体感谢也算，这关不用补理由、票差或动作。"],
    },
    user_reason: {
      number: 4,
      title: "给观众一个上票理由",
      standard: "这关只看有没有依据现场事实，给对方一个愿意参与的位置：可以接兴趣或条件，也可以落到保护、归属、身份与选择、互惠与被看见、竞争等机制；不考票差和上票动作。",
      why: "只说你需要留下，是你的理由；观众还没听见自己为什么值得参与这一拍。",
      method: "先找一条可验证的用户动作、关系或局势，再说清对方能接住什么位置；没有证据就不替用户猜偏好。",
      hints: ["先分清现场给的是兴趣、条件、已发生的参与、共同经历还是关键位置。", "只沿着有证据的机制接下一层，不替用户补动机或偏好。"],
    },
    vote_instruction: {
      number: 5,
      title: "把当下动作说清楚",
      standard: "说出当前阶段马上能执行的动作：未组满递占位，组满未发令等主持，发令后接真实到账，结果落地后承接关系。",
      why: "动作与阶段错位，比数字不精确更伤现场：系统先判断这一拍发生到哪，再看你有没有顺势接住。",
      method: "先确认现在处在哪一拍，再只递这一拍的动作；现场数量说“个/手”，不用为了过关硬报数字。",
      hints: ["先看现场现在是还缺位置，还是已经组满。", "只说这一拍能做的动作，不为了过关硬补数字。"],
    },
    logic: {
      number: 0,
      title: "先立住上票支点",
      standard: "不靠求情或空喊，把请求放到一个观众愿意参与的理由和动作上。",
      method: "先选一个具体的人或现场信号，再说对方为什么愿意参与，最后递出动作。",
    },
    expression: {
      number: 0,
      title: "把生硬的一句说顺",
      standard: "保留原来的意思，但说出口像你平时在现场聊天，而不是念稿。",
      method: "只改最卡口的那句，拆短一点，换回你自己常用的词。",
    },
    mentality: {
      number: 0,
      title: "把要票的底气站稳",
      standard: "请求说完整，不在开口后立刻退缩、松口或否定自己。",
      method: "先承认要票是这轮正常动作，再把条件和请求稳稳说完。",
    },
    redline: {
      number: 0,
      title: "换成能安全播的表达",
      standard: "去掉不能播的词，同时保留你原本想表达的现场意思。",
      method: "只替换踩线的那一处，不需要把整段推翻。",
    },
    persona: {
      number: 0,
      title: "说回你自己的语气",
      standard: "一拍只说一层，并给用户留下真实回应的空隙，换个人不能原样套用。",
      method: "拆掉工整收口，保留你平时真的会说的短句和现场反应。",
    },
    line_angle: {
      number: 0,
      title: "把说话角度站回来",
      standard: "这句话既说清你的请求，也让观众保留选择和参与的理由。",
      method: "保留原意，把只讲自己需要的部分换成观众能接住的动作。",
    },
    final_polish: {
      number: 0,
      title: "打磨最后一句",
      standard: "关键一句落到眼前的人和现场动作上，不用抽象口号收尾。",
      method: "把抽象总结换成此刻能对具体用户说出口的一句话。",
    },
  },

  _loadingTimer: null,

  init: function () {
    document.getElementById("btn-back-edit").addEventListener("click", Report._onBackEdit);
    document.getElementById("btn-retry").addEventListener("click", Report._onRetry);
    document.getElementById("btn-copy").addEventListener("click", Report._onCopy);
    document.getElementById("btn-new-round").addEventListener("click", Report._onNewRound);
    document.getElementById("btn-start-voice").addEventListener("click", Report._onStartVoice);
  },

  _el: function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },

  _clear: function (node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  },

  _challengeFor: function (focus) {
    return Report.CHALLENGES[focus && focus.key] || {
      number: 0,
      title: focus && focus.label ? focus.label : "补上关键一拍",
      standard: "让这一处落到具体的人、具体的现场和可执行的动作上。",
      method: "只改教练指出的这一处，其他已经做到的内容先保留。",
    };
  },

  _mapStatus: function (progress, focus) {
    var challenge = Report._challengeFor(focus);
    var total = Number(progress.applicableCount) || Report.STRUCTURE.length;
    return !challenge.number && progress.metCount === total
      ? (progress.applicableCount ? "本拍要求已齐 · 还有加练关" : "五项结构已齐 · 还有加练关")
      : progress.metCount + "/" + total + " 本拍已做到";
  },

  _shouldOpenHelp: function (progress) {
    return Boolean(progress && progress.focusAttempts >= 2);
  },

  _passAchievement: function (progress) {
    if (progress.isFirstResult && progress.newlyMastered.length === progress.applicableCount) {
      return "第一次挑战就把这一拍该做的全部接住了。";
    }
    if (progress.newlyMastered.length) {
      return "最后拿下：“" + progress.newlyMastered.map(function (check) { return check.label; }).join("、") + "”。";
    }
    return "";
  },

  _solutionFor: function (report, focus) {
    var challenge = Report._challengeFor(focus);
    var direction = report.direction || {};
    if (focus && focus.key === "vote_instruction") {
      var phase = Report._scenario().phase;
      if (phase === "awaiting_drop") return "确认组队已满，提醒已占位的人先别提前丢、按约定等主持统一口令。";
      if (phase === "delivery") return "主持已经发令，按真实到账接住原占位兑现并感谢，不再等口令或拉新占位。";
      if (phase === "result" || phase === "post_round") return "结果已经落地，确认共同完成、感谢这轮参与，再把关系接到下一轮。";
      return "保留你这一轮的理由，再递一个观众此刻能执行的上票或占位动作；不用为了过关硬报数字。";
    }
    return challenge.number ? challenge.method : (direction.summary || challenge.method);
  },

  _scenario: function () {
    var request = typeof App !== "undefined" && App.state ? App.state.lastRequest : null;
    return request && request.scenario && typeof request.scenario === "object"
      ? request.scenario
      : {};
  },

  _fact: function (value, fallback) {
    var text = typeof value === "string" ? value.trim() : "";
    return text || fallback || "";
  },

  _metLabels: function (progress, focus) {
    var checks = progress && Array.isArray(progress.checks) ? progress.checks : [];
    return checks.filter(function (check) {
      return check && check.status === "met" && (!focus || check.key !== focus.key);
    }).map(function (check) { return check.label; });
  },

  _guidanceFor: function (report, focus, progress) {
    if (!focus || ["target_user", "user_reason", "vote_instruction"].indexOf(focus.key) < 0) return null;
    var scenario = Report._scenario();
    var target = Report._fact(scenario.targetUser, "这个用户");
    var signal = Report._fact(scenario.userSignal, "");
    var request = typeof App !== "undefined" && App.state ? App.state.lastRequest : null;
    var script = request && typeof request.script === "string" ? request.script : "";
    var labels = Report._metLabels(progress, focus);
    var completed = labels.length
      ? "你已经拿下“" + labels.join("、") + "”，这些内容都先保留。"
      : "你已经把这一轮想说的话写出来了，不需要推翻整段。";

    if (focus.key === "vote_instruction") {
      var waitingForHost = scenario.phase === "awaiting_drop";
      var fulfilling = scenario.phase === "delivery";
      var completedRound = scenario.phase === "result" || scenario.phase === "post_round";
      return {
        completed: completed,
        gap: waitingForHost
          ? "现场已经占位满额、主持还没发令。这关只核对：有没有确认组齐、让大家先别提前丢，并按约定等主持统一口令；不能继续找人补位。"
          : fulfilling
            ? "主持已经发令。这关只核对：有没有按实际到账接住原占位兑现和感谢；不能重新拉人，也不能还在等已发出的口令。"
            : completedRound
              ? "结果已经确认。这关只核对：有没有接住共同完成、感谢本轮参与并承接关系；不能继续沿用上一拍拉票。"
              : "这关只核对：观众听完后知不知道现在能做什么。补一脚、跟一点、上几张、认一个或认一手都算；不要求你报准数字。",
      };
    }

    if (focus.key === "target_user") {
      if (target !== "这个用户" && script.indexOf(target) >= 0) {
        completed = "你的原话里已经出现了“" + target + "”，说明你找对了要说话的人，不用重写整段。";
      }
      return {
        completed: completed,
        gap: "这关只核对：有没有直接把一句话说给“" + target + "”。最简单的自检是用“" + target + "，……”开头；不考理由、票差或上票动作。",
      };
    }

    var targetCheck = progress && Array.isArray(progress.checks)
      ? progress.checks.filter(function (check) { return check.key === "target_user"; })[0]
      : null;
    if (targetCheck && targetCheck.status === "met") {
      completed = "你已经把话递给“" + target + "”了，称呼这一项已经过关，不用再改。";
    }
    var reasonSupport = Report._reasonSupportFor(report);
    var negativeSignal = reasonSupport.kind === "negative";
    var reasonGap;
    if (negativeSignal) {
      reasonGap = "现场这句“" + signal + "”是在表达不想要，先尊重它，不要照着做；这关只补一个对方愿意接的替代回应或选择权，不检查票差和上票动作。";
    } else if (reasonSupport.kind === "content") {
      reasonGap = "这关只差接住“" + signal + "”：让“" + target + "”听见，参与后能看到什么回应、得到什么乐趣或选择权；不检查票差和上票动作。";
    } else if (reasonSupport.kind === "commitment") {
      reasonGap = signal
        ? "这关只差把“" + signal + "”里的条件变化和认领边界接准确：让“" + target + "”知道这次选择被看见、会按真实报数来接，不替他追加承诺或猜动机；不检查票差和上票动作。"
        : "这关只差接住现场已经发生的条件或认领：把边界、选择和已确认事实说准，不替用户追加承诺或猜动机；不检查票差和上票动作。";
    } else if (reasonSupport.kind === "protection") {
      reasonGap = "这关只差把真实处境变成一个对方可以自主接住的守护位置，不是重复自己有多难；不检查票差和上票动作。";
    } else if (reasonSupport.kind === "belonging") {
      reasonGap = "这关只差接住已经发生的共同经历或共同身份，让对方知道这一拍是在一起续关系，而不是只喊“家人们”；不检查票差和上票动作。";
    } else if (reasonSupport.kind === "status") {
      reasonGap = "这关只差把有事实依据的关键位置或选择权交给“" + target + "”，让他能真实拍板，不替他决定；不检查票差和上票动作。";
    } else if (reasonSupport.kind === "reciprocity") {
      reasonGap = "这关只差具体接住已经发生的参与，让对方知道自己的动作被看见、会得到真实回应；不把过去参与说成欠票，也不检查票差和上票动作。";
    } else if (reasonSupport.kind === "competition") {
      reasonGap = "这关只差把真实的胜负或过关局势变成一个共同参与的位置，让对方知道为什么值得一起走这一拍；不检查票差和上票动作。";
    } else if (signal) {
      reasonGap = "这关只差把“" + signal + "”按原意接回来：先说准可观察事实，再给“" + target + "”一个可自主参与的位置；证据不够时不替他补偏好，不检查票差和上票动作。";
    } else {
      reasonGap = "这关先从现场找一条可验证的动作、关系或局势，再给“" + target + "”一个可自主参与的位置；没有具体信号时不要编“他想看”或“他喜欢”，也不检查票差和上票动作。";
    }
    return {
      completed: completed,
      gap: reasonGap,
    };
  },

  _isNegativeSignal: function (signal) {
    var text = typeof signal === "string" ? signal.replace(/\s+/g, "") : "";
    if (!text) return false;
    if (/(?:不是说|没说过?).{0,10}(?:想看|要看|喜欢看).{0,10}(?:吗|么|呢|嘛|？|\?)/.test(text)) return false;
    return /(?:不想|不愿意?|不要|不用|不必|无需|无须|不需要|用不着|不喜欢|不想听|不想看|别|没想|没有想|没说|没有说|未说).{0,10}(?:撒娇|撒一个|撒个娇|新舞|返场|跳完|跳舞|舞蹈|才艺|表演|整活|节目|唱歌|点歌|点舞)/.test(text);
  },

  _reasonSupportFor: function (report) {
    var scenario = Report._scenario();
    var signal = Report._fact(scenario.userSignal, "");
    if (signal && Report._isNegativeSignal(signal)) return { kind: "negative", signal: signal };

    var request = App.state.lastRequest && typeof App.state.lastRequest === "object"
      ? App.state.lastRequest
      : {};
    var factParts = [signal, Report._fact(request.script, "")];
    ["recentGift", "trainingGoal", "hostCue"].forEach(function (key) {
      var value = Report._fact(scenario[key], "");
      if (value) factParts.push(value);
    });
    if (Array.isArray(scenario.timeline)) {
      scenario.timeline.forEach(function (event) {
        if (!event || typeof event !== "object") return;
        if (typeof event.speaker === "string") factParts.push(event.speaker);
        if (typeof event.text === "string") factParts.push(event.text);
      });
    }
    var facts = factParts.join(" ").replace(/\s+/g, "");

    var drivers = report && report.round_dynamics && Array.isArray(report.round_dynamics.human_drivers)
      ? report.round_dynamics.human_drivers
      : [];
    var evidenceSource = factParts.join("").replace(/[\s，。！？：；、,.!?;:'"“”‘’（）()\[\]【】《》〈〉—…·/_-]+/g, "");
    var isAnchoredInFacts = function (evidence) {
      var compact = String(evidence || "").replace(/[\s，。！？：；、,.!?;:'"“”‘’（）()\[\]【】《》〈〉—…·/_-]+/g, "");
      if (!evidenceSource || compact.length < 4) return false;
      for (var index = 0; index <= compact.length - 4; index += 1) {
        if (evidenceSource.indexOf(compact.slice(index, index + 4)) >= 0) return true;
      }
      return false;
    };
    var hasGroundedDriver = function (names) {
      return drivers.some(function (item) {
        return item && names.indexOf(item.driver) >= 0 &&
          typeof item.evidence === "string" && isAnchoredInFacts(item.evidence);
      });
    };

    var commitmentPattern = /(?:条件|认领|报数|加一个|追加|一半|抹零|搭子|共同下票|他给我就给|她给我就给|按.{0,6}(?:约定|报的|说的)|承诺一致)/;
    var contentPattern = /(?:撒娇|撒一个|撒个娇|新舞|返场|跳舞|舞蹈|才艺|表演|整活|节目|唱歌|点歌|点舞|想看|要看|喜欢看)/;
    if (commitmentPattern.test(facts) || (hasGroundedDriver(["other"]) && /(?:条件|认领|承诺|投入|边界|一致)/.test(facts))) {
      return { kind: "commitment", signal: signal };
    }
    if (signal && contentPattern.test(signal)) return { kind: "content", signal: signal };
    if (hasGroundedDriver(["protection"]) || /(?:守护|保护|托住|护住|新人|第一次上|手抖|紧张|快掉下去)/.test(facts)) {
      return { kind: "protection", signal: signal };
    }
    if (hasGroundedDriver(["belonging"]) || /(?:老朋友|一路走过|前几轮.{0,12}一起|共同经历|共同身份|归属)/.test(facts)) {
      return { kind: "belonging", signal: signal };
    }
    if (hasGroundedDriver(["status", "control"]) || /(?:关键位置|最后一手|拍板|你来定|选择权|带头|榜一|身份|排面)/.test(facts)) {
      return { kind: "status", signal: signal };
    }
    if (hasGroundedDriver(["reciprocity", "visibility"]) || /(?:被看见|我看见|我接住|具体回应|真实回馈|互惠|(?:刚才|刚刚|刚).{0,12}(?:补|投|组|送|支持)|下去票|刀票)/.test(facts)) {
      return { kind: "reciprocity", signal: signal };
    }
    if (hasGroundedDriver(["competition", "social_proof"]) || /(?:共同闯关|一起过关|翻盘|胜负|守位|十连|拿下这一关|跟票)/.test(facts)) {
      return { kind: "competition", signal: signal };
    }
    return { kind: "neutral", signal: signal };
  },

  _signalTerms: function (signal) {
    if (typeof signal !== "string") return [];
    return signal.split(/[，。！？：,;；\s]+/).map(function (part) {
      return part
        .replace(/^(刚才|刚刚|他说|她说|对方说|用户说|你)/, "")
        .replace(/(我考虑一下|考虑一下|可以吗|好不好)$/, "")
        .replace(/个/g, "")
        .trim();
    }).filter(function (part) { return part.length >= 2; });
  },

  _hasHiddenActionRequirement: function (text, focusKey) {
    if (typeof text !== "string" || !text.trim()) return false;
    var explicitAction = /(扣\s*[01一零]|打个\s*[01一零]|评论(?:区)?|公屏|反馈入口|补一点|跟一点|组一组|帮我组|补一脚|上几张|上票|投票|补票)/;
    var abstractAction = /(?:(?:互动|可回应|回应的|可执行|具体).{0,4}动作|缺少.{0,6}动作|还(?:没|没有).{0,6}动作|递出.{0,6}动作|邀请(?:对方|他|她|用户).{0,6}(?:回应|接话)|让(?:对方|他|她|用户).{0,6}(?:回应|接话)|没有让(?:对方|他|她|用户).{0,6}(?:回应|接话)|还没有邀请(?:对方|他|她|用户).{0,6}(?:回应|接话))/;
    if (explicitAction.test(text) || abstractAction.test(text)) return true;
    return focusKey === "target_user" && /(?:动作|让.{0,6}接话|邀请.{0,6}回应)/.test(text);
  },

  _directionMatchesFocus: function (text, focus) {
    if (typeof text !== "string" || !text.trim() || !focus) return false;
    var scenario = Report._scenario();
    var keywords = {
      self_intro: ["名字", "自我介绍", "看点", "记住你", "你是谁"],
      gratitude: ["感谢", "谢谢", "礼物", "参与", "动作", "接住"],
      target_user: ["昵称", "点到", "喊到", "叫到", "直接对", "说给", "具体用户"],
      user_reason: [
        "理由", "想看", "乐趣", "选择", "回应", "参与", "互动", "撒娇", "愿意",
        "条件", "认领", "报数", "边界", "公平", "承诺", "一致性",
        "保护", "守护", "托住", "归属", "共同经历", "共同身份", "老朋友", "一起闯",
        "关键位置", "身份", "带头", "拍板", "被看见", "看见", "互惠", "回馈", "兑现",
        "竞争", "胜负", "过关", "翻盘", "守位", "跟随", "从众",
      ],
      vote_instruction: ["票差", "还差", "补一脚", "上票", "投票", "认领", "动作", "等主持", "主持口令", "统一丢"],
    };
    var terms = keywords[focus.key] ? keywords[focus.key].slice() : [];
    var target = Report._fact(scenario.targetUser, "");
    if (focus.key === "target_user" && target) terms.push(target);
    if (focus.key === "user_reason") terms = terms.concat(Report._signalTerms(scenario.userSignal));
    var matches = terms.some(function (term) { return term && text.indexOf(term) >= 0; });
    if (!matches) return false;

    // 编号关只展示真正属于本关的模型建议，避免把下一关条件偷偷塞进来。
    if (focus.key === "target_user" && (/(理由|参与后|乐趣|选择权|票差|还差\s*\d)/.test(text) || Report._hasHiddenActionRequirement(text, focus.key))) return false;
    if (focus.key === "user_reason" && (/(票差|还差\s*\d|投.{0,3}票|上.{0,3}票|准确数字)/.test(text) || Report._hasHiddenActionRequirement(text, focus.key))) return false;
    if (focus.key === "user_reason" && Report._isNegativeSignal(scenario.userSignal)) {
      var rejectedContent = ["撒娇", "返场", "新舞", "跳舞", "唱歌", "表演", "整活"].filter(function (term) {
        return scenario.userSignal.indexOf(term) >= 0 && text.indexOf(term) >= 0;
      });
      if (rejectedContent.length && !/(不想|不愿|拒绝|尊重|不要|别|换一个|替代|另一个)/.test(text)) return false;
    }
    return true;
  },

  _specificDirectionFor: function (report, focus) {
    var challenge = Report._challengeFor(focus);
    var direction = report && report.direction ? report.direction : {};
    var summary = typeof direction.summary === "string" ? direction.summary.trim() : "";
    if (!challenge.number || !Report._directionMatchesFocus(summary, focus)) return "";
    return summary === challenge.method ? "" : summary;
  },

  _specificOneThingFor: function (report, focus) {
    var oneThing = report && typeof report.one_thing === "string"
      ? report.one_thing.trim()
      : "";
    if (!oneThing) return "";
    var challenge = Report._challengeFor(focus);
    if (!challenge.number) return oneThing;
    return Report._directionMatchesFocus(oneThing, focus) ? oneThing : "";
  },

  _helpItemsFor: function (report, focus) {
    var challenge = Report._challengeFor(focus);
    var scenario = Report._scenario();
    var target = Report._fact(scenario.targetUser, "这个用户");
    var signal = Report._fact(scenario.userSignal, "");
    if (focus && focus.key === "target_user") {
      return [
        "先找到你真正要对他说的那句，在前面直接叫“" + target + "”。",
        "再读一遍：这句话是在对“" + target + "”说，不是在向全场提到他。这关不用补理由、票差或上票动作。",
      ];
    }
    if (focus && focus.key === "user_reason") {
      var reasonSupport = Report._reasonSupportFor(report);
      if (reasonSupport.kind === "negative") {
        return [
          "先把现场这句当成拒绝来听：“" + signal + "”不要反着理解，也不要照着做。",
          "再给一个真实替代选择，保留对方拒绝和拍板的空间；不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "content") {
        var contentScaffold = /撒(?:个)?娇/.test(signal)
          ? target + "，你刚说想看我撒娇，那我现在撒一个给你看。"
          : (/返场/.test(signal)
            ? target + "，你刚说想看返场，那我把返场留给你。"
            : target + "，你刚才递了这个内容信号，我给你一个明确回应。");
        return [
          "先把现场这句接回来：“" + signal + "”",
          "用这个最小骨架自检：“" + contentScaffold + "”只换成你平时会说的词，不用照抄整段，也不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "commitment") {
        return [
          signal
            ? "先按事实接住这次条件变化或认领：“" + signal + "”"
            : "先从现场找出已经发生的条件、报数或认领，不把占位说成到账。",
          "用这个最小骨架自检：“" + target + "，你刚才这次认领我看见了，我按你真实说的接，不替你加。”换成你自己的词，不用补票差或新的上票动作。",
        ];
      }
      if (reasonSupport.kind === "protection") {
        return [
          "先说准现场里的真实处境，再给对方一个可以自主选择的守护位置；不要只重复自己有多难。",
          "用这个最小骨架自检：“" + target + "，这一轮你愿意就来托我一下，这个位置我会接稳。”换成你自己的词，不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "belonging") {
        return [
          "先找到现场里真实的共同经历或共同身份，只有一句“家人们”不算证据。",
          "用这个最小骨架自检：“" + target + "，前面咱们一起走过，这一拍我想把这段关系接下去。”换成你自己的词，不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "status") {
        return [
          "先找到现场里真实的关键位置或选择，再把决定权留给“" + target + "”，不要替他拍板。",
          "用这个最小骨架自检：“" + target + "，这一拍把决定权留给你，你想怎么接由你定。”换成你自己的词，不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "reciprocity") {
        return [
          "先说准“" + target + "”已经做过的那次参与，不把方向不明的动作硬写成喜欢或保护。",
          "用这个最小骨架自检：“" + target + "，你刚才那次参与我看见了，这一拍我先把回应接给你。”换成你自己的词，不用补票差或上票动作。",
        ];
      }
      if (reasonSupport.kind === "competition") {
        return [
          "先找到真实的胜负、过关或跟随局势，再说清对方能在共同目标里接什么位置。",
          "用这个最小骨架自检：“" + target + "，这一轮咱们是在一起过这一关，你愿意就继续和我们走这一拍。”换成你自己的词，不用补票差或上票动作。",
        ];
      }
      return [
        signal
          ? "先把这句按原意拆成可观察事实：“" + signal + "”；证据不够时不要替用户补动机。"
          : "现场没有给出具体用户信号时，先不要写“他想看”或“他喜欢”；去找一条真实动作、关系或局势。",
        "用这个问题自检：“我依据的是他的哪句原话、哪个动作或哪段共同经历？”找到证据后再用自己的词接，不用补票差或上票动作。",
      ];
    }
    if (focus && focus.key === "vote_instruction") {
      var waitingForHost = scenario.phase === "awaiting_drop";
      if (waitingForHost) return [
        "先把事实说准：位置已经占满，但占位不等于全部到账。",
        "再把动作交代清楚：先别提前丢，按约定等主持统一口令；不要继续喊人补位。",
      ];
      if (scenario.phase === "delivery") return [
        "主持已经发令，先看真实到账，不把口头占位全说成已经收到。",
        "接住正在兑现的人并感谢，不再等口令，也不重新找人占位。",
      ];
      if (scenario.phase === "result" || scenario.phase === "post_round") return [
        "先确认这轮已经结束，不再重复上一拍的拉票动作。",
        "接住共同完成和真实参与，感谢后把关系自然带到下一轮。",
      ];
      return [
        "先看现在还缺不缺位置，不必为了过关重新算一个漂亮数字。",
        "用你平时的话递一个明确动作：补一脚、跟一点、上几张、认一个或认一手。",
      ];
    }
    if (challenge.number) return Array.isArray(challenge.hints) ? challenge.hints : [];
    var direction = report.direction || {};
    return Array.isArray(direction.examples) ? direction.examples : [];
  },

  _coachingState: function () {
    if (!App.state.coaching) {
      if (App.resetCoachingProgress) App.resetCoachingProgress();
      else {
        App.state.coaching = {
          totalAttempts: 0,
          focusAttempts: 0,
          currentFocusKey: "",
          previousReport: null,
          currentReport: null,
          lastProgress: null,
          masteredKeys: {},
        };
      }
    }
    return App.state.coaching;
  },

  _recordResult: function (report) {
    var state = Report._coachingState();
    if (state.currentReport === report && state.lastProgress) return state.lastProgress;
    if (!state.masteredKeys) state.masteredKeys = {};
    var previousReport = state.currentReport;
    var checks = Report._checks(report);
    var focus = report.verdict === "passed" ? null : Report._focusCheck(checks, report);
    var previousChecks = previousReport ? Report._checks(previousReport) : [];
    var previousStatus = {};
    previousChecks.forEach(function (check) { previousStatus[check.key] = check.status; });

    var newlyMastered = checks.filter(function (check) {
      return check.status === "met" && !state.masteredKeys[check.key];
    });
    var needsReinforcement = checks.filter(function (check) {
      return previousStatus[check.key] === "met" && check.status !== "met";
    });
    var applicableCount = checks.filter(function (check) { return check.status !== "na"; }).length;
    var metCount = checks.filter(function (check) { return check.status === "met"; }).length;

    state.totalAttempts += 1;
    checks.forEach(function (check) {
      if (check.status === "met") state.masteredKeys[check.key] = true;
    });
    state.previousReport = previousReport;
    state.currentReport = report;
    if (focus) {
      state.focusAttempts = state.currentFocusKey === focus.key ? state.focusAttempts + 1 : 1;
      state.currentFocusKey = focus.key;
    } else {
      state.focusAttempts = 0;
      state.currentFocusKey = "";
    }

    var progress = {
      checks: checks,
      focus: focus,
      metCount: metCount,
      applicableCount: applicableCount,
      newlyMastered: newlyMastered,
      needsReinforcement: needsReinforcement,
      totalAttempts: state.totalAttempts,
      focusAttempts: state.focusAttempts,
      isFirstResult: !previousReport,
    };
    state.lastProgress = progress;
    return progress;
  },

  _checks: function (report) {
    var incoming = Array.isArray(report.structure_checks) ? report.structure_checks : [];
    var phase = Report._scenario().phase || "";
    var applicableByPhase = {
      pledging: ["gratitude", "target_user", "user_reason", "vote_instruction"],
      closing: ["gratitude", "user_reason", "vote_instruction"],
      awaiting_drop: ["gratitude", "user_reason", "vote_instruction"],
      delivery: ["gratitude", "user_reason", "vote_instruction"],
      result: ["gratitude", "user_reason", "vote_instruction"],
      post_round: ["gratitude", "user_reason", "vote_instruction"],
    };
    var applicableKeys = applicableByPhase[phase] || null;
    return Report.STRUCTURE.map(function (definition) {
      var found = null;
      for (var i = 0; i < incoming.length; i++) {
        if (incoming[i] && incoming[i].key === definition.key) {
          found = incoming[i];
          break;
        }
      }
      var status = found && ["met", "partial", "missing"].indexOf(found.status) >= 0
        ? found.status
        : (report.verdict === "passed" ? "met" : "missing");
      var applicable = !applicableKeys || applicableKeys.indexOf(definition.key) >= 0;
      return {
        key: definition.key,
        label: definition.label,
        status: applicable ? status : "na",
        evidence: applicable
          ? (found && typeof found.evidence === "string" ? found.evidence : "这一项还没说清楚")
          : "这是中途切片，这一拍不用重复补这一项。",
      };
    });
  },

  _focusCheck: function (checks, report) {
    // 安全和整体方向要先于结构缺口，否则红线稿会被误导成只补“认识我”。
    if (report && report.redline_note) {
      return { key: "redline", label: "不能播的表达", status: "missing", evidence: report.redline_note };
    }
    if (report && (report.card_type === "persona" || report.ai_flavor)) {
      return {
        key: "persona",
        label: "自己的语气",
        status: "partial",
        evidence: report.ai_flavor || report.card_why || "结构齐了，但还像一套谁都能念的话。",
      };
    }
    if (
      report &&
      report.verdict === "off" &&
      ["logic", "expression", "mentality"].indexOf(report.card_type) >= 0
    ) {
      var cardLabels = {
        logic: "上票支点",
        expression: "说话方式",
        mentality: "开口底气",
      };
      return {
        key: report.card_type,
        label: cardLabels[report.card_type],
        status: "missing",
        evidence: report.card_why || report.verdict_reason || "整体方向要先站稳，再补结构。",
      };
    }

    for (var i = 0; i < checks.length; i++) {
      if (checks[i].status !== "met" && checks[i].status !== "na") return checks[i];
    }

    // 结构全齐不代表一定过关：某句站错角度仍是真正的本轮焦点。
    var reviews = report && Array.isArray(report.line_reviews) ? report.line_reviews : [];
    for (var j = 0; j < reviews.length; j++) {
      if (reviews[j] && reviews[j].mark !== "good") {
        return {
          key: "line_angle",
          label: "说话角度",
          status: "partial",
          evidence: reviews[j].original || reviews[j].comment || "有一句还需要换到观众角度。",
        };
      }
    }
    return {
      key: "final_polish",
      label: "关键一句",
      status: "partial",
      evidence: (report && (report.verdict_reason || report.card_why)) || "结构齐了，再把最关键的一句说到观众身上。",
    };
  },

  _progressMessage: function (progress, focus) {
    var challenge = Report._challengeFor(focus);
    var labels = progress.newlyMastered.map(function (check) { return check.label; });
    if (!challenge.number && progress.metCount === progress.applicableCount) {
      return "这一拍该做的已经齐了，不用补中途不适用的结构。现在只过最后一道“" + challenge.title + "”加练关。";
    }
    if (progress.needsReinforcement && progress.needsReinforcement.length) {
      return "你已经拿下本拍 " + progress.metCount + "/" + progress.applicableCount + " 项。这一关刚刚松了一点，先把它补稳。";
    }
    if (labels.length && progress.isFirstResult) {
      return "第一次挑战已经拿下“" + labels.join("、") + "”。不用从头重写，现在只补一个缺口。";
    }
    if (labels.length) {
      return "刚刚新拿下“" + labels.join("、") + "”。上一关已经结束，现在只看这一关。";
    }
    if (progress.metCount > 0) {
      return "你已经拿下本拍 " + progress.metCount + "/" + progress.applicableCount + " 项。已经做到的先保留，这次只攻“" + focus.label + "”。";
    }
    return "这不是整篇都不行。先只拿下“" + focus.label + "”，其他地方这一轮先不动。";
  },

  _heading: function (report, focus, progress) {
    var heading = Report._el("header", "review-heading");
    var challenge = Report._challengeFor(focus);
    var eyebrow = "话术闯关 · 第 " + progress.totalAttempts + " 次挑战";
    var title = challenge.number
      ? "第 " + challenge.number + " 关 · " + challenge.title
      : "加练关 · " + challenge.title;
    heading.setAttribute("aria-live", "polite");
    heading.appendChild(Report._el("span", null, eyebrow));
    heading.appendChild(Report._el("h1", null, title));
    heading.appendChild(Report._el("p", "review-heading__progress", Report._progressMessage(progress, focus)));
    if (report.echo) heading.appendChild(Report._el("p", "review-heading__echo", report.echo));
    return heading;
  },

  _structureTrack: function (checks, focus) {
    var track = Report._el("div", "structure-track");
    track.setAttribute("aria-label", "本轮五项话术结构完成情况");
    checks.forEach(function (check, index) {
      var isCurrent = focus && focus.key === check.key;
      var item = Report._el(
        "span",
        "structure-check structure-check--" + check.status + (isCurrent ? " is-current" : ""),
        check.label
      );
      item.dataset.step = String(index + 1);
      var stateText = check.status === "met" ? "已做到" : check.status === "partial" ? "还差一点" : check.status === "na" ? "本拍不适用" : "未出现";
      item.title = check.label + "：" + stateText + "。" + check.evidence;
      item.setAttribute("aria-label", item.title);
      if (isCurrent) item.setAttribute("aria-current", "step");
      track.appendChild(item);
    });
    return track;
  },

  _challengeMap: function (checks, focus, progress) {
    var map = Report._el("section", "challenge-map");
    var head = Report._el("div", "challenge-map__head");
    head.appendChild(Report._el("strong", null, "你的能力地图"));
    head.appendChild(Report._el("span", null, Report._mapStatus(progress, focus)));
    map.appendChild(head);

    var bar = Report._el("div", "challenge-progress");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(progress.applicableCount));
    bar.setAttribute("aria-valuenow", String(progress.metCount));
    bar.setAttribute("aria-label", "本拍适用能力已完成 " + progress.metCount + " 项，共 " + progress.applicableCount + " 项");
    var fill = Report._el("span", "challenge-progress__fill");
    fill.style.transform = "scaleX(" + (progress.applicableCount ? progress.metCount / progress.applicableCount : 0) + ")";
    bar.appendChild(fill);
    map.appendChild(bar);
    map.appendChild(Report._structureTrack(checks, focus));
    return map;
  },

  _focusWhy: function (report, focus) {
    var reviews = Array.isArray(report.line_reviews) ? report.line_reviews : [];
    if (focus && focus.key === "line_angle") {
      for (var i = 0; i < reviews.length; i++) {
        if (reviews[i] && reviews[i].mark !== "good" && reviews[i].comment) return reviews[i].comment;
      }
    }
    var challenge = Report._challengeFor(focus);
    if (challenge.number && challenge.why) return challenge.why;
    return report.card_why || report.verdict_reason || (focus.label + "没落到现场，观众就不知道怎么接你的话。");
  },

  _challengeRow: function (label, text, className) {
    var row = Report._el("div", "challenge-card__row" + (className ? " " + className : ""));
    row.appendChild(Report._el("span", "challenge-card__label", label));
    row.appendChild(Report._el("p", null, text));
    return row;
  },

  _focusPaper: function (report, focus, progress) {
    var challenge = Report._challengeFor(focus);
    var guidance = Report._guidanceFor(report, focus, progress);
    var paper = Report._el("section", "focus-paper" + (report.redline_note ? " focus-paper--redline" : ""));
    var head = Report._el("div", "focus-paper__head");
    var attemptText = progress.focusAttempts > 1
      ? "第 " + progress.focusAttempts + " 次攻这关"
      : "当前只练这一关";
    head.appendChild(Report._el("span", null, attemptText));
    head.appendChild(Report._el("span", "focus-paper__tag", challenge.number ? "第 " + challenge.number + " 关" : "加练"));
    paper.appendChild(head);

    paper.appendChild(Report._el("h2", null, challenge.title));
    if (guidance) {
      paper.appendChild(Report._challengeRow(
        "已经做到什么",
        guidance.completed,
        "challenge-card__row--done"
      ));
      paper.appendChild(Report._challengeRow(
        "这关只差什么",
        guidance.gap,
        "challenge-card__row--evidence challenge-card__row--only-gap"
      ));
    } else {
      paper.appendChild(Report._challengeRow(
        "真正卡点",
        report.redline_note || focus.evidence,
        "challenge-card__row--evidence"
      ));
    }
    paper.appendChild(Report._challengeRow("为什么会卡", Report._focusWhy(report, focus)));
    paper.appendChild(Report._challengeRow("过关标准", challenge.standard));

    paper.appendChild(Report._challengeRow(
      "解题方法",
      Report._solutionFor(report, focus),
      "challenge-card__row--solution"
    ));
    var specificDirection = Report._specificDirectionFor(report, focus);
    if (specificDirection) {
      paper.appendChild(Report._challengeRow(
        "结合你这版",
        specificDirection,
        "challenge-card__row--specific"
      ));
    }
    var specificOneThing = Report._specificOneThingFor(report, focus);
    if (specificOneThing) {
      paper.appendChild(Report._el("p", "focus-paper__takeaway", "记住这一点：" + specificOneThing));
    }
    return paper;
  },

  _helpPanel: function (report, focus, progress) {
    var challenge = Report._challengeFor(focus);
    var helpItems = Report._helpItemsFor(report, focus);
    if (!helpItems.length) return null;

    var isOpen = Report._shouldOpenHelp(progress);
    var panel = Report._el(isOpen ? "section" : "details", "challenge-help" + (isOpen ? " challenge-help--open" : ""));
    if (isOpen) {
      panel.setAttribute("aria-live", "polite");
      panel.appendChild(Report._el("span", "challenge-help__eyebrow", "先别怀疑自己，我们只核对这一小步"));
      panel.appendChild(Report._el("h3", null, challenge.number ? "不会再增加新条件，就按这两步检查" : "不用再猜，先借下面这个角度"));
    } else {
      panel.appendChild(Report._el("summary", null, challenge.number ? "卡住了？展开看两个小动作" : "卡住了？展开看一步局部提示"));
    }
    panel.appendChild(Report._el(
      "p",
      null,
      challenge.number
        ? "这不是整段都不行。按这两步检查自己的原话，不用寻找一整句标准答案。"
        : "只看局部怎么转，不要整句照抄；换回你平时会说的词。"
    ));
    var list = Report._el("ul", "challenge-help__examples");
    helpItems.forEach(function (item) {
      list.appendChild(Report._el("li", null, item));
    });
    panel.appendChild(list);
    return panel;
  },

  _revisionDesk: function (focus, progress) {
    var challenge = Report._challengeFor(focus);
    var section = Report._el("section", "revision-desk");
    var label = Report._el("label", null, "过这一关：只改“" + challenge.title + "”");
    label.setAttribute("for", "revision-script");
    section.appendChild(label);
    section.appendChild(Report._el(
      "p",
      "revision-desk__hint",
      "下面还是你自己的原话。已经拿下的本拍 " + progress.metCount + " 项先保留，不用重写整篇。"
    ));

    var input = Report._el("textarea", "revision-input");
    input.id = "revision-script";
    input.setAttribute("aria-describedby", "revision-state");
    input.maxLength = LIMITS.scriptMax;
    input.rows = 7;
    input.value = App.state.lastRequest ? App.state.lastRequest.script : "";
    section.appendChild(input);

    var original = input.value.trim();
    var foot = Report._el("div", "revision-desk__foot");
    var state = Report._el("span", "revision-state", "先按上面的解题方法动一处");
    state.id = "revision-state";
    var count = Report._el("span", "revision-count");
    foot.appendChild(state);
    foot.appendChild(count);
    section.appendChild(foot);

    var buttonText = progress.focusAttempts >= 2
      ? "带着提示，再挑战一次"
      : "只改这一处，提交下一次挑战";
    var button = Report._el("button", "training-primary revision-submit", buttonText);
    button.type = "button";
    button.disabled = true;
    section.appendChild(button);

    var syncCount = function () {
      var value = input.value.trim();
      var changed = value !== original;
      var valid = value.length >= LIMITS.scriptMin && value.length <= LIMITS.scriptMax;
      count.textContent = value.length + " / " + LIMITS.scriptMax;
      button.disabled = !changed || !valid;
      if (!changed) state.textContent = "先按上面的解题方法动一处";
      else if (!valid) state.textContent = "至少保留一句完整的话";
      else state.textContent = "已经改动，可以继续挑战";
    };
    input.addEventListener("input", syncCount);
    syncCount();
    button.addEventListener("click", function () {
      Form.submitRevision(input.value);
    });
    return section;
  },

  _reviewCommentFor: function (comment, focus) {
    var text = typeof comment === "string" ? comment.trim() : "";
    if (!text || !focus) return text;
    if (
      focus.key === "target_user" &&
      (Report._hasHiddenActionRequirement(text, focus.key) || /(给(?:参与)?理由|参与后|乐趣|选择权|票差|还差\s*\d)/.test(text))
    ) {
      return "这句还没有明确说给当前目标用户；本关只核对称呼，不检查理由、票差或动作。";
    }
    if (
      focus.key === "user_reason" &&
      (Report._hasHiddenActionRequirement(text, focus.key) || /(票差|还差\s*\d)/.test(text))
    ) {
      return "这句还没把现场事实变成对方愿意参与的理由；可以落到回应、选择、被看见、关系角色或共同闯关，本关不检查评论或上票动作。";
    }
    return text;
  },

  _fullReview: function (report, checks, focus) {
    var details = Report._el("details", "review-details");
    details.appendChild(Report._el("summary", null, "为什么这样判断 · 查看完整复盘"));

    if (report.audience) {
      var audience = Report._el("p");
      audience.appendChild(Report._el("strong", null, "你这段话在对谁说："));
      audience.appendChild(document.createTextNode(report.audience));
      details.appendChild(audience);
    }

    var structureList = Report._el("ul", "line-review-list");
    checks.forEach(function (check) {
      var item = Report._el("li", "line-review-item line-review-item--" + (check.status === "met" ? "good" : "partial"));
      var statusText = check.status === "met" ? "做到" : check.status === "partial" ? "差一点" : check.status === "na" ? "本拍不适用" : "没出现";
      item.appendChild(Report._el("strong", null, check.label + " · " + statusText));
      item.appendChild(Report._el("p", null, check.evidence));
      structureList.appendChild(item);
    });
    details.appendChild(structureList);

    var reviews = Array.isArray(report.line_reviews) ? report.line_reviews : [];
    if (reviews.length) {
      details.appendChild(Report._el("p", null, "逐句看："));
      details.appendChild(Report._lineReviewList(reviews, focus));
    }

    return details;
  },

  _lineReviewList: function (reviews, focus) {
    var list = Report._el("ul", "line-review-list");
    reviews.forEach(function (review) {
      if (!review) return;
      var mark = ["good", "partial", "wrong"].indexOf(review.mark) >= 0 ? review.mark : "partial";
      var label = mark === "good" ? "站对了" : mark === "wrong" ? "这句会吃亏" : "还差一点";
      var item = Report._el("li", "line-review-item line-review-item--" + mark);
      item.appendChild(Report._el("strong", null, label + (review.original ? " · “" + review.original + "”" : "")));
      var safeComment = Report._reviewCommentFor(review.comment, focus);
      if (safeComment) item.appendChild(Report._el("p", null, safeComment));
      list.appendChild(item);
    });
    return list;
  },

  _roundDynamicsText: function (value) {
    return typeof value === "string" ? value.trim() : "";
  },

  _roundDynamicsDriverLabel: function (driver) {
    var key = Report._roundDynamicsText(driver);
    return Object.prototype.hasOwnProperty.call(Report.DRIVER_LABELS, key)
      ? Report.DRIVER_LABELS[key]
      : Report.DRIVER_LABELS.other;
  },

  _roundDynamicsTextItem: function (label, text, className) {
    if (!text) return null;
    var item = Report._el("article", "round-dynamics__item" + (className ? " " + className : ""));
    item.appendChild(Report._el("h3", "round-dynamics__label", label));
    item.appendChild(Report._el("p", "round-dynamics__copy", text));
    return item;
  },

  _roundDynamics: function (report) {
    var dynamics = report && report.round_dynamics;
    if (!dynamics || typeof dynamics !== "object" || Array.isArray(dynamics)) return null;

    var flowRead = Report._roundDynamicsText(dynamics.flow_read);
    var responseRead = Report._roundDynamicsText(dynamics.response_read);
    var nextMove = Report._roundDynamicsText(dynamics.next_move);
    var drivers = [];
    var incomingDrivers = Array.isArray(dynamics.human_drivers) ? dynamics.human_drivers : [];

    incomingDrivers.forEach(function (item) {
      if (drivers.length >= 3) return;
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      var driver = Report._roundDynamicsText(item.driver);
      var evidence = Report._roundDynamicsText(item.evidence);
      var mechanism = Report._roundDynamicsText(item.mechanism);
      if (!driver || (!evidence && !mechanism)) return;
      drivers.push({
        label: Report._roundDynamicsDriverLabel(driver),
        evidence: evidence,
        mechanism: mechanism,
      });
    });

    if (!flowRead && !drivers.length && !responseRead && !nextMove) return null;

    var sectionClass = "round-dynamics" + (report.verdict === "passed" ? " round-dynamics--passed" : "");
    var section = Report._el("section", sectionClass);
    section.setAttribute("aria-label", "这一轮的现场拆解");

    var head = Report._el("div", "round-dynamics__head");
    head.appendChild(Report._el("strong", null, "现场拆解"));
    head.appendChild(Report._el("span", null, "读事实 → 找可能 → 下一拍"));
    section.appendChild(head);

    var flowItem = Report._roundDynamicsTextItem("这一轮发生了什么", flowRead, "round-dynamics__item--flow");
    if (flowItem) section.appendChild(flowItem);

    if (drivers.length) {
      var driverItem = Report._el("article", "round-dynamics__item round-dynamics__item--drivers");
      driverItem.appendChild(Report._el("h3", "round-dynamics__label", "可能在起作用的机制"));
      var driverList = Report._el("ul", "round-dynamics__driver-list");
      drivers.forEach(function (driver) {
        var row = Report._el("li", "round-dynamics__driver");
        row.appendChild(Report._el("span", "round-dynamics__driver-name", driver.label));
        var detail = Report._el("div", "round-dynamics__driver-detail");
        if (driver.evidence) {
          detail.appendChild(Report._el("p", "round-dynamics__driver-evidence", driver.evidence));
        }
        if (driver.mechanism) {
          detail.appendChild(Report._el("p", "round-dynamics__driver-mechanism", "待验证解释：" + driver.mechanism));
        }
        row.appendChild(detail);
        driverList.appendChild(row);
      });
      driverItem.appendChild(driverList);
      section.appendChild(driverItem);
    }

    var responseItem = Report._roundDynamicsTextItem("用户反馈怎么读", responseRead, "round-dynamics__item--response");
    if (responseItem) section.appendChild(responseItem);
    var nextItem = Report._roundDynamicsTextItem("下一拍", nextMove, "round-dynamics__item--next");
    if (nextItem) section.appendChild(nextItem);

    return section;
  },

  _renderPassedRoundDynamics: function (report) {
    var root = document.getElementById("passed-round-dynamics");
    if (!root) return;
    Report._clear(root);
    var section = Report._roundDynamics(report);
    if (!section) {
      root.hidden = true;
      return;
    }
    root.appendChild(section);
    root.hidden = false;
  },

  _renderPassedStructure: function (progress) {
    var root = document.getElementById("passed-structure-track");
    if (!root) return;
    Report._clear(root);
    var checks = progress && Array.isArray(progress.checks) ? progress.checks : [];
    if (!checks.length) {
      root.hidden = true;
      return;
    }

    var head = Report._el("div", "passed-structure-summary__head");
    head.appendChild(Report._el("strong", null, "本轮能力状态"));
    head.appendChild(Report._el("span", null, progress.metCount + "/" + progress.applicableCount + " 本拍已做到"));
    root.appendChild(head);
    root.appendChild(Report._structureTrack(checks, null));
    root.hidden = false;
  },

  _showRedlineBanner: function (note) {
    var banner = document.getElementById("redline-banner");
    banner.textContent = note ? "不能带进直播间：" + note : "";
    banner.hidden = !note;
  },

  showContent: function (report) {
    Report._stopLoadingMessages();
    document.getElementById("report-loading").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;
    document.getElementById("btn-back-edit").disabled = false;
    Report._showRedlineBanner(report.redline_note);

    var content = document.getElementById("report-content");
    Report._clear(content);
    content.hidden = false;

    var progress = Report._recordResult(report);
    var checks = progress.checks;
    var focus = progress.focus;
    content.appendChild(Report._heading(report, focus, progress));
    content.appendChild(Report._challengeMap(checks, focus, progress));
    content.appendChild(Report._focusPaper(report, focus, progress));
    var roundDynamics = Report._roundDynamics(report);
    if (roundDynamics) content.appendChild(roundDynamics);
    var help = Report._helpPanel(report, focus, progress);
    if (help) content.appendChild(help);
    content.appendChild(Report._revisionDesk(focus, progress));
    content.appendChild(Report._fullReview(report, checks, focus));
    App.showView("report");
  },

  showPassed: function (report) {
    Report._stopLoadingMessages();
    var progress = Report._recordResult(report);
    Report._showRedlineBanner("");
    document.getElementById("btn-back-edit").disabled = false;
    document.getElementById("passed-script").textContent = App.state.lastRequest ? App.state.lastRequest.script : "";

    var passedGoal = document.querySelector(".training-goal--passed");
    if (passedGoal) {
      var passedEyebrow = passedGoal.querySelector("span");
      var passedTitle = passedGoal.querySelector("h1");
      if (passedEyebrow) passedEyebrow.textContent = "核心逻辑已过关";
      if (passedTitle) passedTitle.textContent = "第 " + progress.totalAttempts + " 次挑战，这一轮可以开口练";
    }
    Report._renderPassedStructure(progress);

    var learn = document.getElementById("passed-learn");
    Report._clear(learn);
    var main = report.verdict_reason || "参与理由和上票动作已经站稳，这一轮可以拿去练开口。";
    learn.appendChild(Report._el("p", null, main));
    var achievement = Report._passAchievement(progress);
    if (achievement) learn.appendChild(Report._el("p", "passed-new-skill", achievement));
    if (report.one_thing) learn.appendChild(Report._el("p", null, "你真正学会的是：" + report.one_thing));
    learn.appendChild(Report._el(
      "p",
      "passed-self-check",
      "以后自己走这条链路：看现场、抓人性、递动作、看反馈、接下一拍。"
    ));
    Report._renderPassedRoundDynamics(report);

    App.showView("passed");
  },

  showLoading: function () {
    Report._showRedlineBanner("");
    document.getElementById("report-content").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;
    document.getElementById("btn-back-edit").disabled = true;
    document.getElementById("report-loading").hidden = false;
    var state = Report._coachingState();
    var title = document.querySelector("#report-loading h1");
    if (title) title.textContent = "教练正在看第 " + (state.totalAttempts + 1) + " 次挑战";
    Report._startLoadingMessages();
  },

  _startLoadingMessages: function () {
    Report._stopLoadingMessages();
    var messages = [
      "先找已经拿下的能力，再定位这一轮真正卡住的一关。",
      "只给一个清楚的过关标准，不会一次塞给你一堆问题。",
      "不会替你重写整篇，教练只陪你把自己的原话改到能用。",
    ];
    var index = 0;
    var node = document.getElementById("loading-message");
    node.textContent = messages[index];
    Report._loadingTimer = setInterval(function () {
      index = (index + 1) % messages.length;
      node.textContent = messages[index];
    }, 4200);
  },

  _stopLoadingMessages: function () {
    if (Report._loadingTimer) clearInterval(Report._loadingTimer);
    Report._loadingTimer = null;
  },

  showError: function (message) {
    Report._stopLoadingMessages();
    document.getElementById("report-loading").hidden = true;
    document.getElementById("report-content").hidden = true;
    document.getElementById("btn-back-edit").disabled = false;
    Report._showRedlineBanner("");

    var errorBox = document.getElementById("report-error");
    Report._clear(errorBox);
    errorBox.appendChild(Report._el("p", null, message));
    errorBox.hidden = false;
    document.getElementById("btn-retry").hidden = false;
    setTimeout(function () { if (App.focusElement) App.focusElement(errorBox); }, 0);
  },

  _onBackEdit: function () {
    Report._stopLoadingMessages();
    Form.restore(App.state.form || App.state.lastRequest);
    App.showView("form");
  },

  _onRetry: function () {
    if (!App.state.lastRequest) return;
    Report._submitAgain(App.state.lastRequest);
  },

  _submitAgain: function (request) {
    App.showView("report");
    Report.showLoading();
    Api.submit(request, {
      onSuccess: function (report) {
        App.state.lastReport = report;
        if (report.verdict === "passed") Report.showPassed(report);
        else Report.showContent(report);
      },
      onError: function (status, message) {
        if (status === 401) {
          App.showView("form");
          App.showAccessModal(function () { Report._submitAgain(request); }, { invalid: true, clear: true });
        } else {
          App.showView("report");
          Report.showError(message);
        }
      },
      onFinish: function () {},
    });
  },

  _onStartVoice: function () {
    var script = document.getElementById("passed-script").textContent;
    if (!script || !window.VoiceCoach) {
      App.toast("开口教练还没准备好，先复制这版话术");
      return;
    }
    App.unlockStage("voice");
    VoiceCoach.open({
      script: script,
      onBack: function () { App.showView("passed"); },
    });
    App.showView("voice");
  },

  _onCopy: function () {
    var script = document.getElementById("passed-script").textContent;
    if (!script) return;
    var done = function () { App.toast("已复制，可以去开口练了"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(script).then(done, function () { Report._copyFallback(script, done); });
    } else {
      Report._copyFallback(script, done);
    }
  },

  _copyFallback: function (text, done) {
    var field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (error) { copied = false; }
    document.body.removeChild(field);
    if (copied) done();
    else App.toast("长按上面的稿子手动复制");
  },

  _onNewRound: function () {
    Report._stopLoadingMessages();
    if (window.VoiceCoach && VoiceCoach.reset) VoiceCoach.reset();
    App.state.form = null;
    App.state.lastRequest = null;
    App.state.lastReport = null;
    if (App.resetCoachingProgress) App.resetCoachingProgress();
    Form.reset();
    App.resetStages();
    App.showView("form");
  },
};
