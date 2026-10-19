// 工具行/思考行/回底钮判卷（阶段 2 · 全局 UI 重构 brief §二.4/.5/.6）：
// ① toolVerb 纯函数——「工具名 + 一句话摘要」的人话动词（brief 例：抓取 api-docs.deepseek.com/news）；
// ② styles.css 钉：步骤胶囊（底色 + 圆角 + 紧凑）、字形三色（成功灰勾 / 失败琥珀叹号 / 运行中性旋转，
//    不要大红叉）、思考完成弱化 tertiary、回底 = 右下小圆钮 + 淡入；
// ③ App 源码哨兵：回底钮换形态（图标圆钮 + aria-label），旧「回到底部」文字形态清零。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toolVerb } from "../src/renderer/components/Stream";
import { isNearBottom } from "../src/renderer/useStickyScroll";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("toolVerb（一句话摘要的动词层）", () => {
  it("已知工具给动词；未知工具 null（不编词）", () => {
    expect(toolVerb("read_file")).toBe("读取");
    expect(toolVerb("write_file")).toBe("写入");
    expect(toolVerb("run_shell")).toBe("运行");
    expect(toolVerb("web_fetch")).toBe("抓取");
    expect(toolVerb("web_search")).toBe("搜索");
    expect(toolVerb("mystery_tool")).toBeNull();
  });
});

describe("消息间距 24px（brief §二.1：消息之间间距 24px）", () => {
  const css = read("../src/renderer/styles.css");
  it("user / assistant / error 行顶距 24px（行间不叠也成节奏）", () => {
    expect(css).toMatch(/\.row\.user\s*{[^}]*margin:\s*24px 0 0/s);
    expect(css).toMatch(/\.row\.assistant\s*{[^}]*margin:\s*24px 0 0/s);
    expect(css).toMatch(/\.row\.error-row\s*{[^}]*margin:\s*24px 0 0/s);
  });
});

