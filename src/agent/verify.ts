// 验证门执行器：按目标仓库的 verify 配置跑 lint/test。
// 配置来源（规格 §5.4）：①目标仓库 .agent/config.json 的 verify 字段；②缺省探测 package.json 的
// scripts（lint/test 存在才收）。两者皆无 → fail-closed（ok:false，验证门不空转放行）。
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createOutputRing } from "../tools/output-ring";
import { killGroup, sanitizedEnv, spawnTracked } from "../tools/process";
import type { VerifyCause, VerifyCommandResult } from "../events";
import { verifyTrustDecision, type VerifyTrustDecision } from "./verify-trust";

/** 包管理器**自己那一行**的命名空间错误码（pnpm 打成 `[ERR_PNPM_XXX] msg`）。
 *  锚在行首：这串必须由 pnpm 自己打印才算环境判定——被被测脚本*引用*在正文里的同样文字不算。
 *  这条是 judgment-layer §9.1「零文案匹配」口径的唯一加宽，理由与边界见
 *  `outputs/verify-cause-denominator-2026-09-23.md`（语料里 3/3 环境红都是这一类，且它不是任意输出串）。
 *  导出给复跑面（`scripts/replay/verify-cause-mix.ts` 的 exec 文案栏）：同一行线索写两份正则＝一份改了另一份不跟着（第十三族）。 */
export const PKG_MANAGER_OWN_ERROR_LINE = /^[ \t]*[│┆└├]?[ \t]*\[?ERR_PNPM_[A-Z0-9_]+\]?/m;

/** 环境类失败必须在**正文里点名**（模型只看 output）：红字不说"这不是代码失败"，它就会去改本来正确的代码。
 *  两条 exec 出口（非沙箱 defaultExec / 沙箱 verifyExec）共用这一只，别各写一份文案。 */
const PKG_MANAGER_NOTE = "[verify: 包管理器自身报错（安装目录/依赖状态），测试脚本未被执行——这不是代码失败，别照它改代码]";
/** 「没有退出码」那一类的同一件事：正文里只留 `[exit code: null]` 时，模型读到的是"脚本返回了个怪码"，
 *  而真因是这条命令**压根没跑完**（取消／被信号杀）。两只出口共用这一句，别各写一份。 */
const NOT_RUN_NOTE = "[exec: 没有退出码 ⇒ 这条命令被取消或被信号杀掉，没有跑完 —— 这不是代码失败，别照它改代码]";

export function withVerifyCauseNote(output: string, cause: VerifyCause): string {
  const note = cause === "pkg-manager" ? PKG_MANAGER_NOTE : cause === "not-run" ? NOT_RUN_NOTE : "";
  if (note === "" || output.includes(note)) return output;
  return output + "\n" + note;
}

/** 一次失败命令的归因：**全部来自已有判定**（超时布尔 / 退出码 / pnpm 自有错误码行），缺省 `code`。
 *  `not-run` 排在 127 与 pnpm 之前、`timeout` 之后：超时那一路 `exitCode` 常常也是 null，
 *  但"跑不完"比"没跑完"更具体，先认它。 */
export function classifyVerifyFailure(f: { timedOut: boolean; exitCode: number | null; output: string }): VerifyCause {
  if (f.timedOut) return "timeout";
  if (f.exitCode === null) return "not-run";
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
): T & { exitCode: number | null; timedOut: boolean } {
  // 结构化信号在这里落进结果对象，**成功支也落**：`exitCode=0` 与"这个工具不跑进程"是两件事，
  // 只给 127 那条文案配一句说明、却把退出码丢在 settle 处，等于让下游读者回去匹配文案（本注释上面那段历史）。
  const stamped: T & { exitCode: number | null; timedOut: boolean } = { ...r, exitCode: f.exitCode, timedOut: f.timedOut };
  if (r.ok) return stamped;
  const cause = classifyVerifyFailure({ ...f, output: r.output });
  const note =
    cause === "toolchain-missing"
      ? "[exec: 退出码 127 = 这个命令不在 PATH 里 ⇒ 命令根本没跑成，这不是代码失败（先确认二进制名 / 是否安装）]"
      : cause === "pkg-manager"
        ? "[exec: 包管理器自身报错（安装目录/依赖状态），命令本体未被执行 ⇒ 这不是代码失败，别照它改代码]"
        : cause === "not-run"
          ? NOT_RUN_NOTE
          : "";
  if (note === "" || r.output.includes(note)) return stamped;
  return { ...stamped, output: r.output + "\n" + note };
}

