// ═══ M0 Agent UI 预览原型 · 交互逻辑 ═══
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // 图标统一坐标系：所有 <svg><use> 补 24×24 viewBox，否则按 24 网格绘制的图标会被裁切
  $$("svg").forEach(s => { if (s.querySelector("use") && !s.getAttribute("viewBox")) s.setAttribute("viewBox", "0 0 24 24"); });

  const app = $("#app"), sidebar = $("#sidebar"), panel = $("#panel");
  const tbTitle = $("#tbTitle");
  const PAGE_TITLE = { chat: "新对话", agents: "Agents", tasks: "定时任务", plugins: "插件", security: "安全", settings: "设置" };

  /* ── 页面切换 ── */
  function gotoPage(name, conv) {
    $$(".page").forEach(p => p.classList.toggle("active", p.dataset.page === name));
    $$(".sb-item").forEach(b => b.classList.toggle("active", b.dataset.page === name && name !== "chat"));
    $$(".sb-conv").forEach(b => b.classList.toggle("active", name === "chat" && b.dataset.conv === conv));
    if (name === "chat") {
      $(".sb-item[data-conv='new']").classList.toggle("active", conv === "new");
      const isEmpty = conv === "new";
      $("#chatEmpty").classList.toggle("hidden", !isEmpty);
      $("#chatScroll").classList.toggle("active", !isEmpty);
      tbTitle.textContent = isEmpty ? "新对话" : "修复 todo-app 删除按钮";
    } else {
      tbTitle.textContent = PAGE_TITLE[name] || "";
    }
    closePops();
  }
  document.addEventListener("click", e => {
    const nav = e.target.closest("[data-page]");
    if (nav) { gotoPage(nav.dataset.page, nav.dataset.conv); return; }
    const go = e.target.closest("[data-goto]");
    if (go) gotoPage(go.dataset.goto);
  });

  /* ── 侧栏 / 面板开关 ── */
  $("#btnSidebar").addEventListener("click", () => sidebar.classList.toggle("collapsed"));
  $("#btnPanel").addEventListener("click", () => panel.classList.toggle("hidden"));
  $("#btnPanelX").addEventListener("click", () => panel.classList.add("hidden"));

  function autoLayout() {
    const w = window.innerWidth;
    sidebar.classList.toggle("collapsed", w < 1040);
    panel.classList.toggle("hidden", w < 880 ? true : panel.classList.contains("hidden"));
  }
  window.addEventListener("resize", autoLayout);
  autoLayout();

  /* ── 面板 Tab ── */
  $$(".pn-tabs [data-ptab]").forEach(btn => btn.addEventListener("click", () => {
    $$(".pn-tabs [data-ptab]").forEach(b => b.classList.toggle("active", b === btn));
    $$(".pn-page").forEach(p => p.classList.toggle("active", p.dataset.ptab === btn.dataset.ptab));
  }));

  /* ── 弹层机制 ── */
  const scrim = $("#scrim");
  function closePops() { $$(".popover.open").forEach(p => p.classList.remove("open")); scrim.classList.remove("open"); }
  scrim.addEventListener("click", closePops);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePops(); });

  function openPop(pop, anchor, place) {
    const was = pop.classList.contains("open");
    closePops();
    if (was) return;
    const r = anchor.getBoundingClientRect();
    pop.classList.add("open");
    scrim.classList.add("open");
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x, y;
    if (place === "up-left") { x = r.left; y = r.top - ph - 8; }
    else if (place === "up-right") { x = r.right - pw; y = r.top - ph - 8; }
    else if (place === "down-left") { x = r.left; y = r.bottom + 8; }
    else { x = Math.min(r.left, innerWidth - pw - 12); y = r.bottom + 8; }
    x = Math.max(8, Math.min(x, innerWidth - pw - 8));
    y = Math.max(52, Math.min(y, innerHeight - ph - 8));
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }

  $("#userCard").addEventListener("click", e => { e.stopPropagation(); openPop($("#popAccount"), e.currentTarget, "down-left"); });
  $("#btnAttach").addEventListener("click", e => { e.stopPropagation(); openPop($("#popAttach"), e.currentTarget, "up-left"); });
  $("#btnPerm").addEventListener("click", e => { e.stopPropagation(); openPop($("#popPerm"), e.currentTarget, "up-left"); });
  $("#btnEffort").addEventListener("click", e => { e.stopPropagation(); openPop($("#popEffort"), e.currentTarget, "up-right"); });
  $$(".popover").forEach(p => p.addEventListener("click", e => e.stopPropagation()));

  /* ── 权限三态 ── */
  $$("#popPerm .pop-item").forEach(item => item.addEventListener("click", () => {
    $$("#popPerm .pop-item").forEach(i => { i.classList.remove("sel"); $(".tick", i).textContent = ""; });
    item.classList.add("sel"); $(".tick", item).textContent = "✓";
    $("#permLabel").textContent = item.dataset.perm;
    const risk = item.dataset.perm === "完全访问";
    $("#btnPerm").classList.toggle("risk", risk);
    closePops();
  }));

  /* ── 强度滑杆（离散三档） ── */
  const STOPS = { 低: 8, 中: 50, 高: 92 };
  function setEffort(v) {
    const pct = STOPS[v];
    $(".sl-fill").style.width = pct + "%";
    $(".sl-thumb").style.left = pct + "%";
    $$(".sl-stops span").forEach(s => s.classList.toggle("active", s.dataset.v === v));
    $("#effortNow").textContent = v;
    $("#effortLabel").textContent = "自定义 " + v;
  }
  $$(".sl-stops span").forEach(s => s.addEventListener("click", () => setEffort(s.dataset.v)));
  $(".sl-track").addEventListener("click", e => {
    const r = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - r.left) / r.width) * 100;
    let best = "中", d = 1e9;
    for (const k in STOPS) { const dd = Math.abs(STOPS[k] - pct); if (dd < d) { d = dd; best = k; } }
    setEffort(best);
  });

  /* ── 过滤 Tab / 分段控件（通用 .pill-tabs 与 .seg） ── */
  $$(".pill-tabs").forEach(g => $$("button", g).forEach(b => b.addEventListener("click", () => {
    $$("button", g).forEach(x => x.classList.toggle("active", x === b));
  })));
  $$(".seg").forEach(g => $$("button", g).forEach(b => b.addEventListener("click", () => {
    $$("button", g).forEach(x => x.classList.toggle("active", x === b));
  })));
  $$(".set-item").forEach(b => b.addEventListener("click", () => {
    $$(".set-item").forEach(x => x.classList.toggle("active", x === b));
  }));

  /* ── 建议芯片 → 填入输入框 ── */
  $$(".suggest-chips button").forEach(b => b.addEventListener("click", () => {
    $("#inputTa").value = b.dataset.fill;
    $("#inputTa").focus(); autoGrow();
  }));

  /* ── 输入框自适应高度 ── */
  const ta = $("#inputTa");
  function autoGrow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 170) + "px"; }
  ta.addEventListener("input", autoGrow);

  /* ── 发送：模拟一轮流式回复 ── */
  const chatCol = $("#chatCol");
  let running = false;
  function scrollBottom() { const sc = $("#chatScroll"); sc.scrollTop = sc.scrollHeight; }
  function send() {
    const text = ta.value.trim();
    if (!text || running) return;
    $("#chatEmpty").classList.add("hidden");
    $("#chatScroll").classList.add("active");
    const u = document.createElement("div");
    u.className = "msg user"; u.textContent = text;
    chatCol.appendChild(u);
    ta.value = ""; autoGrow();
    running = true;
    const btn = $("#btnSend"); btn.classList.add("stop");
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';
    const tool = document.createElement("div");
    tool.className = "tool-row";
    tool.innerHTML = '<i class="t-dot run"></i><code>agent</code><span class="t-sum">正在思考…</span>';
    chatCol.appendChild(tool); scrollBottom();
    const reply = "收到。我会先读取相关文件定位问题，给出计划后再动手修改，过程中遇到风险操作会向你请求批准。";
    setTimeout(() => {
      tool.remove();
      const m = document.createElement("div");
      m.className = "msg asst"; m.innerHTML = "<p></p>";
      chatCol.appendChild(m);
      const p = $("p", m); let i = 0;
      const timer = setInterval(() => {
        p.textContent = reply.slice(0, ++i);
        scrollBottom();
        if (i >= reply.length) {
          clearInterval(timer);
          running = false; btn.classList.remove("stop");
          btn.innerHTML = '<svg><use href="#i-up"/></svg>';
        }
      }, 28);
    }, 900);
    scrollBottom();
  }
  $("#btnSend").addEventListener("click", send);
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* ── 快捷键（原型提示级） ── */
  document.addEventListener("keydown", e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "b") { e.preventDefault(); sidebar.classList.toggle("collapsed"); }
    if (e.key === "j") { e.preventDefault(); panel.classList.toggle("hidden"); }
    if (e.key === "n") { e.preventDefault(); gotoPage("chat", "new"); }
    if (e.key === ",") { e.preventDefault(); gotoPage("settings"); }
  });
})();
