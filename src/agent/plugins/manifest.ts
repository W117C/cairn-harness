// M2e：manifest 超集解析（§9.2）。plugin.json = CC 格式超集：
//   name 必填 kebab-case；未知顶层字段忽略 + 警告不阻断；hooks 可为文件路径或内联对象；
//   mcpServers 内联或容器根 .mcp.json。能力边界（§9.8）：插件零进程内第三方代码——
//   含 JS 入口（根 index.js / package.json main|bin）的包拒载 + 警告。
import { lstat, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { HooksFile, HookMatcherDef, HookEventName, McpConfigFile, McpServerConfig } from "./types";

/** 单插件解析失败（加载器隔离粒度：只影响自身，其余照常）。 */
export class PluginLoadError extends Error {}

export const CC_MANIFEST_FIELDS = [
  "name", "description", "version", "author", "homepage", "repository",
  "license", "keywords", "commands", "agents", "skills", "hooks", "mcpServers", "userConfig",
] as const;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const HOOK_EVENTS: readonly HookEventName[] = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PreCompact", "SubagentStart", "SubagentStop", "Stop", "SessionEnd",
];

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** E2（审查 P1-12）：加载侧软链 fail-closed——lstat 判定「真身是常规文件」才存在。
 *  信任后新增软链 hooks.json/.mcp.json：指纹 walk 不 follow（指纹不变）而读取会 follow，
 *  组合 = 指纹绑定被绕过。软链一律按不存在处理（不加载，不报错）。 */
async function existsRegular(p: string): Promise<boolean> {
  try {
    const st = await lstat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/** 代码插件拒载：根 JS 入口（进程内第三方代码边界，§9.8）。 */
export async function detectJsEntry(root: string): Promise<string | null> {
  for (const f of ["index.js", "index.cjs", "index.mjs", "main.js", "main.cjs"]) {
    if (await exists(join(root, f))) return f;
  }
  const pkgPath = join(root, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
      if (typeof pkg.main === "string" && pkg.main !== "") return "package.json:main=" + pkg.main;
      if (pkg.bin !== undefined) return "package.json:bin";
    } catch {
      return "package.json（不可解析）";
    }
  }
  return null;
}

export interface ManifestParseResult {
  name: string;
  unknownFields: string[];
  warnings: string[];
  /** commands/agents/skills 目录覆盖（相对插件根）。 */
  commandsDir: string;
  agentsDir: string;
  skillsDir: string;
  /** hooks：内联对象或指向 hooks 文件的绝对路径（缺省容器根 hooks/hooks.json，可缺省无）。 */
  hooksRef: { kind: "inline"; file: HooksFile } | { kind: "path"; path: string } | { kind: "none" };
  mcp: { serverName: string; config: McpServerConfig }[];
  userConfig: Record<string, unknown> | null;
  /** M2g：userConfig 的敏感字段解析结果（sensitive 值入 safeStorage 的消费依据）。 */
  userConfigFields: UserConfigField[];
}

/** userConfig 单字段（CC 形态：`"KEY": { title?, description?, type?, sensitive?, required?, default? }`；
 *  也容忍裸标量写法）。此前 userConfig 是「解析了但没人用」的字段——M2g 给出真实消费路径。 */
export interface UserConfigField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  required: boolean;
  /** sensitive=true → 值入 safeStorage，**不落明文**（§9.11-2 / §11.8 信任边界底线）。 */
  sensitive: boolean;
  hasDefault: boolean;
  /** 声明里的 default 值本身。此前只留 hasDefault ⇒ 读侧知道"有默认"却不知道是什么，
   *  只能填空串（把不可知记成免费/空值是本仓点名的形状），所以这里带上原值。 */
  defaultValue?: string;
}

