# 桌面设计继续检查 · 第二轮

2026-11-06；工作树 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `fc6e3638`。本轮改动未提交，保留共享工作区前序改动。

## 修复结果

| 问题 | 原因与修改 | 实测 |
| --- | --- | --- |
| 多工具并排时，当前标签的关闭按钮被裁掉 | 原滚动计算混用了导航栏与滚动区坐标，且未响应容器宽度改变。改用同一视口坐标，并观察滚动区与当前标签尺寸 | 关闭按钮越出右缘 12px → 0px；1120px、1440px 及从窄窗恢复均通过 |
| 关闭工具后，键盘焦点落到不在前台的第一个标签 | 焦点选择器从第一个按钮改为当前 `aria-pressed="true"` 的按钮 | 关闭旁路后，焦点落到当前终端标签；其他窗格内容保留 |
| 输入区变窄、控件换行后，发送按钮跑到左侧 | 保持原有 flex 换行，仅补充行末对齐 | 发送按钮右侧空隙从 307–327px → 8px，与原内边距一致 |
| 三个内置子 Agent 只有名字，没有用途说明 | 原先先按空 description 跳过，导致已有的内置角色摘要无法显示 | implement、review、test 的三条用途说明均实际渲染 |

尺寸观察复用浏览器原生 [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)，未增加依赖。没有修改 IPC、Provider 或权限判定。

## 检查范围与验证

- 设置页 16 个分区：1440×900 浅色、880×640 深色均可打开，正文非空，无横向溢出或渲染错误边界。
- 保留 880px 下工具区自动收起的既有行为，并验证 7 个工具窗格的内容仍挂载，恢复宽窗后当前标签完整可见。
- 独立插件侧栏、插件搜索及详情、记忆搜索及详情、空态、读取失败、操作失败、跨页状态保留与命令面板键盘操作均通过整体回归。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 桌面 Vitest（并发 2） | 331 文件，2,280 项通过 | [日志](desktop-tests.log) |
| 工具标签与输入区 Electron smoke | 15/15 | [读数](pane-checks.json) |
| 设置页 Electron sweep | 浅色 13/13，深色 13/13 | [浅色](settings-light-checks.json)、[深色](settings-dark-checks.json) |
| 应用壳及管理页 Electron smoke | 51/51 | [读数](shell-checks.json) |
| 上轮可读性 Electron 回归 | 21/21 | [读数](readability-checks.json) |
| TypeScript、renderer layering、desktop boundary | 均通过 | 当前工作树命令输出 |
| 隔离 Vite 构建 | 通过 | [日志](build.log) |
| 两个 smoke 脚本语法与本轮 tracked diff 空白检查 | 通过 | `node --check`、`git diff --check` |

以上 Electron 验证合计 113 项，使用真实 renderer、合成 AgentApi 与临时用户配置；未调用真实 Provider，也未写入用户实际设置。

先运行新增断言复现了标签裁切、错误焦点、发送按钮落位与内置说明缺失，再修改实现。旧工具 smoke 把插件侧栏误认作第八个工具窗格，现已按当前产品结构分别验证“7 个工具 + 独立插件侧栏”，保留内容常驻、标签可见、关闭行为与渐隐检查，并补充窗口变化及焦点断言。

本代理使用 OCR delegate 选文件和解析规则后完成本轮变更审查，未运行 `ocr review` 或 `ocr scan`。设计 detector 仍报告两条既有 `styles.css:161,176` 的侧栏宽度动画警告，未新增；未声称静态扫描全绿。见 [detector.json](detector.json)。

## 截图

- 工具与输入区：[修改前](before/panes-1440.png) / [修改后](after/panes-1440.png)，同为 1440px 浅色窗口。
- 角色说明：[880px 深色](after/roles-dark-880.png) / [1440px 浅色](after/roles-light-1440.png)。

本轮源文件：`components/PaneDock.tsx`、`components/settings/SubagentsSection.tsx`、`styles.css`，以及两个现有 smoke 脚本。上述文件中的前序改动不计作本轮新增。

未提交、未打包或发布，未运行完整核心 gates、HEAD 认证或 mutation。结果证明当前工作树的上述界面行为，不代表已发布应用或真实服务验证。
