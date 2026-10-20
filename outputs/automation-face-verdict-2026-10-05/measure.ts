/**
 * 定时五件摘/挂取证探针（只读，不写盘；不跑任何判卷/门/vitest）。
 * 运行：node --import tsx outputs/automation-face-verdict-2026-10-05/measure.ts
 *
 * 取料面：**HEAD**（`git archive HEAD src` 解到本目录 head/，HEAD=05d3d0f3）。
 * 工作树那份只作「隔壁正在写」的对照，单列标注，不与 HEAD 混算。
 *
 * 尺子（一律复用仓内现成口径，不自造）：
 *  · 字符 = `surfaceSpecChars` / `accountModelSurface`（src/agent/model-surface.ts:89,102 —— 帽 MODEL_SURFACE_TOTAL_CHAR_LIMIT 同单位）
 *  · token = `estimateTextTokens`（src/agent/text-budget.ts，CJK 感知）＋ 横向对照 `CHARS_PER_TOKEN=3.6`（scripts/prompt-cost.ts）
 */
import { AUTOMATION_TOOL_NAMES, automationToolSpecs } from "./head/src/agent/automation-surface";
import { gateToolSpecs, sessionToolSpecs, OPTIONAL_TOOL_NAMES, isCoreSurfaceTool } from "./head/src/agent/glm-session";
import { accountModelSurface, surfaceSpecChars, MODEL_SURFACE_TOTAL_CHAR_LIMIT } from "./head/src/agent/model-surface";
import { BASE_SYSTEM, systemPromptFor } from "./head/src/agent/system-prompt";
import { estimateTextTokens } from "./head/src/agent/text-budget";
// 对照面：**工作树**（脏）的同一函数，只量「隔壁这一笔加了多少字符」，不参与 HEAD 结论。
import { automationToolSpecs as wtSpecs } from "../../src/agent/automation-surface";

const out: string[] = [];
const p = (k: string, v: string): void => { out.push(k.padEnd(44) + v); };

const five = automationToolSpecs();
const fiveNames = five.map((s) => s.function.name);
p("== A 五件规格本体（HEAD，surfaceSpecChars 口径）==", "");
p("五件合计字符", String(surfaceSpecChars(five)));
p("  同一账 CJK tok", String(estimateTextTokens(JSON.stringify(five))) + " tok ；/3.6 = " + String(Math.round(surfaceSpecChars(five) / 3.6)));
p("帽（tests/automation-tool-surface.test.ts:98）", "2600 ⇒ HEAD 余量 " + String(2600 - surfaceSpecChars(five)));
p("工作树脏版对照", String(surfaceSpecChars(wtSpecs())) + "（比 HEAD 多 " + String(surfaceSpecChars(wtSpecs()) - surfaceSpecChars(five)) + "，余量 " + String(2600 - surfaceSpecChars(wtSpecs())) + "）");

p("", "");
p("== B 逐件（HEAD）==", "");
const per = five.map((s) => ({
  n: s.function.name,
  json: JSON.stringify(s).length,
  desc: String(s.function.description ?? "").length,
  props: Object.keys(((s.function.parameters ?? {}) as { properties?: Record<string, unknown> }).properties ?? {}).length,
})).sort((a, b) => b.json - a.json);
for (const t of per) p("  " + t.n, "json " + String(t.json).padStart(5) + "  desc " + String(t.desc).padStart(4) + "  字段 " + String(t.props));

/* accountModelSurface 的逐件口径（方括号/逗号按位置记入首末项）——用同一把尺再算一遍，
   确保「摘掉后每轮省多少」与面板/事件里那本账能对上。 */
const coreNames = new Set(gateToolSpecs().map((s) => s.function.name).filter((n) => !AUTOMATION_TOOL_NAMES.includes(n)));
const autoFace = sessionToolSpecs({ mode: "auto" }).specs;
const acct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: autoFace, coreNames });
const dropped = acct.pieces.filter((x) => AUTOMATION_TOOL_NAMES.includes(x.name));
p("", "");
p("== C accountModelSurface 逐件口径（auto 档，全挂）==", "");
p("面内工具件数 / 工具 JSON", String(autoFace.length) + " 件 / " + String(acct.toolSpecChars) + " 字符");
p("固定面 fixedChars", String(acct.fixedChars) + " 字符（帽 " + String(MODEL_SURFACE_TOTAL_CHAR_LIMIT) + " ⇒ " + ((acct.fixedChars / MODEL_SURFACE_TOTAL_CHAR_LIMIT) * 100).toFixed(1) + "%）");
let pieceSum = 0;
for (const d of dropped) { pieceSum += d.chars; p("  piece " + d.name, String(d.chars).padStart(5) + " 字符  tier=" + d.tier); }
p("五件 pieces 相加", String(pieceSum) + "（与 surfaceSpecChars 差 " + String(pieceSum - surfaceSpecChars(five)) + "：逐件口径多记的是它们与邻居之间的逗号）");

