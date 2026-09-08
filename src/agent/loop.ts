import type { EventLog } from "../events";
import { gate, type PermissionMode } from "../permissions";
import type { Provider } from "../providers";
import { TOOLS, type ToolName } from "../tools";

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
}

// agent loop：事件流 → 模型 → 工具 → 事件流。
// 每轮向 provider 要下一条输出：assistant_message 直接落事件流；
// tool_call 落事件流 → 过权限门 → 执行 → tool_result 落事件流，继续下一轮；
// provider 序列耗尽（next() 返回 null）即任务结束。
export async function runLoop(opts: LoopOptions): Promise<void> {
  const { provider, events, workspace, userMessage } = opts;
  const mode = opts.mode ?? "default";
  const interactive = opts.interactive ?? false;
  const maxSteps = opts.maxSteps ?? 50;

  if (userMessage !== undefined) {
    await events.append({ type: "user_message", content: userMessage });
  }

  for (let step = 0; step < maxSteps; step++) {
    const output = await provider.next();
    if (!output) return; // 模型认为任务结束

    await events.append(output);
    if (output.type !== "tool_call") continue; // assistant_message：继续下一轮

    // 权限门：先过门再动手
    const name = output.name as ToolName;
    const decision = gate(mode, name, interactive);
    if (decision !== "allow") {
      await events.append({
        type: "tool_result",
        callId: output.id,
        ok: false,
        output: `[permission denied] ${output.name} 在 ${mode} 档（${interactive ? "交互" : "非交互"}）下被门拒绝（${decision}）`,
      });
      continue;
    }

    const tool = TOOLS[name];
    let result;
    if (!tool) {
      result = { ok: false, output: `unknown tool: ${output.name}` };
    } else {
      try {
        result = await tool.run(output.args, { workspace });
      } catch (err) {
        result = { ok: false, output: err instanceof Error ? err.message : String(err) };
      }
    }
    await events.append({ type: "tool_result", callId: output.id, ok: result.ok, output: result.output });
  }
  throw new Error(`agent loop 超过 maxSteps=${maxSteps}，强制中止`);
}
