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
  "(call_expression function: (member_expression property: (property_identifier) @ref))",
  "(new_expression constructor: (identifier) @ref)",
  "(new_expression constructor: (member_expression property: (property_identifier) @ref))",
  "(variable_declarator value: (identifier) @ref)",
  "(assignment_expression left: (identifier) right: (identifier) @ref)",
  "(call function: (identifier) @ref)",
  "(call function: (attribute attribute: (identifier) @ref))",
  "(assignment left: (identifier) right: (identifier) @ref)",
];

/** 抽取**逻辑本体**的版本（谁算一个符号、谁算一次引用的那段代码）。pattern 文本已自动进哈希，
 *  这一条只兜住「文本一字没动而判断变了」——改 `atModuleScope`/属性式取舍时手工 +1。
 *  ⚠️ 必须先于 `TAGS_EXTRACT_VERSION` 声明：后者在模块求值期就要读它（放后面是 TDZ 崩）。 */
const EXTRACT_LOGIC_REV = 1;
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

/** 抛错版单文件 tags：语法错误/空文件返回空 tags；grammar 加载失败向上抛（调用方降级）。 */
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
  // 语法错误文件：hasError 时仍尝试 query（错误恢复节点常能给出部分 tags），
  // 但根节点缺父结构时 query 可能抛 —— 任何一步异常都返回空 tags（本模块契约）。
  try {
    if (tree.rootNode.hasError) return [];
    const query = await queryFor(lang, loaded);
    if (!query) return [];
    const tags: SymbolTag[] = [];
    for (const m of query.matches(tree.rootNode)) {
      for (const c of m.captures) {
        if (c.name !== "def" && c.name !== "ref") continue;
        const name = c.node.text;
        if (!name) continue;
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
