// 验证门执行器：按目标仓库的 verify 配置跑 lint/test。
// 配置来源（规格 §5.4）：①目标仓库 .agent/config.json 的 verify 字段；②缺省探测 package.json 的
// scripts（lint/test 存在才收）。两者皆无 → fail-closed（ok:false，验证门不空转放行）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOutputRing } from "../tools/output-ring";
import { sanitizedEnv, spawnTracked } from "../tools/process";
import type { VerifyCause, VerifyCommandResult } from "../events";

/** 包管理器**自己那一行**的命名空间错误码（pnpm 打成 `[ERR_PNPM_XXX] msg`）。
 *  锚在行首：这串必须由 pnpm 自己打印才算环境判定——被被测脚本*引用*在正文里的同样文字不算。
 *  这条是 judgment-layer §9.1「零文案匹配」口径的唯一加宽，理由与边界见
 *  `outputs/verify-cause-denominator-2026-09-23.md`（语料里 3/3 环境红都是这一类，且它不是任意输出串）。 */
const PKG_MANAGER_OWN_ERROR_LINE = /^[ \t]*[│┆└├]?[ \t]*\[?ERR_PNPM_[A-Z0-9_]+\]?/m;

/** 环境类失败必须在**正文里点名**（模型只看 output）：红字不说"这不是代码失败"，它就会去改本来正确的代码。
 *  两条 exec 出口（非沙箱 defaultExec / 沙箱 verifyExec）共用这一只，别各写一份文案。 */
export function withVerifyCauseNote(output: string, cause: VerifyCause): string {
  const note = "[verify: 包管理器自身报错（安装目录/依赖状态），测试脚本未被执行——这不是代码失败，别照它改代码]";
  if (cause !== "pkg-manager" || output.includes(note)) return output;
  return output + "\n" + note;
}

/** 一次失败命令的归因：**全部来自已有判定**（超时布尔 / 退出码 / pnpm 自有错误码行），缺省 `code`。 */
export function classifyVerifyFailure(f: { timedOut: boolean; exitCode: number | null; output: string }): VerifyCause {
  if (f.timedOut) return "timeout";
  if (f.exitCode === 127) return "toolchain-missing";
  if (PKG_MANAGER_OWN_ERROR_LINE.test(f.output)) return "pkg-manager";
  return "code";
}

/** shell 家族的失败归因（`run_shell` ＋ worker 的 `shell_ro`/`shell_rw` ＋ 两条沙箱出口）。
 *
 *  为什么单列一支文案而不动 verify 那句：verify 能说「测试脚本未被执行」，一条任意 shell 命令不能这么说
 *  （它可能就是 `pnpm install`）。**判据不重写**——吃的还是上面那一只 `classifyVerifyFailure`
 *  （同一正则、同一枚举）；「同一判据四份副本、宽度各不同」是本仓第十三族点过名的形状。
 *  超时不另贴：两条出口自己那行 `[error: … 超时 …]` 说的就是同一件事，再贴一遍是白付字节。
 *  幂等（与 `withVerifyCauseNote` 同口径）：worker 的缺省出口本来就是 `run_shell`，
 *  同一条结果会先后过两层 ⇒ 不幂等就会把同一句贴两遍。
 *  可达性实测（2026-09-28 本机）：`sandbox-exec -p … bash -c 不存在的命令` 退出码仍是 **127**、
 *  pnpm 的错误码行也原样进输出 ⇒ 两类在两条出口上都真能发生（不是替不存在的情形写代码）。 */
export function annotateExecCause<T extends { ok: boolean; output: string }>(
  r: T,
  f: { timedOut: boolean; exitCode: number | null },
): T {
  if (r.ok) return r;
  const cause = classifyVerifyFailure({ ...f, output: r.output });
  const note =
    cause === "toolchain-missing"
      ? "[exec: 退出码 127 = 这个命令不在 PATH 里 ⇒ 命令根本没跑成，这不是代码失败（先确认二进制名 / 是否安装）]"
      : cause === "pkg-manager"
        ? "[exec: 包管理器自身报错（安装目录/依赖状态），命令本体未被执行 ⇒ 这不是代码失败，别照它改代码]"
        : "";
  if (note === "" || r.output.includes(note)) return r;
  return { ...r, output: r.output + "\n" + note };
}

export interface VerifyConfig {
  lint?: string[];
  test?: string[];
  /** 单条 verify 命令的墙钟上限（毫秒）；缺省见 DEFAULT_VERIFY_TIMEOUT_MS。 */
  timeoutMs?: number;
}

export interface VerifyOutcome {
  ok: boolean;
  results: VerifyCommandResult[];
}

export type ExecFn = (command: string, cwd: string, timeoutMs?: number) => Promise<VerifyCommandResult>;

