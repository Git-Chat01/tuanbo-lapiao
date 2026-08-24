// 文字复盘：五项结构看进度，一轮只改一个关键缺口。
// 所有模型内容都通过 textContent 写入，避免把模型输出当成 HTML。

var Report = {
  STRUCTURE: [
    { key: "self_intro", label: "认识我" },
    { key: "gratitude", label: "接礼物" },
    { key: "target_user", label: "点到人" },
    { key: "user_reason", label: "给理由" },
    { key: "vote_instruction", label: "票数指令" },
  ],

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

  _checks: function (report) {
    var incoming = Array.isArray(report.structure_checks) ? report.structure_checks : [];
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
      return {
        key: definition.key,
        label: definition.label,
        status: status,
        evidence: found && typeof found.evidence === "string" ? found.evidence : "这一项还没说清楚",
      };
    });
  },

  _focusCheck: function (checks, report) {
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].status !== "met") return checks[i];
    }

    // 结构全齐不代表一定过关：红线、AI 腔或某句站错角度仍是真正的本轮焦点。
    // 不能因为找不到结构缺口就默认让学员回去改“自我介绍”。
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

  _heading: function (report) {
    var heading = Report._el("header", "review-heading");
    var eyebrow = report.verdict === "off" ? "这版先别带进直播间" : "方向对了，再补一处";
    var title = report.one_thing || report.verdict_reason || "先把一个关键点说到人身上";
    heading.appendChild(Report._el("span", null, eyebrow));
    heading.appendChild(Report._el("h1", null, title));
    if (report.echo) heading.appendChild(Report._el("p", null, report.echo));
    return heading;
  },

  _structureTrack: function (checks) {
    var track = Report._el("div", "structure-track");
    track.setAttribute("aria-label", "本轮五项话术结构完成情况");
    checks.forEach(function (check) {
      var item = Report._el(
        "span",
        "structure-check structure-check--" + check.status,
        check.label
      );
      var stateText = check.status === "met" ? "已做到" : check.status === "partial" ? "还差一点" : "未出现";
      item.title = check.label + "：" + stateText + "。" + check.evidence;
      item.setAttribute("aria-label", item.title);
      track.appendChild(item);
    });
    return track;
  },

  _focusWhy: function (report, focus) {
    var reviews = Array.isArray(report.line_reviews) ? report.line_reviews : [];
    for (var i = 0; i < reviews.length; i++) {
      if (reviews[i] && reviews[i].mark !== "good" && reviews[i].comment) return reviews[i].comment;
    }
    return report.card_why || report.verdict_reason || (focus.label + "没落到现场，观众就不知道怎么接你的话。");
  },

  _focusPaper: function (report, focus) {
    var paper = Report._el("section", "focus-paper");
    var head = Report._el("div", "focus-paper__head");
    head.appendChild(Report._el("span", null, "本轮只改一处"));
    head.appendChild(Report._el("span", "focus-paper__tag", focus.label));
    paper.appendChild(head);

    var title = focus.status === "missing"
      ? "先补上“" + focus.label + "”"
      : "把“" + focus.label + "”再说具体一点";
    if (report.redline_note) title = "先改掉不能播的表达";
    paper.appendChild(Report._el("h2", null, title));
    paper.appendChild(Report._el("blockquote", null, report.redline_note || focus.evidence));
    paper.appendChild(Report._el("p", "focus-paper__why", Report._focusWhy(report, focus)));
    paper.appendChild(Report._el("div", "focus-paper__line"));
    return paper;
  },

  _revisionDesk: function () {
    var section = Report._el("section", "revision-desk");
    var label = Report._el("label", null, "就在原话上改，不用推翻重写");
    label.setAttribute("for", "revision-script");
    section.appendChild(label);

    var input = Report._el("textarea", "revision-input");
    input.id = "revision-script";
    input.maxLength = LIMITS.scriptMax;
    input.rows = 7;
    input.value = App.state.lastRequest ? App.state.lastRequest.script : "";
    section.appendChild(input);

    var count = Report._el("div", "revision-count");
    var syncCount = function () {
      count.textContent = input.value.trim().length + " / " + LIMITS.scriptMax;
    };
    input.addEventListener("input", syncCount);
    syncCount();
    section.appendChild(count);

    var button = Report._el("button", "training-primary revision-submit", "改好，再让教练看");
    button.type = "button";
    button.addEventListener("click", function () {
      Form.submitRevision(input.value);
    });
    section.appendChild(button);
    return section;
  },

  _fullReview: function (report, checks) {
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
      var statusText = check.status === "met" ? "做到" : check.status === "partial" ? "差一点" : "没出现";
      item.appendChild(Report._el("strong", null, check.label + " · " + statusText));
      item.appendChild(Report._el("p", null, check.evidence));
      structureList.appendChild(item);
    });
    details.appendChild(structureList);

    var direction = report.direction || {};
    if (direction.summary) {
      var directionText = Report._el("p");
      directionText.appendChild(Report._el("strong", null, "修改方向："));
      directionText.appendChild(document.createTextNode(direction.summary));
      details.appendChild(directionText);
    }

    var reviews = Array.isArray(report.line_reviews) ? report.line_reviews : [];
    if (reviews.length) {
      details.appendChild(Report._el("p", null, "逐句看："));
      details.appendChild(Report._lineReviewList(reviews));
    }

    var examples = Array.isArray(direction.examples) ? direction.examples : [];
    if (examples.length) {
      var exampleDetails = Report._el("details", "review-details review-details--examples");
      exampleDetails.appendChild(Report._el("summary", null, "实在想不到，再看局部示范"));
      exampleDetails.appendChild(Report._el("p", null, "只借角度，换成你自己平时会说的话。"));
      var exampleList = Report._el("ul", "line-review-list");
      examples.forEach(function (example) {
        var item = Report._el("li", "line-review-item line-review-item--good", example);
        exampleList.appendChild(item);
      });
      exampleDetails.appendChild(exampleList);
      details.appendChild(exampleDetails);
    }
    return details;
  },

  _lineReviewList: function (reviews) {
    var list = Report._el("ul", "line-review-list");
    reviews.forEach(function (review) {
      if (!review) return;
      var mark = ["good", "partial", "wrong"].indexOf(review.mark) >= 0 ? review.mark : "partial";
      var label = mark === "good" ? "站对了" : mark === "wrong" ? "这句会吃亏" : "还差一点";
      var item = Report._el("li", "line-review-item line-review-item--" + mark);
      item.appendChild(Report._el("strong", null, label + (review.original ? " · “" + review.original + "”" : "")));
      if (review.comment) item.appendChild(Report._el("p", null, review.comment));
      list.appendChild(item);
    });
    return list;
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

    var checks = Report._checks(report);
    var focus = Report._focusCheck(checks, report);
    content.appendChild(Report._heading(report));
    content.appendChild(Report._structureTrack(checks));
    content.appendChild(Report._focusPaper(report, focus));
    content.appendChild(Report._revisionDesk());
    content.appendChild(Report._fullReview(report, checks));
    App.showView("report");
  },

  showPassed: function (report) {
    Report._stopLoadingMessages();
    Report._showRedlineBanner("");
    document.getElementById("btn-back-edit").disabled = false;
    document.getElementById("passed-script").textContent = App.state.lastRequest ? App.state.lastRequest.script : "";

    var learn = document.getElementById("passed-learn");
    Report._clear(learn);
    var main = report.verdict_reason || "五项结构都接住了，这版可以拿去练开口。";
    learn.appendChild(Report._el("p", null, main));
    if (report.one_thing) learn.appendChild(Report._el("p", null, "记住：" + report.one_thing));

    App.showView("passed");
  },

  showLoading: function () {
    Report._showRedlineBanner("");
    document.getElementById("report-content").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;
    document.getElementById("btn-back-edit").disabled = true;
    document.getElementById("report-loading").hidden = false;
    Report._startLoadingMessages();
  },

  _startLoadingMessages: function () {
    Report._stopLoadingMessages();
    var messages = [
      "先看你接住了谁，再看上票理由有没有落到人身上。",
      "正在对照五项结构，只挑这一轮最该改的一处。",
      "不会替你重写整篇，教练只帮你把原话改到能用。",
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
    Form.reset();
    App.resetStages();
    App.showView("form");
  },
};
