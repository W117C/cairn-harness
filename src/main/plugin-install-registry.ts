import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import {
  parsePluginSource,
  type PluginInstallScope,
  type PluginSource,
} from "./plugin-source";

export type { PluginInstallScope } from "./plugin-source";

const REGISTRY_SCHEMA_VERSION = 2;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const FINGERPRINT = /^[a-f0-9]{32}$/u;

export interface InstalledPluginRecord {
  readonly entryId: string;
  readonly manifestName: string;
  readonly version: string | null;
  readonly sha256: string;
  readonly fingerprint: string;
  readonly source: PluginSource;
  readonly scope: PluginInstallScope;
  readonly workspace: string | null;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface PluginInstallRegistryPort {
  list(): Promise<InstalledPluginRecord[]>;
  get(entryId: string, scope: PluginInstallScope, workspace: string | null): Promise<InstalledPluginRecord | null>;
  upsert(record: InstalledPluginRecord): Promise<void>;
  remove(entryId: string, scope: PluginInstallScope, workspace: string | null): Promise<void>;
}

interface RegistryFile {
  readonly schemaVersion: 2;
  readonly records: readonly InstalledPluginRecord[];
}

export class InstalledPluginRegistryError extends Error {}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function legacyCatalogSource(entryId: string): PluginSource {
  return {
    kind: "catalog",
    catalogId: "cairn",
    entryId,
    sourceUrl: "",
    revision: "",
  };
}

function record(value: unknown, index: number, schemaVersion: 1 | 2): InstalledPluginRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} is invalid`);
  }
  const raw = value as Record<string, unknown>;
  if (!nonEmpty(raw.entryId) || !ID.test(raw.entryId)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} entryId is invalid`);
  }
  if (!nonEmpty(raw.manifestName) || !ID.test(raw.manifestName)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} manifestName is invalid`);
  }
  if (raw.version !== null && !nonEmpty(raw.version)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} version is invalid`);
  }
  if (raw.version === null && schemaVersion === 1) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} version is invalid`);
  }
  if (typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} sha256 is invalid`);
  }
  if (typeof raw.fingerprint !== "string" || !FINGERPRINT.test(raw.fingerprint)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} fingerprint is invalid`);
  }
  if (raw.scope !== "user" && raw.scope !== "project") {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} scope is invalid`);
  }
  if (raw.scope === "user" ? raw.workspace !== null : !nonEmpty(raw.workspace)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} workspace is invalid`);
  }
  if (typeof raw.enabled !== "boolean") {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} enabled is invalid`);
  }
  if (!validDate(raw.installedAt) || !validDate(raw.updatedAt)) {
    throw new InstalledPluginRegistryError(`installed registry record ${String(index)} timestamps are invalid`);
  }
  let source: PluginSource;
  try {
    source = raw.source === undefined
      ? schemaVersion === 1
        ? legacyCatalogSource(raw.entryId)
        : (() => { throw new Error("missing source"); })()
      : parsePluginSource(raw.source);
  } catch (err) {
    throw new InstalledPluginRegistryError(
      `installed registry record ${String(index)} source is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const workspace = raw.scope === "user" ? null : raw.workspace as string;
  return {
    entryId: raw.entryId,
    manifestName: raw.manifestName,
    version: raw.version as string | null,
    sha256: raw.sha256,
    fingerprint: raw.fingerprint,
    source,
    scope: raw.scope,
    workspace,
    enabled: raw.enabled,
    installedAt: raw.installedAt,
    updatedAt: raw.updatedAt,
  };
}

function registryFile(value: unknown): RegistryFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstalledPluginRegistryError("installed registry must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new InstalledPluginRegistryError("installed registry schemaVersion is unsupported");
  }
  if (!Array.isArray(raw.records)) {
    throw new InstalledPluginRegistryError("installed registry records must be an array");
  }
  const schemaVersion = raw.schemaVersion;
  const records = raw.records.map((row, index) => record(row, index, schemaVersion));
  const keys = new Set<string>();
  for (const row of records) {
    const key = JSON.stringify([row.entryId, row.scope, row.workspace]);
    if (keys.has(key)) throw new InstalledPluginRegistryError("installed registry contains duplicate keys");
    keys.add(key);
  }
  return { schemaVersion: 2, records };
}

function sameKey(
  row: Pick<InstalledPluginRecord, "entryId" | "scope" | "workspace">,
  entryId: string,
  scope: PluginInstallScope,
  workspace: string | null,
): boolean {
  return row.entryId === entryId
    && row.scope === scope
    && row.workspace === (scope === "user" ? null : workspace);
}

function clone(row: InstalledPluginRecord): InstalledPluginRecord {
  return { ...row, source: { ...row.source } };
}

export class InstalledPluginRegistry implements PluginInstallRegistryPort {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<RegistryFile> {
    let size: number;
    try {
      size = (await stat(this.filePath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 2, records: [] };
      throw new InstalledPluginRegistryError(
        `installed registry read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (size > MAX_REGISTRY_BYTES) {
      throw new InstalledPluginRegistryError(`installed registry exceeds ${String(MAX_REGISTRY_BYTES)} byte limit`);
    }
    // 读后复查（CodeQL js/file-system-race，2026-11-13）：stat 限长与读取之间文件可能被换大
    // ⇒ 上限在读到的**实际内容**上再判一次。读取与尺寸两格都在 parse 的 try 外抛——
    // 「读不出」「超限」「内容坏」是三种病，报错必须分开说，尺寸病不许被包装成 malformed。
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      throw new InstalledPluginRegistryError(
        `installed registry read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_BYTES) {
      throw new InstalledPluginRegistryError(`installed registry exceeds ${String(MAX_REGISTRY_BYTES)} byte limit`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new InstalledPluginRegistryError(
        `installed registry is malformed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return registryFile(parsed);
  }

  private async persist(state: RegistryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.filePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  }

  async list(): Promise<InstalledPluginRecord[]> {
    return (await this.load()).records.map(clone);
  }

  async get(
    entryId: string,
    scope: PluginInstallScope,
    workspace: string | null,
  ): Promise<InstalledPluginRecord | null> {
    const found = (await this.load()).records.find((row) => sameKey(row, entryId, scope, workspace));
    return found === undefined ? null : clone(found);
  }

  async upsert(value: InstalledPluginRecord): Promise<void> {
    const nextRecord = record(value, 0, 2);
    const run = async (): Promise<void> => {
      const current = await this.load();
      const records = current.records.map(clone);
      const index = records.findIndex((row) => sameKey(
        row,
        nextRecord.entryId,
        nextRecord.scope,
        nextRecord.workspace,
      ));
      if (index === -1) records.push(nextRecord);
      else records[index] = nextRecord;
      await this.persist({ schemaVersion: 2, records });
    };
    const pending = this.writes.then(run, run);
    this.writes = pending.catch(() => undefined);
    await pending;
  }

  async remove(
    entryId: string,
    scope: PluginInstallScope,
    workspace: string | null,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const current = await this.load();
      const records = current.records.filter((row) => !sameKey(row, entryId, scope, workspace));
      if (records.length === current.records.length) return;
      await this.persist({ schemaVersion: 2, records });
    };
    const pending = this.writes.then(run, run);
    this.writes = pending.catch(() => undefined);
    await pending;
  }
}
