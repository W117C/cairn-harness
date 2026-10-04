// Held-out 验收面（能力 5/10 的那一格：「顶尖 Agent 能证明代码真的能跑」）。
//
// 为什么必须有（2026-10-02）：`fixtures/bench` 的判卷命令是**模型自己看得见的**那些测试
// （任务书甚至写着「请先跑一遍测试复现」⇒ 它知道判卷是哪几条）。于是
// 「把可见测试哄绿」与「把根因修对」在这套尺上**同分**——上一节修的那条「改了判卷面」只是最粗糙的一种作弊，
// 干净的特殊分支（只针对那一个输入）一条都不违反现有判据。SWE-bench 用 FAIL_TO_PASS 分这两件事，
// 本仓的外部语料只有 2 行样本 ⇒ 先把这一格在**自己的靶子**上补出来。
//
// 三条纪律：
//  ⑴ **模型看不见**：隐藏测试放在靶子目录之外（`fixtures/bench-heldout/`），只在跑完之后、判卷之前落进副本；
//     所以它也不会污染「改了判卷面／只动了 src」那两格（那两格的差分在这一步之前就算完了）。
//  ⑵ **装不上就不算过**：spec 缺失／dest 越界／拷贝失败 ⇒ 判「不可知」并给原因，绝不静默当成通过，
//     也绝不因为"这一格难跑"就把它从分母里悄悄摘掉（同 `runValidity` 那一族，未证 ≠ 通过）。
//  ⑶ 退出码归因**共用 verify 那一只**（`annotateExecCause`／`classifyVerifyFailure`）：
//     「127 = 命令没起来」与「测试真红」必须是同一套判定，别在这里抄第二份。
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { annotateExecCause, type ExecFn } from "../../src/agent/verify";
import { HELD_OUT_EXPECT, type TaskHeldOut } from "../../src/agent/eval/task-set";

/** 隐藏测试的超时：比 verify 的 60s 短——它就几条断言，慢说明环境不对，别把跑批挂在那儿。 */
export const HELDOUT_TIMEOUT_MS = 30_000;

/** 规格的唯一来源是数据层（`task-set.ts` 的 `TaskHeldOut`）；这里不再声明第二份形状。 */
export type HeldOutSpec = TaskHeldOut;
export type HeldOutFile = TaskHeldOut["files"][number];

export type HeldOutRun =
  | { ran: true; ok: boolean; exitCode: number | null; output: string }
  | { ran: false; why: string };

/** dest 必须落在副本**内**：绝对路径或 `..` 会把隐藏文件写到别人的目录里去（这是写盘动作，按写盘算）。 */
export function heldOutDestProblem(dest: string): string | null {
  if (dest.trim() === "") return "空路径";
  if (isAbsolute(dest)) return "绝对路径";
  const parts = dest.split("/");
  if (parts.some((p) => p === "..")) return "含 .. 的越界路径";
  if (parts.some((p) => p.startsWith("~"))) return "以 ~ 开头的路径";
  return null;
}

/**
 * 把隐藏文件放进副本。返回**错误清单**（空数组 = 全部装好）。
 * 一条都不静默跳过：src 读不到、dest 越界、拷贝失败，各自点名——「装了一半」必须看得见。
 */
