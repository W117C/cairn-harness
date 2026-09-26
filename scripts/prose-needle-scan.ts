// 复跑面 · 「诊断文案 ↔ 断言收料」的接缝对账（第 92 页）
//
// 动因是本轮自己踩的那格：我改了 `magnitudeOfAb` 里 `reason` 的一句措辞，没回去跑那条
// `expect(m.reason).toContain("…")` ⇒ 红要等**主树全量**（2506 条 / 75 秒）才看得见。
// 同一族的**另一半**本仓早做了：`scripts/mutate-anchor-titles.ts` 秒级校验「锚点的 expectFail
// 还在不在它所指的那个 test 文件里」。**反方向一直没人查**：test 侧按诊断字段收料的那串字面量，
// 还在不在生产侧。本面补的就是这半边。
//
// 五态各自点名，一条都不许静默归进"没问题"（口径同规则 82/117）：
//   verbatim            生产侧逐字有这段 ⇒ 真接上了；
//   across-interpolation 逐字没有，但拆出的每个静态段都落在**同一个**生产文件里
//                       ⇒ 中间隔着 `${…}` 的运行时值（数字/名字/sha），不是漂了；
//   non-prose           收的是算出来的值/标点（计数、比值）⇒ 生产侧本来就不会有这句；
//   echo-caller-text    这段是测试自己喂进去的标签被抄回文案（验的是回显，不是文案）；
//   drift               连静态段都对不齐，且不是测试自备的 ⇒ 这才是"改了文案没改断言"的候选缺陷。
// drift 走存量豁免（`KNOWN_NON_DRIFT`）：逐条带理由，名单外新增即红，**登记了却不再命中的也算红**
// （stale-waiver，同 docs-check 的 LEGACY_WAIVERS 规矩）——豁免不许静默烂在这儿。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** 只收**诊断字段**（`reason`/`why`/`detail`/`note`）。
 *  第一版把 `text`/`message`/`error` 也收了，结果 15 条 drift 里 10 条收的是**被测内容**
 *  （`api_key`、`alpha2`、工具输出片段）——那类断言本来就该长这样，报它"生产侧没有"是我这把尺的噪声。
 *  `.not.toContain`（不要求存在）与 `toContain(SHIP.sha)`（变量，没字面量可对）都不收。
 *  **第 95 页加宽**：第一版把「`.字段` 紧跟闭括号」这一种写法直接编进正则（`x.reason).toContain`），
 *  于是同一族断言换个写法就静默绕过——`reasonOf(d)).toContain(…)`（本地 helper 把字段递出来，
 *  `tests/goal-stop-decision.test.ts` 里就是这一族）与 `x.reason ?? "").toContain(…)` 一概不认。
 *  那是规则 122 那一格：**机制判据挂在一种写法上＝换写法即绕过**。
 *  现在按「取料来源」收：matcher 调用点 → 回走配对括号取被断言的表达式 → 表达式里出现过诊断字段
 *  （或调用了本文件里返回诊断字段的 helper）就算。走不通的那一格必须被数出来（`unresolved`），
 *  因为「看不见」和「没有」在报告里必须是两个数。 */
const MATCH_CALL =
  /\)\s*\.\s*(not\.)?\s*(?:toContain|toMatch|includes)\s*\(\s*"((?:[^"\\]|\\.)*)"/g;

/** 诊断字段名（唯一一份事实源：字段访问、helper 返回体、`via` 判读都从这里拼）。 */
const DIAG_FIELDS = "reason|why|detail|note";
const FIELD_ACCESS = new RegExp("\\.\\s*(" + DIAG_FIELDS + ")\\b", "g");

/** 把注释**等长涂白**（非换行字符换成空格 ⇒ 偏移与行号一律不漂，取料清单还能一跳到位）。
 *  为什么必须有：上一版用正则扫"字面量"，而正则分不清注释——注释里的**一对引号**（中文行文里
 *  常见的 `'…'` / `"…"` / 反引号）会被当成一条生产字面量。第 95 页当场炸给自己看：
 *  我在这把尺的注释里写了「测试调用」，于是 `tests/net.test.ts:54` 那条**真 drift** 被洗成 verbatim，
 *  报告上写着 `drift 0`（假绿的方向正是这把尺存在的理由）。
 *  走 TS 词法拿精确区间，而不是再叠一条正则：规则 79 同一格——按行的判据会把注释里的示例当代码。 */
export interface Lexed {
  /** 注释等长涂白后的文本（偏移与行号与原文一致）。 */
  code: string;
  /** 词法树：字面量取料与注释区间都从这里来，一次解析两处共用。 */
  source: ts.SourceFile;
}

