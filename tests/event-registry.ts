// 事件类型注册表的读料口（两份判卷共用：event-type-coverage 与 stream-redaction）。
// 为什么要抽出来：这两张闸判的是同一句「注册表里有哪些型」，各抄一份正则的话，
// KNOWN_TYPES 换个写法就会只有一支红、另一支静默数到 0 个类型而报「全过」。
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "..");
const EVENTS = "src/events/index.ts";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** 事件类型注册表（append 时拒未知类型的那一份）。 */
export function knownTypes(): string[] {
  const src = read(EVENTS);
  const start = src.indexOf("const KNOWN_TYPES = new Set([");
  if (start < 0) throw new Error(`${EVENTS} 里找不到 KNOWN_TYPES —— 改名了要同步这张闸`);
  const body = src.slice(start, src.indexOf("]);", start));
  return [...body.matchAll(/^\s*"([a-z_]+)",$/gm)].map((m) => m[1] as string);
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
    const i = src.indexOf(`export interface ${n} `);
    const lit = i < 0 ? null : src.slice(i, i + 1200).match(/\btype:\s*"([a-z_]+)"/)?.[1] ?? null;
    if (lit === null) unresolved.push(n);
    else out.push(lit);
  }
  if (unresolved.length > 0) {
    throw new Error(`AgentEvent 成员解析不出 type 字面量（拒绝当成“没有这个类型”）：${unresolved.join(", ")}`);
  }
  return out;
}
