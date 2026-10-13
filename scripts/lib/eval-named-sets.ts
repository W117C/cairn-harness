/** 逐名判卷在**评测面**上的那一个消费者（第 415 页留下的半截：机制在、生产零流量）。
 *
 *  现读的两半都已经在了：
 *   · `src/agent/eval/test-results.ts` —— `parseTestResults`（零 IO，只吃字符串）＋ `judgeNamedSets`
 *     （SWE-bench 要的两件事：该转绿的没绿／该保住的坏了，分列）＋ `namedSetProblems`（形状谓词）。
 *   · `src/agent/eval/task-set.ts` —— SWE-bench 构造路径**产出** `TaskSpec.judge`（两列逐字）。
 *  缺的是中间那位读者：没有它，`judge` 仍然是一条没人读的字段，而评测面只会印退出码——
 *  「没修好」与「修坏了别的」继续在同一枚 1 上同形。本模块就是那位读者。
 *
 *  三条口径（写清楚理由，别当成自然形状）：
 *   ⑴ **判据一份都不抄**：格式识别、逐名对账、两列裁决、派生完整全部住在 `src/agent/eval/test-results.ts`。
 *      这里只做取料编排——把「一次 verify 拍可能有 N 条命令」摊成**一份**逐名证据面，交给那个裁决器。
 *      先例：`lib/eval-heldout.ts` 复用 `src/agent/verify.ts` 的归因函数，而不是自己再判一次 127。
 *   ⑵ **没接住任何测试名的命令不参与裁决**（lint／typecheck／一条噪音）。把它们的不完整折进来，
 *      任何多命令靶子都会**恒不可读**——那是假阴，等于给这一格装了尺却保证它永远说不出话。
 *      它们不是被丢掉：每一条都在 `sources` 里留脸（格式／读到几条／进没进裁决）。
 *   ⑶ 「这条任务没有逐名规格」与「有规格但读不出」是两件事：前者交 `undefined`（这一格无面，
 *      内建四格照旧、读数一列不动），后者交 `state:"unreadable"`（清单在、料没读全）。
 *      并成一条就分不清「不查逐名」与「查了没查着」——同 `HeldOutState` 无面／未跑分列那条纪律。
 *
 *  为什么住在 `scripts/lib` 而不是 `src/agent/eval`：这一支吃的是**跑器的取料形状**
 *  （`verify_result.results[]`），而 `src/` 那一侧刻意保持零 IO、零评测编排；判卷能直接 import 本模块
 *  喂合成输入（`scripts/loop-eval.ts` 顶层会跑起来，判卷 import 不进去——同 `lib/eval-expects` 的理由）。
 */
import {
  judgeNamedSets,
  parseTestResults,
  type NamedSets,
  type NamedSetVerdict,
  type ParsedResults,
  type ResultsFormat,
  type TestCounts,
} from "../../src/agent/eval/test-results";

/** 一次 verify 拍里的取料面（生产端 `verify_result.results[]` 结构化满足：多出来的 ok／cause 这一支不看）。 */
export interface NamedSetCommandResult {
  command: string;
  output: string;
}

/** 裁决吃了哪几条文——取料面本身也是读数（「这一格没料」与「这条命令没跑测试」要分得开）。 */
export interface NamedSetSource {
  command: string;
  /** 这一条自己的格式判定（由生产的解析器给出，不在这里认第二次）。 */
  format: ResultsFormat;
  /** 它的原文里逐名读到几条。0 = 它没接住任何测试名。 */
  tests: number;
  /** 它有没有进裁决（`tests > 0` 才算进，见文件头⑵）。 */
  carried: boolean;
  /** 这一条自己的派生完整性。 */
  complete: boolean;
  /** 原文开头一小段（只在一条测试名都没读到时才带）：「读不出」有三种完全不同的成因——
   *  命令不存在／输出只剩噪音／格式换了，而 `format:unknown, tests:0` 一个都分不出来。
   *  2026-10-12 CI 自评：本地全绿、CI 四连红，红的样子只有 `expected 'unreadable' to be 'pass'`
   *  ⇒ 看不出该修哪一边。带上原文开头，下一趟就能直接读出是哪一种。 */
  head?: string;
}

/** 进 `Reading` 的那一枚：生产的裁决结果 ＋ 本层的取料面。 */
export interface NamedSetReading extends NamedSetVerdict {
  sources: NamedSetSource[];
}

const emptyCounts = (): TestCounts => ({ passed: 0, failed: 0, skipped: 0, todo: 0 });

/** 把多条命令的逐名面并成**一份**证据：tests 串起来、四个桶按条相加、complete 取「每条都完整」。
 *  相加而不是重数：裁决器根本不看 counts（它看 tests／format／complete），这里给 counts 只是为了
 *  交出去的那份是合法的 `ParsedResults`，不是第二把尺。 */