/** 一次词法，两处共用：注释区间（涂白）与字面量（取料）。
 *  等长涂白是关键——非换行字符换成空格，行号与偏移一律不漂，取料清单还能一跳到位。 */
export function lex(text: string): Lexed {
  const source = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, number>();
  const collect = (pos: number): void => {
    for (const r of ts.getLeadingCommentRanges(text, pos) ?? []) ranges.set(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(text, pos) ?? []) ranges.set(r.pos, r.end);
  };
  const walk = (node: ts.Node): void => {
    collect(node.pos);
    node.forEachChild(walk);
  };
  source.statements.forEach(walk);
  walk(source.endOfFileToken);
  let code = text;
  if (ranges.size > 0) {
    const chars = Array.from(text);
    for (const [pos, end] of ranges) {
      for (let i = pos; i < end && i < chars.length; i++) {
        if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
      }
    }
    code = chars.join("");
  }
  return { code, source };
}

/** 把注释**等长涂白**：上一版用正则扫"字面量"，而正则分不清注释——注释里的**一对引号**
 *  （中文行文里常见的 `'…'` / `"…"`）会被当成一条生产字面量。第 95 页当场炸给自己看：
 *  我在这把尺的注释里写了「测试调用」，于是 `tests/net.test.ts:54` 那条**真 drift** 被洗成
 *  verbatim/across，报告上写着"一切正常"（假绿的方向正是这把尺存在的理由）。
 *  走 TS 词法拿精确区间，而不是再叠一条正则：规则 79 同一格。 */
export function blankComments(text: string): string {
  return lex(text).code;
}

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
  /** 这一条是**怎么**从诊断字段取到料的：直取成员，还是经本文件的 helper 递出来。
   *  写成字段而不是只认一种写法：加宽之后要能回答「新收进来的是哪一族」，
   *  否则下一次再换写法（跨文件 helper）照样看不见，而报告上仍然是"82 条，一切正常"。 */
  via: "字段直取" | "本地 helper" | "字段别名";
  needle: string;
  /** 这串字面量在**本 test 文件里还另有一处**（＝测试自己把它喂给了被测函数）。
   *  它是第五态 `echo-caller-text` 的判据：文案里的这段是调用方给的标签被抄回来的，
   *  生产侧永远不该有这句，把它报成 drift 是这把尺的噪声（第 95 页实测 `tests/net.test.ts:54`）。 */
  suppliedInTest: boolean;
}

/** 从 matcher 前面那个闭括号往回走到配对的开括号，取括号**内**的被断言表达式。
 *  走不通（不配对 / 超出 2000 字符）返回 null：那是"这把尺看不见这条"，必须被数出来，
 *  不许和「这条断言不收」混成同一个数。 */
function operandInsideParens(text: string, closeIdx: number): string | null {
  let depth = 0;
  for (let i = closeIdx; i > closeIdx - 2000 && i >= 0; i--) {
    const c = text[i];
    if (c === ")") depth += 1;
    else if (c === "(") {
      depth -= 1;
      if (depth === 0) return text.slice(i + 1, closeIdx);
    }
  }
  return null;
}

/** 本文件里「把诊断字段递出来」的本地取料函数：`function reasonOf(d){ … return d.reason }`、
 *  `const noteOf = (d) => d.note`。只在本文件内解析（跨文件 helper 是另一族，今天全仓 0 例；
 *  有例再加，不替假想需求建数据流）。返回体里取**第一个**诊断字段访问。 */
export function localFieldHelpers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const firstField = (body: string): string | null => {
    FIELD_ACCESS.lastIndex = 0;
    const m = FIELD_ACCESS.exec(body);
    return m === null ? null : m[1]!;
  };
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([\s\S]{0,200}?\)\s*(?:[^{};]{0,160})?\{([\s\S]{0,800}?)\n\}/g)) {
    const field = firstField(m[2]!);
    if (field !== null) out.set(m[1]!, field);
  }
  for (const m of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]{0,120})?=\s*(?:\([^)]{0,160}\)|[A-Za-z_$][\w$]*)\s*=>\s*([^;]{0,200})/g)) {
    const field = firstField(m[2]!);
    if (field !== null) out.set(m[1]!, field);
  }
  // 单行写法（`function labelOf(d) { return d.note }`）：上面那条 `\n\}` 收尾的正则够不着它。
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]{0,160}\)\s*(?::[^{;]{0,80})?\{\s*return\s+([^;\}]{0,200})/g)) {
    const field = firstField(m[2]!);
    if (field !== null) out.set(m[1]!, field);
  }
  return out;
}

