import { isEnvVerifyCause } from "../events";
import { permissionModeRank } from "../permissions/modes";
import type { AgentEvent, AgentPermissionMode, SecurityFinding, WorkerEvidence } from "../events";
import { escapeControlTags } from "./control-tags";
import { SUMMARY_TOKEN_CAP } from "./orchestrator-config";
import { redactSecrets } from "./security/scan";
import { truncateToTokenBudget } from "./text-budget";
import { mayHaveWrittenDisk } from "./write-face";

// ---- 档位单调继承（§11.7.6）：worker ≤ 父，越界裁到父档 + 审批卡警告 ----
/** spawn 成功回执 → agent_id（拿不到即 undefined：不猜、不回落到日志反查）。审查 S2-8 配套。 */
export function parseSpawnedAgentId(output: string): string | undefined {
  try {
    const v = JSON.parse(output) as { agent_id?: unknown };
    return typeof v.agent_id === "string" && v.agent_id !== "" ? v.agent_id : undefined;
  } catch {
    return undefined;
  }
}

/** 档位判别从 `permissions/modes` 那只走（此前这里是第四份 `||` 链抄本；
 *  抄本漂了的后果不报错：`orchestrator` 用 `isPermissionMode(args.tier) ? … : parentMode` ——
 *  少认一档就静默把子跑降成父档，正好与"越界要出声"相反）。 */
export { isPermissionMode } from "../permissions/modes";

/** 越界裁剪（纯函数）：requested > parent → 裁到 parent + 警告文案；否则原样。
 *  名次从 `permissions/modes` 的那一份序里读：旧写法在这里另抄一张
 *  `{ "read-only": 0, default: 1, auto: 2 }` 数字表——加一档时编译器只报 `Record` 少键，
 *  报不了「键在、名次错」，于是新档可以插在中间而继承序仍按旧表算。 */
export function clampTier(
  requested: AgentPermissionMode,
  parent: AgentPermissionMode,
): { mode: AgentPermissionMode; clamped: boolean; warning?: string } {
  if (permissionModeRank(requested) <= permissionModeRank(parent)) return { mode: requested, clamped: false };
  return {
    mode: parent,
    clamped: true,
    warning: `worker 档位 ${requested} 越界（父会话 ${parent}）——已按父档裁剪（§11.7.6 单调继承，worker 不可提权）`,
  };
}

// ---- 输出扫描（§4.4.4）：中和仿冒控制标签、转义 Human:/Assistant: 行、[harness] 标注、redactSecrets ----

export interface ModelOutputScan {
  text: string;
  blocked: boolean;
  findings: SecurityFinding[];
}

/** 模型产出的文本进**别处**上下文前的那一遍扫描（§4.4.4，本仓唯一实现）。
 *  两支共用：worker 回传（orchestrator）与 sidechat 提升（promoteToMain）——§10.8.2 明写两者同级风险，
 *  政策一旦有两份实现，其中一支就会像历史上那样悄悄少做几件事。 */
export function scanModelOutput(text: string): ModelOutputScan {
  const r = redactSecrets(escapeControlTags(text));
  return { text: r.text, blocked: r.blocked, findings: r.findings };
}

export interface ClippedSummary {
  text: string;
  truncated: boolean;
}

/** summary 超 2000 token 类型化裁剪（沿 §6.2 整形先例：截断提示 + 截断位标记）。
 *  计量走 text-budget 的按类别权重（中文报告按 chars/4 记会被低估四倍），
 *  且提示行自己计入预算。提示文案逐字保留——agents-check G5b 按字符串断言它。 */
export function clipWorkerSummary(text: string, capTokens: number = SUMMARY_TOKEN_CAP): ClippedSummary {
  const notice = "\n[truncated: summary 超 " + String(capTokens) + " token 上限，已类型化裁剪]";
  const out = truncateToTokenBudget(text, capTokens, notice);
  return { text: out, truncated: out !== text };
}

// ---- W4b：worker「代码能跑」这句话的机器凭据（事件流纯投影，不新增事件、不造第二份状态）----

/** 写向判据只有一份：`./write-face` 的 `mayHaveWrittenDisk`（权限门的写向集 ∩ 本工作区 + shell 命令形状）。
 *  这里曾另立一张两名字清单 ⇒ shell 落盘看不见：绿拍之后用 shell 改盘仍报 `verified`，
 *  那份绿描述的不是即将合并的代码（能力 5 最忌的假绿）。 */

/** 从 worker 自己的子流里读出证据四态。
 *  为什么必须有这条：在此之前 `agent_result.artifacts` 只有 `report`——模型的一句散文自述就是全部记录，
 *  父会话与合并控制塔都无法区分「验过」与「说验过」（spec §2 缺陷 D6）。而 worker 工具表禁 manual verify
 *  （§4.4.5），所以它的证据只可能来自 W4a 的自动拍或它自己用 shell 跑出来的东西。
 *  判据刻意只看**次序**不做命令形状启发：
 *  - stale 单列：验过之后又写了盘 ⇒ 那份绿证据描述的不是即将合并的代码，不能当证据用。
 *    （把它并入 verified 就是能力 5 最忌的假绿；也不走「再补一拍」——那要改循环语义、多花真钱。）
 *  - shell 跑过的测试**不**算证据：无法区分「跑了全套」与「跑了一个文件」，
 *    拿启发式当门 = 给模型一条免费的免责通道（见 outputs/auto-verify-readout-2026-09-20.md §5）。 */
export function workerVerificationEvidence(events: AgentEvent[]): WorkerEvidence {
  let lastVerify = -1;
  let lastVerifyOk = false;
  let lastWrite = -1;
  const callById = new Map<string, { name: string; args: Record<string, unknown> }>();
  events.forEach((e, i) => {
    if (e.type === "tool_call") {
      callById.set(e.id, { name: e.name, args: e.args });
      return;
    }
    if (e.type === "tool_result") {
      const c = callById.get(e.callId);
      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) lastWrite = i;
      return;
    }
    if (e.type === "verify_result") {
      // 环境拍的证明力是零：它没跑到代码。既不许记成 `failed`（那是模型的账——升档与 bandit
      // 都由这一格驱动，等于用更贵的模型去重跑一个装不上工具链的错），也不许占用"最后一次验证"
      // 的位置（否则一条 `exit 127` 会把先前那拍绿证据顶成 absent/stale）。
      if (!e.ok && isEnvVerifyCause(e.cause)) return;
      lastVerify = i;
      lastVerifyOk = e.ok;
    }
  });
  if (lastVerify < 0) return "absent";
  if (!lastVerifyOk) return "failed";
  return lastWrite > lastVerify ? "stale" : "verified";
}

/** 这段流里有没有**成功落过盘**（判据同 `mayHaveWrittenDisk`，绝不另立一张写向清单）。
 *  goal 模式要用它区分「还没验」与「压根没打算产出」：后者继续自动跑就是纯烧钱。 */
export function hasSessionWrites(events: AgentEvent[]): boolean {
  const callById = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const e of events) {
    if (e.type === "tool_call") callById.set(e.id, { name: e.name, args: e.args });
    else if (e.type === "tool_result") {
      const c = callById.get(e.callId);
      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) return true;
    }
  }
  return false;
}
