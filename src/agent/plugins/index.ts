// M2e：插件运行时组合根。发现（三级作用域）→ 信任过滤（未信任只列出）→ 激活面：
// hook 引擎 / MCP 连接 / skill 注册表。skill 激活不设私有状态——从事件流投影
// （tool_call(name=skill) → 同 callId 的 tool_result 事件 id），与「上下文是投影」同构。
import { dirname, join } from "node:path";
import type { PermissionMode } from "../../permissions/modes";
import {
  discoverPlugins, activeHooks, pendingPlugins,
} from "./discover";
import { defaultForeignSources, type ForeignSource } from "./foreign";
import { TrustStore, pluginFingerprint, pluginFingerprintEx } from "./trust";
import { HookEngine } from "./hooks";
import { McpManager, type McpToolInfo } from "./mcp";
import {
  buildSkillRoutingList, skillInvokeName, commandInvokeName, resolveSkillName, skillRemount, modelInvocable,
  clampSkillBody, skillRecallSuffix, substituteVars, declaredArgumentNames, expandConfigVars, expandUserConfig, referencedUserConfigKeys,
  skillToolPolicy,
  SKILL_REMOUNT_TOKENS_PER_SKILL,
  type ActivatedSkill, type RoutingListResult, type RemountResult, type SubstitutionContext, type SkillToolPolicy,
} from "./skills";
import {
  readPluginUserConfig, pluginUserConfigDir, writePluginUserConfig, type PluginUserConfigRead,
} from "./secrets";
import { loadUserAgentRoles, userAgentInvoke, type UserAgentRole } from "../roles/user-agents";
import {
  registerPluginLspServers, unregisterPluginLspServers, closePluginLspClients, type LspServerConfig as LspRuntimeConfig,
} from "../../tools/lsp";
import { isNumericCompaction, type AgentEvent, type ToolCallEvent, type ToolResultEvent, type UserMessageEvent } from "../../events";
import { userConfigValuesErrors } from "./manifest";
import type {
  DiscoveredPlugin, LoadedHookDef, LooseSkill, PluginsManifest, SkillEntry, McpServerStatus,
} from "./types";

export * from "./types";
export { defaultForeignSources, FOREIGN_LAYOUTS } from "./foreign";
export {
  parseUserConfigFields,
  sensitiveUserConfigKeys,
  userConfigValueError,
  userConfigValuesErrors,
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
  readPluginUserConfig,
  pluginUserConfigFile,
  pluginUserConfigDir,
  SECRET_PLACEHOLDER,
  NO_BACKEND_ERROR,
  type PluginSecretBackend,
  type SafeStorageIo,
  type UserConfigWriteResult,
  type PluginUserConfigRead,
} from "./secrets";
export { parseFrontmatter, fmString } from "./frontmatter";
export { discoverPlugins, activeHooks, pendingPlugins } from "./discover";
export { TrustStore, pluginFingerprint } from "./trust";
export { HookEngine, hookEnv, pluginOptionEnv, parseHookDecision, mergeDecision, parseHookIf, hookIfMatches, HOOK_OUTPUT_CAP, HOOK_CONTEXT_TOTAL_CHAR_LIMIT, HOOK_REASON_CHAR_LIMIT, HOOK_TIMEOUT_DEFAULT, HOOK_TIMEOUT_USER_PROMPT, type HookEngineOptions } from "./hooks";
export { McpManager, expandMcpConfig, scopedToolName, parseScopedToolName, type McpToolInfo, type McpConnectResult } from "./mcp";
export {
  buildSkillRoutingList, skillInvokeName, resolveSkillName, skillRoutingLine, substituteVars, declaredArgumentNames,
  expandConfigVars, expandUserConfig, referencedUserConfigKeys,
  renderPromptCommand, commandInvokeName, expandPromptCommand, expandSkillInvocation, skillRemount, clampSkillBody, estimateTokens, skillRecallSuffix,
  skillToolPolicy, modelInvocable, type SkillToolPolicy,
  type CommandExpansion, type SkillUserExpansion, type SubstitutionContext,
  SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL,
  type ActivatedSkill, type RoutingListResult, type RemountResult,
} from "./skills";

