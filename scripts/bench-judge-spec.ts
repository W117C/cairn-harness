// 把逐名判卷规格（`TaskSpec.judge`）**现读靶子**写进五份 bench 清单。
//
// 为什么是脚本而不是手改 JSON：手抄两列 = 第二份会漂的账。靶子加一条测试、改一个标题，
// JSON 里那份不会跟着动，而这一格**恒真**（它写的那几条名字对不上任何用例 ⇒ 全进 `unmatched`
// ⇒ 三态，看起来"没绿"；更糟的是把一条本来就绿的写进 failToPass ⇒ 它永远绿 ⇒ 恒真）。
//
// 用法：
//   node --import tsx scripts/bench-judge-spec.ts            # 只读：印出会写什么，不动盘
//   node --import tsx scripts/bench-judge-spec.ts --write    # 写进五份清单（保持其余字段逐字不变）
//   node --import tsx scripts/bench-judge-spec.ts --check    # 门形状：清单与盘上现读一致才退 0
//
// `--check` 是那道门：任何一处漂了（靶子改了标题／加了测试／清单被人手改过）都红并点名。
// 它与 `tests/bench-corpus-parity.test.ts` 分工不同：那份判的是「文档/清单 ↔ 盘上**目录与条数**」，
// 这一支判的是「清单里的**逐名两列** ↔ 盘上**逐字跑出来**的那些名字」。
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { judgeSpecFromSeed, type JudgeSeedTask } from "./lib/bench-judge-spec";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const CHECK = argv.includes("--check");
/** 仓根（清单路径与靶子 spawn 的 cwd 都以它为基）。`--root` 只给判据用：把一份**漂过的副本**
 *  指给它，就能真起一次 `--check` 看它红不红——否则「门比的是内容不是形状」这一格没有观测者
 *  （实测：把 `sameSpec(...)` 换成 `t.judge !== undefined` 后，只验证「配平盘上退 0」的判据全绿 ⇒ 突变存活）。 */
const ROOT = (() => {
  const i = argv.indexOf("--root");
  return i >= 0 && argv[i + 1] !== undefined ? resolve(argv[i + 1]!) : process.cwd();
})();

/** 五份清单 ↔ 各自的判卷命令。命令与清单里的 `verifier.command` 同源（这里不猜）。 */
const MANIFESTS: readonly string[] = [
  "fixtures/bench/tasks.json",
  "fixtures/bench/tasks-long30.json",
  "fixtures/bench/tasks-chain32.json",
  "fixtures/bench/tasks-chain48.json",
  "fixtures/bench/tasks-synthetic.json",
];

interface ManifestTask {
  id: string;
  seed: { kind: string; path: string };
  verifier?: { command: string };
  judge?: { failToPass: string[]; passToPass: string[] };
  [k: string]: unknown;
}

/** 清单原文 → 取料面（缺 verifier 的条目不出料：没有判卷命令就没有逐名面）。 */
function tasksOf(text: string): { tasks: ManifestTask[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { tasks: [], error: `不是合法 JSON：${String((e as Error).message)}` };
  }
  if (!Array.isArray(raw)) return { tasks: [], error: "顶层不是数组" };
  return { tasks: raw as ManifestTask[] };
}

const seedTaskOf = (t: ManifestTask): JudgeSeedTask | null =>
  t.verifier?.command === undefined || t.verifier.command === ""
    ? null
    : { id: t.id, dir: t.seed.path, command: t.verifier.command };

const sameSpec = (a: ManifestTask["judge"], b: { failToPass: string[]; passToPass: string[] }): boolean => {
  if (a === undefined) return false;
  const eq = (x: readonly string[] | undefined, y: readonly string[]): boolean =>
    Array.isArray(x) && x.length === y.length && x.every((v, i) => v === y[i]);
  return eq(a.failToPass, b.failToPass) && eq(a.passToPass, b.passToPass);
};

