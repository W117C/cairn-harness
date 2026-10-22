// P2-2/P2-3 判卷：Composer 控件行收口 + 附件 chips 升级 + 传递面（SSR 真 HTML + 源文哨兵）。
// 钉：① ＋菜单四项文案；② 源文清退 pathDraft/「按路径添加引用」//绝对/路径；③ 权限 chip 档位名 + 色点 data-mode；
// ④ 模型 chip「名 · 思考 X」+ 合并单面弹窗（搜索 + 列表 + 思考 segmented + 能力禁用）；
// ⑤ 发送钮 title（⏎）/停止钮 title（⌘.）；⑥ chips 组件形态与图标分类纯函数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer, fileIconKind } from "../src/renderer/components/Composer";
import { ModelMenu, ModelPicker, type ModelOption } from "../src/renderer/components/ModelPicker";
import { MODE_DOT, PermissionMenu } from "../src/renderer/components/PermissionMenu";
import { STR } from "../src/renderer/strings";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const composerSrc = read("../src/renderer/components/Composer.tsx");
const appSrc = readAppSurface();

const base = {
  mode: "default" as const,
  running: false,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
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
  });

  it("弹层四档：每档 data-mode + 色点 + 一句说明；当前档恰一枚对勾", () => {
    const html = renderToStaticMarkup(<PermissionMenu mode="guided" onModeChange={() => undefined} onClose={() => undefined} />);
    for (const m of ["read-only", "default", "guided", "auto"] as const) {
      expect(html).toContain(`data-mode="${m}"`);
    }
    expect(html).toContain(STR.permissionModes.readOnlyDesc);
    expect(html).toContain(STR.permissionModes.defaultDesc);
    expect(html).toContain(STR.permissionModes.guidedDesc);
    expect(html).toContain(STR.permissionModes.autoDesc);
    expect((html.match(/class="check">✓</g) ?? []).length).toBe(1);
    // 色点四枚全用 token（component 零字面色值）
    expect((html.match(/class="mode-dot"/g) ?? []).length).toBe(4);
    expect(html).toContain(MODE_DOT.auto);
  });

  it("MODE_DOT 记录：四键齐全且全为 token 引用", () => {
    for (const m of ["read-only", "default", "guided", "auto"] as const) {
      expect(MODE_DOT[m]).toContain("var(--mode-");
    }
  });
});

describe("P2-2 模型+思考合并单面", () => {
  it("chip 文案 `名 · 思考 X`；未声明支持不带思考段", () => {
    const supported = renderToStaticMarkup(
      <ModelPicker infos={[]} value="cn:hy3" onChange={() => undefined} thinking="low" thinkingSupported onThinkingChange={() => undefined} />,
    );
    expect(supported).toContain("cn:hy3 · 思考 低");
    const unsupported = renderToStaticMarkup(
      <ModelPicker infos={[]} value="cn:hy3" onChange={() => undefined} thinking="off" onThinkingChange={() => undefined} />,
    );
    expect(unsupported).not.toContain("· 思考");
  });

  it("弹层（ModelMenu 本体）：搜索框 + 列表 + 下半区思考 segmented（四键 + 逐档 title 说明 + 当前档提示）", () => {
    const html = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="low" thinkingSupported />,
    );
    expect(html).toContain("mp-search");
    expect(html).toContain(STR.modelPicker.searchPlaceholder);
    expect(html).toContain(">openai<");
    expect(html).toContain("th-row");
    for (const s of [STR.modelPicker.thinkOff, STR.modelPicker.thinkLow, STR.modelPicker.thinkMedium, STR.modelPicker.thinkHigh]) {
      expect(html).toContain(`>${s}<`);
    }
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(html).toContain(STR.modelPicker.thinkLowHint); // 当前档说明上屏
    expect(html).toContain(`title="${STR.modelPicker.thinkHighHint}"`); // 每档一句说明（逐键 tooltip）
  });

  it("未声明能力：整区禁用（四键 disabled）+ 注「当前模型不支持思考强度」+ 配置折叠在场", () => {
    const html = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="off" />,
    );
    expect(html).toContain("th-row");
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(4); // 四键 + 无列表禁用（本面无 running）
    // 实际四键 disabled + 0 列表 = 4
    expect(html).toContain(STR.modelPicker.unsupportedNote);
    expect(html).toContain("th-why");
    expect(html).toContain("reasoningEfforts");
  });

  it("运行中：列表禁用、思考段照开（跑着也能拧）+ 运行注记在场", () => {
    const html = renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} thinking="off" thinkingSupported running />,
    );
    expect(html).toContain(STR.modelPicker.runningNote);
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(3); // 模型两行 + 演示；四键不禁
  });

  it("无 onThinkingChange（旧消费者）：思考段不出现（零行为变化）", () => {
    const html = renderToStaticMarkup(<ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} />);
    expect(html).not.toContain("th-row");
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