export interface PluginRuntimeOptions {
  userPluginsDir?: string;
  projectPluginsDir?: string;
  /** 项目级 skill 根（缺省 = `<workspace>/.agent/skills`，见 `projectSkillsRootOf`）。
   *  显式给空串＝关掉这一顶根（判卷与「只想看别的根」的脚本用）。 */
  projectSkillsDir?: string;
  looseRoots?: string[];
  /** 外部声明式来源（opencode / pi / codex / qoder / claude）。缺省 =
   *  `defaultForeignSources(workspace, home)`：项目级五顶根，带 home 时再加用户级。 */
  foreignSources?: ForeignSource[];
  workspace: string;
  /** 插件数据根（PLUGIN_DATA / 超限落盘）。 */
  pluginDataRoot: string;
  /** 信任决议存储路径（项目级插件；缺省不持久 = 全部 pending）。 */
  trustFile?: string;
  /** hook 权限档（类型取自 `permissions/modes`，不再自己抄一份 union）。 */
  mode?: PermissionMode;
  /** 会话标识：透传给 hook 引擎进 stdin JSON（§9.5）。缺省 = 该字段不进 JSON，不伪造。 */
  sessionId?: string;
  /** 用户级自定义角色（`~/.dsh/agents`、`~/.claude/agents`）的 home；缺省 = `homedir()`。
   *  可注入是为了判卷——不能读真 home 的测试环境里，这条路径也要被验到。 */
  home?: string;
}

/** 信任表那份文件的唯一算法：显式 `trustFile` 优先，否则 `pluginDataRoot` 下那个固定名。
 *  导出是因为 verify 命令的信任门（`src/main/verify-trust-gate.ts`）**复用同一份文件**——
 *  一把信任表、两个门（插件 hook/MCP 与仓库自带验证命令），路径在这里算第二遍就是给
 *  「第二份事实源」开门（本仓零容忍那一格）。 */
export const PLUGIN_TRUST_FILE_NAME = "plugin-trust.json";
export function trustFilePathOf(opts: { pluginDataRoot: string; trustFile?: string }): string {
  return opts.trustFile ?? join(opts.pluginDataRoot, PLUGIN_TRUST_FILE_NAME);
}

/** 插件数据根的缺省目录名（与信任表同顶的那个子目录）。 */
export const PLUGIN_DATA_DIR_NAME = "plugin-data";

/** 缺省数据根 = 用户级 `<home>/.config/cairn/plugin-data`（与 `agent/memory/store.ts` 的全局层同顶）。
 *  从前缺省是 `<os.tmpdir()>/m2e-plugin-data`，两格代价不在「重启就好」的量纲上：
 *  ① 这一顶同时放着**信任表**（verify 命令的信任门走同一个 `trustFilePathOf`）与插件 userConfig
 *     （含 safeStorage 里的敏感值）⇒ 系统清 tmp 就把已批准的决议和配置无声擦掉，也没人备份；
 *  ② tmp 世界可写的平台上（Linux CI、共享 runner）目录名固定可猜 ⇒ 本机其他用户预建
 *     `<tmp>/m2e-plugin-data/plugin-trust.json` 即把 pending 写成 trusted，钩子/MCP/verify 全部免审批激活。
 *  `home` 由参数进来（同 `PluginRuntimeOptions.home` 的口径）：判卷不许读真家目录。 */
export function defaultPluginDataRoot(home: string): string {
  return join(home, ".config", "cairn", PLUGIN_DATA_DIR_NAME);
}

/** 数据根的唯一决议：显式 `M2E_PLUGIN_DATA` 优先，空串按「没给」处理（与旧的 truthy 判定同义）。
 *  纯函数（env 与 home 都从参数进）是为了这一格能被秒级判卷直接问，而不是只在装配面间接可见。 */
export function pluginDataRootOf(env: NodeJS.ProcessEnv, home: string): string {
  const explicit = env.M2E_PLUGIN_DATA;
  return explicit ? explicit : defaultPluginDataRoot(home);
}

/** 项目级 skill 根的唯一算法（第 438 页）。从前本仓只扫 `<ws>/.agent/plugins`，
 *  于是摆在 `.agent/skills` 的 skill **既列不出也批不了**（「装了但看不见」）：
 *  想让某个项目 skill 生效只剩一条路＝把它塞进 `M2E_LOOSE_SKILLS`，而那一顶是恒 trusted 的
 *  ——等于为了可用性绕开信任门。路径住这里（装配面与 `--plugins` 共用），不在调用方各拼一遍。 */
