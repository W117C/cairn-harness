// 逐名判卷规格（`TaskSpec.judge`）的**盘上取料器**：把靶子的种子态跑成一盘逐名结果，
// 直接产出 FAIL_TO_PASS / PASS_TO_PASS 两列——而不是让人在 JSON 里手抄一遍。
//
// 为什么必须有这一支（2026-10-22 登记的那笔债）：`fixtures/bench/tasks*.json` 五份清单
// **12/12 条一条 `judge` 都没有**（`--feasibility` 实测：`逐名格：0 / 12`）。逐名判卷那条链
// （`src/agent/eval/test-results` 的解析与裁决 ＋ `scripts/lib/eval-named-sets` 的读者）**早就通电**，
// 却没有一条任务喂给它 ⇒「该转绿的没绿」与「该保住的坏了」在这批基准上**仍旧同形于同一枚退出码**。
//
// 三条设计决定（写清楚理由，别当成自然形状）：
//   ⑴ **规格由盘上跑出来，不由人写**：手抄两列 = 第二份会漂的账（靶子加一条测试、改一个标题，
//      JSON 里那份不会跟着动）。本脚本每次现读靶子、现跑判卷命令、现分列。
//   ⑵ **两列的语义只由种子态决定**：FAIL_TO_PASS = 种子里**红**的那些（任务要它们转绿），
//      PASS_TO_PASS = 种子里**绿**的那些（任务不许把它们弄坏）。反过来写（把绿的列进该转绿）
//      会让这一格**恒真**——它本来就绿。
//   ⑶ **一条逐名都没读到 ⇒ 拒不出规格**：那是「没有尺」，不是「全绿」。交给它自己判会出
//      `unreadable`，而 `unreadable` 与「没有规格」在产品读数上是两回事（前者是尺没接住料，
//      后者是这一格无面）⇒ 这里 fail-closed，让调用方自己决定。
//
// 零 IO 在 `src/agent/eval/test-results`（只吃字符串），本支只负责 spawn 与分列。
import { execFileSync } from "node:child_process";
import { parseTestResults, type ParsedResults } from "../../src/agent/eval/test-results";

/** 一条任务的取料面：判卷命令 + 靶子目录（命令在靶子目录里跑）。 */
export interface JudgeSeedTask {
  id: string;
  /** 靶子目录（相对仓根或绝对路径）。 */
  dir: string;
  /** 判卷命令（在 `dir` 里跑；shell 形态，与 `TaskSpec.verifier.command` 同一句）。 */
  command: string;
}

export interface JudgeSpec {
  failToPass: string[];
  passToPass: string[];
}

export type JudgeSeedOutcome =
  | { ok: true; spec: JudgeSpec; parsed: ParsedResults }
  /** 拒出规格的理由（逐条点名，不吞）。 */
  | { ok: false; reasons: string[] };

/** 在靶子目录里跑判卷命令，把 stdout+stderr 交托给生产的解析器（不在这里认第二次格式）。 */
export function runSeed(task: JudgeSeedTask, cwd: string): { parsed: ParsedResults; exitCode: number | null; error?: string } {
  let out = "";
  let exitCode: number | null = null;
  try {
    out = execFileSync("/bin/sh", ["-c", task.command], {
      cwd: task.dir.startsWith("/") ? task.dir : `${cwd}/${task.dir}`,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // 判卷命令是 `node --test …`／`node tests/run.mjs`——红时退出码非 0，那不是失败。
    }) as unknown as string;
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; status?: unknown; message?: string };
    out = `${typeof e.stdout === "string" ? e.stdout : ""}${typeof e.stderr === "string" ? e.stderr : ""}`;
    exitCode = typeof e.status === "number" ? e.status : null;
    if (out.trim() === "") return { parsed: emptyParsed([`判卷命令没产出任何输出：${e.message ?? String(err)}`]), exitCode, error: e.message };
  }
  return { parsed: parseTestResults(out), exitCode };
}

const emptyParsed = (reasons: string[]): ParsedResults => ({
  format: "unknown", tests: [], counts: { passed: 0, failed: 0, skipped: 0, todo: 0 }, complete: false, reasons,
});

/** 种子态 → 两列规格。**规格的内容只由盘上那次跑决定**，调用方不许往里添删名字。 */
export function judgeSpecFromSeed(task: JudgeSeedTask, cwd: string): JudgeSeedOutcome {
  const { parsed } = runSeed(task, cwd);
  const reasons: string[] = [];
  if (parsed.format === "unknown") {
    reasons.push(...parsed.reasons, `靶子 ${task.id} 的判卷输出认不出格式 ⇒ 这一格没有尺，不出规格`);
  }
  if (parsed.tests.length === 0) {
    reasons.push(`靶子 ${task.id} 一条逐名都没读到 ⇒ 没有尺（不是全绿），不出规格`);
  }
  // 派生不完整（计划线对不上／结尾计数对不上／有省略标记）也拒：拿半份料分列，
  // 等于把「读不到的那些」按缺席算成该保住——那正是这一格最怕的假绿形状。
  if (!parsed.complete) reasons.push(...parsed.reasons.map((r) => `靶子 ${task.id} 逐名面不完整：${r}`));
  if (reasons.length > 0) return { ok: false, reasons };

  const failToPass = parsed.tests.filter((t) => t.outcome !== "passed").map((t) => t.name);
  const passToPass = parsed.tests.filter((t) => t.outcome === "passed").map((t) => t.name);
  // 两列都空不可能（tests.length > 0 已保证），但 failToPass 空要单独说：
  // 那意味着这颗靶子**天生全绿** ⇒ 逐名那一格退化成只查「好的不许坏」，与 namedSetProblems 同一条。
  if (failToPass.length === 0) {
    reasons.push(`靶子 ${task.id} 种子态全绿 ⇒ failToPass 会是空列（这一格退化成只查不许坏）；要么这颗靶子没有红可修，要么判卷跑错了`);
    return { ok: false, reasons };
  }
  return { ok: true, spec: { failToPass, passToPass }, parsed };
}
