import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
// renderEvent 第一句问的是这条判据（projections 导出的同一个实现，测试不另写一份）；
// 工具行摘要政策与「定时跳过原因」的文案表也从同一处取绑——app.js 里那些本地副本已搬进 projections
// （两份早晚会分叉，切片跑的是脚本不是模块，绑定只能从 context 给）。
import { entersMainConversation, skipReasonLabel, toolArgsSummary } from "./renderer-vm-module";
// 单元成对不变量要用** shipped 的**分组器（不是复刻），注册表类型名从 event-registry 读（不抄清单）。
import { projectUnits } from "../src/renderer/history-window.js";
import { knownTypes } from "./event-registry";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
const historySource = readFileSync(new URL("../src/renderer/history-window.js", import.meta.url), "utf8");

function section(start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

type FakeNode = {
  tag: string;
  className: string;
  textContent: string;
  children: FakeNode[];
  parentNode: FakeNode | null;
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  classList: {
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string, on?: boolean) => void;
    contains: (name: string) => boolean;
  };
  hidden?: boolean;
  disabled?: boolean;
  open?: boolean;
  append: (...nodes: FakeNode[]) => void;
  appendChild: (node: FakeNode) => FakeNode;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  insertAdjacentHTML: (pos: string, html: string) => void;
  querySelector: (sel: string) => FakeNode | null;
  querySelectorAll: (sel: string) => FakeNode[];
  closest: (sel: string) => FakeNode | null;
  innerHTML: string;
};

const tokensOf = (className: string) => (className || "").split(/\s+/).filter(Boolean);
const hasClass = (n: FakeNode, want: string) => tokensOf(n.className).includes(want);

function fakeEl(tag: string): FakeNode {
  const node: FakeNode = {
    tag, className: "", textContent: "", children: [], parentNode: null, attrs: {}, dataset: {}, style: {},
    append(...nodes: FakeNode[]) { for (const n of nodes) { n.parentNode = node; node.children.push(n); } },
    appendChild(child: FakeNode) { child.parentNode = node; node.children.push(child); return child; },
    remove() {
      const at = node.parentNode ? node.parentNode.children.indexOf(node) : -1;
      if (at >= 0) node.parentNode!.children.splice(at, 1);
      node.parentNode = null;
    },
    setAttribute(name: string, value: string) { node.attrs[name] = value; },
    removeAttribute(name: string) { delete node.attrs[name]; },
    // classList 是 className 的另一个面：渲染器用 add/remove/contains 改收起态与失败态，
    // 缺这一面时「建壳后再动 class」的三支（tool_call / verify_result / assistant_message）会在 fake 上撞死。
    classList: {
      add(...names: string[]) { node.className = [...new Set([...tokensOf(node.className), ...names])].join(" "); },
      remove(...names: string[]) { node.className = tokensOf(node.className).filter((c) => !names.includes(c)).join(" "); },
      toggle(name: string, on?: boolean) {
        const at = tokensOf(node.className).includes(name);
        if (on === false || (on === undefined && at)) this.remove(name);
        else this.add(name);
      },
      contains: (name: string) => tokensOf(node.className).includes(name),
    },
    // 静态 chevron 的插入点：测试不解析 HTML，占位即可（断言只认 textContent 通道）
    insertAdjacentHTML() {},
    // 只按 class 查——够覆盖渲染器用到的 .msg-body 一类查询；不解析 HTML，故无注入面可测漏。
    querySelector(sel: string) {
      const want = sel.replace(/^\./, "");
      const walk: FakeNode[] = [];
      flatten(node, walk);
      return walk.find((n) => n !== node && hasClass(n, want)) ?? null;
    },
    querySelectorAll(sel: string) {
      const want = sel.replace(/^\./, "");
      const walk: FakeNode[] = [];
      flatten(node, walk);
      return walk.filter((n) => n !== node && hasClass(n, want));
    },
    closest(sel: string) {
      const want = sel.replace(/^\./, "");
      for (let cur: FakeNode | null = node; cur; cur = cur.parentNode) if (hasClass(cur, want)) return cur;
      return null;
    },
    innerHTML: "",
  };
  /* 渲染器有三支是先建壳、再 `x.innerHTML = '<…class="ti-head">…'` 填内容，然后**回头查自己刚写的类名**
     （tool_call 取 .tg-body、tool_result 取 .ti-state/.ti-out、plan/澄清卡撤 .plan-acts）。
     本 fake 不解析 HTML——但「壳在不在」这条判据要能走到那三支，所以把串里出现过的 class 名各造一个
     占位子节点。层级与文本一律不仿：那些是 panels-check 真窗口判的事，在这里造假反而会把「真窗才有的
     差别」照成绿。 */
  let htmlStore = "";
  Object.defineProperty(node, "innerHTML", {
    configurable: true,
    get: () => htmlStore,
    set: (html: string) => {
      htmlStore = String(html);
      node.attrs.innerHTML = htmlStore;
      for (const m of String(html).matchAll(/class="([^"]+)"/g)) {
        for (const cls of m[1]!.split(/\s+/).filter(Boolean)) {
          const holder = fakeEl("div");
          holder.className = cls;
          holder.parentNode = node;
          node.children.push(holder);
        }
      }
    },
  });
  return node;
}

