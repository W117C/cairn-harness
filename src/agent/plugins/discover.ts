// M2e：容器发现（§9.1–9.2）。三级作用域扫描：
//   user    = <appData>/plugins/ 下每个子目录（容器或散装 skill）
//   project = <workspace>/.agent/plugins/（首次加载出信任卡）
//   loose   = 显式给出的散装 skill 根（foo/SKILL.md 无 manifest = 独立 skill，免包装加载）
// 会话启动静态扫描产「加载清单」（不新增事件类型）；单插件失败隔离：坏 manifest/坏 hook JSON
// 只影响自身（errors 聚合 + 面板报错），其余照常。
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, fmString } from "./frontmatter";
import { pluginFingerprintEx } from "./trust";
import { parsePluginManifest, parseHooksFile, detectJsEntry, PluginLoadError } from "./manifest";
import { parseHookIf } from "./hooks";
import type {
  DiscoveredPlugin, LooseSkill, PluginScope, PluginsManifest, SkillEntry, PromptCommandEntry,
  AgentRoleEntry, LoadedHookDef, HookEventName, HookMatcherDef, LspServerConfig,
} from "./types";

async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** 扫描一个作用域根：子目录要么是容器（有 .claude-plugin/plugin.json），要么是散装 skill（有 SKILL.md）。 */
async function scanScopeRoot(
  root: string,
  scope: PluginScope,
  trustOf: (absRoot: string, fingerprint: string, bounded: boolean) => "trusted" | "pending" | "declined",
): Promise<{ plugins: DiscoveredPlugin[]; loose: LooseSkill[]; errors: PluginsManifest["errors"]; warnings: PluginsManifest["warnings"] }> {
  const plugins: DiscoveredPlugin[] = [];
  const loose: LooseSkill[] = [];
  const errors: PluginsManifest["errors"] = [];
  const warnings: PluginsManifest["warnings"] = [];
  if (!(await dirExists(root))) return { plugins, loose, errors, warnings };
  let entries: string[];
  try {
    entries = (await readdir(root)).sort();
  } catch {
    return { plugins, loose, errors, warnings };
  }
  for (const name of entries) {
    const abs = join(root, name);
    if (!(await dirExists(abs))) continue;
    const hasManifest = await dirExists(join(abs, ".claude-plugin"));
    const hasSkillMd = await stat(join(abs, "SKILL.md")).then(() => true, () => false);
    if (hasManifest) {
      try {
        // E1/E2（审查 P1-11/P1-12）+ 审查 S1-7 修正：指纹 bounded（超帽/超大/软链）不再无条件
        // 塌成 pending——那会让 decide 写下的无界条目永不命中，「批准了还弹卡」死循环。
        // bounded 位随查询一起传给信任库，编进条目键（abs@fp+b）：批准一次即对该形态生效，
        // 内容有界/无界形态互换或指纹变化都自然不命中 = 重新出卡。
        const { fp, bounded } = await pluginFingerprintEx(abs);
        plugins.push(await loadContainer(abs, scope, trustOf(abs, fp, bounded)));
      } catch (err) {
        // 单插件失败隔离：坏 manifest 只影响自身
        errors.push({ plugin: name, message: err instanceof Error ? err.message : String(err) });
      }
    } else if (hasSkillMd) {
      // 散装 skill：免包装（无 manifest = 独立 skill）。
      // E3（审查 P1-13）：项目作用域 loose skill 同走信任门——frontmatter description 随路由
      // 清单直进 system prompt = 注入面，克隆仓库放一个 SKILL.md 不许免审批；免信任只保留给
      // 显式 looseRoots 与用户级安装（两处的 trustOf 恒 trusted）。
      const { fp, bounded } = await pluginFingerprintEx(abs);
      const entry = await loadSkillEntry(null, name, abs);
      if (entry) loose.push({ name, root: abs, entry, trust: trustOf(abs, fp, bounded) });
    }
  }
  return { plugins, loose, errors, warnings };
}

