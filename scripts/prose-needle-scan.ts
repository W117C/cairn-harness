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
  /** 这几处**是谁**（`path#fn`，生产者池里算的）。计数必须点得出名：
   *  「两处不同出口」＝针脚挑错了字，「同一句抄在 N 个生产者」＝代码的副本缺陷，修法相反。 */
  copySites: CopySite[];
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
  /** 它作值为哪个属性键（不是属性赋值＝`""`）。点名豁免要靠它分清
   *  一张表**产出的**字段与**给人读的散文**栏（见 `emittedChunks`）。 */
  key: string;
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
  const push = (node: ts.Node, raw: string, key: string): void => {
    const chunk = decodeJs(raw);
    if (chunk.trim() !== "") out.push({ path, fn: enclosingFn(code, node.getStart(source)), key, chunk });
  };
  const walk = (node: ts.Node, key: string): void => {
    const t = node.getText(source);
    if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral || node.kind === K.TemplateTail) {
      push(node, t.slice(1, -1), key);
      return;
    }
    if (node.kind === K.TemplateHead || node.kind === K.TemplateMiddle) {
      push(node, t.slice(1, -2), key);
      return;
    }
    // 属性赋值：只把键名带给 initializer；遍历形状与原来逐字相同（键名自己仍按"无键"收，不增不减口径）
    if (node.kind === K.PropertyAssignment) {
      const pa = node as ts.PropertyAssignment;
      const k = pa.name.getText(source).replace(/^["']|["']$/g, "");
      node.forEachChild((c) => walk(c, c === pa.initializer ? k : key));
      return;
    }
    node.forEachChild((c) => walk(c, key));
  };
  source.statements.forEach((s) => walk(s, ""));
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

/** 表里**给人读的散文栏**：它们不流进任何输出，所以不许替生产文案"作证"。
 *  实测（第 98 页）：`scripts/mutate-verify.mjs:5317` 的一条 `desc:` 抄了「不在 HEAD 里」
 *  ⇒ 一条本来只有一处生产者的针脚被垫成"2 处副本＝顶包"，而那句话永远到不了被断言的字段。 */
export const DOC_PROSE_KEYS: readonly string[] = ["desc"];

/** 一张表真正"产自"它的字面量——点名豁免只回灌这些（散文栏除外）。 */
export function emittedChunks(chunks: readonly LiteralChunk[]): LiteralChunk[] {
  return chunks.filter((c) => !DOC_PROSE_KEYS.includes(c.key));
}

/** 第二族影子：**用例表**——一批导出的字符串数组常量，且本文件不导出任何函数。
 *  它的字面量是**喂给被测函数的输入**（`"setsid git push --force"`），不是任何字段的出处。
 *  实测：`scripts/lib/shell-bypass-cases.ts` 14 条导出的数组常量、0 个导出函数 ⇒ 上一版把它认成生产者，
 *  于是用例「卡面说得出为什么不是 deny：首词不在已知包装器表里」被算成顶包候选（它其实该判 `echo-caller-text`）。
 *  与登记表同一套规矩：断言自己点名它 ⇒ 它对该条断言就是生产者；两者都不是 ⇒ 落进 drift（响）。 */
export function isInputRegistry(text: string): number {
  if (/^export (?:async )?function /m.test(text)) return 0;
  const lists = (text.match(/^export const [A-Za-z_$][\w$]*\s*:\s*(?:readonly\s+)?(?:string\[\]|Array<|[A-Za-z_$]+\[\])/gm) ?? []).length;
  return lists >= 5 ? lists : 0;
}

/** 这段文字落在几处**不同函数的不同字面量**里（>1 ⇒ "漂了也不响"的风险，单列出声）。
 *  传进来的 `chunks` 已经是**生产者池**（影子池的排除在 `classifyNeedles` 里做），所以这里不再兜底：
 *  池里数到 0 就是 0，而"命中"也不可能发生在池外。 */
export function copyCount(chunks: readonly LiteralChunk[], needle: string): number {
  const seen = new Set<string>();
  for (const c of chunks) if (c.chunk.includes(needle)) seen.add(c.path + "\u0000" + c.fn);
  return seen.size;
}

/** 这段落在**哪几处**（`path#fn`，按取料顺序；同一函数只算一次，与 `copyCount` 同口径）。
 *  第 101 页补这个：光秃秃一个"3 处"要人回仓里猜哪三处＝把顶包的账又交回人肉。
 *  而"是哪三处"恰好决定修法：两处不同出口 ⇒ 针脚挑错了字（换短句）；
 *  同一句抄在 N 个生产者里 ⇒ 那是代码的副本缺陷，改测试永远清不掉（本轮「方案门」三格就是这个）。
 *  与 `copyCount` 是**两份独立实现**（不是互相委托）：两者不一致就是口径漂了，
 *  所以有一条用例与一条真仓断言专门对这两把尺（规则 184：自检的两把尺不许同源）。 */
export interface CopySite {
  /** `path#fn`——这一处是谁。 */
  site: string;
  /** 该处**字面量本体**（折叠空白、截到 40 字）。带上它才分得开两种账：
   *  各处的 `text` 全相同＝同一句抄在 N 处（改代码，#24 那族）；
   *  `text` 不同＝只是共享一个词的两句话（改针脚，第 98/100 页那套）。
   *  第 101 页我只看 `path#fn` 就把 8 格误判成"脚本抄了产品文案"，实际 `compaction` 那两格是后者。 */
  text: string;
}

export function copySites(chunks: readonly LiteralChunk[], needle: string): CopySite[] {
  const seen = new Set<string>();
  const out: CopySite[] = [];
  for (const c of chunks) {
    if (!c.chunk.includes(needle)) continue;
    const site = c.path + "#" + c.fn;
    if (seen.has(site)) continue;
    seen.add(site);
    out.push({ site, text: c.chunk.replace(/\s+/g, " ").trim().slice(0, 40) });
  }
  return out;
}

/** 这一格的几处里，有没有**同一句**被抄了两遍（≥2 处的字面量相同）？
 *  是 ⇒ 代码的副本缺陷（收成一份，测试侧永远清不掉）；
 *  否 ⇒ 只是针脚收的那个词出现在几句**不同**的话里（换该出口独有的短句就能摘，第 98/100 页那套）。 */
export function sharesOneSentence(sites: readonly CopySite[]): boolean {
  const seen = new Set<string>();
  for (const s of sites) {
    if (seen.has(s.text)) return true;
    seen.add(s.text);
  }
  return false;
}

/** 这一格收的是**一个名字**（工具名 / skill 调用名 / 路径片段）还是一句人话？
 *  第 105 页实测：`tests/skill-tool-policy.test.ts:192` 收「grep」，尺算出 35 处副本，
 *  其中 24 处是 import 路径（`./grep.js`、`../tools/ripgrep.js`）与裸标识符，另 11 处是别的话里的工具清单
 *  （「可用工具：read_file / grep / …」）——**没有一条流进被断言的那个 `.note`**。
 *  ⇒ 名字在仓里重复是数据的形状，不是"改一处不会响"的顶包；按第 98/100 页那套再挑一个词也治不了它，
 *  因为下一个名字照样裸。真正的修法只有一种：**把名字放进散文上下文里断言**
 *  （`expect(note).toContain(droppedName + "（由 " + by + "）")`，变量实参 ⇒ 尺不收它）。
 *  所以这一族不进"换针脚"的账，而是当场红——留成软列表＝把 35 处噪声永久挂在单子上。 */
export function isBareNameNeedle(needle: string): boolean {
  const t = needle.trim();
  return t.length > 0 && t.length <= 12 && !/\s/.test(t) && !/[^\x00-\x7F]/.test(t);
}

export interface ShadowFile {
  path: string;
  kind: "登记表" | "用例表";
  /** 命中该谓词的条数（`expectFail:` / 用例常量），读数用。 */
  entries: number;
}

/** 影子池 = 登记表 ∪ 用例表（都用内容谓词认，不写文件名清单）。 */
export function shadowFilesOf(sources: readonly { path: string; text: string }[]): ShadowFile[] {
  const out: ShadowFile[] = [];
  for (const s of sources) {
    const a = isAnchorTable(s.text);
    if (a > 0) {
      out.push({ path: s.path, kind: "登记表", entries: a });
      continue;
    }
    const r = isInputRegistry(s.text);
    if (r > 0) out.push({ path: s.path, kind: "用例表", entries: r });
  }
  return out;
}

/** 逐条判五态。`sources` = 生产侧文件；`testTexts` = test 文件原文（认"这条断言点名了哪张表"）。
 *  **影子池**：登记表（逐字引用被锚行）与用例表（喂给被测函数的输入）都不是字段出处 ⇒
 *  命中、across、`seen` 与副本数一律只在**生产者池**里算；test 自己点名某张表时，该表对该条断言就是生产者。
 *  池外只剩影子时不许读成 verbatim：它要么落进 echo（测试自备），要么落进 drift（响）——两个都是出声的方向。 */
export function classifyNeedles(
  needles: readonly ProseNeedle[],
  sources: readonly { path: string; text: string }[],
  testTexts: ReadonlyMap<string, string> = new Map(),
): NeedleVerdict[] {
  const chunks = sources.flatMap((s) => extractLiterals(s.path, s.text));
  const kinds = shadowFilesOf(sources);
  const shadowPaths = new Set(kinds.map((s) => s.path));
  // 点名只对**登记表**有效：test 断言的是那张表产出的文案（判卷面自己的 `.why`）⇒ 对它而言那张表就是生产者。
  // **用例表**永远不算：它的字面量是被 import 进来当输入的样本，被断言的那句是判据**插值**出来的，
  // 不是清单里的字符串——把"引用了这张表"当成"表是生产者"会把输入错认成出处（实测 `setsid` 那格）。
  const anchorPaths = new Set(kinds.filter((s) => s.kind === "登记表").map((s) => s.path));
  const chunksOf = new Map<string, LiteralChunk[]>();
  for (const c of chunks) chunksOf.set(c.path, [...(chunksOf.get(c.path) ?? []), c]);
  const producerChunks = chunks.filter((c) => !shadowPaths.has(c.path));
  const producerByPath = new Map<string, string>();
  for (const c of producerChunks) producerByPath.set(c.path, (producerByPath.get(c.path) ?? "") + c.chunk);
  // 点名豁免只回灌表**产出的**字面量（`desc:` 那类给人读的散文栏不算，见 `emittedChunks`）
  const emittedByPath = new Map<string, LiteralChunk[]>();
  for (const p of anchorPaths) emittedByPath.set(p, emittedChunks(chunksOf.get(p) ?? []));
  const reachedBy = (testFile: string): Set<string> => {
    const text = testTexts.get(testFile) ?? "";
    const out = new Set<string>();
    for (const path of anchorPaths) {
      const base = path.slice(path.lastIndexOf("/") + 1);
      if (text.includes(base) || text.includes(path)) out.add(path);
    }
    return out;
  };
  return needles.map((n) => {
    const runs = staticRuns(n.needle);
    const zero = { detail: "", lostRun: "", copies: 0, rawCopies: 0, copySites: [] as CopySite[] };
    if (runs.length === 0 || runs.every((r) => ONLY_VALUES.test(r))) {
      return { ...n, ...zero, kind: "non-prose", detail: "收的是算出来的值/标点，不比对生产文案" };
    }
    const reached = reachedBy(n.file);
    // 点名豁免回灌的只是那张表**产出的**字面量：`desc:` 那类给人读的散文栏不在此列（见 `emittedChunks`）
    const emitted = (p: string): LiteralChunk[] => emittedByPath.get(p) ?? [];
    const pool = reached.size === 0
      ? producerChunks
      : producerChunks.concat(...[...reached].map(emitted));
    const byPath = reached.size === 0
      ? producerByPath
      : new Map([...producerByPath, ...[...reached].map((p): [string, string] => [p, emitted(p).map((c) => c.chunk).join("")])]);
    const count = (sought: string): { copies: number; rawCopies: number; copySites: CopySite[] } => ({
      copies: copyCount(pool, sought),
      rawCopies: copyCount(chunks, sought),
      copySites: copySites(pool, sought),
    });
    const hit = pool.find((c) => c.chunk.includes(n.needle));
    if (hit !== undefined) {
      return { ...n, kind: "verbatim", detail: hit.path, lostRun: "", ...count(n.needle) };
    }
    // across：同一文件里各静态段按顺序拼得出整串 ⇒ 中间隔的是 `${…}` 的运行时值。
    for (const [path, whole] of byPath) {
      if (runs.every((r) => whole.includes(r))) {
        return { ...n, kind: "across-interpolation", detail: path, lostRun: "", ...count(runs[0]!) };
      }
    }
    const seen = new Set(runs.filter((r) => pool.some((c) => c.chunk.includes(r))));
    // 第五态：这段**测试自己就有一份**（当输入喂给了被测函数）且生产侧**一段**都对不上 ⇒
    // 它验的是「调用方给的标签被抄回文案」，那句本来就不该躺在生产字面量里
    // （实测 `tests/net.test.ts:54` 的「测试调用」、`tests/shell-bypass-composition.test.ts:333` 的「setsid」）。
    // 门槛留着（`seen.size === 0`）是有原因的：只要有一个静态段在生产侧找得到，这条就可能是
    // **"半真半输入"的文案钉**，漂了必须响——放宽成"测试自备即回显"会把那一半保护撤掉。
    if (n.suppliedInTest && seen.size === 0) {
      return {
        ...n,
        kind: "echo-caller-text",
        detail: "这段是测试自己喂进去的标签被抄回文案 ⇒ 生产侧本就不该有，不算漂",
        lostRun: "",
        copies: 0,
        rawCopies: copyCount(chunks, n.needle),
        copySites: [],
      };
    }
    const lost = runs.find((r) => !seen.has(r)) ?? runs[0]!;
    return { ...n, ...zero, kind: "drift", detail: `生产侧的字面量里没有这一段：「${lost}」`, lostRun: lost };
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
 *  照旧留在单上：这条排除不是把清单缩短的手段。
 *  → **22（第 98 页）**：`tests/mutate-verify-gates.test.ts` 一次摘 5 格——三条「未跟踪」（6 处）换成生产侧唯一的
 *  「无回滚兜底」，「判卷」（34 处）换成「该条不可判」＋「不得伪装成变异表退化」，两条夹具路径
 *  （`src/a.ts`、`tests/a.test.ts`）改成**派生值**（那是喂进去的输入被抄回理由，第 97 页的 echo 形状）。
 *  造红：把 `mutate-gates.ts` 那句改成「未跟踪，拒绝变异」⇒ 新针脚 3 条红，而旧针脚 `toContain("未跟踪")`
 *  在同一次突变下**仍为真** ⇒ 这一格换的不是措辞，是分辨力。
 *  途中量到一条**排除面的过宽**：「不在 HEAD 里」看着独有，实为 2 处——第二处在变异表某条 `desc:` 的散文里，
 *  而 `desc` 是给人读的，永远流不到被断言的那句。⇒ 「测试点名该表 ⇒ 该表算生产者」这条豁免按**文件名**认，
 *  分不清"表产出的字段"（`expectFail:`、报告行）与"表里谈论文的散文"（`desc:`）。已立任务待收窄，先绕开不掩饰。
 *  → **18（第 100 页）**：再摘 4 格，全用同一套办法（针脚换成该出口独有的短句）——
 *  「未启用」4→1 处（`prune-batching.ts#未启用分批`，另两处是 lsp 的报错与 tools-check 的说明）、
 *  「无分辨力」9 处（`prefix-churn.ts` 那句「整轮没变」）、「等值」3 处（`reproducibility.ts` 那句「两次跑逐字段等值」）。
 *  造红同第 98 页那套：三个生产者各改一句（保留旧针脚、去掉新针脚，跑完即删）⇒ 4 条红，
 *  而旧针脚在三个文件里仍分别命中 1/4/1 处 ⇒ 换的是分辨力。
 *  下一批要动的是生产者不是测试：「方案门」那句 `先批后写（当前没有已批准的方案）` 在
 *  `permissions/index.ts`、`permissions/autonomy.ts`、`main/agent-runner.ts` **三处各抄一份**（同族副本缺陷），
 *  所以任何取自那行的针脚都永远 ≥3 处——修法是把拒因收成 `plan-state.ts` 的一份常量；
 *  本轮不动它：`agent-runner.ts` 与变异表都在别人手里飞，改那三行会连带把别人的锚点针脚弄失效。
 *  → **11（第 103 页）**：第 102 页的分族字段一生效，"同词不同句"那一族就变成机械步骤——本轮一次摘 7 格：
 *  「停滞超时」→「ms 内无任何数据（对端挂起或网络黑洞）」、「task 必填」→「].task 必填（worker 上下文唯一来源）」、
 *  「只读注解白名单」→「§11.7.2 只读注解白名单」、「无注解」→「亦逐次（§11.7.2 fail-closed）」、
 *  「已被压缩打断」→「已被压缩打断 ⇒ 顺手剪」、「死跑成本」→「整笔主面开销就是」、「模型面预算」→「字符已满（本轮超出」。
 *  造红：五个生产者各改一句（跑完即删、`git status` 已确认复原）⇒ `5 failed | 79 passed`，
 *  而**旧针脚在那五个文件里仍分别命中 1/1/5/2/2/2 处、新针脚全部归 0** ⇒ 换的是分辨力不是措辞。
 *  `src/agent/sequencer.ts` 在别人手里飞 ⇒ m3c 那格只换了针脚、没做生产者突变（不记成已验收）。
 *  修正一处旧账：上面说「方案门」三处——`copySites` 实测是**四处**（多一份在 `scripts/gate-check.ts#makeDriver`）。
 *  剩 11 格：6 格是"同句抄写"（`方案门`×3 等 #24；`rev`/`STATE.md` 在他人手里；`grep` 那格是标识符重复、仍属换针脚），
 *  5 格等热文件（`skill-tool-policy` 两格的producer 在飞、`replay-*` 两格、`shell-bypass` 一格）。
 *  → **5（第 104 页）**：上面那句"5 格等热文件"是**未证的归因**——按第 102 页的句面字段回读，
 *  那五格里只有 `skill-tool-policy` 两格的 producer 真在飞，其余三格（`replay-corpus-inventory`、
 *  `replay-prune-promise` ×2、`shell-bypass-composition` ×2 格）生产者全干净 ⇒ 本轮一次摘 6 格：
 *  「参数一字不变=0」→「无卡死证据」＋「「参数一字不变」>0」（数那格改成派生断言）、
 *  「不能读成」→「不能读成「没问题」」、「无从判定」→「无从判定：照做过但没有一次配到回执」、
 *  「合并唯一出口」→「worker 无合并/提交/分支权」、「匹配按完整 token 为界」→「——匹配按完整 token 为界」、
 *  「首词」→「不在已知包装器表里」。顺带补了那条**反向**用例（裸工具名条目不许说"按 token 为界"）。
 *  造红：四支生产者改六句（去掉新针脚、**留着旧针脚**，跑完即删，`git status` 已确认复原）⇒ 换掉的 6 格全红，
 *  而旧针脚在那六条 Received 里逐字命中（`参数一字不变=0` / `不能读成` / `无从判定` / `合并唯一出口` /
 *  `匹配按完整 token 为界` / `首词` 全在），同批跑的 `tests/autonomy.test.ts` 17 条仍全绿 ⇒ 换的是分辨力不是措辞。
 *  → **3（第 105 页）**：`skill-tool-policy` 那两格既不是"等热文件"也不是"换一句"能修的——针脚收的是**一个名字**
 *  （`grep`、`/pol:sec`），35 处"副本"里 24 处是 import 路径（`./grep.js`；`../routing/policy` 含 `/pol`）
 *  与别处的工具清单，**一条都流不进被断言的 `.note`** ⇒ 测量产物，改尺（规则 197）。
 *  尺侧：这一族单列成 `bareName` 并**当场红**（软列表会让 35 处噪声永久挂在单上）；谓词两侧各有用例，
 *  长度上限也钉了分歧格（哪天放宽到装得下一句人话＝这一族永远不红）。测试侧：散文那句「从可见工具表摘除」由尺收，
 *  「摘了哪把 · 被谁摘」的成对形状由变量拼 ⇒ 尺不收它。顺带清掉生产侧真抄了一遍的那份：
 *  `scripts/prefix-churn-check.ts` 的驱动器自己造 note，而 PC3 只读 `.length` ⇒ 改成驱动器自己的标记
 *  （同族旧账"读数脚本抄产品文案"）。跑过那道门：与 HEAD 同样只剩 PC7 那条**先于本轮**的待裁红，`--self-test` 臂 0 退出。
 *  现在剩的 3 格全是「方案门」＝生产侧同句抄，等 #24。 */
export const MULTI_COPY_CEILING = 3;

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
  /** 靠内容谓词认出的影子池（登记表＝逐字引用被锚行；用例表＝喂给被测函数的输入）。
   *  空集＝谓词没认出任何表 ⇒ 排除面等于没生效，这条读数必须出现在报告里。 */
  anchorTables: ShadowFile[];
  /** 因"登记表影子"而从 ≥2 降到 ≤1 的格子，**逐条点名**（`rawCopies` 与 `copies` 两个数并排着看）：
   *  排除面只留下一个变小了的数＝把判据关掉还不说（规则 101 的反向一侧）。 */
  shadowCleared: WailedRow[];
  /** 点名豁免挡在门外的**登记表散文栏**（`desc:`）字面量条数。0 ＝ 这条收窄今天空转。 */
  proseHeldBack: number;
  /** 被排除的本面自己的 test 文件（夹具自引用）。空＝排除没生效。 */
  selfExcluded: string[];
  /** 只算**已提交态**（剔掉在飞文件）的顶包候选数——棘轮判这个数，别人并发改动推不动它。 */
  committedMultiCopy: number;
  /** 在飞文件里出现的顶包候选数（单列，不并进水位，也不许悄悄算进棘轮）。 */
  inFlightMultiCopy: number;
  /** 顶包名单按**句子**分两族的格数：同一句抄在 ≥2 处（修法在代码：收成一份）vs 只是共享一个词的两句话
   *  （修法在测试：换该出口独有的短句）。第 101 页我把两族混记成一族，所以这个分法必须是**字段**，
   *  不能留给读报告的人自己判断。 */
  maskedSameSentence: number;
  maskedSharedWord: number;
  /** 顶包名单里针脚是个**裸名字**的那几格（第 105 页）：单列出来，而且**红**。
   *  它们既不是副本缺陷（35 处里 24 处是 import 路径），也换不出更好的句子（名字本身就是要断言的数据），
   *  唯一的修法是把名字放进散文上下文里派生断言 ⇒ 软列表会让这一族永远躺在单上。
   *  在飞文件里的那些走 `inFlightBareName`，不记我的账（同 drift 的分法）。 */
  bareName: WailedRow[];
  inFlightBareName: WailedRow[];
  /** 上面那 N 格**是哪几格**（第 101 页立的规矩同样适用于"在飞"这一半：只给个数＝逃生口）。 */
  flyingMultiCopy: WailedRow[];
  /** 此刻工作树≠HEAD 的文件；水位分两半靠它，也用来对账"在飞那些格真的都落在这些文件里"。 */
  inFlightFiles: string[];
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
  const anchorTables = shadowFilesOf(sources);
  // 点名豁免**挡在门外**的那些：登记表里给人读的散文栏（`desc:`）。读数为 0 ＝ 这条豁免今天空转。
  const anchorSet = new Set(anchorTables.filter((t) => t.kind === "登记表").map((t) => t.path));
  const proseHeldBack = sources
    .filter((s) => anchorSet.has(s.path))
    .reduce((a, s) => a + extractLiterals(s.path, s.text).filter((c) => DOC_PROSE_KEYS.includes(c.key)).length, 0);
  // 被"登记表影子"解释掉的格子：必须并列报出来，排除面不许只留下一个变小了的数。
  const shadowCleared = rows.filter((r) => r.rawCopies > 1 && r.copies < r.rawCopies);
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
  const copySplit = splitByInFlight(rows.filter((x) => x.copies > 1), fly);
  // 同一句抄两处（修代码）vs 只是共享一个词（修测试）——这个分法本身也是判据，必须是字段而不是感想。
  const maskedSameSentence = rows.filter((x) => x.copies > 1 && sharesOneSentence(x.copySites)).length;
  // 第三族：针脚是个裸名字（第 105 页）。它是 `multiCopy` 的**子集**，不另开一条清单外的路（下面有用例钉住这个包含关系）。
  const bareSplit = splitByInFlight(rows.filter((x) => x.copies > 1 && isBareNameNeedle(x.needle)), fly);
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
    proseHeldBack,
    selfExcluded,
    committedMultiCopy: copySplit.committed.length,
    inFlightMultiCopy: copySplit.flying.length,
    flyingMultiCopy: copySplit.flying,
    inFlightFiles: [...fly],
    maskedSameSentence,
    maskedSharedWord: rows.filter((x) => x.copies > 1).length - maskedSameSentence,
    bareName: bareSplit.committed,
    inFlightBareName: bareSplit.flying,
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
      "（已提交态 " + String(r.committedMultiCopy) + " ＋ 在飞 " + String(r.inFlightMultiCopy) + "）" +
      "｜同一句抄 ≥2 处（改代码）" + String(r.maskedSameSentence) + " 条" +
      "｜只是共享一个词（改针脚）" + String(r.maskedSharedWord) + " 条" +
      "｜针脚是个裸名字（改成派生断言，红）" + String(r.bareName.length) + " 条",
  );
  // 列全，不切片：这条清单是分流用的工作表，`slice(0, 10)` 会把第 11 格以后藏起来，
  // 而"看不见"在这张表里会被下游读成"没了"（规则 70/116 同一格）。
  for (const v of r.multiCopy) {
    // 副本"是谁 + 那一处写的是什么"一起印：光一个数要人回仓里猜，而**句子**才分得开
    // "同一句抄在 N 处"（改代码）与"共享一个词的两句话"（改针脚）——第 101 页我就是只看了路径才误判的。
    const flying = r.inFlightFiles.includes(v.file) ? "（在飞，不属我的账）" : "";
    console.log("    ⚠️ " + String(v.copies) + " 处 · " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」" + flying +
      (sharesOneSentence(v.copySites) ? " ⚑同一句抄了两遍" : "") +
      (isBareNameNeedle(v.needle) ? " ⚑裸名字（副本里那些 import 路径/标识符喂不进被断言的字段）" : "") +
      "＝" + v.copySites.map((s) => s.site + " ▸ " + s.text).join(" ｜ "));
  }
  console.log(
    "  影子池：认出 " + String(r.anchorTables.length) + " 张（" +
      r.anchorTables.map((a) => a.kind + " " + a.path + " " + String(a.entries) + " 条").join("、") +
      "），因引用/输入而免计的格子 " + String(r.shadowCleared.length) + " 格",
  );
  for (const v of r.shadowCleared) {
    console.log("    · 免计 " + v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」原 " + String(v.rawCopies) + " 处 → " + String(v.copies) + " 处");
  }
  console.log("  点名豁免挡下的散文栏：" + String(r.proseHeldBack) +
    " 条字面量（登记表 `desc:` 那类给人读的说明——它不流进任何输出，所以不许替生产文案作证）");
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
  // 数与名必须同源：有一格交不出名字（或名字数≠副本数）＝这把尺在报一个它自己都对不上的数。
  const nameless = r.multiCopy.filter((v) => v.copySites.length !== v.copies);
  if (nameless.length > 0) {
    console.error(
      "❌ 顶包名单上有格子的点名数与副本数不一致 ⇒ 读数不可信：" +
        nameless.map((v) => v.file + ":" + String(v.line) + "「" + v.needle + "」" + String(v.copies) + "≠" + String(v.copySites.length)).join("、"),
    );
    process.exitCode = 1;
    return;
  }
  // 裸名字针脚（第 105 页）：这一族的"副本"是 import 路径与别处的工具清单，一条都喂不进被断言的那个字段，
  // 所以它既不是副本缺陷（改代码没用）也换不出更好的词（下一个名字照样裸）——唯一的修法是把名字放进散文上下文里派生断言。
  // 之所以做成**红**而不是列表：水位管的是"改一处不会响"，管不到"这一格按现在的收法根本修不了"；
  // 留成软列表就等于让 35 处噪声永久挂在单上。在飞文件不参与（走 `inFlightBareName`，同 drift 那套分法）。
  if (r.bareName.length > 0) {
    console.error(
      "❌ 针脚是个裸名字的顶包格 " + String(r.bareName.length) + " 条 ⇒ 把名字放进散文上下文里断言（变量拼 ⇒ 尺不收它）：" +
        r.bareName.map((v) => v.file + ":" + String(v.line) + " ." + v.field + "「" + v.needle + "」").join("、"),
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.drift.length === 0 && r.stale.length === 0 ? 0 : 1;
}

// 只在直接执行时读数：判卷要 import 纯函数，模块加载不得有副作用（也不该扫盘）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
