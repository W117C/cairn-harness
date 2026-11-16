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
