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
        draft.revision = RevisionWorkspace.candidate(report) || draft.request.script;
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
  // Same-report updates keep the editor and disclosures mounted, including an active IME session.
  refresh: function (report) {
    var view = RevisionWorkspace._view;
    if (!view || view.report !== report || App.state.currentView !== "report" || view.root.hidden || view.root.firstChild !== view.heading) return false;
    var anchor = null, top = 0;
    if (view.root.querySelectorAll && window.innerHeight) {
      var nodes = view.root.querySelectorAll("textarea, .current-draft, .revision-issue, summary, h1, h2");
      for (var i = 0; i < nodes.length; i++) {
        if (!nodes[i].getBoundingClientRect) continue;
        var rect = nodes[i].getBoundingClientRect();
        if (rect.height && rect.top >= 0 && rect.top < window.innerHeight) { anchor = nodes[i]; top = rect.top; break; }
      }
      if (document.activeElement === view.input) { anchor = view.input; top = anchor.getBoundingClientRect().top; }
    }
    view.sync();
    if (anchor && anchor.isConnected && anchor.getBoundingClientRect && window.scrollBy) {
      var delta = anchor.getBoundingClientRect().top - top;
      if (Math.abs(delta) > 1) window.scrollBy({top:delta,behavior:"instant"});
    }
    return true;
  },
  _stopClock: function () {
    if (RevisionWorkspace._clock) clearInterval(RevisionWorkspace._clock);
    RevisionWorkspace._clock = null;
  },
  render: function (report, root, progress) {
    RevisionWorkspace._stopClock();
    var request = App.state.lastRequest, draft = RevisionWorkspace.draft(report);
    var el = Report._el, plan = RevisionWorkspace.plan(report), items = RevisionWorkspace.issues(report);
    var busy = function () { return RevisionWorkspace._active === report; };
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

    var completePanel = el("section","revision-complete-panel");
    completePanel.appendChild(el("h2",null,"教练帮你一次改完整"));
    var completeStatus = el("p","revision-desk__hint"); completeStatus.setAttribute("role","status");
    completePanel.appendChild(completeStatus);
    var elapsed = el("p","revision-elapsed"); completePanel.appendChild(elapsed);
    var generate = el("button","training-secondary revision-generate"); generate.type="button";
    generate.addEventListener("click",function () { RevisionWorkspace.generate(); }); completePanel.appendChild(generate);
    var cancel = el("button","training-secondary-link","暂时停止等待"); cancel.type="button";
    cancel.addEventListener("click",function () {
      draft.completeWaiting=false; draft.completeError="已停止等待，原稿和修改都已保留。可以继续取回这次完整改稿。";
      Api.cancel(); Report._saveWorkspace(draft); RevisionWorkspace.refresh(report);
    }); completePanel.appendChild(cancel);
    var offer = el("details","review-details revision-offer");
    offer.appendChild(el("summary",null,"查看教练改好的完整稿"));
    var offeredScript=el("div","current-draft"); offer.appendChild(offeredScript);
    var offerStatus=el("p","revision-desk__hint"); offer.appendChild(offerStatus);
    var adopt = el("button","training-secondary","采用这份完整改稿"); adopt.type="button";
    adopt.addEventListener("click",function () {
      draft.beforeEdit=input.value; draft.editing=false;
      RevisionWorkspace.save(draft,RevisionWorkspace.candidate(report)); input.value=draft.revision;
      RevisionWorkspace.refresh(report);
    }); offer.appendChild(adopt); completePanel.appendChild(offer); root.appendChild(completePanel);

    var desk = el("section","revision-desk revision-workspace");
    var deskHead = el("div","revision-desk__head");
    var deskTitle = el("h2",null,"当前稿"); deskTitle.id="current-draft-title"; deskHead.appendChild(deskTitle);
    var copy = el("button","script-copy-button revision-copy","复制完整稿"); copy.type="button";
    copy.addEventListener("click",function () { if (!copy.disabled) Report.copyScript(input.value.trim()); }); deskHead.appendChild(copy); desk.appendChild(deskHead);
    var status = el("p","revision-desk__hint"); status.id="revision-state"; status.setAttribute("role","status"); desk.appendChild(status);
    var clean = el("div","current-draft"); clean.setAttribute("aria-label","当前完整话术"); desk.appendChild(clean);
    var input = el("textarea","revision-input"); input.id="revision-script"; input.maxLength=LIMITS.scriptMax; input.rows=8;
    input.value=draft.revision; input.setAttribute("aria-labelledby","current-draft-title"); input.setAttribute("aria-describedby","revision-state"); desk.appendChild(input);
    var count=el("span","revision-count"); desk.appendChild(count);
    var actions=el("div","revision-actions");
    var primarySlot=el("div","revision-primary-slot");
    var primary=el("button","training-primary revision-submit"); primary.type="button"; primarySlot.appendChild(primary); actions.appendChild(primarySlot);
    var tweak=el("button","training-secondary revision-tweak","我想微调几句"); tweak.type="button"; actions.appendChild(tweak);
    var revert=el("button","training-secondary-link revision-revert","撤销微调"); revert.type="button"; actions.appendChild(revert); desk.appendChild(actions);
    var reviewNote=el("p","revision-desk__hint"); desk.appendChild(reviewNote);
    var remaining=el("section","revision-remaining"); desk.appendChild(remaining);
    var original=el("details","review-details revision-original");
    original.appendChild(el("summary",null,"对照提交前的原稿")); original.appendChild(el("div","current-draft",request.script)); desk.appendChild(original);
    root.appendChild(desk);
    var feedback=el("section","revision-feedback"),feedbackTitle=el("h2"),feedbackNote=el("p","revision-keep"),feedbackBody=el("div");
    feedback.appendChild(feedbackTitle); feedback.appendChild(feedbackNote); feedback.appendChild(feedbackBody); root.appendChild(feedback);
    var detail=el("details","review-details revision-evidence"); detail.appendChild(el("summary",null,"查看原稿的完整判断依据"));
    var lines=report.line_reviews || [];
    if (lines.length) detail.appendChild(Report._lineReviewList(lines,null));
    else (report.structure_checks || []).forEach(function (check) { detail.appendChild(el("p",null,check.evidence)); });
    if (report.interaction_review) {
      detail.appendChild(Report._challengeRow("判断依据",report.interaction_review.reading));
      detail.appendChild(Report._challengeRow("为什么这样判断",report.interaction_review.why));
      detail.appendChild(Report._challengeRow("开口后看什么",report.interaction_review.next_check));
    }
    var dynamics=Report._roundDynamics(report); if (dynamics) detail.appendChild(dynamics); root.appendChild(detail);
    var newRound=el("button","training-secondary-link","另写一份新话术"); newRound.type="button"; newRound.addEventListener("click",Report._onNewRound); root.appendChild(newRound);
    var savedMessage="",feedbackKey="",remainingKey="",composing=false;
    var setText=function (node,value) { if(node.textContent!==value)node.textContent=value; };
    var paintElapsed=function () {
      elapsed.hidden=!busy();
      if (busy()) elapsed.textContent="距本次提交 " + Math.max(0,Math.floor((Date.now()-(draft.completeStartedAt || Date.now()))/1000)) + " 秒 · 原稿和修改仍在本页";
    };
    var sync=function () {
      plan=RevisionWorkspace.plan(report); items=RevisionWorkspace.issues(report);
      // Only explicit adoption or untouched auto-adoption may replace the editor value.
      if (!draft.editing && !composing && input.value!==draft.revision) input.value=draft.revision;
      var value=input.value.trim(),approved=RevisionWorkspace.approval(report,request,value);
      var candidate=RevisionWorkspace.candidate(report),candidateApproved=RevisionWorkspace.approval(report,request,candidate);
      var valid=value.length>=LIMITS.scriptMin && value.length<=LIMITS.scriptMax;
      setText(title,approved ? "这版可以开口练" : "把这版集中改好");
      setText(summary,approved ? "完整稿已检查通过，可以直接练，也可以调整成自己的说法。" :
        (value!==request.script.trim() ? "当前稿有调整，重新检查通过后就能开口练。" : "教练会集中改好完整稿；你也可以按下方说明自己修改。"));
      setText(deskTitle,value===candidate ? "教练改好的完整稿" : "当前稿");
      setText(clean,input.value);
      clean.hidden=Boolean(draft.editing); input.hidden=!draft.editing; count.hidden=!draft.editing;
      setText(count,value.length + " / " + LIMITS.scriptMax);
      actions.classList.toggle("is-editing",Boolean(draft.editing));
      var docked=Boolean(approved && !draft.editing && !busy());
      actions.classList.toggle("has-practice-dock",docked); root.classList.toggle("has-practice-dock",docked);
      primary.disabled=busy() || !valid || (!approved && value===request.script.trim());
      setText(primary,approved ? "用这版开始练习" : "检查这版完整话术");
      setText(tweak,draft.editing ? "收起编辑，查看整稿" : "我想微调几句");
      revert.hidden=typeof draft.beforeEdit!=="string" || draft.beforeEdit===input.value;
      copy.disabled=!approved;
      copy.title=approved ? "复制已通过复核的完整稿" : "当前稿通过复核后可复制使用";
      if (approved) setText(status,"已通过整稿复核");
      else if (!valid) setText(status,"保留一句完整的话，最多 " + LIMITS.scriptMax + " 字。");
      else if (value===request.script.trim()) setText(status,"这份原稿还有下方列出的问题，修改后再检查。");
      else setText(status,"当前稿待复核" + (savedMessage ? " · " + savedMessage : ""));
      if (approved) App.unlockStage("voice"); else App.lockStage("voice");
      completePanel.hidden=report.verdict==="passed" || (!busy() && !draft.completeError && candidateApproved && value===candidate);
      setText(completeStatus,draft.completeError || (busy() ? (draft.completeMessage || "正在生成并复核完整稿，不用自己逐个改。你可以继续查看说明或微调。") :
        (candidate ? (candidateApproved ? "教练完整稿已通过复核，你的当前修改会保留；需要时可展开查看并采用。" : "参考稿仍需复核或调整，可以让教练继续改完整。") :
        (draft.completeAttempted ? "这次完整改稿尚未取回，原稿批改已保留，可以继续。" : "将集中处理已确认的问题，生成一份完整改稿。"))));
      var resumable=window.CoachJobs && CoachJobs.canResume(RevisionWorkspace.completePayload(report,request));
      setText(generate,busy() ? "正在生成并复核…" : draft.completeSaveFailed ? "重试保存完整改稿" : resumable ? "继续取回完整改稿" : candidate ? "帮我把剩余问题一起改好" : draft.completeAttempted ? "重试完整改稿" : "帮我改好完整稿");
      generate.disabled=busy(); generate.hidden=Boolean(candidateApproved && !busy() && !draft.completeError);
      cancel.hidden=!busy(); offer.hidden=!candidate || value===candidate;
      // Do not reset an open disclosure while the user reads or edits.
      if (offeredScript.textContent!==candidate) offeredScript.textContent=candidate;
      setText(offerStatus,candidateApproved ? "已通过整稿复核，可直接采用。" : "这是参考稿，仍需复核通过才能练习。");
      adopt.disabled=busy(); setText(adopt,candidateApproved ? "采用这份完整改稿" : "采用这份参考稿，再检查");
      reviewNote.hidden=!(plan && plan.review_note && !report.ready_revision); setText(reviewNote,reviewNote.hidden ? "" : plan.review_note);
      var nextRemaining=JSON.stringify(plan && plan.remaining_issues || []);
      remaining.hidden=Boolean(approved) || nextRemaining==="[]";
      if (nextRemaining+remaining.hidden!==remainingKey) {
        remainingKey=nextRemaining+remaining.hidden; Report._clear(remaining);
        if (!remaining.hidden) { remaining.appendChild(el("h3",null,"参考改稿还需调整")); remaining.appendChild(RevisionWorkspace.issueList(plan.remaining_issues,candidate)); }
      }
      feedback.hidden=!items.length;
      setText(feedbackTitle,approved ? "原稿这 " + items.length + " 处已改好" : "原稿修改说明 · " + items.length + " 处");
      setText(feedbackNote,approved ? "下面是原稿的问题与修改原因，当前完整稿已通过复核。" :
        (candidateApproved ? "教练完整稿已通过复核；你正在微调的当前稿需重新检查。" : "以下针对提交前的原稿；当前稿能否使用，以整稿复核结果为准。"));
      feedback.classList.toggle("is-resolved",Boolean(approved));
      var nextFeedback=JSON.stringify([items,plan && plan.changes]);
      if (nextFeedback!==feedbackKey) {
        feedbackKey=nextFeedback; Report._clear(feedbackBody);
        if (report.coaching && report.coaching.keep) feedbackBody.appendChild(el("p","revision-keep","保留：" + report.coaching.keep));
        feedbackBody.appendChild(RevisionWorkspace.issueList(items.map(function (issue,index) {
          var change=plan && Array.isArray(plan.changes) && plan.changes.find(function (item) { return item.issue===index; });
          return change ? Object.assign({},issue,{action:change.why}) : issue;
        }),request.script));
      }
      paintElapsed();
      if (busy() && !RevisionWorkspace._clock) RevisionWorkspace._clock=setInterval(function () {
        if (RevisionWorkspace._view && RevisionWorkspace._view.report===report && busy() && App.state.currentView==="report") paintElapsed();
        else RevisionWorkspace._stopClock();
      },1000);
      if (!busy()) RevisionWorkspace._stopClock();
    };
    input.addEventListener("compositionstart",function () { composing=true; });
    input.addEventListener("compositionend",function () { composing=false; savedMessage=RevisionWorkspace.save(draft,input.value) ? "已自动保存" : "本机无法保存，请保留页面"; sync(); });
    input.addEventListener("input",function () {
      savedMessage=RevisionWorkspace.save(draft,input.value) ? "已自动保存" : "本机无法保存，请保留页面"; sync();
    });
    tweak.addEventListener("click",function () {
      draft.editing=!draft.editing;
      if (draft.editing && typeof draft.beforeEdit!=="string") draft.beforeEdit=input.value;
      Report._saveWorkspace(draft); sync(); if (draft.editing) input.focus();
    });
    revert.addEventListener("click",function () {
      var edited=input.value; input.value=draft.beforeEdit; draft.beforeEdit=edited;
      RevisionWorkspace.save(draft,input.value); sync(); revert.textContent="切回刚才的修改";
    });
    primary.addEventListener("click",function () {
      if (primary.disabled) return;
      if (RevisionWorkspace.approval(report,request,input.value)) RevisionWorkspace.start();
      else { RevisionWorkspace.save(draft,input.value); Form.submitRevision(input.value); }
    });
    RevisionWorkspace._view={report:report,root:root,heading:heading,input:input,sync:sync};
    sync(); RevisionWorkspace.save(draft,input.value);
    if (window.CoachJobs) setTimeout(function () { RevisionWorkspace.autoGenerate(report); },0);
  },
  _active: null,
  completePayload: function (report,request) {
    var saved=Report._workspace;
    if(saved && saved.report===report && saved.completeWaiting && saved.completePayloadForJob)return saved.completePayloadForJob;
    var completeRevision={reportId:report.report_id};
    if(report.revision_plan && report.revision_plan.attempt_report_id)completeRevision.attemptReportId=report.revision_plan.attempt_report_id;
    return {script:request.script,voteGap:request.voteGap,scenario:request.scenario,completeRevision:completeRevision};
  },
  autoGenerate: function (report) {
    if(App.state.lastReport!==report || !RevisionWorkspace.supports(report,App.state.lastRequest) || report.verdict==="passed" || Api._inFlight) return;
    var draft=RevisionWorkspace.draft(report);
    var payload=RevisionWorkspace.completePayload(report,App.state.lastRequest);
    var resume=draft.completeWaiting && !draft.completeSaveFailed && CoachJobs.canResume(payload);
    if(resume || (!draft.completeAttempted && !RevisionWorkspace.candidate(report) && report.history_available!==false)) RevisionWorkspace.generate();
  },
  generate: function () {
    var report=App.state.lastReport,request=App.state.lastRequest;
    if(!RevisionWorkspace.supports(report,request) || report.verdict==="passed" || Api._inFlight) return;
    if(!App.getAccessCode()){App.showAccessModal(function(){RevisionWorkspace.generate();});return;}
    if(report.history_available===false || !report.report_id) {Form._submitData(Object.assign({},request));return;}
    var draft=RevisionWorkspace.draft(report),baseline=draft.revision;
    var payload=RevisionWorkspace.completePayload(report,request);
    var savedJob=window.CoachJobs && CoachJobs.canResume(payload) && CoachJobs.read();
    draft.completeStartedAt=savedJob && Number.isFinite(savedJob.startedAt) ? savedJob.startedAt : Date.now();
    draft.completeMessage="";
    draft.completePayloadForJob=payload;draft.completeSaveFailed=false;
    draft.completeAttempted=true;draft.completeWaiting=true;draft.completeError="";
    RevisionWorkspace._active=report;Report._saveWorkspace(draft);Report.showContent(report);
    Api.submit(payload,{
      onSuccess:function (result) {
        if(App.state.lastReport!==report) return;
        if(result.report_id!==report.report_id || result.verdict!==report.verdict) {draft.completeError="整稿结果与当前原稿不一致，请重试。";draft.completeWaiting=false;return;}
        report.revision_plan=result.revision_plan;delete report.ready_revision;
        if(result.ready_revision)report.ready_revision=result.ready_revision;
        var candidate=RevisionWorkspace.candidate(report);
        if(candidate && draft.revision===baseline && !draft.editing) {delete draft.beforeEdit;RevisionWorkspace.save(draft,candidate);}
        draft.completeWaiting=false;draft.completeError="";
        if(!Report._saveWorkspace(draft)){draft.completeSaveFailed=true;draft.completeWaiting=true;draft.completeError="完整改稿已完成，但本机暂时无法保存，请保留页面。";return false;}
      },
      onError:function(status,message){
        if(App.state.lastReport!==report)return;
        draft.completeWaiting=false;draft.completeError=message || "完整改稿暂未生成，原稿批改已保留。";
        if(status===401)App.showAccessModal(null,{invalid:true,clear:true});
        if(status===410)report.history_available=false;
        Report._saveWorkspace(draft);
      },
      onRetry:function(message,context){
        if(App.state.lastReport!==report || RevisionWorkspace._active!==report)return;
        draft.completeMessage=message;
        if(context && Number.isFinite(context.startedAt))draft.completeStartedAt=context.startedAt;
        RevisionWorkspace.refresh(report);
      },
      onFinish:function(){
        if(RevisionWorkspace._active===report){RevisionWorkspace._active=null;RevisionWorkspace._stopClock();}
        if(App.state.lastReport===report && App.state.currentView==="report")Report.showContent(report);
      },
    });
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
