// 方案门（任务 2）验收：存在未批准 plan 时，write_file/run_shell 在权限层被拒；
// 批准后同一调用放行；只读工具在任何阶段都不被拦。
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { PlanGate } from "../src/agent/gates";
import {
  approvePlan,
  checkPermission,
  denyReason,
  gate,
  getPlanState,
  markPlanProposed,
  resetPlanState,
  runWithPlanScope,
} from "../src/permissions";
import type { ToolResult } from "../src/tools/base";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { propose_plan } from "../src/tools/propose_plan";
import type { ModelOutput } from "../src/providers";

function scriptedProvider(script: ModelOutput[]): {
  provider: { next(): Promise<ModelOutput | null> };
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    provider: {
      async next() {
        calls++;
        const v = script[i];
        i++;
        return v ?? null;
      },
    },
    calls: () => calls,
  };
}

const PLAN = {
  goal: "修复 completedCount",
  files: [{ path: "src/todo.ts", action: "edit" as const, summary: "过滤 done" }],
};

beforeEach(() => {
  resetPlanState();
});

describe("权限层写禁（方案门）", () => {
  it("①未批准：write_file/run_shell 一律 deny（连 auto 档也拦）；只读与门工具不拦", () => {
    markPlanProposed();
    expect(getPlanState()).toEqual({ required: false, proposed: true, approved: false });
    for (const mode of ["read-only", "default", "auto"] as const) {
      expect(checkPermission(mode, "write_file")).toBe("deny");
      expect(checkPermission(mode, "run_shell")).toBe("deny");
      expect(gate(mode, "write_file", true)).toBe("deny");
      expect(gate(mode, "run_shell", false)).toBe("deny");
    }
    // ③只读工具与门工具在任何阶段都不被拦
    for (const mode of ["read-only", "default", "auto"] as const) {
      expect(checkPermission(mode, "read_file")).toBe("allow");
      expect(checkPermission(mode, "clarify")).toBe("allow");
      expect(checkPermission(mode, "propose_plan")).toBe("allow");
      expect(checkPermission(mode, "verify")).toBe("allow");
    }
    expect(denyReason("write_file")).toContain("方案门");
    expect(denyReason("read_file")).toBeNull();
  });

  it("②批准后：同一调用放行（auto → allow；default → ask 回到档位语义）", () => {
    markPlanProposed();
    approvePlan();
    expect(getPlanState()).toEqual({ required: false, proposed: true, approved: true });
    expect(checkPermission("auto", "write_file")).toBe("allow");
    expect(checkPermission("default", "write_file")).toBe("ask");
    expect(checkPermission("auto", "run_shell")).toBe("allow");
  });

  it("无 plan 时保持 M0 语义（回归护栏）", () => {
    expect(getPlanState()).toEqual({ required: false, proposed: false, approved: false });
    expect(checkPermission("auto", "write_file")).toBe("allow");
    expect(checkPermission("read-only", "write_file")).toBe("deny");
    expect(checkPermission("default", "run_shell")).toBe("ask");
  });
});

