# Desktop Workbench（2026-10-27）交付与复验

范围：`docs/superpowers/plans/2026-10-27-desktop-workbench.md` 的 Task 1 / Task 2。
本目录只放 md/json/png/log；不复制源码，不写 TS。

## 一、接手时的现场

Codex 的最后一段停在“给工具菜单加限高 + 收紧窄窗断言”：

- 已写入 `.pop-rd[data-workbench-menu] { max-height: …; overflow-y: auto; }`，并补了
  `workbench-tools-smoke.cjs` 的低高度菜单与窄窗边界断言；
- 但没有复跑验证。紧接着的桌面套件读数是 **1 failed / 1486 passed**，红在
  `tests/motion-gaps.test.ts`：`ruleOf(".pop-rd")` 取 CSS 里第一处 `.pop-rd` 字符串，
  新规则插在基础 `.pop-rd` 之前，于是读到的只有 max-height/overflow，进场动画被判丢失。
- `outputs/desktop-workbench-2026-10-27/` 当时不存在，Task 2 的证据与收口没有落盘。

## 二、本轮的改动

1. **把工作台菜单规则移到基础 `.pop-rd` 之后**（`styles.css`）。
   判据没有放宽：仍由 `motion-gaps` 钉 `.pop-rd` 的 `animation: pop-in var(--t-fast)`；
   工作台菜单仍拿到 Radix 可用高度与纵向滚动。规则顺序就是这次回归的根因。
2. 复跑桌面套件、构建、隔离 smoke、根 typecheck、渲染层门与文档门；证据写入本目录。
3. 补计划执行台账与设计规范顶部的可见形态条目。

没有改权限、IPC、agent 路由、全局配置、冻结判据或测试断言（除本轮前已有的在飞改动）。

## 三、读数（工作树）

| 检查 | 读数 |
|---|---|
| 桌面套件 + boundary | **224 文件 / 1487 条全绿**；`desktop-boundary-check` 绿 |
| 修前同一套件（10:18 日志） | 1 failed / 1486 passed，红在 `motion-gaps`（规则顺序） |
| 工作台隔离 smoke | **23/23 PASS**；`checks.json` 为机器原文 |
| 根 typecheck | 0 条报错 |
| `renderer-layer-check` | 绿（133 个渲染层源文件；I1–I4 全过） |
| `docs-check` | 10:22 受检项全绿（下一个未占用页号 719）；10:23 他笔追加第 719 页并点名未入库的 `outputs/interop-c-2026-10-27/`，文档门转 D-11 红，归属他笔，与本笔无关 |
| 桌面 build | tsc 0；vite build 绿；`dist/index.html` 引用 `assets/index-CQBUFc9Z.css`，构建时刻 10:21:38 |

### 关键 smoke 明细（`checks.json`）

- 会话顶栏只常驻「改动 1 / 工具」，改动 aria-label 明说“本会话 1 个文件”；
- 菜单列出文件/终端/浏览器/方案/任务/旁路/插件窗格 + 右侧面板 + 插件侧栏 + 专注模式；
- Esc 关闭菜单并把 activeElement 还给 `[aria-label="工作台工具"]`；
- 已挂载窗格可经「改动」再次直达，不误关、切到前台；
- 右侧面板隐藏后，点「改动」恢复面板与原审查内容；
- 插件侧栏从菜单开/关，从侧栏内部关闭后焦点回到工具入口；
- 原浏览器/终端快捷键仍生效；
- **720×700 窄窗 + 160 字标题**：改动 82px @565–647、工具 59px @649–708、viewport 720、
  标题右界 555 ≤ 改动左界 565、改动右界 647 ≤ 工具左界 649、无横向溢出；
- **880×300 低高度**：菜单 top 35 / bottom 300（=viewport）、client 263 < scroll 385；
  End 后 scrollTop 122，末项（专注模式）进入视口且获得焦点；
- 设置页不展示工作台任务入口；renderer 控制台无 error。

截图：`01-session.png`、`02-tools-menu.png`、`03-narrow.png`、`04-dark.png`、`05-short-menu.png`。

## 四、未验边界

- smoke 用合成 `AgentApi`（`ui-gallery-preload.cjs`）与隐藏 `BrowserWindow`；键盘/鼠标是
  Chromium `sendInputEvent` 的真实输入事件，但不是生产 preload、真实模型或人工点击。
  `Esc` 那条的 `focused:false` 是隐藏窗口没有 OS 焦点；判据是 DOM activeElement。
- 低高度只测了 880×300 一个样本；没有遍历更多窗口尺寸，也没有跑屏幕阅读器。
- Task 1 Step 2 要求的“对旧构建跑出 FAIL 的原始读数”没有保留：接手时实现已在盘上，
  重建基线需要回滚组件；本轮以修前 `motion-gaps` 红样本与修后 23/23 作为边界。
- 未跑全量 core 套件：本轮只动渲染层 CSS/组件，计划要求的门已全跑；core 由在飞的
  Evolve P2 会话负责，不在本笔宣称。
- 工作树有多个并发会话的未提交改动，本笔只改 `styles.css` 规则顺序并新增本目录；
  没有提交、没有 reset/stash 他人改动。
- 业主应用未重启：检查时没有 Cairn Electron 实例在跑；验证用的 dist 是工作树构建，
  不等于常驻应用已加载；需要时由业主或批次收尾统一重开。
