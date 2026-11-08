import { expect, it, vi } from "vitest";
import { listBackgroundTasks, stopBackgroundTask, task_output, task_stop } from "../src/tools/background-tasks";
import { run_shell } from "../src/tools/run_shell";

it("shares the shell tool registry with the desktop controls only for the owning session log", async () => {
  const workspace = process.cwd();
  const owning = { workspace, sessionLogPath: "/workspace-a/sessions/same.jsonl" };
  const otherSession = { workspace, sessionLogPath: "/workspace-a/sessions/different.jsonl" };
  const otherWorkspace = { workspace, sessionLogPath: "/workspace-b/sessions/same.jsonl" };
  try {
    await expect(run_shell.run({ command: "printf scoped-output; exec sleep 60", background: true }, owning))
      .resolves.toMatchObject({ ok: true, output: expect.stringContaining("bg_1") });
    await vi.waitFor(() => expect(listBackgroundTasks(owning.sessionLogPath)[0]?.output).toBe("scoped-output"));
    expect(listBackgroundTasks(otherSession.sessionLogPath)).toEqual([]);
    expect(listBackgroundTasks(otherWorkspace.sessionLogPath)).toEqual([]);
    expect(stopBackgroundTask(otherWorkspace.sessionLogPath, "bg_1")).toBeNull();
    await expect(task_output.run({ task_id: "bg_1" }, otherSession)).rejects.toThrow("没有这个任务号");
    await expect(task_stop.run({ task_id: "bg_1" }, otherWorkspace)).rejects.toThrow("没有这个任务号");
    await expect(task_output.run({ task_id: "bg_1" }, owning)).resolves.toMatchObject({ output: expect.stringContaining("scoped-output") });
    expect(stopBackgroundTask(owning.sessionLogPath, "bg_1")).toMatchObject({ done: true, stopped: true, output: "scoped-output" });
    await expect(task_output.run({ task_id: "bg_1" }, owning)).resolves.toMatchObject({ output: expect.stringContaining("已被 task_stop 停止") });
  } finally {
    if (typeof stopBackgroundTask === "function") stopBackgroundTask(owning.sessionLogPath, "bg_1");
  }
});

it("preserves the approved sandbox launch for background commands", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { newAutonomySession } = await import("../src/permissions");
  const { gatedTool } = await import("../src/main/tool-gates");
  const workspace = await mkdtemp(join(tmpdir(), "cairn-bg-sandbox-"));
  const inner = vi.fn<typeof run_shell.run>(async () => ({ ok: true, output: "launched" }));
  const gated = gatedTool("run_shell", { ...run_shell, run: inner }, undefined, undefined, {
    autonomy: newAutonomySession("full-access"), askGate: null, sandbox: { available: true },
  });
  const args = { command: "echo ready", background: true };
  try {
    await expect(gated.run(args, { workspace })).resolves.toMatchObject({ ok: true, output: "launched" });
    expect(inner).toHaveBeenCalledExactlyOnceWith(args, expect.objectContaining({
      backgroundShellLaunch: expect.objectContaining({
        executable: "sandbox-exec",
        args: ["-p", expect.stringContaining("(deny default)"), "bash", "-c", "echo ready"],
      }),
    }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