const OUTPUT_LIMIT = 32 * 1024;
/** verify 缺省超时：npm 侧脚本 60s 够用（e2e / gym 都跑在这条上，不动它 = 零回归）。 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;
/** 语言探测档的缺省超时：冷编译的 `cargo test` / `go test ./...` 在 60s 内根本跑不完。
 *  上一轮刚把非 npm 仓库的验证面探测出来，若还按 60s 掐，等于把一条死路换了个方向——
 *  模型只会连续收到「超时」并烧光 verify 额度。 */
export const PROBED_LANG_TIMEOUT_MS = 300_000;
const MIN_VERIFY_TIMEOUT_MS = 1_000;
const MAX_VERIFY_TIMEOUT_MS = 900_000;

/** 缺省执行器：bash -c，语义与 run_shell 对齐（32KB 截断 / 60s 强杀 / 退出码）。
 *  env 走 sanitizedEnv、进程走 spawnTracked（进程组 + 超时强制收束）——verify 命令来自目标仓库的
 *  .agent/config.json，属外部输入；不消毒就等于把 BYOK key 交给它（P1-1/P1-2）。
 *  截断走同一只头尾环：这里比 run_shell 更需要尾部——`N failed`、失败用例名、stack 末行
 *  全在输出的最后几行，而这正是 failureDigest 回注给模型去修的全部依据。只留头部时
 *  模型拿到的是 "RUN v5.0.0" 加一串 ✓ 行，改无可改，只能把 3 次 verify 额度白烧完。 */
export const defaultExec: ExecFn = (command, cwd, timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS) => {
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
      if (timedOut) output += "\n[error: verify 命令超时（" + String(Math.round(timeoutMs / 1000)) + "s），已强制终止——命令确实跑完过吗？范围太大就先跑单条测试]";
      if (code !== 0 && !timedOut) {
        output += `\n[exit code: ${String(code)}]`;
        // 127 = bash 找不到这条命令：探到的工具链在这台机器上没装。这一拍说明不了代码对错，
        // 不点名就会让模型照着它改本来正确的代码，还把 3 次 verify 额度烧光。
        if (code === 127) output += "\n[verify: 退出码 127 = 命令不存在（工具链缺失）——这不是代码失败，别照它改代码；换可用的 runner 或先装工具链]";
      }
      const ok = code === 0 && !timedOut;
      const cause = classifyVerifyFailure({ timedOut, exitCode: code, output });
      if (!ok) output = withVerifyCauseNote(output, cause);
      // 绿结果不带 cause：这字段是"这次红算谁的"，给成功结果挂一个 code 会让人误读成结局字段。
      settle({ command, ok, output: output.replace(/\n+$/, ""), ...(ok ? {} : { cause }), exitCode: code });
    };
    // pipefail：管道里任一环节失败都要把非零码带出来。今天 `pnpm test | tail -50` 会把测试失败
    // 吞成 exit 0 ⇒ 判卷面给出 ok:true。预检已在本宿主跑过（bash 3.2.57 支持 -o pipefail）。
    const handle = spawnTracked("bash", ["-o", "pipefail", "-c", command], {
      cwd,
      env: sanitizedEnv(),
      timeoutMs,
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
      // 连 shell 都没起来：这台机器上没有能跑这条命令的东西。归 `toolchain-missing`
      // （该值的口径因此从"退出码 127"加宽到"127 或根本起不来"，已按裁决记进 judgment-layer §9.1）。
      settle({ command, ok: false, output: "verify exec: " + err.message, cause: "toolchain-missing", exitCode: null });
    });
    handle.child.on("close", (code) => finish(code));
  });
};

/** 非 npm 仓库的测试面探测（能力 2「多语言多工具链」× 能力 5「能证明代码真的能跑」）。
 *  旧行为：只看 `.agent/config.json` 与 `package.json`，于是 Python/Go/Rust/Make 仓库一律
 *  落到 `source:"none"` ⇒ 验证门 fail-closed 空转——「执行-验证-修正」这条闭环在非 JS 靶子上整段是死的。
 *  只补 **test**，绝不凭空造 lint：action-fusion 读的是 `config.lint`，
 *  把「风格未整理」造出来会把干净改动报成失败。
 *  命令是这里写死的固定串（不是仓库脚本文本），因此不执行仓库给的任意代码。 */
