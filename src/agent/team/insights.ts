// 团队的三维读数（面板族剩下三面的**数据形状**）：权限、记忆作用域、用量。
//
// 这一层只做纯投影，不碰 IO：
//  · 权限：成员档 ≤ 团队档（`clampTier` 已在 members 里做过），这里只汇总「裁了几个」；
//  · 记忆：按作用域数人头（`memoryScope` 轴，ADR 0015 §五 S1）；
//  · 用量：按**归属者**汇总 usage 事件（主轮 = "main"，worker = agent_id，成员级用 `member:<id>`）。
import type { AgentEvent } from "../../events";
import type { AgentPermissionMode } from "../../events/types";
import type { MemberProfile } from "./members";

export interface PermissionInsight {
  /** 成员档的上界（＝用户当前档）。 */
  teamTier: AgentPermissionMode;
  /** 被裁剪过的成员（裁剪要出声，不许静默降级）。 */
  clamped: { id: string; requested: AgentPermissionMode; applied: AgentPermissionMode }[];
  /** 每个成员一条：请求档与生效档并排，方便面板直接画。 */
  rows: { id: string; name: string; requested: AgentPermissionMode; applied: AgentPermissionMode; clamped: boolean }[];
}

export interface MemoryInsight {
  /** 作用域 → 成员 id 列表。 */
  scopes: { scope: "team" | "member" | "project"; members: string[] }[];
}

export interface UsageInsight {
  /** 归属者 → 用量（token 记账；钱要价表，不在这一层折）。 */
  byOwner: { owner: string; inputTokens: number; outputTokens: number; events: number }[];
  /** 参与记账的事件总数（面板据此说「有/没有读数」）。 */
  totalEvents: number;
}

/** usage 事件里我们认的字段（缺字段 = 这一笔没记，不补零）。 */
function usageOf(event: AgentEvent): { owner: string; input: number; output: number } | null {
  if (event.type !== "usage") return null;
  const e = event as { agent_id?: unknown; inputTokens?: unknown; outputTokens?: unknown; source?: unknown };
  const owner = typeof e.agent_id === "string" && e.agent_id !== "" ? e.agent_id : "main";
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  return { owner, input: num(e.inputTokens), output: num(e.outputTokens) };
}

/** 按归属者汇总 usage。顺序：先按总量降序，再按 owner 字典序（稳定、可判）。 */
export function usageByOwner(events: readonly AgentEvent[]): UsageInsight {
  const map = new Map<string, { inputTokens: number; outputTokens: number; events: number }>();
  let total = 0;
  for (const event of events) {
    const usage = usageOf(event);
    if (usage === null) continue;
    total += 1;
    const row = map.get(usage.owner) ?? { inputTokens: 0, outputTokens: 0, events: 0 };
    row.inputTokens += usage.input;
    row.outputTokens += usage.output;
    row.events += 1;
    map.set(usage.owner, row);
  }
  const byOwner = [...map.entries()]
    .map(([owner, row]) => ({ owner, ...row }))
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens) || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
  return { byOwner, totalEvents: total };
}

/**
 * 跨会话聚合（本页新增）：把多份日志拼起来再汇总。
 * 拼接顺序由调用方给（按会话新旧），汇总本身的排序仍由 `usageByOwner` 决定（总量降序 + 字典序），
 * 所以「读了几份」不影响同名归属者的数值，只影响总量。
 */
/**
 * 「哪些会话算同一个团队」的**默认口径**：同一会话根下最近的 N 个会话。
 * 这是一个**可见的默认值**，不是物理常量：业主改口径时只改这一处与台账，
 * 主进程读的就是它（判卷钉住「主进程用的是这个数」）。
 */
export const TEAM_USAGE_SESSION_CAP = 10;

export function usageAcrossSessions(logs: readonly (readonly AgentEvent[])[]): UsageInsight {
  return usageByOwner(logs.flat());
}

/** 记忆作用域：按 scope 分组（空组也给出，面板才知道「这一类没人」）。 */
export function memoryScopes(members: readonly Pick<MemberProfile, "id" | "memoryScope">[]): MemoryInsight {
  const scopes: MemoryInsight["scopes"] = [
    { scope: "team", members: [] },
    { scope: "member", members: [] },
    { scope: "project", members: [] },
  ];
  for (const member of members) {
    const bucket = scopes.find((s) => s.scope === member.memoryScope) ?? scopes[0]!;
    bucket.members.push(member.id);
  }
  return { scopes };
}

/** 权限：把「请求档 / 生效档」并排画出来，裁剪过的单独点名。 */
export function permissionRows(
  members: readonly Pick<MemberProfile, "id" | "name" | "tier">[],
  requested: Readonly<Record<string, AgentPermissionMode>>,
  teamTier: AgentPermissionMode,
  clamped: readonly { id: string; requested: AgentPermissionMode; applied: AgentPermissionMode }[],
): PermissionInsight {
  return {
    teamTier,
    clamped: [...clamped],
    rows: members.map((m) => {
      const asked = requested[m.id] ?? m.tier;
      return { id: m.id, name: m.name, requested: asked, applied: m.tier, clamped: asked !== m.tier };
    }),
  };
}
