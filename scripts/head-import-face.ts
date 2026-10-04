/** HEAD 的 import 面自洽检查：**只问 HEAD，不问盘**，也不需要第二棵认证树。
 *
 * 立尺的实测（2026-09-27，第 131 页）：`cb70297`「产品面：把 core-only 的内核接成一条真能用的 cairn 命令」
 * 把**消费者**提交了、把它新建的模块留下了未跟踪状态 ⇒ HEAD 里 5 个相对模块悬空
 * （`src/main/{provider-runtime,run-request,run-attachments}.ts`、`src/providers/capabilities.ts`
 * ＋ `glm-session` 少一个 `SessionTransport` 导出），干净树 `head-cert` 跑出
 * **typecheck 8 条错、vitest 34 个判卷文件红**，而**主树同一时刻 236 files / 2701 tests 全绿**。
 * ⇒ 这是「HEAD 红着而主树绿」那一族最贵的一次：主树的判卷永远看不见它，
 * 而唯一能看见的手段（认证树整跑）要 69 秒。
 *
 * 本尺把这 69 秒压成秒级，且**不需要工作树**：
 * 取料 = `git ls-tree -r <rev>` ＋ 一次 `git cat-file --batch` 读提交对象 ⇒ 别人在盘上的未提交改动
 * 不可能把这条红盖掉（那正是上面那次事故的成因）。
 *
 * 两半判据：
 *  ① 模块存在性（`findDanglingImports`）——specifier 解析后在不在 HEAD；
 *  ② 符号存在性（`findMissingExports`）——命名导入的名字在不在目标那份文件的导出面里。
 * 只做 ① 解释不了第 131 页剩下的那条根因（`SessionTransport`：文件在、导出没入库）。
 *
 * 三态（规则 92/119）：悬空模块**盘上有** ＝「漏 `git add`」；盘上也没有 ＝「表写错路径或模块被删而引用没跟着改」。
 * 两者后果不同（前者补一笔就好，后者要找删它的提交），所以分开印、分开豁免。
 *
 * 取料为什么是**整条语句**而不是逐行 grep（第 135 页实测）：
 *  - 逐行 ⇒ 跨行的 `import {\n a,\n b\n} from "./x"` 看不见 ⇒ **真缺陷静默漏报**（就是 `SessionTransport` 那条）；
 *  - 逐行且不要求语句边界 ⇒ 判卷里的假源码字符串被当成真边（47 条假红那一族）。
 * 两者都是尺错，不是代码错，所以两头一起修：从提交对象正文里按语句边界抽，`from` 之前允许换行。 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const FACES = ["src", "scripts", "tests"] as const;
const FACE_RE = /^(src|scripts|tests)\/.*\.(ts|tsx|mts)$/;

const git = (args: readonly string[], input?: string): string | null => {
  try {
    return execFileSync("git", [...args], {
      cwd: ROOT, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

/** TS 里 `./x` 常不带后缀；`/index.ts` 也算一种落点。 */
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"] as const;

/** 而 `./x.js` 这种 ESM 写法指向的其实是 `x.ts`。
 *  第一版只做"加后缀"不做"换后缀" ⇒ `src/tools/index.ts` 那批 `.js` 写法全被判成悬空（47 条假红里的一大族）。 */
const SUFFIX_SWAP: readonly [string, readonly string[]][] = [
  [".js", [".ts", ".tsx", ".mts"]],
  [".mjs", [".mts", ".ts"]],
];

/** specifier → 仓内相对路径。非相对（裸包名）返回 null：本尺只管仓内边。 */
export function resolveRelativeSpec(fromFile: string, spec: string, headFiles: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const rel = relative(".", join(dirname(fromFile), spec)).split(/[\\/]+/).join("/");
  for (const e of EXT_CANDIDATES) if (headFiles.has(rel + e)) return rel + e;
  for (const [from, to] of SUFFIX_SWAP) {
    if (!rel.endsWith(from)) continue;
    const stem = rel.slice(0, -from.length);
    for (const e of to) if (headFiles.has(stem + e)) return stem + e;
  }
  return rel + ".ts"; // 都没命中：给出最可能的形状，交给"盘上有没有"分诊
}

// ---- 语句级抽取（两半判据共用的取料层） ------------------------------------

export interface ImportClause {
  /** `{ … }` 里点名的导入/再导出名（`a as b` 取 **源侧** 的 `a`）。 */
  names: string[];
  /** `* as ns` ⇒ 不点名 ⇒ 符号那一半对它不发言。 */
  namespace: boolean;
  /** 这一条 clause 我读不全 ⇒ 不许拿它判红（宁少报，不假红）。 */
  opaque: boolean;
}