export async function probeLanguageTestCommands(repoDir: string): Promise<string[]> {
  const readIf = async (name: string): Promise<string | null> => {
    try {
      return await readFile(join(repoDir, name), "utf8");
    } catch {
      return null;
    }
  };
  const [g, cargo, pyproject, setupCfg, toxIni, pytestIni, conftest, makefile] = await Promise.all([
    readIf("go.mod"), readIf("Cargo.toml"), readIf("pyproject.toml"), readIf("setup.cfg"),
    readIf("tox.ini"), readIf("pytest.ini"), readIf("conftest.py"), readIf("Makefile"),
  ]);
  if (g !== null) return ["go test ./..."];
  if (cargo !== null) return ["cargo test"];
  const pytestDeclared = pytestIni !== null
    || conftest !== null
    || (pyproject !== null && /\[tool\.pytest\.ini_options\]/.test(pyproject))
    || (setupCfg !== null && /^\[pytest\]/m.test(setupCfg))
    || (toxIni !== null && /^\[pytest\]/m.test(toxIni));
  if (pytestDeclared) return ["python3 -m pytest -q"];
  // Makefile：只认 `test:` 目标（行首、可带依赖），别的 target 不猜。
  if (makefile !== null && /^test[ \t]*:/m.test(makefile)) return ["make test"];
  return [];
}

/** 读 verify 配置：① .agent/config.json 优先；② package.json scripts；③ 非 npm 工具链探测。 */
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
      const t = (v as Record<string, unknown>).timeoutMs;
      if (t !== undefined) {
        if (typeof t !== "number" || !Number.isInteger(t) || t < MIN_VERIFY_TIMEOUT_MS || t > MAX_VERIFY_TIMEOUT_MS) {
          throw new Error("verify.timeoutMs 必须是 " + String(MIN_VERIFY_TIMEOUT_MS / 1000) + "–"
            + String(MAX_VERIFY_TIMEOUT_MS / 1000) + " 秒之间的整数毫秒");
        }
        config.timeoutMs = t;
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
    if (Object.keys(config).length > 0) return { config, source: "probed" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // package.json 存在但坏 → fail loud（与 config.json 同口径）
  }
  // ③ 没有 package.json、或有 package.json 却没 lint/test 脚本 ⇒ 探非 npm 工具链。
  //    旧实现在这里直接返回 "none"，非 JS 仓库因此永远没有验证面。
  const lang = await probeLanguageTestCommands(repoDir);
  // 探测档自带超时：这条命令不是用户写的，超时预期由我们这一侧负责说清楚。
  if (lang.length > 0) return { config: { test: lang, timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" };
  return { config: {}, source: "none" };
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
          cause: "no-surface",
          exitCode: null,
          output:
            source === "config"
              ? "verify 配置为空（.agent/config.json 的 verify 字段没有任何命令）"
              : "未找到 verify 配置（.agent/config.json 无 verify 字段，package.json 无 lint/test scripts，也未探到 go/cargo/pytest/make 测试面）",
        },
      ],
    };
  }
  const results: VerifyCommandResult[] = [];
  const timeoutMs = config.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  for (const command of commands) {
    results.push(await exec(command, repoDir, timeoutMs));
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

/** 一拍 verify 的归因：钩子抛错优先（那条路 results 为空），否则取首个失败命令的 cause。
 *  `ok` ⇒ undefined；cause 缺席 ⇒ 下游按 `"code"` 算（零行为，老会话流照旧）。 */
export function verifyOutcomeCause(outcome: VerifyOutcome, hookError: string | null): VerifyCause | undefined {
  if (outcome.ok) return undefined;
  if (hookError !== null) return "hook-error";
  return outcome.results.find((r) => !r.ok)?.cause;
}

/** 失败摘要：注入同轮给模型继续修的错误输出。 */
export function failureDigest(outcome: VerifyOutcome): string {
  const failed = outcome.results.filter((r) => !r.ok);
  if (failed.length === 0) return "verify 失败（无详细输出）";
  return failed.map((r) => `[verify FAIL] ${r.command}\n${r.output}`).join("\n\n");
}

/** 连续两拍摘要逐字相同时，替掉重复注入的那一段。
 *  「逐字相同」是有确定含义的信号：这一拍**没有新信息**（上一拍的全文已在上下文里），
 *  且说明模型这一轮的改动完全没落到被验的面上。此时重发整段日志（可达 32KB）
 *  既贵又零增益，而它缺的那句「你白改了」恰恰才是可执行信息。 */
export function repeatDigestNote(outcome: VerifyOutcome, attempt: number): string {
  const cmds = outcome.results.filter((r) => !r.ok).map((r) => r.command).join(", ");
  return "[verify] 第 " + String(attempt) + " 拍结果与上一拍**逐字相同**（失败命令不变：" + (cmds === "" ? "（无）" : cmds)
    + "）⇒ 这一拍的改动没落到被验的面上。上一拍的完整输出已在上下文里，不再重复注入。"
    + "下一步二选一：把范围收窄到具体文件/单条测试再跑（看清是哪一条在红），或直接 read 那个文件确认改动是否真的写进去了。";
}
