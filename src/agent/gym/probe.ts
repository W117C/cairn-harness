// 上下文装配探针（能力 9 + 10 的度量前置）。
//
// 为什么要有它：靶场此前的三条 case 用冻结剧本跑，`scriptedUsageOf` 从**剧本文件字节**折算 token——
// 也就是说它量的是「剧本多大」，不是「harness 给模型装了多少」。于是这一整轮做的上下文决策
// （预算认模型、影响面回注、记忆注入、工具表面大小、A1 缓存断点）**没有一个能被量出来**，
// 「这次改动买到分数了吗 / 多花了多少 token」只能靠感觉。
//
// 探针做的事：用**真**会话 provider（走 composeTurnMessages / 压缩 / 预算那条链），
// 只把出网的 transport 换成一个「记录装配结果 + 回放冻结剧本」的假件，
// 于是每装配一次请求就留下一条按可缓存性分层的字节账。
import { estimateTokens, type CompactionConfig } from "../compaction";
import { serializeLayer } from "../prefix-churn";
import { measureHeadSurvival } from "../compaction-cost";
import { createEventLog } from "../../events";
import { createGlmSessionProvider, sessionToolSpecs } from "../glm-session";
import { loadScriptOutputs, takeRound } from "./script";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../../providers/glm";
import type { ModelOutput, Provider } from "../../providers";
import type { AgentEvent } from "../../events";
import type { PermissionMode } from "../../permissions";

/** 一次装配的字节账（按「能不能被缓存」分层，不是按消息条数）。 */
export interface AssemblyTurn {
  turn: number;
  /** 整次请求的字节数（messages JSON + 工具 schema）。 */
  promptBytes: number;
  promptChars: number;
  estTokens: number;
  /** 可缓存前缀 = **首条** system（基础提示）+ 工具 schema——A1 断点正好打在这段末尾。 */
  cacheableBytes: number;
  /** 易变的 system 块：记忆 / skills / 符号地图（逐轮或每 N 轮变，打了点反而每轮重写缓存）。 */
  volatileSystemBytes: number;
  /** 历史投影（含工具结果）——装配决策真正膨胀的地方。 */
  historyBytes: number;
  messages: number;
}

export interface AssemblyReport {
  caseId: string;
  turns: AssemblyTurn[];
  requests: number;
  totalPromptBytes: number;
  peakPromptBytes: number;
  cacheableBytes: number;
  /** 工具面逐条字节排行（降序）。和恰等于工具 schema 总字节——数组括号与逗号按位置计入首/末项，
   *  所以排行相加就是账，不用另算结构开销。 */
  toolRanking?: Array<{ name: string; bytes: number }>;
}