const ID = /^[A-Za-z_$][\w$]*$/;

/** `{ … }` 里的名字列表，导入侧与导出侧**共用这一份**（第十三族：同一谓词抄两份，两份宽度迟早不同）。
 *  `side` 决定 `a as b` 取哪一侧：导入要的是**源侧** `a`，导出报出去的是 `b`。
 *  内联 `type` 修饰（`{ a, type B }`）两边一起认——它只说「这一项是类型」，名字照样要在对面真的存在。 */
function specifiers(body: string, side: "import" | "export"): { names: string[]; namespace: boolean; opaque: boolean } {
  const names: string[] = [];
  let namespace = false;
  let opaque = false;
  for (const part of body.split(",")) {
    const raw = part.trim().replace(/^type\s+/, "");
    if (raw === "") continue;
    if (/^\*\s+as\b/.test(raw)) { namespace = true; continue; }
    const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(raw);
    if (as !== null) { names.push(side === "import" ? as[1]! : as[2]!); continue; }
    if (ID.test(raw)) { names.push(raw); continue; }
    opaque = true; // 看不懂的形状 ⇒ 整条不点名（默认「不报」而不是「猜一个」）
  }
  return { names: opaque ? [] : names, namespace, opaque };
}

/** 拆一条 import/export 的 clause。`import type` 的整条与 `{}` 内的 `type X` 修饰都要认：
 *  类型名同样必须真的在目标导出面里（`SessionTransport` 就是个类型）。 */
export function clauseNames(clause: string): ImportClause {
  const t = clause.trim().replace(/^type\s+/, "");
  const open = t.indexOf("{");
  if (open === -1) {
    // 只剩头部：默认导入 / `* as ns` / 裸 `import "x"`。默认导入不判（见 findMissingExports 的少报口径）。
    return { names: [], namespace: /^\*\s+as\b/.test(t), opaque: false };
  }
  const body = specifiers(t.slice(open + 1, t.lastIndexOf("}")), "import");
  const head = t.slice(0, open).trim();
  const mixed = head !== "" && !/^\*\s+as\b/.test(head); // `Foo, { bar }`：整条不判，别只判一半
  return { names: mixed ? [] : body.names, namespace: body.namespace, opaque: body.opaque || mixed };
}

export interface ImportStatement {
  spec: string;
  /** `export { … } from "./y"`：这条既是边、也要求 `y` 真的导出那些名字。 */
  reexport: boolean;
  clause: ImportClause;
}

/** 语句边界 = 行首（或 `;`）之后紧跟 `import`/`export`，且这条语句以 `from "…"` 收口。
 *  边界这一道是**判据**不是装饰：判卷里的假源码字符串（`const fake = 'import { a } from "./todo";'`）
 *  前面既不是行首也不是 `;` ⇒ 不当边。第一版逐行 grep 没有这一道 ⇒ 十几条假红。
 *  反过来说：跨行的真 import 在这里是**一条语句**，不看行 ⇒ 上一版的静默漏报（`SessionTransport`）消失。
 *
 *  clause 那一截**不许含 `(` `)` `=` `;`**（真 clause 里没有这四个字符）。少了这一道约束会怎样，是实测出来的：
 *  本文件自己的 `export function resolveRelativeSpec(…)` 被当成 clause 的开头，非贪婪一路跨过 70 行函数体，
 *  撞见注释里那句举例用的 `from "./todo"` ⇒ 尺把**自己**报成悬空。跨行要允许，跨语句不允许。 */
const STATEMENT = /(?:^|[;\n])[ \t]*(import|export)[ \t]+([^();=]*?)[ \t]+from[ \t]*["']([^"']+)["']/g;
/** 不带 `from` 的两种：`import "./x";`（副作用）与 `import("./x")`（动态，通常在行中间）。
 *  边界仍要挡住引号 ⇒ 前一个字符只能是行首/空白/`;`（动态再允许 `(`/`[`）：
 *  少一种写法＝静默漏报模块悬空，多一种写法＝把判卷里的假字符串当真边。两头都要数过。 */
