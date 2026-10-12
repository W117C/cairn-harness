import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createEventLog, forkSession, replay, type AgentEvent } from "../events";
import { forkPointOf, forkSessionName } from "../agent/fork-cli";
import { applyTurnRevert, planTurnRevert, type FileRevertResult } from "../agent/file-revert";
import { getLastWorkspace } from "./runner-workspace";
import { interruptedWorkers, respawnArgsFrom } from "../agent/recovery";
import {
  createSession,
  deleteSession,
  isValidSessionName,
  listSessions,
  pathOf,
  readSessionEvents,
  renameSession,
  sessionExists,
  type SessionInfo,
} from "./sessions";
import { ProjectRegistry, type AddProjectInput, type ProjectRecord } from "./project-registry";
import { SessionMetadataRepository, type SessionMetadataRecord } from "./session-metadata";
import { FeedbackStore, type FeedbackRating, type ResolvedFeedback } from "./feedback";
import { store } from "./settings-handlers";

// ---- M1e：会话列表 IPC（会话目录由 index.ts 初始化；headless 脚本未初始化 → 未配置错误） ----
let sessionsDir: string | null = null;
let projects: ProjectRegistry | null = null;
let metadata: SessionMetadataRepository | null = null;
let feedback: FeedbackStore | null = null;

export interface SessionRepositoryPaths {
  projectRegistryPath?: string;
  sessionMetadataPath?: string;
  /** 用户反馈 sidecar（赞/踩）；缺省 `<sessions>/feedback.jsonl`。 */
  feedbackPath?: string;
}

/** shell 启动时初始化会话目录与 CX-01 组织仓库。生产路径由 userData 显式传入。 */
export function initSessionsDir(dir: string, paths: SessionRepositoryPaths = {}): void {
  sessionsDir = dir;
  projects = new ProjectRegistry(paths.projectRegistryPath ?? join(dir, "projects.json"));
  metadata = new SessionMetadataRepository(paths.sessionMetadataPath ?? join(dir, "session-metadata.json"));
  feedback = new FeedbackStore(paths.feedbackPath ?? join(dir, "feedback.jsonl"));
}

/** 只读访问会话目录（未初始化 = null）：调度器的 emitTimeline 需要「有目录才落盘」的判定。 */
export function getSessionsDir(): string | null {
  return sessionsDir;
}

export function requireSessionsDir(): string {
  if (!sessionsDir) throw new Error("会话目录未初始化（shell 未启动？）");
  return sessionsDir;
}

export function requireProjectRegistry(): ProjectRegistry {
  if (!projects) throw new Error("项目注册表未初始化（shell 未启动？）");
  return projects;
}

export function requireSessionMetadata(): SessionMetadataRepository {
  if (!metadata) throw new Error("会话元数据仓库未初始化（shell 未启动？）");
  return metadata;
}

export function requireFeedbackStore(): FeedbackStore {
  if (!feedback) throw new Error("反馈仓库未初始化（shell 未启动？）");
  return feedback;
}

export async function handleSessionList(): Promise<SessionInfo[]> {
  const records = await requireSessionMetadata().list();
  return await listSessions(requireSessionsDir(), new Map(records.map((record) => [record.id, record])));
}

export async function handleSessionCreate(name?: string): Promise<{ id: string }> {
  return { id: await createSession(requireSessionsDir(), name, requireSessionMetadata()) };
}

/** 切换会话：settings.currentSession 落盘（重启还原）；返回该会话全部事件（重放投影）。
 *  M3c 崩溃恢复（§4.4.9）：重开即扫描无终态 worker → 补发 failed(interrupted) + 恢复卡载荷
 *  （幂等：补发即有终态，重扫不再命中；V1 不做热恢复，重派 = 全新 agent_id）。 */
export async function handleSessionOpen(id: string): Promise<{ events: AgentEvent[] }> {
  const dir = requireSessionsDir();
  if (!(await sessionExists(dir, id))) throw new Error(`会话不存在: ${id}`);
  await store().set({ currentSession: id });
  const logPath = pathOf(dir, id);
  await applyCrashRecovery(logPath);
  return { events: await readSessionEvents(dir, id) };
}

