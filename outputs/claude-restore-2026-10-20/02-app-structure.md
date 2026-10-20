# Claude Desktop 2.42304.2 — 应用结构逆向报告

目标：`/Applications/Claude.app/Contents/Resources/app.asar`（`@ant/desktop` 2.42304.2，Anthropic PBC）
工作目录：`/tmp/claude-rea`　报告生成：2026-10-20

---

## 0. 证据源与口径说明

| 证据源 | 路径 | 说明 |
|---|---|---|
| REA 静态分析产物 | [analyze.json](/tmp/claude-rea/analyze.json)（123 MB，单行） | `.data.normalized_result.graph.nodes`（2251）/ `.summary` / `.statistics`；本文节点数据取自导出的 [02-nodes.json](/tmp/claude-rea/out/02-nodes.json) 与 [02-summary.json](/tmp/claude-rea/out/02-summary.json) |
| asar 清单 | [asar-list.txt](/tmp/claude-rea/asar-list.txt)（511 行） | 顶层：`.vite` 438、`node_modules` 49、`resources` 17、`compile-cache` 6、`package.json` 1 |
| asar 内抽取的 JS | [js/.vite/build/](/tmp/claude-rea/js/.vite/build/) | 用 [asar-tool.mjs](/tmp/claude-rea/asar-tool.mjs) 抽取，未改动原 app |
| 渲染层产物 | [x/.vite/renderer/](/tmp/claude-rea/x/.vite/renderer/)、[x2/.vite/renderer/](/tmp/claude-rea/x2/.vite/renderer/) | 6 个窗口的 HTML/CSS/JS bundle |

**派生清单文件（本次产出）**

| 文件 | 内容 |
|---|---|
| [02-ipc-channels.txt](/tmp/claude-rea/out/02-ipc-channels.txt) | **1327** 条**完整通道名**（已把前缀变量展开） |
| [02-channels-by-ns.tsv](/tmp/claude-rea/out/02-channels-by-ns.tsv) | 通道数按命名空间统计 |
| [02-ui-strings.tsv](/tmp/claude-rea/out/02-ui-strings.tsv) | **1153** 条 react-intl `defaultMessage`（`文件 \t id \t 文案`），已按 id 去重 |
| [02-nodes.json](/tmp/claude-rea/out/02-nodes.json) | graph 节点全量（2251，已过滤落盘） |

**REA 自报的解析边界**（`summary.limitations`，原文摘译）：多个文件因「超出父级结果预算」被跳过语义分析，仅保留静态事实 —— 含 `findInPage.js`、`heavyWorkWorker.js`、多个 `index.chunk-*.js`。因此节点统计是**下界**，不是全量。`statistics`：`relevant_files=454`、`parsed_javascript_files=436`、`visited_ast_nodes=9,532,381`、`findings=6821`、`parse_failures=0`。

> **关键方法学说明**：REA 摘要说 `literal_channels: 10` / `dynamic_channel_operations: 1524`，即它把 `n+"X_$_y"` 一律记为 dynamic。但**前缀 `n` 在 preload 里是字面量常量**（见 §3.1），因此本次把 `var n="$eipc…"` 与 `n+"…"` 做常量折叠，**恢复了 1327 条确定的通道名**。这不违背"禁止编造"——每条都能在文件里定位到拼接的两半原文。

---

## 1. 入口与启动链

### 1.1 主进程入口

| 环节 | 证据 | 值 |
|---|---|---|
| `package.json:main` | [package.json](/tmp/claude-rea/x/package.json) | `.vite/build/index.pre.js` |
| electron-main 节点 | nodes.json，`kind=electron-main`，`label=.vite/build/index.pre.js` | `mechanism: "package.json:main"`，`resolution_status: "resolved"` |
| 入口文件尾部 | [index.pre.js](/tmp/claude-rea/js/.vite/build/index.pre.js) 末尾 | `require("./index.js")` |
| 二级 shim | [index.js](/tmp/claude-rea/js/.vite/build/index.js)（638 B） | `require("./index.chunk-CS7I9ydG.js"), require("./index.chunk-BkhOOUzl.js")` |
| 主业务 chunk | [index.chunk-BkhOOUzl.js](/tmp/claude-rea/js/.vite/build/index.chunk-BkhOOUzl.js) | 7.07 MB，**14 个 BrowserWindow 中 11 个在此** |

启动链：`package.json:main` → `.vite/build/index.pre.js` → `require("./index.js")` → `index.chunk-CS7I9ydG.js` + `index.chunk-BkhOOUzl.js`。

`index.pre.js` 的实际职责不只是「壳」，它内含 **573 条 react-intl 文案（全部与主 chunk 重复） + 受管配置 schema**（见 §4.4）。尾部还有 compile-cache 生成逻辑：

```js
// index.pre.js 末尾原文
try{CZ("__claudeMainBundleStartMs"),require("./index.js"),s7=!0,C8(),o7&&k8(__dirname,wZ("__claudeMainBundleStartMs")??0,((e,t)=>{p.default.mkdirSync(h.default.dirname(e),{recursive:!0,mode:493}),p.default.writeFileSync(e,t,{mode:420})}))}catch(e){o7&&(process.stderr?.write(`compile cache generation failed: ${String(e)}\n`),process.exit(2)),_8(e)}
```

对应 [asar-list.txt](/tmp/claude-rea/asar-list.txt) 里的 `compile-cache/index.chunk-BkhOOUzl.js.x64.jsc`（6.83 MB）与 `.arm64.jsc`（6.83 MB）—— V8 code cache 双架构预热。

### 1.2 渲染层入口

6 个 `electron-renderer` 节点（`mechanism: "html-script-entrypoint"`，全部 `resolution_status: "resolved"`）：

| HTML | 对应 preload | 证据 |
|---|---|---|
| `.vite/renderer/main_window/index.html` | `mainView.js` / `mainWindow.js` | BW#8 / BW#12 |
| `.vite/renderer/quick_window/quick-window.html` | `quickWindow.js` | BW#5 |
| `.vite/renderer/about_window/about.html` | `aboutWindow.js` | BW#6 |
| `.vite/renderer/buddy_window/buddy.html` | `buddy.js` | BW#13 |
| `.vite/renderer/find_in_page/find-in-page.html` | `findInPage.js` | （见 §2 说明） |
| `.vite/renderer/local_exec_consent/localExecConsent.html` | `localExecConsent.js` | （见 §2 说明） |

`main_window/index.html` 首行注释即自述职责（原文）：

