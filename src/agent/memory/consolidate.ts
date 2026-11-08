// M7 · 系统级巩固（「睡眠 pass」）：会话结束在 distill 里跑一次的确定性整理，零模型调用。
//
// 这是从人脑记忆与 2024-26 SOTA 记忆系统（Mem0/Zep/Letta/HippoRAG 等，台账见 PROGRESS 对应页）
// 合并出来的最小完备机制集，每条都能指回一个出处：
// · **补偿性学习系统（CLS，McClelland）**：海马体快写（会话 JSONL + remember 即时落盘）
//   与新皮层慢整理（本 pass：衰减、休眠、查重）分开跑——快通道保证「当晚就能用」，
//   慢通道保证「长期不烂」；
// · **睡眠 replay / 突触稳态（Tononi；Richards & Bhatt 2017「遗忘即学习」）**：巩固时
//   全库按半衰期衰减一次（整体削弱）、把又弱又久没用过的条目标休眠（保留相对重要的）——
//   遗忘不是删除文件，是**降低提取优先级**：休眠条目索引行不注、正文不注，但正文仍在盘上，
//   记忆面板可见、词面强命中可唤醒（墓碑态，同 Human-Inspired Memory Architecture 的 L5）；
// · **再巩固（Nader）**：记忆被重新触碰时可被改写——这里落成「查重递条子」：确定性检出
//   疑似重复对，写进沉淀指令让**下一轮蒸馏**经 remember op=replace（原审批面不动）合并；
//   本 pass 自己不合并不删除：删除仅用户（§8.1.7），合并需要语义判断（确定性查重只给证据）。
//
// 与 lessons.ts 的分工：lessons 提炼「这次失败该学什么」（写入侧），本 pass 整理「库里面
// 已经有什么」（维护侧）。两个消费者、两种生命周期，不合并。
import { tokensOf } from "../map/retrieve.js";
import { decayStrength, shouldDormant, type MemoryStat } from "./strength.js";
import { listTopics, readStats, readTopicBody, updateStats, type TopicEntry } from "./store.js";

export interface DuplicatePair {
  a: string;
  b: string;
  /** 词集 Jaccard 相似度 0..1。 */
  score: number;
}

export interface ConsolidationReport {
  dir: string;
  topics: number;
  /** 这次跑完强度账里一共多少条（含新建账）。 */
  tracked: number;
  /** 强度有下降的条数（「衰减了多少」的读数面，具体值在账本里）。 */
  decayed: number;
  /** 本次新标休眠的 topic（已休眠的不重复计）。 */
  dormantMarked: string[];
  /** 检出的疑似重复对（同 type、词集 Jaccard ≥ 阈值；条数有界）。 */
  duplicates: DuplicatePair[];
}

/** 词集 Jaccard 的入选阈值。0.6 = 六成词面重合：同一件事两次独立沉淀的常见形状；
 *  低于它的大多是「同域不同事」，自动并是乱并。 */
export const DUPLICATE_JACCARD_MIN = 0.6;
/** 查重报告条数上限（O(n²) 全对比较的**输出**必须有界；n ≤ 200 也只报最像的 5 对）。 */
export const DUPLICATE_PAIRS_MAX = 5;
/** 参与查重的正文字节帽：超大正文（写入侧失控的信号）不进比较——两份 100KB 的「重复」
 *  该由用户在面板里看，不该塞进指令。 */
const DUP_BODY_MAX_BYTES = 16 * 1024;
/** 陈账超过现存 topic 数这个倍数时，即使强度没变化也落一次盘清账（有界那一条的落点）。 */
const STATS_ENTRIES_FACTOR = 2;

/** 会话结束的确定性整理（对**一个**记忆目录跑；项目层与全局层各跑一次）。
 *  只写 memory-stats.json，**绝不触碰** topic 正文与 MEMORY.md（判卷 canary 钉这条）。
 *  强度整理整段在 dir 锁里（`updateStats`）：与命中落账（inject 侧 flush）并发时不丢更新。
 *  失败语义：listTopics/锁内 IO 失败 → 抛给调用方（distill 侧 emit 留痕）；账本损坏由
 *  readStats 内部按空账告警继续——强度模型挂了不等于整理挂了。 */
