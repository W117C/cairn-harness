// 三维读数判卷（面板族剩下三面的数据形状）：权限成员维 / 记忆作用域 / 按成员用量。
//
// 判的是什么：
//   ① 用量按**归属者**汇总（主轮 main、worker 的 agent_id、成员级 member:<id>），顺序稳定；
//   ② 缺字段的 usage 事件不补零、不猜（只认数字）；
//   ③ 记忆作用域三桶都给出来（空桶也要有，面板才知道「这一类没人」）；
//   ④ 权限行把「请求档 / 生效档」并排，裁剪单独点名。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEAM_USAGE_SESSION_CAP, memoryScopes, permissionRows, usageAcrossSessions, usageByOwner } from "../src/agent/team/insights";
import type { AgentEvent } from "../src/events";

const usage = (agent_id: string | undefined, inputTokens: unknown, outputTokens: unknown): AgentEvent =>
  ({ type: "usage", ...(agent_id === undefined ? {} : { agent_id }), inputTokens, outputTokens }) as AgentEvent;

describe("团队三维读数", () => {
  it("用量按归属者汇总：main / worker / member:<id> 各一行，按总量降序", () => {
    const rows = usageByOwner([
      usage(undefined, 100, 10),
      usage("member:m1", 300, 30),
      usage("worker-a", 200, 20),
      usage("member:m1", 100, 10),
    ]);
    expect(rows.totalEvents).toBe(4);
    expect(rows.byOwner).toEqual([
      { owner: "member:m1", inputTokens: 400, outputTokens: 40, events: 2 },
      { owner: "worker-a", inputTokens: 200, outputTokens: 20, events: 1 },
      { owner: "main", inputTokens: 100, outputTokens: 10, events: 1 },
    ]);
  });

  it("缺字段 / 非数字的 usage 不补零不猜", () => {
    const rows = usageByOwner([usage("worker-a", undefined, 5)] as AgentEvent[]);
    expect(rows.byOwner).toEqual([{ owner: "worker-a", inputTokens: 0, outputTokens: 5, events: 1 }]);
    // 非 usage 事件不算
    expect(usageByOwner([{ type: "user_message", content: "hi" } as AgentEvent]).totalEvents).toBe(0);
  });

  it("跨会话聚合：多份日志拼起来再按归属者汇总（读几份只影响总量，不影响同名归属者）", () => {
    const first = [usage("member:m1", 100, 10), usage(undefined, 50, 5)];
    const second = [usage("member:m1", 20, 2), usage("worker-a", 5, 1)];
    const merged = usageAcrossSessions([first, second]);
    expect(merged.totalEvents).toBe(4);
    expect(merged.byOwner).toEqual([
      { owner: "member:m1", inputTokens: 120, outputTokens: 12, events: 2 },
      { owner: "main", inputTokens: 50, outputTokens: 5, events: 1 },
      { owner: "worker-a", inputTokens: 5, outputTokens: 1, events: 1 },
    ]);
    // 空输入 ⇒ 空读数（不是 NaN）
    expect(usageAcrossSessions([])).toEqual({ byOwner: [], totalEvents: 0 });
  });

  it("用量口径是**可见的默认值**：主进程读同一个常量，不抄第二遍数字", () => {
    expect(TEAM_USAGE_SESSION_CAP).toBe(10);
    const source = readFileSync(fileURLToPath(new URL("../apps/desktop/src/main/index.ts", import.meta.url)), "utf8");
    expect(source).toContain("TEAM_USAGE_SESSION_CAP");
    expect(source).not.toMatch(/const USAGE_SESSION_CAP/);
  });

  it("记忆作用域：三桶都给出来，空桶也在", () => {
    const scopes = memoryScopes([
      { id: "m1", memoryScope: "team" },
      { id: "m2", memoryScope: "member" },
      { id: "m3", memoryScope: "team" },
    ]);
    expect(scopes.scopes).toEqual([
      { scope: "team", members: ["m1", "m3"] },
      { scope: "member", members: ["m2"] },
      { scope: "project", members: [] },
    ]);
  });

  it("权限行：请求档与生效档并排，裁剪点名", () => {
    const permissions = permissionRows(
      [{ id: "m1", name: "阿岚", tier: "guided" }],
      { m1: "full-access" },
      "guided",
      [{ id: "m1", requested: "full-access", applied: "guided" }],
    );
    expect(permissions.teamTier).toBe("guided");
    expect(permissions.rows).toEqual([
      { id: "m1", name: "阿岚", requested: "full-access", applied: "guided", clamped: true },
    ]);
  });
});
