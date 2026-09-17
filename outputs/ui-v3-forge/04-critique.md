> **⚠️ 过时（2026-09-17 起）**：本文属上一轮设计（`ui-v3-forge`），其**色值 / 令牌名 / 尺寸 / 行号 / 函数名**多数已漂移。
> **已被推翻结论的逐条清单见 `outputs/frontend-refactor-2026-09-17/02-design-system.md` §0.2**（15 条）。
> 当前权威规范 = 该包（`00`–`06`）；本文**为存档保留**、正文未改写，**不可直接施工**。

# Forge UI v3 原型 · 质量审查报告（Phase 4）

> 审查官：质量审查官 严过审 · 审查对象：`outputs/ui-v3-forge/prototype/forge-ui-v3.html`（2754 行 / 189 KB，单文件自包含）
> 审查依据：`01-requirements.md`（需求基线）· `02-design-system.md`（设计系统规范，判定标尺）· `00-recon-brief.md`（现状实测）· 对照基线 `src/renderer/index.html`
> **本报告全部结论均有可复现证据**（行号 / 命令 / 脚本 / 截图）。凡无法独立验证者，均如实标注「未验证」。

---

## 1. 结论：**REVISE（定点修复，非重做）**

设计质量整体高（20/25，五维全部 ≥3），**无 P0 阻断**；但存在 **4 项 P1 必修**（其中 1 项为主理人裁决的专项修改），超出「P1 ≤ 3」的放行门槛，故判 **REVISE**。所有 P1 均为低风险定点修改，不需要重做 Phase 3。

### 逐维评分

| 维度 | 分数 | 判定 | 一句话依据 |
|---|---|---|---|
| 设计哲学 Philosophy | **4/5** | 通过 | 严格延续 oklch 灰阶 + 单一强调色 + 内联线性 SVG，无渐变/毛玻璃/新色相（四态为授权例外）；扣分项：`#bpIndicator` 调试标签外露、若干内联样式按钮。 |
| 信息层次 Hierarchy | **4/5** | 通过 | 五级面层次（bg/surface/surface-2/surface-3/弹层）可辨；**本项目最大缺口（运行态/审批/进度）已落位**：顶栏运行点+审批黄脉冲、常驻底栏状态栏（阶段+进度）、任务视图进度条。扣分项：顶栏两个 28px 状态项略拥挤。 |
| 执行质量 Execution | **3/5** | 通过（有真实缺陷） | CSS/JS 语法与状态机实跑通过（headless 实测 20+ 交互）；四档断点逐档实测正确；**但存在 3 处死按钮 + 1 处 ARIA 失效**。 |
| 特异性 Specificity | **5/5** | 通过 | 内容为真实编程 Agent 场景（worker 依赖链、审批门、run 批次回溯、diff/verify/report），真实文件路径与命令；换标题不能当通用聊天软件。 |
| 克制 Restraint | **4/5** | 通过 | 无装饰堆砌，元素均有功能目的；扣分项：调试标签、死 CSS、被拒/失败修复后将同形同色。 |

**总分：20 / 25**

---

## 2. Anti-Slop 门控结果

| 检测项 | 结果 | 证据 / 行号 |
|---|---|---|
| 装饰性渐变 / 毛玻璃 / 发光 / 玻璃拟态 | ✅ 无 | 全文件 grep：`gradient`=0、`backdrop-filter`=0、`blur(`=0、`url(http`=0（脚本 `/tmp/forge_review/hooks.sh`） |
| 无意义大圆角卡片流 / 卡片套卡片 | ✅ 无 | 卡片均为功能卡，圆角统一 `--r-4`（L164）；无装饰性嵌套 |
| 占位文案（Lorem / 示例 / TODO） | ✅ 无 | grep `lorem\|ipsum\|示例文本\|这里是\|占位\|todo:` = 0 命中 |
| emoji 当图标 | ✅ 无 | 图标全为内联线性 SVG；`✓ ✗ → ⌘` 属终端输出/快捷键/状态字形（`.st-dot::before` L817/819 为规范 §A.1.3 授权的「形」编码），非装饰 emoji |
| 居中一切的营销式排版 | ✅ 无 | 三栏工作台 shell，非营销页 |
| 无 hover / focus-visible 反馈的可点元素 | ⚠️ 基本有，**死按钮无反馈** | 全局 `:focus-visible`（L136）+ 各组件 hover；但 `#ctxUpload`(L1416)、`#archiveToggle`(L1168)、`在文件树中查看`(L1275) 点击无任何反馈 → 见 P1/P2 |
| 状态只靠颜色表达 | ✅ 三重编码（色+形+文） | `.st` 用 色+形状(!/×/✓/空心)+中文标签（L808-826）；⚠️ 修复「被拒」后将与「失败」同形同色 → P2-7 |
| **假交互（按钮点了无反应 / 死链）** | ❌ **命中 3 处** | `#ctxUpload`、`#archiveToggle`、`在文件树中查看` —— **headless Chrome 实测点击后 DOM/状态零变化**（见 §3.6） |
| 与现有 Forge 冲突的字体 / 色板 / 圆角 | ✅ 无 | 令牌逐字一致（见 §3.2）；字体栈与 live 一致（L109-111）；圆角档取自 live |

---

## 3. 独立验证记录（我做了什么 → 结果 → 证据）

> **验证手段总述**：① 全文件 grep 静态检索；② Python 独立复算 oklch→WCAG 对比度；③ **headless Google Chrome**（Chrome/153.0.8010.36）注入自测脚本 + `--dump-dom` + `--virtual-time-budget` **真跑 23 项交互**；④ `--screenshot` 目检 6 张截图。
> 脚本与产物：`/tmp/forge_review/{hooks.sh, contrast.py, inject.py, inject2.py, run.mjs, dom_*.html, s1..s6.png}`。

### 3.1 禁用项实测（复核主理人「0 命中」）

- **做了什么**：`grep -o` 全文件统计 `gradient / backdrop-filter / blur( / url(http / @import / <link / <script src`，以及 `data-m1e* / data-virtuoso / data-approval-badge / data-panel-toggle / data-panel-id`。
- **结果**：**全部 0 命中**。主理人结论复核通过。
- **证据**：`bash /tmp/forge_review/hooks.sh` 输出；文件确为单文件自包含（`<head>` 内仅 `<meta>`×3 + `<title>` + `<style>`，末尾仅内联 `<script>`）。

