// 交付轨迹默认只留最新一张卡（2026-10-18 业主截图：收起单卡后仍有二十多张单行卡铺满流尾）。
// 早期记录收进一行入口，展开状态按会话记。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("交付轨迹只留最新", () => {
  it("默认渲染最新卡；早期记录在「查看早期交付」后面，按会话展开", () => {
    expect(app).toContain("查看早期交付（${String(earlierCards)} 张卡 / ${String(olderItems.length)} 项）");
    expect(app).toContain("收起早期交付");
    expect(app).toContain("const showEarlier = activeId !== null && deliveryExpandedFor === activeId;");
    expect(app).toContain("{showEarlier && olderItems.map(renderItem)}");
    // 最新卡及其后的空轮弱行都要留（别吞掉排名末尾的「第 N–M 轮 · 无文件改动」）
    expect(app).toContain("const tailItems = lastCard >= 0 ? deliveryTrailItems.slice(lastCard) : deliveryTrailItems;");
    expect(app).toContain("{tailItems.map(renderItem)}");
    expect(css).toMatch(/\.delivery-earlier\s*{/);
  });
});
