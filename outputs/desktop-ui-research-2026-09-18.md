# 桌面端 UI 与组件调研 · 2026-09-18

> **范围**：只读调研。**未改 `src/` 任何文件，未跑门禁，未创建提交。**
> 基线 = HEAD `d063003`（R1a 前端接线已提交，`src/renderer/` 工作树干净）。
> ⚠️ 渲染层存在并发工作风险：AGENTS.md 已出现 R1a/R2 口径（R2 = `WORKSPACES`/`BRANCHES` 真化），
> 与本调研指向同一批文件。先后需由你指定。
> 本轮按你的裁决执行：**只出结论，不定形态。**

---

## §0 一句话结论

「简单」不会来自第四份设计文档，只会来自**减法**和**把已经付了钱的重复实现换成平台原生件**。
实测后最该修的三件事——**没有停止键 / 错误静默 / 上翻被拽回**——都不是设计问题，是接线问题；
它们比任何令牌体系都更直接决定「舒服」和「有用」。

---

## §1 为什么前三轮设计没换来「简单」（必须先算这笔账）

| 轮次 | 自报「新增」 | 是否提出删界面 |
| --- | --- | --- |
| `ui-v3-forge`（09-15/16） | 令牌 1 组 / 容器 2 个 / **视图 2 个** / 断点 1→4 / 状态 4→7 态 | 否 |
| `frontend-refactor`（09-17） | 令牌 38 条 6 组 / **为喂探针新建第 5 个 `data-view="git"`** / 门禁 26→28 | 否 |
| `desktop-optimize`（09-17） | 令牌 31 条 / reduced-motion 13→17 / z-index 30·40 | **仅删死码**：45 文件 + 14 依赖 + `react()` 插件 + 1 条空 media 规则 |

**同一批文件的实测长度**：`index.html` 1670 → **1968**，`app.js` 2034 → **2620**，右栏视图 **5** 个，门禁 **28** 道。

⇒ **仓库变简单了，界面变复杂了。** 三轮里唯一的减法发生在「删已死的 React 树」，
没有任何一轮提出「删掉一个活着的界面」。三轮的「克制」都指**不新增色相**，从未指**减少界面数**。
（另有 8 处轮间矛盾：四态色相、`⊘/⏸` 字形 vs 内联 SVG、64px 图标栏 vs 208px 窄列、
骨架屏「放弃」后复活、`aria` 基线 298 无法复现改 303、`--border-strong` 同值两数…）

**所以本轮的判据必须换成可判定量**（见 §5），否则第四轮会重复同一个模式。

---

## §2 桌面对标：agent 应用的主流形态，与本仓逐条实测对照

对标来源为 2026 年公开设计指南与 HIG 摘要（**二手，非我对真实 app 的实测截图**）。逐条对照本仓：

| 对标结论 | 本仓实测 | 判定 |
| --- | --- | --- |
| 桌面标准是**两栏**（历史轨 + 居中流），工件面板**按需出现**、常驻面板应收起以省空间 | 常驻三栏：`--sidebar-w:252px` + 中栏 + `--drawer-w:340px`（**5 个 tab 长期占宽**），`--center-w = 100vw − 252 − 340 − 16` | ❌ |
| **必须有停止键**（列为反模式：用户必须能中途逃离坏响应） | `agent:run-cancel` 主进程**完整实现**（`agent-runner.ts:1494`，信号沿 `runLoop` 轮界/门等待/长驻工具透传）+ `main/index.ts:207` IPC 接线 + `preload/index.ts:29` 暴露 → **`app.js` 0 引用，`index.html` 0 个「停止」字样**。运行中新建/切换会话只弹 toast「请先等待完成」 | ❌ **P0**，能力全齐只差一个按钮 |
| **错误给具体原因 + 一个恢复动作**，禁「出错了」 | `src/events/index.ts` 事件 union 实测 26 个类型，**无 error 类**；渲染层无错误卡（`.card.err`/`err-msg` 0 命中）。即 overview.md 的 P0-2 **至今未闭** | ❌ 失败静默 |
| 流式时**只在距底 ~100px 内自动跟随**，用户上翻则锁定 | `scrollStream()`（`app.js:933-940`）无条件 `stream.scrollTop = stream.scrollHeight`，只做了 rAF 合帧 | ❌ 上翻被拽回 |
| 阅读流宽度 **720–768px**，正文 65–72 字符/行（WCAG ≤80） | `--content-max` = `min(100%, clamp(560px, center−48px, 1040px))`。1440 视口 → 正文 736px **已在带内 ✅**；但 ≥~1660 撞 1040 封顶 → 992px，13.5px 字号按 0.5em 均值**估** ≈ **147 字符/行** ❌ | ⚠️ 宽屏越界（估算，未实测排版） |
| 思考/推理**默认折叠**，标签诚实 | `.think` / `.think.expanded`，`aria-expanded="false"` 默认 | ✅ |
| 避免 SMS 气泡，用平铺全宽消息 | `.msg.user{flex-direction:row-reverse}` + 右对齐 | ❌（中文长句下右对齐把起点推离视线） |
| 系统字体是桌面原生感的最大单项 | `--font-body: -apple-system, SF Pro Text, PingFang SC, system-ui`（`index.html:127`） | ✅ **别换** |
| macOS HIG：**不要在侧栏底部放关键信息/操作**；侧栏层级 ≤2 级 | 沙箱态/事件数/tokens 在侧栏底与独立 statusbar（v3-forge 当时也诊断出「运行状态处在视线边缘」，仍未改） | ⚠️ |
| 任务/run 视图值得做 | `grep -c runId src/events/index.ts` → **0**。内核没有「一次运行」这个聚合单位 | ❌ **数据不存在，UI 先做即空中楼阁** |

