# 消息与队列目标绑定：阶段验证

持续优化目标保持 active。本批只修复已复现的消息与队列来源漂移，未提交或发布。

## 结果

- 插话等待期间切换项目，失败回包只入发送时的会话/工作区队列；不再在 await 后读取当前窗口工作区。
- 队列移除、编辑、移动、打断与恢复使用同一对渲染目标，写回/本地取消恢复处理均显式携带工作区。
- Ctrl+Tab 按 id + workspace 找到当前行，打开下一条时传递该行工作区。
- 复用现有 runKey 与服务，未新增依赖、IPC 字段或 JSONL 格式。

## 证据

- 改前：5 项新增行为测试全部失败；真实 Electron renderer + 合成 IPC 的 8 项检查中 5 项失败。
- 改后：同一 8 项检查全通过；实际检查了持久队列写入参数、切换后界面、原项目读回、原生 Ctrl+Tab 与控制台错误。
- 定向测试：7 文件、69 项通过，maxWorkers=2。
- 完整桌面：296 文件，1,985 项通过，1 项失败，maxWorkers=2。唯一失败为原有 `stream-rework.test.tsx:63` 的 raw `run_shell` 展示断言；未改该断言。此前新增的单参数取消源码匹配失败已同步为要求显式目标工作区，原调用数量及快捷键接线断言保留，并有真实组件行为测试补充。
- 兼容 Electron 检查：会话读取恢复 19/19、列表恢复 17/17，无 renderer/preload 错误。
- 根类型检查、桌面类型检查、renderer-layer-check、desktop-boundary-check 和隔离 Vite 构建通过。
- 当前代理按 OCR delegate preview 选择范围、rule 解析规则后审查 scoped.patch；未调用模型 OCR review/scan。preview 输出仍含共享树其他候选，因此实际审查仅本批补丁。没有发现本批新增的阻断问题。
- 本轮未修改 core，未重跑 core 全套；未验证真实 Provider、完整 Electron 主进程服务重启、跨机器或发布包。Electron 证据使用真实 renderer 和合成 IPC。

## 审查边界与后续

这是共享脏工作树的增量，HEAD `be9c0be5`（`fix/spec-summary-double-count`）不包含本批更改。以进场前 preimage 生成的 `scoped.patch` 为本批范围，未重置或归并其他更改。

队列落盘失败后的派发/恢复、异步新建会话期间切换窗口，以及裸 sessionId 控制 IPC 对同名会话的归属校验继续调查；不把本批 UI 目标绑定等同于后端所有运行状态均已完成工作区隔离。队列保存的崩溃一致性尚未证明。

截图已实际查看：乙项目保留自己的队列，甲项目读回原消息；截图等待现有切换动画完成后捕获。其余日志与 result.json 位于同目录。