/** 把诊断字段**赋给局部变量**的那些声明：`const reason = stops[0]?.reason ?? ""`。
 *  第三族写法（实测 `tests/goal-continue.test.ts:317` 就是它）：断言读的是变量，
 *  既没有 `.reason)` 也不是 helper 调用 ⇒ 只认前两种的面照样看不见这条。
 *  与 helper 同一套规矩：初始化式里第一个诊断字段访问就是它读的字段。 */
export function localFieldAliases(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]{0,120})?=\s*([^;\n]{0,240})/g)) {
    const init = m[2]!;
    if (/=>/.test(init)) continue;
    FIELD_ACCESS.lastIndex = 0;
    const field = FIELD_ACCESS.exec(init);
    if (field !== null) out.set(m[1]!, field[1]!);
  }
  return out;
}

/** 从一个 test 文件里挑料；行号按换行数算（读数要一跳到位）。 */
export function collectNeedles(
  relPath: string,
  text: string,
): { needles: ProseNeedle[]; unresolved: number } {
  const code = blankComments(text);
  const helpers = localFieldHelpers(code);
  const aliases = localFieldAliases(code);
  const testChunks = extractLiterals(relPath, code);
  const needles: ProseNeedle[] = [];
  let unresolved = 0;
  for (const m of code.matchAll(MATCH_CALL)) {
    if (m[1] !== undefined) continue;
    const operand = operandInsideParens(code, m.index);
    if (operand === null) {
      unresolved += 1;
      continue;
    }
    let via: ProseNeedle["via"] | null = null;
    let field = "";
    FIELD_ACCESS.lastIndex = 0;
    const direct = FIELD_ACCESS.exec(operand);
    if (direct !== null) {
      via = "字段直取";
      field = direct[1]!;
    } else {
      for (const [name, f] of helpers) {
        if (new RegExp("\\b" + name + "\\s*\\(").test(operand)) {
          via = "本地 helper";
          field = f;
          break;
        }
      }
      if (via === null) {
        for (const [name, f] of aliases) {
          if (new RegExp("\\b" + name + "\\b").test(operand)) {
            via = "字段别名";
            field = f;
            break;
          }
        }
      }
    }
    if (via === null) continue;
    const needle = decodeJs(m[2]!);
    if (needle.trim() === "") continue;
    // matcher 自己那条字面量必然含这串一次；**再多一次**＝测试把它当输入喂给了被测函数。
    let occurrences = 0;
    for (const c of testChunks) occurrences += c.chunk.split(needle).length - 1;
    needles.push({
      file: relPath,
      line: code.slice(0, m.index).split("\n").length,
      field,
      via,
      needle,
      suppliedInTest: occurrences >= 2,
    });
  }
  return { needles, unresolved };
}

/** 把 needle 切成静态段：CJK 连续 2 字以上、ASCII/数字连续 3 字符以上；标点与空格当分隔。
 *  拆段是给 across 用的——插值打断的是段与段之间的连接，段本身不该被打断。 */
export function staticRuns(needle: string): string[] {
  return needle.match(/[一-鿿]{2,}|[A-Za-z0-9_./-]{3,}/g) ?? [];
}

/** 纯数字/标点 ⇒ 收的是**算出来的值**，生产侧不会有这句字面量，不许混进 drift。 */
const ONLY_VALUES = /^[\d.,%\s+−–:：=×/~-]+$/;

export type CoverKind = "verbatim" | "across-interpolation" | "non-prose" | "echo-caller-text" | "drift";

export interface NeedleVerdict extends ProseNeedle {
  kind: CoverKind;
  /** verbatim / across 给命中的生产文件；drift 给"第一个对不上的段"便于人一眼看到断在哪。 */
  detail: string;
  /** drift 时对不齐的那一段 ⇒ 存量豁免的键（整串含运行时值，改一个字就换键，登记不住）。 */
  lostRun: string;
  /** 这段落在几处**不同字面量**里（>1 ⇒ 顶包风险：改了其中一处，断言照样绿 ⇒ 单列出声）。
   *  登记表的影子副本不计在这里，计在 `rawCopies`。 */
  copies: number;
  /** 不做任何排除时的副本数——与 `copies` 的差＝被"登记表影子"解释掉的那几处，
   *  必须并列报出来：排除面不许只留下一个变小了的数（规则 101 的反向一侧）。 */
  rawCopies: number;
}