/** 写盘只换 `judge` 那一格，**文件其余部分逐字不动**。
 *
 *  为什么不用 `JSON.stringify(out, null, 2)`：那会把整份清单重排成一种风格
 *  （`tasks-synthetic.json` 原本是紧凑单行），diff 从「+15 行 judge」变成「5 个文件全改」——
 *  而审 diff 的人要找的正是那 15 行。风格重排还会把别人的手写痕迹抹掉。
 *  做法：解析原文 → 只替换/插入每个任务的 `judge` 值 → 原文其余字节照抄。
 *  这是**纯文本手术**，所以它自己也要被突变体审（见 `tests/bench-judge-spec.test.ts`：
 *  把 judge 换坏、或把别的字段动一个字节，都必须有判据红）。 */

/** JSON 的花括号配对（字符串里的括号不算）：从 `from` 那个 `{` 起数到它的 `}`。 */
function matchBrace(text: string, from: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === "\\") { i += 1; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchBrace: 找不到配对的花括号");
}

/** 任务对象在原文里的 [open, close]（闭区间，指花括号）。
 *  **从 `"id": "<id>"` 那个键定位**，不按 `"<id>"` 裸串找——后者会先命中 `seed.path` 里
 *  同名的目录段（实测：`fixtures/bench/bench-bugfix-crossfile` 就含在 path 里）。
 *  任务对象是数组里的元素，它的 `{` 就在 `"id"` 之前（可能隔着换行与缩进）。 */
function taskSpan(text: string, id: string): { open: number; close: number } {
  const key = `"id": "${id}"`;
  const at = text.indexOf(key);
  if (at < 0) throw new Error(`renderManifest: 原文里找不到 ${key}`);
  const open = text.lastIndexOf("{", at);
  if (open < 0) throw new Error(`renderManifest: ${key} 前面没有对象体`);
  return { open, close: matchBrace(text, open) };
}

/** 一段文本里那一行的前导空白（插入时沿用原缩进）。 */
function indentOfLineBefore(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at) + 1;
  return /^[ \t]*/u.exec(text.slice(lineStart, at))?.[0] ?? "";
}

/** 一次插入/替换的指令（下标全在**同一份原文**上）。 */
interface Edit {
  /** 被替换区间的起点（含）。 */
  from: number;
  /** 被替换区间的终点（不含）。 */
  to: number;
  /** 换上去的文本。 */
  text: string;
}

/** 为每个带 `judge` 的任务算一条 Edit：**只碰 judge 那一格，其余字节逐字不动**。
 *
 *  为什么不用 `JSON.stringify(out, null, 2)`：那会把整份清单重排成一种风格
 *  （`tasks-synthetic.json` 原本是紧凑单行），diff 从「+15 行 judge」变成「5 个文件全改」——
 *  而审 diff 的人要找的正是那 15 行。风格重排还会把别人的手写痕迹抹掉。
 *
 *  **先扫全部区间、再从后往前落**：边扫边改会让后面任务的区间全部位移
 *  （实测：`  ,` 就是这么飞出来的——第二处 edit 拿第一处改完后的下标当原文下标）。
 *  下标互不重叠（每个任务各自一段），从后往前套娃即可。 */
function planEdits(tasks: readonly ManifestTask[], original: string): Edit[] {
  const edits: Edit[] = [];
  for (const t of tasks) {
    if (t.judge === undefined) continue;
    const want = JSON.stringify(t.judge);
    const { open, close } = taskSpan(original, t.id);
    const body = original.slice(open, close);
    const judgeAt = body.indexOf('"judge"');
    if (judgeAt >= 0) {
      // 换值：judge 的值是对象，按花括号配对取它的起止（下标在 body 内）
      const jOpen = body.indexOf("{", judgeAt);
      if (jOpen < 0) throw new Error(`renderManifest: ${t.id} 的 judge 值不是对象`);
      const jClose = matchBrace(body, jOpen);
      const indent = indentOfLineBefore(body, jOpen);
      const wasMultiline = body.slice(jOpen, jClose).includes("\n");
      // 多行就用**缩进的 JSON**（`indent` 是该行原有的前导空白），别拿 `replaceAll` 拼逗号——
      // 那种拼法会把 `[` 与 `]` 也各插一行，出来的东西虽合法却读不成原风格（实测：
      // tasks-synthetic.json 那份手写的两列被拼成了 `"failToPass":[\n "…"\n ]`）。
      const rendered = wasMultiline
        ? JSON.stringify(t.judge, null, 2).replaceAll("\n", "\n" + indent)
        : want;
      edits.push({ from: open + jOpen, to: open + jClose + 1, text: rendered });
    } else {
      // 插入：落在对象体最后一个非空白字符之后。**从 close-1 起跳**（close 是右花括号，
      // 它不是空白）——从 close 起跳会把插入点放到 `}` 之后，顺手把右花括号吃掉。
      let i = close - 1;
      while (i > open && /\s/u.test(original[i]!)) i -= 1;
      const indent = indentOfLineBefore(original, i);
      const hasItems = original.slice(open + 1, i).trim() !== "";
      // 分隔符**加在 judge 前面**（`…上一项 , "judge": …`）——加在后面就成了 `] , "judge"`，
      // 那是把上一项与 judge 之间的逗号写成了上一项与右花括号之间的逗号（语法错）。
      const rendered = body.includes("\n")
        ? `${hasItems ? "," : ""}\n${indent}"judge": ${want}`
        : `${hasItems ? ", " : ""}"judge": ${want}`;
      edits.push({ from: i + 1, to: i + 1, text: rendered });
    }
  }
  // 从后往前落：前面的区间不受后面已发生的位移影响
  return edits.sort((a, b) => b.from - a.from);
}

