# Claude Desktop v3.1623.0 设计系统复核（2026-10-21）

> 上一轮实证是 2026-10-20 针对 **v2.42304.2**（app.asar 56,088,935 B，sha `2b0ebaec…`）。
> 本轮发现 `/Applications/Claude.app` 已升级到 **v3.1623.0**，asar 被重写。本文只记录本轮重新取到的读数，
> 不把上一轮的结论当现值；两版都量过的项标「同」，只在新版出现的项标「新增」。

## 0. 证据链

| 线 | 工具 | 读数 |
|---|---|---|
| ① REA Electron fuses | `inspect_electron_fuses`，evidence `ev_9f7016dc…` | RunAsNode / NodeCliInspectArguments **disabled**；EmbeddedAsarIntegrityValidation / OnlyLoadAppFromAsar / GrantFileProtocolExtraPrivileges / WasmTrapHandlers **enabled** |
| ② REA ASAR 清单 | `inspect_artifact`（`integrity_policy=record-and-continue`），evidence `ev_8a965bda…`（父 `ev_79a6173e…`） | **575 nodes / 601 occurrences / 600 edges**；文件 554 / 目录 47；**8 条 integrity contradiction**（均为 unpacked 原生二进制签名剥离）；`source_complete=true` |
| ③ 编译产物 CSS | 直接解 asar 头 + 提取 `.vite/renderer/main_window/assets/MainWindowPage-Bbug2Ph5.css` | **233,932 B**；**956 个 `--cds-*` 名**，其中 **904 个有定义**；52 个只被 `var()` 引用未在本文件定义 |
| ④ 字体资产 | `Resources/fonts/` 清单 | 4 个可变字体：`AnthropicSerif-Romans/Italics`、`AnthropicSans-Romans/Italics`（25x258），另有 `Anthropicons-Variable` 图标字体 |

**结构面（如实登记）**：全量 `analyze_javascript_application` 在 240s 预算内超时。逐文件缩小后：
- `index.pre.js`（943,349 B）：247,274 AST 节点 / 176 findings，`browser_windows=0`、`ipc.operations=0`、
  `context_bridge_apis=0`（evidence `ev_c46549e8…`）。
- `index.chunk-BLvpT1n4.js`（7,047,286 B）：REA 自有 worker **堆耗尽**，0 个语义节点（evidence `ev_99f1f18c…`）。
- `index.chunk-Cses962f.js`（2,223,943 B）：544,131 AST 节点 / 393 findings，但语义图超出父结果预算；
  `browser_windows=0`、`ipc.operations=0`、`sender_validation_observations=56`（evidence `ev_f7ca05c7…`）。

结论：**当前 REA 的 1 GiB worker 预算 + 结果预算读不动 v3 的主进程图**。因此本文不引用 REA 语义图口径的
「模块数 / contextBridge 成员数」；IPC 通道数改用**静态文本提取**补：v3 **1438 条 / 14 命名空间**，
与 v2 的 1327 条按 `Controller+method` 比对为 **97 新增 / 0 删除**（见 §3.3 与 `CHANNELS-DELTA.md`）。
下一轮要么按 Webpack 模块边界切文件再喂 REA，要么在隔离实例上用 CDP/Inspector 做运行时观测。

## 1. 版本差（这是本轮最先要记住的事实）

| 项 | v2.42304.2（2026-10-20 报告） | v3.1623.0（本轮） |
|---|---|---|
| CFBundleShortVersionString | 2.42304.2 | **3.1623.0** |
| app.asar 字节 | 56,088,935 | **50,725,286（−9.6%）** |
| app.asar sha256 | `2b0ebaec…` | **`760e7cbb6f861f0bc0e71e71fd9c6b721ba735f0f638b6ea623645daff4261a7`** |
| asar 文件清单 | 511 文件 | **553 文件**（+42） |
| 主窗口 CSS | 上一轮抽取 30 个 css/html | **MainWindowPage CSS 233,932 B** |
| 主窗口 CSS 的 `--cds-*` 名 | 上一轮文档记录 364 个 | **956 个名 / 904 个定义** |

结论只有一句：**上一轮的设计令牌文档不能当现值用**。名称集合已经翻倍，新增的不只是颜色，还有整套图表、
编辑器、骨架屏与滚动渐隐令牌。

## 2. 颜色系统：从「gray + 少量族」扩到 10 族 × 35 阶

`tokens-v3.json` 是全量机器可读值（904 条）。按族统计（每族 0–900，35 阶，含 810/820/830/840/850/860/870/880/890 暗部细阶）：

