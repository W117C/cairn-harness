import { join } from "node:path";
import { createEventLog, replay, type AgentEvent } from "../events";
import { interruptedWorkers, respawnArgsFrom } from "../agent/recovery";
import {
  createSession,
  deleteSession,
  listSessions,
  pathOf,
  readSessionEvents,
  renameSession,
  sessionExists,
  type SessionInfo,
} from "./sessions";
import { ProjectRegistry, type AddProjectInput, type ProjectRecord } from "./project-registry";
import { SessionMetadataRepository, type SessionMetadataRecord } from "./session-metadata";
import { store } from "./settings-handlers";

// ---- M1e：会话列表 IPC（会话目录由 index.ts 初始化；headless 脚本未初始化 → 未配置错误） ----
let sessionsDir: string | null = null;
let projects: ProjectRegistry | null = null;
let metadata: SessionMetadataRepository | null = null;

export interface SessionRepositoryPaths {
  projectRegistryPath?: string;
  sessionMetadataPath?: string;
}

/** shell 启动时初始化会话目录与 CX-01 组织仓库。生产路径由 userData 显式传入。 */
export function initSessionsDir(dir: string, paths: SessionRepositoryPaths = {}): void {
  sessionsDir = dir;
  projects = new ProjectRegistry(paths.projectRegistryPath ?? join(dir, "projects.json"));
  metadata = new SessionMetadataRepository(paths.sessionMetadataPath ?? join(dir, "session-metadata.json"));
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
