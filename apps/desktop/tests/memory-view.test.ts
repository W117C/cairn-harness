// 记忆页展示纯函数判卷（2026-10-16 记忆页重做 · 业主 F/E）：
//   relativeTime  ISO → 相对时间（列表与抽屉元信息；悬停完整时间走 fullTime）
//   fullTime      悬停 title 的完整时间（本地时区，YYYY-MM-DD HH:mm）
//   indexLines    MEMORY.md 切行（丢空行、剥「- 」；**加粗**/`代码` 留给 renderInline）
// 固定 NOW 断言（不读真钟）：五档边界 + 未来戳 + 解析失败三条路都钉住。
import { describe, expect, it } from "vitest";
import { bodyLines, fullTime, indexLines, memorySemanticGroup, relativeTime } from "../src/renderer/memory-view";
import { relativeTime as relativeTimeMs } from "../src/renderer/relative-time";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");

describe("relativeTime（F：ISO 时间戳 → 相对时间）", () => {
  it("五档边界：刚刚 / 分钟前 / 小时前 / 天前 / 超 30 天回日期", () => {
    expect(relativeTime("2026-10-16T11:59:30.000Z", NOW)).toBe("刚刚");
    expect(relativeTime("2026-10-16T11:30:00.000Z", NOW)).toBe("30 分钟前");
    expect(relativeTime("2026-10-16T05:00:00.000Z", NOW)).toBe("7 小时前");
    expect(relativeTime("2026-10-13T12:00:00.000Z", NOW)).toBe("3 天前");
    expect(relativeTime("2026-09-01T12:00:00.000Z", NOW)).toBe("2026-09-01");
  });

  it("未来戳（时钟偏差）按「刚刚」——不摆负分钟；解析不了原样返回，不装懂", () => {
    expect(relativeTime("2026-10-16T12:00:30.000Z", NOW)).toBe("刚刚");
    expect(relativeTime("not-a-date", NOW)).toBe("not-a-date");
  });
});

describe("fullTime（悬停完整时间）", () => {
  it("YYYY-MM-DD HH:mm（本地时区；日期位与 ISO 同日锚，时间两位）", () => {
    expect(fullTime("2026-10-13T05:10:00.000Z")).toMatch(/^2026-10-13 \d{2}:\d{2}$/);
  });

  it("解析不了原样返回", () => {
    expect(fullTime("bad")).toBe("bad");
  });
});

describe("indexLines（E：MEMORY.md 切行）", () => {
  it("丢空行、剥行首「- 」；行内标记原样保留（交 renderInline 渲染）", () => {
    expect(indexLines("- a · **加粗**\n\n- b · `code`\n")).toEqual(["a · **加粗**", "b · `code`"]);
  });

  it("无列表符的行原样（不误剥正文内容）", () => {
    expect(indexLines("标题行\n- x")).toEqual(["标题行", "x"]);
  });
});

describe("memorySemanticGroup（2026-11-06 设计体检）", () => {
  it("主题名/类型都参与语义分组；认不出返回「记忆」，不上机器值", () => {
    const t = { topic: "x", type: "project", body: "" };
    expect(memorySemanticGroup({ ...t, type: "decision" })).toBe("决策");
    expect(memorySemanticGroup({ ...t, topic: "架构约束" })).toBe("架构");
    expect(memorySemanticGroup({ ...t, type: "preference" })).toBe("偏好");
    expect(memorySemanticGroup(t)).toBe("记忆");
  });
});

// 2026-10-16 补通道：主题正文进快照后，抽屉「主题正文」区逐行渲染——
// 与 indexLines 的差别是**不剥列表符**（正文是原文，不是索引摘要）。
describe("bodyLines（主题正文切行）", () => {
  it("丢空行、行尾空白剥掉；「- 」等 Markdown 记号原样保留（正文不是索引）", () => {
    expect(bodyLines("**加粗**首行\n\n- 列表行  \n正文末行")).toEqual(["**加粗**首行", "- 列表行", "正文末行"]);
  });

  it("空正文 ⇒ 空数组（渲染侧给「暂无正文」回落，不摆空壳）", () => {
    expect(bodyLines("")).toEqual([]);
    expect(bodyLines("\n\n")).toEqual([]);
  });
});

// 2026-11-18 审计：相对时间此前是**两份**分档实现（各自一段 if 阶梯），漂移已经发生
// （会话面 7 天改显绝对日期、记忆页 30 天）。现在分档只有一处（relative-time.ts），
// 两面的差异收成一个显式参数 `absoluteAfterDays`——是**决定**，不是第二份实现。
// 判据钉两件事：①7 天内两面必须逐字同词；②各自的档外都改显绝对日期（阀值差异不许悄悄没了）。
describe("相对时间：分档单源（2026-11-18 审计）", () => {
  const NOW = Date.parse("2026-11-18T12:00:00.000Z");
  const isoDaysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();

  it("同一段区间两面逐字同词（此前 8–29 天会分叉：一边 N 天前、一边绝对日期）", () => {
    for (const days of [1, 3, 6]) {
      const mem = relativeTime(isoDaysAgo(days), NOW);
      expect(mem).toBe(`${String(days)} 天前`);
      expect(mem).toBe(relativeTimeMs(NOW, NOW - days * 86_400_000));
    }
  });

  it("档外各自改显绝对日期（记忆页 30 天／会话面 7 天，差异只剩参数）", () => {
    expect(relativeTime(isoDaysAgo(31), NOW)).toBe("2026-10-18");
    expect(relativeTimeMs(NOW, NOW - 8 * 86_400_000)).toBe("2026-11-10");
    // 记忆页 8–29 天仍给相对词（它的龄期语义），会话面已切绝对日期——这两句就是那条许可。
    expect(relativeTime(isoDaysAgo(20), NOW)).toBe("20 天前");
    expect(relativeTimeMs(NOW, NOW - 20 * 86_400_000)).toBe("2026-10-29");
  });
});
