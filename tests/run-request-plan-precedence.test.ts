import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import { alwaysRulesPath, savePermissionRules } from "../src/permissions/rules";
import type { AgentEvent } from "../src/events";

let root: string;
let savedScript: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-plan-precedence-"));
  savedScript = process.env.M3A_MAIN_SCRIPT;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (savedScript === undefined) delete process.env.M3A_MAIN_SCRIPT;
  else process.env.M3A_MAIN_SCRIPT = savedScript;
  await rm(root, { recursive: true, force: true });
});

describe("shared application entry respects the plan request", () => {
  it.each([
    { setting: false, request: true, override: undefined, canWrite: false },
    { setting: true, request: false, override: undefined, canWrite: true },
    { setting: false, request: true, override: false, canWrite: true },
    { setting: true, request: false, override: true, canWrite: false },
    { setting: true, request: undefined, override: undefined, canWrite: false },
    { setting: false, request: undefined, override: undefined, canWrite: true },
  ])("setting=$setting request=$request override=$override => write=$canWrite", async row => {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, ".agent"), { recursive: true });
    vi.stubEnv("DSH_APPDATA", join(root, "appdata"));
    await savePermissionRules(alwaysRulesPath(workspace), [{ behavior: "allow", tool: "write_file", scope: "always" }]);
    const settings = join(root, "settings.json");
    await writeFile(settings, JSON.stringify({
      provider: "demo", planRequiredByDefault: row.setting, autoVerify: false, impactAnalysis: false,
    }));
    initSettingsStore(settings);
    const script = join(root, "script.jsonl");
    await writeFile(script, [
      { type: "tool_call", id: "write-result", name: "write_file", args: { path: "result.txt", content: "actual result" } },
      { type: "assistant_message", content: "本轮已收束。" },
    ].map(event => JSON.stringify(event)).join("\n") + "\n");
    process.env.M3A_MAIN_SCRIPT = script;
    const events: AgentEvent[] = [];
    const result = await handleAgentRun({
      message: "写入结果", mode: "auto", workspace,
      ...(row.request !== undefined ? { planRequired: row.request } : {}),
    }, {
      logPath: join(root, "events.jsonl"), modelSelection: { kind: "demo" }, unattended: true,
      ...(row.override !== undefined ? { planRequired: row.override } : {}),
      onEvent: event => { events.push(event); },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const receipt = events.find(event => event.type === "tool_result" && event.callId === "write-result");
    expect(receipt?.type).toBe("tool_result");
    if (receipt?.type !== "tool_result") throw new Error("missing write receipt");
    expect(receipt.ok, receipt.output).toBe(row.canWrite);
    if (row.canWrite) expect(await readFile(join(workspace, "result.txt"), "utf8")).toBe("actual result");
    else {
      expect(receipt.output).toContain("方案");
      await expect(readFile(join(workspace, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
