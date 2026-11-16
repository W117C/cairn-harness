// 发言权（ADR 0015 §四 的第三件最小件；设计规格 2026-11-16 §2 的上游对照）。
//
// 它只回答四个问题，别的都不管：**这一轮谁先说、谁并行、谁静默、什么时候停机**。
// 不碰模型、不碰会话、不落盘 —— 轮次的运行期簿记在别处（编排事件／投影），这里只把
// 「一轮的发言秩序」算成一张可判的名单（纯函数：同一输入必得同一输出，无随机、无时钟）。
//
// 三条与上游刻意的不同（不复制它的命名，也不复制它的短板）：
//  ① 没有「@全体」这种特权：被点名的人由上层解析后交进来（本模块只认成员 id，不解析文本），
//     所以「谁有资格一口气喊全员」是**解析层**的权限问题，不是一个字符串特例。
//  ② 静默就是**这一轮不发言**，不搞「先续推一次再说」的隐形额外回合——
//     多出来的那一回合在上游是未记账的调用，在我们这里会变成说不清的 token 账。
//  ③ 空转守卫是**读数驱动**的：连续若干轮零工具调用就整体停机等人，而不是让模型自己「感觉」该停了。

/** 一轮的成员名单。`chair` 是主持人（模式允许时先答）；不是权限档，改名不改权。 */
export interface RoundMember {
  id: string;
  chair?: boolean;
}

/** 发言秩序：主持人先说，或按名单顺序轮。 */
export type RoundMode = "chairFirst" | "turnOrder";

export interface RoundInput {
  members: readonly RoundMember[];
  mode: RoundMode;
  /** 本轮被点名的成员 id（解析已在上层完成；未知 id 会被忽略并记下来）。 */
  mentioned?: readonly string[];
  /** 本轮选择静默的成员 id。 */
  silent?: readonly string[];
  /** 连续「零工具调用」的轮数（空转守卫的读数）。 */
  idleRounds?: number;
  /** 空转守卫阈值，缺省 6 轮。 */
  idleLimit?: number;
}

export interface SpeechBatch {
  /** 1-based 发言批序；同一批＝同时开工，彼此看不见对方这一轮的答复。 */
  order: number;
  speakers: string[];
}

export interface SpeechPlan {
  batches: SpeechBatch[];
  /** 是否整体停机等人（空转守卫）。 */
  paused: boolean;
  pausedReason: "idle" | null;
  /** 本轮不发言的已知成员（静默）。 */
  silent: string[];
  /** 点名里认不出的 id（不猜、不吞，交回给上层记账）。 */
  unknown: string[];
}

export const DEFAULT_IDLE_LIMIT = 6;

/**
 * 算一轮的发言秩序。
 *
 * 规则（每条都能写成断言）：
 *  · 空转守卫：`idleRounds ≥ idleLimit` ⇒ 停机，名单为空；
 *  · 点名优先：有 `mentioned` 时**只有**被点名的人发言，且全部落在**同一批**（并行）；
 *  · 无点名：`chairFirst` ⇒ 主持人单独一批先说，然后其余按声明顺序一人一批；
 *    `turnOrder` ⇒ 全按声明顺序一人一批（不看 chair）；
 *  · 静默：`silent` 里的人这一轮不出现在任何批里；
 *  · 去重：同一 id 在一轮里只会出现一次（声明顺序取第一次）。
 */
export function planRound(input: RoundInput): SpeechPlan {
  const limit = input.idleLimit ?? DEFAULT_IDLE_LIMIT;
  const idle = input.idleRounds ?? 0;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of input.members) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    order.push(m.id);
  }
  const silentSet = new Set(input.silent ?? []);
  const silent = order.filter((id) => silentSet.has(id));
  const eligible = order.filter((id) => !silentSet.has(id));

  if (idle >= limit) {
    return { batches: [], paused: true, pausedReason: "idle", silent, unknown: [] };
  }

  const mentioned = (input.mentioned ?? []).filter((id, i, arr) => arr.indexOf(id) === i);
  if (mentioned.length > 0) {
    const known = mentioned.filter((id) => seen.has(id));
    const unknown = mentioned.filter((id) => !seen.has(id));
    const speakers = known.filter((id) => !silentSet.has(id));
    return {
      batches: speakers.length === 0 ? [] : [{ order: 1, speakers }],
      paused: false,
      pausedReason: null,
      silent,
      unknown,
    };
  }

  if (eligible.length === 0) {
    return { batches: [], paused: false, pausedReason: null, silent, unknown: [] };
  }

  const batches: SpeechBatch[] = [];
  if (input.mode === "chairFirst") {
    const chair = input.members.find((m) => m.chair === true && !silentSet.has(m.id))?.id;
    if (chair !== undefined) batches.push({ order: 1, speakers: [chair] });
    for (const id of eligible) {
      if (id === chair) continue;
      batches.push({ order: batches.length + 1, speakers: [id] });
    }
    return { batches, paused: false, pausedReason: null, silent, unknown: [] };
  }

  for (const id of eligible) batches.push({ order: batches.length + 1, speakers: [id] });
  return { batches, paused: false, pausedReason: null, silent, unknown: [] };
}
