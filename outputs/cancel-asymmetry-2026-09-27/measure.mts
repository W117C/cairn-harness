/** 任务 #5 的现读：`disallowed-tools` 只禁 `cancel_agents` 时，"能派不可撤"到底可达吗、后果有没有出声。
 *  跑法：node --import tsx outputs/cancel-asymmetry-2026-09-27/measure.mts
 *  只读现成函数（不造第二份判据，规则 236：探针"自己再算一遍"＝假读数）。 */
import { INJECTED_TOOLS } from "../../src/agent/tool-surface";
import { resolveDeclaredTool, skillToolPolicy } from "../../src/agent/plugins/skills";
import { sessionToolSpecs } from "../../src/agent/glm-session";

const declarable = (n: string): string => {
  const r = resolveDeclaredTool(n);
  return r === null ? "不可申报（unknown）" : `可申报 → ${r}`;
};
console.log("== 申报域（#19 之后）==");
for (const n of ["cancel_agents", "spawn_agent", "wait_for_agents", "not_a_tool"]) console.log(`  ${n.padEnd(17)} ${declarable(n)}`);

console.log("\n== 注入面清单里这两把的可达性 ==");
for (const t of INJECTED_TOOLS.filter((x) => /spawn_agent|cancel_agents|wait_for_agents/.test(x.name))) {
  console.log(`  ${t.name}：workerReachable=${String(t.workerReachable)} 只读档可达=${String(t.reachableWhenReadOnly ?? false)}`);
}

console.log("\n== 只禁 cancel_agents 的一份 skill 申报 ==");
const policy = skillToolPolicy({ "disallowed-tools": "cancel_agents" });
console.log(`  deny=${JSON.stringify(policy.deny)} unknown=${JSON.stringify(policy.unknown)}`);

const denial = (name: string): string | null => (policy.deny.includes(name) ? "measure-strict-skill" : null);
const face = sessionToolSpecs({ mode: "auto", skillDenial: denial });
const names = face.specs.map((s) => s.function.name);
const has = (n: string): boolean => names.includes(n);
console.log(`  规格面：spawn_agent 在=${has("spawn_agent")}　cancel_agents 在=${has("cancel_agents")}　wait_for_agents 在=${has("wait_for_agents")}`);
console.log(`  removed=${JSON.stringify(face.removed)}`);
console.log(`  模型看到的那句注脚：\n    ${face.note === "" ? "(空)" : face.note}`);

const saysConsequence = /撤|取消|派|worker/i.test(face.note);
console.log(`\n== 判读 ==`);
console.log(`  「能派不可撤」可达？ ${has("spawn_agent") && !has("cancel_agents") ? "是（派活留着、撤活摘掉）" : "否"}`);
console.log(`  摘除本身出声？ ${face.removed.length > 0 ? "是（注脚点名被摘的刀与是谁摘的）" : "否"}`);
console.log(`  注脚里带不带**后果**（派出去就撤不回来）？ ${saysConsequence ? "带" : "不带 — 只报了名字"}`);