describe("方案门（loop 级）", () => {
  it("①未批准时写工具返回拒绝（tool_result 含 permission denied 与方案门原因）", async () => {
    markPlanProposed();
    const logPath = join(tmpdir(), `m1b-plan-deny-${String(Date.now())}.jsonl`);
    const events = createEventLog(logPath);
    const { provider } = scriptedProvider([
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "x.txt", content: "hi" } },
    ]);
    await runLoop({ provider, events, workspace: tmpdir(), mode: "auto" });
    const log = await replay(logPath);
    const result = log.find((e) => e.type === "tool_result");
    expect(result?.type === "tool_result" && result.ok).toBe(false);
    if (result?.type === "tool_result") {
      expect(result.output).toContain("[permission denied]");
      expect(result.output).toContain("方案门");
    }
    await rm(logPath, { force: true });
  });

  it("②批准后同一调用放行（文件真的写入）", async () => {
    markPlanProposed();
    approvePlan();
    const ws = join(tmpdir(), `m1b-plan-allow-${String(Date.now())}`);
    await mkdir(ws, { recursive: true });
    const logPath = join(ws, "events.jsonl");
    const events = createEventLog(logPath);
    const { provider } = scriptedProvider([
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "x.txt", content: "批准后写入" } },
    ]);
    await runLoop({ provider, events, workspace: ws, mode: "auto" });
    const log = await replay(logPath);
    const result = log.find((e) => e.type === "tool_result");
    expect(result?.type === "tool_result" && result.ok).toBe(true);
    expect(await readFile(join(ws, "x.txt"), "utf8")).toBe("批准后写入");
    await rm(ws, { recursive: true, force: true });
  });

  it("③只读工具在未批准阶段照常执行", async () => {
    markPlanProposed();
    const ws = join(tmpdir(), `m1b-plan-read-${String(Date.now())}`);
    await mkdir(ws, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(ws, "note.txt"), "只读内容", "utf8");
    const logPath = join(ws, "events.jsonl");
    const events = createEventLog(logPath);
    const { provider } = scriptedProvider([
      { type: "tool_call", id: "r1", name: "read_file", args: { path: "note.txt" } },
    ]);
    await runLoop({ provider, events, workspace: ws, mode: "auto" });
    const log = await replay(logPath);
    const result = log.find((e) => e.type === "tool_result");
    expect(result?.type === "tool_result" && result.ok).toBe(true);
    await rm(ws, { recursive: true, force: true });
  });

  it("propose_plan：落 plan_proposed → 权限层进入写禁 → 批准后解锁；拒绝则写禁保持", async () => {
    const planGate = new PlanGate();
    const emitted: AgentEvent[] = [];
    const emit = (e: AgentEvent): void => {
      emitted.push(e);
    };
    // 工具挂起等待期间，写禁已生效
    const pending = propose_plan.run(
      { goal: PLAN.goal, files: PLAN.files },
      { workspace: "/tmp", callId: "p1", emit, plan: planGate },
    );
    await Promise.resolve(); // 让 emit 的首个 await 边界走完（事件落数组）
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe("plan_proposed");
    expect(getPlanState()).toEqual({ required: false, proposed: true, approved: false });
    expect(checkPermission("auto", "write_file")).toBe("deny");

    // 拒绝 → 写禁保持
    expect(planGate.reject("p1")).toBe(true);
    const rejected = await pending;
    expect(rejected.ok).toBe(false);
    expect(getPlanState()).toEqual({ required: false, proposed: true, approved: false });
    expect(checkPermission("auto", "write_file")).toBe("deny");

    // 重新提议 → 批准 → 解锁
    const pending2 = propose_plan.run(
      { goal: PLAN.goal, files: PLAN.files },
      { workspace: "/tmp", callId: "p2", emit, plan: planGate },
    );
    expect(planGate.approve("p2")).toBe(true);
    const approved = await pending2;
    expect(approved.ok).toBe(true);
    expect(getPlanState()).toEqual({ required: false, proposed: true, approved: true });
    expect(checkPermission("auto", "write_file")).toBe("allow");

    // 无门接线 → fail-closed
    await expect(propose_plan.run({ goal: "g", files: PLAN.files }, { workspace: "/tmp" })).rejects.toThrow(
      "无方案审批通道",
    );
  });

  it("propose_plan 入参校验：空 goal / 空 files / action 越界 拒绝", async () => {
    await expect(propose_plan.run({ goal: "", files: PLAN.files }, { workspace: "/tmp" })).rejects.toThrow("goal");
    await expect(propose_plan.run({ goal: "g", files: [] }, { workspace: "/tmp" })).rejects.toThrow("files");
    await expect(
      propose_plan.run({ goal: "g", files: [{ path: "a", action: "touch", summary: "s" }] }, { workspace: "/tmp" }),
    ).rejects.toThrow("action");
  });
});

// P1（审查）回归：plan 门解锁在 run 链内落地——propose_plan 收到 approved 决议后自行 approvePlan
//（决议处理器不在 run 异步链内，plan 态已 run 级隔离）。run 内解锁对 run 可见，模块态（run 外
// 遗留路径）不受污染。
describe("方案门 run 级隔离（P1 回归）", () => {
  it("run 内 propose → 批准 → run 态解锁且模块态不动；run 外模块态行为不变", async () => {
    const planGate = new PlanGate();
    const emitted: AgentEvent[] = [];
    const emit = (e: AgentEvent): void => {
      emitted.push(e);
    };
    let outcome: Promise<ToolResult> | null = null;
    runWithPlanScope(() => {
      outcome = propose_plan.run(
        { goal: PLAN.goal, files: PLAN.files },
        { workspace: "/tmp", callId: "p1", emit, plan: planGate },
      );
      // markPlanProposed 已同步落 run 态：本 run 写禁即刻生效
      expect(checkPermission("auto", "write_file")).toBe("deny");
      return outcome; // 不同步等待：批准从 run 外到达（生产语义：决议处理器不在 run 链内）
    });
    // run 外（模拟另一 run / IPC 决议处理器）：模块态未被 A 的提案污染
    expect(getPlanState()).toEqual({ required: false, proposed: false, approved: false });
    expect(planGate.approve("p1")).toBe(true);
    const done = await outcome!;
    expect(done.ok).toBe(true);
    // 解锁由工具在 run 链内自落：只落 run 态，模块态不动
    expect(getPlanState()).toEqual({ required: false, proposed: false, approved: false });
    // run 外模块态照常可用（脚本/测试遗留路径行为不变）
    markPlanProposed();
    expect(checkPermission("auto", "write_file")).toBe("deny");
    approvePlan();
    expect(checkPermission("auto", "write_file")).toBe("allow");
    resetPlanState();
  });
});
