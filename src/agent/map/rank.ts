// 符号地图·图与排名（§6.4）：自实现邻接表 + aider 边权规则（mul·√num_refs）+
// 个性化 PageRank 幂迭代。graphology 不支持 personalization → 自实现（§6.4 选型决议）。
import type { SymbolTag } from "./parse.js";

// ---- 数据结构 ----
/** 图节点：(文件, 标识符) 对——aider 同构。 */
export interface MapNode {
  file: string; // workspace 相对路径
  name: string; // 标识符
  kind: "def" | "ref";
  /** 首次出现行（1-based，渲染用）。 */
  line: number;
}

export function nodeKey(file: string, name: string, kind: "def" | "ref"): string {
  return kind + "\u0000" + file + "\u0000" + name;
}

/** 邻接表（有向带权）；adj[u] = Map<v, weight>。 */
export type Adj = Map<string, Map<string, number>>;

// ---- 构图 ----
export interface FileTagsInput {
  file: string;
  tags: SymbolTag[];
}

export interface GraphBuildOptions {
  /** 对话中提到的标识符（×10）。 */
  mentionedIdents?: Iterable<string>;
  /** 当前上下文文件（referencer 是它 → ×50；personalization 加权）。 */
  contextFiles?: Iterable<string>;
  /** 缺省 0.85。 */
  damping?: number;
}

export interface BuiltGraph {
  nodes: MapNode[];
  index: Map<string, number>; // nodeKey → 节点序号
  adj: Adj; // ref 节点 → def 节点
  /** def-only 节点自环 0.1 在 adj 里（构图期写入，幂迭代天然处理）。 */
  numRefs: Map<string, number>; // refKey → 该 ref 节点里标识符的出现次数（√num_refs 用）
  mentioned: Set<string>;
  contextFiles: Set<string>;
}

/** 标识符池（构图/渲染共用的名字级索引）：name → def 节点 key 列表。 */
export function defSitesOf(g: BuiltGraph, name: string): string[] {
  const out: string[] = [];
  for (const n of g.nodes) {
    if (n.kind === "def" && n.name === name) out.push(nodeKey(n.file, n.name, "def"));
  }
  return out;
}

/**
 * 构图：ref→def 边权 = mul·√num_refs。
 * mul 规则（aider 照抄）：mentioned ×10；referencer ∈ contextFiles ×50；
 * 标识符长度≥8 ×10；下划线开头 ×0.1；定义点>5 ×0.1。def-only 节点自环 0.1。
 */
export function buildGraph(files: FileTagsInput[], opts: GraphBuildOptions = {}): BuiltGraph {
  const mentioned = new Set(opts.mentionedIdents ?? []);
  const contextFiles = new Set(opts.contextFiles ?? []);

  const nodes: MapNode[] = [];
  const index = new Map<string, number>();
  const ensure = (file: string, name: string, kind: "def" | "ref", line: number): number => {
    const k = nodeKey(file, name, kind);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ file, name, kind, line });
      index.set(k, i);
    } else {
      // 保留最早（最靠顶）的行号
      const n = nodes[i];
      if (line < n.line) n.line = line;
    }
    return i;
  };

  for (const f of files) {
    for (const t of f.tags) {
      ensure(f.file, t.name, t.kind, t.line);
    }
  }

  const adj: Adj = new Map();
  const addEdge = (u: string, v: string, w: number): void => {
    let m = adj.get(u);
    if (!m) {
      m = new Map();
      adj.set(u, m);
    }
    m.set(v, (m.get(v) ?? 0) + w);
  };

  // 每个 ref 节点的 num_refs = 该文件里该标识符的出现次数（def+ref 计次，aider 同口径）
  const numRefs = new Map<string, number>();
  for (const f of files) {
    const perName = new Map<string, number>();
    for (const t of f.tags) perName.set(t.name, (perName.get(t.name) ?? 0) + 1);
    for (const t of f.tags) {
      if (t.kind !== "ref") continue;
      numRefs.set(nodeKey(f.file, t.name, "ref"), perName.get(t.name) ?? 1);
    }
  }

  // def 计数（定义点 >5 的常见名降权）
  const defCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind === "def") defCount.set(n.name, (defCount.get(n.name) ?? 0) + 1);
  }

  // ref→def 边：同名 def 全连（aider 同构）
  for (const n of nodes) {
    if (n.kind !== "ref") continue;
    const k = nodeKey(n.file, n.name, "ref");
    let mul = 1;
    if (mentioned.has(n.name)) mul *= 10;
    if (contextFiles.has(n.file)) mul *= 50;
    if (n.name.length >= 8) mul *= 10;
    if (n.name.startsWith("_")) mul *= 0.1;
    if ((defCount.get(n.name) ?? 0) > 5) mul *= 0.1;
    const w = mul * Math.sqrt(numRefs.get(k) ?? 1);
    for (const n2 of nodes) {
      if (n2.kind === "def" && n2.name === n.name) {
        addEdge(k, nodeKey(n2.file, n2.name, "def"), w);
      }
    }
  }

  // def-only 节点自环 0.1（从未被引用的定义仍有最低存在感）
  for (const n of nodes) {
    if (n.kind !== "def") continue;
    const k = nodeKey(n.file, n.name, "def");
    const hasIncoming = nodes.some((n2) => n2.kind === "ref" && adj.get(nodeKey(n2.file, n2.name, "ref"))?.has(k));
    if (!hasIncoming) addEdge(k, k, 0.1);
  }

  return { nodes, index, adj, numRefs, mentioned, contextFiles };
}

