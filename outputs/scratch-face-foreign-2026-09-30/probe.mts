/** 只读现测：拿本机真的 worktree 清单喂 `staleScratchTrees`，把三格的成因逐棵摊开。
 *  为什么要它：第 231 页那三格在判卷里用假件全绿，而生产端这一趟 `foreign` 是空的——
 *  判据在／生产没观测到＝两头断那一族（规则见 memory「重复调用盲区」）。先量再说修。 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { gitInflightArgs, mainRootFromCommonDir, parseWorktreeList, staleScratchTrees } from "../../scripts/lib/head-cert-deps.ts";

const ROOT = process.cwd();
const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" });
const mainRoot = mainRootFromCommonDir(common, ROOT);
const scratchRoot = join(mainRoot, ".worktrees");
const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
const rows = parseWorktreeList(porcelain);
const TARGET = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

console.log(`cwd=${ROOT}`);
console.log(`mainRoot=${String(mainRoot)}｜scratchRoot=${scratchRoot}｜TARGET=${TARGET.slice(0, 7)}`);
console.log(`parseWorktreeList 抽到 ${String(rows === null ? "null" : rows.length)} 棵（null＝取料坏）`);

for (const r of rows ?? []) {
  const anc = (() => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", r.head, TARGET], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
  })();
  const dirty = (() => {
    try { return execFileSync("git", gitInflightArgs(), { cwd: r.path, encoding: "utf8" }).split("\n").filter((l) => l.trim() !== "").length; }
    catch { return "取不到"; }
  })();
  console.log(`  ${r.detached ? "detached" : "branch  "} dirty=${String(dirty)} ancestor=${String(anc)} ${r.path.startsWith(scratchRoot + "/") ? "在scratch" : "不在scratch"}  ${r.path}@${r.head.slice(0, 7)}`);
}

const res = staleScratchTrees(rows, {
  selfPath: ROOT,
  certTree: resolve(ROOT, ".worktrees/none-such"),
  isAncestor: (sha) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", sha, TARGET], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
  },
  dirtyCountOf: (p) => {
    try { return execFileSync("git", gitInflightArgs(), { cwd: p, encoding: "utf8" }).split("\n").filter((l) => l.trim() !== "").length; }
    catch { return null; }
  },
  scratchRoot,
});
console.log(`stale=${String(res.stale.length)} foreign=${String(res.foreign.length)} unmeasured=${String(res.unmeasured.length)}`);
console.log(`  foreign: ${res.foreign.join("、") || "（空）"}`);
