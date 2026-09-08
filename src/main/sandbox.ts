// macOS Seatbelt 沙箱：写收敛到工作区 + 敏感目录拒读 + 默认断网（拍板：读先全开）。
// 坑一：SBPL 路径必须是 realpath（/tmp 实为 /private/tmp），否则规则静默失效；
//       路径不存在时按原样写入 profile（规则对不上 = 拒绝，fail-closed）。
// 坑二：必须 (allow process*) 与 (allow signal)，否则子进程 Abort / EPERM（vitest worker 要 signal）。
// 坑四：sandbox-exec 不清环境变量 —— env 消毒是本模块的活（白名单 + 秘密名剥除）。
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { truncationNotice, type ToolResult } from "../tools/base";

const OUTPUT_LIMIT = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

/** 敏感目录（相对 HOME）：读取一律拒绝。 */
const SENSITIVE = [".ssh", ".aws", ".config/gcloud", "Library/Keychains"];

/** env 白名单：只传这些；名字含 KEY/TOKEN/SECRET/PASSWORD 的一律剥除（双保险）。 */
const ENV_KEYS = ["PATH", "HOME", "TERM", "SHELL", "LANG", "TMPDIR"] as const;
const SECRET_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD)/i;

export interface SandboxStatus {
  available: boolean;
  reason?: string;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 生成 SBPL profile：写收敛到 writableRoot（realpath），敏感目录拒读，无任何 network 放行。 */
export function buildSandboxProfile(writableRoot: string): string {
  const root = real(writableRoot);
  const home = real(homedir());
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow file-read*)",
  ];
  for (const rel of SENSITIVE) {
    lines.push('(deny file-read* (subpath "' + join(home, rel) + '"))');
  }
  lines.push('(allow file-write* (subpath "' + root + '"))');
  lines.push('(allow file-write* (subpath "/dev/null"))');
  return lines.join("\n");
}

/** 沙箱子进程环境：白名单 + 秘密剥除 + TMPDIR 指向工作区内 .tmp（写收敛）。 */
export function sandboxEnv(tmpDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of Object.keys(env)) {
    if (SECRET_PATTERN.test(k)) delete env[k];
  }
  env.TMPDIR = tmpDir;
  return env;
}

export interface SandboxRunOptions {
  cwd: string;
  /** 默认 = cwd（工具语义：沙箱根与工具工作区一致）。 */
  writableRoot?: string;
  timeoutMs?: number;
}

/** 在 sandbox-exec 内执行 bash -c；结果形态与 src/tools/run_shell 对齐（截断/超时/退出码）。 */
export async function runInSandbox(command: string, opts: SandboxRunOptions): Promise<ToolResult> {
  const profile = buildSandboxProfile(opts.writableRoot ?? opts.cwd);
  const tmp = join(real(opts.cwd), ".tmp");
  await mkdir(tmp, { recursive: true });
  return await new Promise<ToolResult>((settle) => {
    const child = spawn("sandbox-exec", ["-p", profile, "bash", "-c", command], {
      cwd: opts.cwd,
      env: sandboxEnv(tmp),
    });
    let out = "";
    let truncated = false;
    let timedOut = false;
    const collect = (chunk: Buffer): void => {
      if (out.length >= OUTPUT_LIMIT) {
        truncated = true;
        return;
      }
      out += chunk.toString("utf8");
      if (out.length > OUTPUT_LIMIT) {
        out = out.slice(0, OUTPUT_LIMIT);
        truncated = true;
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.on("error", (err) => {
      clearTimeout(timer);
      settle({ ok: false, output: "sandbox-exec: " + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let output = out;
      if (truncated) output += "\n" + truncationNotice(32);
      if (timedOut) output += "\n[error: 沙箱命令超时（" + String(Math.round(timeout / 1000)) + "s），已强制终止]";
      if (code !== 0 && !timedOut) output += "\n[exit code: " + String(code) + "]";
      settle({ ok: code === 0 && !timedOut, output: output.replace(/\n+$/, "") });
    });
  });
}

/** 可用性自检：sandbox-exec 存在且 profile 能编译执行（跑一条 no-op）。不可用 → 应用降级。 */
export async function checkSandbox(): Promise<SandboxStatus> {
  try {
    const res = await runInSandbox("true", { cwd: tmpdir(), timeoutMs: 10_000 });
    if (!res.ok) return { available: false, reason: "自检失败: " + res.output.slice(0, 160) };
    return { available: true };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
