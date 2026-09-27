/** 能力 23「已发货面必须有观测者」取证探针（四问）：
 *  ① 历史复发次数：文档里「零调用者 / 零消费者 / 两头断 / 入口没通」这类手动发现有多少次；
 *  ② 事件面：`AgentEvent` 的每个 `type` 字面量，逐个查「真语料出现过 ∨ 被门/针脚/投影消费」；
 *  ③ 旗标面：`settings` 里的布尔开关，逐个查 src 里有没有**读取处**（只写不读 = 发货了但没接线）；
 *  ④ 导出面：`src/agent/**` 导出的函数，逐个查 src 里有没有调用者（排除自身定义文件与测试）。
 *  跑法：TERM=dumb node --import tsx outputs/observer-coverage-2026-09-23/measure-observers.mts
 *  只读。判据按**形状**取（成员集合 / 调用点正则），不按整串字面量匹配——上两轮的教训。 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
function walk(d: string, acc: string[]): string[] {
  for (const n of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const rel = d + "/" + n.name;
    if (n.isDirectory()) walk(rel, acc);
    else if (/\.[cm]?[tj]sx?$/.test(n.name)) acc.push(rel);
  }
  return acc;
}
const SRC = walk("src", []);
const SCRIPTS = walk("scripts", []);
const TESTS = walk("tests", []);

// ---------------- ① 历史复发 ----------------
const PHRASES = [/零调用者/g, /零消费者/g, /两头断/g, /入口没通/g, /无人调/g, /死代码/g, /零调用者/];
const hits: Array<[string, string]> = [];
for (const rel of ["docs/m5-acceptance.md", "docs/m3-acceptance.md", "docs/m4-acceptance.md", "docs/m2-acceptance.md",
  "AGENTS.md", "PROGRESS.md", "BLOCKED.md", "outputs/gap-fix-proposal-2026-09-23.md",
  "outputs/architecture-uplift-2026-09-21.md"]) {
  const body = read(rel);
  for (const re of PHRASES) { const m = body.match(re); if (m) hits.push([rel, m[0] + "×" + m.length]); }
}
console.log("## ① 同一个缺陷类被**手动**发现的次数（文档措辞计数）");
for (const [f, h] of hits) console.log(`   ${f.padEnd(46)} ${h}`);
console.log(`   合计命中 ${hits.length} 处文件-措辞组合 ⇒ 反复靠人肉抓，说明缺一台机器在数。`);

// ---------------- ② 事件面 ----------------
const evBody = read("src/events/index.ts");
// 第一版只取两空格缩进的 `type:` ⇒ 少算 9 类（`user_message`/`tool_call` 等基础事件都漏了，
// 21 vs 30）。这直接让「完全无观测者 = 0」这个结论建立在**残缺分母**上，故改为任意缩进取全集，
// 并把"两种取法成员数不等"本身当一条自检打印出来（枚举不全的门比没门更坏）。
const narrowTypes = [...new Set([...evBody.matchAll(/^\s{2}type:\s*"([a-z0-9_]+)"/gm)].map((m) => m[1]))];
const eventTypes = [...new Set([...evBody.matchAll(/\btype:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))];
const ifaceCount = new Set((evBody.match(/\binterface (\w+Event)\b/g) ?? []).map((s) => s.split(" ")[1])).size;
console.log(`[枚举自检] 窄取法 ${narrowTypes.length} / 宽取法 ${eventTypes.length} / interface XEvent 声明 ${ifaceCount}` +
  ` ⇒ 取法不等 = 枚举曾不全（本页 01 §四 记的正是这一条）`);
const corpusText: string[] = [];
for (const d of ["fixtures/no-progress", "fixtures/agents", "fixtures/mock", "fixtures/plugins/check",
  "outputs/ga-strategy-2026-09-20", "outputs/ga-strategy-2026-09-20-rep2", "outputs/ga-strategy-2026-09-20-rep3",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "tmp/ga-smoke"]) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) corpusText.push(read(d + "/" + n));
}
const allCorpus = corpusText.join("\n");
const consumers = SRC.concat(SCRIPTS).filter((f) => f !== "src/events/index.ts");
const consumerBody = consumers.map(read).join("\n");
const needleBody = TESTS.map(read).join("\n");
const unobserved: string[] = [];
const noCorpus: string[] = [];
for (const t of eventTypes) {
  const inCorpus = new RegExp(`"type"\\s*:\\s*"${t}"`).test(allCorpus);
  const consumed = new RegExp(`"${t}"`).test(consumerBody) || new RegExp(`"${t}"`).test(needleBody);
  if (!inCorpus) noCorpus.push(t);
  if (!inCorpus && !consumed) unobserved.push(t);
}
console.log(`\n## ② 事件面（按 \`type:\s*"…"\` 字面量取成员，共 ${eventTypes.length} 类；语料 ${corpusText.length} 个文件）`);
console.log(`   真语料里一次没出现：${noCorpus.length} 类 → ${noCorpus.join(", ")}`);
console.log(`   **既无真语料、又无任何 src/scripts/tests 消费**：${unobserved.length} 类 → ${unobserved.join(", ") || "（无）"}`);
console.log(`   ⇒ 前一数就是 G7 那条（当时记 13/30）；后一数才是本页要的「完全无观测者」。`);

// ---------------- ③ 旗标面 ----------------
const setBody = read("src/main/settings.ts");
const boolFlags = [...new Set([...setBody.matchAll(/^\s{2}(\w+)\s*:\s*boolean;$/gm)].map((m) => m[1]))];
const noReader: string[] = [];
for (const f of boolFlags) {
  // 「读取处」= 别的文件里出现 `.<f>` 或 `{ f }` 解构/对象取值；只在自己的定义行出现不算
  const re = new RegExp(`\\.${f}\\b|\\b${f}\\s*[:,}]|\\b${f}\\s*===`);
  const found = SRC.some((rel) => rel !== "src/main/settings.ts" && re.test(read(rel)));
  if (!found) noReader.push(f);
}
console.log(`\n## ③ settings 布尔旗标 ${boolFlags.length} 个`);
console.log(`   在 src 里**没有任何读取处**（写了默认值、没消费方）：${noReader.length ? noReader.join(", ") : "（无）"}`);

// ---------------- ④ 导出面 ----------------
const deadExports: string[] = [];
let exportedFns = 0;
for (const rel of walk("src/agent", [])) {
  const body = read(rel);
  for (const m of body.matchAll(/export (?:async )?function (\w+)/g)) {
    const name = m[1];
    exportedFns++;
    const re = new RegExp(`\\b${name}\\s*\\(`);
    const usedElsewhere = SRC.some((other) => other !== rel && re.test(read(other))) ||
      SCRIPTS.some((other) => re.test(read(other)));
    if (!usedElsewhere) deadExports.push(`${rel}:${name}`);
  }
}
console.log(`\n## ④ src/agent 导出函数 ${exportedFns} 个`);
console.log(`   在 src/scripts 里**零调用者**（可能只被测试消费）：${deadExports.length} 个`);
for (const d of deadExports.slice(0, 8)) console.log("     " + d);
if (deadExports.length > 8) console.log(`     …另 ${deadExports.length - 8} 个`);
console.log("   ⚠️ 第一版把这一数直接当缺陷是错的：谓词排除了定义文件自身，于是「本文件内被调用、只是没被外面调」");
console.log("     被误报成无人消费（例：`danglingToolCallNote`、`hasFailureSignal` 都在自己文件里用）。");
console.log("     ⇒ 分成三桶重取（这是本页真正的判据形状）：");
const testsBody = TESTS.map(read).join("\n");
const refCount = (name: string, ownFile: string): { total: number; outside: number } => {
  const re = new RegExp(`\\b${name}\\b`, "g");
  let total = 0, outside = 0;
  for (const rel of SRC.concat(SCRIPTS, TESTS)) {
    const body = read(rel);
    const ms = body.match(re);
    if (ms === null) continue;
    // 扣掉定义行自身那一次（`export function name(`）
    const defHere = rel === ownFile ? 1 : 0;
    const n = ms.length - defHere;
    total += n;
    if (rel !== ownFile) outside += n;
  }
  return { total, outside };
};
const trulyDead: string[] = [];
const ownFileOnly: string[] = [];
const testOnly: string[] = [];
for (const d of deadExports) {
  const [rel, name] = d.split(":");
  const { total, outside } = refCount(name, rel);
  const inTests = new RegExp(`\\b${name}\\s*\\(`).test(testsBody);
  if (total === 0 && !inTests) trulyDead.push(`${rel}:${name}`);
  else if (outside === 0 && !inTests) ownFileOnly.push(`${rel}:${name}`);
  else if (outside === 0) testOnly.push(`${rel}:${name}`);
}
console.log(`     A 桶·**完全无人引用**（真死码候选）${trulyDead.length} 个 → ${trulyDead.join(", ") || "（无）"}`);
console.log(`     B 桶·只在自己文件里用（导出面多余，非缺陷）${ownFileOnly.length} 个`);
console.log(`     C 桶·仅测试消费（合法设计：纯函数留测试面）${testOnly.length} 个`);
console.log(`   ⇒ 只有 A 桶配得上当缺陷；B/C 是卫生项。判据若不分桶，就会拿 92 这个数字去逼人选错修法。`);
