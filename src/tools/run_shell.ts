import { spawn } from "node:child_process";
import { truncationNotice, type Tool, type ToolResult } from "./base.js";

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
      const child = spawn("bash", ["-c", command], { cwd: ctx.workspace });
      let out = "";
      let truncated = false;
      let timedOut = false;
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
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, SHELL_TIMEOUT_MS);
      child.on("error", (err) => {
        clearTimeout(timer);
        settle({ ok: false, output: `run_shell: ${err.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        let output = out;
        if (truncated) output += "\n" + truncationNotice(32);
        if (timedOut) output += "\n[error: run_shell 超时（60s），已强制终止]";
        if (code !== 0 && !timedOut) output += `\n[exit code: ${code}]`;
        settle({ ok: code === 0 && !timedOut, output: output.replace(/\n+$/, "") });
      });
    });
  },
};
