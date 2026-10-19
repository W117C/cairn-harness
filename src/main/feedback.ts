// 用户反馈沉淀（v2.16）：用户对某条模型输出的「赞 / 踩」——人类反馈的**持久面**。
//
// 为什么是 sidecar 而不是新增 AgentEvent：① 它不是模型行为，落进 JSONL 会污染 live/replay 等价性，
// 且每个投影（上下文 / sidechat / compaction / prune）都得多一个 exclude 分支；② 与 pin/archive 同一条
// 纪律——UI 平面的组织与标记记录走 sidecar（见 `session-metadata.ts` 开头的同一句话）。
//
// append-only JSONL：一条反馈一行、**永不改写**。「用户改主意」= 追加一条新记录（含 `rating:"none"` 的撤销），
// 读时按 (sessionId, eventId) 取最后一条生效——既天然可审计（改过几次都看得见），也不需要读-改-写整文件。
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic-write";

export type FeedbackRating = "up" | "down" | "none";

export interface FeedbackRecord {
  /** 会话 id（与 JSONL 文件名同源）。 */
  sessionId: string;
  /** 1-based 事件序号（渲染层用事件在流里的位置锚定那条输出）。 */
  eventId: number;
  rating: FeedbackRating;
  /** 可选备注（自由文本；不做语义解析）。 */
  note?: string;
  /** 记录时间（ISO）。 */
  at: string;
}

/** 生效的反馈（撤销 `none` 已被剔除）：界面据此点亮赞/踩。 */
export interface ResolvedFeedback {
  sessionId: string;
  eventId: number;
  rating: "up" | "down";
  note?: string;
  at: string;
}

const MAX_SESSION_ID_LENGTH = 80;
const MAX_NOTE_LENGTH = 500;

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

function assertRating(value: unknown): asserts value is FeedbackRating {
  if (value !== "up" && value !== "down" && value !== "none") {
    throw new Error(`反馈 rating 非法: ${JSON.stringify(value)}（只认 up / down / none）`);
  }
}

function assertEventId(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`反馈 eventId 非法: ${JSON.stringify(value)}（须为正整数事件序号）`);
  }
}

/** 单条 JSONL 行的解析。形状不对**整行丢弃**并返回 null（历史/损坏行不该让整个面板崩掉），
 *  但绝不猜测补齐——丢的要能被调用方数出来（`listAll` 返回 `skipped`）。 */
function parseLine(line: string): FeedbackRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isSessionId(r.sessionId)) return null;
  if (typeof r.eventId !== "number" || !Number.isInteger(r.eventId) || r.eventId < 1) return null;
  if (r.rating !== "up" && r.rating !== "down" && r.rating !== "none") return null;
  if (r.note !== undefined && (typeof r.note !== "string" || r.note.length > MAX_NOTE_LENGTH)) return null;
  if (typeof r.at !== "string" || r.at === "") return null;
  return {
    sessionId: r.sessionId,
    eventId: r.eventId,
    rating: r.rating,
    ...(r.note !== undefined ? { note: r.note } : {}),
    at: r.at,
  };
}

export interface FeedbackStoreOptions {
  now?: () => Date;
}

/** 原子追加、进程内串行的反馈日志。缺文件 = 空；损坏行跳过并计数，不重置成假的新状态。 */
export class FeedbackStore {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly filePath: string, options: FeedbackStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** 追加一条反馈。校验在写之前——非法入参不落盘、不建文件。 */
  async append(input: { sessionId: unknown; eventId: unknown; rating: unknown; note?: unknown }): Promise<FeedbackRecord> {
    return await this.enqueue(async () => {
      if (!isSessionId(input.sessionId)) throw new Error(`反馈 sessionId 非法: ${JSON.stringify(input.sessionId)}`);
      assertEventId(input.eventId);
      assertRating(input.rating);
      if (input.note !== undefined) {
        if (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH) {
          throw new Error(`反馈 note 非法：须为 ≤${String(MAX_NOTE_LENGTH)} 字符的字符串`);
        }
      }
      const at = this.timestamp();
      const record: FeedbackRecord = {
        sessionId: input.sessionId,
        eventId: input.eventId,
        rating: input.rating,
        ...(input.note !== undefined && input.note !== "" ? { note: input.note } : {}),
        at,
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
      return record;
    });
  }

  /** 某会话**当前生效**的反馈（按 eventId 去重取最后一条；`none` 撤销的不返回）。 */
  async listForSession(sessionId: string): Promise<ResolvedFeedback[]> {
    if (!isSessionId(sessionId)) throw new Error(`反馈 sessionId 非法: ${JSON.stringify(sessionId)}`);
    const { records } = await this.listAll();
    const latest = new Map<number, FeedbackRecord>();
    for (const r of records) {
      if (r.sessionId !== sessionId) continue;
      latest.set(r.eventId, r); // 文件按追加顺序读 ⇒ 后写覆盖先写
    }
    return [...latest.values()]
      .filter((r): r is FeedbackRecord & { rating: "up" | "down" } => r.rating === "up" || r.rating === "down")
      .map((r) => ({ sessionId: r.sessionId, eventId: r.eventId, rating: r.rating, ...(r.note !== undefined ? { note: r.note } : {}), at: r.at }))
      .sort((a, b) => a.eventId - b.eventId);
  }

  /** 全部原始记录（审计面）：`skipped` = 丢弃的坏行数（丢的事件必须能被数出来，不静默）。 */
  async listAll(): Promise<{ records: FeedbackRecord[]; skipped: number }> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], skipped: 0 };
      throw error;
    }
    const records: FeedbackRecord[] = [];
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const r = parseLine(line);
      if (r === null) skipped += 1;
      else records.push(r);
    }
    return { records, skipped };
  }

  /** 会话删除时清掉它的反馈。append-only 是运行期纪律；会话本身不存在了，记录不再有锚点
   *  （同 id 新会话会继承旧 eventId 的高亮/评分，指向不存在的转录）。 */
  async removeSession(sessionId: string): Promise<number> {
    if (!isSessionId(sessionId)) throw new Error(`反馈 sessionId 非法: ${JSON.stringify(sessionId)}`);
    return await this.enqueue(async () => {
      let text: string;
      try {
        text = await readFile(this.filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
      const kept: string[] = [];
      let removed = 0;
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        const r = parseLine(line);
        if (r !== null && r.sessionId === sessionId) { removed += 1; continue; }
        kept.push(line); // 坏行原样保留（审计面，不借删除会话顺手清洗）
      }
      if (removed > 0) await writeFileAtomic(this.filePath, kept.length === 0 ? "" : kept.join("\n") + "\n");
      return removed;
    });
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("反馈时钟非法");
    return value.toISOString();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