| 族 | 阶数 | 说明 |
|---|---:|---|
| gray / neutral | 35 / 35 | 同上一版；neutral 仍是暗色翻转轴（不动点 450） |
| blue / red / green / yellow | 35 / 35 / 35 / 35 | 上一轮文档只记录了 blue 全阶与 yellow 少量 |
| orange | 35 | **新增完整族**（此前只有品牌橙单值） |
| violet | 35 | **新增完整族** |
| magenta | 35 | **新增完整族** |
| aqua | 35 | **新增完整族** |

品牌色未变：

```css
--cds-clay: #d97757;            /* 与 Cairn --accent-brand 同值 */
--cds-clay-emphasized: #c6613f;
--cds-fill-brand: var(--cds-clay-emphasized);
--cds-fill-brand-hover: var(--cds-clay);
```

语义/表面（与上一版一致的部分）：

| 令牌 | 亮 | 暗 |
|---|---|---|
| `--cds-surface-0` | gray-20 `#f9f9f7` | gray-900 `#0b0b0b` |
| `--cds-surface-1` | gray-10 `#fcfcfb` | gray-850 `#151515` |
| `--cds-surface-2` | gray-0 `#ffffff` | gray-830 `#1a1a19` |
| `--cds-surface-3` | gray-0 `#ffffff` | gray-800 `#20201f` |
| `--cds-page-bg` | `surface-0` | `surface-0` |
| `--cds-surface-popover` | `surface-3` | `surface-3` |

角色层仍是 5 角色 + tooltip，映射未变：accent→blue、danger→red、pro→violet、success→green、warning→yellow、
tooltip→gray-900。`--cds-role-success-on` / `warning-on` 用 gray-900，其余 on 用 gray-0。

**v3 新发现的一条语义**：

```css
--cds-bg-user-message: var(--cds-bg-neutral);          /* = --cds-alpha-1 */
--cds-bg-user-message-personal: var(--cds-bg-tint-blue);
```

用户气泡在 v3 是**中性透明层**（叠在 surface 上），不是固定实色；个人版另有蓝色 tint 变体。
Cairn 的 `--user-bubble-bg` 现在是实色 `--bg-300`，但运行期又被 `dsh-claude-style` 的
`--dsw-specific-bubble`（亮 `#f0f0ef` / 暗 `rgba(255,255,255,.06)`）覆盖——效果同族，故本轮**没有改**。
如果以后要脱离主题包自绘气泡，应照这条 alpha 语义，而不是再写一个实色。

## 3. 新增令牌组（只在 v3 出现）

| 组 | 定义数 | 代表值 / 用途 |
|---|---:|---|
| `--cds-chart-*` | 32 | 分类 8 色、顺序 blue→orange→aqua→yellow→magenta→green→violet→red；另有 sequential/diverging/status/axis/grid/muted |
| `--cds-editor-*` | 6 | 协作者颜色：violet-450 / magenta-450 / aqua-500 / green-500 / yellow-500 / gray-500 |
| `--cds-slider-*` | 6 | track `alpha-2`、fill `alpha-3`、handle gray-0、stop dot 25% |
| `--cds-segmented-*` | 3 | thumb `surface-popover`、track `alpha-1` |
| `--cds-skeleton-*` | 4 | base / sheen 都是 `alpha-1` |
| `--cds-shimmer-*` | 6 | 文本 shimmer 的 keyframes/peak/plateau（可由宿主覆盖） |
| `--cds-scroll-*` | 17 | 滚动渐隐：`fade-size: 28px`、四边 on/raw 变量、`strip-active` |
| `--cds-undimmed-*` | 4 | 弹层下不被压暗的文字（primary/secondary/muted/stays-secondary） |
| `--cds-z-*` | 5 | coachmark 35 / modal 40 / popover & tooltip 50 / toast 60 |
| `--cds-checkbox-*` | 14 | 尺寸与 glyph 分档（旧版只有少量） |
| `--cds-border-*` | 13 | 新增 git / editor / strong 系列语义 |

图表分类色（本轮已接进 Cairn，见 §5）：

```css
--cds-chart-categorical-1: var(--cds-blue-450);    /* #2a78d6 */
--cds-chart-categorical-2: var(--cds-orange-350);  /* #eb6834 */
--cds-chart-categorical-3: var(--cds-aqua-350);    /* #1baf7a */
--cds-chart-categorical-4: var(--cds-yellow-250);  /* #eda100 */
--cds-chart-categorical-5: var(--cds-magenta-300); /* #e87ba4 */
--cds-chart-categorical-6: var(--cds-green-500);   /* #008300 */
--cds-chart-categorical-7: var(--cds-violet-500);  /* #6250d6 */
--cds-chart-categorical-8: var(--cds-red-400);     /* #e34948 */
--cds-chart-axis: var(--cds-gray-200);
--cds-chart-grid: var(--cds-alpha-2);
--cds-chart-muted: var(--cds-gray-200);
```

