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
import { realpathSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { AgentEvent } from "../../../../src/events";
import type {
  RunRequest,
  RunResponse,
  SessionInfoPayload,
  SessionWorktreeRequest,
  SessionWorktreeResult,
  SessionLogPayload,
  SessionSearchResult,
  UsageLedgerPayload,
} from "../../../../src/main/ipc-protocol";
// 会话级 worktree 隔离（§3.7 · G4）：创建/合并/清理全在 core 侧（src/main/session-worktree.ts），
// 这里只做三件宿主事——按会话归属解析工作区、在跑就拒、把结果原样交回渲染层。
import {
  createSessionWorktree,
  discardSessionWorktree,
  isSessionIsolated,
  listIsolatedSessions,
  mergeSessionWorktree,
  sessionWorktreePath,
} from "../../../../src/main/session-worktree";
import { scheduledRunCount } from "../../../../src/main/scheduler-runtime";
import {
  handleAgentDecide,
  handleAgentRun,
  initMemoryHome,
  initSandbox,
  resolveProviderKind,
  setAppHooks,
  updateScheduleCap,
} from "../../../../src/main/agent-runner";
import { applyCrashRecovery, initSessionsDir, requireSessionMetadata, setSessionRootResolver } from "../../../../src/main/session-handlers";
import { initSettingsStore, setSettingsHostDeps } from "../../../../src/main/settings-handlers";
import {
  createSession as createSessionInRoot,
  deriveSessionTitle,
  listSessions as listSessionsInRoot,
  pathOf,
  readSessionQueue,
  writeSessionQueue,
  readSessionEvents,
  sessionExists,
  isSessionInRoot,
  listSessionIds,
  type SessionQueueEntry,
} from "../../../../src/main/sessions";
import { searchSessions } from "../../../../src/main/session-search";
import type { SessionMetadataRepository } from "../../../../src/main/session-metadata";
import { addUsageTotals, emptyUsageTotals } from "../../../../src/main/usage-ledger";
import { scanUsageFile, type UsageFileCache } from "../../../../src/main/usage-ledger-scan";
import { readSessionLogTail } from "../../../../src/main/session-log";

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
  /** 会话级 worktree 隔离（§3.7 · G4）：create / merge / discard。
   *  三条都先按会话归属解析工作区（与 run 同一张归属表），并在该会话**正在跑**时拒绝——
   *  run 正在那棵树里写东西，此刻合并/删除等于把脚下的地板抽走。 */
  sessionWorktree(req: SessionWorktreeRequest): Promise<SessionWorktreeResult>;
  /** 全工作区合并的会话清单，每条带 workspace 归组标记（T3 分组侧栏的数据源）；
   *  并合并单例 sidecar 的 pinned/archived/projectId（与写路径同源，见实现处注释）。 */
  listSessions(): Promise<(SessionInfoPayload & { workspace: string })[]>;
  /** v14：跨全部已登记工作区的用量账本（只读；不触发 openSession 的恢复/漂移副作用）。
   *  按「路径 + size + mtime」缓存单文件读数——重复打开面板只重读变过的会话。 */
  usageLedger(): Promise<UsageLedgerPayload>;
  /** v15：读该会话日志尾部（只读；会话归属由本 host 解析——不接受渲染层传路径）。 */
  sessionLog(id: string, tailLines?: number): Promise<SessionLogPayload>;
  /** v18：会话正文全文检索（只读；工作区归属由本 host 解析——渲染层不传路径）。
   *  结果是三态（ok / partial / unavailable）：「没量到」不许被折成「没有匹配」。 */
  sessionSearch(
    workspace: string,
    query: string,
    options?: { budgetBytes?: number; maxSessions?: number },
  ): Promise<SessionSearchResult>;
  /** 新建会话；缺省落 activeWorkspace。参数是工作区不是会话名
   *  （M3 起 id 恒为时间戳名——秒级粒度、host 级唯一，命名走 rename）。
   *  M3 终审：显式传入的 workspace 须 ∈ workspaces（含 addWorkspace 动态并入），
   *  未注册 ⇒ throw（与构造期 activeWorkspace 校验同式 fail-visible）——堵 IPC 注入面
   *  （否则 renderer 可指任意路径，会话目录被凭空 mkdir）。 */
  createSession(workspace?: string): Promise<{ id: string }>;
  /** 动态并入一个工作区（M3-3 修复轮）：push 进扫描面（去重幂等）——新工作区的会话立即经
   *  listSessions 出现，归属表解析的兜底扫描同步生效。仅在 main 进程内由 addProject handler
   *  成功后调用（同进程直调，不经 IPC、renderer 无感知自动生效）；入参须为 canonical 绝对路径
   *  （ProjectRegistry.add 的 realpath 产物），本出口不重复校验。 */
  addWorkspace(ws: string): void;
  /** 动态缩面（M4-5）：addWorkspace 的逆操作——removeProject handler 成功后对称调用。
   *  workspaces 数组移除（未注册 ⇒ 幂等静默，与 addWorkspace 去重对称）＋归属表清该组条目
   *  ＋漂移快照按该组会话根前缀清理（过期基线残留会让重并后的 run 把「缩面期间的外部改动」
   *  误判成 drift 拒绝——缩面即弃守，重并后由 openSession/run 重建基线）。
   *  **该组有在跑会话（runControllers 有键）⇒ fail-visible throw**：在途 run 的收束基线会写进
   *  已移除的组，取消/等收束是调用方前置动作（throw 经 IPC reject 上抛 renderer，不静默缩面）。
   *  仅 main 进程内由 removeProject handler 成功后直调（同 addWorkspace，不经 IPC）；入参为
   *  canonical 绝对路径（ProjectRecord.path，与 addWorkspace 同源），本出口不重复校验。 */
  removeWorkspace(ws: string): void;
  /** 读回会话事件并登记归属/漂移基线；workspace 缺省时按归属表 → 全工作区扫描解析。
   *  返回值带 running（desktop 扩展字段，同 aborted 先例不动 ipc-protocol 必填面）：
   *  main 侧 runControllers 实况——渲染层开会对账用（换实例后旧标记没有主人，真值只在 main）。 */
  openSession(id: string, workspace?: string): Promise<{ events: AgentEvent[]; running: boolean; startedAt?: number }>;
  /** 在跑会话数（per-session runController 键数）——§3.3 退出告知闸的判据（main 内直调，不经 IPC）。 */
  runningCount(): number;
  /** 发送队列 sidecar 读回（重启恢复的数据面）；会话不存在 fail-visible。 */
  queueGet(sessionId: string): Promise<{ items: SessionQueueEntry[] }>;
  /** 覆盖写发送队列 sidecar（空数组 = 删除 sidecar）；非法载荷 fail-visible。 */
  queueSet(sessionId: string, items: SessionQueueEntry[]): Promise<{ ok: boolean; error?: string }>;
}

