// 成员 run 的**串行闸**：同一时刻只允许一个成员在跑。
//
// 为什么需要它（不是保守，是正确性）：
//  · 密钥注入是**进程级**的（`applyMemberSecretEnv` 写 `process.env`）；
//  · 两个成员同时跑 ⇒ A 注入的键在 B 的窗口里也看得见 ⇒ 权限隔离破了。
// 串行化是最小的正确做法：一次一个，注入窗口不重叠。等锁的时间如实回给调用方（不静默拖慢）。
export interface RunLock {
  /** 排队执行；返回本次等了多久（毫秒）。 */
  run<T>(fn: () => Promise<T>, label?: string): Promise<{ result: T; waitedMs: number }>;
  /** 当前在跑的人（判据/面板可读）。 */
  current(): string | null;
  /** 排队人数。 */
  pending(): number;
}

export function createRunLock(now: () => number = () => Date.now()): RunLock {
  let tail: Promise<unknown> = Promise.resolve();
  let current: string | null = null;
  let waiting = 0;

  return {
    async run<T>(fn: () => Promise<T>, label?: string): Promise<{ result: T; waitedMs: number }> {
      const startedWaiting = now();
      waiting += 1;
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      try {
        await previous.catch(() => undefined);
        const waitedMs = now() - startedWaiting;
        current = label ?? null;
        const result = await fn();
        return { result, waitedMs };
      } finally {
        waiting -= 1;
        current = null;
        release();
      }
    },
    current: () => current,
    pending: () => waiting,
  };
}

/** 进程内唯一的那把锁（主进程装配用；判卷可自建）。 */
export const memberRunLock: RunLock = createRunLock();
