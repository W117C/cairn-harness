// 会话级 worktree 隔离（规范 §3.7 · 缺口 G4，2026-10-20）。
//
// 蓝本（Claude Code tab）：一条会话可以在自己的 git worktree 里跑，并行会话互不踩主 checkout；
// 做完再合并回去。Cairn 的 worktree 机制此前**只在 worker 层**（`src/agent/worktree.ts`，M3b 写模式），
// 桌面会话层零痕迹 ⇒ 两条会话同时写同一个仓，后写的覆盖先写的。
//
// 本模块只加「会话维度」的三件事，其余全部复用 worktree.ts 的既有原语：
//   ① 命名：`<root>/.agents/wt-s-<sessionId>`，与 worker 的 `wt-<agentId>` 同根不撞名
//   ② 共享：把 `.agent` 链回主 checkout —— 权限表 / 记忆 / 配置 / 会话根必须同源，
//      否则隔离会话会活成一棵「没有权限表、没有记忆、会话根另一个」的孤岛（静默分裂，比不隔离更糟）
//   ③ 找回：按 sessionId 定位那棵树（创建/合并/清理都用它，不靠内存里的表——进程重启后事实只有磁盘）
//
// 路径偏离蓝本默认的 `.agent/worktrees/`：worktree 挪进 `.agents/`（与 worker 同根、同一行 .gitignore）。
// 原因不是口味——`.agent` 会被 symlink 进 worktree，若 worktree 自己住在 `.agent/` 里，
// `<wt>/.agent/worktrees/<sid>` 就指回它自身，任何跟随 symlink 的遍历都会无限自指。
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  WORKTREE_ROOT_DIR,
  commitAndMerge,
  createWorktree,
  currentBranch,
  removeWorktree,
  type MergeOutcome,
} from "../agent/worktree";

/** 会话 worktree 的 agentId 前缀（worker 用裸 agentId，这里加前缀避免两类树互相认领）。 */
const SESSION_PREFIX = "s-";

/** 会话 id 会直接进 git 分支名与目录名：只放行 git 认的字符。
 *  不合规**当场拒**，不静默改名——改名之后下一次按 id 就找不到自己那棵树了。 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export const isSafeWorktreeSessionId = (sessionId: string): boolean => SAFE_ID.test(sessionId);

export const sessionAgentId = (sessionId: string): string => SESSION_PREFIX + sessionId;

/** 隔离工作区绝对路径（可能存在也可能不存在，调用方自己 stat）。 */
export const sessionWorktreePath = (root: string, sessionId: string): string =>
  join(root, WORKTREE_ROOT_DIR, "wt-" + sessionAgentId(sessionId));

/** 这条会话是否已隔离：只看目录在不在。worktree 目录存在 = 这一面的事实（进程重启也认）。 */
export async function isSessionIsolated(root: string, sessionId: string): Promise<boolean> {
  if (!isSafeWorktreeSessionId(sessionId)) return false;
  try {
    return (await lstat(sessionWorktreePath(root, sessionId))).isDirectory();
  } catch {
    return false;
  }
}

/** 已隔离会话清单（目录名反推 id；给渲染层标出哪些行在隔离区里跑）。 */
export async function listIsolatedSessions(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  let names: string[];
  try {
    names = await readdir(join(root, WORKTREE_ROOT_DIR));
  } catch {
    return [];
  }
  const prefix = "wt-" + SESSION_PREFIX;
  return names
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length))
    .sort();
}

export interface SessionWorktreeCreated {
  ok: boolean;
  /** 绝对路径（渲染层要显示，也要能复制）。 */
  path?: string;
  branch?: string;
  /** symlink 降级警告（成功 = 缺省）。不阻断：链不上只是少一份共享，隔离本身已成立。 */
  warnings?: string[];
  error?: string;
}

/** 建隔离工作区：base = 当前 HEAD，分支 `agent/<slug>-s-<sid>`。幂等（残留自愈在 createWorktree 里）。 */
export async function createSessionWorktree(
  root: string,
  sessionId: string,
  title = "session",
): Promise<SessionWorktreeCreated> {
  if (!isSafeWorktreeSessionId(sessionId)) {
    return { ok: false, error: `会话 id 不适合进 git 分支名：${sessionId}` };
  }
  try {
    // 主 checkout 的 `.agent` 必须先存在才链得上；不存在就建（它本来也是首跑就会建的那只目录）。
    await mkdir(join(root, ".agent"), { recursive: true });
    const created = await createWorktree(root, sessionAgentId(sessionId), title, [".agent"]);
    return {
      ok: true,
      path: join(root, created.worktree),
      branch: created.branch,
      ...(created.symlinkWarnings.length > 0 ? { warnings: created.symlinkWarnings } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 合并回主 checkout：系统代为 commit（含未提交改动）→ merge --no-ff；冲突 abort 并交清单，
 *  主 checkout 不留半合并态（这套语义全在 commitAndMerge 里，这里只负责找对树和分支）。 */
export async function mergeSessionWorktree(
  root: string,
  sessionId: string,
): Promise<MergeOutcome & { branch?: string }> {
  if (!(await isSessionIsolated(root, sessionId))) {
    return { ok: false, error: "这条会话没有隔离工作区" };
  }
  const wtPath = sessionWorktreePath(root, sessionId);
  // 分支名带任务 slug，别猜：从这棵树自己读（读不到 = detached/损坏，按失败报，不拿主分支顶上）。
  const branch = await currentBranch(wtPath);
  if (branch === null) return { ok: false, error: "读不到隔离工作区的分支（这个工作区可能已损坏）" };
  const out = await commitAndMerge(root, wtPath, branch, sessionAgentId(sessionId), sessionId);
  return { ...out, branch };
}

/** 丢弃隔离工作区（未提交改动一并消失——调用方必须先确认过）。幂等：本来就没有 = 已经是干净态。 */
export async function discardSessionWorktree(
  root: string,
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isSessionIsolated(root, sessionId))) return { ok: true };
  const branch = await currentBranch(sessionWorktreePath(root, sessionId));
  const r = await removeWorktree(root, sessionAgentId(sessionId), branch === null ? {} : { branch });
  if (!r.removed) return { ok: false, error: r.error ?? "清理失败" };
  return { ok: true };
}