### 3.1 壳层组件常量（v3 实测，全部带 `calc(... * var(--cds-rem-scale,1))`）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--cds-panel-radius` | `.625rem`（10px） | 面板圆角 |
| `--cds-panel-inset` / `--cds-panel-gap` | `.5rem`（8px） | 面板内缩 / 面板间距 |
| `--cds-panel-shadow` | `0 0 0 1px var(--cds-border), var(--cds-shadow-sm)` | 面板描边 + 轻阴影 |
| `--cds-avatar-xs/sm/md/lg` | `1 / 1.25 / 1.75 / 2.25rem`（16/20/28/36px） | 头像四档 |
| `--cds-btn-press-sx/sy` | `.975` | 主按钮按下缩放 |
| `--cds-card-press-sx/sy` | `.99` | 卡片按下缩放 |
| `--cds-switch-track` / hover | `alpha-3` / `alpha-4` | 开关轨道 |
| `--cds-switch-knob` | `gray-0` | 开关圆点 |
| `--cds-tooltip-bg` / `fg` | `gray-900` / `text-primary` | 提示气泡 |
| `--cds-toolbar-pad-block` | `.25rem`（4px） | 工具条纵向内边距 |
| `--cds-radius-composer` | `.75rem`（12px） | 输入卡独立圆角；v2 记录是 `.875rem`（14px），**v3 缩了 2px** |

这些是**本地壳**的常量；聊天正文、消息气泡、侧栏行等交互组件在远端 claude.ai，asar 里没有对应类名，
所以不能从这份 CSS 推出它们的 v3 像素值。

### 3.2 v3 运行时特性面（helper 进程 `--desktop-features` 实测）

隔离 profile 启动 v3.1623.0 后，从 `Claude Helper` 的 argv 里取到完整特性表，共 **135 项**：
**77 supported / 51 unavailable / 7 unsupported**（机器可读：`desktop-features-v3.json`）。

| 状态 | 与桌面设计/交互直接相关的项 |
|---|---|
| supported | `desktopTopBar`、**`claudeDesignWindow`**、`bootPlaceholder`、`tearOffHalo`、`coworkArtifactPopout`、`sidePanePopoutNativeViews`、`simulatorNativeViewPopout`、`popoutZoom`、`filePreviewNativeViewRouting`、`sessionMentions`、`inlinePastes`、`turnBoxAtReplies`、`sessionFolderFileAccess`、`conversationFolderGrants` |
| unavailable | `artifactsPane`、`desktopHome`、`chatTab`、`sideSessions`、`btwChildSessions`、`coworkArtifacts`、`multiAccount`、`framebufferPreview`、`simulatorMiniView` |
| unsupported | `coworkBrowser`、`computerUseAppScoped`、`iosSimulator`、`androidEmulator`、`popoutTitleBarOverlay` |

读法（只当状态表，不当行为承诺）：`supported` 只表示该构建声明支持这条特性，不代表当前账号/环境下已开放；
`unavailable` 往往是账号、地区或运行时条件不满足；`unsupported` 是构建层面没有实现。**`claudeDesignWindow`
出现在 supported 里**，说明 v3 有一条我们上一轮完全没有记录的设计窗口能力；本轮没有找到它的入口或窗口，
所以只登记存在，不描述行为。

### 3.3 IPC 通道面（v3 静态提取，不是 REA 语义图）

`extract-channels.mjs` 扫描 477 个 JS / 40,951,039 B，恢复 **1438 条 `$eipc_message$` 通道 / 14 个命名空间**；
上一轮 v2 清单是 1327 条 / 15 个命名空间。按 `Controller+method` 去重后：

| 项 | v2 | v3 |
|---|---:|---:|
| 通道条数 | 1327 | **1438（+111）** |
| 命名空间 | 15 | **14** |
| 新增 Controller+method | — | **97** |
| 删除 Controller+method | — | **0** |

新增的 97 条里 **48 条是 `_$store$_getState/update` 状态对**，其余 49 条才是新能力。最值得注意的：
`CoworkArtifactBridge_*`（6）、`CoworkFilePreview_*`（3）、`Launch_serveRemoteBrowserSession` 等（4）、
`LimitAutoResume_*`（4）、`WindowVibrancy_*`（4）、`LocalPlugins_*`（2）、
`WindowControl_reportBootPlaceholderColors`、`MainWindowTitleBar_requestOrganizationSignIn`。
完整清单、分组与局限见 **`CHANNELS-DELTA.md`**，原始数据见 `channels-v2.txt` / `channels-v3.txt` /
`channels-delta.txt`。

## 4. 与 Cairn 现状的对照

