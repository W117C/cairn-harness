# P0 实施与独立验证报告（2026-09-17）

> 本文档是诊断交付包（`00`–`05`）的**实施轮**记录：按 `05-master-plan.md` 的 P0 批次落地代码，
> 并给出**主理人独立复跑**（不采信成员自评）的实测数字与截图证据。
>
> 交付形态：本轮**改动代码**（`src/renderer/index.html`、`src/renderer/app.js`、`src/main/index.ts`、`BLOCKED.md`）。

---

## 0. 状态总览

| # | 项 | 状态 | 独立复跑结论 |
|---|---|---|---|
| ① | RESP-02 窗口最小尺寸 960×600 | ✅ 完成 | `src/main/index.ts:67-68` 命中 |
| ② | VIS-01 四态语义色 + 尺寸/标尺令牌 | ✅ 完成 | light/dark 双块齐备，既有令牌零删除 |
| ③ | RESP-01 四档断点替换单一 920px | ✅ 完成（**含一次返工**） | 与 `02-design-system.md §C.2` 逐行吻合；**首次交付有 R-1 缺陷，已修并复验** |
| ④ | A11Y live 播报通道 | ✅ 完成 | `ariaLiveCount` 实测 **1 → 2** |
| ⑤ | PERF `scrollStream` rAF 合帧 | ✅ 完成 | `app.js:894-903`，语义不变 |
| ⑥ | BLOCKED 立案（panels-check 探针判据） | ✅ 完成 | 格式、证据、处置、待裁决四项齐备 |
| **R-1** | 1279/1023 档会话行不可辨识 | ✅ **已修并复验** | `readableTitles` 实测 **0 → 8**（五档全绿） |
| **S-1** | 输入区/右板被排在 `.app` 之外 | ✅ **已修并复验**（**存量缺陷**，非本轮引入） | 删 2 行多余 `</div>`；五档 `composerParent=main.chat`；**反向对照精确复现原 bug**（§4） |

**构建**：`node node_modules/electron-vite/bin/electron-vite.js build` 成功
（`out/renderer/index.html` **121 892 B → 121 848 B**，`out/renderer/assets/index-G1puF6ap.js` 93.43 kB；P0 前为 118.23 kB / 93.29 kB）。
HTML 产物**净减 44 字节**，恰好等于删掉那两行 `</div>` 的字节数（`16 空格 + </div> + \n` = 23，`14 空格 + </div> + \n` = 21）
——`diff` 显示整份产物的差异**只有这两行**，这是「只删了这两行、没顺手动别处」的字节级闭环证据（详见 §4.4.1）。

---

## 1. 逐项实测

### ① RESP-02 · 窗口最小尺寸

`src/main/index.ts:67-68` 在 `new BrowserWindow` 内加 `minWidth: 960, minHeight: 600`，
对齐四档断点最低档，防止窗口拖到更小后布局碎裂。

### ② VIS-01 · 令牌补齐

| 组 | 位置 | 内容 |
|---|---|---|
| 四态语义色 | light `:59-66` / dark `:108-115` | `--st-run` `--st-wait` `--st-stuck` `--st-fail` + 各自 `-fg` |
| 交互描边 | light `:68` / dark `:117` | `--border-strong`（`--border` 仅 1.21:1，不满足 WCAG 1.4.11 非文字 3:1） |
| 尺寸令牌 | light `:70-73` / dark `:119-122` | `--statusbar-h` `--tap-min` `--titlebar-h` `--rail-w` |
| 间距标尺 | `:130-132`（主题无关） | `--sp-1` … `--sp-12` |
| 圆角标尺 | `:134-135` | `--r-1` … `--r-7` `--r-pill` `--r-full` |

**既有令牌零删除**（独立计数）：`--sidebar-w` 5 / `--accent` 107 / `--t-fast` 28 / `--content-max` 6 /
`--ok` 18 / `--warn` 12 / `--danger` 23 / `--muted` 99 / `--fg` 91 / `--bg` 11。

### ③ RESP-01 · 四档断点（`index.html:1398-1426`）

四档查询串齐备：`min-width:1600` / `max-width:1599` / `max-width:1279` / `max-width:1023`。
原单一 `@media (max-width:920px)` 的行为被逐条归并（`.gutter` 隐藏、`.shell{--content-max:none}`、
`.drawer` Sheet 化、`.drawer.open-m`、`.bubble 92%`），实现与规范 §C.2 骨架逐行吻合。

