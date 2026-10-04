// R2 的一致性判据（2026-10-05，评审 §2.3 R2 的后半句「配一致性判据」）。
//
// **缺陷形状**：`package.json` 的 `engines.node` 声明了这份代码能在哪些 Node 上跑，而代码里
// 用到一些**有最低版本要求**的 API。两个数各自都是对的，**但它们之间没有东西连着**——
// 声明 `>=20.3.0` 而代码用 `import.meta.dirname`（需 ≥20.11）时，**在声明支持的区间上会 TypeError**。
// 评审当时的读数是 18 处 `import.meta.dirname`。
//
// **为什么不能只靠"当时人改了"**：下限与用法是两处独立演进的东西。谁在低版本分支上加一处
// `import.meta.dirname`，或者谁把下限调回去，**都不会有任何东西响**——这正是本仓反复判死的
// "两个数看似一致"形状。本判据把那层关系写成可执行的：**用到的每个特性，其最低版本都必须
// 被 `engines.node` 的下限覆盖**。
//
// 判据是**纯函数**（输入 engines 字符串 + 找到的特性集合，输出 findings），所以能双向断言：
// 红相命中 + 反相不误伤（把一个真缺口判红，同时不把合法配置误伤）。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 带最低 Node 版本要求的 API。**新加一行就是声明"这个特性从哪个版本起可用"**。 */
export const ENGINE_FEATURES: ReadonlyArray<{ name: string; re: RegExp; min: readonly [number, number]; why: string }> = [
  {
    name: "import.meta.dirname／filename",
    re: /import\.meta\.(?:dirname|filename)/u,
    min: [20, 11],
    why: "这两个属性是 Node 20.11 才进的（此前是 undefined，取 `.dirname` 当场 TypeError）",
  },
];

/** 从 `engines.node` 里取下限。只认 `>=x.y.z` 这个形状；取不到就报 `null`（＝未检，不是通过）。 */
export function enginesFloor(spec: string | undefined): readonly [number, number, number] | null {
  if (spec === undefined) return null;
  const m = /(?:^|\s)>=\s*(\d+)\.(\d+)\.(\d+)/u.exec(spec);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `min` 是否被下限覆盖。比较到 minor：`20.11` ≤ `20.11.0` ⇒ 覆盖。 */
export function coveredBy(floor: readonly [number, number, number] | null, min: readonly [number, number]): boolean {
  if (floor === null) return false;
  if (floor[0] !== min[0]) return floor[0] > min[0];
  return floor[1] >= min[1];
}

export interface EnginesFinding {
  kind: "floor-unparsed" | "feature-not-covered";
  detail: string;
}

/** 纯判据：给下限字符串与"盘上找到了哪些特性"，返回 findings。 */
export function checkEnginesCoverage(spec: string | undefined, found: readonly { name: string; min: readonly [number, number]; why: string }[]): EnginesFinding[] {
  const out: EnginesFinding[] = [];
  const floor = enginesFloor(spec);
  if (floor === null) {
    // 「取不到」与「没问题」必须不同形：解析不出来时**不能**当通过（否则改一次写法就静默失效）。
    out.push({ kind: "floor-unparsed", detail: `engines.node 读不出来（现读 ${String(spec)}）⇒ 下限无法与用法对账，属未检` });
    return out;
  }
  for (const f of found) {
    if (!coveredBy(floor, f.min)) {
      out.push({
        kind: "feature-not-covered",
        detail: `代码用到 ${f.name}（需 ≥${f.min[0]}.${f.min[1]}），而 engines.node 的下限是 ${floor[0]}.${floor[1]}.${floor[2]} ⇒ 声明支持的区间上会 TypeError。${f.why}`,
      });
    }
  }
  return out;
}

/** 盘上扫一遍：只扫真实源码面（src/scripts/tests 的 .ts/.mts），不扫 outputs 与 node_modules。 */
function scanFeatures(root: string): Array<{ name: string; min: readonly [number, number]; why: string }> {
  const hit = new Map<string, { name: string; min: readonly [number, number]; why: string }>();
  const walk = (rel: string): void => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel === "" ? e.name : rel + "/" + e.name;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "outputs" || e.name.startsWith(".")) continue;
        walk(r); continue;
      }
      if (!/\.(ts|mts)$/u.test(e.name)) continue;
      const src = readFileSync(join(root, r), "utf8");
      for (const f of ENGINE_FEATURES) if (f.re.test(src)) hit.set(f.name, f);
    }
  };
  for (const top of ["src", "scripts", "tests"]) walk(top);
  return [...hit.values()];
}

describe("R2 · engines.node 的下限必须覆盖代码里用到的特性（评审 §2.3）", () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { engines?: { node?: string } };

  it("真仓：下限覆盖全部已用特性（缺口为 0）", () => {
    const found = scanFeatures(process.cwd());
    // 先证"这条判据真在扫东西"——一处特性都没找到时它恒绿，等于没写。
    expect(found.length, "一处带版本要求的特性都没扫到 ⇒ 判据恒绿（扫描面坏了），不是通过").toBeGreaterThan(0);
    expect(checkEnginesCoverage(pkg.engines?.node, found)).toEqual([]);
  });

  it("两态：下限低于特性要求 ⇒ 恰一条红，且点名是哪两处数对不上", () => {
    const found = [{ name: "import.meta.dirname", min: [20, 11] as const, why: "20.11 才有" }];
    const bad = checkEnginesCoverage(">=20.3.0 <25", found);
    expect(bad.map((f) => f.kind)).toEqual(["feature-not-covered"]);
    expect(bad[0]!.detail).toContain("20.11");
    expect(bad[0]!.detail).toContain("20.3.0");
    // 反相：同一条判据在下限够高时**必须一条都不报**（否则它是个永远红的门）
    expect(checkEnginesCoverage(">=20.11.0 <25", found)).toEqual([]);
    // 边界：恰好等于也覆盖（20.11.0 覆盖 20.11）
    expect(checkEnginesCoverage(">=20.11.0", found)).toEqual([]);
    // 跨大版本：22.x 也覆盖 20.11
    expect(checkEnginesCoverage(">=22.0.0", found)).toEqual([]);
  });

  it("第三态：下限解析不出来 ⇒ 报 `floor-unparsed`（未检），**不当通过**", () => {
    // 「读不出来」与「没问题」同形是本仓点过名的一族缺陷：改一次写法（比如去掉 `>=`）就静默失效。
    const found = [{ name: "x", min: [20, 11] as const, why: "" }];
    expect(checkEnginesCoverage(undefined, found).map((f) => f.kind)).toEqual(["floor-unparsed"]);
    expect(checkEnginesCoverage("node 20.x", found).map((f) => f.kind)).toEqual(["floor-unparsed"]);
    expect(enginesFloor(">=20.11.0 <25")).toEqual([20, 11, 0]);
    expect(enginesFloor("^20.11.0")).toBeNull();
  });
});
