import { randomUUID } from "node:crypto";
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpPathFor, writeFileAtomic } from "../atomic-write";
import { runLoop } from "../agent/loop";
import { globMatchesPath } from "../agent/impact";
import { createEventLog, mergeAssistantDeltas, redactSecrets, type AgentEvent, type VerifyCommandResult } from "../events";
import { runWithPlanScope } from "../permissions/plan-state";
import type { Provider, ProviderToolSpec } from "../providers";
import { assertNotAgentArea, assertNotAgentAreaReal, assertNotFrozenReal, assertNotSensitivePathReal, assertRealContainment, resolveInWorkspace, type Tool, type ToolName } from "../tools/base";
import { read_file } from "../tools/read_file";
import { grep } from "../tools/grep";
import { glob } from "../tools/glob";
import { write_file } from "../tools/write_file";
import { edit_file } from "../tools/edit_file";
import { contentHash, createArtifactStore } from "./artifacts";
import type { AgentSpec, ArtifactRef, ExecutionBackend, ExecutionRequest, ExecutionResult, FlowTask, VerificationResult, Verdict } from "./types";

export interface LocalProviderContext { role: "producer" | "verifier"; agent_id: string; workspace: string; signal: AbortSignal; revision?: string; }
/** A bounded factory is trusted host code: its adapter MUST enforce the declared monetary upper bound, including internal retries. */
export interface LocalProviderConfig { create(context: LocalProviderContext): Provider | Promise<Provider>; cost: { kind: "scripted" } | { kind: "bounded"; max_call_usd: number }; }
/** The host supplies an actual OS sandbox; commands never fall back to a bare shell. */
export interface TrustedCommandSandbox { run(options: { command: string; cwd: string; timeout_ms: number; signal: AbortSignal }): Promise<{ exitCode: number | null; output: string; assertions: number }>; }
export interface LocalBackendOptions { workspace: string; dataDir: string; producer: LocalProviderConfig; verifier: LocalProviderConfig; commandSandbox?: TrustedCommandSandbox; }

type FileState = { hash: string; mode: number };
interface Manifest { report: ArtifactRef; files: Record<string, FileState>; changes: { path: string; before: FileState | null; after: FileState; artifact: ArtifactRef }[]; }
interface DeliveryJournal { changes: Manifest["changes"]; written: string[]; }
interface RunRecord { key: string; contract_hash: string; directory: string; agent_id: string; revision: string; manifest: ArtifactRef; spent_usd: number; evidence: Record<string, unknown>; verified?: string; delivered?: boolean; rolled_back?: boolean; delivering?: DeliveryJournal; }
const FILE_TOOLS = [read_file, grep, glob, write_file, edit_file];
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);
const SYSTEM_DIRS = new Set([".git", ".agent", ".agents", "node_modules"]);
const MAX_FILES = 20_000;
const MAX_BYTES = 64 * 1024 * 1024;

function cleanPath(path: string, allowRoot = false): boolean {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !path.includes("\\") && !path.includes("\0") &&
    (allowRoot && path === "." || !path.split("/").some((part) => part === ".." || part === "." || part === "" || SYSTEM_DIRS.has(part.toLowerCase())));
}
function matches(path: string, scopes: string[]): boolean {
  return scopes.some((scope) => scope === "." || path === scope || path.startsWith(scope + "/") || globMatchesPath(scope, path));
}
function scopeMayUseLink(path: string, scopes: string[]): boolean {
  return scopes.some((scope) => scope === "." || scope.split("/").some((_, index, parts) => globMatchesPath(parts.slice(0, index + 1).join("/"), path)));
}
function meaningful(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > 0) &&
    (!Array.isArray(value) || value.length > 0) && (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 0);
}
function costOf(config: LocalProviderConfig | undefined): number {
  if (config?.cost?.kind === "scripted") return 0;
  if (config?.cost?.kind === "bounded" && Number.isFinite(config.cost.max_call_usd) && config.cost.max_call_usd > 0) return config.cost.max_call_usd;
  throw new Error("provider cost/price needs an enforceable positive per-call bound, or explicit scripted cost");
}
function abort(signal: AbortSignal): void { signal.throwIfAborted(); }