实施成员额外保留了规范骨架**漏写**的 `.drawer.collapsed{ width:min(var(--drawer-w),88vw) }`
（原 920 块行为，浮层态下重述 collapsed 宽度）——判断正确。

### ④ A11Y · live 通道

`index.html:1928` 加 `<div class="sr-only" id="runStatusLive" role="status" aria-live="polite" aria-atomic="true">`。
**只做 DOM 通道，未改 `app.js` 播报逻辑**（播报归 P1）。独立实测 `[aria-live]` 计数 **1 → 2**。

### ⑤ PERF · `scrollStream` 合帧（`app.js:894-903`）

```js
let scrollPending = false;
function scrollStream() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    const stream = $('.stream');
    stream.scrollTop = stream.scrollHeight;
  });
}
```

打字机每 6 字符调一次，原先每次都触发「读 `scrollHeight` → 强制同步重排」；
现在同一帧内至多一次。**语义不变**：仍滚到底部。

### ⑥ BLOCKED 立案

`BLOCKED.md` 末尾追加条目，含：7 个 `data-m1e-*` 探针在发货 vanilla 层**全部 0 命中**的实测表、
逐探针改指映射表（指向 `02-design-system.md §E.2`）、`panels-check.ts:12` 硬 `import projections` 的附加依赖、
「待裁决」状态，并明确 **本轮未改 `scripts/panels-check.ts`**。**符合判卷纪律**（发现判据缺陷 → 立案，不改代码去绕）。

---

## 2. R-1：一次被拦下的缺陷（本轮最重要的质量事件）

### 2.1 缺陷

`@media (max-width:1279px)` 内的 `.sidebar .s-txt{display:none}` 是**活规则**，不是 no-op：

- `app.js:134` 的 `sessionItemHTML` 确实产出 `<span class="s-txt">` 作为会话标题；
- 而普通会话行**不含任何图标**（只有 `s.running` 时的 `RUN_GRID_HTML` 与 `s.pinned` 时的 `.pin-ind`）；
- 宽度算账：`--rail-w:64px` − `.session-scroll{padding:0 8px}` 16px − `.session{padding:3px 10px}` 20px
  = **内容宽 28px**，而 `.sb-trigger`（`···`）本身约 24px ⇒ 标题宽度必然为 0；
- 左栏**没有手动折叠开关**（`app.js` 无 sidebar toggle），用户无法自救。

### 2.2 影响面：两档，第二个更严重

| 档位 | 现象 |
|---|---|
| **1024–1279（图标栏档）** | 每行只剩一个 `···`；「置顶/项目/最近」分组标签、「时间」排序按钮、「新建对话」「已归档」文字**竖排换行**（后两者是**裸文本节点、不在 `<span>` 里**，故 `.new-chat span{display:none}` 那两条确实 no-op——但 `.s-txt` 不是） |
| **960–1023（抽屉档）** | **打开抽屉后 8 个会话行全是空白**——这是抽屉唯一入口的档位，等于会话名全丢 |

### 2.3 修法（窄列，而非图标栏）

图标栏方案在 P0 不可行：要让 64px 栏可用，需把侧栏**每个文本节点**包进 `<span>` 并各自配图标，
而会话之间**没有天然区分性图标**。故该档改为「窄列 + 文字可读」：
删 `.sidebar{width:var(--rail-w)}` 与整条隐藏规则，改 `.sidebar{ width: min(var(--sidebar-w), 208px) }`；
Sheet 化 / `.gutter` 隐藏 / `--content-max:none` 一字未改。`--rail-w` 令牌保留定义，留给 P1 正式图标栏。

### 2.4 独立复跑（主理人实测，非成员自评）

| 视口 | 栏宽 | `.s-txt` 计算样式 | 可读标题数 | `errors` |
|---|---|---|---|---|
| 修复前 1100 | 64 | `display:none` | **0 / 8** | `[]` |
| 修复后 1100 | **208** | `visible` | **8 / 8** | `[]` |
| 修复前 1000（抽屉开） | 264 | `display:none` | **0 / 8** | `[]` |
| 修复后 1000（抽屉开） | 264 | `visible` | **8 / 8** | `[]` |

主区宽度自证：1100 − 208 = **892px** ≥ RESP-03 要求的 480px。

> **方法论教训（值得留档）**：实施成员最初判定该选择器「全 0 命中 → no-op」，根因是它用了
> 在本 shell **静默失效**的 `grep "\|"` 交替写法（macOS BSD grep 的 BRE 不支持 `\|`），
> 得到空结果后误读为「无命中」。**本主机上一律用 `grep -E`**。
> 更重要的纪律：**「选择器是否命中」这类判断不能靠 grep 推断，要靠浏览器解析后的运行时事实。**

