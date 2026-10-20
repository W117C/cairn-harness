// M8 增量的纯逻辑层：worker diff 的「逐文件接受/拒绝」。
// 职责三件（交互提问留在 cli.ts，这里全部可离线判卷）：
//   ① 把「待审阅的 write worker」从事件流里认出来（`reviewCandidates`）；
//   ② 把逐文件选择解析成接受/拒绝两个集合（`parseSelection`）；
//   ③ 把被拒文件落实为 worktree 里的还原（`revertPlan` / `applyReverts`）。
//
// 为什么"逐文件拒绝"要先在 worktree 里还原：合并唯一出口是控制塔的 `commitAndMerge`
// （`git add -A` 提交再 `merge --no-ff`），它没有"只合并一部分"的入参；而 worker 的改动在
// merge 前**未提交地留在 worktree** ⇒ 把被拒文件就地还原，就是把这部分从下一笔提交里剔掉——
// 不另立第二套合并机制，也不改 orchestrator 一行。
//
// diff 收据的识别标记（`[diff] v` 前缀）：第 245 页起收据 callId 走 `spawnCallId`（回执合并语义），
// 旧的 `callId.startsWith("diff-")` 只在"无 spawn id"的兜底支上成立——用它做渲染判定等于
// **主干路径上整块 diff 从来打不出来**（判卷 `diff-review.test.ts` 钉住生产↔消费两侧同标记）。
// `callId` 前缀两支都保留：老形状仍在兜底支真实发生。
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { AgentEvent } from "../events";

/** diff 收据（worker 改动快照）的判定。生产端输出以 `"[diff] v"` 开头（orchestrator 的 emit）。 */
export function isWorkerDiffReceipt(e: AgentEvent): boolean {
  if (e.type !== "tool_result") return false;
  if (e.callId.startsWith("diff-")) return true; // 兜底支的老形状（无 spawn callId 的内部 worker）
  return e.output.startsWith("[diff] v");
}

export interface ReviewCandidate {
  agentId: string;
  /** worker 的 worktree（`agent_spawned.worktree`，原样来自事件流）。 */
  worktree: string;
  task: string;
  /** `agent_result(done)` 的事件序号（1-based）= card_action 的 source_event_id。 */
  resultEventIndex: number;
}

/** 待审阅 = write worker ∧ 有 worktree ∧ 已 done ∧ 没有针对它的 merge/reject card_action。 */
export function reviewCandidates(events: readonly AgentEvent[]): ReviewCandidate[] {
  const spawned = new Map<string, { worktree: string; task: string }>();
  const done = new Map<string, number>();
  const decided = new Set<string>();
  events.forEach((e, i) => {
    if (e.type === "agent_spawned" && e.mode === "write") {
      const wt = (e as { worktree?: unknown }).worktree;
      if (typeof wt === "string" && wt !== "") spawned.set(e.agent_id, { worktree: wt, task: e.task });
    }
    if (e.type === "agent_result" && e.status === "done" && spawned.has(e.agent_id)) done.set(e.agent_id, i + 1);
    if (e.type === "card_action" && (e.action === "merge" || e.action === "reject")) {
      const tid = (e as { target_agent_id?: unknown }).target_agent_id;
      if (typeof tid === "string") decided.add(tid);
    }
  });
  const out: ReviewCandidate[] = [];
  for (const [agentId, s] of spawned) {
    const idx = done.get(agentId);
    if (idx === undefined || decided.has(agentId)) continue; // 没收敛 / 已决过的都不可再审
    out.push({ agentId, worktree: s.worktree, task: s.task, resultEventIndex: idx });
  }
  return out;
}

export interface ChangedFile {
  path: string;
  /** porcelain 的 XY 码（原样保留：显示与分类都要它）。 */
  code: string;
  /** 改名/复制的来源（本笔不自动还原这类条目）。 */
  from?: string;
}

/** `git status --porcelain -z` 的解析（-z：NUL 分隔、不做引号转义——非 ASCII 路径的先例见 cfa91e1）。
 *  改名/复制条目在 -z 下**多带一段来源路径**，必须一起吃掉，否则下一段会被读成幽灵文件。 */
export function parsePorcelainZ(text: string): ChangedFile[] {
  const parts = text.split("\0");
  const out: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i] ?? "";
    if (p.length < 4) continue; // 最短一条是 "?? a"
    const code = p.slice(0, 2);
    const path = p.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) {
      const from = parts[i + 1] ?? "";
      i += 1;
      out.push({ path, code, from });
    } else {
      out.push({ path, code });
    }
  }
  return out;
}

