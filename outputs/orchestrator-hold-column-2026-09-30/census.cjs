const fs = require("fs");
const src = fs.readFileSync("src/agent/orchestrator.ts", "utf8");
const lines = src.split("\n");
const found = [];
for (let i = 0; i < lines.length; i++) {
  if (!/type: "tool_result"/.test(lines[i])) continue;
  const win = lines.slice(i, i + 4).join("\n");
  const m = /callId:\s*([^,\n]+)/.exec(win);
  const cid = m ? m[1].trim() : "(简写 callId，真值在上下文里)";
  const synth = /"budget-"|"pipeline-"|"diff-"|"wt-cleanup-"|"merge-"/.test(cid);
  found.push({ line: i + 1, cid, kind: synth ? "自造/派生" : "真 callId" });
}
console.log("orchestrator.ts 里 type: \"tool_result\" 落点 =", found.length);
console.log("  自造/派生 =", found.filter((f) => f.kind === "自造/派生").length);
console.log("  真 callId  =", found.filter((f) => f.kind === "真 callId").length);
for (const f of found) console.log("  L" + String(f.line).padEnd(5) + f.kind.padEnd(10) + f.cid);
const hold = fs.readFileSync("src/agent/orchestrator.ts", "utf8").split("\n").filter((l) => /\bhold:/.test(l)).length;
console.log("本笔盖了 hold 的行数（含传播）=", hold);
