// 周期 Assess（SEMA Phase 5 · 批次 C2）：把三路观测账折成一份「进化面体检报告」，
// 并在自治档放开时执行「零权限 content-pack 自动安装 + canary 观察期开档」。
//
// 三路喂料（§7 Phase 5「周期 Assess 驱动重组、lesson 库喂 Planner」的最小落地）：
//  1. **registry 账**：staged 且全门绿但从未装过的包 ⇒ 待办（manual 档 = human-review；
//     gated-auto 档且零权限 content-pack ⇒ 自动装 + 开观察期——Phase 4「运行面装载」的接线位，
//     之前 begin() 从没有生产调用方，观察期整条链是断的）；
//  2. **evolution 账本**（批次 A1 的产物）：复发连击 ≥ 阈值的补丁 key ⇒ 进「该换个方子了」名单，
//     连同读数一并进报告——这就是喂给未来 Planner 的那份料（报告是接口，Planner 是后来的消费者）；
//  3. **canary 回退档**：rolled-back / degraded 的观察档 ⇒ 点名包 id 与退化规则——回退过什么、
//     为什么，是 Planner 最不该再提一遍的提案方向。
//
// 纪律：
//  · 报告落 `.agent/assess-report.json`（模型侧消费的家当目录，与 evolution.json 同居）；
//    **报告只是观测**——除了自治档明示放开的自动安装那一支，Assess 不改任何运行面；
//  · 自动安装走 Installer 的既有安全序（先裁决、再查账、后动文件、最后切指针），
//    观察期基线从 evolution 账本的 tokensPerBoundary 中位数取（没读数 = 无基线，
//    cost-per-progress 规则不判——canary.ts 的既有语义，不编造）；
//  · 零行为边界：工作区没有 modules/ ⇒ 不出报告不动作（与 activation-host 同口径）。

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import { loadLedger, medianOf, projectLedger, RECURRENCE_ESCALATE_MIN_STREAK, type LedgerKeyStats } from "../../agent/evolution/ledger";
import { loadAutonomy, autoInstallEligible, type AutonomyTier } from "./autonomy";
import { openEvolutionRegistry } from "./activation-host";
import { graduationCandidates, WORKFLOW_GRADUATE_MIN_HITS, type WorkflowGraduation } from "./workflow-graduate";
import { Installer } from "./installer";
import { GrantsStore } from "./grants";
import { CanaryController } from "./canary";
import type { RegistryIndex } from "./registry";

/** 自动档执行者的账面 actor（registry 的 assertActor 规矩：可读、非空、有界）。 */
export const ASSESS_ACTOR = "evolution-assess-v1";

export const ASSESS_REPORT_FILE = "assess-report.json";

export function assessReportPathFor(workspace: string): string {
  return join(workspace, ".agent", ASSESS_REPORT_FILE);
}

/** 复发连击多少算「该换方子」：与 ledger.RECURRENCE_ESCALATE_MIN_STREAK 同值同义——
 *  措辞升级（提示词层）与升级上报（Assess 层）是同一个阈值的两张脸，各自抄数会漂。 */

/** canary 观察档的最小读面料（不依赖 canary.ts 的完整形状——报告只要这三格）。 */
export interface CanaryFinding {
  id: string;
  candidateVersion: string;
  state: string;
  degradationRules: string[];
}

export interface AssessInputs {
  index: Pick<RegistryIndex, "bundles">;
  patchStats: Record<string, LedgerKeyStats>;
  workflowHits: WorkflowGraduation[];
  canaryFindings: CanaryFinding[];
  registeredWorkflowIds: ReadonlySet<string>;
}

export type AssessFinding =
  | { kind: "auto-install-candidate"; id: string; version: string; detail: string }
  | { kind: "human-review"; id: string; version: string; detail: string }
  | { kind: "recurring-patch"; key: string; streak: number; detail: string }
  | { kind: "workflow-graduate"; topic: string; hits: number; detail: string }
  | { kind: "canary-lesson"; id: string; state: string; detail: string };