### 3.2 令牌一致性（逐字抽查）

- **做了什么**：将规范 §A.1.2 的 16 个四态令牌 + §A.1.1 灰阶 + 尺寸令牌与原型 `:root`/`html[data-theme=dark]` 逐字比对。
- **结果**：**逐字一致**。
  - 四态 Light（原型 L54-61 vs 规范 §A.1.2）：`--st-run oklch(52% 0.15 150)`、`--st-wait oklch(45% 0.008 250)`、`--st-stuck oklch(50% 0.14 70)`、`--st-fail oklch(53% 0.2 25)`、`-fg` 三变体与 `--st-wait-fg:var(--fg)` —— 全对。
  - 四态 Dark（原型 L95-102）：`74% .15 150 / 76% .012 250 / 80% .13 80 / 76% .16 25` + `-fg` 变体 —— 全对。
  - 尺寸：`--sidebar-w:264px`(L21)、`--drawer-w:340px`(L22)、`--gutter:9px`(L23)、`--statusbar-h:24px`(L24)、`--accent` light `oklch(55% 0.18 255)`(L35) / dark `oklch(72% 0.14 255)`(L76) —— 与 live（`index.html:14/15/16/26/58`）一致。
  - 灰阶骨架 9 项 light/dark 全部与规范 §A.1.1 一致。
- **附加发现**：规范 §A.4 称 `.sb-trigger` 为 28×28，**实测 live 为 24×24**（`src/renderer/index.html:289`），原型也是 24（L324）——**规范表述有误，原型与 live 一致，无回退**。

### 3.3 对比度复算（独立脚本，不抄规范数字）

- **做了什么**：Python 实现 oklch→oklab→linear sRGB→WCAG 相对亮度→对比度，对 dark/light 四态文字与圆点分别对 `--bg`/`--surface-2` 复算。
- **结果**：

| 用途 | Dark vs bg | Dark vs s2 | Light vs bg | Light vs s2 | 判定 |
|---|---|---|---|---|---|
| 彩色状态文字 `-fg`（run/stuck/fail/wait） | 11.66 / 12.46 / 9.72 / 15.68 | 9.95 / 10.64 / 8.29 / 13.38 | 7.25 / 8.29 / 7.84 / 17.71 | 6.97 / 7.96 / 7.53 / 17.01 | **全部 >7:1 ✅** |
| 圆点/描边（非文字） | 8.86 / 10.19 / 8.11 / 8.98 | 7.56 / 8.69 / 6.92 / 7.66 | 5.11 / 6.15 / 5.86 / 7.43 | 4.91 / 5.91 / 5.63 / 7.14 | **全部 >4.5:1 ✅** |

- **交叉校验**：我复算得到的 hex（如 dark `--st-run #5ac576`、light `--st-fail #c51d28`）与规范表内 hex **逐一吻合** → 规范 §A.1.2 的对比度数字可信。
- **证据**：`python3 /tmp/forge_review/contrast.py`（脚本含完整公式）。唯一微差：`--fg` dark 我算 `#e5e8ec`（规范 `#e9ecef`），量级不影响 >7:1 结论。

### 3.4 断点实测（headless Chrome 真跑 5 档）

- **做了什么**：`--window-size=W,900 --dump-dom` 注入探针，读取 computed style 与 `getBoundingClientRect`。
- **结果**：

| 窗口宽 | `--sidebar-w`/实测 | 右板 `position` | 主区宽(px) | 输入区 | 状态栏 | bp 指示 |
|---|---|---|---|---|---|---|
| 1600 | 264 / 264px | relative | 978 | 不折叠 | 显示 h=24 | ≥1600 三栏全开 |
| 1280 | 264 / 264px | relative | 658 | 不折叠 | 显示 | 1280–1599 默认三栏 |
| 1100 | 64 / 64px | relative | 678 | 不折叠 | 显示 | 1024–1279 侧栏 icon 态 |
| 1000 | 64 / 64px | **fixed** | 927 | 不折叠 | 显示 | 960–1023 右板覆盖式 |
| 900 | 64 / 64px | fixed | 827 | 不折叠 | 显示 | <960 兜底浮层 |

- **结论**：四档断点（≥1600 / 1280–1599 / 1024–1279 / 960–1023）**逐档与 RESP-1 完全一致**；主区任意断点 ≥480px（RESP-3 ✅）；输入区永不折叠（RESP-3 ✅）；状态栏在 1000/1100/1280/1600 均可见（TASK-2 ✅）。
- **证据**：`/tmp/forge_review/dom_{1600,1280,1100,1000,900}.html`。

### 3.5 钩子清单核对

- **做了什么**：对规范 §D.2 的 35 个 live 冻结钩子逐条 `grep -o | wc -l` 计数。
- **结果**：**35/35 全部存在**（计数：data-od-id 33、data-card 12、data-msg-act 12、data-label 11、data-act 9、data-id 8、data-view 7、data-card-toggle 6、data-sec 6、data-drawer 5、data-stream 5、其余各 1–4）。**伪造钩子（`data-m1e*`/`data-virtuoso`/`data-approval-badge`/`data-panel-toggle`/`data-panel-id`）全部 0 命中**。
- **证据**：`hooks.sh` 输出。

### 3.6 假交互抽查（headless Chrome 实跑 23 项，方法见 §3 总述）

- **结果**（PASS/FAIL 为实测）：