| 项 | Cairn 现值 | 本轮判断 |
|---|---|---|
| 三层令牌（色阶→role→语义） | 已有 role 层（`tokens.css` ①.5） | 同，不需重做 |
| 5 级尺寸轴（data-ui-size 1–5） | 已有 | 同 |
| 焦点环三层 | 已有 | 同 |
| 5 档时长 × 4 缓动 | 已有 | 同 |
| 品牌 clay | `--accent-brand` = `15 63.1% 59.6%`（#d97757） | 同 |
| 暗色 surface 方向 | 越抬升越亮，`bg-100` #151515 | 同 |
| 输入卡圆角 | composer 实际渲染 12px | v3 实测 12px；**已落地**（§5.12，含 vendored skin 18px 覆盖） |
| 弹层圆角 | 菜单与设置卡实际 10px | v3 `--cds-panel-radius` 10px；**已落地**（§5.13） |
| 图表分类色 | **本轮新增 `--chart-1…8`** | v3 有、Cairn 此前没有 |
| 骨架屏 / shimmer / 滚动渐隐 | 未实现 | **不抄**：Cairn 现有加载态用文字与 aria-live，先不引入装饰性动画 |
| 自研字体 | 不抄（无授权） | 维持；继续 Inter/Noto Serif 近似 |
| 10 族 × 35 阶色阶 | 只有用到的语义值 | **不建空转层**（本仓 2026-10-20 已因「零消费方」删过一次 gray 阶） |

## 5. 本轮落地的代码

1. **`apps/desktop/src/renderer/tokens.css:179`** 新增 `--chart-1…8` 与 `--chart-axis/grid/muted`；
   值按本仓存储纪律写成 HSL 三元组，注释逐条回指 Claude v3 色族名。
2. **`apps/desktop/src/renderer/components/UsagePanel.tsx:40`** 新增 `Composition`：
   **只画输入 / 输出两段**（`cacheReadTokens` 在 Anthropic 是独立计数、在 OpenAI 已含在 `prompt_tokens` 里，
   并进分母会重复计数，所以缓存只作独立读数附注）+ 文字图例；零总量不画条；
   `role="img"` 的 aria-label 报两段百分比。
   `UsagePanel.tsx` 本身是工作树未跟踪文件（批 131），本轮是在它上面叠加，不声称它是本轮新建。
3. **`apps/desktop/src/renderer/styles.css:2299`** 新增加载条与图例样式（消费 `--chart-*`，无硬编码颜色）。
4. **`apps/desktop/src/renderer/strings.ts:188`** 增 `usageCacheShort` 与 `usageComposition` 两条文案。
5. **`apps/desktop/tests/usage-composition.test.tsx`（新文件，7 用例）**：
   两段分母、宽度、aria-label、缓存独立附注、零总量不画条、缓存>输入的 Anthropic 口径、
   非零但四舍五入到 0% 的输出写 `<0.1%`、全部会话口径、8 个 chart 令牌的形状与前三位色序。
6. **启动占位（2026-10-21）**：`apps/desktop/src/renderer/index.html` 在 CSS/React 之前内联
   clay 标记 + 进度线 + `role="status"` 的「正在启动…」，`#root:not(:empty) + #boot` 淡出；
   `apps/desktop/src/main/index.ts` 的主窗口与窗格弹窗都加 `backgroundColor`（surface-1
   `#fcfcfb` / `#151515`）。主题真相是 `settings.json` 的 `theme`：启动时同步 `nativeTheme.themeSource`，
   切换主题时也同步，所以 `backgroundColor` 与 `index.html` 的 `prefers-color-scheme` 用同一判据，
   「系统暗、应用亮」不会先闪暗底。纯函数在 `apps/desktop/src/main/boot-theme.ts`，判卷
   `boot-placeholder.test.ts` 3 条 + `boot-theme.test.ts` 4 条。截图：`boot-placeholder-dark.png` /
   `boot-placeholder-light.png`（JS 关闭，仅 HTML+CSS 渲染）。
   注：v3 走的是 `WindowControl_reportBootPlaceholderColors`（renderer 上报）；Cairn 用 settings.json
   直接同步 `nativeTheme`，少一条 IPC，首帧效果相同。
7. **用量失败空串**：全部会话统计失败且 `error` 为空时补「未知原因」，不再只剩「统计失败：」；
   `usage-panel.test.tsx` 第 4 条扩展断言。
8. **按钮按压缩放**：新增 `--press-btn: 0.975`（v3 `btn-press-sx/sy`），`.btn:active` 与
   `.send-btn:active` 统一消费；`motion.test.ts` 的旧 0.97 源码钉改为钉令牌，`press-scale.test.ts`
   2 条。
