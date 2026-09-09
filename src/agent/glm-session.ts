// 暗卷用会话型 provider：src/providers 只读（M1a 定稿），本文件只调用 streamGlm 不改它。
// 职责：从事件日志重建 OpenAI 兼容对话历史（含 tool_calls / tool 角色），把工具结果反馈回模型，
// 使真实 GLM 能多轮调用 clarify / propose_plan / write_file / verify。
import { replay, type AgentEvent } from "../events";
import { streamGlm, type GlmMessage, type GlmToolSpec } from "../providers/glm";
import type { ModelOutput, Provider } from "../providers";

type RawMessage = Record<string, unknown>;

/** 三门 + 基础工具的 OpenAI function 规格（暗卷把工具面暴露给真实模型）。 */
export function gateToolSpecs(): GlmToolSpec[] {
  const obj = (props: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
    type: "object",
    properties: props,
    required,
  });
  return [
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
}

/** 事件日志 → OpenAI 兼容消息序列（assistant_delta 按 callId 合并；tool_result → tool 角色）。 */
export async function buildGlmHistory(logPath: string): Promise<RawMessage[]> {
  const events = await replay(logPath);
  const msgs: RawMessage[] = [];
  const deltaBuf = new Map<string, string>();
  const deltaOrder: string[] = [];
  const flushDeltas = (): void => {
    for (const callId of deltaOrder) {
      msgs.push({ role: "assistant", content: deltaBuf.get(callId) ?? "" });
    }
    deltaBuf.clear();
    deltaOrder.length = 0;
  };
  for (const e of events) {
    if (e.type === "user_message") {
      flushDeltas();
      msgs.push({ role: "user", content: e.content });
    } else if (e.type === "assistant_message") {
      flushDeltas();
      msgs.push({ role: "assistant", content: e.content });
    } else if (e.type === "assistant_delta") {
      if (!deltaBuf.has(e.callId)) deltaOrder.push(e.callId);
      deltaBuf.set(e.callId, (deltaBuf.get(e.callId) ?? "") + e.text);
    } else if (e.type === "tool_call") {
      flushDeltas();
      msgs.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: e.id,
            type: "function",
            function: { name: e.name, arguments: JSON.stringify(e.args) },
          },
        ],
      });
    } else if (e.type === "tool_result") {
      flushDeltas();
      msgs.push({ role: "tool", tool_call_id: e.callId, content: e.output });
    }
    // clarify_requested / plan_proposed / plan_approved / verify_result / usage：语义已在 tool_result 里，跳过
  }
  flushDeltas();
  return msgs;
}

/** 会话型 provider：队列耗尽且上一轮含 tool_call 时重建历史再要下一轮；纯文本回复 = 任务结束。 */
export function createGlmSessionProvider(
  logPath: string,
  opts: { system?: string; tools?: GlmToolSpec[] } = {},
): Provider {
  let queue: AgentEvent[] = [];
  let lastHadToolCalls: boolean | null = null; // null = 尚未请求过
  return {
    async next(): Promise<ModelOutput | null> {
      if (queue.length > 0) return queue.shift() as ModelOutput;
      if (lastHadToolCalls === false) return null; // 模型收尾（纯文本）→ 任务结束
      const history = await buildGlmHistory(logPath);
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
