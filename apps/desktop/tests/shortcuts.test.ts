// 快捷键速查表数据判卷：分组非空、键位不重复、覆盖已实现的关键键（蓝本 §3.6「查看全部」）。
// P3-3 追加：SHORTCUTS 核心表（设置页展示 + tooltip 同源的单一事实源，brief 九节口径）。
import { describe, expect, it } from "vitest";
import { SHORTCUTS, SHORTCUT_GROUPS } from "../src/renderer/shortcuts";
import { PANE_SHORTCUTS } from "../src/renderer/pane-shortcuts";
import { STR } from "../src/renderer/strings";

describe("⌘/ 速查表（§3.6）", () => {
  it("分组与行都非空（不摆空组）", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title).not.toBe("");
      expect(g.rows.length).toBeGreaterThan(0);
    }
  });

  it("键位不重复（同一键不做两件事）", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.keys));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("速查表自指条目在（⌘/ 自己也要能被查到）", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    expect(all.some((r) => r.keys === "⌘/")).toBe(true);
    expect(all.some((r) => r.keys === "⌘W")).toBe(true);
    expect(all.some((r) => r.keys === "Ctrl+O")).toBe(true);
  });

  it("P3-3：新接通的键都已上表（⌘O/⌘K/⌘⌥B/⌘⌥I/⌘./⌘,——只列已实现的键，接了就得在）", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    for (const k of ["⌘O", "⌘K", "⌘⌥B", "⌘⌥I", "⌘.", "⌘,"]) {
      expect(all.some((r) => r.keys === k)).toBe(true);
    }
  });
});

describe("SHORTCUTS 核心表（P3-3 单一事实源 · brief 九节）", () => {
  it("12 项齐：⌘N / ⌘O / ⌘K / ⌘B / ⌘F / ⌘⌥I / ⌘. / ⌘⇧[ ⌘⇧] / ⌘, / ⏎ / ⇧⏎ / ⌘/", () => {
    // 2026-10-18：⌘F 对话内查找进核心表（对照 Claude Edit > Find…；第 513 页）。
    // 2026-10-20：⌘B 开合侧栏进核心表——命令面板的「开合侧栏」曾错指 palette id，
    // 把 ⌘K 当成它的键显示；键位提示必须从本表取，表里没有的 id 不得被引用。
    expect(SHORTCUTS.length).toBe(13);
    const keys = SHORTCUTS.map((s) => s.keys);
    // 2026-11-02：键序以 dispatch 见证为准（`⌘⇧] / ⌘⇧[`），与 SHORTCUT_GROUPS 一致。
    for (const k of ["F2", "⌘N", "⌘O", "⌘K", "⌘B", "⌘F", "⌘⌥I", "⌘.", "⌘⇧] / ⌘⇧[", "⌘,", "⏎", "⇧⏎", "⌘/"]) {
      expect(keys).toContain(k);
    }
  });

  it("keys / id 都唯一；每行 keys 与 label 非空", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(s.keys).not.toBe("");
      expect(s.label).not.toBe("");
    }
  });
});

