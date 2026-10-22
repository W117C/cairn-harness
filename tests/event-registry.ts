// 事件类型注册表的读料口（两份判卷共用：event-type-coverage 与 stream-redaction）。
// 为什么要抽出来：这两张闸判的是同一句「注册表里有哪些型」，各抄一份正则的话，
// KNOWN_TYPES 换个写法就会只有一支红、另一支静默数到 0 个类型而报「全过」。
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "..");
// 2026-10-17：协议面（`AgentEvent` 联合 + `KNOWN_TYPES`）从 src/events/index.ts 拆去
// src/events/types.ts（存储引擎去 ./log.ts；index 只做逐名再导出）。本取料口**按文件路径**取材——
// 拆分的同笔必须同步这一行，否则 knownTypes()/unionTypes() 会 fail-loud 抛错
// （设计如此：尺坏了要出声，不许静默数 0 条报「全过」）。
const EVENTS = "src/events/types.ts";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** 事件类型注册表（append 时拒未知类型的那一份）。
 *
 *  `KNOWN_TYPES` 在 2026-10-03 由 `new Set([...])` 改成 `Record<AgentEvent["type"], true>`
 *  （漏登记一个联合成员变成编译期错误）。取料口跟着改，两侧都 **fail-loud**：
 *  找不到声明、或声明不是对象字面量，都当场抛——绝不静默返回空数组，那会让
 *  `tests/stream-redaction.test.ts` 的「未表态类型」判据在零长度上假绿。 */
export function knownTypes(): string[] {
  const src = read(EVENTS);
  const start = src.indexOf("const KNOWN_TYPES");
  if (start < 0) throw new Error(`${EVENTS} 里找不到 KNOWN_TYPES —— 改名了要同步这张闸`);
  const open = src.indexOf("{", start);
  const close = open < 0 ? -1 : src.indexOf("};", open);
  if (open < 0 || close < 0) {
    throw new Error(`${EVENTS} 里 KNOWN_TYPES 不是对象字面量 —— 换了写法要同步这张闸`);
  }
  return [...src.slice(open, close).matchAll(/^\s*([a-z_]+): true,$/gm)].map((m) => m[1] as string);
}

/** 联合类型里的成员名 → 各自声明的 `type` 字面量。 */
export function unionTypes(): string[] {
  const src = read(EVENTS);
  const start = src.indexOf("export type AgentEvent =");
  if (start < 0) throw new Error(`${EVENTS} 里找不到 AgentEvent 联合`);
  const body = src.slice(start, src.indexOf(";", src.indexOf("RunErrorEvent", start)));
  const names = [...body.matchAll(/\|\s*([A-Za-z]+Event)\b/g)].map((m) => m[1] as string);
  const out: string[] = [];
  const unresolved: string[] = [];
  for (const n of names) {
    const lit = typeLiteralOf(n);
    if (lit === null) unresolved.push(n);
    else out.push(lit);
  }
  if (unresolved.length > 0) {
    throw new Error(`AgentEvent 成员解析不出 type 字面量（拒绝当成“没有这个类型”）：${unresolved.join(", ")}`);
  }
  return out;
}

/** 成员名 → 它声明的 `type` 字面量。
 *  成员可能是 interface，也可能是**别名联合**（如 `CompactionEvent = NumericCompaction | ReferencedCompaction`）：
 *  别名要逐个成员解析，且所有成员必须声明**同一个** type 字面量；解析不出就返回 null（上层 fail-loud）。 */
function typeLiteralOf(name: string, depth = 0): string | null {
  if (depth > 4) return null;
  const src = read(EVENTS);
  const iface = src.indexOf(`export interface ${name} `);
  if (iface >= 0) {
    const chunk = src.slice(iface, iface + 1600);
    const own = chunk.match(/\btype:\s*"([a-z_]+)"/)?.[1];
    if (own !== undefined) return own;
    // 成员接口可能把 `type` 字面量放在公共基接口里（`CompactionEvent` 的两种形式都 extends CompactionCommon）。
    const base = chunk.match(/extends\s+([A-Za-z0-9_]+)/)?.[1];
    return base === undefined ? null : typeLiteralOf(base, depth + 1);
  }
  const alias = src.indexOf(`export type ${name} =`);
  if (alias < 0) return null;
  const aliasBody = src.slice(alias + `export type ${name} =`.length, src.indexOf(";", alias));
  const members = [...aliasBody.matchAll(/(?:^|\|)\s*([A-Za-z0-9_]+)/g)]
    .map((m) => m[1]!)
    .filter((m) => m !== "undefined" && m !== "true" && m !== "false");
  const lits = members.map((m) => typeLiteralOf(m, depth + 1));
  const unique = [...new Set(lits.filter((l): l is string => l !== null))];
  return unique.length === 1 && lits.every((l) => l !== null) ? unique[0]! : null;
}
