import type { EventLog } from "../events";
import { denyReason, gate, type PermissionMode, type ToolResultWithAudit } from "../permissions";
import type { Provider } from "../providers";
import type { VerifyHook } from "./verify";
import { failureDigest } from "./verify";
import { TOOLS, type ClarifyChannel, type PlanChannel, type ToolName } from "../tools";

export interface LoopOptions {
  provider: Provider;
  events: EventLog;
  /** 工作区：工具的路径根、run_shell 的 cwd。 */
  workspace: string;
  /** 权限档，默认 default。 */
  mode?: PermissionMode;
  /** M0 全程脚本驱动，固定 false（ask 按 deny fail-closed）。 */
  interactive?: boolean;
  /** 防失控护栏。 */
  maxSteps?: number;
  /** 任务描述：作为首条 user_message 落入事件流。 */
  userMessage?: string;
  /** 澄清门通道：接了 clarify 工具才挂得起；缺省 fail-closed。 */
  clarify?: ClarifyChannel;
  /** 方案门通道：接了 propose_plan 工具才挂得起；缺省 fail-closed。 */
  plan?: PlanChannel;
  /** 验证门钩子：接了才支持 verify 反射循环（成功即停 / 上限耗尽即停）。 */
  verify?: VerifyHook;
}

// agent loop：事件流 → 模型 → 工具 → 事件流。
// 每轮向 provider 要下一条输出：assistant_message 直接落事件流；
// tool_call 落事件流 → 过权限门 → 执行 → tool_result 落事件流，继续下一轮；
// provider 序列耗尽（next() 返回 null）即任务结束。
// verify 是系统门不是普通工具：调 verify_hook 跑 lint/test，
//   通过 → 立即停止（不再调用模型）；失败 → 错误输出注入同轮继续修；
//   连续失败达上限（缺省 3）→ verify_result(failed) 后停止（不再调用模型）。
export async function runLoop(opts: LoopOptions): Promise<void> {
  const { provider, events, workspace, userMessage } = opts;
  const mode = opts.mode ?? "default";
  const interactive = opts.interactive ?? false;
  const maxSteps = opts.maxSteps ?? 50;
  const maxVerify = opts.verify?.maxAttempts ?? 3;
  let verifyAttempts = 0;

  if (userMessage !== undefined) {
    await events.append({ type: "user_message", content: userMessage });
  }

  for (let step = 0; step < maxSteps; step++) {
    const output = await provider.next();
    if (!output) return; // 模型认为任务结束

    await events.append(output);
    if (output.type !== "tool_call") continue; // assistant_message：继续下一轮

    // ---- verify 反射循环（系统门，优先于权限门与 TOOLS）----
    if (output.name === "verify") {
      if (!opts.verify) {
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: "verify: 未接线验证门（fail-closed）",
        });
        continue;
      }
      verifyAttempts++;
      const attempt = verifyAttempts;
      const outcome = await opts.verify.run();
      await events.append({
        type: "verify_result",
        callId: output.id,
        ok: outcome.ok,
        attempt,
        maxAttempts: maxVerify,
        results: outcome.results,
      });
      if (outcome.ok) return; // 验证通过 → 立即停止，不再调用模型
      if (attempt >= maxVerify) {
        // 上限耗尽 → verify_result(failed) 已落，停止且不再调用模型
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: `[verify] 连续失败 ${String(attempt)}/${String(maxVerify)} 次，已达上限，停止`,
        });
        return;
      }
      // 失败 → 错误输出注入同轮继续修
      await events.append({
        type: "tool_result",
        callId: output.id,
        ok: false,
        output: failureDigest(outcome),
      });
      continue;
    }

    // 权限门：先过门再动手（verify 已在上面分支处理，此处 name 不含 verify）
    const name = output.name as Exclude<ToolName, "verify">;
    const decision = gate(mode, name, interactive);
    if (decision !== "allow") {
      const reason = decision === "deny" ? denyReason(name) : null;
      await events.append({
        type: "tool_result",
        callId: output.id,
        ok: false,
        output: `[permission denied] ${output.name} 在 ${mode} 档（${interactive ? "交互" : "非交互"}）下被门拒绝（${decision}${reason ? `：${reason}` : ""}）`,
      });
      continue;
    }

    const tool = TOOLS[name];
    let result;
    if (!tool) {
      result = { ok: false, output: `unknown tool: ${output.name}` };
    } else {
      const ctx = {
        workspace,
        emit: (e: Parameters<EventLog["append"]>[0]) => events.append(e),
        callId: output.id,
        clarify: opts.clarify,
        plan: opts.plan,
      };
      try {
        result = await tool.run(output.args, ctx);
      } catch (err) {
        result = { ok: false, output: err instanceof Error ? err.message : String(err) };
      }
    }
    // M1c：gatedTool 自动放行时在结果上附带审计元数据（结构扩展），透传进 tool_result 事件
    const audit = (result as ToolResultWithAudit).auto;
    await events.append({
      type: "tool_result",
      callId: output.id,
      ok: result.ok,
      output: result.output,
      ...(audit ? { auto: audit } : {}),
    });
  }
  throw new Error(`agent loop 超过 maxSteps=${String(maxSteps)}，强制中止`);
}
