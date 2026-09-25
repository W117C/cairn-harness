/** 整张变异表的 ❌ 归因（纯函数，供 `tests/mutation-rerun-triage.test.ts` 消费；不在这里出声、不碰盘、不起进程）。
 *
 * 为什么单独一层：整表一轮 1919s / 963 条，末尾只印一句「N 条变异存活或误伤」。
 * 那 N 条混着三种代价差一个量级的事——① 判卷文件基线就不绿（规则 181：一条已提交的红灯会把它名下
 * 所有锚点打成 ❌）；② 针脚已不在源文件里 ⇒ 突变未生效（形似存活，实为空操作）；③ **真存活**（不变量没观测者）。
 * 分诊要靠**单条复跑**（十几秒一条），而"读哪一行算哪种"是判据，判据得有自己的判卷面（规则 118）。
 */

export type TriageVerdict = "已杀死" | "存活" | "红了未点名" | "未生效" | "基线红" | "读不出";

/** 抽 id：整表日志的行形状是 `❌ <id> — <描述>`。按行首锚定（描述里也可能出现 `❌`）。
 *  去重是必须的：同一条锚点在日志里可能出现两次（首次判定 + 末尾汇总回显），不去重就会复跑两遍。 */
export function failedIds(logText: string): string[] {
  const out: string[] = [];
  for (const line of logText.split("\n")) {
    const m = /^❌\s+(\S+)\s+—/.exec(line.replace(/\r$/, ""));
    if (m !== null) out.push(m[1]!);
  }
  return [...new Set(out)];
}

/** 日志里 ❌ 行的原始条数（与 `failedIds().length` 并排读，就是"抽取有没有吃掉条目"的自检）。 */
export function failedLineCount(logText: string): number {
  return (logText.match(/^❌\s+\S+\s+—/gm) ?? []).length;
}

/** **第二把尺**：只看行首是不是 `❌`，不认分隔符也不认 id 形状。
 *  必须与上面那把分开：两把尺共用一个正则时，"日志形状变了"会让两个数一起变成 0，
 *  于是"抽不出红行"被读成"没有红行"——实测我自己第一版就是这么 exit 0 的（规则 180 的又一形状）。
 *  两者不等 ⇒ 抽取器对不上当场日志，红着退出，不许继续报归类。 */
export function looseFailedLineCount(logText: string): number {
  let n = 0;
  for (const line of logText.split("\n")) if (line.replace(/\r$/, "").startsWith("❌")) n++;
  return n;
}

/** 输出里有没有"真的有用例红了"的痕迹（vitest 的 `Failed Tests N` 段与 ` FAIL ` 行）。
 *  为什么必须分这一刀（第 84 页实测）：runner 末尾那句「N 条变异存活或误伤」把两件修法相反的事
 *  混在一起——**全绿**＝这条不变量真没观测者（要补测试）；**红了但没红在 expectFail 点名的那条**＝
 *  观测者在，只是锚点的期望标题过期了（要改 expectFail，即任务 #50）。
 *  实测样本：`prune-attachment-production-entry` 复跑时红在 `tests/session-prune-attachments.test.ts:69`
 *  的新标题用例上 ⇒ 它是「红了未点名」，不是「存活」。把前者记成后者会凭空造出一条"缺尺"结论。 */
function sawRedTest(stdout: string): boolean {
  return /Failed Tests\s+\d+/.test(stdout) || /^ *FAIL +\S+/m.test(stdout);
}

/** 单条复跑的读数归类。**只认这几类汇总行**，其余一律「读不出」——
 *  非零退出而输出里没有可认的汇总行时，把 0 结论读成"已杀死"就是假绿（规则 128）。 */
export function classify(stdout: string, status: number | null, spawnError?: string): { verdict: TriageVerdict; note: string } {
  if (spawnError !== undefined || status === null) {
    return { verdict: "读不出", note: `spawn 失败：${spawnError ?? "无退出码"} ⇒ 本条没有读数` };
  }
  if (/基线就不是全绿/.test(stdout)) return { verdict: "基线红", note: "判卷文件自己有已提交的红灯 ⇒ 本条判定被污染，不算存活的证据" };
  if (/突变未生效|变异未生效/.test(stdout)) return { verdict: "未生效", note: "针脚不在这份源文件里 ⇒ 空操作（先去修针脚，见任务 #50）" };
  if (/全部变异被正确杀死/.test(stdout)) return { verdict: "已杀死", note: "" };
  if (/条变异存活/.test(stdout)) {
    return sawRedTest(stdout)
      ? { verdict: "红了未点名", note: "测试红了而 runner 没在 expectFail 点名的那条上找到 ⇒ 观测者在，锚点期望过期（改 expectFail，别补测试）" }
      : { verdict: "存活", note: "改坏了而测试仍全绿 ⇒ 这条不变量没有观测者" };
  }
  return { verdict: "读不出", note: `exit=${String(status)} 而输出里没有可认的汇总行（非零退出＋零结论＝读数不可信）` };
}

/** 要人处理的三类（修法各不同：存活＝补观测者；红了未点名＝改 expectFail；读不出＝先修尺）。 */
export const ACTIONABLE: readonly TriageVerdict[] = ["存活", "红了未点名", "读不出"];

/** 归类后的表：把"必须逐条处理"的挑出来。 */
export function needsAction(rows: readonly { id: string; verdict: TriageVerdict }[]): string[] {
  return rows.filter((r) => ACTIONABLE.includes(r.verdict)).map((r) => r.id);
}
