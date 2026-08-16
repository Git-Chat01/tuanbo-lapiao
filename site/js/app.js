// 应用入口：视图切换、入口码 modal、toast、全局状态
// 依赖顺序：config.js → app.js（本文件）→ form.js → api.js → report.js

var App = {
  // 表单数据在视图间保留——"改一改再批"回来时不清空
  state: { form: null, lastReport: null, lastRequest: null },

  /** 切换主视图（form / report），只留一个 --active */
  showView: function (name) {
    document.getElementById("view-form").classList.toggle("main-view--active", name === "form");
    document.getElementById("view-report").classList.toggle("main-view--active", name === "report");
    window.scrollTo(0, 0);
  },

  /** 轻提示：3 秒后自动消失 */
  toast: function (message) {
    var container = document.getElementById("toast-container");
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3000);
  },

  /** 入口码：localStorage 缓存，401 时重新弹出 */
  getAccessCode: function () {
    return localStorage.getItem(STORAGE_KEYS.accessCode) || "";
  },
  saveAccessCode: function (code) {
    localStorage.setItem(STORAGE_KEYS.accessCode, code);
  },

  /**
   * 弹出入口码 modal。onConfirm(code) 返回 true 表示校验通过、关闭弹窗；
   * 返回 false 表示码不对，留在弹窗并显示错误提示。
   * 校验是异步的——MVP 不单独做"校验码"接口，靠第一次提交的 401 反馈。
   */
  showAccessModal: function (onConfirm) {
    var overlay = document.getElementById("access-modal");
    var input = document.getElementById("input-access-code");
    var error = document.getElementById("access-error");
    var confirmBtn = document.getElementById("btn-access-confirm");

    input.value = App.getAccessCode();
    error.hidden = true;
    overlay.hidden = false;
    setTimeout(function () { input.focus(); }, 50);

    var confirm = function () {
      var code = input.value.trim();
      if (!code) return;
      var ok = onConfirm ? onConfirm(code) : true;
      if (ok === false) {
        error.hidden = false;
        input.select();
      }
    };
    confirmBtn.onclick = confirm;
    input.onkeydown = function (e) {
      if (e.key === "Enter") confirm();
    };
  },
  hideAccessModal: function () {
    document.getElementById("access-modal").hidden = true;
  },

  /** 初始化：绑定全局事件，判断是否需要先输入口码 */
  init: function () {
    // 改入口码按钮
    document.getElementById("btn-access-code").addEventListener("click", function () {
      App.showAccessModal(function (code) {
        App.saveAccessCode(code);
        App.hideAccessModal();
        App.toast("入口码已更新");
        return true;
      });
    });

    // 首次进入：没有入口码记录就先弹 modal（填了才能用）
    if (!App.getAccessCode()) {
      App.showAccessModal(function (code) {
        App.saveAccessCode(code);
        App.hideAccessModal();
        return true;
      });
    }

    Form.init();
    Api.init();
    Report.init();
  },
};

document.addEventListener("DOMContentLoaded", function () {
  App.init();
});
