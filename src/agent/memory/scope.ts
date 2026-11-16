// 记忆作用域（ADR 0015 §五 S1 的第二步：从「声明」到「检索过滤」）。
//
// 三个作用域与成员档案里的 `memoryScope` 同词（team / member / project）：
//  · team    —— 团队共享（谁都读得到）
//  · member  —— 成员私有（只有本人读得到；成员身份由调用方给，本层不猜）
//  · project —— 跟随项目（今天所有既有记忆都属于这一档）
//
// 纪律：
//  ① **缺席作用域 = project**：既有记忆没有 scope 字段，把它们读成「团队共享」会让私密内容
//     在升级后排错队；读成 project 与今天的实际行为一致。
//  ② 未给允许集（undefined）= 不过滤：默认路径零行为变化（老调用方逐字不变）。
//  ③ 空允许集 = 什么都读不到，不是「什么都读」——空集合是「这个人没有可读档」的表达。
export const MEMORY_SCOPES = ["team", "member", "project"] as const;
export type MemoryScopeName = (typeof MEMORY_SCOPES)[number];

/** 缺席 ⇒ project（见头注①）。认不出的值也按 project（不猜成更宽的 team）。 */
export function scopeOf(value: string | undefined): MemoryScopeName {
  return value === "team" || value === "member" ? value : "project";
}

/** 该条目在这一组允许集里读不读得到。`allowed` 缺席 ⇒ 全放行。 */
export function scopeAllowed(scope: string | undefined, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true;
  return allowed.includes(scopeOf(scope));
}

/** 过滤候选（纯函数；保持原顺序，不做二次排序）。 */
export function filterByScope<T extends { scope?: string }>(
  items: readonly T[],
  allowed: readonly string[] | undefined,
): T[] {
  if (allowed === undefined) return [...items];
  return items.filter((item) => scopeAllowed(item.scope, allowed));
}

/**
 * 成员私有记忆的落点：`<memory-home>/members/<id>`。
 * id 只收 `[A-Za-z0-9_-]`（与成员档案的 id 规则同口径，不许带`.`/`/`——路径穿越与分隔歧义都在这里挡）。
 * 目录本身不存在也算合法（第一次写入时创建）。
 */
export function memberMemoryDir(memoryHome: string, memberId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) {
    throw new Error(`成员 id 只收字母/数字/下划线/连字符（1-64 位），收到 ${JSON.stringify(memberId)}`);
  }
  return `${memoryHome}/members/${memberId}`;
}

/** 三个档位各自的落点描述（面板与文档共用一份，不各自拼路径）。 */
export function scopeDirs(memoryHome: string, projectDir: string, memberId?: string): { scope: MemoryScopeName; dir: string }[] {
  const out: { scope: MemoryScopeName; dir: string }[] = [
    { scope: "project", dir: projectDir },
    { scope: "team", dir: memoryHome },
  ];
  if (memberId !== undefined) out.push({ scope: "member", dir: memberMemoryDir(memoryHome, memberId) });
  return out;
}

/**
 * 按运行身份给允许集：成员线程（`agent_id = member:<id>`）能读三档；其余只能读 project/team。
 * 这条是「作用域接入运行期」的那一步——调用方只需把 `ctx.agentId` 递进来，不用自己拼集合。
 */
export function scopesForAgent(agentId: string | undefined): string[] {
  return typeof agentId === "string" && agentId.startsWith("member:") ? ["project", "team", "member"] : ["project", "team"];
}
