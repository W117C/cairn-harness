import { spawn } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { resolveInWorkspace, truncationNotice, type Tool, type ToolResult } from "./base.js";
import { sanitizedEnv } from "./process.js";
import { rgBinary } from "./ripgrep.js";

const MAX_FILES = 100;
const NOISE_DIRS = ["**/.git/**", "**/node_modules/**", "**/dist/**"];

export const glob: Tool = {
  name: "glob",
  async run(args, ctx): Promise<ToolResult> {
    const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern : "**/*";
    const rel = typeof args.path === "string" && args.path.trim() ? args.path : ".";
    const abs = rel === "." ? ctx.workspace : resolveInWorkspace(ctx.workspace, rel, "glob");
    // rg --files 天然尊重 .gitignore；噪音目录显式排除。注意 rg 多个 --glob 按「后写优先」裁决，
    // 排除规则必须排在用户 pattern 之后，否则会被 pattern 覆盖（实测坑）。
    const rgArgs = ["--files", "--hidden", "--glob", pattern, ...NOISE_DIRS.flatMap((g) => ["--glob", "!" + g]), abs];
    const files: string[] = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(rgBinary(), rgArgs, { cwd: ctx.workspace, env: sanitizedEnv() }); // D1：env 消毒
      let stdout = "";
      let stderr = "";
      // C10（审查 P2）：与 runRgJson 同口径——输出上限 + 超时击杀（大仓库不 OOM 不长挂）。
      let settled = false;
      let bytes = 0;
      const killWith = (msg: string): void => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        rejectPromise(new Error(msg));
      };
      const timer = setTimeout(() => killWith("glob: rg 超时（60s，已终止——查询面过大）"), 60_000);
      timer.unref?.();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        stdout += d;
        bytes += Buffer.byteLength(d);
        if (bytes > 32 * 1024 * 1024) killWith("glob: rg 输出超过 32MB 上限，已终止（请收窄 path/pattern）");
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => { stderr += d; });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectPromise(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && code !== 1) {
          rejectPromise(new Error(`glob: rg 退出码 ${code}${stderr ? ": " + stderr.slice(0, 200) : ""}`));
          return;
        }
        const files = stdout.split("\n").filter(Boolean).map((p) => {
          const r = relative(resolve(ctx.workspace), resolve(p));
          return r.split(sep).join("/");
        });
        files.sort();
        resolvePromise(files);
      });
    });
    if (files.length === 0) return { ok: true, output: "无匹配文件" };
    const limited = files.length > MAX_FILES;
    const shown = limited ? files.slice(0, MAX_FILES) : files;
    let out = shown.join("\n");
    if (limited) out += `\n${truncationNotice(MAX_FILES)} more files available, use more specific path/pattern`;
    return { ok: true, output: out };
  },
};
