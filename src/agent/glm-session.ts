// 暗卷用会话型 provider：src/providers 只读（M1a 定稿），本文件只调用 streamGlm 不改它。
// 职责：从事件日志重建 OpenAI 兼容对话历史（含 tool_calls / tool 角色），把工具结果反馈回模型，
// 使真实 GLM 能多轮调用 clarify / propose_plan / write_file / verify。
import { createEventLog, replay, type AgentEvent, type CompactionUsage } from "../events";
import { isSideEffectTool, type PermissionMode } from "../permissions";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";
import type { ModelOutput, Provider } from "../providers";
import { projectContext } from "./context";
import {
  DEFAULT_COMPACTION_CONFIG,
  CompactionCoordinator,
  calibrateFactor,
  estimateContextTokens,
  shouldCompact,
  type AssemblyOverhead,
  type CompactionConfig,
  type Summarizer,
  type SummarizerInput,
  type SummarizerOutput,
} from "./compaction";

type RawMessage = Record<string, unknown>;

/** 三门 + 基础工具的 OpenAI function 规格（暗卷把工具面暴露给真实模型）。
 * M1c：mode=read-only 时写向工具从工具表摘除（§11.7.2，与 toolTableFor 同源）。 */
export function gateToolSpecs(mode?: PermissionMode): GlmToolSpec[] {
  const obj = (props: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
    type: "object",
    properties: props,
    required,
  });
  const specs: GlmToolSpec[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "读取工作区内文件（workspace 相对路径）",
        parameters: obj({ path: { type: "string", description: "workspace 相对路径" } }, ["path"]),
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "写入工作区内文件（覆盖式）",
        parameters: obj(
          { path: { type: "string" }, content: { type: "string" } },
          ["path", "content"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "run_shell",
        description: "在工作区内执行 bash 命令",
        parameters: obj({ command: { type: "string" } }, ["command"]),
      },
    },
    {
      type: "function",
      function: {
        name: "clarify",
        description: "任务有歧义时向用户提问；1–4 个问题，每问 2–4 个选项或缺省自由补充",
        parameters: obj(
          {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  header: { type: "string" },
                  multiSelect: { type: "boolean" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { label: { type: "string" }, description: { type: "string" } },
                      required: ["label"],
                    },
                  },
                },
                required: ["question"],
              },
            },
          },
          ["questions"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "propose_plan",
        description: "写文件前提交方案等用户批准；批准前 write_file/run_shell 会被权限层拒绝",
        parameters: obj(
          {
            goal: { type: "string" },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  action: { type: "string", enum: ["create", "edit", "delete"] },
                  summary: { type: "string" },
                },
                required: ["path", "action", "summary"],
              },
            },
            approach: { type: "string" },
            verify: {
              type: "object",
              properties: {
                lint: { type: "array", items: { type: "string" } },
                test: { type: "array", items: { type: "string" } },
              },
            },
          },
          ["goal", "files"],
        ),
      },
    },
    {
      type: "function",
      function: {
        name: "verify",
        description: "按仓库 verify 配置跑 lint/test；通过则任务收束，失败会反馈错误继续修",
        parameters: obj({}, []),
      },
    },
  ];
  if (mode === "read-only") {
    return specs.filter((s) => !isSideEffectTool(s.function.name));
  }
  return specs;
}

/** 事件日志 → OpenAI 兼容消息序列。
 *  M1d：改走组装器投影 projectContext——compaction 感知（跳过被压 id、offset 注入摘要、fresh start），
 *  assistant_delta 合并与 tool 角色映射逻辑与旧版逐字同构。 */
export async function buildGlmHistory(logPath: string): Promise<RawMessage[]> {
  return projectContext(await replay(logPath)) as unknown as RawMessage[];
}

