// 派生层·交付面（纯投影）：事件流 → 逐轮交付（改动 + 验证证据）。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";

export type TurnVerificationStatus = "not-required" | "absent" | "stale" | "verified" | "failed";

export interface TurnVerificationEvidence {
  command: string;
  ok: boolean;
  output: string;
  cause?: string;
  exitCode?: number | null;
}

export interface TurnDelivery {
  round: number;
  files: Array<{ path: string; change: "created" | "modified" | "unknown"; snapshotId?: string }>;
  verification: {
    status: TurnVerificationStatus;
    attempts: number;
    latest: {
      ok: boolean;
      auto: boolean;
      attempt: number;
      maxAttempts: number;
      results: TurnVerificationEvidence[];
    } | null;
  };
  unverifiedFiles: string[];
  nextAction: string;
}

interface InternalVerification {
  index: number;
  ok: boolean;
  auto: boolean;
  attempt: number;
  maxAttempts: number;
  results: TurnVerificationEvidence[];
}

interface InternalTurn {
  round: number;
  files: TurnDelivery["files"];
  lastWriteIndex: number;
  verifications: InternalVerification[];
}

/** 被显式还原过、且此后**没有再被写**的文件集合（退出改动面的那些）。
 *
 *  为什么要有这一格：还原（检查器「撤销此文件改动」）此前只改盘上的文件、**不留任何事件**，
 *  而改动面全部从事件流投影 ⇒ 还原之后那一行仍写着"修改"、仍提供"撤销"、徽标仍数着它、
 *  交付卡仍说"改动已验证"——那个改动在盘上已经不存在了。
 *
 *  判定按**最后一次动作**：还原之后再被写 ⇒ 重新进改动面（还原只撤掉改动，没撤掉这个文件
 *  以后再被改的资格）；只还原过、没再写 ⇒ 不在改动面。 */
export function restoredPathsOf(events: readonly AgentEvent[]): ReadonlySet<string> {
  const lastAction = new Map<string, "write" | "restore">();
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
  const writes = new Map<string, string>(); // tool_call id → path
  for (const e of events) {
    if (e.type === "tool_call" && WRITE_TOOLS.has(e.name)) {
      const p = (e as { args?: { path?: unknown } }).args?.path;
      if (typeof p === "string" && p !== "") writes.set(e.id, p);
      continue;
    }
    if (e.type === "tool_result") {
      const p = writes.get(e.callId);
      if (p !== undefined) {
        writes.delete(e.callId);
        // 被拒绝/失败的一笔没有改动盘上文件（门拒绝、审批超时、工具报错都在执行前/写盘前收口）：
        // 记成 write 会让「还原」之后的文件被一笔没发生的写入重新拉回改动面。
        if (e.ok) lastAction.set(p, "write");
      }
      continue;
    }
    if (e.type === "file_restored") {
      const p = (e as { path?: unknown }).path;
      if (typeof p === "string" && p !== "") lastAction.set(p, "restore");
    }
  }
  const out = new Set<string>();
  for (const [p, kind] of lastAction) if (kind === "restore") out.add(p);
  return out;
}

/** C-32 ChangeSummaryCard 的投影（v2 输出优先）：按轮聚合写工具改动——user 行开新轮，
 *  写类 tool_call（write_file/edit_file/apply_patch）与其 tool_result 配对后计入该轮；
 *  change 字段缺席标 unknown（不猜 created/modified）；worker 子流事件已在 projectStream
 *  的过滤之外（此处直接吃原始事件，沿用同一过滤判据）。
 *  新投影在这份文件事实之上补验证券：验证拍晚于最后一次写盘才算当前证据，
 *  验证后又写盘标 stale，worker 验证不替主会话销账。 */
function collectTurnDelivery(events: readonly AgentEvent[]): InternalTurn[] {
  const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
  const isWorker = (e: AgentEvent): boolean =>
    e.type !== "agent_spawned" && typeof (e as { agent_id?: unknown }).agent_id === "string";
  const out: InternalTurn[] = [];
  let round = 0;
  let current: InternalTurn | null = null;
  // tool_call id → { path }（写工具才登记）；tool_result 按 callId 收口并计入当前轮。
  const pendingWrites = new Map<string, { path: string }>();
  const finish = (): void => {
    if (current !== null && (current.files.length > 0 || current.verifications.length > 0)) out.push(current);
    current = null;
  };
  for (let index = 0; index < events.length; index++) {
    const e = events[index]!;
    if (isWorker(e)) continue;
    if (e.type === "user_message") {
      finish();
      round += 1;
      current = { round, files: [], lastWriteIndex: -1, verifications: [] };
      continue;
    }
    if (current === null) continue;
    if (e.type === "tool_call" && WRITE_TOOLS.has(e.name)) {
      const p = e.args.path;
      if (typeof p === "string" && p !== "") pendingWrites.set(e.id, { path: p });
      continue;
    }
    if (e.type === "tool_result") {
      const call = pendingWrites.get(e.callId);
      if (call === undefined) continue;
      pendingWrites.delete(e.callId);
      // 只有真的落盘的写入才算改动（2026-10-20 修）：gate 拒绝 / 审批超时 / 执行失败的回执
      // 同样带 path，旧实现照单全收 ⇒ 一次被拒的 write_file 会在「改动」面凭空多一行、
      // 顶栏徽标多 1、交付卡把这一轮说成「有改动未验证」——而盘上什么都没发生。
      // 它也不能推进 lastWriteIndex：否则「验证之后又写盘 ⇒ stale」会被一次没发生的写入触发。
      if (!e.ok) continue;
      current.lastWriteIndex = index;
      // 同一文件轮内多笔只记一次（首次的 change 口径）。
      if (current.files.some((f) => f.path === call.path)) continue;
      current.files.push({
        path: call.path,
        change: e.change === "created" ? "created" : e.change === "modified" ? "modified" : "unknown",
        ...(e.snapshotId !== undefined ? { snapshotId: e.snapshotId } : {}),
      });
      continue;
    }
    if (e.type === "verify_result") {
      current.verifications.push({
        index,
        ok: e.ok,
        auto: e.auto === true,
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
        results: e.results.map((r) => ({
          command: r.command,
          ok: r.ok,
          output: r.output,
          ...(r.cause !== undefined ? { cause: r.cause } : {}),
          ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
        })),
      });
    }
  }
  finish();
  return out;
}

