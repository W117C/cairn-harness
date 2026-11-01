// IME 组字守卫覆盖率（2026-10-30）：**文本输入**里消费 Enter 的路径都必须过 `ime.ts`。
//
// 为什么单列：`ime.ts` 头注释写的是「所有会消费 Enter 的键盘路径共用一条判定」，但此前
// 只有 Composer 的发送/菜单接了；项目/会话改名、设置数字框、搜索框、旁路提问、评注编辑器
// 都能在拼音组字途中被 Enter 提前提交——用户正在写的字被系统当成「确认」。本棘轮逐条钉住。
// 非文本入口（按钮 / listbox 行激活）不在本表：它们没有组字态。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const GUARDED: readonly (readonly [string, string])[] = [
  // 新建项目 / 项目设置：回车提交
  ["../src/renderer/components/NewProjectDialog.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); submit(); }'],
  ["../src/renderer/components/Sidebar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); submit(); }'],
  // 会话改名（行内 F2）/ 项目显示名行内改名 / 会话搜索
  ["../src/renderer/components/Sidebar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); props.onRenameCommit(); }'],
  ["../src/renderer/components/Sidebar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) {\n                          e.preventDefault();\n                          const v = renamingProject.value.trim();'],
  ["../src/renderer/components/Sidebar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) {\n                const first = visibleActive[0]'],
  // 设置数字框 / 更新源：回车 = blur（走既有校验）
  ["../src/renderer/components/settings-sections.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); }'],
  // 设置导航搜索：回车选第一个分区
  ["../src/renderer/components/SettingsPanel.tsx", 'if ((e.key === "Enter" && !isCompositionEnter(e, null)) || e.key === "ArrowDown")'],
  // 会话内查找
  ["../src/renderer/components/FindBar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null))'],
  // 旁路提问（Enter 发送）
  ["../src/renderer/components/SidechatPane.tsx", '!isCompositionEnter(e, null)'],
  // 顶栏会话改名
  ["../src/renderer/panes/AppToolbar.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null))'],
  // 差异评注（⌘Enter 提交）
  ["../src/renderer/components/DiffView.tsx", '!isCompositionEnter(e, null) && (e.metaKey || e.ctrlKey)'],
  // 浏览器地址栏
  ["../src/renderer/components/PaneDock.tsx", 'if (e.key === "Enter" && !isCompositionEnter(e, null)) go('],
  // 既有的两处（Composer / ModelPicker）继续在场，防回退
  ["../src/renderer/components/ModelPicker.tsx", "if (isCompositionEnter(e, null) || modelsDisabled) return;"],
  ["../src/renderer/components/Composer.tsx", 'if (e.key === "Enter" && isCompositionEnter(e, composing)) return;'],
];

describe("IME：文本输入消费 Enter 前必须过 isCompositionEnter", () => {
  it.each(GUARDED)("%s 含守卫锚点", (file, needle) => {
    expect(read(file), `${file} 缺：${needle.slice(0, 60)}…`).toContain(needle);
  });

  it("本仓的组字判定只有一处实现（ime.ts），消费方不另写 nativeEvent.isComposing 副本", () => {
    const offenders = [
      "../src/renderer/components/NewProjectDialog.tsx",
      "../src/renderer/components/Sidebar.tsx",
      "../src/renderer/components/settings-sections.tsx",
      "../src/renderer/components/FindBar.tsx",
      "../src/renderer/components/SidechatPane.tsx",
      "../src/renderer/panes/AppToolbar.tsx",
      "../src/renderer/components/DiffView.tsx",
      "../src/renderer/components/PaneDock.tsx",
    ].filter((file) => read(file).includes("nativeEvent.isComposing"));
    expect(offenders).toEqual([]);
  });
});
