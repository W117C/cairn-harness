import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const LEDGER_THRESHOLD_BYTES = 10 * 1024;
export const RECALL_MAX_BYTES = 16 * 1024;
export const RECALL_MAX_LINES = 400;
export const FULL_SENDS = 2;
const ID = /^obs_[a-f0-9]{24}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const queues = new Map<string, Promise<unknown>>();
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const linesOf = (text: string): number => {
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines + Number(text.length > 0 && !text.endsWith("\n"));
};

/** This is an explicit trust assertion, NOT a redactor. Only the host's authorized,
 * already-redacted event text belongs here. Never pass a raw shell spool/buffer. */
export interface AuthorizedRedactedText { kind: "authorized-redacted-text"; text: string }
export interface LedgerRecord { id: string; sha256: string; bytes: number; lines: number; path: string }
interface Entry { sha256: string; bytes: number; lines: number }
interface Manifest { version: 1; sessionId: string; epoch: string; entries: Record<string, Entry>; deleted?: true }
export interface LedgerOptions {
  /** Existing, canonical, private application session-data directory; NOT workspace. */
  sessionDataDir: string;
  sessionId: string;
  enabled?: boolean;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
  maxObjects?: number;
  maxEntries?: number;
  /** Dependency injection for offline disk-failure tests. */
  fs?: typeof fs;
}
export interface RecallInput {
  id: string;
  by?: "bytes" | "lines";
  offset?: number;
  max?: number;
  /** Byte position within an oversized line, returned by the preceding line page. */
  byteInLine?: number;
}
export interface RecallPage {
  text: string;
  eof: boolean;
  nextOffset?: number;
  nextByteInLine?: number;
}
export interface Projection { text: string; archived: boolean; id?: string; error?: string }
export function observeId(toolName: string, callId: string, contentHash: string): string {
  return `obs_${sha(`${toolName}\0${callId}\0${contentHash}`).slice(0, 24)}`;
}
function fault(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`ledger ${code}: ${message}`), { code });
}
function integer(value: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault("EINVAL", "invalid limit/offset");
  return value;
}
function validId(id: string): void { if (!ID.test(id)) throw fault("EINVAL", "invalid observation id"); }
function errorText(error: unknown): string {
  // Do not leak OS paths (or source text) into the model-visible diagnostic.
  const code = (error as { code?: string })?.code;
  return `ledger unavailable (${typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "EIO"})`;
}

/** Durable TEXT-only store. All operations re-read disk state under a per-session
 * queue and exclusive on-disk lock. A crash-held lock fails visibly (EBUSY), never
 * auto-stolen. Host can remove it only after proving no live writer exists.
 * O_NOFOLLOW + fstat guard all reads; application-owned parent directories must
 * not be concurrently renamed by untrusted processes (Node has no openat API).
 * No event mutation, automatic eviction, raw-byte persistence or default enable. */
