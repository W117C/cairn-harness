/** vitest 摘要解析（e2e / ipc-check / gate-check 三门共用）。
 *  两份本地副本曾各自漂移过一次：调用者 TERM=xterm-256color 时 vitest 吐 ANSI 序列，
 *  `^\s*Tests\s+` 匹配不到 ⇒ 摘要"消失"。e2e/ipc-check 早年内建了 ANSI 剥离，gate-check 没有，
 *  于是同一份代码在 `TERM=dumb pnpm gates` 下绿、在裸 `node --import tsx scripts/gate-check.ts` 下红
 *  （2026-09-19 实测：靶子开工基线报「0 failed | 0 passed」——那是**读不到**而不是「零个失败」）。
 *  判据不该依赖调用者环境：剥离写在这里，三门都吃这一份。 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export interface VitestSummary {
  /** false = 输出里根本没有 `Tests …` 摘要行（命令没跑起来 / 被截断 / 别的 runner）。
   *  必须与「真的 0 failed | 0 passed」分开——否则「没跑成」会被读成「全绿」。 */
  found: boolean;
  failed: number;
  passed: number;
}

export function vitestSummary(output: string): VitestSummary {
  // 两种形态："Tests  1 failed | 2 passed (3)" / "Tests  3 passed (3)"；行首锚定避开 "Failed Tests 1" 横幅
  const summary = stripAnsi(output).match(/^\s*Tests\s+([^\n(]*)/m)?.[1];
  if (summary === undefined) return { found: false, failed: -1, passed: -1 };
  return {
    found: true,
    failed: Number(/(\d+)\s+failed/.exec(summary)?.[1] ?? 0),
    passed: Number(/(\d+)\s+passed/.exec(summary)?.[1] ?? 0),
  };
}
