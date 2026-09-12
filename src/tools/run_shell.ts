import { truncationNotice, type Tool, type ToolResult } from "./base.js";
import { sanitizedEnv, spawnTracked } from "./process.js";

// 输出上限 32KB；只在 ctx.workspace 下执行；超时 60s 强杀。
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
      let out = "";
      let truncated = false;
      let timedOut = false;
      let settled = false;
      const collect = (chunk: Buffer): void => {
        if (out.length >= SHELL_OUTPUT_LIMIT) {
          truncated = true;
          return;
        }
        out += chunk.toString("utf8");
        if (out.length > SHELL_OUTPUT_LIMIT) {
          out = out.slice(0, SHELL_OUTPUT_LIMIT);
          truncated = true;
        }
      };
      /** 收束（幂等）：超时路径与 'close' 路径都会走到这里，先到先算。
       *  超时必须主动收束——孙进程持有 stdout 时 'close' 永不触发（P1-2）。 */
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        let output = out;
        if (truncated) output += "\n" + truncationNotice(32);
        if (timedOut) output += "\n[error: run_shell 超时（60s），已强制终止]";
        if (code !== 0 && !timedOut) output += `\n[exit code: ${String(code)}]`;
        settle({ ok: code === 0 && !timedOut, output: output.replace(/\n+$/, "") });
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
