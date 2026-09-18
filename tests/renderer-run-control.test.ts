import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

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
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  open?: boolean;
  append: (...nodes: FakeNode[]) => void;
  appendChild: (node: FakeNode) => FakeNode;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  querySelector: (sel: string) => FakeNode | null;
  querySelectorAll: (sel: string) => FakeNode[];
};

function fakeEl(tag: string): FakeNode {
  const node: FakeNode = {
    tag, className: "", textContent: "", children: [], attrs: {}, dataset: {}, style: {},
    append(...nodes: FakeNode[]) { node.children.push(...nodes); },
    appendChild(child: FakeNode) { node.children.push(child); return child; },
    setAttribute(name: string, value: string) { node.attrs[name] = value; },
    removeAttribute(name: string) { delete node.attrs[name]; },
    // 只按 class 查——够覆盖渲染器用到的 .msg-body 一类查询；不解析 HTML，故无注入面可测漏。
    querySelector(sel: string) {
      const want = sel.replace(/^\./, "");
      const walk: FakeNode[] = [];
      flatten(node, walk);
      return walk.find((n) => n !== node && (n.className || "").split(/\s+/).includes(want)) ?? null;
    },
    querySelectorAll(sel: string) {
      const want = sel.replace(/^\./, "");
      const walk: FakeNode[] = [];
      flatten(node, walk);
      return walk.filter((n) => n !== node && (n.className || "").split(/\s+/).includes(want));
    },
  };
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
  const context: Record<string, unknown> = {
    document: { createElement: fakeEl },
    streamInner,
    historyEvents: events,
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
    // 切片里含顶层的 #sendBtn 绑定语句，需要一个可绑定的壳
    $: (sel: string) => (sel === "#sendBtn"
      ? { addEventListener() {}, setAttribute() {}, title: "", classList: { toggle() {} } }
      : null),
    api: {},
  };
  runInNewContext(
    section("const runControl = {", "promptInput.addEventListener('keydown'") + "\n" +
    section("  function clearTranscript()", "  /* ---------- 会话列表 ---------- */") + "\n" +
    section("  /* ---------- 工具 / 卡片 ---------- */", "  /* ---------- 审批（"),
    context,
  );
  return {
    context,
    streamInner,
    /** live：直接喂 renderEvent，产出挂进 streamInner。 */
    renderLive(index: number) { (context.renderEvent as (e: unknown) => void)(events[index]); return streamInner.children.at(-1) as FakeNode; },
    /** replay：走 buildUnit（重放路径），产出单个 .msg。 */
    renderReplay(index: number) { return (context.buildUnit as (u: unknown) => FakeNode)({ key: "main|card", kind: "card", ids: [index] }); },
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
