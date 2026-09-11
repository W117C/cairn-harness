// M2e：插件运行时组合根。发现（三级作用域）→ 信任过滤（未信任只列出）→ 激活面：
// hook 引擎 / MCP 连接 / skill 注册表。skill 激活不设私有状态——从事件流投影
// （tool_call(name=skill) → 同 callId 的 tool_result 事件 id），与「上下文是投影」同构。
import { join } from "node:path";
import {
  discoverPlugins, activeHooks, pendingPlugins,
} from "./discover";
import { TrustStore } from "./trust";
import { HookEngine } from "./hooks";
import { McpManager, type McpToolInfo } from "./mcp";
import {
  buildSkillRoutingList, skillInvokeName, resolveSkillName, skillRemount,
  type ActivatedSkill, type RoutingListResult, type RemountResult,
} from "./skills";
import type { AgentEvent, ToolCallEvent, ToolResultEvent } from "../../events";
import type {
  DiscoveredPlugin, LoadedHookDef, LooseSkill, PluginsManifest, SkillEntry, McpServerStatus,
} from "./types";

export * from "./types";
export {
  parseUserConfigFields,
  sensitiveUserConfigKeys,
  type UserConfigField,
} from "./manifest";
export {
  installSafeStorageBackend,
  setPluginSecretBackend,
  pluginSecretBackend,
  putPluginSecret,
  getPluginSecret,
  secretKey,
  writePluginUserConfig,
  SECRET_PLACEHOLDER,
  NO_BACKEND_ERROR,
  type PluginSecretBackend,
  type SafeStorageIo,
  type UserConfigWriteResult,
} from "./secrets";
export { parseFrontmatter, fmString } from "./frontmatter";
export { discoverPlugins, activeHooks, pendingPlugins } from "./discover";
export { TrustStore } from "./trust";
export { HookEngine, hookEnv, parseHookDecision, mergeDecision, HOOK_OUTPUT_CAP, HOOK_TIMEOUT_DEFAULT, HOOK_TIMEOUT_USER_PROMPT, type HookEngineOptions } from "./hooks";
export { McpManager, scopedToolName, parseScopedToolName, type McpToolInfo, type McpConnectResult } from "./mcp";
export {
  buildSkillRoutingList, skillInvokeName, resolveSkillName, skillRoutingLine, substituteArgs,
  renderPromptCommand, commandInvokeName, skillRemount, clampSkillBody, estimateTokens,
  SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL,
  type ActivatedSkill, type RoutingListResult, type RemountResult,
} from "./skills";

export interface PluginRuntimeOptions {
  userPluginsDir?: string;
  projectPluginsDir?: string;
  looseRoots?: string[];
  workspace: string;
  /** 插件数据根（PLUGIN_DATA / 超限落盘）。 */
  pluginDataRoot: string;
  /** 信任决议存储路径（项目级插件；缺省不持久 = 全部 pending）。 */
  trustFile?: string;
  /** hook 权限档。 */
  mode?: "read-only" | "default" | "auto";
}

/** skill 激活投影：tool_call(name="skill") → 同 callId 的 tool_result 事件 id（1-based 行号）。 */
export function activationsFromEvents(
  events: AgentEvent[],
  resolve: (invokeName: string) => { body: string } | null,
): ActivatedSkill[] {
  const out: ActivatedSkill[] = [];
  const pending = new Map<string, { invoke: string; index: number }>();
  events.forEach((e, index) => {
    if (e.type === "tool_call" && (e as ToolCallEvent).name === "skill") {
      const raw = (e as ToolCallEvent).args?.name;
      if (typeof raw === "string") {
        const resolved = resolve(raw);
        if (resolved) pending.set((e as ToolCallEvent).id, { invoke: raw, index });
      }
    } else if (e.type === "tool_result") {
      const r = e as ToolResultEvent;
      const p = pending.get(r.callId);
      if (p && r.ok) {
        out.push({ invoke: p.invoke, body: resolve(p.invoke)?.body ?? "", triggerEventId: index + 1, seq: out.length });
        pending.delete(r.callId);
      }
    }
  });
  return out;
}

/** 面板快照（加载清单 + 错误 + 警告 + MCP 状态；无隐藏状态，全部可重放推导）。 */
export interface PluginPanelSnapshot {
  plugins: {
    name: string;
    scope: string;
    trust: string;
    root: string;
    counts: { skills: number; commands: number; agents: number; hooks: number; mcp: number; lsp: number };
    errors: string[];
    warnings: string[];
  }[];
  looseSkills: { invoke: string; description: string }[];
  mcpServers: McpServerStatus[];
  errors: { plugin: string; message: string }[];
  warnings: { plugin: string; message: string }[];
}

export class PluginRuntime {
  manifest: PluginsManifest;
  hooks: HookEngine;
  mcp: McpManager;
  trust: TrustStore;
  private opts: PluginRuntimeOptions;
  /** 本轮已注册的 MCP 工具（scoped 名 → 定义；统一注册表的插件侧贡献）。 */
  mcpTools: Map<string, McpToolInfo & { plugin: string; server: string }> = new Map();

  private constructor(manifest: PluginsManifest, opts: PluginRuntimeOptions) {
    this.opts = opts;
    this.manifest = manifest;
    this.trust = new TrustStore(opts.trustFile ?? join(opts.pluginDataRoot, "plugin-trust.json"));
    this.hooks = new HookEngine({
      hooks: activeHooks(manifest),
      workspace: opts.workspace,
      pluginDataRoot: opts.pluginDataRoot,
      ...(opts.mode ? { mode: opts.mode } : {}),
    });
    this.mcp = new McpManager();
  }