describe("工具行样式钉（步骤胶囊 + 三色字形）", () => {
  const css = read("../src/renderer/styles.css");
  it("胶囊：有底 + 圆角 + 悬停加深（不再是无底的裸行）", () => {
    expect(css).toMatch(/\.tool-head\s*{[^}]*background:\s*var\(--alpha-1\)/s);
    expect(css).toMatch(/\.tool-head\s*{[^}]*border-radius:\s*var\(--radius-md\)/s);
    expect(css).toMatch(/\.tool-head:hover\s*{\s*background:\s*var\(--alpha-2\)/);
  });
  it("成功灰勾 / 失败琥珀 / 运行中性（大红叉与彩对勾下架）", () => {
    expect(css).toMatch(/\.glyph\.ok\s*{\s*color:\s*hsl\(var\(--text-400\)\)/);
    expect(css).toMatch(/\.glyph\.failed\s*{\s*color:\s*hsl\(var\(--color-risk\)\)/);
    expect(css).toMatch(/\.glyph\.pending\s*{\s*color:\s*hsl\(var\(--text-400\)\)/);
    expect(css).not.toMatch(/\.glyph\.ok\s*{[^}]*diff-add-ink/s);
    expect(css).not.toMatch(/\.glyph\.failed\s*{[^}]*danger/s);
  });
  it("失败图标是感叹号三角（不是叉）", () => {
    const src = read("../src/renderer/components/Stream.tsx");
    expect(src).toMatch(/glyph failed[^>]*><AlertTriangle/s);
    expect(src).not.toMatch(/glyph failed[^>]*><X /s);
  });
  it("展开区 = 原始参数 JSON（默认折叠的按钮 aria-expanded 仍在）", () => {
    const src = read("../src/renderer/components/Stream.tsx");
    expect(src).toContain("原始参数（JSON）");
    expect(src).toMatch(/r\.args !== undefined/);
  });
});

describe("思考行弱化（brief §二.5）", () => {
  const css = read("../src/renderer/styles.css");
  it("思考完成字形 = tertiary（绿勾下架）", () => {
    expect(css).toMatch(/\.think-done\s*{\s*color:\s*hsl\(var\(--text-400\)\)/);
    expect(css).not.toMatch(/\.think-done\s*{[^}]*diff-add-ink/s);
  });
});

describe("回底钮挂载竞态（阶段 2 真机复检抓到并修复）", () => {
  // 根因：空态启动时 .stream 未挂载 ⇒ 旧 hook 以 ref.current=null 跑完 effect，依赖 [ref] 不变
  // 便永不再跑 ⇒ 滚动监听恒未接上、回底钮永不出现（真机实证：scrollTop=120 后 DOM 无 .jump-latest）。
  // 修复 = hook 改收元素本身（App 用 callback ref 放入 state）：元素出现 ⇒ effect 重跑 ⇒ 监听接上。
  it("纯函数 isNearBottom：48px 贴底阈值", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 919, clientHeight: 611 })).toBe(false);
    expect(isNearBottom({ scrollTop: 270, scrollHeight: 919, clientHeight: 611 })).toBe(true); // 间隙 38 ≤ 48
    expect(isNearBottom({ scrollTop: 308, scrollHeight: 919, clientHeight: 611 })).toBe(true); // 贴底
  });
  it("接线哨兵：hook 收元素（非 RefObject）；App 走 callback-ref state", () => {
    const hook = read("../src/renderer/useStickyScroll.ts");
    expect(hook).toContain("el: HTMLDivElement | null");
    // 代码行锚（注释里的历史说明不算——第 24 遍 suggest-ghost 同款误伤先例）
    expect(hook).not.toMatch(/=\s*ref\.current/);
    expect(hook).not.toMatch(/RefObject</);
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain("useStickyScroll(streamEl)");
    expect(app).toContain("ref={setStreamEl}");
    expect(app).not.toContain("streamRef");
  });
});

describe("回到底部 = 居中浮钮（业主 10.07 裁：正中间；v3-lite「回到最新」margin:0 auto 同口径）", () => {
  const css = read("../src/renderer/styles.css");
  const app = read("../src/renderer/App.tsx");
  it("圆形图标钮：水平居中定位 + 淡入动画", () => {
    expect(css).toMatch(/\.jump-latest\s*{[^}]*border-radius:\s*var\(--radius-pill\)/s);
    // 居中 = left:50% + translateX(-50%)（宽窗下不再贴右缘孤悬——旧 right 锚已废）。
    expect(css).toMatch(/\.jump-latest\s*{[^}]*left:\s*50%/s);
    expect(css).toMatch(/\.jump-latest\s*{[^}]*transform:\s*translateX\(-50%\)/s);
    expect(css).not.toMatch(/\.jump-latest\s*{[^}]*right:/s);
    expect(css).toMatch(/@keyframes fade-in/);
    expect(css).toMatch(/\.jump-latest\s*{[^}]*animation:\s*fade-in/s);
  });
  it("App：文字形态清零、aria-label 在位（图标钮的可读名）", () => {
    expect(app).toContain('aria-label="回到底部"');
    expect(app).not.toContain("<span>回到底部</span>");
  });
});

describe("工具行折叠态信息量（2026-10-17：去掉重复的绝对时间戳）", () => {
  const stream = read("../src/renderer/components/Stream.tsx");
  it("折叠行 = 图标 + 摘要 + 耗时；不再并列「5.9s / 15 分钟前」两份时间", () => {
    const start = stream.indexOf('<button className="tool-head"');
    expect(start).toBeGreaterThan(-1);
    const end = stream.indexOf("{open && (", start);
    expect(end).toBeGreaterThan(start);
    const head = stream.slice(start, end);
    expect(head).toContain("formatDuration");
    expect(head).not.toContain("<RowTime");
  });
});
