// M3b write mode：worktree 全生命周期（agent-plan §4.4.5 / §4.4.9 / §4.3 合并控制塔）。
// spawn 批准 → git worktree add .agents/wt-<agent_id> -b agent/<slug>-<id>（base_commit 记录）
// → symlink gitignored 目录（node_modules）防重复安装（fail-visible：失败降级为警告，不阻断）
// → worker 文件工具 cwd 锁定本 worktree（worktree 对 worker 完全可写）
// → done → diff（vs base_commit，含未提交改动：git add -N . && git diff <base> 口径）
// → git 面板批准 → 系统代为 commit（message 标注 agent_id）→ merge --no-ff → 清理 worktree。
// 铁律：合并唯一出口 = git 面板，agent 无合并权（§4.3）——本模块只被编排器/主进程控制塔调用，
// 从不暴露给任何 worker 工具表；worker shell 的写向 git 子命令在 orchestrator.shell_rw 静态拦截。
import { execFile, spawn } from "node:child_process";
import { readdir, rm, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sanitizedEnv } from "../tools/process.js";
import { createChunkText, headWithinBytes } from "../tools/output-ring.js";

const exec = promisify(execFile);

/** worktree 根目录名（主 checkout 根相对；.gitignore 已收录 .agents/）。 */
export const WORKTREE_ROOT_DIR = ".agents";

/** gitignored 目录名单：worktree 内 symlink 回主 checkout，避免每 worktree 重复安装（§4.5）。 */
export const WORKTREE_SYMLINK_DIRS: readonly string[] = ["node_modules"];

/** spawn(mode=write) 拒绝原因：主 checkout 不是 git 仓库（fail-visible）。 */
export class WorktreeError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr = "") {
    super(message);
    this.name = "WorktreeError";
    this.stderr = stderr;
  }
}

interface GitRun {
  stdout: string;
  stderr: string;
  code: number;
}

/** git 子进程（spawn 捕获 stdout/stderr/exit code）：不依赖 promisify(execFile) 拒绝错误携带 stderr
 *  （坑五十五：DSH Electron-as-node v24 的 execFile 拒绝错误 stderr 为空——merge 冲突信息会整体丢失）。 */
function gitRun(cwd: string, args: string[]): Promise<GitRun> {
  return new Promise((settle) => {
    // D1（审查 P1-9）：env 消毒——git 会在工作区仓库执行 .git/hooks/*，不消毒等于把
    // process.env.M0_API_KEY（BYOK 明文）交给克隆来的任意 hook 脚本。
    const child = spawn("git", args, { cwd, env: sanitizedEnv() });
    // A7（审查）：输出累积设字节上限——worktreeDiff 大变更集可产出数百 MB 全驻内存；超限杀进程。
    const OUTPUT_CAP_BYTES = 32 * 1024 * 1024;
    let bytes = 0;
    // #55：逐块 `String(d)` 会把跨块的多字节字符各变成一个 U+FFFD——实测一份 1.29MB 中文 git diff 有 32 处，
    // 同一条命令一次解码到底 0 处。补丁正文是给模型读的证据，不能让解码器先改写字节。
    const outText = createChunkText();
    const errText = createChunkText();
    child.stdout?.on("data", (d: Buffer) => {
      bytes += d.length;
      outText.push(d);
      if (bytes > OUTPUT_CAP_BYTES) child.kill("SIGKILL");
    });
    child.stderr?.on("data", (d: Buffer) => {
      errText.push(d);
    });
    child.on("error", (e: Error) => settle({ stdout: "", stderr: String(e), code: 127 }));
    child.on("close", (code) => {
      if (bytes > OUTPUT_CAP_BYTES) {
        // 帽按字节判、也要按字节切：原先 `stdout.slice(0, OUTPUT_CAP_BYTES)` 切的是 UTF-16 字符
        // ⇒ 中文正文最多能交出 3 倍（96MB）却自称"超 32MB 上限"。缝合处由原语按码位回退。
        settle({ stdout: headWithinBytes(outText.text(), OUTPUT_CAP_BYTES), stderr: errText.text() + "\n[truncated: git 输出超 32MB 上限，已截断]", code: code ?? 1 });
        return;
      }
      settle({ stdout: outText.text(), stderr: errText.text(), code: code ?? 1 });
    });
  });
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await gitRun(cwd, args);
  if (r.code !== 0) {
    throw new WorktreeError(
      "git " + args.join(" ") + " 失败：" + (r.stderr.trim() || r.stdout.trim() || "exit " + String(r.code)).slice(0, 400),
      r.stderr,
    );
  }
  return r.stdout;
}

