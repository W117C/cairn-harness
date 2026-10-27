// 词面检索：拿**文件自己写好的头注释＋路径**当语料，把自然语言问句接到符号地图上。
//
// 立案动因（10-02 现读，任务 #17）：接上 import 精确边之后，locate-recall 的 13 个真值文件里仍有
// 9 个的名次落在 1013–1949（4096 档只渲染 ~123 个节点所属文件）⇒ 对这批题，**排名这条路已封顶**。
// 把它们的头注释第一行与问句并排看，9/9 全部词面重叠（`usage-attribution.ts`「用量归因：一笔 usage
// 事件属于哪个模型」对问句「那笔用量到底属于哪个模型，在哪一层补上模型名」几乎逐字）。
// 缺的不是语义模型，是「仓库自己已经写下来的中文说明」——tree-sitter 那侧只抓标识符，注释整个没吃。
//
// 三条刻意的边界：
// · **零模型、零新依赖**：CJK 二元组＋拉丁词的倒排，不调 embedding。它买的是"词面重叠"这一档，
//   买不到同义改写（问句写"卡死"而注释写"停滞"就接不上）——那一档归裁决，不在这里冒充能力。
// · 输出**不伪装成排名结果**：渲染那一行自带"词面命中，不是排名"的口径，且不动 PageRank 的次序，
//   否则这条便宜通道会静默改写整张地图的排序（判卷也分不开两种坏法）。
// · 一切都有界：摘要按**码点**截断（半个字符都不许交出去，本仓 UTF-8 完整性那一族）。
//
// 本文件刻意**零依赖**（纯字符串函数）：token 估算留在渲染那一侧（`render.ts` 已经依赖 compaction 的
// 同一支估算），这里不 import 它——否则 `parse → retrieve → compaction` 会新增一条朝上层模块的边，
// 而摘要语料是解析层要用的东西，不该把依赖往上带。

/** 头注释摘要的码点上限（比 160 字大是浪费：这一行只用来做词面命中，不进上下文）。 */
export const SUMMARY_MAX_CODEPOINTS = 220;
/** 检索行最多列几个文件。 */
export const RETRIEVAL_MAX_FILES = 6;
/** df 超过 `N × 这个比例`的词当停用词（「文件」「模型」这种在 587 个文件里到处都有的词不给分）。 */
export const STOPWORD_DF_RATIO = 0.15;
/** 问句按**码点**截到这里再切词。用户一句话可能整份日志粘进来（外界文本有界性那一族：
 *  每个新吃外部文本的口都要自己封顶），而超长问句对词面命中没有额外价值——df 门槛已经把
 *  到处都有的词滤掉了，多出来的只有算力。 */
export const QUERY_MAX_CODEPOINTS = 2000;

/** 文件顶部那段注释（`//` 连续行，或**跨行**的 `/*…*\/` 块），压成一行并按码点截断。
 *  只吃**顶部**：中段注释是解释具体分支的，拿来当"这个文件是干什么的"会指错方向。
 *  跨行的块注释必须吃完：只读首行 ⇒ 全仓那些 `/** … *\/` 写的文件摘要恒空，
 *  检索对这些文件永远"问什么都不命中"，而症状与"这文件没注释"同形（规则 261 那一族）。 */
export function commentSummary(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    const l = raw.trim();
    if (inBlock) {
      const end = l.indexOf("*/");
      out.push(end >= 0 ? l.slice(0, end) : l);
      if (end >= 0) break; // 块在这里收尾
      continue;
    }
    if (l === "") {
      if (out.length > 0) break; // 顶注释与代码之间的空行 = 结束
      continue;                  // 前置空行/shebang 之后还没开始
    }
    if (l.startsWith("#!")) continue;
    if (l.startsWith("//")) { out.push(l.slice(2)); continue; }
    if (l.startsWith("/*")) {
      const end = l.indexOf("*/", 2);
      out.push(end >= 0 ? l.slice(2, end) : l.slice(2));
      if (end >= 0) break; // 单行块注释：吃完就结束
      inBlock = true;
      continue;
    }
    break; // 第一个非注释行 = 文件真开始了
  }
  // JSDoc 那形状每行顶着一个 `*`：拼行前先剥掉，否则它留在摘要中间变成噪声词。
  const flat = out.map((s) => s.replace(/^\*+/, "")).join(" ").replace(/\s+/g, " ").trim();
  return Array.from(flat).slice(0, SUMMARY_MAX_CODEPOINTS).join("");
}

