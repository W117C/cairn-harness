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
import { injectStoredProviderKey, revokeInjectedProviderKey } from "../src/main/provider-key-inject";
import { setProviderKeyBackend } from "../src/main/provider-keys";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { deriveCustomProviders, parseCustomProviders } from "../src/providers/provider-config";
import { DEFAULT_MODEL_TABLE, installCustomProviders, installedCustomProviders, type ModelSpec } from "../src/providers/registry";

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

describe("思考首选档接线", () => {
  it("客户端没传 thinking ⇒ 模型声明的 reasoningDefault 进第一跳请求体；显式档位/off 仍优先", async () => {
    const parsed = parseCustomProviders({
      version: 1,
      providers: [{
        id: "myprovider",
        label: "我的模型",
        protocol: "openai",
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MYPROVIDER_API_KEY",
        models: [{
          id: "chat",
          model: "gpt-x",
          contextWindow: 131_072,
          reasoningEfforts: ["low", "high"],
          reasoningDefault: "high",
        }],
      }],
    });
    expect(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.problems)).toBe(true);
    if (!parsed.ok) return;
    const derived = deriveCustomProviders(parsed.file);
    installCustomProviders(derived);
    await mkdir(join(root, ".agent"), { recursive: true });
    await writeFile(join(root, ".agent", "providers.json"), JSON.stringify(parsed.file));
    const spec = derived[0]!.specs[0]!;
    const selection = { kind: "custom" as const, providerId: "myprovider", spec, modelExplicit: true };
    try {
      vi.stubEnv("MYPROVIDER_API_KEY", "test-key-never-logged");
      await setSettings({ provider: "openai", model: "openai-standard", autoMemory: false });
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return streamResponse([
          'data: {"id":"x","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ]);
      }));

      const first = await handleAgentRun(
        { message: "hello", mode: "read-only" },
        { workspace: root, logPath: join(root, "reasoning-default.jsonl"), modelSelection: selection },
      );
      expect(first.ok, first.error).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.example.com/v1/chat/completions");
      expect(calls[0]?.body.reasoning_effort, "声明了首选 high 却没发出去").toBe("high");

      const second = await handleAgentRun(
        { message: "hello again", mode: "read-only", thinking: "low" },
        { workspace: root, logPath: join(root, "reasoning-explicit.jsonl"), modelSelection: selection },
      );
      expect(second.ok, second.error).toBe(true);
      expect(calls[1]?.body.reasoning_effort).toBe("low");

      const third = await handleAgentRun(
        { message: "hello off", mode: "read-only", thinking: "off" },
        { workspace: root, logPath: join(root, "reasoning-off.jsonl"), modelSelection: selection },
      );
      expect(third.ok, third.error).toBe(true);
      expect(calls[2]?.body.reasoning_effort).toBeUndefined();
    } finally {
      installCustomProviders([]);
    }
  });
});

