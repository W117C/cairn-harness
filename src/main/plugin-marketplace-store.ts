import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readBodyCapped } from "../net";
import {
  MAX_MARKETPLACE_PAYLOAD_BYTES,
  verifyMarketplaceCatalogEnvelope,
  type MarketplaceCatalog,
  type MarketplacePublicKey,
} from "../agent/plugins/marketplace";

const REFRESH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = Math.ceil((MAX_MARKETPLACE_PAYLOAD_BYTES * 4) / 3) + 16 * 1024;
const MAX_CACHE_BYTES = 768 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = "catalog.json";

export interface MarketplaceSourceConfig {
  readonly catalogUrl: string | null;
  readonly publicKeys: readonly MarketplacePublicKey[];
  readonly configProblem?: string;
}

export interface MarketplaceCacheOptions {
  readonly dir: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface MarketplaceCatalogReadout {
  readonly status: "ready" | "unavailable";
  readonly origin: "live" | "cache" | "none";
  readonly catalog: MarketplaceCatalog | null;
  readonly fetchedAt: string | null;
  readonly expiresAt: string | null;
  readonly stale: boolean;
  readonly note?: string;
}

interface CacheRecord {
  readonly schemaVersion: 1;
  readonly fetchedAt: string;
  readonly envelope: unknown;
}

interface VerifiedCache {
  readonly catalog: MarketplaceCatalog;
  readonly fetchedAt: string;
  readonly fetchedAtMillis: number;
}

interface ReadCacheResult {
  readonly cache: VerifiedCache | null;
  readonly problem: string | null;
}

function option(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function validHttpsUrl(value: string, label: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      return `${label} 必须是 HTTPS 地址且不能包含凭据`;
    }
    return null;
  } catch {
    return `${label} 不是合法 URL`;
  }
}

export function marketplaceSourceConfigFromEnv(env: NodeJS.ProcessEnv): MarketplaceSourceConfig {
  const catalogUrl = option(env.CAIRN_PLUGIN_MARKETPLACE_URL);
  const keysRaw = option(env.CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON);
  if (keysRaw === null) return { catalogUrl, publicKeys: [] };

  try {
    const parsed = JSON.parse(keysRaw) as unknown;
    if (!Array.isArray(parsed)) {
      return { catalogUrl, publicKeys: [], configProblem: "CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON 必须是数组" };
    }
    const keys: MarketplacePublicKey[] = [];
    for (const [index, value] of parsed.entries()) {
      if (
        typeof value !== "object" || value === null || Array.isArray(value)
        || typeof (value as Record<string, unknown>).id !== "string"
        || typeof (value as Record<string, unknown>).pem !== "string"
      ) {
        return {
          catalogUrl,
          publicKeys: [],
          configProblem: `CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON[${String(index)}] 必须包含字符串 id 与 pem`,
        };
      }
      keys.push({
        id: ((value as Record<string, unknown>).id as string).trim(),
        pem: (value as Record<string, unknown>).pem as string,
      });
    }
    return { catalogUrl, publicKeys: keys };
  } catch (err) {
    return {
      catalogUrl,
      publicKeys: [],
      configProblem: `CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function configurationProblem(config: MarketplaceSourceConfig): string | null {
  if (config.configProblem !== undefined) return config.configProblem;
  if (config.catalogUrl === null) return "插件市场目录未配置（缺少 CAIRN_PLUGIN_MARKETPLACE_URL）";
  const urlProblem = validHttpsUrl(config.catalogUrl, "插件市场目录地址");
  if (urlProblem !== null) return urlProblem;
  if (config.publicKeys.length === 0) {
    return "插件市场目录未配置签名公钥（缺少 CAIRN_PLUGIN_MARKETPLACE_KEYS_JSON）";
  }
  if (new Set(config.publicKeys.map((key) => key.id)).size !== config.publicKeys.length) {
    return "插件市场签名公钥 id 重复";
  }
  for (const key of config.publicKeys) {
    if (key.id.trim() === "" || key.pem.trim() === "") return "插件市场签名公钥 id 与 PEM 不能为空";
  }
  return null;
}

function unavailable(note: string): MarketplaceCatalogReadout {
  return {
    status: "unavailable",
    origin: "none",
    catalog: null,
    fetchedAt: null,
    expiresAt: null,
    stale: false,
    note,
  };
}

function readCache(dir: string, keys: readonly MarketplacePublicKey[]): ReadCacheResult {
  const path = join(dir, CACHE_FILE);
  let raw: string;
  try {
    const buf = readFileSync(path);
    if (buf.length > MAX_CACHE_BYTES) {
      return { cache: null, problem: `本地缓存超过 ${String(MAX_CACHE_BYTES)} 字节上限` };
    }
    raw = buf.toString("utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { cache: null, problem: null };
    return { cache: null, problem: `本地缓存读取失败：${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("缓存必须是对象");
    }
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1) throw new Error("缓存 schemaVersion 不支持");
    if (typeof record.fetchedAt !== "string") throw new Error("缓存缺少 fetchedAt");
    const fetchedAtMillis = Date.parse(record.fetchedAt);
    if (!Number.isFinite(fetchedAtMillis)) throw new Error("缓存 fetchedAt 非法");
    const catalog = verifyMarketplaceCatalogEnvelope(record.envelope, keys);
    return {
      cache: { catalog, fetchedAt: record.fetchedAt, fetchedAtMillis },
      problem: null,
    };
  } catch (err) {
    return { cache: null, problem: `本地缓存损坏：${err instanceof Error ? err.message : String(err)}` };
  }
}