  /** 静态扫描 + 信任过滤（不连 MCP 不跑 hook——纯装载）。 */
  static async load(opts: PluginRuntimeOptions): Promise<PluginRuntime> {
    const trust = new TrustStore(opts.trustFile ?? join(opts.pluginDataRoot, "plugin-trust.json"));
    await trust.warm();
    const manifest = await discoverPlugins({
      ...(opts.userPluginsDir ? { userPluginsDir: opts.userPluginsDir } : {}),
      ...(opts.projectPluginsDir ? { projectPluginsDir: opts.projectPluginsDir } : {}),
      ...(opts.looseRoots ? { looseRoots: opts.looseRoots } : {}),
      trustStatus: (abs) => trust.statusSync(abs),
    });
    return new PluginRuntime(manifest, opts);
  }

  /** 信任卡决议（批准/拒绝）→ 按决议重建激活面（同一样本信任后开始生效）。 */
  async trustDecide(pluginName: string, trusted: boolean): Promise<boolean> {
    const p = this.manifest.plugins.find((x) => x.name === pluginName);
    if (!p) return false;
    await this.trust.decide(p.root, trusted);
    const reloaded = await PluginRuntime.load(this.opts);
    this.manifest = reloaded.manifest;
    this.hooks = reloaded.hooks;
    return true;
  }

  /** 激活全部受信插件的 MCP server（未信任/declined 不连接）。 */
  async connectMcp(): Promise<void> {
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      for (const { serverName, config } of p.mcp) {
        const res = await this.mcp.connect(p.name, serverName, config, {
          pluginRoot: p.root,
          projectDir: this.opts.workspace,
        });
        for (const t of res.tools) {
          this.mcpTools.set(t.scopedName, { ...t, plugin: p.name, server: serverName });
        }
      }
    }
  }

  /** 受信插件的 skill 全集（渐进披露路由清单数据源）。 */
  skills(): SkillEntry[] {
    const out: SkillEntry[] = [];
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      out.push(...p.skills);
    }
    for (const l of this.manifest.looseSkills) out.push(l.entry);
    return out;
  }

  /** 散装 skill 清单。 */
  loose(): LooseSkill[] {
    return this.manifest.looseSkills;
  }

  /** 受信插件的 prompt commands。 */
  commands(): { plugin: string | null; name: string; description: string; path: string; frontmatter: Record<string, unknown>; body: string }[] {
    const out: { plugin: string | null; name: string; description: string; path: string; frontmatter: Record<string, unknown>; body: string }[] = [];
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      out.push(...p.commands);
    }
    return out;
  }

  /** 受信插件的 agent 角色（plugin-name:agent-name；采纳留 M3）。 */
  agentRoles(): { invoke: string; description: string }[] {
    const out: { invoke: string; description: string }[] = [];
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      for (const a of p.agents) out.push({ invoke: p.name + ":" + a.name, description: a.description });
    }
    return out;
  }

  /** 渐进披露路由清单（1536 截断）。 */
  routingList(): RoutingListResult {
    return buildSkillRoutingList(this.skills());
  }

  /** skill 触发（全文进上下文 = tool_result 携带全文）。 */
  triggerSkill(input: string): { ok: boolean; output: string } {
    const all = this.skills();
    const hit = resolveSkillName(input, all);
    if (!hit) return { ok: false, output: "skill 未注册: " + input };
    const entry = all.find((s) => s.plugin === hit.plugin && s.name === hit.name)!;
    return { ok: true, output: entry.body };
  }

  /** 压缩后重挂（从事件流投影激活记录）。 */
  remountFromEvents(events: AgentEvent[]): RemountResult {
    const activated = activationsFromEvents(events, (invoke) => {
      const all = this.skills();
      const hit = resolveSkillName(invoke, all);
      if (!hit) return null;
      const entry = all.find((s) => s.plugin === hit.plugin && s.name === hit.name)!;
      return { body: entry.body };
    });
    const excluded = new Set<number>();
    for (const e of events) {
      if (e.type === "compaction") for (const id of e.compressed_event_ids) excluded.add(id);
    }
    return skillRemount(activated, (id) => excluded.has(id));
  }

  /** 面板快照。 */
  snapshot(): PluginPanelSnapshot {
    return {
      plugins: this.manifest.plugins.map((p: DiscoveredPlugin) => ({
        name: p.name,
        scope: p.scope,
        trust: p.trust,
        root: p.root,
        counts: {
          skills: p.skills.length,
          commands: p.commands.length,
          agents: p.agents.length,
          hooks: p.hooks.filter((h: LoadedHookDef) => h.loaded).length,
          mcp: p.mcp.length,
          lsp: Object.keys(p.lsp).length,
        },
        errors: p.errors,
        warnings: p.warnings,
      })),
      looseSkills: this.manifest.looseSkills.map((l) => ({
        invoke: skillInvokeName(l.entry),
        description: l.entry.description,
      })),
      mcpServers: this.mcp.statuses(),
      errors: this.manifest.errors,
      warnings: this.manifest.warnings,
    };
  }

  async shutdown(): Promise<void> {
    await this.mcp.disconnectAll();
  }
}

/** 当前会话的插件运行时（agent-runner 装配；headless 脚本可自建）。 */
let current: PluginRuntime | null = null;
export function setCurrentPluginRuntime(rt: PluginRuntime | null): void {
  current = rt;
}
export function currentPluginRuntime(): PluginRuntime | null {
  return current;
}
