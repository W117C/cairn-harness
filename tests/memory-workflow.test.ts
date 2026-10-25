// 闭环 v2 批次 B 判卷：正向打法蒸馏（复现 + 收尾绿 verify 才沉淀）与毕业提案。
// 反向验证：单次成功不沉淀、收尾红 verify 不沉淀、worker 子流不替父会话表态、
// 无正文不提案、已注册不重复毕业、modules/ 缺席零行为。
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/events/index.js";
import {
  distillWorkflows,
  RECUR_MIN,
  WORKFLOW_MEMORY_TYPE,
  WORKFLOW_TOPIC_PREFIX,
  writeWorkflows,
} from "../src/agent/memory/workflow.js";
import { MEMORY_INDEX, readTopicBody, writeTopic } from "../src/agent/memory/store.js";
import { GATES } from "../scripts/gate-manifest";
import { ModuleRegistry } from "../src/main/evolution/registry";
import { graduationCandidates, maybeGraduateWorkflows, workflowProposal, WORKFLOW_GRADUATE_MIN_HITS } from "../src/main/evolution/workflow-graduate";

const ev = (e: Record<string, unknown>): AgentEvent => e as unknown as AgentEvent;

const green = (callId: string): AgentEvent => ev({ type: "verify_result", callId, ok: true, attempt: 1, maxAttempts: 3, results: [] });
const tool = (id: string, name: string, args: Record<string, unknown>): AgentEvent =>
  ev({ type: "tool_call", id, name, args });

/** 一段「读→写→验证绿」序列（工具名与参数键集固定 ⇒ 同签名）。 */
function sequence(n: number, agent_id?: string): AgentEvent[] {
  const withAgent = (e: AgentEvent): AgentEvent =>
    ev(agent_id === undefined ? e as unknown as Record<string, unknown> : { ...(e as unknown as Record<string, unknown>), agent_id });
  return [
    withAgent(tool("read-" + n, "read_file", { path: "a.ts" })),
    withAgent(tool("write-" + n, "write_file", { path: "a.ts", content: "x" })),
    withAgent(green("verify-" + n)),
  ];
}

/** 生产形状的序列：每个 tool_call 后面跟着它的 tool_result（真实事件流里 call/result 交错——
 *  2026-10-25 复查修的实锤 bug：旧扫描器把 result 当打断事件 ⇒ 每步之后段被清空 ⇒ 模块空转。
 *  这条用例就是那次立案的回归针：交错形状下必须照样蒸馏。 */
function interleavedSequence(n: number): AgentEvent[] {
  return [
    tool("read-" + n, "read_file", { path: "a.ts" }),
    ev({ type: "tool_result", callId: "read-" + n, ok: true, output: "file body" }),
    tool("write-" + n, "write_file", { path: "a.ts", content: "x" }),
    ev({ type: "tool_result", callId: "write-" + n, ok: true, output: "written" }),
    green("verify-" + n),
  ];
}

