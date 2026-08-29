// 现场带练表单：系统给场景，主播只看、写、交。
// 自由话术是次入口；没有场景时明确限制 AI 只判断结构，不猜用户动机。

var Form = {
  _scenario: null,
  _sceneTimers: [],
  _draftTimer: null,

  init: function () {
    Form._scenario = TRAINING_SCENARIOS[0] || null;
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

  _renderScenario: function () {
    if (!Form._scenario) return;
    var scenario = Form._scenario;
    document.getElementById("training-goal-title").textContent = scenario.title;
    document.getElementById("scene-time").textContent = Form._formatTime(scenario.secondsLeft);
    document.getElementById("scene-votes").textContent = String(scenario.votesNeeded);
    document.getElementById("coach-cue-text").textContent = scenario.coachHint;

    var feed = document.getElementById("scene-feed");
    feed.innerHTML = "";
    var events = Array.isArray(scenario.events) ? scenario.events : [];
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var item = document.createElement("li");
      item.className = "scene-feed__item";
      item.dataset.index = String(i);
      item.dataset.at = String(Math.max(0, Number(event.at) || 0));

      var time = document.createElement("span");
      time.className = "scene-feed__time";
      time.textContent = String(event.at).padStart(2, "0");

      var source = document.createElement("span");
      source.className = "scene-feed__source scene-feed__source--" + (event.tone || "host");
      source.textContent = event.source;

      var text = document.createElement("span");
      text.textContent = event.text;

      item.appendChild(time);
      item.appendChild(source);
      item.appendChild(text);
      feed.appendChild(item);
    }
  },

  _formatTime: function (seconds) {
    var safe = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(safe / 60);
    var rest = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  },

  _playScene: function (event) {
    for (var i = 0; i < Form._sceneTimers.length; i++) clearTimeout(Form._sceneTimers[i]);
    Form._sceneTimers = [];

    var button = event.currentTarget;
    var label = button.querySelector("span:last-child");
    var items = document.querySelectorAll(".scene-feed__item");
    for (var j = 0; j < items.length; j++) items[j].classList.remove("is-playing");
    label.textContent = "现场回放中…";
    button.disabled = true;

    Array.prototype.forEach.call(items, function (item, index) {
      Form._sceneTimers.push(setTimeout(function () {
        for (var k = 0; k < items.length; k++) items[k].classList.remove("is-playing");
        item.classList.add("is-playing");
        if (index === items.length - 1) {
          Form._sceneTimers.push(setTimeout(function () {
            item.classList.remove("is-playing");
            label.textContent = "再看一遍现场回放";
            button.disabled = false;
            document.getElementById("input-script").focus();
          }, 900));
        }
      }, (Number(item.dataset.at) || 0) * 1000));
    });
  },

  stopSceneReplay: function () {
    for (var i = 0; i < Form._sceneTimers.length; i++) clearTimeout(Form._sceneTimers[i]);
    Form._sceneTimers = [];
    var items = document.querySelectorAll(".scene-feed__item");
    for (var j = 0; j < items.length; j++) items[j].classList.remove("is-playing");
    var button = document.getElementById("btn-play-scene");
    if (!button) return;
    var label = button.querySelector("span:last-child");
    if (label) label.textContent = "看 8 秒现场回放";
    button.disabled = false;
  },

  _toggleFreeMode: function () {
    Form._setFreeMode(!App.state.freeMode);
    Form._saveDraftSoon();
  },

  _setFreeMode: function (enabled) {
    App.state.freeMode = Boolean(enabled);
    if (enabled) Form.stopSceneReplay();
    document.getElementById("scene-window").hidden = enabled;
    document.getElementById("coach-cue").hidden = enabled;
    document.getElementById("free-mode-note").hidden = !enabled;
    document.getElementById("free-vote-section").hidden = !enabled;
    document.getElementById("training-goal-title").textContent = enabled
      ? "把你现场真的说过的话写下来"
      : (Form._scenario ? Form._scenario.title : "把上票理由说到具体用户身上");
    document.getElementById("script-label").textContent = enabled
      ? "你当时是怎么说的？"
      : "你会怎么接这颗球？";
    document.getElementById("btn-free-mode").textContent = enabled
      ? "返回场景带练"
      : "我有一段自己的话术";
  },

  _onVoteClick: function (event) {
    var buttons = document.querySelectorAll(".vote-option");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i] === event.currentTarget));
    }
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
    return {
      id: scenario.id,
      secondsLeft: scenario.secondsLeft,
      votesNeeded: scenario.votesNeeded,
      hostCue: scenario.hostCue,
      targetUser: scenario.targetUser,
      userSignal: scenario.userSignal,
      recentGift: scenario.recentGift,
      trainingGoal: scenario.trainingGoal,
    };
  },

  collect: function () {
    return {
      voteGap: App.state.freeMode
        ? Form._selectedVoteGap()
        : (Form._scenario ? Form._scenario.voteGap : "close"),
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

  _isSameAsLast: function (data) {
    return Boolean(
      App.state.lastReport &&
      App.state.lastRequest &&
      data &&
      data.script === App.state.lastRequest.script
    );
  },

  _updateInputState: function () {
    var data = Form.collect();
    var sameAsLast = Form._isSameAsLast(data);
    var button = document.getElementById("btn-submit");
    document.getElementById("script-count").textContent = data.script.length + " / " + LIMITS.scriptMax;
    button.disabled = Boolean(Form.validate(data)) || sameAsLast;
    var label = button.querySelector("span:first-child");
    if (label) label.textContent = sameAsLast ? "先改动一处" : "帮我看这版";
  },

  _onSubmit: function () {
    var data = Form.collect();
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
    // 新稿开始批改时，旧稿的 passed / 开口练权限必须立即失效。
    // 否则新稿 almost 或请求失败后，会误打开上一轮的过关页和旧录音稿。
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
    Form._setFreeMode(data.mode === "free" || !data.scenario);
    document.getElementById("input-script").value = data.script || "";
    if (data.voteGap) {
      var buttons = document.querySelectorAll(".vote-option");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.value === data.voteGap));
      }
    }
    Form._updateInputState();
  },

  reset: function () {
    Form._setFreeMode(false);
    document.getElementById("input-script").value = "";
    Form._updateInputState();
    try { localStorage.removeItem(STORAGE_KEYS.draft); } catch (e) {}
    document.getElementById("draft-status").textContent = "草稿会自动保存";
  },

  _saveDraftSoon: function () {
    clearTimeout(Form._draftTimer);
    var status = document.getElementById("draft-status");
    status.textContent = "保存中…";
    status.classList.remove("is-saved");
    Form._draftTimer = setTimeout(Form._saveDraft, 260);
  },

  _saveDraft: function () {
    var data = Form.collect();
    try {
      localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify({
        script: data.script,
        voteGap: data.voteGap,
        mode: data.mode,
        scenarioId: Form._scenario ? Form._scenario.id : null,
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
      if (!draft || typeof draft.script !== "string") return;
      Form._setFreeMode(draft.mode === "free");
      document.getElementById("input-script").value = draft.script;
      if (draft.voteGap) {
        var buttons = document.querySelectorAll(".vote-option");
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.value === draft.voteGap));
        }
      }
      document.getElementById("draft-status").textContent = "已恢复上次草稿";
      document.getElementById("draft-status").classList.add("is-saved");
    } catch (e) {
      // 草稿损坏或存储不可用时直接忽略，不阻断练习。
    }
  },
};
