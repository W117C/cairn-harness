// P2-2/P2-3 判卷：Composer 控件行收口 + 附件 chips 升级 + 传递面（SSR 真 HTML + 源文哨兵）。
// 钉：① ＋菜单四项文案；② 源文清退 pathDraft/「按路径添加引用」//绝对/路径；③ 权限 chip 档位名 + 色点 data-mode；
// ④ 模型 chip「名 · 思考 X」+ 合并单面弹窗（搜索 + 列表 + 思考 segmented + 能力禁用）；
// ⑤ 发送钮 title（⏎）/停止钮 title（⌘.）；⑥ chips 组件形态与图标分类纯函数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer, fileIconKind } from "../src/renderer/components/Composer";
import { ModelMenu, ModelPicker, THINKING_LEVELS, type ModelOption } from "../src/renderer/components/ModelPicker";
import { MODE_DOT, PermissionMenu } from "../src/renderer/components/PermissionMenu";
import { STR } from "../src/renderer/strings";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const composerSrc = read("../src/renderer/components/Composer.tsx") + "\n" + read("../src/renderer/components/ComposerAttachments.tsx") + "\n" + read("../src/renderer/components/ComposerAttachMenu.tsx") + "\n" + read("../src/renderer/components/ComposerPermissionMenu.tsx");
const appSrc = readAppSurface();
const css = read("../src/renderer/styles.css");

const base = {
  mode: "default" as const,
  running: false,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  events: [],
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "执行工具",
  phase: "tool" as const,
  elapsedSec: 3,
  steps: 2,
  workspacePath: "/w/proj",
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
  onPickFiles: async () => null,
  onPickDirectory: async () => null,
};

const OPTIONS: ModelOption[] = [
  { registryId: null, label: "演示", provider: null },
  { registryId: "openai-standard", label: "gpt-4o", provider: "openai", tier: "standard", ctxWindow: 128_000 },
  { registryId: "deepseek-chat", label: "deepseek-chat", provider: "deepseek", tier: "cheap", ctxWindow: 1_000_000 },
];

describe("P2-2 ＋ 菜单四项（零路径输入）", () => {
  it("四项文案在场：上传文件… / 添加文件夹… / 粘贴截图（⌘V） / 引用最近文件", () => {
    const html = renderToStaticMarkup(<Composer {...base} stopped={false} />);
    expect(html).toContain(STR.composer.attachUpload);
    expect(html).toContain(STR.composer.attachFolder);
    expect(html).toContain(STR.composer.attachPaste);
    expect(html).toContain(STR.composer.attachRecent);
  });

  it("源文清退：pathDraft /「按路径添加引用」//绝对/路径 三样不再出现（零路径手输）", () => {
    expect(composerSrc).not.toContain("pathDraft");
    expect(composerSrc).not.toContain("按路径添加引用");
    expect(composerSrc).not.toContain("/绝对/路径");
  });

  it("最近文件空态：该项 disabled 且 tooltip 说明（不摆空壳入口）", () => {
    const html = renderToStaticMarkup(<Composer {...base} stopped={false} recentRefs={[]} />);
    expect(html).toContain(STR.composer.attachRecentEmpty);
    // 空列表 ⇒ disabled 的「引用最近文件」行
    const at = html.indexOf(STR.composer.attachRecent);
    const openTag = html.slice(html.lastIndexOf("<button", at), at);
    expect(openTag).toContain("disabled");
  });
});

