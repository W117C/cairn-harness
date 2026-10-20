# 官方 DSH 交互对照与 Cairn 实现

2026-10-20。当前工作树的增量实现，未提交、未部署。保留任务开始前其他会话的改动。本任务差异见 [task.diff](./task.diff)。

## 对照来源

通过 agent-reach 的 GitHub / gh 路径核对官方仓库；使用的源码为 [deepseek-ai/deepseek-harness @ 687f282](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)，MIT。视觉层继续使用前一轮已接入的 dsh-claude-style 0.17.0。

| 官方源码 | 学习的行为 | Cairn 本轮落地 |
| --- | --- | --- |
| [conversation-nodes 规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-chat/src/client/conversation-nodes/README.md) | 过程摘要、二级披露、最终回答独立于过程 | 连续工具调用组默认收起，摘要显示调用次数、执行中目标与失败计数；最终回答保持可见 |
| [ToolRow](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx) | 单次调用按需显示输入和输出，失败摘要可见 | 增加返回内容；纯文本转义，超过 10,000 字符明确提示截断；保留差异和产物入口 |
| [SidebarRoot](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar/src/client/SidebarRoot.tsx) | 展开/收起侧栏有不同密度的可用入口 | 48px 快捷栏支持展开、新建、搜索、文件、终端、设置；专注模式继续隐藏侧栏 |
| [右侧栏说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar-right/README.zh.md) | 多面板导航、添加、切换时保留内容树 | 增加导航与添加菜单，单面板聚焦及恢复原多面板布局；关闭、弹出、行高和拖动仍可用 |

这些是现有 Cairn 组件上的适配，没有复制 Cordis 插件运行时或整个 DockKit。官方的嵌套停靠、拖入分栏、浮动布局、四档过程视图和全轮过程折叠尚未迁入。

## 同时修复的问题

- 工具簇原来的组件 key 随追加行数变化，工具行还使用数组下标；追加调用或最终回复可能重挂载并清空手动展开状态。现改为事件序号稳定标识。
- 只有参数、没有工具返回内容，失败后只能看到失败图标。现可查看失败原因和完整展示范围内的返回文本。
- 项目组收起状态刷新即丢失；搜索匹配项可能仍藏在收起组内。现本地保存、搜索临时展开，清空恢复原选择。
- 侧栏方向键仅按 getClientRects 过滤，无法排除 visibility:hidden 的组后代。现同时检查组折叠状态。
- 时间线跳转到收起工具组时没有可见落点。现先展开组，再滚动定位。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 新工具行为用例反向验证 | 实现前 3 项失败，修复后通过 | logs/red-tools.log、logs/tools.log |
| 新面板入口反向验证 | 实现前缺少面板导航，修复后通过 | logs/red-panels.log、logs/panels.log |
| 桌面完整套件 | 151 个文件，1125 项测试通过；含边界检查 | logs/desktop.log |
| Electron 交互 smoke | 16/16 断言通过 | final/checks.json、logs/interactions-final.log |
| 桌面构建及桌面 TypeScript | 通过；主包仍有超过 500KB 的构建警告 | logs/build.log |
| 根 TypeScript | 0 条报错 | logs/typecheck.log |
| 文档检查 | 受检项通过；缺少 STATE.md 的 3 项明确未检 | logs/docs-check.log |
| 差异空白检查 | git diff --check 通过 | 当前工作树 |

Electron smoke 使用真实 renderer 和隔离配置目录，AgentApi 为显式启用的合成夹具；证明 UI 交互，不代表真模型、真实 PTY 或内嵌浏览器端到端运行。没有执行本轮 core 全套、完整 gates、HEAD mutation 或 HEAD certification。OCR 只运行 delegate preview/rule，代码审查由当前代理完成。

首轮真实窗口检查发现快捷栏新增节点导致网格换行，以及主题 0.5px 侧栏边框残留；已修复，并新增同排、填满宽高与零侧栏宽度断言。首轮失败日志保留，最终结果以 final/checks.json 为准。

## 最终截图

- [工具组摘要](./final/01-tools-folded.png)
- [展开工具输入与输出](./final/02-tools-expanded.png)
- [收起侧栏与聚焦面板](./final/03-focused-panel.png)
- [恢复多面板布局](./final/04-split-panels.png)
- [窄窗](./final/05-narrow.png)
- [暗色](./final/06-dark.png)
