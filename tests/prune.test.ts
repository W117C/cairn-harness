// M2b 任务 6+7 验收（prune 执行器 + 类型化规则）：
// ①预计裁剪未达 20k → 不修剪（too-small，零替换）②最近 2 轮不被剪 ③免剪名单条目不被剪
// ④被裁原文可从附件目录读回且逐字一致。类型化：code/log/doc 三类 + 摘要 2k 截断。
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  computePrune,
  writePruneAttachments,
  attachmentPathFor,
  isPruneExempt,
  buildPruneIndex,
  DEFAULT_PRUNE_CONFIG,
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

// ---- 免剪判定单元：computePrune 的端到端用例把多条免剪规则叠在保护区/最近轮里，
// 单条规则是否真在生效无法分辨——这里逐规则隔离断言（变异锚点的正面靶子）。
// 三轮 fixture：boundary 落在第 2 条 user_message（index 3），第 1 轮的目标项在免剪区外，
// 免与不免只能由被测的那条规则决定。
describe("isPruneExempt 免剪判定（单元，逐规则）", () => {
  const cfg = DEFAULT_PRUNE_CONFIG;
  /** 三轮；目标 tool_result 固定在 index 2（免剪区外，boundary=3）。 */
  const one = (name: string, ok: boolean): AgentEvent[] => [
    { type: "user_message", content: "r1" },
    { type: "tool_call", id: "t", name, args: {} },
    { type: "tool_result", callId: "t", ok, output: "x" },
    { type: "user_message", content: "r2" },
    { type: "tool_call", id: "u", name: "read_file", args: {} },
    { type: "tool_result", callId: "u", ok: true, output: "y" },
    { type: "user_message", content: "r3" },
  ];
  it("非 tool_result 一律免剪（user_message / tool_call）", () => {
    const ev = one("read_file", true);
    expect(isPruneExempt(ev, 0, cfg)).toBe(true);
    expect(isPruneExempt(ev, 1, cfg)).toBe(true);
    // 探针：一个非 tool_result 事件携带 ok:true 且落在最近轮免剪区外——除第一道类型闸外，
    // 卡片/回注/名单/grep/失败/最近轮都救不了它。类型闸失效 ⇒ computePrune 把它当
    // tool_result 取 .output（undefined）而 TypeError，故这是类型闸唯一的正面靶子。
    const probe = { type: "assistant_message", content: "a", ok: true } as unknown as AgentEvent;
    const ev2: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      probe, // index 1，免剪区外（boundary=2）
      { type: "user_message", content: "r2" },
      { type: "user_message", content: "r3" },
    ];
    expect(isPruneExempt(ev2, 1, cfg)).toBe(true);
  });
  it("免剪名单（skill/remember/memory）免剪；普通 read_file 不免剪", () => {
    expect(isPruneExempt(one("skill", true), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("remember", true), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("memory", true), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("read_file", true), 2, cfg)).toBe(false);
  });
  it("grep/glob/lsp 命中免剪（整形产物不裁）", () => {
    expect(isPruneExempt(one("grep", true), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("glob", true), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("lsp", true), 2, cfg)).toBe(true);
  });
  it("失败结果（ok:false）免剪；同类成功结果不免剪", () => {
    expect(isPruneExempt(one("read_file", false), 2, cfg)).toBe(true);
    expect(isPruneExempt(one("read_file", true), 2, cfg)).toBe(false);
  });
  it("名单 / grep / 失败结果在最近轮之外仍各自免剪（规则不被边界吞）", () => {
    // boundary 落在第 2 条 user_message（index 7），第 1 轮（0–6）在免剪区外
    const ev: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "s", name: "skill", args: {} },
      { type: "tool_result", callId: "s", ok: true, output: "S" },
      { type: "tool_call", id: "g", name: "grep", args: {} },
      { type: "tool_result", callId: "g", ok: true, output: "G" },
      { type: "tool_call", id: "e", name: "read_file", args: {} },
      { type: "tool_result", callId: "e", ok: false, output: "E" },
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "x", name: "read_file", args: {} },
      { type: "tool_result", callId: "x", ok: true, output: "X" },
      { type: "user_message", content: "r3" },
    ];
    const idx = buildPruneIndex(ev, cfg);
    expect(idx.boundary).toBe(7);
    expect(isPruneExempt(ev, 2, cfg, idx)).toBe(true); // 名单
    expect(isPruneExempt(ev, 4, cfg, idx)).toBe(true); // grep
    expect(isPruneExempt(ev, 6, cfg, idx)).toBe(true); // 失败结果
  });
  it("卡片投影免剪：[verify] 前缀的 tool_result 在最近轮外仍免剪", () => {
    // 非 grep / 非名单 / ok=true，唯一能救它的是 isCardProjection 的 verify 分支
    const ev: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "v", name: "run_shell", args: {} },
      { type: "tool_result", callId: "v", ok: true, output: "[verify] 全绿" },
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "w", name: "read_file", args: {} },
      { type: "tool_result", callId: "w", ok: true, output: "W" },
      { type: "user_message", content: "r3" },
    ];
    const idx = buildPruneIndex(ev, cfg);
    expect(idx.boundary).toBe(3);
    expect(isPruneExempt(ev, 2, cfg, idx)).toBe(true);
  });
});

