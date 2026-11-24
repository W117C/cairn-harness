// 「给成员派活」的落点（ADR 0015 §四 第二件的 UI 入口）。
//
// 语义：派活 = 开一条**归属该成员**的会话，第一句就是任务书。
//  · 归属走既有的 `session_meta_update.patch`（键 `member`），不新增事件种类、不新增存储面；
//  · 会话 id 与工作区过既有校验（`sessionIdProblem` / 显式根），不自己拼路径；
//  · **不自动开跑**：派活只负责把活放到那个成员的线程里，按不按发送由人决定——
//    「点一下就跑」要接 run 与审批链，属另一批（这条写在台账里，不装成已完成）。
import { isAbsolute } from "node:path";
import { createEventLog, type AgentEvent } from "../../../../src/events";
import { withMemberSecretEnv, type SecretGrantView } from "../../../../src/agent/team/secrets";
import { memberRunLock, type RunLock } from "./member-run-lock";
import { createSession, pathOf, readSessionEvents, workspaceOfSessionsRoot } from "../../../../src/main/sessions";
import { isPermissionMode, permissionModeRank, type PermissionMode } from "../../../../src/permissions/modes";
import { THINKING_EFFORTS, type ThinkingEffort } from "../../../../src/providers/capabilities";
import { assertRealContainment } from "../../../../src/tools/base";

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

/** 开跑注入面：生产是 main 的 `run` 通道；判卷给假的。 */
export type StartRun = (req: {
  message: string;
  mode: PermissionMode;
  sessionId: string;
  workspace?: string;
  model?: string;
  thinking?: ThinkingEffort;
}) => Promise<{ ok?: boolean; error?: string }>;

export interface MemberRunInput {
  sessionsRoot: string;
  memberId: string;
  task: string;
  mode: PermissionMode;
  maxMode?: PermissionMode;
  model?: string;
  thinking?: string;
  workdir?: string;
  workspace?: string;
}

export type PreparedMemberRun =
  | { ok: true; mode: PermissionMode; workspace?: string; model?: string; thinking?: ThinkingEffort }
  | { ok: false; error: string };

export async function prepareMemberRun(input: MemberRunInput): Promise<PreparedMemberRun> {
  if (!isPermissionMode(input.mode)) return { ok: false, error: "成员权限档位非法" };
  if (input.maxMode !== undefined && !isPermissionMode(input.maxMode)) {
    return { ok: false, error: "全局权限上限非法" };
  }
  if (input.model !== undefined && input.model.trim() === "") {
    return { ok: false, error: "成员 model 不能为空" };
  }
  if (input.thinking !== undefined && !(THINKING_EFFORTS as readonly string[]).includes(input.thinking)) {
    return { ok: false, error: `成员 thinking 非法: ${input.thinking}` };
  }
  const mode = input.maxMode !== undefined && permissionModeRank(input.mode) > permissionModeRank(input.maxMode)
    ? input.maxMode
    : input.mode;
  let workspace = input.workspace;
  if (input.workdir !== undefined) {
    if (!isAbsolute(input.workdir)) return { ok: false, error: "成员工作目录必须是绝对路径" };
    const boundary = input.workspace ?? workspaceOfSessionsRoot(input.sessionsRoot);
    if (boundary === null || boundary === undefined) {
      return { ok: false, error: "成员工作目录缺少可校验的 workspace 边界" };
    }
    try {
      workspace = await assertRealContainment(boundary, input.workdir, "成员工作目录");
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    ok: true,
    mode,
    ...(workspace === undefined ? {} : { workspace }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking as ThinkingEffort }),
  };
}

/** 生产用的依赖包（把「建会话/追加/路径/开跑」四件真东西一次给齐，调用点不再各自 import）。 */
export function defaultStartDeps(run: StartRun): {
  createSession: (root: string) => Promise<string>;
  append: (path: string, event: AgentEvent) => Promise<void>;
  pathOf: (root: string, id: string) => string;
  run: StartRun;
} {
  return {
    createSession: (root) => createSession(root),
    append: (path, event) => createEventLog(path).append(event),
    pathOf,
    run,
  };
}

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

