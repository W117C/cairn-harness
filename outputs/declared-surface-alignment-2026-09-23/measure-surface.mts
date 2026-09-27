/** 能力 26「声明面 vs 可达面」取证探针（三问）：
 *  ① 全仓扫 `export const X = [...] as const` / `new Set([...])` 这类**字面量集合**，
 *     按标识符分组：有没有同名多份、且成员不一致？（这是 agent 幻觉工具/选项的结构成因）
 *  ② 对 provider 这条链算**双向差集**：注册表说有、设置里没有（用户看不见）；
 *     设置里有、key 面存不下（选了也白选）。两边各是几格？
 *  ③ 症状面：真语料里模型有没有调用过"注册表里不存在的工具"（`unknown tool`）？
 *  跑法：TERM=dumb node --import tsx outputs/declared-surface-alignment-2026-09-23/measure-surface.mts
 *  只读。取法按形状（解析成员列表），不按整串字面量比。 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (abs: string): string => (existsSync(abs) ? readFileSync(abs, "utf8") : "");
function walkTs(d: string, acc: string[]): string[] {
  for (const n of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    const rel = d + "/" + n.name;
    if (n.isDirectory()) { if (n.name !== "node_modules") walkTs(rel, acc); }
    else if (/\.ts$/.test(n.name)) acc.push(rel);
  }
  return acc;
}
const SRC = walkTs("src", []);

/** 从 `[ "a", "b" ]` 里抽成员（按引号取，不比字符串整串）。 */
const membersOf = (literal: string): string[] =>
  [...literal.matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2] ?? "").filter((s) => s !== "");

interface Def { file: string; name: string; vals: string[] }
const defs: Def[] = [];
for (const rel of SRC) {
  const body = read(join(ROOT, rel));
  for (const m of body.matchAll(/export const (\w+)\s*(?::[^=]*)?=\s*(\[[^\]]*\])/g)) {
    const vals = membersOf(m[2]);
    if (vals.length > 0) defs.push({ file: rel, name: m[1], vals });
  }
  for (const m of body.matchAll(/new Set(?:<[^>]*>)?\(\s*\[([^\]]*)\]\s*\)/g)) {
    const vals = membersOf(m[1]);
    if (vals.length > 0) defs.push({ file: rel, name: "(Set)", vals });
  }
}
const byName = new Map<string, Def[]>();
for (const d of defs) byName.set(d.name, [...(byName.get(d.name) ?? []), d]);

console.log(`## ① 字面量集合清单（共 ${defs.length} 处，标识符 ${byName.size} 个）`);
let dupSame = 0, dupDiff = 0;
for (const [name, list] of byName) {
  if (name === "(Set)" || list.length < 2) continue;
  const sigs = new Set(list.map((d) => [...d.vals].sort().join(",")));
  const tag = sigs.size === 1 ? "成员一致" : "**成员不一致**";
  if (sigs.size === 1) dupSame++; else dupDiff++;
  console.log(`   ${name}：${list.length} 份 ⇒ ${tag}`);
  for (const d of list) console.log(`      ${d.file.padEnd(38)} [${d.vals.join(", ")}]`);
}
console.log(`   ⇒ 同名多份：一致 ${dupSame} 组 / **不一致 ${dupDiff} 组**；另有 ${defs.length} 处单份声明（无法比对）`);
if (dupDiff === 0) console.log("   ⚠️ 报 0 不一致时先怀疑取法——本仓已知 provider 名单三份不同（自检护栏）。");

// ---------------- ② provider 链的双向差集 ----------------
const grab = (file: string, name: string): string[] => {
  const d = defs.find((x) => x.file === file && x.name === name);
  return d ? d.vals : [];
};
const registry = grab("src/providers/registry.ts", "PROVIDER_IDS");
const kinds = grab("src/main/settings.ts", "PROVIDER_KINDS");
const keyStore = grab("src/main/provider-keys.ts", "PROVIDER_IDS");
console.log("\n## ② provider 这条链：注册表 / 设置面 / key 存储面");
console.log(`   registry.ts PROVIDER_IDS    = [${registry.join(", ")}]`);
console.log(`   settings.ts PROVIDER_KINDS  = [${kinds.join(", ")}]`);
console.log(`   provider-keys PROVIDER_IDS  = [${keyStore.join(", ")}]`);
const minus = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));
console.log(`   注册表有、设置里选不到（**发货了但用户够不着**）：[${minus(registry, kinds).join(", ")}]`);
console.log(`   设置里出现、key 面存不下（**选了也白选**）：[${minus(kinds, [...keyStore, "demo"]).join(", ")}]`);
console.log("   同名 PROVIDER_IDS 两份不同值：registry=[" + registry.join(",") + "] vs provider-keys=[" + keyStore.join(",")
  + "] ⇒ " + (registry.join() === keyStore.join() ? "同" : "**不同**"));

// ---------------- ③ 症状面：模型调过不存在的工具吗 ----------------
const dirs = ["fixtures/mock", "fixtures/agents", "fixtures/no-progress",
  "outputs/loop-eval-v2-base", "outputs/loop-eval-v2-short", "outputs/loop-eval-2026-09-20-base",
  "outputs/loop-eval-2026-09-20-short", "outputs/ga-strategy-2026-09-20", "tmp/ga-smoke"];
const files: string[] = [];
for (const d of dirs) {
  let ns: string[] = [];
  try { ns = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const n of ns) if (n.endsWith(".jsonl")) files.push(join(ROOT, d, n));
}
const toolNames = new Set(grab("src/tools/base.ts", "TOOL_NAMES"));
const runtimeOnly = new Set(["remember", "obs_recall", "spawn_agent", "wait_for_agents", "spawnSupervise", "impact_query", "sidechat", "compact", "search_conversations"]);
const unknownCalls = new Map<string, number>();
for (const f of files) {
  for (const l of read(f).split("\n").filter(Boolean)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    if (e.type === "tool_result" && /unknown tool/.test(String(e.output ?? ""))) unknownCalls.set("(回执 unknown tool)", (unknownCalls.get("(回执 unknown tool)") ?? 0) + 1);
    if (e.type === "tool_call") {
      const nm = String(e.name ?? "");
      if (nm !== "" && !toolNames.has(nm) && !runtimeOnly.has(nm)) unknownCalls.set(`未登记的名字：${nm}`, (unknownCalls.get(`未登记的名字：${nm}`) ?? 0) + 1);
    }
  }
}
console.log(`\n## ③ 症状面（${files.length} 个语料文件；静态工具名表 ${toolNames.size} 个 + 运行时注入 ${runtimeOnly.size} 个别单列）`);
if (unknownCalls.size === 0) console.log("   没抓到 unknown tool 回执，也没抓到未登记工具名 ⇒ **这条轴本地无观测者**（不等于没问题，同 25-G2 的判读法）");
for (const [k, v] of unknownCalls) console.log(`   ${k}: ${v}`);
console.log(`   ⚠️ 上面"运行时注入"那份名单是**我手抄的**（本仓没有'哪些工具是运行期注入'的表）`);
console.log("      ——这本身就是 ①/② 说的那件事的一个现场：静态名单与运行期名单**没有一份共同的源**。");
