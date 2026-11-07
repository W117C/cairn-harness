// M4b §2.1：provider key（BYOK）入 safeStorage（平台原生加密），密文 base64 落
// <appData>/provider-keys.json —— **明文零落盘**（落盘/日志/事件流三处纪律）。
// 复用 src/agent/plugins/secrets.ts 的 fail-closed 纪律：safeStorage 不可用 → **拒绝保存** +
// 显式错误，绝不静默退回明文。Electron main 侧经 installProviderKeyBackend 注入 IO（headless/测试可换）。
// 应用启动时解密注入 provider 配置（process.env.CAIRN_API_KEY，进程内；env 已在 = 优先，零行为）。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";
import type { SafeStorageIo } from "../agent/plugins/secrets";
import { ENV_KEYED_PROVIDERS, customEnvKeyedProviders, type EnvKeyedProvider } from "../providers/env-keys";
import { PROVIDER_ID_RE, RESERVED_PROVIDER_IDS } from "../providers/provider-identifiers";
import { customProviderById } from "../providers/registry";
import type { DerivedCustomProvider } from "../providers/provider-config";

export type { SafeStorageIo };

/** 密文存储 schema（Provider 管理面；commercial-check E 段判卷）。
 *  { version: 1, keys: { <providerId>: { ciphertext: base64, updatedAt: ISO } } } */
export interface ProviderKeyStore {
  version: 1;
  keys: Record<string, { ciphertext: string; updatedAt: string; route?: string }>;
}

/** 无安全后端时的拒绝原因（fail-closed，不静默退回明文——secrets.ts NO_BACKEND_ERROR 同款纪律）。 */
export const PROVIDER_KEY_NO_BACKEND_ERROR =
  "无安全存储后端（headless 或 safeStorage 不可用）→ 拒存 provider key（fail-closed，不落明文）";

/** BYOK 白名单直接复用 provider env-key 唯一事实源；demo 不需要/不接受 key。 */
export const PROVIDER_IDS = Object.freeze([...ENV_KEYED_PROVIDERS]) as readonly EnvKeyedProvider[];
export type ProviderId = EnvKeyedProvider;

export interface ProviderKeyBackend {
  name: string;
  isAvailable(): boolean;
  set(provider: string, plaintext: string, route?: string): Promise<void>;
  get(provider: string, route?: string): Promise<string | null>;
  delete(provider: string): Promise<boolean>;
  storedProviders(): Promise<string[]>;
}

let backend: ProviderKeyBackend | null = null;

/** Electron main 侧装配：safeStorage 加密，密文落 storePath（不可用 → 返回 false，不注入后端）。 */
export function installProviderKeyBackend(io: SafeStorageIo, storePath: string): boolean {
  backend = null;
  if (!io.isEncryptionAvailable()) return false;
  // Electron main owns this store; serialize read/modify/write across its windows.
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
  backend = {
    name: "safeStorage",
    isAvailable: () => io.isEncryptionAvailable(),
    set: (provider, plaintext, route) => serialize(async () => {
      const store = await readStore(storePath);
      store.keys[provider] = {
        ciphertext: io.encryptString(plaintext).toString("base64"),
        updatedAt: new Date().toISOString(),
        ...(route === undefined ? {} : { route }),
      };
      await writeStore(storePath, store);
    }),
    get: (provider, route) => serialize(async () => {
      const store = await readStore(storePath);
      const entry = store.keys[provider];
      if (!entry || (entry.route !== undefined && entry.route !== route)) return null;
      let plaintext: string;
      try {
        plaintext = io.decryptString(Buffer.from(entry.ciphertext, "base64"));
      } catch {
        return null;
      }
      // Old stores had only the provider id. Bind on the first registered activation.
      if (route !== undefined && entry.route === undefined) {
        entry.route = route;
        await writeStore(storePath, store);
      }
      return plaintext;
    }),
    delete: provider => serialize(async () => {
      const store = await readStore(storePath);
      if (!(provider in store.keys)) return false;
      delete store.keys[provider];
      await writeStore(storePath, store);
      return true;
    }),
    storedProviders: () => serialize(async () => Object.keys((await readStore(storePath)).keys).sort()),
  };
  return true;
}

/** 测试/替身注入；传 null = 回到无后端（fail-closed 路径）。 */
export function setProviderKeyBackend(b: ProviderKeyBackend | null): void {
  backend = b;
}

export function providerKeyBackend(): ProviderKeyBackend | null {
  return backend;
}

async function readStore(p: string): Promise<ProviderKeyStore> {
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, keys: {} };
    throw new Error("无法读取 provider key 存储；原文件未修改，请检查文件权限");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new Error("provider key 存储不是合法 JSON；原文件未修改，请先修复或恢复备份"); }
  // The encrypted file is application-wide; a workspace need not load every stored provider.
  const result = parseProviderKeyStore(parsed, false);
  if (!result.ok) throw new Error("provider key 存储格式无效；原文件未修改，请先修复或恢复备份");
  return result.value;
}

