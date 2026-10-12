// One working draft for novice revision. Approval always belongs to an exact reviewed text.
var RevisionWorkspace = {
  supports: function (report, request) {
    return Boolean(report && request && request.scenario && request.scenario.id === "novice-revival-far-v1" &&
      report.practice_status !== "awaiting_response");
  },
  plan: function (report) {
    var plan = report && report.revision_plan;
    if (!plan || !Array.isArray(plan.issues)) return null;
    return plan;
  },
  candidate: function (report) {
    var plan = RevisionWorkspace.plan(report);
    return plan && typeof plan.script === "string" && plan.script.trim() && plan.script.length <= LIMITS.scriptMax ? plan.script.trim() : "";
  },
  approval: function (report, request, script) {
    var value = typeof script === "string" ? script.trim() : "";
    if (!value) return null;
    if (report.verdict === "passed" && report.practice_status !== "awaiting_response" && value === request.script.trim()) return report;
    var ready = report.ready_revision;
    var plan = RevisionWorkspace.plan(report);
    if (!plan || plan.status !== "ready" || !ready || ready.script !== RevisionWorkspace.candidate(report) || value !== ready.script ||
        !ready.report || ready.report.verdict !== "passed" || ready.report.practice_status === "awaiting_response" ||
        ready.report.history_available === false || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ready.report.report_id || "")) return null;
    return ready.report;
  },
  draft: function (report) {
    var draft = Report._draftFor();
    if (!draft.completeRevisionInitialized) {
      var form = draft.formActive && draft.formDraft && draft.formDraft.request;
      var same = form && Form._scenarioKey(form.scenario) === Form._scenarioKey(draft.request.scenario) &&
        form.voteGap === draft.request.voteGap && (form.mode || "guided") === (draft.request.mode || "guided");
      if (same) { draft.revision = form.script; draft.revisionDirty = form.script !== draft.request.script; }
      if (!draft.revisionDirty) {
        var preview = Report._coachingPreview(draft.request.script,report.coaching);
        draft.revision = RevisionWorkspace.candidate(report) || (preview && preview.script) || draft.request.script;
      }
      draft.completeRevisionInitialized = true;
      draft.editing = Boolean(draft.revisionDirty);
    }
    draft.formActive = false;
    delete draft.formDraft;
    return draft;
  },
  save: function (draft, value) {
    draft.revision = value;
    draft.revisionDirty = true;
    draft.formActive = false;
    delete draft.formDraft;
    App.state.form = Object.assign({},App.state.lastRequest,{script:value});
    var originalInput = document.getElementById("input-script");
    if (originalInput) originalInput.value = value;
    return Report._saveWorkspace(draft);
  },
  issues: function (report) {
    var plan = RevisionWorkspace.plan(report);
    if (plan) return plan.issues.filter(function (issue) { return issue && typeof issue.why === "string" && issue.why.trim(); });
    if (report.verdict === "passed") return [];
    var list = [], coaching = report.coaching;
    (report.structure_checks || []).forEach(function (check) {
      if (["user_reason","vote_instruction"].indexOf(check.key) < 0 || check.status === "met") return;
      list.push({key:check.key,why:check.evidence,action:coaching && coaching.focus_key === check.key ? coaching.action : "对照这处缺口调整原稿。"});
    });
    if (report.redline_note) list.push({key:"redline",why:report.redline_note});
    if (report.ai_flavor) list.push({key:"persona",why:report.ai_flavor});
    (report.line_reviews || []).forEach(function (line) { if (line.mark === "wrong") list.push({key:"line_angle",original:line.original,why:line.comment}); });
    if (coaching && !list.some(function (issue) { return issue.key === coaching.focus_key; })) list.push({key:coaching.focus_key,original:coaching.original,why:report.card_why || coaching.why,action:coaching.action});
    return list;
  },
  issueList: function (items, source) {
    var list = Report._el("ol","revision-issues");
    items.forEach(function (issue) {
      var row = Report._el("li","revision-issue");
      var label = Report.CHALLENGES[issue.key];
      row.appendChild(Report._el("strong",null,label ? label.title : "这一处需要调整"));
      if (issue.original && source.indexOf(issue.original) >= 0) row.appendChild(Report._el("blockquote",null,issue.original));
      row.appendChild(Report._el("p",null,issue.why));
      if (issue.action && issue.action !== issue.why) row.appendChild(Report._el("p","revision-issue__action",issue.action));
      list.appendChild(row);
    });
    return list;
  },
  render: function (report, root, progress) {
    var request = App.state.lastRequest, draft = RevisionWorkspace.draft(report);
    var el = Report._el, plan = RevisionWorkspace.plan(report), items = RevisionWorkspace.issues(report);
    var heading = el("header","review-heading");
    heading.appendChild(el("span",null,"话术修改 · 第 " + progress.totalAttempts + " 版"));
    var title = el("h1"); heading.appendChild(title);
    var summary = el("p","review-heading__progress"); heading.appendChild(summary); root.appendChild(heading);
    var previous = App.state.coaching && App.state.coaching.previousReport;
    var resolved = previous && (report.structure_checks || []).filter(function (check) {
      return ["user_reason","vote_instruction"].indexOf(check.key) >= 0 && check.status === "met" &&
        (previous.structure_checks || []).some(function (old) { return old.key === check.key && old.status !== "met"; });
    }).map(function (check) { return Report.CHALLENGES[check.key].title; });
    if (resolved && resolved.length) root.appendChild(el("p","revision-progress-note","这次已解决：" + resolved.join("、") + "。"));
    else if (report.revision_note) root.appendChild(el("p","revision-progress-note",report.revision_note));

    if (items.length) {
      var feedback = el("section","revision-feedback");
      feedback.appendChild(el("h2",null,"原稿问题与修改说明 · " + items.length));
      if (report.coaching && report.coaching.keep) feedback.appendChild(el("p","revision-keep","保留：" + report.coaching.keep));
      feedback.appendChild(RevisionWorkspace.issueList(items,request.script));

    }
    var desk = el("section","revision-desk revision-workspace");
    var deskTitle = el("h2",null,"当前稿"); deskTitle.id = "current-draft-title"; desk.appendChild(deskTitle);
    var status = el("p","revision-desk__hint"); status.id = "revision-state"; status.setAttribute("role","status"); desk.appendChild(status);
    var clean = el("div","current-draft"); clean.setAttribute("aria-label","当前完整话术"); desk.appendChild(clean);
    var input = el("textarea","revision-input"); input.id = "revision-script"; input.maxLength = LIMITS.scriptMax; input.rows = 8;
    input.value = draft.revision; input.setAttribute("aria-labelledby","current-draft-title"); input.setAttribute("aria-describedby","revision-state"); desk.appendChild(input);
    var count = el("span","revision-count"); desk.appendChild(count);
    var primary = el("button","training-primary revision-submit"); primary.type = "button"; desk.appendChild(primary);
    var tweak = el("button","training-secondary revision-tweak","我想微调几句"); tweak.type = "button"; desk.appendChild(tweak);
    var revert = el("button","training-secondary-link revision-revert","撤销微调"); revert.type = "button"; desk.appendChild(revert);
    var savedMessage = "";
    var sync = function () {
      var value = input.value.trim(), approved = RevisionWorkspace.approval(report,request,value);
      var valid = value.length >= LIMITS.scriptMin && value.length <= LIMITS.scriptMax;
      title.textContent = approved ? "这版可以开口练" : "把这版集中改好";
      summary.textContent = approved ? "完整稿已检查通过，可以直接练，也可以调整成自己的说法。"
        : "必要修改已集中列在下方，完整稿检查通过后就能开口练。";
      clean.textContent = input.value;
      clean.hidden = Boolean(draft.editing); input.hidden = !draft.editing; count.hidden = !draft.editing;
      count.textContent = value.length + " / " + LIMITS.scriptMax;
      primary.disabled = !valid || (!approved && value === request.script.trim());
      primary.textContent = approved ? "用这版开始练习" : "检查这版完整话术";
      tweak.textContent = draft.editing ? "收起编辑，查看整稿" : "我想微调几句";
      revert.hidden = typeof draft.beforeEdit !== "string" || draft.beforeEdit === input.value;
      if (approved) status.textContent = "已通过整稿复核";
      else if (!valid) status.textContent = "保留一句完整的话，最多 " + LIMITS.scriptMax + " 字。";
      else if (value === request.script.trim()) status.textContent = "这份原稿还有下方列出的问题，修改后再检查。";
      else status.textContent = "当前稿待复核" + (savedMessage ? " · " + savedMessage : "");
      if (approved) App.unlockStage("voice"); else App.lockStage("voice");
    };
    input.addEventListener("input",function () {
      savedMessage = RevisionWorkspace.save(draft,input.value) ? "已自动保存" : "本机无法保存，请保留页面";
      sync();
    });
    tweak.addEventListener("click",function () {
      draft.editing = !draft.editing;
      if (draft.editing && typeof draft.beforeEdit !== "string") draft.beforeEdit = input.value;
      Report._saveWorkspace(draft); sync();
      if (draft.editing) input.focus();
    });
    revert.addEventListener("click",function () {
      var edited = input.value; input.value = draft.beforeEdit; draft.beforeEdit = edited;
      RevisionWorkspace.save(draft,input.value); sync();
      revert.textContent = "切回刚才的修改";
    });
    primary.addEventListener("click",function () {
      if (primary.disabled) return;
      if (RevisionWorkspace.approval(report,request,input.value)) RevisionWorkspace.start();
      else { RevisionWorkspace.save(draft,input.value); Form.submitRevision(input.value); }
    });
    if (plan && plan.review_note && !report.ready_revision) desk.appendChild(el("p","revision-desk__hint",plan.review_note));
    if (plan && Array.isArray(plan.remaining_issues) && plan.remaining_issues.length) {
      var remaining = el("section","revision-remaining");
      remaining.appendChild(el("h3",null,"参考改稿还需调整"));
      remaining.appendChild(RevisionWorkspace.issueList(plan.remaining_issues,RevisionWorkspace.candidate(report))); desk.appendChild(remaining);
    }
    var original = el("details","review-details revision-original");
    original.appendChild(el("summary",null,"对照提交前的原稿")); original.appendChild(el("div","current-draft",request.script)); desk.appendChild(original);
    root.appendChild(desk);
    if (feedback) root.appendChild(feedback);
    var detail = el("details","review-details"); detail.appendChild(el("summary",null,"查看完整判断依据"));
    var lines = report.line_reviews || [];
    if (lines.length) detail.appendChild(Report._lineReviewList(lines,null));
    else (report.structure_checks || []).forEach(function (check) { detail.appendChild(el("p",null,check.evidence)); });
    if (report.interaction_review) {
      detail.appendChild(Report._challengeRow("判断依据",report.interaction_review.reading));
      detail.appendChild(Report._challengeRow("为什么这样判断",report.interaction_review.why));
      detail.appendChild(Report._challengeRow("开口后看什么",report.interaction_review.next_check));
    }
    var dynamics = Report._roundDynamics(report);
    if (dynamics) detail.appendChild(dynamics);
    root.appendChild(detail);
    var newRound = el("button","training-secondary-link","另写一份新话术"); newRound.type = "button"; newRound.addEventListener("click",Report._onNewRound); root.appendChild(newRound);
    sync(); RevisionWorkspace.save(draft,input.value);
  },
  open: function (edit) {
    if (!RevisionWorkspace.supports(App.state.lastReport,App.state.lastRequest)) return false;
    if (edit) {
      var draft = RevisionWorkspace.draft(App.state.lastReport);
      draft.editing = true;
      if (typeof draft.beforeEdit !== "string") draft.beforeEdit = draft.revision;
    }
    Report.showContent(App.state.lastReport);
    if (edit) document.getElementById("revision-script").focus();
    return true;
  },
  start: function () {
    var report = App.state.lastReport, request = App.state.lastRequest;
    if (!RevisionWorkspace.supports(report,request)) return false;
    var draft = RevisionWorkspace.draft(report), approved = RevisionWorkspace.approval(report,request,draft.revision);
    if (!approved || !window.VoiceCoach) { App.toast("当前稿需要先完成复核，再开口练习"); return true; }
    var script = draft.revision.trim();
    VoiceCoach.open({script:script,scriptLabel:"已通过的练习稿",onBack:function () { Report.showContent(report); }});
    App.unlockStage("voice"); App.showView("voice");
    return true;
  },
  pending: function (root, request, previous) {
    if (!request || !request.scenario || request.scenario.id !== "novice-revival-far-v1") return;
    var panel = Report._el("section","revision-pending"); panel.id = "revision-pending-context";
    panel.appendChild(Report._el("h2",null,"正在检查这份稿子"));
    panel.appendChild(Report._el("div","current-draft",request.script));
    if (previous && previous.report) {
      var items = RevisionWorkspace.issues(previous.report);
      if (items.length) {
        var details = Report._el("details","review-details"); details.appendChild(Report._el("summary",null,"回看上次的修改说明"));
        details.appendChild(RevisionWorkspace.issueList(items,previous.request.script)); panel.appendChild(details);
      }
    }
    root.appendChild(panel);
  },
};
