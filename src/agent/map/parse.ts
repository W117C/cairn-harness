// 符号地图·解析层（§6.4）：web-tree-sitter WASM grammar（懒加载+缓存）按 .scm query 抽
// def/ref captures，产出单文件 tags（名字/种类/行号，1-based）。任何异常由调用方降级
// （buildMap 静默跳过），本模块只负责单文件 tags 的确定性产出：语法错误文件不抛、返回空 tags。
import { createRequire } from "node:module";
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

// ---- 四语言 grammar（懒加载 + 缓存；扩展名 → 语言键）----
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript", // js grammar 吃 jsx（tree-sitter-javascript 内建）
  py: "python",
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
];

/** 抽取**逻辑本体**的版本（谁算一个符号、谁算一次引用的那段代码）。pattern 文本已自动进哈希，
 *  这一条只兜住「文本一字没动而判断变了」——改 `isLocalVariableBinding`/`NESTED_SCOPES`/属性式取舍时手工 +1。
 *  ⚠️ 必须先于 `TAGS_EXTRACT_VERSION` 声明：后者在模块求值期就要读它（放后面是 TDZ 崩）。
 *  rev 2（2026-09-23）：变量声明名要在模块作用域才计入（`isLocalVariableBinding`）。
 *  rev 3（2026-09-23）：语法错误文件从「整文件一票否决」改成「ERROR 子树之外部分回收」。 */
const EXTRACT_LOGIC_REV = 3;
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
}

export interface SymbolTag {
  name: string;
  kind: "def" | "ref";
  /** 1-based 行号（对外口径，与工具 schema 一致；内部 graph 索引照用）。 */
  line: number;
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

/** 回收口径为什么只是一句「hasError 不再一票否决」，而没有再加一道「丢掉 ERROR 子树里的 capture」：
 *  实测那一道在现有图案下**什么都不挡**——四个真触发文件（见 `probe-map-recall.ts` 首跑读数）与
 *  另造的七种坏法（空初值 `const a = ;`、未闭合类、断在半表达式、`if (true {`、坏参数表、
 *  空类型标注、`import type { A from "b"`）逐一对比，过滤前后的 def 集合完全相同
 *  ⇒ tree-sitter 的错误恢复不会在 ERROR 子树里交出可被 pattern 命中的具名节点。
 *  留一条测不到的守卫就是本仓最忌的「模块齐、测试绿、最后一跳没接」，故撤。
 *  重开条件：哪天 pattern 扩到能吃下属性式/解构式定义（§三 主动收掉的那两类），
 *  就得回头测这批新图案在 ERROR 子树里会不会产假名——那条锚点届时才有对象。 */

/** 抛错版单文件 tags：语法错误文件不抛；见下方 `recovering` 一支的口径。 */
export async function fileTags(src: string, ext: string): Promise<SymbolTag[]> {
  const lang = LANG_BY_EXT[ext];
  if (!lang) return []; // 不认识的后缀：空 tags（不抛）
  const loaded = await loadLanguage(lang);
  if (!loaded) return [];
  const w = await getWts();
  const parser = new w.Parser();
  parser.setLanguage(loaded as never);
  let tree: import("web-tree-sitter").Tree | null = null;
  try {
    tree = parser.parse(src);
    if (!tree) return [];
  } catch {
    return []; // parse 抛错 = 语法错误文件：空 tags，不抛
  }
  // 语法错误文件：以前整文件一票否决（`hasError ⇒ []`）。实测代价：本仓 4 个**合法** TS 文件
  // 因此在图里完全不存在（类型位置里的 `import("pkg").T`、`vi.mock` 的
  // `importOriginal<typeof import("node:fs/promises")>()`，以及一条含双斜杠的正则字面量），
  // 而 `impact_query` 只会回「这张图里没有这个符号」——「没有」与「漏了」在读端同形。
  // 现在直接跑 query：错误恢复留下的正常子树照常出 tags；整文件都是错的（`function {{{ nope`）
  // 本来就抽不出具名节点 ⇒ 老契约用例仍绿（为何不再加一道 ERROR 子树过滤，见上方那段测量记录）。
  try {
    const query = await queryFor(lang, loaded);
    if (!query) return [];
    const tags: SymbolTag[] = [];
    for (const m of query.matches(tree.rootNode)) {
      for (const c of m.captures) {
        if (c.name !== "def" && c.name !== "ref") continue;
        const name = c.node.text;
        if (!name) continue;
        if (c.name === "def" && isLocalVariableBinding(c.node)) continue; // 函数体里的变量不是跨文件符号
        tags.push({ name, kind: c.name as "def" | "ref", line: c.node.startPosition.row + 1 });
      }
    }
    return tags;
  } catch {
    return []; // query 抛错 = 语法错误/不兼容模式：空 tags，不抛
  } finally {
    tree?.delete();
    parser.delete();
  }
}
