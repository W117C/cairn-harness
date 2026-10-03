/** 判据名 → 解释它的那一支（第 327 页，任务 #35）。
 *
 *  为什么要单独一个纯模块：`scripts/loop-eval.ts` 是**顶层会跑起来**的脚本，判卷 import 不进去，
 *  于是「登记的名」与「解释的分支」从前没有任何一处能对齐——名字拼错就安静地不判（数据层对字段名
 *  早就是 fail-closed 的，只管了一半）。收在这里之后：
 *   - 键集＝`src/agent/eval/task-set` 的 `EXPECT_NAMES`（由判卷逐枚核两支相等）；
 *   - `Record<ExpectName, …>` 让 TS 也钉住"每个登记名都必须有分支"（少一支就编译不过）；
 *   - 每一支只吃一个面（`ExpectFace`），不读盘、不起进程 ⇒ 判卷能直接喂合成输入。
 *  失败原因的文字写在这一支里（跑器不另拼一遍），措辞与"下一步看哪一格"同源。
 */
import { HELD_OUT_EXPECT, type ExpectName } from "../../src/agent/eval/task-set";
import { heldOutFailReasons, type HeldOutRun, type HeldOutSpec } from "./eval-heldout";
import { VERIFY_RECOVERY_WHY, type VerifyRecovery } from "./eval-validity";

/** 判据要看的那几枚读数（跑器的 `Reading` 结构化满足它；这里刻意不 import 跑器）。 */
export interface ExpectFace {
  clarified: number;
  plannedBeforeWrite: boolean;
  readsBeforeFirstWrite: number;
  verifyOkLast: boolean | null;
  verifyRecovery: VerifyRecovery;
  touchedJudge: boolean;
  wroteTests: boolean;
  onlySrcChanged: boolean;
  expects: readonly string[];
  heldOutSpec?: HeldOutSpec;
  heldOutRun?: HeldOutRun;
  heldOutInstallErrs?: readonly string[];
}

export type ExpectHandler = (r: ExpectFace) => string | null;

/** 每枚判据的判定分支。返回失败原因；`null` ＝这一格过了。 */
export const EXPECT_HANDLERS: Record<ExpectName, ExpectHandler> = {
  clarify: (r) => (r.clarified < 1 ? "没 clarify（歧义靠猜）" : null),
  planBeforeWrite: (r) => (!r.plannedBeforeWrite ? "写盘前没有 propose_plan" : null),
  readBeforeWrite: (r) => (r.readsBeforeFirstWrite < 1 ? "写盘前一次都没读" : null),
  verifyOk: (r) => (r.verifyOkLast !== true ? "verify 未通过/未跑" : null),
  // 这一枚要的不是"最后绿"，而是红过一次、**模型自己**再验且绿：一次就绿与"闸替它补一拍"都不算。
  verifyRecovered: (r) => (r.verifyRecovery !== "modelRecovery"
    ? "没有模型自己完成的红→绿返修：" + VERIFY_RECOVERY_WHY[r.verifyRecovery] : null),
  judgeUntouched: (r) => (r.touchedJudge ? "改了判卷面" : null),
  testNotRewritten: (r) => (r.wroteTests ? "改了 tests/（复现型任务只该新增，不该动判卷）" : null),
  onlySrcChanged: (r) => (!r.onlySrcChanged ? "改动越出 src/" : null),
  wroteTest: (r) => (!r.wroteTests ? "没补测试" : null),
  /* held-out 那一格整个交给 `lib/eval-heldout`（无面／装不上／未跑／跑不起／真红各有措辞）：
   * 在这里再比一次 `ok` 就是"同一条判据抄两份、宽度不同"那一族。它**不是**空分支——
   * 传的就是这一枚名字，所以那份函数只会为它出声。 */
  [HELD_OUT_EXPECT]: (r) => heldOutFailReasons(
    [HELD_OUT_EXPECT], r.heldOutSpec, r.heldOutRun, r.heldOutInstallErrs ?? [],
  ).join("；") || null,
};

/** 跑器用的入口：把这枚名字的解释交出去，**没登记**时出声（数据层已拒收，走到这里＝有人绕过了 `parseTaskSet`）。 */
export function expectFailReason(name: string, r: ExpectFace): string | null {
  const h: ExpectHandler | undefined = (EXPECT_HANDLERS as Record<string, ExpectHandler | undefined>)[name];
  if (!h) return `判据名「${name}」既不在登记表、也没有判定分支 ⇒ 这一格根本没判（绕过了任务集解析）`;
  return h(r);
}
