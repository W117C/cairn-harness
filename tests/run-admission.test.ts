import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); });

describe("拒绝重复 run 不得替换活动会话的取消入口", () => {
  it.each(["none", "exact", "alias"] as const)("原审批仍可取消，收束后取消入口被清理（重复请求=%s）", async (duplicate) => {
    vi.resetModules();
    const dir = await mkdtemp(join(tmpdir(), "run-admission-"));
    const workspace = join(dir, "workspace");
    await mkdir(workspace);
    const scriptPath = join(dir, "script.jsonl");
    await writeFile(scriptPath, [
      { type: "tool_call", id: "write-1", name: "write_file", args: { path: "result.txt", content: "done" } },
      { type: "assistant_message", content: "done" },
    ].map((event) => JSON.stringify(event)).join("\n"), "utf8");
    vi.stubEnv("M1C_AUTONOMY_SCRIPT", scriptPath);
    vi.stubEnv("M0A_PROVIDER", "demo");
    vi.stubEnv("DSH_APPDATA", join(dir, "appdata"));
    vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory"));
    vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
    vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));

    const { runAgent, handleRunCancel } = await import("../src/main/agent-runner");
    const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
    const { AskGate } = await import("../src/main/ask-gate");
    initSettingsStore(join(dir, "settings.json"));
    await setSettings({ autoMemory: false, autoVerify: false, subagentTools: false });
    let onAsk = () => {};
    const asked = new Promise<void>((resolve) => { onAsk = resolve; });
    let askedTool = "";
    const gate = new AskGate({
      notify: (request) => { askedTool = request.tool; onAsk(); },
      timeoutMs: 8000,
    });
    const cleanup = new AbortController();
    const logPath = join(dir, "active.jsonl");
    const active = runAgent({ workspace, logPath, message: "active", mode: "default", askGate: gate, signal: cleanup.signal });
    try {
      await Promise.race([asked, active.then(() => { throw new Error("run ended before requesting approval"); })]);
      expect(askedTool).toBe("write_file");
      expect(gate.pendingCount).toBe(1);
      if (duplicate !== "none") {
        const secondPath = duplicate === "alias" ? dir + sep + "." + sep + "active.jsonl" : logPath;
        await expect(runAgent({ workspace, logPath: secondPath, message: "duplicate", mode: "default" }))
          .rejects.toThrow("session already running or being deleted");
      }

      expect(handleRunCancel()).toEqual({ ok: true });
      expect(gate.pendingCount).toBe(0);
      const events = await active;
      expect(events.filter((event) => event.type === "user_message").map((event) => event.content)).toEqual(["active"]);
      expect(handleRunCancel().ok).toBe(false);
      await expect(readFile(join(workspace, "result.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      cleanup.abort();
      await active.catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
