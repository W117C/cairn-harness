// 生产入口证明：会话型 provider 每轮组装时真的把被裁原文落到 <日志同级>/prune-attachments，
// 且打桩文本把路径交给模型（否则 §7.4 的「可回取」只是测试里才走到的分支）。
// 这里跑的是 createGlmSessionProvider 的真实 assemble() 路径——只测 computePrune 纯函数
// 不足以证明这条：那正是本仓反复点名的「两头断」。
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { createGlmSessionProvider } from "../src/agent/glm-session";
import { PRUNED_PLACEHOLDER } from "../src/agent/prune";
import type { GlmMessage } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", () => ({
  buildMemoryInjection: async () => ({ project: null, global: null }),
}));

const KB = 1024;
let dir = "";
let logPath = "";

async function seed(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "prune-prod-"));
  logPath = join(dir, "events.jsonl");
  const log = createEventLog(logPath);
  // 4 个轮次 × 120KB 结果：保护区 40k 吞掉最新两条、最近 2 轮免剪 ⇒ 候选是 F 与 G
  const round = (n: number, ch: string): AgentEvent[] => [
    { type: "user_message", content: "r" + String(n) },
    { type: "tool_call", id: ch, name: "read_file", args: { path: ch + ".ts" } },
    { type: "tool_result", callId: ch, ok: true, output: ch.repeat(120 * KB) },
  ];
  const events: AgentEvent[] = [...round(1, "F"), ...round(2, "G"), ...round(3, "H"), ...round(4, "I")];
  for (const e of events) await log.append(e);
  await log.close?.();
}

async function oneRequest(): Promise<GlmMessage[]> {
  const captured: GlmMessage[][] = [];
  const provider = createGlmSessionProvider(logPath, {
    map: false,
    workspace: dir,
    transport: async function* (messages) {
      captured.push(messages);
      yield { type: "assistant_message", content: "收到" };
    },
  });
  for await (const _ of provider.stream([])) { /* drain */ }
  return captured[0] ?? [];
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("prune 存盘回取的生产入口", () => {
  it("①打桩文本带着附件路径，模型能照着取回全文", async () => {
    await seed();
    const msgs = await oneRequest();
    const stubbed = msgs.filter((m) => m.role === "tool" && typeof m.content === "string" && m.content.startsWith(PRUNED_PLACEHOLDER));
    expect(stubbed.length).toBeGreaterThan(0);
    for (const m of stubbed) {
      expect(m.content).toContain("prune-attachments");
      expect(m.content).toContain(".txt");
      expect(m.content).toContain("read_file");
    }
  });

  it("②附件真落在盘上且逐字等于被裁原文（不是只写了个路径）", async () => {
    await seed();
    const msgs = await oneRequest();
    const stubbed = msgs.filter((m) => m.role === "tool" && typeof m.content === "string" && m.content.startsWith(PRUNED_PLACEHOLDER));
    expect(stubbed.length).toBeGreaterThan(0);
    const seen: string[] = [];
    for (const m of stubbed) {
      const path = m.content!.split("\n")[1]!.match(/\/\S+\.txt/u)?.[0];
      expect(path).toBeDefined();
      const raw = await readFile(path!, "utf8"); // 读不到就抛 ⇒ 路径必须是真的
      expect(["F".repeat(120 * KB), "G".repeat(120 * KB)]).toContain(raw);
      seen.push(raw.slice(0, 1));
    }
    expect(seen.sort()).toEqual(["F", "G"]); // 两条被裁的都留了底
  });

  it("③重复装配不产生第二份、也不覆写（每轮都跑 assemble，幂等是硬要求）", async () => {
    await seed();
    await oneRequest();
    const first = await readdir(join(dir, "prune-attachments"));
    await oneRequest();
    await oneRequest();
    const after = await readdir(join(dir, "prune-attachments"));
    expect(after.sort()).toEqual(first.sort());
  });
});
