/** 第 262 页取证：把「贴帽读数」这几支纯函数**喂真机数据**跑一遍（规则 237：计数尺先喂真数据）。
 *  取料＝同目录 `suite-quiet.json`（一次全量 `--reporter=json` 的原文）＋仓内真判卷源码。
 *  要答的三件事：⑴ 预算抽取在真文件上取到没有（两种 vitest 写法各有一处真样本）；
 *  ⑵ 「逐字标题对不上」能不能**按成因分档**，且每一档给得出真机样本；
 *  ⑶ 名单有没有分辨力（抬帽清空／压帽出批，且点到那两份真红过的文件）。
 *  用法：`node --import tsx outputs/judge-timeout-2026-10-01/realdata.mts`（退 0＝三件都过） */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { budgetFromTestSource, defaultTimeoutFromConfig, suiteRows, timingCell, timingNearCapCell } from "../../scripts/lib/head-cert-deps";
import type { BudgetLookup } from "../../scripts/lib/head-cert-deps";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string | null => {
  try { return readFileSync(join(repo, rel), "utf8"); } catch { return null; }
};

const rows = suiteRows(readFileSync(join(here, "suite-quiet.json"), "utf8"), repo);
if (rows === null) { console.log("❌ json 取不到／形状不认识 ⇒ 这一格没量到"); process.exit(2); }
console.log(`逐条用例：${String(rows.length)} 条`);
if (rows.length < 1000) { console.log("❌ 条数不对（全量应 3000 条以上）⇒ 取料坏了"); process.exit(2); }

/* 真样本两形各一条，标题都**从数据里现取**：上一版这两条标题是我手抄的，一份文件里都不存在 ⇒ 抽取读成 not-resolved，
 *  这正是本仓那条老课（"抄之前先现读"）——所以哨兵的写法本身也要能被证伪。 */
const show = (l: BudgetLookup): string => l.kind === "explicit" ? `explicit ${String(l.ms)}` : l.kind;
const m3cRows = rows.filter((r) => r.file.endsWith("tests/m3c.test.ts")).sort((a, b) => b.ms - a.ms);
const slowest = m3cRows[0];
const posTitle = slowest?.title ?? "";
const posBudget = slowest === undefined ? { kind: "not-resolved", why: "数据里没有 m3c 那条" } as BudgetLookup : budgetFromTestSource(read(slowest.file) ?? "", posTitle);
const prText = read("tests/worker-project-rules.test.ts") ?? "";
const optM = /it\(\s*"([^"]+)",\s*\{\s*timeout:\s*([0-9_]+)\s*\}/u.exec(prText);
const optTitle = optM?.[1] ?? "";
const optWant = Number((optM?.[2] ?? "0").replace(/_/gu, ""));
const optBudget = budgetFromTestSource(prText, optTitle);
const missing = budgetFromTestSource(read("tests/m3c.test.ts") ?? "", "这一条标题根本不在那份文件里 xyzzy");
const implicit = budgetFromTestSource(`it("某条没有预算的用例", () => {\n  expect(1).toBe(1);\n});\n`, "某条没有预算的用例");
console.log(`预算抽取·位置式：标题「${posTitle.slice(0, 40)}」⇒ 现读 ${show(posBudget)}`);
console.log(`预算抽取·选项式：标题「${optTitle.slice(0, 40)}」⇒ 源码写的是 ${String(optWant)}，抽取现读 ${show(optBudget)}`);
console.log(`标题不在那份文件里 ⇒ 现读 ${show(missing)}（应为 not-resolved，不能读成 implicit＝「没写预算」）`);
console.log(`写了收尾但没写预算 ⇒ 现读 ${show(implicit)}（应为 implicit＝缺省帽说了算，正常态）`);
if (posBudget.kind !== "explicit" || posBudget.ms < 5000 || optWant === 0 || !(optBudget.kind === "explicit" && optBudget.ms === optWant)
  || missing.kind !== "not-resolved" || implicit.kind !== "implicit") {
  console.log("❌ 预算抽取与真文件不符 ⇒ 这一格的接线不可信");
  process.exit(2);
}

const cfgBudget = defaultTimeoutFromConfig(read("tests/vitest.config.ts"));
console.log(`缺省帽现读：${cfgBudget.source}`);
const cell = timingNearCapCell(rows, { defaultBudget: cfgBudget, readTest: read, limit: 8 });
console.log(timingCell(cell));
console.log(`state=${cell.state} total=${String(cell.total)} implicit=${String(cell.implicit)} nonliteral=${String(cell.nonliteral)} notResolved=${String(cell.notResolved)}`);
/* 非字面量标题那一档要有**每一形的名字**，不能只是一个数：三形各从数据里现取一条。
 *  初稿这里写的是「128 条全部是 it.each、0 条真取不到」——那是我在测**之前**写的，实测连否三次：
 *  ① 89 条 `it.each` ＋ 39 条别的成因；② 第二形是反引号插值 `it(\`${c.name} ⇒ …\`)`（读数变 111／3）；
 *  ③ 剩的 3 条里一条是 `"…" + TRUTH.edgeCount + "…"` 拼接、两条是 `it(face.name + "：…")`，
 *     而它们先前逐字对不上还叠着第三个成因：**源码里带转义**（`\"`、`\\`），标题是解了转义的那一份
 *     ⇒ 取料改成 `JSON.stringify(title)`（与变异表里的「松钉指针」同族）。 */
