/** 门禁超时后的终止策略。一份实现，`lib/gate-runner.ts` 与判卷共用。
 *
 *  为什么要单独一支：`gates.ts` 顶层有 `await main()`，直接 import 会跑起全套门禁——判据得抽出来才测得到。
 *
 *  旧行为是超时直接整组 SIGKILL。换成阶梯（整组 SIGTERM → 宽限 → 整组 SIGKILL）买到的是
 *  「**JS 事件循环还活着那一刻**的收尾机会」：`mutate-verify` 的 `restoreInFlight()` 挂在
 *  SIGTERM/SIGINT/SIGHUP 上，MCP stdio 子进程的 close 链同理，组内其他成员也各自有一次按自己方式退场的机会。
 *  不收这条尾的代价实测过：整表里 mutate-verify 撞上 20 分钟预算，树里留下 `app.js.mutbak`，
 *  下一道 `mutate-needles-check` 只能报「针脚是从突变体算的，不可信」。
 *
 *  ⚠️ **别把它当突变体的保险**：`runTest` 走 `execFileSync`，同步阻塞事件循环，JS 处理器要等子进程结束
 *  才可能跑。本轮独立复跑（子进程阻塞 6s、TERM 在 1s 处发出）实测：发出后 2.5s 内处理器一次都没跑；
 *  而阻塞一结束进程直接走到退出，**TERM 被吞掉** ⇒ 那条路靠的是「下次开跑按证据自愈」（`lib/mutate-gates.ts` 的
 *  `leftoverActionOf`，那边写着同一实测），不是这里。
 *  本阶梯只兜「JS 活着时被杀」那一格，且不给"门悬着不出结论"的代价：不理会 TERM 的进程照旧立刻死
 *  （宽限一秒不占），只有真在收尾的才占用宽限，上限 TERM_GRACE_MS。
 *
 *  落定挂在 `exit` 而不是 `close`：`close` 要等所有 stdio 管道关闭，而被留下的孙进程正占着管道——
 *  挂在 close 上会让整套门禁在"门其实已经死了"之后继续悬挂。（旧实现超时立刻 finish 就是为了不踩这个坑，
 *  代价是连一步收尾机会都不给；这里换成"一有落定就返回"。）
 */

/** SIGTERM 之后给多久收尾；到点还没退才整组 SIGKILL。
 *  取值口径：够一支真在收尾的脚本（关 Electron 窗口、MCP close 链、写回自己的账本）走完，
 *  又不至于让"赖着不走的那道门"把整表多挂很久——不理会 SIGTERM 的进程走默认处置立刻死，这一格占不到。 */
export const TERM_GRACE_MS = 15_000;

/** 只声明用得到的那几样（测试要喂假对象，`gates.ts` 传真 ChildProcess）。 */
export interface TerminatableChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: () => void): unknown;
}

export interface TerminateResult {
  /** 是否走到了整组 SIGKILL（false = 子进程在宽限内自己退出了，还原机会用上了）。 */
  escalated: boolean;
  /** 最后一次真发出去的信号；undefined = 一个都没发出去（进程本就已退出）。 */
  lastSignal?: NodeJS.Signals;
  /** 给人看的一句话（拼进门禁输出，别拿"没跑完"当"都收拾干净了"）。 */
  note: string;
}

/** 终止一棵进程组：先 SIGTERM 给它自还原，宽限到点仍未退出才整组 SIGKILL。
 *  负 pid = 整组（`detached: true` 的子进程就是组长）——这一点沿用旧注释的理由：
 *  不整组杀，真正的 check 脚本（固定 CDP 端口、固定 tmpdir 快照名、共享 fixtures 靶子）
 *  会活下来与后续门并发互踩，造成连锁假红/假绿（审查 H-4/agents 分片）。 */
export function terminateGroup(
  child: TerminatableChild,
  opts: { graceMs?: number } = {},
): Promise<TerminateResult> {
  const graceMs = opts.graceMs ?? TERM_GRACE_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (escalated: boolean, lastSignal: NodeJS.Signals | undefined, note: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve({ escalated, lastSignal, note });
    };
    const signal = (sig: NodeJS.Signals): void => {
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, sig); // 整组
          return;
        } catch {
          /* 组已不存在：退回只打子进程 */
        }
      }
      try {
        child.kill(sig);
      } catch {
        /* 已退出 */
      }
    };
    // 已经退出（含 spawn 失败）：不发信号、不空等宽限
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(false, undefined, "超时：子进程已自行退出");
      return;
    }
    child.once("exit", () => finish(false, "SIGTERM", "超时：已发 SIGTERM，子进程自行退出（未强杀）"));
    signal("SIGTERM");
    timer = setTimeout(() => {
      signal("SIGKILL");
      finish(true, "SIGKILL", "超时：SIGTERM 宽限 " + String(Math.round(graceMs / 1000)) + "s 内未退出，已整组 SIGKILL（子进程未自还原）");
    }, graceMs);
  });
}
