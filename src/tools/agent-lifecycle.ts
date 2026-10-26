import type { AgentRuntime } from "../agent/runtime-types";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base";

export const SEND_AGENT_TOOL = "send_agent";
export const LIST_AGENTS_TOOL = "list_agents";
export const RESUME_AGENT_TOOL = "resume_agent";
export const CLOSE_AGENT_TOOL = "close_agent";

export interface AgentLifecycleHost {
  current(): AgentRuntime | null;
}

export interface AgentLifecycleTools {
  send_agent: Tool;
  list_agents: Tool;
  resume_agent: Tool;
  close_agent: Tool;
}

function runtimeOf(host: () => AgentRuntime | null): AgentRuntime | null {
  return host();
}

function notWired(tool: string): ToolResult {
  return { ok: false, output: tool + ": AgentRuntime 未接线（fail-closed）" };
}

function requiredString(args: Record<string, unknown>, key: string, tool: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError(tool + ": " + key + " 必须是非空字符串");
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string, tool: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError(tool + ": " + key + " 必须是非空字符串");
  }
  return value;
}

export function createAgentLifecycleTools(host: () => AgentRuntime | null): AgentLifecycleTools {
  return {
    send_agent: {
      name: SEND_AGENT_TOOL,
      async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
        const runtime = runtimeOf(host);
        if (runtime === null) return notWired(SEND_AGENT_TOOL);
        const threadId = requiredString(args, "thread_id", SEND_AGENT_TOOL);
        const text = requiredString(args, "message", SEND_AGENT_TOOL);
        const messageId = optionalString(args, "message_id", SEND_AGENT_TOOL) ?? ctx.callId;
        if (messageId === undefined || messageId === "") {
          throw new ToolError(SEND_AGENT_TOOL + ": message_id 缺失且当前调用没有 callId，无法保证幂等投递");
        }
        const fence = optionalString(args, "fence", SEND_AGENT_TOOL);
        const receipt = await runtime.send(threadId, { id: messageId, text }, fence);
        return { ok: receipt.ok, output: JSON.stringify(receipt) };
      },
    },
    list_agents: {
      name: LIST_AGENTS_TOOL,
      async run(): Promise<ToolResult> {
        const runtime = runtimeOf(host);
        if (runtime === null) return notWired(LIST_AGENTS_TOOL);
        return { ok: true, output: JSON.stringify(await runtime.list()) };
      },
    },
    resume_agent: {
      name: RESUME_AGENT_TOOL,
      async run(args: Record<string, unknown>): Promise<ToolResult> {
        const runtime = runtimeOf(host);
        if (runtime === null) return notWired(RESUME_AGENT_TOOL);
        const threadId = requiredString(args, "thread_id", RESUME_AGENT_TOOL);
        const fence = requiredString(args, "fence", RESUME_AGENT_TOOL);
        try {
          return { ok: true, output: JSON.stringify(await runtime.resume(threadId, fence)) };
        } catch (error) {
          return {
            ok: false,
            output: RESUME_AGENT_TOOL + ": " + (error instanceof Error ? error.message : String(error)),
          };
        }
      },
    },
    close_agent: {
      name: CLOSE_AGENT_TOOL,
      async run(args: Record<string, unknown>): Promise<ToolResult> {
        const runtime = runtimeOf(host);
        if (runtime === null) return notWired(CLOSE_AGENT_TOOL);
        const threadId = requiredString(args, "thread_id", CLOSE_AGENT_TOOL);
        const receipt = await runtime.close(threadId);
        return { ok: receipt.ok, output: JSON.stringify(receipt) };
      },
    },
  };
}
