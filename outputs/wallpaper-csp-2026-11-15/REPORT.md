# 壁纸 CSP 与设置行 · 真机收口（2026-11-15）

第 1193 页的取证件。上一批（`outputs/wallpaper-layer-2026-11-14/`）留了两格「真渲染层未验证」
（视频暂停、协议 404/416/206），且 CSP 白名单只有源码文本判据。本批把后者关掉，并真机抓出三个缺陷。

## 口径

- 真 Electron **44.9.1 / Chromium 152.0.7977.167**（`/tmp/cairn-electron-launch-probe.cjs` 起过一次）。
- 真构建产物：`pnpm --filter cairn-desktop build` 后的 `dist/index.html`，CSP 是 Vite 插件注入的生产 meta。
- 真协议：scheme 特权登记与 handler 都 `require` 生产模块 `apps/desktop/src/main/wallpaper.ts`
  （经 tsx），不是复刻；主进程 `net.fetch` 真出网。
- 合成面只有 AgentApi：`scripts/ui-gallery-preload.cjs` + `--cairn-wallpaper-fixture=<png>`
  （本批给 preload 加的夹具分支：喂「已选一张图」并记录 `wallpaperPick` 调用次数）。
- 隔离 `userData` profile（mkdtemp，退出自清）；指针是真 `sendInputEvent`（先 `elementFromPoint` 命中测试）。
- 跑法：`pnpm --filter cairn-desktop build && pnpm --filter cairn-desktop exec electron scripts/wallpaper-csp-smoke.cjs outputs/wallpaper-csp-2026-11-15`
  （亦登记为 `pnpm --filter cairn-desktop smoke:wallpaper`，缺省证据落 tmp）。

## 读数（命令 → 结果）

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter cairn-desktop build` | exit 0 |
| `electron scripts/wallpaper-csp-smoke.cjs …` | **23/23 checks passed**（`checks.json`） |
| `pnpm --filter cairn-desktop test` | exit 0；**390 files / 2517 tests**；boundary 绿 |
| 定向 `vitest … wallpaper-contrast csp-build settings-panel strings` | 4 files / 48 tests 绿 |
| `node --import tsx scripts/typecheck.ts` | 0 报错 |
| `pnpm renderer-layer-check` | 绿（244 个渲染层源文件） |
| `pnpm docs-check` | 受检项全绿 |
| `pnpm test:capped`（＝`--maxWorkers=2`） | 见第 1193 页补记 |

## 真机抓出并修掉的三个缺陷

1. **设置整页透明 ⇒ 双层文字。** `wallpaper.css` ① 的让位名单带了 `.sp-page`；它是 `z-index:60`
   的固定覆盖层，底下压着工作台 ⇒ composer 与空态文案整层透在设置行下面（修前截图
   `00-defect-double-text-before-fix.png`）。修：让位名单只留 `.app / .destination-page`；
   修后实测 `.sp-page` 计算底色 `rgb(27, 27, 27)`。判据：`wallpaper-contrast.test.ts`
   「设置整页不在画布让位名单里」＋冒烟同格。
2. **滑杆标签折行、轨道塌回固有宽。** 标签列 `5.5em` 装不下六个汉字（「壁纸不透明度」折两行）；
   `.ss-row` 控件列是 `auto` 轨，`width:100%` 在其中塌回 range 固有宽 **129px**（整行 203px）。
   修：标签列 `6.5em` + `white-space: nowrap`；轨道定宽 **240px**（控件宽度契约 md 档，同
   `.ss-field[data-w=md]`）+ `max-width:100%`。修后实测：列 `78px 240px`、`labelLines:1`、
   三行 top 436/460/485、整行 326px（`readings.json.settingsRow`）。
3. **按钮文案反了。** 已设壁纸时选按钮读状态词「未设置」（`GeneralSection.tsx` 的三元写反）。
   修：动作词恒为「选择图片或视频」；「未设置」只在 `kind==="none"` 时作静态回执（`.ss-static`）。
   冒烟两态都断言（设时：两按钮、无状态词；清除后：状态词出现、清除按钮收起）。

## 反证臂（白名单承重）

把 dist 副本里 `img-src` 的 `cairn-wallpaper:` 摘掉、其余不动 ⇒ 同一张图
`naturalWidth=null`、层被 `onError` 撤掉，且控制台留下 1 条 CSP violation：
`Loading the image 'cairn-wallpaper://media/current?v=0' violates … "img-src 'self' data: blob: https:"`
（`04-negative-control-no-scheme-1440x900.png`、`readings.json.negativeControl`）。
⇒ 「图能加载」不是夹具自证，是白名单在承重。

## 协议真出网（关掉上一批的未验证格之一）

200 + 6843 字节 + `accept-ranges: bytes`；`Range: bytes=0-99` ⇒ 206 + `content-range: bytes 0-99/6843`；
非当前路径 ⇒ 404；越界 Range ⇒ 416（`readings.json.protocol`）。

## 未验证边界（不冒充通过）

- **视频暂停**：本机无 ffmpeg/ffprobe，造不出可解码视频 ⇒ 失焦/不可见暂停仍未真机验证（纯函数
  `shouldPauseMedia` 有单测）。
- **亮色主题**：本冒烟只跑 dark；亮色由对比度模型单测覆盖，未真机截图。
- **真·选文件对话框**：走合成 `wallpaperPick`；系统对话框与主进程落盘路径不在本冒烟面内。

## 工件

`checks.json`（23 格）、`readings.json`、`fixture-wallpaper.png`（Node zlib 生成的对角渐变 PNG）、
`00-defect-double-text-before-fix.png`、`01-wallpaper-on-dark-1440x900.png`、
`02-settings-wallpaper-row-1440x900.png`、`03-wallpaper-cleared-1440x900.png`、
`04-negative-control-no-scheme-1440x900.png`。

覆盖：**工作树**（提交前取证件）；提交号见第 1193 页。