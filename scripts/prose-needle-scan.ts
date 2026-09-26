// 复跑面 · 「诊断文案 ↔ 断言收料」的接缝对账（第 92 页）
//
// 动因是本轮自己踩的那格：我改了 `magnitudeOfAb` 里 `reason` 的一句措辞，没回去跑那条
// `expect(m.reason).toContain("…")` ⇒ 红要等**主树全量**（2506 条 / 75 秒）才看得见。
// 同一族的**另一半**本仓早做了：`scripts/mutate-anchor-titles.ts` 秒级校验「锚点的 expectFail
// 还在不在它所指的那个 test 文件里」。**反方向一直没人查**：test 侧按诊断字段收料的那串字面量，
// 还在不在生产侧。本面补的就是这半边。
//
// 四态各自点名，一条都不许静默归进"没问题"（口径同规则 82/117）：
//   verbatim            生产侧逐字有这段 ⇒ 真接上了；
//   across-interpolation 逐字没有，但拆出的每个静态段都落在**同一个**生产文件里
//                       ⇒ 中间隔着 `${…}` 的运行时值（数字/名字/sha），不是漂了；
//   non-prose           收的是算出来的值/标点（计数、比值）⇒ 生产侧本来就不会有这句；
//   drift               连静态段都对不齐 ⇒ 这才是"改了文案没改断言"的候选缺陷。
// drift 走存量豁免（`KNOWN_NON_DRIFT`）：逐条带理由，名单外新增即红，**登记了却不再命中的也算红**
// （stale-waiver，同 docs-check 的 LEGACY_WAIVERS 规矩）——豁免不许静默烂在这儿。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 只收**诊断字段**（`reason`/`why`/`detail`/`note`）。
 *  第一版把 `text`/`message`/`error` 也收了，结果 15 条 drift 里 10 条收的是**被测内容**
 *  （`api_key`、`alpha2`、工具输出片段）——那类断言本来就该长这样，报它"生产侧没有"是我这把尺的噪声。
 *  `.not.toContain`（不要求存在）与 `toContain(SHIP.sha)`（变量，没字面量可对）都不收。
 *  `)` 后面那个点不许漏：`expect(x.reason).toContain("…")` 里收料方法挂在成员访问上——
 *  漏了就**整面恒 0 命中**（第一版正是这样，靠"零命中即红"那条自检才没被读成全绿）。 */
const NEEDLE =
  /\.\s*(reason|why|detail|note)\s*\)\s*\.\s*(not\.)?\s*(?:toContain|toMatch|includes)\s*\(\s*"((?:[^"\\]|\\.)*)"/g;

/** 表里/源码里的字面量是 JS 转义态（`\n`、`\"`），运行时比的是解出来的真字符。 */
function decodeJs(lit: string): string {
  try {
    return JSON.parse('"' + lit + '"') as string;
  } catch {
    return lit;
  }
}

export interface ProseNeedle {
  file: string;
  line: number;
  field: string;
  needle: string;
}

/** 从一个 test 文件里挑料；行号按换行数算（读数要一跳到位）。 */
export function collectNeedles(relPath: string, text: string): ProseNeedle[] {
  const out: ProseNeedle[] = [];
  for (const m of text.matchAll(NEEDLE)) {
    if (m[2] !== undefined) continue;
    const needle = decodeJs(m[3]!);
    if (needle.trim() === "") continue;
    out.push({ file: relPath, line: text.slice(0, m.index).split("\n").length, field: m[1]!, needle });
  }
  return out;
}

/** 把 needle 切成静态段：CJK 连续 2 字以上、ASCII/数字连续 3 字符以上；标点与空格当分隔。
 *  拆段是给 across 用的——插值打断的是段与段之间的连接，段本身不该被打断。 */
export function staticRuns(needle: string): string[] {
  return needle.match(/[一-鿿]{2,}|[A-Za-z0-9_./-]{3,}/g) ?? [];
}

