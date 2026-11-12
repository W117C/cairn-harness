/** 延迟工具目录的纯检索面：给定目录与查询，按确定性 BM25 排序返回候选。
 *
 *  目录只描述「有什么、怎么调」；它不携带权限判定，也不激活任何东西。
 *  激活仍走各工具自己的门（MCP 的 `mcp_activate` + `gatedMcpTool`）。 */

export interface ToolCatalogEntry {
  /** 可执行名（静态工具名 / MCP scoped 名）。 */
  name: string;
  description: string;
  /** 与执行面逐字相同的那一份 schema。 */
  inputSchema: Record<string, unknown>;
  source: "static" | "mcp";
  /** MCP 的 `plugin/server` 键；静态工具缺席。 */
  server?: string;
  /** 此刻是否已进入模型面。只作提示，不是权限。 */
  active: boolean;
  /** 调用哪个元工具可以让它进入下一轮工具面（仅未激活的 MCP 工具）。 */
  activation?: { tool: "mcp_activate"; server: string; tool_name: string };
}

export interface ToolSearchHit {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolCatalogEntry["source"];
  server?: string;
  active: boolean;
  activation?: ToolCatalogEntry["activation"];
  score: number;
  matched: string[];
}

export interface ToolSearchOutcome {
  ok: boolean;
  /** ok=false 时的原因（空查询 / 超长查询）；不出部分结果。 */
  error?: string;
  query: string;
  hits: ToolSearchHit[];
  /** 目录里实际参与打分的条目数。 */
  scanned: number;
  /** 目录超过语义扫描上限，有条目未参与打分。 */
  truncated: boolean;
}

export const TOOL_SEARCH_MAX_QUERY_CHARS = 200;
export const TOOL_SEARCH_MAX_RESULTS = 8;
export const TOOL_SEARCH_DEFAULT_RESULTS = 5;
/** 语义打分上限。精确工具名的查找仍覆盖全目录。 */
export const TOOL_SEARCH_SCAN_LIMIT = 512;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  const out: string[] = [];
  for (const word of words) {
    out.push(word);
    // CJK 没有空格分词：整段按字二元组补一遍，避免「回显」只能靠整串命中。
    if (/[\u3400-\u9fff]/u.test(word)) {
      const chars = Array.from(word);
      if (chars.length === 1) out.push(chars[0]!);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
    }
  }
  return out;
}

function uniqueTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

interface ScoredEntry {
  entry: ToolCatalogEntry;
  score: number;
  matched: string[];
}

/** 名称与描述一起进打分面；名称 token 额外加权。
 *  精确标识符（完整名 / bare 名 / 查询是名字的一段）享有显式加成，
 *  这样「找 `echo`」不会被一段长描述里的语义散文压过去。 */
function scoreEntry(entry: ToolCatalogEntry, queryTokens: readonly string[], queryRaw: string, idf: Map<string, number>, avgdl: number): ScoredEntry | null {
  const nameTokens = tokenize(entry.name);
  const descTokens = tokenize(entry.description + " " + (entry.server ?? ""));
  const all = [...nameTokens, ...descTokens];
  if (all.length === 0) return null;
  const tf = new Map<string, number>();
  for (const t of all) tf.set(t, (tf.get(t) ?? 0) + 1);
  const dl = all.length;
  let score = 0;
  const matched: string[] = [];
  for (const q of queryTokens) {
    const idfValue = idf.get(q);
    if (idfValue === undefined) continue;
    const freq = tf.get(q);
    if (freq === undefined) continue;
    score += idfValue * (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
    if (!matched.includes(q)) matched.push(q);
  }
  const q = queryRaw.trim().toLowerCase();
  const name = entry.name.toLowerCase();
  const bareName = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  if (q === name || q === bareName) score += 12;
  else if (nameTokens.includes(q)) score += 5;
  else if (q.length >= 3 && name.includes(q)) score += 2;
  if (q.length >= 3 && entry.description.toLowerCase().includes(q)) score += 1.5;
  if (score <= 0) return null;
  return { entry, score: Math.round(score * 10_000) / 10_000, matched: matched.slice(0, 12) };
}

/** 确定性检索：完整调用名优先，其余按分数降序、名字升序。 */
export function searchToolCatalog(
  catalog: readonly ToolCatalogEntry[],
  query: string,
  opts: { maxResults?: number; scanLimit?: number } = {},
): ToolSearchOutcome {
  const raw = query.trim();
  if (raw === "") {
    return { ok: false, error: "tool_search: query 必填（要查能力就用一句话描述；不要空查）", query: raw, hits: [], scanned: 0, truncated: false };
  }
  if (raw.length > TOOL_SEARCH_MAX_QUERY_CHARS) {
    return {
      ok: false,
      error: "tool_search: query 超过 " + String(TOOL_SEARCH_MAX_QUERY_CHARS) + " 字符（收到 " + String(raw.length) + "）——收窄到要查的能力名",
      query: raw,
      hits: [],
      scanned: 0,
      truncated: false,
    };
  }
  const scanLimit = Math.max(1, opts.scanLimit ?? TOOL_SEARCH_SCAN_LIMIT);
  const scannedCatalog = catalog.slice(0, scanLimit);
  const truncated = catalog.length > scannedCatalog.length;
  // An exact name is an address. Reserve a slot for it without widening the BM25 scan.
  const normalizedName = raw.toLowerCase();
  const exactIndex = catalog.findIndex((entry) => entry.name.toLowerCase() === normalizedName);
  const exact = catalog[exactIndex];
  if (exact !== undefined && exactIndex >= scannedCatalog.length) {
    scannedCatalog[scannedCatalog.length - 1] = exact;
  }
  const queryTokens = [...uniqueTokens(raw)];
  if (queryTokens.length === 0) {
    return { ok: true, query: raw, hits: [], scanned: scannedCatalog.length, truncated };
  }
  const docs = scannedCatalog.map((entry) => tokenize(entry.name + " " + entry.description + " " + (entry.server ?? "")));
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.length;
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgdl = docs.length === 0 ? 0 : Math.max(1, totalLen / docs.length);
  const idf = new Map<string, number>();
  for (const [t, count] of df) {
    idf.set(t, Math.log(1 + (docs.length - count + 0.5) / (count + 0.5)));
  }
  const limit = Math.min(TOOL_SEARCH_MAX_RESULTS, Math.max(1, opts.maxResults ?? TOOL_SEARCH_DEFAULT_RESULTS));
  const hits = scannedCatalog
    .map((entry) => scoreEntry(entry, queryTokens, raw, idf, avgdl))
    .filter((hit): hit is ScoredEntry => hit !== null)
    .sort((left, right) => Number(right.entry === exact) - Number(left.entry === exact) ||
      right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .slice(0, limit)
    .map(({ entry, score, matched }) => {
      const activation = entry.activation ?? (entry.source === "mcp" && !entry.active && entry.server !== undefined
        ? { tool: "mcp_activate" as const, server: entry.server, tool_name: entry.name }
        : undefined);
      return {
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        source: entry.source,
        ...(entry.server !== undefined ? { server: entry.server } : {}),
        active: entry.active,
        ...(activation !== undefined ? { activation } : {}),
        score,
        matched,
      };
    });
  return { ok: true, query: raw, hits, scanned: scannedCatalog.length, truncated };
}
