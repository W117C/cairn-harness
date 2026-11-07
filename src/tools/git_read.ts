// 只读 git 工具（2026-11-06 业主「完善工具层」第一批，对标 CC/Codex 的 git 面缺位）：
// status / diff / log 三个动词，零写权、零 shell——argv 逐个传给 git 子进程，
// 不经 shell 解释（无注入面），非写向 ⇒ 只读档与后续 worker 面都可直接放行。
// 为什么值得一枚专用工具：现在模型看仓库状态只能走 run_shell（白名单闸+审批摩擦），
// 而「现在改了什么」是工单/worktree/合并控制塔场景的高频地面化需求。
import { spawn } from "node:child_process";
import { resolveInWorkspace, ToolError, type Tool, type ToolResult } from "./base.js";
import { sanitizedEnv } from "./process.js";

/** 子进程墙钟：git 本地操作是毫秒级；大仓 diff 也只受输出帽约束，不靠超时兜底。 */
const GIT_READ_TIMEOUT_MS = 15_000;
/** 输出帽（字符）：diff 在大改工作区可以很长；超帽截断 + 出声，绝不静默。 */
const GIT_READ_MAX_CHARS = 20_000;

type GitReadOp = "status" | "diff" | "log";

/** op → 固定 argv（白名单拼装，不接受任何自由文本进 argv）。 */
function argvFor(op: GitReadOp, pathAbs?: string): string[] {
  switch (op) {
    case "status":
      // -b 带分支行：地面化「在哪个分支」也是高频需求，零额外成本。
      return ["status", "--porcelain=v1", "-b"];
    case "diff":
      return [
        "diff", "HEAD", "--no-textconv", "--no-color",
        // 静态上下文行数：diff 的文件头还是带完整路径；小上下文 = 同帽下能看更多文件。
        "--unified=2",
        ...(pathAbs !== undefined ? ["--", pathAbs] : []),
      ];
    case "log":
      return ["log", "--oneline", "-n", "20"];
  }
}

/** 跑一条固定 argv 的 git 子进程：限时击杀 + 输出字节帽 + env 消毒 + 不经 shell。 */
function runGit(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { cwd, env: sanitizedEnv() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let bytes = 0;
    const killWith = (msg: string): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(msg));
    };
    const timer = setTimeout(() => killWith(`git_read: 子进程超时（${String(GIT_READ_TIMEOUT_MS / 1000)}s，已终止）`), GIT_READ_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
      bytes += Buffer.byteLength(d);
      if (bytes > 8 * 1024 * 1024) killWith("git_read: 输出超过 8MB 上限，已终止");
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
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

export const git_read: Tool = {
  name: "git_read",
  async run(args, ctx): Promise<ToolResult> {
    const op = args.op;
    if (op !== "status" && op !== "diff" && op !== "log") {
      throw new ToolError("git_read: op 只允许 status / diff / log");
    }
    // diff 的 path 参数：workspace 相对 + 真实包含闸（软链越界与 glob/grep 同口径）。
    let pathAbs: string | undefined;
    if (typeof args.path === "string" && args.path.trim() !== "") {
      if (op !== "diff") throw new ToolError("git_read: path 参数只用于 diff");
      pathAbs = resolveInWorkspace(ctx.workspace, args.path, "git_read");
    }
    const proc = await runGit(["-C", ctx.workspace, ...argvFor(op as GitReadOp, pathAbs)], ctx.workspace);
    if (proc.code !== 0) {
      // 阴性要说清（错误分支里的两可行动出口），不许读成「工具坏了」：
      // ① 不是 git 仓库；② 空仓库 log（exit 128 + 「还没有任何 commit」）。
      if (/not a git repository/i.test(proc.stderr)) {
        return { ok: false, output: "git_read: 工作区不在 git 仓库内（先 git init 或打开一个 git 项目）" };
      }
      if (op === "log" && /does not have any commits yet/i.test(proc.stderr)) {
        return { ok: true, output: "（空仓库：还没有任何 commit）" };
      }
      return { ok: false, output: `git_read: git 退出码 ${String(proc.code)}${proc.stderr ? ": " + proc.stderr.slice(0, 300) : ""}` };
    }
    let out = proc.stdout;
    if (out.length > GIT_READ_MAX_CHARS) {
      out = out.slice(0, GIT_READ_MAX_CHARS)
        + `\n[git_read] 输出已截断（>${String(GIT_READ_MAX_CHARS)} 字符）。diff 太大时改用 op=status 看清单，或用 path 参数收窄到单个文件。`;
    }
    // status 只剩分支行 = 工作区干净：阴性补一句明示，不靠模型从 porcelain 空清单里猜。
    if (op === "status") {
      const changeLines = out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("## "));
      if (changeLines.length === 0) {
        return { ok: true, output: out.trimEnd() + "\n（工作区干净：无未提交改动）" };
      }
    }
    return { ok: true, output: out };
  },
};