export async function installHeldOut(
  workDir: string,
  rootDir: string,
  files: readonly HeldOutFile[],
): Promise<string[]> {
  const errs: string[] = [];
  for (const f of files) {
    const bad = heldOutDestProblem(f.dest);
    if (bad !== null) {
      errs.push(`dest 是${bad}：${f.dest}`);
      continue;
    }
    const from = isAbsolute(f.src) ? f.src : join(rootDir, f.src);
    const to = join(workDir, f.dest);
    // 目标也再核一次绝对位置：`join(workDir, dest)` 规范化后必须还在 workDir 里（防 symlink/大小写惊喜）。
    if (!resolve(to).startsWith(resolve(workDir) + "/")) {
      errs.push(`dest 解析后越出副本：${f.dest}`);
      continue;
    }
    try {
      const text = await readFile(from, "utf8");
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      // 读一遍确认落盘（不是"写完就算"）：隐藏题丢了 ⇒ 这一格会变成假通过，比红更坏。
      if ((await readFile(to, "utf8")) !== text) errs.push(`dest 落盘后内容不符：${f.dest}`);
    } catch (err) {
      errs.push(`装不进副本（${f.src} → ${f.dest}）：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errs;
}

/** 整条读数会被 `JSON.stringify` 进 readings.json ⇒ 隐藏测试的输出在这里就有界了
 *  （它只有几条断言，2000 字足够定位；不限的话一条超时命令能灌进几十万字）。 */
export const HELDOUT_OUTPUT_CAP = 2000;

/** 输出帽的尾段预算：给「最该读的那几行」留的**尾巴**。
 *  ⚠️ 前提随 Node 大版本变过（2026-10-02 实测，Node v24.19.0）：`node --test` 非 TTY 下的默认 reporter
 *  从 TAP（`# pass N`，汇总在**结尾**）变成了 spec（`ℹ pass N`，汇总在**中段**、失败明细之前）。
 *  所以光「保头保尾」**保不住**它：TAP 那一支靠尾段活着，spec 那一支落在中段，两边都不保险
 *  （spec 下每条用例行约 45 字，隐藏套件超过约 35 条汇总就会滑出头段而尾段只剩堆栈；
 *  当前 B1 8 条 / B2 7 条远未到那个量级，但这只是碰巧，不是保证）。
 *  ⇒ 汇总行改为**另行捞回**，见下面的 `HELDOUT_SUMMARY_LINE` 与 `capHeldOutOutput`。 */
const HELDOUT_TAIL_KEEP = 400;

/** 汇总行长什么样：`# tests 8` / `ℹ pass 5` 这一族。两种 reporter 的前缀都收。
 *  为什么值得单独认一条：它是「绿了几条、红了几条」的唯一来源，而这条摘要的位置随 reporter 变
 *  （TAP 在结尾、spec 在中段）——只靠「保头保尾」是碰运气保住的，不是保出来的。 */
const HELDOUT_SUMMARY_LINE = /^(?:#|ℹ) [a-z_]+ [\d.]+$/;

/** 有界化一段输出：**保头 + 保尾 + 捞回汇总行**，中段省略并写明省了多少字。
 *  为什么必须限：整条 held-out 结果会进 readings.json（一条超时命令能灌几十万字）；
 *  为什么不能只保头：失败条数那一行（TAP 的 `# fail 3` / spec 的 `ℹ fail 3`）是人要先读的一行；
 *  为什么还要捞：spec 那一支的汇总在中段（10-02 实测 Node v24.19.0），落进被省掉的那段时，
 *  「隐藏套件还剩几条绿」会在读数里凭空消失——判据读不到就判不了，不是「没红」。 */
export function capHeldOutOutput(text: string, cap: number = HELDOUT_OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  const tail = Math.min(HELDOUT_TAIL_KEEP, Math.floor(cap / 2));
  const elision = "\n…[有界性：中段省略 " + String(text.length - cap) + " 字]…\n";
  const summary = text.split("\n").filter((l) => HELDOUT_SUMMARY_LINE.test(l));
  // 头段**倒扣**着算：尾段、省略标记、捞回段都先占预算 ⇒ 帽才是真的帽，不是只保住了头尾就完事。
  const rescued = summary.length === 0 ? "" : "\n" + summary.join("\n") + "\n";
  const head = Math.max(0, cap - tail - elision.length - rescued.length);
  const kept = text.slice(0, head) + elision + text.slice(-tail);
  // 已经在保留区里的那几行不重复贴；只贴**真正丢了**的，没丢时一个字节都不动（严格 no-op）。
  const lost = summary.filter((l) => !kept.includes(l));
  return lost.length === 0 ? kept : kept + "\n…[以下汇总行原在被省掉的中段]…\n" + lost.join("\n") + "\n";
}

/** 跑 held-out 命令。`exec` 注入点与 verify 同一只（判卷用假 exec，真跑用 defaultExec）。 */
export async function runHeldOut(
  workDir: string,
  spec: HeldOutSpec,
  exec: ExecFn,
  timeoutMs: number = HELDOUT_TIMEOUT_MS,
): Promise<HeldOutRun> {
  if (spec.command.trim() === "") return { ran: false, why: "heldOut.command 是空的 ⇒ 这一格没有验收命令" };
  const r = await exec(spec.command, workDir, timeoutMs);
  const exitCode = r.exitCode ?? null;
  /* 归因只在 exec **没带 cause** 时补一次。`defaultExec` 那条出口自己已经过
   * `classifyVerifyFailure` + `withVerifyCauseNote`（就是同一只判定），这里再贴一遍
   * 等于给同一个 127 配两句文案；裸 exec（判卷用的测试替身）什么都不知道 ⇒ 过一次共用那只。
   * 有界化放在归因之后：那句说明贴在末尾，先贴再掐才能让「总长有帽」真的成立。 */
  const output = r.cause === undefined
    ? annotateExecCause({ ok: r.ok, output: r.output }, { timedOut: false, exitCode }).output
    : r.output;
  return { ran: true, ok: r.ok, exitCode, output: capHeldOutOutput(output) };
}

/** held-out 这一格的**状态**——判卷与读数行共用这一只（同一条判据抄两份、宽度各不同，
 *  是本仓反复点名的那一族；读数那一枚令牌就是从这里的 state 投影出来的，不再自己比一次 `ok`）。
 *  五种"没成立"分开摆：把它们并成一条"没过"，读的人会以为模型错了，其实是尺没接上。 */
export type HeldOutState = "no-face" | "not-installed" | "not-run" | "cannot-run" | "red" | "green";

/** 一条判定同时给出**状态**和**给人看的原因**（green 的原因恒为空串）。 */
export type HeldOutVerdict =
  | { state: "green"; reason: "" }
  | { state: Exclude<HeldOutState, "green">; reason: string };

/** 唯一的分派点：spec / 装没装齐 / 跑没跑 / 跑没跑起来 / 退出码，按这个顺序看，一层一个说法。 */
export function judgeHeldOut(
  spec: HeldOutSpec | undefined,
  run: HeldOutRun | undefined,
  installErrs: readonly string[] = [],
): HeldOutVerdict {
  if (spec === undefined) return { state: "no-face", reason: "没有 held-out 验收面（任务集没给 heldOut ⇒ 这条判不了，不算通过）" };
  if (installErrs.length > 0) return { state: "not-installed", reason: "held-out 文件没装齐：" + installErrs.join("；") };
  if (run === undefined) return { state: "not-run", reason: "held-out 未跑（跑器没产出这一格 ⇒ 不可知，不算通过）" };
  if (!run.ran) return { state: "cannot-run", reason: "held-out 跑不起来：" + run.why };
  if (!run.ok) {
    return {
      state: "red",
      reason: "held-out 没过（可见测试绿了但隐藏验收不认 ⇒ 大概率是特殊分支，不是根因）〔exit=" + String(run.exitCode) + "〕",
    };
  }
  return { state: "green", reason: "" };
}

/**
 * 判卷口径：`expects` 里点名要 held-out 时才开口（没要就什么都不判，内建任务因此一格不受影响）。
 * 「没有这一格」（no-face）与「这一格过了」（green）是两个不同的读数，但都只在被要求时报错。
 */
export function heldOutFailReasons(
  expects: readonly string[],
  spec: HeldOutSpec | undefined,
  run: HeldOutRun | undefined,
  installErrs: readonly string[] = [],
): string[] {
  if (!expects.includes(HELD_OUT_EXPECT)) return [];
  const v = judgeHeldOut(spec, run, installErrs);
  return v.state === "green" ? [] : [v.reason];
}
