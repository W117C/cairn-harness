// 门禁自检判据的回归测试（H-1 / H-2）。
// 这些用例守的是「体检本身」：体检若漏判，其余 22 道门的可信度都无从谈起。
import { describe, expect, it } from "vitest";
import { countUnverified, gateUnverified, scanDisjunctions, silentGreenGate } from "../scripts/assertion-health";
import { VERDICT_MAX_CHARS, verdictLine } from "../scripts/lib/gate-verdict";
import { certifiedFace } from "../scripts/lib/certified-face";

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

  // H3（审查 P1-17）：label-first 签名（tools-check/prune-check/map-check 的
  // `check(label, cond, ...)`）条件在第二实参——旧扫描只看 arguments[0]，此形态全部漏网。
  it("label-first 签名：第二实参里的 || 检出（旧扫描盲区）", () => {
    const src = 'check("G1 宿主不响应 abort", elapsed < 2_000 || elapsed === undefined, "detail");\n';
    const hits = scanDisjunctions("t.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("disjunction");
  });

  it("label-first 签名：豁免注释同样生效", () => {
    const src = 'check("被拒有两种合理表现", !w.ok || /EPERM/.test(w.output), "x"); // gates:disjunction-ok 两种表现\n';
    expect(scanDisjunctions("t.ts", src)).toHaveLength(0);
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

// 第 39 项：一道门绿而一个字没吐，"查了没发现"与"压根没查"同形。判据只认退出码，
// 于是这类门永远算通过。四条用例按正/反两面成对写（收窄判定面时必须补反向断言，
// 否则"什么都不算"与"什么都不算错"都能让用例空转报绿）。
describe("绿而零输出的门 silentGreenGate（未证的一格）", () => {
  it("绿 + 空输出 ⇒ 判为静默（正例）", () => {
    expect(silentGreenGate(0, "")).toBe(true);
  });

  it("绿 + 只有换行/空白 ⇒ 仍判为静默（一个字没吐不靠 length 判定）", () => {
    expect(silentGreenGate(0, "\n   \t \n")).toBe(true);
  });

  it("绿 + 有输出 ⇒ 不判为静默（不误伤正常汇报的门）", () => {
    expect(silentGreenGate(0, "plugins-check: 12 ✅ / 0 ❌\n")).toBe(false);
  });

  it("红 + 空输出 ⇒ 不判为静默（红门已经判红，不再重复计未证）", () => {
    expect(silentGreenGate(1, "")).toBe(false);
    expect(silentGreenGate(2, "  \n")).toBe(false);
  });
});

// 组合面：上报数 + 静默一格。单独测两支函数留不住这条——调用方要的只是这一个数，
// 把它拆成两处相加，就会出现「汇总说有、账本说没有」的两条记账面。
describe("未证总数 gateUnverified（上报 + 静默两格合一）", () => {
  it("只有自报未证 ⇒ 原样带上（静默格不重复计：有输出就不算静默）", () => {
    expect(gateUnverified(0, "UNVERIFIED=3\nplugins-check: 12 ✅ / 0 ❌ / 3 未证\n")).toBe(3);
  });

  it("绿而零输出 ⇒ 计 1（自报数为 0，只有静默格贡献）", () => {
    expect(gateUnverified(0, "")).toBe(1);
  });

  it("红而零输出 ⇒ 计 0（红门由退出码判红，不混进未证）", () => {
    expect(gateUnverified(1, "")).toBe(0);
  });

  it("多行未证标记照常累加，且不因“有输出”多扣一分", () => {
    expect(gateUnverified(0, "UNVERIFIED=2\nUNVERIFIED=5\n")).toBe(7);
  });
});

// 第 40 项：绿门过去只回退出码，"这道门跑了多少东西"要单独复跑才看得见。
// 这里钉的是「取哪一行」——取错一行等于给人一句没用的话，比不取更坏。
describe("门禁结论行 verdictLine", () => {
  const VITEST_OUT = [
    " RUN  v5.0.0 /repo",
    "",
    " ✓ tests/a.test.ts (3 tests) 5ms",
    "",
    " Test Files  3 passed (3)",
    "      Tests  58 passed (58)",
    "   Start at  03:20:54",
    "   Duration  952ms",
    "",
  ].join("\n");

  it("vitest 形态取计数那一行，而不是收尾的 Duration", () => {
    expect(verdictLine(VITEST_OUT)).toBe("Tests  58 passed (58)");
  });

  it("check 门形态取它自己的 verdict", () => {
    expect(verdictLine("== plugins-check ==\n跑完一堆\nplugins-check: 12 ✅ / 0 ❌ / 3 未证\n")).toBe("plugins-check: 12 ✅ / 0 ❌ / 3 未证");
  });

  // 判卷不许依赖调用者 TERM（同 lib/vitest-summary.ts 立的那条）：颜色码就嵌在结论行里，
  // 不剥色时取回来的串带着 \x1b ⇒ 断言必红（把码放在另一行是照不出这一点的）。
  it("带 ANSI 颜色的输出仍取到干净的结论行（剥色吃共用件）", () => {
    expect(verdictLine("  ✓ tests/a.test.ts\n\x1b[32mplugins-check: 12 ✅\x1b[39m / 0 ❌\n")).toBe("plugins-check: 12 ✅ / 0 ❌");
  });

  it("没有结论标记 ⇒ 退回最后一行非空输出（说不清结论也要看得见，不许当没跑）", () => {
    expect(verdictLine("第一行\n最后一行没有记号\n")).toBe("最后一行没有记号");
  });

  it("超长行截到帽内并带省略号", () => {
    const long = "gate-check: " + "x".repeat(400) + " ✅";
    const v = verdictLine(long);
    expect(v.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS);
    expect(v.endsWith("…")).toBe(true);
  });

  it("一个字没吐 ⇒ 空串（那一格由 silentGreenGate 负责，不重复出声）", () => {
    expect(verdictLine("")).toBe("");
    expect(verdictLine("\n   \n")).toBe("");
  });
});

describe("认证面声明 certifiedFace（整表绿的是哪一棵树，必须自己说）", () => {
  // 为什么要有这一格（2026-09-24 第 44 页 §十三）：主树同一时刻有 313 项相对 HEAD 在飞，
  // 其中 11 道门脚本被并发会话**删在盘上**（门读盘 ⇒ 对它们零信号）。整表打印逐道退出码却不说
  // 认证的是工作树，于是「pnpm gates 全 0」被读成「HEAD 全 0」——今天为此花掉一整天做归因。
  it("判卷四面（src/scripts/tests/fixtures）计入在飞，outputs/docs 不计", () => {
    const r = certifiedFace(" M src/a.ts\n M scripts/g.ts\n?? tests/x.test.ts\n D fixtures/mock/m.jsonl\n M outputs/p.md\n M docs/d.md\n");
    expect(r.total).toBe(6);
    expect(r.judged).toBe(4);
    expect(r.judgedDeleted).toBe(1);
  });

  it("有在飞判卷面 ⇒ 那句话必须说「不是 HEAD」并给出 HEAD 认证的出路", () => {
    const r = certifiedFace(" M src/a.ts\n");
    expect(r.line).toContain("工作树");
    expect(r.line).toContain("不等于 HEAD");
    expect(r.line).toContain("--direct");
  });

  it("判卷四面干净 ⇒ 明说本表即 HEAD 认证（不许被读成「没测」）", () => {
    const r = certifiedFace(" M outputs/p.md\n?? notes.txt\n");
    expect(r.judged).toBe(0);
    expect(r.line).toContain("即 HEAD 认证");
  });

  it("带引号的非 ASCII 路径与 rename 行都要解析出首段（漏算会让那句话撒谎）", () => {
    const quoted = ' M "outputs/head-audit-2026-09-24/01-\\344\\275\\223\\346\\243\\200.md"\n D "src/main/\\344\\270\\255\\346\\226\\207.ts"\n';
    expect(certifiedFace(quoted).judged).toBe(1);
    expect(certifiedFace(quoted).judgedDeleted).toBe(1);
    expect(certifiedFace("R  src/old.ts -> src/new.ts\n").judged).toBe(1);
  });
});