describe("P2-2 权限 chip（档位名 + 色点 data-mode）", () => {
  it("触发 chip：模式名 + 色点 data-mode + token 色（组件零字面色值）", () => {
    const html = renderToStaticMarkup(<Composer {...base} stopped={false} />);
    const chip = /<button class="ctl"[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(chip).not.toBe("");
    expect(chip).toContain(STR.permissionModes.default);
    expect(chip).toContain('class="mode-dot"');
    expect(chip).toContain('data-mode="default"');
    expect(chip).toContain(MODE_DOT.default);
    // 第 872 页（业主「让布局说话」）：触发器不再叠第三枚标记。
    // 原先 = 色点 + 盾形图标（只有 warn/非 warn 两个形）+ 档名 + 箭头；
    // 现在 = 色点 + 档名 + 箭头 ⇒ 整枚 chip 里只剩箭头一个 svg。
    expect((chip.match(/<svg/g) ?? []).length, "触发 chip 只许剩箭头一枚 svg").toBe(1);
    expect(chip).toContain('class="ctl-caret"');
  });

  it("弹层四档：每档 data-mode + 色点 + 一句说明；旧 guided 配置落到智能审批那一格", () => {
    const html = renderToStaticMarkup(<PermissionMenu mode="guided" onModeChange={() => undefined} onClose={() => undefined} />);
    for (const m of ["read-only", "default", "auto", "full-access"] as const) {
      expect(html).toContain(`data-mode="${m}"`);
    }
    // 2026-11-03：引导并入智能审批，选择面不再出现 guided。
    expect(html).not.toContain('data-mode="guided"');
    expect(html).toContain(STR.permissionModes.readOnlyDesc);
    expect(html).toContain(STR.permissionModes.defaultDesc);
    expect(html).toContain(STR.permissionModes.autoDesc);
    expect(html).toContain(STR.permissionModes.fullAccessDesc);
    expect((html.match(/class="check">✓</g) ?? []).length).toBe(1);
    // 色点四枚全用 token（component 零字面色值）
    expect((html.match(/class="mode-dot"/g) ?? []).length).toBe(4);
    expect(html).toContain(MODE_DOT.auto);
  });

  it("MODE_DOT 记录：五键齐全且全为 token 引用", () => {
    for (const m of ["read-only", "default", "guided", "auto", "full-access"] as const) {
      expect(MODE_DOT[m]).toContain("var(--mode-");
    }
  });
});

describe("P2-2 模型+思考合并单面", () => {
  it("chip 文案 `名 · 思考 X`；未声明支持不带思考段", () => {
    const supported = renderToStaticMarkup(
      <ModelPicker infos={[]} value="cn:hy3" onChange={() => undefined} thinking="low" thinkingSupported onThinkingChange={() => undefined} />,
    );
    expect(supported).toContain("cn:hy3 · 思考 low");
    const unsupported = renderToStaticMarkup(
      <ModelPicker infos={[]} value="cn:hy3" onChange={() => undefined} thinking="off" onThinkingChange={() => undefined} />,
    );
    expect(unsupported).not.toContain("· 思考");
  });

  it("弹层 root 面：模型/思考强度两枚 cell；模型面：搜索（>4 个模型才出现）+ 分组列表", () => {
    const root = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="low" thinkingSupported />,
    );
    expect(root).toContain("mp-cells");
    expect(root).toContain(">思考强度<");
    // OPTIONS 只有 3 个真模型 ⇒ 不出搜索行（DeepSeek 规则：>4 个才搜）
    expect(root).not.toContain("mp-search");
    expect(root).toContain(">deepseek-chat</span>");
    const model = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} initialFocus="model" />,
    );
    expect(model).toContain(">openai<");
    expect(model).toContain('class="mp-group separated"');
  });

  it("思考面：档位 radio 行（逐行 title 说明 + 当前档恰一枚 aria-selected）", () => {
    const html = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="low" thinkingSupported initialFocus="effort" />,
    );
    expect(html).toContain("mp-effort");
    for (const s of [STR.modelPicker.thinkOff, STR.modelPicker.thinkLow, STR.modelPicker.thinkMedium, STR.modelPicker.thinkHigh, STR.modelPicker.thinkMax]) {
      expect(html).toContain(`>${s}<`);
    }
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toContain(STR.modelPicker.thinkLowHint); // 当前档说明在行 title
    expect(html).toContain(`title="${STR.modelPicker.thinkHighHint}"`); // 每档一句说明（逐行 tooltip）
  });

  it("档位词表含 xhigh 与 max（英文标准档，2026-11-05）：与能力值同字面量，文案来自 STR", () => {
    expect(THINKING_LEVELS.map((level) => level.id)).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
    expect(THINKING_LEVELS.find((level) => level.id === "max")?.short).toBe(STR.modelPicker.thinkMax);
    expect(STR.modelPicker.thinkXhigh).toBe("xhigh");
    expect(STR.modelPicker.thinkMax).toBe("max");
  });

  it("模型声明 max ⇒ 思考面按当前模型出现 max 档", () => {
    const html = renderToStaticMarkup(
      <ModelMenu
        options={[{ registryId: "deepseek-cheap", label: "deepseek-flash", provider: "deepseek", thinkingLevels: ["off", "low", "high", "max"], thinkingDefault: "off" }]}
        value="deepseek-cheap"
        onPick={() => undefined}
        onThinkingChange={() => undefined}
        thinking="high"
        thinkingSupported
        initialFocus="effort"
      />,
    );
    expect(html).toContain(STR.modelPicker.thinkMax);
    expect(html).toContain(STR.modelPicker.thinkMaxHint);
    expect(html).toContain('data-e="max"');
  });

  it("未声明能力：思考面空态 + 注「当前模型不支持思考强度」+ 配置折叠在场", () => {
    const html = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="off" initialFocus="effort" />,
    );
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(0); // 空态，不摆假按键
    expect(html).toContain(STR.modelPicker.unsupportedNote);
    expect(html).toContain("th-why");
    expect(html).toContain("reasoningEfforts");
  });

  it("运行中：模型面禁用、思考面照开（跑着也能拧）+ 运行注记在场", () => {
    const effort = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="off" thinkingSupported running initialFocus="effort" />,
    );
    expect(effort).toContain(STR.modelPicker.runningNote);
    expect((effort.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(0); // 档位行不禁
    const models = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} running initialFocus="model" />,
    );
    expect((models.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(2); // 两行真模型禁
  });

  it("无 onThinkingChange（旧消费者）：root 面无思考强度 cell（零行为变化）", () => {
    const html = renderToStaticMarkup(<ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} />);
    expect(html).not.toContain("mp-effort");
  });
});

