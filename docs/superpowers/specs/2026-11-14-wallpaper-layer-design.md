# 桌面端壁纸层与玻璃表面：设计规格

状态：**待业主复核**（本规格是实现计划的输入，不是实现记录）。
日期：2026-11-14。
参照物：[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)（DSH 0.2 生态插件，2026-11-14 读提交 `909a9cc`）。

## 0. 一句话

在 Cairn 桌面端的对话界面**背后**加一层用户自选的图片/视频，并让压在它上面的界面成为玻璃；
文字可读性有硬地板；默认关闭；不向 agent 注册任何工具；插件边界（§9.8）一动不动。

## 1. 参照仓是什么，以及为什么不能直接搬

它不是一个桌面 app，是 **DSH 0.2 内核里的 Cordis 插件**，双半结构：

- **宿主半**：`lib/index.js` 跑在 DSH 内核进程内，挂同源 HTTP 路由
  （`/wallpaper-engine/inventory`、`/media`、`/settings` 等），并用 `cordis.patch.yml`
  往宿主插件表插九个「组件行」（glass / fonts / fx / parallax / mascot-avatar /
  media-bridge / pet-link / about-notice 等）。
- **渲染半**：`src/client.js` 由宿主客户端模块加载器 `require()` 求值，直接往 `document.body`
  挂壁纸层、注入 `<style>` 玻璃表、画设置面板。

**我们的仓装不进来**，两条硬理由：

1. `src/agent/plugins/manifest.ts` 的 `detectJsEntry` 明令**拒载带 JS 入口的代码插件**
   （§9.8「插件零进程内第三方代码」）。它的宿主半与渲染半各是一个 JS 入口。
2. 我们没有 Cordis 宿主（`apps/desktop/design/desktop-design-spec.md` 自认
   「官方 Cordis 插件宿主……尚未迁入」）。`cordis.patch.yml` 那套「组件行」无处可插。

⇒ 本规格**不复刻它的插件机制**，只借它已经用实测钉死的工程结论。不可借鉴的部分在 §8 列明。

## 2. 目标与非目标

**目标**

- G1 应用内壁纸层：一张图或一段视频，铺在对话界面背后（**不是**系统桌面壁纸）。
- G2 玻璃表面：压在壁纸上的承载面成为玻璃；滑杆可调但**压不穿可读性地板**。
- G3 媒体生命周期：失焦/隐藏/休眠即停；文件消失即降级。
- G4 零 token 开销：不注册 agent 工具，不注入提示文本。
- G5 零回归：无壁纸时渲染与今天完全一致。

**非目标**

- 不做 Wallpaper Engine 的 Scene / Web 实时引擎（自带 WebWallGL + Steam 工坊扫描 + 降级链）。
- 不做系统音频频谱 / Now Playing。
- 不做吉祥物、视差、3D 特效、点击拖尾。
- 不做插件代码注入；不改 §9.8；不引入 Cordis。

## 3. 架构

### 3.1 新增位置（5 处，全是新增；既有调用方零改动）

| 层 | 落点 | 职责 |
|---|---|---|
| 主进程 | `apps/desktop/src/main/wallpaper.ts` | 注册 `cairn-wallpaper://` 协议；只服务**当前选中的那一个文件**；选文件时的扩展名/大小/存在性校验（返回 `kind` + `path`） |
| 渲染层 | `apps/desktop/src/renderer/components/WallpaperLayer.tsx` | 画媒体层（图/视频）+ scrim 层；不吃交互 |
| 渲染层 | `apps/desktop/src/renderer/state/wallpaper.ts` | 从 settings 派生 `kind / opacity / scrim / revision / mediaUrl` |
| 渲染层 | `apps/desktop/src/renderer/wallpaper.css` | 画布让位 + 玻璃面 + 可读性地板 |
| 设置 | `src/main/settings.ts` → `AppSettings.wallpaper` | `{ kind, path, opacity, scrim, revision }` 持久化 |

### 3.2 媒体通道

渲染层**不接触文件系统**。媒体走自定义协议：

```
cairn-wallpaper://media/current?v=<revision>
```