---

## 3. 验证工具：`proto/cdp-probe.mjs`（本轮新增，可复用）

一次跑完「多档视口 × 双主题」，同时产出 **PNG 截图** + **DOM 实测数字** + **页面运行时错误**。

```
node proto/cdp-probe.mjs <htmlPath> <outDir> '<jobsJson>' [delayMs]
```

- **为什么不用 Electron**：本宿主会在 Electron 起真实 renderer 时把整个进程组 SIGTERM
  （实测 `exit=137`、stderr 全空；最小 `data:` URL 用例却能过）。改走 **Chrome 153 + CDP**，
  Node 22 自带全局 `WebSocket` + `fetch`，**零第三方依赖**。
- **为什么内置 HTTP 服务**：`file://` 下 Chrome 按 CORS 拦截 `<script type="module">`，
  `app.js` 根本不执行，测出来是「只有静态标记」的假象（实测 `sessionCount=0`）。起本地静态服务即消除。
- **被测页面必须是构建产物**（`out/renderer/index.html`）：源文件用绝对 `/app.js` 引用。

### 3.1 探针自身的一个伪影（已修，留档）

初版用 `*{animation:none!important}` 冻结动效，结果 `.quick-card` 报 `opacity:0`——
因为它的入场动画是 `animation:quickIn … both`，`fill-mode:both` 会把元素钉在**首帧**，
而首帧正是 `opacity:0`（`index.html:1389` 的注释恰好警告过这一点）。
**修法**：改走应用自带的减动效通道（`html.reduce-motion` + CDP 模拟 `prefers-reduced-motion: reduce`），
这些分支在应用侧就是为「冻结后仍然正确」设计的。修复后 `quickCardVis: "visible"`。

> 纪律：**探针报出的异常必须先排除探针自身的伪影，再当作产品缺陷。**
> 这条纪律在底栏验收时**第二次**生效，见 §3.1b。

### 3.1b 探针自身的第二个伪影：`px()` 量的是宽不是高（已修，留档）

底栏验收时探针报出两个「异常」，看起来都像产品缺陷：

- `statusbarH` = **1280 / 1280 / 1600 / 1100 / 1000** —— 五档**恰好各等于该档的视口宽度**
- `sbItemH` = **68** —— 与实现方实测的 12 不符

`statusbarH` 五档全部等于视口宽，是「量错了维度」的典型指纹：真值 24 与视口宽**无关**，
不可能随视口宽线性变化。根因在 `proto/cdp-probe.mjs:74`：

```js
const px = (el) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
```

`px` 量的是**宽**，名字里的 p 是 pixel 不是 padding。该辅助函数在 `sidebarW` / `drawerW` /
`composerW` / `firstTitleW` 等处**用对了**（那些字段确实是宽度），但新加的 `statusbarH` /
`sbItemH` 两个 **H 字段**直接复用了它 → 量到的是宽度。

**修法**：新增 `const ph = (el) => …getBoundingClientRect().height…`（`proto/cdp-probe.mjs:77`），
两个 H 字段改用它。修复后（三档复跑，`errors: []`）：

| 视口 | `statusbarH` 修前 → 修后 | `sbItemH` 修前 → 修后 |
|---|---|---|
| 1280×832 light | 1280 → **24** | 68 → **12** |
| 1600×900 light | 1600 → **24** | 68 → **12** |
| 1000×832（双抽屉开） | 1000 → **24** | 68 → **12** |

**结论：两处都是探针伪影，产品从未有问题**——`#statusbar` 真高 **24**（= `--statusbar-h`），
`.sb-item` 真高 **12**（`index.html:354` 那个 32px 的类名冲突已被 `.statusbar .sb-item`
限定修掉）。**实现方自评的 `24 / 12` 是对的，主理人初测的 `1280 / 68` 是错的**——
若不做这一步归因，就会拿一个假缺陷去改一个没坏的东西。

**附带教训（已入记忆）**：同一次消息里对**同一个文件**发两处并行 `Edit` 会丢更新——
`sbItemH` 的改动生效、`statusbarH` 的改动被静默覆盖（工具**两次都报 success**）。
同文件多改必须**串行**，且改完要 grep 复核落盘。

### 3.2 独立复跑矩阵（R-1 修复后，全部 `errors: []`）

