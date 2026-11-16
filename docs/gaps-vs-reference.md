# 我们**没有**的能力（对照参照产品，逐条列清）

写这份东西的理由很直接：只报「我们做了什么」，永远能得出「行业最高」。
所以把**不做的、做不到的、没做的**也列出来，每条写清「参照产品是否支持」和「依据等级」。

依据等级只有三种，不混用：

- **已见**：本轮真的读到过原文（引用来源）；
- **未证实**：听说过但没读到原文 —— 不打勾也不打叉；
- **不适用**：与产品定位无关。

| 能力 | 参照产品 | 参照是否支持 | 依据等级 | 我们的状态 | 依据 |
|---|---|---|---|---|---|
| 网站作为壁纸（渲染网页并常驻） | Plash（`github.com/sindresorhus/Plash`，标语「Make any website your Mac desktop wallpaper」） | 支持 | 已见 | **不做** | 本仓无 webview 壁纸实现；`wallpaper.kind` 只有 `image` / `video`（`apps/desktop/src/main/wallpaper.ts`） |
| 多显示器分别设不同壁纸 | 系统级能力（macOS 设置） | 支持 | 未证实 | **已做**（2026-11-16；单屏机器上验证 1 屏路径，多屏真机未验） | `settings.wallpaper.perDisplay` + `src/wallpaper/displays.ts`（专属 > 回落 > 无、孤儿只报告）+ 冒烟用真 `screen.getAllDisplays()` 判屏数与 id |
| 定时切换（按固定间隔轮换） | Plash 等桌面壁纸类产品 | 未知 | 未证实 | **已做**（2026-11-16） | 设置里「定时轮换」+ 主进程每 30s 判定：`src/wallpaper/rotation.ts`、`apps/desktop/src/main/wallpaper-rotation.ts`、`tests/wallpaper-rotation.test.ts` |
| 日出日落切换（按经纬度 + 日期算昼/夜） | 同类产品 | 未知 | 未证实 | **已做**（2026-11-16，近似解） | `src/wallpaper/solar.ts`（±5 分钟量级）+ `decideDayNight`；`tests/wallpaper-solar.test.ts`（北京夏至日出差 ≤12 分钟、极昼/极夜不给假时间） |
| 按天气切换（手动档：晴/云/雨/雪各一张） | 同类产品 | 未知 | 未证实 | **已做**（2026-11-16，手动档） | `src/wallpaper/weather.ts` + `tests/wallpaper-weather.test.ts`；冒烟：切按天气 + 选雨 + 设为该天气 ⇒ `weather.paths.rain` 落设置 |
| 自动天气源（外部喂数据，不联网） | 同类产品 | 支持 | 未证实 | **已做**（2026-11-16，文件源） | `weatherFromText` + `resolveWeatherKind`：读 `{"kind":"rain"}` 或 `{"code":500}`；冒烟判「code 500 ⇒ rain」 |
| 联网天气源（HTTP + key，默认关） | 同类产品 | 支持 | 未证实 | **已做**（2026-11-16，**默认关**，需填 URL） | `apps/desktop/src/main/weather-http.ts`（3s 超时、只 GET、key 只走请求头）+ `weather-key.ts`（钥匙串加密，不落明文）；判据用本机 HTTP 服务 |
| 三维场景壁纸 | Wallpaper Engine（Windows） | 支持 | 未证实 | **明确不做** | 对表 `wallpaper.scene-engine` 记 `out` 并写理由 |
| 原生面板里「点中一个文件」的自动化验收 | — | — | 不适用 | **判不到** | 本机 TCC 拦键盘自动化（`frontmost=false`、AX `-1719`）；见 `docs/native-pick-acceptance.md` |

## 这份表怎么用

- 「已见」才写「参照支持」；其余写「未知/未证实」——**不拿印象当证据**；
- 每当我们把一条从「不做/未做」变成做完，就来这里把状态与依据一起改；
- 判据：`tests/gaps-vs-reference.test.ts` 钉住「每条都要有状态与依据」、且 **behind/未做 至少 3 条**
  ——防止这份表被悄悄删空。
