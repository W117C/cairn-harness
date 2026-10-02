// 改前/改后对照用（一次性）：首轮地图的组成与前排是谁。
import { buildMap } from "../src/agent/map/build";
const PATHISH_RE = /[\w./-]+\.[a-z]{1,5}/g;
function filesInOrder(text: string): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("│")) continue;
    for (const m of line.match(PATHISH_RE) ?? []) {
      const f = m.replace(/^\.\//, "");
      if (!/\.[a-z]{1,5}$/.test(f) || seen.has(f)) continue;
      seen.add(f); out.push(f);
    }
  }
  return out;
}
for (const budget of [1024, 4096]) {
  const b = await buildMap({ workspace: process.cwd(), mentionedIdents: [], contextFiles: [], budgetTokens: budget });
  const files = filesInOrder(b.text);
  const bucket = (f: string) => f.startsWith("src/") ? "src" : f.startsWith("tests/") ? "tests" : f.startsWith("fixtures/") ? "fixtures" : f.startsWith("scripts/") ? "scripts" : f.startsWith("apps/") ? "apps" : f.startsWith("outputs/") ? "outputs" : "other";
  const counts: Record<string, number> = {};
  for (const f of files) counts[bucket(f)] = (counts[bucket(f)] ?? 0) + 1;
  const nonSrc = files.filter((f) => !f.startsWith("src/")).length;
  console.log(`budget=${String(budget)} 文件=${String(files.length)} tokens=${String(b.tokens)} 组成=${JSON.stringify(counts)} 非src占比=${String(Math.round((nonSrc / Math.max(1, files.length)) * 100))}%`);
  console.log(`  前 12：${files.slice(0, 12).join(", ")}`);
}