export interface VerifyConfig {
  lint?: string[];
  test?: string[];
  /** 类型面（M5）：仓库根有 tsconfig 且装了本地 tsc 时探测出的一条命令。
   *  排最前跑：类型错会让 lint/test 的报错变成噪音，先报类型面省一轮。
   *  **刻意只探测 typecheck、不探测 lint** —— `action-fusion.ts` 每次 write_file 后都跑 `config.lint`
   *  并把红了的那次写判成 failed；凭空造 lint 面会把干净改动报成失败（本仓已裁决，见 probeLanguageTestCommands）。 */
  typecheck?: string[];
  /** 单条 verify 命令的墙钟上限（毫秒）；缺省见 DEFAULT_VERIFY_TIMEOUT_MS。 */
  timeoutMs?: number;
}

export interface VerifyOutcome {
  ok: boolean;
  results: VerifyCommandResult[];
  /** 非空＝这一轮**没有真的跑**任何命令，原因已说清（信任闸拒绝）。
   *  调用方必须把它与「跑了但红」分开处理：前者不是失败证据，不该烧模型的修复额度。
   *  这份处置住在**本文件下面那两只映射**里（`verifyOutcomeCause` ⇒ `cause:"skipped"`、
   *  `failureDigest` ⇒ 那句拒因原样回注），而不是在 loop 里再判一遍「什么算跳过」——
   *  同一谓词两份副本迟早漂，那是本仓第十三族点过名的形状。 */
  skipped?: string;
}

export type ExecFn = (command: string, cwd: string, timeoutMs?: number, signal?: AbortSignal) => Promise<VerifyCommandResult>;

const OUTPUT_LIMIT = 32 * 1024;
/** verify 缺省超时：npm 侧脚本 60s 够用（e2e / gym 都跑在这条上，不动它 = 零回归）。 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 60_000;
/** 语言探测档的缺省超时：冷编译的 `cargo test` / `go test ./...` 在 60s 内根本跑不完。
 *  上一轮刚把非 npm 仓库的验证面探测出来，若还按 60s 掐，等于把一条死路换了个方向——
 *  模型只会连续收到「超时」并烧光 verify 额度。 */
export const PROBED_LANG_TIMEOUT_MS = 300_000;
const MIN_VERIFY_TIMEOUT_MS = 1_000;
const MAX_VERIFY_TIMEOUT_MS = 900_000;
/** 从第几拍起，「重复」提示升级为「换策略」（第 2 拍只说重复，逐字不变——见 repeatDigestNote）。 */
export const ESCALATE_REPEAT_ATTEMPT = 3;

/** 缺省执行器：bash -c，语义与 run_shell 对齐（32KB 截断 / 60s 强杀 / 退出码）。
 *  env 走 sanitizedEnv、进程走 spawnTracked（进程组 + 超时强制收束）——verify 命令来自目标仓库的
 *  .agent/config.json，属外部输入；不消毒就等于把 BYOK key 交给它（P1-1/P1-2）。
 *  截断走同一只头尾环：这里比 run_shell 更需要尾部——`N failed`、失败用例名、stack 末行
 *  全在输出的最后几行，而这正是 failureDigest 回注给模型去修的全部依据。只留头部时
 *  模型拿到的是 "RUN v5.0.0" 加一串 ✓ 行，改无可改，只能把 3 次 verify 额度白烧完。 */