/** 装载一个容器插件；任何结构性错误抛 PluginLoadError（由调用方隔离）。 */
async function loadContainer(
  root: string,
  scope: PluginScope,
  trust: "trusted" | "pending" | "declined",
): Promise<DiscoveredPlugin> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const jsEntry = await detectJsEntry(root);
  if (jsEntry) {
    // 代码插件拒载 + 警告（能力边界：插件零进程内第三方代码）
    throw new PluginLoadError("代码插件拒载（能力边界：插件零进程内第三方代码）：检测到 JS 入口 " + jsEntry);
  }
  const m = await parsePluginManifest(root);
  warnings.push(...m.warnings);
  const pluginName = m.name;

  // skills/<name>/SKILL.md
  const skills: SkillEntry[] = [];
  const skillsRoot = join(root, m.skillsDir);
  if (await dirExists(skillsRoot)) {
    for (const dir of (await readdir(skillsRoot)).sort()) {
      const abs = join(skillsRoot, dir);
      if (!(await dirExists(abs))) continue;
      const entry = await loadSkillEntry(pluginName, dir, abs);
      if (entry) skills.push(entry);
    }
  }

  // commands/*.md
  const commands: PromptCommandEntry[] = [];
  const commandsRoot = join(root, m.commandsDir);
  if (await dirExists(commandsRoot)) {
    for (const f of (await readdir(commandsRoot)).sort()) {
      if (!f.endsWith(".md")) continue;
      const abs = join(commandsRoot, f);
      const text = await readFile(abs, "utf8").catch(() => "");
      const { frontmatter, body } = parseFrontmatter(text);
      commands.push({
        plugin: pluginName,
        name: f.slice(0, -3),
        description: fmString(frontmatter, "description") ?? "",
        path: abs,
        frontmatter,
        body,
      });
    }
  }

  // agents/*.md（解析并注册；采纳留 M3）
  const agents: AgentRoleEntry[] = [];
  const agentsRoot = join(root, m.agentsDir);
  if (await dirExists(agentsRoot)) {
    for (const f of (await readdir(agentsRoot)).sort()) {
      if (!f.endsWith(".md")) continue;
      const abs = join(agentsRoot, f);
      const text = await readFile(abs, "utf8").catch(() => "");
      const { frontmatter, body } = parseFrontmatter(text);
      agents.push({
        plugin: pluginName,
        name: fmString(frontmatter, "name") ?? f.slice(0, -3),
        description: fmString(frontmatter, "description") ?? "",
        path: abs,
        frontmatter,
        body,
      });
    }
  }

  // hooks
  const hooks: LoadedHookDef[] = [];
  const collectHooks = (parsed: { hooks: Partial<Record<HookEventName, HookMatcherDef[]>>; warnings: string[] }): void => {
    warnings.push(...parsed.warnings);
    hooks.push(...flattenHooks(pluginName, root, parsed.hooks));
    // §9.3 schema 警告：插件 MCP 工具必须用 scoped 形态（mcp__plugin_...），bare 名永不命中
    for (const h of hooks) {
      if (h.matcher !== undefined && /^mcp__(?!plugin_)/.test(h.matcher)) {
        warnings.push("hook matcher '" + h.matcher + "' 疑似 bare MCP 工具名——插件 MCP 工具必须写 scoped 形态（mcp__plugin_<p>_<s>__<t>），bare 名永不命中");
      }
    }
  };
  if (m.hooksRef.kind === "path") {
    try {
      const raw = await readFile(m.hooksRef.path, "utf8");
      collectHooks(parseHooksFile(raw, m.hooksRef.path));
    } catch (err) {
      // 坏 hook JSON 只影响自身（隔离），不炸整插件
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else if (m.hooksRef.kind === "inline") {
    collectHooks(parseHooksFile(JSON.stringify(m.hooksRef.file), "plugin.json:hooks"));
  }

  // .lsp.json（字段名向 CC 对齐；transport: socket 忽略 + 警告）
  const lsp: Record<string, LspServerConfig> = {};
  const lspPath = join(root, ".lsp.json");
  try {
    const raw = await readFile(lspPath, "utf8");
    const parsed = JSON.parse(raw) as { servers?: Record<string, LspServerConfig> };
    for (const [id, cfg] of Object.entries(parsed.servers ?? {})) {
      if (cfg && typeof cfg === "object" && cfg.transport === "socket") {
        warnings.push("lsp server " + id + ": transport: socket 本轮忽略（仅 stdio）");
        continue;
      }
      if (cfg && typeof cfg === "object" && typeof cfg.command === "string") {
        const KNOWN = ["command", "args", "extensionToLanguage", "initializationOptions", "startupTimeout", "restartOnCrash", "diagnostics", "transport"];
        const unknown = Object.keys(cfg).filter((k) => !KNOWN.includes(k));
        if (unknown.length > 0) warnings.push("lsp server " + id + ": 未知字段忽略（不阻断）: " + unknown.join(", "));
        // §9.8 的字段里只有这几个是运行时真正兑现的；剩下的收下不兑现 = 本仓点名的"收下即丢"，
        // 所以**当场说出来**：作者以为配了重启策略，实际崩了就崩了。
        const unhonored = [
          ...(cfg.startupTimeout !== undefined ? ["startupTimeout"] : []),
          ...(cfg.restartOnCrash !== undefined ? ["restartOnCrash"] : []),
          ...(cfg.diagnostics?.maxPerFile !== undefined ? ["diagnostics.maxPerFile"] : []),
        ];
        if (unhonored.length > 0) warnings.push("lsp server " + id + ": 这些字段本轮不生效（运行时未实现）: " + unhonored.join(", "));
        lsp[id] = cfg;
      } else {
        warnings.push("lsp server " + id + ": 缺少 command，忽略");
      }
    }
  } catch {
    /* 无 .lsp.json = 无 LSP 配置（零配置零进程） */
  }

  return {
    name: pluginName,
    scope,
    root,
    manifest: {},
    skills,
    commands,
    agents,
    hooks,
    mcp: m.mcp,
    lsp,
    unknownFields: m.unknownFields,
    userConfigFields: m.userConfigFields,
    errors,
    warnings,
    trust,
  };
}

/** 事件表 → 扁平 hook 定义列表；${user_config.*} 禁入 shell-form hook（loaded=false，调用方产警告）。 */
function flattenHooks(plugin: string, pluginRoot: string, hooks: Partial<Record<HookEventName, HookMatcherDef[]>>): LoadedHookDef[] {
  const out: LoadedHookDef[] = [];
  for (const [event, matchers] of Object.entries(hooks)) {
    for (const m of matchers ?? []) {
      for (const handler of m.hooks ?? []) {
        const shellForm = typeof handler.command === "string";
        const banned = shellForm && (handler.command as string).includes("${user_config.");
        out.push({
          plugin,
          pluginRoot,
          event: event as HookEventName,
          ...(m.matcher !== undefined ? { matcher: m.matcher } : {}),
          ...(m.if !== undefined ? { if: m.if } : {}),
          handler,
          loaded: !banned,
        });
      }
    }
  }
  return out;
}

/** 装载一个 skill 条目（容器内或散装）；frontmatter name/description 缺省回退目录名。 */
async function loadSkillEntry(plugin: string | null, dirName: string, dir: string): Promise<SkillEntry | null> {
  const path = join(dir, "SKILL.md");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { frontmatter, body } = parseFrontmatter(text);
  return {
    plugin,
    name: fmString(frontmatter, "name") ?? dirName,
    description: fmString(frontmatter, "description") ?? "",
    path,
    frontmatter,
    body,
  };
}

export interface DiscoverOptions {
  /** 用户级 <appData>/plugins/。 */
  userPluginsDir?: string;
  /** 项目级 <workspace>/.agent/plugins/。 */
  projectPluginsDir?: string;
  /** 散装 skill 根（目录下每个含 SKILL.md 的子目录 = 独立 skill）。 */
  looseRoots?: string[];
  /** 项目级插件信任决议源（缺省全部 pending）。H3-P5（E-10）：附带插件内容指纹（abs@fp 绑定）。
   *  审查 S1-7：第三参 bounded = 指纹是否被截断（超帽/超大/软链），由信任库编进条目键参与判定。 */
  trustStatus?: (absRoot: string, fingerprint: string, bounded: boolean) => "trusted" | "pending" | "declined";
}

/** 加载清单（会话启动静态扫描产物；不新增事件类型）。 */
export async function discoverPlugins(opts: DiscoverOptions): Promise<PluginsManifest> {
  const trustOf: NonNullable<DiscoverOptions["trustStatus"]> = opts.trustStatus ?? (() => "pending");
  const plugins: DiscoveredPlugin[] = [];
  const looseSkills: LooseSkill[] = [];
  const errors: PluginsManifest["errors"] = [];
  const warnings: PluginsManifest["warnings"] = [];

  if (opts.userPluginsDir) {
    const r = await scanScopeRoot(opts.userPluginsDir, "user", () => "trusted");
    plugins.push(...r.plugins);
    looseSkills.push(...r.loose);
    errors.push(...r.errors);
  }
  if (opts.projectPluginsDir) {
    const r = await scanScopeRoot(opts.projectPluginsDir, "project", trustOf);
    plugins.push(...r.plugins);
    looseSkills.push(...r.loose);
    errors.push(...r.errors);
  }
  for (const root of opts.looseRoots ?? []) {
    const r = await scanScopeRoot(root, "loose", () => "trusted");
    looseSkills.push(...r.loose);
    errors.push(...r.errors);
  }

  // 扁平化警告与 ${user_config.*} 违规提示
  for (const p of plugins) {
    for (const w of p.warnings) warnings.push({ plugin: p.name, message: w });
    for (const e of p.errors) errors.push({ plugin: p.name, message: e });
    for (const h of p.hooks) {
      if (!h.loaded) {
        warnings.push({ plugin: p.name, message: "hook 被拒载：${user_config.*} 禁入 shell-form hook（" + h.event + "）" });
      }
      // `if` 读不懂时钩子照样跑（宁多拦不漏拦），但必须出声——静默按"没写 if"处理等于偷改语义。
      if (h.if !== undefined && parseHookIf(h.if) === null) {
        warnings.push({ plugin: p.name, message: "hook 的 if 语法读不懂（" + h.event + "：" + h.if + "）⇒ 本轮按「总是跑」处理；要真硬闸请走权限规则（§9.5）" });
      }
    }
  }
  return { plugins, looseSkills, errors, warnings };
}

/** 静态扫描产出的已激活 hook 总表（仅 trusted 插件 + loaded 条目；跨层 (command+args) 去重在引擎做）。 */
export function activeHooks(manifest: PluginsManifest): LoadedHookDef[] {
  const out: LoadedHookDef[] = [];
  for (const p of manifest.plugins) {
    if (p.trust !== "trusted") continue;
    for (const h of p.hooks) if (h.loaded) out.push(h);
  }
  return out;
}

/** 未信任样本清单（信任卡数据源：只列出、不激活）。
 *  审查 S2-12（任务 4.6）：项目作用域的散装 skill 与插件同走信任门（E3），过去这个数据源
 *  只含 plugins => 待信任的 loose skill 在信任卡面上完全不存在（既列不出也决不了）。
 *  两类样本共有的是 name/root/trust 三件（决议按 root 落指纹条目），故返回联合类型。 */
export function pendingPlugins(manifest: PluginsManifest): (DiscoveredPlugin | LooseSkill)[] {
  return [...manifest.plugins.filter((p) => p.trust === "pending"), ...manifest.looseSkills.filter((l) => l.trust === "pending")];
}
