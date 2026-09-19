// shapeDoc 的 maxChars 必须是**帽**，不是「只有大纲超长才生效」的软目标：
// 同族的 shapeCode / shapeLog / shapeResult 缺省支都在末尾严格切帽，只有 shapeDoc
// 在「大纲装得下」那条支上无界追加 [开头] + 前 10 行 ⇒ 一个长段落就能把帽撑穿，
// 而它的两个调用方（记忆注入的 ARCHITECTURE 大纲、进摘要前的文档整形）都按「帽」在记账。
import { describe, expect, it } from "vitest";
import { shapeDoc, shapeResult } from "../src/agent/shape";

const longPara = "句".repeat(4000); // 每段 4000 字符：开头 10 行足以撑穿任何小帽

describe("shapeDoc 的帽对两条支都成立", () => {
  it("大纲很短、开头段落很长：合计仍不得越过 maxChars", () => {
    const doc = ["# 标题", "## 一", longPara, longPara, "## 二", longPara].join("\n");
    const out = shapeDoc(doc, 1200);
    expect(out).toContain("[大纲]");
    expect(out.length).toBeLessThanOrEqual(1200);
  });

  it("装得下时照旧补 [开头]（零回归：不加也不少加）", () => {
    // 100 行短行：原文远超帽 ⇒ 进大纲支；大纲（10 行标题）与开头（前 10 行）都很短 ⇒ 合计仍装得下
    const doc = Array.from({ length: 100 }, (_, i) =>
      (i % 10 === 0 ? "## 小节" + String(i) : "正文" + String(i))).join("\n");
    const out = shapeDoc(doc, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain("[大纲]");
    expect(out).toContain("[开头]");
    expect(out).toContain("## 小节0");
  });

  it("未超限逐字返回；大纲本身超限时切片并如实标截断（既有两条行为不变）", () => {
    const small = "# A\n## B\n短文";
    expect(shapeDoc(small, 2000)).toBe(small);
    const heads = Array.from({ length: 400 }, (_, i) => "## 章节" + String(i) + " " + "目".repeat(20));
    const out = shapeDoc(heads.join("\n"), 900);
    expect(out.length).toBeLessThanOrEqual(900 + 20); // 截断标记自带的那点余量与同族 shapeCode 的 +40 同口径
    expect(out).toContain("…[文档大纲截断]");
  });

  it("类型化入口 shapeResult(doc) 同一条路（供摘要序列化的那份也用同一把尺）", () => {
    const doc = ["# T", "## S1", longPara, "## S2"].join("\n");
    expect(shapeResult("doc", doc, 800).length).toBeLessThanOrEqual(800);
  });
});
