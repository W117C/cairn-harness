// 第二段读数：易变侧到底有多大 —— 降配梯看不见的那部分。
//
// 口径：本文件只做「把各块硬帽换算成字符/token，再与 MODEL_SURFACE_TOTAL_CHAR_LIMIT 对照」。
// 全部数字取自 src/ 的常量与真函数，不是估计。所有帽以字符登记的与以 token 登记的**分开列**，
// 绝不混算（model-surface.ts:9-13 点的正是这个坑）。
import { MODEL_SURFACE_TOTAL_CHAR_LIMIT } from "../../src/agent/model-surface";
import { estimateTextTokens } from "../../src/agent/text-budget";
import { MEMORY_TOKEN_BUDGET_DEFAULT } from "../../src/agent/memory/inject";
import { SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL, SKILL_ROUTING_CHAR_LIMIT } from "../../src/agent/plugins/skills";
import { MAP_TOKENS_DEFAULT, MAP_TOKENS_MAX } from "../../src/agent/map/render";
import { HOOK_CONTEXT_TOTAL_CHAR_LIMIT, HOOK_OUTPUT_CAP } from "../../src/agent/plugins/hooks";

const line = (s = "") => console.log(s);
const hr = (t: string) => line(`\n${"═".repeat(74)}\n${t}\n${"═".repeat(74)}`);

// 降配梯看得见的那一半（甲口径实测，见 measure.mts §1）
const LADDER_VISIBLE_CHARS = 11_498;   // BASE_SYSTEM 697 + 工具 JSON 10,801
const LADDER_VISIBLE_TOK = 4_615;

hr("§1 降配梯看得见的：固定面");
line(`  BASE_SYSTEM + 工具 JSON = ${String(LADDER_VISIBLE_CHARS).padStart(6)} chars / ${String(LADDER_VISIBLE_TOK).padStart(5)} tok`);
line(`  帽 MODEL_SURFACE_TOTAL_CHAR_LIMIT = ${String(MODEL_SURFACE_TOTAL_CHAR_LIMIT).padStart(6)} chars`);
line(`  梯的判词：「${(LADDER_VISIBLE_CHARS / MODEL_SURFACE_TOTAL_CHAR_LIMIT * 100).toFixed(1)}%，在帽内」`);

hr("§2 降配梯看不见的：易变侧四块，各自的硬帽");
line(`  ${"块".padEnd(18)}${"硬帽常量".padEnd(34)}${"登记口径".padStart(6)}${"折字符（中文）".padStart(14)}${"折字符（英文）".padStart(14)}`);
const rows: [string, string, number, "char" | "tok"][] = [
  ["记忆注入", `MEMORY_TOKEN_BUDGET_DEFAULT=${MEMORY_TOKEN_BUDGET_DEFAULT}`, MEMORY_TOKEN_BUDGET_DEFAULT, "tok"],
  ["skill 重挂·单篇", `SKILL_REMOUNT_TOKENS_PER_SKILL=${SKILL_REMOUNT_TOKENS_PER_SKILL}`, SKILL_REMOUNT_TOKENS_PER_SKILL, "tok"],
  ["skill 重挂·合计", `SKILL_REMOUNT_TOKENS_TOTAL=${SKILL_REMOUNT_TOKENS_TOTAL}`, SKILL_REMOUNT_TOKENS_TOTAL, "tok"],
  ["skill 路由清单", `SKILL_ROUTING_CHAR_LIMIT=${SKILL_ROUTING_CHAR_LIMIT}`, SKILL_ROUTING_CHAR_LIMIT, "char"],
  ["符号地图·缺省", `MAP_TOKENS_DEFAULT=${MAP_TOKENS_DEFAULT}`, MAP_TOKENS_DEFAULT, "tok"],
  ["符号地图·上限", `MAP_TOKENS_MAX=${MAP_TOKENS_MAX}`, MAP_TOKENS_MAX, "tok"],
  ["hook 上下文", `HOOK_CONTEXT_TOTAL_CHAR_LIMIT=${HOOK_CONTEXT_TOTAL_CHAR_LIMIT}`, HOOK_CONTEXT_TOTAL_CHAR_LIMIT, "char"],
  ["hook 单条输出", `HOOK_OUTPUT_CAP=${HOOK_OUTPUT_CAP}`, HOOK_OUTPUT_CAP, "char"],
];
for (const [name, konst, v, unit] of rows) {
  const zh = unit === "char" ? v : v;                 // 中文 1 字≈1 tok ⇒ 字符数≈token 数
  const en = unit === "char" ? v : v * 4;             // 英文 4 字符≈1 tok
  line(`  ${name.padEnd(18)}${konst.padEnd(34)}${unit.padStart(6)}${String(zh).padStart(14)}${String(en).padStart(14)}`);
}
line();
line(`  折算依据：estimateTextTokens 的字重表（src/agent/text-budget.ts:26-40）——`);
line(`    宽字符（CJK/全角）1 字 = 1 token；其余 0.25 token/字符 = 4 字符 1 token。`);

