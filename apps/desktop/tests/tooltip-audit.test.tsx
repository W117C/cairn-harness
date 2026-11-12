// P1-6 判卷：tooltip 审计（brief 第九节「图标钮必有 tooltip」；自查清单「所有可点元素都有
// tooltip / aria-label」的机器化）。面 = 重做批的四个组件收拢态真 HTML：
// Sidebar（顶栏/项目/会话行/页脚/添加项目）、NewProjectDialog、ProjectSettingsDialog、AddProjectMenu。
// 判据：每个 <button> 的起始标签里至少有 title= 或 aria-label=——缺一个就红，并打出那枚按钮。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar, ProjectSettingsDialog } from "../src/renderer/components/Sidebar";
import { NewProjectDialog } from "../src/renderer/components/NewProjectDialog";
import { AddProjectMenu } from "../src/renderer/components/AddProjectMenu";
import { Composer } from "../src/renderer/components/Composer";
import { templateCatalog } from "../../../src/main/project-templates";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";

/** Composer 的最小 props（与 composer-rework 同一套，够渲染控件行）。 */
const COMPOSER = {
  mode: "default" as const,
  running: false,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  events: [],
  phaseLabel: "执行工具",
  phase: "tool" as const,
  elapsedSec: 3,
  steps: 2,
  workspacePath: "/w/proj",
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
  onPickFiles: async () => null,
  onPickDirectory: async () => null,
};

const PROJECT: ProjectRecord = {
  id: "p1",
  name: "工作区甲",
  path: "/tmp/ws",
  defaultLocation: "/tmp/ws",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** 有可见文字的按钮不需要 tooltip/aria（文字本身就是可访问名称，例：菜单里的「上传文件…」）。
 *  判据因此只钉**纯图标 / 空文本**的按钮：那类没有名称，缺 title 与 aria-label 就是真缺陷。 */
function audit(html: string): void {
  const tags = html.match(/<button[^>]*>.*?<\/button>/gs) ?? [];
  const buttons = tags.map((t) => t.slice(0, t.indexOf(">") + 1));
  const nameless = buttons.filter((b) => {
    const body = tags[buttons.indexOf(b)] ?? "";
    const text = body.slice(body.indexOf(">") + 1, body.lastIndexOf("</button>"))
      // svg 内部的 <path>/<circle> 等标签内容不是可见文字；保留标签属性、去掉标签体。
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;|&gt;|&amp;|&#\d+;/g, "")
      .trim();
    return text === "";
  });
  expect(buttons.length).toBeGreaterThan(0);

  for (const b of nameless) {
    expect(b.includes("title=") || b.includes("aria-label="), `按钮缺 tooltip/aria-label：${b}`).toBe(true);
  }
}

describe("tooltip 审计：重做面所有 <button> 都有 title 或 aria-label", () => {
  it("侧栏全量（顶栏 ＋ 新任务/搜索、项目行、会话行、页脚、添加项目）", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={[PROJECT]}
        sessions={[{ id: "s1", title: "修左栏样式", mtimeMs: 1, lines: 3, workspace: "/tmp/ws", pinned: true }]}
        activeId="s1"
        activeWorkspace="/tmp/ws"
        running={new Set(["s1"])}
        waitingIds={new Set<string>()}
        outcomes={new Map([["s1", "ok"]])}
        onOpen={() => undefined}
        onNewTask={() => undefined}
        onOpenPalette={() => undefined}
        onSwitchWorkspace={() => undefined}
        onAddProject={async () => undefined}
        onCloneProject={async () => undefined}
        onOpenNewProjectDialog={() => undefined}
        onUpdateProject={async () => undefined}
        onRelocateProject={async () => undefined}
        onRemoveProject={async () => undefined}
        onRevealProject={() => undefined}
        onPickDirectory={() => Promise.resolve(null)}
      />,
    );
    audit(html);
  });

  it("新建项目 Dialog", () => {
    const html = renderToStaticMarkup(
      <NewProjectDialog
        templates={templateCatalog()}
        existingNames={[]}
        onClose={() => undefined}
        onPickDirectory={() => Promise.resolve(null)}
        onCreate={async () => undefined}
      />,
    );
    audit(html);
  });

  it("输入区控件（＋ 菜单 / 权限 / 模型 / 用量环 / 发送）——纯图标钮也必须有 aria-label", () => {
    // 2026-11-02：`.attach-btn` 此前只有 title（＋ 图标无文字）；title 在部分读屏下不可靠。
    const html = renderToStaticMarkup(<Composer {...COMPOSER} stopped={false} />);
    audit(html);
    // 纯图标的 ＋ 钮：只有 title 不够（部分读屏不读 title），必须有 aria-label。
    const plus = html.match(/<button[^>]*class="attach-btn"[^>]*>/)?.[0] ?? "";
    expect(plus, "＋ 按钮应渲染").toContain('class="attach-btn"');
    expect(plus.includes("aria-label="), `＋ 钮缺 aria-label：${plus}`).toBe(true);
  });

  it("项目设置 Dialog", () => {
    const html = renderToStaticMarkup(
      <ProjectSettingsDialog
        project={PROJECT}
        onClose={() => undefined}
        onSave={async () => undefined}
        onPickDirectory={() => Promise.resolve(null)}
      />,
    );
    audit(html);
  });

  it("添加项目菜单（收拢态：触发钮）", () => {
    const html = renderToStaticMarkup(
      <AddProjectMenu
        onPickDirectory={() => Promise.resolve(null)}
        onAddProject={async () => undefined}
        onOpenNewProjectDialog={() => undefined}
        onCloneProject={async () => undefined}
        activePaths={[PROJECT.path]}
      />,
    );
    audit(html);
  });
});
