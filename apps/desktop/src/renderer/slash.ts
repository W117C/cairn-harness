// 斜杠菜单条目合成（2026-10-18）：内置两条 + 当前工作区的 loose skills（技能中心同一份快照）。
// 只负责「列表长什么样」：去重（技能与内置同名不双列）、非 trusted 带 trust 字段（§9.8 未信任不激活，
// 菜单据此在行尾渲染「待批准 / 已拒绝」chip——不拼进描述，截断也看得见）、空描述回落「技能」。
export interface SlashSkill {
  invoke: string;
  description: string;
  trust: string;
}

export interface SlashItem {
  invoke: string;
  desc: string;
  /** 信任态（内置两条没有）：非 trusted 由菜单渲染「待批准 / 已拒绝」chip。
   *  2026-10-24 起不再把「（待批准）」拼进描述——描述改单行截断后，拼在末尾的标记会被
   *  省略号吃掉，等于菜单不再如实告知（§9.8）。 */
  trust?: string;
}

export function slashItems(base: readonly SlashItem[], skills: readonly SlashSkill[]): SlashItem[] {
  const out: SlashItem[] = [...base];
  const seen = new Set(out.map((b) => b.invoke));
  for (const s of skills) {
    const name = s.invoke.trim().replace(/^\/+/, "");
    if (name === "") continue;
    const invoke = `/${name}`;
    if (seen.has(invoke)) continue;
    seen.add(invoke);
    const desc = s.description.trim() === "" ? "技能" : s.description.trim();
    out.push({ invoke, desc, trust: s.trust });
  }
  return out;
}

/** 斜杠过滤（2026-10-24）：先比完整调用名，容器插件的 `/plugin:skill` 再比冒号后的短名。
 *  理由：菜单里看得见的是 `opencli-browser`，用户不会先打 `claude-user:` 前缀；
 *  只按完整名 startsWith 会让「/opencli-b」零命中——列表里明明有这条。
 *  短名用 includes（「sitemap」也能找到 `opencli-browser-sitemap`），完整名仍用 startsWith
 *  （避免「user」这类片段把整个 claude-user 插件都捞出来）。 */
export function slashMatches(invoke: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const full = invoke.trim().replace(/^\/+/, "").toLowerCase();
  if (full.startsWith(q)) return true;
  const at = full.lastIndexOf(":");
  if (at < 0) return false;
  return full.slice(at + 1).includes(q);
}
