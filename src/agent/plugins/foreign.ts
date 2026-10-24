// 外部 harness 的**声明式**插件来源（opencode / pi / codex / qoder / claude）。
// 只导入 skills / commands / agents：五家都遵循 Agent Skills 规范，命令与角色都是 markdown+frontmatter；
// 进程内代码插件（opencode 的 plugins/、pi 的 extensions/）不在这里导入——能力边界见 manifest.ts 的 §9.8。
//
// 每个来源合成一支 DiscoveredPlugin：命名空间 = `<kind>-<scope>`，信任门与容器插件同一道
// （project 走 trustStatus，user 恒 trusted），指纹只算**被导入的目录**——根目录下不导入的
// 代码插件改了不该让用户重批一次。
import { join } from "node:path";
import { isKnownToolName } from "../../permissions/tool-registry";
import {
  dirExists, readAgentEntries, readCommandEntries, readCommandEntriesDeep, readSkillEntries,
} from "./content";
import { pluginFingerprintSubsetEx } from "./trust";
import type {
  AgentRoleEntry, DiscoveredPlugin, ForeignSource, ForeignSourceKind, PluginsManifest,
} from "./types";

export type { ForeignSource, ForeignSourceKind } from "./types";

interface ForeignLayout {
  skills: string;
  commands?: string;
  /** Claude / Qoder 的命令目录允许 `commands/<ns>/<name>.md`。 */
  commandsRecursive?: boolean;
  agents?: string;
  /** 该生态的 always-on 规则目录（Cairn 没有对应内容类型 ⇒ 只提醒没导入）。 */
  rules?: string;
  /** 该生态的进程内代码插件目录（存在即提醒「没导入」）。 */
  codePlugins?: string;
  /** 该生态的声明式插件容器根（存在即提醒「本适配器不扫容器」）。 */
  pluginContainers?: string;
}

export const FOREIGN_LAYOUTS: Readonly<Record<ForeignSourceKind, ForeignLayout>> = {
  opencode: { skills: "skills", commands: "command", agents: "agent", codePlugins: "plugins" },
  pi: { skills: "skills", commands: "prompts", codePlugins: "extensions" },
  // Codex 的根是 `<ws>/.agents` / `~/.agents`，技能在其 skills/ 下；没有声明式命令/角色目录。
  codex: { skills: "skills" },
  qoder: { skills: "skills", commands: "commands", commandsRecursive: true, agents: "agents", rules: "rules" },
  claude: { skills: "skills", commands: "commands", commandsRecursive: true, agents: "agents", pluginContainers: "plugins" },
};

/** 默认来源：**项目级恒扫**；用户级只在显式给出 home 时加入（生产装配面传 home）。
 *  库的其它调用方（判卷/脚本）不传 home 就只扫项目级——否则测试结果会取决于跑测试那台机器的 home。 */
export function defaultForeignSources(workspace: string, home?: string): ForeignSource[] {
  const sources: ForeignSource[] = [
    { kind: "opencode", root: join(workspace, ".opencode"), scope: "project", name: "opencode-project" },
    { kind: "pi", root: join(workspace, ".pi"), scope: "project", name: "pi-project" },
    { kind: "codex", root: join(workspace, ".agents"), scope: "project", name: "codex-project" },
    { kind: "qoder", root: join(workspace, ".qoder"), scope: "project", name: "qoder-project" },
    { kind: "claude", root: join(workspace, ".claude"), scope: "project", name: "claude-project" },
  ];
  if (home !== undefined) {
    sources.push(
      { kind: "opencode", root: join(home, ".config", "opencode"), scope: "user", name: "opencode-user" },
      { kind: "pi", root: join(home, ".pi", "agent"), scope: "user", name: "pi-user" },
      { kind: "codex", root: join(home, ".agents"), scope: "user", name: "codex-user" },
      { kind: "qoder", root: join(home, ".qoder"), scope: "user", name: "qoder-user" },
      { kind: "claude", root: join(home, ".claude"), scope: "user", name: "claude-user" },
    );
  }
  return sources;
}

/** opencode 工具名 → 本仓工具名。 */
const OPENCODE_TOOL_ALIAS: Readonly<Record<string, string>> = {
  bash: "run_shell", read: "read_file", write: "write_file", edit: "edit_file",
  grep: "grep", glob: "glob", lsp: "lsp", webfetch: "web_fetch",
};

