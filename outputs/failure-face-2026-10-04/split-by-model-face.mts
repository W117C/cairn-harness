/** 给第 363 页那个 19/39 **补面**：同一件事在「真模型轨迹」与「脚本／mock 轨迹」两个面上各是多少。
 *  分类判据：这份事件流里出现过非 mock 的 `model` 值 ⇒ 记为真模型面（实测只有 `mimo-v2.6-flash` 一种），
 *  否则记为脚本面。分类只看流本身，不看目录名——目录名会骗人（同名的 base／head-a／head-b 是三档同题）。 */
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
const face = { real: { traces: 0, results: 0, fails: 0, dead: 0, deadTraces: new Set<string>(), compound: 0 }, mock: { traces: 0, results: 0, fails: 0, dead: 0, deadTraces: new Set<string>(), compound: 0 } };
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const models = new Set([...raw.matchAll(/"model":"([^"]{1,40})"/g)].map((m) => m[1]!));
  const isReal = models.size > 0 && ![...models].every((m) => m === "mock");
  const bucket = isReal ? face.real : face.mock;
  bucket.traces++;
  const ev: Ev[] = raw.split("\n").filter((l) => l.trim() !== "").map((l) => { try { return JSON.parse(l) as Ev; } catch { return {}; } });
  const calls = new Map<string, Ev>(ev.filter((e) => e.type === "tool_call" && e.id).map((e) => [e.id!, e]));
  for (const e of ev) {
    if (e.type !== "tool_result") continue;
    bucket.results++;
    if (e.ok !== false) continue;
    bucket.fails++;
    const c = e.callId ? calls.get(e.callId) : undefined;
    if (!c || c.name !== "run_shell") continue;
    const out = String(e.output ?? "");
    const cmd = String(c.args?.command ?? "");
    if (/[;]|&&|\|\|/.test(cmd)) bucket.compound++;
    const body = out.replace(/\[exit code: \d+\]/, "").replace(/\[exec:[^\]]*\]/, "").trim();
    if (/\[exit code: [1-9]/.test(out) && body.length > 20) { bucket.dead++; bucket.deadTraces.add(f); }
  }
}
console.log("面        轨迹  tool_result  ok:false  run_shell正文有却被判死  占失败比  散在轨迹  命令含分隔符");
for (const [k, v] of Object.entries(face)) {
  const rate = v.fails === 0 ? "—" : (v.dead / v.fails * 100).toFixed(0) + "%";
  console.log(`${k.padEnd(8)} ${String(v.traces).padStart(4)} ${String(v.results).padStart(10)} ${String(v.fails).padStart(9)} ${String(v.dead).padStart(22)} ${rate.padStart(8)} ${String(v.deadTraces.size).padStart(9)} ${String(v.compound).padStart(12)}`);
}
console.log("注：两面的 ok:false 合计应等于第 363 页那个 39（若不等＝分类漏了一类，读数作废先查这里）。");
