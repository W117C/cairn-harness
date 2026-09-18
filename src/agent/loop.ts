import type { AgentEvent, EventLog } from "../events";
import { denyReason, gate, type PermissionMode, type ToolResultWithAudit } from "../permissions";
import type { HookEngine } from "./plugins/hooks";
import { projectContext } from "./context";
import type { LegacyNextProvider, ModelOutput, Provider } from "../providers";
import { streamFromNextSource } from "../providers";
import { failureDigest, type VerifyHook, type VerifyOutcome } from "./verify";
import { TOOLS, type ClarifyChannel, type PlanChannel, type ToolContext, type ToolName } from "../tools";

export interface LoopOptions {
  /** 新形态：stream(messages, tools) → AsyncIterable<Event>（§3.3 统一接口）；
   *  兼容旧形态：{ next() }（冻结脚本注入的 scripted provider），两种都走同一条事件管线。 */
  provider: Provider | LegacyNextProvider;
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
  /** M7 影响面钩子：注入后 write_file/edit_file 成功落盘会回注跨文件波及。
   *  缺省 undefined = 零行为（与 ToolContext.impact 同源，透传不加工）。 */
  impact?: ToolContext["impact"];
  /** M2e 插件 hook 引擎：未接线 = 零行为（无插件会话事件流字节不变）。 */
  hooks?: HookEngine;
  /** M2f 工具表白名单（硬闸）：给出时不在表内的工具一律拒绝执行——不是提示词自觉，是工具表摘除。
   *  缺省 undefined = 全表可见（既有路径字节不变）。 */
  allowedTools?: readonly ToolName[];
  /** M3a worker 工具表覆盖（编排内核注入独立工具面，如只读 shell_ro）；缺省 undefined = 全局 TOOLS
   *  （既有路径字节不变）。先于 allowedTools 硬闸之后的执行面查表。 */
  tools?: Record<string, import("../tools").Tool>;
  /** M3a 取消信号（编排器 AbortController 树）：中止于轮界（工具执行中不打断，轮末收束）。
   *  缺省 undefined = 无取消（既有路径字节不变）。 */
  signal?: AbortSignal;
}