export interface AssessReport {
  version: 1;
  ts: number;
  tier: AutonomyTier;
  findings: AssessFinding[];
}

/** 一版 staged 包是不是「全门绿」（注册时定格的 declaredGates 每道都有 pass 结论）。 */
function allGatesGreen(gates: Record<string, "pass" | "fail">, declared: readonly string[]): boolean {
  return declared.length > 0 && declared.every((g) => gates[g] === "pass");
}

/** 纯判定：三路料 ⇒ 报告。排序稳定（id/key 字典序），同输入同输出（可判卷）。 */
export function assess(inputs: AssessInputs, tier: AutonomyTier, ts: number): AssessReport {
  const findings: AssessFinding[] = [];
  // 1) registry 账：从未装过（bundle 无 active）的 staged 版本，全门绿的才有资格进待办。
  for (const [id, entry] of Object.entries(inputs.index.bundles).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (entry.active !== undefined) continue;
    const versions = Object.entries(entry.versions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const latest = versions[versions.length - 1];
    if (latest === undefined) continue;
    const [version, v] = latest;
    if (v.prunedAt !== undefined || v.deprecatedAt !== undefined) continue;
    if (!allGatesGreen(v.gates, v.declaredGates)) continue;
    const eligibility = autoInstallEligible({ kind: entry.kind, permissions: v.permissions }, tier);
    if (eligibility.eligible) {
      findings.push({ kind: "auto-install-candidate", id, version, detail: eligibility.reason });
    } else {
      findings.push({ kind: "human-review", id, version, detail: eligibility.reason });
    }
  }
  // 2) evolution 账：复发连击过线的补丁 key。
  for (const stats of Object.values(inputs.patchStats).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (stats.recurrenceStreak >= RECURRENCE_ESCALATE_MIN_STREAK) {
      findings.push({
        kind: "recurring-patch",
        key: stats.key,
        streak: stats.recurrenceStreak,
        detail: "同一问题跨轮复发 " + String(stats.recurrenceStreak) + " 次连击（发出 " + String(stats.emitted) + " 次）——规则方子没治住，该换思路",
      });
    }
  }
  // 3) 打法毕业面：高命中但还没注册成 content-pack 的 workflow。
  for (const g of inputs.workflowHits) {
    if (!inputs.registeredWorkflowIds.has("content-pack." + g.topic)) {
      findings.push({ kind: "workflow-graduate", topic: g.topic, hits: g.hits, detail: "强度账 hits=" + String(g.hits) + " ≥ " + String(WORKFLOW_GRADUATE_MIN_HITS) + "，可毕业进流水线" });
    }
  }
  // 4) canary 回退档：回退过什么，Planner 最不该再提。
  for (const c of inputs.canaryFindings) {
    if (c.state === "rolled-back" || c.state === "degraded") {
      findings.push({ kind: "canary-lesson", id: c.id, state: c.state, detail: "候选 " + c.candidateVersion + " 观察期" + (c.degradationRules.length > 0 ? "命中 " + c.degradationRules.join("、") : "退化回退") + "——同方向提案需先解释为何这次不同" });
    }
  }
  return { version: 1, ts, tier, findings };
}

/** 读盘上 canary 档的最小三格（坏档只丢那一条——同账本坏行纪律）。 */
async function readCanaryFindings(workspace: string): Promise<CanaryFinding[]> {
  const out: CanaryFinding[] = [];
  let names: string[];
  try {
    names = await readdir(join(workspace, ".agent", "canary"));
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(join(workspace, ".agent", "canary", name), "utf8")) as {
        id?: unknown; candidateVersion?: unknown; state?: unknown; degradations?: unknown;
      };
      if (typeof raw.id !== "string" || typeof raw.candidateVersion !== "string" || typeof raw.state !== "string") continue;
      const rules = Array.isArray(raw.degradations)
        ? raw.degradations.filter((d): d is { rule: string } => typeof d === "object" && d !== null && typeof (d as { rule?: unknown }).rule === "string").map((d) => d.rule)
        : [];
      out.push({ id: raw.id, candidateVersion: raw.candidateVersion, state: raw.state, degradationRules: rules });
    } catch {
      continue; // 坏档丢一条，不点名阻塞（canary.tickAll 的 refused 面会另出声）
    }
  }
  return out;
}

