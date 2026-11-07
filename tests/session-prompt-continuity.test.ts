import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { handleAgentRun, waitForSessionTailWork } from "../src/main/agent-runner";
import { initSettingsStore, setSettings } from "../src/main/settings-handlers";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";

let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});

it("main and session-end requests keep the same personalized system prefix", async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-prompt-continuity-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  vi.stubEnv("M0A_PROVIDER", "");
  vi.stubEnv("CAIRN_MODEL", "");
  vi.stubEnv("M2D_MEMORY_HOME", join(root, "memory"));
  vi.stubEnv(PROVIDER_ENV_KEYS.glm, "test-key");
  initSettingsStore(join(root, "settings.json"));
  await setSettings({ provider: "glm", model: "glm-standard", autoMemory: true, customInstructions: "用简体中文解释，保留用户未提交的修改。" });
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response('data: {"choices":[{"delta":{"content":"无"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    });
  }));

  const logPath = join(root, "session.jsonl");
  const result = await handleAgentRun({ message: "检查现状，记住我的反馈。", mode: "auto" }, { workspace, logPath });
  await waitForSessionTailWork(logPath);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  expect(requests).toHaveLength(2);
  const systems = requests.map((request) => request.messages.filter((message) => message.role === "system"));
  expect(systems[0]).not.toHaveLength(0);
  expect(JSON.stringify(systems[0])).toContain("用简体中文解释，保留用户未提交的修改。");
  expect(systems[1]).toEqual(systems[0]);
  expect(JSON.stringify(requests[1]?.messages.at(-1))).toContain("会话结束沉淀检查");
});
