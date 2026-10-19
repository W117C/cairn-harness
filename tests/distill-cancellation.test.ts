import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/events";
import type { Provider } from "../src/providers";

const hooks = vi.hoisted(() => ({
  readPath: "",
  afterRead: null as (() => void) | null,
  afterRename: null as ((target: string) => void) | null,
  afterDraft: null as (() => void) | null,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const result = await fs.readFile(...args);
      if (String(args[0]) === hooks.readPath) hooks.afterRead?.();
      return result;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      await fs.rename(...args);
      hooks.afterRename?.(String(args[1]));
    },
  };
});
vi.mock("../src/agent/gym/draft", async (importOriginal) => {
  const draft = await importOriginal<typeof import("../src/agent/gym/draft")>();
  return {
    ...draft,
    writeDraftFromFailedSession: async (...args: Parameters<typeof draft.writeDraftFromFailedSession>) => {
      const result = await draft.writeDraftFromFailedSession(...args);
      hooks.afterDraft?.();
      return result;
    },
  };
});

const temporaryDirs: string[] = [];
afterEach(async () => {
  hooks.readPath = "";
  hooks.afterRead = null;
  hooks.afterRename = null;
  hooks.afterDraft = null;
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(failures = 1) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "distill-cancellation-"));
  temporaryDirs.push(dir);
  const workspace = join(dir, "workspace");
  await mkdir(workspace);
  vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory-home"));
  vi.stubEnv("DSH_APPDATA", join(dir, "appdata"));
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  const logPath = join(dir, "session.jsonl");
  const events: AgentEvent[] = [{ type: "user_message", content: "fix the test" }];
  for (let i = 1; i <= failures; i++) events.push({
    type: "verify_result", callId: "v" + String(i), ok: false, attempt: i, maxAttempts: 3,
    results: [{ command: "test", ok: false, output: "assertion failed " + String(i) }],
  });
  await writeFile(logPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const { runSessionEndDistill } = await import("../src/agent/memory/distill");
  const controller = new AbortController();
  const emitted: AgentEvent[] = [];
  const stream = vi.fn(async function* () { yield { type: "assistant_message" as const, content: "无" }; });
  const provider: Provider = { stream };
  const providerFor = vi.fn(() => provider);
  const remember = vi.fn(async () => ({ ok: true, output: "saved" }));
  return {
    dir, workspace, logPath, controller, emitted, stream, providerFor,
    memoryDir: join(workspace, ".agent", "memory"),
    run: (enabled = true) => runSessionEndDistill({
      enabled, logPath, workspace, signal: controller.signal, provider, providerFor,
      rememberTool: { name: "remember", run: remember },
      emit: async (event) => { emitted.push(event); },
    }),
  };
}

async function memoryFiles(path: string): Promise<string[]> {
  try { return (await readdir(path)).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("取消阻止新的自动沉淀副作用", () => {
  it("进入前已取消：不改旧索引、不写教训，也不构造 provider", async () => {
    const s = await setup();
    await mkdir(s.memoryDir, { recursive: true });
    const index = join(s.memoryDir, "MEMORY.md");
    await writeFile(index, "# Existing memory\n");
    s.controller.abort(new Error("cancel-before-start"));
    expect(await s.run()).toEqual({ kind: "failed", why: "cancel-before-start" });
    expect(await readFile(index, "utf8")).toBe("# Existing memory\n");
    expect(await memoryFiles(s.memoryDir)).toEqual(["MEMORY.md"]);
    expect(s.providerFor).not.toHaveBeenCalled();
    expect(s.stream).not.toHaveBeenCalled();
    expect(s.emitted).toEqual([]);
  });

  it("开关已关闭仍为 disabled，即使同时取消也不读取历史", async () => {
    const s = await setup();
    await rm(s.logPath);
    s.controller.abort();
    expect(await s.run(false)).toEqual({ kind: "disabled" });
    expect(await memoryFiles(s.memoryDir)).toEqual([]);
    expect(s.providerFor).not.toHaveBeenCalled();
  });

  it("读取历史期间取消：不启动教训、草稿或 provider", async () => {
    const s = await setup();
    hooks.readPath = s.logPath;
    hooks.afterRead = () => s.controller.abort(new Error("cancel-after-read"));
    const drafted = vi.fn();
    hooks.afterDraft = drafted;
    expect(await s.run()).toEqual({ kind: "failed", why: "cancel-after-read" });
    expect(await memoryFiles(s.memoryDir)).toEqual([]);
    expect(drafted).not.toHaveBeenCalled();
    expect(s.providerFor).not.toHaveBeenCalled();
  });

  it("第一条教训落盘时取消：保留这一条，停止后续教训和 provider", async () => {
    const s = await setup(3);
    const drafted = vi.fn();
    hooks.afterDraft = drafted;
    hooks.afterRename = (target) => {
      if (target === join(s.memoryDir, "lesson-verify-red-1.md")) s.controller.abort(new Error("cancel-after-first-lesson"));
    };
    expect(await s.run()).toEqual({ kind: "failed", why: "cancel-after-first-lesson" });
    expect(await memoryFiles(s.memoryDir)).toEqual(["MEMORY.md", "lesson-verify-red-1.md"]);
    expect(await readFile(join(s.memoryDir, "lesson-verify-red-1.md"), "utf8")).toContain("assertion failed 1");
    expect(drafted).not.toHaveBeenCalled();
    expect(s.providerFor).not.toHaveBeenCalled();
    expect(s.stream).not.toHaveBeenCalled();
  });

  it("草稿阶段结束时取消：不再构造模型 provider，已完成的教训保留", async () => {
    const s = await setup();
    hooks.afterDraft = () => s.controller.abort(new Error("cancel-after-draft"));
    expect(await s.run()).toEqual({ kind: "failed", why: "cancel-after-draft" });
    expect(await memoryFiles(s.memoryDir)).toEqual(["MEMORY.md", "lesson-verify-red-1.md"]);
    expect(s.providerFor).not.toHaveBeenCalled();
    expect(s.stream).not.toHaveBeenCalled();
  });

  it("未取消时教训仍全部写入，provider 正常构造并调用", async () => {
    const s = await setup(3);
    expect(await s.run()).toEqual({ kind: "no_content" });
    expect(await memoryFiles(s.memoryDir)).toEqual(["MEMORY.md", "lesson-verify-red-1.md", "lesson-verify-red-2.md", "lesson-verify-red-3.md"]);
    expect(s.providerFor).toHaveBeenCalledTimes(1);
    expect(s.stream).toHaveBeenCalledTimes(1);
  });

  it("真实 runAgent 被取消后，开启 autoMemory 也不会重写历史教训", async () => {
    const s = await setup();
    const scriptPath = join(s.dir, "script.jsonl");
    await writeFile(scriptPath, JSON.stringify({ type: "assistant_message", content: "done" }) + "\n");
    vi.stubEnv("M1C_AUTONOMY_SCRIPT", scriptPath);
    vi.stubEnv("M0A_PROVIDER", "demo");
    const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
    initSettingsStore(join(s.dir, "settings.json"));
    await setSettings({ autoMemory: true, autoVerify: false, subagentTools: false, safeMode: "off" });
    const { runAgent } = await import("../src/main/agent-runner");
    s.controller.abort();
    const events = await runAgent({ workspace: s.workspace, logPath: s.logPath, sessionId: "cancelled-session", message: "stop", mode: "default", signal: s.controller.signal });
    expect(events.filter((event) => event.type === "verify_result")).toHaveLength(1);
    expect(await memoryFiles(s.memoryDir)).toEqual([]);
  });
});
