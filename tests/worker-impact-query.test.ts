// 影响面读端接进 worker（能力 1 的事前一跳：worker 在 worktree 里改代码也要能问「谁在调用它」）。
// 这组测的是**三处同源**——规格面（模型看得见）/ 执行面（真能跑）/ loop 白名单（不被硬闸摘掉），
// 本仓反复出「机器齐全但两头断」的缺陷（bandit 回灌、defaultImpactHook、detectStuck 都属这类）。
import { describe, expect, it } from "vitest";
import { WORKER_IMPACT_TOOL, WORKER_TOOL_TABLE, WRITE_WORKER_TOOL_TABLE, workerToolTable } from "../src/agent/orchestrator-config";
import { workerToolSpecs } from "../src/agent/worker-shell-tools";
import { buildWorkerToolTable } from "../src/agent/worker-tool-table";
import { impactQuerySpec } from "../src/tools/impact-query";
import { TOOLS } from "../src/tools";
import { isSideEffectTool } from "../src/permissions";
import type { WorkerHandle } from "../src/agent/orchestrator-types";

const fakeW = (mode: "read" | "write"): WorkerHandle => ({ mode, agentId: "a-fake" }) as unknown as WorkerHandle;
const specsOf = (mode: "read" | "write", on: boolean): string[] =>
  workerToolSpecs(mode, { impactAnalysis: on }).map((s) => s.function.name);
const tableOf = (mode: "read" | "write", on: boolean): string[] =>
  Object.keys(buildWorkerToolTable(fakeW(mode), {} as never, { impactAnalysis: on }));

describe("影响面读端接进 worker 工具面", () => {
  it.each(["read", "write"] as const)("%s 档：开关关着时三处一处都不加（模型面零字节）", (mode) => {
    expect(specsOf(mode, false)).not.toContain(WORKER_IMPACT_TOOL);
    expect(tableOf(mode, false)).not.toContain(WORKER_IMPACT_TOOL);
    expect(workerToolTable(mode, false)).not.toContain(WORKER_IMPACT_TOOL);
    // 关着时的白名单必须与既有常量逐字同集合（否则既有 J7c 断言面会被悄悄改写）
    expect([...workerToolTable(mode, false)].sort())
      .toEqual([...(mode === "write" ? WRITE_WORKER_TOOL_TABLE : WORKER_TOOL_TABLE)].sort());
  });

  it.each(["read", "write"] as const)("%s 档：开关开启时规格与实例同名同时出现，白名单同步", (mode) => {
    expect(specsOf(mode, true)).toContain(WORKER_IMPACT_TOOL);
    expect(tableOf(mode, true)).toContain(WORKER_IMPACT_TOOL);
    expect(workerToolTable(mode, true)).toContain(WORKER_IMPACT_TOOL);
    // 规格名字与实例名字必须一字不差（模型调 impact_query、执行表只有 impact ⇒ 「执行面有、模型面没有」）
    expect(impactQuerySpec.name).toBe(WORKER_IMPACT_TOOL);
    // 三处同源：白名单集合 == 规格名字集合（每个可执行工具恰好一次，无孤儿）
    expect([...workerToolTable(mode, true)].sort()).toEqual([...specsOf(mode, true)].sort());
    expect(new Set(specsOf(mode, true)).size).toBe(specsOf(mode, true).length);
    // 执行面与规格面同集合：多出的实例 = 模型够不着的死码；多出的规格 = 一调就「unknown tool」
    expect([...tableOf(mode, true)].sort()).toEqual([...specsOf(mode, true)].sort());
  });

  it("开关开启时执行面真的挂着 impact_query 实例（不是只有规格——「模型看得见、一调就 unknown tool」）", () => {
    const table = buildWorkerToolTable(fakeW("read"), {} as never, { impactAnalysis: true });
    expect(typeof table[WORKER_IMPACT_TOOL]?.run).toBe("function");
    expect(table[WORKER_IMPACT_TOOL]?.name).toBe(WORKER_IMPACT_TOOL);
  });

  it("读档 worker 也拿得到（只读工具不该以写权限为前置）", () => {
    expect(workerToolTable("read", true)).toContain(WORKER_IMPACT_TOOL);
    expect(isSideEffectTool(WORKER_IMPACT_TOOL)).toBe(false);
  });

  it("不进静态工具表：关着时主会话与 worker 都不为该工具付字节", () => {
    expect(Object.keys(TOOLS)).not.toContain(WORKER_IMPACT_TOOL);
  });

  it("worker 追加的规格体积有界（工具面是每轮重送的固定成本，随 worker 数放大）", () => {
    const before = JSON.stringify(workerToolSpecs("read", { impactAnalysis: false })).length;
    const after = JSON.stringify(workerToolSpecs("read", { impactAnalysis: true })).length;
    expect(after - before).toBeLessThan(700);
  });
});
