/** 进程探活：`kill(pid, 0)` 只问存在，不发信号。
 *
 *  这条判据此前在 7 处各写一遍（第 966 页）。其中 `session-mutation-lock.ts` 把 EPERM
 *  当成「已退出」——EPERM 的真实含义是「进程在、只是不归我管」，据此回收锁会抢走活人的
 *  临界区。其余几处虽然今天都认 EPERM，但「探活」与「确认已死」仍被压成同一个布尔：
 *  参数形状不对或其它 errno 到底算哪边，每份副本各答各的。
 *
 *  这里用三态而不是布尔：只有 ESRCH 能证明进程已退出；EPERM 算活着；其余情况都是
 *  「不知道」——锁只能据此多等，不能据此回收。
 */
export type ProcessLiveness = "alive" | "dead" | "unknown";

export function processLiveness(
  pid: unknown,
  kill: (pid: number, signal: 0) => void = process.kill,
): ProcessLiveness {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return "unknown";
  try {
    kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "alive";
    return "unknown";
  }
}