| # | 交互 | 结果 | 实测证据 |
|---|---|---|---|
| 1 | CONV-2 排队发送 | ✅ | 连发 2 条 → `queueCount=2`、`queueBar` 显示 |
| 2 | CONV-2 停止/中断 | ✅ | `composer.interrupted=true`、`data-stream` 归零、出现「已中断 · 可继续」 |
| 3 | CONV-2 停止钮→发送钮 | ✅ | `#sendBtn[data-state=send]`、`aria-label=发送` |
| 4 | CONV-6 引用回填 | ✅ | `#quoteBar` 显示、`#quoteText` = 消息文本 |
| 5 | CONV-5 Enter 发送 | ✅ | 消息数 4→6，出现新 `data-stream` |
| 6 | CONV-7 卡片过滤 | ✅ | `dimmed=5/6`、`cf-status="匹配 1 条"` |
| 7 | CONV-4 卡片折叠 | ✅ | `collapsed true→false`、`aria-expanded` 同步 |
| 8 | plan 批准 | ✅ | tag → 「已批准」 |
| 9 | 审批卡批准 | ✅ | `.card.ask.resolved`、`.ask-acts` 移除 |
| 10 | 视图切换 tasks | ✅ | `#view-tasks` 显、`#view-conversation` 隐 |
| 11 | TASK-6 worker 恢复 | ✅ | `worker-4` state → `run`、恢复钮移除、toast |
| 12 | TASK-3 事件流下钻 | ✅ | Sheet `.show`、`#sheetBody` 5 行事件 |
| 13 | HIST-2 run 展开 | ✅ | `aria-expanded=true`、`#rh1` 显 |
| 14 | HIST-6 时间轴切换 | ✅ | `#timeline` 显、`#runHistoryList` 隐 |
| 15 | HIST-3 检索过滤 | ✅ | 会话 9→1(vite)→9 |
| 16 | HIST-4 状态筛选 | ⚠️ 部分 | fail chip 显示计数 2，但列表仅渲染 1 行（另 1 条在折叠文件夹内）→ P2-4 |
| 17 | HIST-5 回收撤销 | ✅（含残留） | 会话 8→9、回收区隐藏；**但 `#trashList` 残留 1 个隐藏子节点** → P2-3 |
| 18 | 主题切换 dark | ✅ | `data-theme=dark`、body bg = `oklch(0.165…)` |
| 19 | RESP-4 ⌘K 打开 | ✅ | overlay 显、17 个 item |
| 20 | RESP-4 ⌘K Enter 执行并关闭 | ✅ | 400ms 后 `hidden=true` |
| 21 | **RESP-4 `aria-activedescendant` 有效** | ❌ | `actDesc=""`、首个 item 无 id（全宽 5 档均失败）→ **P1-4** |
| 22 | **CONV-5 附件/引用入口可触发** | ❌ | 点击 `#ctxUpload` DOM/状态零变化 → **P1-2** |
| 23 | **HIST-1 已归档入口可触发** | ❌ | 点击 `#archiveToggle` 零变化 → **P1-3** |
| 24 | **diff 卡「在文件树中查看」** | ❌ | 点击零变化 → P2-1 |

- **补充**：另用 `--screenshot` 目检 6 图（`s1..s6.png`），**未见布局破碎 / 溢出 / 遮挡**；四态色在 dark/light 下清晰可辨。

### 3.7 无障碍抽查

- **prefers-reduced-motion**：**6 个 `@media (prefers-reduced-motion: reduce)` 块**（L1066/1071/1079/1084/1088/1092）+ `html.reduce-motion` 全局类（L138，含设置项 `data-reduce-motion` L1844）。覆盖面：run-grid、stream-caret、msg-act、chev、回到底部浮钮、四态脉冲、审批黄脉冲、worker/recover/task-row、run 历史/grain、⌘K/Sheet/设置/toast/scrim/gutter —— **新增动效均有降级，未回退**。
- **role / aria**：`aria-pressed`（chips/开关）正确；`aria-expanded`（卡片/think/run 行/side-tab）正确；`aria-live` 4 处（queueBar、cfStatus、toast、statusbar 阶段）；`role="combobox"`+`listbox`+`option` 结构存在，**但 `aria-activedescendant` 恒为空（P1-4）**；`#cmdkInput aria-expanded` 硬编码 `"true"`（L1779，关闭态也为 true，P2-9）。
- **嵌套交互**：`<span class="st-x" role="button" tabindex="0">` 嵌在 `<button class="side-tab">` 内（L2476）——**浏览器实测开 tab 后 PRESENT(1)**，属非法嵌套交互 → P2-2。
- **最小点击区（实测）**：`#sendBtn` 28×28、`.msg-act` 28×28、`.side-home` 28×28、`.icon-btn` 30×30、`.sb-trigger` **24×24**（与 live 一致，非回退）。

### 3.8 未验证项（如实声明）

- **真实 Electron 窗口最小尺寸 960×600（RESP-2）**：原型为纯 HTML，无法验证 `minWidth/minHeight`（属 `src/main/index.ts`，超出原型范围）。
- **屏幕阅读器真机播报**：未做（仅有静态 aria 检查 + DOM 探针）。
- **4K / 150% 系统缩放（RESP-2 附）**：未实测。

---

## 4. 问题清单

### P0 阻断
**无。**

### P1 必修（4 项，均给出可执行改法）

**P1-1｜「被拒」状态用错色相（主理人裁决专项，见 §5）**
- 行号：**L1651**（run 历史行）、**L1658**（展开区图标）、**L1679**（时间轴项）。
- 现象：`被拒` 复用 `data-state="stuck"` → 渲染为 **amber 圆点 +「!」**（浏览器实测 `被拒 state :: stuck`）。
- 为什么是问题：`--st-stuck` 是「卡死/挂起」语义，与「被拒（终止性）」不符；违反主理人裁决与 TASK-6 四态色纪律。
- 改法：
  - L1651：`<span class="st" data-state="stuck">` → `<span class="st" data-state="fail">`（复用现有 `.st[data-state=fail]` 样式 L818-819/825 → 红点 +「×」）。
  - L1679：`<div class="tl-item" data-state="stuck">` → `data-state="fail"`（复用 L882）。
  - L1658：`<span style="color:var(--st-stuck)">!</span>` → `<span style="color:var(--st-fail)">×</span>`。
  - `被中断`（L1664、L1680）**保持** `data-state="wait"`（灰）——已符合裁决。

**P1-2｜`#ctxUpload`（附件/引用入口）为死按钮**
- 行号：**L1416**（HTML），JS 全文**无 `#ctxUpload` 事件绑定**（grep 仅 1 处命中）。
- 现象：headless 实测点击后 DOM/状态零变化。
- 为什么是问题：违反 CONV-5 验收「附件/引用入口可触发」，命中 Anti-Slop「假交互」。
- 改法：在 §8 composer 段（如 L2251 `#quoteClear` 附近）补绑定，例如：
  ```js
  $('#ctxUpload').addEventListener('click', () => {
    toast('已打开附件/文件引用面板');
    // 原型可仅给反馈；正式版接 openCtx 或文件选择器
  });
  ```

