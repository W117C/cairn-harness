# Claude Desktop IPC 通道：v2 → v3  delta（2026-10-21）

> 对象：v2.42304.2 的 `02-ipc-channels.txt`（上一轮报告，**1327** 条）与 v3.1623.0 的
> `channels-v3.txt`（本轮 `extract-channels.mjs` 产出，**1438** 条）。
> 两份都按同一形状解析：`$eipc_message$_<uuid>$_<namespace>$_<Controller>$_<method>`。
> 这是**静态文本提取**，不是运行时抓包；局限见文末。

## 0. 一句话结论

**v3 在通道层面是 v2 的超集**：按 `Controller+method` 去重后，**新增 97 条、删除 0 条**；
命名空间从 15 个变成 14 个（新增 `claude.telemetry`、`claude.windowVibrancy`，消失的三个
`claude.internal.ui` / `claude.internal.findInPage` / `claude.internal.sableOtter` 是把 controller 搬进了
`claude.internal.computerUse`，不是功能删除）。新增里 **48 条是 `_$store$_getState/update` 状态对**，
剩下 **49 条**才是新能力面。

## 1. 总量与命名空间

| 项 | v2.42304.2 | v3.1623.0 |
|---|---:|---:|
| 原始通道条数 | 1327 | **1438（+111）** |
| 命名空间 | 15 | **14** |
| 按 Controller+method 去重 | 1327 | **1424** |
| 新增 Controller+method | — | **97** |
| 删除 Controller+method | — | **0** |

| 命名空间 | v2 | v3 | 变化 |
|---|---:|---:|---|
| `claude.web` | 1000 | **1061** | +61 |
| `claude.settings` | 142 | **150** | +8 |
| `claude.simulator` | 65 | **72** | +7 |
| `claude.internal.computerUse` | 22 | **66** | +44（含从 ui/findInPage/sableOtter 搬入） |
| `claude.engineSurface` | 25 | **25** | 0 |
| `claude.buddy` | 14 | **18** | +4 |
| `claude.officeAddin` | 14 | **16** | +2 |
| `claude.hybrid` | 3 | **14** | +11（含 DesktopIntl/SableOtter 搬家） |
| `electron_window` | 7 | **7** | 0 |
| `claude.windowVibrancy` | — | **4** | **新命名空间** |
| `claude.telemetry` | — | **2** | **新命名空间** |
| `claude.designPdf` | 1 | **1** | 0 |
| `claude.internal.localExecConsent` | 1 | **1** | 0 |
| `claude.skills` | 1 | **1** | 0 |
| `claude.internal.ui` | 14 | — | 搬入 computerUse |
| `claude.internal.findInPage` | 7 | — | 搬入 computerUse |
| `claude.internal.sableOtter` | 11 | — | 搬入 hybrid / computerUse |

## 2. 49 条非 store 新能力（按控制器分组）

| 控制器 | 新增 | 通道 |
|---|---:|---|
| `CoworkArtifactBridge` | 6 | `askClaude`、`callMcpTool`、`navigateHost`、`openExternalUrl`、`runScheduledTask`、`setEditableFocused` |
| `BuddyBleTransport` | 4 | `log`、`reportState`、`rx`、`tx` |
| `Launch` | 4 | `serveRemoteBrowserSession`、`stopServingRemoteBrowserSession`、`mainAnswersRemoteBrowserAsk`、`remoteBrowserServingEnded` |
| `LimitAutoResume` | 4 | `getLimitAutoResumeState`、`setLimitAutoResumeArmed`、`setLimitAutoResumeHeldSessions`、`limitAutoResumeChanged` |
| `WindowVibrancy` | 4 | `showUnderSidebar`、`clear`、`tintUnderSidebar`、`clearTintUnderSidebar` |
| `CoworkFilePreview` | 3 | `focus`、`isBuiltInViewerAvailable`、`whenContentLost` |
| `LocalSessions` | 3 | `getRemoteBrowserCards`、`readSessionPanelDocumentWithStatus`、`whenShellPtyReads` |
| `Simulator` | 3 | `nativeViewBendsClipped`、`setStatusBar`、`streamFrames` |
| `LocalPlugins` | 2 | `getPluginOptions`、`setPluginOptions` |
| `WindowControl` | 2 | **`reportBootPlaceholderColors`**、`reportTitleRowCenter` |
| `AutoUpdater` | 1 | `getLocalSessionWorkCounts` |
| `ClaudeCode` | 1 | `resolvedSettingsChanged` |
| `CoworkArtifacts` | 1 | `artifactThumbnailChanged` |
| `Custom3pApiKeySignIn` | 1 | `signIn` |
| `Custom3pSetup` | 1 | `showApiKeySignIn` |
| `DeviceRegistry` | 1 | `noteRegistrationOutcome` |
| `DeviceStorage` | 1 | `runCodeCleanupSelected` |
| `LocalAgentModeSessions` | 1 | `retryLocalSkillScan` |
| `MainWindowTitleBar` | 1 | `requestOrganizationSignIn` |
| `MenuEvents` | 1 | `newSideChat` |
| `PrintCallReporter` | 1 | `report` |
| `RendererMemoryReporter` | 1 | `report` |
| `SourceBranchPrefetch` | 1 | `prefetchSourceBranch` |
| `Toast` | 1 | `dismissToast` |