/** 纯数字/标点 ⇒ 收的是**算出来的值**，生产侧不会有这句字面量，不许混进 drift。 */
const ONLY_VALUES = /^[\d.,%\s+−–:：=×/~-]+$/;

export type CoverKind = "verbatim" | "across-interpolation" | "non-prose" | "drift";

export interface NeedleVerdict extends ProseNeedle {
  kind: CoverKind;
  /** verbatim / across 给命中的生产文件；drift 给"第一个对不上的段"便于人一眼看到断在哪。 */
  detail: string;
  /** drift 时对不齐的那一段 ⇒ 存量豁免的键（整串含运行时值，改一个字就换键，登记不住）。 */
  lostRun: string;
  /** 这段落在几处**不同字面量**里（>1 ⇒ 顶包风险：改了其中一处，断言照样绿 ⇒ 单列出声）。 */
  copies: number;
}

/** 取料只认**字符串/模板字面量**，并且数它出现在几处字面量里。
 *  为什么不是"整文件文本里 grep"：本仓注释极密，中文短语在注释里重复是常态，
 *  而更坏的一类是**同模块另一句无关文案替被锚定的文案顶包**——
 *  造红实测：我把 `reason` 那句改了字，同文件里 `repRowLine` 的"（不足两次同配置重复）"
 *  把断言喂饱了 ⇒ 错报 0 drift。字面量级 + 副本计数让这一格从"静默"变成"出声的读数"
 *  （口径同规则 82/98：认不出≠没事，要单列）。
 *  曾用过"字段名须在 ±400 字符邻域"的邻居约束：它把跨层传话（events 抛的 Error 文案进 distill 的 `.why`）
 *  误判成 drift ⇒ 判的是"离得近"而不是"谁产出的"，撤。 */
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/gs;

export interface LiteralChunk {
  path: string;
  /** 该字面量所在的函数名（找不到＝模块顶层，记 `(top)`）。
   *  按**函数**数副本才有用：同模块里另一句文案喂饱断言，正是"改一处不响"的那种漂。 */
  fn: string;
  /** 该字面量里的一段静态文本（`${…}` 会把它切开）。 */
  chunk: string;
}

/** 字面量起点往前最近的函数头＝它所在的函数。只用来分副本，不是完整作用域分析（上限见页里写明）。 */
const FN_HEAD = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/g;

function enclosingFn(text: string, at: number): string {
  let fn = "(top)";
  for (const m of text.slice(0, at).matchAll(FN_HEAD)) fn = m[1] ?? m[2] ?? fn;
  return fn;
}

/** 抽字面量并按 `${…}` 切成静态段（同一段字面量切出的块共享同一个 fn）。 */
export function extractLiterals(path: string, text: string): LiteralChunk[] {
  const out: LiteralChunk[] = [];
  for (const m of text.matchAll(LITERAL)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    const fn = enclosingFn(text, m.index ?? 0);
    for (const piece of raw.split(/\$\{[\s\S]*?\}/)) {
      const chunk = decodeJs(piece);
      if (chunk.trim() !== "") out.push({ path, fn, chunk });
    }
  }
  return out;
}

/** 这段文字落在几处**不同函数的不同字面量**里（>1 ⇒ "漂了也不响"的风险，单列出声）。 */
export function copyCount(chunks: readonly LiteralChunk[], needle: string): number {
  const seen = new Set<string>();
  for (const c of chunks) if (c.chunk.includes(needle)) seen.add(c.path + "\u0000" + c.fn);
  return seen.size;
}