9. **流顶/流底渐隐（v3 `scroll-fade-size: 28px`）**：新增 `--scroll-fade` 令牌；`.stream-fade-bottom`
   贴在 `.zone-stream` 底部，只在 `!stick.stuck` 时显形；`.stream-fade-top` 以 sticky 贴在 `.reading`
   顶部、z-index 低于 gen-bar，只在 `!stick.atTop` 时显形。两处都是 28px 背景渐变、`pointer-events:none`，
   不挡内容。判卷 `stream-fade.test.ts` 4 条；真实 DOM：顶部滚离 120px 后顶边 opacity 1、回顶 0；
   底部贴底 0、离开底部 1。

10. **侧栏骨架微光（v3 `skeleton-sheen`）**：`.side-skeleton-row` 保留 `bg-300` + `breathe` 底条，
    加一条 `::after` 低对比扫光（6% text-000，1.8s）；`prefers-reduced-motion` 明确停掉扫光并停在屏外。
    `skeleton-shimmer.test.ts` 3 条。

11. **文件窗格可恢复性 + 键盘树**：目录/预览各加请求序号，旧响应晚到不再覆盖新请求；目录 `truncated`
    如实提示「只显示前 N 项」；目录失败/预览失败都有原地「重试」；目录按钮补 `aria-expanded`，
    文件行补 `aria-selected`，预览顶部显示完整路径。树加 `role=tree/treeitem`、roving tabindex 与
    ↑/↓/Home/End/→/← 键盘路径（Enter/Space 交给原生 button）。`file-pane-improvements.test.ts` 5 条。
    真实 Electron（画廊夹具补了假树）：根三行；`→` 展开 `src`（aria-expanded=true）、`↓` 到
    `main.ts`、`←` 回 `src`、再 `←` 收起（false）；`src` 的 truncated 提示与 `main.ts` 预览
    （路径 + 正文）都实测可见。

12. **Composer 圆角 12px（v3 `radius-composer: .75rem`）**：`tokens.css` 新增独立令牌
    `--radius-composer-card`（12px），`.composer-card` 消费；**发现 vendored skin 自带 18px**，
    会盖住令牌，于是在 `dsh-claude-style.css` 用同特异性、后加载的覆盖层压回 12px，
    并同步 `::after` 焦点环。真实 DOM 计算值 `border-radius: 12px`；用户气泡仍 14px。
    `composer-radius.test.ts` 3 条。

13. **菜单/浮层/设置卡圆角 10px（v3 `panel-radius: .625rem`）**：新增 `--radius-pop-v3`（10px），
    `.pop` / `.path-menu` / `.pop-rd` / `.ss-card` 消费；真实 DOM 计算值 `.pop` = 10px、
    `.ss-card` = 10px、composer = 12px。`popover-radius.test.ts` 2 条；`menu-unify.test.tsx`
    与 `settings-ui.test.tsx` 的 14px 源码钉同步改为 10px 令牌。

14. **插件窗格（G1 首个可用落点）**：新增 `PaneKind = "plugins"`，右列可直接看插件列表/技能/
    命令/信任与 MCP，不再要求离开当前会话去「应用」页；`⌘⇧U` 与顶栏 ⋮ 菜单同源。
    `getState().plugins` 缺失时显示错误 + 原地重试；窄窗格把详情抽屉改为单列。
    `plugins-pane.test.ts` 3 条；真实 Electron 实测菜单八项、插件窗格可开、缺快照时
    `role=alert` + 「重试」可见；画廊夹具补插件快照后，真实 DOM 能看到「已加载/已信任/MCP」
    统计、`demo-plugin` 列表、`demo-plugin:review` 技能与 `demo-plugin:test` 命令，以及
    `demo-mcp · 1 工具` 的连接态。**真正的 mod 侧栏（Option+Cmd+B、最小 280px）仍未做**。

15. **插件命令带（G1 的按钮带半边）**：Composer 上方 `.plugin-strip` 只列已信任、带命名空间的
    命令（最多 4 条）；点击填入 `/plugin:command `，不直接发送（沿用 C-24）。文案走 `STR`，
    不写裸中文。`plugin-strip.test.ts` 3 条；真实 Electron 夹具实测两条芯片
    `demo-plugin:review` / `demo-plugin:test`，点击后 textarea 值为 `/demo-plugin:review `。

16. **消息操作条 reveal**：`.row-actions` 从「硬切」改成「淡入 + 下沉 2px」，
    过渡走既有 `--t-fast` 几何令牌；hover/focus 与保存态回原位。仍保持「渲染即挂载」，
    不延迟构建。`row-actions-reveal.test.ts` 2 条。

