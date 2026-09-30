// 每轮固定开销的**尺子**（2026-09-30 P1 立项）。
//
// 为什么要一把专门的尺：这个仓库量「测试绿不绿」「门过不过」「变异杀没杀」的尺子很多，
// 但「每一轮对话要付多少 token 的固定开销」这一格**从来没有过读数**——
// 而它是每轮都要付一次的钱：15 个工具的说明书 + 系统提示词在**每一轮**重送。
// 2026-09-30 实测（真模型、真任务）：
//   单行 bug 修复   7 轮  31,902 输入 token（缓存命中 74.6%）
//   跨 4 文件修复 16 轮  80,635 输入 token（缓存命中 82.0%）
//   其中第一轮 3,978 token 里有 2,281 是这块固定开销（57%）。
//
// 这把尺量的是**静态段**：模型每次请求都要重发的那部分。
// 它不量对话增长、不量工具返回、不量压缩——那些是别的格子的账。
//
// 用法：
//   node --import tsx scripts/prompt-cost.ts            # 四档面逐个报
//   node --import tsx scripts/prompt-cost.ts --json     # 机器可读（给回归对比用）
//
// 退出码恒 0：它是尺子不是门（红了要拦谁也没想清楚）。哪天要拦，登记进 GATES 再谈。
import { sessionToolSpecs } from "../src/agent/glm-session";
import { AUTOMATION_TOOL_NAMES } from "../src/agent/automation-surface";
import { BASE_SYSTEM } from "../src/main/agent-runner";
import { PERMISSION_MODES, type PermissionMode } from "../src/permissions";

/** 估算 token：不引第三方分词器（本仓依赖面刻意小），按字符数 /3.6 折算。
 *  这个系数的口径来自实测反推：同一份静态段在真请求里量到的 input_tokens 与之同量级。
 *  它**只用于横向比较**（改前 vs 改后、这一档 vs 那一档），不当绝对值用——
 *  要绝对值请读事件流里的 `usage` 事件（那是厂商给的数）。 */
export const CHARS_PER_TOKEN = 3.6;
export const estTokens = (s: string): number => Math.round(s.length / CHARS_PER_TOKEN);

export interface FaceCost {
  mode: PermissionMode;
  tools: number;
  toolTokens: number;
  systemTokens: number;
  totalTokens: number;
  perTool: { name: string; tokens: number }[];
}

/** 某一档的模型可见工具面成本。`automation: false` = CLI 的取值（定时五件两面同摘）。 */
export function faceCost(mode: PermissionMode, automation = false): FaceCost {
  const all = sessionToolSpecs({ mode }).specs;
  const specs = automation ? all : all.filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name));
  const perTool = specs
    .map((s) => ({ name: s.function.name, tokens: estTokens(JSON.stringify(s)) }))
    .sort((a, b) => b.tokens - a.tokens);
  const toolTokens = perTool.reduce((a, t) => a + t.tokens, 0);
  const systemTokens = estTokens(BASE_SYSTEM);
  return { mode, tools: specs.length, toolTokens, systemTokens, totalTokens: toolTokens + systemTokens, perTool };
}

function main(): void {
  const asJson = process.argv.includes("--json");
  const faces = PERMISSION_MODES.map((m) => faceCost(m, false));
  if (asJson) {
    process.stdout.write(JSON.stringify({ charsPerToken: CHARS_PER_TOKEN, faces }, null, 2) + "\n");
    return;
  }
  console.log("== 每轮固定开销（静态段：工具说明书 + 系统提示词）==");
  console.log("估算口径：字符数 / " + String(CHARS_PER_TOKEN) + "（横向比较用；绝对值看事件流的 usage）");
  console.log("");
  const base = faces.find((f) => f.mode === "default")!;
  for (const f of faces) {
    console.log(
      "  " + f.mode.padEnd(10)
      + String(f.tools).padStart(3) + " 件"
      + "  工具 " + String(f.toolTokens).padStart(5) + " tok"
      + "  系统 " + String(f.systemTokens).padStart(4) + " tok"
      + "  ⇒ 合计 " + String(f.totalTokens).padStart(5) + " tok/轮",
    );
  }
  console.log("");
  console.log("  最大面（" + base.mode + "）逐件：");
  for (const t of base.perTool) {
    const pct = ((100 * t.tokens) / base.toolTokens).toFixed(0);
    console.log("    " + t.name.padEnd(20) + String(t.tokens).padStart(5) + " tok  " + pct.padStart(3) + "%");
  }
  console.log("");
  // 可选面单独记账：这三组各自有「能力没用上就纯浪费」的判据，是 P1 的裁剪候选。
  const optional: Record<string, string[]> = {
    "子代理三件（不派 worker 时纯浪费）": ["spawn_agent", "wait_for_agents", "cancel_agents"],
    "remember（autoMemory 关掉后无消费者）": ["remember"],
    "refine_goal（没武装目标时该工具恒 fail-closed）": ["refine_goal"],
  };
  for (const [label, names] of Object.entries(optional)) {
    const hit = base.perTool.filter((t) => names.includes(t.name));
    const sum = hit.reduce((a, t) => a + t.tokens, 0);
    if (hit.length === 0) {
      console.log("  ⚠️ " + label + "：一个都没在面上（名单陈旧？）");
      continue;
    }
    console.log("  " + label.padEnd(48) + " 省 " + String(sum).padStart(5) + " tok/轮"
      + "（" + ((100 * sum) / base.totalTokens).toFixed(0) + "% 的固定开销）");
  }
  console.log("");
  console.log("  静态段占第一轮的比例（实测第一轮 3,978 tok）："
    + ((100 * base.totalTokens) / 3978).toFixed(0) + "%");
}

main();
