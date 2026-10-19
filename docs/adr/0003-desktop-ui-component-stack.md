# ADR 0003：桌面 UI 组件库与组件边界

- 状态：**原则已接受；具体库选型待业主确认**（2026-10-14）
- 提出人：Codex（按业主「组件不要手写，参考 Claude，找优秀 UI 组件库」的要求）
- 适用面：`apps/desktop/` 的 Electron + React + Vite 渲染层
- 调研日期：2026-10-14（GitHub 仓库元数据 + npm registry / 周下载量；数值会漂移）

## 背景

当前桌面端只有 React / ReactDOM，没有 UI 组件库。侧栏、按钮、输入、弹层、Tabs、
审批卡、设置页等大量交互原语由 `apps/desktop/src/renderer/` 与原型文件手写维护。
这条路径在早期能快速验证，但会产生四个持续成本：

1. 键盘导航、焦点管理、ARIA、Outside click、Esc、Portal 等行为每个控件都要重新补；
2. 同一交互在不同页面各写一份，状态与边界容易漂；
3. 视觉 token 分散在 CSS 与组件里，dark mode / density / 主题迁移成本高；
4. 设计稿与产品代码之间没有组件库这层契约。

Claude 桌面端的界面不是「一套重皮肤」，而是：中性底色、紧凑密度、少量强调色、
原生级键盘行为、以对话为中心的自定义组合。它适合**可访问原语 + 轻量主题系统**，
不适合 Ant Design / MUI 这类会强加整套视觉语言的库。

## 决策

### D1：标准控件不再手写原语

产品的标准控件必须优先来自组件库；禁止在页面里直接重写 `<button>`、`<input>`、
`<select>`、`<textarea>`、`<dialog>` 的完整交互与样式。允许保留的只有：

- 对库组件的**薄封装**（统一 token、尺寸、图标、产品语义）；
- 库没有覆盖的领域控件（例如事件流行、diff 视图、转录 Markdown）；
- 为无障碍或 Electron 特性所需的桥接组件。

### D2：推荐栈

**主库：`@radix-ui/themes`**

理由：它是打包发布的完整可访问组件库，而不是要求逐个复制的模板；默认视觉足够克制，
可用 `Theme` 与 CSS 变量改成接近 Claude 的暖中性/高密度界面；覆盖
Button、IconButton、TextField、TextArea、Select、Dialog、AlertDialog、DropdownMenu、
Popover、Tabs、TabNav、SegmentedControl、Switch、Checkbox、RadioGroup、ScrollArea、
Card、Callout、Badge、Tooltip、DataList 等桌面端常用面。

**复杂原语：`@radix-ui/react-*`**

只在 Radix Themes 组合不够时使用低层 Primitive（例如 `Tooltip`、`ToggleGroup`、
`ContextMenu`、`NavigationMenu`）。不重新实现 Radix 已覆盖的键盘/焦点语义。

**配套库**

| 需求 | 选择 |
|---|---|
| 图标 | `lucide-react` |
| 命令面板 / slash 菜单 | `cmdk` |
| Toast / 操作回执 | `sonner` |
| 三栏可拖拽布局 | `react-resizable-panels` |
| 大表格 / 列表虚拟化（需要时） | `@tanstack/react-table` + `@tanstack/react-virtual` |
| 复杂表单（需要时） | `react-hook-form` + `zod` |
| diff 渲染 | 专用 diff 库（例如 `@git-diff-view/react`）；不要用通用 UI 库硬造 |

### D3：不选它们作为主库

| 候选 | 结论 | 原因 |
|---|---|---|
| Ant Design | 不作为主库 | 99.7k stars、~3.8M 周下载，完整但企业视觉语言很强，Claude 式自定义成本高 |
| MUI | 不作为主库 | 99.2k stars、~10.4M 周下载，Material 视觉语言同样会覆盖产品 identity |
| Mantine | 备选主库 | 31.8k stars、~2.8M 周下载，功能最全；若更看重 AppShell/Spotlight 等全套能力可选，但体积与风格更重 |
| shadcn/ui | 备选主库 | 125.5k stars、`shadcn` CLI ~11.9M 周下载，定制上限最高；但它是「复制进仓库并归你维护」的模式，严格意义上不等同于「组件不手写」 |
| Base UI | 暂不作为主库 | 11.1k stars、~433k 周下载，方向正确但目前仍是 RC；等 1.0 稳定后重评 |
| Chakra UI | 备选 | 40.7k stars、~1.6M 周下载，成熟；视觉更 SaaS 化，需要更强的 theme 覆盖 |
| Ariakit | 备选原语层 | 8.6k stars、~1.4M 周下载，无障碍质量高；需要自己承担更多样式系统 |

## 组件映射

| 当前面 | 目标组件 |
|---|---|
| 左侧任务栏 / 项目组 | `Theme` + `ScrollArea` + `Button` / `IconButton` + `DropdownMenu` + `Tooltip` |
| 中央事件流 | `ScrollArea` + `Card` / `Callout` + 领域行组件；Markdown 与工具行保留产品化渲染 |
| 底部 Composer | `TextArea` + `IconButton` + `Popover` + `SegmentedControl` + `Badge` + `Kbd` |
| 模型 / 权限选择 | `Select` / `Popover` + `SegmentedControl` + `RadioGroup` |
| 审批 / 计划 / 澄清卡 | `AlertDialog` / `Dialog` + `Card` + `Callout` + `RadioGroup` + `Checkbox` |
| 右栏多标签 | `Tabs` + `ScrollArea`；三栏容器用 `react-resizable-panels` |
| 设置页 | 整页 `Tabs` + `Switch` + `Select` + `RadioGroup` + `TextField` + `DataList` |
| 错误 / 回执 | `Callout` + `sonner` |
| Slash / 命令 | `cmdk` + `Popover` |
| 图标 | 全部 `lucide-react`；不再手绘通用图标 |

## 迁移顺序

1. 加依赖与 `Theme` Provider，先把颜色、圆角、密度、明暗主题收成 token；
2. 迁移 Composer（输入、模型、权限、附件、slash、发送/打断）；
3. 迁移 Sidebar（会话列表、项目组、筛选、更多动作、设置入口）；
4. 迁移 RightPanel（Tabs、辅助对话、审查、终端占位）；
5. 迁移审批/计划/澄清卡与设置页；
6. 最后处理事件流与 diff 的领域渲染，只替换可访问原语，不替换业务表达。

## 验收

- 产品代码中不再直接实现标准控件的交互原语；
- 键盘：Tab、Enter、Space、Esc、方向键、焦点回退均有组件库覆盖；
- 明暗主题与密度只通过主题变量切换；
- 视觉回归确认 Claude 式暖中性、紧凑间距、少量强调色没有丢；
- 组件迁移必须同时补渲染结构或行为判卷，不接受「看起来一样」。

## 推翻条件

- 若业主选择 shadcn/ui，则本 ADR 的「打包组件库」约束改为「CLI 生成 + 不再手写原语」；
- 若 Radix Themes 无法覆盖 Electron 桌面密度/滚动/焦点需求，则重评为 Mantine 主库；
- Base UI 到 1.0 且生态稳定后，重新评估是否替代 Radix 原语层。

