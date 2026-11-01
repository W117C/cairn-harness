/** 第 965 页：同一条「JSON 对象」判定在 42 个文件里各写了一遍。
 *
 *  37 份是命名副本（`isRecord` / `isObject` / `isPlainObject`），另有 6 处直接内联。
 *  值域其实只有一句话：非 null、非数组的 object。抄多份的代价不是打字，而是漂移：
 *  `src/agent/evidence.ts` 那一份就漏了 `!Array.isArray`（数组也能通过），挂上收据字段的数组
 *  会被 `validateReceipt` 当成合法收据；其余各份虽然今天逐字相同，但下一次改口径时没有
 *  任何东西保证它们一起改。判据钉四件事：
 *   · 共享实现的值域（数组 / null / 原始值都不是 Record）；
 *   · 伪造的「数组收据」必须 schema-mismatch；
 *   · 源码里只剩 `src/is-record.ts` 一处定义 / 一处内联（任何文件重新写一份都红）；
 *   · 各消费面确实读的是同一份（不是留着旧定义只加一行 import）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/is-record";
import { buildReceipt, validateReceipt } from "../src/agent/evidence";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "src/is-record.ts";
const ROOTS = ["src", "apps/desktop/src", "scripts"];
const LOCAL_DEFINITION = /(?:function|const)\s+(?:isRecord|isPlainObject|isObject)\b/u;
const INLINE_PREDICATE = /typeof\s+([A-Za-z_$][\w$]*)\s*===\s*"object"\s*&&\s*\1\s*!==\s*null\s*&&\s*!Array\.isArray\(\1\)/u;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-electron") continue;
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx)$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

describe("JSON 对象判定只有一份（第 965 页）", () => {
  it("只认非 null、非数组的 object；数组与原始值一律不是 Record", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null) as object)).toBe(true);

    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    for (const value of [0, 1, "", "x", true, false, 1n, Symbol("x"), () => undefined]) {
      expect(isRecord(value), `${String(value)} 不该是 Record`).toBe(false);
    }
  });

  it("数组即使挂了收据字段也不是收据（旧 evidence 实现会收下）", () => {
    const source = `error: ${"x".repeat(1000)}\n`;
    const receipt = buildReceipt(source);
    if (receipt === null) throw new Error("fixture 应产出一份收据");
    const forged: unknown = Object.assign([], receipt);
    expect(validateReceipt(forged, source)).toEqual({ ok: false, reason: "schema-mismatch" });
  });

  it("源码里只剩共享实现一处定义 / 一处内联，所有消费面都 import 它", () => {
    const offenders: string[] = [];
    const importers: string[] = [];
    for (const file of ROOTS.flatMap(sourceFiles)) {
      if (relative(ROOT, join(ROOT, file)) === CANONICAL) continue;
      const source = read(file);
      if (LOCAL_DEFINITION.test(source) || INLINE_PREDICATE.test(source)) offenders.push(file);
      if (/from "[^"]*is-record"/u.test(source)) importers.push(file);
    }

    expect(offenders).toEqual([]);
    expect(importers.length).toBeGreaterThanOrEqual(40);
    const canonical = read(CANONICAL);
    expect(canonical).toContain("export function isRecord");
    expect(canonical).toContain("!Array.isArray(value)");
  });
});
