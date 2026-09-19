// worker 角色块的有界性（能力 9 成本面 + 能力 7 外部文本面）。
// §7.5 把「任务书与角色定义永不进摘要输入」写成结构性保障 ⇒ 这块是每轮常驻付费；
// 而 roleDefinition 的三个来源里有两个是外部文本（插件 agents/*.md、spawn_agent 入参）。
// 收窄用的原语与 skill 正文同源（src/agent/text-budget.ts），这里锁两处：原语语义 + 接线位置。
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKER_ROLE_TOKEN_BUDGET,
  buildWorkerSystemMessages,
} from "../src/agent/worker-prompt";
import { clampToTokenBudget, estimateTextTokens } from "../src/agent/text-budget";
import { BUILTIN_ROLES } from "../src/agent/sequencer";

describe("clampToTokenBudget（共用原语：marker 与 suffix 一律计入预算）", () => {
  it("未超限时逐字不变（内置角色走这条路）", () => {
    expect(clampToTokenBudget("只读审查前环产出。", 2000, "worker 角色定义")).toBe("只读审查前环产出。");
  });

  it("超限时留头部，总量精确 ≤ 预算，且提示用的是调用方给的 label", () => {
    const text = "角色开头。" + "x".repeat(200 * 1024);
    const out = clampToTokenBudget(text, WORKER_ROLE_TOKEN_BUDGET, "worker 角色定义");
    expect(out.startsWith("角色开头。")).toBe(true);
    expect(out).toContain("[worker 角色定义超 " + String(WORKER_ROLE_TOKEN_BUDGET) + " token，已截断]");
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(WORKER_ROLE_TOKEN_BUDGET);
  });

  it("suffix（取回提示）计入预算，不被提示自己撑破", () => {
    const suffix = "\n[完整定义见插件文件]";
    const out = clampToTokenBudget("y".repeat(300 * 1024), 1000, "角色定义", suffix);
    expect(out.endsWith(suffix)).toBe(true);
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(1000);
  });
});

describe("buildWorkerSystemMessages 的角色块有界", () => {
  async function workspace(): Promise<string> {
    return mkdtemp(join(tmpdir(), "worker-role-"));
  }

  it("内置角色逐字进首块（零回归）", async () => {
    const ws = await workspace();
    try {
      const msgs = await buildWorkerSystemMessages(
        { task: "t", context: {}, mode: "read", roleDefinition: BUILTIN_ROLES.review.roleDefinition },
        ws,
      );
      expect(msgs[0]?.content).toBe("[role] " + BUILTIN_ROLES.review.roleDefinition);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("200KB 的插件角色定义被收到预算内，且任务书仍在最后一条 user 里", async () => {
    const ws = await workspace();
    try {
      const msgs = await buildWorkerSystemMessages(
        { task: "修 bug", context: {}, mode: "read", roleDefinition: "开头行。\n" + "z".repeat(200 * 1024) },
        ws,
      );
      const role = msgs[0]!.content ?? "";
      expect(role.startsWith("[role] 开头行。\n")).toBe(true);
      expect(role).toContain("已截断]");
      expect(estimateTextTokens(role)).toBeLessThanOrEqual(WORKER_ROLE_TOKEN_BUDGET + 10); // "[role] " 前缀开销
      const last = msgs[msgs.length - 1]!;
      expect(last.role).toBe("user");
      expect(last.content).toContain("task: 修 bug");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("无角色定义时不产生 [role] 块（缺省 = 零行为）", async () => {
    const ws = await workspace();
    try {
      const msgs = await buildWorkerSystemMessages({ task: "t", context: {}, mode: "write" }, ws);
      expect(msgs.some((m) => (m.content ?? "").startsWith("[role]"))).toBe(false);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
