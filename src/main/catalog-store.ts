// 模型目录的 IO 壳：内置快照 → 本地缓存 → 联网刷新，并把「这次用的是哪一份」明说出来。
//
// 分工：catalog.ts 是纯逻辑（解析 + 查询），本文件只做 I/O。分界线画在这里是因为
// 「读数从哪来」这件事必须能被 CLI/UI 原样显示，而它是 I/O 的结果，不是解析的结果。
//
// 三个来源的优先级与理由：
//   live    —— 刚拉到的，最新（刷新成功时用它）
//   cache   —— 上次拉到的，还能用（缓存未过期，或刷新失败但有缓存）
//   snapshot—— 随包内置，永不失败（断网、缓存也没时的兜底）
// 任何回退都写进 `note`：用户要能看见「这条窗口值是内置快照里三个月前的，不是刚拉的」。
//
// 安全（照 claude code 的发现请求口径）：
//   · 不跟随重定向 —— 数据源请求重定向会把请求带到别处，一律当失败；
//   · 5 秒超时 —— 目录拉不动不该拖住用户的任务；
//   · 响应体有上限 —— 上游换了内容（比如返回一个 HTML 错误页）不会把内存吃光。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCatalogSnapshot,
  parseModelsDevCatalog,
  type CatalogReadout,
  type CatalogSnapshot,
} from "../providers/catalog";

/** 数据源：与 scripts/catalog-snapshot.ts 同一处（改一处即两边一致）。 */
export const CATALOG_SOURCE_URL = "https://models.dev/api.json";
const REFRESH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** 缓存新鲜度：24h（Aider 对同一份公共目录用的是同一个量级）。 */
export const DEFAULT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CatalogStoreOptions {
  /** 缓存目录；缺省 `~/.cairn-harness/catalog`（同 impact-tags 的落点约定），可用 CAIRN_CATALOG_DIR 覆盖。 */
  dir?: string;
  /** 内置快照路径；缺省本仓 src/providers/catalog-snapshot.json。 */
  snapshotPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface LoadCatalogInput {
  /** `never` = 只用快照/缓存；`auto` = 缓存过期才拉；`force` = 一定拉。缺省 `never`。 */
  refresh?: "never" | "auto" | "force";
  maxAgeMs?: number;
}

export function defaultCatalogDir(): string {
  const override = process.env.CAIRN_CATALOG_DIR;
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  return join(homedir(), ".cairn-harness", "catalog");
}

export function defaultSnapshotPath(): string {
  return join(dirname(dirname(fileURLToPath(import.meta.url))), "providers", "catalog-snapshot.json");
}

interface Resolved {
  dir: string;
  snapshotPath: string;
  doFetch: typeof fetch;
  now: () => number;
}

function resolve(opts: CatalogStoreOptions): Resolved {
  return {
    dir: opts.dir ?? defaultCatalogDir(),
    snapshotPath: opts.snapshotPath ?? defaultSnapshotPath(),
    doFetch: opts.fetchImpl ?? fetch,
    now: opts.now ?? (() => Date.now()),
  };
}

function cacheFile(dir: string): string {
  return join(dir, "models-dev.json");
}

/** 读一份文件并解析；不存在 ⇒ null；**存在但坏 ⇒ 抛**（调用方决定怎么记账，不在这里吞掉）。 */
function readJsonFile(path: string): unknown | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw) as unknown;
}

