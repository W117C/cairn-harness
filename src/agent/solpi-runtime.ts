// Run-local SoL-Pi integration. Archives are redacted TEXT, never raw process bytes.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, stat, lstat, chmod, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import type { AgentEvent } from "../events";
import type { Tool, ToolResult } from "../tools";
import { captureObservation, createObservationRecallTool } from "../tools/observation-capture";
import { createObservationLedger, ObservationLedger, LEDGER_THRESHOLD_BYTES } from "./ledger";
import { buildReceipt, validateReceipt, serializeReceipt } from "./evidence";
import { redactSecrets } from "./security/scan";
import { RequestMeter } from "./metering";
import { initialEconomicState, replayEconomicState, type EconomicState } from "./economics";

export interface SolpiFlags {
  requestMetering?: boolean;
  observationPack?: boolean;
  evidenceReceipts?: boolean;
  economicCompaction?: boolean;
}
export const solpiEnabled = (flags: SolpiFlags): boolean => Object.values(flags).some(v => v === true);
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Inode identity survives session display-name changes and never revives a deleted
 * archive when a new log is created with the same name. Canonical private parents
 * are required; workspace-owned storage is deliberately refused. */
export async function privateSessionDirectory(logPath: string, workspace?: string, create = true): Promise<string> {
  const canonicalLog = await realpath(logPath);
  const info = await stat(canonicalLog);
  const root = join(dirname(canonicalLog), "session-data");
  if (workspace) {
    const ws = await realpath(workspace);
    const rel = relative(ws, root);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("SoL-Pi requires private session-data outside workspace");
  }
  if (create) await mkdir(root, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("invalid private session-data root");
  if (create) await chmod(root, 0o700);
  const key = hash(`${info.dev}:${info.ino}:${info.birthtimeMs}`).slice(0, 32);
  const directory = join(root, key);
  if (create) await mkdir(directory, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error("invalid private session directory");
  if (create) await chmod(directory, 0o700);
  return await realpath(directory);
}
export async function removePrivateSessionData(logPath: string): Promise<void> {
  let directory: string;
  try { directory = await privateSessionDirectory(logPath, undefined, false); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  // Caller must stop/refuse live writers first. Revoke before unlinking artifacts.
  const ledger = createObservationLedger(directory);
  await ledger.deleteSession();
  await rm(directory, { recursive: true });
}

export const observationRecallSpec = {
  name: "obs_recall", description: "Recall this session's authorized redacted observation text; bounded UTF-8 pages. No filesystem paths accepted.",
  parameters: { type: "object", properties: { id: { type: "string" }, by: { type: "string", enum: ["bytes", "lines"] }, offset: { type: "number" }, max: { type: "number" }, byteInLine: { type: "number" } }, required: ["id"], additionalProperties: false },
};

export class SolpiRuntime {
  readonly meter?: RequestMeter;
  readonly ledger?: ObservationLedger;
  private readonly observations = new Map<number, { id?: string; text: string; sends: number; error?: string }>();
  private pending = new Set<number>();
  private closed = false;
  private economicState: EconomicState = initialEconomicState();
  readonly runId = randomUUID();
  constructor(readonly directory: string, readonly flags: SolpiFlags) {
    if (flags.requestMetering) this.meter = new RequestMeter();
    if (flags.observationPack || flags.evidenceReceipts) this.ledger = createObservationLedger(directory);
  }
  /** Main events only. Replay is safe: metadata is ephemeral; full history is never changed. */
  async project(events: AgentEvent[], replacements = new Map<number, string>()): Promise<Map<number, string>> {
    this.pending.clear();
    if (!this.ledger || this.closed) return replacements;
    const calls = new Map<string, string>();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if ((e as { agent_id?: string }).agent_id) continue; // worker 子流事件不参与主上下文投影（局部结构检查，events 联合类型不含该字段）
      if (e.type === "tool_call") calls.set(e.id, e.name);
      if (e.type !== "tool_result" || calls.get(e.callId) === "obs_recall" || Buffer.byteLength(e.output) <= LEDGER_THRESHOLD_BYTES) continue;
      const eventId = i + 1;
      let obs = this.observations.get(eventId);
      if (!obs) {
        const redacted = redactSecrets(e.output);
        // Critical output is not authorized for archival. Full source remains in
        // event history; do not create a new secret-bearing persistence channel.
        if (redacted.blocked) { console.warn("[solpi] archive refused: critical output"); continue; }
        const text = redacted.text;
        const captured = await captureObservation(this.ledger, { toolName: calls.get(e.callId) ?? "unknown", callId: `${eventId}:${e.callId}`,
          result: { ok: e.ok, output: text }, source: { kind: "authorized-redacted-text", text } });
        obs = { text, id: captured.observation?.id, error: captured.observation?.error, sends: 0 };
        this.observations.set(eventId, obs);
      }
      const projected = await this.ledger.project({ id: obs.id, text: obs.text, requestNumber: obs.sends + 1 });
      const error = projected.error ?? obs.error;
      if (error) console.warn(`[solpi] ${error}; full redacted source retained`);
      let text = projected.text;
      if (this.flags.evidenceReceipts && projected.archived && obs.sends >= 2) {
        const receipt = buildReceipt(obs.text);
        if (receipt && validateReceipt(receipt, obs.text).ok) {
          // 这一行的旧写法把完整性写成 `completeness=unknown`——那是**把已知报成未知**：
          // 能走到这里意味着每条引文都逐字对过了原文（validateReceipt.ok），原文的行数/字节/sha
          // 也都在手上。模型看到 unknown 只有两种坏结局：白召回一次（花 token），
          // 或按"可能不全"把同一条命令再跑一遍（花更多，且 worker 侧还要再付一次钱）。
          const candidate = `${serializeReceipt(receipt)}\n[tool_exit_ok=${e.ok}; quotes_verified=${String(receipt.evidence.length)}; source_lines=${String(receipt.sourceLines)}; source_bytes=${String(receipt.sourceBytes)}; source_sha=${receipt.sourceSha256.slice(0, 12)}; 取全文 obs_recall id=${obs.id}]`;
          if (Buffer.byteLength(candidate) < Buffer.byteLength(obs.text)) text = candidate;
        } else text = obs.text; // invalid receipt fails open to full authorized source
      } else if (!this.flags.observationPack) text = obs.text;
      // Override legacy prune for captured observations, including sends 1/2 and
      // invalidated archives. Otherwise prune would silently bypass the full-send contract.
      replacements.set(eventId, text);
      this.pending.add(eventId);
    }
    return replacements;
  }
  /** Only completed requests count, not assembly, budget refusals or retries. */
  sent(messages: readonly { role: string; tool_call_id?: string }[], events: AgentEvent[]): void {
    const visible = new Set(messages.filter(m => m.role === "tool").map(m => m.tool_call_id));
    for (const id of this.pending) {
      const e = events[id - 1];
      if (e?.type === "tool_result" && visible.has(e.callId)) this.observations.get(id)!.sends++;
    }
    this.pending.clear();
  }
  recallTool(authorize: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>): Tool | undefined {
    const tool = this.ledger && createObservationRecallTool(this.ledger);
    if (!tool) return undefined;
    return { name: tool.name, run: async (args, ctx): Promise<ToolResult> => {
      if (this.closed || ctx.signal?.aborted || !await authorize(args, ctx.signal) || ctx.signal?.aborted) return { ok: false, output: "obs_recall: permission denied or cancelled" };
      // Local recall is overhead, NOT a model/HTTP request. Record separately.
      const start = performance.now();
      const result = await tool.run(args, ctx);
      this.recalls.push({ elapsedMs: performance.now() - start, bytes: Buffer.byteLength(result.output), ok: result.ok });
      if (ctx.signal?.aborted) return { ok: false, output: "obs_recall: cancelled" };
      return result;
    } };
  }
  private recalls: { elapsedMs: number; bytes: number; ok: boolean }[] = [];
  /** Event log is the crash-recovery authority. Unknown rebuild costs stay unknown;
   * estimated context reduction must NEVER be used as observed debt repayment. */
  economics(events: AgentEvent[]): EconomicState {
    this.economicState = replayEconomicState(events.filter(e => e.type === "compaction" && !e.agent_id)
      .map(() => ({ type: "compacted" as const, writeTokens: null, cacheWriteReadRatio: null })));
    return this.economicState;
  }
  async finish(events: AgentEvent[]): Promise<void> {
    this.closed = true;
    if (this.flags.economicCompaction) this.economics(events);
    const report = { version: 1, scope: "main-run", runId: this.runId, metering: this.meter?.seal() ?? null,
      localRecall: this.recalls, economics: this.flags.economicCompaction ? this.economicState : null,
      realModelBenefits: "unverified" };
    const path = join(this.directory, `run-${this.runId}.json`);
    await writeFile(path, JSON.stringify(report), { mode: 0o600, flag: "wx" });
    if (this.flags.economicCompaction) {
      const temp = join(this.directory, `economic-${this.runId}.tmp`);
      await writeFile(temp, JSON.stringify(this.economicState), { mode: 0o600, flag: "wx" });
      await rename(temp, join(this.directory, "economic.json"));
    }
  }
}