export type RevertUndo = "checkout" | "delete" | "manual";

export interface RevertEntry {
  path: string;
  undo: RevertUndo;
  /** undo=manual 时的理由（改名/复制条目不自动还原）。 */
  why?: string;
}

/** 被拒文件的还原计划：新增（`??` / `A`）⇒ 删文件；其余已跟踪形态（`M`/`D`/`T`…）⇒ checkout 还原；
 *  改名/复制 ⇒ manual（要拆成"删新+还原旧"两步，先不自动做——如实点名，不猜）。 */
export function revertPlan(files: readonly ChangedFile[], rejected: readonly string[]): RevertEntry[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out: RevertEntry[] = [];
  for (const path of rejected) {
    const f = byPath.get(path);
    if (f === undefined) {
      out.push({ path, undo: "manual", why: "不在 worktree 的变更清单里（可能已被回收）" });
      continue;
    }
    if (f.code.startsWith("R") || f.code.startsWith("C")) {
      out.push({ path, undo: "manual", why: "改名/复制条目（需删新档+还原旧档两步，本工具不自动做）" });
    } else if (f.code.includes("?")) {
      out.push({ path, undo: "delete" });
    } else if (f.code.startsWith("A")) {
      out.push({ path, undo: "delete" });
    } else {
      out.push({ path, undo: "checkout" });
    }
  }
  return out;
}

export interface RevertResult {
  done: string[];
  manual: { path: string; why: string }[];
  failed: { path: string; error: string }[];
}

/** 落实还原计划（真 git 调用；路径先过包含性检查防越界）。 */
export function applyReverts(worktree: string, entries: readonly RevertEntry[]): RevertResult {
  const root = resolve(worktree);
  const res: RevertResult = { done: [], manual: [], failed: [] };
  for (const e of entries) {
    if (e.undo === "manual") {
      res.manual.push({ path: e.path, why: e.why ?? "需人工处理" });
      continue;
    }
    const abs = resolve(root, e.path);
    if (abs !== root && !abs.startsWith(root + sep)) {
      res.failed.push({ path: e.path, error: "路径越出 worktree（拒绝还原）" });
      continue;
    }
    if (e.undo === "delete") {
      try {
        rmSync(abs, { force: true });
        res.done.push(e.path);
      } catch (err) {
        res.failed.push({ path: e.path, error: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    const r = spawnSync("git", ["-C", root, "checkout", "--", e.path], { encoding: "utf8" });
    if (r.status === 0) res.done.push(e.path);
    else res.failed.push({ path: e.path, error: (r.stderr || r.stdout || "git checkout 失败").trim().slice(0, 200) });
  }
  return res;
}

export interface Selection {
  /** 1-based 序号，升序。 */
  accepted: number[];
  rejected: number[];
}

/** 交互回答 → 接受/拒绝集合。返回 null = 跳过（什么都不动）。
 *  输入口径：`a`/`all` 全要、`r`/`n`/`none` 全拒、`1,3,5`（逗号/空格/顿号分隔）只要这些、空串跳过。
 *  非法输入返回 error（由调用方决定重问还是放弃）——**不静默回落成"全都接受"**。 */
export function parseSelection(input: string, count: number): Selection | { error: string } | null {
  const t = input.trim().toLowerCase();
  if (t === "") return null;
  if (t === "a" || t === "all") return { accepted: range(1, count), rejected: [] };
  if (t === "r" || t === "n" || t === "none") return { accepted: [], rejected: range(1, count) };
  const parts = t.split(/[,，\s、]+/u).filter((s) => s !== "");
  const picked: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > count) {
      return { error: `只认 1–${String(count)} 的编号（或 a / r / 回车）；收到：${p}` };
    }
    picked.push(n);
  }
  const set = [...new Set(picked)].sort((x, y) => x - y);
  return { accepted: set, rejected: range(1, count).filter((n) => !set.includes(n)) };
}

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

/** 决策 → card_action 动作名（逐一对应 `handleCardAction` 认的那两个字符串）。 */
export function reviewActionFor(sel: Selection): "merge" | "reject" {
  return sel.accepted.length === 0 ? "reject" : "merge";
}

/** diff 收据正文里的补丁段（`## patch` 之后）；没有该段时整段当补丁试（老形状没有分节头）。 */
export function patchSectionOf(output: string): string {
  const marker = "\n## patch\n";
  const at = output.indexOf(marker);
  return at < 0 ? output : output.slice(at + marker.length);
}
