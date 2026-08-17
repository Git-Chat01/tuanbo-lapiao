// 教练后台（coach.html）：密码门、喂话术、案例库清单（软删 + 游标翻页）
// 全局 var 风格与主播端一致，无构建工具；复用 config.js 的 API_BASE / LABELS / LIMITS
// 桌面操作背景：鼠标 hover 友好、信息密度高，不做手机触控优化

var Coach = {
  // 当前 tab：auto（自动吸收清单）/ manual（教练投喂清单）
  _tab: "auto",
  // 游标分页状态（按 tab 分开保存）
  _cursor: { auto: null, manual: null },
  // 是否加载中（防连点）
  _loading: false,

  // ---- 管理密码（localStorage，401 时清缓存重弹） ----
  getAdminCode: function () {
    try {
      return localStorage.getItem("tuanbo_admin_code") || "";
    } catch (e) {
      return "";
    }
  },
  saveAdminCode: function (code) {
    try {
      localStorage.setItem("tuanbo_admin_code", code);
    } catch (e) {
      // 存不了就算了：下次重输
    }
  },
  clearAdminCode: function () {
    try {
      localStorage.removeItem("tuanbo_admin_code");
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
      onConfirm(code).then(function (ok) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "进入";
        if (ok) {
          Coach.saveAdminCode(code);
          overlay.hidden = true;
          // 第一次进入时 init 的 loadList 已因无码 401 失败，
          // 这里补一次加载，否则验证通过后看到的是一页空清单
          Coach.loadList();
        } else {
          error.hidden = false;
          input.select();
        }
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
      return res.ok;
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
    if (Coach._loading) return;
    Coach._loading = true;
    Coach._cursor[Coach._tab] = null;

    Coach._request("/api/admin/cases?source=" + Coach._tab + "&limit=50")
      .then(function (data) {
        Coach._renderList(data.items || [], true);
        Coach._cursor[Coach._tab] = data.nextCursor || null;
        Coach._refreshLoadMore(data);
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast("加载失败，稍后再试");
      })
      .then(function () {
        Coach._loading = false;
      });
  },

  /** 加载更多（游标分页追加） */
  loadMore: function () {
    if (Coach._loading) return;
    var cursor = Coach._cursor[Coach._tab];
    if (!cursor) return;
    Coach._loading = true;

    Coach._request(
      "/api/admin/cases?source=" + Coach._tab + "&limit=50&cursor=" + encodeURIComponent(cursor)
    )
      .then(function (data) {
        Coach._renderList(data.items || [], false);
        Coach._cursor[Coach._tab] = data.nextCursor || null;
        Coach._refreshLoadMore(data);
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast("加载失败，稍后再试");
      })
      .then(function () {
        Coach._loading = false;
      });
  },

  _refreshLoadMore: function (data) {
    document.getElementById("btn-load-more").hidden = !data.hasMore;
  },

  /** 渲染清单卡片。replace=true 清空重画（第一页），false 追加 */
  _renderList: function (items, replace) {
    var container = document.getElementById("list-container");
    if (replace) container.innerHTML = ""; // 仅用于清空

    if (items.length === 0 && replace) {
      var empty = document.createElement("p");
      empty.className = "list-empty";
      empty.textContent =
        Coach._tab === "auto" ? "还没有自动吸收的案例——学员过关稿会自己进来" : "还没投喂过，用左边喂第一条";
      container.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      container.appendChild(Coach._caseCard(items[i]));
    }
  },

  /** 单条案例卡片：票况 tag / 相对时间 / 话术 / 为什么好 / 权威徽章 / 删除 */
  _caseCard: function (item) {
    var card = document.createElement("article");
    card.className = "case-card";
    card.dataset.id = item.id;

    // 头部：票况 tag + 时间 + 权威徽章
    var head = document.createElement("div");
    head.className = "case-card__head";
    var tag = document.createElement("span");
    tag.className = "case-card__tag case-card__tag--" + (item.voteGap || "far");
    tag.textContent = (LABELS.voteGap && LABELS.voteGap[item.voteGap]) || item.voteGap;
    head.appendChild(tag);
    head.appendChild(Coach._el("span", "case-card__time", Coach._formatTime(item.createdAt)));
    if (item.source === "manual") {
      head.appendChild(Coach._el("span", "case-card__badge", "教练投喂 · 权威最高"));
    } else {
      head.appendChild(Coach._el("span", "case-card__badge case-card__badge--auto", "学员过关自动吸收"));
    }
    card.appendChild(head);

    // 话术
    card.appendChild(Coach._el("p", "case-card__script", item.script));

    // 为什么好
    if (item.whyGood) {
      var why = Coach._el("div", "case-card__why");
      why.appendChild(Coach._el("span", "case-card__why-label", "为什么好："));
      why.appendChild(Coach._el("span", null, item.whyGood));
      card.appendChild(why);
    }

    // 删除（软删：覆写 deleted 标记，可溯源可反悔）
    var del = Coach._el("button", "case-card__delete", "删除");
    del.type = "button";
    del.addEventListener("click", function () {
      Coach._deleteCase(item.id, card);
    });
    card.appendChild(del);

    return card;
  },

  /** 软删除：确认 → DELETE → 成功后从 DOM 移除 */
  _deleteCase: function (id, cardEl) {
    if (!window.confirm("确定删除这条？删除后不再参与批改参照（软删，可追溯）")) return;

    // id 是 case:{数字}:{hex}，只含 URL 安全字符——不要 encodeURIComponent，
    // 冒号被编成 %3A 后 workerd 的 pathname 不解码，路由正则匹配不到会 404
    Coach._request("/api/admin/cases/" + id, { method: "DELETE" })
      .then(function () {
        cardEl.remove();
        Coach._toast("已删除");
      })
      .catch(function (err) {
        if (err.message !== "401") Coach._toast("删除失败，稍后再试");
      });
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
    if (!whyGood) {
      Coach._toast("填一下为什么好——这是给 AI 的判断尺子");
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
    document.getElementById("script-count").textContent = script.value.length + "/" + LIMITS.scriptMax;

    var whygood = document.getElementById("input-whygood");
    document.getElementById("whygood-count").textContent = whygood.value.length + "/200";

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