/** 把 createElement 建出来的子树摊平成 {tag, text, role} 序列——断言只认渲染结果，不认实现细节。 */
function flatten(node: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(node);
  node.children.forEach((child) => flatten(child, out));
  return out;
}

function textOf(nodes: FakeNode[]): string {
  return nodes.map((n) => n.textContent).filter(Boolean).join("\n");
}

/**
 * 抽出运行控制段 + 重放行渲染器，并追加真实块（window.agent 在场）里那两行接线的**等价复刻**。
 * 真实块是否真的这么接，由「真实块接线」那条源码断言负责——两层合起来才完整。
 */
function boot(options: { running?: boolean } = {}) {
  const classes: string[] = [];
  const button = {
    listeners: [] as (() => void)[],
    attrs: {} as Record<string, string>,
    title: "",
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    addEventListener(_type: string, fn: () => void) { this.listeners.push(fn); },
    classList: {
      toggle(name: string, on: boolean) {
        const at = classes.indexOf(name);
        if (on && at < 0) classes.push(name);
        if (!on && at >= 0) classes.splice(at, 1);
      },
    },
  };
  const calls: string[] = [];
  const context: Record<string, unknown> = {
    $: (sel: string) => (sel === "#sendBtn" ? button : null),
    document: { createElement: fakeEl },
    send: () => { calls.push("send-v1"); },
    esc: (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    requestAnimationFrame: (fn: () => void) => fn(),
    real: { running: options.running === true },
    // DT-02：切片区间含 syncRunButton，而它现在顺带同步标题栏上下文；
    // syncTitlebar 读 panelData.workspace —— 声明为桩，与既有的 $ / real 同一处置。
    panelData: { workspace: null },
    calls,
  };
  const wiring = "\nrunControl.isRunning = () => real.running === true;" +
    "\nrunControl.cancel = () => { calls.push('cancel'); };";
  runInNewContext(
    section("const runControl = {", "promptInput.addEventListener('keydown'") + wiring,
    context,
  );
  return {
    context,
    classes,
    calls,
    button,
    setRunning(on: boolean) { (context.real as { running: boolean }).running = on; },
    click() { button.listeners.forEach((fn) => fn()); },
    errorCardNode: context.errorCardNode as (message: string) => FakeNode,
    syncRunButton: context.syncRunButton as () => void,
  };
}

/**
 * R1b B1 后的单一渲染器：live 与 replay 跑同一条 renderEvent。
 * 本 boot 把「单一渲染器上下文 + 工具/卡片 + renderEvent」三段拼进同一个 VM 脚本，
 * 于是可以分别以 live / replay 两种 rc 驱动它，并逐字比对产出。
 */
function bootRenderer(events: Record<string, unknown>[]) {
  const streamInner = fakeEl("div");
  const consoleErrors: string[] = [];
  const context: Record<string, unknown> = {
    document: { createElement: fakeEl },
    streamInner,
    historyEvents: events,
    // buildUnit 渲染不出壳时出声（B25 收的就是这句）。这里必须把声道接住：
    // 没有 console 的 vm 里那句 console.error 会抛 ReferenceError，判据就从「出声」变成「崩掉」。
    console: { error: (...a: unknown[]) => consoleErrors.push(a.map(String).join(" ")), log: () => {}, warn: () => {} },
    real: { running: false, usageIn: 0, usageOut: 0, events: 0, runStart: 0, askCards: new Map() },
    esc: (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    actionsHTML: () => "",
    nowTime: () => "00:00",
    runGrid: () => "",
    observeMsg: () => {},
    scrollStream: () => {},
    toast: () => {},
    syncStatusbar: () => {},
    highlightAllDiffs: () => {},
    finalizePending: () => {},
    entersMainConversation,
    toolArgsSummary,
    skipReasonLabel,
    // 切片里含顶层的 #sendBtn 绑定语句，需要一个可绑定的壳
    $: (sel: string) => (sel === "#sendBtn"
      ? { addEventListener() {}, setAttribute() {}, title: "", classList: { toggle() {} } }
      : null),
    api: {},
  };
  runInNewContext(
    section("const runControl = {", "promptInput.addEventListener('keydown'") + "\n" +
    section("  function clearTranscript()", "  /* ---------- 会话列表 ---------- */") + "\n" +
    // 消息流构造 + 底栏同步：appendUser/ensureAi/finalizeAi/finalizePending 都住在这里，
    // 「每种型都要有壳」要跑 user_message 与 assistant_* 就绕不过这一段（整段只有声明，无顶层副作用）。
    section("  /* ---------- 消息流构造", "  /* ---------- 工具 / 卡片 ---------- */") + "\n" +
    section("  /* ---------- 工具 / 卡片 ---------- */", "  /* ---------- 审批（"),
    context,
  );
  return {
    context,
    streamInner,
    consoleErrors,
    /** live：直接喂 renderEvent，产出挂进 streamInner。 */
    renderLive(index: number) { (context.renderEvent as (e: unknown) => void)(events[index]); return streamInner.children.at(-1) as FakeNode; },
    /** replay：走 buildUnit（重放路径），产出单个 .msg。 */
    renderReplay(index: number) { return (context.buildUnit as (u: unknown) => FakeNode)({ key: "main|card", kind: "card", ids: [index] }); },
    /** 照 production 那样把 projectUnits 给出的单元原样交给 buildUnit（返回 null = 这一格产不出壳）。 */
    buildUnit(unit: { key: string; kind: string; ids: number[] }) {
      return (context.buildUnit as (u: unknown) => FakeNode | null)(unit);
    },
  };
}

describe("运行控制一键两用（P0：停止键 + 按值捕获的旧 send）", () => {
  it("空闲时点击走发送，不触发取消", () => {
    const { click, calls } = boot({ running: false });
    click();
    expect(calls).toEqual(["send-v1"]);
  });

  it("运行中点击走取消，不再发送", () => {
    const { click, calls } = boot({ running: true });
    click();
    expect(calls).toEqual(["cancel"]);
  });

  it("点击必须按调用时解析 send——重赋值后点到的是新实现（此前按值捕获演示版）", () => {
    const { context, click, calls } = boot({ running: false });
    context.send = () => { calls.push("send-v2"); };
    click();
    expect(calls).toEqual(["send-v2"]);
  });

  it("按钮形状标记与可访问名跟随运行态切换", () => {
    const { classes, setRunning, syncRunButton, button } = boot({ running: true });
    syncRunButton();
    expect(classes).toContain("stop");
    expect(button.attrs["aria-label"]).toBe("停止");

    setRunning(false);
    syncRunButton();
    expect(classes).not.toContain("stop");
    expect(button.attrs["aria-label"]).toBe("发送");
  });

  it("真实块把 isRunning/cancel 接到 real.running 与 runCancel，且整轮结束后复位运行态", () => {
    expect(source).toMatch(/runControl\.isRunning = \(\) => real\.running === true;/);
    expect(source).toMatch(/runControl\.cancel = [^\n]*runCancel[^\n]*;/);
    // api.run 在整轮跑完才 resolve：成功路径必须复位，否则发送/切会话/新建被永久挡死。
    const block = section("  send = async function ()", "  selectSession = async function");
    expect(block).toMatch(/finally\s*\{[\s\S]*?real\.running = false;[\s\S]*?syncRunButton\(\);/);
  });
});

describe("失败可见性（P0）· R1b B1 后是单一渲染器", () => {
  it("失败卡走纯 DOM 构造：原因原文只进 textContent，不产生任何元素节点", () => {
    const { errorCardNode } = boot();
    const flat = flatten(errorCardNode('<img src=x onerror="alert(1)">'));
    expect(textOf(flat)).toContain('<img src=x onerror="alert(1)">');
    // 注入面的判据不是「有没有 esc 过」，而是「有没有把文本交给 HTML 解析」——这里零子节点来自字符串。
    expect(flat.filter((n) => n.tag === "img")).toHaveLength(0);
  });

  it("恰好一个恢复动作，并带 role=alert 让读屏播报", () => {
    const { errorCardNode } = boot();
    const flat = flatten(errorCardNode("429 insufficient quota"));
    const card = flat[0];
    expect(card.attrs["role"]).toBe("alert");
    expect(textOf(flat)).toContain("429 insufficient quota");
    expect(flat.filter((n) => (n.className || "").split(/\s+/).includes("err-hint"))).toHaveLength(1);
  });

  it("renderEvent 有 error 分支——事件不被静默丢弃", () => {
    expect(source).toMatch(/case ['"]error['"]:/);
  });

  it("同一 error 事件：live 与 replay 产出逐字相等（两套渲染器时这条必红）", () => {
    const r = bootRenderer([{ type: "error", message: "connect ETIMEDOUT api.example.com", step: 2 }]);
    const live = flatten(r.renderLive(0));
    const replay = flatten(r.renderReplay(0));
    expect(textOf(replay)).toBe(textOf(live));
    expect(textOf(replay)).toContain("connect ETIMEDOUT api.example.com");
    expect(textOf(replay)).toContain("重新发送一次即可重试");
    // 重放壳仍带 data-history（panels-check 的虚拟化钩子），且不走 <details> 桩。
    expect(replay[0].dataset["history"]).toBe("");
    expect(replay.some((n) => n.tag === "details")).toBe(false);
  });

  it("15 类零渲染器事件在两条路都落一张记录卡，不再是「查看记录」桩", () => {
    const r = bootRenderer([{ type: "agent_status", agent_id: "w-rev", status: "failed", reason: "max_turns" }]);
    const live = flatten(r.renderLive(0));
    const replay = flatten(r.renderReplay(0));
    expect(textOf(replay)).toBe(textOf(live));
    expect(textOf(live)).toContain("worker 状态");
    expect(textOf(live)).toContain("w-rev");
    expect(textOf(live)).not.toContain("查看记录");
  });

  it("第二套渲染器不得回流：桩渲染器与旧分组函数都已不存在", () => {
    // 判据打在「定义」上，不是「提及」——注释里回顾历史是允许的。
    expect(source).not.toMatch(/function renderHistoryRow\s*\(/);
    expect(source).not.toMatch(/function projectHistory\s*\(/);
    expect(historySource).not.toMatch(/function projectHistory\s*\(/);
    expect(source).not.toMatch(/renderRow:/);
  });
});

/* ---------------- 单元成对不变量：分组器给出的每一格都必须有壳 ----------------
   起因（#31，2026-09-22）：一条找不到可并入调用的 tool_result 直接 break——事实从转录里无声
   消失，且那一格连一个 .msg 壳都不产。修完这一型后剩下的问题不是「这一型」而是「这一族」：
   虚拟化现在会**跳过**产不出壳的单元（一格不再拖死整窗），于是「跳过」成了新的高度静默——
   只有真窗口的 B25 收得到那句 console.error。这张闸是它的离线 counterpart，判的是 shipped 的
   那一对（projectUnits → buildUnit）互相同不同意，不是某个类型的某条分支：
     · 分组器把某型成一格，渲染器却交不出壳 ⇒ 那一格永不上屏且没人红；
     · 分组器把某型整型丢掉 ⇒ 事件落了盘、进了上下文，界面永远看不见它。
   样例表按注册表逐型覆盖（缺一条即红），所以「加一个新事件型忘了管界面」这件事第一次有了
   不需要人记得去加的门槛。为什么不写成源码形状断言：plan_approved 的 `if (tag) { …; break; }`
   是**正当**的提前退出（另一支有卡），只有跑起来才分得清它和 tool_result 那一支的差别。 */
describe("单元成对不变量（projectUnits ↔ buildUnit）", () => {
  const known = knownTypes();

  /** 每种事件型一条样例：字段照 interface 写实（走得到该型的渲染分支即可，不追求完整 payload）。 */
  const SAMPLES: Record<string, Record<string, unknown>> = {
    user_message: { type: "user_message", content: "把登录改成短信码" },
    assistant_message: { type: "assistant_message", content: "先看现有的鉴权中间件。" },
    assistant_delta: { type: "assistant_delta", text: "先看" },
    tool_call: { type: "tool_call", callId: "c1", name: "read_file", args: { path: "src/auth.ts" } },
    // 孤儿结果（没有对应的 tool_call）故意作为样例：#31 那一格就是这个形状。
    tool_result: { type: "tool_result", callId: "c-never-opened", ok: false, output: "boom" },
    usage: { type: "usage", inputTokens: 7, outputTokens: 3 },
    session_meta: { type: "session_meta", branch_of: "main" },
    clarify_requested: {
      type: "clarify_requested", callId: "c2",
      questions: [{ question: "要哪种码？", options: [{ label: "6 位数字" }, { label: "字母+数字" }] }],
    },
    plan_proposed: {
      type: "plan_proposed", plan: { goal: "换掉密码校验", files: [{ action: "modify", path: "src/auth.ts" }] },
    },
    plan_approved: { type: "plan_approved", approved: true },
    verify_result: {
      type: "verify_result", callId: "c3", auto: true, ok: false, attempt: 1, maxAttempts: 3,
      results: [{ command: "pnpm test", ok: false, output: "1 failed" }],
    },
    compaction: {
      type: "compaction", trigger: "auto", reason: "threshold", compressed_event_ids: [1, 2],
      summary: "已归纳", summary_offset: 3, tokens_before: 90000, tokens_after: 12000,
    },
    security_report: {
      type: "security_report", mode: "report", findings: [], changeSet: [],
      summary: { total: 0 }, scannedAt: "2026-09-22T00:00:00.000Z",
    },
    impact_report: { type: "impact_report", file: "src/auth.ts", symbols: ["checkCode"], up: [{ symbol: "checkCode", file: "src/login.ts", line: 42 }], truncated: false },
    agent_spawned: {
      type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "worker", task: "改鉴权",
      max_turns: 20, permission_mode: "standard",
    },
    agent_status: { type: "agent_status", agent_id: "w1", status: "running" },
    agent_message: { type: "agent_message", agent_id: "w1", kind: "progress", text: "读完三个文件" },
    agent_result: {
      type: "agent_result", agent_id: "w1", status: "done", summary: "改完了",
      artifacts: {}, usage: { inputTokens: 100, outputTokens: 20 }, tool_stats: {},
    },
    approval_requested: { type: "approval_requested", id: "a1", tool: "run_shell", args_digest: "sha:1", risk: "high" },
    approval_resolved: { type: "approval_resolved", id: "a1", decision: "approved", scope: "once" },
    card_action: { type: "card_action", card_id: "k1", source_event_id: 2, card_type: "plan", action: "approve" },
    diff_comment: { type: "diff_comment", agent_id: "w1", path: "src/auth.ts", line: 12, body: "这里漏了过期判断" },
    routing_decision: { type: "routing_decision", stage: "worker", candidates: [{ id: "pro" }], picked: "pro", reason: "tier-default" },
    automation_triggered: { type: "automation_triggered", automation_id: "t1", task_name: "夜跑测试", occurrence_key: "2026-09-22T03:00", due_at: "2026-09-22T03:00:00.000Z" },
    automation_skipped: { type: "automation_skipped", automation_id: "t1", task_name: "夜跑测试", occurrence_key: "2026-09-22T03:00", due_at: "2026-09-22T03:00:00.000Z", reason: "workspace busy" },
    automation_completed: {
      type: "automation_completed", automation_id: "t1", task_name: "夜跑测试", occurrence_key: "2026-09-22T03:00",
      session_id: "s1", status: "succeeded", summary: "全绿", usage: { inputTokens: 10, outputTokens: 2 }, tool_stats: {},
    },
    goal_set: { type: "goal_set", objective: "把门禁跑齐", max_turns: 30, max_usd: 5 },
    goal_stopped: { type: "goal_stopped", reason: "budget", turn: 12, evidence: { verified: false } },
    turn_truncated: { type: "turn_truncated", callId: "c4", outcome: "length", stop_reason: "max_tokens", output_tokens: 4096 },
    error: { type: "error", message: "connect ETIMEDOUT", step: 2 },
  };

  it("样例表与注册表同集合（新类型漏一条就红，不靠人记得补）", () => {
    expect(known.length).toBeGreaterThan(20); // 注册表解析塌成空集时下面两条会同时假绿
    expect(Object.keys(SAMPLES).filter((t) => !known.includes(t))).toEqual([]);
    expect(known.filter((t) => !Object.prototype.hasOwnProperty.call(SAMPLES, t))).toEqual([]);
  });

  it("每种型单独进流：成了单元就必须有壳，没成单元只许那两型", () => {
    const dropped: string[] = [];
    let built = 0;
    for (const t of known) {
      const ev = SAMPLES[t] as Record<string, unknown>;
      const units = projectUnits([ev as never]);
      if (units.length === 0) { dropped.push(t); continue; }
      const b = bootRenderer([ev]);
      for (const u of units) {
        const shell = b.buildUnit(u);
        // 空壳 = 虚拟化静默跳过这一格（B25 在真窗口收得到，这里是不等窗口的另一道）。
        expect(shell, `${t} 成了单元却渲染不出 .msg 壳`).not.toBeNull();
        expect((shell?.className || "").split(/\s+/)).toContain("msg");
        built++;
      }
      expect(b.consoleErrors, `${t} 渲染时出过声（buildUnit 只在产不出壳时出声）`).toEqual([]);
    }
    // 静默跳过只许这两型（它们由分组器显式 return，底栏另有记账）。多一型 = 事件落盘却永不上屏。
    expect(dropped.sort()).toEqual(["session_meta", "usage"]);
    // 分母自检：真建了壳的单元数要贴着全表（整批 vacuous 时上面两条会同时假绿）。
    expect(built).toBeGreaterThanOrEqual(known.length - 2);
  });

  it("孤儿 tool_result 与重复投递：两份都要有壳，且原文在卡里", () => {
    const events = [
      { type: "tool_call", callId: "c1", name: "read_file", args: { path: "src/a.ts" } },
      { type: "tool_result", callId: "c1", ok: true, output: "first delivery" },
      { type: "tool_result", callId: "c1", ok: false, output: "second delivery" }, // rc.cards 已删这条
    ];
    const units = projectUnits(events as never[]);
    expect(units.length).toBeGreaterThan(0);
    const b = bootRenderer(events);
    const texts: string[] = [];
    for (const u of units) {
      const shell = b.buildUnit(u);
      // 断言在前、会先抛；下面的 if 只是给 TS 收窄，不是「没壳也放过」。
      expect(shell, "重复投递的第二条结果不许把整格产不出壳").not.toBeNull();
      if (shell) texts.push(textOf(flatten(shell)));
    }
    expect(texts.join("\n")).toContain("second delivery");
    expect(b.consoleErrors).toEqual([]);
  });

  it("一整窗混排：单元数 == 壳数（一格都不许多、也不许少）", () => {
    const events = [
      SAMPLES.user_message, SAMPLES.assistant_message, SAMPLES.tool_call,
      { type: "tool_result", callId: "c1", ok: true, output: "读完了" },
      SAMPLES.verify_result, SAMPLES.compaction, SAMPLES.plan_proposed, SAMPLES.plan_approved,
      SAMPLES.agent_status, SAMPLES.turn_truncated, SAMPLES.error,
    ] as Record<string, unknown>[];
    const units = projectUnits(events as never[]);
    expect(units.length).toBeGreaterThan(4); // 折叠塌成一格时下面这条判据会 vacuously true
    const b = bootRenderer(events);
    let shells = 0;
    for (const u of units) if (b.buildUnit(u)) shells++;
    expect(b.consoleErrors).toEqual([]);
    expect(shells).toBe(units.length);
  });
});
