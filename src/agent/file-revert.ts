// #7 文件级回滚（v2.16）：把**某一轮**主会话在用户真实工作区里改过的文件，还原成那一轮之前的原件。
//
// 为什么走快照而不是 git：D7 快照（`src/tools/snapshot.ts`）正是为「agent 覆盖了用户未提交的工作」这一格
// 建的——`write_file`/`edit_file`/`apply_patch`/`run_shell` 重定向在覆盖**已存在**文件之前按字节抄一份原件，
// 快照路径随 `tool_result.snapshotId` 落进事件流。它是**结构化**的（不像工作区 git 状态，分不出哪一轮改的），
// 所以「回滚这一轮」只能从事件流里取原件，不能靠 `git checkout` 猜。
//
// 只做**主会话直写**：worker 的改动落在自己的 worktree（`.agents/wt-*`，天然可回滚、另有合并控制塔），
// 事件带宽 `agent_id`，本模块一律跳过——把 worker 的改动算进主会话的「这一轮」会张冠李戴。
//
// 口径纪律（逐条对应本仓点名的失败形状）：
//   ① 「轮」以 `user_message` 为界——与 `fork-cli.forkPointOf` 同一份定义（一次用户交付 = 一轮）；
//   ② 同一文件在同一轮里被覆盖多次 ⇒ 取**最早**那份快照（那才是"这一轮之前"的状态，后几份是轮内中间态）；
//   ③ 该文件在本轮**之后**又被改过 ⇒ 拒绝回滚该文件（回滚会把后来的改动一起抹掉）——如实点名，不静默覆盖；
//   ④ 取不到原件的一律进 `manual` 并写明为什么（新建文件没有"覆盖前"、多文件补丁只在事件里留了第一份快照…），
//      绝不把"看不见"说成"能回滚"。
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { AgentEvent } from "../events";
import { SNAPSHOT_ROOT } from "../tools/snapshot";
import { WORKTREE_ROOT_DIR } from "./worktree";

export type RevertUndo = "restore" | "delete" | "manual";

export interface FileRevertEntry {
  /** 被改文件的 workspace 相对路径（从快照 id 或配对的 tool_call 取，不猜）。 */
  path: string;
  undo: RevertUndo;
  /** undo=restore：覆盖前原件在磁盘上的路径（workspace 相对，= `snapshotId`）。 */
  snapshotId?: string;
  /** undo=manual：为什么这一条不自动还原。 */
  why?: string;
  /** 这一条来自哪条 tool_result（1-based 事件序号，界面锚点与审计都读它）。 */
  sourceEventId: number;
}

export interface FileRevertPlan {
  round: number;
  totalRounds: number;
  entries: FileRevertEntry[];
}

/** 从 `snapshotId` 反解被覆盖文件的 workspace 相对路径。
 *  形状是 `snapshotIdOf` 的唯一一份构造：`<SNAPSHOT_ROOT>/<毫秒>--<callId>/<原相对路径>`。
 *  形状不对返回 null（不猜）——调用方据此把它降级成 manual。 */
export function pathFromSnapshotId(snapshotId: string): string | null {
  const prefix = SNAPSHOT_ROOT + "/";
  if (!snapshotId.startsWith(prefix)) return null;
  const rest = snapshotId.slice(prefix.length);
  const at = rest.indexOf("/");
  if (at < 0) return null;
  const rel = rest.slice(at + 1);
  return rel === "" ? null : rel;
}

/** 配对的 `tool_call` 里那个写目标（write_file/edit_file 的 path；apply_patch 不带单一路径）。 */
function callTargetPath(args: Record<string, unknown>): string | null {
  const p = args.path ?? args.file_path;
  return typeof p === "string" && p !== "" ? p : null;
}

interface WriteTouch {
  eventId: number;
  path: string;
  snapshotId: string | null;
  created: boolean;
}

/** 一条主会话成功的写回执 → 一次"改了这个文件"的接触点；取不到路径的返回 null（调用方按 manual 记）。 */
function touchOf(result: Extract<AgentEvent, { type: "tool_result" }>, eventId: number, callPath: string | null): WriteTouch | null {
  const snapshotId = typeof result.snapshotId === "string" && result.snapshotId !== "" ? result.snapshotId : null;
  const fromSnapshot = snapshotId === null ? null : pathFromSnapshotId(snapshotId);
  const path = fromSnapshot ?? callPath;
  if (path === null) return null;
  return { eventId, path, snapshotId, created: result.change === "created" };
}

/** 轮次 → 事件区间（0-based，半开）。与 `forkPointOf` 同一份「轮 = user_message 边界」定义。 */
function turnSlice(events: readonly AgentEvent[], round: number): { from: number; to: number; totalRounds: number } | { error: string } {
  const userAt: number[] = [];
  events.forEach((e, i) => {
    if (e.type === "user_message") userAt.push(i);
  });
  const totalRounds = userAt.length;
  if (!Number.isInteger(round) || round < 1) return { error: `要正整数轮次，收到：${String(round)}` };
  if (totalRounds === 0) return { error: "这条会话还没有任何一轮（0 条 user_message），没有可回滚的点" };
  if (round > totalRounds) return { error: `第 ${String(round)} 轮超出会话轮数（该会话共 ${String(totalRounds)} 轮）` };
  const from = userAt[round - 1]!;
  const to = round < totalRounds ? userAt[round]! : events.length;
  return { from, to, totalRounds };
}

