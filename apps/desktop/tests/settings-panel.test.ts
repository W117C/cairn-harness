import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// 纯函数判卷（node 环境不渲染 JSX，同 sidebar-groups / model-picker 先例：组件文件同源导出）。
import {
  PANEL_PATCH_KEYS,
  PANEL_PROVIDER_KINDS,
  defaultKeyProvider,
  panelPatch,
  providerNeedsKey,
  providerStatusLabel,
  searchCapabilityLabel,
  SEARCH_CONFIG_HINT,
} from "../src/renderer/components/SettingsPanel";
// 唯一事实源对账：面板的 provider 选项集不得抄第二份。settings.ts 的 PROVIDER_KINDS 定义
// ＝ ["demo", ...ENV_KEYED_PROVIDERS]；测试环境是 node，可以 import settings.ts 对账
// （renderer bundle 反而不行——settings.ts 拖 node:fs/registry 进包，面板侧只能同形再推导，测试钉住等值）。
import { PROVIDER_KINDS } from "../../../src/main/settings";
import { envKeyOf } from "../../../src/providers/env-keys";

const panelSrc = readFileSync(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url), "utf8");
const appSrc = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const modalSurfaceSrc = readFileSync(new URL("../src/renderer/components/ModalSurface.tsx", import.meta.url), "utf8");

describe("providerStatusLabel（凭据段状态行，三态文案判卷）", () => {
  it("safeStorage 不可用：写明 fail-closed 拒存、不落明文——不让用户以为 key 存上了", () => {
    expect(providerStatusLabel({ available: false, stored: [], envActive: false })).toBe(
      "安全存储不可用：key 无法保存（fail-closed，不落明文）",
    );
  });

  it("可用且空存储：尚未存储任何 key", () => {
    expect(providerStatusLabel({ available: true, stored: [], envActive: false })).toBe(
      "尚未存储任何 key",
    );
  });

  it("已存清单：逐家列出（stored 列表即删除按钮的数据源）", () => {
    expect(providerStatusLabel({ available: true, stored: ["glm", "openai"], envActive: false })).toBe(
      "已存 key：glm、openai",
    );
  });

  it("env 并存：追加 env 优先提示（启动注入对 env 已在的 provider 零行为；批 6 改通俗行文）", () => {
    expect(providerStatusLabel({ available: true, stored: ["glm"], envActive: true })).toBe(
      "已存 key：glm；检测到环境变量，将优先使用",
    );
  });

  it("env 在场但未存任何 key：两个事实同一条文案，不静默", () => {
    expect(providerStatusLabel({ available: true, stored: [], envActive: true })).toBe(
      "尚未存储任何 key；检测到环境变量，将优先使用",
    );
  });
});

describe("panelPatch（patch 白名单：UI 只放行六键，不透传任意 patch）", () => {
  it("白名单本身钉死为六键：provider/model/mode/theme/planRequiredByDefault/locale（locale 为实测缺陷修复）", () => {
    expect([...PANEL_PATCH_KEYS]).toEqual(["provider", "model", "mode", "theme", "planRequiredByDefault", "locale"]);
  });

  it("六键齐传原样通过", () => {
    const patch = {
      provider: "glm",
      model: "glm-5.2",
      mode: "auto",
      theme: "dark",
      planRequiredByDefault: true,
      locale: "en-US",
    };
    expect(panelPatch(patch)).toEqual(patch);
  });

  it("混入非白名单键（layout/safeMode/workspace/autoMemory/currentSession/未知键）一律丢弃", () => {
    expect(
      panelPatch({
        provider: "openai",
        layout: { activePanel: "token", width: 50 },
        safeMode: "off",
        workspace: "/etc",
        autoMemory: false,
        currentSession: "s1",
        __proto_injection: true,
      }),
    ).toEqual({ provider: "openai" });
  });

  it("undefined 值视同缺席丢弃（防止把 undefined 灌进 settings 浅合并盖掉真值）", () => {
    expect(panelPatch({ model: undefined, provider: "demo" })).toEqual({ provider: "demo" });
  });

  it("空入参 → 空 patch（不产生 `setSettings({})` 之外的任何键）", () => {
    expect(panelPatch({})).toEqual({});
  });

  it("locale 补丁放行（修复前恰在这里被丢成 {}：下拉显示已保存、实际没落库）", () => {
    expect(panelPatch({ locale: "en-US" })).toEqual({ locale: "en-US" });
  });
});

describe("key 表单缺省 provider（修复实测缺陷：初值 deepseek 不在选项集里，干净注册表下首存必败）", () => {
  it("缺省值必须来自同一张选项集且是需要 key 的那一档", () => {
    const fallback = defaultKeyProvider();
    expect(PANEL_PROVIDER_KINDS).toContain(fallback);
    expect(providerNeedsKey(fallback)).toBe(true);
  });

  it("极端形态不造一个不存在的值：全 demo ⇒ 回落首项；空表 ⇒ 空串", () => {
    expect(defaultKeyProvider(["demo"])).toBe("demo");
    expect(defaultKeyProvider([])).toBe("");
  });
});

