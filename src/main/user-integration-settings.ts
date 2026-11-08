import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { flattenHooks } from "../agent/plugins/discover";
import { parseHooksFile } from "../agent/plugins/manifest";
import type { McpServerConfig } from "../agent/plugins/types";
import { parseUserMcpConfig, userHooksConfigPathOf, userMcpConfigPathOf } from "../agent/plugins/user-mcp";
import { writeFileAtomic } from "../atomic-write";
import { isRecord } from "../is-record";

export interface UserIntegrationSaveResult {
  ok: boolean;
  error?: string;
  errors?: readonly string[];
  conflict?: boolean;
  revision?: string;
}

type ConfigFile = { root: Record<string, unknown>; revision: string; error?: string };
const revisionOf = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const conflict = (): UserIntegrationSaveResult => ({
  ok: false, conflict: true, error: "配置文件已变更，请重新载入后再保存",
});

async function readConfig(path: string): Promise<ConfigFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT"
      ? { root: {}, revision: "missing" }
      : { root: {}, revision: "unreadable", error: "无法读取配置文件" };
  }
  const revision = revisionOf(raw);
  try {
    const root: unknown = JSON.parse(raw);
    if (isRecord(root)) return { root, revision };
  } catch { /* Invalid JSON is reported without echoing its contents. */ }
  return { root: {}, revision, error: "配置文件必须是有效的 JSON 对象" };
}

async function saveConfig(path: string, root: Record<string, unknown>): Promise<string> {
  const text = JSON.stringify(root, null, 2) + "\n";
  await writeFileAtomic(path, text, { mode: 0o600 });
  return revisionOf(text);
}

function parseMcp(root: Record<string, unknown>) {
  const parsed = parseUserMcpConfig(root);
  if (isRecord(root.mcpServers) && Object.keys(root.mcpServers).some((name) => name.trim() === "")) {
    parsed.errors.push("MCP 配置中存在空服务器名称");
  }
  return parsed;
}

function readHooks(root: Record<string, unknown>, path: string, absent: boolean) {
  if (absent) return { hooks: {}, errors: [] };
  const hooks = root.hooks;
  if (!isRecord(hooks)) return { hooks: {}, errors: ["hooks 必须是事件对象"] };

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || groups.some((group) =>
      !isRecord(group) || !Array.isArray(group.hooks) || group.hooks.some((handler) => !isRecord(handler))
      || (group.matcher !== undefined && typeof group.matcher !== "string")
      || (group.if !== undefined && typeof group.if !== "string"))) {
      return { hooks, errors: [`${event} 的触发条件或处理器格式不正确`] };
    }
  }
  const parsed = parseHooksFile(JSON.stringify({ hooks }), path);
  const invalid = flattenHooks("user-hooks", "", parsed.hooks).filter((row) => !row.loaded);
  return {
    hooks,
    errors: invalid.map((row) => `${row.event} 含有无效或不兼容的处理器`),
  };
}

export class UserIntegrationSettings {
  private readonly mcpPath: string;
  private readonly hooksPath: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.mcpPath = userMcpConfigPathOf(root);
    this.hooksPath = userHooksConfigPathOf(root);
  }

  async mcpConfig() {
    const file = await readConfig(this.mcpPath);
    const parsed = parseMcp(file.root);
    const table = isRecord(file.root.mcpServers) ? file.root.mcpServers : {};
    const servers = parsed.servers.map(({ name, config }) => ({
      name, config: { ...config, ...table[name] as McpServerConfig },
    }));
    const errors = file.error ? [file.error] : parsed.errors;
    return { ok: errors.length === 0, path: this.mcpPath, revision: file.revision, servers, errors };
  }

  mcpSave(req: { servers: Record<string, unknown>; expectedRevision?: string }): Promise<UserIntegrationSaveResult> {
    return this.enqueue(async () => {
      const file = await readConfig(this.mcpPath);
      if (req?.expectedRevision !== undefined && req.expectedRevision !== file.revision) return conflict();
      if (file.error) return { ok: false, error: file.error };
      const current = parseMcp(file.root);
      if (current.errors.length > 0) return { ok: false, errors: current.errors };
      if (!isRecord(req?.servers) || Object.keys(req.servers).some((name) => name.trim() === "")) {
        return { ok: false, error: "服务器清单格式不正确" };
      }
      const parsed = parseMcp({ mcpServers: req.servers });
      if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors };
      const revision = await saveConfig(this.mcpPath, { ...file.root, mcpServers: req.servers });
      return { ok: true, revision };
    }).catch(() => ({ ok: false, error: "无法写入 MCP 配置" }));
  }

  async listMcpNames(): Promise<string[]> {
    const file = await readConfig(this.mcpPath);
    if (file.error || parseMcp(file.root).errors.length > 0) throw new Error("请先修复 MCP 配置");
    return Object.keys(isRecord(file.root.mcpServers) ? file.root.mcpServers : {});
  }

  importMcp(servers: ReadonlyArray<{ name: string; config: McpServerConfig }>): Promise<string[]> {
    return this.enqueue(async () => {
      const file = await readConfig(this.mcpPath);
      if (file.error || parseMcp(file.root).errors.length > 0) throw new Error("请先修复 MCP 配置");
      const current = isRecord(file.root.mcpServers) ? file.root.mcpServers : {};
      const additions = Object.fromEntries(servers.filter(({ name }) => !Object.hasOwn(current, name))
        .map(({ name, config }) => [name, { ...config, disabled: true }]));
      const names = Object.keys(additions);
      if (names.length > 0) await saveConfig(this.mcpPath, { ...file.root, mcpServers: { ...current, ...additions } });
      return names;
    });
  }

  async hooksConfig() {
    const file = await readConfig(this.hooksPath);
    const config = file.error ? { hooks: {}, errors: [file.error] } : readHooks(file.root, this.hooksPath, file.revision === "missing");
    return { ok: config.errors.length === 0, path: this.hooksPath, revision: file.revision, ...config };
  }

  hooksSave(req: { hooks: Record<string, unknown>; expectedRevision?: string }): Promise<UserIntegrationSaveResult> {
    return this.enqueue(async () => {
      const file = await readConfig(this.hooksPath);
      if (req?.expectedRevision !== undefined && req.expectedRevision !== file.revision) return conflict();
      if (file.error) return { ok: false, error: file.error };
      const current = readHooks(file.root, this.hooksPath, file.revision === "missing");
      if (current.errors.length > 0) return { ok: false, errors: current.errors };
      const next = { ...file.root, hooks: req?.hooks };
      const config = readHooks(next, this.hooksPath, false);
      if (config.errors.length > 0) return { ok: false, errors: config.errors };
      return { ok: true, revision: await saveConfig(this.hooksPath, next) };
    }).catch(() => ({ ok: false, error: "无法写入 Hooks 配置" }));
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.writes.then(action);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