/** 工具面按条拆账：砍谁最省，读这张表而不是猜。 */
export function rankToolSpecs(tools: readonly GlmToolSpec[]): Array<{ name: string; bytes: number }> {
  const n = tools.length;
  return tools
    .map((t, i) => ({
      name: t.function.name,
      bytes:
        utf8(JSON.stringify(t))
        + (i === 0 ? 1 : 0) // 前导 "["
        + (i === n - 1 ? 1 : 0) // 结尾 "]"
        + (i < n - 1 ? 1 : 0), // 与下一项之间的 ","
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** 纯函数：把一次装配切成「可缓存 / 易变 / 历史」三段。分量和必等于 promptBytes（守恒由测钉住）。 */
export function classifyAssembly(turn: number, messages: GlmMessage[], tools?: GlmToolSpec[]): AssemblyTurn {
  const msgsJson = JSON.stringify(messages);
  const toolsJson = tools && tools.length > 0 ? JSON.stringify(tools) : "";
  const toolBytes = utf8(toolsJson);
  let firstSystemBytes = 0;
  let volatileSystemBytes = 0;
  let historyBytes = 0;
  let seenSystem = false;
  for (const m of messages) {
    const b = utf8(JSON.stringify(m));
    if (m.role === "system") {
      if (!seenSystem) { firstSystemBytes = b; seenSystem = true; } else volatileSystemBytes += b;
    } else historyBytes += b;
  }
  const promptBytes = utf8(msgsJson) + toolBytes;
  return {
    turn,
    promptBytes,
    promptChars: msgsJson.length + toolsJson.length,
    estTokens: estimateTokens(msgsJson.length + toolsJson.length),
    cacheableBytes: firstSystemBytes + toolBytes,
    volatileSystemBytes,
    historyBytes,
    messages: messages.length,
  };
}

/** 记录装配 + 按轮回放剧本的假 transport：**一次调用 = 一轮**（吐到下一个 tool_call 为止，含它），
 *  与明卷 createRoundScriptedProvider 同一条切轮口径（见 ./script.ts）。于是 requests 真的等于轮数，
 *  逐轮装配账（历史增长 / 缓存前缀 / 压缩）才量得到。 */
export function createProbeTransport(
  scriptPath: string,
  onAssembly: (t: AssemblyTurn) => void,
  /** 可选：把**真正发出去**的那一份 messages 序列化成一层字符串交出来。
   *  头部存活比只能拿相邻两轮的字节串比（`measureHeadSurvival`），分层字节算不出「断在第几条」。
   *  缺省不传 ⇒ 与旧行为逐字一致（`AssemblyTurn` 的形状、基线 JSON 都不变）。 */
  onLayer?: (turn: number, layer: string) => void,
): typeof streamGlm {
  let script: ModelOutput[] | null = null;
  let cursor = 0;
  let turn = 0;
  return async function* (messages, _opts, tools) {
    turn += 1;
    onAssembly(classifyAssembly(turn, messages as GlmMessage[], tools as GlmToolSpec[] | undefined));
    if (onLayer) onLayer(turn, serializeLayer(messages as GlmMessage[]));
    if (!script) script = await loadScriptOutputs(scriptPath);
    if (cursor >= script.length) return;
    const round = takeRound(script, cursor);
    cursor = round.next;
    for (const output of round.outputs) yield output;
  };
}

export function summarizeAssembly(caseId: string, turns: AssemblyTurn[]): AssemblyReport {
  return {
    caseId,
    turns,
    requests: turns.length,
    totalPromptBytes: turns.reduce((n, t) => n + t.promptBytes, 0),
    peakPromptBytes: turns.reduce((n, t) => Math.max(n, t.promptBytes), 0),
    cacheableBytes: turns.length > 0 ? turns[0].cacheableBytes : 0,
  };
}

/** 两个报告的差分：A/B 一个 harness 开关（如 map on/off、影响面 on/off）时读这张表。 */
export interface AssemblyDelta {
  totalPromptBytes: number;
  peakPromptBytes: number;
  cacheableBytes: number;
  volatileSystemBytes: number;
  historyBytes: number;
}

export function diffAssembly(before: AssemblyReport, after: AssemblyReport): AssemblyDelta {
  const sum = (r: AssemblyReport, k: "volatileSystemBytes" | "historyBytes"): number =>
    r.turns.reduce((n, t) => n + t[k], 0);
  return {
    totalPromptBytes: after.totalPromptBytes - before.totalPromptBytes,
    peakPromptBytes: after.peakPromptBytes - before.peakPromptBytes,
    cacheableBytes: after.cacheableBytes - before.cacheableBytes,
    volatileSystemBytes: sum(after, "volatileSystemBytes") - sum(before, "volatileSystemBytes"),
    historyBytes: sum(after, "historyBytes") - sum(before, "historyBytes"),
  };
}

/** 用探针跑一轮装配（不改 runLoop 行为、不出网）：返回装配报告。 */
export async function probeAssembly(opts: {
  caseId: string;
  eventsPath: string;
  workspace: string;
  system: string;
  scriptPath: string;
  mode?: PermissionMode;
  map?: boolean;
  extraTools?: GlmToolSpec[];
  emit?: (e: AgentEvent) => Promise<void>;
  /** 压缩相关透传：长时程回放要能在不同压缩配置/摊销开关下量同一条链（`replayLongAssembly` 用）。 */
  compaction?: { config?: Partial<CompactionConfig>; summarizer?: unknown; amortizeRewriteCost?: boolean };
  onLayer?: (turn: number, layer: string) => void;
}): Promise<{ provider: Provider; report: () => AssemblyReport }> {
  const turns: AssemblyTurn[] = [];
  const { specs } = sessionToolSpecs({ mode: opts.mode ?? "default" });
  const tools = opts.extraTools ? [...specs, ...opts.extraTools] : specs;
  const provider = createGlmSessionProvider(opts.eventsPath, {
    system: opts.system,
    workspace: opts.workspace,
    tools,
    ...(opts.compaction
      ? { compaction: {
          ...(opts.compaction.config ? { config: opts.compaction.config } : {}),
          ...(opts.compaction.summarizer ? { summarizer: opts.compaction.summarizer as never } : {}),
          ...(opts.compaction.amortizeRewriteCost === undefined ? {} : { amortizeRewriteCost: opts.compaction.amortizeRewriteCost }),
        } }
      : { compaction: {} }),
    ...(opts.map === undefined ? {} : { map: opts.map }),
    ...(opts.emit ? { emit: opts.emit } : {}),
    transport: createProbeTransport(opts.scriptPath, (t) => { turns.push(t); }, opts.onLayer),
  });
  return {
    provider,
    report: () => ({ ...summarizeAssembly(opts.caseId, turns), toolRanking: rankToolSpecs(tools) }),
  };
}

/* ============================ 长时程回放（能力 11） ============================ */

/** 一轮回放的读数。`headSurvival` 是**相邻两轮的字节串比出来的**，不是估的。 */
export interface LongReplayTurn {
  turn: number;
  promptBytes: number;
  cacheableBytes: number;
  volatileSystemBytes: number;
  historyBytes: number;
  /** 上一轮的头部里本轮仍然可缓存的比例（1 = 纯追加；0.02 = 只剩 2%）。首轮为 null。 */
  headSurvival: number | null;
  /** 本轮作废掉多少字符的上一轮前缀（0 = 纯追加）。 */
  rewroteBytes: number;
}

export interface LongReplayReport {
  caseId: string;
  amortize: boolean;
  longTurns: number;
  growthChars: number;
  requests: number;
  totalPromptBytes: number;
  peakPromptBytes: number;
  /** Σ 每轮作废的前缀字节 —— 这就是「重写缓存」的账单，`promptBytes` 里看不出来。 */
  totalRewroteBytes: number;
  /** 头部作废了几次（压缩/裁剪/重挂都算，只问「断没断」不问「谁断的」）。 */
  rewrites: number;
  /** 真落流的 `compaction` 事件数：与 rewrites 分开看，前者是**认账证据**。 */
  compactions: number;
  turns: LongReplayTurn[];
}

/** 靶场此前的 case 全是 `requests=1` ⇒ 任何只在多轮生效的机制（压缩、裁剪、缓存命中、
 *  跨轮记忆）在这里**一次都触发不到**（BLOCKED 裁决 3 的原话：基线是天花板，只能证明「不掉分」）。
 *  本函数走的是 BLOCKED 里方案②：**不动冻结判卷文件**，只把探针的会话在临时目录里续长出历史，
 *  于是同一条链可以被量「第 30 轮装配长什么样、这一轮比上一轮多作废多少前缀」。
 *
 *  写只写 `opts.eventsPath`（gym 的临时目录），fixtures 一个字节都不动。
 *  `compaction` 不传 ⇒ 生产尺度窗口（要压到才长），跑得起但慢；测试里传小窗口验机制。 */
export async function replayLongAssembly(opts: {
  caseId: string;
  eventsPath: string;
  workspace: string;
  system: string;
  scriptPath: string;
  longTurns?: number;
  growthChars?: number;
  mode?: PermissionMode;
  map?: boolean;
  amortize?: boolean;
  compactionConfig?: Partial<CompactionConfig>;
  summarizer?: unknown;
  extraTools?: GlmToolSpec[];
}): Promise<LongReplayReport> {
  const longTurns = opts.longTurns ?? 12;
  const growthChars = opts.growthChars ?? 8_000;
  const layers: string[] = [];
  const probe = await probeAssembly({
    caseId: opts.caseId,
    eventsPath: opts.eventsPath,
    workspace: opts.workspace,
    system: opts.system,
    scriptPath: opts.scriptPath,
    mode: opts.mode ?? "default",
    map: opts.map,
    extraTools: opts.extraTools,
    onLayer: (turn, layer) => { layers[turn - 1] = layer; },
    ...(opts.compactionConfig || opts.amortize !== undefined || opts.summarizer
      ? { compaction: {
          ...(opts.compactionConfig ? { config: opts.compactionConfig } : {}),
          ...(opts.summarizer ? { summarizer: opts.summarizer as never } : {}),
          ...(opts.amortize === undefined ? {} : { amortizeRewriteCost: opts.amortize }),
        } }
      : {}),
  });
  // 增长的内容来自**这条 case 自己的冻结剧本**（助手正文 + 工具调用参数），不是我编的字数。
  // 编内容会让「case=config-default」与「case=todo-completed-count」量出同一张表——
  // 第一版就是这样：三条 case 的读数逐字相同，看起来像仪器坏了，其实是仪器没在读 case。
  const growth = await scriptGrowthText(opts.scriptPath);
  const log = createEventLog(opts.eventsPath);
  try {
    await log.append({ type: "user_message", content: "长时程回放起点" });
    for (let r = 0; r < longTurns; r++) {
      for await (const _ of probe.provider.stream([])) void _;
      await log.append({ type: "assistant_message", content: sliceCyclic(growth, growthChars, r) });
      await log.append({ type: "user_message", content: "继续第 " + String(r + 1) + " 轮" });
    }
  } finally {
    await log.close?.();
  }
  const report = probe.report();
  const rows: LongReplayTurn[] = report.turns.map((t, i) => {
    const prev = i > 0 ? layers[i - 1] : undefined;
    const cur = layers[i];
    const reading = prev !== undefined && cur !== undefined ? measureHeadSurvival(prev, cur) : null;
    return {
      turn: t.turn,
      promptBytes: t.promptBytes,
      cacheableBytes: t.cacheableBytes,
      volatileSystemBytes: t.volatileSystemBytes,
      historyBytes: t.historyBytes,
      headSurvival: reading ? reading.share : null,
      rewroteBytes: reading ? reading.prevChars - reading.stableChars : 0,
    };
  });
  // 两个数分开记，别混：`rewrites` = 相邻轮比出来的「头部作废了几次」（压缩/裁剪/重挂都会进这里）；
  // `compactions` = 事件流里真落了几次 `type:"compaction"`（**认账证据**，与 prefix-churn-check 同一口径）。
  const compactionEvents = await countCompactionEvents(opts.eventsPath);
  return {
    caseId: opts.caseId,
    amortize: opts.amortize === true,
    longTurns,
    growthChars,
    requests: rows.length,
    totalPromptBytes: rows.reduce((n, x) => n + x.promptBytes, 0),
    peakPromptBytes: rows.reduce((n, x) => Math.max(n, x.promptBytes), 0),
    totalRewroteBytes: rows.reduce((n, x) => n + x.rewroteBytes, 0),
    rewrites: rows.filter((x) => x.headSurvival !== null && x.headSurvival < 1).length,
    compactions: compactionEvents,
    turns: rows,
  };
}

/** 真落流的压缩事件数（认账证据；不是「看到抖了就算」）。 */
async function countCompactionEvents(eventsPath: string): Promise<number> {
  try {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(eventsPath, "utf8")).match(/"type":"compaction"/g)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** A/B 一个开关（如 `amortize`）时读这张表：两条链的同名读数差。
 *  看 `totalRewroteBytes` 与 `compactions` 两列——前者是钱，后者是次数。 */
export interface LongReplayDelta {
  requests: number;
  totalPromptBytes: number;
  peakPromptBytes: number;
  totalRewroteBytes: number;
  rewrites: number;
}
export function diffLongReplay(before: LongReplayReport, after: LongReplayReport): LongReplayDelta {
  const rewrites = (r: LongReplayReport) => r.turns.filter((t) => t.headSurvival !== null && t.headSurvival < 1).length;
  return {
    requests: after.requests - before.requests,
    totalPromptBytes: after.totalPromptBytes - before.totalPromptBytes,
    peakPromptBytes: after.peakPromptBytes - before.peakPromptBytes,
    totalRewroteBytes: after.totalRewroteBytes - before.totalRewroteBytes,
    rewrites: rewrites(after) - rewrites(before),
  };
}

/** 把一条冻结剧本里**模型自己说过/要过**的东西拼成增长文本（不新造内容）。
 *  `ModelOutput` 的变体是 assistant_message / assistant_delta / tool_call / usage / turn_truncated，
 *  这里只取前三种真正「进上下文」的。 */
async function scriptGrowthText(scriptPath: string): Promise<string> {
  const outputs = await loadScriptOutputs(scriptPath);
  const parts: string[] = [];
  for (const o of outputs) {
    if (o.type === "assistant_message") parts.push(o.content);
    else if (o.type === "assistant_delta") parts.push(o.text);
    else if (o.type === "tool_call") parts.push(o.name + " " + JSON.stringify(o.args ?? {}));
  }
  const joined = parts.join("\n").trim();
  if (joined === "") {
    throw new Error("scriptGrowthText: 这条 case 的剧本里没有可用正文，拒绝用编造内容放大（会量出假读数）：" + scriptPath);
  }
  return joined;
}

/** 从剧本文本里取 `n` 个字符，不够就从头循环（确定性的：同一 case 同一轮永远同一个串）。 */
function sliceCyclic(text: string, n: number, offsetTurn: number): string {
  const out: string[] = [];
  let remaining = n;
  let at = (offsetTurn * 977) % text.length; // 每轮换个起点，避免历史每轮完全同形（会让“纯追加”过于便宜）
  while (remaining > 0) {
    const take = Math.min(remaining, text.length - at);
    out.push(text.slice(at, at + take));
    remaining -= take;
    at = 0;
  }
  return out.join("");
}