hr("§3 对照：两个帽同值，却各不承认对方");
line(`  HOOK_CONTEXT_TOTAL_CHAR_LIMIT = ${HOOK_CONTEXT_TOTAL_CHAR_LIMIT}（hook 上下文，字符）`);
line(`  MODEL_SURFACE_TOTAL_CHAR_LIMIT  = ${MODEL_SURFACE_TOTAL_CHAR_LIMIT}（系统提示+工具，字符）`);
line(`  两者**同值**，但：hook 上下文进 skills 块，而 skills 块不在后者口径里；`);
line(`  反过来后者算的那些也不在 hook 上下文的口径里。⇒ 一个 session 可以同时`);
line(`  「hook 上下文占满 24,000 字符」且「工具面只占 24,000 的 47.9%」——两句话都真，都不越自己的帽。`);

hr("§4 易变侧合计 vs 降配梯的视野");
const zhWorst = MEMORY_TOKEN_BUDGET_DEFAULT + SKILL_REMOUNT_TOKENS_TOTAL + SKILL_ROUTING_CHAR_LIMIT + MAP_TOKENS_MAX + HOOK_CONTEXT_TOTAL_CHAR_LIMIT;
const enWorst = MEMORY_TOKEN_BUDGET_DEFAULT * 4 + SKILL_REMOUNT_TOKENS_TOTAL * 4 + SKILL_ROUTING_CHAR_LIMIT + MAP_TOKENS_MAX * 4 + HOOK_CONTEXT_TOTAL_CHAR_LIMIT;
line(`  易变侧最坏合计（中文）≈ ${zhWorst} 字符`);
line(`  易变侧最坏合计（英文）≈ ${enWorst} 字符`);
line(`  降配梯看得见的             = ${LADDER_VISIBLE_CHARS} 字符`);
line(`  ⇒ 易变侧最坏是梯视野的 ${(zhWorst / LADDER_VISIBLE_CHARS).toFixed(1)} 倍（中文）/ ${(enWorst / LADDER_VISIBLE_CHARS).toFixed(1)} 倍（英文）`);
line();
line(`  真实每轮固定成本（中文最坏）= ${LADDER_VISIBLE_CHARS} + ${zhWorst} = ${LADDER_VISIBLE_CHARS + zhWorst} 字符`);
line(`  降配梯给出的判词             = 「${LADDER_VISIBLE_CHARS} / ${MODEL_SURFACE_TOTAL_CHAR_LIMIT} = ${(LADDER_VISIBLE_CHARS / MODEL_SURFACE_TOTAL_CHAR_LIMIT * 100).toFixed(1)}%，很安全」`);
line(`  ⇒ 真实成本是帽的 ${((LADDER_VISIBLE_CHARS + zhWorst) / MODEL_SURFACE_TOTAL_CHAR_LIMIT).toFixed(1)} 倍，梯却报「安全」。`);

hr("§5 但别夸大：这一轮请求**不是**静默超支");
line(`  ① compaction 那侧**全量计了**易变块（glm-session.ts:937-941 的 AssemblyOverhead：`);
line(`     systemChars 里含 skillsBlock 与 attachmentContext，另计 memoryChars / mapChars）；`);
line(`  ② 最终还有一道 fail-closed 硬闸（glm-session.ts:1002-1010）：`);
line(`     finalChars = JSON.stringify({messages, tools}).length，超限直接 throw，**请求不发**。`);
line();
line(`  ⇒ 准确的说法不是「默默多花钱」，而是：`);
line(`     **降配梯在真正该出刀的那一轮永远不出刀**——它只看得见固定面，而压力来自易变侧。`);
line(`     于是压力全部落到压缩（削历史）或硬闸（整轮失败）两条路上，`);
line(`     「削工具面」这条最便宜的路被结构性地排除了。`);