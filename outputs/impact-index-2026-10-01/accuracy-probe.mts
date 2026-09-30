// 夹具真值核对探针（只读）：打印 accuracy-repo 全图 defs/refs/edges 与每文件 tag 计数，
// 供人工逐条核对 ground-truth（按图合同核对：def/ref 按名字连边、同文件边不入图、重导出语句无 tag）。
import { buildImpact, upward, downward } from "../../src/agent/impact/index.js";
import { fileTags } from "../../src/agent/map/parse.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WS = fileURLToPath(new URL("../../fixtures/impact/accuracy-repo/", import.meta.url));
const cacheDir = "/tmp/accuracy-probe-cache-" + String(process.pid);
const graph = await buildImpact({ workspace: WS, cacheDir, persistIndex: false });

console.log(`files=${graph.files.length} candidates=${graph.candidates} edges=${graph.edges.length}`);
console.log("\n== 每文件 tag 计数（解析零丢条核对） ==");
for (const rel of graph.files) {
  const src = await readFile(join(WS, rel), "utf8");
  const tags = await fileTags(src, rel.slice(rel.lastIndexOf(".") + 1));
  console.log(`${rel}: tags=${tags.length} (${tags.map((t) => `${t.kind}:${t.name}@${t.line}`).join(", ")})`);
}
console.log("\n== defs ==");
for (const [sym, sites] of [...graph.defs].sort()) console.log(`${sym}: ${sites.map((s) => `${s.file}:${s.line}`).join(", ")}`);
console.log("\n== 跨文件引用点（upward 非空符号） ==");
for (const sym of [...graph.defs.keys()].sort()) {
  const up = upward(graph, sym);
  if (up.length > 0) console.log(`${sym}: ${up.map((s) => `${s.file}:${s.line}`).join(", ")}`);
}
console.log("\n== edges（确定性序） ==");
for (const e of graph.edges) console.log(`${e.from}:${e.refLine} --${e.symbol}--> ${e.to}:${e.defLine}`);
console.log("\n== downward（有出边的文件） ==");
for (const rel of graph.files) {
  const d = downward(graph, rel);
  if (d.length > 0) console.log(`${rel}: ${d.map((s) => `${s.symbol}@${s.file}:${s.line}`).join(", ")}`);
}
