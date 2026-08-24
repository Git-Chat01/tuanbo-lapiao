// 教练后台（coach.html）：密码门、喂话术、自动候选审核、案例库清单。
// 全局 var 风格与主播端一致，无构建工具；复用 config.js 的 API_BASE / LABELS / LIMITS
// 桌面操作背景：鼠标 hover 友好、信息密度高，不做手机触控优化

var Coach = {
  // 当前 tab：auto（自动吸收清单）/ manual（教练投喂清单）
  _tab: "auto",
  // 游标分页状态（按 tab 分开保存）
  _cursor: { auto: null, manual: null },
  // 是否加载中（防连点）
  _loading: false,
  // 清单请求世代号：切 tab 时旧响应绝不得渲染到新 tab。
  _loadSeq: 0,
  _sessionAdminCode: "",
  // 单卡操作锁：发布 / 拒绝 / 删除期间，同一张卡不允许重复操作
  _caseOps: {},

  // ---- 管理密码（仅当前 tab 会话，401 时清缓存重弹） ----
  getAdminCode: function () {
    if (Coach._sessionAdminCode) return Coach._sessionAdminCode;
    try {
      return sessionStorage.getItem("tuanbo_admin_code") || "";
    } catch (e) {
      return "";
    }
  },
  saveAdminCode: function (code) {
    Coach._sessionAdminCode = String(code || "");
    try {
      sessionStorage.setItem("tuanbo_admin_code", code);
    } catch (e) {
      // 存不了就算了：下次重输
    }
  },
  clearAdminCode: function () {
    Coach._sessionAdminCode = "";
    try {
      sessionStorage.removeItem("tuanbo_admin_code");
    } catch (e) {
      // 忽略
    }
  },

  /** 弹出密码门。onConfirm(code) 返回 Promise<boolean>（真校验一次，不猜） */
  showAuthModal: function (onConfirm) {
    var overlay = document.getElementById("auth-modal");
    var input = document.getElementById("input-admin-code");
    var error = document.getElementById("auth-error");
    var confirmBtn = document.getElementById("btn-auth-confirm");

    input.value = Coach.getAdminCode();
    error.hidden = true;
    overlay.hidden = false;
    setTimeout(function () { input.focus(); }, 50);

    var confirm = function () {
      var code = input.value.trim();
      if (!code) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "验证中……";
      Promise.resolve()
        .then(function () { return onConfirm(code); })
        .then(function (ok) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "进入";
          if (ok) {
            Coach.saveAdminCode(code);
            overlay.hidden = true;
            // 第一次进入时 init 的 loadList 已因无码 401 失败，
            // 这里补一次加载，否则验证通过后看到的是一页空清单
            Coach.loadList();
          } else {
            error.textContent = "管理码不对";
            error.hidden = false;
            input.select();
          }
        })
        .catch(function () {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "进入";
          error.textContent = "连不上后台，检查网络后再试";
          error.hidden = false;
        });
    };
    confirmBtn.onclick = confirm;
    input.onkeydown = function (e) {
      if (e.key === "Enter") confirm();
    };
  },

  /**
   * 校验密码：拿码去问一次接口（limit=1 最小请求），200 即通过。
   * 不单独做校验接口——用最小的真实请求当探针，密码对错一次见分晓。
   */
  checkCode: function (code) {
    return fetch(API_BASE + "/api/admin/cases?source=auto&limit=1", {
      headers: { "X-Admin-Code": code },
    }).then(function (res) {
      return res.json().then(function (data) {
        return Boolean(res.ok && data && data.ok === true && Array.isArray(data.items));
      }, function () {
        return false;
      });
    });
  },

  // ---- 带管理头的请求助手（401 统一处理：清缓存 + 弹密码门） ----
  _request: function (path, options) {
    options = options || {};
    options.headers = options.headers || {};
    options.headers["X-Admin-Code"] = Coach.getAdminCode();

    return fetch(API_BASE + path, options).then(function (res) {
      if (res.status === 401) {
        Coach.clearAdminCode();
        Coach.showAuthModal(function (code) {
          return Coach.checkCode(code);
        });
        throw new Error("401");
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || "请求失败");
        return data;
      });
    });
  },

  // ---- 清单 ----
  /** 加载当前 tab 的第一页（切换 tab / 投喂刷新时用） */
  loadList: function () {
    var tab = Coach._tab;
    var requestId = ++Coach._loadSeq;
    Coach._loading = true;
    Coach._cursor[tab] = null;
    Coach._showListLoading();

    Coach._request("/api/admin/cases?source=" + tab + "&limit=50")
      .then(function (data) {
        if (requestId !== Coach._loadSeq || tab !== Coach._tab) return;
        Coach._renderList(data.items || [], true);
        Coach._cursor[tab] = data.nextCursor || null;
        Coach._refreshLoadMore(data);
      })
      .catch(function (err) {
        if (requestId === Coach._loadSeq && err.message !== "401") {
          Coach._toast("加载失败，稍后再试");
        }
      })
      .then(function () {
        if (requestId === Coach._loadSeq) Coach._loading = false;
      });
  },

  /** 加载更多（游标分页追加） */
  loadMore: function () {
    if (Coach._loading) return;
    var tab = Coach._tab;
    var cursor = Coach._cursor[tab];
    if (!cursor) return;
    var requestId = ++Coach._loadSeq;
    Coach._loading = true;

    Coach._request(
      "/api/admin/cases?source=" + tab + "&limit=50&cursor=" + encodeURIComponent(cursor)
    )
      .then(function (data) {
        if (requestId !== Coach._loadSeq || tab !== Coach._tab) return;
        Coach._renderList(data.items || [], false);
        Coach._cursor[tab] = data.nextCursor || null;
        Coach._refreshLoadMore(data);
      })
      .catch(function (err) {
        if (requestId === Coach._loadSeq && err.message !== "401") {
          Coach._toast("加载失败，稍后再试");
        }
      })
      .then(function () {
        if (requestId === Coach._loadSeq) Coach._loading = false;
      });
  },

  _showListLoading: function () {
    var container = document.getElementById("list-container");
    while (container.firstChild) container.removeChild(container.firstChild);
    var loading = Coach._el("p", "list-empty", "正在加载这一类案例……");
    loading.setAttribute("role", "status");
    container.appendChild(loading);
    document.getElementById("btn-load-more").hidden = true;
  },

  _refreshLoadMore: function (data) {
    document.getElementById("btn-load-more").hidden = !data.hasMore;
  },

  /** 渲染清单卡片。replace=true 清空重画（第一页），false 追加 */
  _renderList: function (items, replace) {
    var container = document.getElementById("list-container");
    if (replace) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    if (items.length === 0 && replace) {
      var empty = document.createElement("p");
      empty.className = "list-empty";
      empty.textContent =
        Coach._tab === "auto"
          ? "暂时没有自动候选——学员过关稿会先进入这里，等老师审核"
          : "还没投喂过，用左边喂第一条";
      container.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      container.appendChild(Coach._caseCard(items[i]));
    }
  },

  /** 单条案例卡片：manual 保持原 UI；auto 根据 candidate / published / rejected 渲染审核动作。 */
  _caseCard: function (item) {
    var card = document.createElement("article");
    card.className = "case-card";
    card.dataset.id = item.id;
    item.status = Coach._caseStatus(item);

    // 头部：票况 tag + 时间 + 权威/审核状态徽章
    var head = document.createElement("div");
    head.className = "case-card__head";
    var tag = document.createElement("span");
    tag.className = "case-card__tag case-card__tag--" + (item.voteGap || "far");
    tag.textContent = (LABELS.voteGap && LABELS.voteGap[item.voteGap]) || item.voteGap;
    head.appendChild(tag);
    head.appendChild(Coach._el("span", "case-card__time", Coach._formatTime(item.createdAt)));
    var statusBadge = Coach._el("span", "case-card__badge");
    statusBadge.dataset.role = "case-status";
    head.appendChild(statusBadge);
    card.appendChild(head);

    // 话术
    card.appendChild(Coach._el("p", "case-card__script", item.script));

    // 自动候选必须连同当时的现场一起审核，避免脱离语境把“偶然有效”当成通用经验。
    if (item.source === "auto") {
      card.appendChild(Coach._scenarioContext(item.scenario));
    }

    // 为什么好
    if (item.whyGood) {
      var why = Coach._el("div", "case-card__why");
      why.appendChild(Coach._el("span", "case-card__why-label", "为什么好："));
      why.appendChild(Coach._el("span", null, item.whyGood));
      card.appendChild(why);
    }

    var actions = Coach._el("div", "case-card__actions");
    actions.dataset.role = "case-actions";
    card.appendChild(actions);

    Coach._renderCaseState(item, card);

    return card;
  },

  _scenarioContext: function (scenario) {
    var context = Coach._el("aside", "case-card__context");
    context.appendChild(Coach._el("p", "case-card__context-title", "学员当时面对的现场"));

    if (!scenario || typeof scenario !== "object") {
      context.classList.add("case-card__context--missing");
      context.appendChild(
        Coach._el(
          "p",
          "case-card__context-note",
          "旧候选未保存现场上下文，发布前请特别判断它是否只在某个特定场景成立。"
        )
      );
      return context;
    }

    var grid = Coach._el("dl", "case-card__context-grid");
    var liveNumbers = [];
    if (typeof scenario.secondsLeft === "number") liveNumbers.push(scenario.secondsLeft + " 秒");
    if (typeof scenario.votesNeeded === "number") liveNumbers.push("还差 " + scenario.votesNeeded + " 票");
    if (liveNumbers.length) Coach._contextFact(grid, "局面", liveNumbers.join(" · "));
    Coach._contextFact(grid, "目标用户", scenario.targetUser);
    Coach._contextFact(grid, "用户信号", scenario.userSignal);
    Coach._contextFact(grid, "主持递球", scenario.hostCue);
    Coach._contextFact(grid, "最近礼物", scenario.recentGift);
    Coach._contextFact(grid, "训练目标", scenario.trainingGoal);
    context.appendChild(grid);
    return context;
  },

  _contextFact: function (grid, label, value) {
    if (typeof value !== "string" || !value.trim()) return;
    var row = Coach._el("div", "case-card__context-row");
    row.appendChild(Coach._el("dt", null, label));
    row.appendChild(Coach._el("dd", null, value.trim()));
    grid.appendChild(row);
  },

  /** 兼容旧数据：旧 manual 无 status 视为 published，旧 auto 无 status 视为 candidate。 */
  _caseStatus: function (item) {
    if (item.deleted || item.status === "rejected") return "rejected";
    if (item.status === "candidate" || item.status === "published") return item.status;
    return item.source === "manual" ? "published" : "candidate";
  },

  /** 原地刷新单卡 badge 与 actions；发布成功无需重刷整个清单。 */
  _renderCaseState: function (item, cardEl) {
    var status = Coach._caseStatus(item);
    item.status = status;
    cardEl.dataset.status = status;
    cardEl.classList.toggle("case-card--candidate", item.source === "auto" && status === "candidate");
    cardEl.classList.toggle("case-card--published", item.source === "auto" && status === "published");
    cardEl.classList.toggle("case-card--rejected", item.source === "auto" && status === "rejected");

    var badge = cardEl.querySelector('[data-role="case-status"]');
    badge.className = "case-card__badge";
    if (item.source === "manual") {
      badge.textContent = "教练投喂 · 权威最高";
    } else if (status === "candidate") {
      badge.classList.add("case-card__badge--candidate");
      badge.textContent = "待老师审核";
    } else if (status === "published") {
      badge.classList.add("case-card__badge--published");
      badge.textContent = "已发布给 AI 学习";
    } else {
      badge.classList.add("case-card__badge--rejected");
      badge.textContent = "已拒绝，不参与学习";
    }

    var actions = cardEl.querySelector('[data-role="case-actions"]');
    while (actions.firstChild) actions.removeChild(actions.firstChild);

    if (item.source === "manual") {
      actions.appendChild(
        Coach._actionButton("case-card__delete", "删除", function () {
          Coach._deleteCase(item, cardEl, "manual");
        })
      );
      return;
    }

    if (status === "candidate") {
      actions.appendChild(
        Coach._actionButton("case-card__publish", "发布为经验", function () {
          Coach._publishCase(item, cardEl);
        })
      );
      actions.appendChild(
        Coach._actionButton("case-card__reject", "拒绝", function () {
          Coach._deleteCase(item, cardEl, "reject");
        })
      );
      return;
    }

    if (status === "published") {
      actions.appendChild(
        Coach._actionButton("case-card__stop", "停止使用/删除", function () {
          Coach._deleteCase(item, cardEl, "published");
        })
      );
    }
  },

  _actionButton: function (className, text, onClick) {
    var button = Coach._el("button", className, text);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  },

  _setCaseBusy: function (id, cardEl, busy, activeButton, busyText) {
    if (busy) Coach._caseOps[id] = true;
    else delete Coach._caseOps[id];
    cardEl.classList.toggle("case-card--busy", busy);
    cardEl.setAttribute("aria-busy", String(busy));
    var buttons = cardEl.querySelectorAll(".case-card__actions button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = busy;
    if (busy && activeButton) activeButton.textContent = busyText;
  },

  /** 候选发布：确认 → POST → 成功后原地切换为 published。 */
  _publishCase: function (item, cardEl) {
    if (Coach._caseOps[item.id]) return;
    if (
      !window.confirm(
        "确定发布这条候选吗？发布后 AI 会把它作为批改参考。请确认话术和“为什么好”都值得学习。"
      )
    ) return;

    var activeButton = cardEl.querySelector(".case-card__publish");
    Coach._setCaseBusy(item.id, cardEl, true, activeButton, "发布中……");

    // id 保留冒号，与 DELETE 路由规则一致，不做 encodeURIComponent。
    Coach._request("/api/admin/cases/" + item.id + "/publish", { method: "POST" })
      .then(function () {
        item.status = "published";
        item.deleted = false;
        Coach._renderCaseState(item, cardEl);
        Coach._toast("已发布给 AI 学习");
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast("发布失败：" + err.message);
      })
      .then(function () {
        delete Coach._caseOps[item.id];
        if (!cardEl.isConnected) return;
        Coach._setCaseBusy(item.id, cardEl, false);
        Coach._renderCaseState(item, cardEl);
      });
  },

  /** 拒绝/软删除：candidate 叫拒绝；published 叫停止使用；manual 保持原删除语义。 */
  _deleteCase: function (item, cardEl, intent) {
    if (Coach._caseOps[item.id]) return;
    var confirmText;
    var busyText;
    var successText;
    if (intent === "reject") {
      confirmText = "确定拒绝这条候选吗？拒绝后它不会发布给 AI 学习，同一稿件也不会再次自动进入候选。";
      busyText = "拒绝中……";
      successText = "已拒绝，不会给 AI 学习";
    } else if (intent === "published") {
      confirmText = "确定停止使用并删除这条已发布经验吗？删除后 AI 不再把它作为批改参考。";
      busyText = "停止中……";
      successText = "已停止使用并删除";
    } else {
      confirmText = "确定删除这条教练投喂吗？删除后 AI 不再把它作为批改参考（软删，可追溯）。";
      busyText = "删除中……";
      successText = "已删除";
    }
    if (!window.confirm(confirmText)) return;

    var selector = intent === "reject"
      ? ".case-card__reject"
      : intent === "published"
        ? ".case-card__stop"
        : ".case-card__delete";
    var activeButton = cardEl.querySelector(selector);
    Coach._setCaseBusy(item.id, cardEl, true, activeButton, busyText);

    // id 是 case:{数字}:{hex}，保留冒号，不做 encodeURIComponent。
    Coach._request("/api/admin/cases/" + item.id, { method: "DELETE" })
      .then(function () {
        item.status = "rejected";
        item.deleted = true;
        cardEl.remove();
        delete Coach._caseOps[item.id];
        Coach._ensureListEmptyState();
        Coach._toast(successText);
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast((intent === "reject" ? "拒绝失败：" : "删除失败：") + err.message);
      })
      .then(function () {
        delete Coach._caseOps[item.id];
        if (!cardEl.isConnected) return;
        Coach._setCaseBusy(item.id, cardEl, false);
        Coach._renderCaseState(item, cardEl);
      });
  },

  _ensureListEmptyState: function () {
    var container = document.getElementById("list-container");
    if (container.querySelector(".case-card")) return;
    var empty = Coach._el(
      "p",
      "list-empty",
      Coach._tab === "auto"
        ? "暂时没有自动候选——学员过关稿会先进入这里，等老师审核"
        : "还没投喂过，用左边喂第一条"
    );
    container.appendChild(empty);
  },

  // ---- 投喂 ----
  /** 投喂表单：票况 chip + 话术 + 为什么好 */
  _feed: function () {
    var active = document.querySelector('.coach-col--feed .chip[aria-pressed="true"]');
    var script = document.getElementById("input-script").value.trim();
    var whyGood = document.getElementById("input-whygood").value.trim();

    if (!active) {
      Coach._toast("先选票数情况");
      return;
    }
    if (script.length < LIMITS.scriptMin) {
      Coach._toast("话术太短了，至少写一句完整的话");
      return;
    }
    if (script.length > LIMITS.feedScriptMax) {
      Coach._toast("话术太长，精简到 " + LIMITS.feedScriptMax + " 字以内");
      return;
    }
    if (!whyGood) {
      Coach._toast("填一下为什么好——这是给 AI 的判断尺子");
      return;
    }
    if (whyGood.length > LIMITS.feedWhyGoodMax) {
      Coach._toast("为什么好写太长了，精简到 " + LIMITS.feedWhyGoodMax + " 字以内");
      return;
    }

    var btn = document.getElementById("btn-feed");
    btn.disabled = true;
    btn.textContent = "投喂中……";

    Coach._request("/api/admin/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voteGap: active.dataset.value,
        script: script,
        whyGood: whyGood,
      }),
    })
      .then(function (data) {
        // 乐观插入：KV 最终一致性 ~60s，清单立即显示刚投的（检索慢半拍没关系）
        Coach._toast("投喂成功，教练收到了");
        Coach._resetFeedForm();
        Coach._insertLocalCard({
          id: data.id,
          source: "manual",
          script: script,
          voteGap: active.dataset.value,
          whyGood: whyGood,
          createdAt: Date.now(),
          deleted: false,
        });
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast("投喂失败：" + err.message);
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "投喂给教练";
        Coach._refreshFeedBtn();
      });
  },

  /** 乐观插入：manual tab 直接插到清单顶部（不等 KV 生效） */
  _insertLocalCard: function (item) {
    if (Coach._tab !== "manual") return;
    var container = document.getElementById("list-container");
    // 先清掉空态占位
    var empty = container.querySelector(".list-empty");
    if (empty) empty.remove();
    container.insertBefore(Coach._caseCard(item), container.firstChild);
  },

  _resetFeedForm: function () {
    var chips = document.querySelectorAll(".coach-col--feed .chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", "false");
    }
    document.getElementById("input-script").value = "";
    document.getElementById("input-whygood").value = "";
    Coach._updateCounts();
  },

  // ---- 表单状态 ----
  _updateCounts: function () {
    var script = document.getElementById("input-script");
    document.getElementById("script-count").textContent = script.value.length + "/" + LIMITS.feedScriptMax;

    var whygood = document.getElementById("input-whygood");
    document.getElementById("whygood-count").textContent = whygood.value.length + "/" + LIMITS.feedWhyGoodMax;

    Coach._refreshFeedBtn();
  },

  _refreshFeedBtn: function () {
    var active = document.querySelector('.coach-col--feed .chip[aria-pressed="true"]');
    var script = document.getElementById("input-script").value.trim();
    var whyGood = document.getElementById("input-whygood").value.trim();
    document.getElementById("btn-feed").disabled = !(
      active &&
      script.length >= LIMITS.scriptMin &&
      whyGood.length > 0
    );
  },

  // ---- tab 切换 ----
  _switchTab: function (tab) {
    if (Coach._tab === tab) return;
    Coach._tab = tab;
    document.getElementById("tab-auto").classList.toggle("tab--active", tab === "auto");
    document.getElementById("tab-manual").classList.toggle("tab--active", tab === "manual");
    document.getElementById("tab-auto").setAttribute("aria-selected", String(tab === "auto"));
    document.getElementById("tab-manual").setAttribute("aria-selected", String(tab === "manual"));
    document.getElementById("list-hint").hidden = tab !== "auto";
    Coach.loadList();
  },

  // ---- 小助手 ----
  _el: function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  },
  _toast: function (message) {
    var container = document.getElementById("toast-container");
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3000);
  },

  /** 相对时间：x 分钟前 / x 小时前 / x 天前 / 具体日期 */
  _formatTime: function (createdAt) {
    if (!createdAt) return "";
    var diff = Date.now() - createdAt;
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + " 小时前";
    if (diff < 30 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + " 天前";
    var d = new Date(createdAt);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  /** 初始化：绑定事件 + 密码门 + 首次加载 */
  init: function () {
    // chip 单选（喂话术表单）
    var chips = document.querySelectorAll(".coach-col--feed .chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function (e) {
        var chip = e.currentTarget;
        var siblings = chip.closest(".chip-group").querySelectorAll(".chip");
        for (var j = 0; j < siblings.length; j++) {
          siblings[j].setAttribute("aria-pressed", String(siblings[j] === chip));
        }
        Coach._refreshFeedBtn();
      });
    }

    document.getElementById("input-script").addEventListener("input", Coach._updateCounts);
    document.getElementById("input-whygood").addEventListener("input", Coach._updateCounts);
    document.getElementById("btn-feed").addEventListener("click", Coach._feed);
    document.getElementById("tab-auto").addEventListener("click", function () { Coach._switchTab("auto"); });
    document.getElementById("tab-manual").addEventListener("click", function () { Coach._switchTab("manual"); });
    document.getElementById("btn-load-more").addEventListener("click", Coach.loadMore);
    document.getElementById("btn-logout").addEventListener("click", function () {
      Coach.clearAdminCode();
      Coach.showAuthModal(function (code) {
        return Coach.checkCode(code);
      });
    });

    // 密码门：没有缓存码 → 弹门；有 → 先按门后加载（加载失败 401 会再弹门）
    if (!Coach.getAdminCode()) {
      Coach.showAuthModal(function (code) {
        return Coach.checkCode(code);
      });
    }
    Coach.loadList();
  },
};

document.addEventListener("DOMContentLoaded", function () {
  Coach.init();
});
