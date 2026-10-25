import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceOrchestrationBackend, type WorkspaceOrchestrationBackendOptions } from "../src/main/orchestration-backend";
import { initSettingsStore } from "../src/main/settings-handlers";
import { DEFAULT_SETTINGS } from "../src/main/settings";
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";
import type { MainModelSelection } from "../src/main/provider-runtime";
import type { ExecutionRequest } from "../src/orchestration/types";
import { orchestrationPlan } from "./orchestration-fixture";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
function selection(id = "deepseek-cheap"): MainModelSelection {
  const spec = DEFAULT_MODEL_TABLE.find((row) => row.id === id)!;
  return { kind: spec.provider as "deepseek" | "anthropic" | "openai" | "glm", spec, modelExplicit: true };
}
function response(content = "done"): Response {
  return new Response(`data: ${JSON.stringify({ id: "answer", choices: [{ delta: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}
async function fixture(options: WorkspaceOrchestrationBackendOptions = {}) {
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-key");
  vi.stubEnv("DEEPSEEK_ENDPOINT", "https://api.deepseek.com/chat/completions");
  const root = await mkdtemp(join(tmpdir(), "orch-provider-")); roots.push(root);
  const workspace = join(root, "workspace"); await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src/a.txt"), "answer\n");
  const captures: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => { captures.push(init!); return response(); };
  const backend = await createWorkspaceOrchestrationBackend(workspace, join(root, "data"), { selection: selection(), fetchImpl, ...options });
  const plan = orchestrationPlan(); plan.tasks[0].contract.acceptance = [{ kind: "evidence", id: "revision", fields: ["revision"] }];
  const task = plan.tasks[0]; const spec = plan.agents[0];
  const request: ExecutionRequest = { plan, task, run_id: "run", request_id: "request", signal: new AbortController().signal, context: { plan_goal: plan.goal, plan_non_goals: [], task_goal: task.goal, task_non_goals: [], inputs: [], write_scopes: [], acceptance: task.contract.acceptance, capability: spec.capability, budget: task.budget } };
  return { root, workspace, backend, request, captures };
}

describe("workspace orchestration provider budget gateway", () => {
  it("assembles without a network call, forwards only approved tools and forces the actual wire limits", async () => {
    const f = await fixture();
    expect(f.backend).not.toBeNull(); expect(f.captures).toHaveLength(0);
    const result = await f.backend!.execute(f.request);
    expect(result.summary).toBe("done"); expect(f.captures).toHaveLength(1);
    const body = JSON.parse(f.captures[0].body as string);
    expect(body.max_tokens).toBe(4096);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["read_file"]);
    expect(f.captures[0].redirect).toBe("error");
    expect(Buffer.byteLength(f.captures[0].body as string, "utf8")).toBeLessThanOrEqual(32768);
    expect(result.spent_usd).toBeCloseTo(0.0147456, 10);
  });

  it("reserves the highest input/cache-write tariff rather than observed or missing usage", async () => {
    const f = await fixture({ price: { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 3, cacheWritePerMTok: 5, calibrated: true } });
    const result = await f.backend!.execute(f.request);
    expect(result.spent_usd).toBeCloseTo(0.172032, 10);
  });

  it("rejects UTF8 request bytes over the cap before making any network call", async () => {
    const f = await fixture(); f.request.task.goal = "界".repeat(12000);
    await expect(f.backend!.execute(f.request)).rejects.toThrow(/request.*32768|32768.*request/i);
    expect(f.captures).toHaveLength(0);
  });

  it.each(["http", "sse", "network"])("blocks a second paid fetch during adapter %s retries", async (failure) => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      if (failure === "network") throw new Error("fixture connection lost");
      if (failure === "http") return new Response("overloaded", { status: 503, headers: { "retry-after": "0" } });
      return new Response('data: {"error":{"type":"server_error","message":"fixture overload"}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    };
    const f = await fixture({ fetchImpl });
    await expect(f.backend!.execute(f.request)).rejects.toThrow(/one.*fetch|fetch.*budget/i);
    expect(calls).toBe(1);
  });

  it("fails closed on unknown, incomplete or uncalibrated tariffs and unsupported models", async () => {
    for (const price of [null, { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 0.1, cacheWritePerMTok: null, calibrated: true as const }, { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1 }, { inputPerMTok: -1, outputPerMTok: 1, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1, calibrated: true as const }]) {
      const f = await fixture({ price }); expect(f.backend).toBeNull(); expect(f.captures).toHaveLength(0);
    }
    for (const picked of [{ kind: "demo" } as const, selection("glm-standard"), selection("openai-standard"), { ...selection(), spec: { ...selection().kind !== "demo" && (selection() as Exclude<MainModelSelection, { kind: "demo" }>).spec, model: "unpriced-model" } } as MainModelSelection]) {
      const f = await fixture({ selection: picked }); expect(f.backend).toBeNull(); expect(f.captures).toHaveLength(0);
    }
  });

  it("uses the initialized settings selection and mapped env key without exporting it", async () => {
    const f = await fixture();
    const path = join(f.root, "settings.json");
    await writeFile(path, JSON.stringify({ ...DEFAULT_SETTINGS, provider: "deepseek", model: "deepseek-cheap" })); initSettingsStore(path);
    vi.stubEnv("M0A_PROVIDER", "");
    const backend = await createWorkspaceOrchestrationBackend(f.workspace, join(f.root, "default-data"), { fetchImpl: async () => response() });
    expect(backend).not.toBeNull();
    expect(JSON.stringify(backend)).not.toContain("fixture-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(await createWorkspaceOrchestrationBackend(f.workspace, join(f.root, "no-key"))).toBeNull();
  });

  it("enforces Anthropic max_tokens and explicitly disables thinking on the transmitted request", async () => {
    const captures: RequestInit[] = [];
    const f = await fixture({ selection: selection("anthropic-cheap"), fetchImpl: async (_url, init) => {
      captures.push(init!);
      return new Response('event: message_start\ndata: {"type":"message_start","message":{"id":"a","usage":{"input_tokens":3}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
    } });
    const result = await f.backend!.execute(f.request);
    const body = JSON.parse(captures[0].body as string);
    expect(result.summary).toBe("done"); expect(body.max_tokens).toBe(4096); expect(body.thinking).toEqual({ type: "disabled" });
    expect(result.spent_usd).toBeCloseTo(0.06144, 10);
  });

  it("refuses a provider endpoint override before sending credentials or a request", async () => {
    const f = await fixture(); vi.stubEnv("DEEPSEEK_ENDPOINT", "https://proxy.invalid/chat/completions");
    await expect(f.backend!.execute(f.request)).rejects.toThrow(/endpoint/i);
    expect(f.captures).toHaveLength(0);
  });
});