- `protocol.handle`（Electron 44 有此 API，见 `electron.d.ts` 的 `handle(scheme, handler)`）注册。
- handler 的白名单 = **设置里当前那一个绝对路径**；其余请求一律 403。
- 必须支持 **Range 请求并回 206**：`<video>` 会发 Range，不支持会让拖动/缓冲异常。
- `revision` 由主进程在 `wallpaper.path` 变化时自增（单一写者），用于破浏览器缓存。
- dev（`http://localhost:5173`）与 prod（`loadFile`）共用同一套协议，不依赖 `file://` 跨源。

### 3.3 IPC

新增一条 invoke 通道（沿用仓内既有模式：`AgentApi` 加方法 ⇒ `INVOKE_CHANNELS` 必须同步加行，
否则 typecheck 红）：

```
wallpaperPick(): Promise<{ ok: boolean; kind?: "image" | "video"; path?: string; error?: string }>
```

- 走 `dialog.showOpenDialog`（主进程已有用法，见 `apps/desktop/src/main/index.ts` 的既有调用），
  单选、带扩展名过滤。
- 选完由渲染层把结果写进 settings（既有 `setSettings` 通道），主进程负责 `revision` 自增。

**不复用** `pickFiles()`：它无过滤且是多选，语义与「挑一个壁纸」不符。

### 3.4 设置字段

```ts
wallpaper: {
  kind: "none" | "image" | "video";
  path: string | null;   // 只在主进程与 settings.json 里
  opacity: number;       // 壁纸自身不透明度，0..1
  scrim: number;         // 压暗强度，0..1
  revision: number;      // 破缓存用，主进程单调自增
}
```

- **`wallpaper` 不进偏好导出**（`src/main/preferences.ts` 的 `PREFERENCE_KEYS`）：
  路径是机器本地的，跨机搬运只会指向不存在的文件。`workspace` / `provider` 同理不搬。
- 校验：类型/枚举/范围不对即拒（与既有偏好导入同形）。

### 3.5 渲染层挂载

- 挂点：`apps/desktop/src/renderer/main.tsx`，`#root` 内的**第一个**子节点，`<App/>` 之前。
  层用 `position: fixed; inset: 0; z-index: 0; pointer-events: none`，应用内容靠 DOM 顺序压在其上。
- 媒体自身：`object-fit: cover`；视频必须 `muted` + `loop` + `playsinline`
  （Chromium 对带声视频的自动播放策略会拦下未静音的自动播放）。
- **`data-we-wallpaper` 的唯一写者是 `state/wallpaper.ts`**：有壁纸时写到 `document.body`，
  清空时移除；幂等，不留残值（这是参照仓踩过的坑：组件行停用后 bundle 不再求值，
  残留的 `data-we-*` 属性没人清，只能靠常驻包回收）。
- **只在主窗口挂**：弹出窗格窗口（`#pane=…` 路由）不挂，也不设 `data-we-wallpaper`——
  否则 vendored 主题会在弹窗里也让掉画布，弹窗变成透明壳。
- `data-we-wallpaper` 是**上游接缝的属性名**，见 §4。

## 4. 画布让位：接缝是半成品

参照仓的 vendored 主题 `apps/desktop/src/renderer/vendor/dsh-claude-style/tokens.css` 已经为
「壁纸插件」预留了门控：`body[...]:not([data-we-wallpaper])` 让出下列画布，注释写明
「theme/wallpaper.css lays its mask over the layer the plugin put under the shell」。

| 面 | 今天谁在画 | 壁纸开启时的处理 |
|---|---|---|
| `body` | **我们自己的** `styles.css` 的 `body { background: hsl(var(--bg-100)); }` | **必须透明化**——vendored 主题管不到这里 |
| `#root` | vendored `tokens.css`（已被 `:not([data-we-wallpaper])` 让出） | 无需改 |
| 对话列 `[data-pane="conversation"]` | vendored `tokens.css`（同上） | 无需改 |
| `html` | vendored `tokens.css`（**始终**画） | 保留：壁纸层画在 `#root` 内 ⇒ 压在 html 画布之上、壳之下（上游注释写明的层级） |
| 左栏 `.side-wrap` | 我们自己的 `styles.css` 的 `.side-wrap { background: hsl(var(--bg-200)); }` | 改为玻璃（业主裁决：左栏也玻璃） |

