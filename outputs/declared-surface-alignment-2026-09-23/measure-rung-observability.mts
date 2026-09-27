/** 能力 26 L1 的可观测性预检：把「注册表判定提到权限门之前」这句话，逐条问一遍
 *  「那今天哪条判据会因此变红」。跑法：
 *    TERM=dumb node --import tsx outputs/declared-surface-alignment-2026-09-23/measure-rung-observability.mts
 *  只读：不写任何文件。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { gate } = await import("../../src/permissions/index.ts");
const { isSideEffectTool } = await import("../../src/permissions/autonomy.ts");
const { TOOL_NAMES } = await import("../../src/tools/base.ts");
const rulesSrc = readFileSync(fileURLToPath(new URL("../../src/permissions/rules.ts", import.meta.url)), "utf8");
const loopSrc = readFileSync(fileURLToPath(new URL("../../src/agent/loop.ts", import.meta.url)), "utf8");

const MODES = ["read-only", "default", "guided", "auto"] as const;
const PHANTOMS = ["totally_bogus_tool", "mcp__ghost__do_it", "write_file_v2", "shell_rwx"];

console.log("## ① 假名在权限层拿什么判定（前置想修的暴露面就在这）");
for (const name of PHANTOMS) {
  const row = MODES.map((m) => m + "=" + String(gate(m, name as never, false))).join("  ");
  console.log(`   ${name.padEnd(20)} ${row}   isSideEffect=${String(isSideEffectTool(name))}`);
}

console.log("\n## ② 权限规则能不能专门 deny 一个假名（本想拿它当 C2 的观测量）");
console.log("   ruleApplies 实现：" +
  (/function ruleApplies[\s\S]*?\n}/.exec(rulesSrc)?.[0].replace(/\s+/g, " ") ?? "(没抓到）"));
console.log("   ⇒ 命中与否都不改结局（假名最终仍是 unknown tool），所以它量不出次序。");

console.log("\n## ③ 假名会不会被真的执行（执行前那句查表排在门之后 = 前置的靶子）");
const lookupLine = "const tool = (opts.tools ?? TOOLS)[name];";
console.log(`   执行处用本会话表：${loopSrc.includes(lookupLine) ? "是" : "否"}`);
const gateAt = loopSrc.indexOf('decision === "deny"');
const lookupAt = loopSrc.indexOf(lookupLine);
console.log(`   权限门在查表之前：${gateAt >= 0 && lookupAt > gateAt ? "是（要改的就是这个次序）" : "否/读不出"}`);
console.log("   ⇒ 幻觉名不会被执行，查表兜住了 ⇒ 前置的差异只剩回执文案与 hook 位次，没有结果层判据。");

console.log("\n## ④ 静态名单里有没有 mcp__ 形态（若假名不可执行，MCP 未注解的 fail-closed 就到不了）");
console.log(`   TOOL_NAMES(${String(TOOL_NAMES.length)}) 含 mcp__ 前缀：${TOOL_NAMES.some((n: string) => n.startsWith("mcp__")) ? "是" : "否"}`);
console.log("\n⇒ 结论：C2「未注册名不得进入权限评估」今天没有结果层的可观测差异，不该作为「已修的安全缺口」落库；");
console.log("   能钉的是判定的取表面（本会话表 vs 静态表）——已由 tests/registry-rung.test.ts 钉住。");
