import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { McpServerConfig } from "../../../../src/agent/plugins/types";
import { validateUserMcpServer } from "../../../../src/agent/plugins/user-mcp";
import type {
  SettingsMigrationItem,
  SettingsMigrationPreview,
  SettingsMigrationResult,
  SettingsMigrationSource,
} from "../../../../src/main/ipc-protocol";
import { CUSTOM_INSTRUCTIONS_MAX_BYTES } from "../../../../src/main/settings";

type McpImport = { name: string; config: McpServerConfig };
type Importable =
  | { kind: "instructions"; content: string }
  | { kind: "mcp"; server: McpImport };
type Entry = { item: SettingsMigrationItem; value?: Importable };

interface MigrationDependencies {
  pickFiles(source: SettingsMigrationSource): Promise<string[] | null>;
  getInstructions(): Promise<string>;
  importInstructions(content: string): Promise<boolean>;
  listMcpNames(): Promise<string[]>;
  importMcp(servers: readonly McpImport[]): Promise<string[]>;
}

const MAX_FILES = 12;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MCP_SERVERS = 256;
const PREVIEW_LIFETIME_MS = 15 * 60 * 1000;

const sourceFiles = {
  "claude-code": new Set(["CLAUDE.md", ".claude.json", ".mcp.json", "settings.json", "settings.local.json", "hooks.json"]),
  codex: new Set(["AGENTS.md", "AGENTS.override.md", "config.toml", "hooks.json"]),
};
const claudeMcpPolicy = [
  "permissions", "allowedMcpServers", "deniedMcpServers", "managedMcpServers",
  "allowManagedMcpServersOnly", "enabledMcpjsonServers", "disabledMcpjsonServers",
];

function record(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const proto = Object.getPrototypeOf(raw);
  return proto === null || proto === Object.prototype ? raw as Record<string, unknown> : undefined;
}

function row(name: string, kind: SettingsMigrationItem["kind"], status: SettingsMigrationItem["status"], detail: string): Entry {
  return { item: { id: randomUUID(), name, kind, status, detail } };
}

