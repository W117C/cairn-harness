// 符号地图·解析层（§6.4）：web-tree-sitter WASM grammar（懒加载+缓存）按 .scm query 抽
// def/ref captures，产出单文件 tags（名字/种类/行号，1-based）。任何异常由调用方降级
// （buildMap 静默跳过），本模块只负责单文件 tags 的确定性产出：语法错误文件不抛、返回空 tags。
import { createRequire } from "node:module";
import { commentSummary } from "./retrieve.js";
import { createHash } from "node:crypto";

// web-tree-sitter 会被 electron-vite 打进 main bundle：wasm/grammar 路径必须运行时从真实
// node_modules 解析（坑二十四同款，不能让打包器静态分析 require.resolve）。
const nodeRequire = createRequire(import.meta.url);

type WtsModule = typeof import("web-tree-sitter");
let wts: WtsModule | null = null;
/** 测试注入口：替换 wasm 模块（喂坏 grammar 用）。 */
export function __setWts(m: WtsModule | null): void {
  wts = m;
}

async function getWts(): Promise<WtsModule> {
  if (!wts) wts = (await import("web-tree-sitter")) as WtsModule;
  return wts;
}

/** Emscripten wasm 定位：运行时从真实 node_modules 解析（打包后 out/main 下找不到，坑二十四同族）。 */
async function initParser(): Promise<void> {
  const w = await getWts();
  if (typeof (w.Parser as unknown as { init?: unknown }).init === "function") {
    await (w.Parser as unknown as {
      init: (arg?: { locateFile?: (f: string) => string }) => Promise<void>;
    }).init({ locateFile: (f: string) => nodeRequire.resolve("web-tree-sitter/" + f) });
  }
}

// ---- 六语言 grammar（懒加载 + 缓存；扩展名 → 语言键）----
// go/java（第 261 页 M1 路线图）：wasm 在 tree-sitter-wasms 包里现成（零新依赖）；
// 抽取纪律与 js 同款——属性/选择器访问（obj.Method()、pkg.F()）不进图（名字图判不了对象归属，假边同族）。
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript", // js grammar 吃 jsx（tree-sitter-javascript 内建）
  py: "python",
  go: "go",
  java: "java",
};
export const SUPPORTED_EXTS = Object.keys(LANG_BY_EXT);

type Lang = import("web-tree-sitter").Language;
const langCache = new Map<string, Lang | null>(); // null = 该语言加载失败（本进程不再重试）

