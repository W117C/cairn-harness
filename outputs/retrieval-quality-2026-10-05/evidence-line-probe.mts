/** 第 361 页 · 取数探针 ②（只读、零建图、零花费）：检索尺真值集里那条 `evidence` 引用在 HEAD 上还对不对。
 *
 *  立案：`fixtures/locate/dsh-questions.json` 每题带 `evidence: "<路径>:<行号> <符号>"`，
 *  那是「这道题的正确答案凭什么成立」的唯一凭据。全仓只有 2 支**手动**探针读这份 fixture
 *  （`probe-locate-recall.ts:64`／`probe-summary-coverage.ts:82`），两支都只用 `truth[].file`，
 *  **没有一行代码读过 `evidence`** ⇒ 行号可随任何一次编辑漂，而尺照旧退 0。
 *
 *  v2 修正（v1 有三处自己造出来的假读数，逐条写在这儿免得下一个人重踩）：
 *   ① v1 把 `.agent/snapshots` 里的 `agent` 当成「符号」去核 ⇒ 假漂。现在**先剥掉路径形状的词**再取符号。
 *   ② v1 读不懂范围引用 `:17-145` ⇒ 假漂。现在范围按「符号落在 [起..止] 内即命中」。
 *   ③ v1 对「引用后面只有中文」那一格取不到符号却照样进账 ⇒ 现在单列「无法核」，**不计漂**。
 *  ⚠️ 三态必须分开印（命中／漂／符号在该文件根本不存在／无法核）：把「量不了」并进「没问题」比并进「红」更坏。
 *
 *  跑法（仓库根）：node --import tsx outputs/retrieval-quality-2026-10-05/evidence-line-probe.mts
 */
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const atHead = (rel: string): string | null => {
  const r = spawnSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
};

const spec = JSON.parse(atHead("fixtures/locate/dsh-questions.json") ?? "{}") as {
  questions: { id: string; truth: { file: string; evidence: string }[] }[];
};

/** 一条引用：`<路径>:<行号>`，可选 `-<止行>`，路径必须以源码扩展名结尾。 */
const CITE = /([\w./-]+\.(?:ts|tsx|js|mjs)):(\d+)(?:-(\d+))?/g;
/** 符号候选：≥4 个字符的 ASCII 标识符。
 *  v3 两处修正（v2 留下的两个假读数源）：
 *   ④ 从前写成 `(^|[/\w])([A-Za-z_]\w{3,})` ——前缀那个组会**吃掉符号的第一个字符**，
 *      于是打印出「sKnownToolName」「EMORY_TOKEN_BUDGET_DEFAULT」这种半个名字；改成零宽断言。
 *   ⑤ `<ts>--<callId>` 那种**占位符**不是代码符号（v2 拿 `callId` 去核 snapshot.ts:28，报了一条假漂）
 *      ⇒ 取符号前先把 `<...>` 整段剥掉。 */
const SYM = /(?<![A-Za-z0-9_/.-])([A-Za-z_][A-Za-z0-9_]{3,})(?![A-Za-z0-9_/.-])/u;

type Verdict = { kind: "hit" | "drift" | "absent" | "unmeasurable"; note: string };

function checkCite(file: string, start: number, end: number | null, evTail: string, head: string[]): Verdict {
  // 先剥掉 tail 里所有**路径形状**的词与 `<...>` 占位符，剩下的才是符号候选面（修①⑤）
  const stripped = evTail.replace(/[\w./-]+\.(?:ts|tsx|js|mjs)/g, " ").replace(/<[^>]*>/g, " ");
  const sym = SYM.exec(stripped)?.[1] ?? null;
  if (sym === null) return { kind: "unmeasurable", note: "引用后没有可取的 ASCII 符号名（中文说明／纯锚点）⇒ 不计漂" };
  if (end !== null) {
    // 修②：范围引用——落在区间内即命中（`model-surface.ts:17-145 planSurfaceBudget` 就是这个形状）
    const span = head.slice(start - 1, end).join("\n");
    if (span.includes(sym)) return { kind: "hit", note: `"${sym}" 落在声称的区间 ${String(start)}-${String(end)} 内` };
  } else if ((head[start - 1] ?? "").includes(sym)) {
    return { kind: "hit", note: `"${sym}" 确在第 ${String(start)} 行` };
  }
  const real = head.findIndex((l) => l.includes(sym)) + 1;
  if (real === 0) return { kind: "absent", note: `"${sym}" 在该文件**任何一行都没有**（改名/删码，比漂更坏）` };
  return { kind: "drift", note: `"${sym}" 实际在第 ${String(real)} 行（偏移 ${String(real - start)}）；声称的第 ${String(start)} 行是「${(head[start - 1] ?? "").trim().slice(0, 40) || "空行"}」` };
}