const SENSITIVE_SEGMENTS = new Set([".env", ".env.local", ".npmrc", ".git-credentials", ".netrc", "id_rsa", "id_ed25519", ".ssh", ".aws", ".gnupg"]);
function isSensitivePath(path: string): boolean {
  return path.split("/").some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()));
}
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
/** Directory lock with crash recovery: a dead owner pid is reclaimable; a live one stays fail-closed. */
async function withDirectoryLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8").catch(() => "{}")) as { pid?: unknown };
      if (typeof owner.pid === "number" && !pidAlive(owner.pid)) { await rm(path, { recursive: true, force: true }); continue; }
      throw new Error("orchestration lock held" + (typeof owner.pid === "number" ? " by pid " + String(owner.pid) : "") + ": " + path);
    }
  }
  try { return await operation(); }
  finally { await rm(path, { recursive: true, force: true }); }
}
function runKey(request: ExecutionRequest): string { return contentHash(JSON.stringify([request.plan.plan_id, request.plan.version, request.task.task_id, request.run_id])); }
function specFor(request: ExecutionRequest): AgentSpec {
  const spec = request.plan.agents.find((agent) => agent.agent_spec_id === request.task.agent_spec);
  if (!spec) throw new Error("missing task agent spec");
  // The approved task/spec, rather than a caller supplied context packet, grants authority.
  return spec;
}
function contractHash(request: ExecutionRequest): string { return contentHash(JSON.stringify([request.task, specFor(request)])); }

async function inventory(root: string): Promise<Record<string, FileState>> {
  const files: Record<string, FileState> = Object.create(null) as Record<string, FileState>;
  let totalBytes = 0; let count = 0;
  async function walk(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`symlink refused in execution overlay: ${path}`);
      if (entry.isDirectory()) { await walk(join(directory, entry.name), path); continue; }
      if (!entry.isFile()) throw new Error(`special file refused: ${path}`);
      const absolute = join(root, path); await assertRealContainment(root, absolute, "inventory");
      const bytes = await readFile(absolute); totalBytes += bytes.length;
      if (++count > MAX_FILES || totalBytes > MAX_BYTES) throw new Error("overlay inventory limit exceeded");
      files[path] = { hash: contentHash(bytes), mode: (await lstat(absolute)).mode & 0o777 };
    }
  }
  await walk(root, ""); return files;
}

function sameFiles(a: Record<string, FileState>, b: Record<string, FileState>): boolean {
  const ordered = (value: Record<string, FileState>) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
async function copyOverlay(workspace: string, target: string, scopes: string[], dataDir: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 });
  let count = 0; let bytesCount = 0;
  async function walk(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(workspace, path);
      if (SYSTEM_DIRS.has(entry.name.toLowerCase()) || isSensitivePath(path) || resolve(absolute) === dataDir) continue;
      if (entry.isSymbolicLink()) { if (scopeMayUseLink(path, scopes)) throw new Error(`source symlink refused: ${path}`); continue; }
      if (entry.isDirectory()) { await walk(absolute, path); continue; }
      if (!matches(path, scopes)) continue;
      if (!entry.isFile()) throw new Error(`source special file refused: ${path}`);
      await assertRealContainment(workspace, absolute, "copy overlay");
      const bytes = await readFile(absolute); bytesCount += bytes.length;
      if (++count > MAX_FILES || bytesCount > MAX_BYTES) throw new Error("overlay copy limit exceeded");
      const destination = join(target, path); await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { mode: (await lstat(absolute)).mode & 0o777 });
    }
  }
  await walk(workspace, "");
}