function cacheRecord(fetchedAt: string, envelope: unknown): CacheRecord {
  return { schemaVersion: 1, fetchedAt, envelope };
}

function catalogExpiredAt(catalog: MarketplaceCatalog, at: number): boolean {
  return Date.parse(catalog.expiresAt) <= at;
}

function cacheStaleAt(cache: VerifiedCache, at: number, maxAgeMs: number): boolean {
  const age = at - cache.fetchedAtMillis;
  return age < 0 || age > maxAgeMs || catalogExpiredAt(cache.catalog, at);
}

function writeCache(dir: string, fetchedAt: string, envelope: unknown): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, CACHE_FILE);
  const temp = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(cacheRecord(fetchedAt, envelope)), { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
  } catch (err) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

async function refresh(
  config: MarketplaceSourceConfig,
  fetchImpl: typeof fetch,
): Promise<{ envelope: unknown; catalog: MarketplaceCatalog } | { error: string }> {
  try {
    const response = await fetchImpl(config.catalogUrl as string, {
      redirect: "manual",
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      return { error: `插件市场目录返回重定向 ${String(response.status)}（不跟随）` };
    }
    if (!response.ok) return { error: `插件市场目录 HTTP ${String(response.status)}` };
    const body = await readBodyCapped(response, MAX_RESPONSE_BYTES);
    if (body.capped) {
      return { error: `插件市场目录超过 ${String(MAX_RESPONSE_BYTES)} 字节上限` };
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(body.text);
    } catch {
      return { error: "插件市场目录不是合法 JSON" };
    }
    const catalog = verifyMarketplaceCatalogEnvelope(envelope, config.publicKeys);
    return { envelope, catalog };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPluginMarketplaceCatalog(
  input: { refresh?: "never" | "auto" | "force"; maxAgeMs?: number },
  config: MarketplaceSourceConfig,
  opts: MarketplaceCacheOptions,
): Promise<MarketplaceCatalogReadout> {
  const now = opts.now?.() ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const refreshMode = input.refresh ?? "never";
  const configProblem = configurationProblem(config);
  if (configProblem !== null) return unavailable(configProblem);

  const cachedResult = readCache(opts.dir, config.publicKeys);
  const cached = cachedResult.cache;
  const notes: string[] = [];
  if (cachedResult.problem !== null) notes.push(cachedResult.problem);

  const shouldRefresh = refreshMode === "force"
    || (refreshMode === "auto" && (cached === null || cacheStaleAt(cached, now, maxAgeMs)));
  let readAt = now;
  if (shouldRefresh) {
    const got = await refresh(config, opts.fetchImpl ?? fetch);
    readAt = opts.now?.() ?? Date.now();
    if ("catalog" in got) {
      const stale = catalogExpiredAt(got.catalog, readAt);
      if (stale && cached !== null && !cacheStaleAt(cached, readAt, maxAgeMs)) {
        notes.push("刷新返回的目录已过期，保留较新的已验证缓存");
      } else {
        const fetchedAt = new Date(readAt).toISOString();
        try {
          writeCache(opts.dir, fetchedAt, got.envelope);
        } catch (err) {
          notes.push(`缓存写入失败（不影响本次使用）：${err instanceof Error ? err.message : String(err)}`);
        }
        if (stale) notes.push("刷新返回的目录已过期");
        return {
          status: "ready",
          origin: "live",
          catalog: got.catalog,
          fetchedAt,
          expiresAt: got.catalog.expiresAt,
          stale,
          ...(notes.length > 0 ? { note: notes.join("；") } : {}),
        };
      }
    } else {
      notes.push(`刷新失败：${got.error}`);
    }
  } else if (refreshMode === "auto" && cached !== null) {
    notes.push("缓存仍新鲜，未刷新");
  }

  if (cached !== null) {
    const stale = cacheStaleAt(cached, readAt, maxAgeMs);
    if (stale) notes.unshift("使用已过期的已验证缓存");
    return {
      status: "ready",
      origin: "cache",
      catalog: cached.catalog,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.catalog.expiresAt,
      stale,
      ...(notes.length > 0 ? { note: notes.join("；") } : {}),
    };
  }

  notes.push("没有已验证的插件市场目录缓存");
  return unavailable(notes.join("；"));
}
