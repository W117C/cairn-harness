import type { OrchPlan } from "../src/orchestration/types";
export function orchestrationPlan(count = 1): OrchPlan {
  return {
    plan_id: "plan", version: 1, goal: "Test orchestration", non_goals: [], domain: "generic",
    budget: { usd: 10 }, max_concurrency: 2, policy_ref: "restricted-v1", created_by: "user",
    agents: [{ agent_spec_id: "reader", role: "reader", max_turns: 4, capability: {
      tools: ["read_file"], fs_read: ["src"], fs_write: [], network: [], shell: "none", git: "none", external_effects: "none",
    } }],
    tasks: Array.from({ length: count }, (_, i) => ({
      task_id: "t" + i, goal: "Read evidence " + i, non_goals: [], agent_spec: "reader", lane: "read",
      depends_on: [], write_scopes: [], inputs: [], budget: { usd: 1 }, max_attempts: 2, priority: 5,
      contract: { effect: "none", acceptance: [{ kind: "evidence", id: "answer", fields: ["answer"] }] },
    })),
  };
}
