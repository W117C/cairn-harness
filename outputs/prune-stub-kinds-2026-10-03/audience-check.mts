// 第 310 页落锚点前的前置问题：`src/main/agent-runner.ts#body` 这一面到底是不是 **model** 受众。
// 如果不是，那「撤掉登记 ⇒ 清单判据红」这条锚点就是空操作（针脚命中了，判卷永远不会红）。
// 所以这条读数不是解释，是**造锚点前的必要条件检查**（选子先证选得中）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { promiseInventoryFindings, RUNNERS, scanPromiseSites } from "../../scripts/probe-promise-recall.ts";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";

const ROOT = process.cwd();
const key = (s: { file: string; fn: string }): string => s.file + "#" + s.fn;

const scope = trackedExistingFiles(ROOT, "src");
const files = scope.files.map((p: string) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const sites = scanPromiseSites(files);
const k = "src/main/agent-runner.ts#body";
const hits = sites.filter((s: { file: string; fn: string }) => key(s) === k);
const f = promiseInventoryFindings(sites, RUNNERS);
console.log(`命中面数=${String(hits.length)}｜受众=${[...new Set(hits.map((s: { audience: string }) => s.audience))].join("/")}`);
console.log(`在 modelKeys 里=${String(f.modelKeys.includes(k))}｜在 stale 里=${String(f.stale.includes(k))}｜当前 unjudged=${String(f.unjudged.length)} 条`);
// 反事实：把这一面的登记撤掉，unjudged 会不会多出一条？（会 ⇒ 锚点有 killer）
const without = { ...RUNNERS } as Record<string, string>;
delete without[k];
const f2 = promiseInventoryFindings(sites, without);
console.log(`撤掉登记后 unjudged=${String(f2.unjudged.length)} 条：${f2.unjudged.join(" | ")}`);
