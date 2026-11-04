import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replay } from "../src/events";
import { validateRunRequestEnvelope } from "../src/main/run-request";
import { initSettingsStore, setSettings } from "../src/main/settings-handlers";
import { handleSessionCreate, initSessionsDir } from "../src/main/session-handlers";
import { pathOf } from "../src/main/sessions";
import { handleAgentDecide, handleAgentRun, setAppHooks, waitForSessionTailWork } from "../src/main/agent-runner";
import type { AskPayload } from "../src/main/ipc-protocol";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, type ModelSpec } from "../src/providers/registry";

/** 最小合法 1×1 PNG（magic number 完整）。 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const ROUTES = [
  {
    provider: "glm" as const,
    modelId: "glm-standard",
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    sse: [
      'data: {"id":"glm-1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      "data: [DONE]",
    ],
  },
  {
    provider: "openai" as const,
    modelId: "openai-standard",
    url: "https://api.openai.com/v1/chat/completions",
    sse: [
      'data: {"id":"openai-1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      "data: [DONE]",
    ],
  },
  {
    provider: "anthropic" as const,
    modelId: "anthropic-cheap",
    url: "https://api.anthropic.com/v1/messages",
    sse: [
      'data: {"type":"message_start","message":{"id":"msg-1","usage":{"input_tokens":1,"output_tokens":0}}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      'data: {"type":"message_stop"}',
    ],
  },
  {
    provider: "gemini" as const,
    modelId: "gemini-cheap",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    sse: [
      'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}',
    ],
  },
] as const;

let root = "";
let sessionsDir = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-main-provider-"));
  sessionsDir = join(root, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  initSettingsStore(join(root, "settings.json"));
  initSessionsDir(sessionsDir, {
    projectRegistryPath: join(root, "projects.json"),
    sessionMetadataPath: join(root, "session-metadata.json"),
  });
  vi.stubEnv("M0A_PROVIDER", "");
  vi.stubEnv("CAIRN_MODEL", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function streamResponse(lines: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function installRoute(route: (typeof ROUTES)[number]): Promise<{ calls: Array<{ url: string; body: Record<string, unknown> }> }> {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return streamResponse(route.sse);
  }));
  return { calls };
}

describe("RunRequest boundary", () => {
  it("rejects unknown fields, model names at the request boundary, unknown thinking, and unknown attachment fields", () => {
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", mystery: true })).toMatchObject({ ok: false });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", model: "gpt-4o" })).toMatchObject({ ok: false });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", model: "x".repeat(129) })).toMatchObject({ ok: false });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", model: "openai-standard", thinking: "extreme" })).toMatchObject({ ok: false });
    expect(
      validateRunRequestEnvelope({
        message: "x",
        mode: "default",
        attachments: [{ path: "a", kind: "file", explicit: true, contents: "forbidden" }],
      }),
    ).toMatchObject({ ok: false });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", model: "openai-standard", thinking: "off" })).toMatchObject({ ok: true });
    // v23 Plan 模式：显式 true/false 都放行并原样保留；非布尔拒绝（缺省 = 交给 settings 默认）。
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", planRequired: true })).toMatchObject({ ok: true, value: { planRequired: true } });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", planRequired: false })).toMatchObject({ ok: true, value: { planRequired: false } });
    expect(validateRunRequestEnvelope({ message: "x", mode: "default", planRequired: "yes" })).toMatchObject({ ok: false });
  });

  it("handleAgentRun repeats boundary validation and rejects unsupported thinking before dialing", async () => {
    await expect(
      handleAgentRun({ message: "x", mode: "default", model: "ghost-model" } as never, { workspace: root, logPath: join(root, "ghost.jsonl") }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/model/) });
    await expect(
      handleAgentRun(
        { message: "x", mode: "default", model: "openai-standard", thinking: "high" },
        { workspace: root, logPath: join(root, "thinking.jsonl") },
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/thinking/) });
  });

  it("fails closed for outside-workspace attachments with an explicit approval-required result", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-"));
    try {
      const file = join(outside, "secret.txt");
      await writeFile(file, "not for preload", "utf8");
      const response = await handleAgentRun(
        {
          message: "read it",
          mode: "default",
          attachments: [{ path: file, kind: "file", explicit: true }],
        },
        { workspace: root, logPath: join(root, "outside.jsonl") },
      );
      expect(response).toMatchObject({ ok: false, error: expect.stringMatching(/approval|审批/i) });
      expect(response.error).not.toContain(outside);
      await expect(readFile(join(root, "outside.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("runs with an outside-workspace image without any approval ask", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-image-"));
    try {
      vi.stubEnv(PROVIDER_ENV_KEYS.glm, "test-key-never-logged");
      await setSettings({ provider: "glm", model: "glm-standard", autoMemory: false });
      const file = join(outside, "shot.png");
      await writeFile(file, PNG_1X1);
      const asks: AskPayload[] = [];
      setAppHooks({
        onAsk: (payload) => {
          asks.push(payload);
          handleAgentDecide(payload.askId, false);
        },
      });
      try {
        const { calls } = await installRoute(ROUTES[0]);
        // 无 session ⇒ 若仍走审批会落到 unattended 门并立即失败；跑通即证明没有询问。
        const response = await handleAgentRun(
          {
            message: "look at it",
            mode: "read-only",
            model: "glm-standard",
            attachments: [{ path: file, kind: "file", explicit: true }],
          },
          { workspace: root, logPath: join(root, "outside-image.jsonl") },
        );
        expect(response, response.error).toMatchObject({ ok: true, attachmentCount: 1 });
        expect(asks).toHaveLength(0);
        expect(calls).toHaveLength(1);
        expect(JSON.stringify(calls[0]?.body)).toContain(await realpath(file));
      } finally {
        setAppHooks({ onAsk: undefined });
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("asks only for the non-image paths in a mixed outside bundle", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-mixed-"));
    try {
      vi.stubEnv(PROVIDER_ENV_KEYS.glm, "test-key-never-logged");
      await setSettings({ provider: "glm", model: "glm-standard", autoMemory: false });
      const image = join(outside, "shot.png");
      const note = join(outside, "note.txt");
      await writeFile(image, PNG_1X1);
      await writeFile(note, "approved mixed content", "utf8");
      const created = await handleSessionCreate("outside-mixed");
      const logPath = pathOf(sessionsDir, created.id);
      const asks: AskPayload[] = [];
      setAppHooks({
        onAsk: (payload) => {
          asks.push(payload);
          expect(handleAgentDecide(payload.askId, true)).toBe(true);
        },
      });
      try {
        const { calls } = await installRoute(ROUTES[0]);
        const response = await handleAgentRun(
          {
            message: "read both",
            mode: "read-only",
            model: "glm-standard",
            sessionId: created.id,
            attachments: [
              { path: image, kind: "file", explicit: true },
              { path: note, kind: "file", explicit: true },
            ],
          },
          { workspace: root, logPath },
        );
        expect(response, response.error).toMatchObject({ ok: true, attachmentCount: 2 });
        expect(asks).toHaveLength(1);
        expect(asks[0]?.args).toMatchObject({
          paths: [await realpath(note)],
          count: 1,
          autoApprovedImages: 1,
        });
        const body = JSON.stringify(calls[0]?.body);
        expect(body).toContain(await realpath(image));
        expect(body).toContain(await realpath(note));
      } finally {
        setAppHooks({ onAsk: undefined });
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("asks once for an outside attachment and passes the approved canonical path to the run", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-approved-"));
    try {
      const route = ROUTES[0];
      vi.stubEnv(PROVIDER_ENV_KEYS.glm, "test-key-never-logged");
      await setSettings({ provider: "glm", model: "glm-standard", autoMemory: false });
      const file = join(outside, "note.txt");
      await writeFile(file, "approved outside content", "utf8");
      const created = await handleSessionCreate("outside-approved");
      const logPath = pathOf(sessionsDir, created.id);
      const asks: AskPayload[] = [];
      setAppHooks({
        onAsk: (payload) => {
          asks.push(payload);
          expect(handleAgentDecide(payload.askId, true)).toBe(true);
        },
      });
      try {
        const { calls } = await installRoute(route);
        const response = await handleAgentRun(
          {
            message: "read it",
            mode: "read-only",
            model: "glm-standard",
            sessionId: created.id,
            attachments: [{ path: file, kind: "file", explicit: true }],
          },
          { workspace: root, logPath },
        );
        expect(response).toMatchObject({ ok: true, attachmentCount: 1 });
        expect(asks).toHaveLength(1);
        expect(asks[0]?.tool).toBe("attachment");
        expect(asks[0]?.args).toMatchObject({ paths: [await realpath(file)] });
        expect(calls).toHaveLength(1);
        expect(JSON.stringify(calls[0]?.body)).toContain(await realpath(file));
      } finally {
        setAppHooks({ onAsk: undefined });
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("stops before the run when the user rejects the outside attachment", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-outside-rejected-"));
    try {
      const file = join(outside, "note.txt");
      await writeFile(file, "rejected outside content", "utf8");
      const created = await handleSessionCreate("outside-rejected");
      const logPath = pathOf(sessionsDir, created.id);
      const asks: AskPayload[] = [];
      setAppHooks({
        onAsk: (payload) => {
          asks.push(payload);
          expect(handleAgentDecide(payload.askId, false)).toBe(true);
        },
      });
      try {
        const response = await handleAgentRun(
          {
            message: "read it",
            mode: "read-only",
            model: "glm-standard",
            sessionId: created.id,
            attachments: [{ path: file, kind: "file", explicit: true }],
          },
          { workspace: root, logPath },
        );
        expect(response).toMatchObject({ ok: false, error: expect.stringMatching(/审批.*已拒绝/) });
        expect(response.error).not.toContain(outside);
        expect(asks).toHaveLength(1);
        // 用户轮不得进日志：拒绝发生在装配之前，重放应为空。
        expect(await replay(logPath)).toEqual([]);
      } finally {
        setAppHooks({ onAsk: undefined });
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe.each(ROUTES)("$provider missing-key behavior", (route) => {
  it("fails visibly and never falls back to demo or another provider", async () => {
    vi.stubEnv(PROVIDER_ENV_KEYS[route.provider], "");
    await setSettings({ provider: route.provider, model: route.modelId, autoMemory: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleAgentRun(
      { message: "hello", mode: "read-only", model: route.modelId },
      { workspace: root, logPath: join(root, `${route.provider}-missing-key.jsonl`) },
    );
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining(PROVIDER_ENV_KEYS[route.provider]) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.each(ROUTES)("$provider main-session routing", (route) => {
  const spec = DEFAULT_MODEL_TABLE.find((model) => model.id === route.modelId) as ModelSpec;

  it.each([false, true])("uses the shared adapter for RunRequest sessionMode=%s", async (sessionMode) => {
    vi.stubEnv(PROVIDER_ENV_KEYS[route.provider], "test-key-never-logged");
    await setSettings({ provider: route.provider, model: route.modelId, autoMemory: false });
    const { calls } = await installRoute(route);
    let logPath = join(root, `${route.provider}-non-session.jsonl`);
    let sessionId: string | undefined;
    const req = { message: "hello", mode: "read-only" as const, model: route.modelId };
    if (sessionMode) {
      const created = await handleSessionCreate(`${route.provider}-session`);
      sessionId = created.id;
      logPath = pathOf(sessionsDir, sessionId);
    }

    const response = await handleAgentRun(
      sessionMode ? { ...req, sessionId } : req,
      sessionMode ? {} : { workspace: root, logPath },
    );
    expect(response.ok, response.error).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(route.url);
    if (route.provider === "gemini") expect(calls[0]?.body.model).toBeUndefined();
    else expect(calls[0]?.body.model).toBe(spec.model);
    const events = await replay(logPath);
    const text = events
      .filter((event) => event.type === "assistant_delta")
      .map((event) => event.text)
      .join("");
    expect(text).toBe("ok");
  });
});

describe("non-session transport reuse", () => {
  it("session-end distillation uses the same selected real adapter rather than falling back to GLM/demo", async () => {
    const route = ROUTES[1];
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "test-key-never-logged");
    await setSettings({ provider: "openai", model: route.modelId, autoMemory: true });
    const { calls } = await installRoute(route);

    const response = await handleAgentRun(
      { message: "run and remember", mode: "default", model: route.modelId },
      { workspace: root, logPath: join(root, "distill-route.jsonl") },
    );
    expect(response.ok, response.error).toBe(true);
    // 沉淀轮已转后台（2026-11-04「输出完了界面还在转」）：断言前等尾工落完。
    await waitForSessionTailWork(join(root, "distill-route.jsonl"));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((call) => call.url === route.url && call.body.model === "gpt-4o")).toBe(true);
  });
});

describe("in-workspace attachment is consumed as a path reference", () => {
  it("adds a bounded path-only context block and acknowledges the validated count", async () => {
    const route = ROUTES[0];
    vi.stubEnv(PROVIDER_ENV_KEYS.glm, "test-key-never-logged");
    await setSettings({ provider: "glm", model: "glm-standard", autoMemory: false });
    await writeFile(join(root, "context.txt"), "content stays local", "utf8");
    const { calls } = await installRoute(route);

    const response = await handleAgentRun(
      {
        message: "inspect it",
        mode: "read-only",
        model: "glm-standard",
        attachments: [{ path: "context.txt", kind: "file", explicit: true }],
      },
      { workspace: root, logPath: join(root, "attachment.jsonl") },
    );
    expect(response).toEqual({ ok: true, attachmentCount: 1 });
    expect(calls).toHaveLength(1);
    const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages.some((message) => message.role === "system" && message.content.includes("context.txt"))).toBe(true);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(root);
    expect(JSON.stringify(calls[0]?.body)).not.toContain("content stays local");
  });
});