| 视口 | 栏宽 | 栏定位 | 右板定位 | gutter | 主区内容宽 | `readableTitles` | `aria-live` |
|---|---|---|---|---|---|---|---|
| 1680 light | 264 | static | relative | block | 1040（封顶生效） | 8 | 2 |
| 1440 light | 264 | static | relative | block | 772 | 8 | 2 |
| 1280 light（默认窗口） | 264 | static | relative | block | 612 | 8 | 2 |
| 1100 light | **208** | static | fixed | none | 892 | 8 | 2 |
| 1000 light（抽屉开） | 264 | **fixed** | fixed | none | 1000 | 8 | 2 |
| 1440 dark | 264 | static | relative | block | 772 | 8 | 2 |

> 该矩阵在 S-1 修复后由主理人**再次整表复跑**，六档数字逐项不变（§4.5 的表格是同一批实测的另一视角），
> 即 S-1 的 2 行删除**没有**动到 R-1 的结论。

全程：`bodyScrollW` == 视口宽（无横向溢出）、`composerVis: "visible"`（RESP-03 输入区不折叠）、
`docTheme` 随注入切换正确（深色主题深底浅字、可读）。

**冻结钩子零回归**：`data-tool-toggle` 仍 **6**、`data-ask` 仍 **1**、`data-m1e-` 伪造仍 **0**。

---

## 4. S-1：复跑中发现的存量结构缺陷（**已修复并独立复验**）

### 4.1 现象（1280×832，应用默认窗口尺寸）

运行时 DOM 事实（探针实测）：

```
bodyChildRects: [
  "div.app@y0,h832",          ← .app 高度 = 100vh，铺满视口
  "div.composer@y832,h149",   ← 输入区起点 = 视口高 ⇒ 可见高度 0px
  "button.gutter@y996,h0",
  "span.sr-only@y980,h1",
  "aside.drawer@y1002,h308",  ← 右板同样在视口外
  ...
]
composerParent: "body."      drawerParent: "body."
shellChildren: ["aside.sidebar","button.gutter","span.sr-only","main.chat"]   ← 无 .drawer
chatChildren:  ["h1.sr-only","div.stream","div.msg ai"]                        ← 无 .composer
composerW: 1280              ← 等于视口宽；而 main.chat 只有 1008 宽
```

即：解析后 `.composer`、右侧 `.gutter`、`aside.drawer` 都成了 `<body>` 的直接子节点，
而 `.app{height:100vh}`（`index.html:163`）已吃掉整个视口 ⇒ 三者被排在**首屏之外**。
把整页下滚 478px 后输入区才出现（`div.composer@y354`），且**横跨整个 1280px 窗口宽**
（正确布局下应在 `main.chat` 内、约 1008px 宽）。**默认窗口下用户看不到输入框。**

### 4.2 归因：存量缺陷，非本轮引入

- 更早的原型 `proto/forge-prototype.html` 有**同类错位**（标记深度扫描：净深度 **−7**，
  `main.chat` 进入深度 2、`.composer` 深度 3、`.drawer` 深度 1、`.settings-overlay` 深度 **−1**）；
  当前 `src/renderer/index.html` 为 **−5**，构建产物同为 −5。
- 本轮 P0 只改 CSS 令牌 / 媒体查询 / `src/main/index.ts` 窗口项 / `app.js` 的 `scrollStream`，
  **没有任何一处能搬动 DOM 节点**；`app.js` 全文仅 `:2033` 一处读 `.composer-box`，从不搬动 composer。

### 4.3 根因（已定位并在 `/tmp` 副本上证成）

**根因：`src/renderer/index.html` 的静态消息标记里多出 2 个 `</div>`。**

**机制（由 §4.4 反向对照实测反推，非推测）**：这 2 个多余闭合让**第 2 条 AI 消息的 `.msg-body` 与 `.msg` 依次提前闭合**，
于是紧随其后的 `.msg-actions` 被解析成 `.stream-inner` 的**第 3 个直接子节点**（本该是第 3 条消息 `div.msg ai`）；
闭合余额继续级联上抛，把 `.stream-inner` → `.stream` → `main.chat` → `.shell` → `.app` 依次提前关掉，
文件末尾 `L1748/L1749` 那两个「看起来多余」的 `</div>`，其实**本该是 `.shell` 与 `.app` 的合法闭合**，
只因前面少了匹配而失去归属。所以这不是「少闭合」，而是**多了 2 个闭合**（全文件 div 净差 −2，与标记深度扫描的 −5 同源）。

