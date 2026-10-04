/** 分歧复核：同一件事（失败后同参数重发）在三种量法下各是多少，用来判定 4 与 11 各来自哪一面。
 *  取料面同 verify-face.mts（outputs 下 *.events.jsonl，排除 .worktrees/）。 */
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

interface Ev { type?: string; id?: string; callId?: string; name?: string; ok?: boolean; args?: Record<string, unknown> }
const byFile = new Map<string, { calls: Map<string, Ev>; ordered: Array<{ kind: "call" | "result"; c?: Ev; r?: Ev }> }>();
for (const f of files) {
  const calls = new Map<string, Ev>();
  const ordered: Array<{ kind: "call" | "result"; c?: Ev; r?: Ev }> = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e: Ev;
    try { e = JSON.parse(line) as Ev; } catch { continue; }
    if (e.type === "tool_call" && e.id) { calls.set(e.id, e); ordered.push({ kind: "call", c: e }); }
    if (e.type === "tool_result") ordered.push({ kind: "result", r: e });
  }
  byFile.set(f, { calls, ordered });
}

const key = (c: Ev): string => (c.name ?? "?") + " · " + JSON.stringify(c.args ?? {});
const WRITE = new Set(["write_file", "edit_file", "apply_patch"]);

/** 定义 A：失败点之后 W 次「调用」内出现同工具同参数（W=6 或无限＝整条尾巴）。 */
function countDefA(win: number): { retries: number; noWrite: number } {
  let retries = 0, noWrite = 0;
  for (const rec of byFile.values()) {
    const calls = rec.ordered.filter((x) => x.kind === "call");
    const results = rec.ordered.filter((x) => x.kind === "result");
    // 按事件顺序遍历，维护「已见的失败调用」与「其后是否写盘」
    let idxOfResult = 0;
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i].c!;
      // 找这一调用的结果（同一顺序内，结果与调用一一按序对齐不严格，用 callId 查）
      const r = results.find((x) => x.r?.callId === c.id);
      if (!r || r.r?.ok !== false) continue;
      const k = key(c);
      let wrote = false, hit = -1;
      for (let j = i + 1; j < calls.length; j++) {
        if (win > 0 && j - i > win) break;
        const cj = calls[j].c!;
        if (key(cj) === k) { hit = j; break; }
        const rj = results.find((x) => x.r?.callId === cj.id);
        if (cj.name && WRITE.has(cj.name) && rj && rj.r?.ok !== false) wrote = true;
      }
      if (hit >= 0) { retries++; if (!wrote) noWrite++; }
    }
    idxOfResult++;
  }
  return { retries, noWrite };
}

/** 定义 B：同工具同「归一化后参数」（数字与路径抹平），整条尾巴。 */
function countDefB(): { retries: number; noWrite: number } {
  const norm = (s: string): string => s.replace(/\d+/gu, "<n>").replace(/(?:\/[\w.@-]+){2,}/gu, "<path>");
  let retries = 0, noWrite = 0;
  for (const rec of byFile.values()) {
    const calls = rec.ordered.filter((x) => x.kind === "call");
    const results = rec.ordered.filter((x) => x.kind === "result");
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i].c!;
      const r = results.find((x) => x.r?.callId === c.id);
      if (!r || r.r?.ok !== false) continue;
      const k = norm(key(c));
      let wrote = false, hit = false;
      for (let j = i + 1; j < calls.length; j++) {
        const cj = calls[j].c!;
        if (norm(key(cj)) === k) { hit = true; break; }
        const rj = results.find((x) => x.r?.callId === cj.id);
        if (cj.name && WRITE.has(cj.name) && rj && rj.r?.ok !== false) wrote = true;
      }
      if (hit) { retries++; if (!wrote) noWrite++; }
    }
  }
  return { retries, noWrite };
}

/** 定义 C：只比「工具名相同 + 首个字符串参数相同（归一化）」——模型常重跑同一条命令但改了 tail -c 的数字。 */
function countDefC(): { retries: number } {
  const norm = (s: string): string => s.replace(/\d+/gu, "<n>").replace(/(?:\/[\w.@-]+){2,}/gu, "<path>");
  const first = (c: Ev): string => {
    const a = c.args ?? {};
    for (const v of Object.values(a)) if (typeof v === "string") return norm(v);
    return norm(JSON.stringify(a));
  };
  let retries = 0;
  for (const rec of byFile.values()) {
    const calls = rec.ordered.filter((x) => x.kind === "call");
    const results = rec.ordered.filter((x) => x.kind === "result");
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i].c!;
      const r = results.find((x) => x.r?.callId === c.id);
      if (!r || r.r?.ok !== false) continue;
      for (let j = i + 1; j < calls.length; j++) {
        const cj = calls[j].c!;
        if (cj.name === c.name && first(cj) === first(c)) { retries++; break; }
      }
    }
  }
  return { retries };
}

console.log("A 严格同参数·窗口 6 次调用：", JSON.stringify(countDefA(6)));
console.log("A 严格同参数·整条尾巴：  ", JSON.stringify(countDefA(0)));
console.log("B 归一化同参数·整条尾巴：", JSON.stringify(countDefB()));
console.log("C 同工具＋首串参数归一化：", JSON.stringify(countDefC()));
