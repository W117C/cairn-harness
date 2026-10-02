// 能力 1 缺的那把尺：一问 →「首轮地图里到底有没有出现该落的那个文件」，并且**按预算扫**。
//
// 为什么量地图：仓库里第一处真会"按问题给模型递代码位置"的面就是符号地图，且它**只注入首轮**
// （装配点 `src/agent/glm-session.ts:848`）。既有三把尺都不是这个形状——`probe-map-recall.ts` 量的是
// **抽取召回**，`tests/impact-accuracy.test.ts` 量的是**合成 10 文件上的边集真值**（换更好的检索器这些数
// 一动不动），`outputs/impact-index-2026-10-01/readings.md` 量的是耗时。⇒ 本尺量「问题→位置」的命中与位次。
//
// 两臂 × 预算扫：
//   臂 A 条件化：mentionedIdents / contextFiles 由下面两支正则算出；臂 B 不条件化：两者都空（纯 PageRank）。
//     没有对照的命中率不许归因给条件化（本仓第 3 形态）。
//   预算取 [1024, 2048, 4096]：1024 = 缺省，4096 = `map/cap.ts` 的钳制上限。
//     ⚠️ 加这一维是**被自己的正哨兵逼出来的**：第一版只跑 1024，枢纽文件 `src/main/settings.ts` 报了 MISS，
//     而哨兵失败时先怀疑尺——所以要分清楚"这一格真不在图里"与"1024 token 的窗口装不下它"。
//   正则逐字取自生产端：`src/agent/glm-session.ts:793` 的 /[A-Za-z_][A-Za-z0-9_]{3,}/g（最后一个
//   user_message）与 `:784` 的 /[\w./-]+\.[a-z]{1,5}/（路径形状）。
//   ⚠️ 它们是**镜像**不是 import——生产端那两只是 `createGlmSessionProvider` 内的局部闭包
//     （`glm-session.ts:776,789`，都是 events 的纯函数）没导出。"改成模块级导出＋本尺 import"是这把尺的
//     接线尾巴；在那之前**改了那两行正则而不改这里，A 臂就撒谎**，故出处钉死在注释里。
//
// 负控与正哨兵（尺自己不恒真）：
//   `L-POS` 真值 = `src/main/settings.ts`；`L-NEG` 真值 = 不存在的路径（必须 MISS）。
//   哨兵若在 4096 仍 MISS ⇒ 报「图里真没有它」；若在 4096 命中 ⇒ 报「预算窗口把它挤掉了」，两种都是读数。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMap } from "../src/agent/map/build";

const REPO = resolve(import.meta.dirname, "..");
const MENTIONED_RE = /[A-Za-z_][A-Za-z0-9_]{3,}/g;   // 逐字 = glm-session.ts:793
const PATHISH_RE = /[\w./-]+\.[a-z]{1,5}/g;          // 逐字 = glm-session.ts:784
const BUDGETS = [1024, 2048, 4096];

interface Truth { file: string; evidence: string }
interface Q { id: string; shape: string; question: string; truth: Truth[] }