const tally = { hit: 0, drift: 0, absent: 0, unmeasurable: 0 };
const rows: string[] = [];
let cites = 0;

for (const q of spec.questions) {
  const ev = (q.truth ?? [])[0]?.evidence ?? "";
  for (const m of ev.matchAll(CITE)) {
    const [, file, startRaw, endRaw] = m;
    const start = Number(startRaw);
    const end = endRaw === undefined ? null : Number(endRaw);
    cites++;
    const text = atHead(file);
    if (text === null) { tally.absent++; rows.push(`${q.id}  ${file}:${String(start)}  ⇒ 文件不在 HEAD（量不了，按 absent 记账不出声）`); continue; }
    const v = checkCite(file, start, end, ev.slice((m.index ?? 0) + m[0].length), text.split("\n"));
    tally[v.kind]++;
    rows.push(`${q.id}  ${file}:${String(start)}${end !== null ? `-${String(end)}` : ""}  ⇒ ${v.kind === "hit" ? "命中，" : ""}${v.note}`);
  }
}

console.log(`evidence 引用逐枚核（HEAD 那份，只读、零建图）｜题数=${String(spec.questions.length)}`);
console.log("");
for (const r of rows) console.log(r);
console.log("");
console.log(`---- 引用=${String(cites)}｜命中=${String(tally.hit)}｜**漂=${String(tally.drift)}**｜`
  + `符号在该文件不存在=${String(tally.absent)}｜无法核=${String(tally.unmeasurable)}`);
console.log("");
console.log("★ 人工复认（本尺的第一版读数不许直接进帽——自动取词会挑错符号，也会漏掉引用后没有符号的那几条）：");
console.log("  自动报的 6 条里：真漂 5 条 ＋ 假漂 1 条。");
console.log("    真漂：L02 verify.ts:101→106(+5)｜L08 agent-runner.ts:1143→1150(+7)｜L09 inject.ts:27(空行)→28(+1)");
console.log("           ｜L10 rank.ts:52→77(+25)｜L14 model-surface.ts 声称区间 17-145 而定义实为 167");
console.log("    假漂 1：L07 apply_patch.ts:198-200 —— 自动取词取到散文里的 `hunk`；声称行第 198 行确实是 `if (f.op === \"rename\")`。");
console.log("  自动量不到、手工补核的 2 条：");
console.log("    L03/L11 的 `src/agent/loop.ts:297` 引用后没有符号名 ⇒ 落成「无法核」；297 行是注释，调用实为 304(+7)；");
console.log("    L10 那句 `…:52 buildGraph / :164 personalizedPageRank` 的第二枚是**裸行号**、本尺不解析；实为 231(+67)。");
console.log("  ⇒ 进账口径：**7 枚引用已漂**（自动 5＋手工 2），落在 14 题里的 **7 题**上");
console.log("     （L02、L03 与 L11 同指那一枚 loop.ts:297、L08、L09、L10 两枚、L14）；");
console.log("     另有 1 条候选是**假漂**（L07），0 条指向不存在的文件。");
console.log("");
console.log("读数用途：这是「检索尺的真值面有没有观测者」那一格的**存量登记**分母（本仓帽只准调低）。");
console.log("口径提醒：漂的计数随任何一次编辑浮动，所以这一维**建议只登记不拦**——把它做成阻断维");
console.log("  就会逼「改代码前先改 fixture」，那是过拟合的另一种写法。真要拦的是文件级存在性与");
console.log("  哨兵/负控形状（语义变了才是真变了），而 `absent` 那一格例外：符号在文件里根本没有了，");
console.log("  那说明真值题在指一件不存在的事，它比行号漂更该出声。");