/** 逐条判四态。`sources` = 生产侧文件。 */
export function classifyNeedles(
  needles: readonly ProseNeedle[],
  sources: readonly { path: string; text: string }[],
): NeedleVerdict[] {
  const chunks = sources.flatMap((s) => extractLiterals(s.path, s.text));
  const byPath = new Map<string, string>();
  for (const c of chunks) byPath.set(c.path, (byPath.get(c.path) ?? "") + c.chunk);
  return needles.map((n) => {
    const runs = staticRuns(n.needle);
    const zero = { detail: "", lostRun: "", copies: 0 };
    if (runs.length === 0 || runs.every((r) => ONLY_VALUES.test(r))) {
      return { ...n, ...zero, kind: "non-prose", detail: "收的是算出来的值/标点，不比对生产文案" };
    }
    const hit = chunks.find((c) => c.chunk.includes(n.needle));
    if (hit !== undefined) {
      return { ...n, kind: "verbatim", detail: hit.path, lostRun: "", copies: copyCount(chunks, n.needle) };
    }
    // across：同一文件里各静态段按顺序拼得出整串 ⇒ 中间隔的是 `${…}` 的运行时值。
    for (const [path, whole] of byPath) {
      if (runs.every((r) => whole.includes(r))) {
        return { ...n, kind: "across-interpolation", detail: path, lostRun: "", copies: copyCount(chunks, runs[0]!) };
      }
    }
    const seen = new Set(runs.filter((r) => chunks.some((c) => c.chunk.includes(r))));
    const lost = runs.find((r) => !seen.has(r)) ?? runs[0]!;
    return { ...n, kind: "drift", detail: `生产侧的字面量里没有这一段：「${lost}」`, lostRun: lost, copies: 0 };
  });
}

/** 存量豁免（键＝`test 文件|对不齐的那段`）。今天两条同因：诊断句里嵌了**当场输入**
 *  （fixture 给的路径片段 / 用例自带的预算数字），生产侧不该出现它们——这类断言是健康的。
 *  撤登记条件：那两条用例改成收真文案（或收料段换成变量）之后，本表会自己报 stale-waiver。 */
export const KNOWN_NON_DRIFT: Readonly<Record<string, string>> = {
  "tests/docs-check.test.ts|30000":
    "该条 detail 嵌的是这条用例自己给的预算夹具值，不是本仓写的文案 ⇒ 生产侧无从出现",
  "tests/docs-check.test.ts|no-such":
    "该条 detail 嵌的是当场输入的路径片段（故意不存在的那个名字）⇒ 判的是缺文件分支，不是文案",
};

export interface WailedRow extends NeedleVerdict {
  waived: boolean;
}

/** 应用豁免并算 stale：登记了却不再命中 ⇒ 那条也要红（逼人回看，同 docs-check/mutate-anchor-titles）。 */
export function applyWaivers(
  verdicts: readonly NeedleVerdict[],
  waivers: Readonly<Record<string, string>> = KNOWN_NON_DRIFT,
): { rows: WailedRow[]; stale: string[] } {
  const hit = new Set<string>();
  const rows = verdicts.map((v): WailedRow => {
    if (v.kind !== "drift") return { ...v, waived: false };
    const key = v.file + "|" + v.lostRun;
    const why = waivers[key];
    if (why === undefined) return { ...v, waived: false };
    hit.add(key);
    return { ...v, waived: true, detail: v.detail + "（存量豁免：" + why + "）" };
  });
  return { rows, stale: Object.keys(waivers).filter((k) => !hit.has(k)) };
}

function trackedFiles(prefixes: readonly string[], exts: readonly string[], root: string): string[] {
  const raw = execFileSync("git", ["ls-files", "-z", ...prefixes], { encoding: "utf8", cwd: root });
  return raw.split("\0").filter((p) => p !== "" && exts.some((e) => p.endsWith(e)));
}

export interface ScanReport {
  needles: number;
  testFiles: number;
  sourceFiles: number;
  missingOnDisk: string[];
  counts: Record<CoverKind, number>;
  drift: WailedRow[];
  across: WailedRow[];
  /** 收料那段落在 ≥2 处字面量里：这句漂了也不响，是**顶包候选**清单（不红，但必须列出来）。 */
  multiCopy: WailedRow[];
  stale: string[];
}