export const defaultExec: ExecFn = (command, cwd, timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS, signal?: AbortSignal) => {
  return new Promise<VerifyCommandResult>((settle) => {
    const ring = createOutputRing(OUTPUT_LIMIT);
    let timedOut = false;
    let settled = false;
    const collect = (chunk: Buffer): void => ring.push(chunk);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      handle.dispose();
      killGroup(handle.child);
      settle({ command, ok: false, output: "[verify] 取消信号生效，verify 命令已中止", cause: "not-run", exitCode: null });
    };
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
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
      signal?.removeEventListener("abort", onAbort);
      handle.dispose();
      // 连 shell 都没起来：这台机器上没有能跑这条命令的东西。归 `toolchain-missing`
      // （该值的口径因此从"退出码 127"加宽到"127 或根本起不来"，已按裁决记进 judgment-layer §9.1）。
      settle({ command, ok: false, output: "verify exec: " + err.message, cause: "toolchain-missing", exitCode: null });
    });
    handle.child.on("close", (code) => finish(code));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
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

/** 类型面探测（M5）：仓库根有 tsconfig.json **且**装了本地 tsc ⇒ 产出类型检查面。
 *
 *  两条判据缺一不可，少一条都更坏：
 *  · 只看 tsconfig 不看二进制 ⇒ 给一条必然红的命令（这正是 `verify-lang-timeout-same-as-npm`
 *    那条锚点说的「探出来却让它必然超时，比探不出来更坏」）。
 *  · 命令选 `./node_modules/.bin/tsc` 而不是 `npx --no-install tsc`，是**归因**决定的：
 *    实测（2026-10-01）本地二进制缺失时 bash 退出 **127** ⇒ `classifyVerifyFailure` 落进既有的
 *    `toolchain-missing`（环境类，**不扣模型修复额度**）；而 `npx --no-install tsc` 缺失时退出
 *    **1** 且输出不匹配 `PKG_MANAGER_OWN_ERROR_LINE` ⇒ 被判成 `code`，等于拿 harness 的环境问题
 *    扣模型的钱、改本来正确的代码。故用相对路径二进制（cwd=repoDir，相对路径照常解析）。 */
