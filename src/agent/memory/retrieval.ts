// M7 · 词面检索选材（纯函数，零 IO）：把「本轮问话」接到记忆主题库上，选出 top-k 条正文注入。
//
// 神经映射：提取线索/编码特异性（Tulving）——成功的提取取决于**问话线索与编码时的词面匹配**；
// 索引行是每条记忆「自己说自己是干什么的」，拿它当语料 = 拿编码时的措辞去对提取时的措辞。
// 扩散激活（spreading activation）的最小版本：休眠条目平时不进检索面，但**词面强命中**可以唤醒
// （线索足够强时，弱痕迹也能被取出——这正是「唤醒」要单独设一道更高门槛的原因）。
//
// 三条刻意的边界（与 map/retrieve.ts 同族纪律）：
// · **零模型、零新依赖**：切词与 idf 口径**复用 map/retrieve 的 tokensOf**（CJK 二元组 + 拉丁词），
//   同一把尺不另立事实源；买的是词面重叠这一档，买不到同义改写——那一档留给将来接 embedding，
//   不在这里冒充能力；
// · **不伪装成重要性排名**：RECALL 段的抬头与每行的命中词都写明「词面命中」；强度只做
//   同分邻近的微调（0.5 + 0.5×strength），绝不改写词面分的次序主干；
// · 一切有界：问句经 boundQuery 封顶、摘录按**码点**截断（UTF-8 完整性那一族）。
import { boundQuery, tokensOf } from "../map/retrieve.js";
import { decayStrength, type MemoryStat } from "./strength.js";

/** 一次选材的输入条目：词面语料 = topic 名 + 索引摘要行（**不读全文**——全文只给选中的 top-k，
 *  评分语料用索引行已经足够，整库读正文会把每轮注入变成 O(库×正文) 的 IO）。 */
export interface RecallCandidate {
  topic: string;
  type: string;
  digest: string;
  /** 强度账（缺省 = 无账：强度按 1.0 处理、不休眠——新建条目不该被强度模型压着出不了场）。 */
  stat?: MemoryStat;
}

/** 正文（选中的条目才由调用方读盘填进来；读不动的那一条整个跳过——无正文不注，与 lessons 的
 *  「无出处不注入」同一道门）。 */
export interface RecallInput extends RecallCandidate {
  body: string | null;
}

export interface RecallPick {
  topic: string;
  type: string;
  /** 首行摘要（注入行用，不搬正文头一行再截一次）。 */
  headline: string;
  /** 有界摘录（按码点截断，行宽另由注入侧折行）。 */
  excerpt: string;
  /** 命中的词（读数可见：凭什么命中要说出来，同 map/retrieve 的 matched 口径）。 */
  matched: string[];
  /** 词面分（idf 加和，未乘强度——读数要能对上「命中词表」）。 */
  score: number;
  /** 休眠条目被强命中唤醒（注入行要如实标注；落账在 bumpStat 里清休眠）。 */
  woke: boolean;
}

/** 选入条数上限。3 条 × ~1.2K 字符摘录 ≈ 最多 ~1K token，在 6K 预算内是「补一口」，不是搬库。 */
export const RECALL_MAX_TOPICS = 3;
/** 摘录的码点帽（整段正文超长时截断——记忆正文本来就不该长，超长是写入侧的问题）。 */
export const RECALL_EXCERPT_MAX_CHARS = 1_200;
/** 入选词面分下限（idf 加和）：低于它说明只有一两个弱词碰上，宁缺勿滥——RECALL 段的每一条
 *  都占预算，噪声条目会把「按需 read_file」那条出路挤掉。 */
export const RECALL_MIN_SCORE = 1.5;
/** 休眠唤醒门槛（高于入选门槛）：唤醒是有代价的（写账、清休眠标记），只有明显强的线索才配。 */
export const WAKE_MIN_SCORE = 4.0;
/** df 超过 N×这个比例的词当停用词（沿 map/retrieve 同值：库里到处都有的词不给分）。 */
const STOPWORD_DF_RATIO = 0.15;

