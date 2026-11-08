// 输出动效判卷（2026-10-28 第 757 页 · 对标 Codex 的 word arrival）
//
// 一手依据：Codex 桌面端（ChatGPT.app 26.1023）的产物 CSS 里
// `@keyframes _reveal-response-word` = 0% 透明 + 强调色 → 20% 0.6 → 65% 不透明 → 落回正文色，
// 也就是「**刚到的词自己淡入一次**」；Claude（3.6556.2）则是 shimmer 扫光（另一条路）。
// 本仓取 Codex 那条：字在到，比「一段字啪地出现」更能让阅读面有生命感。
//
// 判卷钉三件事：
//   ① 关键帧取值照抄 Codex（不是自创的一组数）；
//   ② **只在正在写的那一块**开逐词到达，历史正文不多包节点（DOM 与改动前同形）；
//   ③ 词的 key 用词序 ⇒ 词「长出来」时节点不重挂 ⇒ 动画不重播（只播一次）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/renderer/markdown";
import { Stream } from "../src/renderer/components/Stream";
import { projectStream } from "../src/renderer/derived/stream";
import { readAppSurface } from "./helpers/app-surface";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("逐词到达（对标 Codex 的 _reveal-response-word）", () => {
  it("① 关键帧取值照抄 Codex：0% 透明+强调色 → 20% 0.6 → 65% 不透明 → 落回正文色", () => {
    expect(css).toContain("@keyframes md-word-arrive");
    const at = css.indexOf("@keyframes md-word-arrive");
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = css.slice(open, end);
    expect(body).toContain("0% { opacity: 0; color: hsl(var(--accent-brand)); }");
    expect(body).toContain("20% { opacity: 0.6;");
    expect(body).toContain("65% { opacity: 1; }");
    expect(body).toContain("100% { opacity: 1; color: inherit; }");
    // 动画挂在词上（每个词自己一次），不是挂在整块上
    expect(css).toMatch(/\.md-word\s*\{[^}]*animation:\s*md-word-arrive/s);
  });

  it("② 正在写的那一块才逐词到达；历史正文不多包节点", () => {
    const streaming = renderToStaticMarkup(<Markdown text="把 runOverrides 的两个开关接进运行面" caret />);
    expect(streaming).toContain('class="md-word"');
    // 不在写 ⇒ 一个节点都不多包（历史转录的 DOM 与改动前同形）
    const history = renderToStaticMarkup(<Markdown text="把 runOverrides 的两个开关接进运行面" />);
    expect(history).not.toContain('class="md-word"');
    expect(history).toContain("把 runOverrides 的两个开关接进运行面");
  });

  it("②b 逐词到达时，光标仍在（那是业主定的元素，不许借机删掉）", () => {
    const streaming = renderToStaticMarkup(<Markdown text="到达中" caret />);
    expect(streaming).toContain('class="cursor"');
  });

  it("③ 词的 key 用词序：词「长出来」时节点不重挂 ⇒ 动画只播一次", () => {
    const surface = readAppSurface();
    // key 必须是**词序**（w0/w1/…），不能用词本身：词本身会随流式增长而变 ⇒ 每来一个字符就重挂 ⇒ 动画反复重播。
    expect(surface).toContain('key={`w${String(key++)}`}');
  });
});

describe("等待 Logo 的展示生命周期", () => {
  it.each(["error", "done", "failed", "cancelled"])("%s 之后的未结增量不能在下一轮起跑时复活动效", (kind) => {
    const terminal = kind === "error" ? { type: "error" as const, message: "失败" } : { type: "agent_status" as const, status: kind };
    const rows = projectStream([
      { type: "user_message", content: "检查" },
      { type: "assistant_delta", callId: "interrupted", text: "部分回答" },
      terminal as Parameters<typeof projectStream>[0][number],
    ], true);
    expect(rows.find((row) => row.kind === "assistant")).toMatchObject({ live: false, text: "部分回答" });
  });

  it("首个事件前渲染 Logo，但不给临时占位伪造事件锚点、文本光标或操作条", () => {
    const html = renderToStaticMarkup(<Stream rows={[]} streaming waiting />);
    expect(html).toContain('class="cairn-loader"');
    expect(html).toContain('aria-label="等待模型输出"');
    expect(html).not.toContain("data-event-id");
    expect(html).not.toContain('class="cursor"');
    expect(html).not.toContain('class="row-actions"');
  });

  it("真正的 live 行出现后不再重复绘制等待 Logo", () => {
    const html = renderToStaticMarkup(<Stream rows={projectStream([{ type: "user_message", content: "检查项目" }, { type: "assistant_delta", callId: "c1", text: "正在检查" }], true)} streaming waiting />);
    expect(html).not.toContain('aria-label="等待模型输出"');
    expect(html.match(/class="cairn-loader"/gu)).toHaveLength(1);
    expect(html).toContain('class="cursor"');
  });

  it("结束或切换到空闲会话后，陈旧 waiting 也不能留下动效", () => {
    const html = renderToStaticMarkup(<Stream rows={[]} streaming={false} waiting />);
    expect(html).not.toContain('class="cairn-loader"');
    expect(html).toContain('data-running="false"');
  });
});
