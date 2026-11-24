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

  it("目标写入：显式根里没有这条会话、却登记在别处 ⇒ 拒（goal_set 会 createEventLog，不能造幽灵）", () => {
    // goal_set 先于 run 落盘：放过去会先造出一条幽灵会话，下一次 run 再看到「本根有日志」便放行，
    // run 收口的归属闸被提前绕过。判据放在 wired 表这一层，与显式根的解析同拍。
    expect(mainSrc).toContain("async function assertSessionLivesHere(root: string, sessionId: string): Promise<void> {");
    expect(mainSrc).toContain("if (root !== undefined && sessionId !== undefined) await assertSessionLivesHere(root, sessionId);");
  });

  it("切项目回空聊天面：侧栏 / 顶栏不在旧会话上继续发（同一 sessionId 不能写进新工作区）", () => {
    // 命令面板早就这么做（2026-11-05 审计），侧栏行与顶栏项目 chip 此前漏了：
    // 旧 activeId 留在原项目，而 send 带的是 activeWorkspace ⇒ 下一条消息落到新工作区的空日志上。
    expect(app).toContain("const switched = p !== activeWorkspace;");
    expect(app).toContain("const switched = project.path !== activeWorkspace;");
    expect(app).toContain("onClick={() => { selectProject(p); }}");
    expect(app).toContain("if (switched && activeId !== null) newSession();");
  });

  it("主窗重载后窗口指针归零（渲染层状态归零，主进程不能还停在上一个项目）", () => {
    expect(mainSrc).toContain('win.webContents.on("did-navigate", () => {\n    windowWorkspaces.forget(win.webContents);');
    // 进程级自定义供应商注册表也要归零：重载后首页选择器不能还挂着上一个项目的自定义模型
    // （选中后 run 按目标工作区校验，报「未知 provider」）。
    expect(mainSrc).toContain("installCustomProviders([]);");
  });
});