const leanFace = autoFace.filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name));
const leanAcct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: leanFace, coreNames });
p("", "");
p("== D 摘掉五件后每轮省多少（HEAD）==", "");
p("摘后", leanFace.length + " 件 / 固定面 " + String(leanAcct.fixedChars) + " 字符");
p("每轮省", String(acct.fixedChars - leanAcct.fixedChars) + " 字符 ＝ 固定面的 " + (((acct.fixedChars - leanAcct.fixedChars) / acct.fixedChars) * 100).toFixed(1) + "%");
p("省下的两种 token 尺", "CJK " + String(estimateTextTokens(JSON.stringify(five))) + " tok；/3.6 " + String(Math.round(surfaceSpecChars(five) / 3.6)) + " tok");
p("生产现读形状（default 档已摘 refine_goal/lsp）", "");
const prodFace = sessionToolSpecs({ mode: "default", omitTools: [...OPTIONAL_TOOL_NAMES.goalTools, ...OPTIONAL_TOOL_NAMES.lspTools] }).specs;
const prodAcct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: prodFace, coreNames });
const prodLean = prodFace.filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name));
const prodLeanAcct = accountModelSurface({ systemChars: BASE_SYSTEM.length, specs: prodLean, coreNames });
p("  今天实发", prodFace.length + " 件 / " + String(prodAcct.fixedChars) + " 字符");
p("  再摘五件", prodLean.length + " 件 / " + String(prodLeanAcct.fixedChars) + " 字符 ⇒ 省 " + String(prodAcct.fixedChars - prodLeanAcct.fixedChars));

p("", "");
p("== E 前置关系：哪一件是其余四件的说明书 ==", "");
type Props = { properties?: Record<string, { description?: string }> };
const fieldDoc = (s: (typeof five)[number], f: string): string => ((s.function.parameters as Props).properties ?? {})[f]?.description ?? "";
const create = five.find((s) => s.function.name === "automation_create")!;
const others = five.filter((s) => s.function.name !== "automation_create");
p("create 单件字符", String(JSON.stringify(create).length) + "（五件的 " + ((JSON.stringify(create).length / surfaceSpecChars(five)) * 100).toFixed(1) + "%）");
p("其余四件字符", String(others.reduce((a, s) => a + JSON.stringify(s).length, 0)));
for (const s of others) {
  const text = JSON.stringify(s);
  p("  " + s.function.name, "文中提到 create：" + String(text.includes("create")) + "；含 kind 形状文档：" + String(text.includes("once+at")) + "；id 描述原文：" + fieldDoc(s, "id"));
}
p("create 的 schedule 字段文档", String(fieldDoc(create, "schedule").length) + " 字符（这份 kind 文档只出现在 create）");
p("UNATTENDED 那句在面内出现次数", String(five.reduce((a, s) => a + (JSON.stringify(s).includes("无人值守跑的") ? 1 : 0), 0)) + "（create 全文 / update 用「同 create」指回）");

p("", "");
p("== F 只读档是否已经在摘（HEAD）==", "");
const ro = gateToolSpecs("read-only").map((s) => s.function.name);
p("read-only 面里五件", ro.filter((n) => AUTOMATION_TOOL_NAMES.includes(n)).length + " 个（0 = 只读档已整族摘除）");
p("read-only 固定面", accountModelSurface({ systemChars: systemPromptFor("read-only").length, specs: sessionToolSpecs({ mode: "read-only" }).specs, coreNames }).fixedChars + " 字符");
p("五件是否 core", AUTOMATION_TOOL_NAMES.filter((n) => isCoreSurfaceTool(n)).length + " 个是 core（0 = 降配梯可砍）");

p("", "");
p("== G 规格面拼接点与摘除点（HEAD 静态可测）==", "");
p("gateToolSpecs 无条件 push", "specs.push(...automationToolSpecs()) 在 auto/default 恒进面；read-only 与 automationTools:false 各摘一次");
console.log(out.join("\n"));
