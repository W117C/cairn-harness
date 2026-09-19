// token 估算按字符类别登记（能力 9 成本面：预算本身算错，省 token 就是空话）。
// chars/4 对拉丁文近似成立，对中文低估 3–4 倍——而本仓的角色定义、SKILL.md、hook 说明
// 大量是中文，纯英文测试永远测不出这个洞。见记忆「外界文本有界性收尾」。
import { describe, expect, it } from "vitest";
import { clampTailToTokenBudget, clampToTokenBudget, estimateTextTokens } from "../src/agent/text-budget";

describe("estimateTextTokens 按字符类别登记", () => {
  it("纯 ASCII 与 chars/4 同值（零回归：与 compaction 口径不漂移）", () => {
    expect(estimateTextTokens("x".repeat(400))).toBe(100);
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abc")).toBe(1); // ceil(0.75)
  });

  it("中文一字计一 token（旧口径会把它记成 1/4，等于预算被低估四倍）", () => {
    expect(estimateTextTokens("中".repeat(400))).toBe(400);
  });

  it("混合文本两类相加后向上取整", () => {
    expect(estimateTextTokens("中文abc")).toBe(3); // 2 + 0.75 → 3
  });

  it("全角标点与假名同样是宽字符", () => {
    expect(estimateTextTokens("，。！".repeat(10))).toBe(30);
    expect(estimateTextTokens("あ".repeat(20))).toBe(20);
  });

  it("增补平面汉字（代理对）按 1 token 计，不因两个 UTF-16 单元而漏计", () => {
    expect(estimateTextTokens("𠀋".repeat(10))).toBe(10);
  });
});

describe("clampToTokenBudget 的取点跟着类别走", () => {
  it("中文正文截完仍然 ≤ 预算（旧实现按 chars/4 取点，这里会溢出近四倍）", () => {
    const out = clampToTokenBudget("代".repeat(20000), 1000, "角色定义");
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(1000);
    expect(out.length).toBeLessThan(1100); // 1000 宽字符 + 提示行，而不是 4000 字符
    expect(out.endsWith("token，已截断]")).toBe(true);
  });

  it("取回提示与 marker 一起计入预算", () => {
    const suffix = "\n[完整定义见插件文件]";
    const out = clampToTokenBudget("漢".repeat(50000), 800, "角色定义", suffix);
    expect(out.endsWith(suffix)).toBe(true);
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(800);
  });

  it("预算连提示行都装不下时只吐提示行（不假装满足预算，也不吐负长度切片）", () => {
    const out = clampToTokenBudget("字".repeat(5000), 8, "角色定义");
    // 8 token 的位置比中文提示行本身还小 ⇒ 正文取 0 字符，交回来的就是这句实话。
    expect(out).toBe("\n[角色定义超 8 token，已截断]");
  });

  it("未超限的中文逐字不变（零回归）", () => {
    const text = "你是评审环：只读审查前环产出。";
    expect(clampToTokenBudget(text, 2000, "worker 角色定义")).toBe(text);
  });
});

// 留尾一支：错误日志的结论在末行（verify.ts / output-ring 早已写明这条理由），
// 但共享模块此前只有留头——给「跨轮重送」的验证摘要用留头 = 把可执行信息整段丢掉。
describe("clampTailToTokenBudget 留尾且提示行计入预算", () => {
  it("未超限时逐字不变（零回归）", () => {
    const text = "Tests 1 failed\nAssertionError: expected red";
    expect(clampTailToTokenBudget(text, 2000, "自动验证输出")).toBe(text);
  });

  it("超限时保留尾部原文，提示行在前且自己计入预算", () => {
    const text = "HEAD-".repeat(4000) + "TAIL-LINE";
    const out = clampTailToTokenBudget(text, 300, "自动验证输出");
    expect(out.endsWith("TAIL-LINE")).toBe(true);
    expect(out.startsWith("[自动验证输出超 300 token，已截断（只留尾部）]")).toBe(true);
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(300);
  });

  it("中文按字计量：预算 1000 不放成 4000 字符（chars/4 低估四倍的老口径）", () => {
    const out = clampTailToTokenBudget("代".repeat(20000), 1000, "自动验证输出");
    expect(estimateTextTokens(out)).toBeLessThanOrEqual(1000);
    expect(out.length).toBeLessThan(1100);
  });

  it("代理对不被切成半个（半个是非法 UTF-16，进 provider 就变问号）", () => {
    const out = clampTailToTokenBudget("𠀋".repeat(5000), 100, "自动验证输出");
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    expect(out).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  });

  it("预算连提示行都装不下时只吐提示行（不假装满足预算）", () => {
    expect(clampTailToTokenBudget("字".repeat(5000), 8, "自动验证输出")).toBe(
      "[自动验证输出超 8 token，已截断（只留尾部）]\n",
    );
  });
});