```html
<!-- this is the html for app title bar and error UI. everything else gets loaded from claude.ai -->
```

即主窗口是**原生壳 + 标题栏 + 错误 UI**，正文业务从 `claude.ai` 远端加载；`index.html` 里还内置 `boot-placeholder` 骨架屏（sidebar 形状 + `data-boot-placeholder-frame`），用 `#boot-placeholder-sidebar-width`/`--boot-placeholder-scale` 在首帧前画出侧栏轮廓，避免白屏。

### 1.3 原生依赖

`kind=native-addon` 5 个（均为 `unpacked: true`）：

| 路径 | 体积 | 说明 |
|---|---|---|
| `node_modules/@ant/claude-swift/build/Release/swift_addon.node` | 26.07 MB | Swift 原生 |
| `node_modules/@ant/claude-swift/build/Release/computer_use.node` | 2.26 MB | Computer Use |
| `node_modules/@ant/claude-native/claude-native-binding.node` | 5.57 MB | 主原生绑定 |
| `node_modules/node-pty/build/Release/pty.node` | 203 KB | 终端 |
| `resources/office365-mcp/msal-node-runtime.node` | 343 KB | Office 365 MCP |

> REA 完整性告警：`integrity_contradictions` 指出 `claude-native-binding.node`、`computer_use.node`、`swift_addon.node`、`pty.node` 的**实测 sha256 与 asar 声明的 sha256 不一致**（`trust: "observed-untrusted"`）。这是 app 打包侧的元数据问题，不影响本报告结论，但值得记录。

`kind=worker` 3 个：`new Worker(f)`、`new Worker(n)`、`new Worker(t,{type:"module"})` —— 路径均未解析（`resolved_path: null`）。另有 `javascript-chunk` 节点记录 `heavy-work-worker/heavyWorkWorker.js`（`bundler: webpack`，`module_count: 55`）。

---

## 2. 窗口体系

### 2.1 REA 的 `browser_windows: 14` 全量对照

下表按 REA 节点 `static_analysis.electron.browser_windows[]` 的原始 `location` 排序，每行都回到源码取了真实配置。**「窗口作用」一列由源码上下文（title / loadFile / setImplementation / 业务函数）判定，非推测。**

| # | 定义位置 | preload | 关键配置（源码原文） | title / 尺寸 | 窗口作用 |
|---|---|---|---|---|---|
| 1 | `index.chunk-BkhOOUzl.js` L7 C100204 | — | `options_status: dynamic` | 未取到 | 主窗口外壳：`function HSe(e){return B=new a.BrowserWindow(e),ji(B.webContents,ki.MAIN_WINDOW),TSe(B),B}` |
| 2 | `index.chunk-BkhOOUzl.js` L13 C1926484 | — | `options_status: dynamic` | 未取到 | **artifact 弹窗**：`[artifactPopup] createWindow`，`new a.BrowserWindow(HGn(e.options,e.hostWindow))` + `WebContentsView` 收养 guest |
| 3 | `index.chunk-BkhOOUzl.js` L13 C2742750 | 继承 `t.webPreferences` | `contextIsolation:!0, nodeIntegration:!1, sandbox:!0` | `title:"Code"`，`defaultWidth:850, defaultHeight:700` | **Code 弹出窗**：`MMr` / `PMr`，`loadURL` 到 claude.ai 的 `/code` 路径（`LMr` 白名单含 claude.ai / claude.com / preview.*） |
| 4 | `index.chunk-BkhOOUzl.js` L13 C2799714 | — | `contextIsolation:!0, nodeIntegration:!1, sandbox:!0` | 透明全屏 | **Computer Use 高亮遮罩（cu-glow）**：`transparent:!0, frame:!1, alwaysOnTop:!0, focusable:!1, setIgnoreMouseEvents(!0)`，加载 tmpdir 下的 `cu-glow.html` |
| 5 | `index.chunk-BkhOOUzl.js` L13 C3129133 | `.vite/build/quickWindow.js` | `titleBarStyle:"hidden", transparent:!0, frame:!1, type:"panel", skipTaskbar:!0, resizable:!1` | `width:j4r, height:M4r` | **Quick Entry 快速输入浮层**：`ji(gJ.webContents,ki.QUICK_ENTRY)`，`setAlwaysOnTop(!0,"pop-up-menu")` |
| 6 | `index.chunk-BkhOOUzl.js` L13 C3167183 | `.vite/build/aboutWindow.js` | `resizable:!1, minimizable:!1, maximizable:!1, titleBarStyle:"hiddenInset", skipTaskbar:!0` | `width:320, height:388`，`title:"About Claude"` | **关于窗口**：`loadFile(".vite/renderer/about_window/about.html")`，实现 `openHelp/getSupport/getAppName/getBuildProps/ancientJournal` |
| 7 | `index.chunk-BkhOOUzl.js` L13 C3713299 | `.vite/build/designWindow.js` | `sandbox:!0, contextIsolation:!0, nodeIntegration:!1` | 由 `rCi(r)` 决定 | **Design 窗口**：`createDesignWindow`，带严格导航守卫 `lCi(url)`（非 allow 即 `preventDefault`） |
| 8 | `index.chunk-BkhOOUzl.js` L13 C5079862 | `.vite/build/mainView.js` | `additionalArguments:[`--desktop-features=${JSON.stringify(_W())}`]` | `width:900, height:720, minWidth:720, minHeight:560`，`title:"Configure Third-Party Inference…"` | **第三方推理配置窗（Custom3p Setup）**：`createSetupWindow`，`ji(P8.webContents,ki.CUSTOM3P_SETUP)` |
| 9 | `index.chunk-BkhOOUzl.js` L13 C5160408 | `kFa()` → `computerUseTeach.js` | `transparent:!0, frame:!1, alwaysOnTop:!0, focusable:!1, acceptFirstMouse:!0` | 全屏 workArea | **Computer Use 教学引导（cu-teach）**：`setIgnoreMouseEvents(!0,{forward:!0})`，实现 `next/exit/mouseEnter/mouseLeave` |
| 10 | `index.chunk-BkhOOUzl.js` L13 C5187179 | `AIa()` → `watchRecordChooser.js` | `modal:!0, frame:!1, resizable:!1` | `width:TIa`，`title` 上下文相关 `"Share screen"` / `"Record a skill"` | **录屏选择器**：`setMicPreview/stopMicPreview/choose/reportContentShortfall` |
| 11 | `index.chunk-BkhOOUzl.js` L13 C5218853 | `CRa()` → `watchRecordPill.js` | `transparent:!0, frame:!1, alwaysOnTop:!0, type:"panel", movable:!0` | `width:yRa, height:bRa` | **录屏悬浮胶囊（pill）**：`done/discard/toggleMic/reportProcessingWidth` |
| 12 | `index.chunk-CKVIceRl.js` L1 C974 | `.vite/build/mainView.js` | `additionalArguments:[t.IC()]` | `width:520, height:340`（`var i=520,a=340,o=48`），`title:"Verify sign-in code"` | **设备码登录窗**：`ji(s.webContents, t.d5.CUSTOM3P_DEVICE_CODE)`，居中偏上定位 |
| 13 | `index.chunk-C3-1_wcm.js` L1 C11417 | `.vite/build/buddy.js` | `resizable:!1, minimizable:!0, maximizable:!1, titleBarStyle:"hiddenInset", backgroundColor:"#F4F3EE"` | `width:700, height:460`，`title:"Hardware Buddy & Maker Devices"` | **硬件 Buddy 配对窗**：`loadFile("buddy_window/buddy.html")`，有 BLE 指数退避重连 `Math.min(2e3*2**d,6e4)` |
| 14 | `index.chunk-iIuD4C2X.js` L1 C6552 | `A()`（函数返回，未解析出路径） | `contextIsolation:!0, nodeIntegration:!1, sandbox:!0` | 未取到 | **Microsoft 365 / MCP 授权窗**：该文件内含 `builtinMcpRegistry()`、`pendingOAuthMcpConfig`、`No built-in Microsoft 365 server named "${t}"` |

