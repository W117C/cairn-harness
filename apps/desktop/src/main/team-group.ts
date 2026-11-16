// 团队会话（群）的落点：**就是一个会话文件**，用补丁键标记「这是群」。
//
// 为什么不用新事件种类、也不改 `session_meta.kind`：
//  · 事件种类封闭（ADR 0005）——群不是「日志结构控制记录」，它是会话的一种用法；
//  · `kind` 是给 sidechat 这类**另一种日志形态**用的；群与会话同形，只多一个标记。
// 所以：`session_meta_update.patch` 里写 `group="1"`（可选 `group_name`），读侧按补丁判定。
//
// 边界：这一版只做「建群 + 标记 + 反查」。共享流就是该会话自己的事件流（读侧用既有会话日志）；
// 轮次仲裁（谁先说）**还没接**——那要把编排引擎的 roundArbiter 接到群会话上，属下一批。
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { createSession, pathOf, readSessionEvents } from "../../../../src/main/sessions";

export const GROUP_KEY = "group";
export const GROUP_NAME_KEY = "group_name";

export interface GroupDeps {
  createSession: (root: string, name?: string) => Promise<string>;
  append: (path: string, event: AgentEvent) => Promise<void>;
  pathOf: (root: string, id: string) => string;
}

export const defaultGroupDeps: GroupDeps = {
  createSession: (root, name) => createSession(root, name),
  append: (path, event) => createEventLog(path).append(event),
  pathOf,
};

export interface GroupResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

/** 建一条团队会话：会话文件 + `group=1` 补丁（名字可选，落在 `group_name`）。 */
export async function createTeamGroup(
  input: { sessionsRoot: string; name?: string },
  deps: GroupDeps = defaultGroupDeps,
): Promise<GroupResult> {
  const name = input.name?.trim() ?? "";
  let sessionId: string;
  try {
    sessionId = await deps.createSession(input.sessionsRoot, name === "" ? undefined : name);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const patch: Record<string, string> = { [GROUP_KEY]: "1" };
  if (name !== "") patch[GROUP_NAME_KEY] = name;
  try {
    await deps.append(deps.pathOf(input.sessionsRoot, sessionId), { type: "session_meta_update", patch } as AgentEvent);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, sessionId };
}

/** 反查：这条会话是不是群？返回群名（没取名返回空串），不是群返回 null。 */
export async function groupOfSession(sessionsRoot: string, sessionId: string): Promise<{ name: string } | null> {
  const events = await readSessionEvents(sessionsRoot, sessionId).catch(() => [] as AgentEvent[]);
  let isGroup = false;
  let name = "";
  for (const event of events) {
    if (event.type !== "session_meta_update") continue;
    const patch = event.patch as Record<string, string>;
    if (patch[GROUP_KEY] === "1") isGroup = true;
    if (typeof patch[GROUP_NAME_KEY] === "string") name = patch[GROUP_NAME_KEY];
  }
  return isGroup ? { name } : null;
}
