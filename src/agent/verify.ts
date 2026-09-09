// 验证门执行器：按目标仓库的 verify 配置跑 lint/test。
// 配置来源（规格 §5.4）：①目标仓库 .agent/config.json 的 verify 字段；②缺省探测 package.json 的
// scripts（lint/test 存在才收）。两者皆无 → fail-closed（ok:false，验证门不空转放行）。
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { truncationNotice } from "../tools/base";
import type { VerifyCommandResult } from "../events";

export interface VerifyConfig {
  lint?: string[];
  test?: string[];
}

export interface VerifyOutcome {
  ok: boolean;
  results: VerifyCommandResult[];
}

export type ExecFn = (command: string, cwd: string) => Promise<VerifyCommandResult>;

const OUTPUT_LIMIT = 32 * 1024;
const TIMEOUT_MS = 60_000;

/** 缺省执行器：bash -c，语义与 run_shell 对齐（32KB 截断 / 60s 强杀 / 退出码）。 */
export const defaultExec: ExecFn = (command, cwd) => {
  return new Promise<VerifyCommandResult>((settle) => {
    const child = spawn("bash", ["-c", command], { cwd });
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
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      settle({ command, ok: false, output: "verify exec: " + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let output = out;
      if (truncated) output += "\n" + truncationNotice(32);
      if (timedOut) output += "\n[error: verify 命令超时（60s），已强制终止]";
      if (code !== 0 && !timedOut) output += `\n[exit code: ${String(code)}]`;
      settle({ command, ok: code === 0 && !timedOut, output: output.replace(/\n+$/, "") });
    });
  });
};

/** 读 verify 配置：.agent/config.json 优先，缺省探测 package.json scripts。 */
export async function loadVerifyConfig(
  repoDir: string,
): Promise<{ config: VerifyConfig; source: "config" | "probed" | "none" }> {
  // ① .agent/config.json 的 verify 字段
  try {
    const raw = await readFile(join(repoDir, ".agent", "config.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed.verify;
    if (typeof v === "object" && v !== null) {
      const config: VerifyConfig = {};
      const vo = v as Record<string, unknown>;
      for (const key of ["lint", "test"] as const) {
        const arr = vo[key];
        if (arr !== undefined) {
          if (!Array.isArray(arr) || arr.some((c) => typeof c !== "string")) {
            throw new Error(`verify.${key} 必须是字符串数组`);
          }
          config[key] = arr as string[];
        }
      }
      return { config, source: "config" };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // 配置存在但坏 → fail loud
  }
  // ② 缺省探测 package.json scripts
  try {
    const raw = await readFile(join(repoDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const config: VerifyConfig = {};
    for (const key of ["lint", "test"] as const) {
      if (typeof pkg.scripts?.[key] === "string") {
        config[key] = [`pnpm run ${key}`];
      }
    }
    return { config, source: Object.keys(config).length > 0 ? "probed" : "none" };
  } catch {
    return { config: {}, source: "none" };
  }
}

/** 执行一轮 verify：逐条跑 lint/test 命令，全绿才 ok。 */
export async function runVerifyOutcome(repoDir: string, exec: ExecFn = defaultExec): Promise<VerifyOutcome> {
  const { config, source } = await loadVerifyConfig(repoDir);
  const commands = [...(config.lint ?? []), ...(config.test ?? [])];
  if (commands.length === 0) {
    return {
      ok: false,
      results: [
        {
          command: "(none)",
          ok: false,
          output:
            source === "config"
              ? "verify 配置为空（.agent/config.json 的 verify 字段没有任何命令）"
              : "未找到 verify 配置（.agent/config.json 无 verify 字段，package.json 无 lint/test scripts）",
        },
      ],
    };
  }
  const results: VerifyCommandResult[] = [];
  for (const command of commands) {
    results.push(await exec(command, repoDir));
  }
  return { ok: results.every((r) => r.ok), results };
}

/** loop 的 verify 反射循环钩子：上限可配（缺省 3 次），耗尽即停。 */
export interface VerifyHook {
  maxAttempts?: number;
  run(): Promise<VerifyOutcome>;
}

/** 面向 gate-check / agent-runner 的标准钩子：目标仓库 + 可注入执行器（沙箱路径传沙箱 exec）。 */
export function createVerifyHook(repoDir: string, opts: { maxAttempts?: number; exec?: ExecFn } = {}): VerifyHook {
  return {
    maxAttempts: opts.maxAttempts,
    run: () => runVerifyOutcome(repoDir, opts.exec),
  };
}

/** 失败摘要：注入同轮给模型继续修的错误输出。 */
export function failureDigest(outcome: VerifyOutcome): string {
  const failed = outcome.results.filter((r) => !r.ok);
  if (failed.length === 0) return "verify 失败（无详细输出）";
  return failed.map((r) => `[verify FAIL] ${r.command}\n${r.output}`).join("\n\n");
}
