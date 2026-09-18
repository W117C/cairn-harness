// 失败轨迹沉淀引导（能力 6/10）：distill 回放事件时模型注意力不会自动落在失败上——
// failureDigestFromEvents 把失败聚成显式证据并入沉淀指令，引导按 feedback 类型沉淀。
// 同时补 distill 模块原本零覆盖的测试。
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DISTILL_INSTRUCTION, failureDigestFromEvents, runSessionEndDistill } from "../src/agent/memory/distill";
import type { AgentEvent } from "../src/events";
import type { Provider, ProviderMessage, ModelOutput } from "../src/providers";
import type { Tool } from "../src/tools/base";

// 事件构造助手
const tc = (id: string, name: string): AgentEvent => ({ type: "tool_call", id, name, args: {} });
const tr = (callId: string, ok: boolean, output = "x"): AgentEvent => ({ type: "tool_result", callId, ok, output } as AgentEvent);
const vr = (ok: boolean, attempt: number, maxAttempts = 3): AgentEvent => ({ type: "verify_result", callId: "v", ok, attempt, maxAttempts, results: [] });

describe("failureDigestFromEvents（纯函数）", () => {
  it("全成功/空流 → 空串（零注入，无回归）", () => {
    expect(failureDigestFromEvents([])).toBe("");
    expect(failureDigestFromEvents([tc("a", "edit_file"), tr("a", true), vr(true, 1)])).toBe("");
  });

  it("工具失败按工具名归并计数", () => {
    const d = failureDigestFromEvents([tc("a", "edit_file"), tr("a", false), tc("b", "run_shell"), tr("b", false), tc("c", "edit_file"), tr("c", false)]);
    expect(d).toContain("edit_file×2");
    expect(d).toContain("run_shell×1");
    expect(d).toContain("工具失败");
  });

  it("验证失败计数，达上限单独标记", () => {
    const d = failureDigestFromEvents([vr(false, 1), vr(false, 2), vr(false, 3)]);
    expect(d).toContain("3 次验证失败");
    expect(d).toContain("其中 1 次达上限停止");
  });

  it("未达上限的验证失败不标记「达上限」", () => {
    const d = failureDigestFromEvents([vr(false, 1), vr(false, 2)]);
    expect(d).toContain("2 次验证失败");
    expect(d).not.toContain("达上限");
  });

  it("摘要引导按 feedback 类型沉淀（护栏语义在）", () => {
    const d = failureDigestFromEvents([tc("a", "edit_file"), tr("a", false)]);
    expect(d).toContain("type=feedback");
    expect(d).toContain("scope=project");
  });
});

describe("runSessionEndDistill（失败轨迹注入沉淀指令）", () => {
  async function tmpLog(events: AgentEvent[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "distill-"));
    const logPath = join(dir, "session.jsonl");
    await writeFile(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    return logPath;
  }

  // 捕获式 provider：记录收到的 messages，回放一段「无」应答（合法终态，不触发 remember）
  function capturingProvider(): { provider: Provider; lastUser: () => ProviderMessage | undefined } {
    const seen: ProviderMessage[][] = [];
    const p: Provider = {
      async *stream(messages: ProviderMessage[]): AsyncIterable<ModelOutput> {
        seen.push(messages);
        yield { type: "assistant_message", content: "无" };
      },
    };
    return {
      provider: p,
      lastUser: () => {
        const last = seen[seen.length - 1];
        return last?.find((m) => m.role === "user" && m.content !== null && m.content.includes("["));
      },
    };
  }

  const rememberTool: Tool = {
    name: "remember",
    async run() {
      return { ok: true, output: "（不应被调用）" };
    },
  };

  it("有失败时，user 指令含失败轨迹摘要（模型注意力被显式引导）", async () => {
    const logPath = await tmpLog([tc("a", "edit_file"), tr("a", false), vr(false, 3)]);
    const cap = capturingProvider();
    const out = await runSessionEndDistill({
      enabled: true,
      logPath,
      workspace: "/tmp",
      provider: cap.provider,
      rememberTool,
      emit: async () => {},
    });
    expect(out.kind).toBe("no_content");
    const u = cap.lastUser();
    expect(u).toBeDefined();
    expect(u!.content).toContain("失败轨迹");
    expect(u!.content).toContain("edit_file×1");
    // 原指令仍在（叠加而非替换）
    expect(u!.content).toContain(DISTILL_INSTRUCTION.slice(0, 20));
  });

  it("无失败时，指令逐字不变（零行为回归）", async () => {
    const logPath = await tmpLog([tc("a", "edit_file"), tr("a", true)]);
    const cap = capturingProvider();
    await runSessionEndDistill({
      enabled: true,
      logPath,
      workspace: "/tmp",
      provider: cap.provider,
      rememberTool,
      emit: async () => {},
    });
    expect(cap.lastUser()?.content).toBe(DISTILL_INSTRUCTION);
  });

  it("开关关闭 → disabled，零 provider 调用", async () => {
    const logPath = await tmpLog([tc("a", "edit_file"), tr("a", false)]);
    const cap = capturingProvider();
    const out = await runSessionEndDistill({
      enabled: false,
      logPath,
      workspace: "/tmp",
      provider: cap.provider,
      rememberTool,
      emit: async () => {},
    });
    expect(out.kind).toBe("disabled");
    expect(cap.lastUser()).toBeUndefined();
  });
});