/** GLM 暗卷摘要器：非流式单轮调用（thinking/streaming 关），只调用只读的 src/providers/glm.ts。 */
export function createGlmSummarizer(): Summarizer {
  return async (input: SummarizerInput): Promise<SummarizerOutput> => {
    const msgs: GlmMessage[] = [
      { role: "system", content: input.system },
      {
        role: "user",
        content:
          (input.priorSummary ? "[上一份摘要（滚动合并输入）]\n" + input.priorSummary + "\n\n" : "") +
          "[压缩范围内的会话记录]\n" +
          input.conversation,
      },
    ];
    let text = "";
    let usage: CompactionUsage | undefined;
    for await (const e of streamGlm(msgs, { stream: false })) {
      if (e.type === "assistant_delta") text += e.text;
      else if (e.type === "usage") usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens };
    }
    if (!text.trim()) throw new Error("GLM 摘要器返回空摘要");
    return { text, usage, model: process.env.M0_MODEL ?? "glm-5.2" };
  };
}

export interface GlmSessionCompaction {
  config?: Partial<CompactionConfig>;
  /** 缺省 = M0_API_KEY 在场时用 GLM 暗卷摘要器。 */
  summarizer?: Summarizer;
  /** system prompt / 工具 schema / 记忆注入开销字符数（触发估算全量计入，§7.3(a)）。 */
  overhead?: AssemblyOverhead;
}

/** 会话型 provider：队列耗尽且上一轮含 tool_call 时重建历史再要下一轮；纯文本回复 = 任务结束。
 *  M1d：每次组装前做双条件触发检查——命中即压缩（compaction 事件落盘）再重组装（fresh start）。 */
export function createGlmSessionProvider(
  logPath: string,
  opts: { system?: string; tools?: GlmToolSpec[]; compaction?: GlmSessionCompaction } = {},
): Provider {
  let queue: AgentEvent[] = [];
  let lastHadToolCalls: boolean | null = null; // null = 尚未请求过
  const coordinator = opts.compaction
    ? new CompactionCoordinator({
        config: opts.compaction.config,
        summarizer: opts.compaction.summarizer ?? (process.env.M0_API_KEY ? createGlmSummarizer() : undefined),
      })
    : null;
  const assemble = async (): Promise<{ events: AgentEvent[]; history: ReturnType<typeof projectContext> }> => {
    const events = await replay(logPath);
    return { events, history: projectContext(events) };
  };
  return {
    async next(): Promise<ModelOutput | null> {
      if (queue.length > 0) return queue.shift() as ModelOutput;
      if (lastHadToolCalls === false) return null; // 模型收尾（纯文本）→ 任务结束
      let { events, history } = await assemble();
      // M1d 触发检查：估算含 system/tools/记忆全量开销；B（硬兜底）→ overflow 紧急截断
      if (coordinator && opts.compaction) {
        const factor = calibrateFactor(events);
        const estimate = estimateContextTokens(history, opts.compaction.overhead ?? {}, factor);
        const decision = shouldCompact(estimate, {
          ...DEFAULT_COMPACTION_CONFIG,
          ...opts.compaction.config,
        });
        const outcome = await coordinator.maybeCompact(events, decision);
        if (outcome?.ok) {
          await createEventLog(logPath).append(outcome.event);
          ({ events, history } = await assemble()); // fresh start：重组装（摘要 + tail）
        } else if (outcome && outcome.kind === "failed" && coordinator.summarizerDisabled) {
          console.warn("[compaction] 连续摘要失败已达上限，本会话停用摘要（仅 overflow 紧急截断可用）");
        }
      }
      const msgs: GlmMessage[] = [];
      if (opts.system) msgs.push({ role: "system", content: opts.system });
      for (const m of history) msgs.push(m as unknown as GlmMessage);
      queue = [];
      for await (const e of streamGlm(msgs, {}, opts.tools)) queue.push(e);
      lastHadToolCalls = queue.some((e) => e.type === "tool_call");
      if (queue.length === 0) return null;
      return queue.shift() as ModelOutput;
    },
  };
}