**P1-3｜`#archiveToggle`（已归档入口）为死按钮**
- 行号：**L1168**（HTML，含 `aria-haspopup="dialog"`），JS 仅在 **L2012** 读该元素，**无 click 绑定**。
- 现象：headless 实测点击零变化；但按钮声明了 `aria-haspopup="dialog"`，属误导。
- 为什么是问题：HIST-1 要求保留归档能力；一个声明了 dialog 的可点控件无响应，命中「假交互」。
- 改法（二选一）：① 补最小反馈 `$('#archiveToggle').addEventListener('click', () => toast('已归档 ' + archivedList.length + ' 条'));`；② 或实现归档区列表并移除 `aria-haspopup`。

**P1-4｜⌘K 命令面板 `aria-activedescendant` 恒为空（ARIA 断线）**
- 行号：**L2598**（`cmdkInput.setAttribute('aria-activedescendant', items[cmdkActive].id || '')`）+ **L2584 / L2588**（生成的 `.cmdk-item` 无 `id`）。
- 现象：headless 5 档实测 `actDesc=""`、首个 item `id=""`（浏览器实测 FAIL）。
- 为什么是问题：combobox/listbox 模式的键盘选中无法被辅助技术播报，违反 G-5 / RESP-4 的无障碍要求。
- 改法：给每个 item 生成唯一 id 并回填。例如 L2584 改为：
  ```js
  html += '<button class="cmdk-item" id="cmdk-opt-' + (cmdkItems.length-1) + '" type="button" role="option" data-i="' + (cmdkItems.length-1) + '">…';
  ```
  L2588 同理加 `id="cmdk-opt-…"`；并给激活项加 `aria-selected="true"`（其余 false）。

### P2 建议（锦上添花）

- **P2-1｜diff 卡「在文件树中查看」死按钮**（L1275）：无 handler。建议补 `data-doc` → 打开文件树并高亮（spec §B.1.3），或至少给 toast 反馈。
- **P2-2｜非法嵌套交互**（L2476）：`<span class="st-x" role="button">` 嵌于 `<button class="side-tab">`（浏览器实测 PRESENT）。建议把 side-tab 改为 `<div role="tab">` 容器 + 内部两个独立 `<button>`，或把关闭动作改为 `keydown Delete`/右键菜单。
- **P2-3｜回收站撤销后残留隐藏子节点**（`renderTrash` L2085-2086 提前 return 未清空）：浏览器实测 `#trashList` 残留 1 子节点。建议 `trashSec.hidden=true` 前加 `$('#trashList').innerHTML=''`。
- **P2-4｜状态/检索筛选不展开折叠文件夹**（`render` L1978-1983）：fail chip 计数=2 但列表仅可见 1 行（另 1 条在关闭的 `edge-gateway` 文件夹内）。建议筛选激活时强制展开含命中项的文件夹（`if (f.open || query || statusFilter!=='all')`）。
- **P2-5｜死 CSS `.sort-btn`**（L303-309 定义、L1021 引用，HTML 从未使用）：建议删除或补上排序控件。
- **P2-6｜调试标签 `#bpIndicator` 外露**（L997-1002、L1860「≥1600 · 三栏全开」）：对最终用户可见。建议导出前移除，或加 `?debug` 开关。
- **P2-7｜「被拒」修复后将与「失败」同色同形**：二者均红点 +「×」，仅文字不同，三重编码的「形」维度退化。建议给「被拒」独立 glyph，例如新增：
  ```css
  .st[data-state="rejected"] .st-dot{background:var(--st-fail);color:var(--surface)}
  .st[data-state="rejected"] .st-dot::before{content:"—"}
  .st[data-state="rejected"] .st-txt{color:var(--st-fail-fg)}
  .tl-item[data-state="rejected"]::before{border-color:var(--st-fail);background:var(--st-fail)}
  ```
- **P2-8｜命名不一致**：裁决用「已中断」，原型用「被中断」（L1664/1680/1151、`STATE_LABEL` L1921）。建议统一。
- **P2-9｜`#cmdkInput aria-expanded` 静态 `"true"`**（L1779）：关闭时应为 false；`.cmdk-item` 建议补 `aria-selected`。
- **P2-10｜会话点击不切换正文**（L2054 仅改标题/选中）：原型单会话内容，可接受；建议在报告中标注为占位。
- **P2-11｜spec §B.1.3 的 diff→文件树高亮联动未实现**（`data-doc` 存在但无 JS 联动）：非本轮验收硬项，建议记录。

---

## 5. 专项核查结论（被拒 / 被中断 色映射）

**① 当前实际用了什么色**（浏览器实测 + 源码）：

| 状态 | 当前位置 | 当前 `data-state` | 实际渲染 |
|---|---|---|---|
| 被拒 | L1651（run 行）、L1658（展开图标）、L1679（时间轴） | `stuck` | **amber 圆点 +「!」**（`--st-stuck`） |
| 被中断 | L1664（run 行）、L1680（时间轴） | `wait` | 灰空心圆点（`--st-wait`） |

截图 `s5_history.png` 可见「批次 #40 · 批量重命名组件目录」行显示 **amber「!」**——与裁决所指不符。

**② 裁决是否合理：基本合理，建议补一点。**
- 「被拒→amber」**确实错误**：`--st-stuck` 表达「卡死/挂起」，与「被拒（用户否决、终止）」语义冲突。**同意改。**
- 「被拒→`--st-fail` 红」**可接受**：在不新增色相的前提下，红（终止/未成功）是四色中最贴近「被拒」的选择；灰已被「被中断」占用，绿是成功。
- **需提醒的副作用**：改为红后，「被拒」与「失败」将**同色（红）+ 同形（×）**，仅靠文字区分，削弱 §A.1.3「色+形+文」三重编码。**建议按 P2-7 给「被拒」独立 glyph（如「—」）**，既满足裁决的「拒绝图形」意图，又保住形状维度。
- 「被中断保持 `--st-wait` 灰」**合理**：中断是中性/可续语义，灰（空心）恰当。**同意，无需改色**（仅建议标签统一为「已中断」）。

**③ 若需修改，具体行号与改法**：见 **P1-1**（L1651 / L1658 / L1679 三处），外加可选的 **P2-7**（新增 `rejected` 独立 glyph）。

