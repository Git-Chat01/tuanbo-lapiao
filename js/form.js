// 表单视图（v2 极简）：票况 chip 点选、字数统计、校验、数据收集、状态保留
// chip 的选中态用 aria-pressed 承载（选中 = true），单选语义由 data-multi 区分
// 主播端铁律：零思考——全表单只有一个事实性选择（票况），其余就写和交

var Form = {
  /** 初始化：绑定 chip 点击、字数统计、提交按钮 */
  init: function () {
    var chips = document.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", Form._onChipClick);
    }

    document.getElementById("input-script").addEventListener("input", Form._updateCounts);
    document.getElementById("btn-submit").addEventListener("click", Form._onSubmit);
  },

  /** chip 点击：单选组互斥（v2 只剩一个单选组） */
  _onChipClick: function (e) {
    var chip = e.currentTarget;
    var group = chip.closest(".chip-group");

    if (group.dataset.multi === "true") {
      var next = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", String(next));
    } else {
      var siblings = group.querySelectorAll(".chip");
      for (var i = 0; i < siblings.length; i++) {
        siblings[i].setAttribute("aria-pressed", String(siblings[i] === chip));
      }
    }
    Form._refreshSubmitState();
  },

  /** 字数统计：script 500 字 */
  _updateCounts: function () {
    var script = document.getElementById("input-script");
    var scriptCount = document.getElementById("script-count");
    scriptCount.textContent = script.value.length + "/" + LIMITS.scriptMax;
    scriptCount.classList.toggle("char-count--over", script.value.length >= LIMITS.scriptMax);

    Form._refreshSubmitState();
  },

  /** 收集当前表单数据为提交格式（v2 契约：{voteGap, script}） */
  collect: function () {
    var group = document.querySelector('.chip-group[data-group="voteGap"]');
    var active = group.querySelector('.chip[aria-pressed="true"]');

    return {
      voteGap: active ? active.dataset.value : null,
      script: document.getElementById("input-script").value.trim(),
    };
  },

  /** 校验：票况必选 + 话术 ≥20 字；返回 null 或错误信息 */
  validate: function (data) {
    var group = document.querySelector('.chip-group[data-group="voteGap"]');
    var hasSelection = group.querySelector('.chip[aria-pressed="true"]');
    group.classList.toggle("chip-group--invalid", !hasSelection);
    if (!hasSelection) {
      group.scrollIntoView({ behavior: "smooth", block: "center" });
      return "先点一下现在票数什么情况";
    }
    if (data.script.length < LIMITS.scriptMin) {
      return "话术太短了，至少写一句完整的话";
    }
    return null;
  },

  /** 恢复表单状态（"改一改再批"回来时不清空） */
  restore: function (data) {
    if (!data) return;
    var group = document.querySelector('.chip-group[data-group="voteGap"]');
    var chips = group.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", String(chips[i].dataset.value === data.voteGap));
    }
    document.getElementById("input-script").value = data.script || "";
    Form._updateCounts();
  },

  /** 清空表单（过关页"再练一段新的"用：上一轮彻底结束，重新开始） */
  reset: function () {
    var chips = document.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", "false");
    }
    document.getElementById("input-script").value = "";
    Form._updateCounts();
  },

  /** 提交按钮可用态：票况已点 + 话术达标 才可点 */
  _refreshSubmitState: function () {
    var data = Form.collect();
    var btn = document.getElementById("btn-submit");
    btn.disabled = !(data.voteGap && data.script.length >= LIMITS.scriptMin);
  },

  /** 提交：校验 → 收集 → 调 Api → 按结果切换视图 */
  _onSubmit: function () {
    var data = Form.collect();
    var error = Form.validate(data);
    if (error) {
      App.toast(error);
      return;
    }
    // 保存本次表单状态，报告页"改一改再批"回来时恢复
    App.state.form = data;
    App.state.lastRequest = data;

    var btn = document.getElementById("btn-submit");
    btn.disabled = true;
    btn.textContent = "教练正在看……";
    // 等待期间锁表单：防止报告返回前误改，导致展示与快照不一致
    document.getElementById("view-form").classList.add("main-view--submitting");

    Api.submit(data, {
      onSuccess: function (report) {
        App.state.lastReport = report;
        // verdict=passed → 过关页；否则 → 报告页
        if (report.verdict === "passed") {
          Report.showPassed(report);
        } else {
          App.showView("report");
          Report.showContent(report);
        }
      },
      onError: function (status, message) {
        if (status === 401) {
          // 入口码不对：回到表单，弹 modal 重输
          App.showView("form");
          App.showAccessModal(function (code) {
            App.saveAccessCode(code);
            App.hideAccessModal();
            return true;
          });
        } else {
          App.showView("report");
          Report.showError(message);
        }
      },
      onFinish: function () {
        btn.disabled = false;
        btn.textContent = "拿去给教练批";
        document.getElementById("view-form").classList.remove("main-view--submitting");
        Form._refreshSubmitState();
      },
    });
  },
};