describe("Composer 控件视觉层级", () => {
  it("附件与权限退为低强调，模型保留轻底与细边，发送仍是唯一主行动", () => {
    expect(css).toMatch(/\.attach-btn\s*{[^}]*border:\s*1px solid transparent/s);
    expect(css).toMatch(/\.ctl\s*{[^}]*color:\s*hsl\(var\(--text-300\)\)/s);
    expect(css).toMatch(/\.mp-trigger\s*{[^}]*border:\s*1px solid var\(--hairline\)/s);
    expect(css).toMatch(/\.mp-trigger\s*{[^}]*background:\s*hsl\(var\(--bg-100\)\)/s);
    expect(css).toMatch(/\.mp-trigger \.mp-name\s*{[^}]*max-width:\s*180px/s);
    expect(css).toMatch(/\.send-btn\s*{[^}]*background:\s*hsl\(var\(--accent-brand\)\)/s);
  });
});

describe("P2-2 发送/停止钮 title", () => {
  it("空闲：发送钮 title 含 ⏎；运行中：停止钮 title 含 ⌘.", () => {
    const idle = renderToStaticMarkup(<Composer {...base} stopped={false} running={false} />);
    const sendAt = idle.indexOf(`title="${STR.composer.sendTitle}"`);
    expect(sendAt).toBeGreaterThan(-1);
    expect(STR.composer.sendTitle).toContain("⏎");
    const running = renderToStaticMarkup(<Composer {...base} stopped={false} running />);
    expect(running).toContain(`title="${STR.composer.stopTitle}"`);
    expect(STR.composer.stopTitle).toContain("⌘.");
  });

  it("⌘. 挂在 Composer keydown 通道（onCancel）", () => {
    expect(composerSrc).toContain('e.key === "."');
    expect(composerSrc).toContain("onCancel");
  });
});

describe("P2-3 附件 chips + 图标分类", () => {
  it("fileIconKind：图片族按扩展名，其余文件兜底（无扩展名也算文件，目录由 kind 决定）", () => {
    expect(fileIconKind("shot.png")).toBe("image");
    expect(fileIconKind("IMG_1.HEIC")).toBe("image");
    expect(fileIconKind("a/b/c.jpeg")).toBe("image");
    expect(fileIconKind("webp")).toBe("file"); // 裸名无扩展名：不当图片兜底
    expect(fileIconKind("Composer.tsx")).toBe("file");
    expect(fileIconKind("noext")).toBe("file");
  });

  it("源文：chip 形态件在场（图标/名/大小/项目外盾牌/删除钮/路径只进 tooltip）", () => {
    expect(composerSrc).toContain("attach-chip");
    expect(composerSrc).toContain("ac-shield");
    expect(composerSrc).toContain("STR.composer.attachOutsideTip");
    expect(composerSrc).toContain("STR.composer.attachRemove");
    // 路径渲染只进 title，不做 chip 正文字面（旧形态 {a.path} 直出取消）
    expect(composerSrc).not.toMatch(/className="attach-chip">\s*\{a\.path\}/);
  });

  it("⌘V 粘贴：onPaste 收 clipboardData.files，无 files 不劫持文本粘贴", () => {
    expect(composerSrc).toContain("onPaste");
    expect(composerSrc).toContain("clipboardData");
    expect(composerSrc).toContain("saveTempFile");
    expect(composerSrc).toContain("STR.composer.pasteEmpty");
  });

  it("size 只进渲染层：发送前剥离（onSend 仍收 RunAttachmentReference 形状）", () => {
    expect(composerSrc).toContain("stripRenderFields");
  });
});

describe("P2-4 @ 模糊搜索接线 + 拖拽分流", () => {
  it("源文：workspaceSearch 通道 + 120ms debounce + 不再逐层下钻", () => {
    expect(composerSrc).toContain("workspaceSearch");
    expect(composerSrc).toContain("120");
    expect(composerSrc).not.toContain("mentionDirCache");
  });

  it("App：workspacePath 透传 + 最近引用记录（内存级）", () => {
    expect(appSrc).toContain("workspacePath={activeWorkspace}");
    expect(appSrc).toContain("recentRefsBySession");
  });
});
