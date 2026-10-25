import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createEventLog, replay, type AgentEvent, type EventLog } from "../events";
import { projectOrchestration } from "./project";
import type { OrchestrationView } from "./types";

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** One process owns a journal. A live or unidentifiable lock fails closed; a dead pid is reclaimable. */
export class OrchestrationStore {
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly log: EventLog;
  private constructor(readonly path: string, private readonly token: string) { this.log = createEventLog(path); }
  static async open(path: string): Promise<OrchestrationStore> {
    await mkdir(dirname(path), { recursive: true });
    const token = randomUUID();
    let lock = null;
    for (let attempt = 0; attempt < 2 && lock === null; attempt += 1) {
      try { lock = await open(path + ".writer.lock", "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = JSON.parse(await readFile(path + ".writer.lock", "utf8").catch(() => "{}")) as { pid?: unknown };
        if (typeof owner.pid === "number" && !pidAlive(owner.pid)) { await rm(path + ".writer.lock", { force: true }); continue; }
        throw new Error("orchestration writer lock exists; close the owner or confirm it stopped before removing " + path + ".writer.lock");
      }
    }
    if (lock === null) throw new Error("orchestration writer lock could not be acquired: " + path);
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, token })); await lock.sync(); }
    finally { await lock.close(); }
    return new OrchestrationStore(path, token);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(fn);
    this.chain = next;
    return next;
  }
  append(event: AgentEvent): Promise<void> {
    return this.serial(async () => {
      if (this.closed) throw new Error("orchestration store closed");
      await this.log.append(event);
    });
  }
  async events(): Promise<AgentEvent[]> {
    await this.chain;
    try { return await replay(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async view(): Promise<OrchestrationView> {
    // JSONL is authoritative. Snapshot is an inspectable cache, never trusted for execution.
    return projectOrchestration(await this.events());
  }
  async snapshot(): Promise<void> {
    await this.serial(async () => {
      if (this.closed) throw new Error("orchestration store closed");
      let bytes = "";
      try { bytes = await readFile(this.path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const events = bytes === "" ? [] : await replay(this.path);
      const snapshot = { schema_version: 1, hash: createHash("sha256").update(bytes).digest("hex"), view: projectOrchestration(events) };
      const temp = this.path + ".snapshot-" + this.token;
      await (await import("node:fs/promises")).writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
      await rename(temp, this.path + ".snapshot.json");
    });
  }
  async close(): Promise<void> {
    await this.serial(async () => {
      if (this.closed) return;
      this.closed = true;
      await this.log.close?.();
      try {
        const owner = JSON.parse(await readFile(this.path + ".writer.lock", "utf8")) as { token?: string };
        if (owner.token === this.token) await rm(this.path + ".writer.lock");
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    });
  }
}
