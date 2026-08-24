// 开口教练：真实录音、仅本地回放与客观采集质量检查。
// DOM 契约：页面提供 <div id="voice-coach-root"></div>。
// 对外 API：VoiceCoach.init() / VoiceCoach.open({ script, onBack }) / VoiceCoach.reset()。

(function () {
  "use strict";

  var MAX_SECONDS = 60;
  var MIN_EVIDENCE_SECONDS = 3;
  var SILENCE_RMS = 0.01; // -40 dBFS，按 20ms 音频窗口统计
  var OVERLOAD_LEVEL = 0.98; // 接近数字满幅，不等同于判断人的声音表现

  var state = {
    initialized: false,
    root: null,
    els: {},
    phase: "closed",
    script: "",
    onBack: null,
    sessionId: 0,
    stream: null,
    trackEndedBindings: [],
    recorder: null,
    chunks: [],
    mimeType: "",
    recordStartedAt: 0,
    recordedSeconds: 0,
    stopReason: "manual",
    countdownTimer: null,
    countdownValue: 3,
    recordTimer: null,
    maxTimer: null,
    finalizeTimer: null,
    announceTimer: null,
    focusTimer: null,
    meterFrame: null,
    captureContext: null,
    captureSource: null,
    analyser: null,
    analysisContext: null,
    blob: null,
    blobUrl: "",
    metrics: null,
    deleteConfirmTimer: null,
    visibilityBound: false,
    pageHideBound: false,
  };

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function setText(node, text) {
    if (node) node.textContent = text || "";
  }

  function formatSeconds(value, includeTenths) {
    var safe = Math.max(0, Number(value) || 0);
    if (includeTenths) return safe.toFixed(1) + " 秒";
    var whole = Math.floor(safe);
    var minutes = Math.floor(whole / 60);
    var seconds = whole % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatPercent(value) {
    return (Math.max(0, Math.min(1, value || 0)) * 100).toFixed(1) + "%";
  }

  function announce(message, assertive) {
    var node = assertive ? state.els.alertRegion : state.els.liveRegion;
    if (!node) return;
    if (state.announceTimer) window.clearTimeout(state.announceTimer);
    node.textContent = "";
    state.announceTimer = window.setTimeout(function () {
      state.announceTimer = null;
      node.textContent = message;
    }, 20);
  }

  function setPhase(phase) {
    state.phase = phase;
    if (state.root) state.root.setAttribute("data-voice-state", phase);
  }

  function buildShell() {
    var root = state.root;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.classList.add("voice-coach-host");

    var coach = make("section", "voice-coach");
    coach.setAttribute("aria-labelledby", "voice-coach-title");

    var header = make("header", "voice-coach__header");
    var back = make("button", "voice-coach__back", "返回文字教练");
    back.type = "button";
    back.setAttribute("aria-label", "返回文字教练");
    var headingWrap = make("div", "voice-coach__heading");
    var kicker = make("span", "voice-coach__kicker", "第 3 步 · 开口练");
    var title = make("h2", "voice-coach__title", "把这段话真实说一遍");
    title.id = "voice-coach-title";
    title.tabIndex = -1;
    append(headingWrap, kicker, title);
    append(header, back, headingWrap);

    var privacy = make("div", "voice-coach__privacy");
    privacy.setAttribute("role", "note");
    var privacyMark = make("span", "voice-coach__privacy-mark", "●");
    privacyMark.setAttribute("aria-hidden", "true");
    var privacyText = make(
      "p",
      "voice-coach__privacy-text",
      "首次点开始时才会请求麦克风。录音只留在当前页面，不会自动上传；刷新或离开后消失。"
    );
    append(privacy, privacyMark, privacyText);

    var prompter = make("section", "voice-coach__prompter");
    prompter.setAttribute("aria-label", "本轮提词稿");
    var prompterHead = make("div", "voice-coach__prompter-head");
    var prompterLabel = make("span", null, "本轮定稿");
    var statusBadge = make("span", "voice-coach__status-badge", "准备好就开始");
    append(prompterHead, prompterLabel, statusBadge);
    var script = make("p", "voice-coach__script");
    var recordingMeta = make("div", "voice-coach__recording-meta");
    var timer = make("strong", "voice-coach__timer", "00:00 / 01:00");
    var meter = make("div", "voice-coach__meter");
    meter.setAttribute("aria-hidden", "true");
    var meterTrack = make("span", "voice-coach__meter-track");
    var meterFill = make("span", "voice-coach__meter-fill");
    meterTrack.appendChild(meterFill);
    meter.appendChild(meterTrack);
    append(recordingMeta, timer, meter);

    var countdown = make("div", "voice-coach__countdown");
    countdown.hidden = true;
    countdown.setAttribute("aria-live", "assertive");
    var countdownNumber = make("strong", null, "3");
    var countdownText = make("span", null, "主持递麦");
    append(countdown, countdownNumber, countdownText);
    append(prompter, prompterHead, script, recordingMeta, countdown);

    var liveRegion = make("div", "voice-coach__sr-only");
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    var alertRegion = make("div", "voice-coach__sr-only");
    alertRegion.setAttribute("role", "alert");
    alertRegion.setAttribute("aria-live", "assertive");

    var primary = make("button", "voice-coach__primary", "开始录音");
    primary.type = "button";

    var helper = make(
      "p",
      "voice-coach__helper",
      "会先倒数 3 秒，最长录 60 秒。切到后台或麦克风中断时，会安全停止并尽量保留已经录到的内容。"
    );

    var errorBox = make("section", "voice-coach__error");
    errorBox.hidden = true;
    errorBox.setAttribute("aria-labelledby", "voice-coach-error-title");
    var errorTitle = make("h3", null, "暂时录不了");
    errorTitle.id = "voice-coach-error-title";
    var errorMessage = make("p", null, "");
    var errorRetry = make("button", "voice-coach__secondary", "重新尝试");
    errorRetry.type = "button";
    append(errorBox, errorTitle, errorMessage, errorRetry);

    var result = make("section", "voice-coach__result");
    result.hidden = true;
    result.setAttribute("aria-labelledby", "voice-coach-result-title");
    var resultHead = make("div", "voice-coach__result-head");
    var resultKicker = make("span", null, "本地录音");
    var resultTitle = make("h3", null, "先听原声，再看采集质量");
    resultTitle.id = "voice-coach-result-title";
    append(resultHead, resultKicker, resultTitle);

    var audio = document.createElement("audio");
    audio.className = "voice-coach__audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.setAttribute("playsinline", "");

    var resultActions = make("div", "voice-coach__result-actions");
    var rerecord = make("button", "voice-coach__secondary voice-coach__secondary--strong", "重新录一遍");
    rerecord.type = "button";
    var remove = make("button", "voice-coach__secondary voice-coach__secondary--danger", "删除本地录音");
    remove.type = "button";
    append(resultActions, rerecord, remove);

    var quality = make("section", "voice-coach__quality");
    quality.setAttribute("aria-labelledby", "voice-coach-quality-title");
    var qualityHead = make("div", "voice-coach__quality-head");
    var qualityTitle = make("h3", null, "正在检查录音证据…");
    qualityTitle.id = "voice-coach-quality-title";
    var qualityBadge = make("span", "voice-coach__quality-badge", "检查中");
    append(qualityHead, qualityTitle, qualityBadge);
    var qualitySummary = make("p", "voice-coach__quality-summary", "只检查是否收到了足够、不过载的声音。");

    var metrics = make("dl", "voice-coach__metrics");
    var durationRow = metricRow("录音时长");
    var silenceRow = metricRow("静音占比");
    var overloadRow = metricRow("过载占比");
    append(metrics, durationRow.wrap, silenceRow.wrap, overloadRow.wrap);

    var method = make(
      "p",
      "voice-coach__method",
      "门槛说明：少于 3 秒＝证据不足；静音窗口 ≥70% 或过载样本 ≥1%＝建议重录；静音 50%–70% 或过载 0.1%–1%＝先听原声确认。静音按 20 毫秒窗口、低于 -40 dBFS 统计；过载按均匀抽样中接近数字满幅（≥98%）的样本统计。它们只反映录音证据，不代表你的语速、语调、情绪或表现力。"
    );
    var analysisRetry = make("button", "voice-coach__secondary voice-coach__analysis-retry", "重试本地检查");
    analysisRetry.type = "button";
    analysisRetry.hidden = true;
    append(quality, qualityHead, qualitySummary, metrics, method, analysisRetry);

    var teacherHandoff = make("aside", "voice-coach__handoff");
    teacherHandoff.appendChild(make("strong", null, "最后交给现场老师"));
    teacherHandoff.appendChild(
      make(
        "p",
        null,
        "先用原声复盘语速、重音和情绪变化；动作、表情以及和主持的配合，仍由老师放回真实现场一起考核。"
      )
    );
    append(result, resultHead, audio, resultActions, quality, teacherHandoff);

    append(
      coach,
      header,
      privacy,
      prompter,
      liveRegion,
      alertRegion,
      primary,
      helper,
      errorBox,
      result
    );
    root.appendChild(coach);

    state.els = {
      coach: coach,
      back: back,
      title: title,
      script: script,
      statusBadge: statusBadge,
      timer: timer,
      meterFill: meterFill,
      countdown: countdown,
      countdownNumber: countdownNumber,
      liveRegion: liveRegion,
      alertRegion: alertRegion,
      primary: primary,
      helper: helper,
      errorBox: errorBox,
      errorTitle: errorTitle,
      errorMessage: errorMessage,
      errorRetry: errorRetry,
      result: result,
      audio: audio,
      rerecord: rerecord,
      remove: remove,
      quality: quality,
      qualityTitle: qualityTitle,
      qualityBadge: qualityBadge,
      qualitySummary: qualitySummary,
      durationValue: durationRow.value,
      durationNote: durationRow.note,
      silenceValue: silenceRow.value,
      silenceNote: silenceRow.note,
      overloadValue: overloadRow.value,
      overloadNote: overloadRow.note,
      analysisRetry: analysisRetry,
    };

    back.addEventListener("click", handleBack);
    primary.addEventListener("click", handlePrimary);
    errorRetry.addEventListener("click", handleErrorRetry);
    rerecord.addEventListener("click", prepareRerecord);
    remove.addEventListener("click", handleDelete);
    analysisRetry.addEventListener("click", retryAnalysis);
  }

  function metricRow(label) {
    var wrap = make("div", "voice-coach__metric");
    var term = make("dt", null, label);
    var value = make("dd", "voice-coach__metric-value", "—");
    var note = make("dd", "voice-coach__metric-note", "等待录音");
    append(wrap, term, value, note);
    return { wrap: wrap, value: value, note: note };
  }

  function checkSupport() {
    if (!window.isSecureContext) {
      return {
        ok: false,
        message: "麦克风只能在 HTTPS 或本机安全页面使用。请换到正式安全网址后再试。",
      };
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      return {
        ok: false,
        message: "当前浏览器没有提供麦克风接口。请更新系统浏览器，或用最新版 Chrome、Safari、Edge 再试。",
      };
    }
    if (typeof window.MediaRecorder !== "function") {
      return {
        ok: false,
        message: "当前浏览器不能在网页里录音。请更新浏览器后重试，文字稿不会受到影响。",
      };
    }
    if (!getAudioContextConstructor()) {
      return {
        ok: false,
        message: "当前浏览器不能读取本地录音波形，因此无法做真实质量检查。请更新浏览器后再试。",
      };
    }
    return { ok: true, message: "" };
  }

  function getAudioContextConstructor() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function getSupportedMimeType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== "function") return "";
    var candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return "";
  }

  function showReady(message) {
    setPhase("ready");
    state.els.errorBox.hidden = true;
    state.els.result.hidden = true;
    state.els.primary.hidden = false;
    state.els.primary.disabled = !state.script;
    setText(state.els.primary, state.script ? "开始录音" : "请先完成文字稿");
    setText(state.els.statusBadge, "准备好就开始");
    setText(state.els.timer, "00:00 / 01:00");
    setMeter(0);
    state.els.countdown.hidden = true;
    setText(
      state.els.helper,
      message ||
        "会先倒数 3 秒，最长录 60 秒。切到后台或麦克风中断时，会安全停止并尽量保留已经录到的内容。"
    );
  }

  function showError(title, message, retryLabel) {
    setPhase("error");
    state.els.primary.hidden = true;
    state.els.result.hidden = true;
    state.els.errorBox.hidden = false;
    setText(state.els.errorTitle, title || "暂时录不了");
    setText(state.els.errorMessage, message);
    setText(state.els.errorRetry, retryLabel || "重新尝试");
    announce(message, true);
  }

  function permissionErrorMessage(error) {
    var name = error && error.name ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "麦克风权限没有打开。请在浏览器地址栏或系统设置中允许麦克风，然后点“重新请求麦克风”。";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "没有找到可用麦克风。请检查耳机或系统麦克风，再重新尝试。";
    }
    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
      return "麦克风正被其他应用占用，或设备暂时无法读取。关闭占用麦克风的应用后再试。";
    }
    if (name === "OverconstrainedError") {
      return "当前麦克风不支持需要的录音条件。换一个麦克风或浏览器后再试。";
    }
    return "浏览器没有成功打开麦克风。请检查权限和设备后重新尝试。";
  }

  async function requestAndCountdown() {
    var support = checkSupport();
    if (!support.ok) {
      showError("当前环境不支持录音", support.message, "重新检查");
      return;
    }

    clearCurrentRecording();
    cleanupCapture();
    setPhase("requesting");
    var requestSession = ++state.sessionId;
    state.els.errorBox.hidden = true;
    state.els.result.hidden = true;
    state.els.primary.hidden = false;
    state.els.primary.disabled = false;
    setText(state.els.primary, "取消等待");
    setText(state.els.statusBadge, "等待麦克风授权");
    setText(state.els.helper, "请在浏览器提示中选择“允许”。只有你主动开始时才会打开麦克风。");
    announce("正在等待麦克风授权");

    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
        },
        video: false,
      });

      if (requestSession !== state.sessionId || state.phase !== "requesting" || document.hidden) {
        stopTracks(stream);
        if (requestSession === state.sessionId) showReady("页面切到后台，已取消本次录音准备。回到页面后可以重新开始。");
        return;
      }

      state.stream = stream;
      bindTrackEnded(stream);
      await setupCaptureMeter(stream, requestSession);
      if (requestSession !== state.sessionId || state.phase !== "requesting") return;
      startCountdown();
    } catch (error) {
      if (requestSession !== state.sessionId) return;
      cleanupCapture();
      showError("没有打开麦克风", permissionErrorMessage(error), "重新请求麦克风");
    }
  }

  async function setupCaptureMeter(stream, requestSession) {
    var AudioContextCtor = getAudioContextConstructor();
    try {
      state.captureContext = new AudioContextCtor();
      if (state.captureContext.state === "suspended") await state.captureContext.resume();
      if (requestSession !== state.sessionId) return;
      state.captureSource = state.captureContext.createMediaStreamSource(stream);
      state.analyser = state.captureContext.createAnalyser();
      state.analyser.fftSize = 1024;
      state.analyser.smoothingTimeConstant = 0.75;
      state.captureSource.connect(state.analyser);
    } catch (error) {
      cleanupCapture();
      throw error;
    }
  }

  function startCountdown() {
    clearCountdown();
    setPhase("countdown");
    state.countdownValue = 3;
    state.els.countdown.hidden = false;
    setText(state.els.countdownNumber, "3");
    setText(state.els.primary, "取消倒计时");
    state.els.primary.disabled = false;
    setText(state.els.statusBadge, "主持递麦");
    setText(state.els.helper, "倒数结束后自动开始，听到开始提示再说。");
    announce("三秒后开始录音", true);

    state.countdownTimer = window.setInterval(function () {
      state.countdownValue -= 1;
      if (state.countdownValue > 0) {
        setText(state.els.countdownNumber, String(state.countdownValue));
        announce(String(state.countdownValue), true);
        return;
      }
      clearCountdown();
      state.els.countdown.hidden = true;
      beginRecording();
    }, 1000);
  }

  function cancelPreparation(message) {
    state.sessionId += 1;
    clearCountdown();
    cleanupCapture();
    showReady(message || "已取消，这一遍没有录音。准备好后可以重新开始。");
    announce(message || "已取消录音准备");
  }

  function beginRecording() {
    if (!state.stream || state.stream.getAudioTracks().length === 0) {
      showError("麦克风已经断开", "没有可用的声音轨道。检查设备后重新尝试。", "重新请求麦克风");
      cleanupCapture();
      return;
    }

    try {
      state.mimeType = getSupportedMimeType();
      state.recorder = state.mimeType
        ? new window.MediaRecorder(state.stream, { mimeType: state.mimeType })
        : new window.MediaRecorder(state.stream);
    } catch (error) {
      cleanupCapture();
      showError("录音器启动失败", "浏览器打开了麦克风，但没有成功建立录音。可以重新尝试。", "重新开始");
      return;
    }

    var recordingSession = state.sessionId;
    state.chunks = [];
    state.stopReason = "manual";
    state.recordStartedAt = performance.now();
    state.recordedSeconds = 0;

    state.recorder.addEventListener("dataavailable", function (event) {
      if (recordingSession !== state.sessionId) return;
      if (event.data && event.data.size > 0) state.chunks.push(event.data);
    });
    state.recorder.addEventListener("error", function () {
      if (recordingSession !== state.sessionId) return;
      state.stopReason = "recorder-error";
      stopRecording("recorder-error");
    });
    state.recorder.addEventListener("stop", function () {
      finalizeRecording(recordingSession);
    });

    try {
      state.recorder.start(250);
    } catch (error) {
      cleanupCapture();
      showError("录音没有开始", "浏览器没能启动录音。可以重新尝试，之前没有保存任何声音。", "重新开始");
      return;
    }

    setPhase("recording");
    setText(state.els.primary, "结束并保留");
    state.els.primary.disabled = false;
    setText(state.els.statusBadge, "录音中");
    setText(state.els.helper, "正在本地录音。说完就点“结束并保留”，60 秒时会自动停止。");
    announce("录音已经开始", true);
    startMeterLoop();
    updateRecordingClock();
    state.recordTimer = window.setInterval(updateRecordingClock, 200);
    state.maxTimer = window.setTimeout(function () {
      stopRecording("max");
    }, MAX_SECONDS * 1000);
  }

  function updateRecordingClock() {
    if (state.phase !== "recording") return;
    var elapsed = Math.min(MAX_SECONDS, (performance.now() - state.recordStartedAt) / 1000);
    state.recordedSeconds = elapsed;
    setText(state.els.timer, formatSeconds(elapsed, false) + " / 01:00");
  }

  function startMeterLoop() {
    cancelMeterLoop();
    if (!state.analyser) return;
    var samples = new Float32Array(state.analyser.fftSize);
    var draw = function () {
      if (state.phase !== "recording" || !state.analyser) return;
      state.analyser.getFloatTimeDomainData(samples);
      var sum = 0;
      for (var i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      var rms = Math.sqrt(sum / samples.length);
      setMeter(Math.min(1, rms * 8));
      state.meterFrame = window.requestAnimationFrame(draw);
    };
    draw();
  }

  function setMeter(value) {
    if (!state.els.meterFill) return;
    var scale = Math.max(0.03, Math.min(1, value || 0));
    state.els.meterFill.style.transform = "scaleX(" + scale.toFixed(3) + ")";
  }

  function stopRecording(reason) {
    if (state.phase !== "recording" || !state.recorder) return;
    state.stopReason = reason || "manual";
    state.recordedSeconds = Math.min(MAX_SECONDS, (performance.now() - state.recordStartedAt) / 1000);
    setPhase("stopping");
    clearRecordingTimers();
    cancelMeterLoop();
    setMeter(0);
    state.els.primary.disabled = true;
    setText(state.els.primary, "正在保存本地录音…");
    setText(state.els.statusBadge, "正在安全停止");
    announce("正在停止并保存已经录到的内容");

    try {
      if (state.recorder.state !== "inactive") state.recorder.stop();
      else {
        var recordingSession = state.sessionId;
        state.finalizeTimer = window.setTimeout(function () {
          state.finalizeTimer = null;
          finalizeRecording(recordingSession);
        }, 120);
      }
    } catch (error) {
      cleanupCapture();
      showError("没有保存成功", "录音停止时发生错误，这一遍没有形成可回放文件。请重新录一遍。", "重新开始");
    }
  }

  async function finalizeRecording(recordingSession) {
    if (recordingSession !== state.sessionId) return;
    if (state.phase !== "stopping" && state.phase !== "recording") return;
    setPhase("finalizing");
    var chunks = state.chunks.slice();
    var type = (state.recorder && state.recorder.mimeType) || state.mimeType || "audio/webm";
    state.recorder = null;
    state.chunks = [];
    cleanupCapture();

    if (chunks.length === 0) {
      showError(
        "没有收到可回放的声音",
        state.stopReason === "recorder-error"
          ? "录音器中途报错，没有留下可用文件。检查麦克风后可以重新录。"
          : "这一遍没有生成声音数据。检查麦克风后重新录一遍。",
        "重新开始"
      );
      return;
    }

    state.blob = new Blob(chunks, { type: type });
    if (!state.blob.size) {
      clearCurrentRecording();
      showError("录音文件为空", "浏览器没有保存到声音数据。请检查麦克风后重新录。", "重新开始");
      return;
    }

    state.blobUrl = URL.createObjectURL(state.blob);
    state.els.audio.src = state.blobUrl;
    state.els.result.hidden = false;
    state.els.errorBox.hidden = true;
    state.els.primary.hidden = true;
    setText(state.els.statusBadge, "已安全保留");
    setText(state.els.timer, formatSeconds(state.recordedSeconds, false) + " / 01:00");
    setPhase("analyzing");
    renderAnalysisPending();

    var stopMessage = "录音已保留在当前页面";
    if (state.stopReason === "background") stopMessage = "页面切到后台，已安全停止并保留这一段";
    else if (state.stopReason === "track-ended") stopMessage = "麦克风轨道已结束，已保留结束前的录音";
    else if (state.stopReason === "max") stopMessage = "已录满 60 秒并自动停止，录音已保留";
    else if (state.stopReason === "recorder-error") stopMessage = "录音器中途异常，已尽量保留收到的声音";
    setText(state.els.helper, stopMessage + "。先回放确认，再看下方客观证据。");
    announce(stopMessage);

    await analyzeRecording(recordingSession);
  }

  function renderAnalysisPending() {
    setText(state.els.qualityTitle, "正在检查录音证据…");
    setText(state.els.qualityBadge, "检查中");
    state.els.qualityBadge.setAttribute("data-tone", "pending");
    setText(state.els.qualitySummary, "只检查录音是否收清、是否有足够声音，不判断人的表现。");
    setMetric(state.els.durationValue, state.els.durationNote, formatSeconds(state.recordedSeconds, true), "录制计时");
    setMetric(state.els.silenceValue, state.els.silenceNote, "—", "等待波形证据");
    setMetric(state.els.overloadValue, state.els.overloadNote, "—", "等待波形证据");
    state.els.analysisRetry.hidden = true;
  }

  async function analyzeRecording(recordingSession) {
    if (!state.blob) return;
    renderAnalysisPending();
    var AudioContextCtor = getAudioContextConstructor();

    try {
      state.analysisContext = new AudioContextCtor();
      var bytes = await state.blob.arrayBuffer();
      if (recordingSession !== state.sessionId || !state.blob) return;
      var audioBuffer = await state.analysisContext.decodeAudioData(bytes.slice(0));
      if (recordingSession !== state.sessionId || !state.blob) return;
      state.metrics = calculateMetrics(audioBuffer);
      state.recordedSeconds = state.metrics.duration;
      renderMetrics(state.metrics);
      setPhase("recorded");
      announce("录音采集质量检查完成");
    } catch (error) {
      if (recordingSession !== state.sessionId || !state.blob) return;
      state.metrics = null;
      setPhase("analysis-error");
      renderAnalysisError();
      announce("浏览器没能读取波形，不评价静音和过载", true);
    } finally {
      await closeAnalysisContext();
    }
  }

  function calculateMetrics(audioBuffer) {
    var duration = Number(audioBuffer.duration) || state.recordedSeconds || 0;
    var sampleRate = audioBuffer.sampleRate;
    var frameSize = Math.max(1, Math.round(sampleRate * 0.02));
    var frameCount = Math.ceil(audioBuffer.length / frameSize);
    var channels = [];
    for (var channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      channels.push(audioBuffer.getChannelData(channel));
    }

    var silentFrames = 0;
    var overloadSamples = 0;
    var analyzedSamples = 0;
    var peak = 0;

    for (var frame = 0; frame < frameCount; frame++) {
      var start = frame * frameSize;
      var end = Math.min(audioBuffer.length, start + frameSize);
      var stride = Math.max(1, Math.ceil((end - start) / 160));
      var sumSquares = 0;
      var frameSamples = 0;

      for (var i = start; i < end; i += stride) {
        for (var c = 0; c < channels.length; c++) {
          var sample = channels[c][i] || 0;
          var absolute = Math.abs(sample);
          sumSquares += sample * sample;
          frameSamples += 1;
          analyzedSamples += 1;
          if (absolute >= OVERLOAD_LEVEL) overloadSamples += 1;
          if (absolute > peak) peak = absolute;
        }
      }

      var rms = frameSamples ? Math.sqrt(sumSquares / frameSamples) : 0;
      if (rms < SILENCE_RMS) silentFrames += 1;
    }

    return {
      duration: duration,
      silenceRatio: frameCount ? silentFrames / frameCount : 1,
      overloadRatio: analyzedSamples ? overloadSamples / analyzedSamples : 0,
      peak: peak,
      frameCount: frameCount,
      analyzedSamples: analyzedSamples,
    };
  }

  function renderMetrics(metrics) {
    var durationEnough = metrics.duration >= MIN_EVIDENCE_SECONDS;
    var silenceFail = metrics.silenceRatio >= 0.7;
    var silenceWarn = metrics.silenceRatio >= 0.5;
    var overloadFail = metrics.overloadRatio >= 0.01;
    var overloadWarn = metrics.overloadRatio >= 0.001;
    var tone = "good";
    var title = "录音证据可用于下一步复盘";
    var badge = "可用";
    var summary = "时长、静音和过载都在可用范围。这里只说明录音收得是否清楚，不说明话术表现是否合格。";

    if (!durationEnough) {
      tone = "insufficient";
      title = "证据太短，暂不评价声音质量";
      badge = "证据不足";
      summary = "少于 3 秒只能确认录音功能正常，不能据此评价静音或过载。请完整说一遍再检查。";
    } else if (silenceFail || overloadFail) {
      tone = "bad";
      title = "这段录音不适合继续分析";
      badge = "建议重录";
      summary = silenceFail
        ? "大部分录音窗口接近静音，可能离麦太远、声音过小或没有完整说完。"
        : "接近数字满幅的样本偏多，录音可能过载失真。把麦克风放远一点再录。";
    } else if (silenceWarn || overloadWarn) {
      tone = "warn";
      title = "录音可回放，但先听原声确认";
      badge = "需要确认";
      summary = silenceWarn
        ? "静音窗口偏多，可能包含较长停顿或收音偏小。先听原声，听不清就重录。"
        : "有少量样本接近满幅。先听是否出现破音；有破音就把麦克风放远一点。";
    }

    setText(state.els.qualityTitle, title);
    setText(state.els.qualityBadge, badge);
    state.els.qualityBadge.setAttribute("data-tone", tone);
    setText(state.els.qualitySummary, summary);
    setMetric(
      state.els.durationValue,
      state.els.durationNote,
      formatSeconds(metrics.duration, true),
      durationEnough ? "达到最短证据门槛" : "少于 3 秒，不做质量结论"
    );
    setMetric(
      state.els.silenceValue,
      state.els.silenceNote,
      durationEnough ? formatPercent(metrics.silenceRatio) : "不评价",
      durationEnough ? (silenceFail ? "静音窗口过多" : silenceWarn ? "静音窗口偏多" : "静音窗口在可用范围") : "证据时长不足"
    );
    setMetric(
      state.els.overloadValue,
      state.els.overloadNote,
      durationEnough ? formatPercent(metrics.overloadRatio) : "不评价",
      durationEnough ? (overloadFail ? "接近满幅样本过多" : overloadWarn ? "有少量接近满幅样本" : "未发现明显过载证据") : "证据时长不足"
    );
    state.els.analysisRetry.hidden = true;
  }

  function renderAnalysisError() {
    setText(state.els.qualityTitle, "浏览器没能读取这段波形");
    setText(state.els.qualityBadge, "不评价");
    state.els.qualityBadge.setAttribute("data-tone", "insufficient");
    setText(
      state.els.qualitySummary,
      "录音仍可在本页回放，但缺少可核验的波形证据，所以不输出静音或过载结论。可以重试检查，也可以直接重录。"
    );
    setMetric(state.els.durationValue, state.els.durationNote, formatSeconds(state.recordedSeconds, true), "来自录制计时，仅作参考");
    setMetric(state.els.silenceValue, state.els.silenceNote, "不评价", "没有成功解码波形");
    setMetric(state.els.overloadValue, state.els.overloadNote, "不评价", "没有成功解码波形");
    state.els.analysisRetry.hidden = false;
  }

  function setMetric(valueNode, noteNode, value, note) {
    setText(valueNode, value);
    setText(noteNode, note);
  }

  function retryAnalysis() {
    if (!state.blob || state.phase === "analyzing") return;
    setPhase("analyzing");
    analyzeRecording(state.sessionId);
  }

  function prepareRerecord() {
    state.sessionId += 1;
    clearCurrentRecording();
    showReady("上一段已从当前页面删除。准备好后重新录一遍。");
    announce("已准备重新录音");
    state.els.primary.focus();
  }

  function handleDelete() {
    if (!state.blob) return;
    if (state.els.remove.getAttribute("data-confirm") !== "true") {
      state.els.remove.setAttribute("data-confirm", "true");
      setText(state.els.remove, "再点一次确认删除");
      announce("再次点击将删除当前页面里的录音");
      clearDeleteConfirmTimer();
      state.deleteConfirmTimer = window.setTimeout(function () {
        state.els.remove.removeAttribute("data-confirm");
        setText(state.els.remove, "删除本地录音");
      }, 3500);
      return;
    }
    clearDeleteConfirmTimer();
    state.sessionId += 1;
    clearCurrentRecording();
    showReady("本地录音已删除，无法恢复。你可以重新录一遍。");
    announce("本地录音已删除");
    state.els.primary.focus();
  }

  function handlePrimary() {
    if (state.phase === "ready") requestAndCountdown();
    else if (state.phase === "requesting" || state.phase === "countdown") cancelPreparation();
    else if (state.phase === "recording") stopRecording("manual");
  }

  function handleErrorRetry() {
    if (!state.script) {
      showReady("还没有可练的文字稿，请先返回文字教练完成一版。");
      return;
    }
    showReady();
    requestAndCountdown();
  }

  function handleBack() {
    var callback = state.onBack;
    resetInternal(true);
    if (typeof callback === "function") callback();
  }

  function bindTrackEnded(stream) {
    unbindTrackEnded();
    var tracks = stream.getAudioTracks();
    for (var i = 0; i < tracks.length; i++) {
      var handler = function () {
        if (state.phase === "recording") stopRecording("track-ended");
        else if (state.phase === "countdown" || state.phase === "requesting") {
          cancelPreparation("麦克风轨道已经结束，这一遍没有开始。检查设备后重新录。");
        }
      };
      tracks[i].addEventListener("ended", handler);
      state.trackEndedBindings.push({ track: tracks[i], handler: handler });
    }
  }

  function unbindTrackEnded() {
    for (var i = 0; i < state.trackEndedBindings.length; i++) {
      var binding = state.trackEndedBindings[i];
      binding.track.removeEventListener("ended", binding.handler);
    }
    state.trackEndedBindings = [];
  }

  function handleVisibilityChange() {
    if (!document.hidden) return;
    if (state.phase === "recording") {
      stopRecording("background");
      // hidden 后移动浏览器可能冻结异步 stop 事件；先同步停轨，立即释放麦克风。
      // recorder 的 stop/dataavailable 事件回来后仍会用已收集 chunks 完成回放文件。
      stopTracks(state.stream);
    }
    else if (state.phase === "stopping") {
      // 用户刚点“结束并保留”到 stop 事件返回之间仍可能短暂持有麦克风。
      // 若此刻切后台，移动 WebView 可能立即冻结事件队列；同步停轨避免麦克风持续占用。
      stopTracks(state.stream);
    }
    else if (state.phase === "countdown" || state.phase === "requesting") {
      cancelPreparation("页面切到后台，已取消录音准备。回到页面后可以重新开始。");
    }
  }

  function handlePageHide() {
    if (!state.initialized) return;
    resetInternal(true);
  }

  function stopTracks(stream) {
    if (!stream || typeof stream.getTracks !== "function") return;
    var tracks = stream.getTracks();
    for (var i = 0; i < tracks.length; i++) {
      try {
        tracks[i].stop();
      } catch (error) {
        // 轨道可能已经由系统结束；清理继续进行。
      }
    }
  }

  function cleanupCapture() {
    clearCountdown();
    clearRecordingTimers();
    cancelMeterLoop();
    unbindTrackEnded();
    if (state.captureSource) {
      try {
        state.captureSource.disconnect();
      } catch (error) {
        // 已断开的节点无需再次处理。
      }
    }
    if (state.analyser) {
      try {
        state.analyser.disconnect();
      } catch (error) {
        // 已断开的节点无需再次处理。
      }
    }
    state.captureSource = null;
    state.analyser = null;
    stopTracks(state.stream);
    state.stream = null;
    if (state.captureContext) {
      var context = state.captureContext;
      state.captureContext = null;
      try {
        var closing = context.close();
        if (closing && typeof closing.catch === "function") closing.catch(function () {});
      } catch (error) {
        // 部分旧浏览器可能不实现 close；轨道已经停止。
      }
    }
    setMeter(0);
  }

  async function closeAnalysisContext() {
    if (!state.analysisContext) return;
    var context = state.analysisContext;
    state.analysisContext = null;
    try {
      await context.close();
    } catch (error) {
      // 解码已结束，关闭失败不影响录音文件与界面恢复。
    }
  }

  function clearCurrentRecording() {
    closeAnalysisContext();
    state.metrics = null;
    state.blob = null;
    if (state.els.audio) {
      try {
        state.els.audio.pause();
      } catch (error) {
        // 没有在播放时忽略。
      }
      state.els.audio.removeAttribute("src");
      try {
        state.els.audio.load();
      } catch (error) {
        // 某些 WebView 对空媒体 load 会抛错，不影响 URL 清理。
      }
    }
    if (state.blobUrl) {
      URL.revokeObjectURL(state.blobUrl);
      state.blobUrl = "";
    }
    clearDeleteConfirmTimer();
    if (state.els.remove) {
      state.els.remove.removeAttribute("data-confirm");
      setText(state.els.remove, "删除本地录音");
    }
  }

  function clearCountdown() {
    if (state.countdownTimer) window.clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }

  function clearRecordingTimers() {
    if (state.recordTimer) window.clearInterval(state.recordTimer);
    if (state.maxTimer) window.clearTimeout(state.maxTimer);
    if (state.finalizeTimer) window.clearTimeout(state.finalizeTimer);
    state.recordTimer = null;
    state.maxTimer = null;
    state.finalizeTimer = null;
  }

  function cancelMeterLoop() {
    if (state.meterFrame) window.cancelAnimationFrame(state.meterFrame);
    state.meterFrame = null;
  }

  function clearDeleteConfirmTimer() {
    if (state.deleteConfirmTimer) window.clearTimeout(state.deleteConfirmTimer);
    state.deleteConfirmTimer = null;
  }

  function resetInternal(hideRoot) {
    state.sessionId += 1;
    clearCountdown();
    clearRecordingTimers();
    cancelMeterLoop();
    clearDeleteConfirmTimer();
    if (state.announceTimer) window.clearTimeout(state.announceTimer);
    if (state.focusTimer) window.clearTimeout(state.focusTimer);
    state.announceTimer = null;
    state.focusTimer = null;

    if (state.recorder && state.recorder.state !== "inactive") {
      try {
        state.recorder.ondataavailable = null;
        state.recorder.onstop = null;
        state.recorder.onerror = null;
        state.recorder.stop();
      } catch (error) {
        // reset 明确丢弃当前录音，停止失败后仍继续释放轨道。
      }
    }
    state.recorder = null;
    state.chunks = [];
    cleanupCapture();
    closeAnalysisContext();
    clearCurrentRecording();
    state.recordStartedAt = 0;
    state.recordedSeconds = 0;
    state.stopReason = "manual";
    state.script = "";
    state.onBack = null;
    setPhase(hideRoot ? "closed" : "ready");
    if (state.els.script) setText(state.els.script, "");
    if (state.els.countdown) state.els.countdown.hidden = true;
    if (state.els.errorBox) state.els.errorBox.hidden = true;
    if (state.els.result) state.els.result.hidden = true;
    if (state.els.primary) state.els.primary.hidden = false;
    if (state.root) state.root.hidden = Boolean(hideRoot);
  }

  function init() {
    var root = document.getElementById("voice-coach-root");
    if (!root) return false;

    if (state.initialized && state.root === root) return true;
    if (state.initialized) resetInternal(true);

    state.root = root;
    buildShell();
    state.initialized = true;
    state.root.hidden = true;
    setPhase("closed");

    if (!state.visibilityBound) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      state.visibilityBound = true;
    }
    if (!state.pageHideBound) {
      window.addEventListener("pagehide", handlePageHide);
      state.pageHideBound = true;
    }
    return true;
  }

  function open(options) {
    options = options || {};
    if (!init()) return false;

    resetInternal(false);
    state.script = typeof options.script === "string" ? options.script.trim() : "";
    state.onBack = typeof options.onBack === "function" ? options.onBack : null;
    state.root.hidden = false;
    setText(
      state.els.script,
      state.script || "还没有可练的定稿。请返回文字教练，先完成一版话术。"
    );

    var support = checkSupport();
    if (!support.ok) showError("当前环境不支持录音", support.message, "重新检查");
    else showReady();

    state.focusTimer = window.setTimeout(function () {
      state.focusTimer = null;
      if (state.els.title) state.els.title.focus();
    }, 0);
    return true;
  }

  function reset() {
    if (!state.initialized) return;
    resetInternal(true);
  }

  window.VoiceCoach = {
    init: init,
    open: open,
    reset: reset,
  };
})();
