// 复算：cd <仓根> && DSH_ROOT=<仓根> node --import tsx outputs/cap-disclosure-sweep-2026-09-30/probe.ts
// 一次性普查探针（**不是门**，不进 scripts/、不进门表）：把「规则 278 那格」从影响面一处推广到全仓——
//   一个帽切掉东西时，切掉的那部分有没有在**给模型看／给判定读**的那一侧说出来。
// 形状：① 从 src/** 抽出导出的帽常量（名字含 CAP/LIMIT/CEILING/MAX，且是 `export const … = 数`）
//       ② 找每个常量的使用点（同仓内引用该名字的其余行）
//       ③ 每个使用点只看**附近 ±14 行**里的「自述词」命中（另有／未列出／完整清单／截断／省略／只保留／帽／上限／truncated…）
//       ④ 按使用点所在文件的用途分档：模型可见文本（MODEL_FACING）／判定或准入（DECISION）／其它（OTHER）
// 诚实声明：③ 是**文字形状**判据，只能当分诊用——它能列出「这一处附近没有自述词」，
// 不能证明"没人自述"（自述可能在别处、也可能是行为而不是文案），也不能证明"有自述就够"。
// ⇒ 输出只用来决定**人去读哪些点**；每条被引用的结论都必须来自实际读过的代码，不许来自这张表。
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, posix } from "node:path";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());

const MODEL_FACING = /(prompt|impact-query|evidence|inject|render|sidechat|ledger|goal|model-surface|orchestrator-join|hooks|memory|map\/render|summar)/;
const DECISION = /(orchestrator|permission|autonomy|lease|scheduler|supervise|tool-|verify|gate)/;
const DISCLOSE = /(另有|未列出|完整清单|完整调用点|截断|省略|只保留|帽|上限|超出|未展示|被切|truncated|truncat|more than|clipped|slice)/;
const DECL_RE = /^export const ([A-Z0-9_]*(?:CAP|LIMIT|CEILING|MAX)[A-Z0-9_]*) *= *([0-9_]+(?:\.[0-9]+)?)/;

async function walkFrom(abs: string, rel: string, out: string[]): Promise<void> {
  for (const e of await readdir(abs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (["node_modules", "dist", "out", ".git"].includes(e.name)) continue;
      await walkFrom(join(abs, e.name), posix.join(rel, e.name), out);
    } else if (e.isFile() && /\.ts$/.test(e.name)) out.push(posix.join(rel, e.name));
  }
}

const files: string[] = [];
await walkFrom(join(ROOT, "src"), "src", files);
files.sort();

interface Site { file: string; line: number; text: string }
const caps: { name: string; decl: Site; value: string; uses: Site[] }[] = [];

for (const f of files) {
  const src = await readFile(join(ROOT, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((text, i) => {
    const m = DECL_RE.exec(text);
    if (!m) return;
    caps.push({ name: m[1], decl: { file: f, line: i + 1, text: text.trim() }, value: m[2], uses: [] });
  });
}

const byName = new Map(caps.map((c) => [c.name, c]));
for (const f of files) {
  const src = await readFile(join(ROOT, f), "utf8");
  const lines = src.split("\n");
  lines.forEach((text, i) => {
    for (const [name, cap] of byName) {
      if (cap.decl.file === f && cap.decl.line === i + 1) continue;
      if (!text.includes(name)) continue;
      const from = Math.max(0, i - 14);
      const to = Math.min(lines.length, i + 15);
      const near = lines.slice(from, to).join("\n");
      cap.uses.push({ file: f, line: i + 1, text: text.trim().slice(0, 150) + (DISCLOSE.test(near) ? "" : "   ⟦附近无自述词⟧") });
    }
  });
}

const kindOf = (p: string) => (MODEL_FACING.test(p) ? "MODEL" : DECISION.test(p) ? "DECISION" : "OTHER");

let modelSilent = 0; let decisionSilent = 0; let totalSilent = 0;
for (const cap of caps) {
  const silent = cap.uses.filter((u) => u.text.includes("⟦附近无自述词⟧"));
  totalSilent += silent.length;
  const ms = silent.filter((u) => kindOf(u.file) === "MODEL").length;
  const ds = silent.filter((u) => kindOf(u.file) === "DECISION").length;
  modelSilent += ms; decisionSilent += ds;
  console.log(`\n=== ${cap.name} = ${cap.value}  ·  ${cap.decl.file}:${cap.decl.line}  · 用处 ${String(cap.uses.length)}  · 附近无自述词 ${String(silent.length)}（其中 MODEL ${String(ms)}／DECISION ${String(ds)}）`);
  for (const u of cap.uses.slice(0, 6)) console.log(`    [${kindOf(u.file)}] ${u.file}:${u.line}  ${u.text}`);
  if (cap.uses.length > 6) console.log(`    …另有 ${String(cap.uses.length - 6)} 处未列（分诊用，见上计数）`);
}

console.log(`\n口径：帽常量 ${String(caps.length)} 个 · 用处合计 ${String(caps.reduce((a, c) => a + c.uses.length, 0))} · 附近无自述词 ${String(totalSilent)} · 其中 MODEL ${String(modelSilent)}／DECISION ${String(decisionSilent)}`);
console.log("再次声明：⟦附近无自述词⟧ 只说明**这一处 ±14 行没有自述形状**，不等于「没人自述」；判档 MODEL/DECISION 是按**文件名**猜用途，也要人核。");
