// 主播端应用状态：场景带练 → 文字复盘 → 开口练。
// 仍沿用原生单页多视图，不引入框架；未来步骤默认锁定，只允许返回已完成步骤。

var App = {
  state: {
    form: null,
    lastReport: null,
    lastRequest: null,
    currentView: "form",
    freeMode: false,
    sessionAccessCode: "",
  },

  _stageOrder: ["form", "report", "voice"],

  _stageForView: function (viewName) {
    if (viewName === "passed") return "report";
    return viewName;
  },

  showView: function (name) {
    if (App.state.currentView === "voice" && name !== "voice" && window.VoiceCoach && VoiceCoach.reset) {
      VoiceCoach.reset();
    }
    if (name !== "form" && window.Form && Form.stopSceneReplay) {
      Form.stopSceneReplay();
    }
    var viewNames = ["form", "report", "passed", "voice"];
    for (var i = 0; i < viewNames.length; i++) {
      var el = document.getElementById("view-" + viewNames[i]);
      if (el) el.classList.toggle("training-view--active", viewNames[i] === name);
    }
    App.state.currentView = name;
    App._syncStage(App._stageForView(name));
    try { window.scrollTo({ top: 0, behavior: "auto" }); }
    catch (error) { window.scrollTo(0, 0); }
  },

  unlockStage: function (stage) {
    var button = document.querySelector('.training-step[data-stage="' + stage + '"]');
    if (button) button.disabled = false;
  },

  lockStage: function (stage) {
    var button = document.querySelector('.training-step[data-stage="' + stage + '"]');
    if (!button) return;
    button.disabled = true;
    button.classList.remove("is-complete");
    button.removeAttribute("aria-current");
  },

  resetStages: function () {
    var buttons = document.querySelectorAll(".training-step");
    for (var i = 0; i < buttons.length; i++) {
      var stage = buttons[i].dataset.stage;
      buttons[i].disabled = stage !== "form";
      buttons[i].classList.remove("is-complete");
    }
    App._syncStage("form");
  },

  _syncStage: function (activeStage) {
    var activeIndex = App._stageOrder.indexOf(activeStage);
    var buttons = document.querySelectorAll(".training-step");
    for (var i = 0; i < buttons.length; i++) {
      var buttonStage = buttons[i].dataset.stage;
      var buttonIndex = App._stageOrder.indexOf(buttonStage);
      var isActive = buttonStage === activeStage;
      buttons[i].classList.toggle("is-active", isActive);
      buttons[i].classList.toggle("is-complete", buttonIndex >= 0 && buttonIndex < activeIndex);
      if (isActive) buttons[i].setAttribute("aria-current", "step");
      else buttons[i].removeAttribute("aria-current");
    }
  },

  _openStage: function (stage) {
    if (window.Api && Api._inFlight) {
      App.toast("教练正在看这一版，结果出来前先别切走");
      return;
    }
    if (stage === "form") {
      App.showView("form");
      return;
    }
    if (stage === "report") {
      if (!App.state.lastReport) return;
      App.showView(App.state.lastReport.verdict === "passed" ? "passed" : "report");
      return;
    }
    if (stage === "voice" && !document.querySelector('.training-step[data-stage="voice"]').disabled) {
      if (window.Report && Report._onStartVoice) Report._onStartVoice();
    }
  },

  toast: function (message) {
    var container = document.getElementById("toast-container");
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3000);
  },

  getAccessCode: function () {
    if (App.state.sessionAccessCode) return App.state.sessionAccessCode;
    try {
      return localStorage.getItem(STORAGE_KEYS.accessCode) || "";
    } catch (e) {
      return "";
    }
  },

  saveAccessCode: function (code) {
    App.state.sessionAccessCode = String(code || "");
    try {
      localStorage.setItem(STORAGE_KEYS.accessCode, code);
    } catch (e) {
      // 微信隐私模式可能禁用 localStorage；当前提交仍可继续。
    }
  },

  showAccessModal: function (onConfirm, options) {
    options = options || {};
    var overlay = document.getElementById("access-modal");
    var input = document.getElementById("input-access-code");
    var error = document.getElementById("access-error");
    var confirmButton = document.getElementById("btn-access-confirm");

    input.value = options.clear ? "" : App.getAccessCode();
    error.textContent = options.invalid ? "入口码不对，重新输入" : "先输入入口码";
    error.hidden = !options.invalid;
    overlay.hidden = false;
    setTimeout(function () { input.focus(); }, 50);

    var confirm = function () {
      var code = input.value.trim();
      if (!code) {
        error.textContent = "先输入入口码";
        error.hidden = false;
        return;
      }
      App.saveAccessCode(code);
      App.hideAccessModal();
      if (onConfirm) onConfirm(code);
    };

    confirmButton.onclick = confirm;
    input.onkeydown = function (event) {
      if (event.key === "Enter") confirm();
    };
  },

  hideAccessModal: function () {
    document.getElementById("access-modal").hidden = true;
  },

  init: function () {
    document.getElementById("btn-access-code").addEventListener("click", function () {
      App.showAccessModal(function () { App.toast("入口码已保存"); });
    });
    document.getElementById("btn-access-cancel").addEventListener("click", App.hideAccessModal);

    var stageButtons = document.querySelectorAll(".training-step");
    for (var i = 0; i < stageButtons.length; i++) {
      stageButtons[i].addEventListener("click", function (event) {
        if (!event.currentTarget.disabled) App._openStage(event.currentTarget.dataset.stage);
      });
    }

    Form.init();
    Api.init();
    Report.init();
    if (window.VoiceCoach && VoiceCoach.init) VoiceCoach.init();
  },
};

document.addEventListener("DOMContentLoaded", App.init);
