import { describe, expect, it, vi } from "vitest";
import { runLoop } from "../src/agent/loop";
import { skillToolPolicy } from "../src/agent/plugins/skills";
import type { AgentEvent } from "../src/events";
import type { ProviderMessage } from "../src/providers";
import { resolveToolName, type Tool } from "../src/tools/base";

describe("tool name lookup", () => {
  it("preserves canonical names and Claude Code aliases", () => {
    expect(resolveToolName("read_file")).toBe("read_file");
    expect(resolveToolName(" Read ")).toBe("read_file");
    expect(resolveToolName("Bash")).toBe("run_shell");
  });

  it.each(["constructor", "__proto__"])("reports %s as an unknown declaration", (name) => {
    expect(resolveToolName(name)).toBeNull();
    expect(skillToolPolicy({ "allowed-tools": name, "disallowed-tools": name })).toEqual({
      allow: [], deny: [], unknown: [`allow:${name}`, `deny:${name}`],
    });
  });

  it.each([undefined, {}] satisfies Array<Record<string, Tool> | undefined>)(
    "returns unknown tool feedback for inherited registry properties (%j)",
    async (tools) => {
      const log: AgentEvent[] = [];
      const requests: ProviderMessage[][] = [];
      await runLoop({
        workspace: "/tmp", tools,
        events: { async append(event) { log.push(event); } },
        provider: {
          async *stream(messages) {
            requests.push(messages);
            if (requests.length === 1) yield { type: "tool_call", id: "unknown", name: "constructor", args: {} };
          },
        },
      });
      expect(log.filter((event) => event.type === "tool_result")).toMatchObject([
        { callId: "unknown", ok: false, output: "unknown tool: constructor" },
      ]);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.filter((message) => message.role === "tool")).toEqual([
        { role: "tool", tool_call_id: "unknown", content: "unknown tool: constructor" },
      ]);
    },
  );

  it("resolves a registered dynamic tool when its name also exists on Object.prototype", async () => {
    const log: AgentEvent[] = [];
    const run = vi.fn<Tool["run"]>(async () => ({ ok: true, output: "dynamic tool executed" }));
    const resolveTool = vi.fn((name: string) => name === "constructor" ? { name, run } : undefined);
    let turns = 0;
    await runLoop({
      workspace: "/tmp", tools: {}, resolveTool,
      events: { async append(event) { log.push(event); } },
      provider: {
        async *stream() {
          if (++turns === 1) yield { type: "tool_call", id: "dynamic", name: "constructor", args: { value: "test" } };
        },
      },
    });
    expect(resolveTool).toHaveBeenCalledExactlyOnceWith("constructor");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ value: "test" });
    expect(log.filter((event) => event.type === "tool_result")).toMatchObject([
      { callId: "dynamic", ok: true, output: "dynamic tool executed" },
    ]);
    expect(turns).toBe(2);
  });
});
