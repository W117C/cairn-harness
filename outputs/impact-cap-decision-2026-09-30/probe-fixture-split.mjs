// 复算：cd <仓根> && node --import tsx outputs/impact-cap-decision-2026-09-30/probe-fixture-split.mjs
// 也可 DSH_ROOT=<仓根绝对路径>。缺省 ROOT＝当前工作目录 ⇒ 不写死任何一棵临时树（临时树会被删）。
// 一次性探针：帽外 112 个文件 / 分歧漏报 / **确证**漏报 三档各按 夹具·测试·真项目文件 分类。
// 取料方式与仓内那把尺逐字对齐（graph.defs + upward + confirmedExtraOf），免得量出第二个"分歧率"。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const pick = async (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const impact = await pick("src/agent/impact/index.ts");
const build = await pick("src/agent/map/build.ts");
const measure = await pick("scripts/measure-impact-cap-divergence.ts");
const { buildImpact, upward, IMPACT_MAX_FILES_CEILING } = impact;
const { MAX_FILES_DEFAULT } = build;
const { confirmedExtraOf } = measure;

const kind = (p) => (/(^|\/)fixtures\//.test(p) ? "夹具"
  : /(^|\/)tests?\//.test(p) || /\.test\.[cm]?[tsj]sx?$/u.test(p) ? "测试" : "真项目文件");
const tally = (list) => {
  const m = new Map();
  for (const f of list) m.set(kind(f), (m.get(kind(f)) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k}=${String(v)}`).join(" ");
};
const answerOf = (graph, file) => {
  const syms = [...graph.defs.keys()].filter((s) => (graph.defs.get(s) ?? []).some((d) => d.file === file));
  const out = new Set();
  for (const s of syms) for (const site of upward(graph, s)) out.add(site.file);
  return out;
};

const cDir = await mkdtemp(join(tmpdir(), "probe-cap-"));
const fDir = await mkdtemp(join(tmpdir(), "probe-full-"));
try {
  const capped = await buildImpact({ workspace: ROOT, cacheDir: cDir, maxFiles: MAX_FILES_DEFAULT });
  const full = await buildImpact({ workspace: ROOT, cacheDir: fDir, maxFiles: IMPACT_MAX_FILES_CEILING });
  const inCapped = new Set(capped.files);
  const extraFiles = full.files.filter((f) => !inCapped.has(f));
  console.log(`ROOT=${ROOT}`);
  console.log(`帽外文件 ${String(extraFiles.length)} 个：${tally(extraFiles)}`);

  const missedAll = new Set();
  const missedConfirmed = new Set();
  let divergentQueries = 0;
  let confirmedQueries = 0;
  for (const f of capped.files) {
    const a = answerOf(capped, f);
    const b = answerOf(full, f);
    const extra = [...b].filter((x) => !a.has(x) && x !== f);
    if (extra.length > 0) {
      divergentQueries += 1;
      for (const x of extra) missedAll.add(x);
    }
    const conf = confirmedExtraOf(capped, full, f);
    if (conf.length > 0) {
      confirmedQueries += 1;
      for (const x of conf) missedConfirmed.add(x);
    }
  }
  console.log(`上界：有分歧查询=${String(divergentQueries)}／答不出的波及文件（去重）=${String(missedAll.size)}：${tally([...missedAll])}`);
  console.log(`下界（确证，唯一符号定义）：查询=${String(confirmedQueries)}／文件（去重）=${String(missedConfirmed.size)}：${tally([...missedConfirmed])}`);
} finally {
  await rm(cDir, { recursive: true, force: true });
  await rm(fDir, { recursive: true, force: true });
}