/** 漂移拒绝文案（计划 Global Constraints 原文，逐字）。 */
const DRIFT_ERROR = "会话已被外部修改（CLI？），请刷新后重试";

/** 漂移快照：stat 之外还记基线行数与本端事件计数锚——见 externalDrift 的归因慢路径。 */
export interface DriftSnapshot {
  size: number;
  mtimeMs: number;
  /** 基线时刻的非空行数（与本端事件一一对应：pipeline 每事件恰落一行）。 */
  lines: number;
  /** 基线时刻的 ownAppends 计数（归因减法的减数）。 */
  ownAtSnapshot: number;
  /** 取不到稳定三面时的 fail-closed 标记；下一轮必须刷新重建基线。 */
  unstable?: true;
}

/** 漂移判定的**结论**（纯函数面，便于判卷真跑这一格而不是只钉源码）。 */
export type DriftVerdict =
  /** 放行：没有外部改动。 */
  | { kind: "allow" }
  /** 放行，但基线不可信 ⇒ 先重建基线再跑（见下）。 */
  | { kind: "rebuild" }
  /** 拒绝：有外部改动的证据。 */
  | { kind: "reject" };

/** 漂移判据（纯函数）：基线 + 当前读数 + 本端归因 ⇒ 放行/重建/拒绝。
 *
 *  四条判据与它们的理由：
 *  ① **无基线** ⇒ 放行（首场 run，基线在这一轮收束时建立）。
 *  ② **文件不在场** ⇒ 拒绝（快照在而文件没了 = 外部删除）。
 *  ③ **文件自基线起逐字未动** ⇒ 放行（零 I/O 快路径）。**这条排在不稳之前**：
 *     快照不稳只说明"我们测不准"，不是"别人改了"；文件确实没动时不该被拒。
 *  ④ **基线不稳** ⇒ **重建后放行**，不是拒绝。理由见 externalDrift 的注释：
 *     旧实现在这里直接 `return true`（拒绝），而拒绝发生在 refreshSnapshot 之前
 *     ⇒ 基线永远不重建 ⇒ 会话**永久卡死**，且那句文案（"会话已被外部修改（CLI？）"）
 *     是**没有证据的指控**。实测：20MB 会话日志、本端无人写、文件逐字未动，
 *     连续两轮 run 全被这句拒绝，连它自己给的出路（"请刷新后重试"）都走不通。
 *  ⑤ **增长行数 == 本端事件数** ⇒ 增长全来自本端 ⇒ 刷新基线放行；否则拒绝。
 */
export function decideDrift(input: {
  baseline: DriftSnapshot | undefined;
  current: { size: number; mtimeMs: number } | null;
  /** 自基线以来本端追加的事件数（ownTotal - ownAtSnapshot）。 */
  ownSinceSnapshot: number;
  /** 当前的非空行数（读不到时传 null）。 */
  currentLines: number | null;
}): DriftVerdict {
  const snap = input.baseline;
  if (snap === undefined) return { kind: "allow" };
  if (input.current === null) return { kind: "reject" };
  if (input.current.size === snap.size && input.current.mtimeMs === snap.mtimeMs) return { kind: "allow" };
  if (snap.unstable === true) return { kind: "rebuild" };
  if (input.ownSinceSnapshot > 0 && input.currentLines !== null && input.currentLines === snap.lines + input.ownSinceSnapshot) {
    return { kind: "allow" };
  }
  return { kind: "reject" };
}

const SNAPSHOT_STABLE_ATTEMPTS = 8;

/** 文件三面取同一时点：stat 前后一致且本端计数未动，才把 size / lines / own 锚一起落基线。
 *  收束后的 worker 尾随写可能恰好插在 stat 与 countLines 之间；若只取一次，会把“新行数 +
 *  旧文件尺寸 + 新计数”拼成不相容的快照，下一次 run 便把自己的尾随写误判成外部修改。 */
