/** 「这条判卷面的取料面里，哪些正被别的会话改着」——纯函数，供 `tests/judge-input-face.test.ts` 消费。
 *  图（import 边）复用 `reach-graph.ts`，**不另起一份取料**（规则 113：两把尺各抄一份迟早漂）。
 *
 * 为什么要第二把尺（第 86 页 §三 自己记下的限制）：`git status` 那一列只解释判卷文件**自己**。
 * 活例：`tests/mutate-anchor-titles.test.ts` 在 HEAD 里红、在主树里绿，而它本身对 HEAD 无改动——
 * 让它变绿的是别人未提交的 `scripts/mutate-verify.mjs`。那不是 import 边（判卷文件是把它当**文本**读来抽锚点的），
 * 所以只看 import 闭包会得出"没人垫"的假结论。 ⇒ 两条来路分开标，且**一条都没命中时必须说「未记」**，
 * 不许把空集读成"确认无在飞依赖"（规则 82）。 */
import { closure, type Graph } from "./reach-graph";

export type InputVia = "import 闭包" | "路径字面量（提示级，不是证明）";

export interface InputHit {
  file: string;
  via: InputVia;
}

/** 仓内顶层目录：只有这些前缀（或下面那批根级文件）算"仓内路径"。
 *  白名单而不是"任何带斜杠的串"：`node:fs`、`./x`、URL、`@scope/pkg` 都不是仓内面。 */
const LEAD_DIRS: readonly string[] = ["src", "scripts", "tests", "docs", "fixtures", "outputs", "public"];
const ROOT_FILES: readonly string[] = ["AGENTS.md", "PROGRESS.md", "BLOCKED.md", "package.json", "pnpm-lock.yaml", "components.json", "electron.vite.config.ts"];

/** 扩展名名单**长的在前**、且整串以 `$` 收尾：第 82 页实测交替会把 `.json` 截成 `.js` ⇒ 造出 5 条假指针。
 *  这里不直接在整段文本上做路径正则，而是**先取引号串、再判它像不像仓内路径**——
 *  一步一职责，避免一条复杂正则同时错在"取字符串"和"认路径"两处。 */
const QUOTED = /["'`]([^"'`\n]{1,200})["'`]/g;
const EXT = /\.(tsx|ts|mts|cts|mjs|cjs|json|ya?ml|md|html|css|js)$/;

/** 一条引号串是不是"仓内某个面的路径"（可带 `:行号` 尾巴）。 */
export function repoPathIn(text: string): string | null {
  const clean = text.replace(/^\.\//, "").replace(/:\d+$/, "").trim();
  if (clean === "" || clean.includes(" ") || !EXT.test(clean)) return null;
  const top = clean.split("/")[0] ?? "";
  if (LEAD_DIRS.includes(top) || ROOT_FILES.includes(clean)) return clean;
  return null;
}

/** 抽一段文本里"长得像仓内路径"的字符串字面量（**提示级**：规则 177——文本提及不等于依赖）。 */
export function pathLiterals(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(QUOTED)) {
    const p = repoPathIn(m[1] ?? "");
    if (p !== null) out.add(p);
  }
  return [...out].sort();
}

/** 该文件在 import 图里的可达面（含类型边——"有没有人引"这一维就够归因用了）。
 *  文件不在图里（如 `.mts` 读数脚本、被忽略的 fixture）⇒ 返回 null，**调用方要说"未记"而不是"无依赖"**。 */
export function importClosureOf(file: string, g: Graph): string[] | null {
  if (!g.files.includes(file)) return null;
  const { seen } = closure([file], g, true);
  const out = [...seen].filter((f) => f !== file);
  return out;
}

export interface Attribution {
  hits: InputHit[];
  /** 一句话说明这一格**凭什么**这么说——没有这句话，读数的人会把空 hits 读成"没人垫"。 */
  note: string;
}

/** 两把尺各跑一遍，与在飞集合求交；同一文件两条都命中时只留 import（更强的那条）。 */
export function attributeInputs(
  file: string,
  opts: { graph: Graph; text: string | null; inFlight: ReadonlySet<string> },
): Attribution {
  const closure_ = importClosureOf(file, opts.graph);
  const hits: InputHit[] = [];
  const seen = new Set<string>();
  if (closure_ !== null) {
    for (const f of closure_) {
      if (!opts.inFlight.has(f) || f === file || seen.has(f)) continue;
      seen.add(f);
      hits.push({ file: f, via: "import 闭包" });
    }
  }
  const textHits = opts.text === null ? [] : pathLiterals(opts.text);
  for (const f of textHits) {
    if (!opts.inFlight.has(f) || f === file || seen.has(f)) continue;
    seen.add(f);
    hits.push({ file: f, via: "路径字面量（提示级，不是证明）" });
  }
  hits.sort((a, b) => a.file.localeCompare(b.file));
  const notes: string[] = [];
  if (closure_ === null) notes.push("不在 import 图里（图只收 src/tests/scripts 的 .ts）");
  if (opts.text === null) notes.push("文件文本读不到（多半已在途删除）");
  if (hits.length === 0) {
    const tail = notes.length > 0 ? "；未记原因：" + notes.join("，") : "；两把尺（import 闭包＋路径字面量）都没命中在飞集合";
    return { hits, note: "**取料面未记**＝没查到在飞依赖，不等于确认没人垫" + tail };
  }
  const hintOnly = hits.every((h) => h.via !== "import 闭包");
  return { hits, note: hintOnly ? "全部命中的是文本指针 ⇒ 提示级，要人工复判那一跳真不真" : "含 import 闭包命中 ⇒ 至少有一条是硬边" };
}