/** 取料只认**字符串/模板字面量**（走词法，不是正则扫引号），并且数它出现在几处字面量里。
 *  为什么不是"整文件文本里 grep"：本仓注释极密，中文短语在注释里重复是常态，
 *  而更坏的一类是**同模块另一句无关文案替被锚定的文案顶包**——
 *  造红实测：我把 `reason` 那句改了字，同文件里 `repRowLine` 的"（不足两次同配置重复）"
 *  把断言喂饱了 ⇒ 错报 0 drift。字面量级 + 副本计数让这一格从"静默"变成"出声的读数"
 *  （口径同规则 82/98：认不出≠没事，要单列）。
 *  曾用过"字段名须在 ±400 字符邻域"的邻居约束：它把跨层传话（events 抛的 Error 文案进 distill 的 `.why`）
 *  误判成 drift ⇒ 判的是"离得近"而不是"谁产出的"，撤。
 *  第 95 页改走词法：正则那版按引号对切，会被**正则字面量里的引号**带偏——
 *  `src/permissions/risk.ts` 的威胁表里有 `/echo\s+["']…/` 这类模式，带偏之后该文件里
 *  `` `${t.note}（静态威胁表：…）`` 这条真字面量**整段读不到**（实测 127 段只收到几条），
 *  于是断言被报成 across 并指认了别的文件。规则 79 同一格：静态判据要走词法，副本数才是真的。 */
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

/** 抽字面量的静态段：词法树上取 `StringLiteral` / 模板的 head·middle·tail，
 *  `${…}` 天然就是段与段的边界，所以不再需要按正则切；每段共享所在函数的 `fn`。 */
export function extractLiterals(path: string, text: string): LiteralChunk[] {
  const { code, source } = lex(text);
  const out: LiteralChunk[] = [];
  const K = ts.SyntaxKind;
  const push = (node: ts.Node, raw: string): void => {
    const chunk = decodeJs(raw);
    if (chunk.trim() !== "") out.push({ path, fn: enclosingFn(code, node.getStart(source)), chunk });
  };
  const walk = (node: ts.Node): void => {
    const t = node.getText(source);
    if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral || node.kind === K.TemplateTail) {
      push(node, t.slice(1, -1));
      return;
    }
    if (node.kind === K.TemplateHead || node.kind === K.TemplateMiddle) {
      push(node, t.slice(1, -2));
      return;
    }
    node.forEachChild(walk);
  };
  source.statements.forEach(walk);
  return out;
}

/** 「登记表影子」的内容谓词（**不写路径清单**，规则 122/191）：
 *  一个文件里成批出现 `expectFail:` 键 ⇒ 它是变异锚点登记表。登记表的 `apply` 字符串
 *  **按定义要逐字引用被锚那一行**，所以它对副本数的贡献是"另一把尺的影子"，不是第二个生产者。
 *  实测：`tests/goal-stop-decision.test.ts:112` 的第二份副本来自 `scripts/mutate-verify.mjs:4072`
 *  对同一行的引用 ⇒ 那一格从测试侧永远清不掉，而它本来就不是顶包。
 *  今天登记表 804 条 `expectFail:`，阈值取 50（数量级判据，不靠文件名）。 */
const ANCHOR_MARKER = "expectFail:";
const ANCHOR_TABLE_MIN = 50;

export function isAnchorTable(text: string): number {
  const hits = text.split(ANCHOR_MARKER).length - 1;
  return hits >= ANCHOR_TABLE_MIN ? hits : 0;
}

/** 这段文字落在几处**不同函数的不同字面量**里（>1 ⇒ "漂了也不响"的风险，单列出声）。
 *  `anchors` = 登记表文件的路径集：它们的副本**只在还有别处真生产者时**才不计
 *  （若唯一副本就在登记表里，那这条断言收的就是登记表自己的文案 ⇒ 照算，不许读成 0）。 */
export function copyCount(
  chunks: readonly LiteralChunk[],
  needle: string,
  anchors: ReadonlySet<string> = new Set(),
  realProducers: ReadonlySet<string> = new Set(),
): number {
  const all = new Set<string>();
  const strict = new Set<string>();
  for (const c of chunks) {
    if (!c.chunk.includes(needle)) continue;
    const key = c.path + "\u0000" + c.fn;
    all.add(key);
    // 登记表是"另一把尺"——除非这条断言所在的路径本来就指着它（`realProducers` 由调用方按 test 文件是否点名该表算出）。
    if (anchors.has(c.path) && !realProducers.has(c.path)) continue;
    strict.add(key);
  }
  return strict.size > 0 ? strict.size : all.size;
}