/** Table, provider specs and prompt names all derive from the very same selected entries. */
function toolSurface(request: ExecutionRequest, root: string, verifier: boolean) {
  const capability = specFor(request).capability;
  const selected = FILE_TOOLS.filter((tool) => capability.tools.includes(tool.name) && (verifier ? !WRITE_TOOLS.has(tool.name) : true));
  const names = selected.map((tool) => tool.name as ToolName);
  const specs: ProviderToolSpec[] = selected.map((tool) => ({ name: tool.name, description: `${tool.name} in the isolated allowed file surface`, parameters: { type: "object", properties: { path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, pattern: { type: "string" }, content: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" }, offset: { type: "number" }, limit: { type: "number" }, context: { type: "number" }, fixed_strings: { type: "boolean" } } } }));
  const tools: Record<string, Tool> = {};
  for (const tool of selected) tools[tool.name] = { name: tool.name, async run(args, context) {
    abort(request.signal);
    const write = WRITE_TOOLS.has(tool.name);
    const pathValues: unknown[] = [];
    if (args.path !== undefined) pathValues.push(args.path);
    if (Array.isArray(args.paths)) pathValues.push(...args.paths);
    if (pathValues.length === 0) pathValues.push(tool.name === "grep" || tool.name === "glob" ? "." : "");
    for (const path of pathValues) {
      if (typeof path !== "string" || !cleanPath(path, !write)) throw new Error("invalid or protected tool path");
      const absolute = path === "." ? root : resolveInWorkspace(root, path, tool.name);
      await assertRealContainment(root, absolute, tool.name);
      const scopes = write ? capability.fs_write : capability.fs_read;
      // Directory scans only see the physically filtered overlay. Direct files need explicit scope.
      const directory = (await lstat(absolute).catch(() => null))?.isDirectory() === true;
      if (!(directory && !write) && !matches(path, scopes)) throw new Error("file capability scope denied");
      if (write) {
        if (isSensitivePath(path)) throw new Error("sensitive path denied");
        if (request.task.lane !== "write" || !matches(path, request.task.write_scopes)) throw new Error("task write scope denied");
        await assertSafeWrite(root, path);
      }
    }
    return tool.run(args, { ...context, workspace: root, snapshot: false });
  } };
  return { names, specs, tools };
}

async function assertSafeWrite(root: string, path: string): Promise<void> {
  const absolute = resolveInWorkspace(root, path, "deliver");
  // Real containment alone permits aliases to a *different* capability scope inside root.
  let current = root;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    const state = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
    if (!state) break;
    if (state.isSymbolicLink()) throw new Error(`symlink ancestor refused: ${path}`);
  }
  assertNotAgentArea(path, "deliver");
  await assertRealContainment(root, absolute, "deliver");
  await assertNotAgentAreaReal(root, absolute, "deliver");
  await assertNotSensitivePathReal(root, absolute, "deliver");
  await assertNotFrozenReal(root, absolute, "deliver");
}
async function restoreBaseline(workspace: string, record: RunRecord, change: Manifest["changes"][number]): Promise<void> {
  const original = join(record.directory, "baseline", change.path);
  if (!change.before || contentHash(await readFile(original)) !== change.before.hash) throw new Error("rollback baseline hash integrity mismatch");
  const absolute = join(workspace, change.path); const temporary = tmpPathFor(absolute);
  try { await copyFile(original, temporary); await chmod(temporary, change.before.mode); await rename(temporary, absolute); }
  finally { await rm(temporary, { force: true }); }
}

export function createLocalBackend(options: LocalBackendOptions): ExecutionBackend {
  const workspace = resolve(options.workspace); const dataDir = resolve(options.dataDir);
  if (workspace === dataDir) throw new Error("dataDir must differ from workspace");
  const store = createArtifactStore(join(dataDir, "artifacts"));
  const records = new Map<string, RunRecord>();
  let deliveryTail: Promise<unknown> = Promise.resolve();
  function serializeDelivery<T>(operation: () => Promise<T>): Promise<T> {
    const next = deliveryTail.then(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      return withDirectoryLock(join(dataDir, "delivery.lock"), operation);
    });
    deliveryTail = next.catch(() => undefined); return next;
  }
  const persist = async (record: RunRecord) => { await mkdir(record.directory, { recursive: true, mode: 0o700 }); await writeFileAtomic(join(record.directory, "record.json"), JSON.stringify(record), { mode: 0o600 }); };
  async function reserve(request: ExecutionRequest, record: RunRecord, cost: number): Promise<void> {
    await withDirectoryLock(join(dataDir, "budget.lock"), async () => {
      const path = join(dataDir, "budget.json");
      const ledger = JSON.parse(await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return "{}"; })) as Record<string, number>;
      const planKey = contentHash(JSON.stringify([request.plan.plan_id, request.plan.version]));
      const taskKey = contentHash(JSON.stringify([request.plan.plan_id, request.plan.version, request.task.task_id]));
      for (const [key, limit] of [[planKey, request.plan.budget.usd], [taskKey, request.task.budget.usd]] as const) {
        const spent = ledger[key] ?? 0;
        if (!Number.isFinite(spent) || spent < 0 || !Number.isFinite(limit) || spent + cost > limit + Number.EPSILON) throw new Error("task/plan budget exhausted before provider invocation");
        ledger[key] = spent + cost;
      }
      await writeFileAtomic(path, JSON.stringify(ledger), { mode: 0o600 });
      record.spent_usd += cost; await persist(record);
    });
  }
  async function recordFor(request: ExecutionRequest, result?: ExecutionResult): Promise<RunRecord> {
    const key = runKey(request);
    let record = records.get(key);
    if (!record) { record = JSON.parse(await readFile(join(dataDir, "runs", key, "record.json"), "utf8")) as RunRecord; records.set(key, record); }
    if (record.key !== key || record.directory !== join(dataDir, "runs", key)) throw new Error("run identity mismatch");
    if (record.contract_hash !== contractHash(request)) throw new Error("approved execution contract changed");
    if (result && (record.revision !== result.revision || record.agent_id !== result.agent_id)) throw new Error("result revision/identity mismatch");
    return record;
  }
  async function manifestFor(record: RunRecord): Promise<Manifest> {
    if (record.manifest.hash !== record.revision) throw new Error("manifest revision mismatch");
    return JSON.parse(await store.read(record.manifest)) as Manifest;
  }
  async function assertRevision(record: RunRecord): Promise<Manifest> {
    const manifest = await manifestFor(record);
    await store.read(manifest.report);
    if (!sameFiles(await inventory(join(record.directory, "overlay")), manifest.files)) throw new Error("execution revision changed after production");
    return manifest;
  }
  function supports(task: FlowTask, spec: AgentSpec): string | null {
    try { costOf(options.producer); costOf(options.verifier); } catch (error) { return (error as Error).message; }
    const cap = spec.capability;
    if (cap.tools.some((name) => !FILE_TOOLS.some((tool) => tool.name === name))) return "unsupported tool: only read_file/grep/glob/write_file/edit_file are enforceable";
    if (cap.network.length) return "network capability unsupported";
    if (cap.shell !== "none") return "shell capability unsupported";
    if (cap.git !== "none") return "git capability unsupported";
    if (cap.external_effects !== "none" || task.lane === "external" || task.contract.effect === "external") return "external effects unsupported";
    if (task.lane === "read" && (cap.fs_write.length || cap.tools.some((name) => WRITE_TOOLS.has(name)) || task.write_scopes.length)) return "read lane cannot grant write capability";
    if ([...cap.fs_read, ...cap.fs_write, ...task.write_scopes].some((scope) => !cleanPath(scope, true))) return "invalid/protected file scope";
    if (cap.fs_write.some((scope) => !matches(scope, cap.fs_read))) return "write scopes must have a matching read grant for existing-file tools";
    if (!Number.isFinite(task.budget.usd) || task.budget.usd < 0 || !Number.isInteger(spec.max_turns) || spec.max_turns < 1 || spec.max_turns > 100) return "invalid budget or turn limit";
    return null;
  }
  async function runAgent(request: ExecutionRequest, record: RunRecord, role: LocalProviderContext["role"], prompt: string): Promise<{ id: string; summary: string }> {
    const config = role === "producer" ? options.producer : options.verifier;
    const id = role === "producer" ? record.agent_id : `verifier-${randomUUID()}`;
    const root = join(record.directory, "overlay"); const surface = toolSurface(request, root, role === "verifier");
    const provider = await config.create({ role, agent_id: id, workspace: root, signal: request.signal, ...(role === "verifier" ? { revision: record.revision } : {}) });
    const events: AgentEvent[] = []; const log = createEventLog(join(record.directory, `${id}.jsonl`));
    const wrapped: Provider = { async *stream(messages, _tools, call) {
      abort(request.signal);
      const cost = costOf(config);
      await reserve(request, record, cost); // Retain the upper bound even for missing usage, errors or cancellation.
      yield* provider.stream([{ role: "system", content: `Role: ${role}. Available tools: ${JSON.stringify(surface.names)}. Stay within the supplied task and file capability. ${role === "verifier" ? 'Return only JSON {"verdict":"pass"|"fail"|"unverifiable","revision":"the supplied revision"} after independently inspecting the artifacts.' : "Report the actual work performed."}` }, ...messages], surface.specs, call);
    } };
    try {
      await runWithPlanScope(() => runLoop({ provider: wrapped, events: { async append(event) { await log.append(event); events.push(event); } }, workspace: root, mode: "auto", interactive: false, maxSteps: specFor(request).max_turns, userMessage: prompt, tools: surface.tools, allowedTools: surface.names, signal: request.signal, agentId: id, autoVerify: false, deliveryRepair: false, truncationRepair: false }));
      abort(request.signal);
    } finally { await log.close?.(); }
    // 真实 provider 只发 assistant_delta；assistant_message 是 mock/脚本通道的聚合形态。
    // 只取最后一轮（最后一个 callId）的增量，避免把工具调用前的旁白并进交付摘要。
    const lastMessage = [...events].reverse().find((event) => event.type === "assistant_message");
    const lastDeltaCallId = [...events].reverse().find((event) => event.type === "assistant_delta")?.callId;
    const deltaText = lastDeltaCallId === undefined
      ? ""
      : mergeAssistantDeltas(events.filter((event): event is Extract<AgentEvent, { type: "assistant_delta" }> => event.type === "assistant_delta"), lastDeltaCallId);
    return { id, summary: lastMessage?.type === "assistant_message" ? lastMessage.content : deltaText };
  }
  return {
    id: "local-file-overlay-v1", max_concurrency: 1, supports,
    async execute(request) {
      abort(request.signal);
      const reason = supports(request.task, specFor(request)); if (reason) throw new Error(reason);
      const key = runKey(request);
      const directory = join(dataDir, "runs", key); await mkdir(join(dataDir, "runs"), { recursive: true, mode: 0o700 });
      const workspaceReal = await realpath(workspace); const dataReal = await realpath(dataDir);
      if (workspaceReal === dataReal) throw new Error("dataDir resolves to workspace; refusing execution");
      // Stable run identities cannot execute twice, including after a process restart.
      await mkdir(directory, { mode: 0o700 });
      const record: RunRecord = { key, contract_hash: contractHash(request), directory, agent_id: `producer-${randomUUID()}`, revision: "", manifest: { id: "", kind: "json" }, spent_usd: 0, evidence: {} };
      records.set(key, record); await persist(record);
      const cap = specFor(request).capability;
      await copyOverlay(workspaceReal, join(directory, "overlay"), [...cap.fs_read, ...cap.fs_write], dataReal);
      const before = await inventory(join(directory, "overlay"));
      await cp(join(directory, "overlay"), join(directory, "baseline"), { recursive: true, preserveTimestamps: true });
      const inputs = await Promise.all(request.task.inputs.map(async (ref) => ({ ref, content: await store.read(ref) })));
      const produced = await runAgent(request, record, "producer", JSON.stringify({ goal: request.task.goal, non_goals: request.task.non_goals, acceptance: request.task.contract.acceptance, inputs, write_scopes: request.task.write_scopes }));
      const after = await inventory(join(directory, "overlay")); const changes: Manifest["changes"] = [];
      if (Object.keys(before).some((path) => !after[path])) throw new Error("file deletion is unsupported");
      for (const [path, state] of Object.entries(after)) {
        if (before[path]?.hash === state.hash && before[path]?.mode === state.mode) continue;
        if (!matches(path, request.task.write_scopes) || !matches(path, cap.fs_write)) throw new Error("production escaped write scope");
        const text = await readFile(join(directory, "overlay", path), "utf8");
        const artifact = await store.put(text, "file");
        if (artifact.hash !== state.hash) throw new Error("output contains credentials or non-text bytes; refusing divergent artifact/delivery");
        changes.push({ path, before: before[path] ?? null, after: state, artifact });
      }
      const report = await store.put(produced.summary, "blob");
      record.manifest = await store.put(JSON.stringify({ report, files: after, changes } satisfies Manifest), "json"); record.revision = record.manifest.hash!;
      record.evidence = { changed_paths: changes.map((change) => change.path), file_count: Object.keys(after).length, revision: record.revision };
      await persist(record);
      return { agent_id: produced.id, summary: await store.read(report), revision: record.revision, artifacts: [...changes.map((change) => change.artifact), report, record.manifest], evidence: record.evidence, spent_usd: record.spent_usd };
    },
    async verify(request, result) {
      abort(request.signal); const record = await recordFor(request, result); const manifest = await assertRevision(record);
      const checks: VerificationResult["checks"] = []; const results: VerifyCommandResult[] = [];
      for (const check of request.task.contract.acceptance) {
        abort(request.signal);
        let verdict: Verdict = "unverifiable"; let detail = "human acceptance is required";
        if (check.kind === "artifact") {
          const artifact = [...manifest.changes.map((change) => change.artifact), manifest.report, record.manifest].find((ref) => ref.id === check.artifact_id);
          if (!artifact) { verdict = "fail"; detail = "required artifact is absent"; }
          else { try { await store.read(artifact); verdict = !check.hash || check.hash === artifact.hash ? "pass" : "fail"; detail = "artifact hash checked"; } catch (error) { verdict = "fail"; detail = (error as Error).message; } }
        } else if (check.kind === "evidence") {
          verdict = check.fields.length > 0 && check.fields.every((field) => Object.hasOwn(record.evidence, field) && meaningful(record.evidence[field])) ? "pass" : "fail"; detail = "backend-generated evidence fields checked";
        } else if (check.kind === "command") {
          if (!options.commandSandbox) detail = "command has no trusted sandbox; never executed";
          else if (!Number.isFinite(check.timeout_ms) || check.timeout_ms <= 0 || !check.run.trim()) { verdict = "fail"; detail = "invalid command acceptance"; }
          else {
            const output = await options.commandSandbox.run({ command: check.run, cwd: join(record.directory, "overlay"), timeout_ms: check.timeout_ms, signal: request.signal });
            if (output.exitCode !== 0) verdict = "fail";
            else verdict = Number.isInteger(output.assertions) && output.assertions > 0 ? "pass" : "unverifiable";
            detail = redactSecrets(output.output).text;
            results.push({ command: check.run, ok: verdict === "pass", exitCode: output.exitCode, output: detail });
          }
        }
        checks.push({ id: check.id, verdict, detail });
      }
      await assertRevision(record);
      const spentBefore = record.spent_usd;
      const verified = await runAgent(request, record, "verifier", JSON.stringify({ goal: request.task.goal, non_goals: request.task.non_goals, revision: record.revision, acceptance: request.task.contract.acceptance, checks, report: { artifact: manifest.report, content: await store.read(manifest.report) }, artifacts: manifest.changes.map((change) => ({ path: change.path, artifact: change.artifact })) }));
      await assertRevision(record);
      let independent: Verdict = "unverifiable";
      try {
        const report = JSON.parse(verified.summary) as { verdict?: Verdict; revision?: string };
        if (report.revision !== record.revision) independent = "fail";
        else if (["pass", "fail", "unverifiable"].includes(report.verdict ?? "")) independent = report.verdict!;
      } catch { /* malformed independent report cannot pass */ }
      let verdict: Verdict = "unverifiable";
      if (independent === "fail" || checks.some((check) => check.verdict === "fail")) verdict = "fail";
      else if (checks.length > 0 && independent === "pass" && checks.every((check) => check.verdict === "pass")) verdict = "pass";
      record.verified = verdict === "pass" ? record.revision : undefined; await persist(record);
      return { verdict, verifier_id: verified.id, revision: record.revision, checks, results, spent_usd: record.spent_usd - spentBefore };
    },
    async deliver(request, result) {
      return serializeDelivery(async () => {
        abort(request.signal); const record = await recordFor(request, result);
        if (record.verified !== result.revision) throw new Error("delivery requires independent verification of this revision");
        const manifest = await assertRevision(record);
        if (record.delivered) return { revision: record.revision };
        // Recover a journal left by a crash mid-delivery before touching anything new.
        const alreadyWritten = new Set<string>();
        if (record.delivering) {
          for (const change of record.delivering.changes) {
            const absolute = join(workspace, change.path);
            const state = await lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
            const current = state?.isFile() ? contentHash(await readFile(absolute)) : null;
            if (current === change.after.hash) alreadyWritten.add(change.path);
            else if (current !== (change.before?.hash ?? null)) throw new Error(`delivery recovery conflict: ${change.path}`);
          }
          if (record.delivering.changes.every((change) => alreadyWritten.has(change.path))) {
            record.delivered = true; delete record.delivering; await persist(record); return { revision: record.revision };
          }
        }
        // Validate the entire batch before the first main-workspace write.
        const contents = new Map<string, string>();
        for (const change of manifest.changes) {
          if (!cleanPath(change.path) || isSensitivePath(change.path) || !matches(change.path, request.task.write_scopes) || !matches(change.path, specFor(request).capability.fs_write)) throw new Error("delivery path escaped write scope or is sensitive");
          await assertSafeWrite(workspace, change.path);
          const absolute = join(workspace, change.path); const state = await lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
          if (state?.isSymbolicLink() || state && !state.isFile()) throw new Error("delivery symlink/special file conflict");
          const current = state ? contentHash(await readFile(absolute)) : null;
          if (alreadyWritten.has(change.path) && current === change.after.hash) {
            contents.set(change.path, await store.read(change.artifact));
            continue;
          }
          if (current !== (change.before?.hash ?? null) || state && (state.mode & 0o777) !== change.before?.mode) throw new Error(`delivery conflict: ${change.path}`);
          contents.set(change.path, await store.read(change.artifact));
        }
        record.delivering = { changes: manifest.changes, written: [...alreadyWritten] }; await persist(record);
        try {
          for (const change of manifest.changes) {
            if (alreadyWritten.has(change.path)) continue;
            abort(request.signal); await assertSafeWrite(workspace, change.path);
            const absolute = join(workspace, change.path); await mkdir(dirname(absolute), { recursive: true });
            // Exclusive new file creation; existing files get a final byte comparison before writing.
            if (change.before && contentHash(await readFile(absolute)) !== change.before.hash) throw new Error(`delivery conflict: ${change.path}`);
            if (change.before) await writeFileAtomic(absolute, contents.get(change.path)!, { mode: change.after.mode });
            else await writeFile(absolute, contents.get(change.path)!, { flag: "wx", mode: change.after.mode });
            record.delivering.written.push(change.path); await persist(record);
          }
        } catch (error) {
          // Never erase a later user edit during recovery. Keep explicit failure if recovery cannot be proven safe.
          const written = record.delivering?.written ?? [];
          for (const path of [...written].reverse()) {
            const change = manifest.changes.find((item) => item.path === path);
            if (!change) continue;
            const absolute = join(workspace, change.path);
            if (contentHash(await readFile(absolute).catch(() => "")) !== change.after.hash) continue;
            if (!change.before) await rm(absolute);
            else await restoreBaseline(workspace, record, change);
          }
          delete record.delivering; await persist(record);
          throw error;
        }
        delete record.delivering; record.delivered = true; await persist(record); return { revision: record.revision };
      });
    },
    async rollback(request) {
      await serializeDelivery(async () => {
        abort(request.signal); const record = await recordFor(request);
        if (record.rolled_back) return;
        if (!record.revision) throw new Error("rollback refused: producer termination/revision is unconfirmed");
        const manifest = await assertRevision(record);
        if (record.delivering) {
          for (const path of [...record.delivering.written].reverse()) {
            const change = record.delivering.changes.find((item) => item.path === path);
            if (!change) continue;
            const absolute = join(workspace, change.path);
            const current = await readFile(absolute).catch(() => "");
            if (contentHash(current) !== change.after.hash) throw new Error(`rollback conflict: ${change.path}`);
            if (change.before) await restoreBaseline(workspace, record, change); else await rm(absolute);
          }
          delete record.delivering; await persist(record);
        }
        if (record.delivered) {
          // Check the whole rollback batch before changing anything a human may have edited.
          for (const change of manifest.changes) {
            await assertSafeWrite(workspace, change.path);
            const absolute = join(workspace, change.path); const state = await lstat(absolute);
            if (!state.isFile() || contentHash(await readFile(absolute)) !== change.after.hash) throw new Error(`rollback conflict: ${change.path}`);
            if (change.before && contentHash(await readFile(join(record.directory, "baseline", change.path))) !== change.before.hash) throw new Error("rollback baseline hash integrity mismatch");
          }
          for (const change of manifest.changes) {
            abort(request.signal); await assertSafeWrite(workspace, change.path);
            const absolute = join(workspace, change.path);
            if (contentHash(await readFile(absolute)) !== change.after.hash) throw new Error(`rollback conflict: ${change.path}`);
            if (change.before) await restoreBaseline(workspace, record, change);
            else await rm(absolute);
          }
        }
        record.delivered = false; record.verified = undefined; record.rolled_back = true; await persist(record);
      });
    },
  };
}