/** 事件流 → 某一轮的**文件回滚计划**（纯函数，零 I/O：判卷直接喂事件数组）。 */
export function planTurnRevert(events: readonly AgentEvent[], round: number): FileRevertPlan | { error: string } {
  const slice = turnSlice(events, round);
  if ("error" in slice) return slice;

  // callId → 写目标（从 tool_call 取；apply_patch 的多文件不在这一份里，见 ④）
  const callPaths = new Map<string, string | null>();
  for (const e of events) {
    if (e.type === "tool_call") callPaths.set(e.id, callTargetPath(e.args));
  }

  // 轮内接触点（只收主会话成功写；worker 事件带 agent_id，跳过）
  const touches: WriteTouch[] = [];
  for (let i = slice.from; i < slice.to; i++) {
    const e = events[i]!;
    if (e.type !== "tool_result" || !e.ok || e.agent_id !== undefined) continue;
    const isWrite = e.snapshotId !== undefined || e.change !== undefined;
    if (!isWrite) continue;
    const callPath = e.callId === undefined ? null : callPaths.get(e.callId) ?? null;
    const t = touchOf(e, i + 1, callPath);
    if (t !== null) touches.push(t);
  }

  // 同一路径取最早一份快照（轮内中间态不算「这一轮之前」）
  const firstByPath = new Map<string, WriteTouch>();
  for (const t of touches) if (!firstByPath.has(t.path)) firstByPath.set(t.path, t);

  // ③ 轮后又被改过 ⇒ 该文件拒绝回滚（先扫全量，再判，别边扫边改）
  const touchedAfter = new Set<string>();
  for (let i = slice.to; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== "tool_result" || !e.ok || e.agent_id !== undefined) continue;
    const isWrite = e.snapshotId !== undefined || e.change !== undefined;
    if (!isWrite) continue;
    const callPath = e.callId === undefined ? null : callPaths.get(e.callId) ?? null;
    const t = touchOf(e, i + 1, callPath);
    if (t !== null) touchedAfter.add(t.path);
  }

  const entries: FileRevertEntry[] = [];
  for (const [path, t] of firstByPath) {
    if (touchedAfter.has(path)) {
      entries.push({ path, undo: "manual", sourceEventId: t.eventId, why: "该文件在这一轮之后又被改过 ⇒ 回滚会把后来的改动一起抹掉；请回滚最近改动它的那一轮" });
      continue;
    }
    if (t.snapshotId !== null) {
      entries.push({ path, undo: "restore", snapshotId: t.snapshotId, sourceEventId: t.eventId });
      continue;
    }
    if (t.created) {
      entries.push({ path, undo: "delete", sourceEventId: t.eventId });
      continue;
    }
    entries.push({ path, undo: "manual", sourceEventId: t.eventId, why: "这次写入没有留下覆盖前原件（覆盖的是空文件 / 快照层失败）⇒ 撤不回来" });
  }
  entries.sort((a, b) => a.sourceEventId - b.sourceEventId);
  return { round, totalRounds: slice.totalRounds, entries };
}

export interface FileRevertResult {
  restored: string[];
  deleted: string[];
  manual: { path: string; why: string }[];
  failed: { path: string; error: string }[];
}

/** workspace 内的路径（越界一律拒）。`allowAgentArea` 只给**快照源**开：快照原件本来就在 `.agent/snapshots/`
 *  里，读它必须放行；而被回滚的**目标**（要写回/要删的用户文件）绝不能落在 `.agent/` / `.agents/`。 */
function insideWorkspace(workspace: string, rel: string, opts: { allowAgentArea?: boolean } = {}): { ok: true; abs: string } | { ok: false; error: string } {
  const root = resolve(workspace);
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, error: "路径越出工作区（拒绝回滚）" };
  if (opts.allowAgentArea !== true) {
    // 快照区与 agent 区不是用户产物：回滚只动用户文件（WORKTREE_ROOT_DIR 取自 worktree.ts 的唯一一份常量）
    if (rel === ".agent" || rel.startsWith(".agent" + sep) || rel === WORKTREE_ROOT_DIR || rel.startsWith(WORKTREE_ROOT_DIR + sep)) {
      return { ok: false, error: "目标是 agent 工作区（.agent/ / .agents/），不是用户文件（拒绝回滚）" };
    }
  }
  return { ok: true, abs };
}

/** 落实回滚计划（真 fs 调用）。`restore` = 把快照原件按字节抄回；`delete` = 删掉本轮新建的文件。
 *  manual/failed 逐条如实报出——「回滚了」这几个字必须每一条都对得上盘。 */
export async function applyTurnRevert(workspace: string, plan: FileRevertPlan): Promise<FileRevertResult> {
  const res: FileRevertResult = { restored: [], deleted: [], manual: [], failed: [] };
  for (const e of plan.entries) {
    if (e.undo === "manual") {
      res.manual.push({ path: e.path, why: e.why ?? "需人工处理" });
      continue;
    }
    const target = insideWorkspace(workspace, e.path);
    if (!target.ok) {
      res.failed.push({ path: e.path, error: target.error });
      continue;
    }
    if (e.undo === "delete") {
      try {
        await rm(target.abs, { force: true });
        res.deleted.push(e.path);
      } catch (err) {
        res.failed.push({ path: e.path, error: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    // restore：源是快照原件（在 .agent/snapshots/ 里，必须放行 agent 区检查）
    const src = insideWorkspace(workspace, e.snapshotId!, { allowAgentArea: true });
    if (!src.ok) {
      res.failed.push({ path: e.path, error: "快照路径非法：" + src.error });
      continue;
    }
    try {
      const st = await stat(src.abs);
      if (!st.isFile()) throw new Error("快照原件不是一个普通文件");
      await mkdir(dirname(target.abs), { recursive: true });
      await copyFile(src.abs, target.abs); // 按字节抄回（copyFile 保 mtime）——read_file 转写会丢末行换行
      res.restored.push(e.path);
    } catch (err) {
      res.failed.push({ path: e.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return res;
}
