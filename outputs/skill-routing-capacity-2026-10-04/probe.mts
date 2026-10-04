/** 「自动调用 skill」在**真实安装量**下还剩多少：用本仓自己的行格式与预算码（`buildSkillRoutingList`、
 *  `skillRoutingLine`、`SKILL_ROUTING_CHAR_LIMIT`）去装这台机器上真装着的 skill，看模型实际看得见几条。
 *  取料面（如实声明，这不是生产装配面）：用户目录下 `plugins/cache/<插件>/skills/<skill>/SKILL.md`
 *  与 `skills/<skill>/SKILL.md` 两层，frontmatter 走本仓的 `parseFrontmatter`（同一只解析器）。
 *  与生产的差别：真实 `PluginRuntime.skills()` 还过信任门与去重，所以这里数是**上界**（条目只会更多不会更少），
 *  而"被截掉的条数"在这个面上是**下界**。方向说清是为了不拿它冒充门读数。
 *  （注释里绝不能出现那种「星号紧接斜杠」的 glob 写法：它会把这个块注释提前闭合——
 *  本仓 2026-10-04 第 360 页刚记过同一条，我今天在写这条提醒的时候又踩了一次。） */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter, fmString } from "../../src/agent/plugins/frontmatter";
import { buildSkillRoutingList, skillRoutingLine, SKILL_ROUTING_CHAR_LIMIT, type RoutingSkillInput } from "../../src/agent/plugins/skills";

const ROOTS = [join(homedir(), ".qoder", "plugins", "cache"), join(homedir(), ".qoder", "skills")];

async function findSkillFiles(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 6) return;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const n of entries) {
    const p = join(dir, n);
    let st;
    try { st = await stat(p); } catch { continue; }
    if (!st.isDirectory()) {
      if (n === "SKILL.md") out.push(p);
      continue;
    }
    if (n === "skills" || n === "node_modules") {
      // 直接扫 skills 目录这一层，避免把 plugin 根下的 README 误当 skill
      let kids: string[];
      try { kids = await readdir(p); } catch { kids = []; }
      for (const k of kids) {
        const cand = join(p, k, "SKILL.md");
        try { if ((await stat(cand)).isFile()) out.push(cand); } catch { /* 非目录，跳过 */ }
        await findSkillFiles(join(p, k), depth + 1, out);
      }
      continue;
    }
    await findSkillFiles(p, depth + 1, out);
  }
}

const files: string[] = [];
for (const r of ROOTS) await findSkillFiles(r, 0, files);
const uniq = [...new Set(files)];

const skills: RoutingSkillInput[] = [];
let disabled = 0, noDesc = 0;
for (const f of uniq) {
  let text: string;
  try { text = await readFile(f, "utf8"); } catch { continue; }
  const { frontmatter } = parseFrontmatter(text);
  const name = fmString(frontmatter, "name") ?? f.split("/").slice(-2)[0]!;
  const plugin = f.includes("plugins/cache/") ? (f.split("/plugins/cache/")[1]!.split("/")[0] ?? "") : "";
  const description = fmString(frontmatter, "description") ?? "";
  if (description === "") noDesc++;
  if (frontmatter["disable-model-invocation"] === true || frontmatter["disable-model-invocation"] === "true") { disabled++; continue; }
  skills.push({ plugin, name, description, frontmatter });
}

const lines = skills.map(skillRoutingLine);
const full = lines.join("\n");
const r = buildSkillRoutingList(skills);
const keptCount = r.text === "" ? 0 : r.text.split("\n").filter((l) => l.startsWith("- ")).length;

console.log(`取料：SKILL.md 命中 ${String(uniq.length)} 份｜进模型可见清单 ${String(skills.length)} 条（disable-model-invocation ${String(disabled)} 条、无 description ${String(noDesc)} 条）`);
console.log(`清单全长 ${String(full.length)} 字符｜预算帽 ${String(SKILL_ROUTING_CHAR_LIMIT)} 字符`);
console.log(`装配结果：truncated=${String(r.truncated)}｜模型看得见 ${String(keptCount)} 条｜被截掉 ${String(r.dropped)} 条 ⇒ 可见率 ${((keptCount / Math.max(1, skills.length)) * 100).toFixed(0)}%`);
const keptSet = new Set(r.text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(" — ")[0]!));
const droppedNames = skills.map((s) => skillRoutingLine(s).slice(2).split(" — ")[0]!).filter((n) => !keptSet.has(n));
console.log(`保留的是输入序的前 ${String(keptCount)} 条（截断按**发现序**丢尾巴，与"这条任务需不需要它"无关）`);
console.log("头 6 条被截掉的（示例，说明丢的是谁）：");
for (const n of droppedNames.slice(0, 6)) console.log("   ✗ " + n);
console.log("尾 6 条被截掉的：");
for (const n of droppedNames.slice(-6)) console.log("   ✗ " + n);
console.log(`全列出需要的预算：${String(full.length)} 字符＝帽的 ${(full.length / SKILL_ROUTING_CHAR_LIMIT).toFixed(1)} 倍`);
