import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { OrchestrationEngine } from "../orchestration/engine";
import { OrchestrationStore } from "../orchestration/store";
import { nextActions } from "../orchestration/schedule";
import type { ControlCommand, ExecutionBackend, OrchestrationView, ScheduleAction } from "../orchestration/types";

export interface OrchestrationAddress { workspace: string; sessionId: string; }
export interface OrchestrationSubmitRequest { address: OrchestrationAddress; request_id: string; plan: unknown; execute?: boolean; }
export interface OrchestrationControlRequest { address: OrchestrationAddress; command: ControlCommand; execute?: boolean; }
export interface OrchestrationSnapshot {
  address: OrchestrationAddress;
  mode: "shadow" | "execute";
  backend: string | null;
  execution_unavailable?: string;
  error?: string;
  view: OrchestrationView;
  next_actions: ScheduleAction[];
}
export type OrchestrationResponse = { ok: true; snapshot: OrchestrationSnapshot } | { ok: false; error: string };
interface Entry { store: OrchestrationStore; engine: OrchestrationEngine; backend: ExecutionBackend | null; options: { store: OrchestrationStore; backend: ExecutionBackend; enabled: boolean }; running?: Promise<void>; error?: string; }
const unavailable: ExecutionBackend = { id: "unavailable", max_concurrency: 1, supports: () => "No capability-enforcing execution backend configured", execute: async () => { throw new Error("No execution backend"); }, verify: async () => { throw new Error("No verification backend"); } };

/** Explicit workspace+session addressing; journals do not inherit ancestor in-flight runs. */
export class OrchestrationService {
  private readonly entries = new Map<string, Promise<Entry>>();
  private closing = false;
  constructor(private readonly config: {
    dataDir: string;
    allowedWorkspaces: () => readonly string[];
    /** Optional authority check: the session must exist in the workspace, not just be a safe string. */
    sessionExists?: (workspace: string, sessionId: string) => boolean | Promise<boolean>;
    backendFor?: (address: OrchestrationAddress) => ExecutionBackend | null | Promise<ExecutionBackend | null>;
  }) {}
  private async address(value: OrchestrationAddress): Promise<OrchestrationAddress> {
    if (this.closing) throw new Error("orchestration service is closing");
    if (!value || typeof value.workspace !== "string" || typeof value.sessionId !== "string" || !value.sessionId.trim() || value.sessionId.length > 256 || /[\\/\x00-\x1f\x7f]/.test(value.sessionId) || [".", ".."].includes(value.sessionId)) throw new Error("invalid orchestration workspace/session address");
    const workspace = await realpath(value.workspace);
    const allowed = await Promise.all(this.config.allowedWorkspaces().map(ws => realpath(ws)));
    if (!allowed.includes(workspace)) throw new Error("workspace is not registered");
    if (this.config.sessionExists && !(await this.config.sessionExists(workspace, value.sessionId))) throw new Error("session does not exist in workspace");
    return { workspace, sessionId: value.sessionId };
  }
  private async entry(address: OrchestrationAddress): Promise<Entry> {
    const key = JSON.stringify(address);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = (async () => {
        const store = await OrchestrationStore.open(join(this.config.dataDir, createHash("sha256").update(key).digest("hex"), "events.jsonl"));
        try {
          const backend = await this.config.backendFor?.(address) ?? null;
          const options = { store, backend: backend ?? unavailable, enabled: false };
          const engine = new OrchestrationEngine(options);
          await engine.recover();
          return { store, engine, backend, options };
        } catch (error) { await store.close(); throw error; }
      })();
      this.entries.set(key, entry);
      entry.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    }
    return entry;
  }
  private async snapshotOf(address: OrchestrationAddress, entry: Entry): Promise<OrchestrationSnapshot> {
    const view = await entry.engine.view();
    return { address, mode: entry.options.enabled ? "execute" : "shadow", backend: entry.backend?.id ?? null,
      ...(!entry.backend ? { execution_unavailable: "未连接可强制能力与成本上限的执行后端；计划可预览，不能执行。" } : {}),
      ...(entry.error ? { error: entry.error } : {}), view, next_actions: nextActions(view, { max_concurrency: entry.backend?.max_concurrency ?? 1 }) };
  }
  private start(entry: Entry): void {
    if (!entry.options.enabled || entry.running) return;
    entry.running = entry.engine.runUntilIdle().then(() => undefined).catch(error => { entry.error = String(error instanceof Error ? error.message : error); }).finally(() => { delete entry.running; });
  }
  async view(value: OrchestrationAddress): Promise<OrchestrationResponse> {
    try { const address = await this.address(value); return { ok: true, snapshot: await this.snapshotOf(address, await this.entry(address)) }; }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) }; }
  }
  async submit(request: OrchestrationSubmitRequest): Promise<OrchestrationResponse> {
    try {
      const address = await this.address(request.address); const entry = await this.entry(address);
      if (request.execute && !entry.backend) throw new Error("execution backend unavailable");
      await entry.engine.submit(request.plan, request.request_id);
      if (request.execute === true) entry.options.enabled = true;
      this.start(entry); return { ok: true, snapshot: await this.snapshotOf(address, entry) };
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) }; }
  }
  async control(request: OrchestrationControlRequest): Promise<OrchestrationResponse> {
    try {
      const address = await this.address(request.address); const entry = await this.entry(address);
      if (request.execute && !entry.backend) throw new Error("execution backend unavailable");
      await entry.engine.control(request.command);
      if (request.execute === true) entry.options.enabled = true;
      this.start(entry); return { ok: true, snapshot: await this.snapshotOf(address, entry) };
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) }; }
  }
  async close(): Promise<void> {
    this.closing = true;
    const entries = await Promise.all([...this.entries.values()]);
    for (const entry of entries) { entry.options.enabled = false; await entry.engine.stop(); await entry.running; await entry.store.snapshot(); await entry.store.close(); }
    this.entries.clear();
  }
}
