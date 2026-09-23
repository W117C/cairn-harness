// providers-check —— M2c 跨 provider 契约验收（pnpm providers-check）。
// ①同一逻辑对话（一轮文本 + 一次工具调用 + usage）在 openai/anthropic/gemini 三家适配器下
//   产出等价事件序列：文本逐字相同、tool_call 名与参数相同（anthropic 分片参数拼成完整 JSON、
//   gemini 一个 chunk 多个并行 functionCall 全解析）、usage 均 > 0。
// ②三家适配器互不 import（grep src/providers/{openai,anthropic,gemini}.ts 不出现彼此文件名）。
// ③暗卷（有 key 才跑）：OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 检测到哪家跑哪家，
//   断言真实流式返回 ≥2 个 delta；一家都没有 → 打印「暗卷跳过」退出 0。
// ⑦BYOK 可达性（合取 + 只降不升水位）：设置面选项 ⊆ 可存 key 的 provider；可路由的每家必须有 env 名
//   映射；注入面**跑真函数**逐家验到（不是查表）；「可路由但存不进 key」的集合须逐字等于登记水位。
// ⑧映射与适配器实际取料面对账：走 toWorkerModel（worker 真路径）撤 key 撤 env，抛错消息须点名表里那个变量。
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
import { ENV_KEYED_PROVIDERS, PROVIDER_ENV_KEYS, envKeyOf } from "../src/providers/env-keys";
import { byokGapsOf, sameSet, setDiff, type ByokFacts } from "../src/providers/byok";
import { DEFAULT_MODEL_TABLE, PROVIDER_IDS as ROUTABLE_PROVIDER_IDS, toWorkerModel } from "../src/providers/registry";
import { PROVIDER_IDS as STORABLE_PROVIDER_IDS, setProviderKeyBackend, type ProviderKeyBackend } from "../src/main/provider-keys";
import { injectStoredProviderKey } from "../src/main/provider-key-inject";
import { PROVIDER_KINDS } from "../src/main/settings";

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

