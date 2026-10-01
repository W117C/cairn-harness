import { createHash } from "node:crypto";
const root = process.argv[2]!;
const h = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
const ar: any = await import(root + "/src/main/agent-runner.ts");
console.log("  agent-runner BASE_SYSTEM :", h(ar.BASE_SYSTEM), "len", ar.BASE_SYSTEM.length);
for (const m of ["read-only", "default", "guided", "auto", undefined]) {
  console.log("    ", String(m).padEnd(9), "len", String(ar.systemPromptFor(m).length).padStart(4), h(ar.systemPromptFor(m)));
}
try {
  const sm: any = await import(root + "/src/agent/system-prompt.ts");
  console.log("  system-prompt BASE_SYSTEM:", h(sm.BASE_SYSTEM), "len", sm.BASE_SYSTEM.length);
} catch { console.log("  （无 src/agent/system-prompt.ts）"); }
