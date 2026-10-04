/** 第二支（收窄面＋变体预算）：把第一支的**上界**收成能读的三个数——
 *  ① 按调用名去重后到底几条 skill（缓存里同一支有多版本，第一支数的是文件数，会虚高）；
 *  ② 现行行格式（name + description）在 1536 字符帽内装得下几条；
 *  ③ 两种"同一预算装更多条"的变体各装得下几条：只列名字／描述截到 60 字符。
 *  目的是把「改帽还是改格式」这笔账变成有数可选的工单，而不是当场翻语义。 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter, fmString } from "../../src/agent/plugins/frontmatter";
import { skillInvokeName, SKILL_ROUTING_CHAR_LIMIT, type RoutingSkillInput } from "../../src/agent/plugins/skills";

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
        try { if ((await stat(cand)).isFile()) out.push(cand); } catch { /* 跳过 */ }
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
  const description = fmString(frontmatter, "description") ?? "";
  const key = skillInvokeName({ plugin, name });
  if (!byName.has(key)) byName.set(key, { plugin, name, description, frontmatter });
}
const skills = [...byName.values()];
const CAP = SKILL_ROUTING_CHAR_LIMIT;

/** 预算内装几条：按给定行函数逐条累加，超了就停（与 shipped 的"截在完整行尾"同形状）。 */
function fit(lines: string[]): number {
  const marker = 64; // 预留截断标记的位数（与 shipped 的做法一致，量级对即可）
  let total = 0, n = 0;
  for (const l of lines) {
    const add = l.length + 1;
    if (total + add + marker > CAP) break;
    total += add; n++;
  }
  return n;
}
const cur = skills.map((s) => "- " + skillInvokeName(s) + (s.description ? " — " + s.description.replace(/\s+/g, " ").trim() : ""));
const nameOnly = skills.map((s) => "- " + skillInvokeName(s));
const trunc60 = skills.map((s) => "- " + skillInvokeName(s) + (s.description ? " — " + s.description.replace(/\s+/g, " ").trim().slice(0, 60) : ""));

console.log(`文件面（上界）：SKILL.md ${String(new Set(files).size)} 份`);
console.log(`去重后（调用名唯一）：${String(skills.length)} 条`);
console.log(`现行行格式：全表 ${String(cur.join("\n").length)} 字符｜帽 ${String(CAP)}｜装得下 ${String(fit(cur))} 条＝${((fit(cur) / skills.length) * 100).toFixed(0)}%`);
console.log(`变体 A 只列名字：全表 ${String(nameOnly.join("\n").length)} 字符｜装得下 ${String(fit(nameOnly))} 条＝${((fit(nameOnly) / skills.length) * 100).toFixed(0)}%`);
console.log(`变体 B 描述截到 60 字符：全表 ${String(trunc60.join("\n").length)} 字符｜装得下 ${String(fit(trunc60))} 条＝${((fit(trunc60) / skills.length) * 100).toFixed(0)}%`);
const avg = (ls: string[]): string => (ls.reduce((a, b) => a + b.length, 0) / ls.length).toFixed(0);
console.log(`平均每行字符：现行 ${avg(cur)}｜只名字 ${avg(nameOnly)}｜截 60 ${avg(trunc60)}`);