describe("workflow distillWorkflows（纯函数）", () => {
  it("同签名复现 ≥RECUR_MIN 且每次收尾绿 ⇒ 蒸馏一条：步骤+证据+会话出处齐全", () => {
    const events = [ev({ type: "user_message", content: "任务" }), ...sequence(1), ...sequence(2)];
    const out = distillWorkflows(events, "/tmp/logs/sess-abc.jsonl");
    expect(out.length).toBe(1);
    const w = out[0]!;
    expect(w.topic.startsWith(WORKFLOW_TOPIC_PREFIX)).toBe(true);
    expect(w.body).toContain("read_file");
    expect(w.body).toContain("write_file");
    expect(w.body).toContain("evidence-line: read-1");
    expect(w.body).toContain("evidence-line: verify-2");
    expect(w.body).toContain("session-line: sess-abc");
  });

  it("★生产形状（回归针）：tool_call 与 tool_result 交错时照样蒸馏——result 是步的一部分，不打断段", () => {
    const events = [ev({ type: "user_message", content: "任务" }), ...interleavedSequence(1), ...interleavedSequence(2)];
    const out = distillWorkflows(events, "/tmp/logs/sess-abc.jsonl");
    expect(out.length, "交错形状下蒸馏 0 条 = 旧 bug 复发（模块在生产上空转）").toBe(1);
    expect(out[0]!.body).toContain("evidence-line: read-1");
  });

  it("反向：只成功一次 ⇒ 不沉淀（一次成功是碰巧，不是打法）", () => {
    const events = [ev({ type: "user_message", content: "任务" }), ...sequence(1)];
    expect(distillWorkflows(events, "/tmp/logs/s.jsonl")).toEqual([]);
  });

  it("反向：第二次收尾红 verify ⇒ 两次都不是打法（绿是前提不是多数决）", () => {
    const red = [
      tool("read-2", "read_file", { path: "a.ts" }),
      tool("write-2", "write_file", { path: "a.ts", content: "x" }),
      ev({ type: "verify_result", callId: "verify-2", ok: false, attempt: 3, maxAttempts: 3, cause: "code", results: [] }),
    ];
    const events = [ev({ type: "user_message", content: "任务" }), ...sequence(1), ...red];
    expect(distillWorkflows(events, "/tmp/logs/s.jsonl")).toEqual([]);
  });

  it("反向：worker 子流的成功不替父会话表态", () => {
    const events = [
      ev({ type: "user_message", content: "任务" }),
      ...sequence(1, "worker-1"),
      ...sequence(2, "worker-1"),
    ];
    expect(distillWorkflows(events, "/tmp/logs/s.jsonl")).toEqual([]);
  });

  it("反向：段中间夹散文（模型重新决策）⇒ 段被打断，两半各自凑不满复现", () => {
    const events = [
      ev({ type: "user_message", content: "任务" }),
      tool("read-1", "read_file", { path: "a.ts" }),
      ev({ type: "assistant_delta", callId: "c1", text: "我想想。" }),
      tool("write-1", "write_file", { path: "a.ts", content: "x" }),
      green("verify-1"),
      ...sequence(2),
    ];
    expect(distillWorkflows(events, "/tmp/logs/s.jsonl")).toEqual([]);
  });

  it("参数值不同不影响签名（键集同形 = 同打法）；topic 稳定可重复蒸馏", () => {
    const variant = [
      tool("read-9", "read_file", { path: "另一个文件.ts" }),
      tool("write-9", "write_file", { path: "另一个文件.ts", content: "完全不同的内容" }),
      green("verify-9"),
    ];
    const a = distillWorkflows([ev({ type: "user_message", content: "t" }), ...sequence(1), ...sequence(2)], "/tmp/logs/x.jsonl");
    const b = distillWorkflows([ev({ type: "user_message", content: "t" }), ...sequence(1), ...variant], "/tmp/logs/x.jsonl");
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(b[0]!.topic).toBe(a[0]!.topic);
  });
});

