/**
 * 静态成本取数脚本（只读）。运行：
 *   node --import tsx outputs/prompt-economy-audit-2026-10-05/measure.ts
 * 铁律：不自己造尺。固定面用 shipped 的 `accountModelSurface`（字符口径，与 MODEL_SURFACE_* 帽同单位），
 * token 用 `src/agent/text-budget.ts` 的 CJK 感知 `estimateTextTokens`（goal/记忆/skill 各家帽用的就是它）。
 * 本脚本不做任何写盘，不跑 mapBuilder / PluginRuntime 发现链（见 report.md「没能实测」）。
 */
import { readFileSync } from "node:fs";
import { BASE_SYSTEM, systemPromptFor } from "../../src/agent/system-prompt";
import { sessionToolSpecs, gateToolSpecs, OPTIONAL_TOOL_NAMES, ATTACHMENT_CONTEXT_CHAR_LIMIT } from "../../src/agent/glm-session";
import {
  accountModelSurface, surfaceSpecChars, MODEL_SURFACE_TOTAL_CHAR_LIMIT, MODEL_SURFACE_TIGHT_DESC_CHAR_CAP,
} from "../../src/agent/model-surface";
import { estimateTextTokens } from "../../src/agent/text-budget";
import { goalReminder, GOAL_REMINDER_TOKEN_CAP, EVIDENCE_TEXT } from "../../src/agent/goal";
import { buildSkillRoutingList, skillRoutingLine, SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL } from "../../src/agent/plugins/skills";
import { MEMORY_TOKEN_BUDGET_DEFAULT, STANCE_LINE, buildMemoryInjectionSafe, LESSONS_RECENT_DEFAULT, DECISIONS_RECENT_DEFAULT, ARCH_OUTLINE_MAX_CHARS } from "../../src/agent/memory/inject";
import { HOOK_CONTEXT_TOTAL_CHAR_LIMIT } from "../../src/agent/plugins/hooks";
import { MAP_TOKENS_DEFAULT, MAP_TOKENS_MAX } from "../../src/agent/map/render";
import { AUTOMATION_TOOL_NAMES } from "../../src/agent/automation-surface";

const B = (s: string): number => Buffer.byteLength(s, "utf8");
const row: string[] = [];
const p = (k: string, v: string): void => { row.push(k.padEnd(46) + v); };

p("== A 固定面（每轮必付）==", "");
p("BASE_SYSTEM chars", String(BASE_SYSTEM.length) + "  bytes " + String(B(BASE_SYSTEM)) + "  estTokens " + String(estimateTextTokens(BASE_SYSTEM)));
p("systemPromptFor(read-only) chars", String(systemPromptFor("read-only").length) + "  bytes " + String(B(systemPromptFor("read-only"))));
p("read-only 相对共用面省下 bytes", String(B(BASE_SYSTEM) - B(systemPromptFor("read-only"))));

const coreNames = new Set(gateToolSpecs().map((s) => s.function.name));
const modes = ["default", "guided", "auto", "read-only"] as const;
for (const m of modes) {
  const full = sessionToolSpecs({ mode: m }).specs;
  const lean = sessionToolSpecs({ mode: m, omitTools: [...OPTIONAL_TOOL_NAMES.goalTools, ...OPTIONAL_TOOL_NAMES.memoryTools, ...OPTIONAL_TOOL_NAMES.lspTools, ...OPTIONAL_TOOL_NAMES.subagentTools] }).specs
    .filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name));
  const aFull = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: full, coreNames });
  const aLean = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: lean, coreNames });
  p("面[" + m + "] 挂满", full.length + " 件 / toolSpec " + String(aFull.toolSpecChars) + " / 固定面 " + String(aFull.fixedChars) + " 字符 / 帽占比 " + ((aFull.fixedChars / MODEL_SURFACE_TOTAL_CHAR_LIMIT) * 100).toFixed(1) + "%");
  p("面[" + m + "] 最省(摘4组+定时)", lean.length + " 件 / 固定面 " + String(aLean.fixedChars) + " 字符 ⇒ 省 " + String(aFull.fixedChars - aLean.fixedChars));
}

const def = sessionToolSpecs({ mode: "default" }).specs;
const acct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: def, coreNames });
p("", "");
p("== B default 逐件（降序 前 24，accountModelSurface 出品）==", "");
for (const piece of acct.pieces.slice(0, 24)) {
  p("  " + piece.name, String(piece.chars).padStart(6) + " 字符  tier=" + piece.tier);
}
p("合计固定面", String(acct.fixedChars) + " 字符 (system " + String(acct.systemChars) + " + tools JSON " + String(acct.toolSpecChars) + ") / 帽 " + String(MODEL_SURFACE_TOTAL_CHAR_LIMIT));