describe("附件名安全化（目录穿越清洗，sessionId/callId 均为模型侧输入）", () => {
  it("sessionId 含 ../../ 时清洗后附件仍落在 attachmentsDir 内", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "big", name: "read_file", args: {} },
      { type: "tool_result", callId: "big", ok: true, output: "Z".repeat(120 * KB) },
      { type: "user_message", content: "r2" },
      { type: "tool_call", id: "f1", name: "read_file", args: {} },
      { type: "tool_result", callId: "f1", ok: true, output: "F".repeat(120 * KB) },
      { type: "user_message", content: "r3" },
      { type: "tool_call", id: "g2", name: "read_file", args: {} },
      { type: "tool_result", callId: "g2", ok: true, output: "G".repeat(120 * KB) },
    ];
    const r = computePrune({ events, attachmentsDir: attachments, sessionId: "../../evil" });
    expect(r.attachments.length).toBeGreaterThan(0);
    const base = resolve(attachments);
    for (const path of r.attachments) {
      expect(resolve(path).startsWith(base + "/")).toBe(true); // 归一 .. 后仍在目录内
      expect(path.split("/").pop() ?? "").not.toContain("/"); // 文件名段不含路径分隔符
    }
  });
});

// §7.4「被裁原文写会话附件目录可回取」+ §14「prune + 存盘回取」：实现与读回测试一直在，
// 但生产两个 computePrune 调用点都只传 {events} ⇒ 附件恒空、writePruneAttachments 零调用者，
// 打桩文案也只说 "cleared" 而不给任何通道 ⇒ 模型侧「回取」是一句空话（本仓「两头断」第 7 例）。
describe("prune 附件回取接进生产", () => {
  // 触发裁剪的最小语料：保护区 40k（≈160KB ASCII）+ 最近 2 轮免剪 ⇒ 4 个轮次里最旧两轮的两条
  // 120KB 结果才落到「区外 + 不免剪」，合计 60k token > 最小修剪 20k。
  const round = (n: number, ch: string): AgentEvent[] => [
    { type: "user_message", content: "r" + String(n) },
    { type: "tool_call", id: ch, name: "read_file", args: { path: ch + ".ts" } },
    { type: "tool_result", callId: ch, ok: true, output: ch.repeat(120 * KB) },
  ];
  const corpus = (): AgentEvent[] => [...round(1, "F"), ...round(2, "G"), ...round(3, "H"), ...round(4, "I")];

  it("①传 attachmentsDir ⇒ 打桩自带路径，且该路径逐字等于实际写出的那个文件", async () => {
    const events = corpus();
    const outcome = computePrune({ events, attachmentsDir: attachments, sessionId: "s-1" });
    expect(outcome.replacements.size).toBeGreaterThan(0);
    const [id, text] = [...outcome.replacements.entries()][0]!;
    const e = events[(id ?? 0) - 1] as { callId: string; output: string };
    const file = attachmentPathFor(attachments, "s-1", e.callId);
    // 原串逐字在场（新增信息另起一行——往被钉住的提示串里并半句是本仓点名的第三种踩法）
    expect(text.startsWith(PRUNED_PLACEHOLDER + "\n")).toBe(true);
    expect(text).toContain(file);
    await writePruneAttachments(events, outcome, attachments, "s-1");
    expect(await readFile(file, "utf8")).toBe(e.output);
    expect(outcome.attachments).toContain(file);
  });

  it("②未传 attachmentsDir ⇒ 打桩仍是裸占位（零回归：三处逐字等值断言不破）", () => {
    const outcome = computePrune({ events: corpus() });
    expect(outcome.replacements.size).toBeGreaterThan(0);
    expect([...outcome.replacements.values()].every((v) => v === PRUNED_PLACEHOLDER)).toBe(true);
    expect(outcome.attachments).toHaveLength(0);
  });

  it("③savedTokens 按**实际替换文本**计量：路径行不得虚报节省", () => {
    const bare = computePrune({ events: corpus() });
    const withDir = computePrune({ events: corpus(), attachmentsDir: attachments, sessionId: "s-2" });
    expect(withDir.savedTokens).toBeLessThan(bare.savedTokens);
    // 差额必须是"每条一行路径"量级（每行 < 60 token），而不是整段没算
    expect(bare.savedTokens - withDir.savedTokens).toBeLessThanOrEqual(withDir.replacements.size * 60);
  });

  it("④同一附件重复装配不重写（幂等；每轮组装都跑，重写 = 白 IO 且打断 mtime 语义）", async () => {
    const events = corpus();
    const outcome = computePrune({ events, attachmentsDir: attachments, sessionId: "s-3" });
    await writePruneAttachments(events, outcome, attachments, "s-3");
    const file = outcome.attachments[0]!;
    const mtimeBefore = (await stat(file)).mtimeMs;
    await new Promise((r) => setTimeout(r, 25));
    await writePruneAttachments(events, outcome, attachments, "s-3");
    expect((await stat(file)).mtimeMs).toBe(mtimeBefore);
  });
});

