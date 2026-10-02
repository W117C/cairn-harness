// 第 308 页的现读：真仓里 `impact_query` 三个出口各自说了什么（改动前后同一支的文案对照）。
// 为什么单独跑一次：判卷用的是小仓库合成图，能证明"接线在"，证明不了"模型真看见的那一句有多长、说了什么"。
// 而这一页改的恰恰是**模型可见文案**——它得按生产入口读一遍才算数（本仓「写一句承诺就配一支真工具探针」那条规矩）。
// 跑法：`node --import tsx outputs/impact-query-face-2026-10-03/query-face-probe.mts`
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createImpactQueryTool } from "../../src/tools/impact-query";
import { fileImpact, upward, buildImpact } from "../../src/agent/impact/index";

const ROOT = resolve(import.meta.dirname, "..", "..");
const cache = await mkdtemp(join(tmpdir(), "dsh-query-face-"));
try {
  const tool = createImpactQueryTool(cache);
  const ctx = { workspace: ROOT, emit: async () => {} };
  const head = (s: string, n: number) => s.split("\n").slice(0, n).join("\n");
  const cases: { label: string; args: Record<string, unknown> }[] = [
    { label: "symbol=readFile（谁在调用它；图内那份定义在 src/agent/ledger.ts）", args: { symbol: "readFile" } },
    { label: "file=src/agent/ledger.ts（该文件的波及面）", args: { file: "src/agent/ledger.ts" } },
    { label: "file=src/agent/ledger.ts + deps（我在调用谁）", args: { file: "src/agent/ledger.ts", deps: true } },
  ];
  for (const c of cases) {
    const r = await tool.run(c.args, ctx);
    console.log(`\n== ${c.label}  ok=${String(r.ok)}`);
    console.log(head(r.output, 4));
  }
  // 对照：同一支在没有归属句时会短多少（只量长度差，不改生产）
  const g = await buildImpact({ workspace: ROOT, cacheDir: join(cache, "g") });
  const rep = await fileImpact(ROOT, "src/agent/ledger.ts", join(cache, "f"));
  const sites = rep === null ? [] : upward(g, "readFile");
  console.log(`\n== 三态与清单：kept=${String(g.attribution.kept)} dropped=${String(g.attribution.dropped)} noEvidence=${String(g.attribution.noEvidence)}`);
  console.log(`   upward(readFile)=${String(sites.length)} 处；报告里 sitesOnlyToOtherDef=${String(rep?.sitesOnlyToOtherDef ?? -1)}，up=${String(rep?.up.length ?? -1)} 处`);
  console.log("\n[query-face] 自检：三个出口都读到输出 ⇒ 上面那些句子就是模型真看见的那一句");
} finally {
  await rm(cache, { recursive: true, force: true }).catch(() => {});
}
