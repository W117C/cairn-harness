# 冒烟普查：20 支里 3 支红 · 2026-11-01

检查起点与交付面都是共享工作树，HEAD `be9c0be5`；本批改动未提交。

## 为什么普查

第 944 页发现 `diff-render-latency.cjs` 早就坏了（它按实现名找行，产品改说中文动词）。一支能坏，
其它支同不同病？于是把 20 支已跟踪的 Electron 冒烟逐个真跑一遍（每支 `timeout 300`，输出落 `*.log`）。

## 普查结果

| 结果 | 支数 | 名字 |
|---|---|---|
| exit 0 | **17** | cancel-resume / cross-workspace-restore / diff-render-latency / error-boundary / interaction / layout / pane-tabs / performance / plan-mode / radix-open-latency / route / session-continuity / session-preview / session-reference / steer / ui-gallery / workspace-owner |
| exit 1 | **2** | `state-smoke`（7 项里 1 项 FAIL）、`terminal-resize-smoke`（入口就死） |
| exit 2 | **1** | `settings-process-smoke`（渲染层脚本执行抛错） |

## 本轮修的那支：terminal-resize-smoke

旧写法先找 `[aria-label="添加面板"]` 再点「终端」。那枚按钮只在**已经有窗格的 dock 里**存在；首页一个窗格都没开时它不存在，
于是这支冒烟在「还没开窗格就找添加按钮」的死结上直接 exit 1。

改成走键盘（`Ctrl+\``，pane-shortcuts 表里 terminal 那一格）：

| 阶段 | 读数 |
|---|---|
| 修前 | `FAIL 渲染面就绪（存在「添加面板」入口） {"addBtn":false}`，exit 1 |
| 第一次修（引号写坏） | `SyntaxError: missing ) after argument list`（反引号把模板截断）→ exit 124 |
| 修后 | **5/7 PASS**：窗格与 xterm 挂上（344×765）、启动即发行列（44×54）、变窄列数跟着降（44→36）、正整数行列、无控制台错误；**2 项仍红** |

仍红的两项（本轮记录、未修）：

- `容器变矮 ⇒ 行数变少`：变矮后 rows 仍 56；
- `容器放大 ⇒ 行列跟着回去`：放大后 cols 仍 36。

两项的前置读数是 `hostNarrow.width = 2`——冒烟把容器宽度压到了 2px，终端在这个宽度下已经退化。
到底是「布局给窗格加了最小宽度、冒烟的几何假设过期」还是「终端没跟着高度重算」，本轮没有定论，留给下一轮单独查（要先把宿主宽度的来源量清楚）。

## 另外两支红的线索（本轮记录、未修）

- `state-smoke`：7 项里 1 项 FAIL——「请求未完成时操作条保持可见，移开鼠标也能看到保存状态」。
  CSS 里确实有 `.row-actions[data-saving="true"] { opacity: 1; }`，`Stream.tsx` 也确实把 `data-saving` 接到
  `annotationPending(anchor)`；是「pending 没被置上」还是「取样式时正处在过渡中」需要单独量。
- `settings-process-smoke`：`Error: Script failed to execute…` + 渲染层 console 报错，需要读 `.out` 里的详情。

## 边界

- 普查只跑**已跟踪**的 20 支（另有 39 支未跟踪的 `.cjs` 是别的工作树草稿，不碰）。
- 每支都真开 Electron、真加载 `dist`；`dist` 是当轮构建产物。
- 修的是**入口**，不是断言：仍红的两项一条没放宽。
