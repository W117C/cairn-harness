// 派生层·工具失败的人话摘要（2026-11-01 真机缺陷 1：门拦下的工具在收起卡上摆的是机器面原文）。
//
// 为什么要有这一层：tool_result 的 output 是写给**模型**读的解释面——
// 「[permission denied] web_fetch 在 full-access 档下被门拒绝（审批等待超时（无人应答即按拒绝收束）
// ——该工具没有执行。这是授权状态尚未变化，不是本档位禁止这个工具……）」。
// 这是内部散文，用户读不懂；收起态直接把它摆上屏＝把过程日志当成结论给用户（业主截图投诉）。
// 这里只做一件事：把一次失败压成**一行人话**（"web_fetch 未执行 · 审批等待超时（无人应答即按拒绝收束）"）——
// ① gate 判定（tool_result.gate.verdict）说了算；② 没有 gate 留痕时认 output 的特征片段；
// ③ 认不出就走兜底。**绝不冒充成功**：失败就是失败，宁可说「调用失败」也不说「已完成」。
//
// 文案表（strings.ts）在派生层**不可 import**（I3：派生层只许吃登记过的纯模块）⇒ 文案由调用方注入，
// 本模块只负责「判成哪一条」与「拼成哪一句」。
import type { GateVerdict } from "../../../../../src/permissions/autonomy";

/** 视口/行形状里派生层真正需要的两样事实（不引整行类型，免得派生层与行形状绑死）。 */
export interface ToolFailureInput {
  /** 工具名（"web_fetch"）——人话摘要的主语。 */
  tool: string;
  /** 工具返回原文（机器面解释）。 */
  output?: string;
  /** 权限判定留痕的结果（tool_result.gate.verdict）；缺席 = 这次判定没留痕（老日志/非门路径）。 */
  gateVerdict?: GateVerdict;
}

/** 失败原因的五种人话分类（generic = 认不出的兜底，仍然是失败）。 */
export type ToolFailureReason = "timeout" | "unattended" | "denied" | "rejected" | "generic";

/** 文案表（由调用方注入：派生层不 import 文案目录）。字段名与 strings.ts 的 STR.toolGroup 一致。 */
export interface ToolFailureCopy {
  /** "{tool} 未执行 · {reason}"。 */
  failureBlocked: string;
  reasonTimeout: string;
  reasonDenied: string;
  reasonUnattended: string;
  reasonRejected: string;
  /** "{tool} 调用失败"。 */
  failureGeneric: string;
}

/** gate 判定 → 原因分类。approved / auto-approved = 门放行了，是工具自己失败 ⇒ 走兜底
 *  （不能写成「未执行」——那次调用真的跑了，谎称没跑比不分类更糟）。 */
const BY_VERDICT: Record<GateVerdict, ToolFailureReason> = {
  "auto-approved": "generic",
  approved: "generic",
  rejected: "rejected",
  timeout: "timeout",
  unattended: "unattended",
  denied: "denied",
};

/** raw 输出的特征片段 → 原因分类。
 *  **顺序要紧**：超时 / 无人值守 / 明确拒绝 这三种都裹在 denied() 的壳里
 *  （"[permission denied] <工具> 在 <档位> 档下被门拒绝（<原因>）"），
 *  所以先认壳**里面**那一句，再看壳本身。 */
const RAW_FRAGMENTS: ReadonlyArray<readonly [string, ToolFailureReason]> = [
  ["审批等待超时", "timeout"],
  ["无人值守", "unattended"],
  ["用户明确拒绝", "rejected"],
  ["被门拒绝", "denied"],
  ["[permission denied]", "denied"],
  ["fail-closed", "denied"],
];

/** 一次失败算什么原因（纯函数，判卷锚）：gate 优先，没有留痕才认 output 的形状。 */
export function toolFailureReasonOf(row: ToolFailureInput): ToolFailureReason {
  if (row.gateVerdict !== undefined) return BY_VERDICT[row.gateVerdict];
  const raw = row.output ?? "";
  for (const [fragment, reason] of RAW_FRAGMENTS) {
    if (raw.includes(fragment)) return reason;
  }
  return "generic";
}

/** 失败工具的一句话人话摘要（纯函数，判卷锚）：一行说完「哪个工具、为什么没执行」。 */
export function toolFailureSummary(row: ToolFailureInput, copy: ToolFailureCopy): string {
  const reason = toolFailureReasonOf(row);
  if (reason === "generic") return copy.failureGeneric.replace("{tool}", row.tool);
  const text = reason === "timeout" ? copy.reasonTimeout
    : reason === "unattended" ? copy.reasonUnattended
      : reason === "denied" ? copy.reasonDenied
        : copy.reasonRejected;
  return copy.failureBlocked.replace("{tool}", row.tool).replace("{reason}", text);
}