**最容易踩空的一处**：vendored 主题只让出了它自己画的三处；我们自己的 `body` 画布仍在。
若只设 `data-we-wallpaper` 而不接管 body 画布，结果是「壁纸选了但什么也没变」。

⇒ 第一方 `wallpaper.css` 的职责就是接管这张表里**仍由我们画**的 `body` 与 `.side-wrap`。

## 5. 视觉契约

### 5.1 玻璃面清单（只这五类，其余一律实体色）

1. 对话列（承载正文的主面）
2. composer 输入卡
3. 检查器 / 右侧窗格
4. 浮层（dialog / popover / 通知条）
5. 左栏（业主裁决：壁纸要透过去）

**不做嵌套玻璃**：Chromium 的 `backdrop-filter` 在嵌套层里互相采样，玻璃套玻璃会出现
采样错乱与不可控的模糊叠加。五类玻璃面互为兄弟层，不嵌套。

### 5.2 玻璃参数

| 变量 | 含义 | 可调 |
|---|---|---|
| `--cw-glass-blur` | `backdrop-filter` 的模糊半径 | 是 |
| `--cw-glass-tint` | 叠色（色相取自主题画布色） | 是（alpha） |
| `--cw-glass-border` | 1px 内描边（承载边界信息，非装饰） | 否 |
| `--cw-floor` | **可读性地板权重**，见 5.3 | **否** |

### 5.3 可读性地板（本规格唯一的硬指标机制）

参照仓在这一处做对了，值得抄**机制**：

- 做法：每个**承载文字**的面 = `color-mix(in srgb, 画布色 floor%, 玻璃色 (1-floor)%)`。
- 地板是固定权重，**滑杆只能改玻璃那一项** ⇒ 地板压不下去 ⇒ 最差格对比度有下界。
- 它用网格法（玻璃 alpha × 主题 × 壁纸透明度）算出最差格并把数值写进 CSS 常量，
  自带 `test/verify-readability.mjs` 重算同一张网格。

我们抄机制、**不抄它的数值**（那是按它的主题底色算的，我们的底色不同）：

- 地板色 = 本仓主题画布色（亮/暗各一，取 CDS 官方值经 `cds-adapter` 映射后的值）。
- **地板权重必须由本仓测量得出**，不得手抄参照仓的权重。
- 验收口径：网格法最差格 **≥ 4.5:1**（WCAG AA 正文）。
- 地板只铺在**承载文字**的面；纯装饰面（描边、图标、分隔线）不铺。

### 5.4 滑杆

三个滑杆，全部即时生效并落盘：**壁纸不透明度**、**压暗强度**、**玻璃透明度**。
不透明度与压暗只作用于壁纸层自身，不改玻璃面。

### 5.5 与既有 `windowVibrancy` 的冲突

本仓已有 macOS 窗口毛玻璃（设置键 `windowVibrancy`，样式钩子
`html[data-vibrancy="sidebar"] .side-wrap { background: hsl(var(--bg-000) / .75); }`）。

应用内壁纸层画在**系统 vibrancy 之上**，两者同开时 vibrancy 被壁纸完全遮住，只剩「白开一场」。

⇒ **壁纸开启 ⇒ 自动关闭 vibrancy**（单一写者在设置写入时处理），并在设置里写明原因。

## 6. 媒体生命周期与功耗

| 触发 | 动作 | 依据 |
|---|---|---|
| 窗口失焦 | 暂停视频 | `BrowserWindow` 的 `blur` 事件（Electron 44 有） |
| 窗口隐藏 | 暂停视频 | `BrowserWindow` 的 `hide` 事件 |
| 系统休眠 | 暂停视频 | `powerMonitor` 的 `suspend` 事件 |
| 壁纸被清空 / 文件失效 | 撤层、回到无壁纸 | §7 降级链 |

**遮挡（occluded）本轮不做**：Electron 44 的类型定义里**没有** occluded 事件，无法可靠判定
「窗口被别的窗口完全盖住」。用 `!isVisible() || !isFocused()` 近似，并在设置与本文登记为
已知差距，不假装做到。

**帧率上限不做**：参照仓的转码限帧是 Wallpaper Engine 工坊项目的场景；我们是单文件本地视频。

**默认关闭**：壁纸是功耗敏感项，默认 `kind: "none"`。

## 7. 降级链

