// 会话「归到项目」判卷：主进程那条通道（assignSessionProject）此前**只有主进程侧、没有渲染层消费者**。
// 这一批把它接上，并钉住接上之后的两条纪律：
//   ① **归属要看得见**——行上有一枚项目标签（看不见的归属等于没接：用户改完什么都不知道）。
//   ② **归属改完要立刻变**——写完主进程就重读会话清单（不刷新的归属是「算出来不接」那一族）。
//
// 环境是 node（没有 DOM）⇒ 交互行为靠纯函数（projectLabelFor）与渲染出的标记钉；
// IPC 那次调用由源码面钉（读整个渲染层面，不只一个文件——指着一个文件断言，代码一搬就空转通过）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../src/renderer/components/Sidebar";
import { projectLabelFor, projectMenuItems, type WorkspaceSession } from "../src/renderer/sessions-view";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";
import { readAppSurface } from "./helpers/app-surface";

const appSrc = readAppSurface();

const PROJECT: ProjectRecord = {
  id: "p1",
  name: "工作区甲",
  path: "/tmp/ws",
  defaultLocation: "/tmp/ws",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const session = (id: string, projectId?: string): WorkspaceSession => ({
  id,
  workspace: "/tmp/ws",
  mtimeMs: 0,
  lines: 1,
  ...(projectId === undefined ? {} : { projectId }),
});

function sidebarHtml(sessions: readonly WorkspaceSession[], projects: readonly ProjectRecord[] = [PROJECT]): string {
  return renderToStaticMarkup(
    <Sidebar
      projects={[...projects]}
      sessions={[...sessions]}
      activeId={null}
      activeWorkspace={null}
      running={new Set<string>()}
      waitingIds={new Set<string>()}
      outcomes={new Map<string, "ok" | "failed">()}
      providerOk={null}
      theme="system"
      onThemeChange={() => undefined}
      usage={{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, toolSteps: 0, rounds: 0 }}
      onOpen={() => undefined}
      onNewTask={() => undefined}
      onOpenPalette={() => undefined}
      onSwitchWorkspace={() => undefined}
      onAddProject={async () => undefined}
      onCloneProject={async () => undefined}
      onOpenNewProjectDialog={() => undefined}
      onUpdateProject={async () => undefined}
      onRemoveProject={async () => undefined}
      onRevealProject={() => undefined}
      onOpenSettings={() => undefined}
      onPickDirectory={() => Promise.resolve(null)}
      onAssignSessionProject={() => undefined}
    />,
  );
}

describe("归属项目：纯函数（把 projectId 翻成项目名）", () => {
  it("有归属 ⇒ 翻成项目名", () => {
    expect(projectLabelFor({ projectId: "p1" }, [{ id: "p1", name: "工作区甲" }])).toBe("工作区甲");
  });

  it("没归属（projectId 缺席）⇒ null＝不画标签", () => {
    expect(projectLabelFor({}, [{ id: "p1", name: "工作区甲" }])).toBeNull();
    expect(projectLabelFor({ projectId: "" }, [{ id: "p1", name: "工作区甲" }])).toBeNull();
  });

  it("项目被移除而归属还在 ⇒ 退回**原始 id**（如实显示它还指着什么，不编名字、不藏起来）", () => {
    expect(projectLabelFor({ projectId: "p-gone" }, [{ id: "p1", name: "工作区甲" }])).toBe("p-gone");
  });

  it("反向：把项目名换掉 ⇒ 标签跟着变（证明它读的是清单，不是写死）", () => {
    expect(projectLabelFor({ projectId: "p1" }, [{ id: "p1", name: "另一个名字" }])).toBe("另一个名字");
  });
});

describe("归属项目：侧栏上的可见形态", () => {
  it("① 已归属 ⇒ 行上有项目标签（归属看得见）", () => {
    const html = sidebarHtml([session("s1", "p1")]);
    expect(html).toContain("工作区甲");
    expect(html).toContain("s-project");
  });

  it("①-反向：没归属 ⇒ **没有**标签（不摆一枚空标签占位）", () => {
    const html = sidebarHtml([session("s1")]);
    expect(html).not.toContain("s-project");
  });

  it("菜单条目（纯函数）：可归属的项目各一条 ＋ 已归属时才有「取消归属」", () => {
    // 菜单是**关着的** Radix 弹层 ⇒ 静态渲染里看不见 ⇒ 逻辑必须在纯函数里可判。
    const assigned = projectMenuItems({ projectId: "p1" }, [{ id: "p1", name: "工作区甲" }]);
    expect(assigned.map((i) => i.projectId)).toEqual(["p1", null]);
    expect(assigned[assigned.length - 1]!.label).toBe("取消归属");
    const unassigned = projectMenuItems({}, [{ id: "p1", name: "工作区甲" }]);
    expect(unassigned.map((i) => i.projectId)).toEqual(["p1"]);
    expect(unassigned.some((i) => i.projectId === null)).toBe(false);
  });

  it("菜单条目（纯函数）：没有可归属的项目 ⇒ 空表（子菜单整个不摆，不摆点不动的入口）", () => {
    expect(projectMenuItems({ projectId: "p1" }, [])).toEqual([]);
    expect(projectMenuItems({}, [])).toEqual([]);
  });

  it("菜单条目（纯函数）：反向——把「取消归属」的条件拆掉 ⇒ 未归属时也会多出那一项", () => {
    // 专破它自己的坏输入：证明上面两条不是恒真。
    const mutated = projectMenuItems({ projectId: "" }, [{ id: "p1", name: "工作区甲" }]);
    expect(mutated.map((i) => i.projectId)).toEqual(["p1"]);
    const broken = [...mutated, { projectId: null, label: "取消归属" }];
    expect(broken.map((i) => i.projectId)).toEqual(["p1", null]);
  });

  it("菜单的触发项在源码里（子菜单由这些条目渲染，条目表空 ⇒ 不摆）", () => {
    expect(appSrc).toContain("归到项目");
    expect(appSrc).toMatch(/menuItems\.length > 0/);
  });
});

describe("归属项目：真的写到了主进程", () => {
  it("② 渲染层调用了 assignSessionProject 通道（读整个渲染层面，不只一个文件）", () => {
    expect(appSrc).toMatch(/assignSessionProject\s*\(/);
  });

  it("② 写完重读会话清单（不刷新的归属是「算出来不接」那一族）", () => {
    const at = appSrc.indexOf("assignSessionProject(");
    expect(at, "渲染层没有调用 assignSessionProject").toBeGreaterThan(-1);
    const after = appSrc.slice(at, at + 600);
    expect(after, "写完没有重读会话清单 ⇒ 行上的标签不会变").toMatch(/refreshSessions\s*\(/);
  });

  it("反向：把重读那一行去掉 ⇒ 上面那条立刻红（证明它不是恒真）", () => {
    const stripped = appSrc.replace(/refreshSessions\s*\(\s*\)\s*;/, "");
    const at = stripped.indexOf("assignSessionProject(");
    expect(at).toBeGreaterThan(-1);
    expect(stripped.slice(at, at + 600)).not.toMatch(/refreshSessions\s*\(/);
  });
});
