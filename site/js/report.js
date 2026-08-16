// 报告视图：五段卡片渲染、⑤示例折叠、重试与返回
// ⚠️ 安全铁律：报告内容全部来自模型输出，一律用 textContent 赋值，禁 innerHTML

var Report = {
  init: function () {
    document.getElementById("btn-back-edit").addEventListener("click", Report._onBackEdit);
    document.getElementById("btn-retry").addEventListener("click", Report._onRetry);
  },

  /** 小助手：创建元素，可选 className 与文本（textContent 防 XSS） */
  _el: function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },

  /** 渲染完整报告（五段） */
  showContent: function (report) {
    document.getElementById("report-loading").hidden = true;
    document.getElementById("report-error").hidden = true;
    document.getElementById("btn-retry").hidden = true;

    var content = document.getElementById("report-content");
    content.innerHTML = ""; // 清空旧报告（此时才允许 innerHTML，只用于清空）
    content.hidden = false;

    // ① 先接住你
    content.appendChild(
      Report._section("先接住你", report.echo)
    );
    // ② 场里实际发生的
    content.appendChild(
      Report._section("场里实际发生的", report.reality_gap)
    );
    // ③ 逐句点评
    content.appendChild(Report._lineReviews(report.line_reviews || []));
    // ④ 这次只记一件事（高亮卡）
    var highlight = Report._section("这次只记一件事", report.one_thing);
    highlight.classList.add("report-section--highlight");
    content.appendChild(highlight);
    // ⑤ 修改方向 + 折叠示例
    content.appendChild(Report._direction(report.direction));

    // 重新批一次：同参数重发（应对 504/502 重试与模型抽风）
    document.getElementById("btn-retry").hidden = false;
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

  /** ③ 逐句点评列表：每条按 mark 渲染左色条 + ✅⚠️❌ */
  _lineReviews: function (reviews) {
    var section = Report._el("section", "report-section");
    section.appendChild(Report._el("h2", "report-section__title", "逐句看看"));

    var list = Report._el("ul", "review-list");
    var markText = { good: "✅ 站对了", partial: "⚠️ 没到位", wrong: "❌ 站错了" };

    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      var item = Report._el("li", "review-item review-item--" + (r.mark || "partial"));
      var head = Report._el("div", "review-item__head");
      head.appendChild(Report._el("span", "review-item__mark", markText[r.mark] || markText.partial));
      head.appendChild(Report._el("span", "review-item__original", r.original || ""));
      var comment = Report._el("div", "review-item__comment", r.comment || "");
      item.appendChild(head);
      item.appendChild(comment);
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  },

  /** ⑤ 修改方向 + 默认收起的示例（逼她先自己想，防照抄） */
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
      var label = Report._el("span", null, "想不出怎么改？看看示范");
      var arrow = Report._el("span", "example-toggle__arrow", "▾");
      toggle.appendChild(label);
      toggle.appendChild(arrow);

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

  /** 重新批一次：同参数重发 */
  _onRetry: function () {
    if (!App.state.lastRequest) return;
    Report.showLoading();
    Api.submit(App.state.lastRequest, {
      onSuccess: function (report) {
        App.state.lastReport = report;
        Report.showContent(report);
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
