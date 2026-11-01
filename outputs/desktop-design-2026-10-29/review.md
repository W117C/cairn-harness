# 桌面设计与动效检查 · 2026-10-29

本轮已实现设置、模型菜单、思考与工具过程、会话筛选的视觉整理，以及发送与输出之间的动效修复。沿用现有暖色双栏工作台。修改保留在工作树中，未提交、未发布；共享目录内的其他改动未归入本轮交付。

## 设计依据

调研以 GitHub 的实际组件源码为依据，固定到以下版本，未引入依赖或复制上游实现。

| 项目 | 参考 | 本轮采用的方式 |
| --- | --- | --- |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio/blob/6c83579f93d4a9540a90f4bf5f4efd4f661350dc/src/renderer/components/ModelSelector/ModelSelector.tsx) · AGPL-3.0 | 模型搜索、选中项定位与键盘焦点；[设置行](https://github.com/CherryHQ/cherry-studio/blob/6c83579f93d4a9540a90f4bf5f4efd4f661350dc/src/renderer/components/SettingsPrimitives.tsx) | 搜索即聚焦、当前项可见、输入法确认不误选；用对齐与分隔线组织设置 |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui/blob/852a3fa2a61ce81a9161929d12266728dfe7c382/packages/ui/src/components/react/assistant-ui/elements/reasoning.tsx) · MIT | 思考与连续工具的折叠交互 | 收起时减少摘要与装饰，展开后保留完整内容、错误与复制操作 |
| [OpenCode](https://github.com/anomalyco/opencode/blob/6a0acd174b92e904e7722bbfb6f29a05c3ad80cd/packages/app/src/settings/row.tsx) · MIT | 固定宽度的设置内容与行布局 | 采用清晰的标签/控件对齐；没有照搬每一行都带说明的方式 |

本项目额外要求：等待 Logo 从发送入口开始，覆盖 createSession 和首个 IPC 事件之前的间隔；这属于 Cairn 的运行态适配。

## 已落地

- 设置：统一无衬线页头与内容宽度，移除重复页说明和层叠卡片；通用设置合成两组；供应商列表与密钥表单对齐；窄窗改为纵向布局。
- 模型：搜索、独立滚动列表、思考档位和“管理模型”分区；减少行内元数据与重复提示。方向键高亮、Enter 选择、IME 守卫、Esc 焦点返回均保留可用语义。
- 小窗口：按实际可用空间决定方向；两侧空间不足时在窗口内定位，底部操作不会被列表挤出。
- 过程：思考收起时不再重复显示正文摘要；工具收起行以动作和目标为主，保留失败状态，展开后显示细节。既有对话左轨和 24px 间距保持原契约。
- 筛选：新对话旁的菜单保留五个选项与数量，去掉重复标题和脚注；选中状态与清除入口可见。
- 动效：顶部流光从单次播放改为持续循环；减弱动效时保留静态运行提示。Logo 覆盖发送、建会话和首个输出前的等待；输出、工具、审批、错误、取消与会话切换接管各自状态。
- 修正历史未收口增量在下一轮重新显示为运行中的问题，避免旧消息重新转动。

## 验证

| 检查 | 结果 |
| --- | --- |
| 桌面全量测试 | 239 文件 / 1,661 项通过 |
| 最后模型与弹层定向回归 | 5 文件 / 79 项通过 |
| 根类型检查、桌面构建 | 通过 |
| renderer-layer-check / desktop-boundary-check | 通过 |
| docs-check | 受检项全绿 |
| 真实 Electron：设置 | 22/22，通过 1320、880、760px 宽度和表单操作 |
| 真实 Electron：模型、筛选、过程 | 22/22，覆盖 1440×900、880×640、880×420、深色、键盘、IME、能力说明 |
| 真实 Electron：运行与动效 | 19/19，超过一轮仍运行，发送前段、工具后段、减弱动效、错误和切会话均覆盖 |
| Impeccable 静态检测 | 所选目标无报告项；不代替实机视觉检查 |
| OCR delegate | 仅取得文件范围与规则，由当前 agent 审查；未调用 OCR review/scan |

Electron 检查使用合成 AgentApi 和隔离临时 profile，不使用真实模型、凭据或用户会话。画廊的 getProviderInfo 是固定夹具，因此模型切换检查在会话覆盖选择中进行；不能把它当作全局设置持久化验证。此轮没有验证真实服务、跨平台安装包或发布。

本轮涉及文件的 diff 检查通过。全仓 diff 检查另报告三份无关文档的末尾空行，未改动这些文档。

可复跑交互检查（仓库根目录）：

```sh
pnpm --filter cairn-desktop build
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/desktop-design-smoke.cjs /tmp/cairn-design-check
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/motion-lifecycle-smoke.cjs /tmp/cairn-motion-check
```

设置页与模型菜单：

![设置页](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-design-2026-10-29/settings/general-1320.png)

![模型菜单](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-design-2026-10-29/design/01-model-light.png)

![窄窗口模型菜单](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-design-2026-10-29/design/02-model-short.png)

![思考与工具展开](/Users/ze/Downloads/Cairn/cairn/outputs/desktop-design-2026-10-29/design/05-process-expanded.png)