describe("workflow writeWorkflows（落盘往返，tmp 工作区）", () => {
  it("写 topic + 索引行（type=project 进 M7 面）；同 topic 重蒸馏覆盖不翻倍", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-memory-"));
    try {
      const events = [ev({ type: "user_message", content: "任务" }), ...sequence(1), ...sequence(2)];
      const [entry] = distillWorkflows(events, join(root, "sess-1.jsonl"))!;
      expect(entry).toBeDefined();
      await writeWorkflows(root, [entry!], "2026-10-25T00:00:00Z");
      const dir = join(root, ".agent", "memory");
      expect(existsSync(join(dir, entry!.topic + ".md"))).toBe(true);
      const body = await readTopicBody(dir, entry!.topic);
      expect(body).toContain("evidence-line: read-1");
      const index = await readFile(join(dir, MEMORY_INDEX), "utf8");
      expect(index).toContain(entry!.topic + " · " + WORKFLOW_MEMORY_TYPE);
      // 再写一次同 topic（重蒸馏）：索引仍是一行（upsert 覆盖，不翻倍）。
      await writeWorkflows(root, [entry!], "2026-10-26T00:00:00Z");
      const index2 = (await readFile(join(dir, MEMORY_INDEX), "utf8")).split("\n").filter((l) => l.includes(entry!.topic));
      expect(index2.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("workflow 毕业（graduationCandidates / workflowProposal / maybeGraduateWorkflows）", () => {
  it("workflowProposal 的 manifest 过得了真契约校验（id/kind/gates 全在名单）", async () => {
    const { parseBundleManifest } = await import("../src/main/evolution/manifest");
    const p = workflowProposal("workflow-deadbeef", 4, "正文");
    expect(p.manifest.id).toBe("content-pack.workflow-deadbeef");
    expect(p.manifest.permissions).toEqual([]);
    expect(Object.keys(p.files)).toEqual(["prompt.md"]);
    const parsed = parseBundleManifest(p.manifest as unknown, new Set(GATES));
    expect(parsed.kind).toBe("content-pack");
    expect(parsed.gates).toEqual([...(p.manifest.gates as string[])]);
  });

  it("maybeGraduateWorkflows：高命中（强度账 hits ≥3）⇒ 提案进 staging；再跑一次 ⇒ skipped-registered", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-grad-"));
    try {
      // 造一个 modules/（进化平面的家）与一份高命中 workflow 记忆（正文 + 强度账）。
      await mkdir(join(root, "modules"), { recursive: true });
      const dir = join(root, ".agent", "memory");
      await writeTopic(dir, "workflow-deadbeef", "project", "打法正文\nevidence-line: t1\nsession-line: s1", "2026-10-25T00:00:00Z");
      const { writeStats } = await import("../src/agent/memory/store");
      await writeStats(dir, { "workflow-deadbeef": { topic: "workflow-deadbeef", hits: WORKFLOW_GRADUATE_MIN_HITS, lastRetrieved: "2026-10-25T00:00:00Z", strength: 1 } });
      const candidates = await graduationCandidates(root);
      expect(candidates).toEqual([{ topic: "workflow-deadbeef", hits: WORKFLOW_GRADUATE_MIN_HITS }]);

      const first = await maybeGraduateWorkflows(root);
      expect(first).toEqual([{ topic: "workflow-deadbeef", outcome: "submitted" }]);
      expect(existsSync(join(root, "modules", "staging", "content-pack.workflow-deadbeef", "0." + String(WORKFLOW_GRADUATE_MIN_HITS) + ".0", "prompt.md"))).toBe(true);
      // 账上已有同 id ⇒ 第二次不重提。
      const second = await maybeGraduateWorkflows(root);
      expect(second).toEqual([{ topic: "workflow-deadbeef", outcome: "skipped-registered" }]);
      // registry 也能读到这条 staged 记录（真实入账，不是只写了文件）。
      const reg = new ModuleRegistry(root, { knownGates: new Set(GATES) });
      const index = await reg.readIndex();
      expect(index.bundles["content-pack.workflow-deadbeef"]).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("反向：hits 不足 / 索引缺 ⇒ 零提名零提案（没证据不提名）", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-grad-"));
    try {
      await mkdir(join(root, "modules"), { recursive: true });
      const dir = join(root, ".agent", "memory");
      await writeTopic(dir, "workflow-lowhits", "project", "打法", "2026-10-25T00:00:00Z");
      expect(await graduationCandidates(root)).toEqual([]);
      expect(await maybeGraduateWorkflows(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("反向：modules/ 缺席 ⇒ 零行为（不建目录、不提案）", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-grad-"));
    try {
      const dir = join(root, ".agent", "memory");
      await writeTopic(dir, "workflow-hi", "project", "打法", "2026-10-25T00:00:00Z");
      const { writeStats } = await import("../src/agent/memory/store");
      await writeStats(dir, { "workflow-hi": { topic: "workflow-hi", hits: 9, lastRetrieved: "2026-10-25T00:00:00Z", strength: 1 } });
      expect(await maybeGraduateWorkflows(root)).toEqual([]);
      expect(existsSync(join(root, "modules"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
