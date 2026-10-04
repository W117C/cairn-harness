import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTs } from "./helpers/stream-equals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionFusion } from "../src/agent/action-fusion";
import { handleAgentRun, initSettingsStore, runAgent, setSettings, type RunOptions } from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import { run_shell } from "../src/tools/run_shell";
import { buildSandboxProfile } from "../src/main/sandbox";
import type { AgentEvent } from "../src/events";
import type { ToolContext } from "../src/tools/base";

vi.mock("node:timers/promises", { spy: true });

let dir: string;
let seq = 0;
const writeCall = (id = "write", content = "new") => ({ type: "tool_call", id, name: "write_file", args: { path: "target.txt", content, then_run: "printf MODEL > model-ran", verify: { lint: ["printf MODEL"] } } });
const toolResults = (events: AgentEvent[]) => events.filter(e => e.type === "tool_result");
async function config(lint: string[], test = ["printf TEST > test-ran"]) {
  await writeFile(join(dir, ".agent/config.json"), JSON.stringify({ verify: { lint, test } }));
}
async function rules(behavior: "deny" | "ask", tool = "run_shell") {
  await writeFile(join(dir, ".agent/permissions.json"), JSON.stringify({ rules: [{ behavior, tool, scope: "always" }] }));
}
async function script(calls: unknown[]) {
  const path = join(dir, `script-${seq++}.jsonl`);
  await writeFile(path, calls.map(c => JSON.stringify(c)).join("\n"));
  vi.stubEnv("M3A_MAIN_SCRIPT", path);
}
async function run(calls: unknown[] = [writeCall()], opts: Partial<RunOptions> = {}) {
  await script(calls);
  return runAgent({      // S3 信任闸：本用例拥有这个 fixture，自行断言可信（产品路径缺省即拒绝）。
      trustedRepo: true, workspace: dir, logPath: join(dir, `events-${seq++}.jsonl`), message: "local write", mode: "auto", unattended: true, actionFusion: true, ...opts });
}
async function absent(name: string) {
  await expect(readFile(join(dir, name), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "action-fusion-"));
  await mkdir(join(dir, ".agent"));
  vi.stubEnv("M0A_PROVIDER", "mock");
  vi.stubEnv("M1E_SAFE_MODE", "off");
  vi.stubEnv("DSH_APPDATA", dir);
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M2E_PLUGIN_DATA", join(dir, "plugin-data"));
  vi.stubEnv("M2E_TRUST_FILE", join(dir, "trust.json"));
  initSettingsStore(join(dir, "settings.json"));
  await setSettings({ provider: "demo", safeMode: "off", autoMemory: false });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("C1 actual main runner integration (local scripts, no model calls)", () => {
  it("default/off is byte-identical and never reads invalid lint config", async () => {
    await writeFile(join(dir, ".agent/config.json"), "INVALID");
    const baseline = await run(undefined, { actionFusion: undefined });
    // 两次 run 必须从同一文件态起：写盘摘要现在报行增减，
    // 第二次覆盖自己刚写的 target.txt 天然就是 +0 −0，那是信息不是漂移。
    await rm(join(dir, "target.txt"), { force: true });
    const disabled = await run(undefined, { actionFusion: false });
    expect(JSON.stringify(stripTs(disabled))).toBe(JSON.stringify(stripTs(baseline)));
    expect(toolResults(baseline)[0]?.output).toBe("已写入 target.txt（3 字节，新建 +1 行）");
    expect(JSON.stringify(baseline)).not.toContain("fused_lint");
  });

  it("write and edit preserve separate receipts, run only configured lint, no extra tool calls", async () => {
    await config(["printf LINT"]);
    const calls = [writeCall(), { type: "tool_call", id: "edit", name: "edit_file", args: { path: "target.txt", old_string: "new", new_string: "edited", then_run: "printf MODEL > model-ran" } }];
    const events = await run(calls);
    expect(stripTs(events.filter(e => e.type === "tool_call"))).toEqual(calls);
    const results = toolResults(events);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.output).toContain("[fused_write:succeeded]");
      expect(result.output).toContain("[fused_lint:succeeded]");
      expect(result.output).toContain("LINT");
    }
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("edited");
    await absent("model-ran");
    await absent("test-ran");
  });

  it("lint failure is not all-success and never rolls back the successful write", async () => {
    await config(["printf BAD; exit 7", "printf NEVER > never"]);
    const [result] = toolResults(await run());
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("已写入 target.txt");
    expect(result?.output).toContain("[fused_write:succeeded]");
    expect(result?.output).toContain("[fused_lint:failed]");
    expect(result?.output).toContain("[exit code: 7]");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
    await absent("never");
  });

  it("failed or permission-denied writes never launch checks", async () => {
    await config(["printf RAN > lint-ran"]);
    const invalid = { ...writeCall(), args: { path: "target.txt", content: 42 } };
    expect(toolResults(await run([invalid]))[0]?.ok).toBe(false);
    await rules("deny", "write_file");
    expect(toolResults(await run())[0]?.output).toContain("[permission denied]");
    await absent("lint-ran");
    await absent("target.txt");
  });

  it("shell deny rules remain effective after an approved write", async () => {
    await config(["printf RAN > lint-ran"]);
    await rules("deny");
    const [result] = toolResults(await run());
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("[permission denied] run_shell");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
    await absent("lint-ran");
  });

  it.each([true, false])("real AskGate decision %s gates the configured command", async (approved) => {
    await config(["printf RAN > lint-ran"]);
    await rules("ask");
    const asked: string[] = [];
    const gate = new AskGate({ notify: req => { asked.push(String(req.args.command)); gate.decide(req.askId, approved); } });
    const [result] = toolResults(await run(undefined, { askGate: gate }));
    expect(asked).toEqual(["printf RAN > lint-ran"]);
    expect(result?.ok).toBe(approved);
    expect(gate.pendingCount).toBe(0);
    if (approved) expect(await readFile(join(dir, "lint-ran"), "utf8")).toBe("RAN");
    else await absent("lint-ran");
  });

  it("unattended ask fails closed; missing config skips visibly", async () => {
    expect(toolResults(await run())[0]?.output).toContain("[fused_lint:skipped]\nno configured lint");
    await config(["printf RAN > lint-ran"]);
    await rules("ask");
    const [result] = toolResults(await run(undefined, { askGate: new AskGate({ unattended: true }) }));
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("无人值守 fail-closed");
    await absent("lint-ran");
  });

  it("cancel during shell approval propagates signal and clears the real pending gate", async () => {
    await config(["printf RAN > lint-ran"]);
    await rules("ask");
    const abort = new AbortController();
    const gate = new AskGate({ notify: () => abort.abort() });
    const request = vi.spyOn(gate, "request");
    const [result] = toolResults(await run(undefined, { askGate: gate, signal: abort.signal }));
    expect(request.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    expect(gate.pendingCount).toBe(0);
    expect(result?.ok).toBe(false);
    await absent("lint-ran");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
  });

  it("cancels a real in-flight shell process, retaining the write", async () => {
    await config(["printf START > started; sleep 30; printf LATE > late"]);
    const abort = new AbortController();
    const timer = setInterval(() => { void readFile(join(dir, "started")).then(() => abort.abort(), () => {}); }, 10);
    try {
      const [result] = toolResults(await run(undefined, { signal: abort.signal }));
      expect(abort.signal.aborted).toBe(true);
      expect(result?.ok).toBe(false);
      expect(result?.output).toContain("run_shell 随会话取消终止");
      expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
      await absent("late");
    } finally { clearInterval(timer); }
  }, 10_000);

  it("sandbox branch uses existing profile and cancellable shell context after approval", async () => {
    await config(["printf 'QUOTED'"]);
    await rules("ask");
    const abort = new AbortController();
    let signal: AbortSignal | undefined;
    const shell = vi.spyOn(run_shell, "run").mockImplementation(async (args, ctx) => {
      signal = ctx.signal;
      expect(String(args.command)).toContain("exec /usr/bin/sandbox-exec -p");
      expect(String(args.command)).toContain(buildSandboxProfile(dir));
      expect(String(args.command)).toContain("TMPDIR=");
      abort.abort();
      expect(ctx.signal?.aborted).toBe(true);
      return { ok: false, output: "sandbox shell cancelled" };
    });
    const asked: string[] = [];
    const gate = new AskGate({ notify: req => { asked.push(String(req.args.command)); gate.decide(req.askId, true); } });
    const [result] = toolResults(await run(undefined, { sandbox: { available: true }, askGate: gate, signal: abort.signal }));
    expect(asked).toEqual(["printf 'QUOTED'"]);
    expect(shell).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("sandbox shell cancelled");
  });

  it("content mutation while awaiting approval skips lint (recheck after approval)", async () => {
    await config(["printf RAN > lint-ran"]);
    await rules("ask");
    const gate = new AskGate({ notify: req => {
      void writeFile(join(dir, "target.txt"), "external").then(() => gate.decide(req.askId, true));
    } });
    const [result] = toolResults(await run(undefined, { askGate: gate }));
    expect(result?.output).toContain("[fused_lint:skipped]");
    expect(result?.output).toContain("content changed");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("external");
    await absent("lint-ran");
  });

  it("three fusion attempts do not consume verify attempts; fresh run resets the cap", async () => {
    await config(["printf x >> attempts"]);
    const calls: unknown[] = Array.from({ length: 4 }, (_, n) => writeCall(`w${n}`, String(n)));
    calls.push({ type: "tool_call", id: "verify", name: "verify", args: {} });
    const events = await run(calls);
    expect(toolResults(events).find(e => e.callId === "w3")?.output).toContain("attempt limit (3)");
    expect(events.some(e => e.type === "verify_result" && e.ok)).toBe(true);
    expect(await readFile(join(dir, "attempts"), "utf8")).toBe("xxxx");
    await run();
    expect(await readFile(join(dir, "attempts"), "utf8")).toBe("xxxxx");
  });

  it("handleAgentRun forwards the explicit override", async () => {
    await config(["printf LINT"]);
    await script([writeCall()]);
    const events: AgentEvent[] = [];
    // Default shell sandbox state is unavailable: approve the real application gate via hooks.
    const { setAppHooks, handleAgentDecide } = await import("../src/main/agent-runner");
    setAppHooks({ onAsk: req => { handleAgentDecide(req.askId, true); } });
    try {
      const response = await handleAgentRun({ message: "write", mode: "auto" }, { workspace: dir, logPath: join(dir, "handle.jsonl"), actionFusion: true, onEvent: e => events.push(e) });
      expect(response.ok).toBe(true);
      expect(toolResults(events)[0]?.output).toContain("[fused_lint:succeeded]");
    } finally { setAppHooks({ onAsk: undefined }); }
  });
  // 上一格给的是 **override**；`agent-runner.ts` 那行 `over.actionFusion ?? (await store().get()).actionFusion`
  // 的右半边此前零观察着（整行换成 `?? false` 全表照绿）。用户在设置界面点的是盘上那个键。
  it("settings 里的 actionFusion 走得到生产入口（不给 override）", async () => {
    await config(["printf LINT"]);
    await script([writeCall()]);
    await setSettings({ provider: "demo", safeMode: "off", autoMemory: false, actionFusion: true });
    const events: AgentEvent[] = [];
    const { setAppHooks, handleAgentDecide } = await import("../src/main/agent-runner");
    setAppHooks({ onAsk: req => { handleAgentDecide(req.askId, true); } });
    try {
      const response = await handleAgentRun({ message: "write", mode: "auto" }, { workspace: dir, logPath: join(dir, "handle-settings.jsonl"), onEvent: e => events.push(e) });
      expect(response.ok).toBe(true);
      expect(toolResults(events)[0]?.output, "设置里的 true 没穿过 `over ?? settings` ⇒ 界面开关是空的").toContain("[fused_lint:succeeded]");
    } finally { setAppHooks({ onAsk: undefined }); }
  });
  it("反向一侧：盘上没这个键 ⇒ 生产入口不融合，但同一次写盘仍成功", async () => {
    await config(["printf LINT"]);
    await script([writeCall()]);
    const events: AgentEvent[] = [];
    const { setAppHooks, handleAgentDecide } = await import("../src/main/agent-runner");
    setAppHooks({ onAsk: req => { handleAgentDecide(req.askId, true); } });
    try {
      const response = await handleAgentRun({ message: "write", mode: "auto" }, { workspace: dir, logPath: join(dir, "handle-absent.jsonl"), onEvent: e => events.push(e) });
      expect(response.ok).toBe(true);
      const first = toolResults(events)[0];
      expect(first?.ok, "写盘都没成功 ⇒ 「没融合」可以被门拒满足，等于没测").toBe(true);
      expect(first?.output).not.toContain("[fused_lint");
    } finally { setAppHooks({ onAsk: undefined }); }
  });
  it("an approved plan.verify cannot supply the fused lint command", async () => {
    await config(["printf CONFIG > config-ran"]);
    const { handlePlanDecide } = await import("../src/main/agent-runner");
    const plan = { type: "tool_call", id: "plan", name: "propose_plan", args: {
      goal: "write", files: [{ path: "target.txt", action: "create", summary: "write" }],
      verify: { lint: ["printf MODEL > model-ran"] },
    } };
    const events = await run([plan, writeCall()], { onEvent: e => {
      if (e.type === "plan_proposed") void handlePlanDecide(true, e.callId);
    } });
    expect(toolResults(events).find(e => e.callId === "write")?.output).toContain("[fused_lint:succeeded]");
    expect(await readFile(join(dir, "config-ran"), "utf8")).toBe("CONFIG");
    await absent("model-ran");
  });

  it("available sandbox really launches sandbox-exec (host refusal stays visibly failed)", async () => {
    await config(["printf 'QUOTED-LINT'"]);
    const [result] = toolResults(await run(undefined, { sandbox: { available: true } }));
    expect(result?.output).toContain("[fused_write:succeeded]");
    if (result?.ok) {
      expect(result.output).toContain("[fused_lint:succeeded]");
      expect(result.output).toContain("\nQUOTED-LINT");
    } else {
      expect(result?.output).toContain("[fused_lint:failed]");
      expect(result?.output).toMatch(/sandbox|Operation not permitted/);
      console.log("C1 sandbox host enforcement unverified: sandbox-exec refused; fail-closed result asserted");
    }
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
  });

  it("bad configuration is a check failure, not a lost successful write", async () => {
    await writeFile(join(dir, ".agent/config.json"), "INVALID");
    const [result] = toolResults(await run());
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain("[fused_lint:failed]");
    expect(result?.output).toContain("Lint configuration/execution failed");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("new");
  });

  it("package script probing uses loadVerifyConfig and never a model-provided command", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "ignored by spy", test: "not lint" } }));
    const shell = vi.spyOn(run_shell, "run").mockResolvedValue({ ok: true, output: "probed lint" });
    const [result] = toolResults(await run());
    expect(shell).toHaveBeenCalledTimes(1);
    expect(shell.mock.calls[0]?.[0]).toEqual({ command: "pnpm run lint" });
    expect(result?.output).toContain("[fused_lint:succeeded]");
  });

  it("lint failures also consume the independent three-attempt cap without stopping writes", async () => {
    await config(["exit 8"]);
    const results = toolResults(await run(Array.from({ length: 4 }, (_, n) => writeCall(`w${n}`, String(n)))));
    expect(results.slice(0, 3).map(r => r.ok)).toEqual([false, false, false]);
    expect(results[3]?.output).toContain("attempt limit (3)");
    expect(await readFile(join(dir, "target.txt"), "utf8")).toBe("3");
  });
});

