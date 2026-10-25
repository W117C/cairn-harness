// 插件内容目录的共用读取器：容器插件与外部声明式来源（opencode / pi）走同一套解析。
// 分出来是为了不出现第二份「怎么读 commands/*.md、agents/*.md」——外部来源多抄一份，
// 两边的 frontmatter 默认值（name 回退文件名、description 缺省空串）迟早漂。
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fmString, parseFrontmatter } from "./frontmatter";
import type { AgentRoleEntry, PromptCommandEntry, SkillEntry } from "./types";

export async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** 装载一个 skill 条目（容器内或散装）；frontmatter name/description 缺省回退目录名。 */
export async function loadSkillEntry(plugin: string | null, dirName: string, dir: string): Promise<SkillEntry | null> {
  const path = join(dir, "SKILL.md");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const { frontmatter, body } = parseFrontmatter(text);
  const resources = await readSkillResources(dir);
  return {
    plugin,
    name: fmString(frontmatter, "name") ?? dirName,
    description: fmString(frontmatter, "description") ?? "",
    path,
    frontmatter,
    body,
    ...(resources.length > 0 ? { resources } : {}),
  };
}

/** L2 资源索引的边界：只 stat、不读内容；不跟软链；最多 60 个。
 *  顶层只下探约定目录（references/scripts/assets/templates），顶层散文件也登记；
 *  更深层目录允许下探到 RESOURCE_MAX_DEPTH，避免把 node_modules/隐藏目录带进来。 */
const RESOURCE_MAX_FILES = 60;
const RESOURCE_MAX_DEPTH = 3;
const RESOURCE_TOP_DIRS = new Set(["references", "scripts", "assets", "templates"]);

async function readSkillResources(dir: string): Promise<{ path: string; bytes: number }[]> {
  const out: { path: string; bytes: number }[] = [];
  const walk = async (current: string, prefix: string, depth: number): Promise<void> => {
    if (out.length >= RESOURCE_MAX_FILES) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= RESOURCE_MAX_FILES) break;
      if (ent.name === "SKILL.md" || ent.name.startsWith(".") || ent.name === "node_modules") continue;
      if (ent.isSymbolicLink()) continue; // 与插件内容软链 fail-closed 口径一致
      const rel = prefix === "" ? ent.name : prefix + "/" + ent.name;
      const abs = join(current, ent.name);
      if (ent.isDirectory()) {
        if (depth === 0 && !RESOURCE_TOP_DIRS.has(ent.name)) continue;
        await walk(abs, rel, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      const st = await stat(abs).catch(() => null);
      if (st) out.push({ path: rel, bytes: st.size });
    }
  };
  await walk(dir, "", 0);
  return out;
}

/** skills/<name>/SKILL.md 整个目录的条目（目录不存在 = 空表）。 */
export async function readSkillEntries(root: string, dirName: string, plugin: string | null): Promise<SkillEntry[]> {
  const skillsRoot = join(root, dirName);
  if (!(await dirExists(skillsRoot))) return [];
  const out: SkillEntry[] = [];
  for (const dir of (await readdir(skillsRoot)).sort()) {
    const abs = join(skillsRoot, dir);
    if (!(await dirExists(abs))) continue;
    const entry = await loadSkillEntry(plugin, dir, abs);
    if (entry) out.push(entry);
  }
  return out;
}

/** commands/*.md → PromptCommandEntry（模板正文与 frontmatter 均为插件契约原样）。 */
export async function readCommandEntries(root: string, dirName: string, plugin: string | null): Promise<PromptCommandEntry[]> {
  const commandsRoot = join(root, dirName);
  if (!(await dirExists(commandsRoot))) return [];
  const out: PromptCommandEntry[] = [];
  for (const f of (await readdir(commandsRoot)).sort()) {
    if (!f.endsWith(".md")) continue;
    const entry = await readCommandFile(join(commandsRoot, f), f.slice(0, -3), plugin);
    if (entry) out.push(entry);
  }
  return out;
}

/** 递归读命令目录（Claude / Qoder 允许 `commands/<ns>/<name>.md`）。
 *  命令名取相对路径、`/` 换成 `:`：`opsx/new.md` → `opsx:new`（调用名 `/plugin:opsx:new`）。
 *  软链目录不跟随（Dirent 不是目录 ⇒ 跳过），与插件内容的软链 fail-closed 口径一致。 */
export async function readCommandEntriesDeep(root: string, dirName: string, plugin: string | null): Promise<PromptCommandEntry[]> {
  const commandsRoot = join(root, dirName);
  if (!(await dirExists(commandsRoot))) return [];
  const out: PromptCommandEntry[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, prefix + ent.name + ":");
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
      const entry = await readCommandFile(abs, prefix + ent.name.slice(0, -3), plugin);
      if (entry) out.push(entry);
    }
  };
  await walk(commandsRoot, "");
  return out;
}

async function readCommandFile(abs: string, name: string, plugin: string | null): Promise<PromptCommandEntry | null> {
  let text: string;
  try { text = await readFile(abs, "utf8"); } catch { return null; }
  const { frontmatter, body } = parseFrontmatter(text);
  return {
    plugin,
    name,
    description: fmString(frontmatter, "description") ?? "",
    path: abs,
    frontmatter,
    body,
  };
}

/** agents/*.md → AgentRoleEntry（name 缺省回退文件名）。 */
export async function readAgentEntries(root: string, dirName: string, plugin: string): Promise<AgentRoleEntry[]> {
  const agentsRoot = join(root, dirName);
  if (!(await dirExists(agentsRoot))) return [];
  const out: AgentRoleEntry[] = [];
  for (const f of (await readdir(agentsRoot)).sort()) {
    if (!f.endsWith(".md")) continue;
    const abs = join(agentsRoot, f);
    const text = await readFile(abs, "utf8").catch(() => "");
    const { frontmatter, body } = parseFrontmatter(text);
    out.push({
      plugin,
      name: fmString(frontmatter, "name") ?? f.slice(0, -3),
      description: fmString(frontmatter, "description") ?? "",
      path: abs,
      frontmatter,
      body,
    });
  }
  return out;
}
