// 能力 1 缺的那把尺：一问 →「首轮地图里到底有没有出现该落的那个文件」，并且**按预算扫**。
//
// 为什么量地图：仓库里第一处真会"按问题给模型递代码位置"的面就是符号地图，且它**只注入首轮**
// （装配点 `src/agent/session-provider.ts:848`）。既有三把尺都不是这个形状——`probe-map-recall.ts` 量的是
// **抽取召回**，`tests/impact-accuracy.test.ts` 量的是**合成 10 文件上的边集真值**（换更好的检索器这些数
// 一动不动），`outputs/impact-index-2026-10-01/readings.md` 量的是耗时。⇒ 本尺量「问题→位置」的命中与位次。
//
// 三臂 × 预算扫（10-02 加 C 臂，是为了让增量归因给**词面通道**而不是归因给条件化）：
//   臂 A 生产形状：mentionedIdents / contextFiles / queryText 全给；
//   臂 C 只有排名通道：idents+ctx 给、queryText 不给（＝10-02 之前那一版 A）；
//   臂 B 不条件化：三者都空（纯 PageRank）。
//     没有对照的命中率不许归因给条件化（本仓第 3 形态）。A−C 才是这一笔的增量，C−B 才是条件化的增量。
//   预算取 [1024, 2048, 4096]：1024 = 缺省，4096 = `map/cap.ts` 的钳制上限。
//     ⚠️ 加这一维是**被自己的正哨兵逼出来的**：第一版只跑 1024，枢纽文件 `src/main/settings.ts` 报了 MISS，
//     而哨兵失败时先怀疑尺——所以要分清楚"这一格真不在图里"与"1024 token 的窗口装不下它"。
//   两个面分开数（`splitFaces`）：检索行排在正文**之前**，所以「模型首轮看见了吗」算并集，
//   但读数必须能说清它是从排名面进来的还是从词面进来的——否则这一笔的功劳记错了格子。
//   正则出处：`src/agent/context-signals.ts`（路径形状与标识符形状各一只）。生产端 `session-provider.ts` 与本尺
//     **共用同一支源串**——从前这里是逐字镜像，页上写着「改了那两行正则而不改这里，A 臂就撒谎」，
//     那是靠注释守的不变量；接线尾巴已在本笔收掉，尺的 A 臂输入现在结构上就等于生产端算出来的。
//
// 负控与正哨兵（尺自己不恒真）：
//   `L-POS` 真值 = `src/main/settings.ts`；`L-NEG` 真值 = 不存在的路径（必须 MISS）。
//   哨兵若在 4096 仍 MISS ⇒ 报「图里真没有它」；若在 4096 命中 ⇒ 报「预算窗口把它挤掉了」，两种都是读数。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildMap } from "../src/agent/map/build";
import { isRetrievalLine } from "../src/agent/map/retrieve";
import { makeMentionedRe, makePathishRe } from "../src/agent/context-signals";
import { rulerSelfCheck } from "./lib/probe-self-check";

const REPO = resolve(import.meta.dirname, "..");
// 与生产端同一支源串（`context-signals.ts`）⇒ A 臂的输入不是"照着生产端抄的一份"。
// 模块级实例在这里安全只因为两处都用 `.match()`（全局正则的 match 会自己复位 lastIndex）；
// 哪天改成 exec 循环就得换 `makePathishRe()` 现取现用。
const MENTIONED_RE = makeMentionedRe();
const PATHISH_RE = makePathishRe();
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

/** 把注入正文切成两个面：词面面（检索行，排在最前）＋排名面（地图正文）。
 *  行首判据用 `isRetrievalLine`——与生成面同一支源串，改措辞时这条尺不会静默读不到检索面。 */
function splitFaces(text: string): { lex: string[]; map: string[] } {
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  if (!isRetrievalLine(first)) return { lex: [], map: filesInOrder(text) };
  return { lex: filesInOrder(first), map: filesInOrder(nl < 0 ? "" : text.slice(nl + 1)) };
}

/** 一臂一预算：地图 + 真值位次 + 图自己的覆盖面自述（分母只能从被量对象取，规则 261 同族）。 */
async function arm(question: string, shape: { cond: boolean; lex: boolean }, budget: number) {
  const idents = shape.cond ? [...new Set(question.match(MENTIONED_RE) ?? [])] : [];
  const ctx = shape.cond ? [...new Set(question.match(PATHISH_RE) ?? [])] : [];
  const built = await buildMap({
    workspace: REPO, mentionedIdents: idents, contextFiles: ctx, budgetTokens: budget,
    queryText: shape.lex ? question : undefined,
  });
  const faces = splitFaces(built.text);
  return { built, ...faces, idents: idents.length, ctx: ctx.length };
}

const report: string[] = [];
const hitAt = { A: BUDGETS.map(() => 0), C: BUDGETS.map(() => 0), B: BUDGETS.map(() => 0) };
/** 每题"在任一预算档里命中过"——只喂给尺的自检（正哨兵必须至少命中一次、负控必须一次都不命中）。 */
const hitAnyBudget = new Map<string, boolean>();
const denomByShape: Record<string, number> = {};
let condEmpty = 0;
/** 词面通道单独顶上的格（排名面没有它）＝这一笔的增量；反向那一格＝扣预算挤掉的排名命中＝代价。 */
let lexOnly = 0, lostByBudget = 0, lexCells = 0, lexFilesTotal = 0;
let cov: { c: number; g: number; f: number; t: number } | null = null;

