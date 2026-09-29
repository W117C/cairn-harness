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
const calls = new Map();           // id -> name
let shellResults = 0, shellRed = 0, unjoined = 0;
let exitKey = 0, timedOutKey = 0, neither = 0, maxTsShellRed = 0, maxTsAny = 0;
const nameCounts = new Map();
const redExitCodes = new Map();

for (const f of files) {
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (typeof e.ts === "number" && e.ts > maxTsAny) maxTsAny = e.ts;
    if (e.type === "tool_call") { calls.set(e.id, e.name); continue; }
    if (e.type !== "tool_result") continue;
    const name = calls.get(e.callId);
    nameCounts.set(name ?? "(unjoined)", (nameCounts.get(name ?? "(unjoined)") ?? 0) + 1);
    if (name === undefined) { unjoined++; continue; }
    if (!SHELL.has(name)) continue;
    shellResults++;
    if (e.exitCode !== undefined) exitKey++;
    if (e.timedOut !== undefined) timedOutKey++;
    if (e.exitCode === undefined && e.timedOut === undefined) neither++;
    if (e.ok !== false) continue;
    shellRed++;
    if (typeof e.ts === "number" && e.ts > maxTsShellRed) maxTsShellRed = e.ts;
    const key = String(e.exitCode ?? "(absent)");
    redExitCodes.set(key, (redExitCodes.get(key) ?? 0) + 1);
  }
}
console.log("files", files.length);
console.log("maxTsAny", new Date(maxTsAny).toISOString());
console.log("shell tool_result", shellResults, "red", shellRed, "unjoined", unjoined);
console.log("exitCode key present", exitKey, "timedOut key present", timedOutKey, "neither", neither);
console.log("maxTs shell red", maxTsShellRed ? new Date(maxTsShellRed).toISOString() : "-");
console.log("red exitCode histogram", [...redExitCodes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12));
console.log("top tool names", [...nameCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15));