// 第 1065 页收编：速查表文案全部走 STR 单源。此判卷钉三件事——
// ① 值一字不改（防值漂）；② 每项接对 STR 键（防错接/换行）；③ what 确来自 STR.shortcutTable
// （防裸写回潮；与 strings.test.ts 的 REWORKED 源文扫描互为表里）。
describe("速查表文案走 STR 单源（第 1065 页收编）", () => {
  const core = STR.shortcut as unknown as Record<string, string>;
  // 核心 13 项：id → STR.shortcut 键 → 精确值。
  const CORE: readonly (readonly [string, string, string])[] = [
    ["new-session", "newTask", "新任务"],
    ["open-folder", "openFolder", "打开文件夹"],
    ["palette", "palette", "命令面板"],
    ["sidebar", "sidebar", "开合侧栏"],
    ["find", "find", "对话内查找"],
    ["rename", "rename", "重命名当前会话"],
    ["inspector", "inspector", "检查器"],
    ["stop", "stop", "停止生成"],
    ["cycle-session", "cycleSession", "切换会话"],
    ["settings", "settings", "设置"],
    ["send", "send", "发送"],
    ["newline", "newline", "换行"],
    ["cheat-sheet", "cheatSheet", "完整速查表"],
  ];
  it("核心 label 逐项接 STR.shortcut，值一字不改", () => {
    for (const [id, key, val] of CORE) {
      expect(core[key], `STR.shortcut.${key} 值漂了`).toBe(val);
      expect(SHORTCUTS.find((s) => s.id === id)?.label, `${id} 没接 STR.shortcut.${key}`).toBe(val);
    }
  });

  it("3 组标题接 STR.shortcutTable，值一字不改", () => {
    expect(STR.shortcutTable.session).toBe("会话");
    expect(STR.shortcutTable.pane).toBe("窗格");
    expect(STR.shortcutTable.viewInput).toBe("视图与输入");
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual(["会话", "窗格", "视图与输入"]);
  });

  // 28 条显式 what：keys → 精确值（窗格族 7 条由 PANE_SHORTCUTS 单源生成，不在此钉）。
  const ROWS: Readonly<Record<string, string>> = {
    "⌘N": "新会话（回到主页）",
    "⌘O": "打开文件夹…（登记为新项目）",
    "⌘K": "命令面板（搜索会话/项目/设置/操作）",
    "⌘F": "在对话里查找（⏎ 下一个 / ⇧⏎ 上一个）",
    "⌘G / ⇧⌘G": "查找下一个 / 上一个",
    "⌘W": "关闭当前会话（回主页；窗口不关）",
    F2: "重命名当前会话（点工具栏会话名亦可）",
    "Ctrl+Tab / Ctrl+⇧+Tab": "下一个 / 上一个会话（可在设置里关）",
    "⌘⇧] / ⌘⇧[": "下一个 / 上一个会话",
    "⌘B": "开关侧栏",
    "⌘⌥B": "开合插件侧栏（右侧：插件/技能/命令）",
    "⌘⌥I": "开合检查器（右侧：改动 / 计划 / 时间线）",
    "⌘⌥M": "开合插件侧栏（覆盖式首版）",
    "⌘\\": "关闭最近打开的窗格",
    "⌘⇧S": "浏览器：选择页面元素（结果进输入框）",
    "Ctrl+O": "循环视图：Normal / Thinking / Verbose",
    "⌘⇧I": "模型菜单（含思考档）",
    "⌘⇧M": "权限模式菜单",
    "⌘⇧E": "思考档菜单",
    "⌘⌥F": "专注模式（收起侧栏与检查器；再按退出）",
    "⌘,": "设置",
    "⌘/": "这张速查表",
    "⌘↑ / ⌘↓": "回到对话顶部 / 底部（输入框聚焦时不劫持）",
    Tab: "空输入框想下一条（按上下文，填入不发送）",
    Enter: "发送；运行中 = 排队（不打断）",
    "⌘↩": "运行中 = 入队并打断本轮",
    "⌘.": "停止本轮生成",
    Esc: "先关浮层；决策卡在场时让路；无浮层停止本轮",
  };
  it("28 条显式 what 值一字不改、都来自 STR.shortcutTable（防值漂＋防错接＋防裸写）", () => {
    const tableValues = Object.values(STR.shortcutTable);
    const paneKeys = new Set(PANE_SHORTCUTS.map((s) => s.keys));
    const seen = new Set<string>();
    for (const g of SHORTCUT_GROUPS) {
      for (const r of g.rows) {
        if (paneKeys.has(r.keys)) continue; // 窗格族由 PANE_SHORTCUTS 单源生成
        const val = ROWS[r.keys];
        expect(val, `速查表多了未登记的键 ${r.keys}`).toBeDefined();
        expect(r.what, `${r.keys} 的 what 值漂了`).toBe(val);
        expect(tableValues, `${r.keys} 的 what 没走 STR.shortcutTable`).toContain(r.what);
        seen.add(r.keys);
      }
    }
    // 反向：登记的 28 键都在表里（防删行）。
    for (const k of Object.keys(ROWS)) expect(seen.has(k), `速查表少了 ${k}`).toBe(true);
  });
});