async function writeStore(p: string, store: ProviderKeyStore): Promise<void> {
  await writeFileAtomic(p, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

/** 严格 schema 校验（commercial-check「Provider 管理 schema」判卷面）：未知字段拒绝 / ciphertext 须 base64 /
 *  updatedAt 须可解析 ISO / version 恒 1。返回 {ok:false, reason} 而非抛异常（fail-visible）。 */
export function validateProviderKeyStore(raw: unknown): { ok: true; value: ProviderKeyStore } | { ok: false; reason: string } {
  return parseProviderKeyStore(raw, true);
}

function parseProviderKeyStore(raw: unknown, registeredOnly: boolean): ReturnType<typeof validateProviderKeyStore> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "不是对象" };
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return { ok: false, reason: "version 必须 = 1" };
  if (typeof r.keys !== "object" || r.keys === null || Array.isArray(r.keys)) return { ok: false, reason: "keys 缺失或不是对象" };
  const unknown = Object.keys(r).filter((k) => k !== "version" && k !== "keys");
  if (unknown.length > 0) return { ok: false, reason: "未知字段：" + unknown.join("、") };
  const keys: ProviderKeyStore["keys"] = {};
  for (const [id, v] of Object.entries(r.keys as Record<string, unknown>)) {
    const persistedCustom = !registeredOnly && PROVIDER_ID_RE.test(id) && !(RESERVED_PROVIDER_IDS as readonly string[]).includes(id);
    if (!isProviderId(id) && !persistedCustom) return { ok: false, reason: "未知 provider id：" + id };
    if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, reason: "keys[" + id + "] 不是对象" };
    const e = v as Record<string, unknown>;
    const uk = Object.keys(e).filter((k) => k !== "ciphertext" && k !== "updatedAt" && k !== "route");
    if (uk.length > 0) return { ok: false, reason: "keys[" + id + "] 未知字段：" + uk.join("、") };
    if (typeof e.ciphertext !== "string" || e.ciphertext === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)
      || Buffer.from(e.ciphertext, "base64").toString("base64") !== e.ciphertext) {
      return { ok: false, reason: "keys[" + id + "].ciphertext 不是 base64 密文" };
    }
    if (typeof e.updatedAt !== "string" || Number.isNaN(Date.parse(e.updatedAt))) {
      return { ok: false, reason: "keys[" + id + "].updatedAt 不是可解析时间" };
    }
    if (e.route !== undefined && (typeof e.route !== "string" || !/^[0-9a-f]{64}$/.test(e.route))) {
      return { ok: false, reason: "keys[" + id + "].route 格式无效" };
    }
    keys[id] = { ciphertext: e.ciphertext, updatedAt: e.updatedAt, ...(e.route === undefined ? {} : { route: e.route }) };
  }
  return { ok: true, value: { version: 1, keys } };
}

export function isProviderId(v: string): v is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(v) || isCustomProviderId(v);
}

/** 自定义 provider 的 id 也能存钥匙（S7）。判据是「**已装上**」—— 与路由面同一份注册表。
 *
 *  2026-10-06 实测踩到的坑与正解：设置页表单原本「先存钥匙、再写配置」，而配置写完才算装上
 *  ⇒ 首次添加一家必然在第一步被拒（报「未知 provider」），用户看到的现象是「点了保存没有回音」。
 *  当时的第一个修法是把判据放宽成「形状合法即可」，但那是**把保险柜变成来者不拒**——
 *  本仓既有判据明写「未知 id 拒收」，那条是对的，该改的是顺序而不是判据。
 *  正解：表单先把这一家装进运行期注册表（可逆），再存钥匙，最后落盘配置。
 */
function isCustomProviderId(v: string): boolean {
  return customEnvKeyedProviders().includes(v);
}


export function customProviderKeyRoute(provider: DerivedCustomProvider): string {
  return createHash("sha256").update(JSON.stringify([provider.id, provider.protocol, provider.baseURL, provider.apiKeyEnv])).digest("hex");
}

function registeredKeyRoute(id: string): string | undefined {
  const provider = customProviderById(id);
  return provider === undefined ? undefined : customProviderKeyRoute(provider);
}

/** 存一个 provider key；无后端 / 非白名单 provider → fail-closed 拒绝（绝不静默退回明文）。 */
export async function putProviderKey(
  provider: string,
  plaintext: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!backend || !backend.isAvailable()) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };
  if (!isProviderId(provider)) return { ok: false, error: "未知 provider：" + provider + "（白名单：" + PROVIDER_IDS.join("/") + "）" };
  if (plaintext.trim() === "") return { ok: false, error: "key 为空（拒存）" };
  try {
    await backend.set(provider, plaintext, registeredKeyRoute(provider));
    return { ok: true };
  } catch {
    return { ok: false, error: "保存 provider key 失败：请检查安全存储、文件格式与权限；原有配置未被替换" };
  }
}

/** 无后端/未存/解密失败 → null；存储不可读或损坏显式抛错，错误不含密文或明文。 */
export async function getProviderKey(provider: string, route = registeredKeyRoute(provider)): Promise<string | null> {
  if (!backend || !backend.isAvailable() || !isProviderId(provider)) return null;
  return await backend.get(provider, route);
}

/** 删除一个 provider key（用户经设置页显式删除）。 */
export async function deleteProviderKey(provider: string): Promise<{ ok: boolean; error?: string }> {
  if (!backend || !backend.isAvailable()) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };
  try {
    const removed = await backend.delete(provider);
    return removed ? { ok: true } : { ok: false, error: "该 provider 没有已存 key" };
  } catch {
    return { ok: false, error: "删除 provider key 失败：请检查安全存储、文件格式与权限；原有配置未被替换" };
  }
}

/** 状态面（设置页徽标；不含任何 key 值）：stored = 已存 key 的 provider 清单。 */
export async function providerKeyStatus(): Promise<{ available: boolean; stored: string[] }> {
  if (!backend || !backend.isAvailable()) return { available: false, stored: [] };
  return { available: true, stored: await backend.storedProviders() };
}
