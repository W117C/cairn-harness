// 门禁自检判据的回归测试（H-1 / H-2）。
// 这些用例守的是「体检本身」：体检若漏判，其余 22 道门的可信度都无从谈起。
import { describe, expect, it } from "vitest";
import { countUnverified, scanDisjunctions } from "../scripts/assertion-health";

describe("析取式弱断言扫描 scanDisjunctions（H-1）", () => {
  it("检出根级 || 断言（任一析取项成立即通过）", () => {
    const src = 'assert(a.includes(4) === false || !kf.has(4), "x");\n';
    const hits = scanDisjunctions("t.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("disjunction");
    expect(hits[0]!.line).toBe(1);
  });

  it("检出 && 内嵌套的 ||（旧的字面恒真式扫描漏网形态）", () => {
    const src = 'check(rep !== undefined && (rep.llm_reviewed === true || !process.env.M0_API_KEY), "K5b");\n';
    const hits = scanDisjunctions("t.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain("||");
  });

  it("豁免注释写在断言行尾 → 不命中", () => {
    const src = 'assert(!w.ok || /not permitted/i.test(w.output), "x"); // gates:disjunction-ok 被拒有两种合理表现\n';
    expect(scanDisjunctions("t.ts", src)).toHaveLength(0);
  });

  it("豁免注释写在断言上方 3 行内 → 不命中（本仓习惯把理由写在上方）", () => {
    const src = [
      "// gates:disjunction-ok 拒绝可表现为非零退出或 stderr 报 EPERM",
      "assert(!w.ok || /not permitted/i.test(w.output), \"x\");",
      "",
    ].join("\n");
    expect(scanDisjunctions("t.ts", src)).toHaveLength(0);
  });

  it("豁免注释不带理由 → 仍命中（豁免必须可审计，不接受无声放行）", () => {
    const src = "assert(a || b, \"x\"); // gates:disjunction-ok\n";
    expect(scanDisjunctions("t.ts", src)).toHaveLength(1);
  });

  it("无析取的断言不命中（不误伤正常断言）", () => {
    const src = [
      'assert(!readSpecs.includes("shell_rw"), "J7c");',
      "check(rep !== undefined && rep.llm_reviewed === true, \"K5b\");",
      'assert(tail <= 15_000, "tail 超上界");',
      "",
    ].join("\n");
    expect(scanDisjunctions("t.ts", src)).toHaveLength(0);
  });

  it("非断言函数里的 || 不命中（只管断言，不管业务代码）", () => {
    const src = [
      "if (a || b) doThing();",
      "const v = x ?? (y || z);",
      'console.log(m || "n");',
      "",
    ].join("\n");
    expect(scanDisjunctions("t.ts", src)).toHaveLength(0);
  });

  it("多行书写：定位到条件表达式起始行（正是含 || 的那一行）", () => {
    // check( 在第 1 行，而条件 a === 1 || b === 2 始于第 2 行——报条件行比报调用行更可定位。
    const src = ["check(", "  a === 1 ||", "  b === 2,", '  "多行断言"', ");", ""].join("\n");
    const hits = scanDisjunctions("t.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(2);
  });
});

describe("未证计数 countUnverified（H-2）", () => {
  it("无标记 → 0", () => {
    expect(countUnverified("plugins-check: 12 ✅ / 0 ❌")).toBe(0);
  });

  it("单条标记求和", () => {
    expect(countUnverified("plugins-check: 12 ✅ / 0 ❌ / 3 未证\nUNVERIFIED=3\n")).toBe(3);
  });

  it("多条标记累加（一道门多次输出 / 多门汇总）", () => {
    expect(countUnverified("UNVERIFIED=2\nsomething\nUNVERIFIED=5\n")).toBe(7);
  });

  it("UNVERIFIED=0 显式声明零未证", () => {
    expect(countUnverified("UNVERIFIED=0\n")).toBe(0);
  });

  it("只认行首标记，不误伤行内出现的数字", () => {
    expect(countUnverified("see UNVERIFIED=3 inline\nUNVERIFIED=4\n")).toBe(4);
  });
});
