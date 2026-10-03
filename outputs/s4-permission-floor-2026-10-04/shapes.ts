// 证人：S4（全局 deny 被项目层更长的 allow 击穿）的复现形状。
// 取料面＝跑它的那棵树（在主树跑＝含隔壁未提交的 hunk；要干净 HEAD 面就在 detached 树里跑同一条相对路径）。
// 跑法：node --import tsx outputs/s4-permission-floor-2026-10-04/shapes.ts
// 判吃的是生产同一个 judgeChain——不自己再算一遍（规则 236 那一族）。
import { join } from "node:path";
import { judgeChain, type PermissionRule } from "../../src/permissions/rules.js";

const r = (behavior: PermissionRule["behavior"], pattern: string, index: number): PermissionRule => ({
  behavior,
  tool: "run_shell",
  scope: "always",
  pattern,
  id: `${behavior}:run_shell:${pattern}#${String(index)}`,
});

/** 两层规则库今天**不带层归属**（`PermissionRule` 没有 layer 字段，`loadPermissionRules` 直接把
 *  全局层与项目层并成一个数组），所以下面每一格都是「同一次加载后的合并面」——
 *  这本身就是 S4 说不清「谁放宽了谁」的原因：判完就不知道那条 allow 来自哪一层。 */
const cases: Array<[string, PermissionRule[], string]> = [
  ["deny「git push」＋allow「git push --force」，命令 git push --force origin main", [r("deny", "git push", 0), r("allow", "git push --force", 1)], "git push --force origin main"],
  ["同上，两条顺序对调（结果与顺序无关）", [r("allow", "git push --force", 0), r("deny", "git push", 1)], "git push --force origin main"],
  ["deny「rm -rf」＋allow 与命令逐词相等", [r("deny", "rm -rf", 0), r("allow", "rm -rf /tmp/x", 1)], "rm -rf /tmp/x"],
  ["等长（deny 与 allow 同字面）⇒ 行为优先序在这里是生效的", [r("deny", "rm -rf /tmp/x", 0), r("allow", "rm -rf /tmp/x", 1)], "rm -rf /tmp/x"],
  ["链式：allow 段在前、deny 段在后 ⇒ 全链 deny（短路是好的）", [r("deny", "rm -rf", 0), r("allow", "echo hi", 1)], "echo hi && rm -rf /tmp/x"],
  ["**反例（不是缺陷）**：allow 比命令短一整个词元之外的形状 ⇒ 不命中，读成 miss", [r("allow", "rm -rf /tmp", 0)], "rm -rf /tmp/x"],
];

console.log(`取料根＝${join(process.cwd())}`);
for (const [name, rules, command] of cases) {
  const v = judgeChain(rules, "run_shell", command);
  const id = "ruleId" in v ? v.ruleId : "-";
  console.log(`${name}\n  命令＝${command}\n  ⇒ verdict=${v.verdict} ruleId=${id}`);
}
