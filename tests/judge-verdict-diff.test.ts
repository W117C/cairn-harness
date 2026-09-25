/** 两棵树判卷对账这把尺的判卷面（第 86 页）。
 *  重点是**取料**：vitest 的输出有 `✓`/`×`/`❯` 三种状态符、`N failed` 计数、`FAIL` 头、栈行、ANSI 色码，
 *  少认一种就会把"红"读成"没跑"或造出一个不存在的文件键——那正是本模块要防的那类假绿。 */
import { describe, expect, it } from "vitest";

import { diffVerdicts, greenCount, HOW_TO_READ, parseFileVerdicts, stripAnsi, type FileVerdict } from "../scripts/lib/judge-verdict-diff";

const v = (file: string, verdict: "绿" | "红", counts: string = ""): FileVerdict => ({ file, verdict, counts });

describe("parseFileVerdicts：四种红都要认，栈行不许造键", () => {
  it("`✓ file (10 tests)` ⇒ 绿，计数原文留着自证", () => {
    const m = parseFileVerdicts(" ✓ tests/tools.test.ts (10 tests) 45ms\n");
    expect([...m.keys()]).toEqual(["tests/tools.test.ts"]);
    expect(m.get("tests/tools.test.ts")?.verdict).toBe("绿");
    expect(m.get("tests/tools.test.ts")?.counts).toBe("10 tests");
  });

  it("`❯ file (15 tests | 1 failed)` ⇒ 红（vitest 用 ❯ 做文件级汇总的那种写法）", () => {
    expect(parseFileVerdicts(" ❯ tests/mutate-anchor-titles.test.ts (15 tests | 1 failed) 37ms\n").get("tests/mutate-anchor-titles.test.ts")?.verdict).toBe("红");
  });

  it("`× file` ⇒ 红", () => {
    expect(parseFileVerdicts(" × tests/a.test.ts\n").get("tests/a.test.ts")?.verdict).toBe("红");
  });

  it("只见到 `FAIL file >` 头（文件级行被截断/0 用例就崩）⇒ 也算红，不许读成『没跑到＝绿』", () => {
    const m = parseFileVerdicts(" FAIL  tests/b.test.ts > d > case\nAssertionError: x\n");
    expect(m.get("tests/b.test.ts")?.verdict).toBe("红");
  });

  it("栈行 `❯ file.test.ts:139:117` 不许造出一个新键（否则对账会冒出假的存在性差异）", () => {
    const log = " ❯ tests/c.test.ts (1 tests | 1 failed) 3ms\n ❯ tests/c.test.ts:12:7\n";
    expect([...parseFileVerdicts(log).keys()]).toEqual(["tests/c.test.ts"]);
  });

  it("带 ANSI 色码的输出一律可读（验收环境不一定是 TERM=dumb）", () => {
    const colored = " \x1b[32m✓\x1b[39m tests/d.test.ts (2 tests)\n \x1b[31m×\x1b[39m tests/e.test.ts (1 tests | 1 failed)\n";
    expect(stripAnsi(colored)).not.toContain("\x1b");
    expect(parseFileVerdicts(colored).get("tests/d.test.ts")?.verdict).toBe("绿");
    expect(parseFileVerdicts(colored).get("tests/e.test.ts")?.verdict).toBe("红");
  });

  it("同一文件既有红行又有绿行 ⇒ 红（漏计比误报贵）", () => {
    const m = parseFileVerdicts(" ❯ tests/f.test.ts (3 tests | 1 failed)\n ✓ tests/f.test.ts (3 tests)\n");
    expect(m.get("tests/f.test.ts")?.verdict).toBe("红");
  });

  it("非 `tests/` 路径与 describe 汇总行都不收（`❯ 真表：…` 那种不带路径的行）", () => {
    const log = "   ❯ 真表：新漂移必须红，存量必须逐条点名 (6)\n ✓ scripts/x.test.ts 取料面只认 tests/ 前缀\n";
    expect([...parseFileVerdicts(log).keys()]).toEqual([]);
  });
});

