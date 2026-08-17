// 报告视图（v2）：verdict 大字卡 → 诊断卡 → 红线横幅 → echo → one_thing
//   → 逐句点评(折叠) → direction(折叠)；过关页 showPassed() + 复制降级链
// ⚠️ 安全铁律：报告内容全部来自模型输出，一律用 textContent 赋值，禁 innerHTML
// 设计铁律：结论大字在前（10 秒看得懂），细节折叠（想细看再展开）

var Report = {
  // 卡点类型 → 大字标签（与 worker 的 CARD_TYPE_ENUM 一致）
  CARD_LABELS: {
    logic: "逻辑卡住了",
    expression: "表达卡住了",
    mentality: "心态卡住了",
    persona: "人设卡住了",
  },
  // verdict → 大字卡文案与样式（passed 正常不进报告页，此处兜底渲染）
  VERDICT_UI: {
    passed: { text: "过关了", cls: "verdict-card--passed" },
    almost: { text: "还差一口气", cls: "verdict-card--almost" },
    off: { text: "方向不对", cls: "verdict-card--off" },
  },

  init: function () {
    document.getElementById("btn-back-edit").addEventListener("click", Report._onBackEdit);
    document.getElementById("btn-retry").addEventListener("click", Report._onRetry);
    document.getElementById("btn-copy").addEventListener("click", Report._onCopy);
    document.getElementById("btn-new-round").addEventListener("click", Report._onNewRound);
  },

  /** 小助手：创建元素，可选 className 与文本（textContent 防 XSS） */
  _el: function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },

  /** 渲染完整报告（v2 顺序） */
  showContent: function (report) {
    document.getElementById("report-loading").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;

    var content = document.getElementById("report-content");
    content.innerHTML = ""; // 清空旧报告（此时才允许 innerHTML，只用于清空）
    content.hidden = false;

    // ① verdict 大字卡：结论第一眼看到
    content.appendChild(Report._verdictCard(report));

    // 红线横幅：独立元素（红底白字，最扎眼的警告，不许被内容埋没）
    Report._showRedlineBanner(report.redline_note);

    // ② 诊断卡：卡在哪 + 对谁喊话（教学点从表单搬进报告）
    content.appendChild(Report._diagnosisCard(report));

    // ③ 先接住你
    content.appendChild(Report._section("教练先接住你", report.echo));

    // ④ 这次只记一件事（高亮卡）
    var highlight = Report._section("这次只记一件事", report.one_thing);
    highlight.classList.add("report-section--highlight");
    content.appendChild(highlight);

    // ⑤ 逐句点评（默认折叠，按钮带统计）
    content.appendChild(Report._lineReviewsCollapsible(report.line_reviews || []));

    // ⑥ 修改方向 + 折叠示例
    content.appendChild(Report._direction(report.direction));

    // 重新批一次：同参数重发（应对 504/502 重试与模型抽风）
    document.getElementById("btn-retry").hidden = false;
  },

  /** ① verdict 大字卡：verdict 文案 + 判定理由 */
  _verdictCard: function (report) {
    var ui = Report.VERDICT_UI[report.verdict] || Report.VERDICT_UI.off;
    var card = Report._el("section", "verdict-card " + ui.cls);
    card.appendChild(Report._el("div", "verdict-card__text", ui.text));
    card.appendChild(Report._el("div", "verdict-card__reason", report.verdict_reason || ""));
    return card;
  },

  /** 红线横幅（report-content 之外的独立元素，红底白字） */
  _showRedlineBanner: function (redlineNote) {
    var banner = document.getElementById("redline-banner");
    if (!banner) return;
    if (redlineNote) {
      banner.textContent = "🚫 " + redlineNote;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  },

  /** ② 诊断卡：卡点类型 + 依据 + 对谁喊话 */
  _diagnosisCard: function (report) {
    var section = Report._el("section", "report-section diagnosis-card");
    section.appendChild(Report._el("h2", "report-section__title", "教练先看你卡在哪"));

    var badge = Report._el(
      "span",
      "diagnosis-card__badge",
      Report.CARD_LABELS[report.card_type] || report.card_type
    );
    section.appendChild(badge);

    section.appendChild(Report._el("div", "diagnosis-card__why", report.card_why || ""));

    if (report.audience) {
      var audience = Report._el("div", "diagnosis-card__audience");
      audience.appendChild(Report._el("span", "diagnosis-card__audience-label", "你这话是对谁喊的："));
      audience.appendChild(Report._el("span", null, report.audience));
      section.appendChild(audience);
    }
    return section;
  },

  /** 通用段落卡片 */
  _section: function (title, body) {
    var section = Report._el("section", "report-section");
    var head = Report._el("h2", "report-section__title", title);
    var bodyEl = Report._el("div", "report-section__body", body || "（教练没写这一段，重试一次看看）");
    section.appendChild(head);
    section.appendChild(bodyEl);
    return section;
  },

  /**
   * 把用户话术按标点拆成句（与模型按句点评的顺序对齐）。
   * 显示"原句"时优先用这里的拆句结果——用户看到的一定是自己写的话，
   * 同时防御上游偶发的 original 字段乱码（DeepSeek 对部分输入复制原文时会输出损坏字符）。
   */
  _splitSentences: function (script) {
    if (!script) return [];
    return script
      .split(/[。！？!?；;\n]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  },

  /** 检测损坏字符（U+FFFD 替换符，上游乱码的特征） */
  _hasGarbled: function (text) {
    for (var i = 0; i < text.length; i++) {
      if (text.codePointAt(i) === 0xfffd) return true;
    }
    return false;
  },

  /**
   * ⑤ 逐句点评（v2 默认折叠）：
   * 报告 10 秒看得懂的代价是细节必须收起——结论在上，想看细节自己展开。
   * 折叠按钮带统计（"2 句站对 · 1 句没到位"），不展开也能知道大概。
   */
  _lineReviewsCollapsible: function (reviews) {
    var section = Report._el("section", "report-section");
    section.appendChild(Report._el("h2", "report-section__title", "逐句看看"));

    // 统计
    var counts = { good: 0, partial: 0, wrong: 0 };
    for (var i = 0; i < reviews.length; i++) {
      var m = reviews[i] && reviews[i].mark;
      if (counts[m] !== undefined) counts[m]++;
    }
    var parts = [];
    if (counts.good) parts.push(counts.good + " 句站对");
    if (counts.partial) parts.push(counts.partial + " 句没到位");
    if (counts.wrong) parts.push(counts.wrong + " 句站错");
    var summary = parts.length > 0 ? parts.join(" · ") : "逐句看";

    var toggle = Report._el("button", "example-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.appendChild(Report._el("span", null, summary));
    toggle.appendChild(Report._el("span", "example-toggle__arrow", "▾"));

    var panel = Report._el("div", "example-panel");
    panel.hidden = true; // 默认收起
    panel.appendChild(Report._buildReviewList(reviews));

    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      panel.hidden = expanded;
    });

    section.appendChild(toggle);
    section.appendChild(panel);
    return section;
  },

  /** 逐句点评列表本体：每条按 mark 渲染左色条 + ✅⚠️❌ */
  _buildReviewList: function (reviews) {
    var list = Report._el("ul", "review-list");
    var markText = { good: "✅ 站对了", partial: "⚠️ 没到位", wrong: "❌ 站错了" };

    // 前端自己的拆句（来自用户提交的原文），与模型点评按顺序对齐
    var sentences = Report._splitSentences(
      App.state.lastRequest ? App.state.lastRequest.script : ""
    );

    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      var original;
      if (sentences[i]) {
        original = sentences[i]; // 优先：用户原话拆句，永远无乱码
      } else if (r.original && !Report._hasGarbled(r.original)) {
        original = r.original; // 兜底：模型引用（仅当无损坏字符）
      } else {
        original = ""; // 都不可用时不显示原句，点评本身仍可见
      }

      var item = Report._el("li", "review-item review-item--" + (r.mark || "partial"));
      var head = Report._el("div", "review-item__head");
      head.appendChild(Report._el("span", "review-item__mark", markText[r.mark] || markText.partial));
      head.appendChild(Report._el("span", "review-item__original", original));
      var comment = Report._el("div", "review-item__comment", r.comment || "");
      item.appendChild(head);
      item.appendChild(comment);
      list.appendChild(item);
    }
    return list;
  },

  /** ⑥ 修改方向 + 默认收起的示例（逼她先自己想，防照抄） */
  _direction: function (direction) {
    direction = direction || {};
    var section = Report._el("section", "report-section");
    section.appendChild(Report._el("h2", "report-section__title", "往这个方向改"));
    section.appendChild(
      Report._el("div", "report-section__body", direction.summary || "")
    );

    var examples = direction.examples || [];
    if (examples.length > 0) {
      var toggle = Report._el("button", "example-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.appendChild(Report._el("span", null, "想不出怎么改？看看示范"));
      toggle.appendChild(Report._el("span", "example-toggle__arrow", "▾"));

      var panel = Report._el("div", "example-panel");
      panel.hidden = true; // 默认收起
      panel.appendChild(Report._el("p", "example-tip", "示范只是参考——用你自己的话说，才算你的"));
      var list = Report._el("ul", "example-list");
      for (var i = 0; i < examples.length; i++) {
        list.appendChild(Report._el("li", "example-item", examples[i]));
      }
      panel.appendChild(list);

      toggle.addEventListener("click", function () {
        var expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        panel.hidden = expanded;
      });

      section.appendChild(toggle);
      section.appendChild(panel);
    }

    return section;
  },

  /**
   * 过关页：verdict=passed 时进入。
   * 定稿 = 用户自己提交的原话（稿子是她自己的，教练只打磨没代写）。
   * "学会了什么" = verdict_reason + card_why + one_thing 拼接（无状态，不跨轮）。
   */
  showPassed: function (report) {
    var script = App.state.lastRequest ? App.state.lastRequest.script : "";
    document.getElementById("passed-script").textContent = script;

    // 学会了什么：判定理由 → 为什么过 → 只记一件事
    var learn = document.getElementById("passed-learn");
    learn.innerHTML = ""; // 仅用于清空
    var blocks = [];
    if (report.verdict_reason) blocks.push(Report._el("p", "passed-learn__block", report.verdict_reason));
    if (report.card_why) blocks.push(Report._el("p", "passed-learn__block", report.card_why));
    if (report.one_thing) {
      var one = Report._el("p", "passed-learn__block passed-learn__block--strong", report.one_thing);
      blocks.push(one);
    }
    if (blocks.length === 0) {
      blocks.push(Report._el("p", "passed-learn__block", "这一稿方向对了，记住这种感觉"));
    }
    for (var i = 0; i < blocks.length; i++) learn.appendChild(blocks[i]);

    App.showView("passed");
  },

  /** 复制定稿：降级链 clipboard API → 隐藏 textarea + execCommand → 让用户长按手动复制 */
  _onCopy: function () {
    var script = document.getElementById("passed-script").textContent;
    if (!script) return;

    var done = function () {
      App.toast("已复制，去直播间用起来");
    };

    // 第一级：navigator.clipboard（需要 HTTPS 或 localhost，微信 WebView 可能没有）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(script).then(done, function () {
        Report._copyFallback(script, done);
      });
    } else {
      Report._copyFallback(script, done);
    }
  },

  /** 第二级：隐藏 textarea + document.execCommand("copy")（老 iOS/微信兼容性最好） */
  _copyFallback: function (text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // 移出可视区但不 display:none（iOS 要求元素可见才能 select）
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) {
      done();
    } else {
      App.toast("复制不了？长按上面的稿子手动复制");
    }
  },

  /** 过关页"再练一段新的"：清空表单回首页（上一轮彻底结束） */
  _onNewRound: function () {
    App.state.form = null;
    App.state.lastRequest = null;
    App.state.lastReport = null;
    Form.reset();
    App.showView("form");
  },

  /** 提交后的 loading 态（批改 10-30 秒，文案要兜住耐心） */
  showLoading: function () {
    document.getElementById("report-content").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;
    document.getElementById("report-loading").hidden = false;
  },

  /** 错误态：错误卡 + 重试按钮 */
  showError: function (message) {
    document.getElementById("report-loading").hidden = true;
    document.getElementById("report-content").hidden = true;

    var errorBox = document.getElementById("report-error");
    errorBox.innerHTML = ""; // 仅用于清空
    errorBox.hidden = false;
    var card = Report._el("div", "error-card");
    card.appendChild(Report._el("p", null, message));
    errorBox.appendChild(card);

    document.getElementById("btn-retry").hidden = false;
  },

  /** 返回修改：恢复表单状态，不清空 */
  _onBackEdit: function () {
    Form.restore(App.state.form);
    App.showView("form");
  },

  /** 重新批一次：同参数重发（重试结果 passed 也走过关页） */
  _onRetry: function () {
    if (!App.state.lastRequest) return;
    Report.showLoading();
    Api.submit(App.state.lastRequest, {
      onSuccess: function (report) {
        App.state.lastReport = report;
        if (report.verdict === "passed") {
          Report.showPassed(report);
        } else {
          App.showView("report");
          Report.showContent(report);
        }
      },
      onError: function (status, message) {
        if (status === 401) {
          App.showView("form");
          App.showAccessModal(function (code) {
            App.saveAccessCode(code);
            App.hideAccessModal();
            return true;
          });
        } else {
          Report.showError(message);
        }
      },
      onFinish: function () {},
    });
  },
};
