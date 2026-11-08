// M8 · 正向打法蒸馏（自进化批次 B1）：从**成功**轨迹提炼「这套工具组合验证过能成」，
// 作为 project 记忆落盘——与 lessons.ts（负向：失败教训）构成一正一负两条腿。
//
// 对标（Voyager 技能库 / Agent Workflow Memory 的最小本仓版）：
//  · **打法的最小单元**：一段**连续工具调用序列**（主会话、当前用户轮）紧跟一拍**绿** verify——
//    「这么走、然后验证过了」才配叫打法；绿 verify 是唯一的前向证据（同 lessons 拿红 verify
//    当负向证据的镜像面）。
//  · **复现才算**（RECUR_MIN = 2，与 lessons 的 TOOL_STREAK_MIN 同档思路）：同一签名
//    （工具名序列 + 参数形状序列）在本跑出现 ≥2 次且**每次都绿**才蒸馏。只出现过一次的
//    成功序列只是「这一跑碰巧成了」，不沉淀——无复现不产出，与「无出处不写」同一道门。
//  · **签名不带值**：args 只取键集（排序），不取值——值是这一跑的具体参数，进了签名
//    就永远匹配不上第二次；键集表达的是「调用形状」，才是可复用的那一层。
//
// 落盘形状（零新机制）：topic = `workflow-<签名哈希>`（稳定——同一打法跨会话重蒸馏落同一条，
// 天然去重覆盖），type = project（四类型不动，进既有索引/检索/强度账，M7 的 RECALL 直接可命中）。
// 证据纪律同 lessons：evidence-line（首个复现的 callId）+ session-line，无出处不写。

import type { AgentEvent, ToolCallEvent, VerifyResultEvent } from "../../events";
import { eventsForCurrentRun } from "../delivery-guard";
import { sessionOf } from "./lessons";
import { projectMemoryDir, writeTopic } from "./store";

export const WORKFLOW_TOPIC_PREFIX = "workflow-";
/** 记忆四类型不动：打法是项目层事实（换项目就不适用），走 project。 */
export const WORKFLOW_MEMORY_TYPE = "project" as const;
/** 同一签名至少复现这么多次（且每次都绿）才算打法。 */
export const RECUR_MIN = 2;
/** 一段打法里的调用步数上限（超长的序列是「整个任务」不是「子程序」，蒸馏了也没法复用）。 */
export const WORKFLOW_MAX_STEPS = 12;
/** 正文里摘录的字节上限（记忆会被回注，正文太长把预算吃光——同 lessons 的 EXCERPT_LIMIT）。 */
const BODY_LIMIT = 2_000;

/** 一步的形状：工具名 + 参数键集（排序，不带值）。 */
interface StepShape {
  tool: string;
  argKeys: string;
}

/** 一个候选：签名相同的连续段（各自带证据 callId 与收尾的绿 verify callId）。 */
interface Occurrence {
  steps: { shape: StepShape; callId: string }[];
  verifyCallId: string;
}

export interface WorkflowEntry {
  /** 文件名（不含 .md）：workflow-<哈希>。 */
  topic: string;
  body: string;
}

/** 参数键集的稳定序列化：排序 + 逗号连（undefined args = 空集）。 */
function argKeysOf(args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  return Object.keys(args).sort().join(",");
}

function isWorkerEvent(e: AgentEvent): boolean {
  return typeof (e as { agent_id?: unknown }).agent_id === "string";
}

function isGreenVerify(e: AgentEvent): e is VerifyResultEvent {
  return e.type === "verify_result" && e.ok === true;
}

/** FNV-1a 32 位（够用：topic 后缀只要稳定不要密码学强度；与仓库其余哈希口径一致的无依赖实现）。 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function signatureOf(steps: readonly { shape: StepShape }[]): string {
  return steps.map((s) => s.shape.tool + "(" + s.shape.argKeys + ")").join("->");
}

/** 从事件流蒸馏打法（纯函数）。主会话、当前用户轮；worker 子流不替父会话表态
 *  （failureDigestFromEvents 2026-10-19 修的同一族过滤，这里从第一行就带上）。 */
