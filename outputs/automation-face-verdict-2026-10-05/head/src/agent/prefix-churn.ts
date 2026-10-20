// 前缀抖动（cache churn）的纯判据。
//
// 为什么要这一层：真实录制显示，命中与未命中是**全有或全无**的（命中时平均 86.6%，未命中时 0%，
// 没有中间态），而那 41.5% 的整段归零发生在**上游**。⇒ 拿「命中率」当判据 = 一扇随机红的门。
// 我们这一侧唯一确定、可离线判的是：**没有声明的变异源时，装配必须逐字纯追加**。
// 读数与判读：outputs/prefix-churn-2026-09-23/00-实测发现.md。
//
// 叶子模块：零运行时依赖，只 `import type`。判据在此，门与测例共用同一只（本仓规矩：
// 一条判据一只函数，两处出口）。

import type { GlmMessage, GlmToolSpec } from "../providers/glm";

/** 序列化一层，但**去掉数组尾 `]`**：纯追加时上一轮的串应当是这一轮的**严格前缀**。
 *  整体请求体（messages + tools 拼一只字符串）刻意不用——顶层键序是 provider 自己的事，
 *  前缀语义长在层里，不在包装里。 */
export function serializeLayer(items: readonly unknown[]): string {
  return JSON.stringify(items).slice(0, -1);
}

/** 可缓存前缀那一层：首条 system（基础提示）+ 工具面。
 *  与装配探针 `classifyAssembly` 的 `cacheableBytes` 同一口径（同一层，别起第二个名字）。 */
export function cacheableFace(messages: readonly GlmMessage[], tools: readonly GlmToolSpec[] | undefined): string {
  const firstSystem = messages.find((m) => m.role === "system");
  return serializeLayer([firstSystem ?? null, tools ?? []]);
}

/** 易变 system 块：首条之外的 system 消息（记忆 / skills / 地图 / 降配说明）。 */
export function volatileSystemLayer(messages: readonly GlmMessage[]): string {
  let seenSystem = false;
  const volatile = messages.filter((m) => {
    if (m.role !== "system") return false;
    if (!seenSystem) { seenSystem = true; return false; }
    return true;
  });
  return serializeLayer(volatile);
}

export interface ChurnReading {
  /** 两轮共有的前缀字符数。 */
  stableChars: number;
  /** 上一轮里**没被保住**的那一段——这就是要被重写进缓存的字节。 */
  rewroteChars: number;
  /** 本轮新写进去的长度（含分隔符）。 */
  appendChars: number;
  /** true ⇒ 上一轮整串是本轮的前缀（纯追加，零自伤）。 */
  pureAppend: boolean;
  prevChars: number;
  curChars: number;
}

export function lcpChars(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  let i = 0;
  while (i < shared && a[i] === b[i]) i++;
  return i;
}

/** 相邻两轮同一层的抖动读数。 */
export function prefixChurn(prevLayer: string, curLayer: string): ChurnReading {
  const stableChars = lcpChars(prevLayer, curLayer);
  return {
    stableChars,
    rewroteChars: prevLayer.length - stableChars,
    appendChars: curLayer.length - stableChars,
    pureAppend: stableChars === prevLayer.length,
    prevChars: prevLayer.length,
    curChars: curLayer.length,
  };
}

/** 一次请求的观测（门把 provider 真正发出去的那一对记下来喂给判据）。 */
export interface AssemblyObservation {
  messages: GlmMessage[];
  tools: GlmToolSpec[] | undefined;
  /** 本轮工具面若有「省了谁」的说明，必须在这里——PC3 判的就是它。 */
  faceNote: string;
}

export function observe(request: AssemblyObservation): {
  historyLayer: string;
  cacheable: string;
  volatileLayer: string;
} {
  return {
    historyLayer: serializeLayer(request.messages),
    cacheable: cacheableFace(request.messages, request.tools),
    volatileLayer: volatileSystemLayer(request.messages),
  };
}

export interface ChurnVerdict {
  ok: boolean;
  detail: string;
}

/** PC1：历史层必须逐轮纯追加（除非有声明的变异源——压缩/裁剪都属「变了要出声」的那一族）。 */
export function historyPurelyAppends(observations: readonly AssemblyObservation[]): ChurnVerdict {
  const readings = observations.slice(1).map((cur, i) =>
    prefixChurn(serializeLayer(observations[i]!.messages), serializeLayer(cur.messages)),
  );
  const bad = readings.findIndex((r) => !r.pureAppend);
  return {
    ok: readings.length > 0 && bad < 0,
    detail: `相邻 ${String(readings.length)} 对：${readings.map((r, i) => `轮${String(i + 1)}→${String(i + 2)} ${r.pureAppend ? "纯追加" : "重写 " + String(r.rewroteChars) + " 字符"}`).join("｜")}` +
      (bad >= 0 ? `｜第 ${String(bad + 1)} 对破了` : ""),
  };
}

