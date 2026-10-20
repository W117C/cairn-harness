// CX-01 Session Metadata：JSONL 仍是会话事实核心；pin/archive/project 只是 Session 平面组织记录。
// 本仓库刻意不追加业务事件：置顶/归档不是 agent 行为，重放它们会污染 live/replay 等价性。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";

const SCHEMA_VERSION = 1 as const;
const MAX_SESSION_ID_LENGTH = 80;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;

export interface SessionMetadataRecord {
  /** 与主会话 JSONL 的 id 一致；这里不存事件内容。 */
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  projectId?: string;
  /** sidecar 记录首次建立时间；老会话首次被组织时也以真实建档时间为准，不反推虚构创建时刻。 */
  createdAt: string;
  updatedAt: string;
}

interface SessionMetadataState {
  version: typeof SCHEMA_VERSION;
  sessions: Record<string, SessionMetadataRecord>;
}

export interface SessionMetadataRepositoryOptions {
  now?: () => Date;
}

export class SessionMetadataCorruptError extends Error {
  constructor(filePath: string, reason: string) {
    super(`会话元数据损坏，已拒绝覆盖: ${filePath} (${reason})`);
    this.name = "SessionMetadataCorruptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    value.trim() === value &&
    !value.startsWith(".") &&
    !/[\\/\u0000-\u001f\u007f]/.test(value)
  );
}

function isProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROJECT_ID_LENGTH &&
    value.trim() === value &&
    !/[\\/\u0000-\u001f\u007f]/.test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function assertSessionId(value: unknown): asserts value is string {
  if (!isSessionId(value)) throw new Error(`会话 metadata id 非法: ${JSON.stringify(value)}`);
}

function assertTitle(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TITLE_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`会话 title 非法：须为 1–${MAX_TITLE_LENGTH} 个无首尾空白/控制字符的字符`);
  }
}

