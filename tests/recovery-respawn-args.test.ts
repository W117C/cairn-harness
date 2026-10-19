// 2026-10-19 独立评审：恢复卡「按原 spawn 参数重派」对所有真实 worker 都不可执行——
// RespawnArgs 带着 usage_model / worktree / base_commit 等审计字段，旧 respawn 原样转给 spawn，
// 第一步就被 unconsumedSpawnArgs 当「未知参数」拒掉。
import { describe, expect, it } from "vitest";
import { respawnArgsFrom, respawnSpawnArgs } from "../src/agent/recovery";
import { unconsumedSpawnArgs } from "../src/agent/spawn-surface";
import type { AgentSpawnedEvent } from "../src/events";

const spawned = (over: Partial<AgentSpawnedEvent>): AgentSpawnedEvent => ({
  type: "agent_spawned",
  agent_id: "w1",
  parent_event_id: 3,
  mode: "read",
  task: "检查配置",
  max_turns: 8,
  permission_mode: "read-only",
  ...over,
} as AgentSpawnedEvent);

describe("respawn 只转 spawn 合法顶参", () => {
  it("真实 read worker（带 usage_model / 越界请求 / tier_warning）不再被拒", () => {
    const a = respawnSpawnArgs(respawnArgsFrom(spawned({
      usage_model: "glm-4.6",
      permission_mode_requested: "auto",
      tier_warning: "越界裁剪到 read-only",
    })));
    const surface = unconsumedSpawnArgs("read", a);
    expect(surface.unknown).toEqual([]);
    expect(surface.dropped).toEqual([]);
    expect(a).not.toHaveProperty("usage_model");
    expect(a).not.toHaveProperty("permission_mode_requested");
    expect(a).not.toHaveProperty("tier_warning");
  });

  it("真实 write worker（带 worktree / base_commit）同样干净", () => {
    const a = respawnSpawnArgs(respawnArgsFrom(spawned({
      mode: "write",
      permission_mode: "auto",
      worktree: ".agents/wt-w1",
      base_commit: "abc123",
      usage_model: "glm-4.6",
    })));
    const surface = unconsumedSpawnArgs("write", a);
    expect(surface.unknown).toEqual([]);
    expect(surface.dropped).toEqual([]);
    expect(a).not.toHaveProperty("worktree");
    expect(a).not.toHaveProperty("base_commit");
  });

  it("反面对照：旧写法（整包转交）确实会被判未知参数", () => {
    const args = respawnArgsFrom(spawned({ usage_model: "glm-4.6" }));
    expect(unconsumedSpawnArgs("read", args as unknown as Record<string, unknown>).unknown).toContain("usage_model");
  });
});
