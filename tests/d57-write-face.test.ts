// #57 写入端的判卷片段——**与 agent-runner.patch 同笔落地**。
//
// 为什么单独一段：`persistAlwaysRule` 不在导出面上，跑真实审批流去验它要拉一整套 gate/IPC；
// 而这一格真正要守的事实很短——**程序写的授权记录不许落进受跟踪的那份**。
// 所以钉源码形状（本仓对"脚本/模块级产物契约"的既有做法同 `cert-gate-face`／`agents-command-face`），
// 并配一条反向守卫：把落点改回 `permissions.json` 必须当场红。
//
// 诚实边界（不许读成比它做到的更多）：本片段证明的是**写入目标**；
// 「读得到」由已入库的 `tests/permissions-always-file.test.ts` 用真文件行为证明；
// 两者合起来才是完整链路，各自单独都不算。
import { it, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-10-11 拆分：`persistAlwaysRule`（含那支 import）随工具门搬去 ./tool-gates ⇒ 取料读两处。
const src = readFileSync(join(process.cwd(), "src", "main", "agent-runner.ts"), "utf8")
  + "\n" + readFileSync(join(process.cwd(), "src", "main", "tool-gates.ts"), "utf8");

describe("always-allow 的写入落点（#57 写入端）", () => {
  it("落点是 alwaysRulesPath(workspace)，不是受跟踪的 permissions.json", () => {
    const i = src.indexOf("async function persistAlwaysRule");
    expect(i, "找不到 persistAlwaysRule —— 改名了要同步这段判卷").toBeGreaterThan(-1);
    const body = src.slice(i, i + 1200);
    expect(body, "写入端没换落点 ⇒ 授权记录仍随仓库分发（#57 复发）").toContain("alwaysRulesPath(workspace)");
    expect(body, "不许再出现受跟踪那份的写入路径").not.toContain('join(workspace, ".agent", "permissions.json")');
  });

  it("反向守卫：那支 import 必须真在（否则上面那条只是字符串巧合）", () => {
    expect(src).toMatch(/import \{[^}]*alwaysRulesPath[^}]*\} from "\.\.\/permissions\/rules";/u);
  });
});
