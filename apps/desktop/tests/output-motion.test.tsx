// 输出动效判卷（2026-10-28 第 757 页建 · 2026-11-08 第 1043 页改钉）
//
// 一手依据：Codex 桌面端（ChatGPT.app 26.1023）的产物 CSS 里
// `@keyframes _reveal-response-word` = 0% 透明 + 强调色 → 20% 0.6 → 65% 不透明 → 落回正文色，
// 也就是「**刚到的词自己淡入一次**」；Claude（3.6556.2）则是 shimmer 扫光（另一条路）。
// 本仓初版（第 757 页）取 Codex 那条：字在到，比「一段字啪地出现」更能让阅读面有生命感。
//
// 第 1043 页业主缺陷「大模型输出信息总是一闪一闪的需要修复」⇒ 判卷①③ 归因改钉：
// 流式按累计全文重解析，块结构一变「正在写的那一块」就易主，已输出的词在 md-word span
// 与纯文本之间反复重挂 ⇒ 入场动画被反复重播；「透明 + 品牌橙」因此读成整段明灭色闪。
// ⇒ 到达动效只留中性墨色渐落（opacity 恒 1、不携品牌橙），重挂不再可见。业主缺陷反馈
// 优先于「照抄 Codex 关键帧」的一手依据，故 ① 不再钉那组数，改钉「不闪」的形态。
//
// 判卷钉四件事：
//   ① 到达动效恒不透明、不带品牌橙（不闪）；
//   ② **只在正在写的那一块**开逐词到达，历史正文不多包节点（DOM 与改动前同形）；
//   ③ 词的 key 用词序 ⇒ 词「长出来」时节点不重挂 ⇒ 动画不重播（只播一次）；
//   ④ 回归钉：旧的「透明 + 品牌橙」关键帧形态不许回来。
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
  it("① 到达动效不闪：opacity 恒 1、不带品牌橙（第 1043 页业主缺陷改钉）", () => {
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
    // 逐词仍在「到」（浅墨 → 正文色），但每一拍都满不透明：重挂也不会明灭。
    expect(body).toContain("0% { opacity: 1; color: hsl(var(--text-000) / 62%); }");
    expect(body).toContain("100% { opacity: 1; color: inherit; }");
    for (const m of body.matchAll(/opacity:\s*([^;}]+)/g)) expect(m[1]!.trim()).toBe("1");
    expect(body).not.toContain("--accent-brand");
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

  it("④ 回归钉：旧的「透明 + 品牌橙」入场形态不许回来（输出一闪一闪的病灶）", () => {
    expect(css).not.toContain("0% { opacity: 0; color: hsl(var(--accent-brand)); }");
    expect(css).not.toContain("20% { opacity: 0.6;");
    expect(css).not.toContain("65% { opacity: 1; }");
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
