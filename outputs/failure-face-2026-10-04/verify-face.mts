/** 复核（不是新尺）：把"按真实发生率挑活"这张表的三个承重数自己数一遍。
 *  取料面＝`find outputs -name '*.events.jsonl'`（排除 `.worktrees/`）；配对键＝`tool_call.id ↔ tool_result.callId`。
 *  簇的归一化：把工具输出的**首行**里的数字/路径/16 进制串换成 <n>/<path>，再按 (工具名, 归一首行) 聚类。 */
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

interface Ev { type?: string; id?: string; callId?: string; name?: string; ok?: boolean; output?: string; args?: Record<string, unknown>; exitCode?: number | null }
let toolCalls = 0, toolResults = 0, failures = 0;
const byFile = new Map<string, { calls: Map<string, Ev>; seq: Ev[] }>();
for (const f of files) {
  const calls = new Map<string, Ev>();
  const seq: Ev[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e: Ev;
    try { e = JSON.parse(line) as Ev; } catch { continue; }
    if (e.type === "tool_call" && e.id) { calls.set(e.id, e); toolCalls++; }
    if (e.type === "tool_result") { toolResults++; seq.push(e); if (e.ok === false) { failures++; } }
  }
  byFile.set(f, { calls, seq });
}
console.log(`轨迹文件=${String(files.length)}｜tool_call=${String(toolCalls)}｜tool_result=${String(toolResults)}｜ok:false=${String(failures)}`);

const norm = (s: string): string => s
  .replace(/0x[0-9a-f]+/gu, "<hex>")
  .replace(/\d+/gu, "<n>")
  .replace(/(?:\/[\w.@-]+){2,}/gu, "<path>")
  .trim().slice(0, 70);

const clusters = new Map<string, { n: number; files: Set<string>; sample: string }>();
let cluster2 = 0, cluster2Files = new Set<string>(), cluster2WithPipe = 0;
for (const [f, rec] of byFile) {
  for (const r of rec.seq) {
    if (r.ok !== false) continue;
    const call = r.callId ? rec.calls.get(r.callId) : undefined;
    const name = call?.name ?? "(无名/未配对)";
    const first = String(r.output ?? "").split("\n")[0] ?? "";
    const key = name + " · " + norm(first);
    const g = clusters.get(key) ?? { n: 0, files: new Set<string>(), sample: first.slice(0, 90) };
    g.n += 1; g.files.add(f);
    clusters.set(key, g);
    // 簇 2 的形状：run_shell、退出码非 0、正文里有交付内容（不止 exit 那行）、命令含 ; 或 2>/dev/null
    if (name === "run_shell" && /\[exit code: [1-9]/.test(String(r.output ?? "")) && String(r.output ?? "").replace(/\[exit code: \d+\]/, "").trim().length > 20) {
      cluster2 += 1; cluster2Files.add(f);
      if (/;|2\s*>\s*\/dev\/null|&&/.test(String(call?.args?.command ?? ""))) cluster2WithPipe += 1;
    }
  }
}
const top = [...clusters.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);
console.log("Top 10 簇（n｜轨迹数）：");
for (const [k, g] of top) console.log("  " + String(g.n).padStart(2) + "｜" + String(g.files.size).padStart(2) + "｜" + k);
console.log(`复核簇 2：run_shell 有交付内容却被判死 = ${String(cluster2)} 条，散在 ${String(cluster2Files.size)} 份轨迹；其中命令含 ;／&&／2>/dev/null 的 = ${String(cluster2WithPipe)}/${String(cluster2)}`);

// 重发统计：失败后紧接的同工具同参数重发（窗口=其后 6 次调用），以及两次之间有没有写盘
const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);
let retries = 0, retriesNoWrite = 0;
for (const [, rec] of byFile) {
  const timeline = rec.seq.map((r) => ({ r, c: r.callId ? rec.calls.get(r.callId) : undefined }));
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    if (t.r.ok !== false || !t.c) continue;
    let wrote = false;
    for (let j = i + 1; j < Math.min(timeline.length, i + 7); j++) {
      const u = timeline[j];
      if (u.c && u.c.name === t.c.name && JSON.stringify(u.c.args) === JSON.stringify(t.c.args)) {
        retries += 1;
        if (!wrote) retriesNoWrite += 1;
        break;
      }
      if (u.r.ok !== false && u.c && WRITE_TOOLS.has(u.c.name)) wrote = true;
    }
  }
}
console.log(`同工具同参数重发=${String(retries)} 条，其中重发前没有任何成功写盘=${String(retriesNoWrite)} 条（这才是"白付一轮"的下界）`);
console.log("注：同一任务在 baseline／head-a／head-b 三档各跑一遍 ⇒ 同源事件会被重复计入 n，这张表只能排相对高低。");
