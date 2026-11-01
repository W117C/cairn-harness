# Agent OS UI-0 验证报告

日期：2026-10-29  
工作树：`/Users/ze/Downloads/Cairn/cairn`  
分支：`fix/spec-summary-double-count`  
状态：共享脏工作树内完成，未提交、未暂存、未清理无关改动。

## 交付范围

- 48px 全局能力轨：对话、插件、记忆、自动化，设置固定在底部。
- 插件、记忆、自动化升级为持久页面；对话切换后仍挂载，但以 `inert + visibility:hidden` 退出交互。
- 插件、记忆、自动化共享 `PageFrame`，窄窗自动用页内筛选替代上下文侧栏。
- 设置只保留技能中心与工作树两个页面式分区。
- 首启检查、`Cmd+K` 与全局能力轨都路由到同一组一级目的地。
- 页面加载、真实空数据、读取失败具有独立可见状态。
- 首次访问过的插件、记忆、自动化页面分别保持挂载；搜索、详情、筛选与滚动位置在目的地和 Chat 之间切换后保留。
- 页面操作失败显示在当前目的地内并可单独关闭，不再写入隐藏 Chat 的会话错误。
- 快照请求带 page + generation 守卫，迟到的旧响应不会覆盖当前页面。
- 命令面板完成真实键盘选择后，焦点转移到当前 App Rail 目的地；宽设置页的技能筛选保持可见。
- UI-0 不提供市场安装/更新或记忆写入/编辑的假按钮。

## 真实 Electron 证据

验证使用隔离 profile、生产构建后的 renderer 与合成 `AgentApi`，未调用真实模型、真实 provider 或用户会话。

| 场景 | 截图 |
| --- | --- |
| 1440×900 亮色，插件页 | `01-desktop-light-plugins.png` |
| 880×640，记忆页与页内筛选 | `02-narrow-880-memory.png` |
| 1440×900 暗色，记忆页 | `03-desktop-dark-memory.png` |
| 真实 `Meta+K` 键盘选择后焦点落在能力轨 | `04-keyboard-focus-memory.png` |
| 空记忆快照 | `05-empty-memory.png` |
| 快照读取失败 | `06-read-error-memory.png` |
| 1120×720 记忆页与布局边界 | `07-1120-memory-overlap.png` |
| 自动化操作失败在页面内可见 | `08-operation-error-automation.png` |
| 宽设置页技能内联筛选 | `09-settings-skills-inline.png` |

`checks.json` 共 44 项检查，`failed: 0`。覆盖：

- 启动目的地为对话，任意时刻只有一个 `aria-current="page"`。
- 插件、记忆、自动化页面可切换，聊天树保持挂载且隐藏。
- 插件搜索与详情经插件 → 记忆 → Chat → 插件后仍保留；记忆滚动位置也持续存在。
- 页面隐藏时使用真实 `inert`；离开 Chat 后已访问页面不卸载。
- 880px 无横向溢出，上下文侧栏隐藏、页内筛选出现。
- 1120px 恢复上下文侧栏；1440、1120、880 的 rail、上下文、标题、搜索与操作区边界互不重叠。
- 亮暗主题切换落到真实 renderer。
- 真实 `Meta+K` 打开命令面板，文本输入过滤到“记忆”，Enter 选中后焦点落在当前能力轨并显示可见焦点环。
- “页面”组包含四个一级目的地。
- 空快照与读取失败在页面内可区分；错误页只有一个标题，不残留旧内容。
- 自动化“立即运行”被拒后，错误出现在自动化页内；切回 Chat 不泄漏，返回后仍可关闭。
- 宽设置页的技能中心筛选可见且使用 `inlineFilter` 契约。
- 设置导航不再出现插件、记忆系统、自动化任务。
- 渲染过程无控制台错误。

## 自动门

以下命令均在本轮完成并读取了真实输出：

```text
pnpm --filter cairn-desktop test
  → 248 files / 1679 tests passed
  → desktop-boundary-check green

node --import tsx scripts/typecheck.ts
  → 0 errors

pnpm renderer-layer-check
  → green, 151 renderer files

pnpm desktop-boundary-check
  → green

pnpm --filter cairn-desktop build
  → green

pnpm docs-check
  → all inspected checks green

ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron \
  scripts/app-shell-smoke.cjs outputs/agent-os-ui-0-2026-10-29
  → 44/44 checks passed
```

## 静态检测

Impeccable detector 未发现本轮新增组件问题；仍报告两条既有 `.side-wrap` 宽度过渡规则：

- `apps/desktop/src/renderer/styles.css:158`
- `apps/desktop/src/renderer/styles.css:173`

两处均属于既有侧栏开合动画，本轮未改其行为。检测器因 warning 返回码为 2；`AppRail`、`AppPage`、`PageFrame`、`DestinationWorkspace`、`WorkbenchView`、设置壳与新增样式没有额外命中。

## 未验证边界

- 插件市场目录、签名、下载、安装、更新、卸载与回滚。
- 记忆新建、编辑、移动、固定、遗忘及外部引用决议。
- 真实 provider、真实模型调用、真实目录与网络失败。
- Windows、跨机器、正式签名、公证和发布包。
- 目的地上下文侧栏仍固定为 200px，未复用 Chat 侧栏宽度与拖拽持久化；作为 UI-0 的已知延期项保留。

这些属于后续 `PLUGIN-*`、`MEMORY-*`、`PAGES-1` 与 `HARDEN` 阶段，不在 UI-0 中冒充完成。
