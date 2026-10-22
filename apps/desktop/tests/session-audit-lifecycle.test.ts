import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";
import { requireSessionMetadata } from "../../../src/main/session-handlers";
import { SessionMetadataRepository } from "../../../src/main/session-metadata";
import { createSession, pathOf } from "../../../src/main/sessions";

let root = "";
let workspace = "";
let userData = "";
let host: KernelHost;
const runs: Promise<unknown>[] = [];
const outbox: { channel: string; payload: Record<string, unknown> }[] = [];
const logRoot = (): string => join(workspace, ".agent", "sessions");
const metadataPath = (): string => join(logRoot(), "session-metadata.json");
const readMetadata = (): SessionMetadataRepository => new SessionMetadataRepository(metadataPath());
const oldRepository = (): SessionMetadataRepository =>
  new SessionMetadataRepository(metadataPath(), { now: () => new Date("2000-01-01T00:00:00.000Z") });

function makeHost(): KernelHost {
  return createKernelHost({ workspaces: [workspace], activeWorkspace: workspace, userDataDir: userData,
    outbox: (channel, payload) => { outbox.push({ channel, payload: payload as Record<string, unknown> }); } });
}

async function script(events: unknown[], name = "main.jsonl"): Promise<void> {
  const file = join(root, name);
  await writeFile(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  vi.stubEnv("M3A_MAIN_SCRIPT", file);
}

function run(sessionId: string): ReturnType<KernelHost["run"]> {
  const pending = host.run({ sessionId, message: "audit lifecycle", mode: "default" });
  runs.push(pending);
  return pending;
}

async function waitForAsk(sessionId: string): Promise<string> {
  return await vi.waitFor(() => {
    const ask = outbox.find((event) => event.channel === "onAsk" && event.payload.sessionId === sessionId);
    expect(ask?.payload.askId).toEqual(expect.any(String));
    return ask!.payload.askId as string;
  }, { timeout: 10_000, interval: 25 });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-session-audit-"));
  workspace = join(root, "workspace");
  userData = join(root, "userData");
  await mkdir(workspace, { recursive: true });
  workspace = await realpath(workspace);
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, "settings.json"), JSON.stringify({
    provider: "demo", model: "", autoMemory: false, impactAnalysis: false, autoVerify: false,
    planRequiredByDefault: false,
  }));
  for (const name of ["M0A_PROVIDER", "CAIRN_MODEL", "M0B_WORKSPACE", "M0A_MOCK_DELTA", "M1B_GATE_FLOW", "M1C_AUTONOMY_DEMO"]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv("M3A_AGENTS_DEMO", "0");
  outbox.length = 0;
  runs.length = 0;
  await script([{ type: "assistant_message", content: "finished" }]);
  host = makeHost();
});

