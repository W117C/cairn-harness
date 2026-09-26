// 红门的完整输出必须落盘（第 123 页）。
//
// 立这条的实测理由：`pnpm gates` 对失败门只印**输出尾 12 行**且不落盘 ⇒ 它报「7 条变异存活或误伤」
// 却不给那 7 条的名字；要拿名字只能单独复跑 `mutate-verify`，实测耗时 **1,007s**。
// 一门红而不可定位，等于把验证闭环的"修正"那一半交给一次 17 分钟的复跑。
//
// 落盘是**侧信道**：写失败只出声，绝不改变任何一道门的结论或退出码（同 gates.ts 耗时账本的口径）。
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FAILURE_DIR,
  FAILURE_TAIL_LINES,
  failureFileName,
  failureFooter,
  failureFilePath,
  writeFailureLog,
} from "../scripts/lib/gate-failure-log";
import { GATES } from "../scripts/gate-manifest";

describe("failureFileName：门名 → 文件名（门名来自清单，但落盘路径不赌上游）", () => {
  it("清单里真实存在的三种门名形状都能落成合法文件名", () => {
    expect(failureFileName("docs-check")).toBe("docs-check.log");
    expect(failureFileName("sandbox:check")).toBe("sandbox_check.log");
    expect(failureFileName("provider:check")).toBe("provider_check.log");
  });

  it("分隔符与相对段被压掉：结果里不许有 `/`，也不许以点开头（`..` 段会逃出目录）", () => {
    for (const g of ["../../etc/passwd", "a/b/c", "  ", ""]) {
      const name = failureFileName(g);
      expect(name.includes("/")).toBe(false);
      expect(name.startsWith(".")).toBe(false);
      expect(name.endsWith(".log")).toBe(true);
    }
  });

  it("全空白与空串不能产出 `.log` 这种无名文件（那会互相覆盖）", () => {
    expect(failureFileName("")).toBe("unnamed.log");
    expect(failureFileName("   ")).toBe("unnamed.log");
  });

  it("真实清单里的门名两两不撞同一个文件（撞名等于把两道门的红合成一条）", () => {
    const names = GATES.map(failureFileName);
    expect(new Set(names).size).toBe(names.length);
    // 这条断言的价值在"清单变了也要成立"：今天 `:` 压成 `_` 不撞车，是因为清单里没有带下划线的门名。
    expect(names.filter((n) => n.includes("_"))).toContain("sandbox_check.log");
  });
});

describe("failureFilePath / failureFooter：路径要说出口", () => {
  it("路径落在 root 下的 FAILURE_DIR 里，且不包含 `..`", () => {
    const p = failureFilePath("/repo", "mutate-verify");
    expect(p.startsWith(join("/repo", FAILURE_DIR))).toBe(true);
    expect(p.includes("..")).toBe(false);
  });

  it("打印行必须自带路径——只说「已落盘」等于没落盘", () => {
    const line = failureFooter("/repo/.tmp/gate-failures/mutate-verify.log");
    expect(line).toContain("/repo/.tmp/gate-failures/mutate-verify.log");
    expect(line).toContain("尾部 12 行");
  });
});

describe("writeFailureLog：真写，且写的是全量", () => {
  it("200 行输出落盘后行数不减（截断只许发生在打印，不许发生在盘上）", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-fail-"));
    const output = Array.from({ length: 200 }, (_, i) => "line " + String(i)).join("\n");
    const r = writeFailureLog(root, "docs-check", output);
    expect(r.error).toBeUndefined();
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path, "utf8").split("\n")).toHaveLength(200);
  });

  it("空输出也要留下文件：门红了却一个字没输出，正是要查的形状（静默绿的那一族的反面）", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-fail-empty-"));
    const r = writeFailureLog(root, "gate-check", "");
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path, "utf8")).toBe("");
  });

  it("同一道门连红两次：后一次覆盖前一次，文件里只剩一份（不追加成长尾）", () => {
    const root = mkdtempSync(join(tmpdir(), "gate-fail-twice-"));
    writeFailureLog(root, "tools-check", "first");
    const r = writeFailureLog(root, "tools-check", "second");
    expect(readFileSync(r.path, "utf8")).toBe("second");
  });

  it("写不进去只出声，不抛：抛出去会把一次红变成整表崩溃，门的结论就不属于门了", () => {
    // root 指着一个**普通文件**：mkdir 必然失败（ENOTDIR），这里要的是"出错但没炸"。
    const tmp = mkdtempSync(join(tmpdir(), "gate-fail-bad-"));
    const notADir = join(tmp, "afile");
    writeFileSync(notADir, "x");
    const r = writeFailureLog(notADir, "docs-check", "boom");
    expect(r.path).toBe("");
    expect(typeof r.error).toBe("string");
  });
});

describe("接线（纯函数钉不住它自己有没有被用）", () => {
  const gatesSrc = readFileSync(join(__dirname, "..", "scripts", "gates.ts"), "utf8");
  // 只取代码行：注释里那些"以前只贴尾巴"的描述会让判据自我命中（第 118 页实测过的假阳性）。
  const codeLines = gatesSrc
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("红门分支同时握着落盘与打印：缺一个就是这次要修的缺陷", () => {
    expect(codeLines).toContain("writeFailureLog(");
    expect(codeLines).toContain("failureFooter(");
  });

  it("尾部行数收成一份常量，且展示预算没被顺手加大（本笔不许把 stdout 变成洪水）", () => {
    expect(FAILURE_TAIL_LINES).toBe(12);
    expect(codeLines).toContain("slice(-FAILURE_TAIL_LINES)");
  });

  it("反向哨兵：落盘失败那一路必须被容错包住（不许出现裸调用把红门升级成崩溃）", () => {
    const calls = codeLines.split("writeFailureLog(").length - 1;
    expect(calls).toBeGreaterThan(0);
    // gates.ts 里 writeFailureLog 的返回值要被人读（error 或 path 至少出现一次），否则"写失败只出声"是空话
    expect(codeLines.includes("r.error") || codeLines.includes(".error")).toBe(true);
  });
});
