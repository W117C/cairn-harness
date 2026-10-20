// 模块说明符 → 仓内相对路径（纯函数，不碰盘）。
//
// 立案动因（10-02 现读，任务 #14）：地图与波及面的边**只靠裸名 def/ref 相遇**，而 `rank.ts`/`parse.ts`
// 两处对 import 说明符零处理 ⇒ 枢纽文件拿不到 rank mass。AST 普查（`outputs/map-import-edges-2026-10-02/import-census-ast.log`）：
// 候选面 583 个文件里有具名说明符 7875 条（值 6721／类型 1154），值说明符里
// **仓内相对路径漏解析 = 0 条**（未解析的 3165 条全是 `node:*`／`vitest`／外部包）⇒ 这条解析是完备的，
// 不是「先接上看看」。
//
// 为什么按 workspace 相对的 POSIX 路径自己算，而不是 `node:path`：
// ① 图里的 `file` 全是 rel（`/` 分隔，`build.ts` 扫描时已相对化），换成 path.join 会引入宿主分隔符这一维；
// ② 纯字符串 ⇒ 判卷不必造盘，跨机器同结果（这条判据在两棵 mtime 不同的树上也要给同一个答案）。
//
// 刻意不收的两类，各自出声而不是静默 null：
// · 外部包与 `node:` —— 真不在仓里，null 就是对的；
// · 解析后跑出仓根（`../../` 越过顶）—— 说明符不可信，null；这类不参与建边，但也不许被当成「仓内没有这个文件」。

/** 说明符指向的是不是仓内路径（相对或 workspace 根绝对）。外部包 ⇒ false。 */
export function isInternalSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === ".." || spec.startsWith("/");
}

/** `a/b/../c` 与 `./a/b` 收成规范化的 workspace 相对路径；越出仓根时返回 null（而不是留一串 `../`）。 */
export function normalizeRelPath(baseDir: string, spec: string): string | null {
  const parts = baseDir.split("/").filter((p) => p !== "" && p !== ".");
  const raw = spec.startsWith("/") ? spec.slice(1) : spec;
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // 越出仓根
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/** `src/x.ts` 从 `fromRel` 所在目录看过去的那条说明符 → 已知文件集合里的真实 rel；不在集合里 ⇒ null。
 *
 *  候选次序是**语义次序**，不是「试到哪个算哪个」（TS 自己就这么解）：
 *  ⑴ 原样命中（`./x.js` 真的有个 x.js，或说明符本就带后缀）
 *  ⑵ 换 ESM 写法后缀（`./x.js` ⇄ `x.ts`/`x.tsx`/`x.d.ts`——本仓源码写 `.js` 而盘上是 `.ts`，
 *      这一档吃下的就是本仓主流形状；无后缀的 `../src/agent/map/build` 也走这一档）
 *  ⑶ 目录兜底（`./x` → `x/index.ts`，只有在 ⑴⑵ 都不在集合里才轮到，避免 `a.ts` 与 `a/index.ts` 并存时解错）
 */
export function resolveModuleSpecifier(fromRel: string, spec: string, known: ReadonlySet<string>): string | null {
  if (!isInternalSpecifier(spec)) return null;
  const baseDir = fromRel.slice(0, Math.max(0, fromRel.lastIndexOf("/")));
  const target = normalizeRelPath(baseDir, spec);
  if (!target) return null;
  if (known.has(target)) return target;
  const stripped = target.replace(/\.(js|mjs|cjs|jsx)$/, "");
  for (const ext of [".ts", ".tsx", ".d.ts"]) {
    if (known.has(stripped + ext)) return stripped + ext;
  }
  if (stripped !== target && known.has(stripped)) return stripped;
  for (const idx of ["/index.ts", "/index.tsx", "/index.js"]) {
    if (known.has(stripped + idx)) return stripped + idx;
  }
  return null;
}
