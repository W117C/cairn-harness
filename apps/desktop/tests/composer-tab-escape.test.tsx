// 「想下一条」失败后的 Tab 逃生口 · 判卷（2026-11-08 第 1049 页）
//
// 一手依据：离屏真机 `keyboard-focus-smoke.cjs` 用 sendInputEvent 真按 30 次 Tab，
// 第 20 步起连续 11 步都停在同一个 TEXTAREA（焦点出不去）——画廊桩没接 suggestNext，
// 空输入框的 Tab 每次都被 preventDefault 吞掉，连第 1048 页新增的最近会话按钮都 Tab 不到。
// 修法不推翻业主 22.02「Tab 想下一条」裁决：有建议照旧填入；失败 / 接口缺失 / 网络失败后，
// 第二次 Tab 放行焦点。本文件钉住这条边界与既有裁决链不被改坏。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "../src/renderer/components/Composer";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");

const base = {
  mode: "default" as const,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  events: [],
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "空闲",
  phase: "idle" as const,
  elapsedSec: 0,
  steps: 0,
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
  onSuggestNext: async () => ({ ok: true as const, text: "接着抓定价页" }),
};

describe("Tab 逃生口：失败后放行，成功时裁决行为不变", () => {
  it("放行分支不 preventDefault，且只在失败后的第二次 Tab 生效", () => {
    const from = src.indexOf('props.onSuggestNext !== undefined && e.key === "Tab"');
    const block = src.slice(from, src.indexOf("void onSuggest().then(", from));
    expect(from).toBeGreaterThan(-1);
    expect(src).toContain("const suggestBlockedRef = useRef(false)");
    expect(src).toContain("if (suggestBlockedRef.current) { suggestBlockedRef.current = false; return; }");
    // 放行分支必须排在 preventDefault 之前，否则仍会被吞
    expect(block.indexOf("if (suggestBlockedRef.current)")).toBeGreaterThan(-1);
    expect(block.indexOf("if (suggestBlockedRef.current)")).toBeLessThan(block.indexOf("e.preventDefault()"));
  });

  it("失败两路（r.ok=false / catch）都置位；成功与一动笔、切会话都复位", () => {
    expect(src).toContain("setSuggestNote(r.hint); // 失败 fail-visible（分类文案来自 main）");
    expect((src.match(/suggestBlockedRef\.current = true/g) ?? []).length).toBe(2); // 失败 / catch 两路
    expect((src.match(/suggestBlockedRef\.current = false/g) ?? []).length).toBeGreaterThanOrEqual(4); // 放行 / 成功 / 动笔 / 切会话
    expect(src).toContain("suggestBlockedRef.current = false; // 第 1049 页：一动笔，Tab 逃生口复位");
  });

  it("业主 22.02 裁决链原样保留（Tab 门槛 / 只填不发 / 不覆盖已敲字 / 失败提示）", () => {
    expect(src).toContain('props.onSuggestNext !== undefined && e.key === "Tab" && !e.shiftKey');
    expect(src).toContain("void onSuggest().then(");
    expect(src).toContain('cur === "" ? r.text : cur');
    expect(src).toContain("setSuggestNote(r.hint)");
    expect(src).toContain("STR.composer.suggestionFail.replace");
  });

  it("SSR 形态不变：空闲空框仍渲染 Tab 键帽与输入框", () => {
    const html = renderToStaticMarkup(<Composer {...base} running={false} disabled={false} stopped={false} />);
    expect(html).toContain('class="suggest-kbd"');
    expect(html).toContain("textarea");
  });
});
