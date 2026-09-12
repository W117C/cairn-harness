// provider:check —— GLM 真连验收（联网）。断言：
//   ①真实流式调用收到 ≥2 个 delta   ②usage 的 input/output 均 > 0
//   ③带 tools 的请求能解析出至少一个 tool_call   ④事件落 JSONL 重放逐字一致。
// 环境缺 M0_API_KEY → 记 UNVERIFIED=1（联网验收被阻塞，见 BLOCKED.md），
// 默认 exit 0 但由 gates 汇总为「未证，不得宣称全绿」；DSH_STRICT_UNVERIFIED=1
// 或 --strict-unverified 时判红（CI / 有凭据环境）。绝不伪造 delta。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeAssistantDeltas,
  type AgentEvent,
  type AssistantDeltaEvent,
  type ToolCallEvent,
  type UsageEvent,
} from "../src/events";
import { createEventLog, replay } from "../src/events";
import { streamGlm, type GlmToolSpec } from "../src/providers/glm";

let failures = 0;
/** 未证项（前提不成立、断言无从谈起的场景）——显式记账并上报，绝不静默算绿。 */
const unverified: string[] = [];
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

if (!process.env.M0_API_KEY) {
  console.error("[provider:check] M0_API_KEY 未设置 —— 真连验收被阻塞（BLOCKED.md 已备案）。");
  unverified.push("GLM 真连 ①②③④：缺 M0_API_KEY → 未证（非跳过即通过）");
} else {
  const dir = await mkdtemp(join(tmpdir(), "m1a-provider-check-"));
  try {
    const logPath = join(dir, "glm-events.jsonl");
    const log = createEventLog(logPath);
    // 端点/模型/key 均由 glm.ts 从环境变量读取（M0_ENDPOINT / M0_MODEL / M0_API_KEY）

    console.log("[provider:check] 调用①：纯文本流式（无 tools，stream=true + 默认模型）");
    const events1: AgentEvent[] = [];
    for await (const e of streamGlm([{ role: "user", content: "用三句话介绍 Node.js 的事件循环。" }])) {
      events1.push(e);
      await log.append(e);
    }
    const deltas1 = events1.filter((e): e is AssistantDeltaEvent => e.type === "assistant_delta");
    const usage1 = events1.find((e): e is UsageEvent => e.type === "usage");
    const merged = mergeAssistantDeltas(deltas1);
    console.log(
      "  delta=" + String(deltas1.length) +
        " usage=" + (usage1 ? `${String(usage1.inputTokens)}/${String(usage1.outputTokens)}` : "缺失") +
        " 合成文本[" + String(merged.length) + "字]: " + merged.slice(0, 48).replace(/\n/g, " "),
    );
    assert(deltas1.length >= 2, "①收到 ≥2 个 delta（实际 " + String(deltas1.length) + "）");
    assert(
      usage1 !== undefined && usage1.inputTokens > 0 && usage1.outputTokens > 0,
      "②usage 的 input/output 均 > 0" + (usage1 ? `（${String(usage1.inputTokens)}/${String(usage1.outputTokens)}）` : "（缺失）"),
    );

    console.log("[provider:check] 调用②：带 tools 的请求（应解析出 tool_call）");
    const tools: GlmToolSpec[] = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "读取工作区内文件的文本内容",
          parameters: {
            type: "object",
            properties: { path: { type: "string", description: "工作区相对路径" } },
            required: ["path"],
          },
        },
      },
    ];
    const events2: AgentEvent[] = [];
    for await (const e of streamGlm([{ role: "user", content: "请调用工具读取 src/todo.ts 的内容。" }], undefined, tools)) {
      events2.push(e);
      await log.append(e);
    }
    const calls2 = events2.filter((e): e is ToolCallEvent => e.type === "tool_call");
    console.log("  tool_call=" + JSON.stringify(calls2.map((c) => ({ name: c.name, args: c.args }))));
    assert(calls2.length >= 1, "③带 tools 的请求能解析出至少一个 tool_call");

    console.log("[provider:check] 事件落 JSONL 重放往返");
    const fromDisk = await replay(logPath);
    assert(
      fromDisk.length === events1.length + events2.length &&
        JSON.stringify(fromDisk) === JSON.stringify([...events1, ...events2]),
      "两轮事件全部落 JSONL 且 replay 逐字一致（" + String(fromDisk.length) + " 条）",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error("[provider:check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
}

// 机器可读标记（H-2）：让 pnpm gates 把「未证」上浮到门禁汇总与严格模式判定。
console.log("UNVERIFIED=" + String(unverified.length));
if (unverified.length > 0) {
  console.log("[provider:check] 未证项（前提不成立、断言无从谈起——不等于通过）：");
  for (const u of unverified) console.log("  ⚠️  " + u);
}

const strict = process.env.DSH_STRICT_UNVERIFIED === "1" || process.argv.includes("--strict-unverified");
if (strict && unverified.length > 0) {
  console.error("[provider:check] 严格模式（DSH_STRICT_UNVERIFIED=1）：存在未证项，判红");
  process.exitCode = 1;
}

if (failures === 0 && process.exitCode !== 1) {
  console.log(
    unverified.length > 0
      ? "[provider:check] 断言全过，但有 " + String(unverified.length) + " 项未证（不得宣称全绿）"
      : "[provider:check] 全部断言通过",
  );
}
