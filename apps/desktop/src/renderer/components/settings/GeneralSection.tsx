// 通用段（外观 / 语言 / 快捷键）——2026-11-11（第 1066 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 2026-11-12（第 1075 页）：裸中文收编进 STR.general（值一字不改；本文件同时进 strings.test 的 REWORKED_FILES）。
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../../src/main/settings";
import { STR } from "../../strings";
import { SettingsSection, SettingsRow } from "../settings-ui";
import { Switch } from "../Switch";

const THEME_OPTIONS: readonly { id: AppSettings["theme"]; label: string }[] = [
  { id: "system", label: STR.general.themeSystem },
  { id: "light", label: STR.general.themeLight },
  { id: "dark", label: STR.general.themeDark },
];

/** 字号三档（2026-10-18）。id 与 tokens.css 的 `html[data-text-size=…]` 逐字对应；
 *  预览字「A」的字号随档变化，让用户在点下去之前就看见差别（不靠猜）。 */
const TEXT_SIZE_OPTIONS: readonly { id: TextSizeSetting; label: string }[] = [
  { id: "sm", label: STR.general.textSizeSm },
  { id: "md", label: STR.general.textSizeMd },
  { id: "lg", label: STR.general.textSizeLg },
];

/** 组件尺寸五档（2026-10-20 · 双轴变体的尺寸轴，销 G2）。
 *  依据 Claude 实测 data-step="1…5"（step2 = 缺省 = --size-scale 1，step4 = comfortable 密度）。
 *  id 与 tokens.css 的 `html[data-ui-size="…"]` 逐字对应。 */
const UI_SIZE_OPTIONS: readonly { id: UiSizeSetting; label: string }[] = [
  { id: "1", label: STR.general.uiSize1 },
  { id: "2", label: STR.general.uiSize2 },
  { id: "3", label: STR.general.uiSize3 },
  { id: "4", label: STR.general.uiSize4 },
  { id: "5", label: STR.general.uiSize5 },
];

export function GeneralSection(props: {
  settings: AppSettings;
  /** 当前字号档（App 的 live state——与 settings.textSize 同源，但保存后立刻回灌）。 */
  textSize: TextSizeSetting;
  onSave: (patch: Record<string, unknown>) => void;
  /** Ctrl+Tab 走单键直调通道（不入 panelPatch 白名单）。 */
  onCtrlTab: (next: boolean) => void;
  /** 字号档同样走单键直调（不入 panelPatch 白名单；理由同 onCtrlTab）。 */
  onTextSize: (next: TextSizeSetting) => void;
  /** 2026-10-20：组件尺寸档（尺寸轴）；同样走单键直调，理由同上。 */
  uiSize: UiSizeSetting;
  onUiSize: (next: UiSizeSetting) => void;
  onWindowVibrancy: (next: boolean) => void;
  /** 完成通知开关（同样走单键直调：panelPatch 白名单不动）。 */
  onNotify: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <SettingsSection title={STR.general.appearanceTitle}>
        <SettingsRow label={STR.general.theme}>
          <div className="theme-opts" role="radiogroup" aria-label={STR.general.theme}>
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.settings.theme === t.id}
                className={"theme-opt" + (props.settings.theme === t.id ? " on" : "")}
                onClick={() => props.onSave({ theme: t.id })}
              >
                {/* 2026-10-24 业主：不要色块小预览——主题选择就是三个词，文字直给。 */}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label={STR.general.textSize}>
          <div className="theme-opts" role="radiogroup" aria-label={STR.general.textSize}>
            {TEXT_SIZE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.textSize === t.id}
                className={"theme-opt" + (props.textSize === t.id ? " on" : "")}
                onClick={() => props.onTextSize(t.id)}
              >
                <span className="ts-thumb" data-ts={t.id} aria-hidden="true">A</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label={STR.general.uiSize}>
          <div className="theme-opts" role="radiogroup" aria-label={STR.general.uiSize}>
            {UI_SIZE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={props.uiSize === t.id}
                className={"theme-opt" + (props.uiSize === t.id ? " on" : "")}
                onClick={() => props.onUiSize(t.id)}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label={STR.general.vibrancy} desc={STR.general.vibrancyDesc}>
          <Switch
            label={STR.general.vibrancy}
            checked={props.settings.windowVibrancy === true}
            onChange={props.onWindowVibrancy}
            onText={STR.general.on}
            offText={STR.general.off}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={STR.general.habitTitle}>
        {/* 次级说明不再复述控件已经说的话：语言值就摆在右侧（只有一项），
            快捷键表里另有「⌘⇧] / ⌘⇧[」一行，这里再写一遍是同一屏的第二处。 */}
        <SettingsRow label={STR.general.locale}>
          <span className="ss-static">{STR.general.localeValue}</span>
        </SettingsRow>
        <SettingsRow label={STR.general.notify} desc={STR.general.notifyDesc}>
          <Switch
            label={STR.general.notify}
            checked={props.settings.notifyOnComplete !== false}
            onChange={props.onNotify}
            onText={STR.general.on}
            offText={STR.general.off}
          />
        </SettingsRow>
        <SettingsRow label={STR.general.ctrlTab}>
          <Switch
            label={STR.general.ctrlTab}
            checked={props.settings.ctrlTabCycle}
            onChange={props.onCtrlTab}
            onText={STR.general.on}
            offText={STR.general.off}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
