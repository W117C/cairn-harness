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

  it("shows backend limits, readable state, dependency, budget and missing evidence", () => {
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
    expect(html).toContain("已批准");
    expect(html).toContain('data-phase="approved"');
    expect(html).toContain("已完成");
    expect(html).toContain('data-phase="done"');
    expect(html).toContain("未验证");
    expect(html).toContain("缺少验证记录");
    expect(html).toContain("revision mismatch");
    expect(html).toContain("记录不可验证");
    expect(html).toContain("0.5000");
    // 终态任务只留引擎真正接受的出口；重试/接管/取消在终态都被拒，不许再摆成可点按钮。
    expect(html).not.toContain('aria-label="重试任务 t0"');
    expect(html).not.toContain('aria-label="接管任务 t0"');
    expect(html).not.toContain('aria-label="取消任务 t0"');
    expect(html).not.toContain("合并交付");
    expect(html).not.toContain("拒绝交付");
    expect(html).not.toContain("验证通过");
  });

  it("keeps every task action inside the engine's legal transitions", () => {
    const plan = orchestrationPlan(3);
    const snapshot: OrchestrationSnapshot = {
      address: { workspace: "/workspace", sessionId: "current" }, mode: "shadow", backend: "local", backend_capabilities: { rollback: true },
      next_actions: [],
      view: { last_event_id: 1, now: 1, anomalies: [], plans: {
        plan: { plan, phase: "proposed", spent_usd: 0, reserved_usd: 0, source_event_id: 1,
          tasks: {
            t0: { task: plan.tasks[0]!, phase: "running", run_id: "run-1", evidence: "absent", attempt: 1, spent_usd: 0, reserved_usd: 0 },
            t1: { task: plan.tasks[1]!, phase: "failed", evidence: "failed", attempt: 1, spent_usd: 0, reserved_usd: 0 },
            t2: { task: plan.tasks[2]!, phase: "done", run_id: "run-2", evidence: "verified", verdict: "pass", attempt: 1, spent_usd: 0, reserved_usd: 0 },
          } },
      } },
    };
    const html = renderToStaticMarkup(<OrchestrationSnapshotView snapshot={snapshot} pending={false} onControl={vi.fn()} />);
    expect(html).toContain("待批准");
    expect(html).toContain('aria-label="批准 plan"');
    expect(html).toContain('aria-label="拒绝 plan"');
    // 运行中：暂停 + 取消，不给接管。
    expect(html).toContain('aria-label="暂停任务 t0"');
    expect(html).toContain('aria-label="取消任务 t0"');
    expect(html).not.toContain('aria-label="接管任务 t0"');
    // 失败且还有次数：只能重试。
    expect(html).toContain('aria-label="重试任务 t1"');
    expect(html).not.toContain('aria-label="暂停任务 t1"');
    // 已交付且有后端回滚：回滚（要确认）。
    expect(html).toContain('aria-label="回滚改动 t2"');
    expect(html).toContain('data-confirm="true"');
    // 未批准计划不摆「启用执行」。
    expect(html).not.toContain("启用执行");
  });

  it("keeps product copy Chinese while the raw codes stay in titles", () => {
    const plan = orchestrationPlan();
    const snapshot: OrchestrationSnapshot = {
      address: { workspace: "/workspace", sessionId: "current" }, mode: "shadow", backend: null,
      execution_unavailable: "没有可执行后端", next_actions: [
        { kind: "dispatch", plan_id: "plan", version: 1, task_id: "t0", reason: "dependency failed, was cancelled or requires user action" },
        { kind: "escalate", plan_id: "plan", version: 1, task_id: "t0", reason: "upstream provider returned 529" },
      ],
      view: { last_event_id: 1, now: 1, anomalies: [], plans: {
        plan: { plan, phase: "approved", spent_usd: 0, reserved_usd: 0, source_event_id: 1,
          tasks: { t0: { task: plan.tasks[0]!, phase: "needs_you", evidence: "absent", attempt: 0, spent_usd: 0, reserved_usd: 0,
            reason: "taken over by user", artifacts: [{ id: "a1", kind: "file", hash: "sha256:abc" }] } } },
      } },
    };
    const html = renderToStaticMarkup(<OrchestrationSnapshotView snapshot={snapshot} pending={false} onControl={vi.fn()} />);
    expect(html).toContain("需你处理");
    expect(html).toContain("已由你接管");
    expect(html).toContain("只读");
    expect(html).toContain("外部效果：无");
    expect(html).toContain("证据");
    expect(html).toContain("· 文件 ·");
    expect(html).toContain("派发");
    expect(html).toContain("依赖失败、被取消或需要你处理");
    expect(html).toContain("升级");
    // 未知原因不编造：原句原样透出。
    expect(html).toContain("upstream provider returned 529");
    // 机器码仍留在 title 里可回查。
    expect(html).toContain('title="taken over by user"');
    expect(html).not.toContain("· dispatch");
    expect(html).not.toContain("· escalate");
    expect(html).not.toContain("· evidence");
    expect(html).not.toContain("· file");
  });
});
