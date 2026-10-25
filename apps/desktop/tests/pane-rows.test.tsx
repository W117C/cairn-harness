// 窗格行高记忆判卷（批 98）：存储解码、新窗格保底借位、关开记忆、PaneDock 接线。
// 口径：行高按 kind 记（重排不串格）；坏数据不编尺寸；用户拖动才回写（程序性 setLayout 不回写）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MIN_PANE_PCT,
  decodePaneRows,
  loadPaneRows,
  mergePaneRows,
  paneRowLayout,
} from "../src/renderer/pane-layout";
import { PaneDock } from "../src/renderer/components/PaneDock";

const paneDock = readFileSync(
  fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)),
  "utf8",
);

const sum = (rows: Record<string, number>) => Object.values(rows).reduce((a, b) => a + b, 0);

describe("decodePaneRows：坏存储不编尺寸", () => {
  it("null / 坏 JSON / 数组 / 字符串 / 非正 / 非有限一律丢", () => {
    expect(decodePaneRows(null)).toEqual({});
    expect(decodePaneRows("{oops")).toEqual({});
    expect(decodePaneRows("[]")).toEqual({});
    expect(decodePaneRows('{"changes":"70","tasks":30}')).toEqual({ tasks: 30 });
    expect(decodePaneRows('{"a":0,"b":-5,"c":null}')).toEqual({});
    expect(decodePaneRows('{"a":1e999}')).toEqual({});
  });

  it("合法值保留；超过 100 的脏值按 100 收（不小于保底由布局函数兜）", () => {
    expect(decodePaneRows('{"changes":70,"tasks":30}')).toEqual({ changes: 70, tasks: 30 });
    expect(decodePaneRows('{"x":180}')).toEqual({ x: 100 });
  });

  it("SSR（无 window）读回空表而不是抛", () => {
    expect(() => loadPaneRows()).not.toThrow();
    expect(loadPaneRows()).toEqual({});
  });
});

describe("paneRowLayout：完整表 + 保底借位", () => {
  it("空窗格集 ⇒ 空表；无记忆时均分且和 = 100", () => {
    expect(paneRowLayout([], {})).toEqual({});
    const two = paneRowLayout(["changes", "tasks"], {});
    expect(two).toEqual({ changes: 50, tasks: 50 });
    const three = paneRowLayout(["changes", "plan", "tasks"], {});
    expect(Math.abs(sum(three) - 100)).toBeLessThan(1e-9);
    expect(new Set(Object.values(three)).size).toBe(1);
  });

  it("记下的尺寸原样恢复", () => {
    expect(paneRowLayout(["changes", "tasks"], { changes: 70, tasks: 30 }))
      .toEqual({ changes: 70, tasks: 30 });
  });

  it("新开窗格拿保底，其余按「保底以上的部分」等比让位（比例不丢）", () => {
    const rows = paneRowLayout(["changes", "plan", "tasks"], { changes: 70, tasks: 30 });
    expect(rows.plan).toBeCloseTo(MIN_PANE_PCT, 9);
    expect(rows.changes).toBeCloseTo(62.5, 9);
    expect(rows.tasks).toBeCloseTo(27.5, 9);
    expect(sum(rows)).toBeCloseTo(100, 9);
    // 原有 7:3 的比例仍在（扣掉各自保底后）
    expect((rows.changes! - MIN_PANE_PCT) / (rows.tasks! - MIN_PANE_PCT)).toBeCloseTo(60 / 20, 9);
  });

  it("尺寸和不足 100 时等比放大；低于保底的旧值抬到保底", () => {
    expect(paneRowLayout(["changes"], { changes: 40 })).toEqual({ changes: 100 });
    const low = paneRowLayout(["changes", "tasks"], { changes: 95, tasks: 1 });
    expect(low.tasks).toBeCloseTo(MIN_PANE_PCT, 9);
    expect(low.changes).toBeCloseTo(100 - MIN_PANE_PCT, 9);
  });

  it("重复 kind 去重（不出现两行同名轨道）", () => {
    expect(paneRowLayout(["changes", "changes", "tasks"], {})).toEqual({ changes: 50, tasks: 50 });
  });
});

describe("mergePaneRows：关着的窗格也记得", () => {
  it("只更新当前开着的窗格；旧表里关着的原样保留", () => {
    const merged = mergePaneRows({ changes: 60, tasks: 40 }, { changes: 75, plan: 25 }, ["changes", "plan"]);
    expect(merged).toEqual({ changes: 75, tasks: 40, plan: 25 });
  });

  it("非有限 / 非正的布局值不落盘", () => {
    expect(mergePaneRows({}, { changes: Number.NaN, tasks: 0 }, ["changes", "tasks"])).toEqual({});
  });
});

// 2026-10-24 单窗格模式：Grid 纵向堆叠撤下，行高记忆 helpers 保留为纯函数（本文件上半继续判卷），
// 「PaneDock 接线」改为钉单窗格契约（激活派生 / 新开即露出 / 只显示激活块）。
// 2026-10-25：可见性切换 ≠ 条件渲染——所有已开窗格常驻挂载，切标签不杀终端/浏览器/文件树状态。
describe("PaneDock 接线（单窗格模式）", () => {
  it("激活窗格 = 手动聚焦的那个，否则最新打开的一个（新开即露出）", () => {
    expect(paneDock).toContain("const active = focusedPane !== null && props.tabs.includes(focusedPane)");
    expect(paneDock).toContain("props.tabs[props.tabs.length - 1] ?? null");
  });

  it("新开窗格自动激活；激活窗格被关则回落到最新窗格", () => {
    expect(paneDock).toContain("if (added !== undefined) setFocusedPane(added);");
    expect(paneDock).toContain("else if (focusedPane !== null && !props.tabs.includes(focusedPane)) setFocusedPane(null);");
  });

  it("钩子必须在空窗格早退之前（否则 tabs 清空时 hooks 数量变化会崩）", () => {
    expect(paneDock.indexOf("const [focusedPane, setFocusedPane]"))
      .toBeLessThan(paneDock.indexOf("if (props.tabs.length === 0) {"));
  });

  it("SSR 渲染不因 localStorage 缺席抛错；两块都挂载但只有一块 active", () => {
    const html = renderToStaticMarkup(
      <PaneDock tabs={["changes", "plan"]} events={[]} onClose={() => undefined} />,
    );
    expect((html.match(/data-pane=/g) ?? []).length).toBe(2);
    expect((html.match(/data-active="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/data-pane="plan" data-active="true"/);
  });
});

describe("TokenPanel 死组件清理", () => {
  it("用量环组件改从 format-tokens 取纯函数；TokenPanel.tsx 已删", () => {
    const composer = readFileSync(
      fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)),
      "utf8",
    );
    const meter = readFileSync(
      fileURLToPath(new URL("../src/renderer/components/UsageMeter.tsx", import.meta.url)),
      "utf8",
    );
    expect(meter).toContain('import { formatTokens } from "./format-tokens";');
    expect(composer).not.toContain("./TokenPanel");
    expect(() => readFileSync(
      fileURLToPath(new URL("../src/renderer/components/TokenPanel.tsx", import.meta.url)),
      "utf8",
    )).toThrow();
  });
});
