// 复算：cd <仓根> && node --import tsx outputs/fixture-noise-2026-09-30/probe-fixture-blast.mjs
// 也可以 DSH_ROOT=<仓根绝对路径>。
// 问的是**读端与准入**那两半（第 200 页的 49.1% 只是边占比，不能替这两个数说话）：
//  ① 模型真会查的那批 src 符号，它们的「波及文件」里有多少落在夹具目录内？
//  ② 语义租约那支：声明一个 src glob，波及闭包里有多少个是夹具文件？（闭包进审批卡 ⇒ 误伤面）
// 口径：夹具＝路径里有一个**段**叫 fixtures（`/(^|\/)fixtures\//`），不是"字符串含 fixtures"——
// 后者会把 `my-fixtures.ts` 这种真项目文件也算进去（探针先印出被命中的样例，认得出算错）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const impact = await import(pathToFileURL(join(ROOT, "src/agent/impact/index.ts")).href);
const { buildImpact, upward, affectedFilesOf, IMPACT_MAX_FILES_CEILING } = impact;

const FIXTURE = /(^|\/)fixtures\//u;
const dir = await mkdtemp(join(tmpdir(), "probe-fx-blast-"));
try {
  const g = await buildImpact({ workspace: ROOT, cacheDir: dir, maxFiles: IMPACT_MAX_FILES_CEILING });
  console.log(`ROOT=${ROOT}`);
  console.log(`图：文件=${String(g.files.length)} 候选=${String(g.candidates)} 帽=${String(g.cap)} 边=${String(g.edges.length)}`);

  // ① 只取**定义在 src/ 下**的符号（模型会查的那批）。
  //    第一版这里取了"波及最大的 40 个"＝**分页截断**：0.0% 可能只是那 40 个恰好干净。
  //    现在**全枚举**，并分开报：沾到夹具的符号数／夹具文件总数／以及沾夹具最多的那几个。
  const srcDefs = new Map();
  for (const [sym, sites] of g.defs) {
    const inSrc = sites.filter((d) => d.file.startsWith("src/"));
    if (inSrc.length === 0) continue;
    srcDefs.set(sym, inSrc);
  }
  const ranked = [...srcDefs.entries()]
    .map(([sym, defs]) => {
      const files = new Set(upward(g, sym).map((s) => s.file));
      const fxFiles = [...files].filter((f) => FIXTURE.test(f));
      return { sym, defFiles: defs.map((d) => d.file), total: files.size, fx: fxFiles.length, sample: fxFiles.slice(0, 2) };
    })
    .filter((r) => r.total > 0);
  let qFx = 0, filesAll = 0, filesFx = 0;
  for (const r of ranked) {
    filesAll += r.total;
    filesFx += r.fx;
    if (r.fx > 0) qFx += 1;
  }
  const worst = [...ranked].sort((a, b) => b.fx - a.fx).slice(0, 5);
  console.log(`① 定义在 src/ 且**真有跨文件调用方**的符号＝全枚举 ${String(ranked.length)} 个（不取前 N，前一版那样做是分页截断）：`);
  console.log(`   沾到夹具的符号=${String(qFx)}（${((qFx / Math.max(ranked.length, 1)) * 100).toFixed(1)}%）`);
  console.log(`   波及文件合计=${String(filesAll)} 其中夹具内=${String(filesFx)}（${((filesFx / Math.max(filesAll, 1)) * 100).toFixed(1)}%）`);
  console.log(`   沾夹具最多的 5 个：`);
  for (const r of worst) console.log(`     ${r.sym} def=${r.defFiles[0]} 波及=${String(r.total)} 夹具=${String(r.fx)} ${JSON.stringify(r.sample)}`);

  // ② 语义租约：声明 src/**，看闭包里夹具文件占多少（这决定审批卡会不会为夹具相撞而亮）
  const closure = await affectedFilesOf(ROOT, ["src/**"], join(dir, "lease"));
  const fx = closure.filter((f) => FIXTURE.test(f));
  console.log(`② affectedFilesOf(["src/**"]) 闭包=${String(closure.length)} 个文件，其中夹具=${String(fx.length)}（${((fx.length / Math.max(closure.length, 1)) * 100).toFixed(1)}%）`);
  console.log(`   夹具样例=${JSON.stringify(fx.slice(0, 3))}`);

  // ③ 反向哨兵②：一片 0 要先怀疑尺。这里**故意查一个定义在夹具里的符号**，
  //    若它也报 0 个夹具文件，说明 `FIXTURE` 这条判据或取料接错了（而不是"真的没有污染"）。
  const fxFilesInGraph = g.files.filter((f) => FIXTURE.test(f));
  let fxProbe = null;
  for (const [sym, sites] of g.defs) {
    const inFx = sites.filter((d) => FIXTURE.test(d.file));
    if (inFx.length === 0) continue;
    const files = new Set(upward(g, sym).map((s) => s.file));
    const fxOfIt = [...files].filter((f) => FIXTURE.test(f)).length;
    if (fxOfIt > 0) { fxProbe = { sym, def: inFx[0].file, total: files.size, fx: fxOfIt }; break; }
  }
  console.log(`③ 哨兵：图里落在夹具的文件数=${String(fxFilesInGraph.length)}；` +
    (fxProbe === null
      ? "**没找到一个「定义在夹具且波及也在夹具」的符号** ⇒ 上面那两个 0.0% 可疑，别拿它当结案证据"
      : `查夹具内符号 ${fxProbe.sym}（def=${fxProbe.def}）⇒ 波及=${String(fxProbe.total)} 其中夹具=${String(fxProbe.fx)} ✅ 尺接对了`));

  // ④ 分类器自证：被算成夹具的路径形状要真的像夹具目录，不是字符串巧合
  const suspicious = [...g.files].filter((f) => FIXTURE.test(f) && !f.startsWith("fixtures/") && !f.includes("/fixtures/"));
  console.log(`④ 哨兵：被算成夹具却不像夹具目录的文件=${String(suspicious.length)} ${JSON.stringify(suspicious.slice(0, 3))}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
