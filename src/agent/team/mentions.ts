// 群里的 @ 路由（ADR 0015 §五 M4 / 对表里「群 @ 路由」那一格）。
//
// 口径（可判的三条）：
//  ① **名字长者优先**：`@阿岚` 与 `@阿岚的助手` 同时在名单里时，先吃长的（否则短名会截胡）；
//  ② **整名匹配**：`@` 后面必须是完整名字，且名字后面不能紧跟字母/数字/下划线/汉字
//     （否则 `@阿岚二号` 会被误当成 `@阿岚`）；
//  ③ **只认名单里的名字**：认不出的 `@xxx` 进 `unknown`，不猜、不吞。
//
// 本层只做「文本 → 成员 id 列表」；派发与并行批由调用方（群轮次）决定。
export interface MentionMember {
  id: string;
  name: string;
}

export interface MentionParse {
  /** 命中的成员 id（按在文本里出现的先后，去重）。 */
  ids: string[];
  /** 认不出的 @ 片段（去掉 @ 后的原文）。 */
  unknown: string[];
}

const TAIL_FORBIDDEN = /[A-Za-z0-9_\u4e00-\u9fff]/u;

export function parseMemberMentions(text: string, members: readonly MentionMember[]): MentionParse {
  const byName = [...members]
    .filter((m) => m.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length || (a.name < b.name ? -1 : 1));
  const ids: string[] = [];
  const unknown: string[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    const rest = text.slice(at + 1);
    const hit = byName.find((m) => rest.startsWith(m.name) && !TAIL_FORBIDDEN.test(rest.slice(m.name.length, m.name.length + 1)));
    if (hit !== undefined) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
      i = at + 1 + hit.name.length;
      continue;
    }
    // 认不出：吃掉到空白/标点为止的一段，记进 unknown
    const token = /^[^\s，。！？、；：,.!?;:]+/u.exec(rest)?.[0] ?? "";
    if (token !== "") unknown.push(token);
    i = at + 1 + token.length;
  }
  return { ids, unknown };
}
