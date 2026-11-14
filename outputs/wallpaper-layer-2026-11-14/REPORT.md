# 壁纸层与玻璃表面 · 验收证据

日期：2026-11-14（Asia/Shanghai）。
规格：`docs/superpowers/specs/2026-11-14-wallpaper-layer-design.md`（提交 `d0376669`）。
计划：`docs/superpowers/plans/2026-11-14-wallpaper-layer.md`（提交 `adf8dac8`，修订 `01d2ba2d`）。

## 一、环境与限制（先说清楚这份证据能证明什么）

本机沙箱**起不来 Electron**（`MachPortRendezvousServer: Permission denied`）⇒ 真渲染层证据走
「静态服务 + 假 AgentApi」这条路：

- 真构建产物 `apps/desktop/dist` 拷到 scratch，注入一份**同源外部文件**的假 AgentApi
  （构建产物的 index.html 带 CSP `script-src 'self'`，内联脚本会被直接挡掉）；
- `cairn-wallpaper://` 是 Electron 主进程注册的私有协议，浏览器里不存在 ⇒ **只把构建产物副本**
  里的协议地址改写成同源 http 路径（仓库源码一字未动）；
- 假 AgentApi 的口径：invoke 通道返回 **Promise**（真桥是 `ipcRenderer.invoke` ⇒ Promise；
  返回裸值会让 `.then` 直接炸）、push 通道返回**退订函数**（真桥的 subscribe 也这样）；
- 测试壁纸 = 纯 Python 生成的 1440×900 对角渐变 PNG（一张图里同时含「亮到文字读不出」与
  「暗到文字读不出」两个极端，正好压玻璃面的最差格）。

**因此本报告能证明的是几何、级联、对比度与回归；不能证明的是 Electron 主进程侧的行为**
（协议注册、Range/206、选文件弹窗）——那几条由单测覆盖（`apps/desktop/tests/wallpaper-media.test.ts`
4 条），在本机无法端到端跑。

## 二、五条判据的实测读数

宿主：Chromium 148（Electron 44 内核）；视口 1280×720（截图按 2× 输出 2560×1440）。

### 判据 1：开壁纸时 body 画布实测为透明

