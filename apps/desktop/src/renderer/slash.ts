// 斜杠菜单条目合成（2026-10-18）：内置两条 + 当前工作区的 loose skills（技能中心同一份快照）。
// 只负责「列表长什么样」：去重（技能与内置同名不双列）、非 trusted 标「待批准」（§9.8 未信任不激活，
// 菜单如实告知，不摆一个点了没反应的调用名）、空描述回落「技能」。
export interface SlashSkill {
  invoke: string;
  description: string;
  trust: string;
}

export interface SlashItem {
  invoke: string;
  desc: string;
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
    out.push({ invoke, desc: s.trust === "trusted" ? desc : `${desc}（待批准）` });
  }
  return out;
}