const BARE_IMPORT = /(?:^|(?<=[ \t;]))import[ \t]+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /(?:^|(?<=[ \t;([]))import[ \t]*\([ \t]*["']([^"']+)["'][ \t]*\)/g;

const NO_NAMES: ImportClause = { names: [], namespace: false, opaque: false };

/** 把「是数据、不是代码」的区段**等长涂白**：模板字面量整段（含 `${…}`）。
 *
 *  为什么必须有（2026-10-02 实测，我自己踩的）：`tests/eval-heldout.test.ts` 里那些 `String.raw` 包着的
 *  JS 源码是**判卷要写进临时靶子的数据**，而 `import { subtotal } from "./cart.js";` 正好落在模板首行行首，
 *  于是上面那道「语句边界」判不出来（它本来就是一条合法形状的语句），这把尺给我那笔提交报了两条假悬空
 *  （`tests/cart.js.ts`／`tests/discount.js.ts`）⇒ 认证树红一道 `head-import-check`。
 *  这正是文件开头「47 条假红那一族」的下一个变体：上一版靠要求语句边界挡住**单行**假串，
 *  而多行源码片段自带边界，挡不住。
 *
 *  为什么只涂模板字面量、**不涂普通字符串**：动态导入与副作用导入的 specifier 本身就是字符串
 *  （`import("./x")`／`import "./x.css"`），全涂会把**真边**涂掉——那是假绿，比假红坏。
 *  等长涂白（非换行字符换空格）⇒ 偏移与行号一律不漂，报告里那句「第几行」还指得对。
 *
 *  ⚠️ 取区间走**解析器**而不是 `ts.createScanner`：这一条是实测出来的——第一版用裸词法器扫，
 *  而本文件（以及几乎所有被扫的文件）满是正则字面量，裸 scanner 把 `/.../ ` 当除号，
 *  正则里的引号于是把后续整段读成字符串 ⇒ 涂白吞掉真代码，`834ba3a` 那笔的缺失符号从 1 条炸成 300+ 条
 *  （**方向是假绿**，比它要修的假红坏得多）。解析器认得正则字面量，位置才准。 */
export function blankDataSpans(text: string): string {
  if (text === "") return text;
  // 快路：没有反引号就不可能有模板字面量。这一条不是微优化而是**门预算**——
  // 全仓 552 个文件逐个建 AST 把这道门从 ≈0.7s 抬到 ≈1.5s（超 1400ms 预算），
  // 而绝大多数文件本来就一个模板都没有（缺省值、注释、纯逻辑）。
  if (!text.includes("`")) return text;
  const source = ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true);
  // 只有这两种「整段是数据」的字面量；`TemplateHead/Middle/Tail` 不作为独立节点出现（它们只在
  // TemplateExpression 的 token 流里），所以按节点判就够——按 token 判就要回到裸 scanner，那条已实测会崩。
  const ranges: [number, number][] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || node.kind === ts.SyntaxKind.TemplateExpression) {
      ranges.push([node.getStart(source), node.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (ranges.length === 0) return text;
  // split("") 走 UTF-16 单元，与节点的 pos 同一套坐标系（Array.from 会合并代理对 ⇒ 偏移全漂）
  const chars = text.split("");
  for (const [from, to] of ranges) {
    for (let i = from; i < to && i < chars.length; i++) if (chars[i] !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

export function parseImportStatements(text: string): ImportStatement[] {
  const code = blankDataSpans(text);
  const out: ImportStatement[] = [];
  for (const m of code.matchAll(STATEMENT)) {
    const kind = m[1]!;
    const raw = m[2]!.trim();
    // `export * from` / `export * as ns from`：这条**给**名字、不**要**名字 ⇒ 只留模块边，不点名。
    const clause = kind === "export" && raw.startsWith("*") ? { ...NO_NAMES, namespace: true } : clauseNames(raw);
    out.push({ spec: m[3]!, reexport: kind === "export", clause });
  }
  for (const m of code.matchAll(BARE_IMPORT)) out.push({ spec: m[1]!, reexport: false, clause: NO_NAMES });
  for (const m of code.matchAll(DYNAMIC_IMPORT)) out.push({ spec: m[1]!, reexport: false, clause: NO_NAMES });
  return out;
}

/** 命名导出的粗粒度抽取。**只做诊断，不当编译器**：宁可少报（unknown ⇒ 不报），不可把合法写法报成缺失。
 *  `opaque` = 这一份导出面看不全（`export * from`）⇒ 整个目标文件跳过符号判定。 */
export function exportedNames(text: string): { names: Set<string>; opaque: boolean } {
  const names = new Set<string>();
  let opaque = false;
  // 同一只涂白：模板字面量里那段假源码写的是 `export function foo(){}` 时，
  // 不涂就会把这个名字当成这份文件真导出了它 ⇒ 缺失符号被读成存在（**假绿**，比假红坏）。
  const code = blankDataSpans(text);
  for (const m of code.matchAll(/\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?!from)(?:const|let|var|function\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]!);
  }
  // `export { a, b as c }` / `export type { T }` / `export { x } from "./y"`：报出去的名字是 `as` 右边那个。
  for (const m of code.matchAll(/(?:^|[;\n])[ \t]*export[ \t]+(?:type[ \t]+)?\{([\s\S]*?)\}/g)) {
    for (const n of specifiers(m[1]!, "export").names) names.add(n);
  }
  // `export * from` 把整面挡住；`export * as ns from` 只贡献 `ns` 一个名字，不算看不全。
  for (const m of code.matchAll(/(?:^|[;\n])[ \t]*export[ \t]+\*(?:[ \t]+as[ \t]+([A-Za-z_$][\w$]*))?[ \t]+from/g)) {
    if (m[1] !== undefined) names.add(m[1]);
    else opaque = true;
  }
  if (/(?:^|[;\n])[ \t]*export[ \t]+default\b/.test(code)) names.add("default");
  return { names, opaque };
}

// ---- 真取料：一次 ls-tree ＋ 一次 cat-file --batch（读提交对象，不碰工作区） ----

/** 一条 rev 里若干路径的正文。`git cat-file --batch` 逐条回 `<oid> blob <size>` ＋ 内容；
 *  `missing` 只回头行。回的行数与请求数不等 ⇒ 返回 null（**不拿半份面判绿**，规则 92 那一族）。 */
export function parseBatchResponse(paths: readonly string[], raw: Buffer): Map<string, string> | null {
  const map = new Map<string, string>();
  let idx = 0;
  for (const rel of paths) {
    const nl = raw.indexOf(0x0a, idx);
    if (nl === -1) return null;
    const header = raw.subarray(idx, nl).toString("utf8").trim();
    idx = nl + 1;
    const parts = header.split(" ");
    if (parts.length === 3 && parts[1] === "blob") {
      const size = Number(parts[2]);
      if (!Number.isFinite(size) || idx + size > raw.length) return null;
      map.set(rel, raw.subarray(idx, idx + size).toString("utf8"));
      idx += size + 1; // 内容后的那个换行
    } else if (parts.length === 2 && parts[1] === "missing") {
      continue; // 这一条本来就没有正文（ls-tree 之后极少发生）
    } else {
      return null; // 形状不认识 ⇒ 整批判未取，不猜
    }
  }
  return map;
}

export function readHeadBlobs(at: string, paths: readonly string[]): Map<string, string> | null {
  if (paths.length === 0) return new Map();
  const stdin = paths.map((p) => `${at}:${p}`).join("\n") + "\n";
  let raw: Buffer;
  try {
    raw = execFileSync("git", ["cat-file", "--batch"], {
      cwd: ROOT, input: stdin, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  return parseBatchResponse(paths, raw);
}

export interface HeadEdge {
  from: string;
  spec: string;
  /** 这条边点名要的名字（空 ⇒ 只判模块存在性）。 */
  names: string[];
}

export interface HeadFace {
  headFiles: Set<string>;
  edges: HeadEdge[];
  /** rev 里的正文（符号判据的读面）。单测走注入，不必有它。 */
  texts: Map<string, string>;
}

/** `at` 可指到任意 rev ⇒ 能拿"事故当时那一笔"自证这把尺咬得住（见 `--at` 用法）。 */
export function collectHeadEdges(at: string = "HEAD"): HeadFace | null {
  const listed = git(["ls-tree", "-r", "--name-only", at]);
  if (listed === null) return null;
  const headFiles = new Set(listed.split("\n").filter((p) => FACE_RE.test(p)));
  const paths = [...headFiles];
  const texts = readHeadBlobs(at, paths);
  if (texts === null) return null;
  const edges: HeadEdge[] = [];
  for (const [from, text] of texts) {
    for (const s of parseImportStatements(text)) {
      // clause 读不懂 ⇒ 一个名字都不报，但**模块边照留**（否则读不全反而把悬空也一起漏了）。
      edges.push({ from, spec: s.spec, names: s.clause.opaque ? [] : s.clause.names });
    }
  }
  return { headFiles, edges, texts };
}

// ---- 判据 ①：模块存在性 ----------------------------------------------------

export interface DanglingImport {
  /** 解析后应当存在、但 HEAD 里没有的那个路径（相对仓根）。 */
  target: string;
  /** 引用它的文件（HEAD 里的相对路径），最多留 3 个够定位。 */
  importers: string[];
  /** 盘上有没有（＝是不是"漏 add"这一类）。 */
  onDisk: boolean;
}

/** 纯判据：喂 HEAD 的文件表 ＋ 边 ⇒ 悬空边。`existsOnDisk` 注入 ⇒ 单测能造两态。 */
export function findDanglingImports(
  edges: readonly { from: string; spec: string }[],
  headFiles: ReadonlySet<string>,
  existsOnDisk: (rel: string) => boolean,
): DanglingImport[] {
  const byTarget = new Map<string, string[]>();
  for (const e of edges) {
    const t = resolveRelativeSpec(e.from, e.spec, headFiles);
    if (t === null || headFiles.has(t) || e.from === t) continue;
    byTarget.set(t, [...(byTarget.get(t) ?? []), e.from]);
  }
  return [...byTarget.entries()]
    .map(([target, importers]) => ({ target, importers: [...new Set(importers)].slice(0, 3), onDisk: existsOnDisk(target) }))
    .sort((a, b) => b.importers.length - a.importers.length || a.target.localeCompare(b.target));
}

// ---- 判据 ②：命名导出的符号存在性 ------------------------------------------

export interface MissingSymbol {
  target: string;
  symbol: string;
  importers: string[];
}

/** 命名导入 vs 目标文件的导出面：报「消费者入库了、符号没跟着入库」这一半。
 *  （`834ba3a` 的 8 条 typecheck 错里，4 条是模块缺失、1 条就是这一类：`SessionTransport` 没导出，
 *  剩下 3 条是 any 连带——只看模块存在性的那一半解释不了它。）
 *  少报口径：目标 `export *` 看不全 ⇒ 整份不判；clause 读不懂 ⇒ 调用方已滤；默认导入不判。
 *  `readTarget` 由调用方注入（同 `findDanglingImports` 的 `existsOnDisk` 口径 ⇒ 单测不碰 git）。 */
export function findMissingExports(
  edges: readonly HeadEdge[],
  headFiles: ReadonlySet<string>,
  readTarget: (rel: string) => string | null,
): MissingSymbol[] {
  const cache = new Map<string, { names: Set<string>; opaque: boolean } | null>();
  const byKey = new Map<string, MissingSymbol>();
  for (const e of edges) {
    if (e.names.length === 0) continue;
    const target = resolveRelativeSpec(e.from, e.spec, headFiles);
    if (target === null || !headFiles.has(target)) continue; // 模块本身缺，归 dangling 那一半管
    if (!cache.has(target)) {
      const text = readTarget(target);
      cache.set(target, text === null ? null : exportedNames(text));
    }
    const exp = cache.get(target);
    if (exp === null || exp === undefined || exp.opaque) continue; // 看不全 ⇒ 不判
    for (const sym of e.names) {
      if (exp.names.has(sym)) continue;
      const key = target + "\u0000" + sym;
      const seen = byKey.get(key);
      if (seen) seen.importers.push(e.from);
      else byKey.set(key, { target, symbol: sym, importers: [e.from] });
    }
  }
  return [...byKey.values()].map((v) => ({ ...v, importers: [...new Set(v.importers)].slice(0, 3) }))
    .sort((a, b) => a.target.localeCompare(b.target) || a.symbol.localeCompare(b.symbol));
}

// ---- 存量豁免（只准带理由；不再命中即 stale 红） ----------------------------

/** 形状照 `docs-check` 的 `LEGACY_WAIVERS`。 */
// 两张存量表都已清空：`14d2736` 把第 131 页那 4 个模块（provider-runtime / run-request /
// run-attachments / capabilities）和 `834ba3a` 欠的 `SessionTransport` 一并入库了，豁免逐条不再命中。
// 空表不是"没检查"——`checkDanglingImports` 仍要求每个悬空都在表里（新增即红），
// `checkMissingSymbols` 仍要求每个缺失符号都在表里；表空时任何新悬空/新缺失都会当场红。
export const HEAD_DANGLING_WAIVERS: Readonly<Record<string, string>> = {};

/** 符号那一半的存量（键＝`文件:符号`）。同样随 `14d2736` 清空。 */
export const HEAD_MISSING_SYMBOL_WAIVERS: Readonly<Record<string, string>> = {};

export interface HeadImportFinding {
  kind: "dangling" | "missing-symbol" | "stale-waiver";
  target: string;
  detail: string;
}

export function checkMissingSymbols(
  missing: readonly MissingSymbol[],
  waivers: Readonly<Record<string, string>> = HEAD_MISSING_SYMBOL_WAIVERS,
): HeadImportFinding[] {
  const out: HeadImportFinding[] = [];
  const hit = new Set<string>();
  for (const m of missing) {
    const key = m.target + ":" + m.symbol;
    if (waivers[key] !== undefined) { hit.add(key); continue; }
    out.push({
      kind: "missing-symbol",
      target: key,
      detail: `这一版里 ${m.importers.join("、")} 从 ${m.target} import 了 ${m.symbol}，而这份文件的导出面里没有它 ⇒ 导出没跟着入库，或名字改了这一侧没同步`,
    });
  }
  for (const key of Object.keys(waivers)) {
    if (!hit.has(key)) out.push({ kind: "stale-waiver", target: key, detail: `已不再缺这个符号 ⇒ 从 HEAD_MISSING_SYMBOL_WAIVERS 删掉（${waivers[key]}）` });
  }
  return out;
}

/** 出 finding（不出声）：名单外的悬空即红；名单里不再命中的也要红（不许静默烂着）。 */
export function checkHeadImportFace(
  dangling: readonly DanglingImport[],
  waivers: Readonly<Record<string, string>> = HEAD_DANGLING_WAIVERS,
): HeadImportFinding[] {
  const out: HeadImportFinding[] = [];
  const hit = new Set<string>();
  for (const d of dangling) {
    if (waivers[d.target] !== undefined) { hit.add(d.target); continue; }
    out.push({
      kind: "dangling",
      target: d.target,
      detail: `这一版里 ${d.importers.join("、")} import 了它，而它不在这一版 ⇒ `
        + (d.onDisk ? "**漏 `git add`**（盘上有但未入库）" : "**盘上也没有**（引用写错，或模块被删而引用没跟着改）"),
    });
  }
  for (const t of Object.keys(waivers)) {
    if (!hit.has(t)) out.push({ kind: "stale-waiver", target: t, detail: `已不再悬空 ⇒ 从 HEAD_DANGLING_WAIVERS 删掉（${waivers[t]}）` });
  }
  return out;
}

/** 用法：`node --import tsx scripts/head-import-face.ts [--at=<rev>] [--no-waivers]`
 *   · `--at=834ba3a` 拿事故当时那一笔自证；`--no-waivers` 把存量也印出来（只看，不判）。 */
function main(): void {
  const arg = (name: string, dflt: string): string => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit === undefined ? dflt : hit.slice(name.length + 3);
  };
  const at = arg("at", "HEAD");
  const off = process.argv.includes("--no-waivers");
  const waivers = off ? {} : HEAD_DANGLING_WAIVERS;
  const symbolWaivers = off ? {} : HEAD_MISSING_SYMBOL_WAIVERS;
  const got = collectHeadEdges(at);
  if (got === null) {
    console.error("head-import-face：git 取不到 " + at + " ⇒ 没尺，不判（exit 2）");
    process.exit(2);
  }
  const dangling = findDanglingImports(got.edges, got.headFiles, (rel) => existsSync(join(ROOT, rel)));
  const missing = findMissingExports(got.edges, got.headFiles, (rel) => got.texts.get(rel) ?? null);
  const findings = [...checkHeadImportFace(dangling, waivers), ...checkMissingSymbols(missing, symbolWaivers)];
  const waivedCount = dangling.filter((d) => waivers[d.target] !== undefined).length
    + missing.filter((m) => symbolWaivers[m.target + ":" + m.symbol] !== undefined).length;
  console.log(`head-import-face（${at}）：文件 ${String(got.headFiles.size)} 个｜import 边 ${String(got.edges.length)} 条`
    + `｜符号缺失 ${String(missing.length)}｜模块悬空 ${String(dangling.length)}（存量已豁免 ${String(waivedCount)}）`);
  for (const f of findings) console.log(`  ❌ ${f.kind} ${f.target} — ${f.detail}`);
  if (findings.length === 0) { console.log("head-import-face: ✅ import 面自洽（或在内存量已逐条带理由）"); return; }
  console.log(`head-import-face: ❌ ${String(findings.length)} 项（两张存量表在本文件，只准带理由登记）`);
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
