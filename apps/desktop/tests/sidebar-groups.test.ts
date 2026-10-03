import { describe, expect, it } from "vitest";
// groupByWorkspace 与哨兵常量随 Sidebar.tsx 出口（任务书 Interfaces：纯函数，组件文件同源导出——
// 测试环境是 node，不渲染 JSX，只调函数；同 model-picker.test.ts 对 ModelPicker.tsx 的先例）。
import { groupByWorkspace, OTHER_WORKSPACE, type WorkspaceSession } from "../src/renderer/components/Sidebar";
import type { SessionInfoPayload } from "../../../src/main/ipc-protocol";

// 会话夹具：host.listSessions() 的 desktop 扩展形状（SessionInfoPayload & { workspace: string }）。
const ws = (id: string, workspace: string, mtimeMs = 0): WorkspaceSession => ({
  id,
  workspace,
  mtimeMs,
  lines: 1,
});

describe("groupByWorkspace（M3-3 分组侧栏纯函数）", () => {
  it("正常分组：会话按归属工作区落组，注册顺序即组序，组内保持输入序", () => {
    const groups = groupByWorkspace(
      [ws("s1", "/repo/a"), ws("s2", "/repo/b"), ws("s3", "/repo/a")],
      ["/repo/a", "/repo/b"],
    );
    expect(groups.map((g) => [g.workspace, g.sessions.map((s) => s.id)])).toEqual([
      ["/repo/a", ["s1", "s3"]],
      ["/repo/b", ["s2"]],
    ]);
  });

  it("空组也列：已注册工作区零会话仍出组（侧栏可见可切换），不挤掉也不重排", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a")], ["/repo/a", "/repo/empty"]);
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a", "/repo/empty"]);
    expect(groups.find((g) => g.workspace === "/repo/empty")?.sessions).toEqual([]);
  });

  it("未登记工作区的会话归「其他」组垫底，不静默吞数据", () => {
    const groups = groupByWorkspace(
      [ws("s1", "/repo/a"), ws("ghost1", "/ghost/x"), ws("ghost2", "/ghost/y")],
      ["/repo/a"],
    );
    // 「其他」恒垫底；哨兵不是任何真实工作区路径（真实工作区恒为绝对路径）
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a", OTHER_WORKSPACE]);
    expect(OTHER_WORKSPACE).not.toMatch(/^\//);
    // 「其他」组收拢全部未登记会话且保输入序
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(["ghost1", "ghost2"]);
    // 不吞数据：全会话恰好多分组一次（防 listProjects 与盘上漂移时丢会话）
    expect(groups.flatMap((g) => g.sessions).map((s) => s.id)).toEqual(["s1", "ghost1", "ghost2"]);
  });

  it("注册表为空 ⇒ 全部会话进「其他」，零丢失", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a"), ws("s2", "/repo/b")], []);
    expect(groups.map((g) => g.workspace)).toEqual([OTHER_WORKSPACE]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("防御：workspaces 重复条目不产生重复组（registry 保 path 唯一，纯函数不信任上游）", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a")], ["/repo/a", "/repo/a"]);
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("类型面：WorkspaceSession 是 SessionInfoPayload 的超集（workspace 必带）", () => {
    // 静态锚：缺 workspace 字段的对象不能当 WorkspaceSession 用（host 扩展字段是分组依据）
    const base: SessionInfoPayload = { id: "s", mtimeMs: 0, lines: 0 };
    expect(base.id).toBe("s");
    const widened: WorkspaceSession = { ...base, workspace: "/repo/a" };
    expect(groupByWorkspace([widened], ["/repo/a"])).toHaveLength(1);
  });
});
