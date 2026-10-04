/** 改前／改后在**同一取料面**上的对照（台账第 368 页那张表的后半）：
 *  装本机真实 skill 清单，数"模型看得见几条"。面：缓存目录去重后的上界，与第 368 页一致 ⇒ 两个数可直接比。 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter, fmString } from "../../src/agent/plugins/frontmatter";
import { buildSkillRoutingList, skillInvokeName, SKILL_ROUTING_CHAR_LIMIT, type RoutingSkillInput } from "../../src/agent/plugins/skills";

async function find(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 6) return;
  let names: string[];
  try { names = await readdir(dir); } catch { return; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = await stat(p); } catch { continue; }
    if (!st.isDirectory()) { if (n === "SKILL.md") out.push(p); continue; }
    if (n === "skills") {
      let kids: string[];
      try { kids = await readdir(p); } catch { kids = []; }
      for (const k of kids) {
        const cand = join(p, k, "SKILL.md");
        try { if ((await stat(cand)).isFile()) out.push(p === "" ? cand : cand); } catch { /* 跳过 */ }
      }
    }
    await find(p, depth + 1, out);
  }
}

const files: string[] = [];
for (const r of [join(homedir(), ".qoder", "plugins", "cache"), join(homedir(), ".qoder", "skills")]) await find(r, 0, files);
const byName = new Map<string, RoutingSkillInput>();
for (const f of [...new Set(files)]) {
  let text: string;
  try { text = await readFile(f, "utf8"); } catch { continue; }
  const { frontmatter } = parseFrontmatter(text);
  const name = fmString(frontmatter, "name") ?? f.split("/").slice(-2)[0]!;
  const plugin = f.includes("plugins/cache/") ? (f.split("/plugins/cache/")[1]!.split("/")[0] ?? "") : "";
  const key = skillInvokeName({ plugin, name });
  if (!byName.has(key)) byName.set(key, { plugin, name, description: fmString(frontmatter, "description") ?? "", frontmatter });
}
const skills = [...byName.values()];
const r = buildSkillRoutingList(skills);
const listed = r.text.split("\n").filter((l) => l.startsWith("- ")).length;
console.log(`同一面：去重后 ${String(skills.length)} 条 skill｜帽 ${String(SKILL_ROUTING_CHAR_LIMIT)} 字符`);
console.log(`改后：列出 ${String(listed)} 条（其中完整行 ${String(listed - r.nameOnly)} 条、只列名字 ${String(r.nameOnly)} 条）｜整条丢掉 ${String(r.dropped)} 条｜可见率 ${((listed / skills.length) * 100).toFixed(0)}%`);
console.log(`对照第 368 页改前读数：完整行 3 条／可见率 1%／其余 403 条整条不可见`);
const q = "把台账页与判卷按 pathspec 落库并跑凭证，还要检查 apply_patch 的回执";
const rq = buildSkillRoutingList(skills, [], q);
const qlist = rq.text.split("\n").filter((l) => l.startsWith("- "));
console.log(`带 query 时第一条完整行是：${qlist[0]?.slice(0, 90)}`);
console.log(`（同一面、同一预算，只是顺序换了 ⇒ 装得下的条数不变，变的是"谁被看见"）`);