/** 边权单边查询（单测「边权随 num_refs 单调」用）。 */
export function edgeWeight(g: BuiltGraph, fromFile: string, name: string, toFile: string): number {
  return g.adj.get(nodeKey(fromFile, name, "ref"))?.get(nodeKey(toFile, name, "def")) ?? 0;
}

// ---- 个性化 PageRank（幂迭代）----
export interface RankOptions {
  damping?: number;
  /** 收敛阈值：两次迭代的 L1 差 < eps 即停。 */
  eps?: number;
  /** 迭代上限（防不收敛）。 */
  maxIterations?: number;
  /** personalization 强度：命中节点权重 = base × k（缺省 10）。 */
  personalizationBoost?: number;
  /** 输出迭代次数（单测「收敛判定有效」用）。 */
  onIterations?: (iters: number) => void;
}

/**
 * 加权 PageRank + personalization。personalization：上下文文件的 ref 节点与
 * mentioned 标识符的节点获得额外静态权重（实测语义：被提及的标识符排名上升）。
 */
export function personalizedPageRank(g: BuiltGraph, opts: RankOptions = {}): number[] {
  const damping = opts.damping ?? 0.85;
  const eps = opts.eps ?? 1e-8;
  const maxIterations = opts.maxIterations ?? 100;
  const boost = opts.personalizationBoost ?? 10;

  const n = g.nodes.length;
  if (n === 0) {
    opts.onIterations?.(0);
    return [];
  }

  // personalization 向量：base 1，命中（mentioned 名字 / 上下文文件）×boost，再归一
  const p = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    const node = g.nodes[i];
    if (g.mentioned.has(node.name) || g.contextFiles.has(node.file)) p[i] = boost;
  }
  const pSum = p.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) p[i] /= pSum;

  let rank = new Array<number>(n).fill(1 / n);
  // 出边权重归一（列随机）
  const outW = new Map<string, number>();
  for (const [u, m] of g.adj) {
    let s = 0;
    for (const w of m.values()) s += w;
    outW.set(u, s);
  }

  let iters = 0;
  for (; iters < maxIterations; iters++) {
    const next = new Array<number>(n).fill(0);
    for (const [u, m] of g.adj) {
      const ui = g.index.get(u);
      if (ui === undefined) continue;
      const ru = rank[ui];
      const total = outW.get(u) ?? 1;
      for (const [v, w] of m) {
        const vi = g.index.get(v);
        if (vi === undefined) continue;
        next[vi] += (damping * ru * w) / total;
      }
    }
    // dangling 质量（无出边节点）按 personalization 摊回
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const u = nodeKeyOf(g, i);
      if (!g.adj.has(u)) dangling += rank[i];
    }
    for (let i = 0; i < n; i++) next[i] += (1 - damping) * p[i] + damping * dangling * p[i];
    // L1 差 < eps 即停（收敛判定）
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(next[i] - rank[i]);
    rank = next;
    if (diff < eps) {
      iters++;
      break;
    }
  }
  opts.onIterations?.(iters);
  return rank;
}

function nodeKeyOf(g: BuiltGraph, i: number): string {
  const n = g.nodes[i];
  return nodeKey(n.file, n.name, n.kind);
}

/** 排名后的节点（降序）。 */
export function rankedNodes(g: BuiltGraph, ranks: number[]): MapNode[] {
  return g.nodes
    .map((n, i) => ({ node: n, r: ranks[i] ?? 0 }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.node);
}