/** 逐条判四态。`sources` = 生产侧文件。 */
export function classifyNeedles(
  needles: readonly ProseNeedle[],
  sources: readonly { path: string; text: string }[],
  testTexts: ReadonlyMap<string, string> = new Map(),
): NeedleVerdict[] {
  const chunks = sources.flatMap((s) => extractLiterals(s.path, s.text));
  const byPath = new Map<string, string>();
  for (const c of chunks) byPath.set(c.path, (byPath.get(c.path) ?? "") + c.chunk);
  // 登记表（内容谓词认出来的，不是写死的文件名）与"这条断言是否本来就指着它"。
  const anchors = new Set(sources.filter((s) => isAnchorTable(s.text) > 0).map((s) => s.path));
  const reachedBy = (testFile: string): Set<string> => {
    const text = testTexts.get(testFile) ?? "";
    const out = new Set<string>();
    for (const a of anchors) {
      const base = a.slice(a.lastIndexOf("/") + 1);
      if (text.includes(base) || text.includes(a)) out.add(a);
    }
    return out;
  };
  return needles.map((n) => {
    const runs = staticRuns(n.needle);
    const zero = { detail: "", lostRun: "", copies: 0, rawCopies: 0 };
    if (runs.length === 0 || runs.every((r) => ONLY_VALUES.test(r))) {
      return { ...n, ...zero, kind: "non-prose", detail: "收的是算出来的值/标点，不比对生产文案" };
    }
    const reached = reachedBy(n.file);
    const count = (sought: string): { copies: number; rawCopies: number } => {
      const rawCopies = copyCount(chunks, sought);
      return { copies: copyCount(chunks, sought, anchors, reached), rawCopies };
    };
    const hit = chunks.find((c) => c.chunk.includes(n.needle));
    if (hit !== undefined) {
      return { ...n, kind: "verbatim", detail: hit.path, lostRun: "", ...count(n.needle) };
    }
    // across：同一文件里各静态段按顺序拼得出整串 ⇒ 中间隔的是 `${…}` 的运行时值。
    for (const [path, whole] of byPath) {
      if (runs.every((r) => whole.includes(r))) {
        return { ...n, kind: "across-interpolation", detail: path, lostRun: "", ...count(runs[0]!) };
      }
    }
    const seen = new Set(runs.filter((r) => chunks.some((c) => c.chunk.includes(r))));
    // 第五态：这段**测试自己就有一份**（当输入喂给了被测函数）且生产侧一段都对不上 ⇒
    // 它收的是「调用方的标签被抄回文案」，那句本来就不该躺在生产字面量里（实测 `tests/net.test.ts:54`
    // 的「测试调用」被上一版报成 drift）。单独点名而不是并进 verbatim：这条断言验的是**回显**、
    // 不是文案，混进"接上了"就是把没尺的格子读成已验收。
    if (n.suppliedInTest && seen.size === 0) {
      return {
        ...n,
        kind: "echo-caller-text",
        detail: "这段是测试自己喂进去的标签被抄回文案 ⇒ 生产侧本就不该有，不算漂",
        lostRun: "",
        copies: 0,
        rawCopies: 0,
      };
    }
    const lost = runs.find((r) => !seen.has(r)) ?? runs[0]!;
    return { ...n, kind: "drift", detail: `生产侧的字面量里没有这一段：「${lost}」`, lostRun: lost, copies: 0, rawCopies: 0 };
  });
}

/** 存量豁免（键＝`test 文件|对不齐的那段`）。
 *  **今天登记过两条，又在今天被自己判成 stale 删掉**：`tests/docs-check.test.ts` 的
 *  「30000」「no-such」两条在登记后不到一小时内不再命中（那个文件被别人在飞改动改到了 ⇒
 *  它们现在落在 verbatim/across 里）。机制照 `docs-check` 的 `LEGACY_WAIVERS`：
 *  名单外新增即红，**登记了却不再命中的也算红**——豁免不许静默烂在这儿。
 *  留这段是给下一个人：登记豁免前要确认命中的是**谁的在飞改动**，否则这条登记会跟着对方的树一起烂。
 *  已知风险：若那笔在飞改动回退，这两格会重新以 drift 出现（那时该由改动方自己处理，不是这里加回）。 */
export const KNOWN_NON_DRIFT: Readonly<Record<string, string>> = {};

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

/** 本面自己的 test 文件：它的**夹具**里就写着 `expect(m.reason).toContain("…")` 这类样本，
 *  收料面若把它当断言，就是在量自己写进去的字符串——实测多算 3 条顶包候选（41 → 44）。
 *  排除必须**列出来**（报告里的 `selfExcluded`），否则这就是一个静默盲区。 */
