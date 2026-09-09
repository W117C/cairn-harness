// M2b 任务 6+7 验收（prune 执行器 + 类型化规则）：
// ①预计裁剪未达 20k → 不修剪（too-small，零替换）②最近 2 轮不被剪 ③免剪名单条目不被剪
// ④被裁原文可从附件目录读回且逐字一致。类型化：code/log/doc 三类 + 摘要 2k 截断。
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computePrune,
  writePruneAttachments,
  attachmentPathFor,
  PRUNED_PLACEHOLDER,
} from "../src/agent/prune.js";
import type { AgentEvent } from "../src/events";

const KB = 1024;

let attachments = "";

beforeEach(async () => {
  attachments = await mkdtemp(join(tmpdir(), "m2b-prune-"));
});

describe("prune（任务 6）", () => {
  it("①预计裁剪未达 20k → 不修剪（too-small，零替换）", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "a", name: "read_file", args: {} },
      { type: "tool_result", callId: "a", ok: true, output: "A".repeat(60 * KB) }, // 15k token，区外候选
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "b", name: "read_file", args: {} },
      { type: "tool_result", callId: "b", ok: true, output: "B".repeat(100 * KB) }, // 25k
      { type: "user_message", content: "r3" },
      { type: "tool_call", id: "c", name: "read_file", args: {} },
      { type: "tool_result", callId: "c", ok: true, output: "C".repeat(100 * KB) }, // 25k，最新
    ];
    // 保护区从最新回退：C 25k → B 25k（累计 50k ≥ 40k，B 区内）→ 候选只有 A（15k < 20k 最小修剪）
    const r = computePrune({ events });
    expect(r.why).toBe("too-small");
    expect(r.replacements.size).toBe(0);
  });

  it("②最近 2 轮不被剪；第 1 轮的旧大结果被剪", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "a", name: "read_file", args: {} },
      { type: "tool_result", callId: "a", ok: true, output: "A".repeat(120 * KB) }, // 30k，第 1 轮
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "b", name: "read_file", args: {} },
      { type: "tool_result", callId: "b", ok: true, output: "B".repeat(120 * KB) }, // 30k，第 2 轮
      { type: "user_message", content: "r3" },
      { type: "tool_call", id: "c", name: "run_shell", args: { command: "ls" } },
      { type: "tool_result", callId: "c", ok: true, output: "C".repeat(120 * KB) }, // 30k，第 3 轮（最新）
    ];
    const r = computePrune({ events });
    // 保护区从最新回退：C 30k → B 30k（60k ≥ 40k，B 区内）；A 区外且属第 1 轮（超出最近 2 轮）→ 被剪
    expect(r.replacements.has(3)).toBe(true);
    expect(r.replacements.has(6)).toBe(false); // 第 2 轮（最近 2 轮内）
    expect(r.replacements.has(9)).toBe(false); // 第 3 轮
  });

  it("③免剪名单（skill 注入 / grep / 错误结果）不被剪；普通旧大结果被剪", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "第 1 轮" },
      { type: "tool_call", id: "r2", name: "read_file", args: {} },
      { type: "tool_result", callId: "r2", ok: true, output: "R".repeat(100 * KB) }, // 25k，最老（免剪区外）
      { type: "user_message", content: "第 2 轮" },
      { type: "tool_call", id: "s1", name: "skill", args: {} },
      { type: "tool_result", callId: "s1", ok: true, output: "S".repeat(60 * KB) }, // 15k，免剪名单
      { type: "tool_call", id: "g1", name: "grep", args: { pattern: "x" } },
      { type: "tool_result", callId: "g1", ok: true, output: "G".repeat(60 * KB) }, // 15k，grep 免剪
      { type: "tool_call", id: "e1", name: "read_file", args: {} },
      { type: "tool_result", callId: "e1", ok: false, output: "E".repeat(60 * KB) }, // 15k，错误结果免剪
      { type: "user_message", content: "第 3 轮（最新）" },
      { type: "tool_call", id: "n1", name: "read_file", args: {} },
      { type: "tool_result", callId: "n1", ok: true, output: "N".repeat(60 * KB) }, // 15k，最新轮
    ];
    // 保护区从最新回退：N 15k → E 15k → G 15k → S 15k = 60k ≥ 40k（边界落在 E/G 之间）
    // → R2（第 1 轮）在区外且在最近 2 轮免剪区（第 2、3 轮）之外 → 唯一候选
    const r = computePrune({ events });
    expect(r.why).toBe("saved");
    expect(r.replacements.has(3)).toBe(true); // 只有普通旧大结果被剪
    expect(r.replacements.has(6)).toBe(false); // skill 内容免剪
    expect(r.replacements.has(8)).toBe(false); // grep 免剪
    expect(r.replacements.has(10)).toBe(false); // 错误结果免剪
    expect([...r.replacements.values()].every((v) => v === PRUNED_PLACEHOLDER)).toBe(true);
  });

  it("④被裁原文写附件目录，读回逐字一致（GEM saveTruncatedToolOutput 同构）", async () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "任务" },
      { type: "tool_call", id: "big", name: "read_file", args: {} },
      { type: "tool_result", callId: "big", ok: true, output: "Z".repeat(120 * KB) }, // 30k，旧
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "f1", name: "read_file", args: {} },
      { type: "tool_result", callId: "f1", ok: true, output: "F".repeat(120 * KB) }, // 30k，中
      { type: "user_message", content: "r3" },
      { type: "tool_call", id: "g2", name: "read_file", args: {} },
      { type: "tool_result", callId: "g2", ok: true, output: "G".repeat(120 * KB) }, // 30k，最新
    ];
    const outcome = computePrune({ events, attachmentsDir: attachments, sessionId: "sess1" });
    expect(outcome.why).toBe("saved");
    await writePruneAttachments(events, outcome, attachments, "sess1");
    const got = await readFile(attachmentPathFor(attachments, "sess1", "big"), "utf8");
    expect(got).toBe("Z".repeat(120 * KB)); // 逐字一致
    expect(outcome.attachments.length).toBe(1);
  });

  it("打桩投影进 projectContext：tool content 换为占位文本，事件流本体零删改", async () => {
    const { projectContext } = await import("../src/agent/context.js");
    const events: AgentEvent[] = [
      { type: "user_message", content: "任务" },
      { type: "tool_call", id: "big", name: "read_file", args: {} },
      { type: "tool_result", callId: "big", ok: true, output: "Z".repeat(120 * KB) },
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "f1", name: "read_file", args: {} },
      { type: "tool_result", callId: "f1", ok: true, output: "F".repeat(120 * KB) },
      { type: "user_message", content: "r3" },
      { type: "tool_call", id: "g2", name: "read_file", args: {} },
      { type: "tool_result", callId: "g2", ok: true, output: "G".repeat(120 * KB) },
    ];
    const outcome = computePrune({ events });
    expect(outcome.replacements.size).toBeGreaterThan(0);
    const msgs = projectContext(events, outcome.replacements);
    const stubbed = msgs.filter((m) => m.role === "tool").some((m) => m.content === PRUNED_PLACEHOLDER);
    expect(stubbed).toBe(true);
    expect((events[2] as { output: string }).output.length).toBe(120 * KB); // 事件流未动
  });

  it("总轮数 ≤ recentRounds → 全免剪（none）", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "任务" },
      { type: "tool_call", id: "a", name: "read_file", args: {} },
      { type: "tool_result", callId: "a", ok: true, output: "Z".repeat(120 * KB) },
    ];
    const r = computePrune({ events });
    expect(r.why).toBe("none"); // 只有 1 轮，全部落在最近 2 轮免剪区
    expect(r.replacements.size).toBe(0);
  });
});