// agent loop：事件流 → 模型 → 工具 → 事件流。
// 每轮向 provider 要一轮事件流（stream(messages, tools)），逐事件落日志：拉取与工具执行交错
//（for-await 语义：消费一条、执行一条、再拉下一条），与旧 next() 逐条拉取的日志逐字节同序。
// assistant_delta / assistant_message / usage 直接落事件流；
// tool_call 落事件流 → 过权限门 → 执行 → tool_result 落事件流，轮内继续；
// 一轮无 tool_call（纯文本）即任务结束。
// verify 是系统门不是普通工具：调 verify_hook 跑 lint/test，
//   通过 → 立即停止（不再调用模型）；失败 → 错误输出注入同轮继续修；
//   连续失败达上限（缺省 3）→ verify_result(failed) 后停止（不再调用模型）。
export async function runLoop(opts: LoopOptions): Promise<void> {
  const { workspace, userMessage } = opts;
  const seen: AgentEvent[] = [];
  // Persist first: failed writes must not become model-visible history.
  const events: EventLog = {
    async append(event) {
      await opts.events.append(event);
      seen.push(event);
    },
  };
  const mode = opts.mode ?? "default";
  const interactive = opts.interactive ?? false;
  const maxSteps = opts.maxSteps ?? 50;
  const maxVerify = opts.verify?.maxAttempts ?? 3;
  let verifyAttempts = 0;

  // 新旧形态统一收敛成流式事件源（legacy next() 源遇 tool_call 断轮，日志同序）
  const provider = opts.provider;
  // C12（审查 P2）：取消信号随轮传入 provider——在途 fetch 随 abort 收束，不再只等静默窗。
  const streamFn: (messages: Parameters<Provider["stream"]>[0]) => AsyncIterable<ModelOutput> =
    "stream" in provider
      ? (messages) => provider.stream(messages, undefined, opts.signal ? { signal: opts.signal } : undefined)
      : streamFromNextSource(provider);

  if (userMessage !== undefined) {
    const event = { type: "user_message", content: userMessage } as const;
    await events.append(event);
  }

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) return; // M3a：取消信号于轮界收束（终态由编排器分类：cancelled）
    let sawToolCall = false;
    for await (const output of streamFn(projectContext(seen))) {
      await events.append(output);
      if (output.type !== "tool_call") continue; // assistant_message / delta / usage：继续

      sawToolCall = true;

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
        // verify 是系统门：钩子自身抛错（.agent/config.json 损坏、沙箱 exec 异常）应当记为
        // 「一次验证失败」，而不是把整轮任务炸掉。工具执行早有同族 try/catch，这里补齐同一口径；
        // 异常原因进 tool_result（fail-visible），不让模型只看到「无详细输出」。
        let outcome: VerifyOutcome;
        let hookError: string | null = null;
        try {
          outcome = await opts.verify.run();
        } catch (err) {
          hookError = err instanceof Error ? err.message : String(err);
          outcome = { ok: false, results: [] };
        }
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
          output: hookError !== null ? "[verify] 钩子异常（记为一次验证失败）：" + hookError : failureDigest(outcome),
        });
        continue;
      }

      // M2f 工具表摘除（sidechat 只读白名单）：不在表内的工具根本不进入执行面——
      // 与提示词无关的硬闸，工具调用被拒且给出明确原因（fail-closed）。
      if (opts.allowedTools && !opts.allowedTools.includes(output.name as ToolName)) {
        await events.append({
          type: "tool_result",
          callId: output.id,
          ok: false,
          output: `[tool table] ${output.name} 不在本会话工具表（只读白名单摘除）`,
        });
        continue;
      }

      // M2e：PreToolUse hook 先于权限门（CC 语义）；deny/exit2 阻断该次工具调用，
      // allow/ask 继续走原有权限管线（hook 无特权，§9.8 让步序）。
      if (opts.hooks) {
        try {
          const pre = await opts.hooks.run("PreToolUse", {
            event: "PreToolUse",
            tool_name: output.name,
            tool_args: output.args,
          });
          if (pre.blocked) {
            await events.append({
              type: "tool_result",
              callId: output.id,
              ok: false,
              output: "[hook blocked] " + (pre.blockReason ?? "PreToolUse hook 阻断"),
            });
            continue;
          }
        } catch (err) {
          // hook 引擎自身故障不得炸 loop（与 prune/地图同族的静默降级面）
          console.warn("[hooks] PreToolUse 引擎失败:", err instanceof Error ? err.message : String(err));
        }
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

      const tool = (opts.tools ?? TOOLS)[name];
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
          ...(opts.signal ? { signal: opts.signal } : {}), // C12：取消信号透传进长驻工具
          ...(opts.impact ? { impact: opts.impact } : {}), // M7：影响面钩子透传进写工具
        };
        try {
          result = await tool.run(output.args, ctx);
        } catch (err) {
          result = { ok: false, output: err instanceof Error ? err.message : String(err) };
        }
      }
      // M1c：gatedTool 自动放行时在结果上附带审计元数据（结构扩展），透传进 tool_result 事件
      const audit = (result as ToolResultWithAudit).auto;
      // M2e：PostToolUse（成功）/ PostToolUseFailure（失败）——additionalContext 回注 tool_result 尾部
      let postContext = "";
      if (opts.hooks) {
        try {
          const post = await opts.hooks.run(result.ok ? "PostToolUse" : "PostToolUseFailure", {
            event: result.ok ? "PostToolUse" : "PostToolUseFailure",
            tool_name: output.name,
            tool_args: output.args,
            tool_response: result.output,
          });
          if (post.additionalContext !== "") postContext = "\n[hook] " + post.additionalContext;
        } catch (err) {
          console.warn("[hooks] PostToolUse 引擎失败:", err instanceof Error ? err.message : String(err));
        }
      }
      await events.append({
        type: "tool_result",
        callId: output.id,
        ok: result.ok,
        output: result.output + postContext,
        ...(audit ? { auto: audit } : {}),
      });
    }
    if (!sawToolCall) return; // 模型认为任务结束（纯文本轮 / 事件源耗尽）
  }
  throw new Error(`agent loop 超过 maxSteps=${String(maxSteps)}，强制中止`);
}