17. **mod 侧栏（G1 布局挤窄版）**：作为 `.shell` 第三列，不是覆盖层；最小 280px、实际 340px、
    从 38px 标题栏下开始。`⌘⌥M` 开合，localStorage 记住开关；复用 `PluginSurface`，内容与插件
    窗格同源，带关闭按钮。真实 Electron 实测：主栏宽度 821 → 521，侧栏 340、top 38，关闭后主栏
    恢复；打开后焦点落在关闭按钮，Esc 优先关闭侧栏并写回 localStorage；标题栏「插件侧栏」
    按钮带 `aria-expanded` 与 `data-on`；左缘拖手/方向键可调 280–420px 并持久化。
    侧栏里插件命令有「填入」按钮，点击把 `/plugin:command ` 填进 Composer，不直接发送；
    拖手双击复位 340px（实测 350→340，localStorage 同步）。`plugin-sidebar.test.ts` 6 条。**边界**：快捷键用 `⌘⌥M`（`⌘⌥B` 已被检查器占用，设计稿写的是 Option+Cmd+B），
    键位重排仍未做。


18. **键位冲突收口**：`⌘⌥B` 按设计稿归插件侧栏；检查器改为 `⌘⌥I`；`⌘⌥M` 保留为插件侧栏
    兼容别名。Inspector 关闭钮 title、速查表、命令面板、快捷键防漂见证表同步更新。
    真实 Electron 实测：`⌘⌥B` 打开 mod 侧栏；`⌘⌥I` 把检查器宽度 360 → 0（开合）。
    没有新增用例，只改了既有键位判据。

19. **窄窗自适应**：宽窗仍是挤窄主栏的第三列；`@media (max-width: 1120px)` 改为固定覆盖层，
    避免 280px 最小宽把主栏压到不可读。真实 Electron 实测：1440px 时 `position: relative`、
    侧栏 340 / 主栏 521；缩到 1050px 后 `position: fixed`、top 38、侧栏 340。

20. **窄窗点外部收起 + 控件关联**：覆盖层只在 ≤1120px 时监听 `pointerdown`，点侧栏外收起；
    宽窗是布局列不抢点击。标题栏按钮补 `aria-controls="mod-sidebar"`，侧栏有对应 id。
    真实 Electron 实测：1440px 点主栏侧栏仍在；1050px 点主栏侧栏关闭。
    `plugin-sidebar.test.ts` 7 条。

21. **窗口材质实验开关（默认关）**：新增 macOS-only `CAIRN_WINDOW_VIBRANCY=sidebar|1`
    环境变量与设置页「窗口 → 窗口材质」开关（默认关，重启生效）；主进程给出
    `vibrancy:"sidebar"` + 透明背景，并在设置变更时 best-effort `setVibrancy`；preload 给 `<html data-vibrancy>`，
    CSS 只让 `.side-wrap` 透出材质（75% 底，保 text-400/500 在亮/暗反向桌面底上最差约 4.7:1）、
    `.main` 保持近不透明。默认路径仍是不透明窗口。
    `window-vibrancy.test.ts` 3 条；真实 preload 实测 `html[data-vibrancy="sidebar"]` 生效、`window.agent` 仍在；
    再把 `body` / `#root` 的覆盖背景置透明后，计算值 `body=rgba(0,0,0,0)`、`.side-wrap` 55%、
    `.main` 94%。拍了一张暗色隔离壳截图，但 **capturePage 看不出桌面材质、也无对比度读数**，
    所以仍不能把它写成“Claude 材质已对齐”。

22. **侧栏关闭焦点归还**：从侧栏内部（关闭钮/Esc）关闭时，焦点回到标题栏「插件侧栏」入口；
    点外部关闭不抢焦点。真实 Electron 实测：关闭前 active=关闭插件侧栏，关闭后 active=插件侧栏。
    `plugin-sidebar.test.ts` 7 条。