describe("修剪量的是「将要发给模型的那一段」——worker 子流不在其中（2026-09-22）", () => {
  // 动手前的实测：prune.ts 里 agent_id 零命中。projectContext 早已把带归因的事件挡在父上下文外,
  // 但 prune 拿的是**原始事件流**，于是两件事同时错：
  //   ① 子流的 tool_result 被当候选去裁 ⇒ savedTokens 记一次不存在的节省（还会把 worker 内部
  //      转录抄进附件文件——真磁盘、真 I/O，换一条永远不会出现在任何 prompt 里的打桩行）；
  //   ② 保护区按 token 回退时把子流的体量算进预算 ⇒ 父会话里真在上下文中的老结果被提前划出
  //      保护区去裁。（同一形状的第三面：见 outputs/stop-reason-blindspot 第十一程、记忆规则 53。）
  const big = (n: number) => String.fromCharCode(65 + n).repeat(100 * KB); // ≈25k token（ASCII：chars/4）
  const round = (tag: string, parent: boolean): AgentEvent[] => [
    { type: "user_message", content: tag },
    { type: "tool_call", id: tag, name: "read_file", args: {} },
    { type: "tool_result", callId: tag, ok: true, output: big(tag.charCodeAt(1) - 97), ...(parent ? {} : { agent_id: "w1" }) },
  ];

  it("子流大块既不进替换表，也不记进 savedTokens", () => {
    const withChild: AgentEvent[] = [
      ...round("r1", true), ...round("rw", false), ...round("r2", true), ...round("r3", true),
    ];
    const r = computePrune({ events: withChild });
    const childIdx = withChild.findIndex((e) => e.type === "tool_result" && "agent_id" in e);
    // replacements 的键是 1-based 事件 id（行号），不是数组下标
    expect(r.replacements.has(childIdx + 1)).toBe(false);
    expect(r.attachments).toEqual([]);
  });

  it("负控：把 agent_id 去掉，同一条事件确实会被裁（否则上一条可能只是恒绿）", () => {
    const demoted: AgentEvent[] = [
      ...round("r1", true), ...round("rw", true), ...round("r2", true), ...round("r3", true),
    ];
    const r = computePrune({ events: demoted });
    const idx = demoted.findIndex((e) => e.type === "tool_result" && e.callId === "rw");
    expect(r.replacements.has(idx + 1)).toBe(true);
    expect(r.savedTokens).toBeGreaterThan(0);
  });

  /* 保护区量的是「将要发出去的那一段」。把子流的大块算进预算 ⇒ 保护区提前收口，
     父会话里真在上下文中的老结果 q 被划成候选去裁。两条断言把「归因」与「位置」分开：
     同一位置放子流 ⇒ q 受保护；放父会话自己的大块 ⇒ q 该被裁（prune 的本职）。
     每块 100KB ASCII = estimateTextTokens 25600 ⇒ 两块越过 protectTokens 40000。 */
  const budgetConfig = { protectTokens: 40000, minimumTokens: 20000, recentRounds: 1, exemptTools: [] };
  const chunk = "z".repeat(100 * KB);
  const block = (tag: string, parent: boolean): AgentEvent[] => [
    { type: "tool_call", id: tag, name: "read_file", args: {} },
    { type: "tool_result", callId: tag, ok: true, output: chunk, ...(parent ? {} : { agent_id: "w1" }) },
  ];
  const older = (): AgentEvent[] => [
    { type: "user_message", content: "r1" },
    ...block("q", true),
    { type: "user_message", content: "r2" },
    ...block("p", true),
    { type: "user_message", content: "r3" },
  ];
  const qIdOf = (events: AgentEvent[]): number => events.findIndex((e) => e.type === "tool_result" && (e as { callId?: string }).callId === "q") + 1;

  it("末尾放子流大块：不吃保护区预算，老结果 q 仍受保护", () => {
    const events: AgentEvent[] = [...older(), ...block("w", false)];
    const r = computePrune({ events, config: budgetConfig });
    expect(r.replacements.has(qIdOf(events)), "q 被划成候选 = 保护区被子流的体量顶掉了").toBe(false);
    expect(r.savedTokens).toBe(0);
  });

  it("负控：同一位置放父会话自己的大块 ⇒ q 出保护区被裁（判的是归因，不是位置）", () => {
    const events: AgentEvent[] = [...older(), ...block("w", true)];
    const r = computePrune({ events, config: budgetConfig });
    expect(r.replacements.size).toBe(1);
    expect(r.replacements.has(qIdOf(events))).toBe(true);
    expect(r.savedTokens).toBeGreaterThan(0);
  });

  it("isPruneExempt 单点判据：带归因的 tool_result 一律免剪", () => {
    // 三条 user_message：否则 boundary=0，「最近 N 轮免剪」会先于本判据把候选全免掉（假绿）。
    const events: AgentEvent[] = [
      { type: "user_message", content: "r1" },
      { type: "tool_call", id: "x", name: "read_file", args: {} },
      { type: "tool_result", callId: "x", ok: true, output: "x".repeat(200 * KB), agent_id: "w1" },
      { type: "user_message", content: "r2" },
      { type: "user_message", content: "r3" },
    ];
    const config = { ...DEFAULT_PRUNE_CONFIG };
    const idx = buildPruneIndex(events, config);
    expect(isPruneExempt(events, 2, config, idx)).toBe(true);
    // 同一条去掉归因 ⇒ 不再免剪（判的是字段，不是类型）
    const parentOnly = events.map((e, i) => (i === 2 ? ({ ...e, agent_id: undefined } as AgentEvent) : e));
    expect(isPruneExempt(parentOnly, 2, config, buildPruneIndex(parentOnly, config))).toBe(false);
  });
});