export const SELF_EXCLUDED_TESTS: readonly string[] = ["tests/prose-needle-scan.test.ts"];

/** 在飞文件（工作树 ≠ HEAD）：共享工作树里别人正在改的东西不许推动我的棘轮
 *  （实测两分钟之内 41 → 44，推手全是别人的落地/未落地改动）。 */
function inFlightPaths(root: string): Set<string> {
  const raw = execFileSync("git", ["status", "--porcelain", "-z"], { encoding: "utf8", cwd: root });
  const out = new Set<string>();
  for (const rec of raw.split("\0")) {
    if (rec.length < 4) continue;
    out.add(rec.slice(3).split(" -> ").pop()!);
  }
  return out;
}

/** 顶包候选的水位（**只准下调**，同 `docs-check` 的 `DOC_BUDGETS`）。
 *  登记的是**已提交态**那个数（在飞文件不计入 ⇒ 别人并发改动推不动我的棘轮）。
 *  历史：35（第 92 页登记）→ 31（第 93 页摘 4 格）→ 29（第 94 页把两种"不可测"拆成 `cause` 字段，摘 2 格）
 *  → **29（第 95 页：数字没动，底下换了一遍）**。这一轮三面同时修：
 *  ①收料面加宽——本地 helper（`reasonOf(d))`）与字段别名（`const reason = …`）两族写法以前整族看不见，
 *  收料断言 82 → 98 条；②生产侧"字面量"改走词法——正则扫引号会被**正则字面量里的引号**带偏
 *  （`src/permissions/risk.ts` 的威胁表 `/echo\s+["']…/` 实测让该文件 127 段字面量只收到几条）；
 *  ③注释等长涂白——我自己那条提到「测试调用」的注释，把一格真 drift 洗成了 verbatim。
 *  三处修完顶包候选一度 29 → 38（旧盲区现形 9 格）；同轮把 14 处针脚换成生产侧唯一的整句
 *  （goal 一族 11 ＋ 权限来源标记 1 ＋ 可行性聚合 2）⇒ 提交后的真数是 **30**，登记在这里。
 *  这次 29 → 30 是**受控上调**，理由只有一条：量尺加宽——那些断言本来就在，只是这把尺以前读不出；
 *  它们现形不是文案变坏。除此之外仍只准下调。
 *  30 里还有一格从测试侧改不掉：`tests/goal-stop-decision.test.ts:112` 的第二份副本是
 *  `scripts/mutate-verify.mjs:4072` 的**变异锚点对同一行的逐字引用**——那是另一把尺的影子，不是第二个生产者。
 *  降它要动的是副本计数本身（任务 #20 §七），不是测试。
 *  另记一笔自己的方法论错：**提交前读的 29 把"我自己的在飞改动"也排除了**，提交后两格落回判据桶 ⇒ 31。
 *  ⇒ 「在飞排除」对判卷者自己同样成立：**水位必须提交后复跑一次**才算数（规则 108 的形状，第二次兑现）。
 *  降它的方法见任务 #20：**每降一格就把这里一起下调**，否则棘轮只是张装饰性的表。
 *  → **27（第 96 页）**：副本计数不再把**变异锚点的逐字引用**当第二个生产者（内容谓词认表，不是写文件名），
 *  免计的 3 格逐条点名（`autonomy:190`「断路器」、`goal-stop-decision:112`「美元闸本次不生效」、
 *  `shell-bypass-composition:333`「setsid」）——前两格免计后各留一个真生产者（`autonomy.ts#evaluate`、
 *  `goal.ts#budgetLine`），**第三格不是**：`setsid` 剩下的那份在 `scripts/lib/shell-bypass-cases.ts:132`，
 *  是一行**用例清单**（喂给被测函数的输入），这一条真正的态是 `echo-caller-text`。
 *  ⇒ 27 比应有的低 1 格，这条错位写在 `outputs/anchor-shadow-copies-2026-09-26/` §五，不收掉不许当"已验收"。
 *  `net.test.ts:53`「停滞超时」只从 3 降到 2——它另有**两份**真生产者（`updater.ts#stallMessage`、`net.ts#arm`），
 *  照旧留在单上：这条排除不是把清单缩短的手段。 */
export const MULTI_COPY_CEILING = 27;

