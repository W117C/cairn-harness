// 外部 harness 的**声明式**插件来源（opencode / pi）。只导入 skills / commands / agents：
// 两家都遵循 Agent Skills 规范，commands/agents 也都是 markdown+frontmatter；进程内代码插件
// （opencode 的 plugins/、pi 的 extensions/）不在这里导入——能力边界见 manifest.ts 的 §9.8。
//
// 每个来源合成一支 DiscoveredPlugin：命名空间 = `<kind>-<scope>`，信任门与容器插件同一道
// （project 走 trustStatus，user 恒 trusted），指纹只算**被导入的目录**——根目录下不导入的
// 代码插件改了不该让用户重批一次。
import { join } from "node:path";
import { TOOL_NAMES } from "../../tools/base";
import { dirExists, readAgentEntries, readCommandEntries, readSkillEntries } from "./content";
import { pluginFingerprintSubsetEx } from "./trust";
import type {
  AgentRoleEntry, DiscoveredPlugin, ForeignSource, ForeignSourceKind, PluginsManifest,
} from "./types";

export type { ForeignSource, ForeignSourceKind } from "./types";

interface ForeignLayout {
  skills: string;
  commands?: string;
  agents?: string;
  /** 该生态的进程内代码插件目录（存在即提醒「没导入」）。 */
  codePlugins: string;
}

export const FOREIGN_LAYOUTS: Readonly<Record<ForeignSourceKind, ForeignLayout>> = {
  opencode: { skills: "skills", commands: "command", agents: "agent", codePlugins: "plugins" },
  pi: { skills: "skills", commands: "prompts", codePlugins: "extensions" },
};

/** 默认来源：**项目级恒扫**（`<ws>/.opencode`、`<ws>/.pi`）；用户级只在显式给出 home 时加入
 *  （`~/.config/opencode`、`~/.pi/agent`）。生产装配面传 home；库的其它调用方（判卷/脚本）
 *  不传 home 就只扫项目级——否则测试结果会取决于跑测试那台机器的 home。 */
export function defaultForeignSources(workspace: string, home?: string): ForeignSource[] {
  const sources: ForeignSource[] = [
    { kind: "opencode", root: join(workspace, ".opencode"), scope: "project", name: "opencode-project" },
    { kind: "pi", root: join(workspace, ".pi"), scope: "project", name: "pi-project" },
  ];
  if (home !== undefined) {
    sources.push(
      { kind: "opencode", root: join(home, ".config", "opencode"), scope: "user", name: "opencode-user" },
      { kind: "pi", root: join(home, ".pi", "agent"), scope: "user", name: "pi-user" },
    );
  }
  return sources;
}

/** opencode 工具名 → 本仓工具名。未知名字在**白名单**语义下会让角色被跳过（宁可不导入，
 *  也不按比申报更宽的工具面跑）；在剔除语义下忽略即可（本仓没有这个工具，剔它无害）。 */
const OPENCODE_TOOL_ALIAS: Readonly<Record<string, string>> = {
  bash: "run_shell", read: "read_file", write: "write_file", edit: "edit_file",
  grep: "grep", glob: "glob", lsp: "lsp", webfetch: "web_fetch",
};

const CAIRN_TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_NAMES);

function mapTool(name: string): string | null {
  const mapped = OPENCODE_TOOL_ALIAS[name] ?? name;
  return CAIRN_TOOL_NAMES.has(mapped) ? mapped : null;
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
    const mapped = mapTool(tool);
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
        const mapped = mapTool(name);
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
        const mapped = mapTool(name);
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

  const relDirs: string[] = [];
  for (const dir of [layout.skills, layout.commands, layout.agents]) {
    if (dir !== undefined && (await dirExists(join(source.root, dir)))) relDirs.push(dir);
  }
  if (relDirs.length === 0) return { plugin: null, errors, warnings };

  const skills = await readSkillEntries(source.root, layout.skills, source.name);
  const commands = layout.commands === undefined
    ? []
    : await readCommandEntries(source.root, layout.commands, source.name);
  const rawAgents = layout.agents === undefined
    ? []
    : await readAgentEntries(source.root, layout.agents, source.name);
  const agents: AgentRoleEntry[] = [];
  for (const entry of rawAgents) {
    const mapped = source.kind === "opencode" ? mapOpencodeAgent(entry, warn) : entry;
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
  if (await dirExists(join(source.root, layout.codePlugins))) {
    warn("检测到 " + source.kind + " 的代码插件目录 " + layout.codePlugins + "/；声明式导入不包含进程内代码插件（属第 2 层）");
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
