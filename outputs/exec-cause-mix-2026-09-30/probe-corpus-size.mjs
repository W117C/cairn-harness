// 第 217 页：尺真正吃的那块取料面有多大（从前页里写的「11MB」是 `du -sh outputs`，含非 jsonl 文件 ⇒ 标签大于取料面）。
// 与 `scanCorpus()` 同一条口径：同样两个根、同样深度上限 4、同样只认 `.jsonl`。
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
let total = 0, inOut = 0, inSess = 0;
for (const f of files) { const b = fs.statSync(f).size; total += b; if (f.startsWith("outputs")) inOut += b; else inSess += b; }
console.log("jsonl 文件数=" + String(files.length) + " 总字节=" + (total / 1024).toFixed(1) + " KB" +
  "（outputs " + (inOut / 1024).toFixed(1) + " KB ＋ 会话目录 " + (inSess / 1024).toFixed(1) + " KB）");