---

## 6. 复评口径（构建师一次改到位）

修改后我将**只复验以下条目**（其余已通过，不重复）：

1. **L1651 / L1658 / L1679**：`被拒` 的 `data-state` 为 `fail`（或新增 `rejected`），渲染为**红族**且**非 amber**；L1679 时间轴同步。`被中断` 仍为 `wait`（灰）。
2. **L1416 `#ctxUpload`**：点击有可见反馈（toast / 面板 / 状态变化）。
3. **L1168 `#archiveToggle`**：点击有可见反馈，或移除 `aria-haspopup`。
4. **L2584 / L2588 / L2598**：⌘K 打开后 `#cmdkInput[aria-activedescendant]` 指向**存在的 item id**；↑↓ 切换时该值随之变化。
5. 回归确认：**无新增** `gradient/backdrop-filter/blur(/data-m1e*`（重跑 §3.1 grep）。
6. 回归确认：四态令牌与 §A.1.2 仍逐字一致（重跑 §3.2 抽查）。
7. （可选）P2-2 / P2-3 / P2-4 是否一并处理。

> 复验方式：重跑 `/tmp/forge_review/inject2.py` + headless Chrome，比对 §3.6 第 21/22/23 行由 FAIL→PASS，并复跑 §3.1 grep。

---

## 附：审查方法与可复现命令

```bash
# 1) 禁用项 / 钩子核对
bash /tmp/forge_review/hooks.sh
# 2) 对比度独立复算
python3 /tmp/forge_review/contrast.py
# 3) 交互 + 断点 headless 实测（注入自测）
python3 /tmp/forge_review/inject2.py
for W in 1600 1280 1100 1000 900; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --disable-gpu --no-sandbox --virtual-time-budget=20000 \
    --window-size=$W,900 --dump-dom "file:///tmp/forge_review/test2.html" > dom_$W.html
done
# 4) 截图目检
#   --screenshot=/tmp/forge_review/s1_conv_light.png  file://…/forge-ui-v3.html
#   --screenshot=…/s2_tasks_dark.png                  …/#tasks,dark
#   --screenshot=…/s3_icon_light.png                  --window-size=1100,900 …/#tasks
#   --screenshot=…/s4_overlay.png                     --window-size=1000,900 …/#tasks
#   --screenshot=…/s5_history.png                     …/#history
#   --screenshot=…/s6_cmdk.png                        …/#cmdk,dark
```

---

# §7 复评记录（第 2 轮）

> 复评对象：修订后的 `outputs/ui-v3-forge/prototype/forge-ui-v3.html`（2858 行）。
> 复评方法：与第 1 轮同法 —— 源码行号核对 + **headless Google Chrome** 注入自测（`inject3.py`/`inject4.py`/`test5/6`，产物 `dom3/4/5/6.html`）+ `--screenshot` 目检。
> 范围：严格按 §6 的 7 条复评口径 + 主理人新增的两处澄清项，**不全量重审**。

## 7.0 最终结论：**PASS**

**P0 = 0，P1 = 0**（原 4 项 P1 全部修复并经浏览器实测确认），五维全部 ≥3。放行 Phase 5。

### 更新后的逐维分数

| 维度 | 第 1 轮 | 第 2 轮 | 变动依据 |
|---|---|---|---|
| 设计哲学 Philosophy | 4 | **4** | 未变；无新增色相/装饰，`#bpIndicator` 已收敛为 opt-in 调试标记。 |
| 信息层次 Hierarchy | 4 | **4** | 未变；7 态语义更精确（被拒/已中断 拆分），层次无退化。 |
| 执行质量 Execution | 3 | **4** | ⬆ 3 处死按钮 + ⌘K ARIA 断线全部修复并实测通过；断点/交互回归无退化。 |
| 特异性 Specificity | 5 | **5** | 未变；新增附件/归档/定位均为本产品特有语义。 |
| 克制 Restraint | 4 | **4** | 未变；死 CSS 已删，调试标记已隐藏。 |
| **总分** | 20 | **21 / 25** | |

## 7.1 逐条复评（对应 §6 口径 + 新增澄清项）

**① §6-1｜被拒/已中断 色相 → 7 态编码（主理人新口径）**
- **复验方式**：注入探针为 7 个 `data-state` 各建 `.st`，读取 `::before` 的 computed `content` + dot 的 `background-color`/`border`；headless 实测 + `states-7.png` 目检。
- **结果**：**PASS**。7 态「色+形」组合**唯一 = 7/7**（转灰后仅凭形状/文字仍可辨）。实测值：
  - `run` 无 glyph / 实心绿；`wait` 无 glyph / 空心灰；`stuck` `!` / 实心 amber；`fail` `×` / 实心红；`done` `✓` / 实心绿；`rejected` **`⊘` / 实心红（`--st-fail`）**；`interrupted` **`⏸` / 空心灰（`--st-wait`）**。
- **行号核对**：CSS 7 态映射 **L838-859**（`rejected` L848-849、`interrupted` L851-852）；run 行 **L1692**（被拒）/ **L1705**（已中断）；时间轴 **L1720**（被拒）/ **L1721**（已中断）—— `data-state` 均为 `rejected`/`interrupted`，与主理人新口径一致。
- **证据**：`dom3.html` 的 `state rejected :: glyph="⊘" bg=oklch(0.53 0.2 25)`、`state interrupted :: glyph="⏸" bg=rgba(0,0,0,0) border=1px`；`PASS :: 7 态 色+形 编码互不相同 :: unique=7/7`；截图 `/tmp/shots/states-7.png`（7 态并排，**glyph 全部正常渲染，无豆腐块**）。
- **采纳度评价**：主理人**比我的原建议更进一步**（新增 `rejected`/`interrupted` 独立状态 + 独立 glyph），恰好解决了我 P2-7 担心的「被拒/失败同形」与「已中断/等待同形」问题。**该方案优于原 P1-1 的「直接改 fail」**，予以确认。

