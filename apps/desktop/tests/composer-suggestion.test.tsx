// 第二十四遍「Tab 想下一条」判卷（业主 22.02：建议只在按 Tab 时出手；裁 A②：内容按上下文生成）。
// 旧形态（自动常驻灰字 + Tab/→ 填入）整体下架——本文件钉新形态的四组事实：
//   ① 常驻芯片不存在：任何 SSR 形态都不再有 .suggest-ghost（全仓文本哨兵同钉）；
//   ② Tab 入口结构在（SSR 测不了按键，按键链以源码哨兵钉）：空输入框 + 空闲 + 有接线才吃 Tab，
//      Shift+Tab 不劫持；拉到结果只填不发、且不覆盖用户已敲的字；
//   ③ 加载/失败两态上屏（placeholder「正在想下一条…」/ .suggest-note 提示行）；
//   ④ 键帽：接线在场 + 空闲空框 ⇒ 右侧小 Tab 键帽在场（brief 的「右侧 Tab 键帽」落点）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/renderer/components/Composer";

function repo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const base = {
  mode: "default" as const,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "空闲",
  phase: "idle" as const,
  elapsedSec: 0,
  steps: 0,
  workspaceLabel: null,
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
  onSuggestNext: async () => ({ ok: true as const, text: "接着抓定价页" }),
};

describe("Composer 建议（Tab 想下一条 · 常驻芯片下架）", () => {
  it("任何形态都不再有常驻灰字芯片（suggest-ghost 全仓清零）；空闲空框只有 Tab 键帽", () => {
    const idle = renderToStaticMarkup(<Composer {...base} running={false} disabled={false} stopped={false} />);
    expect(idle).not.toContain("suggest-ghost");
    expect(idle).toContain('class="suggest-kbd"');
    const running = renderToStaticMarkup(<Composer {...base} running disabled={false} stopped={false} />);
    expect(running).not.toContain("suggest-ghost");
    expect(running).not.toContain('class="suggest-kbd"'); // 运行中不摆（排队语义优先）
  });

  it("键帽门槛：没接线（旧消费者）不摆；门槛中（disabled）不摆", () => {
    const { onSuggestNext: _drop, ...noWire } = base;
    const plain = renderToStaticMarkup(<Composer {...noWire} running={false} disabled={false} stopped={false} />);
    expect(plain).not.toContain('class="suggest-kbd"');
    const gated = renderToStaticMarkup(<Composer {...base} running={false} disabled stopped={false} />);
    expect(gated).not.toContain('class="suggest-kbd"');
  });

  it("源码哨兵：Tab 入口的完整门槛与行为链（拉取 → 只填不发 → 不覆盖已敲的字 → 失败走提示行）", () => {
    const src = repo("../src/renderer/components/Composer.tsx");
    expect(src).not.toContain('className="suggest-ghost"'); // 旧芯片 JSX 下架（注释里的历史说明不在此钉）
    expect(src).not.toContain('"ArrowRight"'); // 旧「→ 接受」下架
    expect(src).toContain('props.onSuggestNext !== undefined && e.key === "Tab" && !e.shiftKey');
    expect(src).toContain("void onSuggest().then(");
    expect(src).toContain('cur === "" ? r.text : cur'); // 拉回时用户已敲字 ⇒ 不覆盖
    expect(src).toContain("setSuggestNote(r.hint)"); // 失败 fail-visible（分类文案来自 main）
    expect(src).toContain("STR.composer.placeholderSuggesting"); // P2 重做后加载态文案走 STR（同一句「正在想下一条…」）
    expect(src).toContain('{suggestNote !== null && (');
  });

  it("样式与速查表：.suggest-note/.suggest-kbd 在；旧 .suggest-ghost 清零；快捷键表口径已换", () => {
    const css = repo("../src/renderer/styles.css");
    expect(css).toContain(".suggest-note {");
    expect(css).toContain(".suggest-kbd {");
    expect(css).not.toContain("\n.suggest-ghost"); // 规则位清零（行首锚——注释里的历史说明不算）
    const shortcuts = repo("../src/renderer/shortcuts.ts");
    expect(shortcuts).toContain("空输入框想下一条");
    expect(shortcuts).not.toContain("灰字建议");
  });
});