export interface ScanReport {
  needles: number;
  /** 三种取料写法各收到几条：这一族第 95 页以前只认第一种，其余整族静默绕过。
   *  留成分布读数而不是一个总数 ⇒ 哪天又漂回"只认直取"，这三格会露形，报告不会仍然写着"一切正常"。 */
  viaCounts: Record<ProseNeedle["via"], number>;
  /** matcher 调用点里括号回走走不通的条数＝**这把尺看不见那些断言**，与「没有那种断言」是两个数。 */
  unresolvedMatcher: number;
  testFiles: number;
  sourceFiles: number;
  missingOnDisk: string[];
  counts: Record<CoverKind, number>;
  drift: WailedRow[];
  /** 落在**他人在飞文件**里的 drift：单列点名，不并进红（判据不能拿别人没写完的行当我的账）。 */
  inFlightDrift: WailedRow[];
  across: WailedRow[];
  /** 收的是测试自己喂进去的标签被抄回文案（验的是回显，不是文案）——列出来供复核，不红。 */
  echo: WailedRow[];
  /** 收料那段落在 ≥2 处字面量里：这句漂了也不响，是**顶包候选**清单（不红，但必须列出来）。 */
  multiCopy: WailedRow[];
  stale: string[];
  /** 靠内容谓词认出的登记表（`expectFail:` 成批出现）：它们的逐字引用不计进 `copies`。
   *  空集＝谓词没认出任何表 ⇒ 排除面等于没生效，这条读数必须出现在报告里。 */
  anchorTables: { path: string; entries: number }[];
  /** 因"登记表影子"而从 ≥2 降到 ≤1 的格子，**逐条点名**（`rawCopies` 与 `copies` 两个数并排着看）：
   *  排除面只留下一个变小了的数＝把判据关掉还不说（规则 101 的反向一侧）。 */
  shadowCleared: WailedRow[];
  /** 被排除的本面自己的 test 文件（夹具自引用）。空＝排除没生效。 */
  selfExcluded: string[];
  /** 只算**已提交态**（剔掉在飞文件）的顶包候选数——棘轮判这个数，别人并发改动推不动它。 */
  committedMultiCopy: number;
  /** 在飞文件里出现的顶包候选数（单列，不并进水位，也不许悄悄算进棘轮）。 */
  inFlightMultiCopy: number;
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
  const allTests = trackedFiles(["tests"], [".test.ts"], root);
  const selfExcluded = allTests.filter((p) => SELF_EXCLUDED_TESTS.includes(p));
  const testFiles = load(allTests.filter((p) => !SELF_EXCLUDED_TESTS.includes(p)));
  const sources = load(trackedFiles(["src", "scripts"], [".ts", ".mts", ".mjs"], root));
  const collected = testFiles.map((f) => collectNeedles(f.path, f.text));
  const needles = collected.flatMap((c) => c.needles);
  const unresolvedMatcher = collected.reduce((a, c) => a + c.unresolved, 0);
  const viaCounts = {
    "字段直取": needles.filter((n) => n.via === "字段直取").length,
    "本地 helper": needles.filter((n) => n.via === "本地 helper").length,
    "字段别名": needles.filter((n) => n.via === "字段别名").length,
  } as Record<ProseNeedle["via"], number>;
  const { rows, stale } = applyWaivers(classifyNeedles(needles, sources, new Map(testFiles.map((f) => [f.path, f.text]))));
  const anchorTables = sources
    .map((s) => ({ path: s.path, entries: isAnchorTable(s.text) }))
    .filter((a) => a.entries > 0);
  // 被"登记表影子"解释掉的格子：必须并列报出来，排除面不许只留下一个变小了的数。
  const shadowCleared = rows.filter((r) => r.rawCopies > 1 && r.copies <= 1);
  const counts = {
    verbatim: 0,
    "across-interpolation": 0,
    "non-prose": 0,
    "echo-caller-text": 0,
    drift: 0,
  } as Record<CoverKind, number>;
  for (const r of rows) counts[r.kind] += 1;
  const fly = inFlightPaths(root);
  const allDrift = rows.filter((r) => r.kind === "drift" && !r.waived);
  const driftSplit = splitByInFlight(allDrift, fly);
  const copySplit = splitByInFlight(rows.filter((r) => r.copies > 1), fly);
  return {
    needles: needles.length,
    viaCounts,
    unresolvedMatcher,
    testFiles: testFiles.length,
    sourceFiles: sources.length,
    missingOnDisk,
    counts,
    drift: driftSplit.committed,
    inFlightDrift: driftSplit.flying,
    across: rows.filter((r) => r.kind === "across-interpolation"),
    echo: rows.filter((r) => r.kind === "echo-caller-text"),
    multiCopy: rows.filter((r) => r.copies > 1),
    stale,
    anchorTables,
    shadowCleared,
    selfExcluded,
    committedMultiCopy: copySplit.committed.length,
    inFlightMultiCopy: copySplit.flying.length,
  };
}

