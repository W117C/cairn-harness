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

  it("漂移集合 ⊆ 已登记存量；名单外多一条即红", () => {
    if (tableText === null) return; // 上一条用例已经红了
    const rows = parseAnchors(tableText).filter((r) => r.test !== null && r.expectFail !== null);
    const sources: TableSource[] = [];
    for (const rel of new Set(rows.map((r) => r.test!).filter((p) => p.endsWith(".test.ts")))) {
      const text = read(rel);
      if (text !== null) sources.push({ path: rel, text });
    }
    const findings = checkAnchorTitles(rows, sources, KNOWN_DRIFT);
    expect(findings.filter((f) => f.kind === "drift").map((f) => f.id)).toEqual([]);
  });

  it("存量名单不许静默烂在这儿：登记了却不再命中 ⇒ stale 红", () => {
    if (tableText === null) return;
    const rows = parseAnchors(tableText);
    const findings = checkAnchorTitles(rows, [], KNOWN_DRIFT);
    const stale = findings.filter((f) => f.kind === "stale-waiver").map((f) => f.id);
    // 空表取料时每条存量都会被判 stale，所以只要求"真表 + 空 sources"这一格里 stale 被点名出来
    expect(stale.length).toBeGreaterThan(0);
  });

  it("存量条数不写死在注释里，由本文件自己数（写死即漂移磁铁）", () => {
    expect(Object.keys(KNOWN_DRIFT).length).toBeGreaterThan(0);
  });
});
