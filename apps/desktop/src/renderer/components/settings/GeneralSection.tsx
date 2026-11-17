// 通用段（外观 / 语言 / 快捷键）——2026-11-11（第 1066 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 2026-11-12（第 1075 页）：裸中文收编进 STR.general（值一字不改；本文件同时进 strings.test 的 REWORKED_FILES）。
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../../src/main/settings";
import { useEffect, useState } from "react";
import { STR } from "../../strings";
import { applyRadioNavigation } from "../../radio-nav";
import { wallpaperUrl } from "../../state/wallpaper";
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
/** 玻璃强度三档（2026-11-17 玻璃质感打磨）：连续滑杆改离散三档，模糊半径随档联动
 *  （state/wallpaper.ts 的 glassBlurPx：轻 8 / 中 14 / 重 22）。阈值与 glassBlurPx 逐字对齐。 */
const GLASS_TIERS: readonly { id: "mild" | "mid" | "strong"; value: number; label: string }[] = [
  { id: "mild", value: 0.12, label: STR.general.wallpaperGlassMild },
  { id: "mid", value: 0.25, label: STR.general.wallpaperGlassMid },
  { id: "strong", value: 0.45, label: STR.general.wallpaperGlassStrong },
];
function glassTierOf(glassAlpha: number): "mild" | "mid" | "strong" {
  return glassAlpha <= 0.16 ? "mild" : glassAlpha <= 0.3 ? "mid" : "strong";
}

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
  /** 网站壁纸（2026-11-16）：把 https 地址交给上层写设置（kind=web）。 */
  onWallpaperSetWeb?: (url: string) => void;
  /** 多显示器（v77）：判卷缝——直接给解析结果（生产走 wallpaperDisplays）。 */
  initialDisplays?: { id: string; source: string; path?: string }[];
}): React.JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const [displays, setDisplays] = useState<{ id: string; source: string; path?: string }[]>(props.initialDisplays ?? []);
  const [displayNote, setDisplayNote] = useState<string | null>(null);
  // v78：文件源时把「解析出来的天气」显示出来（面板不只让你填路径，还告诉你读到了什么）。
  const [weatherNow, setWeatherNow] = useState<{ kind: string; source: string } | null>(null);
  const [weatherKey, setWeatherKey] = useState("");
  const [webUrl, setWebUrl] = useState("");
  // 壁纸滑杆草稿（2026-11-17）：拖动过程只改本地预览，松手/失焦/键盘松键才落盘——此前
  // onChange 每个事件都走一次 setSettings IPC 并重置右下「已保存 ✓」闪条，拖一格连写 N 次盘。
  const [sliderDraft, setSliderDraft] = useState<{ opacity: number; scrim: number; glassAlpha: number } | null>(null);

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
                tabIndex={props.settings.theme === t.id ? 0 : -1}
                className={"theme-opt" + (props.settings.theme === t.id ? " on" : "")}
                onClick={() => props.onSave({ theme: t.id })}
                onKeyDown={(e) => {
                  const current = THEME_OPTIONS.findIndex((o) => o.id === props.settings.theme);
                  applyRadioNavigation(e, current, THEME_OPTIONS.length, (index) => {
                    const target = THEME_OPTIONS[index];
                    if (target !== undefined) props.onSave({ theme: target.id });
                  });
                }}
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
                tabIndex={props.textSize === t.id ? 0 : -1}
                className={"theme-opt" + (props.textSize === t.id ? " on" : "")}
                onClick={() => props.onTextSize(t.id)}
                onKeyDown={(e) => {
                  const current = TEXT_SIZE_OPTIONS.findIndex((o) => o.id === props.textSize);
                  applyRadioNavigation(e, current, TEXT_SIZE_OPTIONS.length, (index) => {
                    const target = TEXT_SIZE_OPTIONS[index];
                    if (target !== undefined) props.onTextSize(target.id);
                  });
                }}
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
                tabIndex={props.uiSize === t.id ? 0 : -1}
                className={"theme-opt" + (props.uiSize === t.id ? " on" : "")}
                onClick={() => props.onUiSize(t.id)}
                onKeyDown={(e) => {
                  const current = UI_SIZE_OPTIONS.findIndex((o) => o.id === props.uiSize);
                  applyRadioNavigation(e, current, UI_SIZE_OPTIONS.length, (index) => {
                    const target = UI_SIZE_OPTIONS[index];
                    if (target !== undefined) props.onUiSize(target.id);
                  });
                }}
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
      {/* 壁纸自成一段：它有一套自己的决定（来源 / 网站 / 轮换 / 多屏 / 显示），
          挂在「外观」段尾会让一整段读成外观的第六条。 */}
      <SettingsSection title={STR.general.wallpaper}>
        {/* 壁纸（2026-11-16 重构）：此前选图、网站、轮换（含天气）、多屏与三个滑杆**全塞在一条**
            SettingsRow 的控件列里——真机截图里就是一条从右往左堆的控件带，而「壁纸」这个标签
            孤零零悬在左边。现在按「一次决定一行」拆开：标签说是哪件事，控件自己说怎么做；
            轮换依据 / 天气 / 昼夜这类从属行只在相关时出现。 */}
        <SettingsRow label={STR.general.wallpaperCurrent}>
          <div className="cw-settings">
            {/* 2026-11-17（玻璃质感打磨）：效果预览小样——壁纸缩略 + 一块真实地板公式的迷你玻璃卡，
                不用先应用就能看见「这张图 + 这档玻璃」长什么样。 */}
            {props.settings.wallpaper.kind !== "none" && (
              <div className="cw-preview" role="img" aria-label={STR.general.wallpaperPreview} data-wallpaper-preview="true">
                {props.settings.wallpaper.kind === "image"
                  ? <img className="cw-preview-media" src={wallpaperUrl(props.settings.wallpaper.revision)} alt="" aria-hidden="true" />
                  : <span className="cw-preview-media cw-preview-web" aria-hidden="true">{props.settings.wallpaper.kind === "web" ? STR.general.wallpaperPreviewWeb : STR.general.wallpaperUnavailable}</span>}
                <span className="cw-preview-glass" aria-hidden="true" />
              </div>
            )}
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
            {browsing && props.onWallpaperPickPath !== undefined && (
              <WallpaperBrowser onPickPath={props.onWallpaperPickPath} {...(props.initialBrowser === undefined ? {} : { initial: props.initialBrowser })} />
            )}
          </div>
        </SettingsRow>
        {/* 网站壁纸（2026-11-16 业主批「准放 CSP」）：只收 https；页面在 iframe 里带 sandbox 隔离。
            这句是安全边界（C 档），改成行的说明位——常驻、可读，不挤在控件旁边抢宽度。 */}
        {props.onWallpaperSetWeb !== undefined && (
          <SettingsRow label={STR.general.wallpaperWeb} desc={STR.general.wallpaperWebHint}>
            <div className="cw-web-row" data-wallpaper-web-row="true">
              <input
                className="ss-input cw-web-url"
                aria-label={STR.general.wallpaperWebUrl}
                placeholder={STR.general.wallpaperWebUrl}
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
              />
              <button
                type="button"
                className="mini-btn"
                data-wallpaper-web-apply="true"
                onClick={() => props.onWallpaperSetWeb?.(webUrl)}
              >
                {STR.general.wallpaperWebApply}
              </button>
            </div>
          </SettingsRow>
        )}
        {/* 定时轮换（2026-11-16）：到点换下一张；候选少于两张时按纯函数口径不轮换。 */}
        <SettingsRow label={STR.general.wallpaperRotation}>
          <div className="cw-rotation" data-wallpaper-rotation="true">
            {/* 2026-11-17（批6）：原生 checkbox 换成 Switch——同一页所有开关都是 Switch（role=switch + 状态字），
                唯独轮换是原生勾选框，控件家族不一致（审计第 6 条）。 */}
            <span className="cw-rotation-toggle">
              <Switch
                checked={props.settings.wallpaper.rotation.enabled}
                onChange={(next) => {
                  props.onWallpaperRotation({ ...props.settings.wallpaper.rotation, enabled: next });
                }}
                label={STR.general.wallpaperRotation}
              />
            </span>
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
            <span className="ss-static" data-wallpaper-rotation-count="true">
              {`${STR.general.wallpaperRotationCount}${String(props.settings.wallpaper.rotation.paths.length)}`}
            </span>
          </div>
        </SettingsRow>
        {/* 轮换依据：用三个按钮（分段控件）——比 select 更好点，也更好判 */}
        <SettingsRow label={STR.general.wallpaperRotationMode}>
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
        </SettingsRow>
        {props.settings.wallpaper.rotation.mode === "dayNight" && (
          <SettingsRow label={STR.general.wallpaperDayNight}>
            <div className="cw-rotation">
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
            </div>
          </SettingsRow>
        )}
        {props.settings.wallpaper.rotation.mode === "weather" && (
          <SettingsRow label={STR.general.wallpaperWeather}>
            <div className="cw-rotation">
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
              <span className="cw-rotation-modes" role="group" aria-label={STR.general.wallpaperWeatherSource}>
                {([
                  ["manual", STR.general.wallpaperWeatherSourceManual],
                  ["file", STR.general.wallpaperWeatherFromFile],
                  ["http", STR.general.wallpaperWeatherSourceHttp],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`mini-btn${props.settings.wallpaper.rotation.weather.source === value ? " on" : ""}`}
                    data-weather-source={value}
                    aria-pressed={props.settings.wallpaper.rotation.weather.source === value}
                    onClick={() => props.onWallpaperRotation({
                      ...props.settings.wallpaper.rotation,
                      weather: { ...props.settings.wallpaper.rotation.weather, source: value },
                    })}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {props.settings.wallpaper.rotation.weather.source === "http" && (
                <>
                  <input
                    className="ss-input cw-weather-url"
                    aria-label={STR.general.wallpaperWeatherUrl}
                    placeholder={STR.general.wallpaperWeatherUrl}
                    value={props.settings.wallpaper.rotation.weather.httpUrl ?? ""}
                    onChange={(e) => props.onWallpaperRotation({
                      ...props.settings.wallpaper.rotation,
                      weather: { ...props.settings.wallpaper.rotation.weather, httpUrl: e.target.value === "" ? null : e.target.value },
                    })}
                  />
                  <input
                    className="ss-input cw-weather-key"
                    type="password"
                    aria-label={STR.general.wallpaperWeatherKey}
                    placeholder={STR.general.wallpaperWeatherKey}
                    value={weatherKey}
                    onChange={(e) => setWeatherKey(e.target.value)}
                    onBlur={() => {
                      // 2026-11-17（批6）：失焦即落钥匙串——此前只有点「测试连接」才写，填完不点就丢（审计第 10 条）。
                      if (weatherKey !== "") void window.agent.wallpaperWeatherSetKey(weatherKey);
                    }}
                  />
                  <button
                    type="button"
                    className="mini-btn"
                    data-wallpaper-weather-test="true"
                    onClick={() => {
                      void (async () => {
                        if (weatherKey !== "") await window.agent.wallpaperWeatherSetKey(weatherKey);
                        const r = await window.agent.wallpaperWeatherFetch();
                        setWeatherNow(r.kind === undefined || r.kind === null
                          ? { kind: STR.general.wallpaperWeatherFailed, source: r.reason ?? "" }
                          : { kind: r.kind, source: "http" });
                      })();
                    }}
                  >
                    {STR.general.wallpaperWeatherTest}
                  </button>
                </>
              )}
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
            </div>
          </SettingsRow>
        )}
        {/* 多显示器（v77）：每块屏一张；没有专属就回落全局。 */}
        {displays.length > 0 && (
          <SettingsRow label={STR.general.wallpaperDisplay}>
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
          </SettingsRow>
        )}
        {/* 三个滑杆是同一件事（壁纸怎么压）⇒ 一行三档，各自带标签；不拆成三条重复的「壁纸」行。
            落盘走松手（onPointerUp / onKeyUp / onBlur），拖动中只动本地草稿 + 数值回显。 */}
        <SettingsRow label={STR.general.wallpaperBlock}>
          <div className="cw-settings">
            {(() => {
              const wp = sliderDraft ?? {
                opacity: props.settings.wallpaper.opacity,
                scrim: props.settings.wallpaper.scrim,
                glassAlpha: props.settings.wallpaper.glassAlpha,
              };
              const pct = (v: number): string => `${String(Math.round(v * 100))}%`;
              const commit = (): void => {
                if (sliderDraft === null) return;
                props.onWallpaperOpacity(sliderDraft.opacity);
                props.onWallpaperScrim(sliderDraft.scrim);
                props.onWallpaperGlass(sliderDraft.glassAlpha);
                setSliderDraft(null);
              };
              return (
                <>
                  <label className="cw-slider">
                    <span>{STR.general.wallpaperOpacity}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={wp.opacity}
                      onChange={(e) => { setSliderDraft({ ...wp, opacity: Number(e.target.value) }); }}
                      onPointerUp={commit}
                      onKeyUp={commit}
                      onBlur={commit}
                    />
                    <span className="cw-slider-value">{pct(wp.opacity)}</span>
                  </label>
                  <label className="cw-slider">
                    <span>{STR.general.wallpaperScrim}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={wp.scrim}
                      onChange={(e) => { setSliderDraft({ ...wp, scrim: Number(e.target.value) }); }}
                      onPointerUp={commit}
                      onKeyUp={commit}
                      onBlur={commit}
                    />
                    <span className="cw-slider-value">{pct(wp.scrim)}</span>
                  </label>
                  <div className="cw-slider cw-glass-tier-row">
                    <span>{STR.general.wallpaperGlass}</span>
                    <div className="cw-glass-tiers" role="group" aria-label={STR.general.wallpaperGlass} data-glass-tiers="true">
                      {GLASS_TIERS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={"mini-btn" + (glassTierOf(wp.glassAlpha) === t.id ? " on" : "")}
                          aria-pressed={glassTierOf(wp.glassAlpha) === t.id}
                          data-glass-tier={t.id}
                          onClick={() => { props.onWallpaperGlass(t.value); }}
                        >{t.label}</button>
                      ))}
                    </div>
                    <span className="cw-slider-value">{pct(wp.glassAlpha)}</span>
                  </div>
                </>
              );
            })()}
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