async function readSource(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Unsupported file");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_FILE_BYTES) throw new Error("File too large");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}

const commonFields = ["command", "args", "url", "env"];
const claudeFields = new Set([...commonFields, "type", "headers"]);
const codexFields = new Set([...commonFields, "enabled", "enabled_tools", "disabled_tools", "http_headers"]);
const secretArgument = /^(?:--?(?:api[-_]?key|access[-_]?token|token|password|passwd|secret|authorization|header)(?:=|$)|-H|--?user(?:=|$))|(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION)=/i;

function compatibleServer(source: SettingsMigrationSource, raw: unknown): McpServerConfig | string {
  const cfg = record(raw);
  if (!cfg) return "MCP 条目必须是配置对象";
  const codex = source === "codex";
  const knownFields = codex ? codexFields : claudeFields;
  if (Object.keys(cfg).some((key) => !knownFields.has(key))) {
    return "含 Cairn 无法保留的认证、权限、工作目录或运行参数";
  }
  for (const key of ["env", "headers", "http_headers"]) {
    if (cfg[key] === undefined) continue;
    const values = record(cfg[key]);
    if (!values || Object.keys(values).length > 0) {
      return "包含环境变量或请求头，请在 Cairn 中手动配置";
    }
  }
  const command = typeof cfg.command === "string" && cfg.command.trim() !== "" ? cfg.command : undefined;
  const endpoint = typeof cfg.url === "string" && cfg.url.trim() !== "" ? cfg.url : undefined;
  if ((command === undefined && endpoint === undefined) || (command !== undefined && cfg.url !== undefined)
      || (endpoint !== undefined && (cfg.command !== undefined || cfg.args !== undefined))) {
    return "请选择命令型或 HTTP 型 MCP，且只提供对应字段";
  }
  if (cfg.type !== undefined && !(command !== undefined ? cfg.type === "stdio" : cfg.type === "http" || cfg.type === "sse")) {
    return "传输类型与 Cairn 的 MCP 配置不兼容";
  }
  if (cfg.enabled !== undefined && typeof cfg.enabled !== "boolean") return "启用状态格式无效";
  if (Array.isArray(cfg.enabled_tools) && cfg.enabled_tools.length === 0) {
    return "空工具允许列表无法安全转换";
  }
  if (endpoint !== undefined) {
    try {
      const url = new URL(endpoint);
      if (url.username || url.password || url.search || url.hash || /\$\{/.test(endpoint)) {
        return "URL 包含凭据、查询参数、片段或变量引用";
      }
    } catch {
      return "MCP URL 无效";
    }
  } else if (
    (command !== undefined && /\$\{/.test(command))
    || (Array.isArray(cfg.args) && cfg.args.some((arg) => typeof arg === "string" && (
      secretArgument.test(arg) || /\$\{|:\/\/[^/\s]*@|[?&](?:api[_-]?key|token|password|secret)=/i.test(arg)
    )))
  ) {
    return "命令或参数包含凭据标记或变量引用";
  }
  const validated = validateUserMcpServer({
    command: cfg.command,
    args: cfg.args,
    url: cfg.url,
    type: cfg.type,
    includeTools: cfg.enabled_tools,
    excludeTools: cfg.disabled_tools,
    disabled: true,
  });
  return validated.ok ? validated.config : validated.error;
}

function makeMcpEntries(source: SettingsMigrationSource, raw: unknown): Entry[] {
  const servers = record(raw);
  if (!servers) return [row("MCP 服务器", "unsupported", "unsupported", "MCP 服务器列表格式无效")];
  const names = Object.keys(servers);
  if (names.length > MAX_MCP_SERVERS) {
    return [row("MCP 服务器", "unsupported", "skipped", `单个文件最多支持 ${MAX_MCP_SERVERS} 台服务器`)];
  }
  const rows: Entry[] = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || ["__proto__", "prototype", "constructor"].includes(name)) {
      rows.push(row("MCP 服务器", "mcp", "unsupported", "服务器名称无法安全导入"));
      continue;
    }
    const config = compatibleServer(source, servers[name]);
    if (typeof config === "string") {
      rows.push(row(name, "mcp", "unsupported", config));
      continue;
    }
    const entry = row(name, "mcp", "ready", "以禁用状态导入到用户级 MCP");
    rows.push({ ...entry, value: { kind: "mcp", server: { name, config } } });
  }
  return rows;
}

function appendConfigEntries(source: SettingsMigrationSource, config: Record<string, unknown>, rows: Entry[]): boolean {
  const mcpKey = source === "codex" ? "mcp_servers" : "mcpServers";
  const hasHooks = Object.hasOwn(config, "hooks");
  if (hasHooks) rows.push(row("Hooks", "unsupported", "unsupported", "迁移不支持 Hooks 的运行语义"));
  const hasPolicy = source === "claude-code" && claudeMcpPolicy.some((key) => Object.hasOwn(config, key));
  if (hasPolicy) rows.push(row("MCP 权限", "unsupported", "unsupported", "来源权限规则无法迁移"));
  if (Object.hasOwn(config, mcpKey)) rows.push(...makeMcpEntries(source, config[mcpKey]));
  if (Object.keys(config).some((key) => key !== mcpKey && key !== "hooks" && !claudeMcpPolicy.includes(key))) {
    rows.push(row("其他设置", "unsupported", "unsupported", "其余设置、凭据及项目配置不参与迁移"));
  }
  return hasPolicy;
}

function block(entry: Entry, status: "skipped" | "collision" | "unsupported", detail: string): void {
  entry.item.status = status;
  entry.item.detail = detail;
  delete entry.value;
}

export class SettingsMigration {
  #pending?: { id: string; expires: number; entries: Entry[] };
  #previewing = false;

  constructor(private readonly deps: MigrationDependencies) {}

  async preview(source: SettingsMigrationSource): Promise<SettingsMigrationPreview | null> {
    if (source !== "claude-code" && source !== "codex") throw new Error("不支持的迁移来源");
    if (this.#previewing) throw new Error("正在准备迁移预览");
    this.#pending = undefined;
    this.#previewing = true;
    try {
      return await this.prepare(source);
    } finally {
      this.#previewing = false;
    }
  }

  private async prepare(source: SettingsMigrationSource): Promise<SettingsMigrationPreview | null> {
    const files = await this.deps.pickFiles(source);
    if (!files?.length) return null;
    if (files.length > MAX_FILES) throw new Error(`一次最多选择 ${MAX_FILES} 个来源文件`);
    const rows: Entry[] = [];
    let hasMcpPolicy = false;
    for (const path of new Set(files)) {
      const name = basename(path);
      if (!sourceFiles[source].has(name)) {
        rows.push(row("所选文件", "unsupported", "unsupported", "文件名与当前迁移来源不匹配"));
        continue;
      }
      if (name === "hooks.json") {
        rows.push(row("Hooks", "unsupported", "unsupported", "迁移不支持 Hooks 的运行语义"));
        continue;
      }
      try {
        const content = await readSource(path);
        if (name.endsWith(".md")) {
          if (content.trim() === "" || Buffer.byteLength(content) > CUSTOM_INSTRUCTIONS_MAX_BYTES) {
            rows.push(row(name, "instructions", "skipped", "自定义指令为空或超过 12,000 字节"));
            continue;
          }
          const entry = row(name, "instructions", "ready", "保存为 Cairn 用户级自定义指令");
          rows.push({ ...entry, value: { kind: "instructions", content } });
          continue;
        }
        const config = record(source === "codex" ? parseToml(content) : JSON.parse(content));
        if (!config) throw new Error("Invalid configuration");
        const countBefore = rows.length;
        hasMcpPolicy = appendConfigEntries(source, config, rows) || hasMcpPolicy;
        if (rows.length === countBefore) rows.push(row(name, "unsupported", "skipped", "文件中没有可预览的迁移项"));
      } catch {
        rows.push(row(name, "unsupported", "skipped", "无法读取或解析文件（仅支持 2 MiB 以内的普通 UTF-8 文件）"));
      }
    }

    const [mcpNames, instructions] = await Promise.allSettled([
      rows.some((entry) => entry.value?.kind === "mcp") ? this.deps.listMcpNames() : [],
      rows.some((entry) => entry.value?.kind === "instructions") ? this.deps.getInstructions() : "",
    ]);
    const names = new Set(mcpNames.status === "fulfilled" ? mcpNames.value : []);
    const existingInstructions = instructions.status === "fulfilled" && instructions.value.trim() !== "";
    const hasOverride = rows.some((entry) => entry.item.name === "AGENTS.override.md");
    const candidateCounts = new Map<string, number>();
    for (const { item } of rows) {
      if (item.kind === "mcp" || item.kind === "instructions") {
        candidateCounts.set(item.name, (candidateCounts.get(item.name) ?? 0) + 1);
      }
    }
    for (const entry of rows) {
      if (entry.value?.kind === "mcp") {
        if (hasMcpPolicy) block(entry, "unsupported", "所选文件含有无法迁移的 MCP 权限规则");
        else if (mcpNames.status === "rejected") block(entry, "skipped", "无法读取现有 MCP 配置，请修复后重新预览");
        else if (names.has(entry.value.server.name)) block(entry, "collision", "Cairn 已有同名 MCP 服务器");
        else if ((candidateCounts.get(entry.value.server.name) ?? 0) > 1) block(entry, "collision", "来源文件中有同名 MCP 服务器");
      } else if (entry.value?.kind === "instructions") {
        if (hasOverride && entry.item.name === "AGENTS.md") block(entry, "skipped", "已选择优先级更高的 AGENTS.override.md");
        else if (instructions.status === "rejected") block(entry, "skipped", "无法读取现有自定义指令");
        else if (existingInstructions) block(entry, "collision", "Cairn 已有用户级自定义指令");
        else if ((candidateCounts.get(entry.item.name) ?? 0) > 1) block(entry, "collision", "选择了多个同名指令文件");
      }
    }

    const id = randomUUID();
    this.#pending = { id, expires: Date.now() + PREVIEW_LIFETIME_MS, entries: rows };
    return { id, items: rows.map(({ item }) => ({ ...item })) };
  }

  async apply(previewId: string, itemIds: string[]): Promise<SettingsMigrationResult> {
    const pending = this.#pending;
    if (pending && pending.expires <= Date.now()) this.#pending = undefined;
    if (!pending || pending.id !== previewId || this.#pending === undefined) {
      throw new Error("迁移预览已失效，请重新预览");
    }
    if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > pending.entries.length) {
      throw new Error("请选择有效的迁移项");
    }
    const byId = new Map(pending.entries.map((entry) => [entry.item.id, entry.value]));
    const instructions: Array<{ id: string; content: string }> = [];
    const servers: Array<{ id: string; server: McpImport }> = [];
    for (const id of new Set(itemIds)) {
      const value = byId.get(id);
      if (!value) throw new Error("请选择有效的迁移项");
      if (value.kind === "instructions") instructions.push({ id, content: value.content });
      else servers.push({ id, server: value.server });
    }
    this.#pending = undefined;

    const result: SettingsMigrationResult = { imported: [], skipped: [] };
    for (const { id, content } of instructions) {
      try {
        if (await this.deps.importInstructions(content)) result.imported.push(id);
        else result.skipped.push({ id, detail: "Cairn 已有用户级自定义指令" });
      } catch {
        result.skipped.push({ id, detail: "写入自定义指令失败" });
      }
    }
    if (servers.length > 0) {
      try {
        const imported = new Set(await this.deps.importMcp(servers.map(({ server }) => server)));
        for (const { id, server } of servers) {
          if (imported.has(server.name)) result.imported.push(id);
          else result.skipped.push({ id, detail: "Cairn 已有同名 MCP 服务器" });
        }
      } catch {
        result.skipped.push(...servers.map(({ id }) => ({ id, detail: "写入 MCP 配置失败" })));
      }
    }
    return result;
  }
}