/** Claude / Qoder 的 agent `tools` 用 CC 风格的大写名（Read/Grep/Bash…）；按小写归一。
 *  与 tools/base.ts 的 `CC_TOOL_ALIAS` 同向，但这里还覆盖 Grep/Glob/WebFetch/WebSearch。 */
const CC_TOOL_ALIAS: Readonly<Record<string, string>> = {
  read: "read_file", write: "write_file", edit: "edit_file", multiedit: "edit_file",
  bash: "run_shell", grep: "grep", glob: "glob", lsp: "lsp",
  webfetch: "web_fetch", websearch: "web_search",
};

function mapNamedTool(name: string, alias: Readonly<Record<string, string>>): string | null {
  const raw = name.trim();
  // MCP 工具名大小写敏感，原样交给统一注册表的判定；CC/opencode 名字按小写归一。
  if (raw.startsWith("mcp__")) return isKnownToolName(raw) ? raw : null;
  const mapped = alias[raw.toLowerCase()] ?? raw.toLowerCase();
  return isKnownToolName(mapped) ? mapped : null;
}

/** 解析一个工具清单字段：字符串（逗号分隔）或数组；其他形状 = 无法读取。 */
function parseToolList(raw: unknown): string[] | null {
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") return null;
      if (v.trim() !== "") out.push(v.trim());
    }
    return out;
  }
  return null;
}

/** Claude / Qoder agent 的工具面归一化：CC 风格名字映射到本仓工具名。
 *  白名单含本仓没有的工具 ⇒ 跳过角色（收窄不全会让工具面变宽）；剔除面里的未知名字无害。 */
function mapCcAgent(entry: AgentRoleEntry, warn: (message: string) => void): AgentRoleEntry | null {
  const fm: Record<string, unknown> = { ...entry.frontmatter };
  const allow = new Set<string>();
  let allowDeclared = false;
  let allowAll = false;
  for (const field of ["tools", "allowed-tools"] as const) {
    if (fm[field] === undefined) continue;
    allowDeclared = true;
    const list = parseToolList(fm[field]);
    if (list === null) {
      warn("agent「" + entry.name + "」的 " + field + " 不是字符串/数组 ⇒ 无法映射工具面，跳过该角色");
      return null;
    }
    if (list.includes("*")) { allowAll = true; continue; }
    for (const name of list) {
      const mapped = mapNamedTool(name, CC_TOOL_ALIAS);
      if (mapped === null) {
        warn("agent「" + entry.name + "」的工具白名单含本仓没有的工具「" + name + "」⇒ 无法忠实收窄，跳过该角色（不按更宽的工具面导入）");
        return null;
      }
      allow.add(mapped);
    }
  }
  const deny = new Set<string>();
  for (const field of ["disallowedTools", "disallowed-tools"] as const) {
    if (fm[field] === undefined) continue;
    const list = parseToolList(fm[field]);
    if (list === null) {
      warn("agent「" + entry.name + "」的 " + field + " 不是字符串/数组 ⇒ 无法映射，跳过该角色");
      return null;
    }
    if (list.includes("*")) {
      warn("agent「" + entry.name + "」的 " + field + " 含 `*`（禁止全部工具）⇒ 无法忠实映射，跳过该角色");
      return null;
    }
    for (const name of list) {
      const mapped = mapNamedTool(name, CC_TOOL_ALIAS);
      if (mapped !== null) deny.add(mapped);
    }
  }
  if (allowDeclared && !allowAll) {
    const effective = [...allow].filter((t) => !deny.has(t));
    if (effective.length === 0 && deny.size > 0) {
      warn("agent「" + entry.name + "」的工具白名单与剔除面相交后为空 ⇒ 跳过该角色（空白名单会让执行端退回默认面）");
      return null;
    }
    fm.tools = effective;
  } else {
    delete fm.tools;
  }
  delete fm["allowed-tools"];
  if (deny.size > 0) fm.disallowedTools = [...deny];
  delete fm["disallowed-tools"];
  return { ...entry, frontmatter: fm };
}

/** opencode `permission` → 本仓 `disallowedTools`。能忠实收窄的才映射：
 *  - `deny` / `ask` 都进剔除面（ask 在本仓没有交互通道，按 deny 收窄＝fail-closed）；
 *  - `allow` 不映射（本仓角色默认面不会因此变宽）；
 *  - 通配 `"*"` 的 deny、以及按 pattern 分组的值无法忠实映射 ⇒ 返回 null（跳过角色）。
 *  返回值 = 剔除清单；null = 无法忠实映射。 */
