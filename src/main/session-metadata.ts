// CX-01 Session Metadata：JSONL 仍是会话事实核心；pin/archive/project 只是 Session 平面组织记录。
// 本仓库刻意不追加业务事件：置顶/归档不是 agent 行为，重放它们会污染 live/replay 等价性。
//
// ============================ 边界（本文件最重要的一段）============================
// **sidecar 记录，不是事件**：这里存的是「会话平面」的组织/审计事实（标题、置顶、归档、项目归属、
// 最后查看/归档/空闲时刻、恢复次数）。它们**一律不进会话事件流**，也**不新增事件种类**——
// 理由与 pin/archive 一致：重放这些 UI/审计动作会污染 live/replay 等价性，也会让「模型做了什么」
// 与「用户在界面上点了什么」混成同一件事。
// **事实分工**：会话里发生了什么 = JSONL（唯一真身）；会话被怎么组织/审阅过 = 本 sidecar。
// **「最后活动」的真身只有一个**：`updatedAt`（= 本 sidecar 的最后一次写入时刻）。
//   - 本文件**不**另立 `lastActivityAt`：两个都叫「最后活动」的字段迟早分叉，读的人还得猜信哪个。
//   - 对话本身的最后活动时间不在这里——那是 JSONL 的 mtime（`listSessions()` 的 `mtimeMs`），
//     两件不同的事不互相冒充。
// ============================ 缺席 ≠ 0（审计面的读法）============================
// 审计字段**全部可选**，且**缺席一律不读成 0 / false / epoch 0**：
//   · viewedAt 缺席      = **从未被查看过**（不是「查看于 1970 年」）
//   · archivedAt 缺席    = 归档时刻**未记录**（旧记录；且 archived=false 时我们会把这一格摘掉）
//   · idleSince 缺席     = **没有空闲记录**（还在跑，或从未记过）
//   · resumeAttempts 缺席 = **未记录（未知）**——与 `0`（记过、一次都没恢复过）是**两态**，
//     把「未知」读成 0 就是把「没量到」说成「没有」。要数字请用 `resumeAttemptsOf()`（缺省 undefined）。
// 老 sidecar（本次改动之前写的）原样加载，新字段**保持缺席**（不补默认值）——`SCHEMA_VERSION` 不动。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";

const SCHEMA_VERSION = 1 as const;
const MAX_SESSION_ID_LENGTH = 80;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;

/**
 * 审计面（四个字段**全部可选**：缺席 = 没记录过，不许读成 0/false/epoch 0）。
 * 时刻一律 ISO 字符串（本文件既有 `createdAt`/`updatedAt` 的口径，不另立一套纪元）。
 */
export interface SessionAuditFields {
  /** 最后一次被打开/查看的时刻（ISO）。**缺席 = 从未被查看过。** */
  viewedAt?: string;
  /**
   * 归档时刻（ISO）。只在 `archived === true` 时有意义：取消归档时这一格被**摘掉**
   * （留着一个归档时刻却 archived=false ⇒ 两格互相矛盾，读的人得猜信哪个）。
   * 缺席 + archived=true = 归档时刻**未记录**（本次改动之前归档的旧记录）。
   */
  archivedAt?: string;
  /** 最后一次进入空闲的时刻（ISO）。**缺席 = 没有空闲记录**（还在跑，或从未记过）。 */
  idleSince?: string;
  /**
   * 恢复（打开）次数。**缺席 = 未记录（未知）**；`0` = 记过、一次都没恢复过。两态不许合并。
   * 计数器从「开始记录」起算：老记录里真实发生过几次无从得知（这一格只能自此往后数）。
   */
  resumeAttempts?: number;
}

export interface SessionMetadataRecord extends SessionAuditFields {
  /** 与主会话 JSONL 的 id 一致；这里不存事件内容。 */
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  projectId?: string;
  /** sidecar 记录首次建立时间；老会话首次被组织时也以真实建档时间为准，不反推虚构创建时刻。 */
  createdAt: string;
  /** 本 sidecar 的最后一次写入时刻 ＝「会话平面的最后活动」的唯一真身（不另立 lastActivityAt）。 */
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
  // 审计字段：老记录**没有**这些字段（合法，必须原样加载且保持缺席）；有则校验。
  if (raw.viewedAt !== undefined && !isTimestamp(raw.viewedAt)) throw new Error(`sessions.${key}.viewedAt 非法`);
  if (raw.archivedAt !== undefined && !isTimestamp(raw.archivedAt)) throw new Error(`sessions.${key}.archivedAt 非法`);
  if (raw.idleSince !== undefined && !isTimestamp(raw.idleSince)) throw new Error(`sessions.${key}.idleSince 非法`);
  const resumeAttempts = raw.resumeAttempts;
  if (
    resumeAttempts !== undefined &&
    (typeof resumeAttempts !== "number" || !Number.isInteger(resumeAttempts) || resumeAttempts < 0)
  ) {
    throw new Error(`sessions.${key}.resumeAttempts 非法`);
  }