/** PC2：易变块变了，**不得牵连可缓存前缀**（记忆/skills 每轮重读是既有语义）。 */
export function cacheableSurvivesVolatileChange(observations: readonly AssemblyObservation[]): ChurnVerdict {
  const faces = new Set(observations.map((o) => cacheableFace(o.messages, o.tools)));
  const volatiles = observations.map((o) => volatileSystemLayer(o.messages));
  const volatileChanged = new Set(volatiles).size > 1;
  return {
    ok: faces.size === 1 && volatileChanged,
    detail: `易变块 ${volatileChanged ? "确实每轮在变" : "整轮没变（这条判据无分辨力——门自身要红）"}｜可缓存面 distinct=${String(faces.size)}`,
  };
}

/** PC3：工具面**自己**变了 ⇒ 必须出声（note 点名），否则模型看到的清单与上一轮悄悄不同。 */
export function toolFaceChangeIsNamed(observations: readonly AssemblyObservation[]): ChurnVerdict {
  let changed = 0;
  let silent = 0;
  for (let i = 1; i < observations.length; i++) {
    const before = observations[i - 1]!;
    const now = observations[i]!;
    if (JSON.stringify(before.tools ?? []) === JSON.stringify(now.tools ?? [])) continue;
    changed++;
    const named = (now.faceNote ?? "").length > 0 || (before.faceNote ?? "").length > 0;
    if (!named) silent++;
  }
  return {
    ok: changed > 0 && silent === 0,
    detail: `工具面变化 ${String(changed)} 次，其中未点名的 ${String(silent)} 次` +
      (changed === 0 ? "（这条判据无分辨力——门自身要红）" : ""),
  };
}

/** PC4：同一份超限工具面重复装配 ⇒ 降配结果必须逐字稳定（确定性）。
 *  抖动本身不免费：每轮重写一次可缓存前缀，等于把省下的字节再花回去。 */
export function oversizedFaceIsDeterministic(reducer: (round: number) => readonly GlmToolSpec[], rounds = 3): ChurnVerdict {
  const faces = Array.from({ length: rounds }, (_, i) => serializeLayer(reducer(i)));
  const distinct = new Set(faces).size;
  return {
    ok: distinct === 1,
    detail: `${String(rounds)} 轮装配出 ${String(distinct)} 种工具面（1 = 确定性）｜单面 ${String(faces[0]?.length ?? 0)} 字符`,
  };
}

/* ============================ 变异源归因（PC5 / PC6） ============================ */

/** 会让前缀合法重写的**变异源**。判据不禁它们——禁的是「抖了却没人说自己抖过」。 */
export type ChurnMutator =
  /** 阈值摘要替换历史（`compaction` 事件落流为证）。 */
  | "compaction"
  /** 类型化裁剪改写旧工具结果（`prune-attachments/` 落盘为证）。 */
  | "prune"
  /** 工具面自己变了（run 中途 skill 摘除 / MCP 装载变化）。 */
  | "tool-face"
  /** 模型面降配梯生效（note 为证）。 */
  | "surface-ladder"
  /** 易变 system 块变了（记忆/skills 每轮重读）——它**不该**牵连可缓存前缀。 */
  | "volatile-block";

export interface ChurnAttribution extends ChurnReading {
  /** 本轮真实发生的变异源（由 harness 留下的痕迹推得，不是猜的）。 */
  fired: readonly ChurnMutator[];
  /** true ⇒ 重写了前缀却一个声明源都没有 —— 这才是要拦的形状。 */
  silentRewrite: boolean;
  /** 重写从第几条消息起（-1 = 没重写）。比报字符数更可诊断。 */
  firstRewriteIndex: number;
}

/** 每条消息在 `serializeLayer(messages)` 里的起始字符偏移（用于把抖动点换算成「第几条」）。
 *  与 `rankToolSpecs` 同一诉求：**位置**要能对上账，报出来的行号才可信。 */
export function messageStartOffsets(messages: readonly unknown[]): number[] {
  const out: number[] = [];
  let acc = 1; // 前导 "["
  messages.forEach((m, i) => {
    out.push(acc);
    acc += JSON.stringify(m).length + (i < messages.length - 1 ? 1 : 0); // "," 或尾 "]"（尾已被 serializeLayer 去掉）
  });
  return out;
}

function indexOfOffset(offsets: readonly number[], stableChars: number): number {
  let idx = 0;
  for (let i = 0; i < offsets.length; i++) if (offsets[i]! <= stableChars) idx = i;
  return idx;
}

