// v11 主界面批：git 两闸（项目 chip 的"在场景"读数 + 从 Git 仓库克隆）。
// core 层、electron-free；execFile 无 shell（URL 已白名单，参数不经 shell 解释）。
// 口径：一切失败进 ok:false（不抛）——git 缺席、非仓库、detached 分别可辨。
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** 远端 URL 最小白名单：https:// / ssh:// / git@host:path。file:// 与本地路径拒（克隆源必须是远端）。 */
export function isCloneableUrl(url: string): boolean {
  if (url === "" || /\s/.test(url)) return false;
  return /^https:\/\/[^\s]+$/.test(url) || /^ssh:\/\/[^\s]+$/.test(url) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/.test(url);
}

/** URL → 仓库目录名：剥尾斜杠与 .git。认不出合法名 = null（调用方 fail-visible）。 */
export function repoNameFromUrl(url: string): string | null {
  const tail = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  if (tail === "" || /\s/.test(tail)) return null;
  const name = tail.endsWith(".git") ? tail.slice(0, -4) : tail;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}

export type GitStatusResult = { ok: true; branch: string | null; dirtyFiles: number } | { ok: false; error: string };

/** 读工作区 git 在场信息（分支 + 未提交条目数）。
 *  分支用 symbolic-ref（无提交的新仓库也有名）；detached = null（如实，不拿 "HEAD" 冒充）。
 *  非仓库/git 缺席分别可辨；一切失败进 ok:false。 */
export async function gitStatus(workspace: string): Promise<GitStatusResult> {
  let porcelainOut: string;
  try {
    porcelainOut = (await pexec("git", ["-C", workspace, "status", "--porcelain"], { timeout: 10_000 })).stdout;
  } catch (err) {
    const e = err as { code?: string | number; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, error: "未找到 git（检查 PATH）" };
    const stderr = String(e.stderr ?? e.message ?? "").trim();
    if (stderr.includes("not a git repository")) return { ok: false, error: "不是 git 仓库" };
    return { ok: false, error: stderr.split("\n")[0] || "git 命令失败" };
  }
  let branch: string | null = null;
  try {
    const b = (await pexec("git", ["-C", workspace, "symbolic-ref", "--short", "HEAD"], { timeout: 5000 })).stdout.trim();
    branch = b === "" ? null : b;
  } catch {
    branch = null; // detached HEAD 或读不到——如实报 null
  }
  const dirtyFiles = porcelainOut.split("\n").filter((l) => l.trim() !== "").length;
  return { ok: true, branch, dirtyFiles };
}

export type GitCloneResultT = { ok: true; path: string } | { ok: false; error: string };

/** 克隆到 parentDir/<repoName>（全量）。目标已存在即拒（不合并不覆盖）；失败不删半成品（交用户处置）。 */
export async function gitClone(url: string, parentDir: string): Promise<GitCloneResultT> {
  if (!isCloneableUrl(url)) return { ok: false, error: "只支持 https / ssh / git@ 形式的仓库地址" };
  const name = repoNameFromUrl(url);
  if (name === null) return { ok: false, error: "从地址里认不出仓库名" };
  const dest = join(parentDir, name);
  if (existsSync(dest)) return { ok: false, error: `目标已存在：${dest}——换个位置或先移除它` };
  try {
    await pexec("git", ["clone", url, dest], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, path: dest };
  } catch (err) {
    const e = err as { code?: string | number; stderr?: string; message?: string };
    if (e.code === "ENOENT") return { ok: false, error: "未找到 git（检查 PATH）" };
    const stderr = String(e.stderr ?? e.message ?? "").trim();
    return { ok: false, error: stderr.split("\n").slice(-3).join("；") || "克隆失败" };
  }
}