  return {
    id: raw.id,
    title: raw.title,
    pinned: raw.pinned,
    archived: raw.archived,
    ...(raw.projectId !== undefined ? { projectId: raw.projectId } : {}),
    // 审计字段**原样保留缺席**：不补 0 / false / epoch 0（缺席的含义写在 SessionAuditFields 上）。
    ...(raw.viewedAt !== undefined ? { viewedAt: raw.viewedAt } : {}),
    ...(raw.archivedAt !== undefined ? { archivedAt: raw.archivedAt } : {}),
    ...(raw.idleSince !== undefined ? { idleSince: raw.idleSince } : {}),
    ...(resumeAttempts !== undefined ? { resumeAttempts } : {}),
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

  /**
   * 归档 / 取消归档（**状态位与审计时刻一起改**，不许只改一半）。
   * 归档 ⇒ 记 `archivedAt`；取消归档 ⇒ 把 `archivedAt` **摘掉**（留着一个归档时刻却 archived=false
   * ⇒ 两格互相矛盾）。老记录可能是 `archived=true` 而 `archivedAt` 缺席（归档时刻未记录），照实留着。
   */
  async setArchived(id: string, archived: boolean): Promise<SessionMetadataRecord> {
    if (typeof archived !== "boolean") throw new Error(`会话 archived 非法: ${JSON.stringify(archived)}`);
    return await this.mutate(id, (record, now) => {
      if (!archived) {
        const { archivedAt: _removed, ...withoutArchivedAt } = record;
        return { ...withoutArchivedAt, archived: false };
      }
      return { ...record, archived: true, archivedAt: now };
    });
  }

  /** 只改显示标题（第十八遍：首条消息自动命名）——id/文件名一字不动，改名走 rename 那条路。 */
  async setTitle(id: string, title: string): Promise<SessionMetadataRecord> {
    assertTitle(title);
    return await this.mutate(id, (record) => ({ ...record, title }));
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

  // ---- 审计面（sidecar 记录，不是事件；边界见文件头）----

  /**
   * 记一次「被查看」：盖上 `viewedAt`。
   * **缺席 = 从未被查看过**（不是「查看于 epoch 0」）：所以这是「盖一个时刻」而不是「把 0 改成 1」。
   */
  async markViewed(id: string): Promise<SessionMetadataRecord> {
    return await this.mutate(id, (record, now) => ({ ...record, viewedAt: now }));
  }

  /** 记「进入空闲」：盖上 `idleSince`。**缺席 = 没有空闲记录**。 */
  async markIdle(id: string): Promise<SessionMetadataRecord> {
    return await this.mutate(id, (record, now) => ({ ...record, idleSince: now }));
  }

  /**
   * 记「回到活跃」：把 `idleSince` **摘掉**。
   * 没有这一支的话，idleSince 会永远停在那儿 ⇒ 界面会一直说「还闲着」= 谎报当前状态。
   */
  async markActive(id: string): Promise<SessionMetadataRecord> {
    return await this.mutate(id, (record) => {
      const { idleSince: _removed, ...withoutIdle } = record;
      return withoutIdle;
    });
  }

  /**
   * 记一次恢复（打开）尝试：`resumeAttempts` 递增。
   * **首次记录 = 1**（不是 0）：从 0 起数会把「刚发生过一次」记成「一次都没发生过」。
   * 老记录（`resumeAttempts` 缺席 ＝ 未记录）第一次被记 ⇒ 写 1；从这一刻起计数器才有意义。
   */
  async recordResumeAttempt(id: string): Promise<SessionMetadataRecord> {
    return await this.mutate(id, (record) => ({ ...record, resumeAttempts: (record.resumeAttempts ?? 0) + 1 }));
  }

  /**
   * 读审计面。**缺席就是缺席**：没记录过的字段一律不出现（不补 0 / false / epoch 0）。
   * 没有 sidecar 记录的会话 ⇒ 四个字段全缺席（＝ 从未查看 / 未归档 / 无空闲记录 / 恢复次数未知）。
   */
  async audit(id: string): Promise<SessionAuditFields> {
    const record = await this.find(id);
    if (record === undefined) return {};
    return {
      ...(record.viewedAt !== undefined ? { viewedAt: record.viewedAt } : {}),
      ...(record.archivedAt !== undefined ? { archivedAt: record.archivedAt } : {}),
      ...(record.idleSince !== undefined ? { idleSince: record.idleSince } : {}),
      ...(record.resumeAttempts !== undefined ? { resumeAttempts: record.resumeAttempts } : {}),
    };
  }

  /**
   * 恢复次数：**`undefined` = 未记录（未知）**；`0` = 记过、一次都没恢复过。
   * 这两态不许合并——把「未知」读成 0 就是把「没量到」说成「没有」。
   */
  async resumeAttemptsOf(id: string): Promise<number | undefined> {
    const record = await this.find(id);
    return record?.resumeAttempts;
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
    update: (record: SessionMetadataRecord, now: string) => SessionMetadataRecord,
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
      // 同一笔写入里的时刻只有一个（`now` 透传给 update）：两处各取一次时钟会差一毫秒，
      // 于是 archivedAt 与 updatedAt 互相矛盾（读的人得猜哪个是真的）。
      const next = { ...update(current, now), updatedAt: now };
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
