/** 启动恢复上次会话的判据 + key 编解码。
 *
 *  **为什么要带 workspace**：桌面宿主的会话 id 是分钟级时间戳，两个项目在同一分钟各建一条会话
 *  会得到同一个 id。只存 id、恢复时按 id 找第一条，会把 A 的转录当 B 恢复，后续 run 也落进 A。
 *  所以 key 从 v1 的裸 id 升级为 `{id, workspace}`；旧裸 id 仍可读，但**同名多条时不猜**（直接清）。
 *
 *  跨工作区是允许的：桌面 `listSessions` 逐根扫描全部已注册工作区并带 `workspace` 字段，
 *  `openSession` 会切上下文。旧注释「跨区不恢复」与现态相反。
 *
 *  三条分支：
 *  - 用户已经开了会话（activeId 非空）⇒ skip。不许覆盖用户的选择，也不许把 key 清掉；
 *  - 上次会话按 id + workspace 命中（旧格式且唯一）⇒ restore，调用方走 `openSession(id)`；
 *  - 找不到 / 有歧义 / 项目已移除 ⇒ clear，回主页并清 key。
 */
export interface LastSessionRef {
  id: string;
  /** null = 旧格式（只有 id）。新写入的 key 一律带工作区。 */
  workspace: string | null;
}

export type LastSessionDecision =
  | { kind: "skip" }
  | { kind: "restore"; id: string; workspace: string | null }
  /** 有记录但这次没命中（项目暂不可见/扫描失败/旧格式歧义）：**保留 key**，下次再试。
   *  删掉它是不可逆的；留着一个过期 id 的代价只是下次启动多查一次。 */
  | { kind: "keep" }
  | { kind: "clear" };

export function parseLastSession(raw: string | null): LastSessionRef | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const id = (parsed as { id?: unknown }).id;
      const workspace = (parsed as { workspace?: unknown }).workspace;
      if (typeof id !== "string" || id === "") return null;
      return { id, workspace: typeof workspace === "string" && workspace !== "" ? workspace : null };
    }
  } catch {
    // 看着像对象/数组却不是合法 JSON ⇒ 坏 key，不是「旧格式 id」。
    // v1 的裸 id 是时间戳/会话名，不会以 `{`/`[` 开头；把它当 id 会拿垃圾去开文件。
    const text = raw.trim();
    if (text.startsWith("{") || text.startsWith("[")) return null;
    return text === "" ? null : { id: text, workspace: null };
  }
  return raw.trim() === "" ? null : { id: raw.trim(), workspace: null };
}

export function serializeLastSession(ref: LastSessionRef): string {
  return JSON.stringify({ id: ref.id, workspace: ref.workspace });
}

export function decideLastSessionRestore(opts: {
  last: LastSessionRef | null;
  sessions: readonly { id: string; workspace?: string }[];
  activeId: string | null;
}): LastSessionDecision {
  if (opts.activeId !== null) return { kind: "skip" };
  const last = opts.last;
  if (last === null) return { kind: "clear" };
  if (last.workspace !== null) {
    const hit = opts.sessions.find((s) => s.id === last.id && s.workspace === last.workspace);
    return hit !== undefined
      ? { kind: "restore", id: hit.id, workspace: hit.workspace ?? last.workspace }
      : { kind: "keep" };
  }
  // 旧格式：id 唯一才恢复；同名跨项目时宁可不恢复，也不打开错的那一份。
  const hits = opts.sessions.filter((s) => s.id === last.id);
  if (hits.length === 1) {
    return { kind: "restore", id: hits[0]!.id, workspace: hits[0]!.workspace ?? null };
  }
  return { kind: "keep" };
}
