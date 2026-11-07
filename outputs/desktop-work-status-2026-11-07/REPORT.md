# Cairn 桌面端：任务进度与工作台回归

2026-11-07 · 本地工作树 `fix/spec-summary-double-count`，HEAD `fc6e3638`。本轮在已有共享改动上增量修复，未提交、推送或打包。

| 路径 | 修改前 | 修改后 |
| --- | --- | --- |
| 有历史的会话发起新任务 | 3 个历史步骤与 1 个新步骤一起显示为 4 步 | 顶栏显示当前轮的 1 步；输入区的累计读数仍使用会话累计 |
| 任务运行中补充指令 | 顶栏显示累计 5 步；旧本轮算法也会被插话截断 | 插话不另起一轮，后续工具调用使本轮显示 2 步；worker 的消息与工具不计入 |
| 键盘阅读进度 | 只读面板标为菜单，回车打开后焦点仍在按钮，Page Down 不滚动清单 | 进度有名称和区域语义，打开即聚焦；Page Down 滚动清单，Esc 关弹层并归还焦点，运行不受影响 |
| 打开进度后缩短窗口 | 880×205 时弹层底边到 217px，被窗口裁掉 | 底边到 197px；22 项清单滚动后标题和“运行 · 2 步”仍可见 |
| Ctrl+Tab 切会话 | 旧进度的打开状态沿用到新会话 | 弹层随项目和会话身份切换；下一会话可打开自己的清单 |

验收脚本 `work-status-smoke.cjs` 用 Electron 加载实际构建的 renderer，驱动键盘、窗口大小及跨会话切换。修复前 [4/10 通过](baseline/checks.json)，修复后 [10/10 通过](after/checks.json)。截图：[修复前短窗](baseline/02-short-list.png)、[修复后短窗](after/02-short-list.png)、[宽窗](after/01-running-wide.png)、[暗色会话](after/03-second-session-dark.png)。

工作台工具的旧冒烟脚本会误读侧栏筛选菜单，且仍查找已经删掉的菜单项。本轮把断言绑定到实际展开的工具菜单，并在内容确实溢出的 205px 窗口里验证滚动和 End 聚焦。[最终工作台检查](workbench-tools-final/checks.json) 23/23；[跨项目同名会话与队列检查](queue-target-binding.log) 8/8。

桌面 Vitest 331 个文件、2,287 个用例通过。renderer 构建、TypeScript、renderer 分层、桌面边界和文档检查通过。将任务读数归回已有的读数模块后，`workbench.ts` 为 1,194 行，符合 1,200 行上限。已按 OCR delegate 给出的规则审阅本轮增量。Impeccable 检查仍报告两条已有的侧栏宽度动画警告。

Electron 检查使用合成 AgentApi 和隔离 profile，覆盖界面与事件投影；未连接真实 provider，也未验证安装包或其他平台。
