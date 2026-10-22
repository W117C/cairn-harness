// 记忆沉淀不挡对话判卷（v7.3，owner 实证 2026-10-15「记忆沉淀挡住正常对话了」）。
// 病灶（真机勘定）：主会话 run 从不发 agent_status ⇒ 渲染层摘「运行中」的终态判据断粮；
// 用户切走会话（非活动事件路径点亮）后 run 收束永不清位 ⇒ send 只入队没人派（main 侧
// cancel 已「会话不在运行」，渲染层仍在转）。修法两层：
//   ① kernel-host run 收束补发合成终态（push-only）+ openSession 返回 running 实况；
//   ② 渲染层开会对账收敛陈旧标记；对话优先跳沉（onAsk 队列在场即拒 / send 运行中即拒）。
// 本文件判纯判据与接线哨兵；收束推送与 running 的语义断言在 kernel-host.test.ts。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isSessionEndDistillAsk } from "../src/renderer/send-queue";
import { readAppShell } from "./helpers/app-surface";

describe("isSessionEndDistillAsk（沉淀审批辨识）", () => {
  it("distill 合并审批（args.trigger=session_end_distill）命中", () => {
    expect(isSessionEndDistillAsk({ tool: "remember", args: { trigger: "session_end_distill" } })).toBe(true);
  });

  it("手打记忆写入审批（同 tool、args 无 trigger）不命中——用户主动写记忆照常弹卡", () => {
    expect(isSessionEndDistillAsk({ tool: "remember", args: { path: "notes.md", content: "x" } })).toBe(false);
    expect(isSessionEndDistillAsk({ tool: "remember", args: {} })).toBe(false);
    expect(isSessionEndDistillAsk({ tool: "remember" })).toBe(false);
  });

  it("判据看 tool 与 args 两段：别的 tool 带同名 trigger、或 trigger 值不同，都不命中", () => {
    expect(isSessionEndDistillAsk({ tool: "bash", args: { trigger: "session_end_distill" } })).toBe(false);
    expect(isSessionEndDistillAsk({ args: { trigger: "session_end_distill" } })).toBe(false);
    expect(isSessionEndDistillAsk({ tool: "remember", args: { trigger: "manual" } })).toBe(false);
  });
});

describe("接线哨兵（源码级）", () => {
  const appSrc = readAppShell();
  const hostSrc = readFileSync(new URL("../src/main/kernel-host.ts", import.meta.url), "utf8");
  const queueSrc = readFileSync(new URL("../src/renderer/send-queue.ts", import.meta.url), "utf8");

  it("判据唯一处：触发串只在 send-queue.ts 出现一次，App/kernel-host 不得复制", () => {
    expect(queueSrc).toContain("isSessionEndDistillAsk");
    expect(queueSrc.match(/session_end_distill/g)?.length).toBe(1);
    expect(appSrc).not.toContain("session_end_distill");
    expect(hostSrc).not.toContain("session_end_distill");
  });

  it("onAsk：队列在场即拒沉淀审批（快销 + notice 明示），不占卡位不上屏", () => {
    expect(appSrc).toContain("isSessionEndDistillAsk(p)");
    expect(appSrc).toContain("(sendQueue.current.get(sid)?.length ?? 0) > 0");
    expect(appSrc).toContain("window.agent.decide(p.askId, false)");
    expect(appSrc).toContain("已跳过本轮全局记忆写入（你在继续对话；下次收尾再试）");
  });

  it("send：运行中发送时挂起的沉淀审批先拒（fire-and-forget，随后同拍入队不 await）", () => {
    expect(appSrc).toContain("askById.current.get(sid)");
    expect(appSrc).toContain("isSessionEndDistillAsk(pendingAsk)");
    expect(appSrc).toContain("window.agent.decide(pendingAsk.askId, false)");
  });

  it("openSession 开会对账：running 实况收敛陈旧标记（在跑补上、已收束摘掉）", () => {
    expect(appSrc).toContain("running?: boolean");
    expect(appSrc).toContain('typeof r.running === "boolean"');
    expect(appSrc).toContain("runningSet.current.delete(id)");
  });

  it("kernel-host 收束补发合成终态：三态映射 + openSession.running 实况", () => {
    expect(hostSrc).toContain("let settledOk = false");
    expect(hostSrc).toContain("settledOk = res.ok === true");
    expect(hostSrc).toContain('controller.signal.aborted ? "cancelled" : settledOk ? "done" : "failed"');
    // push-only 的机械面：直调 deps.outbox（不经 setAppHooks.onEvent 的 ownAppends 计数链）——
    // 「不落 JSONL」由 kernel-host.test.ts 的盘面语义断言钉住。
    expect(hostSrc).toContain('deps.outbox("onEvent", {');
    expect(hostSrc).toContain("running: runControllers.has(id)");
  });
});

// 第十一遍分层裁决（项目层免批 / 全局层合并批）的接线哨兵；语义判卷在根仓
// tests/distill.test.ts（gate 四型 + 无审批口 fail-closed）与 tests/memory-runner.test.ts（落盘面）。
describe("沉淀分层审批（接线哨兵）", () => {
  const distillSrc = readFileSync(new URL("../../../src/agent/memory/distill.ts", import.meta.url), "utf8");
  const runnerSrc = readFileSync(new URL("../../../src/main/agent-runner.ts", import.meta.url), "utf8");

  it("distill.ts：按 args.scope 分流（项目层免批直写 / 全局层合并审批问一次）", () => {
    expect(distillSrc).toContain('out.args.scope === "global"');
    expect(distillSrc).toContain("let globalApproval: boolean | null = null");
    expect(distillSrc).toContain('auto: { layer: "X-distill", verdict: "auto-approved" }');
  });

  it("agent-runner：全局层送审带 scope=global 标记（对话优先跳沉的 trigger 判据仍命中）", () => {
    expect(runnerSrc).toContain('{ trigger: "session_end_distill", scope: "global" }');
  });
});