export function turnDelivery(events: readonly AgentEvent[]): TurnDelivery[] {
  // 被显式还原过的文件退出改动面（用户明说"这一项我撤了"）。判定按**最后一次动作**：
  // 还原之后再被写 ⇒ 重新进改动面（还原只撤掉改动，没撤掉它以后再被改的资格）。
  const restored = restoredPathsOf(events);
  return collectTurnDelivery(events).map((turn) => {
    const files = turn.files.filter((f) => !restored.has(f.path));
    const fresh = turn.verifications.filter((v) => v.index > turn.lastWriteIndex);
    const latest = fresh.length > 0 ? fresh[fresh.length - 1]! : (turn.verifications[turn.verifications.length - 1] ?? null);
    const status: TurnVerificationStatus =
      files.length === 0
        ? "not-required"
        : fresh.length === 0
          ? turn.verifications.length === 0 ? "absent" : "stale"
          : latest!.ok ? "verified" : "failed";
    const unverifiedFiles = status === "verified" || status === "not-required" ? [] : files.map((f) => f.path);
    const nextAction =
      status === "failed" ? "修复失败项后重新运行验证"
      : status === "stale" ? "文件在上次验证后又有改动，请重新运行验证"
      : status === "absent" ? "本轮有文件改动但还没有验证记录，请运行验证"
      : status === "verified" ? "改动已验证，可进入审查或继续下一项"
      : "本轮没有文件改动，可继续下一项";
    return {
      round: turn.round,
      files,
      verification: {
        status,
        attempts: files.length === 0 ? turn.verifications.length : fresh.length,
        latest: latest === null ? null : {
          ok: latest.ok,
          auto: latest.auto,
          attempt: latest.attempt,
          maxAttempts: latest.maxAttempts,
          results: latest.results,
        },
      },
      unverifiedFiles,
      nextAction,
    };
  });
}

/** 批 3 交付卡流尾的条目：有交付的轮出卡，空轮出一行弱提示（连续空轮并一段）。 */
export type DeliveryTrailItem =
  | { kind: "card"; delivery: TurnDelivery }
  | { kind: "empty"; from: number; to: number };

/** 空轮弱行文案（单轮「第 N 轮」；区间「第 M–N 轮」）。 */
export function formatEmptyTrailNote(from: number, to: number): string {
  return from === to ? `第 ${String(from)} 轮 · 无文件改动` : `第 ${String(from)}–${String(to)} 轮 · 无文件改动`;
}

/** 交付卡流尾序列（批 3 · 文档阶段 3·对话页①）：按轮序把「有交付的卡」与「空轮弱行」交错铺开，
 *  连续空轮合并为一段（第 M–N 轮）。`currentRoundRunning` = 末轮还在跑：即便它此刻没有交付也
 *  不预告弱行——轮还没收束，「无文件改动」断言不成立（写盘随时可能发生）；末轮已有交付时卡照出
 *  （live 卡与运行中流式并存是既有行为）。总轮数取 max(totalRounds, 末卡轮号) 防御失配。 */
export function deliveryTrail(
  deliveries: readonly TurnDelivery[],
  totalRounds: number,
  currentRoundRunning: boolean,
): DeliveryTrailItem[] {
  const byRound = new Map<number, TurnDelivery>();
  for (const d of deliveries) byRound.set(d.round, d);
  const last = deliveries.length > 0 ? deliveries[deliveries.length - 1]!.round : 0;
  const total = Math.max(totalRounds, last);
  const out: DeliveryTrailItem[] = [];
  let emptyFrom: number | null = null;
  const flushEmpty = (end: number): void => {
    if (emptyFrom !== null) out.push({ kind: "empty", from: emptyFrom, to: end });
    emptyFrom = null;
  };
  for (let r = 1; r <= total; r++) {
    const card = byRound.get(r);
    if (card !== undefined) {
      flushEmpty(r - 1);
      out.push({ kind: "card", delivery: card });
      continue;
    }
    if (r === total && currentRoundRunning) { flushEmpty(total - 1); break; } // 运行中末轮不预告（见上注）
    emptyFrom ??= r;
  }
  flushEmpty(total);
  return out;
}

export function turnChanges(events: readonly AgentEvent[]): Array<{
  round: number;
  files: TurnDelivery["files"];
}> {
  return turnDelivery(events)
    .filter((t) => t.files.length > 0)
    .map((t) => ({ round: t.round, files: t.files }));
}
