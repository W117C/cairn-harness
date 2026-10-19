// 记忆页展示纯函数判卷（2026-10-16 记忆页重做 · 业主 F/E）：
//   relativeTime  ISO → 相对时间（列表与抽屉元信息；悬停完整时间走 fullTime）
//   fullTime      悬停 title 的完整时间（本地时区，YYYY-MM-DD HH:mm）
//   indexLines    MEMORY.md 切行（丢空行、剥「- 」；**加粗**/`代码` 留给 renderInline）
// 固定 NOW 断言（不读真钟）：五档边界 + 未来戳 + 解析失败三条路都钉住。
import { describe, expect, it } from "vitest";
import { bodyLines, fullTime, indexLines, relativeTime } from "../src/renderer/memory-view";

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