/* 单把工具的「说明书」成本 = JSON 序列化字符，按同法拆出描述 vs 参数 */
const perTool = def.map((s) => ({ n: s.function.name, j: JSON.stringify(s).length, d: String(s.function.description ?? "").length })).sort((a, b) => b.j - a.j);
p("", "");
p("== C 单把工具：JSON vs description 字符 == ", "");
for (const t of perTool.slice(0, 24)) p("  " + t.n, "json " + String(t.j).padStart(5) + "  desc " + String(t.d).padStart(4));

p("", "");
p("== D goal 提醒块（goalReminder 纯函数逐态渲染）==", "");
for (const ev of Object.keys(EVIDENCE_TEXT)) {
  const t = goalReminder({ objective: "把这一件事做完，按验收口径交结果。", maxTurns: 20, maxUsd: 2 } as never, 3, 0.42, ev as never);
  const th = goalReminder({ objective: "把这一件事做完，按验收口径交结果。", maxTurns: 20, maxUsd: 2 } as never, 3, 0.42, ev as never, "上一轮按失败信息改完后重跑，再看证据态。");
  p("  " + ev, "无hint " + String(t.length) + "字符/" + String(estimateTextTokens(t)) + "tok  有hint " + String(th.length) + "字符/" + String(estimateTextTokens(th)) + "tok");
}
p("  帽", "GOAL_REMINDER_TOKEN_CAP=" + String(GOAL_REMINDER_TOKEN_CAP) + " tok");

p("", "");
p("== E 技能路由清单（buildSkillRoutingList）==", "");
const { fileURLToPath } = await import("node:url");
const ws = fileURLToPath(new URL("../../", import.meta.url)); // 仓库根，固定取料面=工作树
console.log("取料工作区: " + ws);
const skillFiles = [".agent/skills/graphflow/SKILL.md"];
const inputs = skillFiles.map((f) => {
  const raw = readFileSync(`${ws}/${f}`, "utf8");
  const name = /(^|\n)name:\s*"?(.+?)"?\s*$/mu.exec(raw)?.[2] ?? "";
  const desc = /(^|\n)description:\s*"?(.+?)"?\s*$/mu.exec(raw)?.[2] ?? "";
  return { plugin: null, name, description: desc };
});
const rl = buildSkillRoutingList(inputs, [], "修 bug 跑测试");
p("  本仓工作区散装 skill 条数", String(inputs.length));
p("  清单实际长度", String(rl.text.length) + " 字符 / " + String(estimateTextTokens(rl.text)) + " tok（truncated=" + String(rl.truncated) + " dropped=" + String(rl.dropped) + "）");
p("  单行样本", rl.text.split("\n")[0]!.length + " 字符");
p("  帽", "SKILL_ROUTING_CHAR_LIMIT=" + String(SKILL_ROUTING_CHAR_LIMIT) + " 字符；重挂 " + String(SKILL_REMOUNT_TOKENS_PER_SKILL) + "/" + String(SKILL_REMOUNT_TOKENS_TOTAL) + " tok");

p("", "");
p("== F 记忆注入（buildMemoryInjectionSafe，本工作区现读）==", "");
const mem = await buildMemoryInjectionSafe({ workspace: ws, refState: { approved: [], declined: [] }, onExternalRef: () => false, persistRefDecision: () => {} });
p("  project 块", (mem.injection.project === null ? "null" : String(mem.injection.project.length) + " 字符 / " + String(estimateTextTokens(mem.injection.project)) + " tok"));
p("  global 块", (mem.injection.global === null ? "null" : String(mem.injection.global.length) + " 字符 / " + String(estimateTextTokens(mem.injection.global)) + " tok"));
p("  charsCurrent/tokens", String(mem.injection.charsCurrent) + " / " + String(mem.injection.tokens));
p("  帽", "MEMORY_TOKEN_BUDGET_DEFAULT=" + String(MEMORY_TOKEN_BUDGET_DEFAULT) + " tok（charsLimit=" + String(MEMORY_TOKEN_BUDGET_DEFAULT * 4) + "）；ARCH大纲帽 " + String(ARCH_OUTLINE_MAX_CHARS) + " 字符；DECISIONS " + String(DECISIONS_RECENT_DEFAULT) + " 条；LESSONS " + String(LESSONS_RECENT_DEFAULT) + " 条");
p("  块首固定文本", STANCE_LINE.length + " 字符 ×每个块");