**补充：`find_in_page` 与 `local_exec_consent` 未在 14 个节点内出现。** REA 的 `limitations` 明确写了 `.vite/build/findInPage.js` 因资源预算被跳过语义分析；`localExecConsent.js` 虽被解析（有 ipc/bridge 观测）但**没有落 browser_window 节点**。两者确实存在：HTML 已解包（[find-in-page.html](/tmp/claude-rea/x/.vite/renderer/find_in_page/find-in-page.html)、[localExecConsent.html](/tmp/claude-rea/x/.vite/renderer/local_exec_consent/localExecConsent.html)），preload 也已抽取。因此**真实窗口数 ≥ 16**，REA 的 14 是主进程里静态可解的 `new BrowserWindow` 字面量数，不是窗口总数。

### 2.2 六类窗口职责汇总

| 窗口 | preload | 职责（证据） |
|---|---|---|
| **main_window** | `mainWindow.js`（标题栏/壳） + `mainView.js`（业务 WebContentsView） | 原生标题栏 + 错误 UI + 启动骨架屏，正文从 claude.ai 加载；暴露全量 `claudeApp*` API（§3.2） |
| **quick_window** | `quickWindow.js` | Quick Entry 悬浮输入，面板级置顶（`pop-up-menu`），`requestDismiss` / `requestSkooch` |
| **about_window** | `aboutWindow.js` | 版本号/构建属性展示、Get Support、Help 跳转；`ancientJournal`（彩蛋，原文名） |
| **buddy_window** | `buddy.js` | 硬件 Buddy 蓝牙配对：扫描/配对/PIN/设备状态/安装/遗忘设备 |
| **find_in_page** | `findInPage.js` | 页内查找条：`findInPage` / `stepToMatch` / `stopFindInPage` / `endFindSession` / `focusInput` / `blurInput` / `clearQuery`，另带 `FindInPage_$_density_$store` 密度状态同步 |
| **local_exec_consent** | `localExecConsent.js` | **主进程自持的同意弹窗**。HTML 注释原文：*"Main-owned confirm for direct-MCP Connect / Disconnect, the standing Chat grant, and 3P's bootstrap-settings prompt… Deliberately dependency-free (no windowBase / React): the consent surface must not run any stack the web-origin renderer could influence. Content arrives via query; the page renders it with textContent only."* |

### 2.3 webPreferences 基线

REA 统计 `explicit_web_preferences: 37`。逐条读源码后，**无框浮层类与主业务类走两套基线**：

- **主业务/常规窗**（#3/#7/#10/#11/#14）：`contextIsolation: true, nodeIntegration: false, sandbox: true`
- **面板/浮层类**（#4/#5/#9）：`transparent + frame:false + alwaysOnTop + skipTaskbar`，**且未显式写 sandbox**（由 `additionalArguments:[iK()]` 注入特性开关）
- **继承型**（#8/#12/#13）：只写 `preload` + `additionalArguments`，其余继承 `t.webPreferences`

**未找到** `preload_entrypoints: 0` —— REA 无法把 `n.default.join(a.app.getAppPath(),".vite/build/xxx.js")` 折叠成常量串（它记的是 `preload_path: null`），故统计为 0。本报告已在表中手工展开这 5 个路径。

### 2.4 utility_processes: 4

| 定义位置 | service_name / 表达式 |
|---|---|
| `index.chunk-BkhOOUzl.js` L13 C161685 | `module_expression: "e"`（未解析） |
| `index.chunk-BkhOOUzl.js` L13 C1387366 | `module_expression: "r"`（未解析） |
| `index.chunk-BkhOOUzl.js` L13 C3083329 | **`"Claude Desktop Shell Environment Extractor"`** |
| `index.chunk-iyOh8m2u.js` L1 C8276 | **`t.vU("pty-host","ptyHostWorker.js")`** |

`resolved_utility_entrypoints: 0` —— 前三条的 `module_path` 均为 `null`，静态不可恢复，如实记录。

---

## 3. IPC 面

### 3.1 通道命名规则（这是本次最关键的结构发现）

通道名形如（原文，取自 [mainView.js](/tmp/claude-rea/js/.vite/build/mainView.js)）：

```
$eipc_message$_<uuid>$_<namespace>$_<Controller>$_<method>
```

两个 UUID 前缀在源码里是**字面量常量**：

```js
// mainView.js 原文
var n="$eipc_message$_a3829cb6-7c80-4175-99fe-190ca39844be_$_claude.settings_$_"
var _="$eipc_message$_a3829cb6-7c80-4175-99fe-190ca39844be_$_claude.simulator_$_"
var b="$eipc_message$_a3829cb6-7c80-4175-99fe-190ca39844be_$_claude.officeAddin_$_"
var S="$eipc_message$_a3829cb6-7c80-4175-99fe-190ca39844be_$_claude.engineSurface_$_"
var k="$eipc_message$_a3829cb6-7c80-4175-99fe-190ca39844be_$_claude.web_$_"
```