/** task → 分支 slug（分支名安全字符集；空 slug 落 "task"）。 */
export function taskSlug(task: string): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return s === "" ? "task" : s;
}

/** agent 分支名（与投影侧共用同一推导，事件契约只存 worktree/base_commit）。 */
export function branchForAgent(task: string, agentId: string): string {
  return "agent/" + taskSlug(task) + "-" + agentId;
}

export function worktreePathFor(root: string, agentId: string): string {
  return join(root, WORKTREE_ROOT_DIR, "wt-" + agentId);
}

export interface CreatedWorktree {
  /** 主 checkout 根相对路径（.agents/wt-<agent_id>）。 */
  worktree: string;
  branch: string;
  baseCommit: string;
  /** symlink 降级警告（成功 = 空数组）。 */
  symlinkWarnings: string[];
}

/** spawn 批准后的 worktree 创建：base = 当前 HEAD → worktree add -b → symlink gitignored 目录。
 *  幂等加固：同路径残留（同 id 撞车/上次清理失败）先清 git 注册与目录再建；分支已存在则挂载而非重建。 */
export async function createWorktree(root: string, agentId: string, task: string): Promise<CreatedWorktree> {
  const baseCommit = (await git(root, "rev-parse", "HEAD")).trim();
  const branch = branchForAgent(task, agentId);
  const rel = join(WORKTREE_ROOT_DIR, "wt-" + agentId);
  // 残留自愈（fail-visible 于 add 失败）：先清 git 注册（ignore 失败）再清目录
  await git(root, "worktree", "remove", "--force", rel).catch(() => {});
  await rm(worktreePathFor(root, agentId), { recursive: true, force: true });
  // 分支已存在（同 agent 重启语义）→ 挂载既有分支；否则 -b 新建
  const branchExists = await git(root, "rev-parse", "--verify", "--quiet", branch).then(() => true, () => false);
  if (branchExists) await git(root, "worktree", "add", rel, branch);
  else await git(root, "worktree", "add", rel, "-b", branch);
  const symlinkWarnings = await linkGitignoredDirs(root, worktreePathFor(root, agentId));
  await ensureGitignoreAgents(root);
  return { worktree: rel, branch, baseCommit, symlinkWarnings };
}

/** symlink gitignored 目录（node_modules 等）：主 checkout 存在才链；失败降级为警告不阻断（fail-visible）。 */
export async function linkGitignoredDirs(root: string, wtPath: string): Promise<string[]> {
  const warnings: string[] = [];
  for (const name of WORKTREE_SYMLINK_DIRS) {
    const src = join(root, name);
    const dst = join(wtPath, name);
    try {
      await lstat(src);
    } catch {
      continue; // 主 checkout 没有该目录（如尚未安装依赖）→ 静默跳过
    }
    try {
      await lstat(dst);
      warnings.push("worktree 内已存在 " + name + "，跳过 symlink");
      continue;
    } catch {
      /* 目标不存在 = 期望路径 */
    }
    try {
      await symlink(src, dst, "dir");
    } catch (err) {
      warnings.push("symlink " + name + " 失败（降级为不链，不阻断）：" + (err instanceof Error ? err.message : String(err)));
    }
  }
  return warnings;
}

/** 确保 .gitignore 含 .agents/（用户工作区运行时自愈；本仓库自己的 .gitignore 已显式提交该行）。 */
async function ensureGitignoreAgents(root: string): Promise<void> {
  try {
    const r = await exec("git", ["check-ignore", "-q", WORKTREE_ROOT_DIR], { cwd: root }).catch(() => null);
    if (r !== null) return; // 已被忽略（本仓库提交的 .agents/ 行或用户自配）
    const { readFile, writeFile, appendFile } = await import("node:fs/promises");
    const p = join(root, ".gitignore");
    let text = "";
    try {
      text = await readFile(p, "utf8");
    } catch {
      /* 无 .gitignore */
    }
    if (text.split("\n").some((l) => l.trim() === WORKTREE_ROOT_DIR)) {
      await writeFile(p, text, "utf8");
      return;
    }
    await appendFile(p, (text.endsWith("\n") || text === "" ? "" : "\n") + ".agents/\n", "utf8");
  } catch {
    /* 自愈失败不阻断（worktree 已建成功；git status 噪音属可见失败面） */
  }
}