const TSC_BIN = "./node_modules/.bin/tsc";
export async function probeTypecheckCommands(repoDir: string): Promise<string[]> {
  let hasTsconfig = false;
  try {
    await access(join(repoDir, "tsconfig.json"), constants.F_OK);
    hasTsconfig = true;
  } catch {
    return [];
  }
  if (!hasTsconfig) return [];
  try {
    await access(join(repoDir, "node_modules", ".bin", "tsc"), constants.X_OK);
  } catch {
    return []; // 没装 tsc ⇒ 不产出这一面（不是产出一条必红的命令）
  }
  return [TSC_BIN + " --noEmit -p tsconfig.json"];
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
      // `typecheck` 进这张表（M5）：手配的 verify.typecheck 不能被静默丢弃——探测档已经产出这一面，
      // 配置档却不收，两档口径不一致就是「配了没生效」。顺序与执行顺序一致（typecheck → lint → test）。
      for (const key of ["typecheck", "lint", "test"] as const) {
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
  // 类型面（M5）走**独立的一行 return**，不碰上面那行——`scripts/mutate-verify.mjs` 有两条锚点
  // 逐字钉着它（`probe-invents-lint-commands` / `verify-lang-timeout-same-as-npm`）。
  // 与语言面互斥：语言面命中就整段返回，所以这条只在「没有 go/cargo/pytest/make 测试面」时才会走到。
  const tc = await probeTypecheckCommands(repoDir);
  if (tc.length > 0) return { config: { typecheck: tc, timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" };
  return { config: {}, source: "none" };
}

/** 一条 verify 序列 = 类型面 → lint 面 → 测试面（顺序即优先级：类型错会让 lint/test 的报错变成噪音）。 */
export function verifyCommands(config: VerifyConfig): string[] {
  return [...(config.typecheck ?? []), ...(config.lint ?? []), ...(config.test ?? [])];
}

/** 执行一轮 verify：逐条跑 lint/test 命令，全绿才 ok。 */
export async function runVerifyOutcome(repoDir: string, exec: ExecFn = defaultExec, signal?: AbortSignal): Promise<VerifyOutcome> {
  const { config, source } = await loadVerifyConfig(repoDir);
  const commands = verifyCommands(config);
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
    try {
      results.push(await exec(command, repoDir, timeoutMs, signal));
    } catch (err) {
      // 钩子/执行器抛错也要留一条结构化结果：否则前面已跑完的证据被吞，审计面只剩一句文案。
      results.push({
        command,
        ok: false,
        output: "verify exec: " + (err instanceof Error ? err.message : String(err)),
        cause: "hook-error",
        exitCode: null,
      });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

/** loop 的 verify 反射循环钩子：上限可配（缺省 3 次），耗尽即停。 */
export interface VerifyHook {
  maxAttempts?: number;
  /** 目标仓库有没有可验面（verify 命令非空）。false ⇒ harness 的自动验证拍整段跳过：
   *  没东西可验还回注「未找到 verify 配置」= 白烧一轮模型调用。缺省视为有面。 */
  surface?(): Promise<boolean>;
  run(signal?: AbortSignal): Promise<VerifyOutcome>;
}

/** 面向 gate-check / agent-runner 的标准钩子：目标仓库 + 可注入执行器（沙箱路径传沙箱 exec）。
 *
 *  **信任闸（审查 S3，2026-10-05）**：`opts.trustedRepo` 缺省 **false**，即"调用方没有断言这个
 *  仓库的 verify 命令可信"。缺省即拒绝是刻意的：这条执行路径上**一次权限判定都没有**，而命令
 *  100% 来自仓库自带文件（`.agent/config.json` / `package.json` scripts / Makefile 探测）。
 *  克隆即携带 ⇒ 模型改任意文件 ⇒ 收束闸自动补拍 ⇒ 任意命令执行，且绕开 shell 威胁表与网络审批。
 *
 *  两级的处置刻意不同：
 *   · `surface()` 返回 **false** ⇒ 自动补拍**整段跳过**。不假绿（没声称验过）、不假红（不是失败
 *     证据）、不烧模型修复额度。这条就是攻击路径本身，关掉它即止血。
 *   · `run()` 返回 `skipped` + 理由 ⇒ 手工 `/verify` 这条**用户主动发起**的路，如实告诉用户
 *     「命令来自仓库、未授权」，而不是伪装成一条 verify 失败。
 *
 *  自己拥有该仓库的调用方（gym / gate-check / 基准 / 判卷，跑的都是仓内 fixture）显式传
 *  `trustedRepo: true`——那是**调用方的断言**，不是默认。 */
export function createVerifyHook(repoDir: string, opts: { maxAttempts?: number; exec?: ExecFn; trustedRepo?: boolean } = {}): VerifyHook {
  const trusted = opts.trustedRepo ?? false;
  /** 把命令来源折成信任闸认得的 provenance：`loadVerifyConfig` 的两个来源都是仓库自带文件。 */
  const trustOf = async (): Promise<VerifyTrustDecision> => {
    const { config, source } = await loadVerifyConfig(repoDir);
    const commands = verifyCommands(config);
    return verifyTrustDecision({
      provenance: source === "config" ? "repo-config" : source === "probed" ? "repo-probed" : "host",
      commands,
      trusted,
    });
  };
  return {
    maxAttempts: opts.maxAttempts,
    surface: async () => {
      const { config } = await loadVerifyConfig(repoDir);
      // 类型面也算「有可验面」：只有 tsconfig 的仓库此前被判成没面 ⇒ harness 整段跳过 verify，
      // 而它其实能验（M5 交付物 1 的另一半：补上的面要真的被跑到，不能只躺在配置里）。
      if (verifyCommands(config).length === 0) return false;
      const d = await trustOf();
      if (!d.run) {
        console.warn(d.reason);
        return false; // fail-closed：宁可这一拍不验，也不执行未经授权的仓库命令
      }
      return true;
    },
    run: async (signal?: AbortSignal) => {
      const d = await trustOf();
      if (!d.run) return { ok: false, results: [], skipped: d.reason };
      return runVerifyOutcome(repoDir, opts.exec, signal);
    },
  };
}

/** 一拍 verify 的归因：**被拒**优先（那一拍什么都没跑），其次钩子抛错（那条路 results 为空），
 *  否则取首个失败命令的 cause。
 *  `ok` ⇒ undefined；cause 缺席 ⇒ 下游按 `"code"` 算（零行为，老会话流照旧）。
 *  `skipped` 那一格为什么必须在这里给出、不许留给调用方各判一遍：空 results 在旧形状下**取不到 cause**
 *  ⇒ `isEnvVerifyCause(undefined)=false` ⇒ 一条「压根没跑」被四处出口（修复额度 / 返修那一拍 / 升档与
 *  bandit 的证据位 / 沉淀）一致记成「跑过且红」。归因就是那条闭环唯一的分岔口。 */
export function verifyOutcomeCause(outcome: VerifyOutcome, hookError: string | null): VerifyCause | undefined {
  if (outcome.ok) return undefined;
  if (outcome.skipped !== undefined) return "skipped";
  if (hookError !== null) return "hook-error";
  return outcome.results.find((r) => !r.ok)?.cause;
}

/** 失败摘要：注入同轮给模型继续修的错误输出。
 *  被拒那一拍回注的是**那句拒因本身**（要模型做什么它自己说：走 run_shell 或让用户授权）——
 *  落到下面那句「无详细输出」就是往上下文塞一条**没有红字的红**，模型只会照着它改本来正确的代码。 */
export function failureDigest(outcome: VerifyOutcome): string {
  if (outcome.skipped !== undefined) return outcome.skipped;
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
  const base = "[verify] 第 " + String(attempt) + " 拍结果与上一拍**逐字相同**（失败命令不变：" + (cmds === "" ? "（无）" : cmds)
    + "）⇒ 这一拍的改动没落到被验的面上。上一拍的完整输出已在上下文里，不再重复注入。"
    + "下一步二选一：把范围收窄到具体文件/单条测试再跑（看清是哪一条在红），或直接 read 那个文件确认改动是否真的写进去了。";
  // 升级处置（M5 交付物 2）：第 2 拍只说「重复」（逐字不变，tests/verify.test.ts 逐字钉着它）；
  // 第 3 拍起同一句话已经是第二遍噪音——那时模型已经听过一次「换策略」，还在原地打转，
  // 说明**换策略本身**没被当真。这拍因此升级：明说「别再改同一处」，并把「这条红到底可不可修」
  // 摆上台面（真失败越修越有进展，配置/依赖/环境这类红改多少遍都不会绿）。
  if (attempt < ESCALATE_REPEAT_ATTEMPT) return base;
  return base + "\n[verify] 升级处置：这是**第 " + String(attempt) + " 拍**同一处红。别再改同一处了——"
    + "先判这条红可不可修：真失败（测试断言/类型错）才有修的意义；若是配置、依赖缺失或环境问题，"
    + "改多少遍代码都不会绿（那类红归因会写成 cause=toolchain-missing/pkg-manager/timeout，别照它改代码）。"
    + "确定要继续修的话，换一条**不同**的路：收窄到单个文件或单条用例先跑通，再决定要不要动大面。";
}