function mapOpencodePermission(name: string, raw: unknown, warn: (message: string) => void): string[] | null {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    warn("agent「" + name + "」的 permission 不是对象 ⇒ 无法映射，跳过该角色（不静默放宽）");
    return null;
  }
  const deny: string[] = [];
  for (const [tool, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "object" && value !== null) {
      warn("agent「" + name + "」的 permission." + tool + " 是按 pattern 分组的规则 ⇒ 无法忠实映射，跳过该角色");
      return null;
    }
    if (value !== "deny" && value !== "ask") continue; // allow 不映射
    if (tool === "*") {
      warn("agent「" + name + "」的 permission 对全部工具 deny/ask ⇒ 无法忠实映射，跳过该角色");
      return null;
    }
    const mapped = mapNamedTool(tool, OPENCODE_TOOL_ALIAS);
    if (mapped !== null) deny.push(mapped);
  }
  if (deny.length > 0) {
    warn("agent「" + name + "」的 opencode permission 已映射为 disallowedTools=[" + deny.join(",") +
      "]（ask 按 deny 收窄；allow 未映射）");
  }
  return deny;
}

/** opencode agent 的 frontmatter → Cairn 可执行的角色定义。返回 null = 无法忠实映射，跳过。
 *  两条硬口径：
 *   - `mode: primary` 是主 agent，不是可派活的子角色 ⇒ 跳过；
 *   - `tools` 若声明了白名单（`"*": false`）而含本仓没有的工具 ⇒ 跳过（白名单落不全 = 工具面变宽）。 */
function mapOpencodeAgent(entry: AgentRoleEntry, warn: (message: string) => void): AgentRoleEntry | null {
  const fm: Record<string, unknown> = { ...entry.frontmatter };
  if (fm.mode === "primary") {
    warn("agent「" + entry.name + "」是 opencode 主 agent（mode: primary），不是可派活的子角色 ⇒ 跳过");
    return null;
  }
  const permissionDeny = mapOpencodePermission(entry.name, fm.permission, warn);
  if (permissionDeny === null) return null;
  delete fm.permission;
  const denied = new Set<string>(permissionDeny);

  const rawTools = fm.tools;
  if (rawTools !== undefined && typeof rawTools === "object" && !Array.isArray(rawTools)) {
    const map = rawTools as Record<string, unknown>;
    const entries = Object.keys(map).filter((k) => k !== "*");
    if (map["*"] === false) {
      const allow: string[] = [];
      const missing: string[] = [];
      for (const name of entries) {
        if (map[name] !== true) continue;
        const mapped = mapNamedTool(name, OPENCODE_TOOL_ALIAS);
        if (mapped === null) missing.push(name);
        else allow.push(mapped);
      }
      if (missing.length > 0) {
        warn("agent「" + entry.name + "」的 tools 白名单含本仓没有的工具（" + missing.join("、") +
          "）⇒ 无法忠实收窄，跳过该角色（不按更宽的工具面导入）");
        return null;
      }
      const allowed = allow.filter((t) => !denied.has(t));
      if (allowed.length === 0 && denied.size > 0) {
        warn("agent「" + entry.name + "」的 tools 白名单与 permission 收窄后为空 ⇒ 跳过该角色（空白名单会让执行端退回默认面）");
        return null;
      }
      fm.tools = allowed;
    } else {
      const deny = new Set(denied);
      for (const name of entries) {
        if (map[name] !== false) continue;
        const mapped = mapNamedTool(name, OPENCODE_TOOL_ALIAS);
        if (mapped !== null) deny.add(mapped);
      }
      if (deny.size > 0) fm.disallowedTools = [...deny];
      delete fm.tools;
    }
  } else if (denied.size > 0) {
    fm.disallowedTools = [...denied];
  }

  // 不映射的 opencode 专有字段：删掉，避免它们落进 `resolvePluginRole` 的「不认识」警告，
  // 但必须在这里出声——收下不兑现而不吭声就是把假承诺写进用户的配置文件。
  const dropped = ["mode", "temperature", "hidden", "color"].filter((k) => fm[k] !== undefined);
  for (const k of dropped) delete fm[k];
  if (dropped.length > 0) {
    warn("agent「" + entry.name + "」的 opencode 字段 " + dropped.join("/") + " 不映射（角色正文、model 与工具面照常）");
  }
  return { ...entry, frontmatter: fm };
}

function mapAgent(source: ForeignSourceKind, entry: AgentRoleEntry, warn: (message: string) => void): AgentRoleEntry | null {
  if (source === "opencode") return mapOpencodeAgent(entry, warn);
  if (source === "qoder" || source === "claude") return mapCcAgent(entry, warn);
  return entry;
}