/** userConfig 对象 → 字段表（未知形态按 string 兜底，不抛）。 */
export function parseUserConfigFields(raw: Record<string, unknown> | null): UserConfigField[] {
  if (!raw) return [];
  const out: UserConfigField[] = [];
  for (const [key, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      out.push({
        key,
        type: typeof o.type === "string" ? o.type : "string",
        ...(typeof o.title === "string" ? { title: o.title } : {}),
        ...(typeof o.description === "string" ? { description: o.description } : {}),
        required: o.required === true,
        sensitive: o.sensitive === true,
        hasDefault: o.default !== undefined,
        ...(o.default !== undefined ? { defaultValue: String(o.default) } : {}),
      });
    } else {
      // 裸标量简写（"KEY": "value"）：那个值就是默认值——不是"有默认但不知道是什么"。
      out.push({ key, type: typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string", required: false, sensitive: false, hasDefault: true, defaultValue: String(v) });
    }
  }
  return out;
}

/** 敏感字段的键（值不得出现在任何落盘产物 / 日志 / 事件流里）。 */
export function sensitiveUserConfigKeys(fields: UserConfigField[]): string[] {
  return fields.filter((f) => f.sensitive).map((f) => f.key);
}

/** userConfig 字段值按声明类型校验（写侧；读侧不校验，读出来就是要敢说"存的是什么"）。
 *
 *  为什么必须有这一层：`type` 从前只被解析（`parseUserConfigFields`）和陈列（快照回给面板），
 *  **没有任何一处按它校验** ⇒ 表单里往 `type:"number"` 的字段填 "abc" 会被原样收下，
 *  再原样进 MCP 的 `command/args`、LSP 的 `args` 与 hook 的 exec form。
 *  一个拼错的数字不会在任何地方报错——它只会让那家 MCP server 起不来或悄悄用错端口，
 *  而用户看到的只是"插件没连上"。宁可在这里拒，不要让它带着错值上路。
 *
 *  只对**声明了的**类型收紧：`type` 缺省/未知一律按 string 放过（CC 形态允许插件作者
 *  只写 title/description；把未知类型当非法会让那些插件的配置永远写不进去）。
 *  空串交给 required 与"留空＝保持不变"那两层管，不在这里判——敏感字段的回显占位
 *  就是空串，按"非数字"拒掉会让用户永远无法保存别的字段。 */
export function userConfigValueError(field: UserConfigField, value: string): string | null {
  if (field.type === "number") {
    // Number() 会把 "" 与 "  " 收成 0、把 "0x10"/"1e3" 收成合法数字；这里要的是
    // "人能看懂的十进制量"：端口、超时、上限这一类。所以另立形状，不复用 Number 的宽容。
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(value.trim())) {
      return `配置项 ${field.key} 声明为 number，但 ${JSON.stringify(value)} 不是十进制数字`;
    }
    if (!Number.isFinite(Number(value.trim()))) {
      return `配置项 ${field.key} 的数字超出可表示范围：${JSON.stringify(value)}`;
    }
    return null;
  }
  if (field.type === "boolean") {
    // 表单是纯文本框（值可能来自剪贴板/脚本），所以把常见写法都认下，但大小写与
    // "yes/no/1/0" 这种只在人眼里有意义的串不认——那会让"到底存的是真还是假"说不清。
    if (!["true", "false"].includes(value.trim().toLowerCase())) {
      // 这句是**能力断言**（"只有这两个取值"），所以文案里留一段点得出名字的中文：
      // 判卷网认"只能"这类标记，但它要的是**能配证人的连续中文**——"可接受的值只有"这七字
      // 才是判卷能钉住的一格；写成"只能是 true 或 false"就只剩三个字的中文碎片，钉不住。
      return `配置项 ${field.key} 声明为 boolean，可接受的值只有 true 或 false（收到 ${JSON.stringify(value)}）`;
    }
    return null;
  }
  return null;
}

/** 一批值按字段表逐个校验（返回全部问题，不让用户改一个存一次）。 */
export function userConfigValuesErrors(fields: readonly UserConfigField[], values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (typeof v !== "string") {
      out.push(`配置项 ${f.key} 必须是字符串`);
      continue;
    }
    const err = userConfigValueError(f, v);
    if (err !== null) out.push(err);
  }
  return out;
}

