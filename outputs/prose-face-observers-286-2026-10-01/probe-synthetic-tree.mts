/** 第 286 页的先导探针（动代码之前）：`scanRepo` 能不能跑在一棵**合成树**上？
 *  为什么问这个：真仓那三格（`sourceFiles`／`proseHeldBack`／`inFlightStale`）今天只在**安全值那一侧**被断言
 *  （规则 340）——真仓的干净树里「在飞」那一面是空的 ⇒ 任何等式或 `≤` 在此刻都不分辨，把字段焊死成 0 也不会红。
 *  合成树能把三格都变成**确切期望值**：生产侧 2 支、登记表 60 条 `desc:`、在飞 2 支（一支 mtime 拨到 3 天前＝该旧、一支是新的）。
 *  这一趟只回答"跑不跑得起来、三格读不读得出确切数"，不改任何尺。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "/Users/ze/Downloads/deepseek harness/scripts/prose-needle-scan.ts";

const root = mkdtempSync(join(tmpdir(), "dsh-prose-face-"));
const g = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
try {
  g("init", "-q");
  g("config", "user.email", "probe@test.local");
  g("config", "user.name", "Probe");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), 'export const sentence = "不在 HEAD 里";\n');
  const rows = Array.from({ length: 60 }, (_, i) =>
    `  { id: "probe-${String(i)}", desc: "第 ${String(i)} 条散文：这条永不流进任何输出", expectFail: "不在 HEAD 里" },`).join("\n");
  writeFileSync(join(root, "scripts", "table.ts"), `export const MUTATIONS = [\n${rows}\n];\n`);
  writeFileSync(join(root, "tests", "a.test.ts"),
    'import { expect, it } from "vitest";\nit("点名那句生产文案", () => { expect(1).toBe(1); expect("不在 HEAD 里").length; });\n');
  g("add", "src/a.ts", "scripts/table.ts", "tests/a.test.ts");
  g("commit", "-q", "-m", "fixture");
  // 在飞两面：一支拨旧（3 天前 ⇒ 该进 stale），一支新鲜（不该进）
  writeFileSync(join(root, "src", "old.ts"), 'export const oldFace = "老的一面";\n');
  writeFileSync(join(root, "src", "new.ts"), 'export const newFace = "新的一面";\n');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(join(root, "src", "old.ts"), threeDaysAgo, threeDaysAgo);
  const r = scanRepo(root);
  console.log(JSON.stringify({
    scope: r.scope,
    sourceFiles: r.sourceFiles,
    testFiles: r.testFiles,
    needles: r.needles,
    anchorTables: r.anchorTables.map((t) => `${t.kind}:${t.path}:${String(t.entries)}`),
    proseHeldBack: r.proseHeldBack,
    inFlightFiles: r.inFlightFiles.slice().sort(),
    inFlightStale: r.inFlightStale,
    inFlightAgeChecked: r.inFlightAgeChecked,
    三格期望: { sourceFiles: 2, proseHeldBack: 60, inFlightStale: ["src/old.ts"], inFlightAgeChecked: 2 },
    三格命中: r.sourceFiles === 2 && r.proseHeldBack === 60
      && JSON.stringify(r.inFlightStale) === JSON.stringify(["src/old.ts"]) && r.inFlightAgeChecked === 2,
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
