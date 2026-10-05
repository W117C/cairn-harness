// serena 的项目级数据目录不进 git（掐掉「随仓库分发」那一条通路）。
//
// 现读事实：`.agents/`、`.workbuddy-ai/` 都被 `.gitignore` 忽略，`.serena/` 此前被漏掉
// ⇒ 它是 untracked-but-not-ignored：`git status` 看得见、`git add -A` 会扫走。
// 盘上体积现读 **59M**（`cache/typescript/document_symbols.pkl` 一支就 68MB 量级），
// 且 `serena project health-check` 的日志会持续写进 `.serena/logs/`。
// **外泄通道是 commit 而不是 copy**——与 `.agent/memory/`、`.agent/sessions/`、
// `.agent/snapshots/` 那一族完全同构（`#100` 的 C2 裁决就是为那一族下的）。
//
// 判卷三层，缺一层就有一个洞（形状照 `tests/snapshot-dir-not-distributed.test.ts`，不重抄其判据）：
//   ① 行为（不是读文本）：`git check-ignore` 真把 `.serena/` 判成忽略，且回指 `.gitignore`。
//      **刻意读不到文本**：`.gitignore` 里那段注释含「`.serena/`」这个字符串（`.agent/snapshots/`
//      那一族第 ④ 格就是这么被散文顶包的，本仓第 387 页记过这个教训），所以 `toContain(".serena/")`
//      那一型断言在这里恒真。
//   ② 反向证人：`.serena/` **不许**被整体忽略成「把同族的跟踪面也带走」——
//      钉的是修法没有走过头。`.agent/permissions.json` 是本仓有意跟踪的项目策略（`#100` 那支判卷
//      钉的就是它），它必须仍然**不被**忽略；`AGENTS.md` 同理（删掉整份 `AGENTS.md` 会毁掉命令面）。
//   ③ 尺的分辨力：一个刻意不在忽略面的路径必须判成「未忽略」，否则 ① 可能只是命令恒退 0。
//      这一格是上一支教训的直接应用：`project.py:230` 那类「路径不存在就返回 False」的坑，
//      在 git 侧同构的是 `--no-index` 与不存在的路径。
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** `git check-ignore` 退 0＝命中忽略；退 1＝未命中；其余＝命令本身出问题（不许当成「未忽略」）。 */
function checkIgnore(path: string): { ignored: boolean; out: string; code: number } {
  try {
    const out = execFileSync("git", ["check-ignore", "-v", "--no-index", path], { encoding: "utf8" });
    return { ignored: true, out, code: 0 };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    if (e.status === 1) return { ignored: false, out: e.stderr ?? "", code: 1 };
    throw new Error(`git check-ignore 本身失败（status=${String(e.status)}）：这一格不能读成「未忽略」`);
  }
}

describe("serena 项目数据目录不进 git", () => {
  it("① `.serena/` 真被判成忽略，且回指 .gitignore 里的那一行", () => {
    const r = checkIgnore(".serena/project.yml");
    expect(r.ignored, ".serena/ 没被忽略 ⇒ 59M 索引缓存与日志会随 commit 外泄").toBe(true);
    expect(r.out, "忽略了但回指的不是 .gitignore ⇒ 这条忽略来自别处（.git/info/exclude？）").toContain(".gitignore");
    // 缓存与日志两支各自也判一次：只判 project.yml 的话，改成只忽略那一个文件也能骗过这一格。
    expect(checkIgnore(".serena/cache/typescript/document_symbols.pkl").ignored,
      "缓存没被忽略 ⇒ 体积最大那一支仍会被扫走").toBe(true);
    expect(checkIgnore(".serena/logs/health-checks/x.log").ignored,
      "日志没被忽略 ⇒ health-check 记录会持续进 git").toBe(true);
  });

  it("② 反向证人：同族的跟踪面不许被一起带走", () => {
    expect(checkIgnore(".agent/permissions.json").ignored,
      ".agent/permissions.json 被一起忽略了 ⇒ 修法走过头成「整体忽略 .agent/」").toBe(false);
    expect(checkIgnore("AGENTS.md").ignored,
      "AGENTS.md 被忽略了 ⇒ 命令面会被带走（本仓第一纪律）").toBe(false);
  });

  it("③ 尺有分辨力：刻意不在忽略面的路径必须判成未忽略（否则 ① 可能是恒真）", () => {
    expect(checkIgnore("src/tools/__not-ignored-probe__.ts").ignored,
      "这把尺对什么都回答「忽略」⇒ ① 那条是恒真").toBe(false);
    expect(checkIgnore("outputs/__not-ignored-probe__/x.txt").ignored,
      "outputs/ 也不该被这把尺判成忽略（它另有 repo-hygiene 那一格在管）").toBe(false);
  });
});