// ---- 任务 7：类型化规则 ----
describe("shape 类型化规则（任务 7）", () => {
  it("code：签名行保留；log：错误行+尾部；doc：大纲；摘要 2k 截断生效", async () => {
    const { classifyResult, shapeCode, shapeLog, shapeDoc, summaryTruncate } = await import("../src/agent/shape.js");
    const code = ["const filler = 1;", "function realFn() {", "  return 1;", "}"].join("\n") + "\n" + "// ".repeat(3000);
    expect(classifyResult("read_file", { path: "src/x.ts" }, code)).toBe("code");
    const shapedCode = shapeCode(code, 2000);
    expect(shapedCode).toContain("function realFn() {");
    expect(shapedCode.length).toBeLessThanOrEqual(2040);

    const log = ["ok line", "line2"].concat(Array(2000).fill("noise")).concat(["FATAL: boom", "tail1", "tail2"]).join("\n");
    expect(classifyResult("run_shell", { command: "make" }, log)).toBe("log");
    const shapedLog = shapeLog(log, 2000);
    expect(shapedLog).toContain("FATAL: boom");
    expect(shapedLog).toContain("tail2");
    expect(shapedLog.length).toBeLessThanOrEqual(2040);

    const doc = ["# Title", "## S1", "body ".repeat(3000), "## S2"].join("\n");
    expect(classifyResult("read_file", { path: "README.md" }, doc)).toBe("doc");
    const shapedDoc = shapeDoc(doc, 2000);
    expect(shapedDoc).toContain("# Title");
    expect(shapedDoc).toContain("## S2");

    // 2k 截断：超 2000 的任意输入进摘要被截
    const long = "y".repeat(3000);
    const t = summaryTruncate(long);
    expect(t.length).toBeLessThan(2100);
    expect(t.endsWith("…(截断)")).toBe(true);
  });
});