调用点是 `e.ipcRenderer.invoke(k+"Account_$_setAccountDetails",t)` 这种「常量前缀 + 字面量后缀」的拼接。REA 把整个表达式记为 `dynamic`（`literal_channels: 10`），但**两半都是字面量，可安全常量折叠**。

### 3.2 命名空间分布（1327 条通道）

| 命名空间 | 通道数 | UUID 前缀 | 归属 |
|---|---:|---|---|
| `claude.web` | 1000 | `a3829cb6` | 主业务（会话/协作/窗口/文件系统…） |
| `claude.settings` | 142 | `a3829cb6` | 设置与受管配置 |
| `claude.simulator` | 65 | `a3829cb6` | 模拟器（computer-use 相关） |
| `claude.engineSurface` | 25 | `a3829cb6` | 引擎 UI 面（pane/message/scroll…） |
| `claude.internal.computerUse` | 22 | `a3829cb6` | CuTeach / CuWatchRecord* |
| `claude.internal.ui` | 14 | `a3829cb6` | MainWindowTitleBar / QuickWindow / AboutWindow |
| `claude.officeAddin` | 14 | `a3829cb6` | Office 加载项文件通道 |
| `claude.buddy` | 14 | `a3829cb6` | 硬件 Buddy + BLE 传输 |
| `claude.internal.sableOtter` | 11 | `a3829cb6` | SableOtterHud |
| `claude.internal.findInPage` | 7 | `a3829cb6` | 页内查找 |
| **`electron_window`** | **7** | **`fcb91d11`** | **窗口管理器（独立 UUID，见下）** |
| `claude.hybrid` | 3 | `a3829cb6` | DesktopIntl（跨窗口共用） |
| `claude.designPdf` | 1 | `a3829cb6` | DesignPdf 打印 |
| `claude.internal.localExecConsent` | 1 | `a3829cb6` | 本地执行同意 |
| `claude.skills` | 1 | `a3829cb6` | Skills 预览 |

**注意 `electron_window` 用了不同的 UUID（`fcb91d11-972d-4fd6-b90b-72739699bff5`）**，形状也不同（`$eipc_message$_<uuid>$_electron_window_$_WindowManager_$_<method>`）。这 7 条是 REA 唯一判为 `literal` 的一批（预拼接完整串），对应窗口注册协议。

### 3.3 Top 控制器（按通道数）

| 控制器 | 通道数 | 命名空间 | 用途（据方法名） |
|---|---:|---|---|
| `LocalSessions` | 339 | claude.web | 本地会话全生命周期：创建/归档/信任校验/SSH/分支切换/PR |
| `LocalAgentModeSessions` | 128 | claude.web | 本地 Agent 模式会话、直连 MCP 授权 |
| `Launch` | 108 | claude.web | 预览/artifact/远端浏览器工具/allowlist |
| `Simulator` | 65 | claude.simulator | 模拟器：截图/快捷键/设备/同意 |
| `Custom3pSetup` | 35 | claude.settings | 第三方推理配置 |
| `CoworkSpaces` | 34 | claude.web | Cowork 空间 |
| `Extensions` | 28 | claude.settings | 桌面扩展（DXT）增删与进度 |
| `EngineSurface` | 24 | claude.engineSurface | UI ↔ 引擎：pane/message/scroll/input |
| `ClaudeAiImport` | 24 | claude.settings | 从 claude.ai 导入 |
| `MenuEvents` | 21 | claude.web | 菜单事件回灌渲染层 |
| `FileSystem` | 19 | claude.web | 文件/目录选择、缩略图、系统路径 |
| `WindowControl` | 16 | claude.web | 窗口控制（与 §3.5 的 bridge 成员一一对应） |
| `WindowState` | 12 | claude.web | 缩放/可见性/全屏状态同步 |

**抽样通道名（全部可在 [02-ipc-channels.txt](/tmp/claude-rea/out/02-ipc-channels.txt) 查到全量）**

| 控制器 | 方法名抽样 |
|---|---|
| `LocalSessions` | `createSessionFile` `archive` `changeCwd` `checkTrust` `checkRemoteTrust` `answerPendingCwdTrust` `addDirectories` `commitWipForBranchSwitch` `checkGhAvailable` `createPrReviewComment` `createScratchWorkspace` `beginTearOffHalo` `canStartWslSession` `clearSSHHostToolGrants` `ackSSHPasswordRequestShown` `classifyTccFolderKind` |
| `Launch` | `addPreviewAllowedOrigin` `armPreviewLiveStream` `callRemoteBrowserTool` `capturePreviewScreenshot` `acceptChromeImportSharedOffer` `admitRemotePaneOriginOnce` `addServerFromCandidate` |
| `AutoUpdater` | `checkForUpdates` `restartToUpdate` `restartToUpdateWhenIdle` `cancelPendingRestart` `getRunningLocalSessions` `getRunningLocalSessionCount` `requestAncientJournal` `ancientJournalState` |
| `WindowControl` | `show` `close` `focus` `resize` `captureScreenshot` `setThemeMode` `setIncognitoMode` `setModalScrimActive` `reportFrameLayout` `reportGoMenuAreas` `reportSidebarMenuState` `reportSplitViewMenuState` `reportReopenClosedSessionMenuState` `reportCloseMenuTarget` `reportModalScrim` `reportSidebarPlaceholder` |
| `MenuEvents` | `closeSessionPane` `closeWindow` `cycleSession` `editCommand` `editCommandUnclaimed` `claimEditCommands` `findInFiles` `backgroundTasksShortcut` |
| `MCP` | `getMcpServersConfig` `getMcpServersConfigWithStatus` `mcpConfigChange` `mcpStatusChanged` `isLocalDevMcpEnabled` `revealConfig` `revealLogs` `revealServerLog` |
| `Simulator` | `attach` `checkSetup` `checkAndroidSetup` `captureScreenshot` `captureShortcut` `captureThumbnailAction` `consentAsk` `awaitQuitRestart` |
| `FileSystem` | `browseFile` `browseFiles` `browseFolder` `browseFolders` `getSystemPath` `getLocalFileThumbnail` `exportLocalFileToGoogleDrive` `appInfoForExtension` |

### 3.4 六个窗口各自的通道集（完整，小到可全列）