const nonliteral = rows
  .map((r) => ({ r, l: budgetFromTestSource(read(r.file) ?? "", r.title) }))
  .filter((x) => x.l.kind === "nonliteral") as { r: (typeof rows)[number]; l: Extract<BudgetLookup, { kind: "nonliteral" }> }[];
/* **按命中的形状分组**，而不是按"这个文件里有没有那种形状"挑样本：后者会拿一个隔壁文件的名义形状
 *  冒充这一条的成因（第一版就这么点错了：`pick("concat")` 返回的是 `tests/head-cert-deps.test.ts`，
 *  而那条的成因其实是反引号插值——文件里两种形状都有）。 */
const byShape = new Map<string, { count: number; sample: string }>();
for (const { r, l } of nonliteral) {
  const shape = l.fileHas.replace(/\s+/gu, "");
  const prev = byShape.get(shape);
  byShape.set(shape, { count: (prev?.count ?? 0) + 1, sample: prev === undefined ? `${r.file}·「${r.title.slice(0, 46)}」` : prev.sample });
}
for (const [shape, v] of [...byShape.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`非字面量·形状「${shape}」：${String(v.count)} 条｜样本 ${v.sample}`);
}
if (cell.nonliteral !== nonliteral.length) { console.log("❌ 档位计数与逐行数不一致 ⇒ 汇总行不可信"); process.exit(2); }
if (byShape.size < 2) { console.log("❌ 只归因出一种形状 ⇒ 这一档的归因不可信（真机至少同时存在 it.each 与插值／拼接）"); process.exit(2); }
if (cell.notResolved !== 0) {
  console.log(`❌ 有 ${String(cell.notResolved)} 条既没显式预算、也不是这三种形状 ⇒ 先修取料再谈名单`);
  process.exit(2);
}
/* 分辨力证人：把帽抬到 10 分钟 ⇒ 名单应清空；压到 1500ms ⇒ 名单必须有一批。两态不同形才算这把尺有牙。 */
const loose = timingNearCapCell(rows, { defaultBudget: { ms: 600000, source: "证人：抬帽 600000ms" }, readTest: read, limit: 8 });
const strict = timingNearCapCell(rows, { defaultBudget: { ms: 1500, source: "证人：压帽 1500ms" }, readTest: read, limit: 8 });
console.log(`抬帽到 600000ms ⇒ 名单 ${String(loose.near.length)} 条（应为 0）；压到 1500ms ⇒ 名单 ${String(strict.near.length)} 条（应远大于 0）`);
if (loose.near.length !== 0 || strict.near.length < 5) { console.log("❌ 两态同形 ⇒ 别看上面的名单"); process.exit(2); }
/* 压帽那一批要**点到那两条真红过的用例**（`bd5ec44` 第一趟超时的那两份文件里的用例）——点名能力得有见证，
 *  不然"名单"只是长度对得上。按文件核对，不按顺序（顺序由 ratio 排，我不该替它写死）。 */
const redFiles = ["tests/mutate-shards.test.ts", "tests/mutate-verify-gates.test.ts"];
const hit = redFiles.filter((f) => strict.near.some((n) => n.file === f));
console.log(`压帽名单里点到那两份红过的文件：${String(hit.length)}/${String(redFiles.length)}（${hit.join("、") || "无"}）`);
for (const f of redFiles) {
  const slowestRow = rows.filter((r) => r.file === f).sort((a, b) => b.ms - a.ms)[0];
  if (slowestRow === undefined) { console.log(`  ${f}：数据里没有这个文件的用例 ⇒ 取料坏了`); process.exit(2); }
  const b = budgetFromTestSource(read(f) ?? "", slowestRow.title);
  /* 后半句**由 b.kind 决定**，不是我写的：显式预算取到了才说"补预算把它从缺省名单里摘出去了"，取不到就照实说没取到。 */
  const why = b.kind === "explicit"
    ? `已有显式预算 ${String(b.ms)}ms ⇒ 它不再按缺省 5000 进名单（这就是本笔补预算的效果）`
    : `预算档位＝${show(b)} ⇒ 仍按缺省算`;
  console.log(`  ${f}：最慢 ${String(Math.round(slowestRow.ms))}ms·${show(b)}·在压帽名单里=${String(strict.near.some((n) => n.file === f))}｜${why}`);
}
if (hit.length === 0) { console.log("❌ 那两份红过的用例一条都没被点到 ⇒ 名单的点名能力没有见证"); process.exit(2); }
/* 收尾那句**由数据说**，不由我写。上一版这里硬写了「名单第一条就是那一次红过的那条」，
 *  而两次运行（补预算前/后）这一格**都是 0 条**：m3c 那条一直自带 25_000（15198/25000＝61%），
 *  `bd5ec44` 那两条超时是并发抬上去的（安静态 2.26–2.75s＝缺省帽的 45–55%）。
 *  ⇒ 这一格的用处是"跑完之后把贴帽的点名出来"（负载重的趟会给出门道），不是预测并发；写在这儿免得被读成预言机。 */
const worst = cell.near[0];
console.log(worst === undefined
  ? "✅ 两态证人过；这一趟贴帽名单为空（安静态没有用例贴帽；bd5ec44 那两条超时是并发抬上去的，见文件末注）"
  : `✅ 点名第一条：${worst.file}·${worst.full.slice(0, 40)} ${String(Math.round(worst.ms))}ms／帽 ${String(worst.budget)}ms`);