/**
 * 派活并开跑：建归属会话（**只写归属，不写任务书**）→ 交给 run 通道写第一句并开跑。
 * 为什么任务书交给 run：同一条任务只许有一条写入路径；这里再写一遍就会在会话里出现两条
 * 一模一样的 user_message（一条是派活写的、一条是 run 写的）。
 */
export async function startToMember(
  input: MemberRunInput,
  deps: {
    createSession: (root: string) => Promise<string>;
    append: (path: string, event: AgentEvent) => Promise<void>;
    pathOf: (root: string, id: string) => string;
    run: StartRun;
  },
): Promise<DispatchResult> {
  const task = input.task.trim();
  if (task === "") return { ok: false, error: "派活内容不能为空" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.memberId)) {
    return { ok: false, error: `成员 id 只收字母/数字/下划线/连字符（1-64 位），收到 ${JSON.stringify(input.memberId)}` };
  }
  const prepared = await prepareMemberRun(input);
  if (!prepared.ok) return prepared;
  let sessionId: string;
  try {
    sessionId = await deps.createSession(input.sessionsRoot);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const path = deps.pathOf(input.sessionsRoot, sessionId);
  await deps.append(path, { type: "session_meta_update", patch: { [MEMBER_SESSION_KEY]: input.memberId } } as AgentEvent);
  const started = await deps.run({
    message: task,
    mode: prepared.mode,
    sessionId,
    ...(prepared.workspace === undefined ? {} : { workspace: prepared.workspace }),
    ...(prepared.model === undefined ? {} : { model: prepared.model }),
    ...(prepared.thinking === undefined ? {} : { thinking: prepared.thinking }),
  });
  if (started.ok === false) return { ok: false, error: started.error ?? "开跑失败" };
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

export interface StartDepsWithSecrets {
  createSession: (root: string) => Promise<string>;
  append: (path: string, event: AgentEvent) => Promise<void>;
  pathOf: (root: string, id: string) => string;
  run: StartRun;
  /** 团队密钥授权的投影（默认拒：没 allow 就一个键都不注入）。 */
  grants: SecretGrantView;
  /** 注入目标 / 取值源（判卷时可替换；生产就是 process.env）。 */
  envTarget?: Record<string, string | undefined>;
  envSource?: Record<string, string | undefined>;
  /** 串行闸（默认进程内唯一那把）：一次只跑一个成员，注入窗口不重叠。 */
  lock?: RunLock;
}

export interface StartWithSecretsResult extends DispatchResult {
  /** 这次 run 注入了几个键（只报个数，不报名字与值）。 */
  injected?: number;
  missingSecrets?: string[];
  deniedSecrets?: string[];
  /** 排队等了多久（毫秒）——串行闸不静默拖慢。 */
  waitedMs?: number;
}

/**
 * 起跑 + 密钥注入：**进 run 前写、run 收束后一定撤**，回包只报个数与缺失/被拒的名字。
 * 「密钥卡片」的第四跳就接在这里——`teamMemberStart` 只调它，不自己拼 env。
 */
export async function startMemberWithSecrets(
  input: MemberRunInput,
  deps: StartDepsWithSecrets,
): Promise<StartWithSecretsResult> {
  const target = deps.envTarget ?? process.env;
  const source = deps.envSource ?? process.env;
  const lock = deps.lock ?? memberRunLock;
  // 串行闸：注入写的是进程环境，两个成员同时跑会互相看见对方的键（权限隔离破了）。
  const locked = await lock.run(async () => {
    const wrapped = await withMemberSecretEnv(deps.grants, input.memberId, async (env) => {
      const result = await startToMember(input, deps);
      return {
        ...result,
        injected: Object.keys(env.env).length,
        missingSecrets: env.missing,
        deniedSecrets: env.denied,
      };
    }, target, source);
    return wrapped.result;
  }, input.memberId);
  return { ...locked.result, waitedMs: locked.waitedMs };
}
