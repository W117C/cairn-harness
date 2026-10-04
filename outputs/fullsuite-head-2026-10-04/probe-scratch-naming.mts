// 取证探针：把 tests/scratch-tree-naming.test.ts 的两条真仓面断言按现读注册表复算一遍，
// 并分别算出「含我这棵树」与「排除我这棵树」两种读数，用来判那两条红归谁。
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { checkScratchTreeNaming, parseWorktreePorcelain, scratchTreesUnder } from "../../scripts/lib/scratch-tree-naming";

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8" });
const commonDir = resolve(process.cwd(), git(["rev-parse", "--git-common-dir"]).trim());
const mainRoot = resolve(commonDir, "..");
const self = resolve(process.cwd());

const rows = parseWorktreePorcelain(git(["worktree", "list", "--porcelain"]));
console.log("cwd=" + self);
console.log("mainRoot=" + mainRoot);
console.log("registry rows=" + rows.length);
for (const r of rows) console.log("  " + resolve(r.path) + "  head=" + r.head.slice(0, 12) + (r.detached ? " (detached)" : ""));

const withoutSelf = rows.filter((r) => resolve(r.path) !== self);

const report = (label: string, trees: typeof rows): void => {
  const mine = scratchTreesUnder(mainRoot, trees);
  const underRoot = trees.filter((r) => resolve(r.path).startsWith(mainRoot + "/.worktrees/"));
  console.log("\n--- " + label + " ---");
  console.log("断言①取料派生对：mine=" + mine.length + " underRoot=" + underRoot.length + " ⇒ " + (JSON.stringify(mine.map((m) => resolve(m.path)).sort()) === JSON.stringify(underRoot.map((m) => resolve(m.path)).sort()) ? "PASS" : "FAIL"));
  console.log("  mine 有 / underRoot 没有：" + JSON.stringify(mine.map((m) => resolve(m.path)).filter((p) => !p.startsWith(mainRoot + "/.worktrees/"))));
  const findings = checkScratchTreeNaming(mainRoot, trees);
  console.log("断言②三类不一致：findings=" + findings.length + " ⇒ " + (findings.length === 0 ? "PASS" : "FAIL"));
  for (const f of findings) console.log("  [" + f.kind + "] " + f.detail);
};

report("现读全表（含我这棵探针树）", rows);
report("排除我这棵探针树（= 只留别的会话的树）", withoutSelf);
