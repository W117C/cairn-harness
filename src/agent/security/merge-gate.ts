// 合并准入闸的**纯判据**：哪些安全 findings 挡住一次 worker 合并。
//
// 为什么单开一支（而不是让判卷去读 orchestrator 那一行内联过滤器）：
// 本仓最忌「同一条判据各抄一份」——判卷抄一份、orchestrator 留一份，两份迟早漂，
// 而漂掉的方向恰恰是「判卷还在验、闸已经放行」。这里出纯函数、生产与判卷**共用同一份**，
// 与 `orchestrator.ts` 末尾那批「拆分面再导出」是同一条既定做法（同 provider-key-inject 先例）。
//
// 它量的正是本仓目前**唯一没有证人**的那一格（2026-10-02 普查结论）：
// `src/agent/security/llm-review.ts` 的 `llmReviewDiff` 补出来的 high/critical，
// 能不能真的挡住 `mergeWorker`。在此之前，把 `high` 从这个过滤器里删掉、
// 或让 `parseLlmFindings` 把 severity 降级，全仓 3754 条断言**一条都不会红**。
import type { SecurityFinding, SecuritySeverity } from "../../events";

/** 挡合并的两档（§11.6 gate 档）。为什么是这两档、不是全部非 low：
 *  low/medium 是提示，挡下来会让 gate 变成「必须零告警才能合并」，实践中等于关掉；
 *  high/critical 才是「合了要回滚」那一档。**这一格不许靠改数组了事**——
 *  去掉 `high` 会让「LLM 补出来的高危」全部放行，而那正是本模块存在的理由。 */
export const MERGE_BLOCKING_SEVERITIES: readonly SecuritySeverity[] = ["critical", "high"];

export function isMergeBlocking(f: Pick<SecurityFinding, "severity">): boolean {
  return MERGE_BLOCKING_SEVERITIES.includes(f.severity);
}

/** 挡合并的 findings（保持原顺序，便于卡面逐条点名）。 */
export function mergeBlockingFindings(findings: readonly SecurityFinding[]): SecurityFinding[] {
  return findings.filter(isMergeBlocking);
}

/** gate 档的合并裁决（纯函数，判卷与生产同源）。
 *
 *  三态而不是两态，是这一格的关键：
 *   allow  = 没有挡合并的 findings；
 *   block  = 有，且**没有**人明确要「仍要合并」（force）——合并权永远在人；
 *   forced = 有，但人已显式二次确认（force=true）。
 *  把 forced 与 block 合成一态，force 这条路就成了没人验证的分支。
 *
 *  ⚠️ 三条臂都带 `forced` 字段（不是只给 forced 那条）：判卷要断「不带 force 的那次调用
 *  forced 为 false」，若该字段只在一条臂上存在，TS 会把「读它」判成错——而那正是
 *  「force 只对当次生效」这条判据要读的东西。字段齐全比省一个字节重要。 */
export type MergeGateVerdict = {
  allow: boolean;
  /** 人是否已显式二次确认（逐次参数，不记忆）。 */
  forced: boolean;
  blocking: readonly SecurityFinding[];
};

export function mergeGateVerdict(
  findings: readonly SecurityFinding[],
  opts: { force?: boolean } = {},
): MergeGateVerdict {
  const blocking = mergeBlockingFindings(findings);
  if (blocking.length === 0) return { allow: true, forced: false, blocking: [] };
  if (opts.force === true) return { allow: true, forced: true, blocking };
  return { allow: false, forced: false, blocking };
}

/** 卡面文案（判卷与生产共用一份措辞——同一谓词不抄两份，散文同理）。 */
export function mergeGateMessage(blocking: readonly SecurityFinding[]): string {
  const named = blocking.slice(0, 3).map((f) => `${f.path}:${String(f.line)} ${f.title}`).join("；");
  return `gate：存在 critical|high findings ${String(blocking.length)} 条（${named}）`
    + "——合并卡红标，需二次确认（force=true「仍要合并」；合并权永远在人）";
}