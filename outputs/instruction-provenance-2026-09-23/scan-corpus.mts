import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CT = /<\/?\s*(?:system(?:-reminder)?|instructions?|context|goal|task|harness|memory|tool_result|thinking)\b[^>]*>/gi;
const RL = /^(\s*)(Human|Assistant|System)\s*:/gm;

const files = execFileSync("git", ["ls-files", "*.jsonl"], { encoding: "utf8" }).split("\n").filter(Boolean);
let n = 0, bytes = 0, tagHits = 0, roleHits = 0;
const changed: string[] = [];
for (const f of files) {
  let raw = "";
  try { raw = readFileSync(f, "utf8"); } catch { continue; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (e["type"] !== "tool_result") continue;
    const out = String(e["output"] ?? "");
    n++; bytes += Buffer.byteLength(out, "utf8");
    const t = out.match(CT), r = out.match(RL);
    if (t) { tagHits += t.length; changed.push(f + " TAG " + JSON.stringify(t[0]).slice(0, 60)); }
    if (r) { roleHits += r.length; changed.push(f + " ROLE " + JSON.stringify(r[0])); }
  }
}
console.log(`tracked jsonl files: ${files.length}`);
console.log(`tool_result 条数 ${n} / ${bytes} 字节`);
console.log(`控制标签命中 ${tagHits} · 角色行命中 ${roleHits}`);
console.log(changed.slice(0, 30).join("\n") || "(无一条会被 escapeControlTags 改动)");
