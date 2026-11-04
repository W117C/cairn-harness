import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/agent/orchestrator";
import { closeAllEventLogs, createEventLog, replay, type AgentEvent } from "../src/events";
import { compactSessionLog } from "../src/main/compact-and-report";
import {
  handleAgentRun,
  handleCompact,
} from "../src/main/agent-runner";
import {
  handleSessionCreate,
  handleSessionFork,
  handleSessionOpen,
  handleSessionRevert,
  initSessionsDir,
  setSessionRootResolver,
} from "../src/main/session-handlers";
import { createSession, pathOf } from "../src/main/sessions";
import { writeSessionPreferences } from "../src/main/session-preferences";
import { initSettingsStore, setSettings } from "../src/main/settings-handlers";
import { streamAnthropic } from "../src/providers/anthropic";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { streamGemini } from "../src/providers/gemini";
import { streamOpenAI } from "../src/providers/openai";
import { DEFAULT_MODEL_TABLE, type ModelSpec } from "../src/providers/registry";

let root = "";
let defaultSessions = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-multi-provider-reg-"));
  defaultSessions = join(root, "default-sessions");
  await mkdir(defaultSessions, { recursive: true });
  initSettingsStore(join(root, "settings.json"));
  initSessionsDir(defaultSessions, {
    projectRegistryPath: join(root, "projects.json"),
    sessionMetadataPath: join(root, "session-metadata.json"),
  });
  setSessionRootResolver(null);
  vi.stubEnv("M0A_PROVIDER", "");
  vi.stubEnv("CAIRN_MODEL", "");
  vi.stubEnv("CAIRN_API_KEY", "");
});

afterEach(async () => {
  setSessionRootResolver(null);
  await closeAllEventLogs();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function rawStreamResponse(rawBody: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(rawBody));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("多厂商一致性：手动压缩 /compact 与未开路由的 spawn_agent", () => {
  it("非 GLM 会话（OpenAI）无 CAIRN_API_KEY 时可执行手动压缩，且优先遵循会话级模型偏好", async () => {
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "sk-openai-test");
    await setSettings({ provider: "openai", model: "openai-cheap", autoMemory: false });

    const created = await handleSessionCreate("openai-compact");
    const logPath = pathOf(defaultSessions, created.id);
    await writeSessionPreferences(logPath, { model: "openai-standard" });

    const log = createEventLog(logPath);
    for (let i = 0; i < 16; i += 1) {
      await log.append({ type: "user_message", content: `第 ${String(i)} 轮长上下文提问：` + "内容填充 ".repeat(1500) });
      await log.append({ type: "assistant_message", content: `第 ${String(i)} 轮长上下文回答：` + "细节展开 ".repeat(1500) });
    }
    await log.close?.();

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          id: "sum-1",
          choices: [{ message: { content: "## Objective\n- OpenAI 摘要完成\n\n## Next Move\n- 继续" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }));

    const res = await compactSessionLog(logPath);
    expect(res.ok, res.error).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.body.model).toBe("gpt-4o");
  });

  it("未开启 routing 时 Orchestrator 沿用父会话 defaultModelSpec（不要求 CAIRN_API_KEY，也不借用环境变量里的 GLM key）", async () => {
    const openaiSpec = DEFAULT_MODEL_TABLE.find((m) => m.id === "openai-standard") as ModelSpec;
    const logPath = join(root, "orch.jsonl");

    // ① 即使环境里有 CAIRN_API_KEY，只要父会话选的 OpenAI 缺 key，也必须 fail-closed 拒派而非偷切 GLM
    vi.stubEnv(PROVIDER_ENV_KEYS.glm, "glm-key-present");
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "");
    const emitted: AgentEvent[] = [];
    const orchMissing = new Orchestrator({
      logPath,
      workspace: root,
      parentMode: "default",
      defaultModelSpec: openaiSpec,
      emit: async (e) => { emitted.push(e); },
    });
    delete process.env[PROVIDER_ENV_KEYS.openai];
    const denied = await orchMissing.spawn({ mode: "read", task: "检查文件" }, {});
    expect(denied.ok).toBe(false);
    expect(denied.output).toContain("OPENAI_API_KEY");

    // ② 配齐 OPENAI_API_KEY 且清空 CAIRN_API_KEY 后，read worker 直接拨 OpenAI 并顺利完成
    delete process.env[PROVIDER_ENV_KEYS.glm];
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "sk-openai-worker");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return rawStreamResponse(
        'data: {"id":"w-1","choices":[{"delta":{"content":"worker 调研完毕"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\ndata: [DONE]\n',
      );
    }));
    const orchOk = new Orchestrator({
      logPath,
      workspace: root,
      parentMode: "default",
      defaultModelSpec: openaiSpec,
      emit: async (e) => { emitted.push(e); },
    });
    const spawned = await orchOk.spawn({ mode: "read", task: "检查文件" }, {});
    expect(spawned.ok, spawned.output).toBe(true);
    const joined = await orchOk.waitForAgents([], 5_000);
    expect(joined.rows[0]?.status).toBe("done");
    expect(calls[0]).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("流式适配器 EOF 尾帧冲刷与半帧截断检测", () => {
  it("OpenAI / Anthropic / Gemini 末尾无换行符的完整 SSE 帧不丢字，半截 JSON 尾帧显式报错", async () => {
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "k");
    vi.stubEnv(PROVIDER_ENV_KEYS.anthropic, "k");
    vi.stubEnv(PROVIDER_ENV_KEYS.gemini, "k");

    const oaiOut: string[] = [];
    for await (const ev of streamOpenAI(
      [{ role: "user", content: "hi" }],
      {
        model: "gpt-4o",
        fetchImpl: async () => rawStreamResponse('data: {"id":"1","choices":[{"delta":{"content":"尾帧无换行"},"finish_reason":"stop"}]}'),
      },
    )) {
      if (ev.type === "assistant_delta") oaiOut.push(ev.text);
    }
    expect(oaiOut.join("")).toBe("尾帧无换行");

    const antOut: string[] = [];
    for await (const ev of streamAnthropic(
      [{ role: "user", content: "hi" }],
      {
        model: "claude-sonnet-4-6",
        fetchImpl: async () => rawStreamResponse(
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anthropic尾帧"}}',
        ),
      },
    )) {
      if (ev.type === "assistant_delta") antOut.push(ev.text);
    }
    expect(antOut.join("")).toBe("Anthropic尾帧");

    const gemOut: string[] = [];
    for await (const ev of streamGemini(
      [{ role: "user", content: "hi" }],
      {
        model: "gemini-2.5-flash",
        fetchImpl: async () => rawStreamResponse(
          'data: {"candidates":[{"content":{"parts":[{"text":"Gemini尾帧"}],"role":"model"},"finishReason":"STOP"}]}',
        ),
      },
    )) {
      if (ev.type === "assistant_delta") gemOut.push(ev.text);
    }
    expect(gemOut.join("")).toBe("Gemini尾帧");

    await expect(async () => {
      for await (const _ of streamOpenAI(
        [{ role: "user", content: "hi" }],
        {
          model: "gpt-4o",
          fetchImpl: async () => rawStreamResponse('data: {"id":"1","choices":[{"delta":{"content":"半截'),
        },
      )) {
        // 消费触发尾帧解析
      }
    }).rejects.toThrow(/SSE 帧损坏/);
  });
});

