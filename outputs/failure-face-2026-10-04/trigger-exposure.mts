/** 补丁**真正会出声**的那一格有多少：在「有正文却被判死」里，再要求命令是复合的且不带引号
 *  （带引号时切分不可信，补丁按设计闭嘴）。分真模型面与脚本面各数一遍——这决定第一名该排第几。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files: string[] = [];
const walk = (d: string, depth: number): void => {
  if (depth > 3 || d.includes(".worktrees")) return;
  let names: string[];
  try { names = readdirSync(d); } catch { return; }
  for (const n of names) {
    const p = join(d, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (n.endsWith(".events.jsonl")) files.push(p);
  }
};
walk("outputs", 0);
walk("fixtures/no-progress", 0);

interface Ev { type?: string; id?: string; callId?: string; name?: string; ok?: boolean; output?: string; args?: Record<string, unknown> }
const Q = /["'`]/;
const face = {
  real: { deadBody: 0, trigger: 0, silentByQuote: 0, silentSingleSeg: 0 },
  mock: { deadBody: 0, trigger: 0, silentByQuote: 0, silentSingleSeg: 0 },
};
const examples: string[] = [];
const silentExamples: string[] = [];

for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const models = [...new Set([...raw.matchAll(/"model":"([^"]{1,40})"/g)].map((m) => m[1]!))];
  const isReal = models.length > 0 && models.every((m) => m !== "mock");
  const b = isReal ? face.real : face.mock;
  const ev: Ev[] = raw.split("\n").filter((l) => l.trim() !== "").map((l) => { try { return JSON.parse(l) as Ev; } catch { return {}; } });
  const calls = new Map<string, Ev>(ev.filter((e) => e.type === "tool_call" && e.id).map((e) => [e.id!, e]));
  for (const e of ev) {
    if (e.type !== "tool_result" || e.ok !== false) continue;
    const c = e.callId ? calls.get(e.callId) : undefined;
    if (!c || c.name !== "run_shell") continue;
    const o = String(e.output ?? "");
    const cmd = String(c.args?.command ?? "");
    if (!/\[exit code: [1-9]/.test(o)) continue;
    const body = o.replace(/\[exit code: \d+\]/, "").replace(/\[exec:[^\]]*\]/, "").trim();
    if (body.length <= 20) continue;
    b.deadBody++;
    const segs = cmd.split(/[;\n]|&&|\|\|/).map((s) => s.trim()).filter((s) => s !== "");
    if (segs.length > 1 && !Q.test(cmd)) {
      b.trigger++;
      if (examples.length < 8) examples.push((isReal ? "real" : "mock") + "｜" + cmd.replace(/\s+/g, " ").slice(0, 88));
    } else if (segs.length > 1 && Q.test(cmd)) {
      b.silentByQuote++;
      if (silentExamples.length < 5) silentExamples.push((isReal ? "real" : "mock") + "｜带引号不出声：" + cmd.replace(/\s+/g, " ").slice(0, 76));
    } else {
      b.silentSingleSeg++;
      if (silentExamples.length < 5) silentExamples.push((isReal ? "real" : "mock") + "｜单段（回执本来就没错）：" + cmd.replace(/\s+/g, " ").slice(0, 76));
    }
  }
}
console.log("面      有正文却判死   补丁会出声   因带引号闭嘴   单段命令");
for (const [k, v] of Object.entries(face)) {
  console.log(`${k.padEnd(7)} ${String(v.deadBody).padStart(9)} ${String(v.trigger).padStart(12)} ${String(v.silentByQuote).padStart(13)} ${String(v.silentSingleSeg).padStart(11)}`);
}
console.log("出声样本："); for (const s of examples) console.log("  " + s);
console.log("闭嘴样本："); for (const s of silentExamples) console.log("  " + s);