const both = (f: { lex: string[]; map: string[] }): string[] => [...f.lex, ...f.map];
const at = (r: number): string => (r > 0 ? "第" + String(r) : "MISS");

for (const q of rows) {
  denomByShape[q.shape] = (denomByShape[q.shape] ?? 0) + 1;
  const target = q.truth[0]!.file;
  const cells: string[] = [];
  const a0 = await arm(q.question, { cond: true, lex: false }, BUDGETS[0]!);
  if (a0.idents === 0 && a0.ctx === 0) condEmpty++;
  if (cov === null) cov = { c: a0.built.candidates, g: a0.built.graphFiles, f: a0.map.length, t: a0.built.tokens };
  for (const [bi, budget] of BUDGETS.entries()) {
    const A = await arm(q.question, { cond: true, lex: true }, budget);
    const C = bi === 0 ? a0 : await arm(q.question, { cond: true, lex: false }, budget);
    const B = await arm(q.question, { cond: false, lex: false }, budget);
    const rA = rankOf(both(A), target);
    const rC = rankOf(C.map, target);
    const rB = rankOf(B.map, target);
    const lexR = rankOf(A.lex, target), mapR = rankOf(A.map, target);
    if (rA > 0) hitAt.A[bi]!++;
    if (rC > 0) hitAt.C[bi]!++;
    if (rB > 0) hitAt.B[bi]!++;
    if (rA > 0 || rC > 0 || rB > 0) hitAnyBudget.set(q.id, true);
    if (A.lex.length > 0) { lexCells++; lexFilesTotal += A.lex.length; }
    if (lexR > 0 && mapR < 0) lexOnly++;
    if (rC > 0 && rA < 0) lostByBudget++;
    cells.push(`${String(budget)}:A=${at(rA)}(词面=${at(lexR)},排名=${at(mapR)}) C=${at(rC)} B=${at(rB)}`
      + `[A词面=${String(A.lex.length)}/排名=${String(A.map.length)}/tok=${String(A.built.tokens)}`
      + ` C排名=${String(C.map.length)}/tok=${String(C.built.tokens)} B排名=${String(B.map.length)}]`);
  }
  report.push(`${q.id} shape=${q.shape} idents=${String(a0.idents)} ctx=${String(a0.ctx)} target=${target} | ${cells.join(" | ")}`
    + (a0.built.ok ? "" : " [地图降级:" + (a0.built.error ?? "?") + "]"));
}

console.log(report.join("\n"));
console.log("");
console.log(`[locate-recall] 题数=${String(rows.length)}（其中真值题 ${String(rows.length - 2)} 条＋哨兵 1＋负控 1）· 题型分布 ${JSON.stringify(denomByShape)}`);
for (const [bi, budget] of BUDGETS.entries()) {
  console.log(`[locate-recall] 预算 ${String(budget)} tok ⇒ A 臂（条件化＋词面，生产形状）${String(hitAt.A[bi])}/${String(rows.length)}`
    + ` · C 臂（只条件化＝上一版）${String(hitAt.C[bi])}/${String(rows.length)}`
    + ` · B 臂（不条件化）${String(hitAt.B[bi])}/${String(rows.length)}`);
}
console.log(`[locate-recall] 词面通道：有检索行的格=${String(lexCells)}/${String(rows.length * BUDGETS.length)}，平均列=${String((lexFilesTotal / Math.max(1, lexCells)).toFixed(1))} 个文件`);
console.log(`[locate-recall] 增量归因：只有词面顶上的格=${String(lexOnly)}（A−C 的功劳记在词面这一格）；C 命中而 A 两个面全丢=${String(lostByBudget)}（扣预算的代价）`);
console.log(`[locate-recall] 负控 L-NEG 期望始终 MISS；正哨兵 L-POS 期望至少在 4096 命中（否则=图里真没有它）`);
console.log(`[locate-recall] 条件化输入为空的题=${String(condEmpty)}/${String(rows.length)} ⇒ 这些题 C/B 两臂按构造同图，差值不许归因给条件化`);
console.log(`[locate-recall] 覆盖面自述（1024 那一档、无词面）候选文件=${String(cov?.c ?? "?")} 进图=${String(cov?.g ?? "?")} 渲染进地图=${String(cov?.f ?? "?")} tokens=${String(cov?.t ?? "?")}`);

const selfCheck = rulerSelfCheck(hitAnyBudget.get("L-POS") === true, hitAnyBudget.get("L-NEG") === true);
console.log(selfCheck.ok
  ? "[locate-recall] 自检 ✅ 正哨兵命中、负控未命中 ⇒ 上面的命中率可以引用"
  : "[locate-recall] 自检 ❌ " + selfCheck.why);
if (!selfCheck.ok) process.exit(1);