| 元素 | 壁纸开 | 壁纸关（回归对照） |
|---|---|---|
| `body` | `rgba(0, 0, 0, 0)` | `rgb(21, 21, 21)` |
| `.app` | `rgba(0, 0, 0, 0)` | `rgb(27, 27, 27)` |
| `#root` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` |
| `.main` | 玻璃 `color(srgb 0.209241 0.209241 0.209241 / 0.707882)` | `rgb(27, 27, 27)` |
| `.side-wrap` | 同上（玻璃） | `rgba(0, 0, 0, 0)` |
| `.side` | `rgba(0, 0, 0, 0)` | `rgb(17, 17, 17)` |
| `.composer-card` | 同上（玻璃）+ `backdrop-filter: blur(14px)` | `rgb(48, 48, 46)` |

玻璃面五类（对话列 / composer / 检查器与右窗 / 浮层 / 左栏）在实测里全部拿到
`backdrop-filter: blur(14px)` 与地板色 ✓。

### 判据 2：最差格文字对比度

**模型侧（网格最差格，`apps/desktop/tests/wallpaper-contrast.test.ts` 8 条全绿）**：
玻璃 alpha {0,0.15,0.3,0.45,0.6} × 壁纸 alpha {0,0.5,0.9} × 压暗 {0,0.35,1}。

| 主题 | 地板权重 | 网格最差格 | 降 0.01 后 |
|---|---|---|---|
| 亮色 | 45% | 4.618:1 | 4.476（破线） |
| 暗色 | 58% | 4.520:1 | 4.376（破线） |

两主题都 >0 且再降一格即破线 ⇒ 是最小地板（滑杆压不动它）。

**真渲染层实测（采样文字位置处的真实壁纸像素，按真实 scrim/玻璃/地板合成）**：
运行时地板由 DOM 的**真实计算样式**现算（`--cw-floor: 61%`，暗色主题；比模型里的 58% 更保守，
因为真实底色与 vendored 常量有差）。

| 探针 | 壁纸像素 | 合成后表面 | 文字色 | 对比度 |
|---|---|---|---|---|
| 主区标题 | `101,102,103` | `59.0,59.2,59.4` | `240,239,236` | **9.714:1** |
| composer 占位 | `138,138,138` | `66.1,66.1,66.1` | `240,239,236` | **8.732:1** |

验收线 4.5:1 ⇒ 两处都过，且余量很大（地板把最差格抬到了 4.5 以上）。

### 判据 3：失焦即暂停视频

**未在真渲染层验证**（需要真视频文件 + Electron 主进程；本机没有 ffmpeg、沙箱也起不来 Electron）。
已覆盖的部分：暂停判据 `shouldPauseMedia(focused, visible)` 有单测（`tests/wallpaper-view.test.ts`
4 条）；组件的 `blur`/`focus`/`visibilitychange` 监听与 `el.pause()` 调用在 `WallpaperLayer.tsx` 里。
**这条记为未验证，不当作通过。**

### 判据 4：协议拒绝非当前文件

由单测覆盖（`apps/desktop/tests/wallpaper-media.test.ts`）：无当前文件 ⇒ 404；Range 越界 ⇒ 416；
正常 Range ⇒ 206 + `content-range`。浏览器壳里没有 Electron 主进程 ⇒ **未在真渲染层验证**。

### 判据 5：无壁纸时与今天一致

| 项 | 读数 |
|---|---|
| 图层元素 | `document.querySelector(".cw-layer") === null`（组件在 kind=none 时不渲染） |
| 接缝属性 | body 无 `data-we-wallpaper`、html 无 `data-cairn-wallpaper` |
| 表面底色 | 全部回到上表「壁纸关」列（body 21,21,21 / .app 27,27,27 / .side 17,17,17 / composer 48,48,46） |
| backdrop-filter | 全部 `none` |

截图 `screenshots/02-no-wallpaper-regression-2560x1440.png` = 今天的桌面（实体底色），
`screenshots/01-wallpaper-on-dark-2560x1440.png` = 壁纸 + 玻璃。
两条 CSS 规则族全部挂在 `body[data-we-wallpaper]` / `html[data-cairn-wallpaper]` 之下 ⇒ 无壁纸时不可能命中。

## 三、过程中修掉的四个真问题（这一节是本轮最值钱的产出）

### 1. 「最不利壁纸」方向写反了（worker 抓到的）

我原写：`text.r > 128 ⇒ worstWallpaper = 黑`。方向反了：**白字遇白壁纸**才是读不出的那个极端。
写反的后果实测过：暗色主题地板只算到 33%，而按真最差格只有 2.177:1 ⇒ 暗色主题遇白壁纸直接破线。
正确映射（与 derived 的 `DARK_SPEC` 一致）：亮字 ⇒ 白壁纸，暗字 ⇒ 黑壁纸。

### 2. 接缝是「半成品」的第三处：`.app` 自己铺不透明画布

vendored 主题只让出了它自己画的三处；我们自己的画布有三处：
`styles.css` 的 `body`、`tokens.css` 的 `[data-theme=…] .app`、`.side`。
只接管 body 不接管 `.app` ⇒ 壁纸层（z-index:-1）被 `.app` 的不透明底整个盖住 ⇒
「body 透明了、壁纸仍看不见」。这是规格 §4 那张表漏掉的一行。

### 3. CSS 压缩器去重时挑了带前缀那条 ⇒ 玻璃没有模糊

源文件里同时写 `backdrop-filter` 与 `-webkit-backdrop-filter`，压缩后**只剩带前缀那条**；
而 Chromium（Chromium 142/148）**只认标准写法** ⇒ 实测 `backdrop-filter` 计算值 = `none`。
本应用只发布 Electron 壳（不需要为老 Safari 留前缀）⇒ 只写标准写法。
（顺带验证过：`build.cssTarget` / `css.lightningcss.targets` 钉 Chromium 也救不了——根因是去重，
不是目标。改完把那两处配置**回退**了，diff 保持最小。）

### 4. 主题规则的特异性压过玻璃规则

主题那条 `html[data-theme="dark"] body[data-dsh-claude-style] [data-composer-card]` 特异性
(0,3,2) ⇒ 压过我们普通写法 (0,2,1)，composer 的不透明底色就把玻璃盖住了。
仓规不许在 `cds-adapter.css` 之后再插第三个样式 import（`cds-parity` 钉着「adapter 之后只允许
组件层」）⇒ 只能抬权重：加一个我们自己的 html 根属性 `data-cairn-wallpaper`，规则写成
`html[data-theme][data-cairn-wallpaper] body[data-we-wallpaper] :is(...)` ⇒ (0,4,2)，
稳定压过主题那条。两个属性都由 `state/wallpaper.ts` 单点写（幂等、无残值）。

## 四、门禁读数

| 命令 | 结果 |
|---|---|
| `node --import tsx scripts/typecheck.ts` | 通过（0 条报错） |
| `pnpm test:capped`（核心全量） | 见下方「本次提交前最后一次读数」 |
| `pnpm --filter cairn-desktop test` | 同上 |
| `pnpm renderer-layer-check` | 绿 |
| `pnpm desktop-boundary-check` | 绿 |
| `pnpm docs-check` | 绿 |

**宿主条件导致、与本次改动无关的红**（本机沙箱规则，非代码缺陷）：

- `apps/desktop/tests/desktop-review-batch.test.ts`：原生宿主用例要真起 Electron ⇒ 沙箱起不来；
- `apps/desktop/tests/settings-migration.test.ts`（3 条）：要写 `.mcp.json` ⇒ 沙箱拒写该文件名。

## 五、跳过与未验证

- 视频暂停（判据 3）与协议 403/206（判据 4）未在真渲染层验证（原因见 §一）。
- `backdrop-filter` 在大面积上的 GPU 成本未在真机量（本机无 Electron）。
- 启动首帧闪色（规格 §10 的 v1.1 项）未做。
- 遮挡暂停不可靠（Electron 无 occluded 事件）——用 `!isVisible() || !isFocused()` 近似。