/** M3c 崩溃恢复扫描 + 补发（§4.4.9）：无终态 worker → failed(interrupted) + 恢复卡（respawn 载荷）。
 *  纯投影层模拟口径（裁决 5）：headless 验收直接对本函数断言；UI 走 session:open 同路。 */
export async function applyCrashRecovery(logPath: string, emit?: (e: AgentEvent) => Promise<void>): Promise<string[]> {
  const events = await replay(logPath).catch(() => [] as AgentEvent[]);
  const interrupted = interruptedWorkers(events);
  if (interrupted.length === 0) return [];
  const out: string[] = [];
  const sink = emit ?? (async (e: AgentEvent) => { await createEventLog(logPath).append(e); });
  for (const iw of interrupted) {
    const respawn = respawnArgsFrom(iw.spawned);
    const ts = Date.now();
    await sink({ type: "agent_status", agent_id: iw.agentId, status: "failed", reason: "interrupted", ts } as AgentEvent);
    await sink({
      type: "agent_result",
      agent_id: iw.agentId,
      status: "failed",
      reason: "interrupted",
      summary:
        "[recovery] 崩溃恢复：该 worker 上次会话被中断（重启扫描无终态事件）。" +
        "可在恢复卡「重派」（全新 agent_id 按原 spawn 参数再 spawn，V1 无热恢复）或忽略。" +
        "write worker 的旧 worktree 走孤儿列表（可清理，不自动删）。",
      artifacts: {
        report: "[recovery] interrupted（无终态事件；重派参数见 artifacts.respawn）",
        respawn,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      tool_stats: {},
    } as AgentEvent);
    out.push(iw.agentId);
  }
  return out;
}

export async function handleSessionRename(oldId: string, newName: string): Promise<{ id: string }> {
  const dir = requireSessionsDir();
  const id = await renameSession(dir, oldId, newName, requireSessionMetadata());
  const cur = await store().get();
  if (cur.currentSession === oldId) await store().set({ currentSession: id });
  return { id };
}

/** 删除会话：若删的是当前会话 → 回退到最近一个（列表 mtime 降序首个）；无会话 → null。 */
export async function handleSessionDelete(id: string): Promise<{ currentSession: string | null }> {
  const dir = requireSessionsDir();
  await deleteSession(dir, id, requireSessionMetadata());
  const cur = await store().get();
  if (cur.currentSession !== id) return { currentSession: cur.currentSession };
  const rest = await listSessions(dir);
  const next = rest[0]?.id ?? null;
  await store().set({ currentSession: next });
  return { currentSession: next };
}

/** M8 分叉 IPC 接线（v2.15）：保留前 N 轮（含）→ 新会话 `<id>-f<N>`；源会话只读、字节不变。
 *  与 CLI `--fork --from` 同口径（「轮」以 user_message 为界；`forkPointOf` 是唯一算术源，
 *  与 `forkSessionName` 同层复用——不抄第二份算术）。目标已存在 ⇒ fail-visible 不覆盖既有转录；
 *  半成品经 scrub 目录 rename 收口（forkSession 写 `<dir>/events.jsonl`，会话文件命名是 `<id>.jsonl`）。 */
export async function handleSessionFork(
  sessionId: string,
  round: number,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const dir = requireSessionsDir();
  if (!(await sessionExists(dir, sessionId))) return { ok: false, error: `源会话不存在：${sessionId}` };
  const srcPath = pathOf(dir, sessionId);
  let events: AgentEvent[];
  try {
    events = await replay(srcPath);
  } catch (err) {
    return { ok: false, error: `读源会话失败：${err instanceof Error ? err.message : String(err)}` };
  }
  const point = forkPointOf(events, round);
  if ("error" in point) return { ok: false, error: point.error };
  const newId = forkSessionName(sessionId, round);
  if (!isValidSessionName(newId)) return { ok: false, error: `分叉出的会话名非法（多半过长）：${newId}` };
  const target = pathOf(dir, newId);
  if (existsSync(target)) return { ok: false, error: `目标会话已存在：${newId}（不覆盖既有转录）` };
  const scratch = join(dir, ".fork-" + newId);
  const made = await forkSession(srcPath, String(point.lastIncluded), scratch);
  await rename(made.eventsPath, target);
  await rm(scratch, { recursive: true, force: true });
  return { ok: true, id: newId };
}

/** #7 文件级回滚（v2.16 IPC 接线）：把某一轮主会话在**用户真实工作区**改过的文件还原成那一轮之前的原件。
 *  原件只从 `tool_result.snapshotId`（D7 覆盖前快照）取——那是唯一结构化、且能对上"哪一轮"的源；
 *  计划与落实全在 `src/agent/file-revert.ts`（纯函数 + fs，可离线判卷），这里只做会话定位与接线。
 *  工作区取"最近一次 run 的工作区"（`getLastWorkspace`）：没有它就无法把相对路径落到盘上 ⇒ fail-visible，
 *  绝不拿一个内置靶子目录冒充用户工作区去删文件。 */
export async function handleSessionRevert(
  sessionId: string,
  round: number,
): Promise<FileRevertResult & { ok: boolean; error?: string }> {
  const empty: FileRevertResult = { restored: [], deleted: [], manual: [], failed: [] };
  const dir = requireSessionsDir();
  if (!(await sessionExists(dir, sessionId))) return { ok: false, error: `会话不存在：${sessionId}`, ...empty };
  const workspace = getLastWorkspace();
  if (workspace === null) return { ok: false, error: "没有已知的工作区（本进程还没跑过 run）⇒ 无法定位要回滚的文件", ...empty };
  let events: AgentEvent[];
  try {
    events = await replay(pathOf(dir, sessionId));
  } catch (err) {
    return { ok: false, error: `读会话失败：${err instanceof Error ? err.message : String(err)}`, ...empty };
  }
  const plan = planTurnRevert(events, round);
  if ("error" in plan) return { ok: false, error: plan.error, ...empty };
  if (plan.entries.length === 0) {
    return { ok: false, error: `第 ${String(round)} 轮没有可回滚的文件改动（这一轮没写过盘，或改动都取不到覆盖前原件）`, ...empty };
  }
  const r = await applyTurnRevert(workspace, plan);
  return { ok: true, ...r };
}

// ---- 用户反馈（v2.16）：赞/踩的沉淀面（sidecar，不进事件流）----

/** 提交或撤销一条反馈。`rating:"none"` = 撤销（append-only：不删旧记录，读时取最后一条生效）。 */
export async function handleFeedbackSubmit(req: {
  sessionId: string;
  eventId: number;
  rating: FeedbackRating;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireExistingSession(req.sessionId);
    await requireFeedbackStore().append({
      sessionId: req.sessionId,
      eventId: req.eventId,
      rating: req.rating,
      ...(req.note !== undefined ? { note: req.note } : {}),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 某会话当前生效的反馈（界面据此点亮赞/踩）。 */
export async function handleFeedbackList(sessionId: string): Promise<ResolvedFeedback[]> {
  return await requireFeedbackStore().listForSession(sessionId);
}

// ---- CX-01：项目注册表 + Session-plane 组织记录 ----
// pin/archive/project assignment 只写 sidecar repository，绝不追加 AgentEvent：它们不是模型业务事实，
// 也不得让同一会话的 live 与 replay 因 UI 组织动作产生差异。

export async function handleProjectList(): Promise<ProjectRecord[]> {
  return await requireProjectRegistry().list();
}

export async function handleProjectAdd(input: AddProjectInput): Promise<ProjectRecord> {
  return await requireProjectRegistry().add(input);
}

export async function handleProjectRemove(id: string): Promise<ProjectRecord> {
  return await requireProjectRegistry().remove(id);
}

async function requireExistingSession(id: string): Promise<void> {
  if (!(await sessionExists(requireSessionsDir(), id))) throw new Error(`会话不存在: ${id}`);
}

export async function handleSessionSetPinned(id: string, pinned: boolean): Promise<SessionMetadataRecord> {
  await requireExistingSession(id);
  return await requireSessionMetadata().setPinned(id, pinned);
}

export async function handleSessionSetArchived(id: string, archived: boolean): Promise<SessionMetadataRecord> {
  await requireExistingSession(id);
  return await requireSessionMetadata().setArchived(id, archived);
}

export async function handleSessionAssignProject(id: string, projectId: string | null): Promise<SessionMetadataRecord> {
  await requireExistingSession(id);
  if (projectId !== null) await requireProjectRegistry().getActive(projectId);
  return await requireSessionMetadata().assignProject(id, projectId);
}
