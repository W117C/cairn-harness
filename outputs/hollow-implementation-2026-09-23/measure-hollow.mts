/** 能力 21「实现被掏空」取证探针（四问）：
 *  ① 实弹：把函数实现成 stub（`return null; // TODO`），测试没覆盖它 ⇒ verify 绿，harness 说什么；
 *  ② 真 buildReceipt 对这种绿的 status/uncertain 是什么；
 *  ③ `uncertain` 这个字段有没有任何生产者能置真（死字段核查）；
 *  ④ 拿一把"看起来能用"的宽正则当判据，在本仓自己身上误报多少（证明必须 diff-scoped）。
 *  跑法：TERM=dumb node --import tsx outputs/hollow-implementation-2026-09-23/measure-hollow.mts */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { write_file } from "../../src/tools/write_file";
import { run_shell } from "../../src/tools/run_shell";
import { buildReceipt, hasFailureSignal } from "../../src/agent/evidence";
import type { ToolContext } from "../../src/tools/base";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------- ① + ② 实弹：掏空式实现能不能被读出来 ----------------
const ws = realpathSync(mkdtempSync(join(tmpdir(), "hollow-probe-")));
mkdirSync(join(ws, "tests"), { recursive: true });
writeFileSync(join(ws, "package.json"), '{"name":"p","type":"module","scripts":{"test":"node --test"}}\n', "utf8");
const IMPL_BEFORE = [
  "export function refund(order) {",
  "  if (order.paid !== true) throw new Error(\"not paid\");",
  "  return order.amount;",
  "}",
  "",
].join("\n");
const r0 = await write_file.run({ path: "src.mjs", content: IMPL_BEFORE }, { workspace: ws, callId: "w0", snapshot: false } as ToolContext);
// 测试只覆盖另一条路（paid!==true），对 refund 的正常返回不做断言 ⇒ 掏空它不会被测到
writeFileSync(join(ws, "tests", "a.test.mjs"), [
  "import { test } from \"node:test\";",
  "import assert from \"node:assert\";",
  "import { refund } from \"../src.mjs\";",
  "test(\"未支付要拒\", () => { assert.throws(() => refund({ paid: false, amount: 10 })); });",
  "",
].join("\n"), "utf8");

const t0 = await run_shell.run({ command: "npm test --silent 2>&1" }, { workspace: ws, callId: "s0", snapshot: false } as ToolContext);
console.log("## ① 实弹：把实现掏空");
console.log(`[掏空前] write_file 回执：${r0.output.replace(/\n/g, "\\n")}`);
console.log(`[掏空前] npm test ok=${t0.ok}（# pass ${/# pass (\d+)/.exec(t0.output)?.[1] ?? "?"} / fail ${/# fail (\d+)/.exec(t0.output)?.[1] ?? "?"}）`);

const IMPL_AFTER = [
  "export function refund(order) {",
  "  if (order.paid !== true) throw new Error(\"not paid\");",
  "  // TODO: 接支付网关退款 API",
  "  return null;",
  "}",
  "",
].join("\n");
const r1 = await write_file.run({ path: "src.mjs", content: IMPL_AFTER }, { workspace: ws, callId: "w1", snapshot: false } as ToolContext);
const t1 = await run_shell.run({ command: "npm test --silent 2>&1" }, { workspace: ws, callId: "s1", snapshot: false } as ToolContext);
console.log(`[掏空后] write_file 回执：${r1.output.replace(/\n/g, "\\n")}`);
console.log(`[掏空后] npm test ok=${t1.ok}（# pass ${/# pass (\d+)/.exec(t1.output)?.[1] ?? "?"} / fail ${/# fail (\d+)/.exec(t1.output)?.[1] ?? "?"}）⇒ **仍然全绿**`);
console.log(`盘上事实：refund 现在返回 ${/return null/.test(IMPL_AFTER) ? "**null（带 TODO 注释）**" : "真值"}，测试从没覆盖这条路径`);
const said = /TODO|掏空|空实现|stub|未实现|覆盖不到/.test(r1.output);
console.log(`判读：写盘回执里有没有任何一处提到新增行里有 TODO / 实现被掏空：${said ? "有" : "**没有**"}`);