/** 词面切分：CJK **连续串**出二元组（单字不成词，噪声大 ⇒ 长度 1 的串直接不收），
 *  拉丁/数字词按 `[A-Za-z_][A-Za-z0-9_]{2,}`（≥3 字符，转小写）。
 *  路径也进语料 ⇒ 问句里写 `sandbox.ts` 时 `sandbox` 这一刀能对上文件名。
 *  区间用转义写：BMP 常用汉字＋扩展 A＋兼容表意文字，避免把区间端点写成字面字符后被复制粘贴磨掉。 */
const CJK_RUN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]{2,}/gu;
export function tokensOf(text: string): string[] {
  const out = new Set<string>();
  for (const run of text.match(CJK_RUN_RE) ?? []) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  }
  for (const w of text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) out.add(w.toLowerCase());
  return [...out];
}

export interface RetrievalEntry {
  file: string;
  /** `commentSummary` 的产物（与 tags/imports 同一次解析产出）。 */
  summary: string;
}

export interface Retrieved {
  file: string;
  score: number;
  /** 命中的词（读数用：不写出来的话，"命中 3 个文件"与"命中 3 个文件、靠的是『用量』这一个词"同形）。 */
  matched: string[];
}

/** 问句先按码点封顶再切词（半个字符都不许切进去：与摘要那一侧同一个量法）。 */
export function boundQuery(query: string): string {
  return Array.from(query).slice(0, QUERY_MAX_CODEPOINTS).join("");
}

/** 问句 → 候选文件（分数降序；同分按 rel 升序，绝不把同分次序交给遍历顺序）。 */
export function retrieveByQuery(
  query: string,
  entries: readonly RetrievalEntry[],
  opts: { k?: number; stopwordDfRatio?: number } = {},
): Retrieved[] {
  const k = opts.k ?? RETRIEVAL_MAX_FILES;
  const ratio = opts.stopwordDfRatio ?? STOPWORD_DF_RATIO;
  const queryTokens = tokensOf(boundQuery(query));
  if (queryTokens.length === 0 || entries.length === 0 || k <= 0) return [];
  // 每文件的词集（路径并入摘要一起切：语料=「这个文件叫什么」＋「它自己说自己是干什么的」）
  const perFile = entries.map((e) => ({ file: e.file, tokens: new Set(tokensOf(e.summary + " " + e.file)) }));
  const df = new Map<string, number>();
  for (const f of perFile) for (const t of f.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = entries.length;
  const stopAt = Math.max(3, Math.floor(n * ratio));
  const idf = new Map<string, number>();
  for (const [t, d] of df) if (d <= stopAt) idf.set(t, Math.log(1 + n / d));
  const scored: Retrieved[] = [];
  for (const f of perFile) {
    let score = 0;
    const matched: string[] = [];
    for (const t of queryTokens) {
      const w = idf.get(t);
      if (w === undefined || !f.tokens.has(t)) continue;
      score += w;
      matched.push(t);
    }
    if (score > 0) scored.push({ file: f.file, score, matched: matched.sort() });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return scored.slice(0, k);
}

/** 检索行的**行首标记**（唯一事实源）：取料面（`probe-locate-recall.ts` 要把这一行从排名正文里
 *  分出去）与生成面共用它。写成副本的话，改措辞就会让那条尺静默读不到检索面。 */
export const RETRIEVAL_LINE_HEAD = "[map] 按你这句问话的";

/** 这一行是不是检索行（只判行首，别拿"含 `[map]`"当判据——降级说明那句也以它开头）。 */
export function isRetrievalLine(line: string): boolean {
  return line.startsWith(RETRIEVAL_LINE_HEAD);
}

/** 渲染那一行（空串 = 没命中 ⇒ 什么都不加，不许印「命中 0 个」这种噪声）。
 *  口径写死在句子里：**词面命中**，不是地图排名——否则模型会把它当成"这些文件最重要"。 */
export function renderRetrievalLine(items: readonly Retrieved[]): string {
  if (items.length === 0) return "";
  const head = RETRIEVAL_LINE_HEAD + "**词面**命中的候选文件（依据＝文件自己的头注释与路径，" +
    "不是重要性排名，也不是调用关系；先读它们，再决定要不要走地图）：";
  return head + items.slice(0, RETRIEVAL_MAX_FILES).map((r) => r.file).join("、");
}
