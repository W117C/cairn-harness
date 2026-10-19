import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "../src/agent/plugins";
import type { WorkerHandle } from "../src/agent/orchestrator-types";
import type { Orchestrator } from "../src/agent/orchestrator";
import type { AskScope, ToolResultWithAudit } from "../src/permissions";

const renameHook = vi.hoisted(() => ({ before: null as ((target: string) => void) | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      renameHook.before?.(String(args[1]));
      return fs.rename(...args);
    },
  };
});

const temporaryDirs: string[] = [];
afterEach(async () => {
  renameHook.before = null;
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(mode: "default" | "auto" = "default", scope: AskScope = "once", cancelOnApproval = true) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "approval-cancel-race-"));
  temporaryDirs.push(dir);
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  vi.stubEnv("DSH_APPDATA", join(dir, "appdata"));
  vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory"));
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M1E_SAFE_MODE", "off");
  const { newAutonomySession } = await import("../src/permissions");
  const { AskGate } = await import("../src/main/ask-gate");
  const gates = await import("../src/main/tool-gates");
  const { write_file } = await import("../src/tools/write_file");
  const controller = new AbortController();
  const asked: string[] = [];
  const gate = new AskGate({
    timeoutMs: 3000,
    notify: (request) => {
      asked.push(request.tool);
      gate.decide(request.askId, true, "user", scope);
      if (cancelOnApproval) controller.abort();
    },
  });
  const autonomy = newAutonomySession(mode, { planBlocked: () => false });
  gates.setToolGateDeps({ currentSession: () => ({ askGate: gate, autonomy, sandbox: null }) });
  return {
    dir, workspace, controller, asked, gate, gates, autonomy,
    writer: gates.gatedTool("write_file", write_file),
    ctx: { workspace, signal: controller.signal },
    args: { path: "result.txt", content: "approved write" },
  };
}

async function expectNoWrite(workspace: string) {
  await expect(readFile(join(workspace, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
}

describe("批准与实际执行之间的取消不能丢失", () => {
  it("真实 runAgent 在批准后取消，不再写盘或返回写入成功", async () => {
    const s = await setup();
    const scriptPath = join(s.dir, "script.jsonl");
    await writeFile(scriptPath, [
      { type: "tool_call", id: "write", name: "write_file", args: s.args },
      { type: "assistant_message", content: "done" },
    ].map((event) => JSON.stringify(event)).join("\n"));
    vi.stubEnv("M1C_AUTONOMY_SCRIPT", scriptPath);
    vi.stubEnv("M0A_PROVIDER", "demo");
    const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
    initSettingsStore(join(s.dir, "settings.json"));
    await setSettings({ autoMemory: false, autoVerify: false, subagentTools: false, safeMode: "off" });
    const { runAgent } = await import("../src/main/agent-runner");
    const events = await runAgent({ workspace: s.workspace, logPath: join(s.dir, "run.jsonl"), message: "write", mode: "default", askGate: s.gate, signal: s.controller.signal });
    const results = events.filter((event) => event.type === "tool_result");
    expect(s.asked).toEqual(["write_file"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, gate: { verdict: "approved", scope: "once" } });
    expect(results[0]?.output).toContain("cancelled");
    await expectNoWrite(s.workspace);
  });

  it.each(["once", "session_kind", "always"] as const)("主会话 %s 批准后取消：保留批准审计，工具没有执行", async (scope) => {
    const s = await setup("default", scope);
    const result = await s.writer.run(s.args, s.ctx) as ToolResultWithAudit;
    expect(result).toMatchObject({ ok: false, gate: { verdict: "approved", scope } });
    expect(result.output).toContain("cancelled");
    await expectNoWrite(s.workspace);
  });

  it("自动放行的调用开始前已取消，同样不执行", async () => {
    const s = await setup("auto");
    s.controller.abort();
    const result = await s.writer.run(s.args, s.ctx) as ToolResultWithAudit;
    expect(result).toMatchObject({ ok: false, gate: { verdict: "auto-approved" } });
    expect(s.asked).toEqual([]);
    await expectNoWrite(s.workspace);
  });

  it("等待授权落盘期间取消，也不继续执行已批准的文件写入", async () => {
    const s = await setup("default", "always", false);
    const alwaysPath = join(s.workspace, ".agent", "permissions.always.json");
    renameHook.before = (target) => { if (target === alwaysPath) s.controller.abort(); };
    const result = await s.writer.run(s.args, s.ctx) as ToolResultWithAudit;
    expect(s.controller.signal.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, gate: { verdict: "approved", scope: "always" } });
    await expectNoWrite(s.workspace);
    // 运行取消不撤回用户刚刚明确选择的持久授权。
    expect(JSON.parse(await readFile(alwaysPath, "utf8")).rules).toHaveLength(1);
  });

  it("内部执行前复核等待期间取消，不再调用原始执行器", async () => {
    const s = await setup("auto");
    const execute = vi.fn(async () => ({ ok: true, output: "executed" }));
    const tool = s.gates.gatedTool("run_shell", { name: "run_shell", run: execute }, async () => {
      await Promise.resolve();
      s.controller.abort();
      return null;
    });
    const result = await tool.run({ command: "echo safe" }, s.ctx);
    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([true, false])("MCP 批准后 cancel=%s：只在未取消时调用服务器", async (cancel) => {
    const s = await setup("default", "once", cancel);
    const callTool = vi.fn(async () => ({ ok: true, output: "server result" }));
    const scopedName = "mcp__plugin_cancel_srv__write";
    // 仅替代服务器传输与工具清单，权限判定和真实 AskGate 保持原样。
    const runtime = {
      skills: () => [],
      mcp: { callTool },
      mcpTools: new Map([[scopedName, { name: "write", description: "write", scopedName, inputSchema: { type: "object" }, plugin: "cancel", server: "srv", grade: { annotated: true, readOnly: false } }]]),
    } as unknown as PluginRuntime;
    s.gates.installPluginTools(runtime);
    const { TOOLS } = await import("../src/tools");
    const tool = (TOOLS as unknown as Record<string, import("../src/tools/base").Tool>)[scopedName]!;
    const result = await tool.run({}, s.ctx) as ToolResultWithAudit;
    expect(result.ok).toBe(!cancel);
    expect(result.gate?.verdict).toBe("approved");
    expect(callTool).toHaveBeenCalledTimes(cancel ? 0 : 1);
  });

  it.each([true, false])("worker 批准后 cancel=%s：只在未取消时写盘", async (cancel) => {
    const s = await setup();
    const { buildWorkerToolTable } = await import("../src/agent/worker-tool-table");
    const requestWorkerApproval = vi.fn(async () => {
      if (cancel) s.controller.abort();
      return { approved: true, scope: "once" as const };
    });
    // 无需派生实际 agent：验证 worker 工具门到真实文件工具的执行边界。
    const worker = { mode: "write", agentId: "cancel-worker", autonomy: s.autonomy, toolAutonomy: s.autonomy, editAnchors: new Map(), snapshots: new Map() } as unknown as WorkerHandle;
    const orch = { requestWorkerApproval } as unknown as Orchestrator;
    const table = buildWorkerToolTable(worker, orch);
    const result = await table.write_file!.run(s.args, s.ctx) as ToolResultWithAudit;
    expect(requestWorkerApproval).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: !cancel, gate: { verdict: "approved", scope: "once" } });
    if (cancel) await expectNoWrite(s.workspace);
    else expect(await readFile(join(s.workspace, "result.txt"), "utf8")).toBe(s.args.content);
  });
});