/** 按「文件在不在飞」把清单分成两半（第 93 页给水位立的规矩，这里给 drift 与顶包候选共用）：
 *  判卷只判**已提交态**——别人写到一半的文件里，"漂了"与"还没写完"在盘上长得一模一样，
 *  把它算进我的红＝牵连；但这一半必须**单列点名**，否则"在飞"会变成随手关掉判据的逃生口。 */
export function splitByInFlight<T extends { file: string }>(rows: readonly T[], inFlight: ReadonlySet<string>): { committed: T[]; flying: T[] } {
  const committed: T[] = [];
  const flying: T[] = [];
  for (const r of rows) (inFlight.has(r.file) ? flying : committed).push(r);
  return { committed, flying };
}

function main(): void {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const r = scanRepo(root);
  console.log(
    "prose-needle-scan：收料断言 " + String(r.needles) + " 条（扫 " + String(r.testFiles) +
      " 个 test 文件）｜生产侧 " + String(r.sourceFiles) + " 个文件",
  );
  console.log(
    "  取料写法：字段直取 " + String(r.viaCounts["字段直取"]) +
      " ＋ 本地 helper " + String(r.viaCounts["本地 helper"]) +
      " ＋ 字段别名 " + String(r.viaCounts["字段别名"]) +
      " ｜括号回走走不通（＝这些断言本面看不见，不是没有）" + String(r.unresolvedMatcher),
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
      " ｜ echo（测试自备标签回显）" + String(r.counts["echo-caller-text"]) +
      " ｜ drift（未登记）" + String(r.drift.length),
  );
  for (const v of r.drift) console.log("  ❌ drift " + v.file + ":" + String(v.line) + " ." + v.field + " ⇒ " + v.detail);
  for (const v of r.inFlightDrift) console.log("  ⚠️ drift(在飞，不计我的账) " + v.file + ":" + String(v.line) + " ." + v.field + " ⇒ " + v.detail);
  for (const v of r.echo) console.log("  · echo " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」");
  for (const k of r.stale) console.log("  ❌ stale-waiver " + k + " ⇒ 已不再命中：从 KNOWN_NON_DRIFT 删掉它");
  for (const v of r.across) {
    console.log("  ⚠️ across " + v.file + ":" + String(v.line) + " ." + v.field + " ⇒ " + v.detail + "（整串「" + v.needle + "」）");
  }
  console.log(
    "  顶包候选（收料那段在 ≥2 处字面量里 ⇒ 改一处不会响）：" + String(r.multiCopy.length) + " 条" +
      "（已提交态 " + String(r.committedMultiCopy) + " ＋ 在飞 " + String(r.inFlightMultiCopy) + "）",
  );
  // 列全，不切片：这条清单是分流用的工作表，`slice(0, 10)` 会把第 11 格以后藏起来，
  // 而"看不见"在这张表里会被下游读成"没了"（规则 70/116 同一格）。
  for (const v of r.multiCopy) {
    console.log("    ⚠️ " + String(v.copies) + " 处 · " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」");
  }
  console.log(
    "  登记表影子：认出 " + String(r.anchorTables.length) + " 张表（" +
      r.anchorTables.map((a) => a.path + " " + String(a.entries) + " 条").join("、") +
      "），因逐字引用而免计的格子 " + String(r.shadowCleared.length) + " 格",
  );
  for (const v of r.shadowCleared) {
    console.log("    · 免计 " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」原 " + String(v.rawCopies) + " 处 → " + String(v.copies) + " 处");
  }
  console.log("  自排除（本面自己的夹具）：" + (r.selfExcluded.length > 0 ? r.selfExcluded.join("、") : "空"));
  if (r.anchorTables.length === 0) {
    console.error("❌ 一张登记表都没认出 ⇒ 内容谓词失效（或表改了写法），排除面正在悄悄改变副本数却无人作证");
    process.exitCode = 1;
    return;
  }
  if (r.selfExcluded.length !== SELF_EXCLUDED_TESTS.length) {
    console.error("❌ 自排除清单没全命中 ⇒ 登记与取料面脱节（要么文件改名了，要么排除失效）");
    process.exitCode = 1;
    return;
  }
  if (r.committedMultiCopy > MULTI_COPY_CEILING) {
    console.error(
      "❌ 水位上涨：已提交态顶包候选 " + String(r.committedMultiCopy) + " > 登记的 " + String(MULTI_COPY_CEILING) +
        "（只准下调；降法见任务 #20。在飞文件不计入这一格，所以这不是并发噪声）",
    );
    process.exitCode = 1;
    return;
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
