// 流本体的 memo 边界（2026-10-22 性能面）：长会话里这棵树能到四万七千个 DOM 节点，
// 而它是 App 的直接子级 ⇒ App 每有一次**与流无关**的状态变化（每秒的计时器、输入一个字、
// 侧栏拖宽）都会让整棵树重新 diff 一遍。
//
// 这条判卷守三件事：
//   ① `Stream` 的导出**确实**是 memo 化的（运行时断言导出值的 $$typeof，不是读源码文本）；
//   ② App 传给它的 props **全是稳定的**（memo 只有在 props 恒等时才跳过重渲染）；
//   ③ memo 化不许吃掉两个既有修法：切会话仍要重挂（`key`），流里自己的计时器仍在子组件里。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Stream } from "../src/renderer/components/Stream";
import { readAppSurface } from "./helpers/app-surface";

const appSrc = readAppSurface();
const streamSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Stream.tsx", import.meta.url)), "utf8");

describe("流本体的 memo 边界", () => {
  it("① Stream 的导出是 memo 化的（运行时看导出值，不看源码文本）", () => {
    const exotic = Stream as unknown as { $$typeof?: symbol };
    expect(exotic.$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("② App 传给 Stream 的 props 全是稳定的（memo 只在 props 恒等时才跳过）", () => {
    // rows / actions 必须是 useMemo 出来的稳定引用；其余是 state 或派生值（恒等或原始值）。
    expect(appSrc).toMatch(/const streamRows = useMemo\(\(\) => projectStream\(/);
    expect(appSrc).toMatch(/const streamActions = useMemo<StreamActions>\(/);
    expect(appSrc).toContain("rows={streamRows}");
    expect(appSrc).toContain("actions={streamActions}");
    expect(appSrc).toContain("view={viewMode}");
    expect(appSrc).toContain("streaming={runningActive}");
    expect(appSrc).toContain("foldedRounds={foldedRounds}");
    expect(appSrc).toContain("flashRound={flashRound}");
    // 每次渲染新建的对象/数组会让 memo 恒不命中 ⇒ 这两处不许写成字面量。
    expect(appSrc).not.toMatch(/rows=\{\[/);
    expect(appSrc).not.toMatch(/actions=\{\{/);
  });

  it("③ 切会话仍重挂（memo 化不许把这条既有修法吃掉）", () => {
    expect(appSrc).toMatch(/<Stream[\s\S]{0,400}?key=\{activeId \?\? "home"\}/);
  });

  it("④ 流里自己跳的计时器留在子组件里（memo 化不许把它冻住）", () => {
    // ThinkingLive 自带 setInterval：它自己管自己，不靠父级重渲染推进。
    expect(streamSrc).toMatch(/export function ThinkingLive\(/);
    const thinking = streamSrc.slice(streamSrc.indexOf("export function ThinkingLive("));
    expect(thinking).toMatch(/setInterval\(/);
    // 顶层 Stream 自己不该有定时器（若有，它会被 memo 冻住 ⇒ 计时停在原地）。
    const head = streamSrc.slice(streamSrc.indexOf("export const Stream = memo("));
    const beforeThinking = head.includes("export function ThinkingLive(")
      ? head.slice(0, head.indexOf("export function ThinkingLive("))
      : head;
    expect(beforeThinking).not.toMatch(/setInterval\(/);
  });
});
