// 门禁汇总里的「结论行」：一道门跑完，把它自己下的那句结论带出来。
//
// 为什么需要：`pnpm gates` 过去只对**红门**打印输出尾几行，绿门只回一个退出码 ⇒ 整表跑完
// 看不出"这道门到底跑了多少东西"，要数就得单独复跑那道门（一次 3 分钟到 11 分钟）。
// 绿而一个字都没吐的门另有判据（assertion-health 的 `silentGreenGate`，按未证计）。
import { stripAnsi } from "./vitest-summary.js";

/** 结论行最长多少字符——它是给人扫一眼的，不许长成第二份日志。 */
export const VERDICT_MAX_CHARS = 160;

/** 本仓各门收尾用的结论记号（check 系写 `X ✅ / Y ❌ / Z 未证`，vitest 写 `Tests … passed`）。 */
const VERDICT_MARK = /✅|❌|passed|failed|全部通过|零命中|未证/;

const clip = (s: string): string => (s.length <= VERDICT_MAX_CHARS ? s : s.slice(0, VERDICT_MAX_CHARS - 1) + "…");

/**
 * 从一道门的输出里挑出「它自己下的结论」那一行。
 *
 * 从后往前找而不是直接取最后一行：vitest 的收尾是 `Start at` / `Duration`，**计数在那之前**；
 * 而 check 系的收尾才是 verdict。找不到结论标记就退回最后一行非空输出——"说不清结论"也要看得见，
 * 不许返回空串让人以为这道门没跑（空串只留给真的一个字没吐的情况，那一格另有判据）。
 */
export function verdictLine(output: string): string {
  const lines = stripAnsi(output).split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (VERDICT_MARK.test(l)) return clip(l);
  }
  return clip(lines[lines.length - 1]!);
}