export const PROJECT_SKILLS_DIR_SEGMENTS = [".agent", "skills"] as const;
export function projectSkillsRootOf(workspace: string): string {
  return join(workspace, ...PROJECT_SKILLS_DIR_SEGMENTS);
}

/** skill 激活投影：tool_call(name="skill") → 同 callId 的 tool_result 事件 id（1-based 行号）；
 *  以及**用户侧触发**（§9.3）：带 `skill` 字段的 user_message 本身就是一次激活，
 *  它的行号就是被压缩时该重挂的那条。两条 face 都必须进这里，否则用户点出来的 skill
 *  在压缩后静默消失（模型点的那条却会重挂）——那是最难查的那种不一致。 */
export function activationsFromEvents(
  events: AgentEvent[],
  /** 第二参 = 那次 tool_call 实下的 `args`（§9.3 的参数替换要在重挂时重放；无参数 = 空串）。 */
  resolve: (invokeName: string, argsString: string) => { body: string } | null,
): ActivatedSkill[] {
  const out: ActivatedSkill[] = [];
  const pending = new Map<string, { invoke: string; args: string; index: number }>();
  events.forEach((e, index) => {
    if (e.type === "user_message" && (e as UserMessageEvent).skill) {
      const m = (e as UserMessageEvent).skill!;
      out.push({ invoke: m.invoke, body: resolve(m.invoke, m.args)?.body ?? "", triggerEventId: index + 1, seq: out.length });
    } else if (e.type === "tool_call" && (e as ToolCallEvent).name === "skill") {
      const raw = (e as ToolCallEvent).args?.name;
      if (typeof raw === "string") {
        const callArgs = (e as ToolCallEvent).args?.args;
        const resolved = resolve(raw, typeof callArgs === "string" ? callArgs : "");
        if (resolved) pending.set((e as ToolCallEvent).id, { invoke: raw, args: typeof callArgs === "string" ? callArgs : "", index });
      }
    } else if (e.type === "tool_result") {
      const r = e as ToolResultEvent;
      const p = pending.get(r.callId);
      if (p && r.ok) {
        out.push({ invoke: p.invoke, body: resolve(p.invoke, p.args)?.body ?? "", triggerEventId: index + 1, seq: out.length });
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
    counts: { skills: number; commands: number; agents: number; hooks: number; mcp: number; lsp: number; lspActive: number };
    /** 2026-10-18：面板不再只报数目——列出可调用的技能与命令（invoke 名与描述）。
     *  信任是插件级的（未信任不激活），条目本身不另带 trust 字段。 */
    skills: { name: string; invoke: string; description: string }[];
    commands: { name: string; invoke: string; description: string }[];
    /** userConfig 可编辑面的**元数据**（值绝不发给渲染层；敏感字段只报 hasValue）。 */
    userConfig: {
      key: string;
      type: string;
      title?: string;
      description?: string;
      required: boolean;
      sensitive: boolean;
      hasValue: boolean;
      missing: boolean;
    }[];
    errors: string[];
    warnings: string[];
  }[];
  /** 审查 S2-12（任务 4.6）：loose 样本同样要能被面板列出并被决议 => 带 name/trust。 */
  looseSkills: { name: string; invoke: string; description: string; trust: string }[];
  mcpServers: McpServerStatus[];
  /** §9.3 权限联动的本 turn 账：哪些 skill/command 被激活过、各自申报了什么工具面改动。
   *  面板与判据读同一份（审计与可解释：申报了 allowed-tools 却仍需确认时，这里看得见是谁）。 */
  toolScopes: { invoke: string; allow: string[]; deny: string[] }[];
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
  /** 本轮已注册进 LSP 运行时的插件服务器 id（带插件前缀）；shutdown 按这张表摘干净。 */
  private lspServerIds: string[] = [];
  /** §9.5 userConfig 的读侧（一个受信插件一份）。三条激活面（hook / MCP / LSP）都从这里取值。 */
  private userConfigs: Map<string, PluginUserConfigRead> = new Map();
  /** §9.3 权限联动的持有面：本 run 内被激活过的 skill/command 申报的工具改动。
   *  键 = 调用名（同名重复激活不叠加）。生命周期 = 一个 PluginRuntime 实例 = 一次 run
   *  （一条用户消息），下条消息新建实例 ⇒ 「本 turn 放行、下条用户消息清除」不需要清理代码。 */
  private skillScopes: Map<string, SkillToolPolicy> = new Map();
  /** 用户级自定义角色（`~/.dsh/agents`、`~/.claude/agents`）。装载期读一次；
   *  与插件角色共用查找口与路由清单，于是消费端只有一路（两处口径必漂的老毛病从这里挡掉）。 */
  private userAgents: UserAgentRole[] = [];

  private constructor(manifest: PluginsManifest, opts: PluginRuntimeOptions) {
    this.opts = opts;
    this.manifest = manifest;
    this.trust = new TrustStore(trustFilePathOf(opts));
    this.hooks = new HookEngine({
      hooks: activeHooks(manifest),
      workspace: opts.workspace,
      pluginDataRoot: opts.pluginDataRoot,
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      // exec form 的 ${user_config.*} 展开与 PLUGIN_OPTION_* 取值共用这一份解析结果。
      userConfigValues: (plugin) => this.userConfigs.get(plugin)?.values ?? {},
      userConfigSensitive: (plugin) => this.userConfigs.get(plugin)?.sensitive ?? [],
    });
    this.mcp = new McpManager();
    // server 崩溃 ⇒ 立即摘掉它的工具（旧实现只标 failed，模型仍看到一组永远「未连接」的工具）。
    this.mcp.onServerDown = (plugin, server) => {
      for (const [name, info] of this.mcpTools) {
        if (info.plugin === plugin && info.server === server) this.mcpTools.delete(name);
      }
    };
  }

  /** 静态扫描 + 信任过滤（不连 MCP 不跑 hook——纯装载）。 */
  static async load(opts: PluginRuntimeOptions): Promise<PluginRuntime> {
    const trust = new TrustStore(trustFilePathOf(opts));
    await trust.warm();
    const manifest = await discoverPlugins({
      ...(opts.userPluginsDir ? { userPluginsDir: opts.userPluginsDir } : {}),
      ...(opts.projectPluginsDir ? { projectPluginsDir: opts.projectPluginsDir } : {}),
      // 缺省取装配面那个唯一算法（不在调用方拼路径）；显式空串＝关掉这一顶（`??` 不把 "" 当没给）。
      projectSkillsDir: opts.projectSkillsDir ?? projectSkillsRootOf(opts.workspace),
      ...(opts.looseRoots ? { looseRoots: opts.looseRoots } : {}),
      foreignSources: opts.foreignSources ?? defaultForeignSources(opts.workspace, opts.home),
      trustStatus: (abs, fp, bounded) => trust.statusSync(abs, fp, bounded),
    });
    const rt = new PluginRuntime(manifest, opts);
    await rt.resolveUserConfigs(); // 装载即解析：缺项要在激活前就出现在警告里
    // 用户级自定义角色：装载期读一次，问题进同一份警告面（面板与判据都看得见，不是只进内存）。
    const ua = await loadUserAgentRoles(opts.home === undefined ? {} : { home: opts.home });
    rt.userAgents = ua.roles;
    for (const message of ua.warnings) manifest.warnings.push({ plugin: "user-agents", message });
    return rt;
  }

  /** 读每个受信插件的 userConfig（明文值 + safeStorage 里的敏感值），并把
   *  「插件引用了 `${user_config.K}` 而 K 拿不到值」当场点名——不点名的话插件会带着字面占位串
   *  去连远端，报回来的错和配置毫无关系（把不可知记成空值是本仓点名的形状）。 */
  async resolveUserConfigs(): Promise<void> {
    this.userConfigs.clear();
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      const read = await readPluginUserConfig({
        dir: pluginUserConfigDir(this.opts.pluginDataRoot, p.name),
        plugin: p.name,
        fields: p.userConfigFields,
      });
      this.userConfigs.set(p.name, read);
      if (read.missing.length === 0) continue;
      const texts = JSON.stringify([p.hooks, p.mcp, p.lsp]);
      const referenced = referencedUserConfigKeys(texts);
      for (const key of referenced) {
        if (read.missing.includes(key)) {
          p.warnings.push("userConfig 缺项：" + p.name + " 引用了 ${user_config." + key + "} 但没有值（未填或敏感值解不开）⇒ 原样保留，不填空串");
        }
      }
    }
  }

  /** 某插件的 userConfig 取值（配置面：hook exec form / MCP / LSP）。未装载 = 空表。 */
  userConfigValuesFor(plugin: string): Record<string, string> {
    return this.userConfigs.get(plugin)?.values ?? {};
  }

  /** 写插件 userConfig（桌面设置面的唯一写入口）。敏感字段走 safeStorage；写后重解析激活面。 */
  async setUserConfig(plugin: string, values: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const p = this.manifest.plugins.find((x) => x.name === plugin);
    if (p === undefined) return { ok: false, error: `插件不存在: ${plugin}` };
    const allowed = new Set(p.userConfigFields.map((f) => f.key));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length > 0) return { ok: false, error: `未知配置项: ${unknown.join("、")}` };
    // 按声明类型校验（number/boolean）。此前这里只查"是不是字符串"⇒ 往 number 字段填
    // "abc" 会被收下并原样进 MCP/LSP argv 与 hook exec form，错值不在任何地方报错。
    const bad = userConfigValuesErrors(p.userConfigFields, values);
    if (bad.length > 0) return { ok: false, error: bad.join("；") };
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== "string") return { ok: false, error: `配置项 ${k} 必须是字符串` };
      clean[k] = v;
    }
    const r = await writePluginUserConfig({
      plugin,
      fields: p.userConfigFields,
      values: clean,
      dir: pluginUserConfigDir(this.opts.pluginDataRoot, plugin),
    });
    if (!r.ok) return { ok: false, error: r.error };
    await this.resolveUserConfigs();
    // 敏感值/端点变化要重连 MCP、重注册 LSP；失败不把写入回滚（值已安全落盘），但要出声。
    await this.connectMcp().catch((err: unknown) => {
      console.warn("[plugins] userConfig 更新后 MCP 重连失败:", err instanceof Error ? err.message : String(err));
    });
    try { this.activateLsp(); } catch (err) {
      console.warn("[plugins] userConfig 更新后 LSP 重注册失败:", err instanceof Error ? err.message : String(err));
    }
    return { ok: true };
  }

  /** §9.3 权限联动：一条 skill / prompt command **被激活的那一瞬间**登记它的工具面申报。
   *  两条触发 face（模型的 skill 工具、用户的 /命令）都走这一个入口，同源一份实现。 */
  grantSkillScope(invoke: string, frontmatter: Record<string, unknown> | undefined): SkillToolPolicy {
    const p = skillToolPolicy(frontmatter);
    this.skillScopes.set(invoke, p);
    // 认不出的名字不静默吞：与 §9.8「运行时还没兑现的字段当场说出来」同一条纪律。
    // 文案要说清**申报域**是哪两张表——否则下一个"认不出"会被当成拼写错误，而不是面没接上。
    for (const u of p.unknown) {
      console.warn(
        "[skill] 工具名不在申报域（静态工具表 ∪ 注入面清单）内（" + invoke + " 申报 " + u + "）⇒ 本轮不生效",
      );
    }
    return p;
  }

  /** §9.3 的 `disallowed-tools` 活闸：这个工具此刻被哪条已激活 skill 摘除（null = 没被摘）。
   *  这是**收紧向**的申报，所以它进执行面；`allowed-tools` 是放宽向的，按 §9.3 的收紧点
   *  只能登记不能扩权（见 skillAllowNote）。 */
  skillDenial(tool: string): string | null {
    for (const [invoke, p] of this.skillScopes) {
      if (p.deny.some((t) => t === tool)) return invoke;
    }
    return null;
  }

  /** 某工具是否被某条已激活 skill 申报进 `allowed-tools`（返回申报者，null = 没申报）。
   *  只用于**解释**：门卡在 ask 时把这条申报连同「为什么不因它放行」一起说给用户看。
   *  它不进权限管线——一条规则库 allow 能顶掉档位的逐次审批，那是插件作者替用户扩权。 */
  skillAllowNote(tool: string): string | null {
    for (const [invoke, p] of this.skillScopes) {
      if (p.allow.some((t) => t === tool)) return invoke;
    }
    return null;
  }

  /** 本 turn 已登记的工具面改动（面板与判据读同一份；空表 = 没激活过任何带申报的 skill）。 */
  skillScopeSnapshot(): { invoke: string; allow: string[]; deny: string[] }[] {
    return [...this.skillScopes.entries()].map(([invoke, p]) => ({
      invoke, allow: [...p.allow], deny: [...p.deny],
    }));
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
    // 决议只带名字（IPC 形状不动）。同名条目（项目插件 vs 项目散装 skill，或用户级插件）时
    // 旧实现取扫描序第一个 ⇒ 用户批的是 A，落信任的可能是 B 的执行面。
    // 判不准就不落：歧义时拒绝本次决议（fail-closed），面板仍显示待信任。
    const matches = [
      ...this.manifest.plugins.map((x) => ({ name: x.name, root: x.root })),
      ...this.manifest.looseSkills.map((x) => ({ name: x.name, root: x.root })),
    ].filter((x) => x.name === pluginName);
    if (matches.length !== 1) return false;
    const target = matches[0]!;
    const { fp, bounded } = await pluginFingerprintEx(target.root);
    await this.trust.decide(target.root, trusted, fp, bounded);
    const reloaded = await PluginRuntime.load(this.opts);
    const inactive = this.manifest.plugins.filter((plugin) =>
      reloaded.manifest.plugins.find((current) => current.name === plugin.name)?.trust !== "trusted");
    this.manifest = reloaded.manifest;
    this.hooks = reloaded.hooks;
    this.userConfigs = reloaded.userConfigs;
    const cleanups: Promise<void>[] = [];
    for (const plugin of inactive) {
      for (const [name, info] of this.mcpTools) if (info.plugin === plugin.name) this.mcpTools.delete(name);
      const ids = this.lspServerIds.filter((id) => id.startsWith(plugin.name + ":"));
      unregisterPluginLspServers(this.opts.workspace, ids);
      this.lspServerIds = this.lspServerIds.filter((id) => !ids.includes(id));
      cleanups.push(this.mcp.disconnectPlugin(plugin.name), closePluginLspClients(this.opts.workspace, ids));
    }
    await Promise.all(cleanups);
    return true;
  }

  /** 激活全部受信插件的 MCP server（未信任/declined 不连接）。 */
  async connectMcp(): Promise<void> {
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      for (const { serverName, config } of p.mcp) {
        if (this.manifest.plugins.find((current) => current.name === p.name)?.trust !== "trusted") break;
        const res = await this.mcp.connect(p.name, serverName, config, {
          pluginRoot: p.root,
          projectDir: this.opts.workspace,
          // §9.5：远程 server 的 API key 就写在 headers/url 里，不展开这一层等于那类插件连不上。
          userConfig: this.userConfigValuesFor(p.name),
          userConfigSensitive: this.userConfigs.get(p.name)?.sensitive ?? [],
        });
        if (this.manifest.plugins.find((current) => current.name === p.name)?.trust !== "trusted") break;
        for (const t of res.tools) {
          this.mcpTools.set(t.scopedName, { ...t, plugin: p.name, server: serverName });
        }
      }
    }
  }

  /** §9.8 的第三个激活面：把受信插件的 `.lsp.json` 注册进 LSP 运行时。
   *  此前它只被装载 + 被面板计数 ⇒ 数字在撒谎（装载即陈列）。
   *  未信任不注册：`server.command` 是任意可执行文件，信任门与 hook / MCP 同口径（§9.5 信任边界）。
   *  id 加插件前缀（§9.2 scoped 命名）——两个插件都写 "ts" 时不该互相顶掉，也让 broken/clients 的键可归因。 */
  activateLsp(): void {
    for (const p of this.manifest.plugins) {
      if (p.trust !== "trusted") continue;
      const servers: Record<string, LspRuntimeConfig> = {};
      const cfgValues = this.userConfigValuesFor(p.name);
      // 敏感值只进 env；LSP 的 command/args 会出现在进程表里。
      const sensitive = new Set(this.userConfigs.get(p.name)?.sensitive ?? []);
      const argvValues = Object.fromEntries(Object.entries(cfgValues).filter(([k]) => !sensitive.has(k)));
      const expand = (t: string): string => expandUserConfig(
        expandConfigVars(t, { pluginRoot: p.root, projectDir: this.opts.workspace }),
        argvValues,
      );
      for (const [id, cfg] of Object.entries(p.lsp)) {
        const extensions = Object.keys(cfg.extensionToLanguage ?? {});
        if (extensions.length === 0) continue; // 没有扩展映射 = 永远不会被选中；装载期已出过声
        servers[p.name + ":" + id] = {
          command: expand(cfg.command),
          args: (cfg.args ?? []).map(expand),
          extensions,
          // extensionToLanguage 的**值**此前在这里被丢掉（只用 Object.keys 取扩展名）⇒
          // didOpen 的 languageId 落回 TS 启发式，非 JS 语言的插件 server 静默失效。
          ...(cfg.extensionToLanguage !== undefined ? { extensionToLanguage: cfg.extensionToLanguage } : {}),
          ...(cfg.initializationOptions !== undefined ? { initializationOptions: cfg.initializationOptions } : {}),
          ...(cfg.diagnostics?.enabled === false ? { diagnosticsEnabled: false } : {}),
        };
      }
      const { accepted } = registerPluginLspServers(this.opts.workspace, servers);
      this.lspServerIds.push(...accepted);
    }
  }

  /** 已注册进 LSP 运行时的插件服务器 id（含插件前缀）。面板与测试都看这个数，不看声明数。 */
  activeLspServerIds(): string[] {
    return [...this.lspServerIds];
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

  /** 用户级自定义角色（`user:<name>`），与 `agentRoles()` 同形状 —— 查找口与路由清单共用一条。 */
  userAgentRoles(): { invoke: string; description: string; plugin: string; name: string; path: string; frontmatter: Record<string, unknown>; body: string }[] {
    return this.userAgents.map((a) => ({
      invoke: userAgentInvoke(a.name), description: a.description, plugin: "user",
      name: a.name, path: a.path, frontmatter: a.frontmatter, body: a.body,
    }));
  }

  /** 按 invoke 取 agent 角色定义（编排器 stages[].role 解析口；§9.6）。两条来源一条查找面：
   *  `plugin-name:agent-name` 走插件（未信任不可见，信任门一致），`user:agent-name` 走用户级目录。
   *  未命中 = null（编排器 fail-visible 拒绝该环）。 */
  findAgentRole(invoke: string): { name: string; body: string; frontmatter: Record<string, unknown> } | null {
    const hit = this.agentRoles().find((a) => a.invoke === invoke) ?? this.userAgentRoles().find((a) => a.invoke === invoke);
    if (!hit) return null;
    return { name: hit.name, body: hit.body, frontmatter: hit.frontmatter };
  }

  /** 渐进披露路由清单（1536 截断）。
   *  插件 agent 角色一并列进去：`pipeline.stages[].role` 认的就是这个 invoke 名，而模型此前
   *  **没有任何地方**能读到注册了哪些角色（skill 有清单，角色没有）——于是"自定义子智能体"
   *  只能靠猜，猜错的唯一反馈是 spawn 被拒（未知角色）。同一条清单、同一份预算。 */
  routingList(query = ""): RoutingListResult {
    const roleLines = [...this.agentRoles(), ...this.userAgentRoles()].map((a) => {
      const desc = a.description.replace(/\s+/g, " ").trim();
      return "- " + a.invoke + " — " + (desc !== "" ? desc : "（该 agent 文件没写 description）") + "（可用作 pipeline stages[].role）";
    });
    return buildSkillRoutingList(this.skills(), roleLines, query);
  }

  /** §9.3 替换器的取值面（skill 与 prompt command 共用一份）：目录类变量按条目自己的路径与
   *  所属插件解析，散装条目没有插件根 ⇒ 整项缺席（`${PLUGIN_ROOT}` 就原样留着，不填假路径）。 */
  substitutionFor(entry: { plugin: string | null; path: string; frontmatter: Record<string, unknown> }): Omit<SubstitutionContext, "args"> {
    const root = entry.plugin === null ? undefined : this.manifest.plugins.find((p) => p.name === entry.plugin)?.root;
    return {
      named: declaredArgumentNames(entry.frontmatter),
      skillDir: dirname(entry.path),
      ...(root !== undefined ? { pluginRoot: root, pluginData: join(this.opts.pluginDataRoot, entry.plugin as string) } : {}),
      projectDir: this.opts.workspace,
      ...(this.opts.sessionId !== undefined ? { sessionId: this.opts.sessionId } : {}),
    };
  }

  /** skill 触发。全文进上下文（tool_result），且 skill 结果免剪（prune exemptTools）
   *  ⇒ 这一份是**常驻**的：一个仓库自带的 200KB SKILL.md 会付满整个会话。
   *  重挂路径早就按 SKILL_REMOUNT_TOKENS_PER_SKILL 收窄（clampSkillBody），主路径却原样吐——
   *  同一个预算只在一头生效。现两头同口径。 */
  triggerSkill(input: string, argsString = ""): { ok: boolean; output: string } {
    const all = this.skills();
    const hit = resolveSkillName(input, all);
    if (!hit) return { ok: false, output: "skill 未注册: " + input };
    const entry = all.find((s) => s.plugin === hit.plugin && s.name === hit.name)!;
    // 清单挡住 ≠ 执行端挡住：模型硬猜名字时同样要拒（§9.3 disable-model-invocation 的语义面）。
    // 拒绝理由只说机制、不回显正文——否则一次失败的调用就把全文买进了上下文。
    if (!modelInvocable(entry)) {
      return { ok: false, output: "skill " + skillInvokeName(entry) + " 声明 disable-model-invocation，只能由用户触发（模型侧不可调用）" };
    }
    // 替换在**收窄之前**：clampSkillBody 按 token 记账，先裁后替会让账面与实付的字节数不符
    //（参数把正文撑长的那部分本来就该算进预算）。
    // 权限联动（§9.3）在成功触发的那一刻登记：拒绝路径不给任何工具面改动。
    this.grantSkillScope(skillInvokeName(entry), entry.frontmatter);
    return {
      ok: true,
      output: clampSkillBody(
        substituteVars(entry.body, { ...this.substitutionFor(entry), args: argsString }),
        SKILL_REMOUNT_TOKENS_PER_SKILL,
        skillRecallSuffix(entry.path, this.opts.workspace)),
    };
  }

  /** 压缩后重挂（从事件流投影激活记录）。 */
  remountFromEvents(events: AgentEvent[]): RemountResult {
    const activated = activationsFromEvents(events, (invoke, callArgs) => {
      const all = this.skills();
      const hit = resolveSkillName(invoke, all);
      if (!hit) return null;
      const entry = all.find((s) => s.plugin === hit.plugin && s.name === hit.name)!;
      // 重挂必须重放**当年那次调用的参数**：激活记录只存名字，参数在 tool_call 事件里；
      // 不传就会把一份已经替换过的正文重挂成带裸 $ARGUMENTS 的原始模板（同一 skill 两次进上下文内容不同）。
      return { body: substituteVars(entry.body, { ...this.substitutionFor(entry), args: callArgs }) };
    });
    const excluded = new Set<number>();
    for (const e of events) {
      if (e.type === "compaction" && isNumericCompaction(e)) for (const id of e.compressed_event_ids) excluded.add(id);
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
          // 声明数与已注册进运行时的数分开报：只看 lsp 就是"装载即陈列"的老口径（面板撒谎的形状）。
          // 注意这是"已注册"，不是"已起进程"——LSP 总开关（.agent/lsp.json）关着时注册了也不启动。
          lspActive: this.lspServerIds.filter((id) => id.startsWith(p.name + ":")).length,
        },
        skills: p.skills.map((sk) => ({ name: sk.name, invoke: skillInvokeName(sk), description: sk.description })),
        commands: p.commands.map((c) => ({ name: c.name, invoke: commandInvokeName(c), description: c.description })),
        userConfig: (() => {
          const read = this.userConfigs.get(p.name);
          return p.userConfigFields.map((f) => ({
            key: f.key,
            type: f.type,
            ...(f.title !== undefined ? { title: f.title } : {}),
            ...(f.description !== undefined ? { description: f.description } : {}),
            required: f.required,
            sensitive: f.sensitive,
            hasValue: read?.values[f.key] !== undefined,
            missing: read?.missing.includes(f.key) === true,
          }));
        })(),
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
      toolScopes: this.skillScopeSnapshot(),
      errors: this.manifest.errors,
      warnings: this.manifest.warnings,
    };
  }

  async shutdown(): Promise<void> {
    await this.mcp.disconnectAll();
    // LSP 注册表与会话同生命周期（TOOLS 摘除同族）：不清零的话下一个会话会继承上一个插件的服务器，
    // 而那个插件的目录可能已经被卸载——pickServerForFile 会挑到一个不存在的 command。
    unregisterPluginLspServers(this.opts.workspace, this.lspServerIds);
    await closePluginLspClients(this.opts.workspace, this.lspServerIds);
    this.lspServerIds = [];
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