/** 扫整仓（读盘 IO 集中在这里；纯函数由 tests/ 直接消费）。 */
export function scanRepo(root: string): ScanReport {
  // 仓根问 git、不做路径算术：`new URL("../..", import.meta.url)` 从 `scripts/<f>.ts` 出发会多退一层，
  // 于是每个 read 都 ENOENT（第一次跑就是这么炸的——炸得响，比读成 0 条好）。
  const missingOnDisk: string[] = [];
  const load = (list: readonly string[]): { path: string; text: string }[] => {
    const out: { path: string; text: string }[] = [];
    for (const p of list) {
      try {
        out.push({ path: p, text: readFileSync(resolve(root, p), "utf8") });
      } catch {
        // `git ls-files` 会给出**已跟踪但盘上已被删**的文件（桌面层那笔删除在别人手里飞）⇒
        // 跳过并点名：跳过 ≠ 没问题，那 N 条此刻没有尺。
        missingOnDisk.push(p);
      }
    }
    return out;
  };
  const testFiles = load(trackedFiles(["tests"], [".test.ts"], root));
  const sources = load(trackedFiles(["src", "scripts"], [".ts", ".mts", ".mjs"], root));
  const needles = testFiles.flatMap((f) => collectNeedles(f.path, f.text));
  const { rows, stale } = applyWaivers(classifyNeedles(needles, sources));
  const counts = { verbatim: 0, "across-interpolation": 0, "non-prose": 0, drift: 0 } as Record<CoverKind, number>;
  for (const r of rows) counts[r.kind] += 1;
  return {
    needles: needles.length,
    testFiles: testFiles.length,
    sourceFiles: sources.length,
    missingOnDisk,
    counts,
    drift: rows.filter((r) => r.kind === "drift" && !r.waived),
    across: rows.filter((r) => r.kind === "across-interpolation"),
    multiCopy: rows.filter((r) => r.copies > 1),
    stale,
  };
}

function main(): void {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const r = scanRepo(root);
  console.log(
    "prose-needle-scan：收料断言 " + String(r.needles) + " 条（扫 " + String(r.testFiles) +
      " 个 test 文件）｜生产侧 " + String(r.sourceFiles) + " 个文件",
  );
  if (r.missingOnDisk.length > 0) {
    console.log(
      "  ⚠️ 清单里有 " + String(r.missingOnDisk.length) + " 个文件盘上不存在（他人的在飞删除），已跳过：" +
        r.missingOnDisk.slice(0, 6).join("、"),
    );
  }
  console.log(
    "  verbatim " + String(r.counts.verbatim) +
      " ｜ across-interpolation " + String(r.counts["across-interpolation"]) +
      " ｜ non-prose " + String(r.counts["non-prose"]) +
      " ｜ drift（未登记）" + String(r.drift.length),
  );
  for (const v of r.drift) console.log("  ❌ drift " + v.file + ":" + String(v.line) + " ." + v.field + " ⇒ " + v.detail);
  for (const k of r.stale) console.log("  ❌ stale-waiver " + k + " ⇒ 已不再命中：从 KNOWN_NON_DRIFT 删掉它");
  for (const v of r.across.slice(0, 12)) {
    console.log("  ⚠️ across " + v.file + ":" + String(v.line) + " ." + v.field + " ⇒ " + v.detail + "（整串「" + v.needle + "」）");
  }
  console.log(
    "  顶包候选（收料那段在 ≥2 处字面量里 ⇒ 改一处不会响）：" + String(r.multiCopy.length) + " 条",
  );
  for (const v of r.multiCopy.slice(0, 10)) {
    console.log("    ⚠️ " + String(v.copies) + " 处 · " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」");
  }
  if (r.needles === 0) {
    console.error("❌ 一条收料断言都没挑到 ⇒ 取料面自己坏了，这不是「全绿」");
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.drift.length === 0 && r.stale.length === 0 ? 0 : 1;
}

// 只在直接执行时读数：判卷要 import 纯函数，模块加载不得有副作用（也不该扫盘）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