| 窗口 | 命名空间 | 通道 |
|---|---|---|
| **MainWindowTitleBar**（`claude.internal.ui`） | | `titleBarReady` `updateTitleBar` `showLoadError` `hideLoadError` `requestMainMenuPopup` `requestReloadMainView` `requestRestartApp` |
| **QuickWindow**（`claude.internal.ui`） | | `requestDismiss` `requestSkooch` |
| **AboutWindow**（`claude.internal.ui`） | | `openHelp` `getSupport` `getAppName` `getBuildProps` `ancientJournal` |
| **FindInPage**（`claude.internal.findInPage`） | | `findInPage` `stepToMatch` `stopFindInPage` `endFindSession` `focusInput` `blurInput` `clearQuery` |
| **LocalExecConsent** | `claude.internal.localExecConsent` | `LocalExecConsent_$_choose`（唯一一条，REA 记为 literal） |
| **DesignPdf** | `claude.designPdf` | `DesignPdf_$_printFrameToPdf`（唯一一条，REA 记为 literal） |
| **MainWindowTitleBar/About/Quick/FindInPage 共用** | `claude.hybrid` | `DesktopIntl_$_getInitialLocale` `DesktopIntl_$_localeChanged` `DesktopIntl_$_requestLocaleChange` |
| **CuTeach**（`claude.internal.computerUse`） | | `show` `hide` `next` `exit` `working` `mouseEnter` `mouseLeave` `reassertHover` |
| **CuWatchRecordChooser** | | `choose` `inputDevices` `micState` `setMicPreview` `stopMicPreview` `reportContentShortfall` |
| **CuWatchRecordPill** | | `done` `discard` `toggleMic` `micState` `micError` `processing` `timeWarning` `reportProcessingWidth` |
| **SableOtterHud**（`claude.internal.sableOtter`） | | `render` `resize` `button` `submit` `tab` `escape` `paste` `fieldChanged` `removePill` `settings` `levels` |

### 3.5 窗口管理器协议（独立 UUID，7 条全文）

```
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_RegisterWindow
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_UnregisterWindow
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_UpdateWindow
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_DestroyWindow
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_WindowAction
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_GetWindowState
$eipc_message$_fcb91d11-972d-4fd6-b90b-72739699bff5_$_electron_window_$_WindowManager_$_WindowEvent
```

前 6 条 `side: renderer / operation: invoke`（renderer → main 注册与查询），第 7 条 `WindowEvent` 是 `side: renderer / operation: on`（main → renderer 广播）。位置：`mainView.js` L1 C157647–158598。

### 3.6 诚实口径：抽不到的部分

| REA 口径 | 数 | 本次结论 |
|---|---:|---|
| `ipc.operations` | 1535 | 主进程侧 `index.chunk-BkhOOUzl.js` 的 `static_analysis.electron.ipc[]` 实测有 **1421 条**条目 |
| `literal_channels` | 10 | 已全部列出（§3.4 的 2 条 + §3.5 的 7 条 + `electron-store-get-data`） |
| `dynamic_channel_operations` | 1524 | **本次恢复 1327 条确定通道名**（常量折叠），剩余约 198 条确实是 `i` / `r` / `n` / `t` 这类**单变量通道**（`channel_expression: "i"` 出现 31 次、`"r"` 6 次、`"n"` 2 次、`"t"` 1 次）—— 这些变量由运行时 `setImplementation()` 注入，静态不可恢复，**如实标注为未找到** |
| `main_handlers` | 3 | 主进程 `ipcMain.on/handle` 只解析出 3 个 —— 因为本 app 用 `contextBridge` + `setImplementation` 的自定义分发，**不走裸 ipcMain**，故 main 侧 handler 天然稀少 |
| `renderer_listeners` | 231 | 与 `on` 操作对应 |
| `sender_validations` | 63 | 63 处 `process-id` 校验（`mechanism: "comparison:===" / "!=="`，期望值 `e.sshRemoteProcessId`）—— 这是**发件人身份校验**，用于 SSH 远端进程场景，值得单独关注 |

**唯一真正不可恢复的**：`channel_expression` 为裸变量（`i`/`r`/`n`/`t`）的约 40 个节点。这些是 `xxx.for(webContents).setImplementation({...})` 生成的响应端监听，通道名由框架在运行时拼装。

---

## 4. contextBridge 面

### 4.1 REA 口径 vs 实测

REA：`context_bridge_apis: 52`、`exposed_api_members: 37`。graph 里 `kind=context-bridge-api` 只有 **19 个节点**（其余在 `static_analysis.electron.context_bridge_apis[]` 里，未提升为节点）。52 是**调用点总数**，19 是去重后的节点数，两者不矛盾。

### 4.2 `mainView.js` 全量暴露面（渲染层能调什么——最有价值的一张表）

源码 `exposeInMainWorld(...)` 原文（[mainView.js](/tmp/claude-rea/js/.vite/build/mainView.js)）：

| API key | 成员 | 说明 |
|---|---|---|
| **`claudeAppBindings`** | `registerBinding` `unregisterBinding` `connectToMcpServer` `listMcpServers` `openMcpSettings` | MCP 绑定 |
| **`electronWindowControl`** | `show` `close` `focus` `resize` `captureScreenshot` `setThemeMode` `setIncognitoMode` `setModalScrimActive` `reportFrameLayout` `reportGoMenuAreas` `reportModalScrim` `reportCloseMenuTarget` `reportSidebarMenuState` `reportSidebarPlaceholder` `reportSplitViewMenuState` `reportReopenClosedSessionMenuState` | 窗口控制（与 §3.3 `WindowControl` 通道一一对应） |
| **`electronIntl`** | `getInitialLocale` `onLocaleChanged` `requestLocaleChange` | 国际化 |
| **`buddyBle`** | `pair` `disconnect` | 硬件 Buddy 蓝牙 |
| **`claudeAppSettings`** | `filePickers` | 文件选择器 |
| **`desktopBootFeatures`** | （dynamic，`unknown_members:1`） | 启动特性开关 |
| **`desktopManagedConfig`** | （dynamic） | 受管配置（MDM） |
| **`desktopEnterpriseConfig`** | （dynamic） | 企业配置 |
| **`desktopTelemetryConfig`** | （dynamic） | 遥测配置 |
| **`desktopDeviceClass`** | `t.deviceClass` | 设备分级 |
| **`desktopPreferredLanguages`** | `t.preferredSystemLanguages` | 系统语言 |
| **`process`** | （dynamic，wrapper 替换） | 进程信息 |
| **`gr`**（key 为变量） | `isActive` | 未解析出字面量 key |
| （8 处 `exposeInMainWorld(t,n)`） | dynamic | key 与成员均为变量，静态不可恢复 |

源码原文证据：