describe("窗口工作区的上报 → 读因果", () => {
  it("切工作区与上报同拍：入口同时设状态并上报（挂在 effect 上会晚于子组件的读）", () => {
    // React 的子组件 effect 先于父组件跑：上报若挂在 activeWorkspace 的 effect 上，
    // 页面挂载期的读会先于上报发出 ⇒ 仍落到旧指针上。
    expect(app).toContain("const setActiveWorkspace = useCallback((workspace: string | null): void => {");
    expect(app).toMatch(/applyWorkspaceContext\(workspace\);\s*setActiveWorkspaceState\(workspace\);/);
    expect(app).not.toContain("useEffect(() => { applyWorkspaceContext(activeWorkspace); }");
    // 打开归属未知的会话（host 缺省根）：开打前先只把窗口指针归位（不拿旧项目的根去读这条会话）；
    // 回包里解析出的真实根在 opened 中按「这次打开仍是当前会话」采纳（下一条用例钉住）。
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
    // 换项目那一帧就不能再渲染旧清单（渲染期按快照所属工作区判定，不等 effect 晚一拍）。
    expect(app).toContain("const current = snap !== null && snap.forWorkspace === (props.workspace ?? null) ? snap.value : null;");
    expect(app).toContain("snapshotState.page === props.page && snapshotState.workspace === props.workspace");
    expect(app).toContain("void windowWorkspaceApplied().then(() => window.agent.getState())");
    // 插件市场的三个读取面（runtime 走 getState）也在同一道门闩后发车；连切两次只让最新那次跑。
    expect(app).toContain("const id = ++refreshSeq.current;");
    expect(app).toContain("if (id !== refreshSeq.current) return;");
    // 闲时队列按窗口工作区取：切项目重挂载的第一读数也要等上报落定。
    expect(app).toContain("await windowWorkspaceApplied();\n        if (!alive) return;\n        const next = await window.agent.idleTaskList();");
  });

  it("换项目后模型目录重取（自定义 provider 是项目级的：选择器不能列着上一个项目的模型）", () => {
    // 主进程这半：选择成功后才把该项目的 providers.json 装进注册表；渲染层这半：换项目
    // 等上报落定再重读目录。少任意一半，选择器与 run 的校验就会各说各话。
    expect(mainSrc).toContain("const current = workspaceContext();");
    expect(mainSrc).toContain('installCustomProviders(loaded?.kind === "ok" ? loaded.derived : []);');
    expect(app).toMatch(/windowWorkspaceApplied\(\)\.then\(\(\) => \{[\s\S]{0,120}?void refreshProviderInfo\(\);[\s\S]{0,60}?void refreshProviderKeys\(\);/);
    expect(app).toContain("}, [activeWorkspace, refreshProviderInfo, refreshProviderKeys]);");
  });

  it("命令面板的「打开文件」目标属于设置时的项目（换项目后不拿旧相对路径预览新项目）", () => {
    expect(app).toContain("setFileTarget((prev) => ({ path, seq: (prev?.seq ?? 0) + 1, workspace: activeWorkspace }))");
    expect(app).toContain("props.fileTarget.workspace === (props.workspace ?? null)");
    expect(app).toContain("{...(fileTargetCurrent !== undefined ? { openTarget: fileTargetCurrent } : {})}");
  });

  it("换项目后文件窗格换根（旧树不能留在屏幕上，第一读等上报落定）", () => {
    expect(app).toContain('<FilePane\n                  key={props.workspace ?? ""}');
    expect(app).toContain('void windowWorkspaceApplied().then(() => { if (alive) loadDir(""); });');
  });

  it("移除当前项目 = 退出该工作区并回主页（不把界面留在已注销的根上）", () => {
    expect(app).toContain("if (activeWorkspaceRef.current === p.path) {\n      setActiveWorkspace(null);\n      activeWorkspaceRef.current = null;\n      newSessionRef.current?.();");
    expect(app).toContain("toast.success(STR.toast.projectRemovedActive.replace(\"{name}\", p.name));");
  });

  it("克隆后切过去 / 重新定位后换根：都回新根的空聊天面（旧 sessionId 属于旧根）", () => {
    // 克隆成功会切到新项目、重新定位会把根换成新路径：两种情况下 activeId 都还属于旧根，
    // 不回空聊天面就会把同一 sessionId 写进新根的空日志（侧栏 / 命令面板已收口，这两条通道此前漏了）。
    expect(app).toMatch(/setActiveWorkspace\(record\.path\);\s*activeWorkspaceRef\.current = record\.path;\s*\/\/ 切过去[\s\S]{0,160}?newSessionRef\.current\?\.\(\);/);
    expect(app).toMatch(/activeWorkspaceRef\.current = updated\.path;\s*\/\/ 根换了[\s\S]{0,160}?newSessionRef\.current\?\.\(\);/);
  });

  it("归属未知的会话：回包后采纳解析出的根（send 与队列键都不再拿旧 activeWorkspace）", () => {
    // 通知没带根 / 清单还没到：打开时不知道归属，但主进程回包里有（r.session.workspace）。
    // 不采纳 ⇒ 下一条 send 带着旧项目当显式根，run 收口会拒绝（拒绝好过写错，但会话也继续不了）。
    // 判据是「这次打开仍是当前会话」而不是「窗口没有项目」：用户切项目/切会话都会走
    // newSession 自增 openSeq，迟到回包已先行返回；而「正停在项目 A 时打开一条属于别处的会话」
    // 恰恰是最需要采纳的形态——chip / 队列键 / 运行旗都该跟会话真实的根。
    expect(app).toContain("resolvedQueueWs = r.session?.workspace ?? resolvedQueueWs;");
    expect(app).toContain("if (sessionWs === null && r.session !== undefined && activeIdRef.current === id) {");
    expect(app).toContain("setActiveWorkspace(r.session.workspace);");
    // 队列键与运行旗按回包后的归属算；落键等 opened 落定——两个 IPC 的到达顺序没有保证，
    // 读取保持并行，否则 queueGet 先回时键仍停在旧 activeWorkspace，待发消息会挂错键。
    expect(app).toContain("const runId = runKey(resolvedQueueWs ?? activeWorkspace, id);");
    expect(app).toContain("const queueKey = runKey(resolvedQueueWs ?? activeWorkspace, id);");
    expect(app).toContain("const queued = Promise.all([queueRead, opened])");
    expect(app).toContain("const queueRead = window.agent.queueGet(id, sessionWs ?? undefined);");
    // 快照判据取在发起读取**之前**：读取在飞期间本窗口写过的队列不能被旧磁盘快照覆盖
    // （在回包里拿「此刻」的 revision 与它自己比是恒等式，等于没有这道闸）。
    const readAt = app.indexOf("const queueRead = window.agent.queueGet");
    const snapshotAt = app.indexOf("const queueRevisionsAtRead = new Map(queueRevision.current);");
    expect(snapshotAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeLessThan(readAt);
    // 判据本体在 send-queue 的纯函数里（语义由 send-queue.test.ts 逐条判）；这里钉接线
    // 传的是读取前那一份快照，且“此刻”的两张表也一并交给它。
    expect(app).toContain("queueSnapshotAdoptable({");
    expect(app).toContain("dirtyAtRead: queueDirtyAtRead");
    expect(app).toContain("revisionsAtRead: queueRevisionsAtRead");
    expect(app).toContain("dirtyNow: queueDirty.current");
    expect(app).toContain("revisionsNow: queueRevision.current");
    // 重试也必须重走归属推导：把窗口当前项目当显式根，会话属于另一个根时永远打不开。
    expect(app).toMatch(/if \(id !== null && !queueLoading\) openSession\(id\);/);
  });

  it("换工作区丢掉上一份快照：旧行上的信任决议不能落到新项目（决议带行自己的根）", () => {
    expect(app).toContain("const sameSurface = state.page === action.page && state.workspace === action.workspace;");
    expect(app).toContain("dispatch({ type: \"start\", page, generation, workspace: props.workspace });");
    expect(app).toContain("window.agent.pluginDecide(selected.name, next, props.workspace ?? undefined)");
  });
});
