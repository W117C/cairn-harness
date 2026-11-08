// 打法毕业（自进化批次 B2）：M7 强度账里**反复被检索命中**的 workflow- 记忆，
// 升格为 content-pack 提案进 SEMA 流水线（modules/staging → 门 → 人工/自治安装 → canary）。
//
// 为什么走流水线而不直接进系统提示词：记忆条目是「按检索词面碰巧命中」的软注入
// （RECALL 段，预算 3 条）；毕了业的打法是**常驻提示词面**（active content-pack，装配缝拼接）——
// 从「偶尔被想起」到「一直在场」是权限升级，必须过门（prompt-surface-check / prefix-churn-check）
// 并留可回滚的账（registry）。这也是 SEMA Phase 5「lesson 库喂 Planner」的第一条真实流量：
// 进化平面从此有了非测试的提案来源，evolution-check 门立门的条件（真实 staging 流量）开始积累。
//
// 判据（单一事实源：M7 强度账 memory-stats.json 的 hits）：
//  · hits ≥ WORKFLOW_GRADUATE_MIN_HITS（3）：被检索命中过三次 = 它真的在跨会话被需要，
//    一次命中就毕业等于把「碰巧词面撞上」读成「被反复需要」；
//  · **毕业一次**：registry 里已有同 id ⇒ 跳过（重提须 bump version；后续版本等更强判据，
//    不在收束缝里自动刷版本——常驻提示词面的变更频率自己得有节制）；
//  · 正文即包体：prompt.md = 记忆正文原样（evidence/session 行一并带走——进了提示词也留着
//    出处，「无出处不产出」不分层）。
//
// 零行为边界：工作区没有 modules/ ⇒ 不建目录、不提案（同 activation-host 的口径）。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseIndex,
  projectMemoryDir,
  readStats,
  readTopicBody,
  MEMORY_INDEX,
} from "../../agent/memory/store";
import { WORKFLOW_TOPIC_PREFIX } from "../../agent/memory/workflow";
import { EvolutionPlane, ProposalRefusedError } from "./evolution-plane";
import { openEvolutionRegistry } from "./activation-host";
import type { BundleManifest } from "./manifest";

/** 毕业的命中门槛：M7 强度账 hits ≥ 3。 */
export const WORKFLOW_GRADUATE_MIN_HITS = 3;

/** content-pack 提案声明的门（名单在 scripts/gate-manifest.ts 的 GATES 里；这里只是引用）。 */
export const WORKFLOW_PACK_GATES: readonly string[] = ["prompt-surface-check", "prefix-churn-check"];

export interface WorkflowGraduation {
  topic: string;
  hits: number;
}

/** 高命中打法的提名（纯读料）：索引里 workflow- 前缀 + 强度账 hits 过线。
 *  无账 / 索引读不动 ⇒ 空列表（fail-closed：没证据不提名，不静默编）。 */
export async function graduationCandidates(workspace: string, minHits: number = WORKFLOW_GRADUATE_MIN_HITS): Promise<WorkflowGraduation[]> {
  const dir = projectMemoryDir(workspace);
  let indexRaw: string;
  try {
    indexRaw = await readFile(join(dir, MEMORY_INDEX), "utf8");
  } catch {
    return [];
  }
  const stats = await readStats(dir);
  const out: WorkflowGraduation[] = [];
  for (const entry of parseIndex(indexRaw)) {
    if (!entry.topic.startsWith(WORKFLOW_TOPIC_PREFIX)) continue;
    const hits = stats[entry.topic]?.hits ?? 0;
    if (hits >= minHits) out.push({ topic: entry.topic, hits });
  }
  return out.sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
}

/** 打法 → content-pack 提案的形状（纯函数；topic 已保证 [a-z0-9-] 形状——哈希后缀 + 固定前缀）。 */
export function workflowProposal(topic: string, hits: number, body: string): { manifest: BundleManifest; files: Record<string, string> } {
  const manifest: BundleManifest = {
    id: "content-pack." + topic,
    // 版本携带毕业时的命中数：同一打法后续若解禁重提，更高的 hits 天然是更高的版本号。
    version: "0." + String(hits) + ".0",
    kind: "content-pack",
    entry: "prompt.md",
    deps: [],
    permissions: [],
    gates: [...WORKFLOW_PACK_GATES],
    title: "打法：" + topic,
    description: "由跨会话反复命中的 workflow 记忆毕业而来（hits=" + String(hits) + "）。",
  };
  return { manifest, files: { "prompt.md": body } };
}

export interface GraduationOutcome {
  topic: string;
  outcome: "submitted" | "skipped-registered" | "refused";
  detail?: string;
}

/** 收束缝的一行入口：提名 → 过滤已注册 → 逐条提交进 staging。任何一条红都只出声（返回 refused），
 *  不抛——毕业是增益，不许它把收束缝打红。modules/ 缺席 ⇒ 空数组（零行为）。 */
export async function maybeGraduateWorkflows(workspace: string): Promise<GraduationOutcome[]> {
  const opened = await openEvolutionRegistry(workspace, WORKFLOW_PACK_GATES);
  if (opened.kind === "absent") return [];
  if (opened.kind === "broken") {
    return [{ topic: "-", outcome: "refused", detail: "账本读不动，本链跳过毕业（不是没有候选；先修账）：" + opened.detail }];
  }
  const { registry, index } = opened;
  const candidates = await graduationCandidates(workspace);
  if (candidates.length === 0) return [];
  const plane = new EvolutionPlane({ registry, requiredGatesByKind: {} });
  const out: GraduationOutcome[] = [];
  for (const c of candidates) {
    if (index.bundles["content-pack." + c.topic] !== undefined) {
      out.push({ topic: c.topic, outcome: "skipped-registered" });
      continue;
    }
    const body = await readTopicBody(projectMemoryDir(workspace), c.topic);
    if (body === null || body.trim().length === 0) {
      out.push({ topic: c.topic, outcome: "refused", detail: "正文读不出（无正文不提案——与 RECALL 无正文不注同一道门）" });
      continue;
    }
    const proposal = workflowProposal(c.topic, c.hits, body);
    try {
      await plane.submitProposal({ manifest: proposal.manifest as unknown, files: proposal.files });
      out.push({ topic: c.topic, outcome: "submitted" });
    } catch (err) {
      // 拒绝即无痕（evolution-plane 的纪律）；这里只回执拒因。
      const detail = err instanceof ProposalRefusedError ? err.message : err instanceof Error ? err.message : String(err);
      out.push({ topic: c.topic, outcome: "refused", detail });
    }
  }
  return out;
}
