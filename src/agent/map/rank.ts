// 符号地图·图与排名（§6.4）：自实现邻接表 + aider 边权规则（mul·√num_refs）+
// 个性化 PageRank 幂迭代。graphology 不支持 personalization → 自实现（§6.4 选型决议）。
import type { ImportRef, SymbolTag } from "./parse.js";
import { resolveModuleSpecifier } from "./import-edge.js";

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
  /** 该文件的跨文件依赖（`fileSymbols` 的第二个出口）。缺席 = 老取料面没给 ⇒ 只走同名全连，
   *  绝不因为「没带 imports」就少边（不许把新维度做成新的失效来源）。 */
  imports?: ImportRef[];
  /** 头注释摘要（`fileSymbols` 的第三个出口，词面检索的语料）。图不吃它——放在这里只因为
   *  图谱与检索语料**必须取自同一个数组**：另建一份 summary 表就有第二套取料面，
   *  缓存命中那支会给出「图里有它、检索看不见它」的第三种地图。 */
  summary?: string;
}

/** import 面的计数——每个数都得有人看，否则「接上了」与「接上但一条没吃到」在读端同形。 */
export interface ImportEdgeStats {
  /** 非类型的具名导入条数。 */
  refs: number;
  /** 吃成精确边的条数。 */
  edges: number;
  /** 说明符指向外部包（`node:`/pkg）⇒ 不该入图。 */
  external: number;
  /** 解析到了仓内文件，但那个文件里没有这个名字的 def（re-export 链、或对面是别名导出）。 */
  resolvedNoDef: number;
  /** `import type { … }`：本轮不入图（2026-09-23 裁决要求先分类型边/运行边）。 */
  typeOnlySkipped: number;
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
  /** import 面的五个计数（见 `ImportEdgeStats`）。 */
  importStats: ImportEdgeStats;
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

  // ---- import 面：把「本文件从对面取走了哪个名字」做成**精确边** ----
  // 三条设计决定，各钉一态：
  // ⑴ 只吃**解析得到且对面真有同名 def**的那一条 ⇒ 精确。解析不到（外部包）或对面没这个名字
  //    （re-export 链）时**不动**，让下面那支同名全连继续兜——新维度绝不让现有的边变少。
  // ⑵ 精确边一旦成立就把这个 ref 节点「钉住」，同名全连那支跳过它 ⇒ 这才了结 #9 的歧义：
  //    `import { execute } from "./a.js"` 不该顺手连到任何别处叫 `execute` 的定义。
  // ⑶ 类型导入不入图（`typeOnly`）。2026-09-23 的裁决要求先把类型边/运行边分开、并在读端分开呈现；
  //    在那之前把它们并进同一张名字图，等于把刚清出去的「同名不同实体假边」再请回来。
  const knownFiles = new Set(files.map((f) => f.file));
  const pinned = new Map<string, string>(); // refKey → 唯一正确的 defKey
  const importStats: ImportEdgeStats = { refs: 0, edges: 0, external: 0, resolvedNoDef: 0, typeOnlySkipped: 0 };
  for (const f of files) {
    for (const ir of f.imports ?? []) {
      if (ir.typeOnly) {
        importStats.typeOnlySkipped++;
        continue;
      }
      importStats.refs++;
      const target = resolveModuleSpecifier(f.file, ir.spec, knownFiles);
      if (!target) {
        importStats.external++;
        continue; // 外部包：不给它造节点，否则 `describe`/`expect` 这种名字会污染整张图
      }
      const defKey = nodeKey(target, ir.name, "def");
      if (!index.has(defKey)) {
        importStats.resolvedNoDef++;
        continue; // 对面没这个名字（re-export 链等）：留给你原来的样子，别把真依赖换成假精确
      }
      const refKey = nodeKey(f.file, ir.name, "ref");
      ensure(f.file, ir.name, "ref", ir.line); // 只用不用（re-export）的导入也要有节点，PageRank 才有可流的边
      pinned.set(refKey, defKey);
      importStats.edges++;
    }
  }

  // 名字级索引：def 计数与「同名 def 清单」一次建好。
  // 原实现「每个 ref 遍历全部节点找同名 def」与「每个 def 遍历全部节点找入边」
  // 是两处 O(N²)（400 文件规模下 ~10^8 次比较），这里各降为一次线性扫描。
  const defCount = new Map<string, number>();
  const defsByName = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.kind !== "def") continue;
    defCount.set(n.name, (defCount.get(n.name) ?? 0) + 1);
    const dk = nodeKey(n.file, n.name, "def");
    const list = defsByName.get(n.name);
    if (list) list.push(dk);
    else defsByName.set(n.name, [dk]);
  }

  // ref→def 边：同名 def 全连（aider 同构）
  const referencedDefs = new Set<string>(); // 收到过 ref 入边的 def key（自环判定的索引版）
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
    const pinnedTo = pinned.get(k);
    if (pinnedTo !== undefined) {
      // 这条 ref 由 import 说明符钉住了目标 ⇒ 只连那一个（歧义面见上面第 ⑵ 条）
      addEdge(k, pinnedTo, w);
      referencedDefs.add(pinnedTo);
      continue;
    }
    for (const defKey of defsByName.get(n.name) ?? []) {
      addEdge(k, defKey, w);
      referencedDefs.add(defKey);
    }
  }

  // def-only 节点自环 0.1（从未被引用的定义仍有最低存在感）
  for (const n of nodes) {
    if (n.kind !== "def") continue;
    const k = nodeKey(n.file, n.name, "def");
    if (!referencedDefs.has(k)) addEdge(k, k, 0.1);
  }

  return { nodes, index, adj, numRefs, mentioned, contextFiles, importStats };
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
  // dangling 判定是循环不变量：预计算一次，避免每次迭代为每个节点重建 key 字符串。
  const hasOut = new Array<boolean>(n);
  for (let i = 0; i < n; i++) hasOut[i] = g.adj.has(nodeKeyOf(g, i));

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
      if (!hasOut[i]) dangling += rank[i];
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

/** 排名后的节点（降序）。同分必须有次级键：
 *  PageRank 的浮点在结构对称的节点上会给**完全相同**的值（两个互不引用的同形文件就是），
 *  而只比 `b.r - a.r` 时这一位的次序就由 `g.nodes` 的插入序决定。扫描层在 #21 笔1 已经收成
 *  「mtime 降序＋rel 升序」，这一支是同一条判据没铺到的接缝——
 *  09-30 实测本仓当前没撞到同分（冷/热缓存、隔 95s 重建都逐字相同），所以登记为**潜在**而非现行偏差。 */
export function rankedNodes(g: BuiltGraph, ranks: number[]): MapNode[] {
  const byStr = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return g.nodes
    .map((n, i) => ({ node: n, r: ranks[i] ?? 0 }))
    .sort((a, b) => (b.r - a.r) || byStr(a.node.file, b.node.file) || byStr(a.node.name, b.node.name) || byStr(a.node.kind, b.node.kind))
    .map((x) => x.node);
}
