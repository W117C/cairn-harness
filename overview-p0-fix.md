# 概览 · Forge 前端 P0 修复（2026-09-17）

## 做了什么

按诊断轮方案（`outputs/frontend-refactor-2026-09-17/`）的 **P0 批次落地代码**，并对每一项做**主理人独立复跑**（不采信成员自评）。

改动文件：`src/renderer/index.html`、`src/renderer/app.js`、`src/main/index.ts`、`BLOCKED.md`
新增工具：`proto/cdp-probe.mjs`（响应式探针，可复用）
构建：`node node_modules/electron-vite/bin/electron-vite.js build` **成功** — `out/renderer/index.html` **121.89 → 121.85 kB**（净减 44 B，恰等于删掉那两行 `</div>` 的字节数）/ `assets/index-G1puF6ap.js` **93.43 kB**（P0 前 118.23 / 93.29）

## 七项状态

| # | 项 | 结论 |
|---|---|---|
| ① | RESP-02 窗口最小尺寸 | ✅ `src/main/index.ts:67-68` 加 `minWidth:960, minHeight:600` |
| ② | VIS-01 令牌补齐 | ✅ 四态语义色 + `--border-strong` + 尺寸/间距/圆角标尺；**既有令牌零删除** |
| ③ | RESP-01 四档断点 | ✅ `index.html:1398-1426` 替换单一 920px；**首次交付含 R-1 缺陷，已修并复验** |
| ④ | A11Y live 通道 | ✅ `index.html:1928`；`aria-live` 实测 **1 → 2** |
| ⑤ | PERF `scrollStream` 合帧 | ✅ `app.js:894-903` rAF 合帧，语义不变仍滚到底 |
| ⑥ | BLOCKED 立案 | ✅ 7 探针命中 0 的实测表 + 改指映射表 + 待裁决；**未改 `panels-check.ts`** |
| **R-1** | 1279/1023 档会话行不可辨识 | ✅ 已修并复验：`readableTitles` **0 → 8**（五档全绿） |
| **S-1** | 输入区/右板被排在 `.app` 之外 | ✅ 已修并复验：删 2 行多余 `</div>`；五档 `composerParent=main.chat` |

冻结钩子零回归：`data-tool-toggle` **6** / `data-ask` **1** / `data-m1e-` 伪造 **0**。

## 关键事件：R-1（拦下的一个缺陷）

`@media (max-width:1279px)` 的 `.sidebar .s-txt{display:none}` 是**活规则**（会话标题就是它），
而普通会话行**不含图标** → 64px 图标栏内容宽仅 28px、`···` 按钮就占 24px ⇒ 标题宽度必然为 0。
影响两档：1024–1279 每行只剩 `···`；**960–1023 打开抽屉后 8 个会话行全空白**。

**修法**：该档改「窄列 + 文字可读」（`width: min(var(--sidebar-w), 208px)`），保留全部文字。
**独立复验**：可读标题数 **0 → 8**（两档都验）；主区 1100 − 208 = 892px ≥ RESP-03 的 480px。

## 关键发现：S-1（存量结构缺陷，已修复并反向对照证伪）

**默认窗口 1280×832 下，输入区与右板完全不在首屏。**
`.composer`（y=832 = 视口高，可见 0px）、右侧 `.gutter`、`aside.drawer`（y=1002）都是 `<body>` 的直接子节点，
不在 `.app`/`.shell` 内；而 `.app{height:100vh}` 已吃掉整个视口。`composerW=1280`（=视口宽，正确应在 `main.chat` 内约 1008px）。
整页下滚 478px 后输入区才出现，且横跨整个窗口宽。

**归因：存量缺陷，非本轮引入** —— 更早的 `proto/forge-prototype.html` 有同类错位（标记深度净 −7），当前 `index.html` 为 −5；
P0 只改 CSS / 窗口项 / `scrollStream`，搬不动 DOM 节点。

**根因**：`src/renderer/index.html` 静态消息标记里**多出 2 个 `</div>`**（原 `:1558` 16 空格 / `:1559` 14 空格）。
它们让第 2 条 AI 消息的 `.msg-body` 与 `.msg` 依次提前闭合，`.msg-actions` 被解析成 `.stream-inner` 的第 3 个子节点，
闭合余额继续上抛，把 `.stream-inner` → `.stream` → `main.chat` → `.shell` → `.app` 依次提前关掉。

**修法**：删这两行。**修后实测**（1280×832）：`composerParent` `body.` → `main.chat`、`drawerParent` `body.` → `div.shell`、
`composerW` 1280 → 660、`bodyChildren` 9 项 → 5 项、`drawerRect` `0,930,…` → `940,44,340,788`；五档 `readableTitles` 全为 8、`errors: []`。

**反向对照（本轮新增的证伪环节）**：把两个 `</div>` 塞回构建产物，跑**同一支**探针 —— `bodyChildRects` 三项
（`div.composer@y832,h149` / `button.gutter@y996,h0` / `aside.drawer@y1002,h308`）与原始缺陷记录**逐字相同**，
证明判据真能抓出这个 bug，不是恒真的绿门。

