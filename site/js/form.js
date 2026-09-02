// 现场带练表单：系统给场景，主播只看、写、交。
// 每个切片都把角色、阶段、认领、到账和弹幕时间线分开，避免把热闹当事实。

var Form = {
  _scenario: null,
  _sceneTimers: [],
  _draftTimer: null,
  _draftsByScenario: {},
  _freeDraft: { script: "", voteGap: "close" },
  _replayCompleted: false,
  _replayInProgress: false,

  ROLE_LABELS: {
    host: "主持",
    active_streamer: "台上主播",
    offstage_streamer: "台下主播",
    viewer: "观众",
    system: "系统",
  },

  EFFECT_LABELS: {
    down: "下台方向",
    revive: "复活方向",
  },

  init: function () {
    Form._scenario = Form._findScenario(DEFAULT_TRAINING_SCENARIO_ID) || TRAINING_SCENARIOS[0] || null;
    Form._renderScenarioPicker();
    Form._renderScenario();

    document.getElementById("btn-play-scene").addEventListener("click", Form._playScene);
    document.getElementById("btn-free-mode").addEventListener("click", Form._toggleFreeMode);
    document.getElementById("btn-submit").addEventListener("click", Form._onSubmit);
    document.getElementById("input-script").addEventListener("input", Form._onScriptInput);

    var voteButtons = document.querySelectorAll(".vote-option");
    for (var i = 0; i < voteButtons.length; i++) {
      voteButtons[i].addEventListener("click", Form._onVoteClick);
    }

    Form._restoreDraft();
    Form._updateInputState();
  },

  _findScenario: function (id) {
    for (var i = 0; i < TRAINING_SCENARIOS.length; i++) {
      if (TRAINING_SCENARIOS[i].id === id) return TRAINING_SCENARIOS[i];
    }
    return null;
  },

  _scenarioIndex: function () {
    if (!Form._scenario) return -1;
    for (var i = 0; i < TRAINING_SCENARIOS.length; i++) {
      if (TRAINING_SCENARIOS[i].id === Form._scenario.id) return i;
    }
    return -1;
  },

  _renderScenarioPicker: function () {
    var tabs = document.getElementById("scenario-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";
    for (var i = 0; i < TRAINING_SCENARIOS.length; i++) {
      var scenario = TRAINING_SCENARIOS[i];
      var selected = Boolean(Form._scenario && Form._scenario.id === scenario.id);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-tab";
      button.dataset.scenarioId = scenario.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(selected));
      button.setAttribute("aria-controls", "scene-window");
      button.tabIndex = selected ? 0 : -1;
      button.textContent = scenario.selectorLabel || scenario.title;
      button.addEventListener("click", Form._onScenarioSelect);
      button.addEventListener("keydown", Form._onScenarioTabKeydown);
      tabs.appendChild(button);
    }
    Form._updateScenarioPickerStatus();
  },

  _updateScenarioPickerStatus: function () {
    var status = document.getElementById("scenario-picker-status");
    if (!status) return;
    var index = Form._scenarioIndex();
    status.textContent = index >= 0
      ? "当前 " + (index + 1) + " / " + TRAINING_SCENARIOS.length
      : "共 " + TRAINING_SCENARIOS.length + " 个";
  },

  _onScenarioSelect: function (event) {
    Form._selectScenario(event.currentTarget.dataset.scenarioId);
  },

  _onScenarioTabKeydown: function (event) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) < 0) return;
    event.preventDefault();
    var current = Form._scenarioIndex();
    var next = current;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TRAINING_SCENARIOS.length - 1;
    if (event.key === "ArrowLeft") next = (current - 1 + TRAINING_SCENARIOS.length) % TRAINING_SCENARIOS.length;
    if (event.key === "ArrowRight") next = (current + 1) % TRAINING_SCENARIOS.length;
    var scenario = TRAINING_SCENARIOS[next];
    if (!scenario) return;
    Form._selectScenario(scenario.id);
    var selected = document.querySelector('.scenario-tab[data-scenario-id="' + scenario.id + '"]');
    if (selected) selected.focus();
  },

  _selectScenario: function (id, options) {
    options = options || {};
    var scenario = Form._findScenario(id);
    if (!scenario) return;
    if (!options.skipCapture) Form._captureCurrentDraft();
    Form.stopSceneReplay();
    Form._scenario = scenario;
    App.state.freeMode = false;
    Form._renderScenarioPicker();
    Form._renderScenario();
    Form._setFreeMode(false);
    document.getElementById("input-script").value = Form._draftsByScenario[scenario.id] || "";
    Form._updateInputState();
    if (!options.skipSave) Form._saveDraftSoon();
  },

  _renderScenario: function () {
    if (!Form._scenario) return;
    var scenario = Form._scenario;
    var timeline = Array.isArray(scenario.timeline) ? scenario.timeline : [];
    Form._replayCompleted = timeline.length === 0;
    Form._replayInProgress = false;
    Form._renderSceneGuidance(Form._replayCompleted);
    document.getElementById("scene-time").textContent = scenario.timeLabel || Form._formatTime(scenario.secondsLeft);
    document.getElementById("scene-role-context").textContent = scenario.roleContext || "台上主播";
    document.getElementById("scene-goal-unit").textContent = scenario.goalUnit || "按直播间实时票数";
    document.getElementById("scene-host-state").textContent = scenario.hostCue || "主持按当前进度控场；没有提供具体口播。";
    Form._applyProgress(scenario.initialProgress || scenario);

    var feed = document.getElementById("scene-feed");
    feed.innerHTML = "";
    for (var i = 0; i < timeline.length; i++) {
      var event = timeline[i];
      var item = document.createElement("li");
      item.className = "scene-feed__item is-pending";
      item.dataset.index = String(i);
      item.dataset.at = String(Math.max(0, Number(event.at) || 0));
      item.hidden = true;

      var time = document.createElement("span");
      time.className = "scene-feed__time";
      time.textContent = String(event.at).padStart(2, "0");

      var who = document.createElement("span");
      who.className = "scene-feed__who scene-feed__who--" + (event.role || "system");
      var role = document.createElement("span");
      role.className = "scene-feed__role";
      role.textContent = Form.ROLE_LABELS[event.role] || "现场";
      var speaker = document.createElement("strong");
      speaker.textContent = event.speaker || "未知";
      who.appendChild(role);
      who.appendChild(speaker);

      var content = document.createElement("span");
      content.className = "scene-feed__content";
      var text = document.createElement("span");
      text.textContent = event.text;
      content.appendChild(text);
      if (Form.EFFECT_LABELS[event.effect]) {
        var effect = document.createElement("small");
        effect.className = "scene-feed__effect scene-feed__effect--" + event.effect;
        effect.textContent = Form.EFFECT_LABELS[event.effect];
        content.appendChild(effect);
      }

      item.appendChild(time);
      item.appendChild(who);
      item.appendChild(content);
      feed.appendChild(item);
    }

    var status = document.getElementById("scene-feed-status");
    status.textContent = timeline.length
      ? "点击下方按钮，弹幕会按现场顺序出现。"
      : "这个切片没有可回放的现场信息。";
    var replay = document.getElementById("btn-play-scene");
    replay.disabled = timeline.length === 0;
    var replayLabel = replay.querySelector("span:last-child");
    if (replayLabel) replayLabel.textContent = "看现场回放 · " + timeline.length + "条";
    Form._updateInputState();
  },

  _renderSceneGuidance: function (completed) {
    var scenario = Form._scenario || {};
    document.getElementById("training-goal-title").textContent = completed
      ? (scenario.title || "现在轮到你接下一拍")
      : (scenario.preReplayTitle || "先看完现场，再决定怎么接");
    document.getElementById("scene-phase").textContent = completed
      ? (scenario.phaseLabel || "现场切片")
      : (scenario.initialPhaseLabel || "现场进行中");
    document.getElementById("coach-cue-text").textContent = completed
      ? (scenario.coachHint || "先读现场，再写下一拍。")
      : (scenario.preReplayHint || "先看角色和事件顺序，不要提前猜结果。");
  },

  _formatTime: function (seconds) {
    if (seconds === undefined || seconds === null || seconds === "") return "主持控时";
    var safe = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(safe / 60);
    var rest = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  },

  _formatNumber: function (value) {
    return Number.isInteger(Number(value)) ? String(Number(value)) : String(value);
  },

  _progressText: function (value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return Form._formatNumber(value) + " " + (Form._scenario.unitShort || "个");
  },

  _applyProgress: function (progress) {
    var scenario = Form._scenario || {};
    progress = progress || {};
    var read = function (key) {
      return Object.prototype.hasOwnProperty.call(progress, key) ? progress[key] : scenario[key];
    };
    document.getElementById("scene-target-units").textContent = Form._progressText(scenario.targetUnits, "看现场规则");
    document.getElementById("scene-pledged-units").textContent = Form._progressText(read("pledgedUnits"), scenario.pledgedLabel || "未提供");
    document.getElementById("scene-open-remaining").textContent = Form._progressText(read("openRemaining"), scenario.remainingLabel || "未提供");
    document.getElementById("scene-delivered-units").textContent = Form._progressText(read("deliveredUnits"), scenario.deliveredLabel || "未提供");
  },

  _playScene: function (event) {
    Form.stopSceneReplay();
    Form._replayCompleted = false;
    Form._replayInProgress = true;
    Form._renderSceneGuidance(false);
    Form._updateInputState();
    var button = event.currentTarget;
    var label = button.querySelector("span:last-child");
    var items = document.querySelectorAll(".scene-feed__item");
    var timeline = Form._scenario && Array.isArray(Form._scenario.timeline) ? Form._scenario.timeline : [];
    if (!items.length) return;

    Form._applyProgress(Form._scenario.initialProgress || Form._scenario);
    for (var j = 0; j < items.length; j++) {
      items[j].hidden = true;
      items[j].classList.add("is-pending");
      items[j].classList.remove("is-playing");
    }
    label.textContent = "现场回放中…";
    button.disabled = true;
    document.getElementById("scene-feed-status").textContent = "现场开始，留意每条信息是谁发的。";

    Array.prototype.forEach.call(items, function (item, index) {
      var delay = (Number(item.dataset.at) || 0) * 700;
      Form._sceneTimers.push(setTimeout(function () {
        for (var k = 0; k < items.length; k++) items[k].classList.remove("is-playing");
        item.hidden = false;
        item.classList.remove("is-pending");
        item.classList.add("is-playing");
        var timelineEvent = timeline[index] || {};
        if (timelineEvent.progress) Form._applyProgress(timelineEvent.progress);
        document.getElementById("scene-feed-status").textContent = "现场回放 " + (index + 1) + " / " + items.length;
        var feed = document.getElementById("scene-feed");
        feed.scrollTop = feed.scrollHeight;

        if (index === items.length - 1) {
          Form._sceneTimers.push(setTimeout(function () {
            item.classList.remove("is-playing");
            Form._applyProgress(Form._scenario);
            Form._replayInProgress = false;
            Form._replayCompleted = true;
            Form._renderSceneGuidance(true);
            label.textContent = "再看一遍现场回放";
            button.disabled = false;
            document.getElementById("scene-feed-status").textContent = "现场停在这里：现在轮到你写下一拍。";
            Form._updateInputState();
            document.getElementById("input-script").focus();
          }, 850));
        }
      }, delay));
    });
  },

  stopSceneReplay: function () {
    for (var i = 0; i < Form._sceneTimers.length; i++) clearTimeout(Form._sceneTimers[i]);
    Form._sceneTimers = [];
    Form._replayInProgress = false;
    var items = document.querySelectorAll(".scene-feed__item");
    for (var j = 0; j < items.length; j++) items[j].classList.remove("is-playing");
    var button = document.getElementById("btn-play-scene");
    if (!button) return;
    var label = button.querySelector("span:last-child");
    var total = Form._scenario && Array.isArray(Form._scenario.timeline) ? Form._scenario.timeline.length : 0;
    if (label) label.textContent = total ? "看现场回放 · " + total + "条" : "看现场回放";
    button.disabled = total === 0;
  },

  _toggleFreeMode: function () {
    Form._captureCurrentDraft();
    var enabled = !App.state.freeMode;
    Form._setFreeMode(enabled);
    if (!enabled) Form._renderScenario();
    document.getElementById("input-script").value = enabled
      ? Form._freeDraft.script
      : (Form._scenario ? Form._draftsByScenario[Form._scenario.id] || "" : "");
    Form._updateInputState();
    Form._saveDraftSoon();
  },

  _setFreeMode: function (enabled) {
    App.state.freeMode = Boolean(enabled);
    if (enabled) Form.stopSceneReplay();
    document.getElementById("scenario-picker").hidden = enabled;
    document.getElementById("scene-window").hidden = enabled;
    document.getElementById("coach-cue").hidden = enabled;
    document.getElementById("free-mode-note").hidden = !enabled;
    document.getElementById("free-vote-section").hidden = !enabled;
    document.getElementById("training-goal-title").textContent = enabled
      ? "把你现场真的说过的话写下来"
      : (Form._scenario ? (Form._scenario.preReplayTitle || Form._scenario.title) : "把上票理由说到具体用户身上");
    document.getElementById("script-label").textContent = enabled ? "你当时是怎么说的？" : "你会怎么接这颗球？";
    document.getElementById("btn-free-mode").textContent = enabled ? "返回场景带练" : "我有一段自己的话术";
  },

  _onVoteClick: function (event) {
    var buttons = document.querySelectorAll(".vote-option");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i] === event.currentTarget));
    }
    Form._freeDraft.voteGap = event.currentTarget.dataset.value;
    Form._updateInputState();
    Form._saveDraftSoon();
  },

  _onScriptInput: function () {
    Form._updateInputState();
    Form._saveDraftSoon();
  },

  _selectedVoteGap: function () {
    var selected = document.querySelector('.vote-option[aria-pressed="true"]');
    return selected ? selected.dataset.value : null;
  },

  _scenarioPayload: function () {
    if (App.state.freeMode || !Form._scenario) return null;
    var scenario = Form._scenario;
    var payload = {};
    var fields = [
      "id", "roleContext", "phase", "goalUnit", "targetUnits", "pledgedUnits",
      "openRemaining", "deliveredUnits", "secondsLeft", "votesNeeded", "hostCue",
      "targetUser", "userSignal", "recentGift", "trainingGoal",
    ];
    for (var i = 0; i < fields.length; i++) {
      var value = scenario[fields[i]];
      if (value !== undefined && value !== null && value !== "") payload[fields[i]] = value;
    }
    if (Array.isArray(scenario.timeline)) {
      payload.timeline = scenario.timeline.map(function (event) {
        var copy = { at: event.at, role: event.role, kind: event.kind, speaker: event.speaker, text: event.text };
        if (event.effect) copy.effect = event.effect;
        return copy;
      });
    }
    return payload;
  },

  collect: function () {
    return {
      voteGap: App.state.freeMode ? Form._selectedVoteGap() : (Form._scenario ? Form._scenario.voteGap : "close"),
      script: document.getElementById("input-script").value.trim(),
      scenario: Form._scenarioPayload(),
      mode: App.state.freeMode ? "free" : "guided",
    };
  },

  validate: function (data) {
    if (!data.voteGap) return "先点一下现在票数什么情况";
    if (data.script.length < LIMITS.scriptMin) return "至少写一句完整的话，教练才看得准";
    if (data.script.length > LIMITS.scriptMax) return "话术太长，精简到 500 字以内";
    return null;
  },

  _requestScenarioId: function (request) {
    return request && request.scenario && typeof request.scenario.id === "string" ? request.scenario.id : "";
  },

  _isSameAsLast: function (data) {
    if (!App.state.lastReport || !App.state.lastRequest || !data) return false;
    var previous = App.state.lastRequest;
    return data.script === previous.script &&
      (data.mode || "guided") === (previous.mode || "guided") &&
      Form._requestScenarioId(data) === Form._requestScenarioId(previous) &&
      (data.voteGap || "") === (previous.voteGap || "");
  },

  _updateInputState: function () {
    var data = Form.collect();
    var sameAsLast = Form._isSameAsLast(data);
    var waitingForReplay = Boolean(!App.state.freeMode && Form._scenario &&
      Array.isArray(Form._scenario.timeline) && Form._scenario.timeline.length > 0 &&
      !Form._replayCompleted);
    var button = document.getElementById("btn-submit");
    document.getElementById("script-count").textContent = data.script.length + " / " + LIMITS.scriptMax;
    button.disabled = Boolean(Form.validate(data) || sameAsLast || waitingForReplay);
    var label = button.querySelector("span:first-child");
    if (label) label.textContent = waitingForReplay ? (Form._replayInProgress ? "先看完现场" : "先播放现场") : (sameAsLast ? "先改动一处" : "帮我看这版");
  },

  _onSubmit: function () {
    var data = Form.collect();
    if (!App.state.freeMode && Form._scenario && Array.isArray(Form._scenario.timeline) && Form._scenario.timeline.length && !Form._replayCompleted) {
      App.toast("先看完现场回放，再按你看到的这一拍写话术");
      return;
    }
    var error = Form.validate(data);
    if (error) {
      App.toast(error);
      return;
    }
    if (Form._isSameAsLast(data)) {
      App.toast("先按教练指出的关卡改动一处，再提交下一次挑战");
      return;
    }
    if (!App.getAccessCode()) {
      App.showAccessModal(function () { Form._submitData(data); });
      return;
    }
    Form._submitData(data);
  },

  _submitData: function (data) {
    if (Api._inFlight) {
      App.toast("教练正在看上一版，等结果出来再改");
      return;
    }
    App.state.form = data;
    App.state.lastRequest = data;
    App.state.lastReport = null;
    App.lockStage("voice");
    var passedScript = document.getElementById("passed-script");
    if (passedScript) passedScript.textContent = "";
    if (window.VoiceCoach && VoiceCoach.reset) VoiceCoach.reset();
    App.unlockStage("report");
    App.showView("report");
    Report.showLoading();

    Api.submit(data, {
      onSuccess: function (report) {
        App.state.lastReport = report;
        if (report.verdict === "passed") Report.showPassed(report);
        else Report.showContent(report);
      },
      onError: function (status, message) {
        if (status === 401) {
          App.showView("form");
          App.showAccessModal(function () { Form._submitData(data); }, { invalid: true, clear: true });
        } else {
          App.showView("report");
          Report.showError(message);
        }
      },
      onFinish: function () {},
    });
  },

  submitRevision: function (script) {
    var base = App.state.lastRequest;
    if (!base) return;
    var next = {
      voteGap: base.voteGap,
      script: String(script || "").trim(),
      scenario: base.scenario || null,
      mode: base.mode || "guided",
    };
    var error = Form.validate(next);
    if (error) {
      App.toast(error);
      return;
    }
    document.getElementById("input-script").value = next.script;
    Form._updateInputState();
    Form._saveDraftSoon();
    Form._submitData(next);
  },

  restore: function (data) {
    if (!data) return;
    if (data.scenario && data.scenario.id && Form._findScenario(data.scenario.id)) {
      Form._selectScenario(data.scenario.id, { skipCapture: true, skipSave: true });
    }
    Form._setFreeMode(data.mode === "free" || !data.scenario);
    document.getElementById("input-script").value = data.script || "";
    if (data.voteGap) Form._setVoteGap(data.voteGap);
    Form._updateInputState();
  },

  reset: function () {
    Form.stopSceneReplay();
    Form._draftsByScenario = {};
    Form._freeDraft = { script: "", voteGap: "close" };
    Form._scenario = Form._findScenario(DEFAULT_TRAINING_SCENARIO_ID) || TRAINING_SCENARIOS[0] || null;
    Form._renderScenarioPicker();
    Form._renderScenario();
    Form._setFreeMode(false);
    document.getElementById("input-script").value = "";
    Form._setVoteGap("close");
    Form._updateInputState();
    try { localStorage.removeItem(STORAGE_KEYS.draft); } catch (e) {}
    document.getElementById("draft-status").textContent = "草稿会自动保存";
  },

  _setVoteGap: function (voteGap) {
    var buttons = document.querySelectorAll(".vote-option");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.value === voteGap));
    }
    Form._freeDraft.voteGap = voteGap || "close";
  },

  _captureCurrentDraft: function () {
    var input = document.getElementById("input-script");
    if (!input) return;
    if (App.state.freeMode) {
      Form._freeDraft.script = input.value;
      Form._freeDraft.voteGap = Form._selectedVoteGap() || Form._freeDraft.voteGap || "close";
    } else if (Form._scenario) {
      Form._draftsByScenario[Form._scenario.id] = input.value;
    }
  },

  _saveDraftSoon: function () {
    clearTimeout(Form._draftTimer);
    var status = document.getElementById("draft-status");
    status.textContent = "保存中…";
    status.classList.remove("is-saved");
    Form._draftTimer = setTimeout(Form._saveDraft, 260);
  },

  _saveDraft: function () {
    Form._captureCurrentDraft();
    try {
      localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
        version: 2,
        mode: App.state.freeMode ? "free" : "guided",
        selectedScenarioId: Form._scenario ? Form._scenario.id : null,
        scenarioDrafts: Form._draftsByScenario,
        freeDraft: Form._freeDraft,
      }));
      var status = document.getElementById("draft-status");
      status.textContent = "已自动保存";
      status.classList.add("is-saved");
    } catch (e) {
      document.getElementById("draft-status").textContent = "这台设备无法保存草稿";
    }
  },

  _restoreDraft: function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEYS.draft);
      if (!raw) return;
      var draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return;

      if (draft.version === 2) {
        if (draft.scenarioDrafts && typeof draft.scenarioDrafts === "object") {
          for (var id in draft.scenarioDrafts) {
            if (Object.prototype.hasOwnProperty.call(draft.scenarioDrafts, id) && Form._findScenario(id) && typeof draft.scenarioDrafts[id] === "string") {
              Form._draftsByScenario[id] = draft.scenarioDrafts[id];
            }
          }
        }
        if (draft.freeDraft && typeof draft.freeDraft === "object") {
          Form._freeDraft.script = typeof draft.freeDraft.script === "string" ? draft.freeDraft.script : "";
          Form._freeDraft.voteGap = ["far", "close", "secured"].indexOf(draft.freeDraft.voteGap) >= 0 ? draft.freeDraft.voteGap : "close";
        }
        var restoredScenario = Form._findScenario(draft.selectedScenarioId);
        if (restoredScenario) Form._selectScenario(restoredScenario.id, { skipCapture: true, skipSave: true });
        var free = draft.mode === "free";
        Form._setFreeMode(free);
        Form._setVoteGap(Form._freeDraft.voteGap);
        document.getElementById("input-script").value = free
          ? Form._freeDraft.script
          : (Form._scenario ? Form._draftsByScenario[Form._scenario.id] || "" : "");
      } else if (typeof draft.script === "string") {
        var legacyScenario = Form._findScenario(draft.scenarioId);
        if (legacyScenario) Form._selectScenario(legacyScenario.id, { skipCapture: true, skipSave: true });
        Form._setFreeMode(draft.mode === "free");
        document.getElementById("input-script").value = draft.script;
        if (draft.voteGap) Form._setVoteGap(draft.voteGap);
        Form._captureCurrentDraft();
      }
      document.getElementById("draft-status").textContent = "已恢复上次草稿";
      document.getElementById("draft-status").classList.add("is-saved");
    } catch (e) {
      // 草稿损坏或存储不可用时直接忽略，不阻断练习。
    }
  },
};