describe("content guard boundaries", () => {
  it("checks hash twice with a yield, rejects traversal/system area/symlink escapes", async () => {
    await config(["printf LINT"]);
    await writeFile(join(dir, "target.txt"), "old");
    const shell = vi.fn(async () => ({ ok: true, output: "lint" }));
    const fuse = createActionFusion(shell);
    const ctx: ToolContext = { workspace: dir };
    const write = { ok: true, output: "written" };
    const outside = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "fusion-outside-"));
    await writeFile(join(outside, "data"), "outside");
    await symlink(outside, join(dir, "escape"));
    await symlink(join(dir, ".agent"), join(dir, "system-alias"));
    for (const path of ["../outside", ".agent/config.json", "escape/data", "system-alias/config.json", "missing"]) {
      expect((await fuse(write, path, ctx)).output).toContain("[fused_lint:skipped]");
    }
    expect(shell).not.toHaveBeenCalled();
    // A scheduled immediate modifies the file exactly at the guard's mandatory yield.
    const timers = await import("node:timers/promises");
    vi.spyOn(timers, "setImmediate").mockImplementationOnce(async () => {
      await writeFile(join(dir, "target.txt"), "mutated");
    });
    expect((await fuse(write, "target.txt", ctx)).output).toContain("content changed after write");
    expect(shell).not.toHaveBeenCalled();
    const failed = { ok: false, output: "write failed" };
    expect(await fuse(failed, "target.txt", ctx)).toBe(failed);
  });
});
