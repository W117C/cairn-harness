// 冒烟脚本语法哨兵（第 1081 页）：`apps/desktop/scripts` 里任何一支 .cjs 都必须能通过 `node --check`。
// 动因：`same-id-workspace-smoke.cjs` 在 HEAD 就带着 TS 注解（`(w: string)`）——脚本从来跑不起来，
// 而没有任何一道门看得见它（它不在任何 vitest 集合里）。语法错不该靠人去点。
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../scripts", import.meta.url));

describe("冒烟脚本语法哨兵", () => {
  // 95 支脚本串行起 95 次 node；闲置机 3.8s，全量套件并跑时实测 5.4–6.4s ⇒ 缺省 5s 会
  // 把「慢」读成「语法错」（2026-11-15 两趟全量均红、单跑均绿）。给足预算，判据一条不改。
  it("scripts/*.cjs 全部通过 node --check（≥90 支，不许空跑）", { timeout: 30_000 }, () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".cjs")).sort();
    expect(files.length, "脚本面一支都没扫到（取料坏了）").toBeGreaterThanOrEqual(90);
    const bad: string[] = [];
    for (const f of files) {
      try {
        execFileSync(process.execPath, ["--check", DIR + "/" + f], { stdio: "pipe" });
      } catch (err) {
        const e = err as { stderr?: Buffer | string };
        const detail = String(e.stderr ?? err).split("\n").slice(0, 3).join(" | ");
        bad.push(f + " → " + detail);
      }
    }
    expect(bad, "这些脚本过不了 node --check：\n" + bad.join("\n")).toEqual([]);
  });
});