```js
exposeInMainWorld("buddyBle",{pair:kr,disconnect:Er}
exposeInMainWorld("claudeAppBindings",{registerBinding:(t,n
exposeInMainWorld("claudeAppSettings",Pr
exposeInMainWorld("process",$
exposeInMainWorld("desktopBootFeatures",n
exposeInMainWorld("electronWindowControl",A
exposeInMainWorld("electronIntl",D
```

### 4.3 其余 preload 的暴露面

| 文件 | API key | 成员 |
|---|---|---|
| **mainWindow.js** | `process` | （dynamic） |
| | `desktopEssentialTelemetryDisabled` | （dynamic） |
| | **`desktopBootPlaceholder`** | **`shellZoomFactor`**（+2 个未解析成员） |
| **quickWindow.js** / **aboutWindow.js** | `process`、`desktopEssentialTelemetryDisabled` | （dynamic） |
| **localExecConsent.js** | （key 为变量 `t`） | 1 个未解析成员 |
| **designWindow.js**（`omeletteDesktopPdf`） | **`printFrameToPdf`** | 经 `javascript-expression` 节点证实：入口 `omeletteDesktopPdf.printFrameToPdf` → 终点 `electron.ipcRenderer.invoke`，通道 `…claude.designPdf_$_DesignPdf_$_printFrameToPdf`，且**带来源校验条件** `(()=>{try{return n(window.location)}catch{return!1}})()` |
| **buddy.js**（`buddy`） | **`getPathForFile`** | object-literal |
| **coworkArtifact.js**（`cowork`） | **`askClaude` `callMcpTool` `runScheduledTask`** | object-literal |
| **claudePagePreview.js**（`claudeDesktopArtifactPane`） | **`chrome` `embedded` `platform`**（+1 未解析） | artifact 预览面 |

**`unknown_members: 1` 的含义**：REA 看到了一次 `exposeInMainWorld` 调用但解析不出成员名，一律计 1，**不代表"有 1 个隐藏成员"**。上述表中已如实标注。

### 4.4 暴露面小结

渲染层可见的**具名**能力共 4 组：`claudeAppBindings`（MCP）、`electronWindowControl`（窗口，16 个成员）、`electronIntl`（语言）、`buddyBle`（蓝牙），加上 `omeletteDesktopPdf.printFrameToPdf`、`buddy.getPathForFile`、`cowork.{askClaude,callMcpTool,runScheduledTask}`、`claudeDesktopArtifactPane.{chrome,embedded,platform}` 与各 `desktop*` 只读配置对象。

---

## 5. UI 文案清单

### 5.1 采集方法

全部走 react-intl 的 `defaultMessage`（**英文原文，非运行时翻译**）：

| 文件 | 条数 | 出处 |
|---|---:|---|
| [index.chunk-BkhOOUzl.js](/tmp/claude-rea/js/.vite/build/index.chunk-BkhOOUzl.js)（主进程） | 1153 | 菜单、错误、设置提示 |
| [index.pre.js](/tmp/claude-rea/js/.vite/build/index.pre.js)（受管配置 schema） | 573 | 设置项标签、placeholder、管理员说明 |
| **合计（按 id 去重后的并集）** | **1153** | [02-ui-strings.tsv](/tmp/claude-rea/out/02-ui-strings.tsv) |

> **去重说明（重要）**：`index.pre.js` 的 573 条 id **全部**被 `index.chunk-BkhOOUzl.js` 包含，且同 id 的文案值逐条一致（比对结果 `missing=0, mismatch=0`）。二者是同一份消息表的两处打包副本 —— `index.pre.js` 在加载主 bundle 之前先加载了自己的 i18n 副本。因此真实去重后的文案总数是 **1153**，不是 1153+573。

另从渲染层 bundle 直接抽到一批文案（非 intl）：FindInPage、BuddyWindow、AboutWindow、MainWindowPage、localExecConsent。

### 5.2 应用菜单（原文 + 快捷键）

从 `Menu.buildFromTemplate` 的模板组装函数 `QPi` 还原（源码原文）：

```js
QPi=async e=>[await c8r(),HCi(e),aSi(),IPi(e),qCi(e),...BJ()?[await Jei()]:[],await Yei(),Zei(),ZPi(),DMi(e)]
```

即顺序为：**App(应用名) → File → Edit → View → Go → [Cowork] → Prototypes(隐藏) → Debug(隐藏) → Window → Help**。

| 菜单 | 子项（原文） | 快捷键 |
|---|---|---|
| **{App}** | `About {appName}` / `Settings…` / … / `Services` / `Hide {appName}` / `Hide Others` / `Show All` / `Quit {appName}` | `CmdOrCtrl+,`（Settings）、`CmdOrCtrl+Q`（Quit） |
| **File** | `New Chat` / `New Task` / `New Session`（按当前面切换）、`New Session in New Window`、`New Side Chat`、…、`Close Window` / `Close Session` / `Close Pane` / `Close Chat` / `Close Task` / `Close Page`、`Reopen Closed Session` | `CmdOrCtrl+N`、`CmdOrCtrl+W`、`CmdOrCtrl+Shift+W`、`CmdOrCtrl+Shift+T` |
| **Edit** | （`iSi("mac")` 标准编辑项）、`Find…` / `Find Next` / `Find Previous` | `CmdOrCtrl+F` / `CmdOrCtrl+G` / `CmdOrCtrl+Shift+G` |
| **View** | `Command Palette…`、`Show Sidebar`/`Hide Sidebar`、`Reload`、`Enter Full Screen` / `Exit Full Screen` | `CmdOrCtrl+K`、`CmdOrCtrl+B`、`CmdOrCtrl+R`、`Control+Command+F` |
| **Go** | `Back` / `Forward` / `Search…` | `Command+[` / `Command+]` / `Command+Shift+[` / `Command+Shift+]` / `Command+Shift+K` |
| **Window** | `Minimize` / `Zoom` / `Show Main Window` / `Bring All to Front` | （role 默认） |
| **Help** | `Claude Help`、`Keyboard Shortcuts`、`Get Support` | `CmdOrCtrl+/` |
| **Debug**（`visible:!1`） | `Uei()`、`Copy URL` | — |
| **Prototypes**（`visible:!1`） | 动态 `getPrototypeMenuItems()` | — |
| **Dock 菜单**（`tFi`） | `Show App` / … / `Quit {appName}` | — |