**定位方法**：逐行追踪 `div` 收支，找「闭合缩进与所配开标签缩进不符」的行——该方法的两条独立预测
（`.composer` 落深度 1、`chatChildren` 缺 `.composer`）与浏览器解析结果**逐条吻合**，互为印证。

**修法**：删除两行纯 `</div>`

| # | 行号 | 缩进 | 上下文 |
|---|---|---|---|
| 1 | `index.html:1558` | 16 空格 | 上一行 `:1557` 的 `</div>`(16)，下一行 `:1559` 的 `</div>`(14) |
| 2 | `index.html:1559` | 14 空格 | 上一行 `:1558` 的 `</div>`(16)，下一行 `:1560` 的 `<div class="msg-actions">`(14) |

> 行号勘误：本报告早先版本写的是 `1546` / `1559`（主理人的第一次判断，**是错的**）。
> 经反向对照（§4.4）实测，真正多出来的是 `1558`/`1559` 这一对；`1546` 的假设已作废。

### 4.4 反向对照：证明判据不是真空（本轮新增的证伪环节）

只证明「删了就好」是不够的——必须证明**判据能把这个 bug 抓出来**，否则可能是一道恒真的绿门。
做法：把 `out/renderer` 拷到 `/tmp/dsh-s1neg`，在构建产物第 1559 行（= 源码 `:1558`）前**把两个 `</div>` 塞回去**，
跑**同一支**探针。1280×832 实测：

| 指标 | 修后（真·当前仓库） | 反向对照（塞回 2 个 `</div>`） |
|---|---|---|
| `composerParent` | **`main.chat`** | `body.` ← bug 复现 |
| `drawerParent` | **`div.shell`** | `body.` ← bug 复现 |
| `composerW` | **660** | 1280（=视口宽）← bug 复现 |
| `chatChildren` | `[h1, div.stream, div.composer]` | `[h1, div.stream, div.msg ai]` |
| `bodyChildren` | **5 项** | 9 项 |
| `bodyChildRects` | 全部在视口内 | `div.composer@y832,h149`、`button.gutter@y996,h0`、`aside.drawer@y1002,h308` |
| `streamInnerKids` | `[msg user, msg ai, msg ai]` | `[msg user, msg ai, **msg-actions**]` |
| `msgAiParent` | **`div.stream-inner`** | `main.chat` |
| `msgAiRect` | `320,404,564,85` | `272,769,1008,63`（视口外 + 宽 1008） |
| `streamInnerRect` | `296,68,612,**421**` | `470,68,612,**324**` |

`bodyChildRects` 三项与 §4.1 记录的**原始缺陷数字逐字相同**（`y832,h149` / `y996,h0` / `y1002,h308`），
证明反向对照**精确复现了原始 bug**，而不是另一个相似状态。

`streamInnerRect` 的高度差还有算术闭环：324 + 63（漏出去的 `.msg.ai` 高度）+ 边距 ≈ **421** ——
即修后 `.stream-inner` 比坏态**多装了一条完整的消息**，说明它是**完整**而非被截断的容器。

#### 4.4.1 最小性证明（字节级闭环）

反向对照顺带给出了「**只删了这两行、没顺手改别处**」的硬证据。对当前产物与反向对照产物做 diff：

```
$ diff out/renderer/index.html /tmp/dsh-s1neg/index.html
1557a1558
>                 </div>
1558a1560
>               </div>
```

**整份 HTML 的差异就是这两行**，别无其他。字节数同样闭合：

| | 字节数 |
|---|---|
| 当前产物 `out/renderer/index.html` | **121 848** |
| 反向对照（塞回 2 行） | **121 892** |
| 差 | **44** |
| 两行自身字节数（`od -c` 实测） | `16 空格 + </div> + \n` = **23**，`14 空格 + </div> + \n` = **21**，合计 **44** ✅ |

`121 892 B = 121.89 kB`、`121 848 B = 121.85 kB` —— 与构建日志的两位小数**逐位吻合**。
这条闭环同时排除了「改对了地方但顺带动了别的标记」这类隐患。

> **一个被证伪的判据（留档，避免后人重走）**：主理人曾要求成员用 `.msg-actions` 的 `parentElement.className`
> 来区分「两种修法」。实测**不具判别力** —— 修后与坏态都读到 `div.msg-body`
> （真正变的是它的**祖父**是否还是 `.stream-inner` 的直接子节点）。
> 换用 `streamInnerKids` / `msgAiParent` 才把两态分开。
> **教训：判据写下后必须用反向对照验证它真的能分辨两态，不能只验证「期望的那一侧成立」。**

