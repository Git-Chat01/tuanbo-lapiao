// API 层：fetch 封装——防连点、陈旧请求守卫、前端超时、错误分类
// 模式沿用 expense-tracker update-flow 的 memoize + requestId 守卫

var Api = {
  _inFlight: false, // 同一时间只允许一个批改请求
  _requestId: 0, // 陈旧响应守卫
  _timeoutMs: 60000, // 前端超时：Worker 自身 45s 超时，这里留 15s 余量

  init: function () {},

  /**
   * 提交批改请求。
   * @param {object} payload - Form.collect() 的产物
   * @param {object} callbacks - {onSuccess(report), onError(status, message), onFinish()}
   */
  submit: function (payload, callbacks) {
    callbacks = callbacks || {};
    if (!API_BASE) {
      App.toast("后端地址未配置（部署时填入 config.js）");
      if (callbacks.onFinish) callbacks.onFinish();
      return;
    }
    if (Api._inFlight) return; // 防连点：上一个请求没结束就忽略
    Api._inFlight = true;
    var requestId = ++Api._requestId;

    // 场景是可选上下文；自由话术仍保持旧三字段契约兼容。
    var body = {
      accessCode: App.getAccessCode(),
      voteGap: payload.voteGap,
      script: payload.script,
    };
    if (payload.scenario && typeof payload.scenario === "object") {
      body.scenario = payload.scenario;
    }

    // 前端超时保险。旧 WebView 没有 AbortController 时用 Promise.race 降级，
    // 不让一个同步 ReferenceError 把 _inFlight 永久锁住。
    var controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
    var timer;
    var timeoutPromise = new Promise(function (_resolve, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        var timeoutError = new Error("request timeout");
        timeoutError.name = "TimeoutError";
        reject(timeoutError);
      }, Api._timeoutMs);
    });
    var requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    if (controller) requestOptions.signal = controller.signal;

    Promise.race([fetch(API_BASE + "/api/coach", requestOptions), timeoutPromise])
      .then(function (res) {
        // 401 没有合法 JSON 之外的额外信息，直接按状态码分类
        return res.json().then(function (data) {
          if (!res.ok) {
            var err = new Error(data && data.message ? data.message : "请求失败");
            err.status = res.status;
            throw err;
          }
          return data;
        });
      })
      .then(function (data) {
        clearTimeout(timer);
        if (requestId !== Api._requestId) return; // 陈旧响应丢弃
        if (callbacks.onSuccess) callbacks.onSuccess(data.report);
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (requestId !== Api._requestId) return;
        var status = err.status || 0;
        var message;
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          message = "等太久了，网络可能不好，重试一次";
        } else if (status === 401) {
          message = "入口码不对";
        } else if (status >= 400) {
          message = err.message; // Worker 返回的业务文案（含 502/504 的重试提示）
        } else {
          message = "连不上教练，检查一下网络"; // fetch 网络层错误（断网/DNS）
        }
        if (callbacks.onError) callbacks.onError(status, message);
      })
      .then(function () {
        clearTimeout(timer);
        Api._inFlight = false;
        if (callbacks.onFinish) callbacks.onFinish();
      });
  },
};
