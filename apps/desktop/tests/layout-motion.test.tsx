// 布局动效判卷（2026-11-17 移植设计收敛 R5 B/C 档 · 业主「让布局动起来」）：
//   ② 过程带折叠体走 grid-rows 高度过渡（hidden 瞬切退场），减弱动效两路都关；
//   ③ 流式粒子只挂在正在写的那一行（历史/等待态没有），减弱动效两路都下架。
//   （R5 的 ① 侧栏收合不摘：本线判卷钉「收起不渲染」是刻意裁决——workbench-sidebar.test.tsx。）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Stream } from "../src/renderer/components/Stream";
import { projectStream } from "../src/renderer/derived/stream";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const procCss = readFileSync(fileURLToPath(new URL("../src/renderer/components/stream-process.css", import.meta.url)), "utf8");

const liveRows = projectStream([
  { type: "user_message", content: "检查" },
  { type: "assistant_delta", callId: "c1", text: "正在检查" },
], true);
const doneRows = projectStream([
  { type: "user_message", content: "检查" },
  { type: "assistant_delta", callId: "c1", text: "部分回答" },
  { type: "agent_status", status: "done" } as Parameters<typeof projectStream>[0][number],
], true);

describe("移植 R5 ② 过程带折叠体：grid-rows 高度过渡取代 hidden 瞬切", () => {
  it("process-fold 走 grid-template-rows 过渡 + .fold-inner 裁剪层（hidden 规则已撤）", () => {
    expect(procCss).toMatch(/\.process-fold-body\s*\{[^}]*grid-template-rows: 0fr/s);
    expect(procCss).toMatch(/\.process-fold\[data-open="true"\] \.process-fold-body\s*\{[^}]*grid-template-rows: 1fr/s);
    expect(procCss).toContain(".fold-inner");
    expect(procCss).not.toContain(".process-fold-body[hidden]");
    expect(procCss).toContain("var(--ease-out)");
  });
  it("减弱动效两路都关掉折叠过渡（根属性显式 none + 系统媒体全局归零）", () => {
    expect(css).toContain('[data-reduce-motion="true"] .process-fold-body { transition: none; }');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition-duration: 0\.01ms !important/);
  });
});

describe("移植 R5 ③ 流式粒子：只在正在写的那一行", () => {
  it("live 行有粒子；历史行与等待态没有", () => {
    expect(renderToStaticMarkup(<Stream rows={liveRows} streaming waiting />)).toContain('class="spark-motes"');
    expect(renderToStaticMarkup(<Stream rows={doneRows} streaming={false} waiting={false} />)).not.toContain('class="spark-motes"');
    expect(renderToStaticMarkup(<Stream rows={[]} streaming waiting />)).not.toContain('class="spark-motes"');
  });
  it("粒子关键帧在场；减弱动效两路都下架（根属性 display:none + 系统媒体 display:none）", () => {
    expect(css).toContain("@keyframes mote-rise");
    expect(css).toMatch(/\.spark-motes \.mote\s*\{[^}]*animation: mote-rise/s);
    expect(css).toContain('[data-reduce-motion="true"] .spark-motes { display: none; }');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.spark-motes \{ display: none; \}/);
  });
});