> **一个被证伪的判据（留档）**：我原本要求用 `.msg-actions` 的 `parentElement.className` 区分两种修法，
> 实测**两态都读到 `div.msg-body`**，不具判别力；改用 `streamInnerKids` / `msgAiParent` 才分开。
> 教训：判据写下后必须用反向对照验证它**真的能分辨两态**。

## 新增工具 `proto/cdp-probe.mjs`

一次跑「多档视口 × 双主题」→ PNG 截图 + DOM 实测数字 + 页面运行时错误。三个踩坑点已固化在文件头注释里：

- **Electron 在本宿主不可用**：起真实 renderer 时整个进程组被 SIGTERM（`exit=137`，stderr 全空）→ 改走 **Chrome 153 + CDP**（Node 22 自带 `WebSocket`/`fetch`，零依赖）
- **`file://` 不可用**：Chrome 按 CORS 拦 `<script type="module">`，`app.js` 不执行 → 测出 `sessionCount=0` 的假象；探针内置 HTTP 服务
- **探针自身伪影**：`*{animation:none}` 会把 `animation:...both` 的元素钉在首帧（`.quick-card` 基态 `opacity:0`）→ 改走应用自带减动效通道

## 待办收口轮结果（2026-09-17 下午）

用户就「处理待办内容」拍板四项，**全部执行完毕**：

| 裁决 | 结果 |
|---|---|
| ① 执行范围 = 全部做完 | 判据改指 + 底栏 VIS-02 + 死代码 VIS-06 + 新门禁 **26 → 28** + docs 漂移清理 —— 全部落地 |
| ② vanilla 入库 = 只提交 `src/renderer/` | 提交 **`e259113`**（6 files，+4338 / −1752） |
| ③ React 归档 = 先移植虚拟化再归档 | 本轮**只做移植前置的记录与判定表收口**，未动 React 树 |
| ④ GAP-03 = 接受占位 | git 面板落骨架视图 + 明确空态（数据缺失时不报错） |

### 新门禁（26 → 28）

- `renderer-arch-check`：干净产物 **28/28 通过**；反向对照（塞回两个 `</div>` 的产物）**14/28 判红**，失败断言逐条命中 S-1 签名 ⇒ 有真实判别力
- `a11y-check`：干净产物 **3/3 通过**（12 条规则全 0）；两条反向对照均判红
- 两道门默认走 `--static out/renderer`（Electron 交付壳在本宿主起不来，见 `BLOCKED.md:432`），**Electron 路径保留为显式 opt-in**

### 本轮揪出的真问题

1. **`a11y-check` 抓到两个真实可达性缺陷**（连干净产物都红）：关闭态浮层内可聚焦元素仍留在 tab 序（**33** 条）；`.composer-box` / `#searchInput` 边界对比度 **1.21:1 / 1.09:1** 不满足 WCAG 1.4.11 的 3:1（**6** 条）。
   **规范 `02-design-system.md:42` 早已指定 `--border-strong`，实现漏了** ⇒ 属补齐既有规范，不是新范围。已修，两主题实测 **3.64:1 / 3.83:1**。
2. **门禁自身的假阳性**：`a11y-check` 规则 5 注释自称「与 axe 同口径」，却漏了 axe 认的 `inert` —— 摘掉与在位**报数同为 33**（零分辨力）。
   按「判据纠错」裁决补 1 行，并强制三行对照证明**不是无差别静音**（摘掉 inert 仍判红）。
3. **`panels-check` 首次跑通到断言层**（此前被宿主 safe-delete 守卫拦在构建），红因二分清楚：**vanilla 无虚拟化**（用户已裁决留位）+ 两条判据缺陷。
   其中 **B3/B4 全绿**——git 面板 + 布局持久化在真实 Electron + CDP 下被门禁**自己**验证通过。

### 未开始（P1/P2）

`app.js` 模块拆分与单一状态源 · 卡片/面板注册表 · **长会话窗口化（虚拟化）** · React 树归档 · 任务执行视图/运行批次历史 ·
CSS 出层（944 处硬编码 px 收敛）· 图标栏档的正式实现

### 仍待裁决

1. `panels-check` 三项：事件计数断言改指 / 两条滚动断言补 `> 0` 下界 / 虚拟化移植是否单独立项
2. `src/main/index.ts` 的 **RESP-02 5 行**：该文件 diff **归属混合**（另 4 行属并发工作流的 `closeAllEventLogs`，依赖同被改的 `src/events/index.ts`），故**未纳入本轮提交**，暂留工作树
3. 其余文档行号漂移：`docs/CODE-WIKI.md:61`/`:328`、`docs/solpi-port-proposal.md:265`/`:218`/`:324`、权威包 `01/04/05/06` 与 `03` 的其余引用

---

详细逐项实测数字与证据见 `outputs/frontend-refactor-2026-09-17/07-todo-closure.md`（待办收口轮）与
`06-p0-implementation.md`（P0 实施轮）；证据图在 `outputs/frontend-refactor-2026-09-17/evidence/shots/`。
