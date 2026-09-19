/** 引导向导「在产品里可达吗」的判据本体（commercial-check D 段用）。
 *
 *  为什么需要它（2026-09-19 实测）：React 树归档时 `src/renderer/onboarding.tsx` 被删，
 *  纯数据部分抽成 `src/main/onboarding-groups.ts`；vanilla 渲染层从未把它接回去。
 *  而 D 段的两条断言名叫「首启必弹向导」「完成后不再弹」，实际只验了
 *  `DEFAULT_SETTINGS.onboarded === false` —— **数据在、门是绿的，产品里却没有这个行为**。
 *  这正是本仓最忌的假绿：能力已发货但用户点不到 = 零价值。
 *
 *  判据：定义文件与它的存取层（settings）**之外**，必须有人在 shipped 源码里读这两个符号。
 *  没有 ⇒ 只能记「未证」，并说清缺的是哪一段（补向导 UI，或按裁决把数据一起归档）。 */

export interface SourceFile {
  path: string;
  text: string;
}

export interface Reachability {
  reachable: boolean;
  /** 找到的消费者路径（可判性证据，红/未证时要能指到人）。 */
  consumers: string[];
}

/** 允许「自己定义自己」的文件：数据源与设置存取层不算消费者。 */
export const WIZARD_DEFINERS = ["src/main/onboarding-groups.ts", "src/main/settings.ts"];

/** 向导可达 = 有定义层之外的消费者引用 ONBOARDING_GROUPS 或 onboarded。 */
export function wizardReachability(files: readonly SourceFile[]): Reachability {
  const consumers = files
    .filter((f) => !WIZARD_DEFINERS.some((p) => f.path.includes(p)))
    .filter((f) => /\bONBOARDING_GROUPS\b/.test(f.text) || /\.onboarded\b/.test(f.text) || /["']onboarded["']\s*[,:)]/.test(f.text))
    .map((f) => f.path);
  return { reachable: consumers.length > 0, consumers };
}

/** 未证条目的固定句式（人和 gates 都要能读出「缺哪一段」）。 */
export function wizardUnverifiedNote(consumers: readonly string[]): string {
  return "D2b/D2c 首启必弹向导与完成后不再弹：产品侧无消费者（只找到定义层，shipped 源码里读 "
    + "ONBOARDING_GROUPS / onboarded 的文件数 = " + String(consumers.length)
    + "）——只验到 settings 缺省值，验不到「弹」与「不再弹」；补向导 UI 或按裁决连同数据一起归档";
}