export async function stableSessionSnapshot(
  statSession: () => Promise<{ size: number; mtimeMs: number } | null>,
  countLines: () => Promise<number | null>,
  ownAppends: () => number,
): Promise<DriftSnapshot | null> {
  let latest: DriftSnapshot | null = null;
  for (let attempt = 0; attempt < SNAPSHOT_STABLE_ATTEMPTS; attempt++) {
    const ownBefore = ownAppends();
    const before = await statSession();
    if (before === null) return null;
    const lines = await countLines();
    if (lines === null) return null;
    const after = await statSession();
    if (after === null) return null;
    const ownAfter = ownAppends();
    latest = { size: after.size, mtimeMs: after.mtimeMs, lines, ownAtSnapshot: ownAfter };
    if (ownBefore === ownAfter && before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return latest;
    }
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
  // 持续尾随写时不把最后一组读数冒充可信基线；下一轮 fail-closed，刷新后重建。
  return latest === null ? null : { ...latest, unstable: true };
}

/** 第十八遍「首条消息自动命名」（业主 21.50.54：侧栏一水「会话 2026-10-15 21:51:38」戳名）：
 *  空会话 + 标题仍是缺省（记录缺省 title=id，或无记录）⇒ 以消息提炼的短标题写 sidecar title。
 *  无记录 = CLI/外部建的会话首次在桌面里跑——写侧懒建记录（同 setPinned 的 mutate 懒建语义；
 *  读侧「不补造」契约不动，listSessions 依旧只回在场记录）。
 *  id 与 JSONL 一字不动（秒戳身份不换——渲染层活动会话、settings.currentSession、归属表都持着它）。
 *  返回落下的标题；任一门槛不满足或提炼不出（纯附件/全空白）= null（保留戳名，不硬凑）。 */
export async function autoTitleFirstMessage(
  repo: Pick<SessionMetadataRepository, "find" | "create" | "setTitle">,
  sessionId: string,
  isEmptySession: boolean,
  message: string,
): Promise<string | null> {
  if (!isEmptySession) return null;
  // P1 主界面重做：侧栏标题预算 40 宽（≈ 汉字 20 字）——旧 32 宽在侧栏里 16 个汉字就断，
  // 业主口径「标题 20 字」。只改桌面这条调用；core 缺省 32 不动（CLI/其他调用面零影响）。
  const title = deriveSessionTitle(message, 40);
  if (title === null) return null;
  const record = await repo.find(sessionId);
  // title 已是真标题（手动命名/前次自动命名落下的 title ≠ id）⇒ 永不覆盖。
  if (record !== undefined && record.title !== sessionId) return null;
  if (record === undefined) await repo.create(sessionId, title);
  else await repo.setTitle(sessionId, title);
  return title;
}

/** 工作区串真实化 + 去重（2026-10-17 真机实证的重复会话）：env 给的默认工作区可能是
 *  /tmp/x，而项目注册表存的是 realpath /private/tmp/x——同一个目录两种写法会被当成两个
 *  工作区，listSessions 把同一份会话列两遍（侧栏两行同 id）。realpath 失败（目录不存在）
 *  保留原串，让后续 IO 自己 fail-loud。纯函数导出给判卷直接钉。 */
export function canonicalWorkspacePath(ws: string): string {
  try { return realpathSync(ws); } catch { return ws; }
}

export function normalizeWorkspaces(
  workspaces: readonly string[],
  active: string,
): { workspaces: string[]; activeWorkspace: string } {
  return {
    workspaces: [...new Set(workspaces.map(canonicalWorkspacePath))],
    activeWorkspace: canonicalWorkspacePath(active),
  };
}

export function createKernelHost(deps: KernelHostDeps): KernelHost {
  const { workspaces, activeWorkspace } = normalizeWorkspaces(deps.workspaces, deps.activeWorkspace);
  if (!workspaces.includes(activeWorkspace)) {
    throw new Error(`activeWorkspace 不在 workspaces 里: ${deps.activeWorkspace}`);
  }
  // 会话根按工作区解析（spec §4.1）：与 CLI 同根 <ws>/.agent/sessions。
  // 单例 initSessionsDir 仍指 activeWorkspace：core 里 requireSessionsDir 的兜底路径
  // （压缩/调度器等未接线通道）需要一个 coherent 根；本文件的所有会话 IO 都显式传 root，不依赖它。
  const wsRoot = (ws: string) => join(ws, ".agent", "sessions");
  initSessionsDir(wsRoot(activeWorkspace));
  const sessionMetadata = requireSessionMetadata();
  // 审计是 sidecar，不是主任务：写失败明确出声，不把已成功的打开/run 反签为失败。
  // 读侧仍由 repository 抛错，坏档不能被折成空数据。
  const writeSessionAudit = async (
    id: string,
    method: "recordResumeAttempt" | "markViewed" | "markActive" | "markIdle",
  ): Promise<void> => {
    try { await sessionMetadata[method](id); }
    catch (error) {
      console.warn(`[session-audit] ${id} ${method} 写入失败（主任务继续，审计未记录）:`, error instanceof Error ? error.message : String(error));
    }
  };
  initMemoryHome(join(deps.userDataDir, "memory"));
  // settings 存储挂 userData（task-3-brief 把这一行记在 setSettingsHostDeps 名下——实测
  // settings-handlers 的存储走独立出口 initSettingsStore(filePath)，宿主依赖面另两个回调：
  // provider 判定与 run 同源（resolveProviderKind），并发上限变更转发调度器缓存（updateScheduleCap）。
  initSettingsStore(join(deps.userDataDir, "settings.json"));
  setSettingsHostDeps({ resolveProviderKind, onScheduleCapChange: updateScheduleCap });
  // 沙箱自检（与 CLI 同一份事实：`initSandbox()` 写模块级 `sandboxState`，`handleAgentRun` 读它）。
  // 为什么必须在这里做：`agent-runner.ts:788` 的缺省值是 `{ available:false, reason:"尚未自检" }`，
  // 而 `permissions/risk.ts:258` 的 `sandboxRisk` 把 `false` 读成「自检过但降级」⇒ 每一次写向工具
  // 都被抬成 risk=high ⇒ auto 档（riskAskAt 就是 high）永远送审，`auto` 档名不副实。
  // 自检失败只降级（打印一句，不抛）：宿主跑不了 Seatbelt 时行为与今天逐字相同。
  initSandbox().then(
    (s) => { if (!s.available) console.warn(`[sandbox] 自检不可用（${s.reason ?? "未自检通过"}）——写向工具将按降级送审`); },
    (err: unknown) => { console.warn(`[sandbox] 自检抛错：${err instanceof Error ? err.message : String(err)}`); },
  );

  // ---- 会话→工作区归属表（M3 T1）：createSession/openSession 登记，run 时解析（缺省 activeWorkspace）。
  const owner = new Map<string, string>();
  let sessionSeq = 0;

  // **会话归属解析器**（多根面）：core 侧那些「按会话 id 找它自己的日志」的动作
  // （存在性检查 / 改名 / 删除 / 还原事件落哪个日志）问这一个函数，而不是问单例根。
  // 旧形状（不注册 ⇒ core 落回单例根）会让**项目工作区**里的会话：
  //   ① 置顶/赞踩/归档/改名/删除一律被判成「会话不存在」（用户加一个项目文件夹就全废——
  //      而"加项目文件夹"是这产品的主入口）；
  //   ② 还原文件那一笔落进默认工作区的日志 ⇒ 侧栏多一个幽灵会话，真会话里没有这次还原
  //      ⇒ 还原不持久（重开又变回"已改"）。
  // 两处是同一个 bug 的两个出口 ⇒ 收成**一个**解析器。
  // ⚠️ 找不到就返回 null（**不回落 activeWorkspace**）：回落 = 往别人的日志里写 = 造幽灵会话。
  setSessionRootResolver(async (sessionId) => {
    const known = owner.get(sessionId);
    if (known !== undefined) return wsRoot(known);
    for (const ws of workspaces) {
      if (await sessionExists(wsRoot(ws), sessionId)) return wsRoot(ws);
    }
    return null;
  });

  // ---- 每会话取消（M3 T2）：run 启动建 per-session AbortController，经 RunOverrides.signal 注入
  //  （agent-runner.ts:1584 AbortSignal.any 并入运行信号 ⇒ 轮界 loop.ts:363 + 门等待 ask-gate.ts:92-97
  //  + 长驻工具 loop.ts:484 全语义，实测见 task-2-report 勘误裁决）；run 收束清 map。
  //  同会话并发 run 被 core 的 isSessionLogBusy 拒（第二场速死），首场的 controller 保持 canonical
  //  ——set 只在缺位时发生、清只在还是自己时发生，cancel 永远指向真正在跑的那一场。
  const runControllers = new Map<string, AbortController>();
  /** v14 用量账本的单文件缓存：跨面板开合复用，文件变了（size/mtime）才重读。 */
  const usageCache: UsageFileCache = new Map();
  // 每会话这一轮 run 的**起点**（毫秒）：渲染层换实例（HMR/重载）后秒表要接着真值算，
  // 不能从 0 起（2026-10-20 独立评审追出，LOW-MEDIUM：旧形状换实例后秒表恒读 "0s"——
  // 而 `setElapsedSec(0)` 是同值更新 ⇒ React 根本不重渲染 ⇒ 那个 0 永远冻在那儿）。
  const runStartedAt = new Map<string, number>();

  // ---- 漂移检测状态 ----
  // 快照按 logPath（=工作区×会话）记，不按裸 id：同一秒在两工作区外部建的会话 id 可同名
  // （core 撞名规避只在各自根内），按 id 记会让两个文件的基线互相覆盖。
  const drift = new Map<string, DriftSnapshot>();
  // 本端事件计数：setAppHooks.onEvent 是每一条会话 JSONL 追加的下游（agent-runner pipeline
  // 「先 log.append 后 onEvent」，agent-runner.ts:1618-1626），事件带 session_id ⇒ 每见一次
  // = 本端向该会话落了一行。用「行数守恒」区分本端尾随写与外部追加，见 externalDrift。
  // 已知局限（如实记）：计数只能按 session_id 归并——同 id 跨工作区（同秒撞名）且两流
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
  /** 刷新基线为同一稳定时点的文件三面。worker 尾随写可能插在任意两次异步读取之间，
   *  由 stableSessionSnapshot 反复取到 stat / 行数 / 本端计数都不再变化才落盘。 */
  const refreshSnapshot = async (sessionId: string, logPath: string): Promise<void> => {
    const snapshot = await stableSessionSnapshot(
      () => statSession(logPath),
      () => countLines(logPath),
      () => ownAppends.get(sessionId) ?? 0,
    );
    if (snapshot === null) {
      drift.delete(logPath); // 文件不可见 = 无从守护；下次 run 重建基线
      return;
    }
    drift.set(logPath, snapshot);
  };
  /** run 启动前的漂移判：true = 外部改动 ⇒ 拒绝。快路径 stat 全等放行；慢路径做归因——
   *  本端 worker 子流在父 run 收束后仍会落盘（实测 demo 剧本尾随写持续 ≥5s，agent-runner.ts:1624
   *  「a late worker append reopens through createEventLog」），单纯「收束即 stat」会把这部分
   *  自身增长误判成外部改动。归据：增长行数 == 快照后本端事件数 ⇒ 全部自身 ⇒ 刷新基线放行；
   *  行数对不上（含外部追加/删改/触碰）⇒ 拒绝，恢复走 openSession 重建基线（「请刷新后重试」）。 */
  const externalDrift = async (sessionId: string, logPath: string): Promise<boolean> => {
    const snap = drift.get(logPath);
    const st = await statSession(logPath);
    const ownTotal = ownAppends.get(sessionId) ?? 0;
    const own = snap === undefined ? 0 : ownTotal - snap.ownAtSnapshot;
    // 只有在可能走归因慢路径时才读行数（读整份文件很贵；快路径不该付这个钱）。
    const needLines = snap !== undefined && snap.unstable !== true && own > 0;
    const lines = needLines ? await countLines(logPath) : null;
    const verdict = decideDrift({
      baseline: snap,
      current: st,
      ownSinceSnapshot: own,
      currentLines: lines,
    });
    if (verdict.kind === "allow") {
      // 归因慢路径判定"增长全来自本端"时，基线要跟着刷新（否则下一轮又拿旧基线比）。
      if (snap !== undefined && st !== null && own > 0 && lines !== null && lines === snap.lines + own) {
        drift.set(logPath, { size: st.size, mtimeMs: st.mtimeMs, lines, ownAtSnapshot: ownTotal });
      }
      return false;
    }
    if (verdict.kind === "rebuild") {
      // 基线不稳 ⇒ 这一格我们**自己都测不出**「文件有没有被外部改过」——
      // 把它读成外部改动是**指控**（文案说"会话已被外部修改（CLI？），请刷新后重试"），
      // 而证据并不支持那个指控；更糟的是它把会话**永久卡死**：旧实现在这里直接 return true，
      // 而拒绝发生在 refreshSnapshot 之前 ⇒ 基线永远不重建 ⇒ 每一轮都撞同一句拒绝，
      // 连"刷新后重试"那条出路都走不通（实测：20MB 会话日志、本端无人写、文件逐字未动，
      // 连续两轮 run 全被这句拒绝；只有切走再切回（openSession 重建基线）才恢复）。
      // 正确处置：**重新取一次基线**（读当前状态），让这一轮从当前真相起跑；
      // 下一轮再从新基线判。重建后仍不稳（worker 还在尾随写）也照样放行——
      // 卡死比"这一轮测不出漂移"坏得多：卡死让会话彻底不可用，而尾随写是我们自己的。
      await refreshSnapshot(sessionId, logPath);
      console.warn("[drift] 基线不稳（多见于 worker 尾随写）⇒ 重建基线后放行本轮；这不是外部改动");
      return false;
    }
    return true;
  };

  /** 会话工作区解析：显式参 > 归属表 > 全工作区扫描（CLI 建的会话/进程重启后的首开）> activeWorkspace。 */
  const resolveSessionWs = async (sessionId: string, explicit?: string): Promise<string> => {
    if (explicit !== undefined) {
      const ws = canonicalWorkspacePath(explicit);
      owner.set(sessionId, ws);
      return ws;
    }
    const known = owner.get(sessionId);
    if (known !== undefined) return known;
    for (const ws of workspaces) {
      if (await sessionExists(wsRoot(ws), sessionId)) {
        owner.set(sessionId, ws);
        return ws;
      }
    }
    return activeWorkspace;
  };

  return {
    run: async (req) => {
      const sessionId = req.sessionId;
      if (sessionId === undefined) return handleAgentRun(req); // 非会话模式：临时日志，无归属无漂移无可取消缝
      const ws = await resolveSessionWs(sessionId);
      const logPath = pathOf(wsRoot(ws), sessionId);
      // 会话级 worktree 隔离（§3.7 · G4）：隔离会话的 run 工作区 = 它自己那棵 worktree
      // （工具 cwd / 写面 / 验证全在里面，主 checkout 不被并行会话踩）。会话存储**不受影响**：
      // logPath 已显式钉在主 checkout 侧，而 worktree 里的 `.agent` 是指回主 checkout 的 symlink
      // ⇒ 权限表/记忆/配置/会话根仍是同一份（这正是「配置跨面共享」那一环，缺了隔离会话就成活孤岛）。
      const runWs = (await isSessionIsolated(ws, sessionId)) ? sessionWorktreePath(ws, sessionId) : ws;
      if (await externalDrift(sessionId, logPath)) return { ok: false, error: DRIFT_ERROR };
      // canonical controller 覆盖 run 与审计收束：旧 run 的 idle 尚未写完时不接受下一代。
      // 否则 core 已释放日志、旧 finally 仍在写 sidecar，可能把新 run 标成空闲。
      if (runControllers.has(sessionId)) return { ok: false, error: "session already running or being deleted" };
      const controller = new AbortController();
      runControllers.set(sessionId, controller);
      runStartedAt.set(sessionId, Date.now());
      // 第十八遍：首条消息自动命名——空会话（0 字节）才出手；装饰性增强不挡跑（sidecar 写不上
      // 就留戳名，catch 不吞 run）。落名后 push-only 合成事件（同收束终态先例，不落 JSONL）让
      // 渲染层秒级刷新侧栏标题。**刻意排在 controller 注册之后**：demo 剧本 21ms 就收束，
      // openSession.running 的观察窗只比注册点晚几毫秒——挂点塞在注册前会把窗口整个挤掉
      // （kernel-host「收束补发合成终态」判卷实证）。
      const titled = await autoTitleFirstMessage(
        requireSessionMetadata(),
        sessionId,
        (await statSession(logPath))?.size === 0,
        req.message,
      ).catch(() => null);
      if (titled !== null) {
        deps.outbox("onEvent", { type: "session_titled", session_id: sessionId, title: titled, ts: Date.now() });
      }
      let settledOk = false;
      let accepted = false;
      let activeAudit: Promise<void> | undefined;
      try {
        const res = await handleAgentRun(req, {
          sessionId, logPath, workspace: runWs, signal: controller.signal,
          onEvent: (event) => {
            // 只有本 run 真正接收了主面用户轮才记 active；请求校验/busy 拒绝没有这拍。
            if (!accepted && event.type === "user_message" &&
              (!("agent_id" in event) || event.agent_id === undefined) && runControllers.get(sessionId) === controller) {
              accepted = true;
              activeAudit = writeSessionAudit(sessionId, "markActive");
            }
          },
        });
        settledOk = res.ok === true;
        // aborted 真值（desktop 扩展字段，不动 ipc-protocol 类型）：当且仅当本会话 controller 被 abort
        return controller.signal.aborted ? { ...res, aborted: true } : res;
      } finally {
        if (runControllers.get(sessionId) === controller) {
          await activeAudit;
          if (accepted) await writeSessionAudit(sessionId, "markIdle");
          runControllers.delete(sessionId);
          runStartedAt.delete(sessionId);
        }
        // 收束补发合成终态（push-only，不落 JSONL、不进漂移计数）：main-session 的 run 只发业务
        // 事件、从不发 agent_status——渲染层摘「运行中」只认终态 agent_status 或自家 run promise
        // 的 finally。用户切走会话后（非活动事件路径点灯）run 收束时两条路都不经过 ⇒ 运行标记
        // 永久卡住，send() 判「运行中」只入队不派发（owner 实证 2026-10-15：main 侧 cancel 已
        // 「会话不在运行」，渲染层仍在转、消息卡队列）。此推送经 deps.outbox → 全窗口到达每个
        // 活实例，任何来源的陈旧 running 标记都被摘掉；形状与 worker 的 agent_status 一致。
        deps.outbox("onEvent", {
          type: "agent_status",
          // 不带 agent_id：它是主会话终态，而渲染层把任何带 agent_id 的 agent_status 当 worker 子流
          // （isMainSessionTerminalEvent 会返回 false），运行旗永远摘不掉。
          session_id: sessionId,
          status: controller.signal.aborted ? "cancelled" : settledOk ? "done" : "failed",
          ts: Date.now(),
        });
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
      // pinned/archived/projectId 合并（第三遍真机复检勘定）：core listSessions 只在传 metadataById
      // 时合并 sidecar 组织字段；此前这里不传 ⇒ 固定/归档**写入成功但清单读回永久丢**——真机实证：
      // 行菜单点「固定」后 sidecar 已写 pinned:true，菜单文案不翻、「已固定」筛选恒空。
      // sidecar 单例根 = 装配根（上方 initSessionsDir；写路径 setPinned/setArchived 同指此根），
      // 读侧同源合并即闭环；id 为 host 级唯一（createSession 秒级定名），跨根误命中不可能。
      // 边界如实记：写入路径仍走单例根（T3 工作区切换前的既有形态），非装配根会话的组织动作在
      // 写路径 fail-loud（requireExistingSession 拒「会话不存在」），不在读侧静默造数。
      const records = await requireSessionMetadata().list();
      const metadataById = new Map(records.map((record) => [record.id, record]));
      const out: (SessionInfoPayload & { workspace: string })[] = [];
      for (const ws of workspaces) {
        // 隔离标记读侧现算（目录存在即真）：不落 sidecar、不进事件流 ⇒ 也不会有第二份会漂的状态。
        const isolated = new Set(await listIsolatedSessions(ws));
        for (const info of await listSessionsInRoot(wsRoot(ws), metadataById)) {
          out.push({ ...info, workspace: ws, ...(isolated.has(info.id) ? { isolated: true } : {}) });
        }
      }
      // 同 id 跨工作区（秒级时间戳撞名）：无法判断这份 sidecar 属于哪一边 ⇒ 两边都不套组织字段，
      // 而不是把 A 的 pinned/title 套到 B（也不能因此让所有项目会话都失去标题）。
      const counts = new Map<string, number>();
      for (const s of out) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      for (const s of out) {
        if ((counts.get(s.id) ?? 0) > 1) {
          const mutable = s as unknown as Record<string, unknown>;
          delete mutable.title;
          delete mutable.pinned;
          delete mutable.archived;
          delete mutable.projectId;
          delete mutable.viewedAt;
          delete mutable.archivedAt;
          delete mutable.idleSince;
          delete mutable.resumeAttempts;
        }
      }
      return out;
    },
    usageLedger: async () => {
      // 只读扫描：不 openSession（那条路会补崩溃终态、刷新漂移基线——看用量不该写状态）。
      // 侧栏 sidecar（pins/feedback）由 listSessionsInRoot 的首行形状判定挡掉，不在本函数里重抄一套。
      try {
        // 评审修：不再经 listSessions（它会整份读文件数行）也不读 metadata（这里根本用不上）。
        const totals = emptyUsageTotals();
        const seenWorkspaces = new Set<string>();
        let sessions = 0;
        let skipped = 0;
        let badLines = 0;
        for (const ws of workspaces) {
          const root = wsRoot(ws);
          const ids = await listSessionIds(root);
          for (const id of ids) {
            sessions += 1;
            seenWorkspaces.add(ws);
            try {
              const scan = await scanUsageFile(pathOf(root, id), usageCache);
              addUsageTotals(totals, scan.totals);
              badLines += scan.badLines;
            } catch {
              // 单个会话读不了（权限/删除竞态/损坏）不拖垮整本账：计数后如实上报。
              skipped += 1;
            }
          }
        }
        return { ok: true, totals, sessions, workspaces: seenWorkspaces.size, skipped, badLines };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    // v18：会话**正文**全文检索（只读）。逐工作区扫会话 JSONL——结果三态由 core 判别式联合给出
    // （ok / partial / unavailable），这里**不重写**那套语义，也不把 unavailable 折成空数组：
    // 「没量到」必须一路传到渲染层，否则界面会说「没有匹配」——那是谎报。
    sessionSearch: async (workspace, query, options) => {
      // 工作区归属由 host 自己判：渲染层传的是工作区名，不是路径（路径面是泄露面）。
      const known = workspaces.find((ws) => ws === workspace);
      if (known === undefined) {
        return { kind: "unavailable", reason: "workspace-unknown", detail: `工作区未登记：${workspace}` };
      }
      const records = await requireSessionMetadata().list();
      const metadataById = new Map(records.map((record) => [record.id, record]));
      return await searchSessions({
        root: wsRoot(known),
        query,
        metadataById,
        ...(options?.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
        ...(options?.maxSessions !== undefined ? { maxSessions: options.maxSessions } : {}),
      });
    },
    sessionLog: async (id, tailLines) => {
      try {
        const ws = await resolveSessionWs(id);
        const root = wsRoot(ws);
        // 只认**真会话**：只读该文件首行判 sidecar（评审修：不要为看一眼日志扫全目录数行）。
        if (!(await isSessionInRoot(root, id))) return { ok: false, error: `会话不存在: ${id}` };
        const path = pathOf(root, id);
        const tail = await readSessionLogTail(path, tailLines);
        return { ok: true, path, ...tail };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    sessionWorktree: async (req) => {
      const kind = req.kind;
      const sessionId = req.sessionId;
      // 在跑就拒（fail-visible）：合并/丢弃会动这棵树与主 checkout，run 正在里面写。
      if (runControllers.has(sessionId)) {
        return { ok: false, error: "这条会话正在运行——先等它收束或取消，再动它的工作区" };
      }
      const ws = await resolveSessionWs(sessionId);
      if (kind === "create") {
        const r = await createSessionWorktree(ws, sessionId, req.title?.trim() || sessionId);
        if (r.ok) console.log(`[worktree] 会话 ${sessionId} 已隔离：${r.path ?? "?"}（分支 ${r.branch ?? "?"}）`);
        return r;
      }
      if (kind === "merge") {
        const r = await mergeSessionWorktree(ws, sessionId);
        if (r.ok) console.log(`[worktree] 会话 ${sessionId} 已合并回主 checkout（${r.branch ?? "?"}）`);
        else if (r.conflict === true) console.warn(`[worktree] 会话 ${sessionId} 合并冲突：${(r.conflictedFiles ?? []).join("、")}`);
        else console.warn(`[worktree] 会话 ${sessionId} 合并失败：${r.error ?? "未知原因"}`);
        return r;
      }
      return await discardSessionWorktree(ws, sessionId);
    },
    addWorkspace: (wsInput) => {
      // 动态并入扫描面（M3-3 修复轮）：唯一调用方是 main 进程 addProject handler（registry.add
      // 成功后传 canonical realpath）。去重幂等——workspaces 数组被 listSessions/resolveSessionWs
      // 闭包按引用迭代，重复 push 会让新工作区被逐根扫描两遍、清单出重复条目。
      // 2026-10-17：入参也先 realpath，防调用方给 symlink/非 canonical 串绕过去重。
      const ws = canonicalWorkspacePath(wsInput);
      if (workspaces.includes(ws)) return;
      workspaces.push(ws);
    },
    removeWorkspace: (wsInput) => {
      const ws = canonicalWorkspacePath(wsInput);
      // 在跑拒绝（M4-5 fail-visible）：该组任一会话仍在 run（runControllers 有键）⇒ 拒绝缩面。
      // 判据走归属表（owner: sid→ws，run 启动时已登记）——按 sid 逐个对组，命中即 throw。
      for (const sid of runControllers.keys()) {
        if (owner.get(sid) === ws) {
          throw new Error(`工作区有正在运行的会话，无法移除: ${ws}`);
        }
      }
      const i = workspaces.indexOf(ws);
      if (i >= 0) workspaces.splice(i, 1); // 未注册 = 幂等（与 addWorkspace 去重对称）
      for (const [sid, w] of owner) if (w === ws) owner.delete(sid); // 归属表清该组
      // 漂移基线按 logPath 前缀（= 该组会话根 <ws>/.agent/sessions/）清理；Map 迭代中删当前键安全。
      const prefix = `${wsRoot(ws)}${sep}`;
      for (const logPath of drift.keys()) {
        if (logPath.startsWith(prefix)) drift.delete(logPath);
      }
    },
    createSession: async (workspace) => {
      const ws = canonicalWorkspacePath(workspace ?? activeWorkspace);
      // M3 终审（Important）：显式 workspace 加白名单校验——与构造期 activeWorkspace 校验同式
      // fail-visible。清单含 addWorkspace 动态并入（addProject 成功后），合法增量不被误拒；
      // 未注册路径在 mkdir 之前就被拒，IPC 注入面（任意路径凭空建 .agent/sessions）收口。
      if (!workspaces.includes(ws)) {
        throw new Error(`workspace 不在 workspaces 里: ${ws}`);
      }
      // ---- host 级 id 唯一（T1 审查强制前置，T3 收口）----
      // core createSession 缺省名只到秒、撞名规避只在各自根内（stat 同根文件）⇒ 同秒跨工作区
      // 两建可能返回同名 id，归属表「后建覆盖先建」，先建会话的 run/open 被路由到后建工作区
      // （task-1-report Concern 2；核验结论：T1 的「create 返回后立即 owner.set」不解歧——
      // id 本身同名时覆盖照旧发生）。修法（T1 审查建议：name 参传自定义名避开分钟粒度）：
      // 秒级时间戳 ＋ host 内单调序号；「查重→占位」是同步段（无 await 夹缝），并发同秒
      // 两建也必分先手。序号让每个请求名跨根不同，避免 core 对两根本地残留加出同一后缀。
      const p2 = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const stamp = `会话 ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} `
        + `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
      const serial = ++sessionSeq;
      let name = `${stamp} #${String(serial)}`;
      for (let n = 2; owner.has(name); n++) name = `${stamp} #${String(serial)} (${n})`;
      owner.set(name, ws); // 占位：键先于盘上文件在场，键面即保证 host 级唯一
      try {
        const id = await createSessionInRoot(wsRoot(ws), name);
        if (id !== name) {
          owner.delete(name); // 根内序号避让改写了名（盘上残留撞名）：以返回 id 为准
          if (owner.has(id)) {
            await rm(pathOf(wsRoot(ws), id), { force: true }).catch(() => undefined);
            throw new Error(`会话 ID 冲突，已拒绝覆盖: ${id}`);
          }
          owner.set(id, ws);
        }
        return { id };
      } catch (error) {
        owner.delete(name); // 建失败不留幽灵占位
        throw error;
      }
    },
    // §3.3 退出告知闸判据（main 内直调）：在跑 run 的 per-session controller 键数。
    runningCount: () => runControllers.size + scheduledRunCount(),
    openSession: async (id, workspace) => {
      const ws = await resolveSessionWs(id, workspace);
      const root = wsRoot(ws);
      if (!(await sessionExists(root, id))) throw new Error(`会话不存在: ${id}`);
      await writeSessionAudit(id, "recordResumeAttempt");
      const logPath = pathOf(root, id);
      // M3c 崩溃恢复随开随扫（M2 handleSessionOpen 同语义，显式 logPath 化——补发的 failed(interrupted)
      // 不经 onEvent 通道，但在下面的基线刷新之后落盘 ⇒ 计入基线，不污染归因）。
      await applyCrashRecovery(logPath);
      const events = await readSessionEvents(root, id);
      await refreshSnapshot(id, logPath); // open 即基线（含补发行）
      await writeSessionAudit(id, "markViewed");
      // running 实况（desktop 扩展字段）：渲染层开会对账——换实例后的新渲染层靠这条把陈旧的
      // 「运行中」标记收敛到 main 真值（真在跑 ⇒ 补上；已收束 ⇒ 摘掉）。收束补发终态是正路，
      // 这条是开一条会话就自愈一次的兜底（两者互不依赖）。
      // startedAt：这一轮 run 的起点（渲染层换实例后秒表接着真值算；不在场 = 起点未知）
      return { events, running: runControllers.has(id), startedAt: runStartedAt.get(id) };
    },
    queueGet: async (sessionId) => {
      const ws = await resolveSessionWs(sessionId);
      const root = wsRoot(ws);
      if (!(await sessionExists(root, sessionId))) throw new Error(`会话不存在: ${sessionId}`);
      return { items: await readSessionQueue(root, sessionId) };
    },
    queueSet: async (sessionId, items) => {
      const ws = await resolveSessionWs(sessionId);
      const root = wsRoot(ws);
      if (!(await sessionExists(root, sessionId))) throw new Error(`会话不存在: ${sessionId}`);
      try {
        await writeSessionQueue(root, sessionId, items);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
