// 残留树判定的现读探针（契约 A2）：逐棵跑本仓自己的 `staleScratchTrees` 判据，不另写一份"哪些能回收"。
// 判据本体在 `scripts/lib/head-cert-deps.ts`；这里只喂它 git 的取料面，四格读数是它的输出，不是我重抄的。
// 取料面刻意走 `--git-common-dir`（与判卷 `tests/head-cert-deps.test.ts` 同一个口径），
// 而不是拿"我脚下这棵树"当根——否则从 linked 树里跑会把那棵树本身报成主树。
// 口径：常驻残留 = detached ∧ 0 项在飞 ∧ 已是 HEAD 祖先 ∧ 住本仓 scratch 面（`stale`）；
//       第五条出头的（住外面）进 `foreign`：照报不误，但**不配那句"可以去收"**（`staleTreeCell` 那格）。
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { parseWorktreeList, staleScratchTrees } from "../../scripts/lib/head-cert-deps";

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8" });
const mainRoot = dirname(resolve(process.cwd(), git(["rev-parse", "--git-common-dir"]).trim()));
const scratchRoot = join(mainRoot, ".worktrees");

const rows = parseWorktreeList(git(["worktree", "list", "--porcelain"]));
/** 在飞数：取不到就回 null，让判据把它记进 `unmeasured`（"没量过"绝不写成 0）。 */
const dirtyCountOf = (path: string): number | null => {
  try {
    return execFileSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" })
      .split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
};
const isAncestor = (sha: string): boolean => {
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"]); return true; } catch { return false; }
};

const res = staleScratchTrees(rows, {
  selfPath: mainRoot,
  // 本次认证树名是随 rev 变的（`head-cert-<sha>`），这里不猜：传一个不存在的绝对路径，
  // 于是"排除本次那棵"这一格对任何真树都不生效——真树本来就不该被当成残留。
  certTree: join(scratchRoot, "head-cert-<未认证>"),
  isAncestor,
  dirtyCountOf,
  scratchRoot,
});

const short = (p: string): string => p.replace(mainRoot + "/", "");
for (const key of ["stale", "unmeasured", "foreign"] as const) {
  const v = res[key] as Array<{ path: string; head?: string }>;
  console.log(`${key} = ${String(v.length)}`);
  for (const x of v) {
    console.log(`    ${short(x.path)}  head=${(x.head ?? "").slice(0, 7)}  dirty=${String(dirtyCountOf(x.path))}`);
  }
}
console.log("--- 全部树逐棵读数（归属判定用：谁在飞、谁不是暂存根下的）---");
for (const r of rows ?? []) {
  console.log(`${r.detached ? "det  " : "branch"} ${short(r.path)}  head=${r.head.slice(0, 7)}  dirty=${String(dirtyCountOf(r.path))}`);
}
