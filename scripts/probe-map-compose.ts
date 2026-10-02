// 现读取证（能力 1 / 任务 #14）：地图的「候选面 / 渲染面」按根目录各占多少。
// 用法（两棵树各跑一次，同一支脚本 ⇒ 改动前后的差值只能归因给被测方）：
//   node --import tsx scripts/probe-map-compose.ts                 # 工作树（已排载荷）
//   cp scripts/probe-map-compose.ts <干净 HEAD 树>/scripts/ && 在那棵树里跑  # 改动前
//
// 分类只用「workspace 相对路径的第一段」，且**在本文件自己算**（classifyRoot）：
// 它只是给读数打标签，不是被测的排除逻辑——排除有没有生效看候选面读数（scanSourceFilesAll 那一支），
// 那才是生产端。判生产端谓词的地方是 tests/map-build.test.ts，不在这把尺里。
import { resolve } from "node:path";
import { buildMap, scanSourceFilesAll } from "../src/agent/map/build";

const REPO = resolve(import.meta.dirname, "..");
const BUDGETS = [1024, 2048, 4096];
const PAYLOAD_ROOTS = new Set(["fixtures", "outputs"]);

const classifyRoot = (rel: string): string => {
  const slash = rel.indexOf("/");
  const first = slash === -1 ? rel : rel.slice(0, slash);
  return PAYLOAD_ROOTS.has(first) ? "载荷(" + first + ")" : first;
};
const tally = (rels: string[]) => {
  const m = new Map<string, number>();
  for (const r of rels) m.set(classifyRoot(r), (m.get(classifyRoot(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${String(v)}`).join(" ");
};

const all = await scanSourceFilesAll(REPO);
console.log(`[compose] 候选面（生产端 scanSourceFilesAll 那一支）总数=${String(all.length)}`);
console.log(`[compose] 候选面按根目录：${tally(all.map((f) => f.rel))}`);

// 渲染面的取料方式与尺（probe-locate-recall）逐字同一支：PATHISH 正则、跳过 `│` 符号行。
const PATHISH = /[\w./-]+\.[a-z]{1,5}/g;
const rendered = (text: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("│")) continue;
    for (const m of line.match(PATHISH) ?? []) {
      const f = m.replace(/^\.\//, "");
      if (!/\.[a-z]{1,5}$/.test(f) || seen.has(f)) continue;
      seen.add(f);
      out.push(f);
    }
  }
  return out;
};

for (const budget of BUDGETS) {
  const built = await buildMap({ workspace: REPO, budgetTokens: budget });
  const files = rendered(built.text);
  const payload = files.filter((f) => classifyRoot(f).startsWith("载荷"));
  const pct = ((100 * payload.length) / Math.max(1, files.length)).toFixed(1);
  console.log(
    `[compose] 预算 ${String(budget)}：渲染文件=${String(files.length)} 载荷=${String(payload.length)} 载荷占比=${pct}% ` +
    `tokens=${String(built.tokens)} ／ 自述：候选=${String(built.candidates)} 进图=${String(built.graphFiles)} 帽=${String(built.cap)}`,
  );
  console.log(`[compose]   渲染面按根目录：${tally(files)}`);
}