// ---- ⑤ 三家适配器互不 import（H8，审查 P2：AST 提取真实 import 说明符）----
console.log("[providers-check] ⑤ 三家适配器互不 import（AST import 说明符判定）");
{
  // 旧实现用 src.includes("openai.ts") 字符串判定：`import ... from "./openai"`（无扩展名）漏判，
  // 注释里出现文件名则假红。AST 只认真实 ImportDeclaration 的说明符。
  const ts = await import("typescript");
  const importSpecifiers = (src: string): string[] => {
    const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const out: string[] = [];
    // 审查 H-1（agents 分片）：只遍历 sf.statements 会漏掉动态 import（await import("./openai")
    // 不是 ImportDeclaration）——旧子串判据反而能命中带扩展名的动态导入，AST 化时不能把
    // 命中面缩小。改为全量下潜：静态说明符 + 动态 import(...) 首参字面量一并收集。
    const walk = (n: import("typescript").Node): void => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
        const mod = (n as { moduleSpecifier?: { text?: string } }).moduleSpecifier;
        if (mod && typeof mod.text === "string") out.push(mod.text);
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a0 = n.arguments[0];
        if (a0 !== undefined && ts.isStringLiteralLike(a0)) out.push(a0.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    return out;
  };
  const names = ["openai.ts", "anthropic.ts", "gemini.ts"] as const;
  for (const a of ADAPTERS) {
    const src = await readFile(join(ROOT, "src", "providers", `${a.key}.ts`), "utf8");
    const others = names.filter((n) => n !== `${a.key}.ts`);
    const specs = importSpecifiers(src);
    const hit = others.filter((n) =>
      specs.some((s) => s.endsWith("/" + n.replace(/\.ts$/, "")) || s.endsWith("/" + n) || s === "./" + n.replace(/\.ts$/, "")),
    );
    assert(hit.length === 0, `${a.key}.ts 不 import ${others.join("/")}${hit.length > 0 ? `（命中: ${hit.join(",")}）` : ""}`);
  }
}

// ---- ⑥ 暗卷（有 key 才跑）----
console.log("[providers-check] ⑥ 暗卷（真实 key，哪家有跑哪家）");
{
  const DARKS = [
    { env: PROVIDER_ENV_KEYS.openai, model: "gpt-4o-mini", run: (k: string) => streamOpenAI(USER, { apiKey: k, model: "gpt-4o-mini" }) },
    { env: PROVIDER_ENV_KEYS.anthropic, model: "claude-sonnet-4-5", run: (k: string) => streamAnthropic(USER, { apiKey: k, model: "claude-sonnet-4-5", maxTokens: 256 }) },
    { env: PROVIDER_ENV_KEYS.gemini, model: "gemini-2.5-flash", run: (k: string) => streamGemini(USER, { apiKey: k, model: "gemini-2.5-flash" }) },
  ];
  const present = DARKS.filter((d) => process.env[d.env]);
  if (present.length === 0) {
    console.log("  暗卷跳过（未检测到 OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY）");
    console.log("UNVERIFIED=1"); // H2（审查 P1-16）：跳过 ≠ 通过，上浮到门禁汇总
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

/** 缺口清单进断言标签时的可读化。不用 `xs.join("/") || "无"`：`||` 会被 `assertion-health` 的
 *  析取式扫描按「断言含 ||」记账（它看整棵 AST，不看这个 `||` 在条件位还是标签位），
 *  而给标签开 `disjunction-ok` 豁免等于把这条闸的语义弄脏——空数组本来就是"无"，直接写。 */
const orNone = (xs: readonly string[]): string => (xs.length === 0 ? "无" : xs.join("/"));

// ---- ⑦ BYOK 可达性（合取 + 只降不升水位）----
// 「能力发货、入口没通」的机器化：路由能选到一家 provider，与用户能为它配上一把 key，
// 是两件事。本段一次读四支取料面（UI 的按钮 / 设置可持久化面 / key 存储白名单 / 启动注入面），
// 把它们对成一份缺口清单。水位 = **已知的 V1 边界**，只许缩小不许扩大（两侧各一条断言，
// 单边判据会被下一次改动从另一侧绕过去）。
const BYOK_NO_KEY_WAIVER: readonly string[] = ["openai", "anthropic", "gemini"];
console.log("[providers-check] ⑦ BYOK 可达性（设置面 ⊆ 可存 key；可路由每家须有 env 名与注入覆盖；边界水位只降不升）");
{
  const html = await readFile(join(ROOT, "src", "renderer", "index.html"), "utf8");
  const offeredMatch = html.match(/data-setting="provider"[^>]*>([\s\S]*?)<\/div>/);
  const offeredUi = offeredMatch ? [...offeredMatch[1].matchAll(/data-val="([^"]+)"/g)].map((m) => m[1]) : [];
  // 解析失效必须可见：offeredUi=[] 会让下面每条合取 vacuously 成立（本仓点名的「读到 0 即绿」形态）。
  assert(offeredUi.length > 0, `设置面 provider 选项解析到 ${String(offeredUi.length)} 枚（0 = 解析失效，不许 vacuous 绿）`);
  assert(
    setDiff(offeredUi, [...PROVIDER_KINDS]).length === 0,
    `UI 按钮 ⊆ 设置可持久化面（UI: ${offeredUi.join("/")} · 可持久化: ${PROVIDER_KINDS.join("/")}）`,
  );

  // 注入面跑**真函数**：内存后端替 env 表里每家备一把哨兵 key，看各自 env 名有没有被写上。
  // 今天存储白名单只有 glm，但这一跑先把「白名单扩到四家」的那天验到位——硬编码 "glm" 的旧实现当场红。
  const sentinel = new Map<string, string>();
  for (const p of ENV_KEYED_PROVIDERS) sentinel.set(p, `byok-probe-${p}-0123456789`);
  const memBackend: ProviderKeyBackend = {
    name: "in-memory-probe",
    isAvailable: () => true,
    async set(p, v) { sentinel.set(p, v); },
    async get(p) { return sentinel.get(p) ?? null; },
    async delete(p) { return sentinel.delete(p); },
    async storedProviders() { return [...sentinel.keys()]; },
  };
  const savedEnv = new Map<string, string | undefined>();
  for (const p of ENV_KEYED_PROVIDERS) {
    const n = envKeyOf(p) as string;
    savedEnv.set(n, process.env[n]);
    delete process.env[n];
  }
  let injected: string[] = [];
  setProviderKeyBackend(memBackend);
  try {
    await injectStoredProviderKey(ENV_KEYED_PROVIDERS);
    injected = ENV_KEYED_PROVIDERS.filter((p) => process.env[envKeyOf(p) as string] === sentinel.get(p));
  } finally {
    setProviderKeyBackend(null);
    for (const [n, v] of savedEnv) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }

  const routable = [...new Set([...ROUTABLE_PROVIDER_IDS, ...DEFAULT_MODEL_TABLE.map((s) => s.provider)])];
  const gaps = byokGapsOf({
    routable,
    storable: STORABLE_PROVIDER_IDS,
    envKeyed: ENV_KEYED_PROVIDERS,
    injected,
    offered: [...new Set([...offeredUi, ...PROVIDER_KINDS])],
  } satisfies ByokFacts);
  assert(
    gaps.routableWithoutEnvKey.length === 0,
    `可路由的每家都有 env 名映射（缺: ${orNone(gaps.routableWithoutEnvKey)}）`,
  );
  assert(
    setDiff(ENV_KEYED_PROVIDERS, injected).length === 0,
    `启动注入面对 env 表每家真注入到各自 env 名（已注入: ${orNone(injected)}）`,
  );
  assert(
    gaps.storableNotInjected.length === 0,
    `可存 key 的每家都被注入面覆盖（缺: ${orNone(gaps.storableNotInjected)}）`,
  );
  assert(
    gaps.offeredNotStorable.length === 0,
    `设置面选项 ⊆ 可存 key 的 provider ∪ {demo}（越界: ${orNone(gaps.offeredNotStorable)}）`,
  );
  assert(
    sameSet(gaps.routableNotStorable, BYOK_NO_KEY_WAIVER),
    `「可路由但存不进 key」逐字等于登记水位（实测 ${orNone(gaps.routableNotStorable)} · ` +
      `水位 ${orNone(BYOK_NO_KEY_WAIVER)}；扩一家不给 key 通道 ⇒ 前者多出该项，开了白名单忘了撤水位 ⇒ 后者多出该项）`,
  );
}

// ---- ⑧ env 名映射 == 适配器实际取料面 ----
// 表写对了但适配器其实读另一个变量，⑦ 四条全绿也看不见——这段走 **toWorkerModel**（worker 真路径），
// 撤掉 env、不传 key，断言抛错消息点名表里那个变量名。顺序放在 ⑥ 暗卷之后：这段会临时删 env。
console.log("[providers-check] ⑧ env 名映射与适配器实际取料面对账（撤 key 撤 env，走 toWorkerModel 真抛错）");
{
  const savedEnv = new Map<string, string | undefined>();
  for (const p of ENV_KEYED_PROVIDERS) {
    const n = envKeyOf(p) as string;
    savedEnv.set(n, process.env[n]);
    delete process.env[n];
  }
  try {
    for (const p of ENV_KEYED_PROVIDERS) {
      const envName = envKeyOf(p) as string;
      const spec = DEFAULT_MODEL_TABLE.find((s) => s.provider === p);
      if (!spec) {
        assert(false, `档位表里找不到 provider=${p} 的任何一档 ⇒ 对账无从起跑（映射表与档位表已失配）`);
        continue;
      }
      let message = "";
      try {
        for await (const ev of toWorkerModel(spec)(USER as never, [] as never)) {
          void ev;
          break;
        }
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      assert(message.includes(envName), `${p}：无 key 无 env 时抛错点名 ${envName}（实际「${message === "" ? "未抛错" : message.slice(0, 64)}」）`);
    }
  } finally {
    for (const [n, v] of savedEnv) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

if (failures > 0) {
  console.error(`[providers-check] 失败: ${String(failures)} 项断言未通过`);
  process.exitCode = 1;
} else {
  console.log("[providers-check] 全部断言通过");
}