export interface AssessRunResult {
  report: AssessReport;
  reportPath: string | null;
  /** 自动档执行了的动作（manual 档恒空）。 */
  autoInstalled: Array<{ id: string; version: string; outcome: "installed" | "observing" | "failed"; detail?: string }>;
}

/** 收束缝的一行入口。modules/ 缺席 ⇒ 返回 null（零行为）；任何一支失败出声不抛。 */
export async function runAssess(workspace: string): Promise<AssessRunResult | null> {
  const opened = await openEvolutionRegistry(workspace, []);
  if (opened.kind === "absent") return null;
  if (opened.kind === "broken") {
    console.warn("[assess] 账本读不动（" + opened.detail + "）——本轮不出体检报告；先修账，报告会自动回来");
    return null;
  }
  const { registry, index } = opened;
  const ledger = await loadLedger(workspace);
  if (ledger.badLines > 0) {
    // 这里读账不在 evolution 那把锁内（Assess 是旁路观测）：读到的最后一行可能是并发追加的
    // 半行——按坏行丢掉并出声，下一轮 Assess 会读到完整行。
    console.warn("[assess] evolution 账本有 " + String(ledger.badLines) + " 行认不出（坏行只丢那一条，投影按读到的事件折）");
  }
  const projection = projectLedger(ledger.events);
  const report = assess(
    {
      index,
      patchStats: projection.stats,
      workflowHits: await graduationCandidates(workspace),
      canaryFindings: await readCanaryFindings(workspace),
      registeredWorkflowIds: new Set(Object.keys(index.bundles)),
    },
    (await loadAutonomy(workspace)).tier,
    Date.now(),
  );
  let reportPath: string | null = null;
  try {
    reportPath = assessReportPathFor(workspace);
    await writeFileAtomic(reportPath, JSON.stringify(report, null, 2) + "\n");
  } catch (err) {
    reportPath = null;
    console.warn("[assess] 报告落盘失败（动作照常执行，只丢观测面）: " + (err instanceof Error ? err.message : String(err)));
  }

  // 自动档执行面：manual 档一个指头都不动（报告已把候选列进 human-review）。
  const autoInstalled: AssessRunResult["autoInstalled"] = [];
  if (report.tier === "gated-auto") {
    const installer = new Installer(registry);
    const baseline = medianOf(projection.recentTokensPerBoundary);
    const controller = new CanaryController({ registry, workspace });
    for (const f of report.findings) {
      if (f.kind !== "auto-install-candidate") continue;
      try {
        // 授权面从 grants.json 现读（与 evolution-plane.installApprovedProposal 同一取料面：
        // grants 与 registry.jsonl 同住 modules/）；零权限包不比对授权，但走同一道裁决序。
        await installer.installStaged({ id: f.id, version: f.version, actor: ASSESS_ACTOR, grants: await new GrantsStore(dirname(registry.paths.log)).load() });
        // 装完即观察（Phase 4 的运行面装载）：基线没读数 = 无基线，cost 规则不判（不编造）。
        await controller.begin({ id: f.id, ...(baseline !== null ? { baselineTokensPerBoundary: baseline } : {}) });
        autoInstalled.push({ id: f.id, version: f.version, outcome: "installed" });
        console.warn("[assess] 自治安装 " + f.id + "@" + f.version + " 已生效并进入观察期" + (baseline !== null ? "（cost 基线 " + String(baseline) + "）" : "（无 cost 基线，cost 规则不判）"));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        autoInstalled.push({ id: f.id, version: f.version, outcome: "failed", detail });
        console.warn("[assess] 自治安装 " + f.id + "@" + f.version + " 失败: " + detail);
      }
    }
  }
  return { report, reportPath, autoInstalled };
}