export async function consolidateMemoryDir(opts: {
  dir: string;
  nowISO: string;
  onCorrupt?: (reason: string) => void;
}): Promise<ConsolidationReport> {
  const topics = await listTopics(opts.dir);
  // 查重在锁外跑：只读 topic 正文与一份可能略旧的账（休眠过滤用），不与强度账竞争。
  // 旧账最坏后果：把一条即将休眠的条目也算进比较，多报一对——查重是「递条子」不是判决，可容。
  const staleStats = await readStats(opts.dir, opts.onCorrupt);
  const duplicates = await detectDuplicates(opts.dir, topics, staleStats);

  return await updateStats(opts.dir, async (stats) => {
    const next: Record<string, MemoryStat> = {};
    let decayed = 0;
    const dormantMarked: string[] = [];
    for (const t of topics) {
      const prev = stats[t.topic];
      if (prev === undefined) {
        // 新建账：强度 1（「刚写入」），锚点取 topic 自己的 modified——modified 缺失（手写文件）
        // 用 nowISO（衰减从今天起算，不从盘古开天算）。
        next[t.topic] = { topic: t.topic, hits: 0, lastRetrieved: t.modified || opts.nowISO, strength: 1 };
        continue;
      }
      const strength = decayStrength(prev.strength, prev.lastRetrieved, opts.nowISO);
      if (strength < prev.strength) decayed += 1;
      const dormant = prev.dormant === true || shouldDormant({ ...prev, strength }, opts.nowISO);
      if (dormant && prev.dormant !== true) dormantMarked.push(t.topic);
      next[t.topic] = { topic: t.topic, hits: prev.hits, lastRetrieved: prev.lastRetrieved, strength, ...(dormant ? { dormant: true } : {}) };
    }
    // 本会话刚被 RECALL 唤醒的条目可能还带 dormant 标记（落账在 flush，先于本 pass 跑完）：
    // 它有更新的 lastRetrieved，shouldDormant 不会再度判休，上面的分支已按非休眠落账。
    const report: ConsolidationReport = {
      dir: opts.dir,
      topics: topics.length,
      tracked: Object.keys(next).length,
      decayed,
      dormantMarked,
      duplicates,
    };
    // 账本只在有变化（或陈账该清）时写——纯读会话不该每次都 touch 盘。
    // 陈账清理是形状保证而不是一条独立逻辑：next 只装现存 topic，已删 topic 的旧账天然不进新账。
    const stale = Object.keys(stats).length > Object.keys(next).length * STATS_ENTRIES_FACTOR;
    const wrote = changed(stats, next) || stale;
    return { value: report, next: wrote ? next : null };
  });
}

/** 查重（纯读）：**同 type**、双方按旧账未休眠、词集 Jaccard ≥ 阈值；按相似度降序取前 K 对。
 *  同 type 是硬条件：同一段事实沉淀成 project 与 reference 是**两种记忆**，不是重复
 *  （类型本身就是写入时的用途标注，跨 type 合并会把用途抹掉）。 */
async function detectDuplicates(dir: string, topics: TopicEntry[], stats: Record<string, MemoryStat>): Promise<DuplicatePair[]> {
  const bodies = new Map<string, { type: string; tokens: Set<string> }>();
  for (const t of topics) {
    if (t.type === "unknown" || t.bytes > DUP_BODY_MAX_BYTES) continue;
    if (stats[t.topic]?.dormant === true) continue;
    const raw = await readTopicBody(dir, t.topic);
    if (raw === null) continue;
    bodies.set(t.topic, { type: t.type, tokens: new Set(tokensOf(t.topic + " " + raw)) });
  }
  const names = [...bodies.keys()].sort();
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const ta = bodies.get(a)!;
      const tb = bodies.get(b)!;
      if (ta.type !== tb.type) continue;
      let inter = 0;
      for (const tok of ta.tokens) if (tb.tokens.has(tok)) inter += 1;
      const union = ta.tokens.size + tb.tokens.size - inter;
      if (union === 0) continue;
      const score = inter / union;
      if (score >= DUPLICATE_JACCARD_MIN) pairs.push({ a, b, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1));
  return pairs.slice(0, DUPLICATE_PAIRS_MAX);
}

/** 查重报告 → 沉淀指令里的「合并条子」（无重复 → 空串，指令逐字不变）。
 *  合并动作**只指给 remember op=replace**：走原审批/免批分层，不新增写入口；
 *  条子只报证据（哪两层哪两题、相似度），不替模型下「必删」的结论。 */
export function consolidationDigest(
  reports: readonly { scope: "project" | "global"; report: ConsolidationReport }[],
): string {
  const lines: string[] = [];
  for (const { scope, report } of reports) {
    for (const d of report.duplicates) {
      lines.push("- [" + (scope === "project" ? "项目层" : "全局层") + "] " + d.a + " ↔ " + d.b + "（词面相似度 " + d.score.toFixed(2) + "）");
    }
  }
  if (lines.length === 0) return "";
  return "[巩固报告·疑似重复主题] 以下条目词面高度重合，像是同一件事沉淀了两次：\n" + lines.join("\n") +
    "\n若你确认它们是同一件事：用 remember 的 op=replace（scope 对应上面标注的层）把旧主题改写成合并后的内容（仍走既定审批分层），" +
    "不要新建第三个重复主题；不确定就保持现状并说明。";
}

function changed(before: Record<string, MemoryStat>, after: Record<string, MemoryStat>): boolean {
  const ak = Object.keys(after);
  if (Object.keys(before).length !== ak.length) return true;
  for (const k of ak) {
    const b = before[k];
    const a = after[k];
    if (b === undefined) return true;
    if (b.hits !== a.hits || b.lastRetrieved !== a.lastRetrieved || b.strength !== a.strength || (b.dormant === true) !== (a.dormant === true)) return true;
  }
  return false;
}