另有 48 条 `_$store$_getState/update` 对（`AutoUpdater`、`BrowserNavigation`、`ClaudeVM`、`Custom3pSetup`、
`GrandPrix`、`Launch`、`LocalAgentModeSessions`、`ManagedConfig`、`RemoteControlServing`、`SupportBundle`、
`ViolinFret`、`WindowState`、`FindInPage`、`ComputerUseLivePreview`、`OfficeAddinFiles`、`CliSessionImport` 等）。
它们是 v3 的「状态仓库」模式：每个 store 一对 getState/update，不是 48 个独立用户功能。

## 3. 对 Cairn 有直接参考价值的四条

1. **`WindowControl_reportBootPlaceholderColors`**：v3 的启动占位底色不是主进程写死，而是 renderer
   把颜色报回主进程。Cairn 现在用 settings.json 的 `theme` 在启动/切换时同步 `nativeTheme.themeSource`，
   让窗口底色与 `prefers-color-scheme` 占位同判据（少一条 IPC）；若以后要支持运行中动态取色，
   再照这条改成 renderer 首帧上报。
2. **`WindowVibrancy_*`**：侧栏下的原生 vibrancy（macOS）是 v3 的外观能力，Cairn 目前没有；
   属于平台特定效果，不在本轮抄。
3. **`MainWindowTitleBar_requestOrganizationSignIn` + `MenuEvents_newSideChat`**：标题栏与菜单事件
   继续走 IPC 而不是 renderer 本地状态，说明 v3 的组织/多窗口面仍在扩张；Cairn 的标题栏是纯 renderer，
   这条差异值得在「多窗口」任务里单独评估。
4. **`CoworkArtifactBridge_*` + `CoworkFilePreview_*`**：v3 把 artifact / 文件预览的宿主交互做成
   独立控制器（9 条），与 Cairn 的 `FilePane` / 预览窗格方向一致；可作为下一步文件面板能力的对照表。

## 4. 方法、可复跑与局限

```bash
node extract-channels.mjs /Applications/Claude.app/Contents/Resources/app.asar channels-v3.txt
node diff-channels.mjs channels-v2.txt channels-v3.txt
```

- v3 提取：477 个 JS / 40,951,039 B ⇒ 1438 条；`diff-channels.mjs` 归一化后 97 新增 / 0 删除。
- 文件 sha256：`channels-v3.txt` = `92afa0f1…ce99d3`；`channels-v2.txt` = `b17742c0…077f41`。
- **局限（必须连同结论一起读）**：
  - 静态启发式，不执行应用；`setImplementation` 运行时拼装的通道、模板字符串通道、超过 1200 字符
    回溯窗口的赋值都可能漏。
  - v2 清单来自上一轮报告（同一形状、1327 条），不是本轮重跑；两轮提取脚本的实现细节可能不同，
    「0 删除」只保证在**本轮能提取到的 v3 集合**里没有 v2 的 controller+method 消失，不保证运行时不存在。
  - `_$store$_getState/update` 可能是框架按 schema 自动生成，不能逐条读成手写功能。
  - 通道数不等于安全面：没有做 sender 校验/权限的逐条核对。