```
视频解码失败 ─┐
图片解码失败 ─┼─→ 撤掉壁纸层（保留 scrim 与玻璃）→ 设置里标记「文件不可用」
文件被删/移动 ─┘
协议 403/404 ──→ 同上
```

降级**只撤媒体**，不撤玻璃：玻璃面在没有壁纸时仍是实体色（地板色兜底），不会出现「玻璃浮在
纯色上」的破面。

## 8. 明确不做（连理由一起钉住）

| 不做的东西 | 理由 |
|---|---|
| Wallpaper Engine Scene/Web 实时引擎 | 自带 WebWallGL 引擎 + Steam 工坊扫描 + 多级降级链；工作量数倍于本体，且它的插件装不进我们的 §9.8 边界。若以后要做，是独立批次，且须先过插件边界讨论 |
| 系统音频频谱 / Now Playing | macOS 取系统音频需原生模块（MediaRemote / ScreenCaptureKit），本仓零原生代码；且频谱不承载信息，与「结构优先、不要装饰」的判据冲突 |
| 吉祥物 / 视差 / 3D 特效 / 点击拖尾 | 装饰；每个视觉元素都要能说清它承载什么信息 |
| 插件代码注入 | 越过 §9.8 |
| 嵌套玻璃 | Chromium `backdrop-filter` 嵌套采样错乱 |
| 精确遮挡判定 | Electron 无 occluded 事件（§6） |

## 9. 验收判卷

| # | 判据 | 形式 |
|---|---|---|
| 1 | 壁纸开启时 `body` 实测为透明 | 真渲染层 `getComputedStyle` 实测 |
| 2 | **最差格文字对比度 ≥ 4.5:1** | 计算脚本（网格法，重算地板）+ 真渲染实测；脚本红即门红 |
| 3 | 失焦时 `video.paused === true` | 实测 |
| 4 | 协议拒绝非当前文件（403） | 单测 |
| 5 | **无壁纸时渲染与今天逐像素一致** | 回归（改动前后同尺寸截图比对） |
| 6 | 分层与类型 | `pnpm renderer-layer-check`；`node --import tsx scripts/typecheck.ts` |
| 7 | 新 CSS 不碰 vendor | `cds-adapter` 仍最后 import；`cds-parity` 绿 |

补充：设置写入走既有 `setSettings`，`INVOKE_CHANNELS` 必须同步加 `wallpaperPick` 行，否则 typecheck 红。

## 10. 风险与已知差距

- `backdrop-filter` 在大面积上吃 GPU，低端机需实测；必要时降级为「半透明纯色 + 1px 描边」。
- 视频壁纸持续解码耗电；失焦/休眠即停只是止损，不是根治。
- 玻璃与 CDS 官方值之间的桥必须走 `cds-adapter` 映射，不得复制官方色值（`AGENTS.md` 明令）。
- **启动首帧**：窗口底色目前由 `bootBackgroundFor(theme)` 决定。壁纸开启时首帧会先闪一帧画布色。
  最小修法：图片壁纸时主进程用 `nativeImage` 取 1×1 平均色（`resize({width:1,height:1})` 的首像素
  即平均色）作为 `backgroundColor`；视频壁纸无此捷径，按画布色处理。列为 v1.1 项。
- 遮挡判定不可靠（§6）。

## 11. 待业主复核的问题（每条都带默认值，不等答复也能开工）

| # | 问题 | 默认（若不另行裁决即按此执行） |
|---|---|---|
| 1 | 玻璃面清单（§5.1）是否就是这五类？ | 就是这五类：对话列 / composer / 检查器与右窗 / 浮层 / 左栏 |
| 2 | 可读性地板的验收线取多少？ | **4.5:1**（WCAG AA 正文）。大字面（≥24px）另按 3:1 判，不为大字面放宽整体地板 |
| 3 | 启动首帧闪色（§10）放 v1 还是 v1.1？ | **v1.1**：图片壁纸用 `nativeImage` 1×1 平均色填 `backgroundColor`；v1 先接受首帧闪画布色 |
| 4 | 是否需要一个「纯色/渐变」壁纸作为零成本入口？ | **不需要**：纯色壁纸等价于「不开壁纸」，不构成新能力；将来若要，做成滑杆里的预设而不是独立类型 |
