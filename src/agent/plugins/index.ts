// M2e：插件运行时组合根。发现（三级作用域）→ 信任过滤（未信任只列出）→ 激活面：
// hook 引擎 / MCP 连接 / skill 注册表。skill 激活不设私有状态——从事件流投影
// （tool_call(name=skill) → 同 callId 的 tool_result 事件 id），与「上下文是投影」同构。
import { join } from "node:path";
import {
  discoverPlugins, activeHooks, pendingPlugins,
} from "./discover";
import { TrustStore, pluginFingerprint, pluginFingerprintEx } from "./trust";
import { HookEngine } from "./hooks";
import { McpManager, type McpToolInfo } from "./mcp";
import {
  buildSkillRoutingList, skillInvokeName, resolveSkillName, skillRemount,
  clampSkillBody, SKILL_REMOUNT_TOKENS_PER_SKILL,
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
export { TrustStore, pluginFingerprint } from "./trust";
export { HookEngine, hookEnv, parseHookDecision, mergeDecision, HOOK_OUTPUT_CAP, HOOK_CONTEXT_TOTAL_CHAR_LIMIT, HOOK_REASON_CHAR_LIMIT, HOOK_TIMEOUT_DEFAULT, HOOK_TIMEOUT_USER_PROMPT, type HookEngineOptions } from "./hooks";
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
  /** 审查 S2-12（任务 4.6）：loose 样本同样要能被面板列出并被决议 => 带 name/trust。 */
  looseSkills: { name: string; invoke: string; description: string; trust: string }[];
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
      trustStatus: (abs, fp, bounded) => trust.statusSync(abs, fp, bounded),
    });
    return new PluginRuntime(manifest, opts);
  }

  /** 信任卡决议（批准/拒绝）→ 按决议重建激活面（同一样本信任后开始生效）。
   *  H3-P5：决议绑内容指纹；审查 S1-7：一并写入 bounded 位（abs@fp+b），
   *  否则有界指纹（含软链/超大文件/超帽）的批准永不命中 = 弹卡死循环。 */
  async trustDecide(pluginName: string, trusted: boolean): Promise<boolean> {
    // 审查 S2-12（任务 4.6）：项目作用域散装 skill 与插件同走信任门（E3：description 直进
    // system prompt = 注入面），但这里过去只在 manifest.plugins 里找名字 => loose 样本
    // **永远查不到出口**（面板既显示不出待信任，批准也点不动，用户只能看着 skill 不在路由清单里）。
    // 出口统一：按名字在 plugins / looseSkills 两处解析 root，其余流程（指纹 + bounded 位 +
    // 重建激活面）复用同一条路径；IPC 通道 agent:plugin-decide 原样够用，不新增机制。
    const target =
      this.manifest.plugins.find((x) => x.name === pluginName) ??
      this.manifest.looseSkills.find((x) => x.name === pluginName);
    if (!target) return false;
    const { fp, bounded } = await pluginFingerprintEx(target.root);
    await this.trust.decide(target.root, trusted, fp, bounded);
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

  /** 受信插件的 skill 全集（渐进披露路由清单数据源）。
   *  E3（审查 P1-13）：散装 skill 同走信任门——只有 trusted 才进路由（description 直进
   *  system prompt = 注入面；项目作用域克隆仓库丢 SKILL.md 不许免审批入路由）。 */
  skills(): SkillEntry[] {
    const out: SkillEntry[] = [];
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      out.push(...p.skills);
    }
    for (const l of this.manifest.looseSkills) {
      if (l.trust !== "trusted") continue;
      out.push(l.entry);
    }
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

  /** 受信插件的 agent 角色全集（plugin-name:agent-name）。M3c：返回完整定义（正文=roleDefinition、
   *  frontmatter=工具组/模型/上限，§9.6）供编排器采纳（§9.11-4 闭合）。 */
  agentRoles(): { invoke: string; description: string; plugin: string; name: string; path: string; frontmatter: Record<string, unknown>; body: string }[] {
    const out: { invoke: string; description: string; plugin: string; name: string; path: string; frontmatter: Record<string, unknown>; body: string }[] = [];
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      for (const a of p.agents) {
        out.push({ invoke: p.name + ":" + a.name, description: a.description, plugin: p.name, name: a.name, path: a.path, frontmatter: a.frontmatter, body: a.body });
      }
    }
    return out;
  }

  /** 按 invoke（plugin-name:agent-name）取插件 agent 角色定义（编排器 stages[].role 解析口；§9.6）。
   *  未信任插件的角色不可见（信任门一致）；未命中 = null（编排器 fail-visible 拒绝该环）。 */
  findAgentRole(invoke: string): { name: string; body: string; frontmatter: Record<string, unknown> } | null {
    const hit = this.agentRoles().find((a) => a.invoke === invoke);
    if (!hit) return null;
    return { name: hit.name, body: hit.body, frontmatter: hit.frontmatter };
  }

  /** 渐进披露路由清单（1536 截断）。 */
  routingList(): RoutingListResult {
    return buildSkillRoutingList(this.skills());
  }

  /** skill 触发。全文进上下文（tool_result），且 skill 结果免剪（prune exemptTools）
   *  ⇒ 这一份是**常驻**的：一个仓库自带的 200KB SKILL.md 会付满整个会话。
   *  重挂路径早就按 SKILL_REMOUNT_TOKENS_PER_SKILL 收窄（clampSkillBody），主路径却原样吐——
   *  同一个预算只在一头生效。现两头同口径。 */
  triggerSkill(input: string): { ok: boolean; output: string } {
    const all = this.skills();
    const hit = resolveSkillName(input, all);
    if (!hit) return { ok: false, output: "skill 未注册: " + input };
    const entry = all.find((s) => s.plugin === hit.plugin && s.name === hit.name)!;
    return {
      ok: true,
      output: clampSkillBody(entry.body, SKILL_REMOUNT_TOKENS_PER_SKILL,
        "\n[全文见 " + entry.path + "]"),
    };
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
        name: l.name,
        invoke: skillInvokeName(l.entry),
        description: l.entry.description,
        trust: l.trust,
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
