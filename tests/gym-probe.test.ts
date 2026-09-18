// 装配探针自证（能力 10 的度量面）：它必须量得出「harness 装了多少」，
// 且分层守恒、方向正确——否则 A/B 一张假表比没有表更坏。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { createEventLog, type AgentEvent } from "../src/events";
import { runLoop } from "../src/agent/loop";
import { createMockProvider } from "../src/providers/mock";
import { loadCase, loadGymIndex } from "../src/agent/gym/case";
import { cleanupRun, runCase } from "../src/agent/gym/runner";
import type { GlmToolSpec } from "../src/providers/glm";
import {
  classifyAssembly,
  createProbeTransport,
  diffAssembly,
  probeAssembly,
  rankToolSpecs,
  summarizeAssembly,
  type AssemblyTurn,
} from "../src/agent/gym/probe";

const turn0 = (content: string): AgentEvent => ({ type: "assistant_message", content });

describe("classifyAssembly 分层守恒", () => {
  const tools: GlmToolSpec[] = [
    { type: "function", function: { name: "read_file", description: "读", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  ];
  const MSGS = [
    { role: "system", content: "基础提示（整轮不变）" },
    { role: "system", content: "[记忆] 逐轮检索出来的条目" },
    { role: "user", content: "修个 bug" },
    { role: "assistant", content: "我先看文件" },
  ] as unknown as Parameters<typeof classifyAssembly>[1][];
  const msgs = MSGS as unknown as Parameters<typeof classifyAssembly>[1];

  it("可缓存 = 首条 system + 工具 schema；易变 system 与历史各归各段", () => {
    const t = classifyAssembly(1, msgs, tools);
    expect(t.cacheableBytes).toBeGreaterThan(0);
    expect(t.volatileSystemBytes).toBeGreaterThan(0);
    expect(t.historyBytes).toBeGreaterThan(0);
    // JSON.stringify(数组) = "[" + 项们以 "," 连接 + "]" ⇒ 分量与总量的差恰是结构开销
    expect(t.promptBytes - (t.cacheableBytes + t.volatileSystemBytes + t.historyBytes))
      .toBe(2 + (msgs.length - 1));
    expect(t.messages).toBe(4);
  });

  it("没有工具 ⇒ 工具面 0 字节（可缓存段只剩基础提示）", () => {
    const withTools = classifyAssembly(1, msgs, tools);
    const noTools = classifyAssembly(1, msgs, []);
    expect(noTools.cacheableBytes).toBeLessThan(withTools.cacheableBytes);
    expect(noTools.promptBytes).toBe(withTools.promptBytes - (withTools.cacheableBytes - noTools.cacheableBytes));
  });
});

describe("rankToolSpecs（工具面按条拆账）", () => {
  const t = (name: string, desc: string): GlmToolSpec => ({
    type: "function",
    function: { name, description: desc, parameters: { type: "object", properties: { a: { type: "string" } } } },
  });

  it("排行相加恰等于工具 schema 总字节（含括号与逗号，不留结构开销当糊涂账）", () => {
    const tools = [t("one", "x".repeat(300)), t("two", "y".repeat(80)), t("three", "z".repeat(1500))];
    const ranked = rankToolSpecs(tools);
    expect(ranked.reduce((n, x) => n + x.bytes, 0)).toBe(Buffer.byteLength(JSON.stringify(tools), "utf8"));
    expect(ranked.map((x) => x.name)).toEqual(["three", "one", "two"]); // 降序：砍谁最省一眼可见
  });

  it("单工具与空表都不越界（n=1 只有方括号，无逗号）", () => {
    const single = [t("only", "d")];
    expect(rankToolSpecs(single).reduce((n, x) => n + x.bytes, 0)).toBe(Buffer.byteLength(JSON.stringify(single), "utf8"));
    expect(rankToolSpecs([])).toEqual([]);
  });

  it("probe 报告带排行；工具面字节的和 = 可缓存前缀里的工具部分", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "gym-probe-rank-"));
    try {
      const evPath = join(dir2, "events.jsonl");
      await writeFile(evPath, "", "utf8");
      const sc = join(dir2, "s.jsonl");
      await writeFile(sc, JSON.stringify(turn0("done")) + "\n", "utf8");
      const { provider, report } = await probeAssembly({ caseId: "c", eventsPath: evPath, workspace: dir2, system: "s", scriptPath: sc, map: false });
      for await (const _e of provider.stream([] as never)) void _e;
      const r = report();
      expect(r.toolRanking?.length).toBeGreaterThan(0);
      const sum = (r.toolRanking ?? []).reduce((n, x) => n + x.bytes, 0);
      expect(sum).toBeLessThan(r.cacheableBytes + 1); // 工具面 ⊂ 可缓存前缀（另一块是基础提示）
      expect(r.turns[0].cacheableBytes).toBeGreaterThan(sum);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

describe("探针驱动真装配链（走 composeTurnMessages，不出网）", () => {
  let dir: string;
  let eventsPath: string;
  let scriptPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gym-probe-"));
    eventsPath = join(dir, "events.jsonl");
    await writeFile(eventsPath, "", "utf8");
    scriptPath = join(dir, "script.jsonl");
    await writeFile(scriptPath, JSON.stringify(turn0("## 结论\n- 已看完")) + "\n", "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  // 每次 drive 用独立子目录 + 独立事件日志：共用日志会让第二次的历史投影盖住真实差分（A/B 假象）。
  const drive = async (over: { mode?: "default" | "read-only"; extraTools?: GlmToolSpec[] } = {}): Promise<ReturnType<typeof summarizeAssembly>> => {
    const runDir = await mkdtemp(join(dir, "run-"));
    const runEvents = join(runDir, "events.jsonl");
    await writeFile(runEvents, "", "utf8");
    const { provider, report } = await probeAssembly({
      caseId: "probe-case",
      eventsPath: runEvents,
      workspace: runDir,
      system: "你是编程 agent，按工具办事。",
      scriptPath,
      map: false,
      ...over,
    });
    await runLoop({
      provider,
      events: createEventLog(runEvents),
      workspace: runDir,
      mode: "default",
      userMessage: "读一下 README 并总结",
    });
    return report();
  };

  it("一次真实 run 留下装配账：请求数 ≥1，可缓存段与历史段都非零", async () => {
    const r = await drive();
    expect(r.requests).toBeGreaterThanOrEqual(1);
    expect(r.cacheableBytes).toBeGreaterThan(0); // 工具 schema + 基础提示
    expect(r.turns[0].historyBytes).toBeGreaterThan(0); // 用户任务进了历史
    expect(r.totalPromptBytes).toBeGreaterThan(r.cacheableBytes);
  });

  it("A/B：只读档工具面更小 ⇒ 可缓存前缀变小（差分表能报出这次装载省了多少）", async () => {
    const before = await drive({ mode: "default" });
    const after = await drive({ mode: "read-only" });
    const d = diffAssembly(before, after);
    expect(d.cacheableBytes).toBeLessThan(0);
    expect(d.totalPromptBytes).toBeLessThan(0);
  });

  it("A/B：往工具面塞一个大工具 ⇒ 增量恰等于它的 JSON 字节（不是估的，是账）", async () => {
    const big: GlmToolSpec = {
      type: "function",
      function: { name: "probe_extra_tool", description: "x".repeat(500), parameters: { type: "object", properties: { a: { type: "string" } } } },
    };
    const before = await drive();
    const after = await drive({ extraTools: [big] });
    // 数组里多一项：自身 JSON 字节 + 一个逗号分隔符
    const expected = Buffer.byteLength(JSON.stringify(big), "utf8") + 1;
    expect(diffAssembly(before, after).cacheableBytes).toBe(expected);
  });

  it("runCase 的 probe 档把装配账带出来（CLI 走的就是这条路，不是只测纯函数）", async () => {
    const gymRoot = join(process.cwd(), "fixtures", "gym");
    const c = await loadCase(gymRoot, (await loadGymIndex(gymRoot)).cases.find((x) => x.id === "sum-clamp")!);
    const r = await runCase(c, { model: "probe" });
    try {
      expect(r.score, "探针档不得改变任务结果").toBe(1);
      expect(r.assembly, "probe 档必须带回装配账").toBeDefined();
      expect(r.assembly!.requests).toBeGreaterThanOrEqual(1);
      expect(r.assembly!.cacheableBytes).toBeGreaterThan(0);
    } finally {
      await cleanupRun(r);
    }
  });

  it("剧本形状不合（非 assistant/tool_call）⇒ 显式抛错，不静默少装", async () => {
    await writeFile(scriptPath, JSON.stringify({ type: "usage", inputTokens: 1, outputTokens: 1 }) + "\n", "utf8");
    const seen: AssemblyTurn[] = [];
    const transport = createProbeTransport(scriptPath, (t) => { seen.push(t); });
    await expect(async () => {
      for await (const _o of transport([{ role: "user", content: "hi" }], {}, [])) void _o;
    }).rejects.toThrow(/装配探针剧本/);
    expect(seen).toHaveLength(1); // 记账发生在读剧本之前
  });

  it("探针不改模型可见行为：同一剧本下 mock 与 probe 产出同一串 ModelOutput", async () => {
    const mockEvents: AgentEvent[] = [];
    const mock = createMockProvider(scriptPath);
    for await (const e of mock.stream([] as never)) mockEvents.push(e as AgentEvent);
    const { provider } = await probeAssembly({ caseId: "c", eventsPath, workspace: dir, system: "s", scriptPath, map: false });
    const probeEvents: AgentEvent[] = [];
    for await (const e of provider.stream([] as never)) probeEvents.push(e as AgentEvent);
    expect(probeEvents.map((e) => JSON.stringify(e))).toEqual(mockEvents.map((e) => JSON.stringify(e)));
  });
});
