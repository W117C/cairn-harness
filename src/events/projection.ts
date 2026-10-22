// 日志结构控制记录的**投影层**（ADR 0005）。
//
// 为什么控制记录的解释在这一层、而不在 `replay()` 里：
// `replay()` 逐字原样返回落盘的事件（含控制记录），「JSONL 逐字重放」与
// 「事件 id = 1-based 行号」两条契约因此同时为真。控制记录**说了什么**（回退到哪、元数据改了哪些键）
// 是**读侧**的问题——读侧要的是「有效历史」，不是「日志原样」。那份解读就是本文件。
//
// 纯度：本文件零 IO、零时钟、零随机、零 promise 等待——同一份输入必得同一份输出。
// 投影结果不得反过来影响日志（控制记录照旧留在盘上，占着自己的行号）。
import type { AgentEvent, SessionMetaUpdateEvent, SessionRewindEvent } from "./types";

/** 投影层抛错的分型（fail loud：坏控制记录不许被静默忽略）。 */
export type ProjectionErrorCode = "rewind-invalid-target" | "rewind-out-of-range";

/** 投影层错误：控制记录本身不合法。**不吞、不回落成"当作没有这条记录"**——
 * 一条坏控制记录会让整份历史变得不可判读，静默忽略它等于交出一份看着没事、其实算错的历史。 */
export class ProjectionError extends Error {
  readonly code: ProjectionErrorCode;
  constructor(code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = "ProjectionError";
    this.code = code;
  }
}

function isRewind(e: AgentEvent): e is SessionRewindEvent {
  return e.type === "session_rewind";
}

function isMetaUpdate(e: AgentEvent): e is SessionMetaUpdateEvent {
  return e.type === "session_meta_update";
}

/** 一份投影结果：有效历史 + 累积的元数据补丁 + 回退后的边界水位。 */
export interface Projection {
  /** 有效历史：去掉控制记录、按回退截断后的消息历史。 */
  events: AgentEvent[];
  /** 累积的会话元数据补丁（后写的键覆盖先写的）。 */
  patch: Record<string, string>;
  /** 回退后的边界水位（1-based 行号口径）：当前有效历史覆盖到日志的第几行。
   *  0 = 还没覆盖任何行（空日志）。 */
  boundary: number;
}

/**
 * 走一遍事件流，算出有效历史与元数据补丁。
 *
 * **回退的语义**（`to_event_id` 是 1-based 行号口径，与 `compressed_event_ids` /
 * `parent_event_id` / `untilEventId` 同一家族）：
 * · `to_event_id = N` ⇒ 有效历史 = 日志里 id ≤ N 且仍在历史中的事件（**含** N）。
 * · 回退标记本身**不在**有效历史里（它是对日志的记录，不是历史的一环）。
 * · 回退标记之后的事件**全部丢弃**——那正是"回退"的意思。
 * · 多次回退：后一条回退作用在**那一刻**的历史上（只会更早，不会更晚）。
 *
 * **越界即抛**（不静默忽略）：
 * · `to_event_id` 不是整数 → `rewind-invalid-target`；
 * · `to_event_id` < 1（含 0 与负数）→ `rewind-invalid-target`；
 * · `to_event_id` 越过当前边界（指到还没发生的行，或指到已被前一次回退丢弃的行）→ `rewind-out-of-range`。
 */
function project(events: readonly AgentEvent[]): Projection {
  // kept = 有效历史**候选**：除回退标记外的所有行（按 id 升序，恒为日志前缀）。
  // 元数据补丁也留在里面：补丁要从**有效集合**里累积（回退砍掉后缀 ⇒ 补丁随之回滚）。
  const kept: { id: number; event: AgentEvent }[] = [];
  let boundary = 0;
  // 已经回退过 ⇒ 之后的事件一律丢弃（回退 = 往回走，它之后的东西不算数了）。
  // 但**后续的回退标记仍要处理**：它作用在那一刻（已被截短）的历史上，只会截得更早。
  let rewound = false;

  for (let i = 0; i < events.length; i++) {
    const id = i + 1; // 1-based 行号口径：事件 id = 落盘行号
    const e = events[i]!;
    if (isRewind(e)) {
      const target = e.to_event_id;
      if (typeof target !== "number" || !Number.isInteger(target)) {
        throw new ProjectionError(
          "rewind-invalid-target",
          `session_rewind（第 ${String(id)} 行）的 to_event_id 不是整数：${JSON.stringify(target)}`,
        );
      }
      if (target < 1) {
        throw new ProjectionError(
          "rewind-invalid-target",
          `session_rewind（第 ${String(id)} 行）的 to_event_id 必须 ≥ 1：${JSON.stringify(target)}`,
        );
      }
      if (target > boundary) {
        throw new ProjectionError(
          "rewind-out-of-range",
          `session_rewind（第 ${String(id)} 行）指向第 ${String(target)} 条，越过当前边界（第 ${String(boundary)} 条）`,
        );
      }
      // 截断：只留 id ≤ target 的行（历史恒为日志前缀，截断只砍后缀）。
      while (kept.length > 0 && kept[kept.length - 1]!.id > target) kept.pop();
      boundary = target; // 边界水位 = 截断点（被丢弃的行不再推进它：指向那些行 ⇒ 越界）
      rewound = true;
      continue; // 回退标记本身不进有效历史
    }
    if (rewound) continue; // 回退之后的事件一律丢弃
    kept.push({ id, event: e });
    boundary = id;
  }

  // 补丁只从**有效集合**累积：被回退砍掉的那几行里的补丁一并回滚
  // （回退是往回走：连同它之前那次元数据改动一起不算数）。
  const patch: Record<string, string> = {};
  for (const k of kept) {
    const e = k.event;
    if (!isMetaUpdate(e)) continue;
    const p = e.patch;
    if (p && typeof p === "object") {
      for (const [key, v] of Object.entries(p)) {
        if (typeof v === "string") patch[key] = v;
      }
    }
  }

  return {
    events: kept.filter((k) => !isMetaUpdate(k.event)).map((k) => k.event),
    patch,
    boundary,
  };
}

/**
 * 有效历史：应用全部回退后的消息历史。
 *
 * 控制记录（`session_rewind` / `session_meta_update`）**不在**其中：
 * · 回退标记是对日志的记录，不是历史的一环；
 * · 元数据补丁改的是会话属性，不是消息。
 *
 * 纯函数：同一份输入必得同一份输出；不改动传入的数组与其中的事件。
 */
export function effectiveEvents(events: readonly AgentEvent[]): AgentEvent[] {
  return project(events).events;
}

/**
 * 累积的会话元数据补丁（后写的键覆盖先写的）。
 *
 * 键缺席 = 该键不变（不是"清空"）；空补丁 = 什么都没改。
 * 回退会连带丢弃它**之后**的补丁（那些行已被回退从有效历史里砍掉）。
 */
export function sessionMetaPatch(events: readonly AgentEvent[]): Record<string, string> {
  return project(events).patch;
}

/** 回退后的边界水位（1-based 行号口径；0 = 空）。给需要知道"历史覆盖到哪儿"的读侧用。 */
export function effectiveBoundary(events: readonly AgentEvent[]): number {
  return project(events).boundary;
}