---

## §3 组件从哪来 —— 本调研的核心结论

**前提（本机实测，非推断）**：`node_modules/electron` = 44.2.0，从其 Framework 二进制读出
**Chromium `152.0.7977.76`**。CSP = `script-src 'self'; style-src 'self' 'unsafe-inline'`，`index.html` 无构建链。
同时实测：`<dialog>` / `popover` / `<template>` 使用数 = **0**；
`<details>` 使用数 = **1**（`app.js:1876`，重放渲染器 `renderHistoryRow` 用 `createElement('details')`）。

> **⚠️ 2026-09-18 更正**：本段原写「`<dialog>` / `popover` / `<details>` 使用数 = 0」。
> `<details>` 那条是**我的计数缺陷**——只 grep 了字面量 `<details`，漏掉 `document.createElement('details')` 这种写法。
> 复测口径：`grep -rn "details" src/renderer/`。更正后结论反而更强，见下表 D3 行的补充。

⇒ **结论：运行时早已把你手写的那批重复机制全部实现了。用原生件的代价是 0 依赖、0 构建步骤、
不碰 CSP、不需要引框架。** 这是本次调研最有确定性的产出。

| 本仓手写件（实测份数） | 平台原生件 | 落地于 Chromium | 152 可用 | 省掉什么 |
| --- | --- | --- | --- | --- |
| 浮层 **4 套**：`showPop`+`getBoundingClientRect`（`app.js:1194-1215`）/ `.sb-menu` 重挂 body / `#askPop` 运行时构建 / `#modelPop` absolute | `popover` 全局属性 + `popovertarget` + CSS 锚点定位（`anchor-name` / `position-anchor` / `position-try`） | 114 / 125 | ✅ | 全部 JS 测距、outside-click、Esc、焦点管理（light dismiss 与层级由平台负责） |
| 模态 **2 套**：`#settingsOverlay` / `#riskScrim`（手写 `inert`） | `<dialog>` + `showModal()` + `::backdrop` | 105 | ✅ | 手写 inert / focus trap / 三档 Esc |
| 折叠 **3 套且状态名相反**：`.card.collapsed` / `.toolgroup.collapsed` / `.think.expanded` | `<details>` / `<summary>` | 长期 | ✅ | 三套逻辑归一，`aria-expanded` 与键盘行为自带。**且重放渲染器 `renderHistoryRow`（`app.js:1876`）已经在用 `<details>`**——两套渲染器连「用不用原生件」都不一致，减法有仓内先例可循 |
| 主题 **2 份令牌块**（`:root` + `html[data-theme=dark]`；81 个名字 / **132 处声明 / 44 个名字重复声明**） | `light-dark()` + `color-scheme` | 123 | ✅ | 一份令牌表（暗色只写差异项） |
| composer 手写测高（隐藏 textarea `app.js:994`） | `field-sizing: content` | 123 | ✅ | 测高 JS |
| 视口断点 3 档 + `--center-w` 三处重算 | **容器查询** `@container` | 105 | ✅ | 面板按自身宽度响应（拖分隔条时右栏自己决定收窄），不再靠 `100vw` 算术 |
| 静态演示对话 `INITIAL_TRANSCRIPT` 每次切会话重注入 | `<template>` + 空态（R1a 对右栏已确立此口径） | — | ✅ | 演示常量（AGENTS.md 明文：「假象比空白更坏」） |

**关于组件库**：`frontend-refactor/02` §F 早已裁决过——29 个 shadcn 件按「移植 4 / vanilla 替代 23 / 放弃 2」处理，
Tailwind 与 `components.json` 明确放弃，且 **2026-09-17 刚删掉 14 个前端依赖**。
**本调研维持该裁决：不引框架、不引组件库。** 「组件」的落地形态 = 一组 `<template>` + 一个 `mount(name, data)` 约定 + 上表原生件；
连 custom elements 都不必须。（若将来要用 Lit 级别的小运行时 ≈6KB、ESM、CSP 兼容，那是**新决策**，需单独立项，不在本调研结论内。）

