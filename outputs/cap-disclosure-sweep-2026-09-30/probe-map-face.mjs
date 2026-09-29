// 复算：DSH_ROOT=<仓根> node --import tsx outputs/cap-disclosure-sweep-2026-09-30/probe-map-face.mjs
// 09-30 普查分诊出的那一格（规则 278 的第四个消费者）：**给模型看的仓库地图**也吃同一个 mtime 帽——
//   `src/agent/map/build.ts:211` `scanSourceFiles(merged.workspace, merged.maxFiles ?? MAX_FILES_DEFAULT)`，
//   而 `glm-session.ts:630` 是 `opts.map === false ? null : …` ⇒ **默认开**；render/build 里现读**没有**任何覆盖面自述。
// 这一支在**同一棵树、同一份预算**上只换 `maxFiles`（400 vs 全量帽），量"地图少给了模型什么"；
// 另外把渲染预算（`MAP_TOKENS_MAX=4096`）也摆出来——两道帽里哪道才是瓶颈，是要看数的，不是猜的。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const pick = async (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const build = await pick("src/agent/map/build.ts");
const render = await pick("src/agent/map/render.ts");
const { buildMap, scanSourceFilesAll, MAX_FILES_DEFAULT } = build;
const { MAP_TOKENS_MAX } = render;

const dirs = [];
const tmp = async (tag) => { const d = await mkdtemp(join(tmpdir(), `mapface-${tag}-`)); dirs.push(d); return d; };

const PATH_RE = /([A-Za-z0-9_.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs))/g;
const pathsIn = (text) => {
  const out = new Set();
  for (const m of text.matchAll(PATH_RE)) if (!m[1].includes("node_modules")) out.add(m[1]);
  return out;
};

const candidates = await scanSourceFilesAll(ROOT);
console.log(`面 = ${ROOT}`);
console.log(`全量候选 = ${String(candidates.length)} 个 · 缺省帽 = ${String(MAX_FILES_DEFAULT)} · 全量帽(=IMPACT_MAX_FILES_CEILING 同位) = 5000 · 渲染帽 MAP_TOKENS_MAX = ${String(MAP_TOKENS_MAX)}`);

const run = async (label, maxFiles, budgetTokens) => {
  const t0 = Date.now();
  const r = await buildMap({ workspace: ROOT, tagsCacheDir: await tmp(label), maxFiles, budgetTokens });
  const ms = Date.now() - t0;
  const paths = pathsIn(r.text);
  console.log(`\n[${label}] maxFiles=${String(maxFiles)} budgetTokens=${String(budgetTokens ?? "缺省")} ok=${String(r.ok)} parsed=${String(r.parsed)} tokens=${String(r.tokens)} 文本行=${String(r.text.split("\n").length)} 文中出现的路径=${String(paths.size)} 耗时=${String(ms)}ms${r.ok ? "" : " error=" + String(r.error ?? "?")}`);
  return { r, paths };
};

const capped = await run("缺省帽", MAX_FILES_DEFAULT);
const full = await run("全量帽", 5000);

const onlyFull = [...full.paths].filter((p) => !capped.paths.has(p));
const onlyCapped = [...capped.paths].filter((p) => !full.paths.has(p));
const kind = (p) => (/(^|\/)fixtures\//.test(p) ? "夹具"
  : /(^|\/)tests?\//.test(p) || /\.test\.[cm]?[tsj]sx?$/u.test(p) ? "测试" : "真项目文件");
const tally = (list) => {
  const m = new Map();
  for (const f of list) m.set(kind(f), (m.get(kind(f)) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k}=${String(v)}`).join(" ");
};

console.log(`\n帽换掉之后，地图里**多出现**的路径 ${String(onlyFull.length)} 个（${tally(onlyFull)}）：${onlyFull.slice(0, 12).join(", ")}${onlyFull.length > 12 ? " …" : ""}`);
console.log(`反向（缺省帽独有）${String(onlyCapped.length)} 个（${tally(onlyCapped)}）：${onlyCapped.slice(0, 12).join(", ")}${onlyCapped.length > 12 ? " …" : ""}`);
console.log(`文本是否逐字相同＝${String(capped.r.text === full.r.text)} · 长度 ${String(capped.r.text.length)} vs ${String(full.r.text.length)} 字符 · 指纹 ${capped.r.fingerprint.slice(0, 12)} vs ${full.r.fingerprint.slice(0, 12)}`);
console.log(`自述检查：地图正文里有没有"覆盖／帽／另有"这类字＝${/覆盖|帽|另有|未列出|截断/.test(capped.r.text) ? "有" : "没有（模型看不到自己拿到的是残缺地图）"}`);

for (const d of dirs) await rm(d, { recursive: true, force: true });
