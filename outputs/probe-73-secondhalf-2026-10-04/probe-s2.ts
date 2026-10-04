import { evaluate, type AutonomySession } from "../../src/permissions/index.ts";
import { newAutonomySession } from "../../src/permissions/index.ts";
function session(mode: "guided" | "auto" | "default"): AutonomySession {
  const s = newAutonomySession(mode, { rules: [], sandboxAvailable: null, sessionScopes: new Set<string>() });
  s.planBlocked = () => false; s.consecutiveAutoApprovals = 0; s.breakerTripped = false; s.consecutiveCriticalDenials = 0;
  return s;
}
const show = (label: string, d: unknown) => console.log(label.padEnd(46), JSON.stringify(d));
for (const mode of ["guided", "auto", "default"] as const) {
  show(`write_file .git/hooks/pre-commit [${mode}]`, evaluate("write_file", { path: ".git/hooks/pre-commit", content: "x" }, session(mode)));
}
show("run_shell >> .git/hooks/pre-commit [guided]", evaluate("run_shell", { command: "echo hi >> .git/hooks/pre-commit" }, session("guided")));
show("apply_patch 批量 [auto]", evaluate("apply_patch", { patch: "--- a/.git/hooks/post-commit\n+++ b/.git/hooks/post-commit\n+#!/bin/sh\n+x\n" }, session("auto")));
show("edit_file .git/config [auto]", evaluate("edit_file", { path: ".git/config" }, session("auto")));
show("edit_file src/index.ts [auto]", evaluate("edit_file", { path: "src/index.ts" }, session("auto")));
show("write_file src/index.ts [auto]", evaluate("write_file", { path: "src/index.ts", content: "x" }, session("auto")));
show("write_file src/index.ts [guided]", evaluate("write_file", { path: "src/index.ts", content: "x" }, session("guided")));