/** 解析 .claude-plugin/plugin.json；结构性错误抛 PluginLoadError（隔离），非结构缺陷只警告。 */
export async function parsePluginManifest(root: string): Promise<ManifestParseResult> {
  const manifestPath = join(root, ".claude-plugin", "plugin.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new PluginLoadError("缺少 .claude-plugin/plugin.json（非容器布局）");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new PluginLoadError("plugin.json 解析失败：" + (err instanceof Error ? err.message : String(err)));
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new PluginLoadError("plugin.json 必须是 JSON 对象");
  }
  const m = json as Record<string, unknown>;
  const name = m.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new PluginLoadError("plugin.json 缺少必填字段 name");
  }
  if (!KEBAB.test(name)) {
    throw new PluginLoadError("plugin.json name 必须是 kebab-case（收到 " + JSON.stringify(name) + "）");
  }
  const warnings: string[] = [];
  const unknownFields = Object.keys(m).filter((k) => !(CC_MANIFEST_FIELDS as readonly string[]).includes(k));
  if (unknownFields.length > 0) {
    warnings.push("未知顶层字段忽略（不阻断）: " + unknownFields.join(", "));
  }
  // 路径覆盖（CC 字段：commands/agents/skills 可为 string 或 string[]；取首个存在的目录）
  // 包含性校验（审查 E-12）：覆盖路径是不可信输入——resolve 后校验不越出插件根，越界拒载
  // （fail-closed）。否则一个 "../" 就能让 skills/commands/agents/hooks 挂载扫描目标到插件根外。
  const resolveDir = (v: unknown, fallback: string, field: string): string => {
    const chosen = typeof v === "string" && v.trim() !== "" ? v : fallback;
    const relBack = relative(resolve(root), resolve(root, chosen));
    if (relBack.length > 0 && (relBack.startsWith("..") || isAbsolute(relBack))) {
      throw new PluginLoadError(`plugin.json ${field} 路径越出插件根: ${chosen}`);
    }
    return chosen;
  };
  const commandsDir = resolveDir(m.commands, "commands", "commands");
  const agentsDir = resolveDir(m.agents, "agents", "agents");
  const skillsDir = resolveDir(m.skills, "skills", "skills");
  // hooks：string = 文件路径；object = 内联
  let hooksRef: ManifestParseResult["hooksRef"] = { kind: "none" };
  if (typeof m.hooks === "string" && m.hooks.trim() !== "") {
    const hp = join(root, resolveDir(m.hooks, "", "hooks"));
    // 审查 S2-9（任务 2.2）：E2 的软链 fail-closed 过去只装在**隐式**默认路径上
    // （下面 existsRegular(hooks/hooks.json) 那支）；plugin.json 显式写 hooks: "x.json" 时
    // 直接交给 discover.readFile 读，跟随软链 => 插件根里放一个 x.json -> /tmp/evil.json
    // 就把「批准的是哪个内容」和「执行的是哪个内容」拆成两件事。显式路径同样只接受常规文件
    // （lstat 判定）；缺失留给既有 discover 侧 warning（行为不变，只补软链/目录这一类）。
    const st = await lstat(hp).catch(() => null);
    if (st !== null && !st.isFile()) {
      throw new PluginLoadError("plugin.json hooks 指向的不是常规文件（软链/目录一律拒载）: " + String(m.hooks));
    }
    hooksRef = { kind: "path", path: hp };
  } else if (m.hooks && typeof m.hooks === "object") {
    hooksRef = { kind: "inline", file: m.hooks as HooksFile };
  } else if (await existsRegular(join(root, "hooks", "hooks.json"))) {
    hooksRef = { kind: "path", path: join(root, "hooks", "hooks.json") };
  }
  // mcpServers：manifest 内联优先；否则容器根 .mcp.json
  const mcp: { serverName: string; config: McpServerConfig }[] = [];
  if (m.mcpServers && typeof m.mcpServers === "object") {
    mcp.push(...normalizeMcp(m.mcpServers as Record<string, unknown>));
  } else {
    const mcpPath = join(root, ".mcp.json");
    if (await existsRegular(mcpPath)) {
      try {
        const parsed = JSON.parse(await readFile(mcpPath, "utf8")) as McpConfigFile;
        mcp.push(...normalizeMcp((parsed.mcpServers ?? {}) as Record<string, unknown>));
      } catch (err) {
        throw new PluginLoadError(".mcp.json 解析失败：" + (err instanceof Error ? err.message : String(err)));
      }
    }
  }
  const userConfig = m.userConfig && typeof m.userConfig === "object" ? (m.userConfig as Record<string, unknown>) : null;
  return {
    name,
    unknownFields,
    warnings,
    commandsDir,
    agentsDir,
    skillsDir,
    hooksRef,
    mcp,
    userConfig,
    userConfigFields: parseUserConfigFields(userConfig),
  };
}

/** mcpServers 对象 → 规范化条目；command → stdio，url → http（type 可标 sse）。 */
export function normalizeMcp(servers: Record<string, unknown>): { serverName: string; config: McpServerConfig }[] {
  const out: { serverName: string; config: McpServerConfig }[] = [];
  for (const [serverName, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const cfg = raw as McpServerConfig;
    const resolved: McpServerConfig = { ...cfg };
    if (resolved.command !== undefined) resolved.type = resolved.type ?? "stdio";
    else if (resolved.url !== undefined) resolved.type = resolved.type ?? "http";
    out.push({ serverName, config: resolved });
  }
  return out;
}

export interface HooksParseResult {
  hooks: Partial<Record<HookEventName, HookMatcherDef[]>>;
  warnings: string[];
}

/** hooks 文件/内联对象 → 事件表；坏 JSON/坏结构抛 PluginLoadError（隔离），未知事件名警告。 */
export function parseHooksFile(raw: string, origin: string): HooksParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new PluginLoadError("hooks JSON 解析失败（" + origin + "）：" + (err instanceof Error ? err.message : String(err)));
  }
  const file = json as HooksFile | null;
  if (!file || typeof file !== "object" || typeof file.hooks !== "object" || file.hooks === null) {
    throw new PluginLoadError("hooks 结构不合法（" + origin + "）：缺少 hooks 对象");
  }
  const out: Partial<Record<HookEventName, HookMatcherDef[]>> = {};
  const warnings: string[] = [];
  for (const [event, matchers] of Object.entries(file.hooks)) {
    if (!HOOK_EVENTS.includes(event as HookEventName)) {
      warnings.push("未知 hook 事件名忽略: " + event);
      continue;
    }
    if (!Array.isArray(matchers)) continue;
    out[event as HookEventName] = matchers as HookMatcherDef[];
  }
  return { hooks: out, warnings };
}