p("", "");
p("== G 其余面（帽与归属）==", "");
p("符号地图前缀文案", "[符号地图] 标签串 " + String("[符号地图] 仓库符号索引（def/ref 排名，预算内渲染；用于先看仓库结构再探索）：\n".length) + " 字符；预算帽 " + String(MAP_TOKENS_DEFAULT) + " tok（生产显式传值），MAP_TOKENS_MAX " + String(MAP_TOKENS_MAX));
p("hook 上下文帽", "HOOK_CONTEXT_TOTAL_CHAR_LIMIT=" + String(HOOK_CONTEXT_TOTAL_CHAR_LIMIT) + " 字符（= 整顶模型面帽）");
p("附件引用帽", "ATTACHMENT_CONTEXT_CHAR_LIMIT=" + String(ATTACHMENT_CONTEXT_CHAR_LIMIT) + " 字符");
p("降配紧帽", "MODEL_SURFACE_TIGHT_DESC_CHAR_CAP=" + String(MODEL_SURFACE_TIGHT_DESC_CHAR_CAP) + " 字符（仅池满时）");
console.log(row.join("\n"));

/* ===== H 生产现读形状（工作树，default 档）：未武装 goal ⇒ 摘 refine_goal；
   工作区无 .agent/lsp.json ⇒ lspConfigured=false 摘 lsp；automationTools 缺省=挂；
   settings 缺省 autoMemory:true / subagentTools:true ⇒ remember 与子代理三件套都挂。
   对照 scripts/prompt-cost.ts 的 CHARS_PER_TOKEN=3.6 与 text-budget 的 CJK 感知两把尺。 */
p("", "");
p("== H 生产现读（default 档，本工作区条件摘除后）==", "");
const prod = sessionToolSpecs({ mode: "default", omitTools: ["refine_goal", "lsp"] }).specs;
const prodAcct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: prod, coreNames });
const prodLean = sessionToolSpecs({ mode: "default", omitTools: ["refine_goal", "lsp", ...OPTIONAL_TOOL_NAMES.memoryTools, ...OPTIONAL_TOOL_NAMES.subagentTools] }).specs
  .filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name));
const prodLeanAcct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: prodLean, coreNames });
p("  今天实发固定面", prod.length + " 件 / " + String(prodAcct.fixedChars) + " 字符 / 帽占比 " + ((prodAcct.fixedChars / MODEL_SURFACE_TOTAL_CHAR_LIMIT) * 100).toFixed(1) + "%");
p("  同一面的两种 token 尺", "prompt-cost(/3.6)=" + String(Math.round(prodAcct.fixedChars / 3.6)) + "  text-budget(CJK)=" + String(estimateTextTokens(BASE_SYSTEM)) + "+" + String(estimateTextTokens(JSON.stringify(prod))) + "=" + String(estimateTextTokens(BASE_SYSTEM) + estimateTextTokens(JSON.stringify(prod))));
p("  若 automation+记忆+子代理也摘", prodLean.length + " 件 / " + String(prodLeanAcct.fixedChars) + " 字符 ⇒ 再省 " + String(prodAcct.fixedChars - prodLeanAcct.fixedChars) + " 字符/轮");
const groups: Record<string, string[]> = {
  "automation 五件": [...AUTOMATION_TOOL_NAMES],
  "子代理三件套": [...OPTIONAL_TOOL_NAMES.subagentTools],
  "remember": [...OPTIONAL_TOOL_NAMES.memoryTools],
  "refine_goal": [...OPTIONAL_TOOL_NAMES.goalTools],
  "lsp": [...OPTIONAL_TOOL_NAMES.lspTools],
};
p("  ——逐组字符（今天是否已摘）", "");
for (const [g, ns] of Object.entries(groups)) {
  const chars = JSON.stringify(prod.filter((s) => ns.includes(s.function.name))).length;
  const onFace = prod.some((s) => ns.includes(s.function.name));
  p("    " + g, String(chars).padStart(5) + " 字符  今天" + (onFace ? "仍在重送" : "已摘(不付)"));
}
p("  降配梯可达性", prodAcct.pieces.filter((x) => x.tier === "core").length + "/" + prodAcct.pieces.length + " 件是 core ⇒ 梯级 A/B 对基础面 0 刀可下");
console.log("\n" + row.slice(row.findIndex((r) => r.startsWith("== H"))).join("\n"));
