/** 每请求固定面这把尺的判卷面（第 90 页立，第 185 页改口径）。
 *  重点是**不许把"没数据"读成 0**，也不许把"物理不可能"夹成好看：占比 null、请求数 0 的流不进表、
 *  factor 非正不硬算；而 share>1（估计固定 > 实测输入）必须原样报出来并反解出系数的下界。 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  fixedFaceOfMode, fixedFacesOfModes, fixedInputTokens, fixedShare, median,
  minAdmissibleFactor, promptCostRows, promptShareOfFixedFace, summarizePromptCost,
} from "../scripts/lib/prompt-cost";

describe("fixedInputTokens / fixedShare", () => {
  it("每请求固定输入 = ceil(字符/factor) × 请求数", () => {
    expect(fixedInputTokens(4100, 3, 4)).toBe(1025 * 3);
  });

  it("请求数 0 或 factor 非正 ⇒ 0，不返回 NaN（NaN 会顺着合计把整表带坏）", () => {
    expect(fixedInputTokens(4000, 0, 4)).toBe(0);
    expect(fixedInputTokens(4000, 5, 0)).toBe(0);
    expect(Number.isNaN(fixedInputTokens(4000, 5, 0))).toBe(false);
  });

  it("实测输入为 0 ⇒ 占比是 null 而不是 0%（缺报≠免费）", () => {
    expect(fixedShare(100, 0)).toBeNull();
    expect(fixedShare(100, 400)).toBe(0.25);
  });

  it("占比不夹住：>1 原样报——「估计固定 > 实测输入」物理不可能，那正是系数用错的声音", () => {
    // 旧写法是 `Math.min(1, …)`，理由也写在旧用例里（"宁可夹住也不报 130%"）。
    // 但固定面进分子之后，本仓 19 条可摊流有 18 条估超实测输入（中位 148%、最大 197%）——
    // 夹住之后那一列是一片 100%，规则 242 说的"常数的签名"，把"系数把成本放大一倍"这件事完全藏起来。
    expect(fixedShare(900, 100)).toBe(9);
    expect(fixedShare(100, 400)).toBe(0.25); // 正常那一侧不许跟着一起坏
  });
});

describe("promptCostRows：只有真有请求的流进表", () => {
  const rows = promptCostRows(
    [
      { file: "a/I1.events.jsonl", requests: 4, measuredInputTokens: 8000 },
      { file: "b/I2.events.jsonl", requests: 0, measuredInputTokens: 0 },
      { file: "c/I3.events.jsonl", requests: 2, measuredInputTokens: 0 },
    ],
    { promptChars: 4000, factor: 4 },
  );

  it("问答流（0 请求）被排除，且理由随行走", () => {
    expect(rows.map((r) => r.file)).toEqual(["a/I1.events.jsonl", "c/I3.events.jsonl"]);
  });

  it("有请求但实测输入缺报 ⇒ share=null + note 说未记", () => {
    const c = rows.find((r) => r.file === "c/I3.events.jsonl");
    expect(c?.share).toBeNull();
    expect(c?.note).toContain("未记");
  });

  it("合计里 `inputTotal` 只加有数的一条，`medianShare` 忽略 null", () => {
    const s = summarizePromptCost(rows);
    expect(s.streams).toBe(2);
    expect(s.fixedTotal).toBe(4000 + 2000); // 每请求 4000/4=1000 token：a 4 次、c 2 次
    expect(s.inputTotal).toBe(8000);
    expect(s.medianShare).toBe(0.5);
    expect(s.maxShare).toBe(0.5);
  });

  it("空表 ⇒ 三个统计都是 null，不是 0（0 会被读成「这条面量到的是零开销」）", () => {
    const s = summarizePromptCost([]);
    expect(s.medianShare).toBeNull();
    expect(s.maxShare).toBeNull();
    expect(s.fixedTotal).toBe(0);
    expect(s.overshoot).toBe(0); // 计数缺席也要是 0（"没数"由 streams=0 说，不靠 overshoot 缺席）
    expect(median([])).toBeNull();
  });
});

describe("每请求固定**面**：分子必须等于真的上 wire 的那一份（第 185 页，待办 #22）", () => {
  it("面 = 系统提示 + 序列化工具规格，两者都进分子", () => {
    const specs = [{ function: { name: "a", description: "d", parameters: { type: "object" } } }];
    const f = fixedFaceOfMode({ mode: "default", promptChars: 670, specs });
    expect(f.toolSpecChars).toBe(JSON.stringify(specs).length);
    expect(f.totalChars).toBe(670 + JSON.stringify(specs).length);
    expect(f.tools).toBe(1);
    expect(f.totalChars).toBeGreaterThan(f.promptChars); // 只数提示的那把尺，分子恒偏小
    expect(promptShareOfFixedFace(f)).toBeCloseTo(670 / (670 + JSON.stringify(specs).length), 6);
  });

  it("0 把工具 ⇒ 面退回提示（序列化出来是 `[]` 两个字符，不是凭空有成本）", () => {
    const f = fixedFaceOfMode({ mode: "none", promptChars: 500, specs: [] });
    expect(f.toolSpecChars).toBe(2);
    expect(f.totalChars).toBe(502);
  });

  it("逐档分开数：8 把与 20 把这两档不许并成一个数", () => {
    const faces = fixedFacesOfModes([
      { mode: "read-only", promptChars: 554, specs: [{ n: 1 }, { n: 2 }] },
      { mode: "default", promptChars: 670, specs: [{ n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }] },
    ]);
    expect(faces.map((f) => f.mode)).toEqual(["read-only", "default"]);
    expect(faces[0]!.totalChars).toBeLessThan(faces[1]!.totalChars);
  });
});

describe("系数自检：让数据自己说这把尺的系数至少要是几", () => {
  it("取最紧那条流反解，不是第一条也不是平均", () => {
    const rows = [
      { requests: 4, measuredInputTokens: 8000 }, // 4000×4/8000 = 2
      { requests: 2, measuredInputTokens: 1000 }, // 4000×2/1000 = 8 ← 最紧
    ];
    expect(minAdmissibleFactor(4000, rows)).toBe(8);
    expect(minAdmissibleFactor(4000, [...rows].reverse())).toBe(8); // 顺序不该改变结论
  });

  it("没有可用流（0 请求 / 实测输入缺报 / 面为 0）⇒ null，而不是 0 或 Infinity", () => {
    expect(minAdmissibleFactor(4000, [{ requests: 0, measuredInputTokens: 100 }])).toBeNull();
    expect(minAdmissibleFactor(4000, [{ requests: 3, measuredInputTokens: 0 }])).toBeNull();
    expect(minAdmissibleFactor(0, [{ requests: 3, measuredInputTokens: 100 }])).toBeNull();
  });

  it("按这条下界摊 ⇒ 不该再有任何一行 >1（自检与判据互为反证）", () => {
    const face = 10801;
    const perFile = [
      { file: "a/I1.events.jsonl", requests: 27, measuredInputTokens: 158920 },
      { file: "b/I2.events.jsonl", requests: 2, measuredInputTokens: 5495 },
      { file: "c/I3.events.jsonl", requests: 11, measuredInputTokens: 49463 },
    ];
    const lo = minAdmissibleFactor(face, perFile);
    expect(lo).not.toBeNull();
    const at = summarizePromptCost(promptCostRows(perFile, { promptChars: face, factor: lo! }));
    expect(at.maxShare).not.toBeNull();
    expect(at.maxShare! <= 1.02).toBe(true);
    // `fixedInputTokens` 向上取整 ⇒ 在最紧那一行，按"下界"摊仍可能刚好越过 1 一丝
    // （≤ 1 token/请求 × 请求数）。所以这条报的是**至少**，不是精确阈值：真实可用系数只会更大。
    expect(at.overshoot).toBeLessThanOrEqual(1);
    // 反控：系数小于下界 ⇒ 必然又出现 overshoot（否则上面那条"至多 1"是谁都能给的）
    const under = summarizePromptCost(promptCostRows(perFile, { promptChars: face, factor: lo! / 2 }));
    expect(under.overshoot).toBeGreaterThan(0);
    expect(under.maxShare! > 1).toBe(true);
  });

  it("超限行带 note 说破原因，缺报行仍说「未记」（两种坏读数分开，不混成一格）", () => {
    const rows = promptCostRows(
      [
        { file: "over/I1.events.jsonl", requests: 2, measuredInputTokens: 500 },
        { file: "null/I2.events.jsonl", requests: 2, measuredInputTokens: 0 },
        { file: "ok/I3.events.jsonl", requests: 1, measuredInputTokens: 100000 },
      ],
      { promptChars: 4000, factor: 2 },
    );
    const over = rows.find((r) => r.file === "over/I1.events.jsonl");
    expect(over?.share).toBe(8); // 4000/2 = 2000 token/请求 × 2 = 4000，除以实测 500 ⇒ 800%
    expect(over?.note).toMatch(/系数不成立/u);
    expect(rows.find((r) => r.file === "ok/I3.events.jsonl")?.note).toBe("");
    expect(rows.find((r) => r.file === "null/I2.events.jsonl")?.note).toMatch(/未记/u);
    expect(summarizePromptCost(rows).overshoot).toBe(1); // 三条里只有超界那条计数
  });
});

describe("复跑面接线：这条尺会当场报出自己系数不成立", () => {
  // 真跑登记项 `replay:prompt-fixed-cost`（读盘上的既有语料，不花钱）。
  // 为什么必须真跑而不是钉源码文字：钉文字的话，"算出来不打印"那种接线断法照样绿（规则 230/236）。
  it("输出里有逐档面、少看百分之几、系数自检三条", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay/prompt-fixed-cost.ts"],
      { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
    );
    expect(out).toMatch(/每请求固定面（逐档/u);
    expect(out, "标签说「面」，分子就必须把规格算进去").toContain("＋ 规格");
    expect(out).toMatch(/少看 \d+\.\d%/u); // 旧口径少了多少，要由这条尺自己说出来
    expect(out).toMatch(/估出「固定 > 该流实测输入」/u);
    expect(out).toMatch(/真实字符\/token 至少/u);
  });

  it("自证一致性：逐流行里的「固定≈」必须等于「面÷系数 × 请求数」——分子被换掉就破", () => {
    // 为什么钉这条而不是钉某句措辞：这条尺最容易犯的错是"算出全面却仍按提示摊"
    // （`promptCostRows` 的实参打回 `promptChars` 时，所有文字行照旧印得出来的样子最骗人）。
    // 让读数自己跟自己对账，比再钉一串字面强（规则 236/245 同族）。
    const root = fileURLToPath(new URL("../", import.meta.url));
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/replay/prompt-fixed-cost.ts"],
      { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
    );
    const factor = Number(out.match(/系数 ([\d.]+)（calibrateFactor/)?.[1] ?? "0");
    const face = Number(out.match(/逐流摊按 \*\*\w[\w-]*\*\* 档的面：(\d+) 字符/)?.[1] ?? "0");
    expect(factor, "没读到系数 ⇒ 这条判卷会退化成恒真，先让它红").toBeGreaterThan(0);
    expect(face, "没读到摊所用的面 ⇒ 同上").toBeGreaterThan(0);
    const perReq = Math.ceil(face / factor);
    const rows = [...out.matchAll(/请求=\s*(\d+)\s*固定≈\s*(\d+)/gu)].map((m) => ({
      requests: Number(m[1]),
      fixed: Number(m[2]),
    }));
    expect(rows.length, "一条逐流都没读到 ⇒ 判卷会在空表上恒真").toBeGreaterThan(0);
    for (const r of rows) expect(r.fixed).toBe(perReq * r.requests);
  });
});
