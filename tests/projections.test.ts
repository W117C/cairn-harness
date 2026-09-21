// projections.ts 纯函数覆盖：本文件替代随 React 归档删除的 tests/panels.test.ts 中
// 对三个**仍在发货**的投影函数的断言（projectDiffCards 还被 panels-check 消费）。
// React 组件注册表/SSR 冒烟部分随 panels/registry.tsx 归档不再适用，故不重建。
import { describe, expect, it } from "vitest";
import { pendingApprovals, projectDiffCards, projectMemoryWrites, projectMergeTower, workerEvidenceLabel, workerSpentLabel, groupOnboardingSteps } from "../src/renderer/projections";
import { ONBOARDING_GROUPS } from "../src/main/onboarding-groups";
import type { AgentEvent } from "../src/events";

describe("projections 纯函数（消费方：panels-check / agents-check / sidechat-check 与渲染层）", () => {
  it("memory 投影：remember tool_call/tool_result 配对（M2d）", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "m1", name: "remember", args: { scope: "project", kind: "memory", topic: "note" } },
      { type: "tool_result", callId: "m1", ok: true, output: "已记录" },
    ];
    const writes = projectMemoryWrites(events);
    expect(writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ callId: "m1", scope: "project", kind: "memory", topic: "note", ok: true });
  });

  it("memory 投影：无 remember 调用 → 空列表（不误报）", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "x1", name: "read_file", args: { path: "a.ts" } },
      { type: "tool_result", callId: "x1", ok: true, output: "" },
    ];
    expect(projectMemoryWrites(events)).toEqual([]);
  });

  it("diff 投影：write_file 聚合 + tool_result 配对状态；空事件 → 空列表", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts", content: "x" } },
      { type: "tool_result", callId: "t1", ok: true, output: "written" },
      { type: "tool_call", id: "t2", name: "write_file", args: { path: "b.ts", content: "y" } },
      { type: "tool_call", id: "t3", name: "read_file", args: { path: "a.ts" } },
    ];
    const diffs = projectDiffCards(events);
    expect(diffs.map((d) => d.id)).toEqual(["t1", "t2"]);
    expect(diffs[0]?.ok).toBe(true);
    expect(diffs[1]?.ok).toBe(null);
    expect(projectDiffCards([])).toEqual([]);
  });

  it("approvals 投影：未 resolved 计数；resolved 后归零（重启后 pending 必空）", () => {
    const asks = [
      { askId: "a1", tool: "run_shell", args: {} },
      { askId: "a2", tool: "write_file", args: {}, resolved: "approved" as const },
    ];
    expect(pendingApprovals(asks).map((a) => a.askId)).toEqual(["a1"]);
    expect(pendingApprovals([])).toEqual([]);
  });
});

// 合并控制塔的「这份交付到底跑过测试没有、花了多少钱」——W4b 四态 + W3② 价格标签的读端。
describe("merge 塔的证据四态与花费账（读端）", () => {
  const spawned = {
    type: "agent_spawned", agent_id: "a1", mode: "write", task: "修排序", worktree: "wt-a1", base_commit: "abc",
  } as unknown as AgentEvent;
  const result = (artifacts: Record<string, unknown>): AgentEvent =>
    ({ type: "agent_result", agent_id: "a1", status: "done", summary: "改完了", artifacts }) as unknown as AgentEvent;

  it("回程带 verified / spent_usd ⇒ 列上取得到（父会话与面板读同一份投影）", () => {
    const col = projectMergeTower([spawned, result({ verified: "verified", spent_usd: 0.0123 })])[0];
    expect(col.verified).toBe("verified");
    expect(col.spentUsd).toBeCloseTo(0.0123, 6);
    expect(workerEvidenceLabel(col.verified)).toBe("已验证");
    expect(workerSpentLabel(col.spentUsd)).toBe("$0.0123");
  });

  it("「没带标记」与「机器判出没有验证拍」是两句话，不许合并", () => {
    const noMark = projectMergeTower([spawned, result({})])[0];
    const absent = projectMergeTower([spawned, result({ verified: "absent" })])[0];
    expect(noMark.verified).toBeNull();
    expect(absent.verified).toBe("absent");
    expect(workerEvidenceLabel(null)).toBe("无回程标记");
    expect(workerEvidenceLabel("absent")).toBe("无验证拍");
    expect(workerEvidenceLabel(null), "把不可知折成已知的任何一种 = 假证据").not.toBe(workerEvidenceLabel("absent"));
    expect(workerEvidenceLabel("stale")).toBe("证据已过期");
    expect(workerEvidenceLabel("failed")).toBe("验证未过");
  });

  it("价格不可知说「价格未知」，真话 $0 才写 $0.0000（不可知≠免费）", () => {
    expect(workerSpentLabel(null)).toBe("价格未知");
    expect(workerSpentLabel(0)).toBe("$0.0000");
    const col = projectMergeTower([spawned, result({ verified: "verified" })])[0];
    expect(col.spentUsd).toBeNull();
  });
});

describe("§13 引导的步数分组（向导只渲染这份投影）", () => {
  const g = (id: string, step: number) => ({ id, step });

  it("乱序进来 → 步号升序出去，步内保持给到的顺序", () => {
    const steps = groupOnboardingSteps([g("memory", 3), g("provider", 1), g("ui", 2), g("schedule", 3), g("permission", 2)]);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(steps[1]!.items.map((i) => i.id)).toEqual(["ui", "permission"]);
    expect(steps[2]!.items.map((i) => i.id)).toEqual(["memory", "schedule"]);
  });

  it("真实那张表恰好四步七组（步数不在界面里写死，但也不能是空表）", () => {
    const steps = groupOnboardingSteps(ONBOARDING_GROUPS);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4]);
    expect(steps.reduce((n, s) => n + s.items.length, 0)).toBe(7);
  });

  it("空表 ⇒ 空向导（不造一步空壳让计数看起来对）", () => {
    expect(groupOnboardingSteps([])).toEqual([]);
  });
});