function snapshotOf(r: Resolved): { snapshot: CatalogSnapshot | null; problem: string | null } {
  try {
    const raw = readJsonFile(r.snapshotPath);
    if (raw === null) return { snapshot: null, problem: `内置快照不存在（${r.snapshotPath}）` };
    return { snapshot: parseCatalogSnapshot(raw), problem: null };
  } catch (err) {
    // 内置快照坏掉是打包/生成的错，但**不该拖垮用户这一轮任务** —— 目录只是帮填表的辅助。
    // 所以这里记账后继续（呼叫方会把 note 显示出来），而不是抛。
    return { snapshot: null, problem: `内置快照读取失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

function cachedOf(r: Resolved): { snapshot: CatalogSnapshot | null; problem: string | null; at: number | null } {
  try {
    const path = cacheFile(r.dir);
    const raw = readJsonFile(path);
    if (raw === null) return { snapshot: null, problem: null, at: null };
    const snapshot = parseCatalogSnapshot(raw);
    return { snapshot, problem: null, at: snapshot.generatedAt !== undefined ? Date.parse(snapshot.generatedAt) : null };
  } catch (err) {
    return { snapshot: null, problem: `本地缓存损坏：${err instanceof Error ? err.message : String(err)}`, at: null };
  }
}

function writeCache(r: Resolved, snapshot: CatalogSnapshot): void {
  mkdirSync(r.dir, { recursive: true });
  writeFileSync(cacheFile(r.dir), JSON.stringify(snapshot), "utf8");
}

/** 联网拉一份。失败**不抛**，而是把原因当字符串还给调用方去记账（目录拉不动不是致命错误）。 */
async function refresh(r: Resolved): Promise<{ snapshot: CatalogSnapshot } | { error: string }> {
  try {
    const res = await r.doFetch(CATALOG_SOURCE_URL, {
      redirect: "manual",
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.status >= 300 && res.status < 400) return { error: `数据源返回重定向 ${res.status}（不跟随）` };
    if (!res.ok) return { error: `数据源 HTTP ${res.status}` };
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return { error: `响应体 ${text.length} 字节超过上限` };
    const snapshot = parseModelsDevCatalog(JSON.parse(text) as unknown);
    // 拉到的时间以**本地时钟**记：上游不给时间戳，而「这份数据什么时候拿到的」正是要显示的东西。
    return { snapshot: { ...snapshot, generatedAt: new Date(r.now()).toISOString() } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 取一份目录。永不抛（除开缓存目录不可写这种写不进去就写不进去的情况，也只是记账）。
 * 返回的 `origin` 是**给用户看的**：snapshot / cache / live 三选一必须原样透出。
 */
export async function loadCatalog(
  input: LoadCatalogInput = {},
  opts: CatalogStoreOptions = {},
): Promise<CatalogReadout> {
  const r = resolve(opts);
  const refreshMode = input.refresh ?? "never";
  const maxAge = input.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;

  const snap = snapshotOf(r);
  const cached = cachedOf(r);
  const notes: string[] = [];
  if (snap.problem !== null) notes.push(snap.problem);
  if (cached.problem !== null) notes.push(cached.problem);

  const cacheFresh = cached.snapshot !== null && (cached.at === null || r.now() - cached.at <= maxAge);
  const wantRefresh = refreshMode === "force" || (refreshMode === "auto" && !cacheFresh);

  if (wantRefresh) {
    const got = await refresh(r);
    if ("snapshot" in got) {
      try {
        writeCache(r, got.snapshot);
      } catch (err) {
        notes.push(`缓存写入失败（不影响本次使用）：${err instanceof Error ? err.message : String(err)}`);
      }
      return {
        catalog: got.snapshot,
        origin: "live",
        ...(got.snapshot.generatedAt !== undefined ? { generatedAt: got.snapshot.generatedAt } : {}),
        ...(notes.length > 0 ? { note: notes.join("；") } : {}),
      };
    }
    notes.push(`刷新失败：${got.error}`);
  } else if (refreshMode === "auto" && cacheFresh) {
    notes.push("缓存仍新鲜，未刷新");
  }

  if (cached.snapshot !== null) {
    return {
      catalog: cached.snapshot,
      origin: "cache",
      ...(cached.snapshot.generatedAt !== undefined ? { generatedAt: cached.snapshot.generatedAt } : {}),
      ...(notes.length > 0 ? { note: notes.join("；") } : {}),
    };
  }

  if (snap.snapshot !== null) {
    return {
      catalog: snap.snapshot,
      origin: "snapshot",
      ...(snap.snapshot.generatedAt !== undefined ? { generatedAt: snap.snapshot.generatedAt } : {}),
      ...(notes.length > 0 ? { note: notes.join("；") } : {}),
    };
  }

  // 三个来源全无：给一份**空的**目录并说明原因。呼叫方（填表界面）会因此把每个字段都标成待填，
  // 而不是崩掉 —— 这仍是 fail-visible：note 里写清了为什么什么都不知道。
  return {
    catalog: { version: 1, source: "unavailable", providers: [] },
    origin: "snapshot",
    note: [...notes, "没有可用的模型目录（内置快照与缓存都不可用）"].join("；"),
  };
}
