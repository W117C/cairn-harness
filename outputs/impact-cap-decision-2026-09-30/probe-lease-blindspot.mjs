// 复算：cd <仓根> && node --import tsx outputs/impact-cap-decision-2026-09-30/probe-lease-blindspot.mjs
// 也可 DSH_ROOT=<仓根绝对路径>。一次性探针，只读盘（tags 缓存写进 mkdtemp 的 tmpdir，不碰 ~/.m0-agent-loop）。
//
// 这一支要证的不是"影响面少答了"，而是 §五 那条更要紧的：**语义租约把"图外"读成"不相交"，而它管的是 spawn 准入**。
// 形状＝同一个 `semanticConflictsVia`（判定内核一字不改）、同一对 glob，只换「波及集从哪张图算」这一位：
//   缺省臂＝照抄生产端的接法（`agent-runner.ts:373`：semanticLease = (globs) => affectedFilesOf(workspace, globs)，
//            而 `affectedFilesOf` 根本没有 maxFiles 位 ⇒ 永远用 `MAX_FILES_DEFAULT`）；
//   全量臂＝同一份闭包逻辑，只是图按 `IMPACT_MAX_FILES_CEILING` 建。
// ⇒ 若两臂一个报冲突、一个放行，那就是"帽切掉的那批文件"在**准入判定**这一格上等价于"不存在"。
//
// 诚实声明：全量臂的闭包是本探针**复刻**的 7 行（因为生产端不接 maxFiles，不改代码就只能复刻）。
// 将来把这条变成判卷时**不许**复用这份复刻（规则 217：判据要与生产端共用决策点）——
// 先给 `affectedFilesOf` 透进 maxFiles，再让判卷直接调它。
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const pick = async (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const impact = await pick("src/agent/impact/index.ts");
const build = await pick("src/agent/map/build.ts");
const { semanticConflictsVia, globIntersects } = await pick("src/agent/lease-conflicts.ts");
const { buildImpact, upward, globMatchesPath, affectedFilesOf, IMPACT_MAX_FILES_CEILING } = impact;
const { MAX_FILES_DEFAULT } = build;

const kind = (p) => (/(^|\/)fixtures\//.test(p) ? "夹具"
  : /(^|\/)tests?\//.test(p) || /\.test\.[cm]?[tsj]sx?$/u.test(p) ? "测试" : "真项目文件");

/** 复刻 `impact/index.ts:407-415` 的闭包（glob → 实际波及的文件集），唯一区别是能吃任意帽。 */
function closureOf(graph, globs) {
  const out = new Set();
  for (const file of graph.files) {
    if (!globs.some((g) => globMatchesPath(g, file))) continue;
    out.add(file);
    for (const sym of graph.defs.keys()) {
      if (!(graph.defs.get(sym) ?? []).some((d) => d.file === file)) continue;
      for (const site of upward(graph, sym)) out.add(site.file);
    }
  }
  return [...out];
}

const dirCap = await mkdtemp(join(tmpdir(), "lease-probe-cap-"));
const dirFull = await mkdtemp(join(tmpdir(), "lease-probe-full-"));

const capped = await buildImpact({ workspace: ROOT, cacheDir: dirCap, maxFiles: MAX_FILES_DEFAULT });
const full = await buildImpact({ workspace: ROOT, cacheDir: dirFull, maxFiles: IMPACT_MAX_FILES_CEILING });
const cappedFiles = new Set(capped.files);

console.log(`面 = ${ROOT}`);
console.log(`建图：缺省帽 ${String(MAX_FILES_DEFAULT)} ⇒ 实收 ${String(capped.files.length)} 个／全量帽 ${String(IMPACT_MAX_FILES_CEILING)} ⇒ 实收 ${String(full.files.length)} 个`);

// A＝一个在缺省图内的真文件；B＝A 的波及集里「全量图算得出、缺省图算不出」的第一个**真项目文件**。
const aClosureCap = closureOf(capped, ["src/events/index.ts"]);
const aClosureFull = closureOf(full, ["src/events/index.ts"]);
const invisible = aClosureFull.filter((f) => !aClosureCap.includes(f));
const bCandidates = invisible.filter((f) => kind(f) === "真项目文件" && existsSync(join(ROOT, f)));
const B = bCandidates[0];

if (B === undefined) {
  console.log("本面没有「被帽切掉的波及文件」（候选数≤帽 或 这一例的波及全在图内）⇒ 这一格在本面不成立，探针不编结论。");
  await rm(dirCap, { recursive: true, force: true });
  await rm(dirFull, { recursive: true, force: true });
  process.exit(0);
}

const A = "src/events/index.ts";
console.log(`\n对：A = ${A}（在缺省图内）   B = ${B}（档=${kind(B)}，在缺省图外＝${String(!cappedFiles.has(B))}）`);
console.log(`前置：glob 层不相交（${String(!globIntersects(A, B))}）⇒ 按 orchestrator.ts:627 这一对**只可能**被语义层抓到`);
console.log(`波及：A 缺省臂 ${String(aClosureCap.length)} 个／A 全量臂 ${String(aClosureFull.length)} 个（差 ${String(invisible.length)} 个，其中真项目文件 ${String(bCandidates.length)} 个）`);

// 两臂都走同一个判定内核 semanticConflictsVia；只有 hook 的取料帽不同。
const capHook = (globs) => affectedFilesOf(ROOT, globs, dirCap);
const fullHook = async (globs) => closureOf(full, globs);

const capVerdict = await semanticConflictsVia(capHook, [B], [{ agentId: "w-A", resources: [A] }]);
const fullVerdict = await semanticConflictsVia(fullHook, [B], [{ agentId: "w-A", resources: [A] }]);

// 反向对照：把生产端那条 hook 原样接上（不传帽），确认"放行"确实是默认路径给的不是探针造的。
const prodVerdict = await semanticConflictsVia(capHook, [B], [{ agentId: "w-A", resources: [A] }]);
const bClosureProd = await affectedFilesOf(ROOT, [B], dirCap);

console.log(`\n判定（同一 semanticConflictsVia，只换帽）：`);
console.log(`  缺省帽臂（＝今天默认路径）⇒ 冲突 ${String(capVerdict.length)} 条  ${capVerdict.length === 0 ? "⇒ orchestrator.ts:630 不发审批卡，spawn 直接过" : JSON.stringify(capVerdict)}`);
console.log(`  全量帽臂                ⇒ 冲突 ${String(fullVerdict.length)} 条  ${fullVerdict.length === 0 ? "" : JSON.stringify(fullVerdict)}`);
console.log(`  生产端 hook 原样（affectedFilesOf，无 maxFiles 位）⇒ B 的波及集 = ${String(bClosureProd.length)} 个（空集 ⇒ lease-conflicts.ts:29 continue，B 这一侧也静默为空）`);

const admitted = capVerdict.length === 0 && fullVerdict.length > 0;
console.log(`\n结论：${admitted ? "**成立**——同一对声明，全量图会拦、缺省帽放行" : "本面不成立（两臂判定相同）⇒ 别把这段读成缺陷已证"}`);
console.log(`口径自检：capVerdict 与 prodVerdict 必须同形（同 hook 同输入）＝${String(capVerdict.length === prodVerdict.length)}`);

await rm(dirCap, { recursive: true, force: true });
await rm(dirFull, { recursive: true, force: true });