/** pi prompt template 支持 `${1:-默认}` / `${@:N}` 这类 shell 风格参数；本仓替换器不认，
 *  会原样保留。装载期点出来，别让作者以为它生效了。 */
const PI_UNSUPPORTED_SUBSTITUTION = /\$(?:@|\{(?:@|\d+):[^}]*\})/;

export async function scanForeignSource(
  source: ForeignSource,
  trustOf: (absRoot: string, fingerprint: string, bounded: boolean) => "trusted" | "pending" | "declined",
): Promise<{ plugin: DiscoveredPlugin | null; errors: PluginsManifest["errors"]; warnings: PluginsManifest["warnings"] }> {
  const errors: PluginsManifest["errors"] = [];
  const warnings: PluginsManifest["warnings"] = [];
  const warn = (message: string): void => { warnings.push({ plugin: source.name, message }); };
  const layout = FOREIGN_LAYOUTS[source.kind];
  // `~/.claude/agents` 已由 user-agents.ts 走 `user:<name>` 通道导入；这里不重复产一份。
  const agentsDir = source.kind === "claude" && source.scope === "user" ? undefined : layout.agents;

  const relDirs: string[] = [];
  for (const dir of [layout.skills, layout.commands, agentsDir]) {
    if (dir !== undefined && (await dirExists(join(source.root, dir)))) relDirs.push(dir);
  }
  if (relDirs.length === 0) return { plugin: null, errors, warnings };

  const skills = await readSkillEntries(source.root, layout.skills, source.name);
  const commands = layout.commands === undefined
    ? []
    : layout.commandsRecursive
      ? await readCommandEntriesDeep(source.root, layout.commands, source.name)
      : await readCommandEntries(source.root, layout.commands, source.name);
  const rawAgents = agentsDir === undefined ? [] : await readAgentEntries(source.root, agentsDir, source.name);
  const agents: AgentRoleEntry[] = [];
  for (const entry of rawAgents) {
    const mapped = mapAgent(source.kind, entry, warn);
    if (mapped !== null) agents.push(mapped);
  }

  if (source.kind === "pi") {
    for (const cmd of commands) {
      if (PI_UNSUPPORTED_SUBSTITUTION.test(cmd.body)) {
        warn("命令「" + cmd.name + "」使用了 pi 的 ${1:-默认} / ${@:N} 参数语法；本仓替换器不支持，运行时会原样保留");
      }
    }
  }
  if (source.kind === "opencode") {
    for (const cmd of commands) {
      const dropped = ["agent", "model", "subtask"].filter((k) => cmd.frontmatter[k] !== undefined);
      if (dropped.length > 0) {
        warn("命令「" + cmd.name + "」的 opencode 字段 " + dropped.join("/") + " 不映射（命令只按模板正文展开）");
      }
    }
  }
  if (layout.rules !== undefined && (await dirExists(join(source.root, layout.rules)))) {
    warn("检测到 " + layout.rules + "/（始终生效规则）；Cairn 没有 always-on rule 内容类型 ⇒ 未导入，可改写为 skill");
  }
  if (layout.codePlugins !== undefined && (await dirExists(join(source.root, layout.codePlugins)))) {
    warn("检测到 " + source.kind + " 的代码插件目录 " + layout.codePlugins + "/；声明式导入不包含进程内代码插件（属第 2 层）");
  }
  if (layout.pluginContainers !== undefined && (await dirExists(join(source.root, layout.pluginContainers)))) {
    warn("检测到 " + layout.pluginContainers + "/ 插件容器根；本适配器只导入 skills/commands/agents，容器插件请放到 .agent/plugins");
  }

  const { fp, bounded } = await pluginFingerprintSubsetEx(source.root, relDirs);
  if (bounded) warn("内容指纹不完整（含软链 / 超出上限 / 有文件读不出）⇒ 不可批准（fail-closed）；请改成普通文件布局");
  const trust = source.scope === "user" ? "trusted" : trustOf(source.root, fp, bounded);

  return {
    plugin: {
      name: source.name,
      scope: source.scope,
      root: source.root,
      manifest: {},
      skills,
      commands,
      agents,
      hooks: [],
      mcp: [],
      lsp: {},
      unknownFields: [],
      userConfigFields: [],
      errors: [],
      warnings: [],
      trust,
    },
    errors,
    warnings,
  };
}
