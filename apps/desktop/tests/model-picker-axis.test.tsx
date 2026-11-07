// 模型选择器的「多轴」判卷（2026-10-28 第 757 页 · 对标 Codex / Claude）
//
// 这一批把模型选择器从「一个菜单 + 全局四档」改成 Codex 那种**多轴**结构：
//   ① 每个模型带**自己声明**的思考档（Codex 的 supportedReasoningEfforts）——
//      此前无论哪个模型都摆全局四档 ⇒ 能选到该模型不支持的档（请求会被 provider 拒）。
//   ② 换模型 ⇒ 思考档**归位**（Codex 的 defaultReasoningEffort）——
//      此前芯片显示旧档、请求发新档，两边分叉。
//   ③ 芯片的值变了要**弹一下**（Claude 的 cds-pill-pop）——此前换模型静默换字。
//
// 判据钉的是**行为**（纯函数 + 真 HTML 渲染），不是快照：
// 归位函数的四支、菜单按模型出档、芯片显示生效档、动效的两条动画分开。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelMenu, ModelPicker, reconcileThinkingLevel } from "../src/renderer/components/ModelPicker";
import type { ProviderInfo } from "../../../src/main/ipc-protocol";
import { readAppSurface } from "./helpers/app-surface";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const menuCss = readFileSync(fileURLToPath(new URL("../src/renderer/components/model-menu.css", import.meta.url)), "utf8");

/** 一个只支持 ["off","medium"] 的模型（不声明支持时 levels 缺席）。 */
function modelWithThinking(id: string, values: readonly ("off" | "low" | "medium" | "high")[], fallback: "off" | "low" | "medium" | "high") {
  return {
    id,
    provider: "deepseek",
    model: id,
    tier: "standard" as const,
    ctxWindow: 128_000,
    capability: {
      modelId: id,
      provider: "deepseek",
      availability: "unverified" as const,
      thinking: { supported: true, values, default: fallback },
      attachments: { text: true, image: false },
    },
  };
}

const info: ProviderInfo = {
  kind: "openai",
  provider: "DeepSeek",
  model: "deepseek-chat",
  modelId: "deepseek-chat",
  models: [modelWithThinking("deepseek-chat", ["off", "medium"], "medium")],
  keyConfigured: true,
  providers: [{ id: "deepseek", label: "DeepSeek", custom: false }],
};

describe("思考档归位（对标 Codex 的 supportedReasoningEfforts + defaultReasoningEffort）", () => {
  it("当前档被支持 ⇒ 原样留着", () => {
    expect(reconcileThinkingLevel("medium", ["off", "low", "medium", "high"], "medium")).toBe("medium");
  });

  it("当前档不被支持 ⇒ 落到该模型的缺省档", () => {
    expect(reconcileThinkingLevel("high", ["off", "medium"], "medium")).toBe("medium");
  });

  it("没有缺省档（或缺省档也不被支持）⇒ 落到声明的第一档", () => {
    expect(reconcileThinkingLevel("high", ["off", "low"], undefined)).toBe("off");
    expect(reconcileThinkingLevel("high", ["off", "low"], "zzz")).toBe("off");
  });

  it("模型没声明思考 ⇒ 归位到关（给不支持的模型发思考参数 = 白烧 token）", () => {
    expect(reconcileThinkingLevel("high", undefined, undefined)).toBe("off");
    expect(reconcileThinkingLevel("high", [], undefined)).toBe("off");
  });
});