### 4.5 修复后五档独立复跑（主理人实测，非成员自评）

对**当前仓库构建产物** `out/renderer/index.html` 跑五档矩阵，全部 `errors: []`：

| 视口 | `composerParent` | `drawerParent` | `drawerRect` | `composerW` | `bodyChildren` | `readableTitles` | `ariaLive` | `bodyScrollW` |
|---|---|---|---|---|---|---|---|---|
| 1680×1050 light | `main.chat` | `div.shell` | `1340,44,340,1006` | 1060 | 5 项 | 8 | 2 | 1680 |
| 1440×900 dark | `main.chat` | `div.shell` | `1100,44,340,856` | 820 | 5 项 | 8 | 2 | 1440 |
| **1280×832（默认）** | `main.chat` | `div.shell` | `940,44,340,788` | 660 | 5 项 | 8 | 2 | 1280 |
| 1100×832 | `main.chat` | `div.shell` | `1100,44,340,788`（右出屏＝收起态） | 892 | 5 项 | 8 | 2 | 1100 |
| 1000×832（双抽屉开） | `main.chat` | `div.shell` | `660,44,340,788` | 1000 | 5 项 | 8 | 2 | 1000 |

- 五档 `chatChildren` 均为 `["h1.sr-only","div.stream","div.composer"]`、`shellChildren` 均为 7 项含 `aside.drawer`
- 五档 `msgBodyCount` 3、`tgBodyCount` 1、`streamInnerParent` `div.stream`、`drawerAncestors` 三级链完整
- **R-1 未回归**：五档 `readableTitles` 全为 8、`newChatTextVis` / `archiveTextVis` 均 `visible`
- 冻结钩子不回归：`data-tool-toggle` **6**（`index.html` 3 + `app.js` 3）、`data-ask` **1**（`app.js`）、`data-m1e-` 伪造 **0**
- 证据图：`evidence/shots/s1-after-1280x832-composer-visible.png` 与本次实测 PNG **md5 逐字节相同**
  （`4826331df1663a9996f9267fafcba6dd`），证明早先留档的对照图确实来自真实构建产物；
  新增 `evidence/shots/s1-negctl-1280-two-divs-restored.png`（反向对照）

**截图对照（人眼可判）**：

- 修后 1280×832 —— 输入区（`工作区 / 工作树` + 输入框 + `标准权限 / Forge-1`）正确落在主列底部，
  右板 340px 带 4 张快捷卡在位，**无整页滚动**
- 反向对照 —— 输入区整块消失、第 3 条消息横跨 1008px 且被视口底边裁断、右板完全在视口外

**处置**：已完成。修法由原型构建师落地（删 `src/renderer/index.html:1558`/`:1559` + 重建），
主理人对构建产物独立复跑五档矩阵 + 反向对照，全部通过（§4.5 / §4.4）。

> 工具可靠性说明：主理人另写了三个**静态**扫描器（标记深度、栈式嵌套、逐行 div 收支）辅助定位。
> 前两个会因多行开标签 / SVG / 注释而误报，**只能当线索**；第三个（纯 div 收支）预测与浏览器解析结果吻合，
> 但仍以**探针实测**为最终判据。**判据一律以浏览器解析结果为准。**

---

## 5. 未开始项（P1/P2，如实标注）

- `app.js`（2281 行）模块拆分 → 9 文件；单一状态源
- 卡片/面板注册表、差量重渲染
- 长会话窗口化（当前 `r.events.forEach(renderEvent)` 零虚拟化）
- React 树归档（决策表已备）
- 任务执行视图 / 状态栏 / 运行批次历史（GAP 项）
- CSS 出层（944 处硬编码 px / 60 个数值待收敛到标尺）
- 死代码修复（`app.js:419/465` 的 `data-archived` 守卫恒为真）
- 门禁登记：`renderer-arch-check.ts`、`a11y-check.ts`、`renderer-golden` 视觉回归
- 图标栏档的正式实现（会话行图标语义待设计；`--rail-w` 令牌已预留）

## 6. 待用户裁决（沿用诊断轮，未变）

1. `panels-check` 探针判据变更（需授权改 `scripts/panels-check.ts`）——**建议优先**
2. 未提交的 vanilla 渲染层迁移是否提交
3. React 树归档时机
4. GAP-03 结构性占位是否接受
5. `docs/` 截图与历史 UI 提案的漂移清理