function renderManifest(tasks: readonly ManifestTask[], original: string): string {
  let text = original;
  for (const e of planEdits(tasks, original)) {
    text = text.slice(0, e.from) + e.text + text.slice(e.to);
  }
  return text;
}

let drift = 0;
let wrote = 0;
const problems: string[] = [];

for (const rel of MANIFESTS) {
  const abs = join(ROOT, rel);
  const { tasks, error } = tasksOf(readFileSync(abs, "utf8"));
  if (error !== undefined) {
    problems.push(`${rel}：${error}`);
    drift += 1;
    continue;
  }
  const out: ManifestTask[] = [];
  for (const t of tasks) {
    const seed = seedTaskOf(t);
    if (seed === null) {
      problems.push(`${rel} ${t.id}：没有 verifier.command ⇒ 这一格无尺，不出规格（保持原样）`);
      out.push(t);
      continue;
    }
    const r = judgeSpecFromSeed(seed, ROOT);
    if (!r.ok) {
      problems.push(`${rel} ${t.id}：${r.reasons.join("；")}`);
      drift += 1;
      out.push(t);
      continue;
    }
    if (sameSpec(t.judge, r.spec)) {
      out.push(t);
      continue;
    }
    drift += 1;
    console.log(`[judge-spec] ${rel} ${t.id}：`
      + `failToPass ${String(t.judge?.failToPass?.length ?? 0)}→${String(r.spec.failToPass.length)}、`
      + `passToPass ${String(t.judge?.passToPass?.length ?? 0)}→${String(r.spec.passToPass.length)}`);
    // 只换 judge 一字段，其余键**逐字**保留（含键序）：写盘不顺手重排别人的清单。
    const next: ManifestTask = { ...t, judge: r.spec };
    out.push(next);
    wrote += 1;
  }
  if (WRITE) writeFileSync(abs, renderManifest(out, readFileSync(abs, "utf8")), "utf8");
}

if (CHECK) {
  if (problems.length > 0) {
    console.error(`[judge-spec] ${String(problems.length)} 处不出规格/不合法：`);
    for (const p of problems) console.error("  - " + p);
  }
  if (drift > 0) {
    console.error(`[judge-spec] ${String(drift)} 条任务的逐名规格与盘上现读不一致 ⇒ 跑 --write 重新生成`);
    process.exit(1);
  }
  console.log("[judge-spec] 五份清单的逐名规格与盘上现读逐字一致 ✅");
  process.exit(0);
}
if (problems.length > 0) {
  console.error(`[judge-spec] ${String(problems.length)} 处不出规格：`);
  for (const p of problems) console.error("  - " + p);
}
console.log(`[judge-spec] ${WRITE ? "已写" : "试运行"}：${String(wrote)} 条任务拿到/更新规格，${String(drift)} 条与现读有差`);
if (!WRITE) console.log("[judge-spec] 试运行未动盘；加 --write 落盘，加 --check 当门跑");
