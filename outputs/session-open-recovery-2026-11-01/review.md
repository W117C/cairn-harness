# 会话打开失败恢复 · 2026-11-01

延续用户选定的「会话与工作台」方向。检查起点与交付 HEAD 均为 `be9c0be5`；改动位于共享工作树，未提交、未发布，未改 `src/` 核心或 IPC。

原来正文与队列两条读取各自接住错误后，汇合分支始终解除输入锁。队列缓存的移除、编辑、排序与打断按钮也没有读取闸，只有继续发送受保护。真实 renderer 基线确认了这两个缺陷，并确认缺少就地重读入口。

现在失败保留在当前打开请求的序号下，与活动会话切换隔离。正文与队列都读取成功才恢复输入；失败时缓存队列可见但不可修改或派发。新增的恢复提示提供错误详情和「重新读取」，支持键盘；重读成功保留草稿与持久队列。Composer 复用共享锁因类型，输入占位与快捷键提示说明真实锁因，不把失败冒充加载。

界面仍沿用现有布局与令牌：错误靠近输入区，长原因按需展开、限定高度滚动。重读按钮使用正文色，实际亮暗对比度分别为 7.73 / 10.19。没有新依赖、权限变化或后台任务。

## 验证结果

| 面 | 结果 |
| --- | --- |
| 新增回归 `session-open-recovery.test.tsx` | 改前 3 项失败，改后 3 项通过 |
| 聚焦桌面：新回归、send-queue、session-stream-isolation、queue-key、interaction-deadends | 5 文件 / 68 项通过，`--maxWorkers=2` |
| 完整桌面 | 293 文件通过 / 1 文件失败；1980 项通过 / 1 项失败，`--maxWorkers=2` |
| 新 Electron 恢复冒烟 | 19/19 通过；读取期间按钮禁用、两类失败、键盘重读、先读完队列仍等待正文、草稿/持久队列保留、迟到失败隔离、不写队列/不派任务、亮暗与 1440/880 窗口、展开长原因、对比度 |
| 上一轮列表恢复兼容冒烟 | 17/17 通过 |
| 根 typecheck / 桌面 typecheck | 均通过，无类型错误 |
| 隔离 Vite 生产构建 | 通过，产物位于 `/tmp/cairn-session-open-after-20261101` |
| renderer-layer-check / desktop-boundary-check | 通过；工作台源文件仍在既有行数帽内 |
| Impeccable 静态扫描 | 命中两条既有 width 过渡警告，位于 styles.css 159/174，本轮未修改；本轮没有新增命中 |

新冒烟的改前基线为 15 项检查中 7 项失败；后续增加了展开状态和文字对比度检查，最终为 19 项。首次对比度检查发现亮色重读按钮不足 4.5，继承正文色后复验通过。最终 renderer/preload 错误计数为零；Electron 偶发 sandbox-extension 系统提示没有造成渲染或加载错误。

这些 Electron 证据使用真实 renderer、合成 AgentApi、临时 profile。覆盖界面状态与调用边界，不证明生产 preload、真实 Provider、安装包或跨平台行为。

## 既有失败与未运行项

- 完整桌面唯一失败仍是 `apps/desktop/tests/stream-rework.test.tsx:63`，期待已知工具的原始名 `run_shell`，与当前展示规则冲突；本轮开始时独立复现，同一项在改后仍失败。未调整此断言或产品展示以取得绿灯。
- 开始时独立复核 `tests/promise-recall-inventory.test.ts`，34 项通过、1 项失败（`--maxWorkers=2`）：noNeedle 清单 6 超过帽 5，包含其他批次新增的 LSP 能力协商文案。本轮没有修改 `src/` 或该治理判据，没有重跑完整 core，也不沿用上一轮全量数冒充本轮证据。
- 未运行 gates、head-cert-check、mutate-verify；没有提交或发布。

## 审查与复现

OCR 仅使用带排除范围的 delegate preview 和指定路径的 delegate rule；当前代理审查本轮起点至最终文件的差异。重点检查请求序号与回主页失效、两个失败不互相覆盖、锁因传递、队列编辑 blur 回调、键盘恢复、错误文本转义和临时 profile 清理。原有菜单锁提示的条件链保持项目现有写法。没有调用 OCR review/scan，没有修改既有测试判据。

`scoped.patch` 只包含相对本轮开始内容的改动与本轮新文件。`before/` 和 `after/` 内保存截图和机器结果；亮暗截图均已目视检查。主要日志、规则、类型与边界输出保存在本目录。

从仓库根复现：

```sh
pnpm --filter cairn-desktop exec vite build --outDir /tmp/cairn-session-open-after-20261101
env -u ELECTRON_RUN_AS_NODE CAIRN_RENDERER_DIST=/tmp/cairn-session-open-after-20261101 pnpm --filter cairn-desktop exec electron scripts/session-open-recovery-smoke.cjs /tmp/cairn-session-open-recheck
```
