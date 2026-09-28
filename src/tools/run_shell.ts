import { type Tool, type ToolResult } from "./base.js";
import { annotateExecCause } from "../agent/verify.js";
import { killGroup, sanitizedEnv, spawnTracked } from "./process.js";
import { createOutputRing } from "./output-ring.js";

// 输出上限 32KB；只在 ctx.workspace 下执行；超时 60s 强杀。
// 超限后的「头 + 尾环」截断在 output-ring（与 verify 共用——两处都得留住尾部结论）。
const SHELL_OUTPUT_LIMIT = 32 * 1024;
const SHELL_TIMEOUT_MS = 60_000;

export const run_shell: Tool = {
  name: "run_shell",
  async run(args, ctx): Promise<ToolResult> {
    const command = args.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error("run_shell: command 参数必须是非空字符串");
    }
    return await new Promise<ToolResult>((settle) => {
      const ring = createOutputRing(SHELL_OUTPUT_LIMIT);
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const collect = (chunk: Buffer): void => ring.push(chunk);
      /** 收束（幂等）：超时路径与 'close' 路径都会走到这里，先到先算。
       *  超时必须主动收束——孙进程持有 stdout 时 'close' 永不触发（P1-2）。 */
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        let output = ring.read();
        if (timedOut) output += "\n[error: run_shell 超时（60s），已强制终止]";
        if (cancelled) output += "\n[error: run_shell 随会话取消终止]";
        if (code !== 0 && !timedOut && !cancelled) output += `\n[exit code: ${String(code)}]`;
        const res: ToolResult = { ok: code === 0 && !timedOut && !cancelled, output: output.replace(/\n+$/, "") };
        // 归因走 verify 那一只谓词（`classifyVerifyFailure`，同正则同枚举）：127 与「包管理器自身报错」
        // 这两类「命令根本没跑成」对模型必须点名，否则它会照着一条环境红去改本来正确的代码
        // （取消这一支不贴——它的原因已经写在 `[error: … 随会话取消终止]` 那行了）。
        settle(cancelled ? res : annotateExecCause(res, { timedOut, exitCode: code }));
      };
      // env 消毒：spawn 不传 env 会继承 process.env，而主进程把 BYOK key 写进了
      // process.env.M0_API_KEY —— 一条 `env` 就能把明文 key 读进事件流（P1-1）。
      const handle = spawnTracked("bash", ["-c", command], {
        cwd: ctx.workspace,
        env: sanitizedEnv(),
        timeoutMs: SHELL_TIMEOUT_MS,
        onTimeout: () => {
          timedOut = true;
          finish(null);
        },
      });
      // C12（审查 P2）：会话取消 → 立即组杀在途 shell（旧实现只能等 60s 超时才收束）。
      if (ctx.signal) {
        const onAbort = (): void => {
          if (settled) return;
          cancelled = true;
          killGroup(handle.child);
          finish(null);
        };
        if (ctx.signal.aborted) onAbort();
        else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
          // 审查 D-8：正常完成路径必须摘掉监听——ctx.signal 是整个 run 级别的，一个 run 里
          // 第 11 次 shell 调用起 Node 打 MaxListenersExceededWarning，且每次的 onAbort 闭包
          // （含 child 引用与 ≤32KB 输出缓冲）被 signal 拖到 run 结束才释放。
          // 与 B7 的 onRootAbort「注册必配对摘除」同口径。
          handle.child.once("close", () => ctx.signal?.removeEventListener("abort", onAbort));
        }
      }
      handle.child.stdout?.on("data", collect);
      handle.child.stderr?.on("data", collect);
      handle.child.on("error", (err) => {
        if (settled) return;
        settled = true;
        handle.dispose();
        settle({ ok: false, output: `run_shell: ${err.message}` });
      });
      handle.child.on("close", (code) => finish(code));
    });
  },
};
