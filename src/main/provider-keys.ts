// M4b §2.1：provider key（BYOK）入 safeStorage（平台原生加密），密文 base64 落
// <appData>/provider-keys.json —— **明文零落盘**（落盘/日志/事件流三处纪律）。
// 复用 src/agent/plugins/secrets.ts 的 fail-closed 纪律：safeStorage 不可用 → **拒绝保存** +
// 显式错误，绝不静默退回明文。Electron main 侧经 installProviderKeyBackend 注入 IO（headless/测试可换）。
// 应用启动时解密注入 provider 配置（process.env.M0_API_KEY，进程内；env 已在 = 优先，零行为）。
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../atomic-write";
import type { SafeStorageIo } from "../agent/plugins/secrets";
import { ENV_KEYED_PROVIDERS, type EnvKeyedProvider } from "../providers/env-keys";

export type { SafeStorageIo };

/** 密文存储 schema（Provider 管理面；commercial-check E 段判卷）。
 *  { version: 1, keys: { <providerId>: { ciphertext: base64, updatedAt: ISO } } } */
export interface ProviderKeyStore {
  version: 1;
  keys: Record<string, { ciphertext: string; updatedAt: string }>;
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
  set(provider: string, plaintext: string): Promise<void>;
  get(provider: string): Promise<string | null>;
  delete(provider: string): Promise<boolean>;
  storedProviders(): Promise<string[]>;
}

let backend: ProviderKeyBackend | null = null;

/** Electron main 侧装配：safeStorage 加密，密文落 storePath（不可用 → 返回 false，不注入后端）。 */
export function installProviderKeyBackend(io: SafeStorageIo, storePath: string): boolean {
  if (!io.isEncryptionAvailable()) return false;
  backend = {
    name: "safeStorage",
    isAvailable: () => io.isEncryptionAvailable(),
    async set(provider, plaintext) {
      const store = await readStore(storePath);
      store.keys[provider] = { ciphertext: io.encryptString(plaintext).toString("base64"), updatedAt: new Date().toISOString() };
      await writeStore(storePath, store);
    },
    async get(provider) {
      const store = await readStore(storePath);
      const v = store.keys[provider];
      if (!v || typeof v.ciphertext !== "string") return null;
      try {
        return io.decryptString(Buffer.from(v.ciphertext, "base64"));
      } catch {
        return null; // 解密失败（换机器/换钥匙）→ null，不抛明文
      }
    },
    async delete(provider) {
      const store = await readStore(storePath);
      if (!(provider in store.keys)) return false;
      delete store.keys[provider];
      await writeStore(storePath, store);
      return true;
    },
    async storedProviders() {
      return Object.keys((await readStore(storePath)).keys).sort();
    },
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
  try {
    const parsed = JSON.parse(await readFile(p, "utf8")) as unknown;
    const v = validateProviderKeyStore(parsed);
    if (v.ok) return v.value;
  } catch {
    /* 无文件 / 坏文件 = 空存储 */
  }
  return { version: 1, keys: {} };
}

async function writeStore(p: string, store: ProviderKeyStore): Promise<void> {
  await writeFileAtomic(p, JSON.stringify(store, null, 2) + "\n");
}

/** 严格 schema 校验（commercial-check「Provider 管理 schema」判卷面）：未知字段拒绝 / ciphertext 须 base64 /
 *  updatedAt 须可解析 ISO / version 恒 1。返回 {ok:false, reason} 而非抛异常（fail-visible）。 */
export function validateProviderKeyStore(raw: unknown): { ok: true; value: ProviderKeyStore } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "不是对象" };
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return { ok: false, reason: "version 必须 = 1" };
  if (typeof r.keys !== "object" || r.keys === null) return { ok: false, reason: "keys 缺失" };
  const unknown = Object.keys(r).filter((k) => k !== "version" && k !== "keys");
  if (unknown.length > 0) return { ok: false, reason: "未知字段：" + unknown.join("、") };
  const keys: ProviderKeyStore["keys"] = {};
  for (const [id, v] of Object.entries(r.keys as Record<string, unknown>)) {
    if (!isProviderId(id)) return { ok: false, reason: "未知 provider id：" + id };
    if (typeof v !== "object" || v === null) return { ok: false, reason: "keys[" + id + "] 不是对象" };
    const e = v as Record<string, unknown>;
    const uk = Object.keys(e).filter((k) => k !== "ciphertext" && k !== "updatedAt");
    if (uk.length > 0) return { ok: false, reason: "keys[" + id + "] 未知字段：" + uk.join("、") };
    if (typeof e.ciphertext !== "string" || e.ciphertext === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)) {
      return { ok: false, reason: "keys[" + id + "].ciphertext 不是 base64 密文" };
    }
    if (typeof e.updatedAt !== "string" || Number.isNaN(Date.parse(e.updatedAt))) {
      return { ok: false, reason: "keys[" + id + "].updatedAt 不是可解析时间" };
    }
    keys[id] = { ciphertext: e.ciphertext, updatedAt: e.updatedAt };
  }
  return { ok: true, value: { version: 1, keys } };
}

export function isProviderId(v: string): v is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(v);
}

/** 存一个 provider key；无后端 / 非白名单 provider → fail-closed 拒绝（绝不静默退回明文）。 */
export async function putProviderKey(
  provider: string,
  plaintext: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!backend) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };
  if (!isProviderId(provider)) return { ok: false, error: "未知 provider：" + provider + "（白名单：" + PROVIDER_IDS.join("/") + "）" };
  if (plaintext.trim() === "") return { ok: false, error: "key 为空（拒存）" };
  await backend.set(provider, plaintext);
  return { ok: true };
}

/** 读一个 provider key；无后端/未存/解密失败 → null（不抛，不回显）。 */
export async function getProviderKey(provider: string): Promise<string | null> {
  if (!backend) return null;
  return await backend.get(provider);
}

/** 删除一个 provider key（用户经设置页显式删除）。 */
export async function deleteProviderKey(provider: string): Promise<{ ok: boolean; error?: string }> {
  if (!backend) return { ok: false, error: PROVIDER_KEY_NO_BACKEND_ERROR };
  const removed = await backend.delete(provider);
  return removed ? { ok: true } : { ok: false, error: "该 provider 没有已存 key" };
}

/** 状态面（设置页徽标；不含任何 key 值）：stored = 已存 key 的 provider 清单。 */
export async function providerKeyStatus(): Promise<{ available: boolean; stored: string[] }> {
  if (!backend || !backend.isAvailable()) return { available: false, stored: [] };
  return { available: true, stored: await backend.storedProviders() };
}
