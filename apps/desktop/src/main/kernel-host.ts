// kernel-host：内核装配单点（spec §3.2 预留 C 缝）。electron-free——
// headless 判卷直接 import；Electron main / 未来 utilityProcess 宿主都只消费本文件出口。
// 只装配、不实现：全部能力都是 src/main 既有出口的直调/小包装，缺的缝就地补一行。
// 装配出口是进程级单例：二次 createKernelHost 会静默覆盖前一次的装配
// （setAppHooks/initSettingsStore 等进程级出口「最后一个赢」），v0.1 契约是每进程只建一次。
//
// M3 T1（多工作区运行面）：deps 升级为 workspaces[] + activeWorkspace。会话→工作区归属、
// 跨工作区列举/建会话/读会话一律走 sessions.ts 的 root 注入族（listSessions(root)/createSession(root)/
// readSessionEvents(root)/sessionExists(root)）——不用 session-handlers 的全局单例 handleSessionList
// （那只认 initSessionsDir 的单一根）。run 以 RunOverrides 的 logPath/workspace 第一优先注入
// （agent-runner.ts:2057/2058 实测口径）⇒ 多工作区并发 run 零 core 改动。
// 漂移检测（Global Constraints）：每会话记 {size, mtimeMs} 快照（openSession 与本端 run 收束时刷新）；
// run 启动前重读 stat，不一致 ⇒ 拒绝该次 run（不静默覆盖），快照比对只对 sessionMode 生效。
// M3 T2（每会话取消）：run 建 per-session AbortController 经 RunOverrides.signal 注入（零 core 改动），
// cancel(sessionId) 只 abort 该会话的 controller；run 响应带 aborted 真值（desktop 扩展字段）。
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../../../../src/events";
import type { RunRequest, RunResponse, SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import {
  handleAgentDecide,
  handleAgentRun,
  initMemoryHome,
  resolveProviderKind,
  setAppHooks,
  updateScheduleCap,
} from "../../../../src/main/agent-runner";
import { applyCrashRecovery, initSessionsDir } from "../../../../src/main/session-handlers";
import { initSettingsStore, setSettingsHostDeps } from "../../../../src/main/settings-handlers";
import {
  createSession as createSessionInRoot,
  listSessions as listSessionsInRoot,
  pathOf,
  readSessionEvents,
  sessionExists,
} from "../../../../src/main/sessions";

export interface KernelHostDeps {
  /** 全部已注册工作区（绝对路径）；listSessions 按此清单逐根扫描。
   *  M3-3 修复轮起可经 addWorkspace 动态扩（addProject 接线）。 */
  workspaces: string[];
  /** 当前工作区（新会话缺省归属）。必须 ∈ workspaces——装配错位当场炸，不让会话静默落错根。 */
  activeWorkspace: string;
  userDataDir: string; // app userData（settings/日志）
  outbox: (channel: "onEvent" | "onAsk" | "onAskDone", payload: unknown) => void;
}

export interface KernelHost {
  /** 会话模式（sessionId 在场）时工作区/日志路径由归属表给出并以 over 第一优先注入；
   *  非会话模式原样透传（M2 语义逐字不变）。aborted 增强字段（desktop 扩展，不进 ipc-protocol 类型）：
   *  当且仅当该会话的 per-session controller 被 abort 时为 true——判定在包装返回处做。 */
  run(req: RunRequest & { workspace?: string }): Promise<RunResponse & { aborted?: boolean }>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): boolean;
  /** 会话级取消（M3 T2 接管 T1 的缝）：只 abort 该会话在跑 run 的 AbortController；
   *  该会话不在运行 ⇒ { ok:false, error:"会话不在运行" }。不再走 M2 全局缝 handleRunCancel
   *  （那只认最后注册的 interactiveRunAbort——并发会话下取消的是最后启动的那场，杀错对象）。 */
  cancel(sessionId: string): Promise<{ ok: boolean; error?: string }>;
  /** 全工作区合并的会话清单，每条带 workspace 归组标记（T3 分组侧栏的数据源）。 */
  listSessions(): Promise<(SessionInfoPayload & { workspace: string })[]>;
  /** 新建会话；缺省落 activeWorkspace。参数是工作区不是会话名
   *  （M3 起 id 恒为时间戳名——秒级粒度、host 级唯一，命名走 rename）。 */
  createSession(workspace?: string): Promise<{ id: string }>;
  /** 动态并入一个工作区（M3-3 修复轮）：push 进扫描面（去重幂等）——新工作区的会话立即经
   *  listSessions 出现，归属表解析的兜底扫描同步生效。仅在 main 进程内由 addProject handler
   *  成功后调用（同进程直调，不经 IPC、renderer 无感知自动生效）；入参须为 canonical 绝对路径
   *  （ProjectRegistry.add 的 realpath 产物），本出口不重复校验。 */
  addWorkspace(ws: string): void;
  /** 读回会话事件并登记归属/漂移基线；workspace 缺省时按归属表 → 全工作区扫描解析。 */
  openSession(id: string, workspace?: string): Promise<{ events: AgentEvent[] }>;
}

