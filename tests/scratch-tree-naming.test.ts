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

  // 10-04 认证第一趟实测：判卷在认证树里跑，这把尺把认证自己的默认树名 `head-cert-<sha7>` 读成
  // 「名字没编码提交」⇒ 认证永远不可能全绿。补的是漏，不是松：下面两条一条验"不许多报"、一条验"说谎照样响"。
  it("认证自己的树（head-cert-<sha>）带着提交号 ⇒ 一条都不许多报", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "head-cert-abc1234"), head: H }]);
    expect(r).toEqual([]);
  });

  it("换前缀不关判据：head-cert 的名字与实际 HEAD 不符 ⇒ 照样响 name-not-head", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "head-cert-abc1234"), head: "9".repeat(40) }]);
    expect(r.map((f) => f.kind)).toEqual(["name-not-head"]);
    expect(r[0]!.detail).toContain("名字在说谎");
  });

  it("认证树少了提交号那段 ⇒ 仍响（前缀放行不等于整名放行）", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "head-cert"), head: H }]);
    expect(r.map((f) => f.kind)).toEqual(["no-sha-name"]);
  });

  // 10-05 第三次同形状（复跑对照树起名 `probe-head-<sha>`，也是诚实编码了提交号）⇒ 前缀白名单这条路的
  // 成本已高于收益：判据是「名字里那串 sha 与这棵树实际 HEAD 对得上」，不是「前缀必须是我认识的两个」。
  // 下面三条一起把"放宽前缀"与"不放宽判据"钉死：换前缀不许让说谎的名字闭嘴，也不许让暂存根外的树被误伤。
  it("第三种前缀（probe-head-<sha>）带着提交号 ⇒ 一条都不许多报", () => {
    expect(checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "probe-head-abc1234"), head: H }])).toEqual([]);
  });

  it("换前缀不关判据：probe-head 的名字与实际 HEAD 不符 ⇒ 照样响 name-not-head", () => {
    const r = checkScratchTreeNaming(R, [{ path: join(R, ".worktrees", "probe-head-abc1234"), head: "9".repeat(40) }]);
    expect(r.map((f) => f.kind)).toEqual(["name-not-head"]);
  });

  it("harness 自己管的树（`.qoder/worktrees/agent-*`）不进这把尺——它不在暂存根下，名字里那串也不是提交号", () => {
    // 2026-10-05 实测的假红形状：并行子代理一开，六棵 harness 树全报 no-sha-name，
    // 而那些树由 harness 建、由 harness 收，本仓的 verify-<sha> 约定对它们不成立。
    // 这一格同时是取料面的证人：把过滤改回"根下任何子目录"，它立刻红。
    const trees = [
      { path: R, head: "a".repeat(40) },
      { path: join(R, ".qoder", "worktrees", "agent-general-purpose-07475095"), head: "b".repeat(40) },
      { path: join(R, ".worktrees", "verify-abc1234"), head: H },
    ];
    expect(scratchTreesUnder(R, trees).map((t) => t.path)).toEqual([join(R, ".worktrees", "verify-abc1234")]);
    expect(checkScratchTreeNaming(R, trees)).toEqual([]);
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
