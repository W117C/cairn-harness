// 设置页正文（批 6 · 总纲阶段 3-1/3-2 + 细则 §六）——SettingsPanel 只做壳；正文按区拆分（第 1066–1072 页）：
//   本文件只留 SettingsIssueBanner（设置文件首读失败横幅）＋文件末重导出保旧 import 面。
//   GeneralSection / ShortcutsSection / PermissionsSection / AdvancedSection / AboutSection / ProviderSection /
//   McpSection / HooksSection 已抽到 settings/ 子文件；纯函数资产抽到 settings/provider-assets.ts（叶子）。
// 2026-10-16（模型/通道页重做）：控件走 settings-ui 的 Field（36px/8px/四态）、徽章走 Badge、
// 状态走 StatusDot；旧 sp-key-row / sp-key-chip 一族随重做下架（判卷钉已同步改名点名）。
import { TriangleAlert } from "lucide-react";
import { Banner } from "./settings-ui";

// ── 设置文件首读失败横幅（v26）─────────────────────────────────────────

/** 文件坏了不许静默用缺省：说清哪份文件、什么原因、怎么修。
 *  缺省（undefined / null）= 没有文件或读得动，不摆横幅（缺席 ≠ 失败）。
 *  不给「重新检查」按钮：主进程的设置缓存与首读结论都驻留在进程里，改盘后要重启才生效——
 *  摆一个点了没反应的按钮，比不摆更坏。 */
export function SettingsIssueBanner(props: {
  issue: { kind: string; message: string; path: string } | null | undefined;
  /** 真重读盘（设置页传 `window.agent.reloadSettings`）；缺省不摆按钮（SSR / 旧调用面零行为）。 */
  onReload?: () => void;
  reloading?: boolean;
}): React.JSX.Element | null {
  if (props.issue === null || props.issue === undefined) return null;
  return (
    <Banner
      tone="warn"
      icon={<TriangleAlert size={13} />}
      details={
        <>
          <p>{props.issue.path}</p>
          <p>{props.issue.message}</p>
        </>
      }
    >
      {props.onReload === undefined
        ? "设置文件未生效：当前按缺省设置运行。修好或删除它，再重新打开 Cairn。"
        : "设置文件未生效：当前按缺省设置运行。修好或删除它，然后点「重新读取」。"}
      {props.onReload !== undefined && (
        <button
          type="button"
          className="mini-btn ss-banner-action"
          disabled={props.reloading === true}
          onClick={props.onReload}
        >
          {props.reloading === true ? "正在读取…" : "重新读取"}
        </button>
      )}
    </Banner>
  );
}

// 段与纯函数资产 re-export（设置壳与判卷消费；放这里避免壳与段各持一份）。

export { GeneralSection } from "./settings/GeneralSection";
export { ShortcutsSection } from "./settings/ShortcutsSection";
export { PermissionsSection, MODE_OPTIONS } from "./settings/PermissionsSection";
export { AdvancedSection, parseBudgetField, parseCapField } from "./settings/AdvancedSection";
export { AboutSection, licenseLabel, licenseExpiryHint, DoctorResultView, DIAGNOSTICS_TEXT } from "./settings/AboutSection";
export { ProviderSection } from "./settings/ProviderSection";
export { McpSection, mcpDraftFrom, mcpDraftPayload, MCP_EMPTY_DRAFT, type McpDraft } from "./settings/McpSection";
export { HooksSection } from "./settings/HooksSection";
export {
  PANEL_PATCH_KEYS,
  panelPatch,
  PANEL_PROVIDER_KINDS,
  providerNeedsKey,
  defaultKeyProvider,
  providerStatusParts,
  providerStatusLabel,
  searchCapabilityLabel,
  SEARCH_CONFIG_HINT,
  visionCapabilityLabel,
  type ProviderStatusParts,
} from "./settings/provider-assets";
