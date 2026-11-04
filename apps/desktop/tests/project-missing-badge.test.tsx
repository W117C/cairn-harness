// 侧栏「目录失联」判卷（2026-10-30 · 第 802 页）：
// 已登记但目录不在场时，侧栏先于点击标出事实（不是等用户点出一个「未注册」）。
// 健康项目不摆标记；标记走 risk token 且带解释性 title。
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sidebar, type SidebarProps } from "../src/renderer/components/Sidebar";

const noop = (): void => undefined;
const base = {
  id: "p1", name: "Moved", path: "/tmp/moved", defaultLocation: "/tmp/moved",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const props: SidebarProps = {
  projects: [{ ...base, missing: true }],
  sessions: [{ id: "s1", title: "任务", workspace: "/tmp/moved", mtimeMs: 0, lines: 1 }],
  activeId: null, activeWorkspace: null, running: new Set(), waitingIds: new Set(), outcomes: new Map(),
  providerOk: null,
  onOpen: noop, onNewTask: noop, onOpenPalette: noop, onSwitchWorkspace: noop,
  onAddProject: async () => undefined, onCloneProject: async () => undefined,
  onOpenNewProjectDialog: noop, onUpdateProject: async () => undefined,
  onRelocateProject: async () => undefined, onRemoveProject: async () => undefined,
  onRevealProject: noop, onPickDirectory: async () => null,
};

describe("侧栏目录失联标记", () => {
  it("missing 项目显示「目录失联」与解释性 title", () => {
    const html = renderToStaticMarkup(<Sidebar {...props} />);
    expect(html).toContain("目录失联");
    expect(html).toContain("项目目录不存在（可能已被移动或删除）");
  });

  it("健康项目不显示标记（不把正常态画成告警）", () => {
    const html = renderToStaticMarkup(<Sidebar {...props} projects={[{ ...base, missing: false }]} />);
    expect(html).not.toContain("目录失联");
  });

  it("标记样式走 risk token，不是硬编码颜色", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const i = css.indexOf("\n.g-missing {");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, css.indexOf("}", i));
    expect(block).toContain("hsl(var(--color-risk) / 35%)");
    expect(block).toContain("hsl(var(--color-risk) / 10%)");
  });
});
