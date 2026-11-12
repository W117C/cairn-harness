// 思考行流式体验（2026-11-08 第 1042 页，对标 zcode 3.17.2 的 Reasoning 面）：
// ① 折叠态 ticker 实时显示「正在想的最后一行」——旧静态摘要取开头 120 字，思考越久越陈旧；
// ② 展开体限高 240px 内部滚动 + 流式自动跟尾（用户上滚即停、回底恢复）——不再无限顶高；
// ③ 运行中不再锁死折叠（互斥锁的病因是「流式长高把阅读面顶跳」，限高后根因消失）；
// ④ 「思考中」标题走中性墨色流光（88% strong / 38% soft，同族墨无色相）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThinkingLive } from "../src/renderer/components/Stream";
import { lastThinkingLine } from "../src/renderer/derived/thinking-line";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("lastThinkingLine（ticker 取材：最后一个非空行，key=行号）", () => {
  it("取最后一个非空行；尾部空行不夺 key（同一行续写不换 key、不重滚）", () => {
    expect(lastThinkingLine("第一行\n第二行")).toEqual({ key: "1", text: "第二行" });
    expect(lastThinkingLine("第一行\n第二行\n\n  \n")).toEqual({ key: "1", text: "第二行" });
    expect(lastThinkingLine("只有一行")).toEqual({ key: "0", text: "只有一行" });
  });
  it("CRLF 归一；空/全空白 ⇒ null（不摆空 ticker）", () => {
    expect(lastThinkingLine("甲\r\n乙")).toEqual({ key: "1", text: "乙" });
    expect(lastThinkingLine("")).toBeNull();
    expect(lastThinkingLine(" \n \n")).toBeNull();
  });
});

describe("运行中折叠态：实时 ticker + 可折叠（互斥锁下架）", () => {
  it("Normal 档运行中有正文 ⇒ 折叠 + ticker 只显示最后一行；无 aria-disabled 锁", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking={"先查接口。\n再核对边界。"} running view="normal" />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("完成后可折叠");
    expect(html).toContain('class="think-preview think-ticker"');
    const ticker = html.slice(html.indexOf("think-ticker"), html.indexOf("thinking-actions") > -1 ? html.indexOf("thinking-actions") : html.indexOf("think-body"));
    expect(ticker).toContain("再核对边界。");
    expect(ticker).not.toContain("先查接口。");
  });

  it("展开态不摆 ticker（正文已经在读）；Thinking 档运行中默认展开", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking="想" running view="thinking" />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("think-ticker");
  });

  it("完成后折叠态仍是开头摘要（历史扫读面），不摆 ticker", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先查接口。" running={false} view="normal" />);
    expect(html).toContain("think-preview");
    expect(html).not.toContain("think-ticker");
  });

  it("运行中点击真的开合（不再只有 !lock 才写 expanded）", () => {
    const surface = readAppSurface();
    expect(surface).not.toContain("if (!lock) setExpanded(!open)");
  });
});

describe("思考体限高 + 自动跟尾（流式不再无限顶高）", () => {
  const processCss = read("../src/renderer/components/stream-process.css");
  it("think-text 限高 240px、内部滚动（zcode max-h-60 同档）", () => {
    const rule = processCss.match(/\.row\.think \.think-text\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("max-height: 240px");
    expect(rule).toContain("overflow-y: auto");
  });
  it("跟尾接线：复用 isNearBottom 判贴底；流式追加时写 scrollTop 跟到 scrollHeight", () => {
    const surface = readAppSurface();
    expect(surface).toContain("isNearBottom");
    expect(surface).toMatch(/scrollTop\s*=\s*\w+\.scrollHeight/);
  });
});

describe("「思考中」标题：中性墨色流光（zcode animated-gradient-text 的 neutral 档）", () => {
  const processCss = read("../src/renderer/components/stream-process.css");
  const tokens = read("../src/renderer/tokens.css");
  it("运行档标题：88% 墨 strong / 38% soft、background-clip:text、时长走令牌", () => {
    const rule = processCss.match(/\.row\.think\[data-running="true"\] \.think-label\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("hsl(var(--text-000) / 88%)");
    expect(rule).toContain("hsl(var(--text-000) / 38%)");
    expect(rule).toContain("background-clip: text");
    expect(rule).toContain("animation: live-shimmer-flow var(--t-live-shimmer)");
    expect(tokens).toContain("--t-live-shimmer:");
  });
  it("系统减弱动效：停动并还原 flat 墨色（背景清掉后不许留透明字）", () => {
    const block = processCss.slice(processCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    const rule = block.match(/\.row\.think\[data-running="true"\] \.think-label\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("animation: none");
    expect(rule).toContain("background: none");
    expect(rule).toContain("color: hsl(var(--text-000) / 88%)");
  });
  it("app 内减弱动效（data-reduce-motion）同样停动还原", () => {
    const rule = processCss.match(/\[data-reduce-motion="true"\] \.row\.think\[data-running="true"\] \.think-label\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("animation: none");
    expect(rule).toContain("color: hsl(var(--text-000) / 88%)");
  });
});

describe("展开体滚动边缘渐隐（第 1044 页，zcode ReasoningContent 同形）", () => {
  const processCss = read("../src/renderer/components/stream-process.css");
  it("单张纵向 mask + 两个 0px/16px 变量；贴顶/贴底各自独立", () => {
    expect(processCss).toContain('--think-fade-top: 0px');
    expect(processCss).toContain('--think-fade-bottom: 0px');
    expect(processCss).toMatch(/mask-image:\s*linear-gradient\(to bottom/);
    expect(processCss).toContain('.think-body-inner[data-fade-top="true"] { --think-fade-top: 16px; }');
    expect(processCss).toContain('.think-body-inner[data-fade-bottom="true"] { --think-fade-bottom: 16px; }');
    // 遮罩必须挂在**不滚动**的父盒：滚动容器上的 mask 随内容坐标走，贴底时视口只看得到中段（像素对照证伪）。
    expect(processCss).toMatch(/\.row\.think \.think-body-inner\s*\{[^}]*mask-image:/s);
    expect(processCss).not.toMatch(/\.row\.think \.think-text\s*\{[^}]*mask-image:/s);
    // mask 是静态遮罩，不新增第二块减弱动效（全仓只准一块）
    expect(processCss.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).toHaveLength(1);
  });
  it("SSR 未溢出：两侧都不淡出（首行不被吃掉）", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking="想" running view="thinking" />);
    expect(html).toContain('data-fade-top="false"');
    expect(html).toContain('data-fade-bottom="false"');
  });
  it("接线：scrollEdges 纯函数 + onScroll 同步 + 跟尾 effect 同拍落定", () => {
    const surface = readAppSurface();
    expect(surface).toContain("function scrollEdges(el: HTMLDivElement)");
    expect(surface).toContain("const next = scrollEdges(el)");
    expect(surface).toContain("data-fade-top={edges.top");
    expect(surface).toContain("followRef.current = isNearBottom(el)");
  });
});