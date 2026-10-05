// 目标漂移（M4 交付物）：长任务里模型**中途改口**的次数。
//
// 计划书 M4 只给了这一句：「长任务**不遗忘**的真读数：跑一条 ≥30 轮的任务，记录**目标漂移**
// （模型中途改口）次数。」**全仓没有第二处定义**（2026-10-02 实查），所以口径由本模块定，
// 并按本仓规矩写成**可证伪**的两向判据：正样本必须报得出且指名，正常长跑一条都不许报。
//
// ── 口径（这是定义，不是实现细节）─────────────────────────────────────────────
// **目标漂移 ＝ 模型在某一轮正文里宣布"任务的范围/目标变了"（收窄 / 扩大 / 替换），
//   而不是推进原目标。** 只有三族算：
//   A 范围词变更：目标/范围/需求/任务 + 改·换·调整·收窄·缩小·重新定义
//   B 量词收窄  ：只修 X 就够 / 其余先不做 / 剩下的跳过  （以及英文 only … / ignore the rest）
//   C 目标替换  ：其实要做的是 Y / 我理解错了，真正要的是 Z （以及英文 actually the goal is）
//
// **明令不认的**（这是精度的一半，不是遗漏）：
//   · 实现层措辞——「把 `clamp` 改为 `sum`」「switch X to Y」「only change this line」都是**干活**，
//     不是改口；把它们算进来，判据立刻变成噪声发生器。
//   · 光有动词没有目标对象——「改为」后面跟的是函数名还是任务目标，机制上分不出来，一律不认。
//
// ── 为什么两向都必须在真跑上量 ────────────────────────────────────────────────
// 误报是这条能力的头号成本（与 `no-progress.ts` 同族）：把"正常推进"读成"改口"，
// 会得出"长任务普遍遗忘目标"的假结论。所以本模块的**负样本用真跑**：
// `outputs/eval-base-a/B12-long-horizon-*.events.jsonl`（真实跑出来的 26–28 轮长任务，实测 0 命中）。
//
// ── 语言 ──────────────────────────────────────────────────────────────────
// **中英都要认**：真实跑里模型是**用英文回答**的（B12 实测：`I'll start by exploring …`）。
// 只写中文规则 ⇒ 英文跑静默 0 命中 ⇒ 读数变成假的"零漂移"（本仓点过名的「没量到 ≠ 没问题」）。

import type { AgentEvent } from "../events";

/** 漂移的一处命中。`quote` 是**原文片段**（不许转述）：读数要能指回现场。 */
export interface GoalDriftFinding {
  /** 第几段正文（从 0 起；按"连续 delta 拼成一段、遇 tool_call 断段"切）。 */
  turn: number;
  /** 命中的族（A/B/C）与规则名。 */
  rule: string;
  /** 这一族为什么算漂移（原样来自规则表）。读数行只有 `rule` 时，读者只能去源码里查 id 的含义。 */
  why: string;
  /** 命中的原文片段（截断到 200 字）。 */
  quote: string;
}

/** 三族规则。每条都要求**目标对象在场**（或明确的范围收窄），不认光杆动词。
 *  `re` 用 `gmu`：跨行匹配 + 命中所有。 */
const RULES: readonly { rule: string; why: string; re: RegExp }[] = [
  {
    rule: "A:scope-noun-change",
    why: "目标/范围/需求/任务 这几个词直接跟变更动词 ⇒ 明说范围变了",
    // 允许名词与动词之间夹一小段（≤4 字）：「范围**要**收窄」「把目标**重新**定义」都是这一族；
    // 卡成紧邻会把最自然的说法漏掉（那是"没量到"，不是"没漂移"）。
    re: /(目标|范围|需求|任务)[^。；\n]{0,4}(改|变|换|调整|收窄|缩小|扩大|重新定义)|(change|switch|narrow|expand|redefine)\s+(the\s+)?(goal|scope|task|objective)/giu,
  },
  {
    rule: "B:quantifier-narrowing",
    why: "量词收窄（只修 X 就够 / 其余不做）⇒ 单方面缩小交付面",
    re: /(只|仅)(需要)?(修|做|改|处理|完成)[^\n。；]{0,24}(就(行|够|好|可以)|即可)|(其余|剩下|其他)[^\n。；]{0,12}(先)?(不|不用|无需|略过|跳过)|(ignore|skip)\s+the\s+(rest|others)|only\s+(fix|do|handle|complete)[^\n.]{0,30}(is\s+enough|suffices)/giu,
  },
  {
    rule: "C:goal-replacement",
    why: "把目标换成另一个（其实要的是 Y / 我理解错了）⇒ 换了目标不是推进",
    re: /其实(我们)?(要|应该|需要)的?是|我(之前)?理解错了[^\n。；]{0,20}(真(正)?要|应该)的?是|(actually|instead)[^\n.]{0,30}(the\s+(real\s+)?(goal|task|requirement)\s+is|what\s+we\s+(really\s+)?need\s+is)/giu,
  },
];

/** 一段正文里所有漂移命中（同一族只报第一条：一段里重复同一句话没有新信息）。 */
export function goalDriftFindings(turns: readonly string[]): GoalDriftFinding[] {
  const out: GoalDriftFinding[] = [];
  turns.forEach((text, turn) => {
    for (const r of RULES) {
      const m = text.match(r.re);
      if (m === null) continue;
      out.push({ turn, rule: r.rule, why: r.why, quote: m[0].replace(/\s+/gu, " ").slice(0, 200) });
    }
  });
  return out;
}

/** 从事件流重组「每一轮的模型正文」：连续 `assistant_delta` 拼成一段，遇 `tool_call` 断段。
 *
 *  为什么必须由本模块提供：真实跑里模型输出**只有 `assistant_delta`**（流式块），
 *  B12 实测 24 个 delta、**0 个 `assistant_message`** ⇒ 拿 `assistant_message` 当输入会恒得 0 条，
 *  那是"没量到"被读成"没漂移"。取料口径与被判对象**同一份**，不留给调用方各拼一套。 */
export function assistantTurnsFromEvents(events: readonly AgentEvent[]): string[] {
  const turns: string[] = [];
  let cur = "";
  for (const e of events) {
    const ev = e as { type: string; text?: string; delta?: string };
    if (ev.type === "assistant_delta") { cur += ev.text ?? ev.delta ?? ""; continue; }
    if (ev.type === "tool_call") { if (cur.trim() !== "") turns.push(cur.trim()); cur = ""; }
  }
  if (cur.trim() !== "") turns.push(cur.trim());
  return turns;
}

/** 读数行：门与判卷共用这一份措辞（同一谓词不抄两份）。 */
export function goalDriftCell(findings: readonly GoalDriftFinding[]): string {
  if (findings.length === 0) return "目标漂移 0 处";
  return `目标漂移 ${String(findings.length)} 处：` +
    findings.slice(0, 6).map((f) => `第 ${String(f.turn + 1)} 段[${f.rule}]「${f.quote}」——${f.why}`).join("；");
}