**② §6-2｜`#ctxUpload`（附件/引用入口）**
- **复验方式**：点击 `#ctxUpload` → 统计 `.ctx-pop [data-attach]` 数量与弹层可见性；再点其中一项读 toast。
- **结果**：**PASS**。弹层打开且含 **4 个 `data-attach`**（添加文件/引用文件夹/添加目标/计划模式）；点「添加文件」→ toast「已打开文件选择器」。
- **行号**：HTML **L1457**；绑定 **L2623-2633**；点击分派 **L2634-2643**。
- **证据**：`dom3.html`：`PASS :: CONV-5 ctxUpload 打开弹层 :: attachItems=4`、`PASS :: CONV-5 附件项可触发 :: toast="已打开文件选择器"`。

**③ §6-3｜`#archiveToggle`（已归档入口 → 真功能）**
- **复验方式**：读初始 `aria-expanded`/`hidden` → 点击 → 归档一条会话后读计数与列表行数 → 恢复后读计数。
- **结果**：**PASS**（闭环）。初始 `aria-expanded="false"` + 区隐藏；点击后 `"true"` + 区可见；归档一条后 **计数=列表行数=1**；恢复后 **归零**。
- **行号**：HTML **L1205**（toggle，含 `aria-controls="archivedSec"`）/ **L1211**（`#archivedSec`）/ **L1208**（`#archiveCount`）；逻辑 **L2049-2080**（`renderArchived` L2058、archive L2068、绑定 L2074-2080）。
- **证据**：`dom4_*.html`：`PASS :: HIST-1 归档区 初始折叠`、`PASS :: HIST-1 点击展开`、`PASS :: HIST-1 归档后计数=列表行数 :: count=1 rows=1`、`PASS :: HIST-1 恢复后计数归零`。

**④ §6-4｜⌘K `aria-activedescendant`**
- **复验方式**：⌘K 打开 → 读 `actDesc` 并 `getElementById` 校验存在性 → ↑↓ → 再读 → 统计 `aria-selected` → Esc → 读 `aria-expanded`。
- **结果**：**PASS**。`actDesc="cmdk-opt-0"` 且该 id 存在；↓ 后变 `"cmdk-opt-1"`；`aria-selected` 唯一 = 1；打开 `aria-expanded="true"`、Esc 后 `"false"`。
- **行号**：id 生成 **L2682 / L2686**；`setActive` 回填 **L2692-2699**；`openCmdk/closeCmdk` 的 `aria-expanded` **L2701 / L2702**；HTML 初值 **L1820**（已改为 `"false"`）。
- **证据**：`dom3.html`：`PASS :: RESP-4 actDesc 指向存在的 id`、`PASS :: RESP-4 ↑↓ 后 actDesc 变化 :: ad0="cmdk-opt-0" ad1="cmdk-opt-1"`、`PASS :: RESP-4 aria-selected 唯一 :: selected=1`、`PASS :: RESP-4 打开时 aria-expanded=true`、`PASS :: RESP-4 Esc 后 aria-expanded=false`。

**⑤ §6-5｜回归：无新增禁用项**
- **复验方式**：重跑第 1 轮 grep（12 个模式）。
- **结果**：**PASS**。`gradient / backdrop-filter / blur( / url(http / @import / <link / <script src / data-m1e* / data-virtuoso / data-approval-badge / data-panel-toggle / data-panel-id` **全部 0 命中**。

**⑥ §6-6｜回归：四态令牌逐字一致**
- **复验方式**：打印四态令牌块比对。
- **结果**：**PASS**。Light（**L54-61**）与 Dark（**L95-102**）四态令牌**逐字未改**（`52% .15 150 / 45% .008 250 / 50% .14 70 / 53% .2 25` + `-fg`；dark `74% .15 150 / 76% .012 250 / 80% .13 80 / 76% .16 25` + `-fg`）。本轮**只新增 `rejected`/`interrupted` 状态映射，复用既有 `--st-fail`/`--st-wait`，未新增任何色相令牌** —— 与主理人说明一致。

**⑦ §6-7｜可选 P2（已处理 8 条）**
| 项 | 结果 | 证据 |
|---|---|---|
| P2-1 diff→文件树定位高亮 | **PASS** | 点 `#diffToTree`（L1316，绑定 L2575-2586）→ `.tree-file.is-active`=1、doc=`src/auth/session.ts`、files 页打开。⚠️ 见下方「rAF 说明」。 |
| P2-2 侧 tab 非法嵌套 | **PASS** | 结构改为 `<div class="side-tab"><button class="st-main" role="tab">…</button><button class="st-x">✕</button></div>`（L2539-2545）；实测 `.st-x` 不再嵌于任何 button 内。 |
| P2-3 回收站残留清空 | **PASS** | 撤销后 `#trashList` children = **0**。 |
| P2-4 筛选展开折叠文件夹 | **PASS** | 点「失败」芯片 → 渲染 **2** 行（此前为 1）。 |
| P2-5 删死 CSS `.sort-btn` | **PASS** | 全文件 `.sort-btn` **0 命中**。 |
| P2-6 `#bpIndicator` opt-in | **PASS** | 默认 `hidden=true`；`#debug` → `hidden=false` 且文案 `≥1600 · 三栏全开` 正确（L1901 / L1038 / L2842 / L2847）。 |
| P2-8 文案统一「已中断」 | **PASS** | 运行历史状态文案为 `成功,失败,被拒,已中断`，无「被中断」。 |
| P2-9 `#cmdkInput aria-expanded` | **PASS** | 随开/关切换（见 ④）。 |

**⑧ 两处「请勿误判为回归」（主理人澄清项）**
- **`#bpIndicator`**：确认现在是 **默认隐藏的 opt-in 调试标记**（HTML `hidden` L1901 + CSS `.bp-indicator[hidden]{display:none}` L1038 + `DEBUG` 由 `?debug`/`#debug` 判定 L2842 + `bpIndicator.hidden = !DEBUG` L2847）。实测默认 `hidden=true`、`#debug` 下 `hidden=false` 且文案随断点正确。**判为正常实现，非回归**。
- **状态筛选芯片**：实测为 `全部 10 | 成功 5 | 失败 2 | 被拒 1 | 已中断 1 | 进行中 1`，其中 5 枚带字形、`全部` 为纯文字。**确认为刻意设计，不判为不一致**。

