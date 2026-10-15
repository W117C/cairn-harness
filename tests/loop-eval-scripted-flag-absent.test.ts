/** `--scripted` 旗标**缺席**时不许掉进空值闸（第 492 笔；锚点 `scripted-flag-absent-not-empty-value`）。
 *
 * 为什么单独立一户：这一格钉的是判别式 `scriptedEq !== undefined` 本身。缺了它，
 * 「旗标根本没给」与「给了 `--scripted=` 却是空」会被同一个空值闸吃掉
 * ⇒ **真会话那条路变成死代码**，一份真模型读数都产不出来，而判卷全绿。
 * `eae8eaed`（第 483 页）正是这么活的：守卫被并成 `pick("--scripted","") + if (SCRIPTED === "")`，
 * 而 `pick` 在旗标缺席时同样返回 `""` ⇒ 恒真。盘上所有 `providerFace=真会话` 的读数
 * 都停在那一笔之前，时间戳对得上。
 *
 * 判据是**行为格**而不是形状格：问「缺席时走到哪」，不问源码长什么样——
 * 后者会随实现换形状而失效，正是 `scripted-flag-equals-form-dropped` 迁过两次针脚的原因。
 * 与那一支是同一道闸的两半：那半管「给了却空必须退」，这半管「没给必须放行」；
 * 只有前半时，第 483 页那种回归照样能活。
 *
 * 刻意不并进 `tests/loop-eval-synthetic-chain.test.ts`：写这一笔时那份文件里有别的会话
 * 在飞（输出目录隔离那笔），并进去会把别人的未提交改动夹带进本笔提交。 */
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const TASKS = "fixtures/bench/tasks.json";

describe("--scripted 旗标缺席（判别式那一半）", () => {
  it("旗标缺席 ⇒ 不许掉进空值闸（eae8eaed 那次回归的形状：缺席被读成「给了空剧本」）", () => {
    /* 四枚 key/endpoint 全清空：这一格要的是「没有合成面也没有真会话凭据」这个形状，
     * 于是跑器应当走完判别式、落到真会话那条路、再因无凭据而**显式**跳过。
     * 少清任何一枚都可能让它中途改道，那测的就不是判别式了。 */
    const env: NodeJS.ProcessEnv = {
      ...process.env, NO_COLOR: "1",
      CAIRN_API_KEY: "", CAIRN_ENDPOINT: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "",
    };
    const r = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS],
      { cwd: ROOT, encoding: "utf8", env, timeout: 90_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out, "旗标缺席不是「给了空剧本」，不许落进空值闸").not.toContain("后面是空的");
    expect(out, "缺席 ⇒ 走真会话那条路；无凭据时它显式打印跳过（未证 ≠ 通过，不许静默不出数）").toContain("暗卷缺席");
    expect(r.status, "缺席且无凭据 ⇒ 显式跳过并退 0，不是用法错").toBe(0);
  });
});
