// M2g §9.11-2 / §11.8：插件 userConfig 的 **sensitive** 值入 safeStorage，不落明文。
// 底线：headless（无 Electron / safeStorage 不可用）时 **fail-closed 拒绝存敏感值**——
//   绝不静默退回明文（§11.8 信任边界底线）。
// 存储形态：加密后的字节以 base64 落在 <storePath> 的 JSON 里（密文可落盘，明文永不落盘）。
// src/agent/** 不 import electron：Electron 侧经 installSafeStorageBackend 注入 IO（可测可换）。
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import type { UserConfigField } from "./manifest";

/** Electron safeStorage 的最小 IO 面（注入式：headless 与测试可替换）。 */
export interface SafeStorageIo {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(payload: Buffer): string;
}

export interface PluginSecretBackend {
  name: string;
  isAvailable(): boolean;
  set(key: string, plaintext: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

/** safeStorage 落盘占位符：出现在明文配置文件里，绝不含真实值。 */
export const SECRET_PLACEHOLDER = "<sensitive: 值存于 safeStorage，不落明文>";
/** 无安全后端时的拒绝原因（fail-closed，不静默）。 */
export const NO_BACKEND_ERROR = "无安全存储后端（headless 或 safeStorage 不可用）→ 拒存敏感值（fail-closed，不落明文）";

let backend: PluginSecretBackend | null = null;

/** Electron main 侧装配（用 safeStorage 加密，密文落 storePath）。 */
export function installSafeStorageBackend(io: SafeStorageIo, storePath: string): boolean {
  if (!io.isEncryptionAvailable()) return false;
  backend = {
    name: "safeStorage",
    isAvailable: () => io.isEncryptionAvailable(),
    async set(key, plaintext) {
      const store = await readStore(storePath);
      store[key] = io.encryptString(plaintext).toString("base64");
      await writeStore(storePath, store);
    },
    async get(key) {
      const store = await readStore(storePath);
      const v = store[key];
      if (typeof v !== "string") return null;
      try {
        return io.decryptString(Buffer.from(v, "base64"));
      } catch {
        return null; // 解密失败（换机器/换钥匙）→ null，不抛明文
      }
    },
  };
  return true;
}

/** 测试/替身注入；传 null = 回到无后端（fail-closed 路径）。 */
export function setPluginSecretBackend(b: PluginSecretBackend | null): void {
  backend = b;
}

export function pluginSecretBackend(): PluginSecretBackend | null {
  return backend;
}

/** 密文存储键（插件 + 字段名）。 */
export function secretKey(plugin: string, key: string): string {
  return "mcp-userconfig:" + plugin + ":" + key;
}

async function readStore(p: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    /* 无文件 / 坏文件 = 空存储 */
  }
  return {};
}

async function writeStore(p: string, store: Record<string, string>): Promise<void> {
  // 原子写：裸 writeFile 在写中途崩溃会截断密文存储 → 全部插件敏感值不可恢复地丢失。
  await writeFileAtomic(p, JSON.stringify(store, null, 2) + "\n");
}

/** 存一个敏感值；无后端 → fail-closed 拒绝（绝不静默退回明文）。 */
export async function putPluginSecret(
  plugin: string,
  key: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!backend) return { ok: false, error: NO_BACKEND_ERROR };
  await backend.set(secretKey(plugin, key), value);
  return { ok: true };
}

/** 读一个敏感值；无后端/解密失败 → null（不抛，不回显）。 */
export async function getPluginSecret(plugin: string, key: string): Promise<string | null> {
  if (!backend) return null;
  return await backend.get(secretKey(plugin, key));
}

/** userConfig 的落盘文件名（读写两侧共用，别各拼一遍）。 */
export const USER_CONFIG_FILE = "plugin-userconfig.json";

export function pluginUserConfigFile(dir: string): string {
  return dir.endsWith("/") ? dir + USER_CONFIG_FILE : dir + "/" + USER_CONFIG_FILE;
}

/** 产品侧规范目录 = 该插件自己的 PLUGIN_DATA 目录（§9.5 给钩子的 PLUGIN_DATA 同一个）。
 *  选它而不是 `<workspace>/.agent/`：配置文件里可能有非敏感值，而用户仓库会被 git 提交。 */
export function pluginUserConfigDir(pluginDataRoot: string, plugin: string): string {
  return join(pluginDataRoot, plugin);
}

export interface PluginUserConfigRead {
  /** 可直接展开进配置的键 → 值。 */
  values: Record<string, string>;
  /** 值来自 safeStorage 的键：**只许进子进程 env，不许进模型可见内容**（正文/事件流）。 */
  sensitive: string[];
  /** 声明过或被引用但拿不到值的键（没填 / 密文解不开）——调用方要点名出声，不许换成空串。 */
  missing: string[];
}

