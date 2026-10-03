/** 第 335 页补 · 把 **探针族**补进记分板（第一版只跑了门与判卷，漏了 `scripts/probe-*` 整族 ⇒ 这是规则 429 的同一格：名字要枚举，不许猜）。
 *  跑在干净 HEAD 树里；全部零模型花费。用法：node --import tsx outputs/capability-rescore-2026-10-04/rescore-probes.mjs <干净树绝对路径> */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAnsi } from "../../scripts/lib/vitest-summary.ts";

const TREE = process.argv[2];
if (TREE === undefined || TREE === "") { console.error("用法：node --import tsx rescore-probes.mjs <干净树路径>"); process.exit(2); }
const OUT = join(dirname(fileURLToPath(import.meta.url)), "probe-readings.log");

// 名单来自 `ls scripts/probe-*  scripts/goal-cost-probe.ts scripts/eval/report.ts` 的现读枚举，不靠记忆。
// 本文件刻意写成纯 JS（.mjs 走 tsx 也不保证剥类型注解；第一版带了 `Array<[...]>` 注解直接崩在这里）。
const PROBES = [
  ["①问题→代码位置 的命中尺", "probe-locate-recall", ["--import", "tsx", "scripts/probe-locate-recall.ts"]],
  ["①地图召回（真实仓库语料）", "probe-map-recall", ["--import", "tsx", "scripts/probe-map-recall.ts"]],
  ["①地图装配面（预算内塞得进多少）", "probe-map-compose", ["--import", "tsx", "scripts/probe-map-compose.ts"]],
  ["①波及面结论的出处", "probe-impact-provenance", ["--import", "tsx", "scripts/probe-impact-provenance.ts"]],
  ["⑤摘要/收束的覆盖率", "probe-summary-coverage", ["--import", "tsx", "scripts/probe-summary-coverage.ts"]],
  ["⑥压缩前附件回取", "probe-prune-recall", ["--import", "tsx", "scripts/probe-prune-recall.ts"]],
  ["⑦shell 绕过面枚举", "probe-shell-bypass", ["--import", "tsx", "scripts/probe-shell-bypass.ts"]],
  ["⑦写租约闭合（A/B 两臂）", "probe-lease-closure-ab", ["--import", "tsx", "scripts/probe-lease-closure-ab.ts"]],
  ["⑧网络截断那格的锚点claim", "probe-web-anchor-claim", ["--import", "tsx", "scripts/probe-web-anchor-claim.ts"]],
  ["④goal 模式自身的边际上下文成本", "goal-cost-probe", ["--import", "tsx", "scripts/goal-cost-probe.ts"]],
  ["⑩对账面（两次同配置读数的噪声带）", "eval-report", ["--import", "tsx", "scripts/eval/report.ts"]],
];

const lines = ["# 探针族零花费现读 · 树=" + TREE, ""];
for (const [cap, name, args] of PROBES) {
  const r = spawnSync(process.execPath, args, { cwd: TREE, encoding: "utf8", timeout: 300000 });
  const out = stripAnsi((r.stdout ?? "") + (r.stderr ?? ""));
  const code = r.status === null ? "取不到（超时或被杀）" : String(r.status);
  lines.push("=== " + cap + " ｜ " + name + " ｜ exit=" + code);
  const keep = out.split("\n").filter((l) => l.trim() !== "").slice(-18);
  for (const l of keep) lines.push("  " + l.slice(0, 220));
  lines.push("");
}
writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log("写好了：" + OUT + "（" + String(lines.length) + " 行）");