/** worker 产出 diff（裁决 3 口径：worktree 工作树 vs base_commit，含未提交改动）。
 *  先 `git add -N .`（intent-to-add 让未跟踪文件进 diff），再 `git diff <base>`。 */
export async function worktreeDiff(wtPath: string, baseCommit: string): Promise<{ stat: string; patch: string; files: string[] }> {
  await git(wtPath, "add", "-N", ".").catch(() => {}); // 无改动时 add -N 也可能非零：吞掉，diff 兜底
  // symlink 目录（node_modules 等）是安装共享面不是产出：diff 一律排除
  const excludes = WORKTREE_SYMLINK_DIRS.map((d) => ":(exclude)" + d);
  const stat = (await git(wtPath, "diff", baseCommit, "--stat", ".", ...excludes)).trim();
  const patch = (await git(wtPath, "diff", baseCommit, ".", ...excludes)).trimEnd();
  const files =
    stat === ""
      ? []
      : stat
          .split("\n")
          .filter((l) => l.includes("|"))
          .map((l) => l.trim().split(/\s+\|/)[0]!.replace(/"/g, ""));
  return { stat, patch, files };
}

export interface MergeOutcome {
  ok: boolean;
  mergeCommit?: string;
  conflict?: boolean;
  conflictedFiles?: string[];
  error?: string;
}

/** 合并控制塔唯一写主分支通道（§4.3）：系统代为 commit（message 标注 agent_id，author 沿仓库配置）
 *  → merge --no-ff。冲突 → abort 恢复主 checkout 干净态 + 冲突清单（人工介入，不自动解）。 */
export async function commitAndMerge(
  root: string,
  wtPath: string,
  branch: string,
  agentId: string,
  task: string,
): Promise<MergeOutcome> {
  const dirty = (await git(wtPath, "status", "--porcelain")).trim();
  if (dirty !== "") {
    await git(wtPath, "add", "-A");
    await git(wtPath, "commit", "-m", "M3b(agent " + agentId + "): " + taskSlug(task) + "\n\nAgent-Id: " + agentId);
  }
  try {
    await git(root, "merge", "--no-ff", branch, "-m", "Merge branch '" + branch + "' (agent " + agentId + ")");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 冲突清单以 git 的权威输出为准（`--diff-filter=U` = 未合并项），且必须在 merge --abort 之前取
    // （abort 会清掉冲突状态）。旧实现从 git 文案 `CONFLICT (content): Merge conflict in <path>` 里
    // 取第一个空白分词 → 恒得 "Merge"，用户看到的是假清单（测试只断言 length > 0，故漏过）。
    const unmerged = (await git(root, "diff", "--name-only", "--diff-filter=U").catch(() => "")).trim();
    const conflicted = unmerged.split("\n").map((s) => s.trim()).filter((s) => s !== "");
    if (conflicted.length > 0) {
      await git(root, "merge", "--abort").catch(() => {}); // 恢复主 checkout 干净态（人工介入前零半合并态）
      return { ok: false, conflict: true, conflictedFiles: [...new Set(conflicted)], error: "合并冲突（人工介入，主 checkout 已恢复干净态）" };
    }
    // 兜底：diff 无 U 项但文案含 CONFLICT（如 modify/delete 类）——按「Merge conflict in <path>」取路径，
    // 并显式滤掉旧实现那个恒真的 "Merge" 伪路径。
    const fromText = [...msg.matchAll(/CONFLICT \([^)]*\):\s*(?:Merge conflict in\s+)?(\S+)/g)]
      .map((m) => m[1]!)
      .filter((f) => f !== "Merge");
    if (fromText.length > 0) {
      await git(root, "merge", "--abort").catch(() => {});
      return { ok: false, conflict: true, conflictedFiles: [...new Set(fromText)], error: "合并冲突（人工介入，主 checkout 已恢复干净态）" };
    }
    return { ok: false, error: msg.slice(0, 400) };
  }
  const mergeCommit = (await git(root, "rev-parse", "HEAD")).trim();
  return { ok: true, mergeCommit };
}

export interface WorktreeCleanupResult {
  removed: boolean;
  branchDeleted: boolean;
  error?: string;
}

/** 清理 worktree（+可选删分支）。分支删除失败不掩盖 worktree 清理结果（分别可见）。 */
export async function removeWorktree(root: string, agentId: string, opts: { keepBranch?: boolean; branch?: string } = {}): Promise<WorktreeCleanupResult> {
  const rel = join(WORKTREE_ROOT_DIR, "wt-" + agentId);
  let removed = false;
  let error: string | undefined;
  try {
    await git(root, "worktree", "remove", "--force", rel);
    removed = true;
  } catch (err) {
    // git 不认的残留（目录还在但 worktree 元数据已丢）→ 物理删除兜底（fail-visible）
    try {
      await rm(worktreePathFor(root, agentId), { recursive: true, force: true });
      await git(root, "worktree", "prune").catch(() => {});
      removed = true;
    } catch (err2) {
      error = (err instanceof Error ? err.message : String(err)) + " / " + (err2 instanceof Error ? err2.message : String(err2));
    }
  }
  let branchDeleted = false;
  if (removed && !opts.keepBranch && opts.branch) {
    try {
      await git(root, "branch", "-D", opts.branch);
      branchDeleted = true;
    } catch {
      branchDeleted = false; // 分支删除失败不阻断（worktree 已清，分支可手动删）
    }
  }
  return { removed, branchDeleted, ...(error ? { error } : {}) };
}

/** 扫描 worktree 目录（孤儿扫描的目录侧输入）。 */
export async function listWorktreeDirs(root: string): Promise<string[]> {
  const dir = join(root, WORKTREE_ROOT_DIR);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith("wt-")).sort();
}

