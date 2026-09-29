// 复算：cd <仓根> && node --import tsx outputs/impact-cap-decision-2026-09-30/probe-fixture-edges.mjs
// 也可 DSH_ROOT=<仓根绝对路径>。
// 第二个数（同一把尺的另一半）：全量图的边集里有多少条**沾到夹具**——#21 标题里"夹具占 48.9% 的边"是早先读数，本轮重测。
// 口径：边的**任一端**路径含 `fixtures/` 就算沾夹具（先看清 edges 形状再数，别猜）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const impact = await import(pathToFileURL(join(ROOT, "src/agent/impact/index.ts")).href);
const { buildImpact, IMPACT_MAX_FILES_CEILING } = impact;

const dir = await mkdtemp(join(tmpdir(), "probe-edges-"));
try {
  const g = await buildImpact({ workspace: ROOT, cacheDir: dir, maxFiles: IMPACT_MAX_FILES_CEILING });
  const edges = g.edges;
  const sample = Array.isArray(edges) ? edges.slice(0, 1) : [];
  console.log(`ROOT=${ROOT}`);
  console.log(`edges 类型=${Object.prototype.toString.call(edges)} 长度=${String(edges?.length ?? edges?.size ?? "n/a")} 样例=${JSON.stringify(sample).slice(0, 200)}`);
  let total = 0;
  let withFx = 0;
  const eat = (e) => {
    total += 1;
    if (/"[^"]*fixtures\/[^"]*"/u.test(JSON.stringify(e))) withFx += 1;
  };
  if (Array.isArray(edges)) for (const e of edges) eat(e);
  else if (edges?.entries) for (const [, v] of edges.entries()) eat(v);
  console.log(`全量图边数=${String(total)} 沾到夹具的边=${String(withFx)}（${total > 0 ? ((withFx / total) * 100).toFixed(1) : "n/a"}%）`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
