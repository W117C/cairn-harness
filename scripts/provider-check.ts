// provider:check —— GLM 真连验收（联网）。断言：
//   ①真实流式调用收到 ≥2 个 delta   ②usage 的 input/output 均 > 0
//   ③带 tools 的请求能解析出至少一个 tool_call。
// 环境缺 M0_API_KEY → 退出码 1（联网验收被阻塞，见 BLOCKED.md），绝不伪造 delta。
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
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

if (!process.env.M0_API_KEY) {
  console.error("[provider:check] M0_API_KEY 未设置 —— 真连验收被阻塞（BLOCKED.md 已备案），退出码 1。");
  process.exitCode = 1;
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
} else if (process.exitCode !== 1) {
  console.log("[provider:check] 全部断言通过");
}
