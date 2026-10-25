// 工作区搜索表单：非敏感配置原子写回既有 config.json；密钥复用已装配的 safeStorage 后端。
// 不缓存工作区、不开页出网；main 只传可信窗口上下文解析出的根。
import { readFile } from "node:fs/promises";
import { projectAgentPath } from "../app-data";
import { writeFileAtomic } from "../atomic-write";
import { getPluginSecret, pluginSecretBackend, putPluginSecret } from "../agent/plugins/secrets";
import { assertRealContainment, resolveWriteTarget } from "../tools/base";
import {
  makeWebSearch, parseSearchConfig, searchApiKey, searchKeyEnv, searchSecretId,
  type SearchConfig, type SearchProvider, type WebSearchDeps,
} from "../tools/web-search";
import type { SearchSettingsInput, SearchSettingsSaveResult, SearchSettingsSnapshot, SearchSettingsTestResult } from "./ipc-protocol";

const SECRET_OWNER = "web-search";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isProvider = (v: unknown): v is SearchProvider => ["searxng", "brave", "tavily", "custom"].includes(String(v));
const message = (error: unknown): string => error instanceof SettingsError ? error.message : "搜索设置操作失败，请检查文件权限或系统安全存储后重试";
class SettingsError extends Error {}

async function readDocument(workspace: string): Promise<Record<string, unknown>> {
  const path = projectAgentPath(workspace, "config.json");
  await assertRealContainment(workspace, path, "search settings");
  let text: string;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SettingsError("搜索配置 JSON 损坏，请先修复 .agent/config.json；原文件未覆盖"); }
  if (!isObject(value)) throw new SettingsError(".agent/config.json 须是 JSON 对象；原文件未覆盖");
  return value;
}