describe("provider 选项集与 key 需求（凭据段数据面）", () => {
  it("PANEL_PROVIDER_KINDS 与 settings.PROVIDER_KINDS 逐位相等（同源对账，renderer 侧不得漂移）", () => {
    expect([...PANEL_PROVIDER_KINDS]).toEqual([...PROVIDER_KINDS]);
  });

  it("demo 首位且免 key；四家真实 provider 都要 key 且都有登记的 env 名（env 提示可渲染）", () => {
    expect(PANEL_PROVIDER_KINDS[0]).toBe("demo");
    expect(providerNeedsKey("demo")).toBe(false);
    for (const kind of PANEL_PROVIDER_KINDS) {
      if (kind === "demo") continue;
      expect(providerNeedsKey(kind), kind).toBe(true);
      expect(envKeyOf(kind), kind).not.toBeNull();
    }
  });

  it("未知 provider 一律按要 key 判（fail-visible 而不是当 demo 放行）", () => {
    expect(providerNeedsKey("ghost")).toBe(true);
  });
});

describe("searchCapabilityLabel（联网搜索状态行，三态文案判卷）", () => {
  // 动因：2026-10-15 桌面端会话里，用户让 agent「搜一下」，agent 答「我没有检索能力」。
  // 真实原因是这个工作区没配 search.endpoint ⇒ web_search 整族不注入，而用户无从知道原因
  // （doctor 只有 CLI 输出）。这一行把配置缺口说成一句可执行的话，而不是让用户猜模型不行。
  it("未配：说清工具不会出现、模型会说什么", () => {
    expect(searchCapabilityLabel({ search: { kind: "unset" } })).toContain("web_search 工具不会出现");
  });

  it("已配：带回端点（用户要能看见配的是哪一家）", () => {
    const label = searchCapabilityLabel({ search: { kind: "ok" }, searchEndpoint: "https://searx.example/search?q={query}&format=json" });
    expect(label).toContain("已配");
    expect(label).toContain("https://searx.example/search?q={query}&format=json");
  });

  it("已配但没带端点 URL：也说「已配」，不编一个地址", () => {
    expect(searchCapabilityLabel({ search: { kind: "ok" } })).toBe("联网搜索已配");
  });

  it("配坏：把真实原因带出来（折成「未配」会让用户白找一遍配置）", () => {
    const label = searchCapabilityLabel({ search: { kind: "broken", message: "Unexpected token" } });
    expect(label).toContain("解析失败");
    expect(label).toContain("Unexpected token");
  });

  it("配法提示带 {query} 占位符（那是 loadSearchConfig 的硬判据，漏了照样不注入）", () => {
    expect(SEARCH_CONFIG_HINT).toContain("{query}");
  });
});

describe("设置页模态边界（背景不可达 + 焦点环绕 + 关闭恢复）", () => {
  it("设置页走统一 ModalSurface，由边界声明 aria-modal 并隔离背景", () => {
    expect(panelSrc).toContain('<ModalSurface className="sp-page" label="设置" onClose={props.onClose}>');
    expect(modalSurfaceSrc).toContain('aria-modal="true"');
    expect(modalSurfaceSrc).toContain('setAttribute("inert", "")');
    expect(modalSurfaceSrc).toContain('setAttribute("aria-hidden", "true")');
  });

  it("Tab / Shift+Tab 在设置内环绕，卸载时把焦点还给打开前的控件", () => {
    expect(modalSurfaceSrc).toContain('e.key !== "Tab"');
    expect(modalSurfaceSrc).toContain("previousFocus");
    expect(modalSurfaceSrc).toContain("previousFocus?.focus()");
    expect(modalSurfaceSrc).toContain("last.focus()");
    expect(modalSurfaceSrc).toContain("first.focus()");
  });

  it("设置打开时 App 全局快捷键让路，Esc 不会被误判成停止运行", () => {
    expect(appSrc).toContain("if (document.querySelector('[data-modal-surface=\"true\"]') !== null || h.paletteOpen) return;");
  });
});


// 2026-10-17：设置分区切换的进场（Claude 质感：短淡入，不弹跳）。
import { readFileSync as readFs } from "node:fs";
import { fileURLToPath as fileUrl } from "node:url";
describe("设置页切换动效", () => {
  it(".ss-page 首绘淡入（120–160ms 区间）", () => {
    const css = readFs(fileUrl(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.ss-page\s*{[^}]*animation:\s*fade-in var\(--t-fast\)/s);
  });
});
