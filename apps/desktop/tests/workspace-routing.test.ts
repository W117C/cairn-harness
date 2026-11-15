// 第 1215 / 1219 页：会话作用域的调用必须把「这一行属于哪个工作区」带到底；上报与读之间也要有因果。
//
// 背景：同一个 session id 可以同时存在于两个工作区（same-id-workspace-smoke 是活着的语义）。
// 主进程能按归属解析，但同 id 时归属是**歧义的** ⇒ fail-closed；渲染层明明知道
// （侧栏行上就带着 workspace），却在中途把它丢掉，用户看到的是一次没有解释的失败。
// 这里钉的是「丢掉」本身：请求带 workspace、主进程按显式工作区解析、diff 读同一条根。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noteWorkspaceContext, windowWorkspaceApplied } from "../src/renderer/state/window-workspace";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();
const mainSrc = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
const kernelHost = readFileSync(new URL("../src/main/kernel-host.ts", import.meta.url), "utf8");

describe("会话作用域调用的工作区路由", () => {
  it("worktree 隔离：请求带行内 workspace，main 按显式工作区解析（不猜）", () => {
    expect(app).toMatch(/sessionWorktree\([\s\S]{0,260}?workspace: s\.workspace/);
    expect(kernelHost).toContain("const ws = await resolveSessionWs(sessionId, req.workspace);");
  });

  it("worker 改动 diff 读会话自己的工作区（缺了它读的是构造期的启动工作区）", () => {
    expect(app).toContain("worktreeDiff(w.diffRef, props.workspace ?? undefined)");
  });

  it("消息标记的写路径带上当前工作区（sidecar 是 host 级，存在性检查才需要根）", () => {
    expect(app).toContain("useMessageAnnotations(activeId, activeWorkspace, setLastError)");
    expect(app).toMatch(/submitFeedback\(\{[^}]*workspace: ws/);
    expect(app).toMatch(/setMessagePinned\(\{[^}]*workspace: ws/);
    expect(app).toContain("listMessagePins(sid, ws)");
    expect(mainSrc).toContain("listMessagePins: async (sessionId, workspace) =>");
  });

  it("侧栏行级动作把行自己的 workspace 递出去", () => {
    expect(app).toContain("props.onPinSession?.(s.id, pinned, s.workspace)");
    expect(app).toContain("props.onRenameSession?.(s.id, next, s.workspace)");
    expect(app).toContain("props.onAssignSessionProject?.(s.id, projectId, s.workspace)");
  });

  it("重命名把根带给主进程：行内给行根，顶栏按当前会话 / 清单行补齐（不留给归属解析去猜）", () => {
    expect(app).toContain("window.agent.renameSession(id, name, ws)");
    expect(app).toContain("const activeMatches = activeIdRef.current === id && (workspace === undefined || activeWorkspaceRef.current === workspace);");
    expect(app).toContain("const ws = workspace ?? (activeMatches ? activeWorkspaceRef.current ?? undefined : sessions.find((s) => s.id === id)?.workspace);");
  });

  it("技能正文按窗口工作区读（快照与正文不能来自两个项目）", () => {
    expect(app).toContain("skillBody(selectedName, props.workspace ?? undefined)");
    expect(app).toContain("skillBody(invoke, props.workspace ?? undefined)");
    expect(app).toContain("<PluginSurface workspace={props.workspace ?? null} />");
  });

  it("会话日志按窗口工作区读（同 id 时不让「查看日志」变成无解释的错误）", () => {
    expect(app).toContain("sessionLog(props.id, 400, props.workspace ?? undefined)");
    expect(kernelHost).toContain("const ws = await resolveSessionWs(id, workspace);");
    // wired 行必须把第三个形参一路递给 host：只改两端不改中间，等于没改。
    expect(mainSrc).toContain("sessionLog: (id, tailLines, workspace) => host.sessionLog(id as string, typeof tailLines === \"number\" ? tailLines : undefined, workspace as string | undefined)");
  });

  it("桌面 wired 表：pin / archive / 项目归属都过已登记根闸", () => {
    expect(mainSrc).toContain("handleSessionSetPinned(sessionId as string, pinned as boolean, await explicitSessionsRoot(workspace))");
    expect(mainSrc).toContain("handleSessionSetArchived(sessionId as string, archived as boolean, await explicitSessionsRoot(workspace))");
    expect(mainSrc).toContain("handleSessionAssignProject(sessionId as string, projectId as string | null, await explicitSessionsRoot(workspace))");
  });

  it("主窗重载后窗口指针归零（渲染层状态归零，主进程不能还停在上一个项目）", () => {
    expect(mainSrc).toContain('win.webContents.on("did-navigate", () => { windowWorkspaces.forget(win.webContents); });');
  });
});

describe("窗口工作区的上报 → 读因果", () => {
  it("切工作区与上报同拍：入口同时设状态并上报（挂在 effect 上会晚于子组件的读）", () => {
    // React 的子组件 effect 先于父组件跑：上报若挂在 activeWorkspace 的 effect 上，
    // 页面挂载期的读会先于上报发出 ⇒ 仍落到旧指针上。
    expect(app).toContain("const setActiveWorkspace = useCallback((workspace: string | null): void => {");
    expect(app).toMatch(/applyWorkspaceContext\(workspace\);\s*setActiveWorkspaceState\(workspace\);/);
    expect(app).not.toContain("useEffect(() => { applyWorkspaceContext(activeWorkspace); }");
    // 打开归属未知的会话（host 缺省根）：只把窗口指针归位，当前浏览的项目不动。
    expect(app).toContain("if (sessionWs !== null) setActiveWorkspace(sessionWs);");
    expect(app).toContain("else applyWorkspaceContext(null);");
  });

  it("读侧等最后一次上报落定；上报失败也放行（坏项目不许把 UI 卡死）", async () => {
    let release: (r: { ok: boolean }) => void = () => undefined;
    const pending = new Promise<{ ok: boolean }>((resolve) => { release = resolve; });
    noteWorkspaceContext(pending);
    let settled = false;
    const waiting = windowWorkspaceApplied().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release({ ok: true });
    await waiting;
    expect(settled).toBe(true);

    const failed = Promise.reject(new Error("未注册"));
    failed.catch(() => undefined); // 测试侧接管：这里只验「门闩不被一次失败卡住」
    noteWorkspaceContext(failed);
    await expect(windowWorkspaceApplied()).resolves.toBeUndefined();
  });

  it("空屏三查先等上报落定（再读目录 / package.json，否则读到上一个项目）", () => {
    expect(app).toContain("const promise = same !== null ? same.promise : window.agent.setWorkspaceContext(workspace ?? \"\");");
    expect(app).toMatch(/await windowWorkspaceApplied\(\);[\s\S]{0,160}?workspaceListDir\(""\)[\s\S]{0,120}?workspaceReadText\("package\.json"\)/);
  });

  it("同一目标的并发上报并成一次；过期的那次不再当用户错误弹（也不清上下文）", () => {
    expect(app).toContain("const same = inflight !== null && inflight.workspace === workspace ? inflight : null;");
    expect(app).toContain("if (token !== contextSeq.current) return;");
  });

  it("应用页 / 插件面 / 插件市场在切换工作区后重取快照（删除、信任写进新项目，清单不能还是旧的）", () => {
    expect(app).toContain("}, [props.page, props.workspace, refresh]);");
    expect(app).toContain("void windowWorkspaceApplied().then(() => {");
    expect(app).toMatch(/换项目：旧清单的行不能再可点[\s\S]{0,80}?setSnap\(null\);/);
    expect(app).toContain("void windowWorkspaceApplied().then(() => window.agent.getState())");
    // 插件市场的三个读取面（runtime 走 getState）也在同一道门闩后发车；连切两次只让最新那次跑。
    expect(app).toContain("const id = ++refreshSeq.current;");
    expect(app).toContain("if (id !== refreshSeq.current) return;");
  });

  it("换工作区丢掉上一份快照：旧行上的信任决议不能落到新项目（决议带行自己的根）", () => {
    expect(app).toContain("const sameSurface = state.page === action.page && state.workspace === action.workspace;");
    expect(app).toContain("dispatch({ type: \"start\", page, generation, workspace: props.workspace });");
    expect(app).toContain("window.agent.pluginDecide(selected.name, next, props.workspace ?? undefined)");
  });
});
