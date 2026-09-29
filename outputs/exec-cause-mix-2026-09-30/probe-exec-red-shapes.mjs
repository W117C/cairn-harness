import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const roots = ["outputs", path.join(os.homedir(), "Library", "Application Support", "m0-agent-loop", "sessions")];
const files = [];
const walk = (d, depth) => {
  if (depth > 4) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith(".jsonl")) files.push(p); }
};
for (const r of roots) walk(r, 0);
const SHELL = new Set(["run_shell", "shell_rw", "shell_ro"]);
const PKG = /^[ \t]*[│┆└├]?[ \t]*\[?ERR_PNPM_[A-Z0-9_]+\]?/m;

for (const f of files) {
  const local = new Map();
  const rows = [];
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    rows.push(e);
  }
  for (const e of rows) { if (e.type === "tool_call") local.set(e.id, e.name); }
  for (const e of rows) {
    if (e.type !== "tool_result") continue;
    const n = local.get(e.callId);
    if (n === undefined || !SHELL.has(n) || e.ok !== false) continue;
    console.log("=== " + path.basename(f) + " | " + n + " | exitCode=" + JSON.stringify(e.exitCode) + " timedOut=" + JSON.stringify(e.timedOut));
    console.log(JSON.stringify(String(e.output ?? "").slice(0, 400)));
    console.log("   hints: exit-code-bracket=" + String(e.output ?? "").includes("[exit code:") + " 127=" + String(e.output ?? "").includes("[exit code: 127]") + " 超时=" + String(e.output ?? "").includes("超时") + " ERR_PNPM=" + PKG.test(String(e.output ?? "")));
  }
}