afterEach(async () => {
  for (const event of outbox) {
    if (event.channel === "onAsk" && typeof event.payload.sessionId === "string") await host.cancel(event.payload.sessionId);
  }
  await Promise.allSettled(runs);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("SessionMetadata audit through the real KernelHost", () => {
  it("counts successful open attempts and persists viewedAt through a new host instance", async () => {
    const { id } = await host.createSession();
    const bytes = await readFile(pathOf(logRoot(), id), "utf8");
    await host.openSession(id);
    expect(await readMetadata().get(id)).toMatchObject({ resumeAttempts: 1, viewedAt: expect.any(String) });
    host = makeHost();
    await host.openSession(id);
    expect(await readMetadata().get(id)).toMatchObject({ resumeAttempts: 2, viewedAt: expect.any(String) });
    expect(await readFile(pathOf(logRoot(), id), "utf8")).toBe(bytes);
  });

  it("records a failed known-session open attempt without recording a successful view", async () => {
    const { id } = await host.createSession();
    await writeFile(pathOf(logRoot(), id), '{broken\n{"type":"assistant_message","content":"valid tail"}\n');
    await expect(host.openSession(id)).rejects.toThrow(/坏行/);
    const record = await readMetadata().get(id);
    expect(record.resumeAttempts).toBe(1);
    expect(record.viewedAt).toBeUndefined();
    await expect(host.openSession("missing-session")).rejects.toThrow(/会话不存在/);
    expect(await readMetadata().find("missing-session")).toBeUndefined();
  });

  it("projects present audit fields and leaves unrecorded values absent", async () => {
    const { id } = await host.createSession();
    const repo = readMetadata();
    await repo.markViewed(id);
    await repo.markIdle(id);
    await repo.recordResumeAttempt(id);
    await repo.setArchived(id, true);
    const expected = await repo.audit(id);
    const external = await createSession(logRoot(), "external-session");
    const list = await host.listSessions();
    expect(list.find((entry) => entry.id === id)).toMatchObject(expected);
    const unknown = list.find((entry) => entry.id === external)!;
    for (const field of ["viewedAt", "idleSince", "resumeAttempts", "archivedAt"]) expect(unknown).not.toHaveProperty(field);
  });

  it("marks an accepted run active, keeps it active after a rejected duplicate, then marks it idle", async () => {
    const { id } = await host.createSession();
    await oldRepository().markIdle(id);
    await script([{ type: "tool_call", id: "gate", name: "run_shell", args: { command: "true" } },
      { type: "assistant_message", content: "finished" }]);
    const first = run(id);
    await waitForAsk(id);
    await vi.waitFor(async () => expect((await readMetadata().get(id)).idleSince).toBeUndefined());
    expect(host.runningCount()).toBe(1);
    const duplicate = await run(id);
    expect(duplicate).toMatchObject({ ok: false });
    expect(duplicate.error).toMatch(/already running|正在运行/);
    expect((await readMetadata().get(id)).idleSince).toBeUndefined();
    expect(host.runningCount()).toBe(1);
    await host.cancel(id);
    await first;
    expect((await readMetadata().get(id)).idleSince).toEqual(expect.any(String));
    expect(host.runningCount()).toBe(0);
  });

  it("rejecting a request before a real run does not change its idle audit state", async () => {
    const { id } = await host.createSession();
    await oldRepository().markIdle(id);
    const before = await readMetadata().audit(id);
    const rejected = await host.run({ sessionId: id, message: "no provider call", mode: "default", thinking: "high" });
    expect(rejected).toMatchObject({ ok: false });
    expect(rejected.error).toContain("demo provider 不支持 thinking");
    expect(await readMetadata().audit(id)).toEqual(before);
    expect(await readFile(pathOf(logRoot(), id), "utf8")).toBe("");
    expect(host.runningCount()).toBe(0);
  });

  it("concurrent sessions settle their own audit state without marking the other session idle", async () => {
    const a = await host.createSession();
    const b = await host.createSession();
    await oldRepository().markIdle(a.id);
    await oldRepository().markIdle(b.id);
    await script([{ type: "tool_call", id: "gate", name: "run_shell", args: { command: "true" } },
      { type: "assistant_message", content: "finished" }]);
    const runA = run(a.id);
    await waitForAsk(a.id);
    const runB = run(b.id);
    await waitForAsk(b.id);
    await vi.waitFor(async () => {
      expect((await readMetadata().get(a.id)).idleSince).toBeUndefined();
      expect((await readMetadata().get(b.id)).idleSince).toBeUndefined();
    });
    expect(host.runningCount()).toBe(2);
    await host.cancel(a.id);
    await runA;
    expect((await readMetadata().get(a.id)).idleSince).toEqual(expect.any(String));
    expect((await readMetadata().get(b.id)).idleSince).toBeUndefined();
    expect(host.runningCount()).toBe(1);
    await host.cancel(b.id);
    await runB;
    expect((await readMetadata().get(b.id)).idleSince).toEqual(expect.any(String));
    expect(host.runningCount()).toBe(0);
  });

  it("same-id sessions in different workspaces do not inherit an ambiguous sidecar audit", async () => {
    const { id } = await host.createSession();
    const repo = readMetadata();
    await repo.markViewed(id);
    await repo.markIdle(id);
    await repo.recordResumeAttempt(id);
    await repo.setArchived(id, true);
    const other = join(root, "other-workspace");
    await mkdir(other, { recursive: true });
    host.addWorkspace(await realpath(other));
    await createSession(join(other, ".agent", "sessions"), id);
    const sameId = (await host.listSessions()).filter((entry) => entry.id === id);
    expect(sameId).toHaveLength(2);
    for (const entry of sameId) {
      for (const field of ["viewedAt", "idleSince", "resumeAttempts", "archivedAt"]) expect(entry).not.toHaveProperty(field);
    }
  });

  it("a real provider-script failure after the user turn still settles the accepted run as idle", async () => {
    const { id } = await host.createSession();
    await oldRepository().markIdle(id);
    const file = join(root, "broken-provider.jsonl");
    await writeFile(file, "not valid JSON\n");
    vi.stubEnv("M3A_MAIN_SCRIPT", file);
    const result = await run(id);
    expect(result.ok).toBe(false);
    expect(await readFile(pathOf(logRoot(), id), "utf8")).toContain('"type":"user_message"');
    expect((await readMetadata().get(id)).idleSince).not.toBe("2000-01-01T00:00:00.000Z");
    expect((await readMetadata().get(id)).idleSince).toEqual(expect.any(String));
    expect(host.runningCount()).toBe(0);
  });

  it("audit storage failure is visible and preserves the main open/run result and corrupt bytes", async () => {
    const { id } = await host.createSession();
    const corrupt = "{broken audit metadata\n";
    await writeFile(metadataPath(), corrupt);
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
    expect(await host.openSession(id)).toMatchObject({ events: [], running: false });
    expect(await run(id)).toMatchObject({ ok: true });
    expect(warnings.filter((line) => line.includes("[session-audit]")).length).toBeGreaterThanOrEqual(4);
    expect(await readFile(metadataPath(), "utf8")).toBe(corrupt);
    await expect(host.listSessions()).rejects.toThrow(/会话元数据损坏/);
  });

  it("an old run holds ownership until its idle write finishes, so a new run cannot be marked idle by it", async () => {
    const { id } = await host.createSession();
    await oldRepository().markIdle(id);
    const repo = requireSessionMetadata();
    const original = repo.markIdle.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const idle = vi.spyOn(repo, "markIdle").mockImplementation(async (sessionId) => {
      signalEntered();
      await gate;
      return await original(sessionId);
    });
    const first = run(id);
    try {
      expect(await Promise.race([entered.then(() => true), first.then(() => false)])).toBe(true);
      expect(host.runningCount()).toBe(1);
      expect(await run(id)).toMatchObject({ ok: false });
      expect((await readMetadata().get(id)).idleSince).toBeUndefined();
    } finally {
      release();
      await first;
      idle.mockRestore();
    }
    expect(await run(id)).toMatchObject({ ok: true });
    expect(host.runningCount()).toBe(0);
    expect((await readMetadata().get(id)).idleSince).toEqual(expect.any(String));
  });
});
