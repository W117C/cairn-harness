// ⌘\ 「关闭最近打开的窗格」判卷（2026-10-18 修）。
//
// 旧实现 `setPaneTabs((tabs) => tabs.slice(0, -1))` 有两个真缺陷：
//   ① 数组尾项 ≠ 最近打开。paneTabs 的顺序是**渲染顺序**，会被拖标题栏换位（movePane）
//      与 ⌥↑/⌥↓ 键盘换位改掉——重排之后 slice(0,-1) 关掉的就不是文档承诺的那个。
//      速查表写的是「关闭最近打开的窗格」（shortcuts.ts:36）。
//   ② 空数组时 slice(0,-1) 仍是空数组，而按键分支已经 preventDefault ⇒ 按了没反应，
//      键还被吞掉不外传。
// 修法：另记一条只增不减的打开顺序 paneOpenOrder，关的时候从后往前找第一个仍在场的；
//       没有可关的返回 false，让快捷键别 preventDefault。
import { describe, expect, it } from "vitest";
import { lastOpenedPane, movePane } from "../src/renderer/components/panes";

describe("lastOpenedPane（⌘\ 关哪一个）", () => {
  it("空窗格集 ⇒ null（调用方据此不吞键）", () => {
    expect(lastOpenedPane([])).toBeNull();
    expect(lastOpenedPane([], ["browser", "terminal"])).toBeNull();
  });

  it("无打开顺序记录时退化为数组尾（旧行为的合理猜测）", () => {
    expect(lastOpenedPane(["terminal", "browser"])).toBe("browser");
    expect(lastOpenedPane(["terminal"], [])).toBe("terminal");
  });

  it("按打开顺序取最后一个仍在场的（核心修复）", () => {
    // 开：terminal → browser → file；然后手动把 file 关掉
    expect(lastOpenedPane(["terminal", "browser"], ["terminal", "browser", "file"])).toBe("browser");
    // 再关 browser ⇒ 该回到 terminal
    expect(lastOpenedPane(["terminal"], ["terminal", "browser", "file"])).toBe("terminal");
  });

  it("数组被重排后仍按打开顺序（这正是旧实现错的地方）", () => {
    const opened: Array<"terminal" | "browser" | "file"> = ["terminal", "browser", "file"];
    // 用户把 file 拖到最上面：渲染顺序变成 file, terminal, browser
    const reordered = movePane(["terminal", "browser", "file"], 2, 0);
    expect(reordered).toEqual(["file", "terminal", "browser"]);
    // 旧实现 slice(0,-1) 会关 browser（数组尾）；正确该关 file（最后打开的那个）
    expect(lastOpenedPane(reordered, opened)).toBe("file");
    expect(reordered[reordered.length - 1]).toBe("browser"); // 证明两者确实不同
  });

  it("打开顺序里全部已不在场 ⇒ 退化为数组尾（不留死键）", () => {
    expect(lastOpenedPane(["terminal"], ["browser", "file"])).toBe("terminal");
  });

  it("已关掉的窗格不会卡在顺序里被反复选中", () => {
    // browser 开过又关了；顺序仍是 [terminal, browser]，但 browser 已不在场
    expect(lastOpenedPane(["terminal"], ["terminal", "browser"])).toBe("terminal");
  });
});

describe("movePane 与打开顺序互不干扰", () => {
  it("重排只改渲染数组，不动打开顺序", () => {
    const render = ["terminal", "browser", "file"];
    const order = [...render];
    const moved = movePane(render, 0, 2);
    expect(moved).toEqual(["browser", "file", "terminal"]);
    expect(order).toEqual(["terminal", "browser", "file"]);
    expect(lastOpenedPane(moved, order)).toBe("file");
  });

  it("movePane 越界/同位原样返回（不抛）", () => {
    const items = ["a", "b"] as const;
    expect(movePane(items, 0, 0)).toEqual(["a", "b"]);
    expect(movePane(items, -1, 0)).toEqual(["a", "b"]);
    expect(movePane(items, 0, 5)).toEqual(["a", "b"]);
  });
});