## 7.2 rAF 说明（P2-1 的验证方法学）
- headless Chrome（`--dump-dom` 模式）**不产生合成帧，`requestAnimationFrame` 不触发**（实测 `rAF fired in headless? false`），故 `#diffToTree` 内 `requestAnimationFrame(...)` 的高亮回调在纯 headless 下不执行 —— 这是**环境限制，非产品缺陷**。
- 我据实采用两种手段交叉验证：① 直接读 toast（同步执行）确认 `doc` 读取正确（`已在文件树中定位 src/auth/session.ts`）且目标 `.tree-file[data-doc]` 选择器命中；② **在 `<head>` 注入 rAF shim（`rAF → setTimeout(0)`）** 后重跑，得到 `active=1 doc=src/auth/session.ts filesPage=true` → **代码路径正确，真实浏览器下可正常工作**。

## 7.3 未验证项（沿用第 1 轮，如实声明）
- **Electron 真机窗口最小尺寸 960×600（RESP-2）**：属 `src/main/index.ts`，超出纯 HTML 原型范围，未验证。
- **屏幕阅读器真机播报**：未做（仅静态 aria + DOM 探针）。
- **4K / 150% 系统缩放**：未实测。

## 7.4 复评结论
原 **4 项 P1 全部闭环**，8 项 P2 全部处理，回归项（禁用项 / 令牌）无退化，断点与既有交互无回归。**最终判定：PASS**，逐维分数 **21/25**（哲学 4 / 层次 4 / 执行 4 / 特异性 5 / 克制 4），可进入 Phase 5 导出。

---

# §8 复评记录（第 3 轮 · 导出后修复）

> 复评对象：修订后的 `outputs/ui-v3-forge/prototype/forge-ui-v3.html`（**2873 行**，MD5 `e7bcf41076ae32dcd3efcdc020482e2c`，mtime 2026-09-15 23:38:55）。
> 复评范围：**仅验**导出阶段两处定点修复（覆盖断点 `#drawerToggle` 逻辑反转 + 跨断点状态一致性）**+ 回归红线**，**不全量重审**。
> 复评方法：源码行号核对 + **headless Google Chrome**（`--headless=new`）注入自测（`inject7.py`，产物 `dom7_1000.html` / `dom7_1280.html`，生成于 23:41:13/14 —— **晚于文件末次写入**，故证据对应当前文件）+ 静态 grep 回归。

## 8.0 最终结论：**PASS**

两处修复**行为正确、双向可逆、跨断点无残留**；回归红线**零退化**。P0 = 0，P1 = 0，五维分数**维持 21/25**。**维持放行 Phase 5 导出。**

### 更新后的逐维分数

| 维度 | 第 2 轮 | 第 3 轮 | 变动依据 |
|---|---|---|---|
| 设计哲学 Philosophy | 4 | **4** | 未变；本轮纯缺陷修复，未触及设计语言。 |
| 信息层次 Hierarchy | 4 | **4** | 未变。 |
| 执行质量 Execution | 4 | **4** | 未变（修复的是**覆盖断点下的既有交互 bug**，属第 1 轮 24 项清单未覆盖的盲区；修复后无新增缺陷、无退化，故不加分亦不减分）。 |
| 特异性 Specificity | 5 | **5** | 未变。 |
| 克制 Restraint | 4 | **4** | 未变。 |
| **总分** | 21 | **21 / 25** | |

## 8.1 逐条复评（对应主理人 5 项验收 + 1 项判断）

**① 1000px 初始化一致性**
- **复验方式**：`--window-size=1000,900` 载入，读 `#drawerToggle@aria-pressed` / `#drawer.classList.contains('open-m')` / `#mScrim.hidden` / `#shell.dataset.drawer`。
- **结果**：**PASS**。`pressed="false" openM=false scrimHidden=true shell="0"` —— 四者一致，**覆盖态下右板默认关闭且 ARIA 与视觉同步**。
- **证据**：`dom7_1000.html` → `PASS :: ① 1000px 初始化一致性 :: pressed=false openM=false scrimHidden=true shell=0`；`INFO :: initial state :: {"pressed":"false","openM":false,"collapsed":false,"scrimShow":false,"scrimHidden":true,"shell":"0"}`。
- **行号**：初始化 **L2861-2862**（注释 + `if (isOverlay()) setDrawer(true);`）。

**② 1000px 打开 → 关闭（双向可逆）**
- **复验方式**：`dispatchEvent(click)` 点 `#drawerToggle` 两次，各读一次四元组。
- **结果**：**PASS**（双向）。开：`openM=true scrimShow=true pressed=true shell=1`；关：`openM=false scrimShow=false pressed=false shell=0`。**修复后的 `collapsed = isOverlay() ? drawer.classList.contains('open-m') : …` 使覆盖态下不再「双重取反」—— 第一次点开、第二次点关，均正确。**
- **证据**：`dom7_1000.html` → `PASS :: ② 点击→打开 :: openM=true scrimShow=true pressed=true shell=1`、`PASS :: ② 再点→关闭 :: openM=false scrimShow=false pressed=false shell=0`。
- **行号**：点击绑定 **L2492-2495**（判定行 **L2493**）；`setDrawer` **L2478-2491**（overlay 分支 L2479-2483、`shell.dataset.drawer` L2489、`aria-pressed` L2490）。

**③ 跨断点一致性（1280 展开 → 收窄入覆盖 → 再放宽回 1280）**
- **复验方式**：1280px 起（`pressed=true/shell=1`）→ 注入 `matchMedia` stub 强制 `max-width:1023px` 命中并派发 `resize` → 读状态 → 解除 stub 再派发 `resize` → 读状态。
- **结果**：**PASS**。
  - **跨入覆盖**：`openM=false shell="0" pressed="false" scrimShow=false` —— **收起到位、`shell`/`aria-pressed` 同步、无残留 `open-m`、遮罩不显示**。
  - **跨出覆盖**：`collapsed=false shell="1" pressed="true" openM=false` —— **恢复展开、`shell`/`aria-pressed` 同步、无残留 `open-m`**。
