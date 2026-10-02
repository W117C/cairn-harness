// 一次性诊断（用完即删）：那 10 个"人常问却进不了地图"的生产文件，在图里到底是几进几出。
// 目的：分清 #8① 文件域（fodder 挤占）与 #8② 边按同名建（路径 import 不进图）哪一个才是成因。
import { scanSourceFiles } from "../../src/agent/map/build";
import { fileTags } from "../../src/agent/map/parse";

const files = await scanSourceFiles(process.cwd());
/** file → defs(name→lines) / refs(name→count) */
const defs = new Map<string, Map<string, number>>();
const refs = new Map<string, Map<string, number>>();
let parsed = 0;
for (const f of files) {
  let src: string;
  try {
    src = await (await import("node:fs/promises")).readFile(f.abs, "utf8");
  } catch { continue; }
  const ext = f.rel.slice(f.rel.lastIndexOf(".") + 1).toLowerCase();
  let tags;
  try { tags = await fileTags(src, ext); } catch { continue; }
  parsed++;
  const d = new Map<string, number>();
  const r = new Map<string, number>();
  for (const t of tags) {
    if (t.kind === "def") d.set(t.name, (d.get(t.name) ?? 0) + 1);
    else r.set(t.name, (r.get(t.name) ?? 0) + 1);
  }
  defs.set(f.rel, d);
  refs.set(f.rel, r);
}

/** 某个文件的"按名字被别的文件引用"的文件数（同名匹配＝地图现在的建边方式）。 */
function inboundByName(target: string): { name: string; fanInFiles: number }[] {
  const out: { name: string; fanInFiles: number }[] = [];
  for (const [name] of defs.get(target) ?? new Map()) {
    let n = 0;
    for (const [other, rmap] of refs) {
      if (other !== target && rmap.has(name)) n++;
    }
    out.push({ name, fanInFiles: n });
  }
  return out.sort((a, b) => b.fanInFiles - a.fanInFiles);
}

const targets = [
  "src/main/settings.ts", "src/main/sandbox.ts", "src/tools/snapshot.ts",
  "src/agent/no-progress.ts", "src/agent/tool-surface.ts", "src/agent/ledger.ts",
  "src/agent/verify.ts", "src/tools/grep.ts", "src/agent/memory/inject.ts",
];

console.log(`解析文件数=${String(parsed)} / 候选=${String(files.length)}`);
for (const t of targets) {
  const d = defs.get(t);
  if (d === undefined) { console.log(`${t}：不在图里（未被扫到或解析失败）`); continue; }
  const inb = inboundByName(t);
  const total = inb.reduce((s, x) => s + x.fanInFiles, 0);
  console.log(`${t} defs=${String(d.size)} 按名入边(不同引用方文件数,同名匹配)=${String(total)} top=${JSON.stringify(inb.slice(0, 3))}`);
}

// 谁赢：按"名字入边文件数之和"排出全仓前 12，看赢家是不是靶场副本
const scored: { f: string; s: number }[] = [];
for (const f of defs.keys()) scored.push({ f, s: inboundByName(f).reduce((a, x) => a + x.fanInFiles, 0) });
scored.sort((a, b) => b.s - a.s);
console.log("按名入边总量前 12：", scored.slice(0, 12).map((x) => `${x.f}=${String(x.s)}`).join(", "));