// ---- P1（2026-11-07 真机实证）：自定义 provider 注册表是进程级、随窗口工作区切换换装/清空，
// 而 run 的工作区可以 ≠ 窗口上下文（临时对话发送、主页选项目发送、调度器触发）。修法 =
// handleAgentRun 在模型解析前把 run 工作区的 providers.json **并装**（additive-only）。
describe("run 工作区自定义家并装（P1 修）", () => {
  it("同名 provider 按运行工作区拨号，且不会被未配置的工作区继承", async () => {
    const first = join(root, "project-a");
    const second = join(root, "project-b");
    const missing = join(root, "project-c");
    const config = (project: string, apiKeyEnv: string) => ({
      version: 1,
      providers: [{
        id: "shared",
        protocol: "openai",
        baseURL: `https://${project}.example.com/v1`,
        apiKeyEnv,
        models: [{ id: "chat", model: `${project}-chat` }],
      }],
    });
    for (const [workspace, file] of [[first, config("a", "PROJECT_A_KEY")], [second, config("b", "PROJECT_B_KEY")]] as const) {
      await mkdir(join(workspace, ".agent"), { recursive: true });
      await writeFile(join(workspace, ".agent", "providers.json"), JSON.stringify(file));
    }
    await mkdir(missing);
    const parsed = parseCustomProviders(config("a", "PROJECT_A_KEY"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    const registered = deriveCustomProviders(parsed.file);
    installCustomProviders(registered);
    try {
      await setSettings({ provider: "shared", model: "shared-chat", autoMemory: false });
      vi.stubEnv("PROJECT_A_KEY", "fixture-a");
      vi.stubEnv("PROJECT_B_KEY", "fixture-b");
      const calls: { url: string; model: string; authorization: string | null }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), model: JSON.parse(String(init?.body)).model, authorization: new Headers(init?.headers).get("authorization") });
        return streamResponse(ROUTES[1].sse);
      }));
      const run = (workspace: string, suffix: string) => handleAgentRun(
        { message: "fixture", mode: "read-only", model: "shared-chat" },
        { workspace, logPath: join(root, `route-${suffix}.jsonl`) },
      );
      expect(await run(first, "a")).toEqual({ ok: true });
      expect(await run(second, "b")).toEqual({ ok: true });
      expect(await run(missing, "missing")).toMatchObject({ ok: false, error: expect.stringContaining("shared-chat") });
      expect(calls).toEqual([
        { url: "https://a.example.com/v1/chat/completions", model: "a-chat", authorization: "Bearer fixture-a" },
        { url: "https://b.example.com/v1/chat/completions", model: "b-chat", authorization: "Bearer fixture-b" },
      ]);
      expect(installedCustomProviders()).toBe(registered);
    } finally {
      installCustomProviders([]);
    }
  });

  it("禁止同名但不同端点的项目复用 Cairn 为另一端点注入的密钥", async () => {
    const config = (host: string) => ({
      version: 1, providers: [{
        id: "byok-shared", protocol: "openai", baseURL: `https://${host}.example.com/v1`,
        apiKeyEnv: "REVIEW_BYOK_SHARED_KEY", models: [{ id: "chat", model: "chat" }],
      }],
    });
    const parsed = parseCustomProviders(config("original"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    installCustomProviders(deriveCustomProviders(parsed.file));
    vi.stubEnv("REVIEW_BYOK_SHARED_KEY", undefined);
    setProviderKeyBackend({
      name: "fixture", isAvailable: () => true, get: async () => "fixture-byok",
      set: async () => undefined, delete: async () => true, storedProviders: async () => ["byok-shared"],
    });
    try {
      expect(await injectStoredProviderKey(["byok-shared"])).toBe(true);
      await setSettings({ provider: "byok-shared", model: "byok-shared-chat", autoMemory: false });
      installCustomProviders([]); // 窗口切走，原端点的 BYOK 值仍在环境中
      await mkdir(join(root, ".agent"), { recursive: true });
      await writeFile(join(root, ".agent", "providers.json"), JSON.stringify(config("other")));
      const { calls } = await installRoute(ROUTES[1]);
      expect(await handleAgentRun(
        { message: "fixture", mode: "read-only" },
        { workspace: root, logPath: join(root, "byok.jsonl") },
      )).toMatchObject({ ok: false, error: expect.stringContaining("REVIEW_BYOK_SHARED_KEY") });
      expect(calls).toHaveLength(0);
    } finally {
      revokeInjectedProviderKey("byok-shared");
      setProviderKeyBackend(null);
      installCustomProviders([]);
    }
  });

  it("冷启动后，当前窗口未装载的自定义模型仍可在实际工作区显式选择", async () => {
    const file = {
      version: 1,
      providers: [{
        id: "only-here", protocol: "openai", baseURL: "https://only-here.example.com/v1",
        apiKeyEnv: "ONLY_HERE_KEY", models: [{ id: "chat", model: "here-chat" }],
      }],
    };
    await mkdir(join(root, ".agent"), { recursive: true });
    await writeFile(join(root, ".agent", "providers.json"), JSON.stringify(file));
    await writeFile(join(root, "settings.json"), JSON.stringify({ provider: "only-here", model: "only-here-chat", autoMemory: false }));
    initSettingsStore(join(root, "settings.json"));
    vi.stubEnv("ONLY_HERE_KEY", "fixture-only-here");
    const { calls } = await installRoute(ROUTES[1]);
    const run = (model?: string) => handleAgentRun(
      { message: "fixture", mode: "read-only", ...(model ? { model } : {}) },
      { workspace: root, logPath: join(root, `${model ?? "settings"}.jsonl`) },
    );
    expect(await run("only-here-chat")).toEqual({ ok: true });
    expect(await run()).toEqual({ ok: true });
    expect(calls.map((call) => [call.url, call.body.model])).toEqual([
      ["https://only-here.example.com/v1/chat/completions", "here-chat"],
      ["https://only-here.example.com/v1/chat/completions", "here-chat"],
    ]);
    expect(installedCustomProviders()).toEqual([]);
  });

  it("注册表未装而 run 工作区声明的自定义家：起跑前并装 ⇒ 解析过、按那家拨号", async () => {
    // 真实时序：provider 在装着的时候被写进 settings（选择器写盘），随后窗口切走清空注册表；
    // settings 首读缓存的正是原始串。这里按同一时序摆布：先装 → 写设置 → 清空。
    try {
      const ws = join(root, "pin-ws");
      await mkdir(join(ws, ".agent"), { recursive: true });
      const file = {
        version: 1,
        providers: [
          {
            id: "pinws",
            protocol: "openai",
            baseURL: "https://pinws.example.com/v1",
            apiKeyEnv: "PINWS_API_KEY",
            models: [{ id: "chat", model: "pin-model" }],
          },
        ],
      };
      await writeFile(join(ws, ".agent", "providers.json"), JSON.stringify(file));
      const parsed = parseCustomProviders(JSON.parse(JSON.stringify(file)));
      expect(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.problems)).toBe(true);
      if (!parsed.ok) return;
      installCustomProviders(deriveCustomProviders(parsed.file));
      await setSettings({ provider: "pinws", model: "pinws-chat", autoMemory: false });
      installCustomProviders([]); // 模拟窗口切到无 providers.json 上下文后的空注册表
      vi.stubEnv("PINWS_API_KEY", "test-key-never-logged");
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return streamResponse([
          'data: {"id":"pinws-1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
          "data: [DONE]",
        ]);
      }));

      const res = await handleAgentRun(
        { message: "hello", mode: "read-only" },
        { logPath: join(root, "pin-union.jsonl"), workspace: ws },
      );
      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://pinws.example.com/v1/chat/completions");
    } finally {
      installCustomProviders([]);
    }
  });

  it("负针：注册表没有且工作区也没声明的自定义家，仍 fail-visible（不静默回落）", async () => {
    // 同上时序：settings 里留着当年装过、现已不在注册表的 provider 串。
    const ghostFile = {
      version: 1,
      providers: [
        { id: "ghost-provider", protocol: "openai", baseURL: "https://ghost.example.com/v1", apiKeyEnv: "GHOST_KEY", models: [{ id: "chat", model: "ghost-model" }] },
      ],
    } as const;
    const ghostParsed = parseCustomProviders(JSON.parse(JSON.stringify(ghostFile)));
    expect(ghostParsed.ok, ghostParsed.ok ? undefined : JSON.stringify(ghostParsed.problems)).toBe(true);
    if (!ghostParsed.ok) return;
    installCustomProviders(deriveCustomProviders(ghostParsed.file));
    try {
      await setSettings({ provider: "ghost-provider", model: "", autoMemory: false });
      installCustomProviders([]);
      const res = await handleAgentRun(
        { message: "hello", mode: "read-only" },
        { logPath: join(root, "pin-ghost.jsonl"), workspace: root },
      );
      expect(res.ok, JSON.stringify(res)).toBe(false);
      if (res.ok === false) expect(res.error ?? "").toContain("未知主会话 provider");
    } finally {
      installCustomProviders([]);
    }
  });
});
