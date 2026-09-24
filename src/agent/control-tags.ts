/** 仿冒控制标签与角色行的中和（§4.4.4 同款：`<system-reminder>` 类 + 行首 Human:/Assistant:/System:）。
 *
 *  为什么单独一支模块、不留在 `memory/inject.ts`：这条政策要守的是**所有**把外界文本送进模型的出口，
 *  而投影层（`agent/context.ts`）不该为了拿一个纯文本函数去依赖记忆子系统（含 fs/homedir，
 *  测试里还要整支打桩）。搬过来之后四个消费者共用这一份实现。
 *
 *  memory 必须在名单内：renderBlock 用 `<memory source="…">…</memory>` 包裹记忆块，
 *  恶意仓库的 `.agent/memory/*.md` 只要写一行 `</memory>` 就能提前闭合数据块，让后续文本
 *  落到块外冒充系统指令，且随记忆注入**跨会话持久**（M0 复盘 E-3）。
 *  注意：本函数只作用于各 section 的正文，包裹标签由 renderBlock 之后拼接，不会被误转义。
 */
const CONTROL_TAG = /<\/?\s*(?:system(?:-reminder)?|instructions?|context|goal|task|harness|memory|tool_result|thinking)\b[^>]*>/gi;
const ROLE_LINE = /^(\s*)(Human|Assistant|System)\s*:/gm;

export function escapeControlTags(text: string): string {
  return text
    .replace(CONTROL_TAG, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .replace(ROLE_LINE, (_m, indent: string, role: string) => indent + "[harness] " + role + ":");
}
