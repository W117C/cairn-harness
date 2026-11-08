// 父日志依赖扫描（指针接入 Task 3）：分叉是**指针**，父日志改名/删除会让子会话留成断链。
// 第一版不引入数据库：扫描同一会话根里每个 JSONL 的首行 fork 元信息，按真实路径建边，再传递闭包。
// 读失败**抛错**——把「读不动」当成「没有依赖」，等于把断链放行。
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { replay, type SessionRef } from "../events";
import { listSessionIds } from "./sessions";

interface Node { id: string; path: string }

/** 同一会话根内，依赖 `targetId` 的会话（直接 + 传递），稳定按 id 升序返回。 */
export async function dependentSessionsInRoot(
  root: string, workspace: string, targetId: string,
): Promise<SessionRef[]> {
  const ids = await listSessionIds(root);
  if (!ids.includes(targetId)) throw new Error(`会话不存在：${targetId}`);
  const targetPath = await realpath(join(root, targetId + ".jsonl"));
  const edges = new Map<string, Node[]>();
  for (const id of ids) {
    if (id === targetId) continue;
    let raw;
    try {
      raw = await replay(join(root, id + ".jsonl"));
    } catch (error) {
      throw new Error(`依赖扫描失败：读不动 ${id}（${error instanceof Error ? error.message : String(error)}）`);
    }
    const head = raw[0];
    const fork = head?.type === "session_meta" ? head.fork : undefined;
    if (fork === undefined) continue;
    const parent = await realpath(fork.from_session_path).catch(() => resolve(fork.from_session_path));
    const childPath = await realpath(join(root, id + ".jsonl")).catch(() => join(root, id + ".jsonl"));
    const list = edges.get(parent);
    if (list === undefined) edges.set(parent, [{ id, path: childPath }]);
    else list.push({ id, path: childPath });
  }
  const out = new Set<string>();
  const seen = new Set<string>([targetPath]);
  const queue = [targetPath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of edges.get(current) ?? []) {
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      out.add(child.id);
      queue.push(child.path);
    }
  }
  return [...out].sort().map((sessionId) => ({ workspace, sessionId }));
}

/** 按来源引用扫描；`sessionsRoot` 缺省 = 该工作区的 `<ws>/.agent/sessions`。 */
export async function dependentSessions(session: SessionRef, sessionsRoot?: string): Promise<SessionRef[]> {
  const root = sessionsRoot ?? join(session.workspace, ".agent", "sessions");
  return dependentSessionsInRoot(root, session.workspace, session.sessionId);
}

/** 破坏性 mutation 前的统一闸：有依赖就拒绝，并列出子会话。 */
export async function assertNoDependents(session: SessionRef, sessionsRoot?: string): Promise<void> {
  const deps = await dependentSessions(session, sessionsRoot);
  if (deps.length > 0) {
    throw new Error(
      `会话被指针分叉依赖，拒绝破坏性操作：${session.sessionId} ← ${deps.map((d) => d.sessionId).join("、")}` +
      "（先处理叶子会话，不提供隐式级联）",
    );
  }
}
