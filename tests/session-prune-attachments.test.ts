// 生产入口证明：会话型 provider 每轮组装时真的把被裁原文落到 <日志同级>/prune-attachments，
// 且模型看到的那句尾注与「附件在不在工作区里」这个事实**一致**（#33：原先无条件说「存附件 <绝对路径>，
// 需要时 read_file 取回」，而那七个工具第一句就拒绝对路径 ⇒ 空话）。
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
  // 生产这一跳**今天没把 workspace 传进 computePrune**（`glm-session.ts` 的实参只有 events/attachmentsDir/
  // sessionId），而附件目录与会话日志同级 ⇒ 落位判定走「区外/未知」那一案。#33 的裁决＝分案改文案、
  // 不给 read_file 开第二根允许例，所以这两格钉的是「没接上时不许说谎 + 能力仍然真落盘」，
  // 而不是旧写法那句「打桩带绝对路径」——那正是被冻进用例里的假承诺。
  // 接线（把这层已有的 opts.workspace 传下去）在别人在飞的那支文件里，登记为任务 #3 的余下半格。
  it("①生产形状（组装点未传 workspace）：递诚实话，且不递任何模型用不了的路径", async () => {
    await seed();
    const msgs = await oneRequest();
    const stubbed = msgs.filter((m) => m.role === "tool" && typeof m.content === "string" && m.content.startsWith(PRUNED_PLACEHOLDER));
    expect(stubbed.length).toBeGreaterThan(0);
    for (const m of stubbed) {
      expect(m.content).toContain("读不到");
      expect(m.content).toContain("由用户打开");
      expect(m.content).not.toMatch(/附件 \S/u); // 不递假地址
      expect(m.content).not.toContain("prune-attachments"); // 绝对路径一个字节都不进上下文
    }
  });

  it("②附件真落在盘上且逐字等于被裁原文（不是只写了个路径）", async () => {
    await seed();
    const msgs = await oneRequest();
    const stubbed = msgs.filter((m) => m.role === "tool" && typeof m.content === "string" && m.content.startsWith(PRUNED_PLACEHOLDER));
    expect(stubbed.length).toBeGreaterThan(0);
    // 路径来源改成**生产实际写出的那个目录**：旧写法从打桩文本里正则抠路径，文案一改就抠不到，
    // 而这一格要证的从来是"真落盘"，不是"文案里带不带路径"。
    const atDir = join(dir, "prune-attachments");
    const raws: string[] = [];
    for (const n of (await readdir(atDir)).sort()) raws.push(await readFile(join(atDir, n), "utf8"));
    expect(raws.length).toBe(stubbed.length); // 每条被裁的都有底，不多写也不漏写
    expect(raws.sort()).toEqual(["F".repeat(120 * KB), "G".repeat(120 * KB)]); // 逐字等于被裁原文
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