---

## §4 三个方向（不定形态，只给取舍）

- **A 纯减法**（不与 R2 相撞时最省）：37 个无 JS 引用的 id 逐个甄别（部分是 aria/CSS 锚点，**不得直接删**）/ 删静态演示对话 /
  4 套浮层→1 / 2 套模态→1 / 3 套折叠→1 / 44 个重复令牌声明→1 份。预估 `index.html` −350 行、`app.js` −400 行、界面数 35→约 20。**零新增依赖。**
- **B 原生件替换 + 三处「有用」接线**：停止键 / 错误事件与错误卡 / 滚动跟随策略（距底 100px 内才跟）。
  这三项是「舒服 + 有用」的最大增量，且**不依赖任何新设计**——前两项甚至是补既有 P0。
- **C 界面重排**（常驻三栏→按需第三栏、run/task 视图）：**依赖内核 `runId`，现在做是空中楼阁**。必须最后做，且先补数据面。

**推荐**：A 与 B 合并成一轮（改的是同一批文件、同一批判据，拆开反而两次碰门禁）；C 单独等数据。
其中「停止键」与「错误静默」属 bug 级，**不必等设计轮**，可立刻单独处理。

---

## §5 把「简单/舒服/有用」变成可判定量（本轮真正交付的东西）

| 度量 | 现值（实测） | 目标 | 怎么测 |
| --- | --- | --- | --- |
| 顶层界面/面板数 | ~35 | ≤20 | DOM 计数（一次 CDP `document.querySelectorAll` 快照） |
| 浮层机制份数 / 模态 / 折叠 | 4 / 2 / 3 | **1 / 1 / 1** | grep 实现点（`showPop`、`inert=`、`.collapsed`/`.expanded`） |
| 同一动作的实现份数 | `send`/`selectSession`/`renderSide`/`openView`/`closeView` 各 **2**（互相 monkey-patch） | 1 | grep 同名赋值 |
| 无 JS 引用的 id | 37 / 101 | 逐个归因后 0 悬空 | 已跑脚本，可复跑 |
| 令牌 | 81 名 / 132 声明 / 44 重复 | 声明数 ≈ 名字数 | `(--[\w-]+)\s*:` 计数 |
| `<dialog>`/`popover`/`<details>` 使用数 | 0 | 覆盖全部浮层与模态 | grep |
| 依赖数（前端运行时） | 0 | **维持 0** | `package.json` |
| 「停止一次运行」的点击数 | **∞（做不到）** | 1 | 手工 + 探针 |
| 失败可见性 | 0（无 error 事件类型） | 每次模型/网络失败 1 张卡 | 事件 union 计数 + 探针 |
| 正文行宽 | 1440 档 736px ✅ / 宽屏 992px ≈147 字符 | 正文 ≤72ch，code/diff 可更宽 | 排版实测 |

---

## §6 未证边界（不做没跑过的宣称）

1. 上表原生件的可用性是**由 Chromium 152 版本号推得的**——版本号本身是二进制实测，但
   **未在本仓渲染进程跑过 `CSS.supports` 探针**。落地前一次探针即可判定：
   `CSS.supports('anchor-name: --a')` / `'popover' in HTMLElement.prototype` / `CSS.supports('color: light-dark(red,blue)')` / `CSS.supports('field-sizing: content')`。**我不替它背书。**
2. 行宽 ≈147 字符是按 0.5em 均值**估算**，未实测排版。
3. **未跑任何门禁。** `panels-check` 目前仍红，且其 `#eventCount` 与 `[data-m1e-event-count]` 语义等价问题待裁决——
   **任何减法若删到探针钩子会连带污染判据**，故减法施工图必须先出「钩子白名单」，
   并遵守 AGENTS.md 判卷纪律：**判据有缺陷 → 写 `BLOCKED.md` 要求换判据，不许改代码去绕。**
4. 外部对标是二手公开文章与 HIG 摘要，非我对 Claude Desktop / Cursor / Codex 等真实窗口的截图测量。
5. 「当前权威设计文档是哪一份」在三轮互相覆盖后已不可判定（`frontend-refactor/02` 自称权威，
   `desktop-optimize/02` 同日续写并自称「沿用不换系统」，`ui-v3-forge/*` 已被 banner 标注过时但仍被引用）。
   **需要你指定唯一权威，否则第五轮还会拿到互相矛盾的输入。**

---

## §7 建议的下一步（我**没有**做，等你点头）

1. 你定：**A+B 合并成一轮** / 只做 B / 或仍不定形态再补调研。
2. 定了我出**施工图**（含 panels-check 钩子白名单、变异表增量、与 R2 的先后），仍然**不动代码**。
3. 「停止键」和「错误静默」这两项我建议从设计轮里摘出来当 bug 处理——它们是能力缺口，不是审美分歧。