export class ObservationLedger {
  readonly enabled: boolean;
  readonly directory: string;
  private readonly io: typeof fs;
  private readonly root: string;
  private readonly sessionId: string;
  private readonly limits: { object: number; total: number; objects: number; entries: number };
  private deleted = false;
  constructor(options: LedgerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.sessionId)) throw fault("EINVAL", "invalid session id");
    if (!isAbsolute(options.sessionDataDir)) throw fault("EINVAL", "sessionDataDir must be absolute");
    this.root = resolve(options.sessionDataDir);
    this.sessionId = options.sessionId;
    this.directory = join(this.root, `ledger-${this.sessionId}`);
    this.enabled = options.enabled === true;
    this.io = options.fs ?? fs;
    this.limits = {
      object: integer(options.maxObjectBytes ?? 4 * 1024 * 1024, 1, 64 * 1024 * 1024),
      total: integer(options.maxTotalBytes ?? 64 * 1024 * 1024, 1, 1024 * 1024 * 1024),
      objects: integer(options.maxObjects ?? 256, 1, 4096),
      entries: integer(options.maxEntries ?? 1024, 1, 4096),
    };
  }
  private requireEnabled(): void {
    if (!this.enabled) throw fault("EDISABLED", "disabled");
    if (this.deleted) throw fault("ESTALE", "session deleted");
  }
  private async directoryCheck(path: string): Promise<void> {
    const stat = await this.io.lstat(path);
    if (stat.isSymbolicLink()) throw fault("ELOOP", "symlink directory");
    if (!stat.isDirectory()) throw fault("EINVAL", "not a directory");
  }
  private async parents(): Promise<void> {
    let p = this.root;
    for (;;) {
      await this.directoryCheck(p);
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }
  private async locked<T>(create: boolean, fn: () => Promise<T>): Promise<T> {
    this.requireEnabled();
    const previous = queues.get(this.directory) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      this.requireEnabled();
      await this.parents();
      if (create) await this.io.mkdir(this.directory, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
      await this.directoryCheck(this.directory);
      const lockPath = join(this.directory, ".lock");
      const lock = await this.io.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        .catch((e: NodeJS.ErrnoException) => { if (e.code === "EEXIST") throw fault("EBUSY", "session locked"); throw e; });
      try { return await fn(); }
      finally { await lock.close(); await this.io.unlink(lockPath); }
    });
    queues.set(this.directory, task);
    try { return await task; }
    finally { if (queues.get(this.directory) === task) queues.delete(this.directory); }
  }
  private async readFile(path: string, cap: number): Promise<Buffer> {
    const handle = await this.io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw fault("EINVAL", "not a private regular file");
      if (stat.size > cap) throw fault("EQUOTA", "file exceeds bound");
      // Fixed allocation + one sentinel byte also bounds a file grown after fstat.
      const buffer = Buffer.alloc(stat.size + 1);
      let n = 0;
      while (n < buffer.length) {
        const { bytesRead } = await handle.read(buffer, n, buffer.length - n, n);
        if (!bytesRead) break;
        n += bytesRead;
      }
      if (n !== stat.size) throw fault("ECORRUPT", "file changed during read");
      return buffer.subarray(0, n);
    } finally { await handle.close(); }
  }
  private async manifest(create: boolean, allowDeleted = false): Promise<Manifest> {
    let data: Buffer;
    try { data = await this.readFile(join(this.directory, "index.json"), 1024 * 1024); }
    catch (e) {
      if (create && (e as NodeJS.ErrnoException).code === "ENOENT") {
        const m: Manifest = { version: 1, sessionId: this.sessionId, epoch: randomUUID(), entries: {} };
        await this.save(m);
        return m;
      }
      throw e;
    }
    let m: Manifest;
    try { m = JSON.parse(data.toString("utf8")) as Manifest; } catch { throw fault("ECORRUPT", "invalid index"); }
    if (!m || m.version !== 1 || m.sessionId !== this.sessionId || !/^[a-f0-9-]{36}$/.test(m.epoch) ||
        !m.entries || typeof m.entries !== "object" || Array.isArray(m.entries)) throw fault("ECORRUPT", "invalid index");
    if (m.deleted === true && !allowDeleted) throw fault("ESTALE", "session deleted");
    if (Object.keys(m.entries).length > this.limits.entries) throw fault("EQUOTA", "entry quota");
    for (const [id, e] of Object.entries(m.entries)) {
      if (!ID.test(id) || !e || !HASH.test(e.sha256) || !Number.isSafeInteger(e.bytes) || e.bytes < 0 ||
          e.bytes > this.limits.object || !Number.isSafeInteger(e.lines) || e.lines < 0 || e.lines > e.bytes)
        throw fault("ECORRUPT", "invalid entry");
    }
    return m;
  }
  private async syncDir(path: string): Promise<void> {
    const h = await this.io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await h.sync(); } finally { await h.close(); }
  }
  private async save(m: Manifest): Promise<void> {
    const temp = join(this.directory, ".index.tmp");
    // All callers hold the exclusive session lock. A leftover regular temp is
    // from an interrupted manifest commit; never follow or replace a symlink.
    try {
      const stale = await this.io.lstat(temp);
      if (stale.isSymbolicLink()) throw fault("ELOOP", "symlink manifest temp");
      if (!stale.isFile() || stale.nlink !== 1) throw fault("EINVAL", "unsafe manifest temp");
      await this.io.unlink(temp);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const h = await this.io.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await h.writeFile(JSON.stringify(m), "utf8"); await h.sync(); }
    catch (e) { await h.close(); await this.io.unlink(temp); throw e; }
    await h.close();
    try { await this.io.rename(temp, join(this.directory, "index.json")); await this.syncDir(this.directory); }
    catch (e) { await this.io.unlink(temp).catch(() => {}); throw e; }
  }
  private async objects(create: boolean): Promise<string> {
    const dir = join(this.directory, "objects");
    if (create) await this.io.mkdir(dir, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    await this.directoryCheck(dir);
    return dir;
  }
  private async usage(dir: string): Promise<{ bytes: number; count: number }> {
    // Streaming scan, bounded even when outsiders fill the directory. Orphans
    // from interrupted commits count against quota, including after restart.
    const stream = await this.io.opendir(dir);
    let bytes = 0, count = 0;
    for await (const entry of stream) {
      if (!/^[a-f0-9]{64}\.txt$/.test(entry.name)) throw fault("ECORRUPT", "unknown object");
      const stat = await this.io.lstat(join(dir, entry.name));
      if (stat.isSymbolicLink()) throw fault("ELOOP", "symlink object");
      if (!stat.isFile() || stat.nlink !== 1) throw fault("EINVAL", "nonregular object");
      bytes += stat.size; count++;
      if (bytes > this.limits.total || count > this.limits.objects) throw fault("EQUOTA", "store quota");
    }
    return { bytes, count };
  }
  private async source(m: Manifest, id: string): Promise<{ entry: Entry; buffer: Buffer }> {
    validId(id);
    const entry = m.entries[id];
    if (!entry) throw fault("ESTALE", "unknown or cleared observation");
    const dir = await this.objects(false);
    const buffer = await this.readFile(join(dir, `${entry.sha256}.txt`), this.limits.object);
    if (buffer.length !== entry.bytes || sha(buffer) !== entry.sha256) throw fault("ECORRUPT", "object hash mismatch");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (linesOf(text) !== entry.lines) throw fault("ECORRUPT", "line count mismatch");
    return { entry, buffer };
  }
  async archive(input: { toolName: string; callId: string; source: AuthorizedRedactedText }): Promise<LedgerRecord | undefined> {
    if (!this.enabled) return undefined;
    if (input.source?.kind !== "authorized-redacted-text" || typeof input.source.text !== "string") throw fault("EAUTH", "authorized redacted text required");
    const text = input.source.text;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= LEDGER_THRESHOLD_BYTES) return undefined;
    if (bytes > this.limits.object) throw fault("EQUOTA", "object quota");
    if (typeof input.toolName !== "string" || !input.toolName || input.toolName.length > 256 || input.toolName.includes("\0") ||
        typeof input.callId !== "string" || !input.callId || input.callId.length > 1024 || input.callId.includes("\0")) throw fault("EINVAL", "invalid tool/call id");
    return this.locked(true, async () => {
      const buffer = Buffer.from(text, "utf8");
      if (buffer.toString("utf8") !== text || text.includes("\0")) throw fault("EINVAL", "not lossless UTF-8 text");
      const m = await this.manifest(true);
      const hash = sha(buffer);
      const id = observeId(input.toolName, `${this.sessionId}:${m.epoch}:${input.callId}`, hash);
      const dir = await this.objects(true);
      const path = join(dir, `${hash}.txt`);
      const used = await this.usage(dir);
      if (!m.entries[id] && Object.keys(m.entries).length >= this.limits.entries) throw fault("EQUOTA", "entry quota");
      let exists = true;
      try {
        const old = await this.readFile(path, this.limits.object);
        if (!old.equals(buffer)) throw fault("ECORRUPT", "content-address collision");
      } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") exists = false; else throw e; }
      if (!exists) {
        if (used.bytes + bytes > this.limits.total || used.count + 1 > this.limits.objects) throw fault("EQUOTA", "store quota");
        const h = await this.io.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await h.writeFile(buffer); await h.sync(); }
        catch (e) { await h.close(); await this.io.unlink(path); throw e; }
        await h.close();
        await this.syncDir(dir);
      }
      const entry = { sha256: hash, bytes, lines: linesOf(text) };
      m.entries[id] = entry;
      await this.save(m);
      return { id, ...entry, path };
    });
  }
  /** Call at capture time. Never replaces or truncates the event's full output. */
  async capture(input: { toolName: string; callId: string; source: AuthorizedRedactedText }): Promise<Projection> {
    const text = input.source.text;
    if (!this.enabled) return { text, archived: false };
    try {
      const record = await this.archive(input);
      return { text, archived: !!record, ...(record ? { id: record.id } : {}) };
    } catch (e) { return { text, archived: false, error: errorText(e) }; }
  }
  /** requestNumber is 1-based successful provider sends containing this result,
   * tracked by the host, NOT assembly attempts. Revalidate on every projection.
   * Keep full source in events; never use this return value to overwrite events. */
  async project(input: { id?: string; text: string; requestNumber: number }): Promise<Projection> {
    if (!this.enabled || !input.id) return { text: input.text, archived: false };
    try {
      integer(input.requestNumber, 1);
      return await this.locked(false, async () => {
        const m = await this.manifest(false);
        const { entry, buffer } = await this.source(m, input.id!);
        if (buffer.toString("utf8") !== input.text) throw fault("ECORRUPT", "event source mismatch");
        if (input.requestNumber <= FULL_SENDS) return { text: input.text, archived: true, id: input.id };
        let end = Math.min(1024, buffer.length);
        while (end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
        return { text: `${buffer.subarray(0, end).toString("utf8")}\n[observation ${input.id}: ${entry.bytes} bytes, ${entry.lines} lines; obs_recall available]`, archived: true, id: input.id };
      });
    } catch (e) { return { text: input.text, archived: false, error: errorText(e) }; }
  }
  async recall(input: RecallInput): Promise<RecallPage> {
    validId(input.id);
    const by = input.by ?? "bytes";
    if (by !== "bytes" && by !== "lines") throw fault("EINVAL", "invalid paging mode");
    const offset = integer(input.offset ?? 0, 0);
    const max = Math.min(integer(input.max ?? (by === "bytes" ? RECALL_MAX_BYTES : RECALL_MAX_LINES), 1), by === "bytes" ? RECALL_MAX_BYTES : RECALL_MAX_LINES);
    const within = integer(input.byteInLine ?? 0, 0);
    if (by === "bytes" && within !== 0) throw fault("EINVAL", "byteInLine requires lines mode");
    return this.locked(false, async () => {
      const { buffer } = await this.source(await this.manifest(false), input.id);
      let start = offset;
      if (by === "lines") {
        start = 0;
        for (let line = 0; line < offset; line++) {
          if (start >= buffer.length) throw fault("ERANGE", "line offset beyond EOF");
          const end = buffer.indexOf(10, start);
          start = end < 0 ? buffer.length : end + 1;
        }
        const nl = buffer.indexOf(10, start);
        const length = (nl < 0 ? buffer.length : nl + 1) - start;
        if (within >= length && within !== 0) throw fault("ERANGE", "invalid within-line offset");
        start += within;
      }
      if (start > buffer.length || (start < buffer.length && (buffer[start]! & 0xc0) === 0x80)) throw fault("ERANGE", "offset not a UTF-8 boundary");
      let end = Math.min(buffer.length, start + (by === "bytes" ? max : RECALL_MAX_BYTES));
      let newlines = 0;
      const lineCap = by === "lines" ? max : RECALL_MAX_LINES;
      for (let i = start; i < end; i++) if (buffer[i] === 10 && ++newlines === lineCap) { end = i + 1; break; }
      while (end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
      if (end === start && start < buffer.length) throw fault("ERANGE", "page too small for next UTF-8 character");
      const page = buffer.subarray(start, end);
      const eof = end === buffer.length;
      if (eof) return { text: page.toString("utf8"), eof };
      if (by === "bytes") return { text: page.toString("utf8"), eof, nextOffset: end };
      const count = page.reduce((n, b) => n + Number(b === 10), 0);
      const last = page.lastIndexOf(10);
      return { text: page.toString("utf8"), eof, nextOffset: offset + count,
        nextByteInLine: last < 0 ? within + page.length : page.length - last - 1 };
    });
  }
  async delete(id: string): Promise<void> {
    if (!this.enabled) return;
    validId(id);
    await this.locked(false, async () => {
      const m = await this.manifest(false);
      const e = m.entries[id];
      if (!e) throw fault("ESTALE", "unknown observation");
      m.epoch = randomUUID(); // Do not revive a deleted handle on identical recapture.
      delete m.entries[id];
      await this.save(m); // revoke first; an interrupted unlink leaves a counted orphan
      if (!Object.values(m.entries).some(other => other.sha256 === e.sha256)) {
        await this.io.unlink(join(await this.objects(false), `${e.sha256}.txt`));
        await this.syncDir(join(this.directory, "objects"));
      }
    });
  }
  /** Clear rotates generation before deleting objects; old handles cannot revive. */
  async clear(): Promise<void> { return this.reset(false); }
  private async reset(deleted: boolean): Promise<void> {
    if (!this.enabled) return;
    await this.locked(true, async () => {
      const m = await this.manifest(true, deleted);
      m.entries = {}; m.epoch = randomUUID();
      if (deleted) m.deleted = true;
      await this.save(m);
      const dir = await this.objects(true);
      for await (const e of await this.io.opendir(dir)) {
        if (!/^[a-f0-9]{64}\.txt$/.test(e.name)) throw fault("ECORRUPT", "unknown object during clear");
        // unlink never follows object symlinks; never recursively remove unknown directories.
        await this.io.unlink(join(dir, e.name));
      }
      await this.syncDir(dir);
    });
  }
  /** Revokes archives and closes this instance. Host then deletes the owning
   * session data directory after stopping all session writers. */
  async deleteSession(): Promise<void> {
    if (!this.enabled || this.deleted) return;
    await this.reset(true);
    this.deleted = true;
  }
}
/** 会话观察账本的唯一构造点。`sessionId` 只在这里出现一次：写入侧（SolpiRuntime）与撤销侧
 *  （removePrivateSessionData）必须指向同一个 `ledger-<sessionId>` 目录，两处各写字面量
 *  就是漂移的入口。*/
export const OBSERVATION_SESSION_ID = "observations";
export const createObservationLedger = (sessionDataDir: string): ObservationLedger =>
  new ObservationLedger({ sessionDataDir, sessionId: OBSERVATION_SESSION_ID, enabled: true });