/** 渲染正文里按首次出现顺序取文件（`│` 开头是符号行，不是文件行）。 */
function filesInOrder(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("│")) continue;
    for (const m of line.match(PATHISH_RE) ?? []) {
      const f = m.replace(/^\.\//, "");
      if (!/\.[a-z]{1,5}$/.test(f) || seen.has(f)) continue;
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

const rankOf = (files: string[], target: string): number => {
  const i = files.findIndex((f) => f === target || f.endsWith("/" + target) || target.endsWith("/" + f));
  return i < 0 ? -1 : i + 1;
};

const spec = JSON.parse(readFileSync(resolve(REPO, "fixtures/locate/dsh-questions.json"), "utf8")) as { questions: Q[] };
const rows: Q[] = [
  ...spec.questions,
  { id: "L-POS", shape: "sentinel", question: "各开关的默认值集中在哪个文件里定义？", truth: [{ file: "src/main/settings.ts", evidence: "正哨兵：枢纽文件" }] },
  { id: "L-NEG", shape: "control", question: "noProgressLadder 定义在哪个文件？", truth: [{ file: "src/agent/definitely-not-a-real-file.ts", evidence: "负控：该路径不存在 ⇒ 必须 miss" }] },
];

/** 一臂一预算：地图 + 真值位次 + 图自己的覆盖面自述（分母只能从被量对象取，规则 261 同族）。 */
async function arm(question: string, conditioned: boolean, budget: number) {
  const idents = conditioned ? [...new Set(question.match(MENTIONED_RE) ?? [])] : [];
  const ctx = conditioned ? [...new Set(question.match(PATHISH_RE) ?? [])] : [];
  const built = await buildMap({ workspace: REPO, mentionedIdents: idents, contextFiles: ctx, budgetTokens: budget });
  const files = filesInOrder(built.text);
  return { built, files, idents: idents.length, ctx: ctx.length };
}

const report: string[] = [];
const hitAt = { A: BUDGETS.map(() => 0), B: BUDGETS.map(() => 0) };
const denomByShape: Record<string, number> = {};
let condEmpty = 0;
let cov: { c: number; g: number; f: number; t: number } | null = null;

for (const q of rows) {
  denomByShape[q.shape] = (denomByShape[q.shape] ?? 0) + 1;
  const target = q.truth[0]!.file;
  const cells: string[] = [];
  const a0 = await arm(q.question, true, BUDGETS[0]!);
  if (a0.idents === 0 && a0.ctx === 0) condEmpty++;
  if (cov === null) cov = { c: a0.built.candidates, g: a0.built.graphFiles, f: a0.files.length, t: a0.built.tokens };
  for (const [bi, budget] of BUDGETS.entries()) {
    const A = bi === 0 ? a0 : await arm(q.question, true, budget);
    const B = await arm(q.question, false, budget);
    const rA = rankOf(A.files, target);
    const rB = rankOf(B.files, target);
    if (rA > 0) hitAt.A[bi]!++;
    if (rB > 0) hitAt.B[bi]++;
    cells.push(`${String(budget)}:A=${rA > 0 ? "第" + String(rA) : "MISS"},B=${rB > 0 ? "第" + String(rB) : "MISS"}[A文件=${String(A.files.length)}/tok=${String(A.built.tokens)} B文件=${String(B.files.length)}/tok=${String(B.built.tokens)}]`);
  }
  report.push(`${q.id} shape=${q.shape} idents=${String(a0.idents)} ctx=${String(a0.ctx)} target=${target} | ${cells.join(" | ")}`
    + (a0.built.ok ? "" : " [地图降级:" + (a0.built.error ?? "?") + "]"));
}

console.log(report.join("\n"));
console.log("");
console.log(`[locate-recall] 题数=${String(rows.length)}（其中真值题 ${String(rows.length - 2)} 条＋哨兵 1＋负控 1）· 题型分布 ${JSON.stringify(denomByShape)}`);
for (const [bi, budget] of BUDGETS.entries()) {
  console.log(`[locate-recall] 预算 ${String(budget)} tok ⇒ A 臂（条件化）${String(hitAt.A[bi])}/${String(rows.length)} · B 臂（不条件化）${String(hitAt.B[bi])}/${String(rows.length)}`);
}
console.log(`[locate-recall] 负控 L-NEG 期望始终 MISS；正哨兵 L-POS 期望至少在 4096 命中（否则=图里真没有它）`);
console.log(`[locate-recall] 条件化输入为空的题=${String(condEmpty)}/${String(rows.length)} ⇒ 这些题两臂按构造同图，A/B 差值不许归因给条件化`);
console.log(`[locate-recall] 覆盖面自述（1024 那一档）候选文件=${String(cov?.c ?? "?")} 进图=${String(cov?.g ?? "?")} 渲染进地图=${String(cov?.f ?? "?")} tokens=${String(cov?.t ?? "?")}`);
