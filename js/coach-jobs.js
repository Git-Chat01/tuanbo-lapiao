// Persist the task ID BEFORE sending. Lost responses, reloads and reconnects
// all address the same task; polling never starts another model generation.
var CoachJobs = {
  key: "tuanbo-pending-coach-job-v1",
  memory: null,
  waitMs: 180000,
  requestMs: 12000,

  payload: function (value) {
    var body = {voteGap:value.voteGap, script:value.script};
    if (value.scenario) body.scenario = value.scenario;
    if (value.revision) body.revision = value.revision;
    return body;
  },
  read: function () {
    try { CoachJobs.memory = JSON.parse(localStorage.getItem(CoachJobs.key) || "null") || CoachJobs.memory; } catch (e) {}
    var saved = CoachJobs.memory;
    if (!saved || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.id) ||
        !saved.payload || typeof saved.payload.script !== "string" || saved.expiresAt <= Date.now()) return null;
    return saved;
  },
  save: function (record, updating) {
    if (updating) {
      var current = CoachJobs.read();
      if (current && current.id !== record.id) return false;
    }
    CoachJobs.memory = record;
    try { localStorage.setItem(CoachJobs.key, JSON.stringify(record)); return true; } catch (e) { return false; }
  },
  clear: function (id) {
    // A late callback from an older tab must not delete a newer task's pointer.
    var saved = CoachJobs.read();
    if (saved && saved.id !== id) return;
    CoachJobs.memory = null;
    try { localStorage.removeItem(CoachJobs.key); } catch (e) {}
  },
  canResume: function (request) {
    var saved = CoachJobs.read();
    return Boolean(saved && JSON.stringify(saved.payload) === JSON.stringify(CoachJobs.payload(request)));
  },
  uuid: function () {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  },
  owner: async function (code) {
    var bytes = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    return Array.from(new Uint8Array(bytes), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  },
  submit: function (payload, callbacks) {
    callbacks = callbacks || {};
    if (Api._inFlight) return;
    if (!API_BASE) { App.toast("后端地址未配置"); if (callbacks.onFinish) callbacks.onFinish(); return; }
    Api._inFlight = true;
    var requestId = ++Api._requestId, startedAt = Date.now(), finished = false;
    var cancelReject;
    var canceled = new Promise(function (_, reject) { cancelReject = reject; });
    canceled.catch(function () {});
    var run = {stopped:false, controller:null, wake:null, cancel:function () {
      run.stopped = true;
      if (run.controller) run.controller.abort();
      if (run.wake) run.wake();
      cancelReject(new Error("Canceled"));
      finish();
    }};
    Api._active = run;
    function active() { return !run.stopped && Api._requestId === requestId; }
    function finish() {
      if (finished) return;
      finished = true;
      if (Api._active === run) { Api._active = null; Api._inFlight = false; }
      if (callbacks.onFinish) callbacks.onFinish();
    }
    function message(text) { if (active() && callbacks.onRetry) callbacks.onRetry(text); }
    function pause(ms) {
      return new Promise(function (resolve) {
        var timer = setTimeout(done, ms);
        function done() { clearTimeout(timer); run.wake = null; resolve(); }
        run.wake = done;
      });
    }
    async function exchange(path, body) {
      var controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
      run.controller = controller;
      var timer;
      try {
        return await Promise.race([(async function () {
          var res = await fetch(API_BASE + path, {method:"POST", headers:{"Content-Type":"application/json"},
            body:JSON.stringify(body), ...(controller ? {signal:controller.signal} : {})});
          var data;
          try { data = JSON.parse(await res.text()); }
          catch (e) { throw new Error("Incomplete response"); }
          if (!res.ok || data.error) { var error = new Error(data.message || "批改暂时不可用"); error.status = res.status; throw error; }
          return data;
        })(), new Promise(function (_, reject) {
          timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error("Connection timeout")); }, CoachJobs.requestMs);
        }), canceled]);
      } finally { clearTimeout(timer); if (run.controller === controller) run.controller = null; }
    }
    (async function () {
      var code = App.getAccessCode(), body = CoachJobs.payload(payload);
      var owner = await CoachJobs.owner(code);
      if (!active()) return;
      var saved = CoachJobs.read();
      if (!saved || saved.owner !== owner || JSON.stringify(saved.payload) !== JSON.stringify(body)) {
        saved = {id:CoachJobs.uuid(), owner:owner, payload:body, acknowledged:false, expiresAt:Date.now()+86400000};
      }
      run.jobId = saved.id;
      var persistent = CoachJobs.save(saved);
      var errors = 0;
      while (active()) {
        if (Date.now()-startedAt >= CoachJobs.waitMs) {
          throw new Error("暂时未能取回批改结果，原稿和任务编号已保留。点击重新连接会继续查询这次批改。");
        }
        if (window.navigator && window.navigator.onLine === false) {
          message("网络已断开，正在等待恢复；已提交的批改会在后台继续。");
          await pause(3000); continue;
        }
        try {
          var data = await exchange(saved.acknowledged ? "/api/coach/jobs/"+saved.id : "/api/coach/jobs",
            saved.acknowledged ? {accessCode:code} : Object.assign({accessCode:code, jobId:saved.id}, body));
          if (!active()) return;
          if (data.jobId !== saved.id || ["queued","running","done","failed"].indexOf(data.state) < 0) throw new Error("Incomplete job response");
          saved.acknowledged = true;
          if (Number.isFinite(data.expiresAt)) saved.expiresAt = data.expiresAt;
          CoachJobs.save(saved, true); errors = 0;
          if (data.state === "failed") {
            CoachJobs.clear(saved.id);
            var failure = new Error(data.failure && data.failure.message || "这次批改未完成，请重新提交。");
            failure.status = data.failure && data.failure.status || 500; failure.terminal = true; throw failure;
          }
          if (data.state === "done") {
            if (!data.report || !data.report.report_id || ["passed","almost","off"].indexOf(data.report.verdict) < 0) throw new Error("Incomplete report");
            // Keep the pointer if rendering/storage fails so this exact report is recoverable.
            try { if (callbacks.onSuccess) callbacks.onSuccess(data.report); }
            catch (e) { var rendering = new Error("批改已完成，但页面显示失败。请刷新后取回这份结果。"); rendering.terminal = true; throw rendering; }
            CoachJobs.clear(saved.id); return;
          }
          message(persistent ? "批改已提交，后台正在处理。刷新或重新打开本浏览器仍可取回结果。"
            : "批改已提交。本浏览器无法保存任务编号，请保留此页面等待结果。");
          await pause(2500);
        } catch (err) {
          if (!active()) return;
          if (err.terminal || [400,401,403,404,409,410,429].indexOf(err.status) >= 0) {
            if ([400,403,404,409,410].indexOf(err.status) >= 0) CoachJobs.clear(saved.id);
            throw err;
          }
          message("连接暂时中断，正在重新查询这次批改，不用重复提交。");
          await pause(Math.min(10000, 1500 * Math.pow(2, Math.min(errors++, 3))));
        }
      }
    })().catch(function (err) {
      if (active() && callbacks.onError) callbacks.onError(err.status || 0, err.message);
    }).finally(finish);
  },
};