/** 读一份插件 userConfig（§9.5 的取值面）。
 *  与写入侧同一套规则：sensitive 位永远走 safeStorage，明文文件里那条只有占位符。
 *  文件里的 plugin 与请求的 plugin 不一致 → 当作没有（绝不把 A 插件的配置套到 B 插件上）。 */
export async function readPluginUserConfig(opts: {
  dir: string;
  plugin: string;
  fields: UserConfigField[];
}): Promise<PluginUserConfigRead> {
  const values: Record<string, string> = {};
  const sensitive: string[] = [];
  const missing: string[] = [];
  let file: { plugin?: unknown; config?: unknown; secretKeys?: unknown } | null = null;
  try {
    file = JSON.parse(await readFile(pluginUserConfigFile(opts.dir), "utf8")) as
      { plugin?: unknown; config?: unknown; secretKeys?: unknown };
  } catch {
    file = null; // 没写过 = 全部走 default / missing
  }
  const cfg = file !== null && file.plugin === opts.plugin && file.config && typeof file.config === "object"
    ? file.config as Record<string, unknown> : {};
  const declaredSecrets: unknown[] = file !== null && Array.isArray(file.secretKeys) ? file.secretKeys : [];
  const secretKeys = new Set<string>(declaredSecrets.filter((k): k is string => typeof k === "string"));
  const keys = new Set<string>();
  for (const f of opts.fields) keys.add(f.key);
  for (const k of Object.keys(cfg)) keys.add(k);
  for (const k of secretKeys) keys.add(k);
  for (const key of keys) {
    const field = opts.fields.find((f) => f.key === key);
    if (field?.sensitive === true || secretKeys.has(key)) {
      const v = await getPluginSecret(opts.plugin, key);
      if (v === null) { missing.push(key); continue; } // 无后端 / 换机器解不开 → 出声，不填空串
      values[key] = v;
      if (!sensitive.includes(key)) sensitive.push(key);
      continue;
    }
    const raw = cfg[key];
    if (typeof raw === "string" && raw !== SECRET_PLACEHOLDER) { values[key] = raw; continue; }
    if (typeof raw === "number" || typeof raw === "boolean") { values[key] = String(raw); continue; }
    if (field?.defaultValue !== undefined) { values[key] = field.defaultValue; continue; }
    missing.push(key);
  }
  return { values, sensitive, missing };
}

export interface UserConfigWriteResult {
  ok: boolean;
  error?: string;
  /** 明文落盘的键（非敏感）。 */
  plaintextKeys: string[];
  /** 入 safeStorage 的键（敏感；值不出现在任何落盘产物里）。 */
  secretKeys: string[];
  /** 落盘文件（非敏感值 + 占位符）。 */
  file: string;
}

/** 写一份插件 userConfig：敏感字段进 safeStorage，非敏感字段明文落 .agent/。
 *  任一敏感字段存不进去 → 整体失败（fail-closed，不写半成品明文）。 */
export async function writePluginUserConfig(opts: {
  plugin: string;
  fields: UserConfigField[];
  values: Record<string, string>;
  dir: string;
}): Promise<UserConfigWriteResult> {
  const plaintext: Record<string, string> = {};
  const plaintextKeys: string[] = [];
  const secretKeys: string[] = [];
  for (const f of opts.fields) {
    const v = opts.values[f.key];
    if (v === undefined) continue;
    if (f.sensitive) {
      const r = await putPluginSecret(opts.plugin, f.key, v);
      if (!r.ok) return { ok: false, error: r.error, plaintextKeys, secretKeys, file: "" };
      plaintext[f.key] = SECRET_PLACEHOLDER; // 只有占位符，不含值
      secretKeys.push(f.key);
    } else {
      plaintext[f.key] = v;
      plaintextKeys.push(f.key);
    }
  }
  const file = opts.dir.endsWith("/") ? opts.dir + "plugin-userconfig.json" : opts.dir + "/plugin-userconfig.json";
  await mkdir(opts.dir, { recursive: true });
  await writeFileAtomic(file, JSON.stringify({ plugin: opts.plugin, config: plaintext, secretKeys }, null, 2) + "\n");
  // H4（审查 P1-18）：产品口径审计行（只记插件名/键名/落盘路径，**绝不记值**）——userConfig
  // 写入是用户可见事件，日志可查；这也让验收的日志扫描位有真实捕获对象（不再靠验收脚本手工喂行）。
  console.log("[plugin] userConfig 写入完成：" + JSON.stringify({ plugin: opts.plugin, secretKeys, plaintextKeys, file }));
  return { ok: true, plaintextKeys, secretKeys, file };
}
