// 验证门执行器：按目标仓库的 verify 配置跑 lint/test。
// 配置来源（规格 §5.4）：①目标仓库 .agent/config.json 的 verify 字段；②缺省探测 package.json 的
// scripts（lint/test 存在才收）。两者皆无 → fail-closed（ok:false，验证门不空转放行）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOutputRing } from "../tools/output-ring";
import { sanitizedEnv, spawnTracked } from "../tools/process";
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

/** 缺省执行器：bash -c，语义与 run_shell 对齐（32KB 截断 / 60s 强杀 / 退出码）。
 *  env 走 sanitizedEnv、进程走 spawnTracked（进程组 + 超时强制收束）——verify 命令来自目标仓库的
 *  .agent/config.json，属外部输入；不消毒就等于把 BYOK key 交给它（P1-1/P1-2）。
 *  截断走同一只头尾环：这里比 run_shell 更需要尾部——`N failed`、失败用例名、stack 末行
 *  全在输出的最后几行，而这正是 failureDigest 回注给模型去修的全部依据。只留头部时
 *  模型拿到的是 "RUN v5.0.0" 加一串 ✓ 行，改无可改，只能把 3 次 verify 额度白烧完。 */
export const defaultExec: ExecFn = (command, cwd) => {
  return new Promise<VerifyCommandResult>((settle) => {
    const ring = createOutputRing(OUTPUT_LIMIT);
    let timedOut = false;
    let settled = false;
    const collect = (chunk: Buffer): void => ring.push(chunk);
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      handle.dispose();
      let output = ring.read();
      if (timedOut) output += "\n[error: verify 命令超时（60s），已强制终止]";
      if (code !== 0 && !timedOut) output += `\n[exit code: ${String(code)}]`;
      settle({ command, ok: code === 0 && !timedOut, output: output.replace(/\n+$/, "") });
    };
    const handle = spawnTracked("bash", ["-c", command], {
      cwd,
      env: sanitizedEnv(),
      timeoutMs: TIMEOUT_MS,
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
      settle({ command, ok: false, output: "verify exec: " + err.message });
    });
    handle.child.on("close", (code) => finish(code));
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
  /** 目标仓库有没有可验面（verify 命令非空）。false ⇒ harness 的自动验证拍整段跳过：
   *  没东西可验还回注「未找到 verify 配置」= 白烧一轮模型调用。缺省视为有面。 */
  surface?(): Promise<boolean>;
  run(): Promise<VerifyOutcome>;
}

/** 面向 gate-check / agent-runner 的标准钩子：目标仓库 + 可注入执行器（沙箱路径传沙箱 exec）。 */
export function createVerifyHook(repoDir: string, opts: { maxAttempts?: number; exec?: ExecFn } = {}): VerifyHook {
  return {
    maxAttempts: opts.maxAttempts,
    surface: async () => {
      const { config } = await loadVerifyConfig(repoDir);
      return [...(config.lint ?? []), ...(config.test ?? [])].length > 0;
    },
    run: () => runVerifyOutcome(repoDir, opts.exec),
  };
}

/** 失败摘要：注入同轮给模型继续修的错误输出。 */
export function failureDigest(outcome: VerifyOutcome): string {
  const failed = outcome.results.filter((r) => !r.ok);
  if (failed.length === 0) return "verify 失败（无详细输出）";
  return failed.map((r) => `[verify FAIL] ${r.command}\n${r.output}`).join("\n\n");
}
