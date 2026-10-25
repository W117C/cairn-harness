import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildReadPlan, OrchestrationSnapshotView } from "../src/renderer/components/OrchestrationPane";
import { parsePlan } from "../../../src/orchestration/validate";
import type { OrchestrationSnapshot } from "../../../src/main/orchestration-service";
import { orchestrationPlan } from "../../../tests/orchestration-fixture";

describe("orchestration desktop control", () => {
  it("builds a bounded read-only plan from ordinary task lines", () => {
    const plan = buildReadPlan({ id: "draft-1", goal: "检查实现", tasks: "阅读接口\n\n核对证据", budget: 2, sequential: true });
    expect(() => parsePlan(plan)).not.toThrow();
    expect(plan.tasks.map(task => ({ goal: task.goal, dependencies: task.depends_on, budget: task.budget.usd }))).toEqual([
      { goal: "阅读接口", dependencies: [], budget: 1 }, { goal: "核对证据", dependencies: ["task-1"], budget: 1 },
    ]);
    expect(plan.agents[0]?.capability).toEqual({ tools: ["read_file", "grep", "glob"], fs_read: ["."], fs_write: [], network: [], shell: "none", git: "none", external_effects: "none" });
    expect(plan.tasks.every(task => task.lane === "read" && task.contract.effect === "none" && task.write_scopes.length === 0)).toBe(true);
    expect(() => buildReadPlan({ id: "bad", goal: "x", tasks: "x", budget: NaN, sequential: false })).toThrow();
  });

  it("shows backend limits, literal task state, dependency, budget and missing evidence", () => {
    const plan = orchestrationPlan();
    plan.tasks[0]!.depends_on = ["prior-task"];
    const snapshot: OrchestrationSnapshot = {
      address: { workspace: "/workspace", sessionId: "current" }, mode: "shadow", backend: null,
      execution_unavailable: "没有可执行后端", error: "记录不可验证", next_actions: [],
      view: { last_event_id: 1, now: 1, anomalies: ["revision mismatch"], plans: {
        plan: { plan, phase: "approved", spent_usd: 0.5, reserved_usd: 1, source_event_id: 1,
          tasks: { t0: { task: plan.tasks[0]!, phase: "done", evidence: "absent", attempt: 1, spent_usd: 0.5, reserved_usd: 0, reason: "缺少验证记录" } } },
      } },
    };
    const html = renderToStaticMarkup(<OrchestrationSnapshotView snapshot={snapshot} pending={false} onControl={vi.fn()} />);
    expect(html).toContain("预览模式");
    expect(html).toContain("没有可执行后端");
    expect(html).toContain("prior-task");
    expect(html).toContain("done");
    expect(html).toContain("absent");
    expect(html).toContain("缺少验证记录");
    expect(html).toContain("revision mismatch");
    expect(html).toContain("记录不可验证");
    expect(html).toContain("0.5000");
    expect(html).toContain('aria-label="重试任务 t0"');
    expect(html).toContain('aria-label="接管任务 t0"');
    expect(html).not.toContain("验证通过");
  });
});
