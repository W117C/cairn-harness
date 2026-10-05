// #100（业主拍板的 C2）：覆盖前快照**不许随仓库分发**。
//
// 现读事实（第 385 页那份选型取证）：`.agent/memory/` 与 `.agent/sessions/` 都被 .gitignore 忽略，
// 而**根级** `.agent/snapshots/` 被漏掉了 ⇒ 那一份按字节抄的原件是 untracked-but-not-ignored：
// `git status` 看得见、`git add -A` 会扫走。被覆盖的文件里若含凭据，外泄通道是 **commit**，不是 copy。
//
// 判卷写三层，缺一层就有一个洞：
//   ① 行为（不是读文本）：`git check-ignore` 真把这条路径判成忽略。
//   ② 反向证人：`.agent/permissions.json` **不许**被忽略——它是有意跟踪的项目策略；
//      这一格钉的是修法没有走过头（「整体忽略 .agent/」是本仓明令禁止的那种偷懒）。
//   ③ 尺的分辨力：一个刻意不在忽略面的路径必须判成「未忽略」，否则 ① 可能只是命令恒退 0。
// 取料共用生产算出的那一份路径（`SNAPSHOT_ROOT`），判卷不另拼一遍字符串——那正是「探针自己再算一遍」
// 造出假读数的形状。
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_ROOT } from "../src/tools/snapshot";

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

describe("#100 快照目录不进 git（C2：掐掉随仓库分发那一条通路）", () => {
  it("① 生产用的那条快照根路径真被判成忽略，且回指 .gitignore 里的那一行", () => {
    const probe = join(SNAPSHOT_ROOT, "1700000000000-call-x", "src", "a.ts");
    const r = checkIgnore(probe);
    expect(r.ignored, SNAPSHOT_ROOT + " 没被忽略 ⇒ 含凭据的原件会随 commit 外泄").toBe(true);
    expect(r.out).toContain(".gitignore");
  });

  it("② 反向证人：被跟踪的项目策略不许一起被忽略（整体忽略 .agent/ 是走过头）", () => {
    expect(checkIgnore(".agent/permissions.json").ignored).toBe(false);
  });

  it("③ 尺有分辨力：刻意不在忽略面的路径必须判成未忽略（否则 ① 可能是命令恒退 0）", () => {
    const r = checkIgnore("src/tools/__not-ignored-probe__.ts");
    expect(r.ignored, "这把尺对什么都回答「忽略」⇒ ① 那条是恒真").toBe(false);
    expect(r.code).toBe(1);
  });

  it("④ 同族运行产物一致：memory／sessions／snapshots 三条**真被 git 判成忽略**（文本断言会被注释顶包）", () => {
    // 这一格原本是读 .gitignore 文本 `toContain(SNAPSHOT_ROOT + "/")`——造红那一台当场把它打回原形：
    // 把忽略行摘掉后它照绿，因为第 26 行**注释里**就写着这个路径（`fixtures/todo-app/.agent/` 那一段的
    // 说明文字）。这是本仓点名的「文本断言被散文顶包」形状，所以改成走同一条命令的行为判定。
    for (const dir of [".agent/memory/", ".agent/sessions/", SNAPSHOT_ROOT + "/"]) {
      const r = checkIgnore(dir + "probe.txt");
      expect(r.ignored, dir + " 没被 git 判成忽略 ⇒ 这一族运行产物会随仓库分发").toBe(true);
    }
  });
});
