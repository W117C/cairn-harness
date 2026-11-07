// 产品来源视图（ADR 0005）：父前缀 + 本地有效历史，**每一条都带着它所属文件的物理行号**。
//
// 为什么不能直接用 `replaySession` 的数组：那是投影，下标是「拼接后的位置」，不是任何文件的
// raw 行号；压缩、回退、反馈、回放一拿它当行号就会写错文件。视图把两件事分开：
//   · `localEvents` = 本地文件的 raw（与 `replay()` 逐字相等，视图不是 raw 的替代品）；
//   · `entries` = 有效历史 + EventRef（工作区 / 会话 / 原文件行号）。
// 祖先各自按自己的 raw 边界截、各自应用控制记录；父前缀里未收尾的请求不继承。
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { effectiveControlEntries, effectiveEntries } from "./projection";
import { SessionReplayError, resolveSessionChain, unfinishedIndexes, type SessionChainFile } from "./session";
import type { EventRef, SessionRef } from "./session-ref";
import { findEffectiveVerifyDeclaration } from "./verify-declaration";
import { isNumericCompaction, type AgentEvent, type VerifyDeclaration } from "./types";

export interface SessionViewEntry {
  event: AgentEvent;
  ref: EventRef;
  /** true = 来自祖先文件；false = 本地会话自己的行。 */
  inherited: boolean;
}

export interface SessionView {
  /** 视图所属的会话（全量分叉/本地边界要它）。 */
  session: SessionRef;
  entries: SessionViewEntry[];
  /** 本地文件的 raw 事件（与 `replay(localPath)` 相等）。 */
  localEvents: AgentEvent[];
  /** 当前视图最后一轮用户消息之前的有效任务判据；坏声明不生效，缺席 = 没声明。 */
  verify?: VerifyDeclaration;
}

function sliced(file: SessionChainFile): AgentEvent[] {
  return file.boundary === undefined ? file.raw : file.raw.slice(0, file.boundary);
}

/** 读取一个会话的来源视图。`sessionsRoot` 必须是受信会话根（`<workspace>/.agent/sessions`）：
 *  父链的每一份文件都经 realpath 校验落在它之内，软链不能借分叉读根外日志。 */
export async function readSessionView(session: SessionRef, sessionsRoot: string): Promise<SessionView> {
  let root: string;
  try {
    root = await realpath(sessionsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SessionReplayError("session-missing", `会话根缺失：${sessionsRoot}`);
    }
    throw error;
  }
  const chain = await resolveSessionChain(join(root, session.sessionId + ".jsonl"), undefined, root);
  const inherited: SessionViewEntry[] = [];
  const local: SessionViewEntry[] = [];
  for (const [index, file] of chain.entries()) {
    const isLocal = index === chain.length - 1;
    for (const projected of effectiveEntries(sliced(file))) {
      const entry: SessionViewEntry = {
        event: projected.event,
        ref: { workspace: session.workspace, sessionId: file.sessionId, eventId: projected.eventId },
        inherited: !isLocal,
      };
      (isLocal ? local : inherited).push(entry);
    }
  }
  // 父链各文件先按自己的回退/压缩解释，再把「有效控制记录 + 合成表行号」交给同一份判据窗口函数。
  // `effectiveEntries` 会摘掉 session_meta_update，而声明正写在那里；故声明面单独用
  // `effectiveControlEntries`，视图的历史入口仍用原来的过滤结果。
  const drop = unfinishedIndexes(inherited.map((e) => e.event));
  const chainEvents: AgentEvent[] = [];
  const chainExcluded = new Set<number>();
  for (const file of chain) {
    const raw = sliced(file);
    const offset = chainEvents.length;
    const entries = effectiveControlEntries(raw);
    // 压缩记录里的 id 是**该文件 raw 行号**；effectiveControlEntries 会去掉回退标记，
    // 所以要按它保留的 eventId 映射到合成表的 1-based 位置，不能用 raw 行号直接顶替。
    const byRawId = new Map(entries.map((entry, at) => [entry.eventId, offset + at + 1]));
    // M3c：worker 子流的压缩事件（agent_id 在场）不参与排除集——它的 id 是 worker 内存态
    // 事件序，经 byRawId 映射会对主表错摘主事件（含承载声明的 session_meta），与
    // agent/context.ts#excludedIds 同一条口径，不各写一份「谁是 worker」的判定。
    for (const e of raw) {
      if (e.type !== "compaction" || !isNumericCompaction(e)) continue;
      if (typeof (e as { agent_id?: unknown }).agent_id === "string" &&
          (e as { agent_id?: unknown }).agent_id !== "") continue;
      for (const id of e.compressed_event_ids) {
        const mapped = byRawId.get(id);
        if (mapped !== undefined) chainExcluded.add(mapped);
      }
    }
    for (const entry of entries) chainEvents.push(entry.event);
  }
  const effective = findEffectiveVerifyDeclaration(chainEvents, chainEvents.length, chainExcluded);
  const verify = effective?.declaration;
  return {
    session,
    entries: [...inherited.filter((_, i) => !drop.has(i)), ...local],
    localEvents: sliced(chain[chain.length - 1]!),
    ...(verify === undefined ? {} : { verify }),
  };
}

/** 会话身份记录不算历史内容（下游投影也把它们当非内容事件）；分叉边界不落在它们身上。 */
const isHistoryEvent = (event: AgentEvent): boolean => event.type !== "session_meta";

export interface ForkPointInView {
  /** 分叉点所在文件的会话（可能是某个祖先）。 */
  source: SessionRef;
  /** 该文件里的 raw 物理行号（含）；0 = 不继承该文件的任何事件。 */
  boundaryEventId: number;
  totalRounds: number;
}

/** 可见历史里的轮次 → 分叉点。`round` = 保留前几轮（含）；0 = 全量分叉（desktop 扩展）。 */
export function forkPointInView(view: SessionView, round: number): ForkPointInView | { error: string } {
  if (!Number.isInteger(round) || round < 0) {
    return { error: `分叉轮次要非负整数，收到：${String(round)}` };
  }
  const userPositions: number[] = [];
  view.entries.forEach((entry, index) => {
    if (entry.event.type === "user_message") userPositions.push(index);
  });
  const totalRounds = userPositions.length;
  if (totalRounds === 0) {
    return { error: "这条会话还没有任何一轮（0 条 user_message），没有可分叉的点" };
  }
  const effective = round === 0 ? totalRounds : round;
  if (effective > totalRounds) {
    return { error: `分叉轮次 ${String(round)} 超出可见历史（共 ${String(totalRounds)} 轮）` };
  }
  if (effective === totalRounds) {
    return { source: view.session, boundaryEventId: view.localEvents.length, totalRounds };
  }
  // 下一轮的 user_message 之前、最后一条**历史内容**所在的文件与行号。
  const nextUser = userPositions[effective]!;
  for (let i = nextUser - 1; i >= 0; i--) {
    const entry = view.entries[i]!;
    if (!isHistoryEvent(entry.event)) continue;
    return {
      source: { workspace: entry.ref.workspace, sessionId: entry.ref.sessionId },
      boundaryEventId: entry.ref.eventId,
      totalRounds,
    };
  }
  // 下一轮之前没有任何历史内容（只有身份记录）⇒ 指向拥有该轮的文件、边界 0。
  const at = view.entries[nextUser]!.ref;
  return { source: { workspace: at.workspace, sessionId: at.sessionId }, boundaryEventId: 0, totalRounds };
}