/** 漂移拒绝文案（计划 Global Constraints 原文，逐字）。 */
const DRIFT_ERROR = "会话已被外部修改（CLI？），请刷新后重试";

/** 漂移快照：stat 之外还记基线行数与本端事件计数锚——见 externalDrift 的归因慢路径。 */
interface DriftSnapshot {
  size: number;
  mtimeMs: number;
  /** 基线时刻的非空行数（与本端事件一一对应：pipeline 每事件恰落一行）。 */
  lines: number;
  /** 基线时刻的 ownAppends 计数（归因减法的减数）。 */
  ownAtSnapshot: number;
}

export function createKernelHost(deps: KernelHostDeps): KernelHost {
  if (!deps.workspaces.includes(deps.activeWorkspace)) {
    throw new Error(`activeWorkspace 不在 workspaces 里: ${deps.activeWorkspace}`);
  }
  const workspaces = [...new Set(deps.workspaces)];
  // 会话根按工作区解析（spec §4.1）：与 CLI 同根 <ws>/.agent/sessions。
  // 单例 initSessionsDir 仍指 activeWorkspace：core 里 requireSessionsDir 的兜底路径
  // （压缩/调度器等未接线通道）需要一个 coherent 根；本文件的所有会话 IO 都显式传 root，不依赖它。
  const wsRoot = (ws: string) => join(ws, ".agent", "sessions");
  initSessionsDir(wsRoot(deps.activeWorkspace));
  initMemoryHome(join(deps.userDataDir, "memory"));
  // settings 存储挂 userData（task-3-brief 把这一行记在 setSettingsHostDeps 名下——实测
  // settings-handlers 的存储走独立出口 initSettingsStore(filePath)，宿主依赖面另两个回调：
  // provider 判定与 run 同源（resolveProviderKind），并发上限变更转发调度器缓存（updateScheduleCap）。
  initSettingsStore(join(deps.userDataDir, "settings.json"));
  setSettingsHostDeps({ resolveProviderKind, onScheduleCapChange: updateScheduleCap });

  // ---- 会话→工作区归属表（M3 T1）：createSession/openSession 登记，run 时解析（缺省 activeWorkspace）。
  const owner = new Map<string, string>();

  // ---- 每会话取消（M3 T2）：run 启动建 per-session AbortController，经 RunOverrides.signal 注入
  //  （agent-runner.ts:1584 AbortSignal.any 并入运行信号 ⇒ 轮界 loop.ts:363 + 门等待 ask-gate.ts:92-97
  //  + 长驻工具 loop.ts:484 全语义，实测见 task-2-report 勘误裁决）；run 收束清 map。
  //  同会话并发 run 被 core 的 isSessionLogBusy 拒（第二场速死），首场的 controller 保持 canonical
  //  ——set 只在缺位时发生、清只在还是自己时发生，cancel 永远指向真正在跑的那一场。
  const runControllers = new Map<string, AbortController>();

  // ---- 漂移检测状态 ----
  // 快照按 logPath（=工作区×会话）记，不按裸 id：同一分钟在两工作区各建的会话 id 同名
  // （core 撞名规避只在各自根内），按 id 记会让两个文件的基线互相覆盖。
  const drift = new Map<string, DriftSnapshot>();
  // 本端事件计数：setAppHooks.onEvent 是每一条会话 JSONL 追加的下游（agent-runner pipeline
  // 「先 log.append 后 onEvent」，agent-runner.ts:1618-1626），事件带 session_id ⇒ 每见一次
  // = 本端向该会话落了一行。用「行数守恒」区分本端尾随写与外部追加，见 externalDrift。
  // 已知局限（如实记）：计数只能按 session_id 归并——同 id 跨工作区（同分钟撞名）且两流
  // 并发尾随时，计数互相抬高 ⇒ 归因保守偏「拒」（不静默覆盖是底线方向），openSession 刷新即恢复。
  const ownAppends = new Map<string, number>();

  setAppHooks({
    onEvent: (e) => {
      const sid = (e as { session_id?: unknown }).session_id;
      if (typeof sid === "string") ownAppends.set(sid, (ownAppends.get(sid) ?? 0) + 1);
      deps.outbox("onEvent", e);
    },
    onAsk: (p) => deps.outbox("onAsk", p),
    onAskOutcome: (p) => deps.outbox("onAskDone", p),
  });

  const statSession = async (p: string) => {
    try {
      return await stat(p);
    } catch {
      return null;
    }
  };
  /** 非空行数（口径与 sessions.ts countSessionLines 一致；只比增量，不需要逐字一致）。 */
  const countLines = async (p: string): Promise<number | null> => {
    try {
      const raw = await readFile(p, "utf8");
      let n = 0;
      for (const line of raw.split("\n")) if (line.trim() !== "") n++;
      return n;
    } catch {
      return null;
    }
  };
  /** 刷新基线为「当时 stat」。先读盘、后读计数：pipeline 的 onEvent 在 append 完成后的同一
   *  异步链上触发，await readFile 之后取计数 ⇒ 基线行与计数锚不会把同一行算两次（实测见报告）。 */
  const refreshSnapshot = async (sessionId: string, logPath: string): Promise<void> => {
    const st = await statSession(logPath);
    const lines = await countLines(logPath);
    if (st === null || lines === null) {
      drift.delete(logPath); // 文件不可见 = 无从守护；下次 run 重建基线
      return;
    }
    drift.set(logPath, {
      size: st.size,
      mtimeMs: st.mtimeMs,
      lines,
      ownAtSnapshot: ownAppends.get(sessionId) ?? 0,
    });
  };
  /** run 启动前的漂移判：true = 外部改动 ⇒ 拒绝。快路径 stat 全等放行；慢路径做归因——
   *  本端 worker 子流在父 run 收束后仍会落盘（实测 demo 剧本尾随写持续 ≥5s，agent-runner.ts:1624
   *  「a late worker append reopens through createEventLog」），单纯「收束即 stat」会把这部分
   *  自身增长误判成外部改动。归据：增长行数 == 快照后本端事件数 ⇒ 全部自身 ⇒ 刷新基线放行；
   *  行数对不上（含外部追加/删改/触碰）⇒ 拒绝，恢复走 openSession 重建基线（「请刷新后重试」）。 */
  const externalDrift = async (sessionId: string, logPath: string): Promise<boolean> => {
    const snap = drift.get(logPath);
    if (snap === undefined) return false; // 尚无基线（首场 run）：本轮收束时建立
    const st = await statSession(logPath);
    if (st === null) return true; // 快照在场而文件消失 = 外部删除
    if (st.size === snap.size && st.mtimeMs === snap.mtimeMs) return false; // 原样：零 I/O 快路径
    const ownTotal = ownAppends.get(sessionId) ?? 0;
    const own = ownTotal - snap.ownAtSnapshot;
    if (own > 0) {
      const lines = await countLines(logPath);
      if (lines !== null && lines === snap.lines + own) {
        drift.set(logPath, { size: st.size, mtimeMs: st.mtimeMs, lines, ownAtSnapshot: ownTotal });
        return false; // 增长全部来自本端事件管线
      }
    }
    return true;
  };

  /** 会话工作区解析：显式参 > 归属表 > 全工作区扫描（CLI 建的会话/进程重启后的首开）> activeWorkspace。 */
  const resolveSessionWs = async (sessionId: string, explicit?: string): Promise<string> => {
    if (explicit !== undefined) {
      owner.set(sessionId, explicit);
      return explicit;
    }
    const known = owner.get(sessionId);
    if (known !== undefined) return known;
    for (const ws of workspaces) {
      if (await sessionExists(wsRoot(ws), sessionId)) {
        owner.set(sessionId, ws);
        return ws;
      }
    }
    return deps.activeWorkspace;
  };

  return {
    run: async (req) => {
      const sessionId = req.sessionId;
      if (sessionId === undefined) return handleAgentRun(req); // 非会话模式：临时日志，无归属无漂移无可取消缝
      const ws = await resolveSessionWs(sessionId);
      const logPath = pathOf(wsRoot(ws), sessionId);
      if (await externalDrift(sessionId, logPath)) return { ok: false, error: DRIFT_ERROR };
      const controller = new AbortController();
      if (!runControllers.has(sessionId)) runControllers.set(sessionId, controller);
      try {
        const res = await handleAgentRun(req, { sessionId, logPath, workspace: ws, signal: controller.signal });
        // aborted 真值（desktop 扩展字段，不动 ipc-protocol 类型）：当且仅当本会话 controller 被 abort
        return controller.signal.aborted ? { ...res, aborted: true } : res;
      } finally {
        if (runControllers.get(sessionId) === controller) runControllers.delete(sessionId);
        await refreshSnapshot(sessionId, logPath); // 收束即基线；自身尾随写由下一场 run 启动前的归因放行
      }
    },
    decide: (askId, approved, scope) => handleAgentDecide(askId, approved, scope),
    // 会话级取消（M3 T2）：abort 该会话在跑 run 的 controller（经 RunOverrides.signal 全语义收束）；
    // 不在跑 ⇒ fail-visible。M2 全局缝 handleRunCancel 不再经此出口（并发会话下它杀的是最后启动的 run）。
    cancel: async (sessionId) => {
      const controller = runControllers.get(sessionId);
      if (controller === undefined) return { ok: false, error: "会话不在运行" };
      controller.abort();
      return { ok: true };
    },
    listSessions: async () => {
      const out: (SessionInfoPayload & { workspace: string })[] = [];
      for (const ws of workspaces) {
        for (const info of await listSessionsInRoot(wsRoot(ws))) {
          out.push({ ...info, workspace: ws });
        }
      }
      return out;
    },
    addWorkspace: (ws) => {
      // 动态并入扫描面（M3-3 修复轮）：唯一调用方是 main 进程 addProject handler（registry.add
      // 成功后传 canonical realpath）。去重幂等——workspaces 数组被 listSessions/resolveSessionWs
      // 闭包按引用迭代，重复 push 会让新工作区被逐根扫描两遍、清单出重复条目。
      if (workspaces.includes(ws)) return;
      workspaces.push(ws);
    },
    createSession: async (workspace) => {
      const ws = workspace ?? deps.activeWorkspace;
      // ---- host 级 id 唯一（T1 审查强制前置，T3 收口）----
      // core createSession 缺省名到分钟、撞名规避只在各自根内（stat 同根文件）⇒ 同分钟跨工作区
      // 两建返回同名 id，归属表「后建覆盖先建」，先建会话的 run/open 被路由到后建工作区
      // （task-1-report Concern 2；核验结论：T1 的「create 返回后立即 owner.set」不解歧——
      // id 本身同名时覆盖照旧发生）。修法（T1 审查建议：name 参传自定义名避开分钟粒度）：
      // 秒级时间戳名 ＋ 归属表查重换名；「查重→占位」是同步段（无 await 夹缝），并发同秒
      // 两建也必分先手；core 若因盘上残留同名走根内序号避让（返回 id ≠ 请求名），以返回 id 重登记。
      const p2 = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `会话 ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} `
        + `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
      let name = stamp;
      for (let n = 2; owner.has(name); n++) name = `${stamp} (${n})`;
      owner.set(name, ws); // 占位：键先于盘上文件在场，键面即保证 host 级唯一
      try {
        const id = await createSessionInRoot(wsRoot(ws), name);
        if (id !== name) {
          owner.delete(name); // 根内序号避让改写了名（盘上残留撞名）：以返回 id 为准
          owner.set(id, ws);
        }
        return { id };
      } catch (error) {
        owner.delete(name); // 建失败不留幽灵占位
        throw error;
      }
    },
    openSession: async (id, workspace) => {
      const ws = await resolveSessionWs(id, workspace);
      const root = wsRoot(ws);
      if (!(await sessionExists(root, id))) throw new Error(`会话不存在: ${id}`);
      const logPath = pathOf(root, id);
      // M3c 崩溃恢复随开随扫（M2 handleSessionOpen 同语义，显式 logPath 化——补发的 failed(interrupted)
      // 不经 onEvent 通道，但在下面的基线刷新之后落盘 ⇒ 计入基线，不污染归因）。
      await applyCrashRecovery(logPath);
      const events = await readSessionEvents(root, id);
      await refreshSnapshot(id, logPath); // open 即基线（含补发行）
      return { events };
    },
  };
}