/** 只校验结构和 URL，不解析 DNS、不请求端点。网络边界由实际检索的既有闸执行。 */
function normalize(input: SearchSettingsInput): SearchConfig {
  if (!isObject(input) || typeof input.enabled !== "boolean" || !isProvider(input.provider) ||
    typeof input.endpoint !== "string" || typeof input.allowLocalEndpoint !== "boolean" ||
    (input.clearApiKey !== undefined && typeof input.clearApiKey !== "boolean") ||
    (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 4096 || /[\r\n]/u.test(input.apiKey)))) {
    throw new SettingsError("搜索设置格式无效，请重新选择服务并填写地址");
  }
  const cfg = parseSearchConfig({ ...input, enabled: true });
  if (cfg === null) {
    if (!input.enabled && input.endpoint.trim() === "" && !input.apiKey?.trim()) return { provider: input.provider, endpoint: "", ...(input.allowLocalEndpoint ? { allowLocalEndpoint: true } : {}) };
    throw new SettingsError("请填写搜索服务的 HTTP(S) 地址");
  }
  if (cfg.endpoint.length > 4096) throw new SettingsError("搜索服务地址过长");
  let url: URL;
  try { url = new URL(cfg.endpoint); } catch { throw new SettingsError("搜索服务地址无效，请填写完整的 HTTP(S) 地址"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new SettingsError("搜索服务地址仅支持 HTTP(S)");
  if (url.username || url.password) throw new SettingsError("服务地址不能含用户名或密码；请使用 API Key 输入框");
  for (const name of url.searchParams.keys()) {
    if (/^(?:api[-_]?key|key|(?:access[-_]?)?token|authorization|password|secret)$/iu.test(name)) {
      throw new SettingsError("服务地址不能含密钥参数；请将密钥填入 API Key 输入框");
    }
  }
  url.hash = "";
  return { ...cfg, endpoint: url.href.replaceAll("%7Bquery%7D", "{query}") };
}

export async function getSearchSettings(workspace: string): Promise<SearchSettingsSnapshot> {
  const base: SearchSettingsSnapshot = {
    workspace, enabled: false, provider: "searxng", endpoint: "", allowLocalEndpoint: false,
    hasKey: false, keySource: "none", secureStorageAvailable: pluginSecretBackend()?.isAvailable() === true,
  };
  try {
    const doc = await readDocument(workspace);
    if (doc.search === undefined) return base;
    if (!isObject(doc.search)) throw new SettingsError("现有 search 配置格式无效，请重新填写搜索设置");
    const raw = doc.search;
    const provider = raw.provider === undefined ? "custom" : raw.provider;
    if (!isProvider(provider)) throw new SettingsError("现有搜索服务类型无法识别，请重新选择服务");
    const enabled = raw.enabled !== false;
    const cfg = normalize({ enabled, provider, endpoint: typeof raw.endpoint === "string" ? raw.endpoint : "", allowLocalEndpoint: raw.allowLocalEndpoint === true });
    // 不完整的旧配置不冒充可用配置。
    const configured = parseSearchConfig(raw) !== null;
    const env = process.env[searchKeyEnv(provider)]?.trim();
    const stored = !env && cfg.endpoint !== "" ? await getPluginSecret(SECRET_OWNER, searchSecretId(workspace, cfg)) : null;
    let keySource: SearchSettingsSnapshot["keySource"] = "none";
    if (stored) keySource = "stored";
    if (env) keySource = "environment";
    return { ...base, enabled: enabled && configured, provider, endpoint: cfg.endpoint,
      allowLocalEndpoint: cfg.allowLocalEndpoint === true, hasKey: Boolean(env || stored),
      keySource };
  } catch (error) { return { ...base, error: message(error) }; }
}

export async function saveSearchSettings(workspace: string, input: SearchSettingsInput): Promise<SearchSettingsSaveResult> {
  try {
    const cfg = normalize(input);
    // 坏 JSON 先拒绝，防止先存凭据再发现配置不能写。
    await readDocument(workspace);
    const id = searchSecretId(workspace, cfg);
    const changeKey = input.clearApiKey === true || Boolean(input.apiKey?.trim());
    let previous: string | null = null;
    if (changeKey) {
      if (pluginSecretBackend()?.isAvailable() !== true) throw new SettingsError("系统安全存储不可用，无法保存或清除 API Key；不会保存明文密钥");
      previous = await getPluginSecret(SECRET_OWNER, id);
      try {
        const r = await putPluginSecret(SECRET_OWNER, id, input.clearApiKey === true ? "" : input.apiKey!.trim());
        if (!r.ok) throw new Error("secure key save rejected");
      } catch { throw new SettingsError("API Key 安全保存失败，请解锁系统钥匙串后重试；配置未更改"); }
    }
    try {
      // 密钥存取可能异步等待系统：重新读，保留这期间更新的其他配置字段。
      const doc = await readDocument(workspace);
      const existing = isObject(doc.search) ? doc.search : {};
      doc.search = { ...existing, ...cfg, enabled: input.enabled, allowLocalEndpoint: input.allowLocalEndpoint };
      const path = await resolveWriteTarget(workspace, projectAgentPath(workspace, "config.json"), "search settings");
      await writeFileAtomic(path, JSON.stringify(doc, null, 2) + "\n");
    } catch (error) {
      if (changeKey) await putPluginSecret(SECRET_OWNER, id, previous ?? "").catch(() => undefined);
      throw error;
    }
    return { ok: true, settings: await getSearchSettings(workspace) };
  } catch (error) { return { ok: false, error: message(error) }; }
}

/** 显式调用才有一次真实 query；不会为了验证先请求 /health 或 /models。 */
export async function testSearchSettings(workspace: string, input?: SearchSettingsInput, deps: WebSearchDeps = {}): Promise<SearchSettingsTestResult> {
  const started = performance.now();
  const result = (ok: boolean, resultCount: number, error?: string): SearchSettingsTestResult => ({ ok, elapsedMs: Math.round(performance.now() - started), resultCount, ...(error ? { error } : {}) });
  try {
    let cfg: SearchConfig | null;
    if (input !== undefined) {
      cfg = normalize(input);
      if (!input.enabled) throw new SettingsError("请先启用联网搜索，再测试连接");
    } else {
      const doc = await readDocument(workspace);
      cfg = parseSearchConfig(doc.search);
    }
    if (cfg === null) throw new SettingsError("请先选择搜索服务并填写服务地址");
    const key = input?.clearApiKey === true ? null : input?.apiKey?.trim() || await searchApiKey(workspace, cfg);
    let count = 0;
    const tool = makeWebSearch({ ...deps, config: cfg, apiKey: key, requireResults: true, onResults: (n) => { count = n; } });
    const response = await tool.run({ query: "Cairn search connection test" }, { workspace });
    return response.ok ? result(true, count) : result(false, 0, key ? response.output.replaceAll(key, "[redacted]") : response.output);
  } catch (error) { return result(false, 0, message(error)); }
}
