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
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { estimateTokens } from "../compaction";
import { createGlmSessionProvider, sessionToolSpecs } from "../glm-session";
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

async function loadScript(scriptPath: string): Promise<ModelOutput[]> {
  const raw = await readFile(scriptPath, "utf8");
  const out: ModelOutput[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const e = JSON.parse(t) as AgentEvent;
    if (e.type === "assistant_message" || e.type === "tool_call") out.push(e as unknown as ModelOutput);
    else throw new Error(`装配探针剧本只接受 assistant_message/tool_call，读到: ${JSON.stringify(e.type)}`);
  }
  return out;
}

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

/** 记录装配 + 回放剧本的假 transport（语义与 createMockProvider 同：一次 stream() 把剩余剧本吐完）。 */
export function createProbeTransport(scriptPath: string, onAssembly: (t: AssemblyTurn) => void): typeof streamGlm {
  let script: ModelOutput[] | null = null;
  let cursor = 0;
  let turn = 0;
  return async function* (messages, _opts, tools) {
    turn += 1;
    onAssembly(classifyAssembly(turn, messages as GlmMessage[], tools as GlmToolSpec[] | undefined));
    if (!script) script = await loadScript(scriptPath);
    while (cursor < script.length) yield script[cursor++];
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
}): Promise<{ provider: Provider; report: () => AssemblyReport }> {
  const turns: AssemblyTurn[] = [];
  const { specs } = sessionToolSpecs({ mode: opts.mode ?? "default" });
  const tools = opts.extraTools ? [...specs, ...opts.extraTools] : specs;
  const provider = createGlmSessionProvider(opts.eventsPath, {
    system: opts.system,
    workspace: opts.workspace,
    tools,
    compaction: {},
    ...(opts.map === undefined ? {} : { map: opts.map }),
    ...(opts.emit ? { emit: opts.emit } : {}),
    transport: createProbeTransport(opts.scriptPath, (t) => { turns.push(t); }),
  });
  return {
    provider,
    report: () => ({ ...summarizeAssembly(opts.caseId, turns), toolRanking: rankToolSpecs(tools) }),
  };
}
