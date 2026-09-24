/** 锚点 expectFail 的标题漂移闸（2026-09-25）
 *  病灶：`mutate-verify` 的 runner 会在「测试红了但没红在 expectFail 点名的那条用例上」判存活（见其 8400 行）。
 *  于是**改了 it() 标题而没同步 expectFail**＝一条好锚点被报成"未杀"——代价是一次 963 条整跑（实测 36.9 分钟）
 *  才发现，而且发现的人还得靠人眼归类。今天我自己就是那两条（a966cd9）。
 *  判据形状照 docs-check 的 waive()：存量逐条带理由入表，**名单外的新漂移即红**；名单里某条不再命中 ⇒ stale 也红。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KNOWN_DRIFT, checkAnchorTitles, parseAnchors, type TableSource } from "../scripts/mutate-anchor-titles";

const ROOT = resolve(__dirname, "..");
const read = (rel: string): string | null => {
  try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
};

describe("parseAnchors：取料面自己要先可信", () => {
  it("按 id 边界切块；三条就是三条（整块切错会读出『总数 1』这种恒真读数）", () => {
    const table = [
      "export const MUTANTS = [",
      "  {",
      '    id: "a-one",',
      '    test: "tests/x.test.ts",',
      '    expectFail: "标题甲",',
      "  },",
      "  {",
      '    id: "b-two",',
      '    test: "tests/x.test.ts",',
      '    expectFail: "标题乙",',
      "  },",
      "];",
    ].join("\n");
    const rows = parseAnchors(table);
    expect(rows.map((r) => r.id)).toEqual(["a-one", "b-two"]);
    expect(rows[0]!.test).toBe("tests/x.test.ts");
  });

  it("表里的转义态按 JS 语义解出来（\\\" 是真引号）", () => {
    const rows = parseAnchors('{ id: "c", test: "tests/x.test.ts", expectFail: "matcher \\"Edit\\" 不得命中 NotebookEdit", }');
    expect(rows[0]!.expectFail).toBe('matcher "Edit" 不得命中 NotebookEdit');
  });
});

describe("checkAnchorTitles：漂移与误报的分界", () => {
  const src = (titles: string[]): TableSource => ({ path: "tests/x.test.ts", text: `describe("d", () => {\n${titles.map((t) => `  it("${t}", () => {});`).join("\n")}\n});` });

  it("标题逐字在场 ⇒ 无 finding", () => {
    const rows = parseAnchors('{ id: "m1", test: "tests/x.test.ts", expectFail: "开着 ⇒ 压缩次数严格更少", }');
    expect(checkAnchorTitles(rows, [src(["开着 ⇒ 压缩次数严格更少"])], {})).toEqual([]);
  });

  it("改了标题没同步 expectFail ⇒ 红并点名 id（这就是本闸存在的全部理由）", () => {
    const rows = parseAnchors('{ id: "m1", test: "tests/x.test.ts", expectFail: "开着 ⇒ 压缩次数不更多", }');
    const f = checkAnchorTitles(rows, [src(["开着 ⇒ 压缩次数严格更少"])], {});
    expect(f.map((x) => x.kind + ":" + x.id)).toEqual(["drift:m1"]);
  });

  it("参数化标题不误判：%s 与 ${} 渲染后的实参算命中", () => {
    const rows = parseAnchors('{ id: "m2", test: "tests/x.test.ts", expectFail: "恢复真回执（observationPack=true）", }');
    expect(checkAnchorTitles(rows, [{ path: "tests/x.test.ts", text: 'it("恢复真回执（observationPack=%s）", () => {});' }], {})).toEqual([]);
    expect(checkAnchorTitles(rows, [{ path: "tests/x.test.ts", text: "it(`恢复真回执（observationPack=${p}）`, () => {});" }], {})).toEqual([]);
  });

  it("expectFail 只写长标题的一段也算命中（runner 比的是输出里含不含这段）", () => {
    const rows = parseAnchors('{ id: "m3", test: "tests/x.test.ts", expectFail: "security_report 实测改投影", }');
    expect(checkAnchorTitles(rows, [src(["security_report 实测改投影：脏集要含它"])], {})).toEqual([]);
  });

  it("柯里形式的 it.each([...])(\"标题\") 也要抽到（真表里 4 条就栽在这一格）", () => {
    const rows = parseAnchors('{ id: "m5", test: "tests/x.test.ts", expectFail: "read 档：规格与实例同名同时出现", }');
    const curried: TableSource = {
      path: "tests/x.test.ts",
      text: 'it.each(["read", "write"] as const)("%s 档：规格与实例同名同时出现", (mode) => {});',
    };
    expect(checkAnchorTitles(rows, [curried], {})).toEqual([]);
  });

  it("vitest 的 $插值标题（`$label`）按通配处理", () => {
    const rows = parseAnchors('{ id: "m6", test: "tests/x.test.ts", expectFail: "零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形", }');
    const interpolated: TableSource = {
      path: "tests/x.test.ts",
      // 真实形状（tests/loop.test.ts:205）：it.each 的**表**里给 label，标题在第二个括号里用 $label 插值
      text: '  it.each([\n    { label: "缺省不开闸（未给 autoVerify）", call: "write_file" },\n  ])("零行为回退：$label → 无 verify_result、请求数与旧行为同形", async () => {});',
    };
    expect(checkAnchorTitles(rows, [interpolated], {})).toEqual([]);
  });

  it("非 vitest 面的锚点单列 unverified，不算漂移也不静默消失", () => {
    const rows = parseAnchors('{ id: "m4", test: "scripts/foo-check.ts", expectFail: "随便", }');
    const f = checkAnchorTitles(rows, [], {});
    expect(f.map((x) => x.kind + ":" + x.id)).toEqual(["unverified-face:m4"]);
  });
});

describe("真表：新漂移必须红，存量必须逐条点名", () => {
  const tableText = read("scripts/mutate-verify.mjs");
  it("表本身读得到（读不到＝没尺，不许把 0 条当结论）", () => {
    expect(tableText).not.toBeNull();
  });

  it("真表：漂移必须为 0，且存量名单一旦不再命中就该被点名（不许静默豁免）", () => {
    if (tableText === null) return; // 上一条用例已经红了
    const rows = parseAnchors(tableText).filter((r) => r.test !== null && r.expectFail !== null);
    const sources: TableSource[] = [];
    for (const rel of new Set(rows.map((r) => r.test!).filter((p) => p.endsWith(".test.ts")))) {
      const text = read(rel);
      if (text !== null) sources.push({ path: rel, text });
    }
    const findings = checkAnchorTitles(rows, sources, KNOWN_DRIFT);
    // 两条一起断言：漂移=有锚点指不到标题；stale=名单里躺着已经不再命中的豁免。
    // 只断言前一条，就等于允许"把已知红登记成存量后 forever 不回看"。
    expect(findings.filter((f) => f.kind === "drift" || f.kind === "stale-waiver").map((f) => f.kind + ":" + f.id)).toEqual([]);
  });

  it("豁免机制自己是活的：同一行标题，登记则免、不登记则红（两侧都要有）", () => {
    const rows = parseAnchors('{ id: "m7", test: "tests/x.test.ts", expectFail: "已经不存在的标题", }');
    const src: TableSource = { path: "tests/x.test.ts", text: 'it("现存标题", () => {});' };
    expect(checkAnchorTitles(rows, [src], {}).map((f) => f.kind + ":" + f.id)).toEqual(["drift:m7"]);
    expect(checkAnchorTitles(rows, [src], { "m7": "示例理由" })).toEqual([]);
    // 反过来：登记了但不再命中 ⇒ stale 点名（这就是"豁免不许静默烂在这儿"）。
    // 注意用一条**不漂移**的锚点来验：同一格里 drift 与 stale 会一起报，混着用就读不出谁在响。
    const alive = parseAnchors('{ id: "m7", test: "tests/x.test.ts", expectFail: "现存标题", }');
    expect(checkAnchorTitles(alive, [src], { "m8": "示例理由" }).map((f) => f.kind + ":" + f.id)).toEqual(["stale-waiver:m8"]);
  });

  it("存量名单若有条目，每条必须带理由（空理由＝无声放行，本仓不接受）", () => {
    for (const [id, reason] of Object.entries(KNOWN_DRIFT)) {
      expect(reason.trim(), `KNOWN_DRIFT[${id}] 缺理由`).not.toBe("");
    }
  });
});
