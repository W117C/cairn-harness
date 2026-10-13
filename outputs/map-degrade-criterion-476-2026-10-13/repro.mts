// BLOCKED.md 2026-09-30 那一格的**造红探针**：降级说明里的原因按 200 字截断，
// 而那条原因里 `rg` 的位置 = 仓库绝对路径长度 + 一段固定后缀。
// 本仓现在的路径短 ⇒ `rg` 落在 200 字窗内 ⇒ 旧判据 `toContain("rg")` 绿；
// 同一个仓放到深一点的目录（BLOCKED 记的实况：前缀 104 字的嵌套 worktree）⇒ 窗外 ⇒ 红。
// 这一格与本页新判据的差别只有一个：**判「原因被带出来」用身份，还是用一个恰好能被路径长短改变的魔词。**
import { mapUnavailableText } from "../../src/agent/map/build";

// 与 `tests/map-self-report.test.ts` 那条真失败同形的错误串：spawn <rg 绝对路径> ENOENT
const SUFFIX = "node_modules/.pnpm/@vscode+ripgrep-darwin-arm64@1.18.0/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg";
const cases: Record<string, string> = {
  "本仓现读（前缀 40 字）": "/Users/ze/Downloads/Cairn/deepseek harness/",
  "BLOCKED 记的实况（前缀 104 字）": "/Users/ze/some/deeply/nested/checkout/that/another/session/left/behind/.claude/worktrees/audit-zcode/",
  "深一格（前缀 140 字）": "/Users/ze/" + "deep-checkout-dir/".repeat(6),
};
for (const [label, root] of Object.entries(cases)) {
  const why = "spawn " + root + SUFFIX + " ENOENT";
  const line = mapUnavailableText(why);
  const oldCriterion = line.includes("rg");
  const newCriterion = line.includes("（原因：" + why.slice(0, 200) + "）");
  console.log(
    label + "｜错误串 " + String(why.length) + " 字｜旧判据 line.includes(\"rg\") = " + String(oldCriterion) +
    "｜新判据（原因身份）＝ " + String(newCriterion),
  );
}