其余实测到的 accelerator：`CmdOrCtrl+C/X/V/Z/Shift+Z/Shift+V/A`、`CmdOrCtrl+0/+/-/=`、`CmdOrCtrl+\`（Close Pane）、`CmdOrCtrl+Shift+O`、`CmdOrCtrl+Alt+Shift+V`、`CommandOrControl+Alt+I`（DevTools）、`CmdOrCtrl+num0/numadd/numsub`（缩放，含 numpad 变体）。

`Close Pane` 一项的源码原文（含快捷键与启用条件）：

```js
{label:X().formatMessage({defaultMessage:"Close Pane",id:"bRbh5As7Cl"}),accelerator:"CmdOrCtrl+\\",registerAccelerator:n?.registerAccelerator,enabled:t&&r.closePane.enabled,click:(e,t,r)=>FQ(r,(e=>e.dispatchCloseSessionPane()),RPi(n))}
```

### 5.3 设置项标签（`index.pre.js` 的受管配置 schema）

这批是**给 IT 管理员看的受管配置**（MDM/JSON schema），价值最高：

| 文案（原文） | 语境 |
|---|---|
| `Allow Chat` / `Allow Code` / `Allow Auto mode` / `Allow Cowork` / `Allow Quick Write` | 功能开关 |
| `Allow user-added MCP servers` / `Allowed plugin MCP servers` / `Blocked plugin MCP servers` / `Managed MCP servers` | MCP 治理 |
| `Allow user-added plugins` / `Allow user-added plugin marketplaces` / `Organization plugin settings` / `Strict plugin-only customization` | 插件治理 |
| `Disabled built-in tools` / `Disable bypass permissions mode` / `Disable local Code sessions` / `Disable Claude.ai sign-in` | 安全收紧 |
| `Block auto-updates` / `Auto-update enforcement window` / `Configuration relaunch window` / `Maximum version` | 更新治理 |
| `Block essential telemetry` / `Block nonessential telemetry` / `Block nonessential services` / `Anthropic telemetry` / `Desktop telemetry export level` | 遥测 |
| `OpenTelemetry collector endpoint` / `OpenTelemetry exporter protocol` / `OpenTelemetry resource attributes` / `Telemetry attribute length limit` | OTLP |
| `Allowed workspace folders` / `Block reads outside working directories` / `Remember allowed files (sec)` / `Allowed egress hosts` | 沙箱边界 |
| `SSH host allowlist` / `Block WSL sessions` / `Allow persistent tool approvals` / `Enable IPv6 in the workspace VM` | 执行环境 |
| `Allowed sites in the built-in browser` / `Allow all sites except blocked sites` / `Block all sites except allowed sites` / `Allow the built-in browser` | 内置浏览器 |
| `Allow Hardware Buddy devices` / `Allow scheduled tasks` / `Allow keep awake` / `Allow Developer Mode` | 特性开关 |
| `Credential helper` / `Helper script` / `Helper script (Windows)` / `Helper script arguments` / `Helper cache TTL (sec)` / `Helper refresh buffer (sec)` | 凭据外置 |
| `Self-hosted execution` / `Self-hosted execution URL` / `Model catalog URL` / `Model pricing` / `Max tokens per window` / `Token cap window` | 自托管推理 |
| `Microsoft 365` / `Microsoft 365 native sign-in broker` / `Disabled Office applications` / `Disabled add-in features` | Office 集成 |
| `Enable import` / `Enable session export` / `Allow user-created skills` / `Disable bundled skills and workflows` | 数据与技能 |

**管理员向的说明文案**（这几条写得很用心，是最有信息量的样本）：

> `The default host-native mode starts faster and works behind restricted networks. Shell commands run inside the VM; file tools run on the host with path-based access control. Enable this only if your security review requires the agent loop itself to run in the VM.`

> `Usage analytics, which include no message content, help Anthropic prioritize improvements for third-party inference. Turning this on also blocks diagnostic-report uploads. People can still export reports to a file.`

> `This disables connector icons, hosted artifact previews and MCP Apps widgets, and also turns spellcheck off on Linux. Artifacts still render locally. Connectors that return MCP Apps show the text tool result instead of the widget.`

> `Devices on a newer version cannot open Claude, and security fixes in newer releases do not install, until you raise or remove this cap.`

> `Header “{name}” looks like a credential. Use the headers helper script so the secret isn’t stored in the config file.`

### 5.4 错误 / 空态 / 引导文案

| 文案（原文） | 类别 |
|---|---|
| `Claude tried to start several times without success. If Claude still won't start, choose Help → Get Support and mention error code {exitCode}.` | 启动失败 |
| `Claude crashed repeatedly. Try restarting the app. If it keeps crashing, reinstall Claude from claude.ai/download or choose Help → Troubleshooting → Disable Hardware Acceleration.` | 崩溃（macOS 路径） |
| `Claude crashed repeatedly. Try restarting the app. If it keeps crashing, reinstall Claude from the Microsoft Store or from your organization's app catalog.` | 崩溃（Windows 路径） |
| `Claude couldn't reach the update server. If you're on a work network, a firewall or proxy may be blocking {hosts} — ask your IT team to allow them. Otherwise, check your connection and try again, or download the latest version from claude.ai/download.` | 更新失败 |
| `Failed to check for updates: {error}` / `Last Update Attempt Failed` / `No Update Available` | 更新 |
| `There was an error reading or parsing claude_desktop_config.json: {error}` | 配置损坏 |
| `There was an error reading or parsing developer_settings.json: {error}` | 开发者配置损坏 |
| `Couldn't reload MCP configuration. Please check the logs for more details.` / `MCP Configuration Reload Failed` | MCP |
| `The extension couldn't be installed. Please ensure the extension folder is valid and try again. The error was: {errorMessage}` / `No manifest.json found in extension file` / `Extension preview failed` | 扩展 |
| `This version of Cowork doesn't support disk cleanup yet. Restart the app and try again.` / `Cowork isn't running, so there's nothing to clean up right now.` / `No space could be freed. Caches and temporary files are already clean.` | Cowork 空态 |
| `No CLI sessions to import` / `{count} session(s) couldn't be imported. Check the logs for details.` | 导入空态 |
| `Sign-in was cancelled.` / `Claude couldn't confirm which organization you signed in to. Try signing in again.` / `Couldn't open that session. Sign in to the desktop app and try again.` / `Couldn't open that session. Check your network connection and try again.` | 登录 |
| `Choose {cancelLabel} unless this is your account and your browser just confirmed that you approved the sign-in. Nothing has been saved yet.` | 设备码登录防钓鱼 |
| `The sign-in gave no address for the account that approved the code, so choose {continueLabel} only if you entered the code yourself and your browser confirmed it. Nothing has been saved yet.` | 设备码登录防钓鱼 |
| `The Chrome extension's session expired. Open the Claude extension in Chrome and sign in again, then retry.` | Chrome 扩展 |
| `Your Google Cloud credentials were rejected. Refresh your application-default credentials and try again.` | 云凭据 |
| `We failed to open a link using your system's default application for this type of link. This is often caused by the default app misbehaving or your operating system refusing the link itself. {url}` | 外链 |
| `{count} Couldn't attach the file from Quick Entry, so nothing was sent. Check that it's still in place and is a file under {maxFileMb} MB.` | Quick Entry |
| `Your message wasn't sent because the signed-in account changed. Try again.` | 发送失败 |
| `Up to {limit} folders on this computer can be listed for your phone and claude.ai. Remove one to make room, then try again.` | 配额 |
| `To stay within the folder limit, “{name}” will no longer be listed.` | 配额 |
| `No SSH host is allowed in this configuration, so Code may have nowhere to start a session. Add hosts to the SSH host allowlist here. Claude Code's own managed settings count only while it is unset here.` | 空配置告警 |
| `Crash and error reports are how we diagnose failures specific to your inference setup. Support turnaround will be slower without them.` | 遥测劝导 |
| `Automatic installation needs … Without one this marketplace is treated as available: it is listed, but this setting installs nothing.` | marketplace |

