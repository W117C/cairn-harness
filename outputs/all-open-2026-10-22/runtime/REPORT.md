# App 拆分运行期验证 · 2026-10-22

当前生产构建下，修正陈旧 smoke 输入后，交互 23/23、状态隔离 11/11 均通过，主窗口 / 方案弹出窗两条路由通过。没有发现此次 App 拆分引入的运行期失败。

首次 interaction 的 3 条失败已保留，不能抹成首次全绿；它们是原脚本使用错误快捷键导致。该轮退出码 1，23 条断言中 20 条通过。主线程授权后，只修复脚本中 2 个检查器键盘事件 `⌘⌥B` → `⌘⌥I`（影响 3 条断言），原断言与 fixture 不变。完整复验退出码 0，23/23 通过。

## 命令与原始结果

均从仓库根执行，所有 Electron 命令显式清除 `ELECTRON_RUN_AS_NODE`。复用主线程当时的 `pnpm --filter cairn-desktop build` 产物，本子任务没有重新构建。

| 使用路径 | 实际命令（共同前缀 `env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron`） | 退出码 | 结果 |
| --- | --- | --- | --- |
| 交互首次 | `../../outputs/all-open-2026-10-22/runtime/interaction-capture.cjs ../../outputs/all-open-2026-10-22/runtime/interaction` | 1 | 23 条断言，20 通过、3 失败；`interaction.log`、`interaction/checks.json` |
| 状态隔离 | `scripts/state-smoke.cjs ../../outputs/all-open-2026-10-22/runtime/state` | 0 | 11/11；`state.log`、`state/checks.json` |
| 路由 | `scripts/route-smoke.cjs ../../outputs/all-open-2026-10-22/runtime/route/routes.json` | 0 | main / pane=plan 两条路由的 DOM、真实加载资源和错误记录；`route.log`、`route/routes.json` |
| 交互修正后 | `../../outputs/all-open-2026-10-22/runtime/interaction-capture.cjs ../../outputs/all-open-2026-10-22/runtime/interaction-corrected` | 0 | 23/23；`interaction-corrected.log`、`interaction-corrected/checks.json` |

`interaction-capture.cjs` 在内存中运行原 `apps/desktop/scripts/interaction-smoke.cjs`，只在设置返回前追加一次 `shot('07-settings')`，用于补齐要求的设置页截图。它没有改变断言、fixture、等待时间或选择器，也没有写回产品脚本；实际运行的带截图源码在 `interaction-source.cjs`，首次未修正脚本保存在 `interaction-original.cjs`。

编辑时曾将“3 条失败断言”误当作“3 个错误事件”，保护断言因实际仅 2 处匹配而拒绝写入；同 shell 的后续命令意外启动了一轮未修正 smoke，随即 SIGINT 终止（exit 130）。这次中断不计入通过证据，记录在 `interaction-interrupted.log`。随后确认 2 个匹配，完成精确编辑，再跑上表唯一完整的修正后复验。

## 首次失败定位

首次 3 条失败：

- 显式关闭检查器：窗格仍开、偏好写成 0。
- 带恢复窗格重载后检查器保持关闭。
- 关闭后仍可重新打开检查器。

原始读数为 `pref: null`，重载后检查器宽度 320、无 inert；所谓“重新打开”后宽度 420，仍未设置偏好。脚本两次发出 `meta+alt+KeyB`，这实际上切换插件侧栏，并未触发检查器。

当前 `state/app-commands.ts` 的 KeyB 分支映射插件侧栏，KeyI 分支映射检查器；`state/chrome.ts` 的 toggleInspector 仍负责写入 `cairn.inspector.open.v1`。对照拆分前 HEAD 的 `App.tsx`，同样是 KeyB → 插件侧栏、KeyI → 检查器，证明这是原有 smoke 输入陈旧，不是本次搬移造成的契约改变。

修正后读数：关闭偏好 `0`；重载后 pane 存在、宽度 `0`、`inert:true`；重开偏好 `1`、宽度 `420`、`inert:false`。修复 diff 在 `interaction-key-fix.diff`，仅两行键盘输入变化，未改断言或生产源码。

## 覆盖与视觉核对

交互脚本覆盖工具结果披露、流式事件后已展开 DOM 保留、侧栏折叠与搜索、localStorage 重载恢复、快捷栏布局、文件面板入口、面板组合 / 聚焦 / 关闭后的焦点恢复、检查器显式偏好、设置返回的真实 hit-test 与指针点击、窄窗口横向溢出。

状态脚本覆盖反馈 / 置顶的请求期间禁用、重复点击去重、待保存状态可见、每条消息的独立失败回滚、切换会话后的迟到响应隔离、切走再切回后的旧请求隔离。

路由记录显示：主路由有 composer、无 popout，加载主 App chunk；`pane=plan` 有 popout、无 composer，未请求主 App chunk。两路由的 errors 均为空。单次观测 main 就绪约 65.1ms，pane=plan 约 53.5ms；这是本次加载观测，不是性能基准或改进对比。

已经实际读取并目验：

- `interaction-corrected/04-split-panels.png`：亮色，右栏概览与文件 / 方案组合可见。
- `interaction-corrected/06-dark.png`：暗色，窄窗口快捷栏、消息、输入区及文件面板排布正常。
- `interaction-corrected/07-settings.png`：设置页侧栏与内容区域可见，返回按钮位于设置 surface 内。
- 首次 `interaction/01-tools-folded.png`：亮色三栏、停转工具失败说明可见。

所有已完成 smoke 的 renderer 控制台错误数组为空。

## 验证边界

三条脚本使用真实 Electron / Chromium、当前生产 renderer bundle、真实 DOM 和 localStorage，但 preload 使用 `ui-gallery-preload.cjs` 的合成 AgentApi。interaction 使用 `--cairn-interaction-fixture`，state 使用 `--cairn-hardening-fixture`，route 使用基础 fixture。

因此证据证明 renderer 组件、hook 接线、浏览器状态、事件投影和路由资源在这些可控数据下工作；不证明生产 preload / IPC handler、真实模型请求、反馈磁盘写入、后端 session 持久化或外部工具执行。fixture 的“pnpm test 失败”等文字是合成内容，不能算仓库测试运行或实际模型结果。

每条脚本使用新建临时 profile，不读取或清空用户产品配置。只编辑了授权的 `apps/desktop/scripts/interaction-smoke.cjs` 两行；没有改生产源码、规则或提交 git。后续主线程如再次完成工具栏纯拆分构建，只需追加一次 route smoke，不重复全批交互 / 状态检查。