function wasmPath(lang: string): string {
  return nodeRequire.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`);
}

/** E7（审查 P2）：grammar 环境级失败（缺失/损坏）——加载失败也写 null 缓存（本进程不再逐文件
 *  重试同一失败加载），并以类型化错误上抛：buildMap 据此整图降级（ok:false，锚定契约）。 */
export class TreeSitterUnavailableError extends Error {}

async function loadLanguage(lang: string): Promise<Lang | null> {
  const hit = langCache.get(lang);
  if (hit !== undefined) {
    if (hit === null) throw new TreeSitterUnavailableError(`tree-sitter grammar 不可用: ${lang}（已缓存失败，本进程不再重试）`);
    return hit;
  }
  try {
    const w = await getWts();
    await initParser();
    const l = await w.Language.load(wasmPath(lang));
    langCache.set(lang, l);
    return l;
  } catch (err) {
    langCache.set(lang, null); // E7：失败入缓存——旧实现不上缓存，逐文件重试同一失败加载
    throw new TreeSitterUnavailableError(`tree-sitter grammar 不可用: ${lang}：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 测试口：清空 language 缓存。 */
export function __resetLangCache(): void {
  langCache.clear();
}

// ---- .scm query 模式（def/ref captures；模式池按语言取交集编译）----
// 单模式编译失败（某语言无该节点类型）就跳过该模式，不让一处不兼容炸掉整语言。
// 抽取判据不抽「属性名」。三条曾在此的 pattern（`obj.prop()` / `new obj.prop()` / py `obj.attr()`）
// 实测贡献了 47,303 个引用捕获里的 20,533 个（43%），而它们连的是 `console.log` 与某个文件里
// 自己那个 `const log = …`——名字图无法判断属性访问的对象是哪个模块，故这类边一律是假边
// （单个 `log` 在一仓之内产出 45,160 条）。读数量与消融见 outputs/impact-precision-2026-09-23.md。
// 已知代价（**命名缺口，不是遗漏**）：`obj.method()` 形式的方法调用因此不进图。要拿回它，
// 得先解析 `object` 标识符的绑定（它是不是本文件的模块级绑定或 import），那是另一笔工程。
/** 刻意不收的一条：`.d.ts` 里"只有签名没有函数体"的 `export function`（ambient 声明）。
 *  实测本仓召回还差 3 个符号，全在这一格里（`history-window.d.ts` 的 `projectUnits`/`windowRange`/`mountHistory`）。
 *  用户裁决 2026-09-23：**不收**——那是类型边不是运行边，而这张图的口径是「改这里会被谁调用」。
 *  重开条件：先给边分两类（类型边 / 运行边）并在读端分开呈现；在那之前把签名塞进调用点，
 *  等于把 §三 刚清出去的"同名不同实体假边"再请回来一遍。留读数：`map-check` ⑦ 的 `漏抽=N` 会一直挂着。 */
const PATTERNS = [
  "(function_declaration name: (identifier) @def)",
  "(function_declaration name: (nested_identifier) @def)",
  "(generator_function_declaration name: (identifier) @def)",
  "(class_declaration name: (type_identifier) @def)",
  "(class_declaration name: (identifier) @def)",
  "(abstract_class_declaration name: (type_identifier) @def)",
  "(method_definition name: (property_identifier) @def)",
  "(variable_declarator name: (identifier) @def)",
  "(type_alias_declaration name: (type_identifier) @def)",
  "(interface_declaration name: (type_identifier) @def)",
  "(enum_declaration name: (identifier) @def)",
  "(function_definition name: (identifier) @def)",
  "(class_definition name: (identifier) @def)",
  "(call_expression function: (identifier) @ref)",
  "(new_expression constructor: (identifier) @ref)",
  "(variable_declarator value: (identifier) @ref)",
  "(assignment_expression left: (identifier) right: (identifier) @ref)",
  "(call function: (identifier) @ref)",
  "(assignment left: (identifier) right: (identifier) @ref)",
  // go/java（第 261 页 M1 路线图）。纪律同 js：属性/选择器访问不进图——
  // go 的 pkg.F() 与 java 的 obj.method() 是 selector_expression/method_invocation 带受体，
  // 名字图判不了受体归属（假边同族，2026-09-23 用户裁决）。go 跨包调用因此不进图（登记的设计边界）。
  "(method_declaration name: (field_identifier) @def)", // go 方法
  "(type_spec name: (type_identifier) @def)", // go 类型声明（type_declaration 包一层 type_spec）
  "(method_invocation name: (identifier) @ref !object)", // java 无受体方法调用（有受体=属性访问，排除）
  "(object_creation_expression type: (type_identifier) @ref)", // java new X() ⇒ 引用类 X
];

/** 抽取**逻辑本体**的版本（谁算一个符号、谁算一次引用的那段代码）。pattern 文本已自动进哈希，
 *  这一条只兜住「文本一字没动而判断变了」——改 `isLocalVariableBinding`/`NESTED_SCOPES`/属性式取舍时手工 +1。
 *  ⚠️ 必须先于 `TAGS_EXTRACT_VERSION` 声明：后者在模块求值期就要读它（放后面是 TDZ 崩）。
 *  rev 2（2026-09-23）：变量声明名要在模块作用域才计入（`isLocalVariableBinding`）。
 *  rev 3（2026-09-23）：语法错误文件从「整文件一票否决」改成「ERROR 子树之外部分回收」。
 *  rev 4（2026-10-02）：跨文件依赖多出一个**独立出口**（`fileSymbols` 的 `imports`）——
 *  老条目里没有 import 面，缓存命中那支就会给出「有 tags、没边」的另一张图 ⇒ 必须整体重解析一次。
 *  rev 5（2026-10-02）：再加第三个出口 `summary`（头注释摘要＝词面检索的语料）。同一族理由：
 *  只核 tags/imports 而让 summary 缺席，热缓存那支的地图会突然"问什么都不命中"。
 *  rev 6（2026-10-20）：tags 多一个**字段** `crossFile`（成员位名字标成不可跨文件链接）。
 *  同一族理由、但更要紧：老缓存条目里**没有这个字段** ⇒ 缺席 = 可链接 ⇒ 热缓存那支会把
 *  成员名照旧连成跨文件依赖，出来的是**另一张图**（成员名假边又回来了）。
 *  ⇒ 必须整体重解析一次。 */
const EXTRACT_LOGIC_REV = 6;
/** 版本号的算法单独成一个纯函数：判卷可以直接拿「改一行 pattern ⇒ 版本必须变」这条不变量打它。 */
export function tagsExtractVersion(patterns: readonly string[]): string {
  return createHash("sha1").update(EXTRACT_LOGIC_REV + "\n" + patterns.join("\n")).digest("hex").slice(0, 12);
}
/** 抽取判据的版本号（sha1 前 12 位，由上面这些输入派生，**不是手写的常量**）。
 *
 *  为什么非要有：map 与 impact 两份 tags 磁盘缓存的命中判据只有 `{mtimeMs,size}`。
 *  改了抽取判据而未改动的那些文件，下次建图仍会从盘上读回**旧判据**抽出的 tags ⇒
 *  新判据对它们根本不生效，而现象是「改了没反应」——极易被误读成修法无效，
 *  于是把正确的改动回滚掉（2026-09-23 立此条；动因与读数量见
 *  `outputs/impact-precision-2026-09-23.md`：不先有版本号，那次「把局部变量与属性名踢出符号表」
 *  对 397/400 个文件都不会生效）。
 *  旧条目没有 `v` 字段 ⇒ 与任何版本号都不相等 ⇒ 自然按 miss 处理（一次全量重解析，之后稳定）。 */
/** 只读导出：让判卷能验「版本 = 按这组 pattern 算出来的」这条派生关系，而不是信注释。 */
export const TAGS_PATTERNS: readonly string[] = PATTERNS;
export const TAGS_EXTRACT_VERSION = tagsExtractVersion(PATTERNS);

/** 每语言缓存一把编译好的 Query（有效模式并集）；编译失败的模式静默跳过。 */
const queryCache = new Map<string, import("web-tree-sitter").Query | null>();

async function queryFor(lang: string, language: Lang): Promise<import("web-tree-sitter").Query | null> {
  const hit = queryCache.get(lang);
  if (hit !== undefined) return hit;
  const w = await getWts();
  const valid: string[] = [];
  for (const p of PATTERNS) {
    try {
      new w.Query(language as never, p); // 试编译
      valid.push(p);
    } catch {
      // 该语言无此节点/字段：跳过
    }
  }
  if (valid.length === 0) {
    queryCache.set(lang, null);
    return null;
  }
  try {
    const q = new w.Query(language as never, valid.join("\n"));
    queryCache.set(lang, q);
    return q;
  } catch {
    queryCache.set(lang, null);
    return null;
  }
}

/** 测试口：清空 query 缓存（配 __resetLangCache 用）。 */
export function __resetQueryCache(): void {
  queryCache.clear();
  importQueryCache.clear();
}

// ---- import 面（跨文件依赖）：单独一把 Query，不与 def/ref 并表 ----
// 为什么捕整条语句而不是深嵌的 specifier 模式：`source:` 字段与嵌套组在同一个 pattern 里
// 报「Bad pattern structure」（10-02 实测三种写法全被 Query 拒），而把结构判断放到代码里走 AST
// 只需要 `childForFieldName`，且 js/ts/tsx 与 python/go 的差异能在这里逐条判，不靠 pattern 猜。
const IMPORT_PATTERNS = ["(import_statement) @imp", "(export_statement) @exp"];
const importQueryCache = new Map<string, import("web-tree-sitter").Query | null>();

async function importQueryFor(lang: string, language: Lang): Promise<import("web-tree-sitter").Query | null> {
  const hit = importQueryCache.get(lang);
  if (hit !== undefined) return hit;
  const w = await getWts();
  const valid: string[] = [];
  for (const p of IMPORT_PATTERNS) {
    try {
      new w.Query(language as never, p);
      valid.push(p);
    } catch {
      // 该语言没这个节点：跳过（跳过≠通过：python/go 的 import 形状不同，本轮不接，出声在任务 #14）
    }
  }
  if (valid.length === 0) {
    importQueryCache.set(lang, null);
    return null;
  }
  try {
    const q = new w.Query(language as never, valid.join("\n"));
    importQueryCache.set(lang, q);
    return q;
  } catch {
    importQueryCache.set(lang, null);
    return null;
  }
}

/** 语句级 `import type { … }` / `export type { … }` 的那个 `type` 令牌。
 *  实测（10-02 一次性 AST 探针，读数在 `outputs/map-import-edges-2026-10-02/ast-shapes.log`）：
 *  specifier 自己的 `type` 只在 `import { type T }` 那一档出现，语句级那档必须看语句的 children
 *  ⇒ 两档各查一次，缺一个就漏一类（`export type { T } from "…"` 探针第一版就是这么漏的）。 */
function statementIsTypeOnly(stmt: import("web-tree-sitter").Node): boolean {
  const kids = (stmt.children ?? []).filter((c): c is NonNullable<typeof c> => c !== null);
  return kids.some((c) => c.type === "type" && /^(import|export)$/.test(String(c.previousSibling?.type)));
}

/** 从一条 import/export 语句里取出「本文件从对面取走了哪些名字」。 */
function collectImportRefs(stmt: import("web-tree-sitter").Node): ImportRef[] {
  const sourceNode = stmt.childForFieldName("source");
  if (!sourceNode) return []; // `export const x = 1`：本文件的定义，不是跨文件依赖
  const spec = sourceNode.text.replace(/^["'`]|["'`]$/g, "");
  if (!spec) return [];
  const stmtType = statementIsTypeOnly(stmt);
  const out: ImportRef[] = [];
  const walk = (n: import("web-tree-sitter").Node | null): void => {
    if (!n) return;
    if (n.type === "import_specifier" || n.type === "export_specifier") {
      const nameNode = n.childForFieldName("name");
      if (nameNode?.text) {
        const aliasNode = n.childForFieldName("alias");
        const specType = (n.children ?? []).some((c) => c !== null && c.type === "type");
        out.push({
          name: nameNode.text,
          ...(aliasNode?.text ? { localName: aliasNode.text } : {}),
          spec,
          typeOnly: stmtType || specType,
          line: n.startPosition.row + 1,
        });
      }
      return; // specifier 里面没有别的 specifier
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(stmt);
  return out;
}


export interface SymbolTag {
  name: string;
  kind: "def" | "ref";
  /** 1-based 行号（对外口径，与工具 schema 一致；内部 graph 索引照用）。 */
  line: number;
  /** `false` = 这个名字挂在**成员位**上（类方法／类字段／接口成员）⇒ 它**不可跨文件链接**。
   *  缺席 = 可跨文件链接（缺省，含这份字段出现之前落盘的所有缓存条目）。
   *  消费方是构图层（`rank.ts`）：跨文件的 ref→def 边不许落到成员定义上，
   *  **同文件内的边照旧**（类内自调用是真依赖）。 */
  crossFile?: false;
}

/** 一条跨文件依赖：本文件从 `spec` 里取走名字 `name`。
 *  与 `SymbolTag` 分两个出口（而不是往 tags 里塞 `via` 字段）的理由：
 *  · tags 是**名字图**的输入，波及面（`impact/index.ts`）也吃它——混进去会静默改掉波及面的边集精度，
 *    而那边按「同名全连」建边，一条 `import { execute } from "./a.js"` 会顺手连到任何叫 `execute` 的定义；
 *  · 缓存里存的正是 tags ⇒ 新字段若只在热缓存里缺席（老条目没写过），冷/热两支会给出两张图。
 *    分两个出口、`imports` 一起进缓存，两支的图才是同一份。 */
export interface ImportRef {
  /** 被取走的名字（`import { a as b }` 取 `a`——那才是对面的 def 名）。 */
  name: string;
  /** 说明符原文（已剥引号），交给 `resolveModuleSpecifier` 解析。 */
  spec: string;
  /** `import type { T }` 或 `import { type T }` ⇒ true。类型边**不入运行边图**
   *  （2026-09-23 用户裁决：先分类型边／运行边并在读端分开呈现，在那之前不许并进同一张名字图）。 */
  typeOnly: boolean;
  line: number;
  /** `import { execute as run }` 的本文件名（run）。缺省 = 与 name 相同。
   *  精确边与影响面都必须用本文件名：源名 execute 只是对面的 def，调用点写的是 run。 */
  localName?: string;
}

/** `fileSymbols` 的完整出口：tags（名字图）＋ imports（跨文件依赖）＋ summary（词面检索的语料）。 */
export interface FileSymbols {
  tags: SymbolTag[];
  imports: ImportRef[];
  /** 文件顶部那段注释（按码点有界）。地图的词面检索只吃这一行——中段注释是解释分支的，
   *  当"这个文件是干什么的"会指错方向（形状见 `retrieve.ts` 的 `commentSummary`）。 */
  summary: string;
}

/** 嵌套执行作用域的容器节点：从捕获节点向上到 `program` 的路上遇到任意一个，就说明这个声明
 *  写在函数体/方法体/类体/分支/循环里。判「能否走到 program」是不够的——每个节点都能走到根，
 *  那样所有定义都会被当成模块级（第一次量这个数时就这样错过一次，读数 1,666/1,666 全是局部）。 */
const NESTED_SCOPES = new Set([
  "statement_block", "class_body", "function_body", "switch_body", "switch_statement", "block",
  "compound_statement", "arrow_function", "function", "generator_function", "for_statement",
  "for_in_statement", "for_of_statement", "do_statement", "while_statement", "if_statement",
  "try_statement", "catch_clause", "finally_clause", "else_clause", "with_statement",
]);

/** 变量声明的名字是否在模块作用域（`export const x = …` 与 `const x = …` 都算；函数体里不算）。 */
function declaredAtModuleScope(nameNode: import("web-tree-sitter").Node): boolean {
  let n: import("web-tree-sitter").Node | null = nameNode.parent;
  let guard = 0;
  while (n && guard++ < 500) {
    if (n.type === "program" || n.type === "module") return true;
    if (NESTED_SCOPES.has(n.type)) return false;
    n = n.parent;
  }
  return false; // 走不到根（异常树形）：不收录，宁缺不假
}

/** 这次捕获是不是「函数体里的一个变量声明名」。
 *  只闸这一种，不是偏心：实测 11,701 个 `variable_declarator` 定义里 10,184 个是局部变量，
 *  它们是同名假边的第一来源（`i` 有 187 个「定义」、`p` 有 119 个），而局部变量**根本不可能**
 *  被另一个文件 import——把它当跨文件符号等于凭空造依赖。其余 def pattern 抽的是
 *  函数/类/接口/类型这类命名声明，嵌套出现也仍是有名字的实体，闸它们没有这份证据支撑。 */
function isLocalVariableBinding(nameNode: import("web-tree-sitter").Node): boolean {
  const p = nameNode.parent;
  if (!p || p.type !== "variable_declarator") return false;
  // 按位置比，不按对象比：tree-sitter 每次取节点都新建外壳，`childForFieldName(...) === c.node`
  // 恒为 false ⇒ 这道闸会静默地永远不放行（第一次落地就是这样，读数只少了 16 个定义才暴露它）。
  const nm = p.childForFieldName("name");
  if (!nm || nm.startIndex !== nameNode.startIndex || nm.endIndex !== nameNode.endIndex) return false;
  return !declaredAtModuleScope(nameNode);
}

/** 挂在**成员位**上的名字：类方法／类字段／接口成员。
 *  闸这一族的理由与上一道同源，只是换了载体：成员名**只能**经 `obj.name`（或 `new Klass().name`）
 *  被别处触到，而那种写法走属性/选择器纪律、**根本不进图**（见 PATTERNS 上方那段「不抽属性名」的
 *  设计边界）⇒ 把成员名当跨文件可链接定义，等于凭空造依赖。
 *  真仓读数（2026-10-02 一次全量图构建）：`src/agent/ledger.ts` 的 `private readFile` 吸了
 *  **107 个文件**的同名 ref、`src/tools/grep.ts` 的 `run` 吸 23 个——一条成员定义横跨上百个文件，
 *  还把地图前排占成假枢纽（影响面分析的首位因此指向一个谁也调不到它的私有方法）。
 *  ⚠️ 只标**成员位**（不是「所有方法」）：类的**名字**本身是可跨文件引用的（`new Klass()`），
 *  闸掉它会把真依赖一起闸掉。 */
const MEMBER_NAME_PARENTS = new Set([
  "method_definition", "method_declaration", "method_signature", "abstract_method_signature",
  "field_definition", "public_field_definition", "property_signature",
]);
function isMemberPositionName(nameNode: import("web-tree-sitter").Node): boolean {
  const p = nameNode.parent;
  if (!p || !MEMBER_NAME_PARENTS.has(p.type)) return false;
  // 按位置比、不按对象比（rev 2 踩过的坑：tree-sitter 每次取节点都新建外壳，`===` 恒 false ⇒ 闸门静默不生效）
  const nm = p.childForFieldName("name");
  return nm !== null && nm.startIndex === nameNode.startIndex && nm.endIndex === nameNode.endIndex;
}

/** 回收口径为什么只是一句「hasError 不再一票否决」，而没有再加一道「丢掉 ERROR 子树里的 capture」：
 *  实测那一道在现有图案下**什么都不挡**——四个真触发文件（见 `probe-map-recall.ts` 首跑读数）与
 *  另造的七种坏法（空初值 `const a = ;`、未闭合类、断在半表达式、`if (true {`、坏参数表、
 *  空类型标注、`import type { A from "b"`）逐一对比，过滤前后的 def 集合完全相同
 *  ⇒ tree-sitter 的错误恢复不会在 ERROR 子树里交出可被 pattern 命中的具名节点。
 *  留一条测不到的守卫就是本仓最忌的「模块齐、测试绿、最后一跳没接」，故撤。
 *  重开条件：哪天 pattern 扩到能吃下属性式/解构式定义（§三 主动收掉的那两类），
 *  就得回头测这批新图案在 ERROR 子树里会不会产假名——那条锚点届时才有对象。 */

/** 抛错版单文件 tags：语法错误文件不抛；见下方 `fileSymbols` 里 `recovering` 一支的口径。
 *  只是 `fileSymbols` 的薄壳 ⇒ 解析实现全仓只有一份（两份副本迟早宽度不同，本仓第十三族）。
 *  波及面（`impact/index.ts`）继续吃这一支：它按「同名全连」建边，本轮不让 import 面静默改掉它的精度。 */
export async function fileTags(src: string, ext: string): Promise<SymbolTag[]> {
  return (await fileSymbols(src, ext)).tags;
}

/** 一次解析给出两个出口：名字图用的 tags ＋ 跨文件依赖用的 imports。
 *  `imports` 必须与 tags **同一次解析**产出并一起进缓存：分两次解析就是两份取料面，
 *  而只进其中一支会给出「有 tags、没边」的另一张图（冷/热缓存两支不同形，本仓老坑）。 */
export async function fileSymbols(src: string, ext: string): Promise<FileSymbols> {
  const empty = (): FileSymbols => ({ tags: [], imports: [], summary: "" });
  const lang = LANG_BY_EXT[ext];
  if (!lang) return empty(); // 不认识的后缀：两个出口都空（不抛）
  const loaded = await loadLanguage(lang);
  if (!loaded) return empty();
  const w = await getWts();
  const parser = new w.Parser();
  parser.setLanguage(loaded as never);
  let tree: import("web-tree-sitter").Tree | null = null;
  try {
    tree = parser.parse(src);
    if (!tree) return empty();
  } catch {
    return empty(); // parse 抛错 = 语法错误文件：空，不抛
  }
  // 语法错误文件：以前整文件一票否决（`hasError ⇒ []`）。实测代价：本仓 4 个**合法** TS 文件
  // 因此在图里完全不存在（类型位置里的 `import("pkg").T`、`vi.mock` 的
  // `importOriginal<typeof import("node:fs/promises")>()`，以及一条含双斜杠的正则字面量），
  // 而 `impact_query` 只会回「这张图里没有这个符号」——「没有」与「漏了」在读端同形。
  // 现在直接跑 query：错误恢复留下的正常子树照常出 tags；整文件都是错的（`function {{{ nope`）
  // 本来就抽不出具名节点 ⇒ 老契约用例仍绿（为何不再加一道 ERROR 子树过滤，见上方那段测量记录）。
  try {
    const tags: SymbolTag[] = [];
    const query = await queryFor(lang, loaded);
    if (query) {
      for (const m of query.matches(tree.rootNode)) {
        for (const c of m.captures) {
          if (c.name !== "def" && c.name !== "ref") continue;
          const name = c.node.text;
          if (!name) continue;
          if (c.name === "def" && isLocalVariableBinding(c.node)) continue; // 函数体里的变量不是跨文件符号
          const tag = { name, kind: c.name as "def" | "ref", line: c.node.startPosition.row + 1 };
          // 成员名是同一族的第二道闸（与上面那道「局部变量」同因，只是换了载体）。
          tags.push(c.name === "def" && isMemberPositionName(c.node) ? { ...tag, crossFile: false } : tag);
        }
      }
    }
    // import 面单独一把 query：主 query 在某语言编译失败时，这一把仍可能有结果——
    // 两支各自出声，不共用一个「编译失败」的结论。
    const imports: ImportRef[] = [];
    const iq = await importQueryFor(lang, loaded);
    if (iq) {
      for (const m of iq.matches(tree.rootNode)) {
        for (const c of m.captures) imports.push(...collectImportRefs(c.node));
      }
    }
    return { tags, imports, summary: commentSummary(src) };
  } catch {
    return empty(); // query 抛错 = 语法错误/不兼容模式：空，不抛
  } finally {
    tree?.delete();
    parser.delete();
  }
}
