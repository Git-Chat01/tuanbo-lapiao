// API 层：fetch 封装——防连点、陈旧请求守卫、前端超时、错误分类、502/504 自动重试一次
// 模式沿用 expense-tracker update-flow 的 memoize + requestId 守卫

var Api = {
  _inFlight: false, // 同一时间只允许一个批改请求
  _requestId: 0, // 陈旧响应守卫
  _timeoutMs: 105000, // Worker 思考与正文最多 90s，另留 15s 网络余量
  _retryMinBudgetMs: 45000, // 重试至少要留得下一次生成；预算不够就直说，别让用户白等

  init: function () {},

  /**
   * 单次批改尝试：fetch + 响应解析统一封装。
   * 响应有两种形态，用同一条路径解析：
   *   1. 纯 JSON（旧 Worker、本地 mock、测试桩）；
   *   2. NDJSON —— Worker 在生成期间每 10 秒发一行心跳（{"t":"ping"}）保活手机端连接
   *      （iPhone Safari 对长时间收不到字节的连接约 60 秒判死），只有最后一个非空行是结果。
   * 所以取“最后一个非空行”JSON.parse 即可同时吃两种；不需要 ReadableStream/TextDecoder，
   * 旧 WebView 也能跑 —— 保活发生在 TCP 层，这里只是 await 整个文本。
   * 解析失败说明后端没返回合法 JSON（比如网关 502/504 的 HTML 页面），
   * 打上 parseFailed 标记让上层单独分类，而不是混进“连不上教练”的网络错误。
   * @param {object} requestOptions - fetch 选项（含同一 signal）
   * @param {Promise} timeoutPromise - 与初次请求共享的总超时预算
   */
  _attempt: function (requestOptions, timeoutPromise) {
    return Promise.race([fetch(API_BASE + "/api/coach", requestOptions).then(function (res) {
      return res.text().then(function (text) {
        var lines = String(text || "").split("\n");
        var lastLine = "";
        for (var i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim()) {
            lastLine = lines[i];
            break;
          }
        }
        var data;
        try {
          data = JSON.parse(lastLine);
        } catch (parseError) {
          var err = new Error("教练返回了无法识别的响应");
          err.parseFailed = true;
          err.status = res.status || 0;
          throw err;
        }
        // 流式响应状态码恒为 200，生成期的失败写在体内（payload.status）；
        // 非流式的业务错误同时带 HTTP 状态码，两者取其一。
        var status = data && data.status ? data.status : res.status;
        if (!res.ok || (data && data.error)) {
          var apiError = new Error(data && data.message ? data.message : "请求失败");
          apiError.status = status;
          throw apiError;
        }
        return data;
      });
    }), timeoutPromise]);
  },

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
    if (payload.revision && typeof payload.revision === "object") {
      body.revision = {
        previousScript: payload.revision.previousScript,
        focusKey: payload.revision.focusKey,
        instruction: payload.revision.instruction,
      };
    }

    // 前端超时保险。旧 WebView 没有 AbortController 时用 Promise.race 降级，
    // 不让一个同步 ReferenceError 把 _inFlight 永久锁住。
    // 总预算在首次请求和 502/504 自动重试之间共享，不会因为重试把时长翻倍。
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
    var submittedAt = Date.now();
    var requestOptions = {
      method: "POST",
      // Accept 让 Worker 走流式保活（生成期间发心跳行）；旧 Worker 不认识这个头，
      // 照旧返回纯 JSON，上面的解析路径两种都能吃。
      headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" },
      body: JSON.stringify(body),
    };
    if (controller) requestOptions.signal = controller.signal;

    var attempt = function () {
      return Api._attempt(requestOptions, timeoutPromise).then(function (data) {
        clearTimeout(timer);
        if (requestId !== Api._requestId) return; // 陈旧响应丢弃
        if (!callbacks.onSuccess) return;
        try {
          callbacks.onSuccess(data.report);
        } catch (renderError) {
          // 渲染异常 ≠ 网络错误：不能让下面的 catch 把它误报成“连不上教练”。
          // 真实堆栈打到 console 方便定位渲染 bug；流程锁仍由末尾的 then 统一复位。
          console.error("批改结果渲染失败（非网络问题）：", renderError);
          App.toast("结果渲染出错，请刷新页面重试");
        }
      });
    };

    var retried = false;
    var handleError = function (err) {
      if (requestId !== Api._requestId) return;
      var status = err.status || 0;

      // Worker 网关短暂故障（502/503/504）自动重试一次，共用一个超时预算；
      // 401/429 等业务状态不重试，避免把“入口码不对”拖成两次请求。
      // 预算不够就别重试：90 秒超时后只剩十几秒，第二次注定跑不完，
      // 用户却要多等一轮（实测“等了两分钟”就是这么来的）。
      var remainingBudget = Api._timeoutMs - (Date.now() - submittedAt);
      if ((status === 502 || status === 503 || status === 504) && !retried && remainingBudget >= Api._retryMinBudgetMs) {
        retried = true;
        return Promise.race([new Promise(function (resolve) {
          setTimeout(resolve, 1500);
        }), timeoutPromise])
          .then(attempt)
          .catch(handleError);
      }

      clearTimeout(timer);
      var message;
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        // 旧 WebView 没有 AbortController 时，超时只是“假中断”：fetch 还在跑，
        // 稍后会把结果当成功投递。把请求号前移，让迟到响应在 onSuccess 处作废，
        // 避免“超时提示 + 结果突然出现”的双重投递。
        if (!controller) Api._requestId += 1;
        message = "等太久了，网络可能不好，重试一次";
      } else if (err.parseFailed) {
        // 响应不是合法 JSON：网关 HTML（502/504）或意外内容，按状态码区分文案
        message = status >= 400 ? "教练服务开小差了，稍后再试" : "结果解析失败，稍后再试";
      } else if (status === 401) {
        message = "入口码不对";
      } else if (status >= 400) {
        message = err.message; // Worker 返回的业务文案（含 429 限流提示）
      } else {
        message = "连不上教练，检查一下网络"; // fetch 网络层错误（断网/DNS）
      }
      if (callbacks.onError) callbacks.onError(status, message);
    };

    attempt()
      .catch(handleError)
      .then(function () {
        clearTimeout(timer);
        Api._inFlight = false;
        if (callbacks.onFinish) callbacks.onFinish();
      });
  },
};