const receipt = buildReceipt(t1.output, { maxQuoteChars: 600 });
console.log(`\n## ② 真 buildReceipt / hasFailureSignal 对这轮「绿」的判读（意外发现，如实记）`);
console.log(`   npm test 自己报：# pass ${/# pass (\d+)/.exec(t1.output)?.[1] ?? "?"} / # fail ${/# fail (\d+)/.exec(t1.output)?.[1] ?? "?"} ⇒ 绿`);
console.log(`   buildReceipt.status=${receipt?.status ?? "null"} uncertain=${receipt?.uncertain ?? "n/a"} —— 同一次运行，两说`);
const badLines = (t1.output.split("\n") ?? []).filter((l) => /error|fail|✖|not ok|AssertionError/i.test(l)).slice(0, 3);
console.log(`   被 hasFailureSignal 认领的行（文案匹配）：${badLines.map((l) => "「" + l.trim().slice(0, 60) + "」").join(" ") || "（无）"}`);
console.log(`   ⇒ 「红不红」在本仓有两套口径：exit code（verify/tool 用）与逐行文案匹配（evidence 用）；`);
console.log(`     这次是**后者误报红**（绿跑里的诊断噪声也被认成失败）——它与本页主轴相反，但同一条根：`);
console.log(`     文案匹配不是可靠判据（见 00 §五那条区分：非对抗面可用弱信号，判定面不行）。`);
rmSync(ws, { recursive: true, force: true });

// ---------------- ③ uncertain 是不是死字段 ----------------
function walkTs(d: string, acc: string[]): string[] {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (n.isDirectory()) walkTs(p, acc);
    else if (/\.ts$/.test(n.name)) acc.push(p);
  }
  return acc;
}
const assigns: string[] = []; const allSites: string[] = [];
for (const p of walkTs(join(ROOT, "src"), []).concat(walkTs(join(ROOT, "tests"), []))) {
  const b = readFileSync(p, "utf8");
  const rel = p.slice(ROOT.length + 1);
  b.split("\n").forEach((line, i) => {
    if (!/\buncertain\b/.test(line)) return;
    // 分「真赋值」与「类型/校验声明」：赋值形态 = uncertain: <表达式> 且该表达式不是类型名
    const m = /uncertain\s*:\s*([A-Za-z_$][\w$.]*)/.exec(line);
    const isType = m !== null && /^(boolean|string|number|unknown|any)$/.test(m[1]);
    const isCmp = /typeof|!==|===|==/.test(line);
    allSites.push(`${rel}（第 ${String(i + 1)} 行${isType ? "·类型声明" : isCmp ? "·校验" : m !== null ? "·赋值=" + m[1] : "·其它"}）`);
    if (m !== null && !isType && !isCmp) assigns.push(`${rel}: uncertain: ${m[1]}`);
  });
}
console.log("\n## ③ uncertain 生产者核查（只认**真赋值**，别把类型声明当成生产者）");
console.log("   全部出现处：" + allSites.join("；"));
const truthy = assigns.filter((s) => !/:\s*false$/.test(s));
console.log(`   真赋值共 ${assigns.length} 处，其中能置为非常量的：${truthy.length ? truthy.join(", ") : "**无**"}`);
console.log("   ⇒ 结论：schema 必填、解析时会因非 boolean 而 reject，但**唯一生产者恒写 false** ⇒ 该字段无生产者。");

// ---------------- ④ 宽正则的误报率（设计约束的取证） ----------------
const LOOSE = /(function\s+\w+\s*\([^)]*\)\s*\{|=>\s*\{)\s*\}/g;
const TODO_RE = /\/\/.*\b(TODO|FIXME|XXX)\b/g;
let looseHits = 0, todoHits = 0; const looseWhere: string[] = [];
for (const p of walkTs(join(ROOT, "src"), [])) {
  const b = readFileSync(p, "utf8");
  const l = b.match(LOOSE); const t = b.match(TODO_RE);
  if (l) { looseHits += l.length; if (looseWhere.length < 4) looseWhere.push(p.slice(ROOT.length + 1) + " ×" + l.length); }
  if (t) todoHits += t.length;
}
console.log("\n## ④ 拿宽正则当判据会怎样（这就是为什么必须 diff-scoped + 结构判定）");
console.log(`   「空函数体」宽正则在本仓 src 命中 ${looseHits} 处${looseWhere.length ? "，例如 " + looseWhere.join("；") : ""}`);
console.log(`   ——抽样看：这些多为空 catch / 空回调 / 接口方法声明，**不是掏空**；判据若据此出声就是自造假红。`);
console.log(`   「TODO/FIXME 注释」在 src 命中 ${todoHits} 处（这类是自我声明，可作弱信号——但只对本次新增行）。`);
