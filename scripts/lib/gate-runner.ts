/** 跑一道门的命令：起进程、收输出、到点把终止交给 `lib/gate-kill`。一份实现，`gates.ts` 与判卷共用。
 *
 *  抽出来的理由与 `./assertion-health` 同族：`gates.ts` 顶层有 `await main()`，直接 import 会跑起
 *  全套门禁——而「超时支路到底叫没叫那个阶梯」正是必须有人观测的那一格（判据在 lib 里、调用方
 *  没人叫 = 本仓记过多次的「两头断」）。这里连命令组装都不管（那是 `gate-manifest.gateCommand`），
 *  只管「给一条命令，拿到一次带超时的结果」。
 */
import { spawn } from "node:child_process";
import { terminateGroup } from "./gate-kill";

/** H11（审查 P3）：单门超时——旧实现 spawn 无超时，任一门挂起即无限阻塞整套门禁。
 *  20 分钟 = 当时最慢门（test）的 10 倍以上余量；超时判红（exit 124）。 */
export const GATE_TIMEOUT_MS = 20 * 60_000;

/** **按门覆盖**的单门预算。为什么要有这一层（2026-10-02 业主裁决）：
 *  缺省 20 分钟是按"当时最慢门 test 的 10 倍"定的，而 `mutate-verify` **实测要 28.7 分钟**
 *  （1223 条锚点逐条起判卷；2026-10-02 在 40 分钟档下真跑完：exit=0、`ms=1722521`）⇒
 *  缺省档下它**必然以 exit=124 收场**，读起来像"这道门红了"，实际是"预算不够"。
 *  此前两次也确实都被 20 分钟档杀掉（M6 的凭证里如实照贴为"超时，非内容红"）。
 *
 *  40 分钟 ＝ 实测 28.7 分钟的 **1.4 倍**余量。**这是预算不是判据**：一条断言都没放松，
 *  超时仍然判红，只是给这道已知最慢的门足够的时间跑完。
 *  加新条目必须贴实测耗时——"我猜它慢"不算理由（缺省那个 20 分钟也带着它的实测出处）。 */
export const GATE_TIMEOUT_OVERRIDES: Readonly<Record<string, number>> = {
  "mutate-verify": 40 * 60_000,
};

/** 这道门该拿多少预算：覆盖表优先，缺省回 `GATE_TIMEOUT_MS`。 */
export function gateTimeoutOf(name: string): number {
  return GATE_TIMEOUT_OVERRIDES[name] ?? GATE_TIMEOUT_MS;
}

export interface GateResult {
  name: string;
  code: number;
  ms: number;
  output: string;
}

export interface CommandSpec {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** 超时预算（缺省 GATE_TIMEOUT_MS）。 */
  timeoutMs?: number;
  /** SIGTERM 之后等多久升级 SIGKILL（缺省 gate-kill 的 TERM_GRACE_MS）。 */
  graceMs?: number;
}

export function runCommand(name: string, spec: CommandSpec): Promise<GateResult> {
  const timeoutMs = spec.timeoutMs ?? GATE_TIMEOUT_MS;
  return new Promise((settle) => {
    const t0 = Date.now();
    let done = false;
    // 预算一旦用掉，结论就锁死：超时后子进程可以带着自己的退出码结束，但**不能**把 124 翻成绿
    // （一支把 SIGTERM 当"干完了"来处理、退出码 0 的门会被 `close` 抢先落定而假绿——这个口子是
    //  引入宽限的同时带来的，旧实现超时当场就 finish，所以没有；实测见 tests/gate-kill.test.ts）。
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (code: number, output: string): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      settle({ name, code, ms: Date.now() - t0, output });
    };
    // detached：让子进程及其孙进程同属一个新进程组——终止只能整组做，否则信号打在包装器上，
    // 真正的 check 脚本（固定 CDP 端口、固定 tmpdir 快照名、共享 fixtures 靶子）活下来与后续门
    // 并发互踩，造成连锁假红/假绿（审查 H-4/agents 分片）。
    const child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.on("error", (err) => finish(127, String(err)));
    child.on("close", (code) => {
      if (timedOut) return; // 超时结论由阶梯落，不被退出码覆盖
      finish(code ?? 1, out);
    });
    timer = setTimeout(() => {
      timedOut = true;
      void terminateGroup(child, { graceMs: spec.graceMs }).then((r) => {
        finish(124, out + "\n[gates] 超时（" + String(Math.round(timeoutMs / 1000)) + "s），" + r.note + " ⇒ 判红");
      });
    }, timeoutMs);
    timer.unref?.();
  });
}
