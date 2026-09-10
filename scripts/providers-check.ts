// providers-check —— M2c 跨 provider 契约验收（pnpm providers-check）。
// ①同一逻辑对话（一轮文本 + 一次工具调用 + usage）在 openai/anthropic/gemini 三家适配器下
//   产出等价事件序列：文本逐字相同、tool_call 名与参数相同（anthropic 分片参数拼成完整 JSON、
//   gemini 一个 chunk 多个并行 functionCall 全解析）、usage 均 > 0。
// ②三家适配器互不 import（grep src/providers/{openai,anthropic,gemini}.ts 不出现彼此文件名）。
// ③暗卷（有 key 才跑）：OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 检测到哪家跑哪家，
//   断言真实流式返回 ≥2 个 delta；一家都没有 → 打印「暗卷跳过」退出 0。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mergeAssistantDeltas,
  type AgentEvent,
  type AssistantDeltaEvent,
  type ToolCallEvent,
  type UsageEvent,
} from "../src/events";
import type { ProviderMessage, ProviderToolSpec } from "../src/providers";
import { streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

const ROOT = join(import.meta.dirname, "..");
const FIX = (p: string): string => join(ROOT, "fixtures", "providers", p);
const SPEC: ProviderToolSpec = {
  name: "read_file",
  description: "读取工作区内文件",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

async function loadLines(rel: string): Promise<string[]> {
  const raw = await readFile(FIX(rel), "utf8");
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

function stubFetch(lines: string[]): typeof fetch {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"));
      controller.close();
    },
  });
  return (async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

interface TurnSummary {
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  usage: { inputTokens: number; outputTokens: number } | null;
  error?: string;
}
function summarize(events: AgentEvent[]): TurnSummary {
  const deltas = events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
  const calls = events.filter((e): e is ToolCallEvent => e.type === "tool_call");
  const usage = events.find((e): e is UsageEvent => e.type === "usage");
  return {
    text: mergeAssistantDeltas(deltas),
    calls: calls.map((c) => ({ name: c.name, args: c.args })),
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : null,
  };
}

const ADAPTERS = [
  {
    key: "openai",
    dir: "openai",
    run: (msgs: ProviderMessage[], tools: ProviderToolSpec[], fetchImpl: typeof fetch) =>
      streamOpenAI(msgs, { apiKey: "test", fetchImpl }, tools),
  },
  {
    key: "anthropic",
    dir: "anthropic",
    run: (msgs: ProviderMessage[], tools: ProviderToolSpec[], fetchImpl: typeof fetch) =>
      streamAnthropic(msgs, { apiKey: "test", fetchImpl }, tools),
  },
  {
    key: "gemini",
    dir: "gemini",
    run: (msgs: ProviderMessage[], tools: ProviderToolSpec[], fetchImpl: typeof fetch) =>
      streamGemini(msgs, { apiKey: "test", fetchImpl }, tools),
  },
] as const;

const USER: ProviderMessage[] = [{ role: "user", content: "hi" }];

async function replayTurn(dir: string, fixture: string, fetchImpl: typeof fetch): Promise<TurnSummary> {
  const lines = await loadLines(join(dir, fixture));
  const adapter = ADAPTERS.find((a) => a.dir === dir) as (typeof ADAPTERS)[number];
  try {
    return summarize(await collect(adapter.run(USER, [SPEC], fetchImpl)));
  } catch (err) {
    // 适配器抛错 = 该家该轮失败（判为红，错误信息进断言标签，不让脚本崩溃丢上下文）
    return { text: "", calls: [], usage: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- ① 文本流等价：三家文本逐字相同、usage 均 > 0 ----
console.log("[providers-check] ① 文本流等价（同一逻辑对话，三家 fixture 各自回放）");
{
  const texts: string[] = [];
  for (const a of ADAPTERS) {
    const s = await replayTurn(a.dir, "text-stream.sse", stubFetch(await loadLines(join(a.dir, "text-stream.sse"))));
    texts.push(s.text);
    assert(
      s.usage !== null && s.usage.inputTokens > 0 && s.usage.outputTokens > 0,
      `${a.key} usage 均 > 0（${s.usage ? `${String(s.usage.inputTokens)}/${String(s.usage.outputTokens)}` : "缺失"}）`,
    );
  }
  const allEqual = texts.every((t) => t === texts[0]);
  assert(allEqual, `三家文本逐字相同：${texts.map((t) => `[${t}]`).join(" ")}`);
  assert(texts[0] === "你好，世界", `文本内容与协议无关的期望一致（${texts[0]}）`);
}

// ---- ② 工具调用等价：名与参数相同（分片拼 JSON + 并行调用全解析）----
console.log("[providers-check] ② 工具调用等价（anthropic 分片参数拼成完整 JSON / gemini 并行 functionCall 全解析）");
{
  const summaries: TurnSummary[] = [];
  for (const a of ADAPTERS) {
    summaries.push(await replayTurn(a.dir, "tool-call.sse", stubFetch(await loadLines(join(a.dir, "tool-call.sse")))));
  }
  const nameSets = summaries.map((s) => JSON.stringify(s.calls.map((c) => c.name)));
  const argSets = summaries.map((s) => JSON.stringify(s.calls.map((c) => c.args)));
  assert(
    new Set(summaries.map((s) => s.calls.length)).size === 1 && summaries[0].calls.length === 2,
    `三家 tool_call 数量一致且并行调用全解析（各 ${String(summaries[0].calls.length)} 条）`,
  );
  assert(new Set(nameSets).size === 1, `三家 tool_call 名相同：${nameSets.join(" | ")}`);
  const errNotes = summaries.map((s, i) => (s.error ? " [" + ADAPTERS[i].key + ": " + s.error + "]" : "")).join("");
  assert(new Set(argSets).size === 1, "三家 tool_call 参数相同（分片参数拼成完整 JSON）：" + argSets.join(" | ") + errNotes);
  assert(
    JSON.stringify(summaries[0].calls) ===
      JSON.stringify([
        { name: "read_file", args: { path: "a.ts" } },
        { name: "read_file", args: { path: "b.ts" } },
      ]),
    "参数与协议无关的期望一致（a.ts / b.ts 两条，JSON 完整未截断）",
  );
  assert(
    summaries.every((s) => s.usage !== null && s.usage.outputTokens > 0),
    "三家 usage 均 > 0",
  );
}

// ---- ③ 错误转可读错误 ----
console.log("[providers-check] ③ 错误事件 → 可读错误（不静默吞）");
{
  const expectations: Record<string, RegExp> = {
    openai: /OpenAI 流错误 server_error/,
    anthropic: /Anthropic 流错误 overloaded_error/,
    gemini: /Gemini 流错误 RESOURCE_EXHAUSTED/,
  };
  for (const a of ADAPTERS) {
    const lines = await loadLines(join(a.dir, "error.sse"));
    let message = "";
    try {
      await collect(a.run(USER, [SPEC], stubFetch(lines)));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    assert(expectations[a.key].test(message), `${a.key} 错误转可读消息：${message.slice(0, 80)}`);
  }
}

// ---- ④ 未知事件优雅跳过 ----
console.log("[providers-check] ④ 未知事件优雅跳过（不抛错，正常文本继续）");
{
  for (const a of ADAPTERS) {
    const lines = await loadLines(join(a.dir, "unknown.sse"));
    let text = "";
    let threw = false;
    try {
      text = (await collect(a.run(USER, [SPEC], stubFetch(lines)))).reduce(
        (acc, e) => (e.type === "assistant_delta" ? acc + e.text : acc),
        "",
      );
    } catch {
      threw = true;
    }
    assert(!threw && text === "你好，世界", `${a.key} 未知事件不抛且文本正常（${threw ? "抛错" : text}）`);
  }
}

// ---- ⑤ 三家适配器互不 import（文件名 grep）----
console.log("[providers-check] ⑤ 三家适配器互不 import（grep 彼此文件名）");
{
  const names = ["openai.ts", "anthropic.ts", "gemini.ts"] as const;
  for (const a of ADAPTERS) {
    const src = await readFile(join(ROOT, "src", "providers", `${a.key}.ts`), "utf8");
    const others = names.filter((n) => n !== `${a.key}.ts`);
    const hit = others.filter((n) => src.includes(n));
    assert(hit.length === 0, `${a.key}.ts 不引用 ${others.join("/")}${hit.length > 0 ? `（命中: ${hit.join(",")}）` : ""}`);
  }
}

// ---- ⑥ 暗卷（有 key 才跑）----
console.log("[providers-check] ⑥ 暗卷（真实 key，哪家有跑哪家）");
{
  const DARKS = [
    { env: "OPENAI_API_KEY", model: "gpt-4o-mini", run: (k: string) => streamOpenAI(USER, { apiKey: k, model: "gpt-4o-mini" }) },
    { env: "ANTHROPIC_API_KEY", model: "claude-sonnet-4-5", run: (k: string) => streamAnthropic(USER, { apiKey: k, model: "claude-sonnet-4-5", maxTokens: 256 }) },
    { env: "GEMINI_API_KEY", model: "gemini-2.5-flash", run: (k: string) => streamGemini(USER, { apiKey: k, model: "gemini-2.5-flash" }) },
  ];
  const present = DARKS.filter((d) => process.env[d.env]);
  if (present.length === 0) {
    console.log("  暗卷跳过（未检测到 OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY）");
  } else {
    for (const d of present) {
      const key = process.env[d.env] as string;
      try {
        const events = await collect(d.run(key));
        const deltas = events.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
        assert(deltas.length >= 2, `${d.env}（${d.model}）真实流式 ≥2 delta（实际 ${String(deltas.length)}）`);
      } catch (err) {
        failures++;
        console.error(`  ❌ ${d.env}（${d.model}）暗卷失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`[providers-check] 失败: ${String(failures)} 项断言未通过`);
  process.exitCode = 1;
} else {
  console.log("[providers-check] 全部断言通过");
}