/** 归因：相邻两轮的抖动 + 造成它的变异源。 */
export function attributeChurn(
  prev: AssemblyObservation,
  cur: AssemblyObservation,
  fired: readonly ChurnMutator[],
): ChurnAttribution {
  const prevLayer = serializeLayer(prev.messages);
  const reading = prefixChurn(prevLayer, serializeLayer(cur.messages));
  const offsets = messageStartOffsets(prev.messages);
  return {
    ...reading,
    fired,
    silentRewrite: !reading.pureAppend && fired.length === 0,
    firstRewriteIndex: reading.pureAppend ? -1 : indexOfOffset(offsets, reading.stableChars),
  };
}

/** PC5 / PC6 的判据本体：**要么不抖，要么抖得有证据**。
 *  两条反向的红：抖了没证据（静默中段重写）；要求它抖却整轮没抖（样本无分辨力）。 */
export function churnIsAttributed(
  attrs: readonly ChurnAttribution[],
  expectRewrite: boolean,
): ChurnVerdict {
  const rewrote = attrs.filter((a) => !a.pureAppend);
  const silent = rewrote.filter((a) => a.silentRewrite);
  const ok = expectRewrite ? rewrote.length > 0 && silent.length === 0 : rewrote.length === 0;
  return {
    ok,
    detail: `相邻 ${String(attrs.length)} 对里重写 ${String(rewrote.length)} 次、其中无证据 ${String(silent.length)} 次` +
      (rewrote.length > 0
        ? `｜首次重写在第 ${String(rewrote[0]!.firstRewriteIndex)} 条消息、作废 ${String(rewrote[0]!.rewroteChars)} 字符`
        : expectRewrite ? "（要求重写却一次没发生——样本无分辨力，门自身红）" : ""),
  };
}

/** 抖动代价的口径：这轮之后还剩多少字符可以走缓存命中。 */
export function cacheSurvivalAfterRewrite(attr: ChurnAttribution): string {
  return `${String(attr.stableChars)} / ${String(attr.prevChars)} 字符仍可缓存`;
}

/** 门的反向对照用料：把易变文本折进**首条** system —— 这正是 PC2 要拦的那一类改法
 *  （「可变内容后置」一旦被破，记忆每轮重读就会牵连整段可缓存前缀）。 */
export function breakByFoldingVolatileIntoHead(messages: readonly GlmMessage[]): GlmMessage[] {
  const systems = messages.filter((m) => m.role === "system");
  const first = systems[0];
  if (!first) return [...messages];
  const volatileTail = systems.slice(1).map((v) => String(v.content ?? "")).join("");
  const out: GlmMessage[] = [];
  for (const m of messages) {
    if (m === first) {
      out.push({ ...m, content: String(first.content ?? "") + volatileTail });
      continue;
    }
    if (m.role === "system") continue; // 已经被折进首条
    out.push(m);
  }
  return out;
}

/** 门的反向对照用料：从历史**中间**摘一条（prune 改写中段的形状）。 */
export function breakByMiddleSplice<T>(items: readonly T[]): T[] {
  if (items.length < 3) return [...items];
  return [...items.slice(0, 1), ...items.slice(2)];
}

/** PC7 的裁决（案 A，2026-09-26 由人裁）：摊销买的是**字符当量上的净省**，不是"少压一次"。
 *  省＝关臂累计重写 − 开臂累计重写（这些是后续主请求里按全价重发的输入字符）；
 *  付＝开臂多用的摘要输入字符 ＋ 多出来的摘要输出字符 × 输出/输入单价比。
 *  「压缩次数不得升」这条代理指标为什么撤：第 106 页实测——关臂到第 7 对已没空档（尾部到底，只能发一份超量请求），
 *  开臂还能继续压 ⇒ **次数 +1 与省 7,663 字符同向发生**；断"次数不升"实际是在要求多付一次重写。
 *  `outputOverInput` 由调用方从价表取：判据里不许写死价格，这样加一档更贵的输出价时这条线自己收紧。 */
export interface AmortizationExchange {
  rewroteOff: number;
  rewroteOn: number;
  summaryInputOff: number;
  summaryInputOn: number;
  summaryOutputOff: number;
  summaryOutputOn: number;
  outputOverInput: number;
}

export function amortizationIsPaidOff(x: AmortizationExchange): {
  ok: boolean; priced: boolean; saved: number; paid: number; shortfall: number;
} {
  const saved = x.rewroteOff - x.rewroteOn;
  // 价表里没有一条已校准的行 ⇒ 这条线**算不出来**。退化成"只看省没省"是 fail-open（输出再贵也不会响），
  // 所以缺价就红，并且把 `priced:false` 交出去——"没价"与"没省到"是两件事，不许在话术里合并。
  const priced = x.outputOverInput > 0;
  const paid = priced
    ? x.summaryInputOn - x.summaryInputOff + (x.summaryOutputOn - x.summaryOutputOff) * x.outputOverInput
    : Number.POSITIVE_INFINITY;
  return { ok: priced && saved > 0 && saved >= paid, priced, saved, paid, shortfall: paid - saved };
}