### 5.5 渲染层窗口文案（非 intl，直接抽自 bundle）

| 窗口 | 文案（原文） |
|---|---|
| **FindInPage** | `Find in page` `Previous match` `Next match` `Close find bar` |
| **MainWindowPage**（错误态） | `Couldn't connect to Claude` `Check your network connection` `Retrying automatically…` `Restart Claude` |
| **MainWindowPage**（彩蛋） | `Press {key} to play` |
| **About** | `Copy version {version} to clipboard` `Copied version to clipboard` `Failed to copy version to clipboard:` `Get support` `Failed to fetch build properties:` |
| **Buddy** | `Hardware Buddy & Maker Devices` `Connect maker devices to Claude` `Choose your Buddy` `Scanning for 5s…` `Tap to pair:` `None found. Make sure yours is on and nearby.` `Pair with {name}` `Enter the 6-digit code shown on the device's screen to connect.` `Pairing code` `No buddy paired` `Connection is unencrypted` `No response` `Device did not respond` `Name saved` `Can't read folder, or it's empty or too large` `Drop a data folder here{br}or click to choose` `Send to Device` `What is this?` `Reference implementation` `Build your own device` |
| **localExecConsent**（模板串） | `Connect to ${connectorName}?` `Disconnect from ${connectorName}?` `Let this app use ${connectorName}?` `Your organization's configuration server delivered ${t} setting${…} that can run on this device, change where you sign in, or change where your requests are sent:` |
| **QuickWindow** | `What can I help you with today?` |
| **ComputerUse**（Buddy 心跳协议说明，bundle 内） | `The desktop apps send a heartbeat snapshot whenever something changes, plus a keepalive every 10 seconds:` `When <code>prompt</code> is present, your device can return a response:` |

### 5.6 其它值得记的文案

- **窗口标题（源码里的字面量）**：`About Claude`、`Code`、`Hardware Buddy & Maker Devices`、`Verify sign-in code`、`Configure Third-Party Inference…`、`Record a skill`、`Share screen`（`r==="context"` 时的分支）
- **开发者模式确认弹窗**（原文）：
  - title: `Enable Developer Mode?`
  - message: `Developer mode allows access to developer tools and debugging features. Only enable this if you know what you're doing.`
  - buttons: `Enable` / `Don't Enable`（`defaultId:1, cancelId:1` — 默认不选启用）
- **签名/安全相关**：`SHA-256`、`Matches a file that has this label.`、`Deny turns the actions off for matching files. Allow turns them off for every other file of that type. Deny wins when both match.`

---

## 6. 结论摘要

1. **架构**：Vite + Electron Forge 打包，主进程是一个 7 MB 的单体 chunk（`index.chunk-BkhOOUzl.js`），V8 code cache 双架构预热（`compile-cache/*.jsc`）。主窗口正文**从 claude.ai 远端加载**，本地只负责壳、标题栏、错误 UI 与原生能力。
2. **窗口**：REA 静态解出 14 个 `new BrowserWindow`；实测至少 16 个（`find_in_page` / `local_exec_consent` 因预算被跳过归入节点）。**窗口注册走统一的 `WindowManager` 协议**（独立 UUID `fcb91d11`），主业务通道走 `a3829cb6`。
3. **IPC**：不是「抽不出」——REA 判 dynamic 是因为它不折叠常量。把 `var n="$eipc…"` 常量折叠后**恢复 1327 条完整通道名**，分 15 个命名空间、约 95 个控制器。真正静态不可恢复的只有约 40 个裸变量通道（`i`/`r`/`n`/`t`，由 `setImplementation` 运行时拼装）。
4. **contextBridge**：渲染层具名能力集中在 `electronWindowControl`(16)、`claudeAppBindings`(5)、`electronIntl`(3)、`buddyBle`(2)，加 `omeletteDesktopPdf.printFrameToPdf`、`cowork.*`、`claudeDesktopArtifactPane.*`。另有 13 处 key 为变量，静态不可恢复。
5. **安全面**：63 处 `process-id` 发件人校验（SSH 远端场景）；`localExecConsent` 刻意零依赖（不跑任何 web 源 renderer 可影响的技术栈）；开发者模式确认弹窗默认 `cancelId:1`（默认不启用）；绝大多数业务窗 `sandbox:true, contextIsolation:true, nodeIntegration:false`。

---

## 附：本次产出的文件

| 文件 | 说明 |
|---|---|
| [02-ipc-channels.txt](/tmp/claude-rea/out/02-ipc-channels.txt) | 1327 条完整通道名 |
| [02-ui-strings.tsv](/tmp/claude-rea/out/02-ui-strings.tsv) | 1153 条 react-intl 文案（`文件 \t id \t 文案`），去重后 |
| [02-channels-by-ns.tsv](/tmp/claude-rea/out/02-channels-by-ns.tsv) | 通道数按命名空间 |
| [02-nodes.json](/tmp/claude-rea/out/02-nodes.json) | graph 节点全量（2251） |
| [02-summary.json](/tmp/claude-rea/out/02-summary.json) | REA summary 段 |
| [js/.vite/build/](/tmp/claude-rea/js/.vite/build/) | 抽取的主进程 + preload JS |
| [x2/.vite/renderer/](/tmp/claude-rea/x2/.vite/renderer/) | 抽取的渲染层 bundle |