function validateMetadata(raw: unknown, key: string): SessionMetadataRecord {
  if (!isRecord(raw)) throw new Error(`sessions.${key} 不是对象`);
  assertSessionId(raw.id);
  if (raw.id !== key) throw new Error(`sessions.${key}.id 与键不一致`);
  assertTitle(raw.title);
  if (typeof raw.pinned !== "boolean") throw new Error(`sessions.${key}.pinned 非法`);
  if (typeof raw.archived !== "boolean") throw new Error(`sessions.${key}.archived 非法`);
  if (raw.projectId !== undefined && !isProjectId(raw.projectId)) throw new Error(`sessions.${key}.projectId 非法`);
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) throw new Error(`sessions.${key} 时间戳非法`);

  return {
    id: raw.id,
    title: raw.title,
    pinned: raw.pinned,
    archived: raw.archived,
    ...(raw.projectId !== undefined ? { projectId: raw.projectId } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function validateState(raw: unknown): SessionMetadataState {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !isRecord(raw.sessions)) {
    throw new Error("根对象/version/sessions 结构非法");
  }
  const sessions = Object.create(null) as Record<string, SessionMetadataRecord>;
  for (const [key, value] of Object.entries(raw.sessions)) sessions[key] = validateMetadata(value, key);
  return { version: SCHEMA_VERSION, sessions };
}

function emptyState(): SessionMetadataState {
  return { version: SCHEMA_VERSION, sessions: Object.create(null) as Record<string, SessionMetadataRecord> };
}

function cloneMetadata(record: SessionMetadataRecord): SessionMetadataRecord {
  return { ...record };
}

/** 原子、进程内串行的会话 sidecar。缺文件 = 空默认；损坏文件显式失败，绝不重置成假的新状态。 */
export class SessionMetadataRepository {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(
    private readonly filePath: string,
    options: SessionMetadataRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<SessionMetadataRecord[]> {
    const state = await this.load();
    return Object.values(state.sessions)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(cloneMetadata);
  }

  async find(id: string): Promise<SessionMetadataRecord | undefined> {
    assertSessionId(id);
    const state = await this.load();
    const record = Object.prototype.hasOwnProperty.call(state.sessions, id) ? state.sessions[id] : undefined;
    return record ? cloneMetadata(record) : undefined;
  }

  async get(id: string): Promise<SessionMetadataRecord> {
    const record = await this.find(id);
    if (!record) throw new Error(`会话 metadata 不存在: ${id}`);
    return record;
  }

  async create(id: string, title: string = id, projectId?: string): Promise<SessionMetadataRecord> {
    return await this.enqueue(async () => {
      assertSessionId(id);
      assertTitle(title);
      if (projectId !== undefined && !isProjectId(projectId)) throw new Error(`会话 projectId 非法: ${JSON.stringify(projectId)}`);
      const state = await this.load();
      if (Object.prototype.hasOwnProperty.call(state.sessions, id)) throw new Error(`会话 metadata 已存在: ${id}`);

      const now = this.timestamp();
      const record: SessionMetadataRecord = {
        id,
        title,
        pinned: false,
        archived: false,
        ...(projectId !== undefined ? { projectId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      state.sessions[id] = record;
      await this.persist(state);
      return cloneMetadata(record);
    });
  }

  async setPinned(id: string, pinned: boolean): Promise<SessionMetadataRecord> {
    if (typeof pinned !== "boolean") throw new Error(`会话 pinned 非法: ${JSON.stringify(pinned)}`);
    return await this.mutate(id, (record) => ({ ...record, pinned }));
  }

  async setArchived(id: string, archived: boolean): Promise<SessionMetadataRecord> {
    if (typeof archived !== "boolean") throw new Error(`会话 archived 非法: ${JSON.stringify(archived)}`);
    return await this.mutate(id, (record) => ({ ...record, archived }));
  }

  async assignProject(id: string, projectId: string | null): Promise<SessionMetadataRecord> {
    if (projectId !== null && !isProjectId(projectId)) throw new Error(`会话 projectId 非法: ${JSON.stringify(projectId)}`);
    return await this.mutate(id, (record) => {
      if (projectId === null) {
        const { projectId: _removed, ...withoutProject } = record;
        return withoutProject;
      }
      return { ...record, projectId };
    });
  }

  async rename(oldId: string, newId: string, title: string = newId): Promise<SessionMetadataRecord | null> {
    return await this.enqueue(async () => {
      assertSessionId(oldId);
      assertSessionId(newId);
      assertTitle(title);
      const state = await this.load();
      const existing = Object.prototype.hasOwnProperty.call(state.sessions, oldId) ? state.sessions[oldId] : undefined;
      if (!existing) return null;
      if (oldId !== newId && Object.prototype.hasOwnProperty.call(state.sessions, newId)) {
        throw new Error(`会话 metadata 目标已存在: ${newId}`);
      }
      const now = this.timestamp();
      const renamed: SessionMetadataRecord = { ...existing, id: newId, title, updatedAt: now };
      delete state.sessions[oldId];
      state.sessions[newId] = renamed;
      await this.persist(state);
      return cloneMetadata(renamed);
    });
  }

  async remove(id: string): Promise<boolean> {
    return await this.enqueue(async () => {
      assertSessionId(id);
      const state = await this.load();
      if (!Object.prototype.hasOwnProperty.call(state.sessions, id)) return false;
      delete state.sessions[id];
      await this.persist(state);
      return true;
    });
  }

  /** 供 JSONL 硬删除事务回滚使用；正常用户动作不调用。 */
  async restore(record: SessionMetadataRecord): Promise<SessionMetadataRecord> {
    return await this.enqueue(async () => {
      const validated = validateMetadata(record, record?.id);
      const state = await this.load();
      const existing = Object.prototype.hasOwnProperty.call(state.sessions, validated.id)
        ? state.sessions[validated.id]
        : undefined;
      if (existing !== undefined) {
        if (JSON.stringify(existing) === JSON.stringify(validated)) return cloneMetadata(validated);
        throw new Error(`会话 metadata 回滚冲突: ${validated.id}`);
      }
      state.sessions[validated.id] = validated;
      await this.persist(state);
      return cloneMetadata(validated);
    });
  }

  private async mutate(
    id: string,
    update: (record: SessionMetadataRecord) => SessionMetadataRecord,
  ): Promise<SessionMetadataRecord> {
    return await this.enqueue(async () => {
      assertSessionId(id);
      const state = await this.load();
      const now = this.timestamp();
      const current: SessionMetadataRecord = Object.prototype.hasOwnProperty.call(state.sessions, id)
        ? state.sessions[id]
        : {
            id,
            title: id,
            pinned: false,
            archived: false,
            createdAt: now,
            updatedAt: now,
          };
      const next = { ...update(current), updatedAt: now };
      state.sessions[id] = next;
      await this.persist(state);
      return cloneMetadata(next);
    });
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("会话 metadata 时钟非法");
    return value.toISOString();
  }

  private async load(): Promise<SessionMetadataState> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new SessionMetadataCorruptError(this.filePath, "JSON.parse 失败");
    }
    try {
      return validateState(raw);
    } catch (error) {
      throw new SessionMetadataCorruptError(this.filePath, error instanceof Error ? error.message : String(error));
    }
  }

  private async persist(state: SessionMetadataState): Promise<void> {
    await writeFileAtomic(this.filePath, JSON.stringify(state, null, 2) + "\n");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