export function distillWorkflows(events: AgentEvent[], logPath: string): WorkflowEntry[] {
  const scoped = eventsForCurrentRun(events).filter((e) => !isWorkerEvent(e));
  // 扫描段：连续 tool_call 攒进当前段；遇 verify（无论红绿）或任何非 tool_call 事件，段终止——
  // 「紧跟一拍绿 verify」的紧跟就是字面意义：中间隔了别的回合就不是这套组合的功劳。
  const occurrences: Occurrence[] = [];
  let current: { shape: StepShape; callId: string }[] = [];
  const flushWith = (verify: VerifyResultEvent | null) => {
    if (verify !== null && current.length >= 2 && current.length <= WORKFLOW_MAX_STEPS) {
      occurrences.push({ steps: current, verifyCallId: verify.callId });
    }
    current = [];
  };
  for (const e of scoped) {
    if (e.type === "tool_call") {
      current.push({ shape: { tool: (e as ToolCallEvent).name, argKeys: argKeysOf((e as ToolCallEvent).args) }, callId: (e as ToolCallEvent).id });
      continue;
    }
    // tool_result 是步的一部分，**不打断段**（复查修的实锤 bug：真实事件流里 call 与 result 交错
    // ——t1 call、t1 result、t2 call、t2 result、verify；把 result 当打断事件 ⇒ 每步之后段都被清空
    // ⇒ 生产上永远凑不满 ≥2 步，整个模块空转。测试当时没抓住，因为合成序列里没放 result——
    // 这条注释连同下面的交错回归用例就是那次的立案）。段内某步失败要不要除名？不除：收尾的
    // 绿 verify 才是这段路径的判据，失败-重试-再成功本就是打法的形状。
    if (e.type === "tool_result") {
      continue;
    }
    if (e.type === "verify_result") {
      flushWith(isGreenVerify(e) ? e : null);
      continue;
    }
    // 别的事件（user/assistant 散文）打断段：工具调用之间夹着模型发言 = 模型重新决策过，
    // 这就不是一段连续子程序了。
    flushWith(null);
  }
  flushWith(null); // 跑尾没 verify 的段不成打法（无验证不沉淀）

  // 按签名分组；每组 ≥RECUR_MIN 次才出条目。
  const bySignature = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const sig = signatureOf(occ.steps);
    const list = bySignature.get(sig) ?? [];
    list.push(occ);
    bySignature.set(sig, list);
  }
  const session = sessionOf(logPath);
  const out: WorkflowEntry[] = [];
  for (const [sig, group] of [...bySignature.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (group.length < RECUR_MIN) continue;
    const first = group[0]!;
    const body = [
      "适用：需要 " + first.steps.map((s) => s.shape.tool).join(" → ") + " 这套组合的任务（本会话验证过 " + String(group.length) + " 次，均绿）。",
      "打法（按序执行，收尾必须 verify）：",
      ...first.steps.map((s, i) => String(i + 1) + ". " + s.shape.tool + (s.shape.argKeys.length > 0 ? "（参数键：" + s.shape.argKeys + "）" : "")),
      ...group.slice(0, RECUR_MIN).flatMap((occ) => [
        "evidence-line: " + occ.steps[0]!.callId,
        "evidence-line: " + occ.verifyCallId,
      ]),
      "session-line: " + session,
    ].join("\n");
    out.push({ topic: WORKFLOW_TOPIC_PREFIX + fnv1a(sig), body: body.slice(0, BODY_LIMIT) });
  }
  return out;
}

/** 写盘（project 层免批直写——分层审批第十一遍裁决的口径，与 lessons 同层）。
 *  同一 topic 覆盖：同一打法重蒸馏落同一条（writeTopic 的 upsert 语义），不翻倍。
 *  写失败抛给调用方（收束缝只出声不阻塞）。 */
export async function writeWorkflows(workspace: string, entries: readonly WorkflowEntry[], nowISO: string): Promise<number> {
  const dir = projectMemoryDir(workspace);
  let written = 0;
  for (const entry of entries) {
    await writeTopic(dir, entry.topic, WORKFLOW_MEMORY_TYPE, entry.body, nowISO);
    written += 1;
  }
  return written;
}

/** 读料口（毕业判据用）：给 workflow- 前缀的 topic 名配会话出处——从正文 session-line 行取。 */
export function sessionLineOf(body: string): string | null {
  for (const line of body.split("\n")) {
    if (line.startsWith("session-line: ")) return line.slice("session-line: ".length).trim();
  }
  return null;
}
