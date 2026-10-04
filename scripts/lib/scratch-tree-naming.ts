/** 验证树的**名字对账**：`.worktrees/verify-<sha>` 这个名字是一个承诺——它说"这棵树钉在某个提交上"。
 *  本仓天天建这种树（认证、复跑、双树对照），回收命令也按名字给人看；名字与树的实际 HEAD 不符，
 *  下一个人就会拿一棵树的读数去替另一棵作证。
 *
 *  与 `head-cert-deps.ts` 里 `staleScratchTrees` 的分工（刻意不重抄那一格）：
 *  那把尺答的是**哪些树可以回收**（脏不脏／是不是 HEAD 的祖先／在不在暂存根里）；
 *  这把尺答的是**注册表的名字有没有说谎**（同一棵树在 git 里的 HEAD vs 目录名里的 sha 前缀）。
 *  两把尺问的是两件事，合成一把就会互相掩盖：回收判据不看名字，命名判据不看能不能删。 */

export interface ScratchTree {
  /** 绝对或相对路径，如 `/repo/.worktrees/verify-abc1234`。 */
  path: string;
  /** 这棵树当前 checkout 的提交（来自 `git worktree list --porcelain` 的 HEAD 行）。 */
  head: string;
}

export interface NamingFinding {
  kind: "no-sha-name" | "name-not-head" | "duplicate-head";
  detail: string;
}

/** 允许出现在暂存根下的「名字里带提交号」前缀。加 `head-cert` 不是放宽，是补一格漏：
 *  认证自己的默认树名 `head-cert-<sha7>` 由 `scripts/head-cert.ts` 的 `TREE` 那行产出，它同样编码了提交号，
 *  而 10-04 认证第一趟实测：判卷在认证树里跑 ⇒ 这把尺把**认证自己那棵树**读成「名字没编码提交」⇒
 *  认证永远不可能全绿（尺咬的是自己的车，不是别人的货）。下一棵同类名前缀要加就一起加，
 *  但「带不带 sha」这一判据不动——`name-not-head` 那格对所有前缀一视同仁，说谎的名字照样响。 */
const NAME_OF_DIR = /^(?:verify|head-cert)-([0-9a-f]{7,40})$/u;

const base = (p: string): string => p.replace(/[/\\]+$/u, "").split(/[/\\]/u).pop() ?? p;

/** 只看暂存根底下的树；主树与别处的树不归这把尺管（它们没有 `verify-` 这个约定）。 */
export function scratchTreesUnder(root: string, trees: readonly ScratchTree[], canonical: (p: string) => string = (p) => p): ScratchTree[] {
  const r = canonical(root).replace(/[/\\]+$/u, "");
  return trees.filter((t) => {
    const p = canonical(t.path).replace(/[/\\]+$/u, "");
    return p.startsWith(r + "/") && base(p) !== base(r);
  });
}

export function checkScratchTreeNaming(root: string, trees: readonly ScratchTree[]): NamingFinding[] {
  const out: NamingFinding[] = [];
  const mine = scratchTreesUnder(root, trees);
  const byHead = new Map<string, string[]>();
  for (const t of mine) {
    const name = base(t.path);
    const m = NAME_OF_DIR.exec(name);
    if (m === null) {
      out.push({ kind: "no-sha-name", detail: `暂存树 ${name} 的名字没编码提交（约定是 verify-<sha>／head-cert-<sha>）⇒ 回收时无法从名字认出它钉在哪一笔` });
      continue;
    }
    const prefix = (m[1] ?? "").toLowerCase();
    const head = t.head.toLowerCase();
    if (!head.toLowerCase().startsWith(prefix)) {
      out.push({ kind: "name-not-head", detail: `暂存树 ${name} 的名字承诺 ${prefix}，实际 checkout 是 ${head.slice(0, 12)} ⇒ 名字在说谎` });
    }
    const seen = byHead.get(head) ?? [];
    seen.push(name);
    byHead.set(head, seen);
  }
  for (const [head, names] of [...byHead.entries()].sort()) {
    if (names.length > 1) {
      out.push({ kind: "duplicate-head", detail: `${names.length} 棵暂存树钉在同一个提交 ${head.slice(0, 12)}：${names.join("、")} ⇒ 同一 HEAD 该复用一棵，别留多份读起来像两个证据面` });
    }
  }
  return out;
}

/** `git worktree list --porcelain` 的极小解析：只取 path 与 HEAD、以及是否 detached。
 *  这是 git 的输出契约，不是本仓"哪些树算陈旧"那个决策点（那格在 `staleScratchTrees`，这里刻意不重抄）。 */
export function parseWorktreePorcelain(text: string): Array<ScratchTree & { detached: boolean }> {
  const out: Array<ScratchTree & { detached: boolean }> = [];
  let path: string | null = null;
  let head = "";
  let detached = false;
  const flush = (): void => {
    if (path !== null) out.push({ path, head, detached });
    path = null; head = ""; detached = false;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) { flush(); path = line.slice("worktree ".length); continue; }
    if (line.startsWith("HEAD ")) { head = line.slice("HEAD ".length).trim(); continue; }
    if (line.trim() === "detached") { detached = true; continue; }
    if (line === "") flush();
  }
  flush();
  return out;
}
