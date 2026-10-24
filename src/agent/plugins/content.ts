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
  return {
    plugin,
    name: fmString(frontmatter, "name") ?? dirName,
    description: fmString(frontmatter, "description") ?? "",
    path,
    frontmatter,
    body,
  };
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
    const abs = join(commandsRoot, f);
    const text = await readFile(abs, "utf8").catch(() => "");
    const { frontmatter, body } = parseFrontmatter(text);
    out.push({
      plugin,
      name: f.slice(0, -3),
      description: fmString(frontmatter, "description") ?? "",
      path: abs,
      frontmatter,
      body,
    });
  }
  return out;
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