- **证据**：`dom7_1280.html` → `PASS :: ③ 跨入覆盖断点→收起且同步 :: {"pressed":"false","openM":false,"collapsed":false,"scrimShow":false,"scrimHidden":true,"shell":"0"}`、`PASS :: ③ 跨出覆盖断点→恢复展开 :: {"pressed":"true","openM":false,"collapsed":false,"scrimShow":false,"scrimHidden":true,"shell":"1"}`。
- **行号**：`resize` 钩子 **L2814-2831**（`prevOverlay` 初值 **L2815**、`nowOverlay` **L2820**、跨出分支 **L2821-2824**、跨入分支 **L2825-2828**、`prevOverlay = nowOverlay` **L2829**）。逻辑复核：**仅 `nowOverlay !== prevOverlay`（真跨断点）时才调 `setDrawer`** → 覆盖态内拖拽宽度反复触发 `resize` **不会误关**面板（符合注释 L2826 的意图）。

**④ 1280px 非覆盖分支无回归**
- **复验方式**：`--window-size=1280,900` 载入 → 读初态 → 点 `#drawerToggle` 收起 → 再点展开。
- **结果**：**PASS**。初始 `pressed=true shell=1 openM=false`（默认展开）；收起 `collapsed=true shell=0 pressed=false`；再展开 `collapsed=false shell=1 pressed=true`。**非覆盖分支的「手动收起/展开」行为与第 2 轮完全一致，无回归。**
- **证据**：`dom7_1280.html` → `PASS :: ④ 1280px 非覆盖 初始展开`、`PASS :: ④ 非覆盖 收起正确`、`PASS :: ④ 非覆盖 再展开正确`。

**⑤ 回归红线（4 类）**
| 红线 | 期望 | 实测 | 证据 |
|---|---|---|---|
| 12 个禁用模式 | 全 0 | **全 0 ✅** | `gradient`/`backdrop-filter`/`blur(`/`url(http`/`@import`/`<link`/`<script src`/`data-m1e`/`data-virtuoso`/`data-approval-badge`/`data-panel-toggle`/`data-panel-id` **逐项 = 0**（`grep -oF`） |
| 35 个真实钩子齐全 | 35/35 | **35/35 ✅** | 对 §D.2 冻结清单逐条 `\b…\b` 计数，**无缺失**（脚本化核对） |
| 无伪造钩子 | 0 | **0 ✅** | `data-m1e`/`data-virtuoso`/`data-approval-badge`/`data-panel-toggle`/`data-panel-id`/`data-fake`/`data-test`/`data-dummy` **全 0** |
| 四态令牌逐字未改 | 逐字 | **逐字 ✅** | Light **L54-61**、Dark **L95-102** 与第 1/2 轮完全一致（`52% .15 150 / 45% .008 250 / 50% .14 70 / 53% .2 25` + `-fg`；dark `74% .15 150 / 76% .012 250 / 80% .13 80 / 76% .16 25` + `-fg`） |
| `prefers-reduced-motion` 块 | 6 | **6 ✅** | `@media (prefers-reduced-motion: reduce)` **恰 6 块**（L1103/1108/1116/1121/1125/1129） |
| 单文件自包含 | 是 | **是 ✅** | 外部 `<link>`=0、`<script src>`=0、`@import`=0、`url(http`=0；内联 `<script>` 仅 1 |

**⑥ 判断项：跨出覆盖断点恢复为「展开」而非记忆「手动收起」状态**
- **我的判断：可接受，非缺陷，但建议在 README 记为「原型简化」。** 理由：
  1. **无 a11y 违规**：任意时刻 `aria-pressed` 与 `shell[data-drawer]`/视觉**始终一致**（实测 ①③④ 四元组无一错位），不存在「隐藏面板 + `pressed=true`」这类状态谎报。
  2. **「展开」是安全默认**：展开 = 无隐藏内容；若恢复为「收起」，用户在收窄-放宽窗口后会发现右板「凭空消失」，反而更易困惑。**恢复展开不会隐藏任何信息**。
  3. **与主理人「手动 > 自动」的适用域一致**：该原则针对**列宽**（分隔条拖动尺寸需保留用户意图）；折叠态属**模式切换**（覆盖式 vs 并列式），跨模式时取各模式的规范默认（覆盖=收起、并列=展开）是合理且确定性的。
  4. **代价可控**：要「记忆手动收起」需引入额外状态位并在多分支维护，收益低、回归面大，**不划算**。
- **结论**：**维持现状**，建议在导出 README 注明「跨断点切换时折叠态按目标断点默认值重置，不保留手动折叠」即可。

## 8.2 未验证项 / 环境限制（如实声明）
- **本次尝试「重跑」`inject7.py` 失败**：当前系统内存紧张（`vm_stat` 空闲页 ≈ 3770，约 59 MB；用户本机 Chrome 占用大量渲染进程），headless Chrome 启动即被 **SIGKILL（exit 137）**，多次重试（`--headless=new`/`--headless=old`/精简 flags）均同。
- **因此 §8.1 的交互证据取自 23:41 的既有产物** `dom7_1000.html` / `dom7_1280.html`。**该产物生成时间（23:41:13/14）晚于被测文件末次写入（23:38:55）**，且 `inject7.py` 在运行时读取的即当前文件（MD5 `e7bcf41076ae32dcd3efcdc020482e2c`），故证据与当前文件一一对应，**结论有效**。此为用户机环境限制，**非产品问题**。
- 沿用第 2 轮未验证项：Electron 真机窗口最小尺寸 960×600（RESP-2，属 `src/main/index.ts`）、屏幕阅读器真机播报、4K/150% 缩放 —— 均超出纯 HTML 原型范围。

## 8.3 复评结论
导出阶段两处修复（**覆盖断点 `#drawerToggle` 双重取反** → L2492-2495；**跨断点状态一致性** → L2814-2831 + L2861-2862）**行为正确、双向可逆、跨断点无残留、非覆盖分支无回归**；12 项禁用模式 / 35 钩子 / 四态令牌 / 6 个 reduced-motion 块 / 单文件自包含 **回归红线全绿**。**最终判定：PASS**，逐维分数 **21/25**（哲学 4 / 层次 4 / 执行 4 / 特异性 5 / 克制 4），**维持放行 Phase 5 导出**。

> **流程反思（供团队留档）**：此缺陷属「断点切换 × 组件交互」的**组合态**，第 1 轮 24 项交互清单仅在**固定断点内**测交互、第 1 轮断点测试仅在**默认态**测布局，二者交叉处（覆盖态下点开关）成为盲区。后续原型自检建议补一条「**同一交互在每个断点档 + 跨断点切换后各测一次**」的组合用例。