describe("菜单的思考段按**当前模型声明的档**出", () => {
  const render = (over: Partial<Parameters<typeof ModelMenu>[0]> = {}): string =>
    renderToStaticMarkup(
      <ModelMenu
        options={[{ registryId: "deepseek-chat", label: "deepseek-chat", provider: "deepseek", thinkingLevels: ["off", "medium"] }]}
        value="deepseek-chat"
        onPick={() => undefined}
        onThinkingChange={() => undefined}
        thinkingSupported
        thinkingLevels={["off", "medium"]}
        initialFocus="effort"
        {...over}
      />,
    );

  it("只出该模型声明的档（不多给、不少给）", () => {
    const html = render();
    expect(html).toContain('data-e="off"');
    expect(html).toContain('data-e="medium"');
    expect(html).not.toContain('data-e="low"');
    expect(html).not.toContain('data-e="high"');
  });

  it("档位可自定义：声明了多档的模型出现「自定义」入口，未声明的不出现", () => {
    const multi = render({ thinkingLevels: ["off", "low", "high"] });
    expect(multi).toContain('class="menu-item th-custom"');
    expect(multi).toContain("自定义");
    const none = render({ thinkingLevels: undefined, thinkingSupported: false });
    expect(none).not.toContain('class="menu-item th-custom"');
  });

  it("模型没声明 ⇒ 思考面空态（fail-visible，不摆假按键）", () => {
    const html = render({ thinkingLevels: undefined, thinkingSupported: false });
    expect(html).not.toContain('data-e="high"'); // 没有可摆的档位行（不摆假按键）
    expect(html).not.toContain("disabled"); // 也没有被禁用的行——是空态不是禁用
    // 不支持 ⇒ 面板挂标记：读屏/样式据此知道这是「不可调」的说明面（ADR-0009）
    expect(html).toContain('data-unsupported="true"');
    expect(html).toContain("当前模型不支持思考强度");
    const ok = render({ thinkingLevels: ["off", "medium"], thinkingSupported: true });
    expect(ok).not.toContain('data-unsupported="true"');
  });

  it("不支持时只留一句明说：「这家没提供思考能力」收进折叠体（不摆三句话）", () => {
    const html = render({ thinkingLevels: undefined, thinkingSupported: false });
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain("了解如何配置");
    expect(summary).not.toContain("这家没提供思考能力");
    expect(html.indexOf("这家没提供思考能力")).toBeGreaterThan(html.indexOf("</summary>"));
    expect(html).toContain("当前模型不支持思考强度");
  });
});

describe("芯片显示的是**当前档**（既有契约：显示的 = 发出去的）", () => {
  it("模型不支持当前档 ⇒ 芯片仍显示当前档（归位不许靠偷换显示）", () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        infos={[info]}
        value="deepseek-chat"
        thinking="high"
        thinkingSupported
        onThinkingChange={() => undefined}
        onChange={() => undefined}
      />,
    );
    // 显示层不许偷换：芯片上写「· 思考 high」＝用户设的那一档＝真正发出去的那一档。
    // 归位由**状态更新**完成（下面的 effect / pick 两条路径），不是显示层换字。
    expect(html).toContain("· 思考 high");
  });
});

describe("不支持态的视觉：思考面是空态说明，不摆假按键", () => {
  it("override 落在 model-menu.css（styles.css 的基线不动）", () => {
    // 新结构下「不支持」是空态（没有分段可覆盖）；这条钉住组件层 CSS 的落点不变
    expect(menuCss).toContain(".mp-pop .mp-effort");
  });
});

describe("芯片动效（对标 Claude 的 cds-pill-pop）", () => {
  it("进场是缩放弹入，值变了是上冲一下落回——两条动画分开", () => {
    expect(css).toContain("@keyframes mp-name-in");
    expect(css).toContain("@keyframes mp-name-pop-up");
    expect(css).toContain("@keyframes mp-name-pop-down");
    // 值变了走 data-pop（单独的规则），进场走默认那条
    expect(css).toMatch(/\.mp-trigger \.mp-name\[data-pop="true"\]\s*\{[^}]*mp-name-pop-up/);
    expect(css).toMatch(/\.mp-trigger \.mp-name\s*\{[^}]*mp-name-in/);
  });

  it("上冲 1.32 / 落回 overshoot（Claude 的数值，不是自创）", () => {
    expect(css).toContain("@keyframes mp-name-pop-up { to { transform: scale(1.32); } }");
    expect(css).toContain("@keyframes mp-name-pop-down { 0% { transform: scale(1.32); } }");
  });

  it("换模型那一步真的会归位并通知上层（接线面：读整个渲染层，不读单文件）", () => {
    const surface = readAppSurface();
    // pick 里先归位、再通知 onThinkingChange —— 顺序反了就会出现「先换模型后归位」的闪档
    const pickAt = surface.indexOf("const pick = (registryId: string | null)");
    expect(pickAt).toBeGreaterThan(-1);
    const body = surface.slice(pickAt, pickAt + 700);
    expect(body).toContain("reconcileThinkingLevel(");
    expect(body.indexOf("reconcileThinkingLevel(")).toBeLessThan(body.indexOf("onThinkingChange?.("));
    // 归位还必须有一条**不靠点击**的路径（切会话 / 父级换 value）：effect 里同样归位并写回
    const effectAt = surface.indexOf("if (reconciled !== level) props.onThinkingChange(reconciled);");
    expect(effectAt).toBeGreaterThan(-1);
    // 芯片显示的必须是**当前档**（既有契约）：不许在显示层偷换成归位档
    const chipAt = surface.indexOf('const level = props.thinking ?? "off";');
    expect(chipAt).toBeGreaterThan(-1);
  });
});
