import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider, ModelOutput } from "../src/providers";
import type { AgentSpec, ExecutionRequest } from "../src/orchestration/types";
import { createLocalBackend, type LocalBackendOptions, type LocalProviderContext } from "../src/orchestration/local-backend";
import { createArtifactStore } from "../src/orchestration/artifacts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const capability = { tools: ["read_file", "grep", "glob", "write_file", "edit_file"], fs_read: ["src/**"], fs_write: ["src/**"], network: [], shell: "none", git: "none", external_effects: "none" } as const;
function request(): ExecutionRequest {
  const task = { task_id: "change", goal: "Change the answer", non_goals: [], agent_spec: "writer", lane: "write", depends_on: [], write_scopes: ["src/**"], inputs: [], contract: { acceptance: [{ kind: "evidence", id: "changed", fields: ["changed_paths"] }], effect: "workspace" }, budget: { usd: 1 }, max_attempts: 1, priority: 1 } as ExecutionRequest["task"];
  const spec: AgentSpec = { agent_spec_id: "writer", role: "writer", capability: structuredClone(capability) as unknown as AgentSpec["capability"], max_turns: 4 };
  const plan = { plan_id: "p", version: 1, goal: "test", non_goals: [], domain: "coding", tasks: [task], agents: [spec], budget: { usd: 2 }, max_concurrency: 2, policy_ref: "test", created_by: "user" } as ExecutionRequest["plan"];
  return { plan, task, run_id: "run", request_id: "request", context: { plan_goal: plan.goal, plan_non_goals: [], task_goal: task.goal, task_non_goals: [], inputs: [], write_scopes: task.write_scopes, acceptance: task.contract.acceptance, capability: spec.capability, budget: task.budget }, signal: new AbortController().signal };
}
function script(turns: ModelOutput[][]): Provider {
  let turn = 0;
  return { async *stream() { yield* turns[turn++] ?? [{ type: "assistant_message", content: "finished" }]; } };
}
const edit: ModelOutput = { type: "tool_call", id: "edit", name: "write_file", args: { path: "src/answer.txt", content: "42\n" } };
async function fixture(overrides: Partial<LocalBackendOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "orch-backend-")); roots.push(root);
  const workspace = join(root, "workspace"); await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src/answer.txt"), "old\n");
  const options: LocalBackendOptions = { workspace, dataDir: join(root, "data"), producer: { cost: { kind: "scripted" }, create: () => script([[edit]]) }, verifier: { cost: { kind: "scripted" }, create: (ctx) => script([[{ type: "assistant_message", content: JSON.stringify({ verdict: "pass", revision: ctx.revision }) }]]) }, ...overrides };
  return { root, workspace, options, backend: createLocalBackend(options), req: request() };
}

describe("local orchestration backend", () => {
  it("isolates writes, independently verifies the revision, then delivers exact bytes", async () => {
    let verifierContext: LocalProviderContext | undefined;
    const f = await fixture();
    f.options.verifier.create = (ctx) => { verifierContext = ctx; return { async *stream(messages, tools) {
      expect(messages.flatMap((m) => m.tool_calls ?? [])).toHaveLength(0);
      expect(messages.map((m) => m.content).join()).not.toContain("已写入");
      expect(tools?.map((t) => t.name)).toEqual(["read_file", "grep", "glob"]);
      yield { type: "assistant_message", content: JSON.stringify({ verdict: "pass", revision: ctx.revision }) };
    } }; };
    const result = await f.backend.execute(f.req);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("old\n");
    const verdict = await f.backend.verify(f.req, result);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.verifier_id).not.toBe(result.agent_id);
    expect(verifierContext?.role).toBe("verifier");
    await f.backend.deliver!(f.req, result);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("42\n");
  });

  it("recovers a delivery journal after a crash between workspace writes", async () => {
    const f = await fixture();
    const result = await f.backend.execute(f.req); const verdict = await f.backend.verify(f.req, result); expect(verdict.verdict).toBe("pass");
    const runs = await (await import("node:fs/promises")).readdir(join(f.root, "data", "runs"));
    const recordPath = join(f.root, "data", "runs", runs[0]!, "record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as { manifest: { id: string }; delivering?: unknown };
    const manifestHash = record.manifest.id.replace("sha256:", "");
    const manifest = JSON.parse(await readFile(join(f.root, "data", "artifacts", manifestHash), "utf8")) as { changes: { path: string; after: { hash: string } }[] };
    await writeFile(join(f.workspace, "src/answer.txt"), "42\n");
    (record as { delivering?: unknown }).delivering = { changes: manifest.changes, written: [manifest.changes[0]!.path] };
    await writeFile(recordPath, JSON.stringify(record));
    await createLocalBackend(f.options).deliver!(f.req, result);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("42\n");
  });

  it("never copies credential paths into the execution overlay", async () => {
    const f = await fixture(); await writeFile(join(f.workspace, ".env"), "SECRET=1\n");
    f.req.task.lane = "read"; f.req.task.write_scopes = []; f.req.task.contract.effect = "none";
    f.req.plan.agents[0].capability.tools = ["read_file"]; f.req.plan.agents[0].capability.fs_read = ["."]; f.req.plan.agents[0].capability.fs_write = [];
    f.req.context.capability = f.req.plan.agents[0].capability; f.req.context.write_scopes = [];
    f.options.producer.create = () => script([[{ type: "tool_call", id: "read-env", name: "read_file", args: { path: ".env" } }, { type: "assistant_message", content: "done" }]]);
    await f.backend.execute(f.req);
    const entries = await (await import("node:fs/promises")).readdir(join(f.root, "data", "runs"), { recursive: true });
    expect(entries.some((entry) => String(entry).endsWith(".env"))).toBe(false);
  });

  it("reclaims budget and delivery locks left by a dead process", async () => {
    const f = await fixture();
    for (const name of ["budget.lock", "delivery.lock"]) {
      const lock = join(f.root, "data", name); await mkdir(lock, { recursive: true });
      await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 999999, at: 0 }));
    }
    const result = await f.backend.execute(f.req);
    const verdict = await f.backend.verify(f.req, result); expect(verdict.verdict).toBe("pass");
    await f.backend.deliver!(f.req, result);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("42\n");
  });

  it("rejects unsupported capabilities with a reason", async () => {
    const f = await fixture(); const spec = f.req.plan.agents[0];
    for (const tool of ["run_shell", "lsp", "remember"]) {
      expect(f.backend.supports(f.req.task, { ...spec, capability: { ...spec.capability, tools: [tool] } })).toMatch(/tool|工具/i);
    }
    expect(f.backend.supports(f.req.task, { ...spec, capability: { ...spec.capability, network: ["*"] } })).toMatch(/network|网络/i);
    expect(f.backend.supports(f.req.task, { ...spec, capability: { ...spec.capability, shell: "sandboxed" } })).toMatch(/shell/i);
  });

  it("derives prompt, model tool specs and the execution allowlist from one surface", async () => {
    const f = await fixture(); f.req.task.lane = "read"; f.req.task.write_scopes = []; f.req.task.contract.effect = "none";
    f.req.plan.agents[0].capability.fs_write = []; f.req.plan.agents[0].capability.tools = ["read_file", "grep", "glob"];
    f.req.context.capability = f.req.plan.agents[0].capability; f.req.context.write_scopes = [];
    f.options.producer.create = () => ({ async *stream(messages, tools) {
      const names = tools!.map((t) => t.name); expect(names).toEqual(["read_file", "grep", "glob"]);
      expect(messages[0].content).toContain(JSON.stringify(names));
      if (!messages.some((m) => m.role === "tool")) { yield edit; return; }
      expect(messages.find((m) => m.role === "tool")?.content).toMatch(/不在|tool table/);
      yield { type: "assistant_message", content: "read complete" };
    } });
    const result = await f.backend.execute(f.req);
    expect(result.evidence.changed_paths).toEqual([]);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("old\n");
  });

  it("blocks write scope escapes and source symlinks before tool execution", async () => {
    const f = await fixture(); await mkdir(join(f.workspace, "outside")); await writeFile(join(f.workspace, "outside/secret"), "private");
    await symlink(join(f.workspace, "outside"), join(f.workspace, "src/link"));
    f.options.producer.create = () => script([[{ ...edit, args: { path: "src/link/secret", content: "stolen" } }]]);
    await expect(f.backend.execute(f.req)).rejects.toThrow(/symlink|软链/i);
    expect(await readFile(join(f.workspace, "outside/secret"), "utf8")).toBe("private");
  });

  it("cannot deliver unverified or mutated output", async () => {
    const f = await fixture(); const result = await f.backend.execute(f.req);
    await expect(f.backend.deliver!(f.req, result)).rejects.toThrow(/verif|验收/i);
    await f.backend.verify(f.req, result);
    const forged = { ...result, revision: "0".repeat(64) };
    await expect(f.backend.deliver!(f.req, forged)).rejects.toThrow(/revision|版本/i);
    await writeFile(join(f.workspace, "src/answer.txt"), "someone else's edit");
    await expect(f.backend.deliver!(f.req, result)).rejects.toThrow(/conflict|冲突/i);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("someone else's edit");
  });

  it("keeps commands unverifiable without a sandbox and never accepts zero assertions", async () => {
    const f = await fixture(); f.req.task.contract.acceptance = [{ kind: "command", id: "test", run: "pnpm test", timeout_ms: 1000 }];
    const result = await f.backend.execute(f.req);
    expect((await f.backend.verify(f.req, result)).verdict).toBe("unverifiable");
    const g = await fixture({ commandSandbox: { run: async () => ({ exitCode: 0, output: "No tests found", assertions: 0 }) } });
    g.req.task.contract.acceptance = f.req.task.contract.acceptance;
    expect((await g.backend.verify(g.req, await g.backend.execute(g.req))).verdict).toBe("unverifiable");
  });

  it("fails an empty acceptance contract and a verifier judging a stale revision", async () => {
    const f = await fixture(); f.req.task.contract.acceptance = [];
    expect((await f.backend.verify(f.req, await f.backend.execute(f.req))).verdict).toBe("unverifiable");
    const g = await fixture({ verifier: { cost: { kind: "scripted" }, create: () => script([[{ type: "assistant_message", content: '{"verdict":"pass","revision":"old"}' }]]) } });
    expect((await g.backend.verify(g.req, await g.backend.execute(g.req))).verdict).toBe("fail");
  });

  it("reserves every paid provider call before invocation, including verifier calls", async () => {
    const f = await fixture(); f.options.producer.cost = { kind: "bounded", max_call_usd: 0.6 };
    await expect(f.backend.execute(f.req)).rejects.toThrow(/budget|预算/i);
    const g = await fixture(); g.options.producer.cost = { kind: "bounded", max_call_usd: 0.3 }; g.options.verifier.cost = { kind: "bounded", max_call_usd: 0.6 };
    const result = await g.backend.execute(g.req); expect(result.spent_usd).toBeCloseTo(0.6);
    await expect(g.backend.verify(g.req, result)).rejects.toThrow(/budget|预算/i);
  });

  it("rejects unknown paid prices instead of interpreting them as zero", async () => {
    const f = await fixture();
    f.options.producer.cost = undefined as never;
    expect(f.backend.supports(f.req.task, f.req.plan.agents[0])).toMatch(/cost|price|价格|成本/i);
    await expect(f.backend.execute(f.req)).rejects.toThrow(/cost|price|价格|成本/i);
  });

  it("reads content addressed artifacts only after checking their hash and redacts secrets", async () => {
    const f = await fixture(); const store = createArtifactStore(join(f.root, "store"));
    const ref = await store.put("token=sk-abcdefghijklmnopqrstuvwxyz1234567890", "blob");
    expect(await store.read(ref)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234567890");
    await writeFile(join(f.root, "store", ref.hash!), "tampered");
    await expect(store.read(ref)).rejects.toThrow(/hash|integrity|完整性/i);
  });

  it("retains paid reservations across failed runs, retries and backend recreation", async () => {
    const f = await fixture(); f.req.task.budget.usd = 0.8;
    f.options.producer = { cost: { kind: "bounded", max_call_usd: 0.5 }, create: () => ({ async *stream() { throw new Error("connection interrupted"); } }) };
    await expect(f.backend.execute(f.req)).rejects.toThrow("connection interrupted");
    const retry = structuredClone({ ...f.req, signal: undefined }) as unknown as ExecutionRequest;
    retry.signal = new AbortController().signal; retry.run_id = "retry";
    const recreated = createLocalBackend(f.options);
    await expect(recreated.execute(retry)).rejects.toThrow(/budget|预算/i);
  });

  it("rejects changed contracts and overlay bytes after production", async () => {
    let overlay = ""; const f = await fixture();
    f.options.producer.create = (ctx) => { overlay = ctx.workspace; return script([[edit]]); };
    const result = await f.backend.execute(f.req);
    await writeFile(join(overlay, "src/answer.txt"), "tampered\n");
    await expect(f.backend.verify(f.req, result)).rejects.toThrow(/revision|版本/i);
    await writeFile(join(overlay, "src/answer.txt"), "42\n");
    f.req.task.contract.acceptance = [{ kind: "evidence", id: "forged", fields: ["revision"] }];
    await expect(f.backend.verify(f.req, result)).rejects.toThrow(/contract|契约/i);
  });

  it("preserves real sandbox failure exit codes and refuses producer credential output", async () => {
    const f = await fixture({ commandSandbox: { run: async () => ({ exitCode: 17, output: "assertion failed", assertions: 3 }) } });
    f.req.task.contract.acceptance = [{ kind: "command", id: "test", run: "test", timeout_ms: 1000 }];
    const verification = await f.backend.verify(f.req, await f.backend.execute(f.req));
    expect(verification.verdict).toBe("fail"); expect(verification.results?.[0].exitCode).toBe(17);
    const g = await fixture(); g.options.producer.create = () => script([[{ ...edit, args: { path: "src/answer.txt", content: "token=sk-abcdefghijklmnopqrstuvwxyz1234567890" } }]]);
    await expect(g.backend.execute(g.req)).rejects.toThrow(/credentials|凭据/i);
    expect(await readFile(join(g.workspace, "src/answer.txt"), "utf8")).toBe("old\n");
  });

  it("rolls delivered bytes back after recreation while preserving unrelated user files", async () => {
    const f = await fixture(); const result = await f.backend.execute(f.req);
    await f.backend.verify(f.req, result); await f.backend.deliver!(f.req, result);
    await writeFile(join(f.workspace, "src/user.txt"), "user-owned");
    await createLocalBackend(f.options).rollback!(f.req);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("old\n");
    expect(await readFile(join(f.workspace, "src/user.txt"), "utf8")).toBe("user-owned");
  });

  it("refuses rollback when a user modified delivered bytes", async () => {
    const f = await fixture(); const result = await f.backend.execute(f.req);
    await f.backend.verify(f.req, result); await f.backend.deliver!(f.req, result);
    await writeFile(join(f.workspace, "src/answer.txt"), "later user edit");
    await expect(f.backend.rollback!(f.req)).rejects.toThrow(/conflict|冲突/i);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("later user edit");
  });

  it("enforces the task write scope inside a broader file capability", async () => {
    const f = await fixture(); f.req.task.write_scopes = ["src/allowed.txt"];
    const result = await f.backend.execute(f.req);
    expect(result.evidence.changed_paths).toEqual([]);
    expect(await readFile(join(f.workspace, "src/answer.txt"), "utf8")).toBe("old\n");
  });

  it("rejects symlink ancestors introduced after production, including aliases inside the workspace", async () => {
    const f = await fixture(); f.options.producer.create = () => script([[{ ...edit, args: { path: "src/new/answer.txt", content: "42\n" } }]]);
    const result = await f.backend.execute(f.req); await f.backend.verify(f.req, result);
    await mkdir(join(f.workspace, "outside")); await symlink(join(f.workspace, "outside"), join(f.workspace, "src/new"));
    await expect(f.backend.deliver!(f.req, result)).rejects.toThrow(/symlink|软链/i);
    await expect(readFile(join(f.workspace, "outside/answer.txt"))).rejects.toThrow();
  });

  it("does not accept an empty backend evidence array as a meaningful check", async () => {
    const f = await fixture(); f.options.producer.create = () => script([[{ type: "assistant_message", content: "done" }]]);
    const verification = await f.backend.verify(f.req, await f.backend.execute(f.req));
    expect(verification.verdict).toBe("fail");
  });

  it("binds the final report to the revision and gives the independent verifier its exact bytes", async () => {
    const f = await fixture(); f.options.producer.create = () => script([[{ type: "assistant_message", content: "The inspected answer is old." }]]);
    f.req.task.contract.acceptance = [{ kind: "evidence", id: "inspected", fields: ["file_count"] }];
    f.options.verifier.create = (ctx) => ({ async *stream(messages) {
      expect(messages.map((message) => message.content).join()).toContain("The inspected answer is old.");
      yield { type: "assistant_message", content: JSON.stringify({ verdict: "pass", revision: ctx.revision }) };
    } });
    const result = await f.backend.execute(f.req);
    const report = result.artifacts.find((artifact) => artifact.kind === "blob");
    expect(report).toBeDefined();
    const store = createArtifactStore(join(f.options.dataDir, "artifacts"));
    expect(await store.read(report!)).toBe(result.summary);
    expect((await f.backend.verify(f.req, result)).verdict).toBe("pass");
    await writeFile(join(f.options.dataDir, "artifacts", report!.hash!), "tampered report");
    await expect(f.backend.deliver!(f.req, result)).rejects.toThrow(/hash|integrity/i);
  });
});
