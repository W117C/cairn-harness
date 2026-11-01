/** 第 955 页：同一条「JSON 对象」判定在 35 个文件里各抄了一份。
 *
 *  值域其实只有一句话：非 null、非数组的 object。抄多份的代价不是打字，而是漂移：
 *  `src/agent/evidence.ts` 那一份就漏了 `!Array.isArray`（数组也能通过），其余各份虽然今天
 *  逐字相同，但下一次改口径时没有任何东西保证它们一起改。判据钉三件事：
 *   · 共享实现的值域（数组 / null / 原始值都不是 Record）；
 *   · 源码里只剩 `src/is-record.ts` 一处定义（任何文件重新写一份都红）；
 *   · 各消费面确实读的是同一份（不是留着旧定义只加一行 import）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord } from "../src/is-record";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "src/is-record.ts";
const ROOTS = ["src", "apps/desktop/src"];

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

describe("JSON 对象判定只有一份（第 955 页）", () => {
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

  it("源码里只剩共享实现一处定义，所有消费面都 import 它", () => {
    const offenders: string[] = [];
    const importers: string[] = [];
    for (const file of sourceFiles("src").concat(sourceFiles("apps/desktop/src"))) {
      if (relative(ROOT, join(ROOT, file)) === CANONICAL) continue;
      const source = read(file);
      if (/(?:function|const)\s+(?:isRecord|isPlainObject|isObject)\b/u.test(source)) offenders.push(file);
      if (/from "[^"]*is-record"/u.test(source)) importers.push(file);
    }

    expect(offenders).toEqual([]);
    expect(importers.length).toBeGreaterThanOrEqual(30);
    const canonical = read(CANONICAL);
    expect(canonical).toContain("export function isRecord");
    expect(canonical).toContain("!Array.isArray(value)");
  });
});
