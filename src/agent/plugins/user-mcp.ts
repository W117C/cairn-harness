// 用户级 MCP 服务器（ZCode 的独立 MCP 管理对应面，2026-11-05 业主裁「参考开源项目 ZCode」）。
// 单一事实源 = <appData>/mcp.json（顶层 mcpServers —— Claude / ZCode / Codex 生态同款格式）。
// 发现期把它合成一支**虚拟插件**（user-mcp，user 作用域、恒 trusted）进同一套运行时：
// 激活流（mcp_list / mcp_activate）、权限门、工具命名（mcp__plugin_user-mcp_<server>__<tool>）、
// 面板 summaries 与禁用开关全部零改动复用——不造第二套连接/激活/门控。
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { normalizeMcp } from "./manifest";
import type { DiscoveredPlugin, McpServerConfig } from "./types";

/** 虚拟插件名：工具命名与面板里它就是这一支（mcp__plugin_user-mcp_<server>__<tool>）。 */
export const USER_MCP_PLUGIN_NAME = "user-mcp";

/** 用户级 mcp.json 的落点：appData 根，与 plugins/ 同层。 */
export function userMcpConfigPathOf(pluginDataRoot: string): string {
  return join(pluginDataRoot, "mcp.json");
}

/** 用户级 hooks.json 的落点（同层；hooks.json 形态与插件 hooks/ 同一门方言）。 */
export const USER_HOOKS_PLUGIN_NAME = "user-hooks";
export function userHooksConfigPathOf(pluginDataRoot: string): string {
  return join(pluginDataRoot, "hooks.json");
}

/** 字符串记录（env/headers）：键非空、值必须是字符串（数字/布尔 = 配置写错，明说而不是 String() 偷换）。 */
function stringRecord(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") return undefined;
    out[k] = v;
  }
  return out;
}

/** 字符串数组（args/includeTools/excludeTools）：全字符串数组才收，混型 = 配置写错。 */
function stringList(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) return undefined;
  return raw as string[];
}

/** 单台校验（纯函数判卷出口）：stdio 必须带 command；http/sse 必须带 http(s) URL；
 *  args/env/headers/include/exclude/disabled 逐字段查型。返回规范化配置或一句能落设置面的错误。 */
export function validateUserMcpServer(raw: unknown): { ok: true; config: McpServerConfig } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "配置必须是对象（command 或 url）" };
  }
  const cfg = raw as Record<string, unknown>;
  const hasCommand = typeof cfg.command === "string" && cfg.command.trim() !== "";
  const hasUrl = typeof cfg.url === "string" && cfg.url.trim() !== "";
  if (!hasCommand && !hasUrl) return { ok: false, error: "缺 command（stdio）或 url（http/sse）" };
  const type: McpServerConfig["type"] = hasCommand ? "stdio" : (typeof cfg.type === "string" && cfg.type === "sse" ? "sse" : "http");
  if (hasCommand && cfg.url !== undefined) return { ok: false, error: "command 与 url 二选一，不要同时给" };
  if (hasUrl) {
    try {
      const u = new URL(cfg.url as string);
      if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "url 只允许 http/https" };
    } catch {
      return { ok: false, error: "url 不是合法地址" };
    }
  }
  const args = stringList(cfg.args);
  if (cfg.args !== undefined && args === undefined) return { ok: false, error: "args 必须是字符串数组" };
  const env = stringRecord(cfg.env);
  if (cfg.env !== undefined && env === undefined) return { ok: false, error: "env 必须是字符串键值表" };
  const headers = stringRecord(cfg.headers);
  if (cfg.headers !== undefined && headers === undefined) return { ok: false, error: "headers 必须是字符串键值表" };
  const includeTools = stringList(cfg.includeTools);
  if (cfg.includeTools !== undefined && includeTools === undefined) return { ok: false, error: "includeTools 必须是字符串数组" };
  const excludeTools = stringList(cfg.excludeTools);
  if (cfg.excludeTools !== undefined && excludeTools === undefined) return { ok: false, error: "excludeTools 必须是字符串数组" };
  const disabled = cfg.disabled === undefined ? undefined : typeof cfg.disabled === "boolean" ? cfg.disabled : undefined;
  if (cfg.disabled !== undefined && disabled === undefined) return { ok: false, error: "disabled 必须是布尔" };
  const resolved: McpServerConfig = {
    ...(hasCommand ? { command: (cfg.command as string).trim() } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(hasUrl ? { url: (cfg.url as string).trim(), type } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(includeTools !== undefined ? { includeTools } : {}),
    ...(excludeTools !== undefined ? { excludeTools } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
  };
  return { ok: true, config: resolved };
}

/** 解析整份用户级配置（发现期口子；单台失败隔离——坏一台跳一台，不拖垮其它 server）。
 *  容错面：非对象 / 非法 JSON 由读盘层兜住，这里只管「对象里每台 server」的形状。 */
export function parseUserMcpConfig(raw: unknown): {
  servers: { name: string; config: McpServerConfig }[];
  errors: string[];
  warnings: string[];
} {
  const servers: { name: string; config: McpServerConfig }[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { servers, errors: ["mcp.json 顶层必须是 { \"mcpServers\": { … } } 对象"], warnings };
  }
  const root = raw as Record<string, unknown>;
  const table = root.mcpServers;
  if (table === undefined) return { servers, errors: [], warnings }; // 空文件 = 零服务器（合法）
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    return { servers, errors: ["mcpServers 必须是对象"], warnings };
  }
  for (const [name, rawConfig] of Object.entries(table as Record<string, unknown>)) {
    if (name.trim() === "") continue;
    const v = validateUserMcpServer(rawConfig);
    if (!v.ok) {
      errors.push(`${name}：${v.error}`);
      continue;
    }
    servers.push({ name, config: v.config });
  }
  return { servers, errors, warnings };
}

/** 读盘（缺文件 = 零服务器，不是错误；坏 JSON = 一句错误，不抛）。 */
export async function readUserMcpConfig(path: string): Promise<{
  servers: { name: string; config: McpServerConfig }[];
  errors: string[];
  warnings: string[];
}> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return { servers: [], errors: [], warnings: [] };
    return { servers: [], errors: [`mcp.json 读不了：${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { servers: [], errors: [`mcp.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
  return parseUserMcpConfig(parsed);
}

/** 发现期合成虚拟插件（与容器插件同形状；manifest 只带 mcpServers，fingerprint 留空——
 *  user 作用域恒 trusted、永不走信任决议，指纹不会被消费）。 */
export function virtualUserMcpPlugin(root: string, servers: readonly { name: string; config: McpServerConfig }[]): DiscoveredPlugin {
  return {
    name: USER_MCP_PLUGIN_NAME,
    scope: "user",
    root,
    manifest: { name: USER_MCP_PLUGIN_NAME, mcpServers: Object.fromEntries(servers.map((s) => [s.name, s.config])) },
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    mcp: servers.map((s) => ({ serverName: s.name, config: s.config })),
    lsp: {},
    unknownFields: [],
    userConfigFields: [],
    errors: [],
    warnings: [],
    trust: "trusted",
  };
}