/** 孤儿 worktree（§4.4.9）：目录存在、但事件流里该 agent 无终态（done/failed/cancelled 的 agent_status）
 *  **且** 无合并控制塔收尾记录（merge/cleanup tool_result）——进程被杀遗留，列「可清理」，不自动删。 */
export function orphanWorktrees(dirNames: string[], events: { type: string; agent_id?: string; status?: string; callId?: string }[]): string[] {
  const terminalAgents = new Set<string>();
  for (const e of events) {
    if (e.type === "agent_status" && (e.status === "done" || e.status === "failed" || e.status === "cancelled") && typeof e.agent_id === "string") {
      terminalAgents.add(e.agent_id);
    }
    if (e.type === "tool_result" && typeof e.callId === "string" && (e.callId.startsWith("merge-") || e.callId.startsWith("wt-cleanup-"))) {
      terminalAgents.add(e.callId.replace(/^(merge|wt-cleanup)-/, ""));
    }
  }
  return dirNames
    .map((n) => n.slice("wt-".length))
    .filter((agentId) => !terminalAgents.has(agentId));
}

/** 孤儿手动清理（§4.4.9：面板只列不自动删，清理 = 用户显式动作）：移除 worktree + 按后缀删 agent/*-<id> 分支。
 *  A6（审查）：agentId 先过字符白名单——目录名含 glob 元字符（[ ? *）拼进 `branch --list`
 *  会匹配全部 agent 分支并循环删除；列出的分支名还须**精确以后缀 -<id> 结尾**才删（双保险）。 */
export async function cleanOrphanWorktree(root: string, agentId: string): Promise<WorktreeCleanupResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {
    return { removed: false, branchDeleted: false, error: "agentId 含非法字符（只允许 [A-Za-z0-9_-]），已拒绝清理" };
  }
  const r = await removeWorktree(root, agentId);
  if (r.removed) {
    try {
      const out = await exec("git", ["branch", "--list", "agent/*-" + agentId], { cwd: root, maxBuffer: 1024 * 1024 });
      for (const line of out.stdout.split("\n")) {
        const name = line.replace(/^\*?\s*/, "").trim();
        if (name !== "" && name.endsWith("-" + agentId)) await git(root, "branch", "-D", name).catch(() => {});
      }
    } catch {
      /* 分支清点失败不掩盖 worktree 清理结果 */
    }
  }
  return r;
}