describe("diffVerdicts：六个桶各有唯一读法，且『两棵都绿』不进结果", () => {
  const head = new Map<string, FileVerdict>([
    ["tests/both-green.test.ts", v("tests/both-green.test.ts", "绿")],
    ["tests/head-red.test.ts", v("tests/head-red.test.ts", "红", "1 failed")],
    ["tests/both-red.test.ts", v("tests/both-red.test.ts", "红", "2 failed")],
    ["tests/gone.test.ts", v("tests/gone.test.ts", "绿")],
  ]);
  const disk = new Map<string, FileVerdict>([
    ["tests/both-green.test.ts", v("tests/both-green.test.ts", "绿")],
    ["tests/head-red.test.ts", v("tests/head-red.test.ts", "绿", "9 passed")],
    ["tests/both-red.test.ts", v("tests/both-red.test.ts", "红", "2 failed")],
    ["tests/disk-red.test.ts", v("tests/disk-red.test.ts", "红", "1 failed")],
    ["tests/new.test.ts", v("tests/new.test.ts", "绿")],
  ]);
  const byFile = new Map(diffVerdicts(head, disk).map((r) => [r.file, r.kind]));

  it("被未提交改动垫住的已提交红 ⇒『只在 HEAD 红』", () => {
    expect(byFile.get("tests/head-red.test.ts")).toBe("只在 HEAD 红");
  });

  it("会随提交进 HEAD 的新红 ⇒『只在盘上红』（这一桶必须逐条归因才能提交）", () => {
    expect(byFile.get("tests/disk-red.test.ts")).toBe("只在盘上红");
  });

  it("存量红 ⇒『两棵都红』；在途删除 ⇒『只在 HEAD 有』；未入库新判卷面 ⇒『只在盘上有』", () => {
    expect(byFile.get("tests/both-red.test.ts")).toBe("两棵都红");
    expect(byFile.get("tests/gone.test.ts")).toBe("只在 HEAD 有");
    expect(byFile.get("tests/new.test.ts")).toBe("只在盘上有");
  });

  it("两棵都绿的不出现在差异里（否则读数会被 200 多行绿淹没）", () => {
    expect(byFile.has("tests/both-green.test.ts")).toBe(false);
  });

  // 本模块第一版把存在性判在颜色**之前**：`tests/disk-red.test.ts`（只在盘上有、且红）被归进
  // "未入库的新判卷面，正常"那一桶 ⇒ 等于给一条会随提交进 HEAD 的红灯发了通过票。自己的用例当场抓到。
  it("颜色优先于存在性：只在盘上有的文件若红 ⇒ 仍算『只在盘上红』（新判卷面也会随提交进 HEAD）", () => {
    const h = new Map<string, FileVerdict>();
    const d = new Map<string, FileVerdict>([["tests/newred.test.ts", v("tests/newred.test.ts", "红", "3 tests | 1 failed")]]);
    expect(diffVerdicts(h, d).map((r) => r.kind)).toEqual(["只在盘上红"]);
  });

  it("镜像一侧：HEAD 里红、主树已把该文件删掉 ⇒ 归『只在 HEAD 红』，不许混进在途删除那桶", () => {
    const h = new Map<string, FileVerdict>([["tests/gonerad.test.ts", v("tests/gonerad.test.ts", "红", "1 failed")]]);
    expect(diffVerdicts(h, new Map<string, FileVerdict>()).map((r) => r.kind)).toEqual(["只在 HEAD 红"]);
  });

  it("每个桶都要有读法——加一桶就得加一句，编译器逼齐键（漏一句就是那种『状态没人解释』的老病）", () => {
    const kinds = ["只在 HEAD 红", "只在盘上红", "两棵都红", "只在 HEAD 有", "只在盘上有", "两棵都绿"] as const;
    const table: Record<(typeof kinds)[number], string> = { ...HOW_TO_READ };
    for (const k of kinds) expect(table[k], `HOW_TO_READ[${k}] 缺读法`).not.toBe("");
  });

  it("greenCount 只数两侧都绿的那批", () => {
    expect(greenCount(head, disk)).toBe(1);
  });
});