## 6. 验证（工作树）

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run --config vitest.config.ts tests/usage-composition.test.tsx tests/usage-panel.test.tsx tests/tokens.test.ts tests/boot-placeholder.test.ts tests/boot-theme.test.ts tests/stream-fade.test.ts tests/press-scale.test.ts tests/skeleton-shimmer.test.ts tests/file-pane-improvements.test.ts tests/composer-radius.test.ts tests/popover-radius.test.ts tests/plugins-pane.test.ts tests/plugin-strip.test.ts tests/row-actions-reveal.test.ts tests/plugin-sidebar.test.ts tests/window-vibrancy.test.ts` | **16 文件 / 83 用例全绿** |
| `node --import tsx scripts/typecheck.ts` | **0 报错** |
| `pnpm --filter cairn-desktop build` | **构建通过**（含 `tsc -p tsconfig.json --noEmit`） |
| `env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop test` | **183 文件 / 1278 用例全绿** + `desktop-boundary-check: 绿` |
| `pnpm test`（core 全量） | **454 文件 / 6239 用例全绿** |
| 真 Electron 截图（`/tmp/shoot-usage.cjs`，真 preload + 假 AgentApi） | `usage-popover.png`：条为 blue `rgb(42,120,214)`（输入 87.1%）+ aqua `rgb(27,175,122)`（输出 12.9%）；缓存 0 时不显示附注 |
| 启动占位截图（JS 关闭） | `boot-placeholder-dark.png` / `boot-placeholder-light.png`：底色 `#151515` / `#fcfcfb`，clay 标记与进度线 |
| 启动占位淡出（真实 DOM） | React 挂载后 `rootChildren=1`，`#boot` 的 `visibility=hidden`、`opacity=0` |
| 流顶/流底渐隐（真实 DOM） | 顶部：滚离 120px 后 `opacity=1`、回顶 `0`；底部：贴底 `0`、离开底部 `1` |
| 通道提取（`extract-channels.mjs` → `diff-channels.mjs`） | 477 JS / 40,951,039 B ⇒ **1438 条**；v2 1327 → v3 1438，按 Controller+method **97 新增 / 0 删除** |

**环境坑（如实记录）**：本会话环境预置 `ELECTRON_RUN_AS_NODE=1`，直接跑桌面全量会让
`tests/desktop-review-batch.test.ts` 里的原生宿主子进程把 Electron 当 Node 启动，报
`app.setPath` undefined——1 条假红。`env -u ELECTRON_RUN_AS_NODE` 后同文件 8/8、全量 1278/1278 全绿。
这不是产品缺陷，也不能把第一次的红读成回归。

**未跑**：`pnpm gates`、`mutate-verify`、`head-cert-check`（核心全量已补跑：454 文件 / 6239 用例全绿）。本轮没有提交；
`mutate-verify` / `head-cert` 量的是 HEAD，工作树证据不能冒充提交认证。
**未证**：真实 Claude 窗口的几何与视觉。本轮用隔离 profile（`--user-data-dir=/tmp/...`）启动过一次，
只从 helper argv 取到特性表；主窗口在该会话里没有暴露可观测几何（AX 空、CG bounds 78×103、桌面截图全黑），
随即强杀并删除 profile，未读取任何用户会话。追加实测：v3 对 `--remote-debugging-port` 直接拒绝启动
（`Claude: refusing to start — a debugging or network-override switch is present on the command line.`），
日志也写明 `[a11y] accessibility support disabled features=none`——所以 CDP 与 AX 两条真机观测路都被应用自身关掉，
几何只能等它自己显示出可观测窗口。v3 的聊天主界面在远端 claude.ai，本地 asar 只有壳——
所有「聊天区排版」结论仍只能来自上一轮的 v2 真机测量，不能当 v3 现值。
Cairn 的用量截图是系统暗色；启动占位有暗/亮两张（JS 关闭，不经过 App 的 theme effect）。

## 6.5 WindowVibrancy 研究（未改产品）

v3 的 `claude.windowVibrancy` 命名空间有 `showUnderSidebar` / `tintUnderSidebar` /
`clearTintUnderSidebar` / `clear` 四条通道。静态提取只能证明名字存在，不能推出视觉参数。
本轮用独立 Electron 窗口验证 macOS `vibrancy:"sidebar"` 可出材质、`capturePage` 可离屏取图，
原型图与边界记录在本目录的 `VIBRANCY.md` / `vibrancy-proto.png`；**没有改 Cairn 默认外观**，
因为透明窗要同时审首帧、暗色对比度、hover/选中态与 popout。

## 7. 下一轮可继续的线（按证据缺口排序）

1. **v3 语义图**：按 Webpack 模块边界把 7 MB 的 `index.chunk-*.js` 切成小文件再喂 REA，补窗口数与
   contextBridge 成员；IPC 通道面已用 `extract-channels.mjs` 补到 1438 条（见 §3.3），不再重复。
2. **真机几何**：本轮隔离实例没有可见主窗口；下一轮先解决「为什么 AX/CG 只看到 78×103 的隐形窗」，
   再量侧栏/内容列/composer，不触碰用户已有会话。
3. **骨架屏**：滚动渐隐已落地（§5.9）；骨架屏等 Cairn 出现真正的懒加载长列表再评估，不先造空转令牌。
4. **用户气泡 alpha 语义**：若未来脱离 `dsh-claude-style` 自绘，按 `bg-user-message = alpha-1` 落地。

