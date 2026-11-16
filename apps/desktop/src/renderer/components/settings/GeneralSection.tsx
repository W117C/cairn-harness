// 通用段（外观 / 语言 / 快捷键）——2026-11-11（第 1066 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 2026-11-12（第 1075 页）：裸中文收编进 STR.general（值一字不改；本文件同时进 strings.test 的 REWORKED_FILES）。
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../../src/main/settings";
import { useEffect, useState } from "react";
import { STR } from "../../strings";
import { WallpaperBrowser } from "./WallpaperBrowser";
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
  /** 2026-11-14（设计规格 §3.3/§5.4）：壁纸行——选文件 / 清除 / 三个滑杆。
   *  全部走单键直调（不进 panelPatch 白名单）。 */
  onWallpaperPick: () => void;
  /** v73：应用内选择器选中路径后交给上层应用（同一条校验与落设置路径）。 */
  onWallpaperPickPath?: (path: string) => void;
  /** 判卷缝：直接给浏览器的初始读数。 */
  initialBrowser?: { dir: string; parent: string | null; entries: { name: string; path: string; kind: "dir" | "file" }[] };
  onWallpaperOpacity: (next: number) => void;
  onWallpaperScrim: (next: number) => void;
  onWallpaperGlass: (next: number) => void;
  onWallpaperClear: () => void;
  /** 设计规格 §7 降级链：媒体读不出时设置行点名「文件不可用」（运行期状态，不是设置字段）。 */
  wallpaperUnavailable: boolean;
  /** 定时轮换（2026-11-16）：整块 rotation 交给上层写（走 setSettings 的 wallpaper 合并，不走 panelPatch 白名单）。 */
  onWallpaperRotation: (next: AppSettings["wallpaper"]["rotation"]) => void;
  /** 多显示器（v77）：判卷缝——直接给解析结果（生产走 wallpaperDisplays）。 */
  initialDisplays?: { id: string; source: string; path?: string }[];
}): React.JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const [displays, setDisplays] = useState<{ id: string; source: string; path?: string }[]>(props.initialDisplays ?? []);
  const [displayNote, setDisplayNote] = useState<string | null>(null);
  // v78：文件源时把「解析出来的天气」显示出来（面板不只让你填路径，还告诉你读到了什么）。
  const [weatherNow, setWeatherNow] = useState<{ kind: string; source: string } | null>(null);

  useEffect(() => {
    const w = props.settings.wallpaper.rotation.weather;
    if (w.source !== "file" || w.filePath === null) { setWeatherNow(null); return; }
    void (async () => {
      try {
        const r = await window.agent.wallpaperWeatherNow();
        if (r.ok === true && typeof r.kind === "string") setWeatherNow({ kind: r.kind, source: String(r.source ?? "") });
      } catch { setWeatherNow(null); }
    })();
  }, [props.settings.wallpaper.rotation.weather.source, props.settings.wallpaper.rotation.weather.filePath, props.settings.wallpaper.rotation.weather.kind]);

  useEffect(() => {
    if (props.initialDisplays !== undefined) return;
    void (async () => {
      try {
        const r = await window.agent.wallpaperDisplays();
        if (r.ok === true && r.displays !== undefined) setDisplays(r.displays.map((d) => ({ id: d.id, source: d.source, ...(d.path === undefined ? {} : { path: d.path }) })));
      } catch { /* 读不到就不显示 */ }
    })();
  }, [props.initialDisplays]);
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
        {/* 壁纸（2026-11-14）：一行里放「选/清」与三个滑杆——同一屏同一件事，
            不再拆第二个二级标签（设计规范：布局优先，避免二级标签）。 */}
        <SettingsRow label={STR.general.wallpaper}>
          <div className="cw-settings">
            <div className="cw-settings-actions">
              {/* 「未设置」是状态词，不是动作：放在按钮左边当静态回执。
                  2026-11-15 真机实测：旧写法把它塞进按钮文案，已设壁纸时按钮反而读「未设置」。 */}
              {props.settings.wallpaper.kind === "none" && (
                <span className="ss-static">{STR.general.wallpaperNone}</span>
              )}
              <button type="button" className="mini-btn" onClick={props.onWallpaperPick}>
                {STR.general.wallpaperPick}
              </button>
              {props.onWallpaperPickPath !== undefined && (
                <button type="button" className="mini-btn" data-wallpaper-browse-toggle="true"
                  onClick={() => { setBrowsing(!browsing); }}>
                  {STR.general.wallpaperBrowse}
                </button>
              )}
              {props.settings.wallpaper.kind !== "none" && (
                <button type="button" className="mini-btn" onClick={props.onWallpaperClear}>
                  {STR.general.wallpaperClear}
                </button>
              )}
              {/* 选中的文件读不出（被删/移动/解码失败）⇒ 在这里点名，不让用户对着「已设壁纸但看不见」猜。 */}
              {props.wallpaperUnavailable && props.settings.wallpaper.kind !== "none" && (
                <span className="ss-static">{STR.general.wallpaperUnavailable}</span>
              )}
            </div>
            {/* 定时轮换（2026-11-16）：到点换下一张；候选少于两张时按纯函数口径不轮换。 */}
            <div className="cw-rotation" data-wallpaper-rotation="true">
              <label className="cw-rotation-toggle">
                <input
                  type="checkbox"
                  aria-label={STR.general.wallpaperRotation}
                  checked={props.settings.wallpaper.rotation.enabled}
                  onChange={(e) => {
                    props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, enabled: e.target.checked });
                  }}
                />
                {STR.general.wallpaperRotation}
              </label>
              <input
                className="ss-input cw-rotation-minutes"
                type="number"
                min={1}
                max={1440}
                aria-label={STR.general.wallpaperRotationMinutes}
                value={props.settings.wallpaper.rotation.everyMinutes}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  if (!Number.isFinite(minutes)) return;
                  props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, everyMinutes: minutes });
                }}
              />
              <span className="ss-static">{STR.general.wallpaperRotationUnit}</span>
              <button
                type="button"
                className="mini-btn"
                data-wallpaper-rotation-add="true"
                disabled={props.settings.wallpaper.path === null}
                onClick={() => {
                  const path = props.settings.wallpaper.path;
                  if (path === null) return;
                  const paths = props.settings.wallpaper.rotation.paths;
                  if (paths.includes(path)) return;
                  props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, paths: [...paths, path].slice(0, 32) });
                }}
              >
                {STR.general.wallpaperRotationAdd}
              </button>
              {/* 轮换依据：用三个按钮（分段控件）——比 select 更好点，也更好判 */}
              <span className="cw-rotation-modes" role="group" aria-label={STR.general.wallpaperRotationMode}>
                {([
                  ["interval", STR.general.wallpaperRotationInterval],
                  ["dayNight", STR.general.wallpaperRotationDayNight],
                  ["weather", STR.general.wallpaperRotationWeather],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`mini-btn cw-rotation-mode${props.settings.wallpaper.rotation.mode === value ? " on" : ""}`}
                    data-rotation-mode={value}
                    aria-pressed={props.settings.wallpaper.rotation.mode === value}
                    onClick={() => props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, mode: value })}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {props.settings.wallpaper.rotation.mode === "weather" && (
                <>
                  <span className="cw-rotation-modes" role="group" aria-label={STR.general.wallpaperWeatherKind}>
                    {([
                      ["clear", STR.general.wallpaperWeatherClear],
                      ["clouds", STR.general.wallpaperWeatherClouds],
                      ["rain", STR.general.wallpaperWeatherRain],
                      ["snow", STR.general.wallpaperWeatherSnow],
                    ] as const).map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className={`mini-btn${props.settings.wallpaper.rotation.weather.kind === kind ? " on" : ""}`}
                        data-weather-kind={kind}
                        aria-pressed={props.settings.wallpaper.rotation.weather.kind === kind}
                        onClick={() => props.onWallpaperRotation({
                          ...props.settings.wallpaper.rotation,
                          weather: { ...props.settings.wallpaper.rotation.weather, kind },
                        })}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <label className="cw-rotation-toggle">
                    <input
                      type="checkbox"
                      aria-label={STR.general.wallpaperWeatherFromFile}
                      data-wallpaper-weather-source="true"
                      checked={props.settings.wallpaper.rotation.weather.source === "file"}
                      onChange={(e) => props.onWallpaperRotation({
                        ...props.settings.wallpaper.rotation,
                        weather: { ...props.settings.wallpaper.rotation.weather, source: e.target.checked ? "file" : "manual" },
                      })}
                    />
                    {STR.general.wallpaperWeatherFromFile}
                  </label>
                  {weatherNow !== null && (
                    <span className="ss-static" data-wallpaper-weather-now="true">
                      {`${STR.general.wallpaperWeatherNow}${weatherNow.kind}（${weatherNow.source}）`}
                    </span>
                  )}
                  {props.settings.wallpaper.rotation.weather.source === "file" && (
                    <input
                      className="ss-input cw-weather-path"
                      aria-label={STR.general.wallpaperWeatherFile}
                      placeholder={STR.general.wallpaperWeatherFile}
                      value={props.settings.wallpaper.rotation.weather.filePath ?? ""}
                      onChange={(e) => props.onWallpaperRotation({
                        ...props.settings.wallpaper.rotation,
                        weather: { ...props.settings.wallpaper.rotation.weather, filePath: e.target.value === "" ? null : e.target.value },
                      })}
                    />
                  )}
                  <button
                    type="button"
                    className="mini-btn"
                    data-wallpaper-weather-set="true"
                    disabled={props.settings.wallpaper.path === null}
                    onClick={() => {
                      const path = props.settings.wallpaper.path;
                      if (path === null) return;
                      const r = props.settings.wallpaper.rotation;
                      props.onWallpaperRotation({ ...r, weather: { ...r.weather, paths: { ...r.weather.paths, [r.weather.kind]: path } } });
                    }}
                  >
                    {STR.general.wallpaperWeatherSet}
                  </button>
                </>
              )}
              <button
                type="button"
                className="mini-btn"
                data-wallpaper-daynight="day"
                onClick={() => {
                  const path = props.settings.wallpaper.path;
                  if (path !== null) props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, dayPath: path });
                }}
              >
                {STR.general.wallpaperRotationSetDay}
              </button>
              <button
                type="button"
                className="mini-btn"
                data-wallpaper-daynight="night"
                onClick={() => {
                  const path = props.settings.wallpaper.path;
                  if (path !== null) props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, nightPath: path });
                }}
              >
                {STR.general.wallpaperRotationSetNight}
              </button>
              <span className="ss-static" data-wallpaper-daynight-count="true">
                {`${STR.general.wallpaperRotationDayNightCount}${String((props.settings.wallpaper.rotation.dayPath === null ? 0 : 1) + (props.settings.wallpaper.rotation.nightPath === null ? 0 : 1))}`}
              </span>
              <span className="ss-static" data-wallpaper-rotation-count="true">
                {`${STR.general.wallpaperRotationCount}${String(props.settings.wallpaper.rotation.paths.length)}`}
              </span>
            </div>
            {/* 多显示器（v77）：每块屏一张；没有专属就回落全局。 */}
            {displays.length > 0 && (
              <div className="cw-displays" data-wallpaper-displays="true">
                {displays.map((d) => (
                  <span key={d.id} className="ss-static" data-display-id={d.id}>
                    {`${STR.general.wallpaperDisplayPrefix} ${d.id} · ${d.source === "display" ? STR.general.wallpaperDisplayOwn : d.source === "fallback" ? STR.general.wallpaperDisplayFallback : STR.general.wallpaperDisplayNone}`}
                  </span>
                ))}
                <button
                  type="button"
                  className="mini-btn"
                  data-wallpaper-display-set="true"
                  disabled={props.settings.wallpaper.path === null}
                  onClick={() => {
                    const first = displays[0];
                    if (first === undefined) return;
                    void window.agent.wallpaperSetForDisplay(first.id).then((r) => {
                      setDisplayNote(r.ok === true ? STR.general.wallpaperDisplaySetOk : (r.error ?? STR.general.wallpaperDisplaySetFailed));
                    });
                  }}
                >
                  {STR.general.wallpaperDisplaySet}
                </button>
                {displayNote !== null && <span className="ss-static" data-wallpaper-display-note="true">{displayNote}</span>}
              </div>
            )}
            {browsing && props.onWallpaperPickPath !== undefined && (
              <WallpaperBrowser onPickPath={props.onWallpaperPickPath} {...(props.initialBrowser === undefined ? {} : { initial: props.initialBrowser })} />
            )}
            <label className="cw-slider">
              <span>{STR.general.wallpaperOpacity}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={props.settings.wallpaper.opacity}
                onChange={(e) => { props.onWallpaperOpacity(Number(e.target.value)); }}
              />
            </label>
            <label className="cw-slider">
              <span>{STR.general.wallpaperScrim}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={props.settings.wallpaper.scrim}
                onChange={(e) => { props.onWallpaperScrim(Number(e.target.value)); }}
              />
            </label>
            <label className="cw-slider">
              <span>{STR.general.wallpaperGlass}</span>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.05}
                value={props.settings.wallpaper.glassAlpha}
                onChange={(e) => { props.onWallpaperGlass(Number(e.target.value)); }}
              />
            </label>
          </div>
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
