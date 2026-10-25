// 会话型 provider 的来源历史（计划 Task 2 红面·装配面）：
// `buildSessionHistory` 与 `createSessionProvider` 的 assemble 都要让指针分叉的子会话看到父前缀，
// 同时**本地 raw 事件不变**（游标/回滚/审计只认各自文件）；没分叉的会话逐字走旧路径。
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replay, type AgentEvent, type SessionMetaEvent } from "../src/events";
import { buildSessionHistory, createSessionProvider } from "../src/agent/session-provider";
import { projectContext } from "../src/agent/context";
import type { GlmMessage } from "../src/providers/glm";

vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });
const forkMeta = (from: string, boundary: number, id: string): SessionMetaEvent =>
  ({ type: "session_meta", fork: { from_session_path: from, boundary_event_id: boundary, from_session_id: id } });

async function setup(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-ref-prov-")));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  return { ws, root };
}

async function writeSession(root: string, id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(root, id + ".jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return realpath(path);
}

const bodies = (msgs: readonly { content?: unknown }[]): string[] => msgs.map((m) => String(m.content ?? ""));

async function historyThroughProvider(logPath: string, ws: string): Promise<GlmMessage[]> {
  const captured: GlmMessage[][] = [];
  const provider = createSessionProvider(logPath, {
    map: false,
    workspace: ws,
    transport: async function* (messages) {
      captured.push(messages);
      yield { type: "assistant_message", content: "收到" };
    },
  });
  for await (const _ of provider.stream([])) { /* drain */ }
  return captured[0] ?? [];
}

describe("指针分叉的模型历史", () => {
  it("buildSessionHistory 读得到父前缀；raw 与父文件字节不变", async () => {
    const { ws, root } = await setup();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER")]);
    const child = await writeSession(root, "child", [forkMeta(parent, 2, "parent"), user("CHILD_USER")]);
    const before = createHash("sha256").update(await readFile(parent)).digest("hex");

    const history = await buildSessionHistory(child);
    const body = bodies(history).join("\n");
    expect(body).toContain("P1");
    expect(body).toContain("PARENT_ANSWER");
    expect(body).toContain("CHILD_USER");

    expect((await replay(child)).map((e) => e.type)).toEqual(["session_meta", "user_message"]);
    expect(createHash("sha256").update(await readFile(parent)).digest("hex")).toBe(before);
    void ws;
  });

  it("createSessionProvider 的 assemble 走来源视图；没分叉的会话仍走原投影", async () => {
    const { ws, root } = await setup();
    const parent = await writeSession(root, "parent", [user("P1"), assistant("PARENT_ANSWER")]);
    const child = await writeSession(root, "child", [forkMeta(parent, 2, "parent"), user("CHILD_USER")]);
    const plain = await writeSession(root, "plain", [user("L1"), assistant("LOCAL_ANSWER")]);

    const forked = bodies(await historyThroughProvider(child, ws)).join("\n");
    expect(forked).toContain("PARENT_ANSWER");
    expect(forked).toContain("CHILD_USER");

    const plainHistory = await historyThroughProvider(plain, ws);
    const expected = projectContext(await replay(plain)) as unknown as GlmMessage[];
    expect(plainHistory).toEqual(expected); // 零行为变化
  });
});
