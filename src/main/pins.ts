// 消息置顶沉淀（2026-10-20 · 销 G6 / 规范 §3.11 操作条 "copy / branch / pin / read aloud / time"）。
//
// 为什么独立一个 sidecar 而不是扩 feedback.jsonl 的字段：feedback 的语义是「对输出的质量评价」
// （up/down/none 三态互斥），置顶是「导航标记」——两者生命周期与读法都不同（置顶要能按会话列出
// 全部锚点，评价是按 eventId 取最后一条）。混进同一条记录会让 rating 枚举长出第四条「既赞又置顶」
// 的组合态，且撤销语义打架（取消置顶不该撤销赞）。
//
// 与 feedback / pin/archive 同一条纪律：UI 平面的组织与标记走 sidecar，不进 AgentEvent
// （见 `session-metadata.ts` 开头同一句：重放它们会污染 live/replay 等价性）。
// append-only：置顶/取消各追加一行，读时按 eventId 取最后一条生效。
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic-write";

const MAX_SESSION_ID_LENGTH = 80;

export interface PinRecord {
  /** 会话 id（与 JSONL 文件名同源）。 */
  sessionId: string;
  /** 1-based 事件序号（渲染层用事件在流里的位置锚定那条消息）。 */
  eventId: number;
  /** true = 置顶；false = 取消置顶（append-only 的撤销行）。 */
  pinned: boolean;
  /** 记录时间（ISO）。 */
  at: string;
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

function assertEventId(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`置顶 eventId 非法: ${JSON.stringify(value)}（须为正整数事件序号）`);
  }
}

/** 单条 JSONL 行的解析。形状不对整行丢弃并返回 null——历史/损坏行不该让面板崩掉，也不猜测补齐。 */
function parseLine(line: string): PinRecord | null {
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
  if (typeof r.pinned !== "boolean") return null;
  if (typeof r.at !== "string" || r.at === "") return null;
  return { sessionId: r.sessionId, eventId: r.eventId, pinned: r.pinned, at: r.at };
}

/** 原子追加、进程内串行的置顶日志。缺文件 = 空；损坏行跳过并计数。 */
export class PinStore {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly filePath: string, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** 追加一条置顶/取消记录。校验在写之前——非法入参不落盘、不建文件。 */
  async append(input: { sessionId: unknown; eventId: unknown; pinned: unknown }): Promise<PinRecord> {
    return await this.enqueue(async () => {
      if (!isSessionId(input.sessionId)) throw new Error(`置顶 sessionId 非法: ${JSON.stringify(input.sessionId)}`);
      assertEventId(input.eventId);
      if (typeof input.pinned !== "boolean") throw new Error(`置顶 pinned 非法: ${JSON.stringify(input.pinned)}`);
      const record: PinRecord = {
        sessionId: input.sessionId,
        eventId: input.eventId,
        pinned: input.pinned,
        at: this.now().toISOString(),
      };
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
      return record;
    });
  }

  /** 某会话**当前生效**的置顶锚点（按 eventId 取最后一条；pinned:false 的撤销行不返回）。 */
  async listForSession(sessionId: string): Promise<number[]> {
    if (!isSessionId(sessionId)) throw new Error(`置顶 sessionId 非法: ${JSON.stringify(sessionId)}`);
    const { records } = await this.listAll();
    const latest = new Map<number, PinRecord>();
    for (const r of records) {
      if (r.sessionId !== sessionId) continue;
      latest.set(r.eventId, r); // 文件按追加顺序读 ⇒ 后写覆盖先写
    }
    return [...latest.values()].filter((r) => r.pinned).map((r) => r.eventId).sort((a, b) => a - b);
  }

  /** 全部原始记录（审计面）；`skipped` = 丢弃的坏行数（丢的要能数出来，不静默）。 */
  async listAll(): Promise<{ records: PinRecord[]; skipped: number }> {
    await this.writes; // 与反馈日志一致：查询等待此前入队的修改。
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], skipped: 0 };
      throw error;
    }
    const records: PinRecord[] = [];
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const r = parseLine(line);
      if (r === null) skipped += 1;
      else records.push(r);
    }
    return { records, skipped };
  }

  /** 会话删除时清掉它的置顶记录（同 id 新会话会继承旧 eventId 的高亮，指向不存在的转录）。 */
  async removeSession(sessionId: string): Promise<number> {
    if (!isSessionId(sessionId)) throw new Error(`置顶 sessionId 非法: ${JSON.stringify(sessionId)}`);
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
