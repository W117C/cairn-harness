// 第 311 页的**前置现读**（不是尺，是量法）：`audienceOf` 只把 `console.*` 认成"给运维看"，
// 而本仓 CLI 一律走 `process.stdout/stderr.write` ⇒ 那些句 usage / 审批提示 现在都被判成 model 受众。
// 这一格为什么值得先量：受众决定"这句话欠不欠一次判定"，判错方向有两个相反的后果——
//   多判（假红）：一句给人看的 usage 文案被要求"照那句做一遍"；
//   少判（假绿）：反过来如果把工具输出认成 operator，模型真读的文案就永远不进清单。
// 取料与判定都**复用探针自己那一份**（`scanPromiseSites`／`trackedExistingFiles`），不在这里重算受众。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { promiseInventoryFindings, scanPromiseSites } from "../../scripts/probe-promise-recall.ts";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";

const ROOT = process.cwd();
const scope = trackedExistingFiles(ROOT, "src");
const files = scope.files.map((p: string) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const sites = scanPromiseSites(files);
const f = promiseInventoryFindings(sites, {});
console.log(`扫到面 ${String(sites.length)} 处｜受众分布 ${JSON.stringify(f.byAudience)}｜modelKeys ${String(f.modelKeys.length)} 条`);
const cli = sites.filter((s: { file: string }) => s.file === "src/cli.ts");
console.log(`住在 src/cli.ts 的面：${String(cli.length)} 处（受众=${[...new Set(cli.map((s: { audience: string }) => s.audience))].join("/")}）`);
for (const s of cli) console.log(`  ${s.file}:${String(s.line)} [${s.audience}] ${s.mark} ⇒ ${s.text.slice(0, 90)}`);
const byFile = new Map<string, number>();
for (const s of sites) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
console.log("按文件：" + [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${String(v)}`).join(" ｜ "));
