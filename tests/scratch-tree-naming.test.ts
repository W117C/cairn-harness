/** 暂存树命名对账的判卷。与 `scripts/lib/scratch-tree-naming.ts` 共用同一份谓词（本文件不再写第二份正则）。
 *  取料面要说清楚：worktree 注册表是**共享状态**（`git worktree list` 从任何一棵树里问都返回同一张表），
 *  所以这里刻意不走 `cwd/.worktrees`，而是从 `--git-common-dir` 反推主树根——
 *  否则认证/复跑在别的树里跑这套判卷时会因为"那棵树没有 .worktrees 目录"而空跑成一条假绿。 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkScratchTreeNaming, parseWorktreePorcelain, scratchTreesUnder } from "../scripts/lib/scratch-tree-naming";

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8" });
const commonDirRaw = git(["rev-parse", "--git-common-dir"]).trim();
const commonDir = resolve(process.cwd(), commonDirRaw);
/** 主树根：common dir 就是 `<主树>/.git`（链接树里也指回主树的那个），所以取它的上一级。 */
const mainRoot = resolve(commonDir, "..");

const tmpDirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "dsh-scratch-naming-"));
  tmpDirs.push(d);
  return d;
};
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

describe("合成面：三类不一致各响一次，一致的不出声", () => {
  const R = scratch();
  const H = "abc1234567890abcdef1234567890abcdef1234567";
  it("名字与 HEAD 相符 ⇒ 一条都不许多报（主树与暂存根外的树不参与）", () => {
    const trees = [
      { path: R, head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      { path: join(R, ".worktrees", "verify-abc1234"), head: H },
      { path: join(scratch(), "verify-deadbee"), head: "ffffffffffffffffffffffffffffffffffffffff" },
    ];
    expect(checkScratchTreeNaming(R, trees)).toEqual([]);
    expect(scratchTreesUnder(R, trees).map((t) => t.path)).toEqual([join(R, ".worktrees", "verify-abc1234")]);
  });

  it("名字承诺的 sha 不是这棵树的 HEAD ⇒ 必须响", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "verify-abc1234"), head: "9".repeat(40) }]);
    expect(r.map((f) => f.kind)).toEqual(["name-not-head"]);
    expect(r[0]!.detail).toContain("名字在说谎");
  });

  it("目录名里根本没有 sha ⇒ 响（约定是 verify-<sha>）", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "verify-临时"), head: H }]);
    expect(r.map((f) => f.kind)).toEqual(["no-sha-name"]);
  });

  it("两棵树钉在同一个提交 ⇒ 响（同一 HEAD 该复用一棵，别留多份像两个证据面）", () => {
    const r = checkScratchTreeNaming(R, [
      { path: join(R, ".worktrees", "verify-abc1234"), head: H },
      { path: join(R, ".worktrees", "verify-abc1234567"), head: H },
    ]);
    expect(r.map((f) => f.kind)).toEqual(["duplicate-head"]);
    expect(r[0]!.detail).toContain("2 棵");
  });
});

describe("真仓面：注册表里的暂存树名字都没说谎", () => {
  const rows = parseWorktreePorcelain(git(["worktree", "list", "--porcelain"]));
  const mine = scratchTreesUnder(mainRoot, rows);

  it("取料派生对：问的是共享注册表、且主树根下那批一棵都不许漏（暂存树为 0 是合法态，不当红也不当绿证）", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => resolve(r.path) === mainRoot)).toBe(true);
    const underRoot = rows.filter((r) => resolve(r.path).startsWith(mainRoot + "/.worktrees/"));
    expect(mine.map((m) => resolve(m.path)).sort()).toEqual(underRoot.map((m) => resolve(m.path)).sort());
  });

  it("三类不一致都必须为 0，且报出来时要点名是哪棵树", () => {
    const findings = checkScratchTreeNaming(mainRoot, rows);
    expect(findings, findings.map((f) => f.detail).join("；")).toEqual([]);
  });

  it("porcelain 解析与 git 自己给的分母同数（少一条就是解析漏了某种形状）", () => {
    expect(rows.length).toBe(git(["worktree", "list"]).trim().split("\n").filter(Boolean).length);
    for (const r of rows) expect(r.head).toMatch(/^[0-9a-f]{7,40}$/u);
  });
});
