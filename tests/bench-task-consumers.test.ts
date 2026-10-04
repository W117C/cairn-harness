// #63c 的判卷：三份长任务清单必须有真消费者，且"一次只吃一份"要出声而不是静默取首个。
//
// 原缺陷有两半，缺一不可：
//   ① `tasks-long30/chain32/chain48.json` 在全仓**没有消费者**（`bench` 脚本只指 `tasks.json`）
//      ⇒ 那三份清单等于躺在盘上；本仓 README 自己写着"本轮只登记、不修"，这一页就是来修的。
//   ② `pick()` 用 `argv.indexOf(flag)` 取**首个** ⇒ 同时给两份清单时第二份**静默丢掉**，
//      读数上没有任何痕迹。这类"悄悄只听一个"正是本仓反复登记的形状。
//
// 判法：① 走**真起进程**（守卫在任何真实工作之前就退出，所以这条判卷不花钱也不出网）；
//      ② 走盘上事实（脚本 ↔ 清单文件双向配平），比字符串断言结实。
import { it, expect, describe } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

/** 从一条 bench 类脚本里抽出它吃的那份清单。 */
const listOf = (scriptName: string): string | null => {
  const cmd = pkg.scripts[scriptName];
  if (cmd === undefined) return null;
  const m = /--tasks\s+(\S+)/u.exec(cmd);
  return m === null ? null : (m[1] ?? null);
};

describe("① 三份长清单都有消费者", () => {
  const expectConsumers: Array<[string, string]> = [
    ["bench:long30", "fixtures/bench/tasks-long30.json"],
    ["bench:chain32", "fixtures/bench/tasks-chain32.json"],
    ["bench:chain48", "fixtures/bench/tasks-chain48.json"],
  ];

  it.each(expectConsumers)("%s 指向 %s", (script, file) => {
    expect(pkg.scripts[script], "没有这条脚本 ⇒ 那份清单仍然零消费者（#63c 复发）").toBeDefined();
    expect(listOf(script)).toBe(file);
  });

  it("被点名的清单都真在盘上（指向幽灵文件比没有脚本更坏）", () => {
    for (const [script] of expectConsumers) {
      const f = listOf(script);
      expect(f, script + " 抽不出 --tasks").not.toBeNull();
      expect(existsSync(join(ROOT, f as string)), f + " 不在盘上").toBe(true);
    }
  });

  it("四份清单各走各的消费者，没有两份指向同一个文件（否则等于又有一份没人跑）", () => {
    const lists = ["bench", "bench:long30", "bench:chain32", "bench:chain48"].map(listOf);
    expect(lists.every((l) => l !== null)).toBe(true);
    expect(new Set(lists).size, "有两份脚本吃同一份清单 ⇒ 另一份仍然零消费者").toBe(lists.length);
  });
});

describe("② 重复给 --tasks 必须出声（不许静默取首个）", () => {
  it("真起进程：给两份 ⇒ exit 2，且话术点名这是拒绝出数", () => {
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", "fixtures/bench/tasks.json", "--tasks", "fixtures/bench/tasks-long30.json", "--reps", "1", "--max-steps", "1"],
      { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
    );
    expect(r.status, "重复给 --tasks 没有拦住 ⇒ 静默只用第一份（#63c 的另一半复发）").toBe(2);
    expect(String(r.stderr)).toContain("#63c");
    expect(String(r.stderr)).toContain("拒绝出数");
  });
});
