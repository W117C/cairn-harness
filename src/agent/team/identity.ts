// 成员线程的运行身份（ADR 0015 §四 的第二件：成员会话归属）。
//
// 这一层只做一件事：把「派活时点的成员 id」变成**运行期 agent_id**。不点成员 ⇒ 老路径
// （`worker-N`）一字不变；点了成员 ⇒ `member:<id>`，于是：
//  · 记忆作用域（`scopesForAgent`）自动带上成员私有档；
//  · `remember` 的 member 档有身份可认；
//  · 用量按 `member:<id>` 归属，面板的成员维才有真数据。
//
// 纪律：id 只收 `[A-Za-z0-9_-]{1,64}`（与成员档案同一把尺）；不合法 ⇒ 拒，不悄悄退回 worker-N
// （退回去会让「派给某个成员」变成「派给一个匿名 worker」，事后没人查得出来）。
export const MEMBER_AGENT_PREFIX = "member:";

export type SpawnIdentity =
  | { ok: true; agentId: string; memberId: string | null }
  | { ok: false; error: string };

export function spawnIdentity(memberId: string | undefined, fallback: () => string): SpawnIdentity {
  if (memberId === undefined || memberId === "") return { ok: true, agentId: fallback(), memberId: null };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) {
    return { ok: false, error: `spawn_agent: 成员 id 只收字母/数字/下划线/连字符（1-64 位），收到 ${JSON.stringify(memberId)}` };
  }
  return { ok: true, agentId: MEMBER_AGENT_PREFIX + memberId, memberId };
}

/** 反向：`member:<id>` → id；不是成员身份 ⇒ null。 */
export function memberOfAgentId(agentId: string | undefined): string | null {
  if (typeof agentId !== "string" || !agentId.startsWith(MEMBER_AGENT_PREFIX)) return null;
  const id = agentId.slice(MEMBER_AGENT_PREFIX.length);
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