/** 词面打分：idf 加和（与 map/retrieve.retrieveByQuery 同式，但语料/候选形状不同，
 *  不硬凑共用一个函数——那会把「文件检索」与「记忆检索」的演化绑死在一起）。 */
export function scoreRecallCandidates(
  query: string,
  candidates: readonly RecallCandidate[],
): { topic: string; score: number; matched: string[] }[] {
  const queryTokens = tokensOf(boundQuery(query));
  if (queryTokens.length === 0 || candidates.length === 0) return [];
  const perTopic = candidates.map((c) => ({ topic: c.topic, tokens: new Set(tokensOf(c.topic + " " + c.digest)) }));
  const df = new Map<string, number>();
  for (const t of perTopic) for (const tok of t.tokens) df.set(tok, (df.get(tok) ?? 0) + 1);
  const n = candidates.length;
  const stopAt = Math.max(3, Math.floor(n * STOPWORD_DF_RATIO));
  const idf = new Map<string, number>();
  for (const [tok, d] of df) if (d <= stopAt) idf.set(tok, Math.log(1 + n / d));
  const out: { topic: string; score: number; matched: string[] }[] = [];
  for (const t of perTopic) {
    let score = 0;
    const matched: string[] = [];
    for (const tok of queryTokens) {
      const w = idf.get(tok);
      if (w === undefined || !t.tokens.has(tok)) continue;
      score += w;
      matched.push(tok);
    }
    if (score > 0) out.push({ topic: t.topic, score, matched: matched.sort() });
  }
  return out;
}

/** 选材主口（纯函数）：词面分过线 → 按（词面分 × 强度微调）降序取 top-k，休眠条目要过更高的
 *  唤醒门槛。同分按 topic 字典序——绝不把同分次序交给遍历顺序（同 map/retrieve 的纪律）。 */
export function selectRecall(
  query: string,
  candidates: readonly RecallInput[],
  opts: { k?: number; nowISO?: string } = {},
): RecallPick[] {
  const k = opts.k ?? RECALL_MAX_TOPICS;
  if (k <= 0) return [];
  const scored = new Map(scoreRecallCandidates(query, candidates).map((s) => [s.topic, s]));
  // 强度微调只折半影响：词面命中是主干（编码特异性），强度只表达「多久没用」——
  // 决不许让一条 0 强度的强命中出局（那是 decay 抢了 cueing 的方向盘）。nowISO 缺省取
  // 衰减锚点本身（Δ=0 不衰减）：纯函数调用方不该被迫先看一眼钟。
  const strengthOf = (c: RecallInput): number =>
    c.stat === undefined ? 1 : decayStrength(c.stat.strength, c.stat.lastRetrieved, opts.nowISO ?? c.stat.lastRetrieved);
  const rows: { pick: RecallPick; eff: number }[] = [];
  for (const c of candidates) {
    const s = scored.get(c.topic);
    if (s === undefined) continue;
    const dormant = c.stat?.dormant === true;
    if (dormant ? s.score < WAKE_MIN_SCORE : s.score < RECALL_MIN_SCORE) continue;
    if (c.body === null || c.body.trim().length === 0) continue; // 无正文不注（与 lessons「无出处不注入」同一道门）
    rows.push({
      pick: {
        topic: c.topic,
        type: c.type,
        headline: c.digest.replace(/\s+/gu, " ").trim().slice(0, 80),
        excerpt: clipByCodepoints(c.body.trim(), RECALL_EXCERPT_MAX_CHARS),
        matched: s.matched,
        score: s.score,
        woke: dormant,
      },
      eff: s.score * (0.5 + 0.5 * (Number.isFinite(strengthOf(c)) ? strengthOf(c) : 1)),
    });
  }
  rows.sort((a, b) => b.eff - a.eff || (a.pick.topic < b.pick.topic ? -1 : a.pick.topic > b.pick.topic ? 1 : 0));
  return rows.slice(0, k).map((r) => r.pick);
}

/** 按码点截断（半个字符都不许交出去；超长时用省略号收尾并说明截了多少）。 */
export function clipByCodepoints(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join("") + "…（超长截断，原文见记忆文件）";
}
