// 「给成员派活」的落点（ADR 0015 §四 第二件的 UI 入口）。
//
// 语义：派活 = 开一条**归属该成员**的会话，第一句就是任务书。
//  · 归属走既有的 `session_meta_update.patch`（键 `member`），不新增事件种类、不新增存储面；
//  · 会话 id 与工作区过既有校验（`sessionIdProblem` / 显式根），不自己拼路径；
//  · **不自动开跑**：派活只负责把活放到那个成员的线程里，按不按发送由人决定——
//    「点一下就跑」要接 run 与审批链，属另一批（这条写在台账里，不装成已完成）。
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { createSession, pathOf, readSessionEvents } from "../../../../src/main/sessions";

/** 会话元数据里记成员归属的键（与 `session_meta_update.patch` 的自由键通道同形）。 */
export const MEMBER_SESSION_KEY = "member";

export interface DispatchDeps {
  createSession: (root: string) => Promise<string>;
  append: (path: string, event: AgentEvent) => Promise<void>;
  pathOf: (root: string, id: string) => string;
}

export const defaultDispatchDeps: DispatchDeps = {
  createSession: (root) => createSession(root),
  append: (path, event) => createEventLog(path).append(event),
  pathOf,
};

export interface DispatchResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

/**
 * 开一条成员会话：
 *  ① 建会话（独占创建，重名自动加序号）；
 *  ② 先写归属补丁（`member=<id>`）——**先归属再说话**，否则第一条 user_message 会被当成
 *     「没有主的会话」；
 *  ③ 再写任务书（`user_message`），内容就是派活时填的那句。
 */
export async function dispatchToMember(
  input: { sessionsRoot: string; memberId: string; task: string },
  deps: DispatchDeps = defaultDispatchDeps,
): Promise<DispatchResult> {
  const task = input.task.trim();
  if (task === "") return { ok: false, error: "派活内容不能为空" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.memberId)) {
    return { ok: false, error: `成员 id 只收字母/数字/下划线/连字符（1-64 位），收到 ${JSON.stringify(input.memberId)}` };
  }
  let sessionId: string;
  try {
    sessionId = await deps.createSession(input.sessionsRoot);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const path = deps.pathOf(input.sessionsRoot, sessionId);
  await deps.append(path, { type: "session_meta_update", patch: { [MEMBER_SESSION_KEY]: input.memberId } } as AgentEvent);
  await deps.append(path, { type: "user_message", content: task } as AgentEvent);
  return { ok: true, sessionId };
}

/** 读会话归属（给面板/判卷用；没有归属返回 null）。 */
export async function memberOfSession(sessionsRoot: string, sessionId: string): Promise<string | null> {
  const events = await readSessionEvents(sessionsRoot, sessionId).catch(() => [] as AgentEvent[]);
  let member: string | null = null;
  for (const event of events) {
    if (event.type !== "session_meta_update") continue;
    const raw = (event.patch as Record<string, string>)[MEMBER_SESSION_KEY];
    if (typeof raw === "string" && raw !== "") member = raw;
  }
  return member;
}