function mergeEvidence(carrying: readonly { command: string; parsed: ParsedResults }[], totalCommands: number): ParsedResults {
  if (carrying.length === 0) {
    // 一条测试名都没读到：交一份「unknown 且没料」的解析面给裁决器，让**它**去点名所有规格 id——
    // 这里不自己造 unmatched 清单（那是裁决器的职责，抄一份就是第二把尺）。
    return {
      format: "unknown",
      tests: [],
      counts: emptyCounts(),
      complete: false,
      reasons: totalCommands === 0
        ? ["最后一次 verify 拍里一条命令结果也没有 ⇒ 逐名面没有原文可读"]
        : [`${String(totalCommands)} 条命令的原文里一条测试名也没读到 ⇒ 这一格没有逐名料（多半没跑测试命令，或输出只剩噪音）`],
    };
  }
  const counts = emptyCounts();
  for (const c of carrying) {
    counts.passed += c.parsed.counts.passed;
    counts.failed += c.parsed.counts.failed;
    counts.skipped += c.parsed.counts.skipped;
    counts.todo += c.parsed.counts.todo;
  }
  return {
    format: carrying[0]!.parsed.format,
    tests: carrying.flatMap((c) => c.parsed.tests),
    counts,
    complete: carrying.every((c) => c.parsed.complete),
    // 一条命令时原样透传它的成因；多条时逐条带上是哪条文——「哪条命令没读全」得能指出来。
    reasons: carrying.length === 1
      ? [...carrying[0]!.parsed.reasons]
      : carrying.flatMap((c) => c.parsed.reasons.map((r) => `[${c.command}] ${r}`)),
  };
}

/** 读一次逐名裁决。
 *  `spec` 缺省（这条任务没有 `judge`）⇒ 返回 `undefined`：**无面**，不是「读不出」也不是「过了」。
 *  `results` 是**最后一次** verify 拍的命令结果（与 `verifyOkLast` 同一拍；拿别的拍来比就是两枚读数在比两件事）。 */
export function readNamedSets(
  results: readonly NamedSetCommandResult[] | undefined,
  spec: NamedSets | undefined,
): NamedSetReading | undefined {
  if (spec === undefined) return undefined;
  const rows = results ?? [];
  const sources: NamedSetSource[] = [];
  const carrying: { command: string; parsed: ParsedResults }[] = [];
  for (const r of rows) {
    const parsed = parseTestResults(typeof r.output === "string" ? r.output : "");
    const carried = parsed.tests.length > 0;
    const raw = typeof r.output === "string" ? r.output : "";
    sources.push({
      command: r.command, format: parsed.format, tests: parsed.tests.length, carried, complete: parsed.complete,
      // 只在那一条什么都没读到时带原文开头：读到了就没有诊断价值，而带上一大段会把读数行撑爆。
      ...(carried ? {} : { head: raw.slice(0, 400) }),
    });
    if (carried) carrying.push({ command: r.command, parsed });
  }
  return { ...judgeNamedSets(mergeEvidence(carrying, rows.length), spec), sources };
}

/** 逐名那一格给 `grade` 的失败原因；`null` = 这一格不拦（无面或全绿）。
 *  措辞在这里、不在跑器里再拼一遍（同 `VERIFY_RECOVERY_WHY`／`heldOutFailReasons` 的分工）。
 *  `unreadable` 也拦：**没有尺不等于过了**——这一格的全部意义就是不把「读不出」糊成「绿」。
 *  列表只点前若干枚 id：一条 300 枚没转绿的清单会把读数行刷成屏，而总数已经在同一句里。 */
export function namedSetFailReason(r: NamedSetReading | undefined, idCap = 5): string | null {
  if (r === undefined) return null;
  if (r.state === "pass") return null;
  const clip = (ids: readonly string[]): string =>
    ids.slice(0, idCap).join("、") + (ids.length > idCap ? `…（共 ${String(ids.length)} 条）` : "");
  if (r.state === "fail") {
    const bits: string[] = [];
    if (r.notGreen.length > 0) bits.push(`该转绿的没绿：${clip(r.notGreen)}`);
    if (r.broken.length > 0) bits.push(`该保住的坏了：${clip(r.broken)}`);
    // 红是结论性的，但退出码给不出这两句——那正是这一格买来的分辨力。
    return "逐名判卷红〔同一枚退出码分不出这两件事〕：" + (bits.join("；") || "逐名读到红");
  }
  const why = r.reasons.length > 0 ? r.reasons.slice(0, 3).join("；") : "裁决器没给成因（第三态却无成因＝尺自己坏了）";
  return "逐名判卷不可读 ⇒ 不许算过：" + why + (r.unmatched.length > 0 ? `〔对不上号 ${String(r.unmatched.length)} 条〕` : "");
}
