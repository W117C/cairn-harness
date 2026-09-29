// 第 217 页取证：五条 shell 红拍的**完整结尾**（前 400 字的探针会把 `[exit code: N]` 截掉，
// 而那一行正是"今天只有文案栏看得见"的那格证人）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const roots = ["outputs", path.join(os.homedir(), "Library", "Application Support", "m0-agent-loop", "sessions")];
const files = [];
const walk = (d, dep) => {
  if (dep > 4) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, dep + 1); else if (e.name.endsWith(".jsonl")) files.push(p); }
};
for (const r of roots) walk(r, 0);
const SH = new Set(["run_shell", "shell_rw", "shell_ro"]);
for (const f of files) {
  const rows = [];
  for (const l of fs.readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { rows.push(JSON.parse(l)); } catch { /* 脏行跳过 */ } }
  const idx = new Map();
  for (const e of rows) if (e.type === "tool_call") idx.set(e.id, e.name);
  let n = 0;
  for (const e of rows) {
    if (e.type !== "tool_result") continue;
    const tool = idx.get(e.callId);
    if (tool === undefined || !SH.has(tool) || e.ok !== false) continue;
    n++;
    const out = String(e.output ?? "");
    console.log(path.basename(f) + " red#" + String(n) + " tool=" + tool + " len=" + String(out.length) +
      " keys=" + Object.keys(e).sort().join(",") + " tail=" + JSON.stringify(out.slice(-64)));
  }
}