23. **焦点环从品牌橙拆成控件蓝**：v3 `--cds-focus-shadow` 用 `--cds-fill-accent`（blue-450），
    不是品牌陶土橙；新增 `--accent-control: 212.8 67.7% 50.2%`，全局 `:focus-visible`、
    composer focus-within、设置字段 focus、侧栏拖手 focus、会话日志 focus 改用蓝环；
    主按钮/品牌仍用 `--accent-brand`。`focus-ring.test.ts` 4 条把 token 值也钉住。

24. **强调色按 v3 职责拆成三枚**：`--cds-fill-accent`（blue-450）管焦点环/填充/选中边框，
    `--cds-text-accent`（blue-600）管强调文字，`--cds-fill-brand`（clay-emphasized）管品牌填充。
    Cairn 对应 `--accent-control` / `--accent-control-text` / `--accent-brand`：
    焦点环、选中态（chip / 主题选项卡 / 设置档位）走控件蓝，链接与菜单勾走 blue-600 文字色，
    主按钮、品牌图标、当前会话强调条留陶土橙。判卷 `control-accent.test.ts` 5 条钉住分工
    （把控件蓝换回品牌橙必红）。

25. **强调文字分主题（v3 暗色 scope 实测）**：v3 里 `--cds-text-accent` 亮色是 role-accent-600
    （blue-600），**暗色 scope 改成 role-accent-300**（blue-300 `#6da7ec`）——暗底上 blue-600
    只有 4.6:1（bg-200 侧栏底），blue-300 有 11:1 以上。Cairn 对应把
    `--accent-control-text` 在 `[data-theme="dark"]` 里覆盖为 blue-300。
    真 DOM 读数：亮色 chip 文字 `rgb(24,79,149)`、暗色 `rgb(44,132,219)`。

26. **焦点环外发光也分主题**：v3 的 `--cds-bg-accent` 亮色是 role-accent-100（blue-100
    `#cde2fb`）、暗色 scope 是 role-accent-800（blue-800 `#032042`）——同一枚 token 在两个
    主题里明暗相反。Cairn 对应 `--accent-control-glow`：亮色 `210 70.9% 90%`、
    暗色 `210 82% 13%`；`:focus-visible` 的第三层外发光改吃这一枚。

27. **hover / 选中的淡底分主题**：v3 亮色 scope 的 `--cds-fill-ghost-hover` = 5%、
    `--cds-fill-ghost-selected` = 10%；**暗色 scope 提到 7.5% / 15%**——暗底上同样的百分比
    看不出「浮起」。Cairn 新增 `--alpha-hover` / `--alpha-selected`（亮 5%/10%，暗 7.5%/15%），
    74 处 hover/选中底改吃这两枚（`--alpha-1/2` 阶梯本身保留给描边等其它用途）。

28. **输入框底分主题**：v3 `--cds-fill-field` 亮色 = `#ffffff80`（白半透）、
    暗色 scope = `--cds-alpha-1`（5% 亮墨）。Cairn 新增 `--fill-field` 两态，
    设置页输入框（`.ss-field > input/select`）改吃它，不再用实体 `bg-000`。

29. **弹层投影按 v3 两主题实测改正**：v3 `--cds-shadow-popover`
    亮色 = `0 8px 24px #0000001f, 0 2px 6px #00000014`，
    暗色 = `0 8px 24px #00000052, 0 2px 6px #0003`。
    Cairn 此前是 `8px 28px / 2px 8px`（模糊更大、墨更淡），已改为同形状；
    判卷 `v3-shadow-tokens.test.ts` 3 条钉两主题四段值与「模糊两主题一致」。

30. **卡片投影按 v3 `--cds-shadow-sm` 改正**：亮色 v3 = 单层 `0 1px 2px 0 #0000000d`；
    暗色 v3 = `0 1px 2px 0 hsl(gray-900 / 6%), 0 2px 8px 0 var(--cds-shadow-color)`
    （暗色 shadow-color = `#0000003d` ≈ 24%）。Cairn 此前暗色是 `none`（卡片不浮）、
    亮色是两层 4%，已改为与 v3 同形。

30. **字号刻度按业主 §4.4 与 v3 实测校回**：
    - 业主 §4.4：caption `.625/.6875/.75/.8125`（10/11/12/13）＋ body `.75/.8125/.875/.9375`
      （12/13/14/15）＋ footnote/code `.75/.8125`；
    - 此前实现把 caption 三档**压平成 12.5**、body-md 落 **14.5**（不在四档里）；
    - v3 实测（comfortable / step-4）：caption 12 / body 14 / prose 16 / heading 15 / title 22，
      行高分别 17/20/24/20/28；
    - 现已按规格与实测改回：caption 10/11/12/13、body-sm 13、body-md 14、footnote 12、code 13、
      prose-m 14；`tokens.test.ts` 相应判据改为逐档钉住。