describe("多根会话归属解析与运行时工具开关热更新", () => {
  it("项目文件夹会话通过 setSessionRootResolver 可正常 open / fork / revert / compact", async () => {
    const projectWs = join(root, "proj-ws");
    const projectSessions = join(projectWs, ".agent", "sessions");
    await mkdir(projectSessions, { recursive: true });
    setSessionRootResolver(async (sid) => (sid.startsWith("proj-") ? projectSessions : defaultSessions));

    const createdId = await createSession(projectSessions, "proj-s1");
    const logPath = pathOf(projectSessions, createdId);
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "第一轮" });
    await log.append({ type: "assistant_message", content: "第一轮答复" });
    await log.close?.();

    const opened = await handleSessionOpen(createdId);
    expect(opened.events.some((e) => e.type === "user_message" && e.content === "第一轮")).toBe(true);

    const forked = await handleSessionFork(createdId, 1, true);
    expect(forked.ok, forked.error).toBe(true);
    expect(forked.id).toBe("proj-s1-f1");

    const reverted = await handleSessionRevert(createdId, 1);
    expect(reverted.ok).toBe(false);
    expect(reverted.error).toContain("没有可回滚的文件改动");

    vi.stubEnv("M1D_COMPACTION_DEMO", "1");
    const log2 = createEventLog(logPath);
    for (let i = 0; i < 8; i += 1) {
      await log2.append({ type: "user_message", content: "填充内容 ".repeat(80) });
      await log2.append({ type: "assistant_message", content: "填充回复 ".repeat(80) });
    }
    await log2.close?.();
    const compacted = await handleCompact({ sessionId: createdId });
    expect(compacted.ok, compacted.error).toBe(true);
    const afterEvents = await replay(logPath);
    expect(afterEvents.some((e) => e.type === "compaction")).toBe(true);
  });

  it("同一进程内切换 autoMemory 开关后，下一场 run 的工具面即时挂载 remember（不再被首跑冻结）", async () => {
    vi.stubEnv(PROVIDER_ENV_KEYS.openai, "sk-live-switch");
    const seenToolSets: string[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tools?: Array<{ function?: { name?: string } }> };
      seenToolSets.push((body.tools ?? []).map((t) => t.function?.name ?? ""));
      return rawStreamResponse(
        'data: {"id":"1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\ndata: [DONE]\n',
      );
    }));

    await setSettings({ provider: "openai", model: "openai-standard", autoMemory: false });
    await writeFile(join(root, "dummy.txt"), "x", "utf8");
    const r1 = await handleAgentRun(
      { message: "first", mode: "default", model: "openai-standard" },
      { workspace: root, logPath: join(root, "r1.jsonl"), unattended: true },
    );
    expect(r1.ok, r1.error).toBe(true);
    expect(seenToolSets[0]).not.toContain("remember");

    await setSettings({ autoMemory: true });
    const r2 = await handleAgentRun(
      { message: "second", mode: "default", model: "openai-standard" },
      { workspace: root, logPath: join(root, "r2.jsonl"), unattended: true },
    );
    expect(r2.ok, r2.error).toBe(true);
    expect(seenToolSets[1]).toContain("remember");
  });
});
