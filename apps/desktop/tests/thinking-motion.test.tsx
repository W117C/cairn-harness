// 思考体展开物理判卷（2026-10-31）：参考库 `ThinkingAccordion` / `ReasoningAmbientGlow`
// 的移植面。保留 Cairn 既有裁决：逐格加载标不换三点波；Normal 档默认折叠。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThinkingLive } from "../src/renderer/components/Stream";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("思考体：DOM 开合语义", () => {
  it("折叠体在 DOM 里，用 data-open/aria-hidden 表达开合，不再用 hidden 硬切", () => {
    const closed = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先想" view="normal" running={false} />);
    expect(closed).toContain('class="think-body"');
    expect(closed).toContain('data-open="false"');
    expect(closed).toContain('aria-hidden="true"');
    expect(closed).not.toContain('hidden=""');

    const open = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先想" view="thinking" running={false} />);
    expect(open).toContain('data-open="true"');
    expect(open).toContain("think-body-inner");
  });

  it("Normal 档仍默认折叠；Thinking 档默认展开（既有产品裁决）", () => {
    const normal = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先想" view="normal" running={false} />);
    expect(normal).toContain('aria-expanded="false"');
    const thinking = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先想" view="thinking" running={false} />);
    expect(thinking).toContain('aria-expanded="true"');
  });

  it("生成中可折叠（第 1042 页改钉，zcode 同形）：折叠态 ticker 给最后一行；限高跟尾取代互斥锁", () => {
    // 旧契约（参考库 ThinkingAccordion 互斥锁）强制展开 + aria-disabled，病因是流式正文
    // 无限长高把阅读面顶跳；展开体限高 240px + 自动跟尾后根因消失 ⇒ 锁下架，运行中交还用户开合。
    const live = renderToStaticMarkup(<ThinkingLive seq={1} thinking={"先想\n再想"} running view="normal" />);
    expect(live).toContain('aria-expanded="false"');
    expect(live).not.toContain("aria-disabled");
    expect(live).toContain("think-ticker");
    const done = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先想" view="normal" running={false} />);
    expect(done).toContain('aria-expanded="false"');
    expect(done).not.toContain('aria-disabled="true"');
    // 开合写在用户点击上，不再有 lock 闸（否定断言读面，不单读一个文件）。
    expect(readAppSurface()).not.toContain("if (!lock) setExpanded(!open)");
  });
});

describe("思考体：CSS 物理", () => {
  const css = read("../src/renderer/styles.css");
  const tokens = read("../src/renderer/tokens.css");

  it("Grid 0fr→1fr 展开，内层 overflow:hidden 裁切", () => {
    expect(css).toMatch(/\.think-body\s*\{[^}]*grid-template-rows:\s*0fr/s);
    expect(css).toMatch(/\.think-body-inner\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.row\.think\.open \.think-body\s*\{[^}]*grid-template-rows:\s*1fr/s);
  });

  it("运行中陶土呼吸光，系统减弱动效与 app 内减弱都停动", () => {
    expect(css).toContain('.row.think[data-running="true"]::before');
    expect(css).toContain("think-glow-breathe");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.row\.think\[data-running="true"\]::before \{ animation: none;/);
    expect(css).toContain('[data-reduce-motion="true"] .row.think[data-running="true"]::before');
    expect(tokens).toContain("--t-think-glow:");
    expect(tokens).toContain("--t-think-expand:");
  });

  it("品牌等待标保留：逐格加载标在场，三点波不回归", () => {
    const live = renderToStaticMarkup(<ThinkingLive seq={1} />);
    expect(live).toContain("cairn-loader");
    expect(live).not.toContain("<i />");
  });
});
