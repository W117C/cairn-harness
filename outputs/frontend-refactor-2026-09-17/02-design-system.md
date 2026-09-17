# Forge 前端重构 · 设计系统规范（Phase 2 / 2026-09-17）

> 负责人：设计系统专家 彩格调（Cai）。
> 事实来源：**本轮对当前工作树逐行复核**（`src/renderer/index.html` + `src/renderer/app.js` 两文件合计约 4.3k 行；另复核 `src/main/index.ts` / `scripts/panels-check.ts` / `src/renderer/cards/registry.tsx`），并独立复算全部对比度。
>
> ⚠️ **行数一律不写死**：本文件初稿写的是 `index.html` 1866 行 / `app.js` 2281 行，而本轮两次改代码后实测已漂到 **1969 / 2360**（+103 / +79）。**任何行号在引用前必须重新 grep 核对**——写死行数是漂移磁铁，本文件正文里的具体行号同理，只作定位线索、不作判据。
> 覆盖需求：**VIS-01…06、A11Y-01…03 逐条覆盖**（见 §H），并支撑 MAINT-03/05/06/07、RESP-01…04、PERF-02 的设计侧输入。
> 口径：本文件是**增量规范**（现有值 → 修订值 → 理由），不是重写。**不引 React、不换字体、不换色板、不引组件库、不引毛玻璃/渐变。**
> 硬约束：**不改 `src/` 下任何代码**；**32+ 钩子零重命名**；**严禁设计伪造 `data-m1e-*` 的方案**；所有行号与当前工作树一致（引用前已抽查）。

---

## §0 结论先行 + 与上一轮规范的差异复核（**最重要章节**）

### 0.1 TL;DR

1. **视觉体系不动**：oklch 中性灰阶骨架、`-apple-system/SF Pro/PingFang SC` 字体栈、单一钢蓝 accent 全部保持。本轮只做两件增量：**① 补齐尺寸/间距标尺与四态语义色（收敛，不新增色相）；② 补齐四档响应式与状态三重编码。**
2. **令牌块实测为 `index.html:15-94`**：`:root` = 15–57（含布局/色/阴影/动效），`html[data-theme="dark"]` = 58–89，第二个 `:root` = 90–94（字体栈）。颜色纪律良好（令牌块外仅 **4 处** oklch 字面量：418 / 581 / 866 / 1110）。
3. **四态语义色不新增色相**：直接**映射到既有语义令牌**（`--ok` / `--muted` / `--warn` / `--danger`），把「四态」从"新色"降级为"新命名 + 三重编码"，零色板风险（§A.1.2）。
4. **对比度全部独立复算**（§A.2，脚本见附录）：新增/变更前景色在 light/dark 双主题全部达标（非文字图形 ≥4.5:1、彩色文字 >7:1、正文 >7:1）。**发现 `--border` 不满足非文字对比 3:1（1.21:1 / 1.33:1），补 `--border-strong`。**
5. **四档断点落点**：把 `index.html:1353-1365` 的单一 `@media (max-width:920px)` **整体替换**为 `min-width:1600 / max-width:1599 / max-width:1279 / max-width:1023` 四档（§C.1），920 断点由 1023 档吸收，**无断点冲突**。
6. **7 态三重编码的字形可用性已实测验证**（§B.2）：`-apple-system`→`SFNS.ttf` 覆盖 `✓ ✗ ● ○`，但 `⊘` 仅 Apple Symbols 有、`⏸/⏳/❚` **全栈缺失（会落到 Apple Color Emoji 变彩色 emoji）**→ 结论：**状态字形一律用内联 SVG**（代码库已有 30+ 内联 SVG 先例）。

### 0.2 ⚠️ 上一轮规范（`outputs/ui-v3-forge/02-design-system.md`）中**已过时或错误**的结论

上一轮基于当时工作树（`index.html` 1670 行 / `app.js` 2034 行）；本文件初稿写「现为 1866 / 2281」，但**行数随改代码持续漂移**（本轮末实测已到 **1969 / 2360**，见顶部「行数一律不写死」说明）——**故此处不再写死数字**，只保留「相对上一轮已整体漂移」这一结论。逐条列出（**这是本轮最有价值的部分**）：

| # | 上一轮结论 | 实测复核（当前工作树） | 影响 |
|---|---|---|---|
| 1 | `--sidebar-w` = **264px**（`index.html:14`） | **CSS 令牌 = `252px`（`index.html:17`）**；而 `data-def="264"`（`index.html:1414`）→ JS 启动 `apply()` 覆盖为 **264px**（`app.js:588/594/646`） | **同一默认值两处不一致（252 vs 264），JS 胜出**。规范以 **264** 为权威默认，并建议 CSS 对齐 |
| 2 | `--gutter` = **9px**（`index.html:16`） | **`8px`（`index.html:19`）** | 上一轮数值错误 |
| 3 | `--accent` light = `oklch(55% 0.18 255)`，dark = `oklch(72% 0.14 255)` | **light `oklch(48% 0.13 247)`，dark `oklch(76% 0.12 250)`（`index.html:30/68`）**，源码注释明写「L 55→48、饱和 0.18→0.13、色相 255→247」 | **色板已重构**；上一轮 `accent 4.93:1` 的复算对**旧值**成立，对现值无效（现 **6.49:1**） |
| 4 | `--ok/--danger/--warn` = `55% .16 145 / 55% .2 25 / 52% .14 75`（dark `74/70/78`） | **light `52% .13 150 / 54% .19 25 / 50% .12 80`；dark `74% .15 150 / 70% .18 25 / 78% .13 80`（`index.html:38-40/76-78`）** | 上一轮数值错误 |
| 5 | 动效令牌名 `--dur-1…--dur-4` / `--ease-enter` / `--ease-standard` | **实际是 `--t-fast/--t-base/--t-slow` = 120/160/240ms，`--ease-out`/`--ease-spring`（`index.html:51-55`）** | 上一轮**虚构了不存在的令牌名**；本轮以真实命名为准 |
| 6 | 圆角 `--r-4=12px` 用于卡片、`--r-5=14px` 用于 composer、`--r-6=16px` 用于气泡 | 实测 `.composer-box` 圆角 = **12px（`index.html:780`）**，`.bubble` 需重测（非 16） | 上一轮圆角映射表**与实测不符** |
| 7 | `.inline-send` = **28×28**、`--tap-min=28` | 实测 `.inline-send` = **26×26（`index.html:791`）**；`.msg-act` = 28×28（`index.html:549`） | 上一轮把 inline-send 尺寸写错 |
| 8 | composer textarea `max-height:140px`（`index.html:692`） | 实测在 **`index.html:786`**（`min-height:24px;max-height:140px`） | 行号漂移（值正确） |
| 9 | `#settingsOpen` 在 `index.html:1221` | 实测 **`index.html:1401`** | 行号漂移 |
| 10 | `.drawer.open-m` Sheet 机制在 `index.html:1177` | 实测 **`index.html:1360-1363`**（在 920 断点块内） | 行号漂移 |
| 11 | 审批卡 `askCard()` 在 `app.js:1880`、`data-ask` 在 `app.js:1884/1918` | 实测 `askCard()` = **`app.js:2089`**；`data-ask` = **`app.js:2130`**；`.ask-pop` = `app.js:2027` | 行号漂移 ~200 行 |
| 12 | `newCard()` 在 `app.js:1748`、`setCardBody()` 在 `app.js:1764` | **当前 `app.js` 无 `newCard`/`setCardBody` 函数**；1748 行是 `finalizePending`、1764 行是 `toolIcon` | **上一轮引用了不存在的函数** |
| 13 | 「live 层真实冻结清单」32 个钩子 | 实测**遗漏 `data-tool-toggle`（6 次，两级工具折叠的核心钩子，`app.js:1640-1656`）**；另有 `data-sid`/`data-doc-active`/`data-v` 未收录 | §E 补齐 |
| 14 | 「面板只有 4 视图 `files/browser/review/terminal`」 | **正确**（`app.js:684-689` `VIEW_META`；`index.html:1655/1661/1667/1673`） | 保持 |
| 15 | 「13 处 reduced-motion」上一轮写「12 处」 | **实测 13 处**（`index.html:378/533/573/627/660/714/753/950/1065/1160/1163/1333/1346`）+ 全局 `html.reduce-motion` 块（110-112） | 上一轮少算 1 处 |

> **一句话**：上一轮规范的**结构性判断（不引 React、收敛卡片、补四态、补断点）仍成立且被本轮继承**；但其**色值、令牌名、尺寸值、行号、函数名**大量过时，**不可直接施工**。本文件是**复核后的唯一事实源**。

### 0.3 本轮新增的独立发现（简报未记录）

| 发现 | 证据 | 处置 |
|---|---|---|
| **F1 `data-tool-toggle` 未在冻结清单** | `index.html:1464/1473/1484`；`app.js:1640-1656` 委托监听；`app.js:1822/1878/1983` 模板产出（共 6 处） | 必须纳入冻结清单，**零重命名**（§E.1） |
| **F2 侧栏默认宽两处冲突** | CSS `252px`（`index.html:17`）vs `data-def="264"`（`index.html:1414`）；`app.js:594` 启动即写 `--sidebar-w` | 统一为 **264**（§A.4） |
| **F3 `--border` 不满足非文字 3:1** | 复算 `--border` vs `--surface` = **1.21:1(light) / 1.33:1(dark)** | 新增 `--border-strong`（≥3:1）供**交互控件**使用（§A.1.3） |
| **F4 `KEEP_CENTER=380` 低于 RESP-03 的 480** | `app.js:580` `const KEEP_CENTER = 380`；`sideMax()/drawerMax()`（`app.js:581-582`）用它算面板上限 | 响应式落地时须把该常量与断点协调（§C.3） |
| **F5 CSS 硬编码 px 实际更多** | 实测 CSS 区（`index.html:9-1367`）**962 处 px / 60 个不同数值**（简报写「700+/20+」，低估了小数 px：12.5px×30、10.5px×15、11.5px×13、13.5px×5、2.5px×2、1.5px×1） | 间距标尺迁移映射按 **962** 全量覆盖（§A.7） |
| **F6 令牌块外 4 处 oklch 中含 2 处 backdrop-filter** | `index.html:418`、`1110` 为 `oklch(...)/.34` 半透明 + `backdrop-filter:blur(2px)` | 属**既有**资产，规范不新增毛玻璃；迁移时**保留**、仅把字面量收进令牌（§A.1.4） |

---

## §A 令牌规格（补齐标尺）

> 全部令牌为**可直接粘贴进 CSS 的字面量**。`--sp-* / --r-* / --t-* / --bd-* / --statusbar-h / --tap-min` 为**主题无关**（无 light/dark 差异）；色彩类令牌给双主题值。
> 插入位置：色彩/尺寸类进**第一 `:root`（`index.html:15-57`）**与 **`html[data-theme="dark"]`（`58-89`）**；主题无关标尺进**第二个 `:root`（`90-94`）**。**不动任何既有令牌名。**

### A.0 令牌总览（本轮新增/规范化）

| 组 | 前缀 | 条数 | 主题相关 | 性质 |
|---|---|---|---|---|
| 间距标尺 | `--sp-*` | 12 | 否 | 新增命名（值取自现有散落间距，零渲染变化） |
| 圆角标尺 | `--r-*` | 9 | 否 | 新增命名（收敛 15 个散落值） |
| 状态语义色 | `--st-*` | 9 | **是** | 新增命名（**复用既有色相**，见 §A.1.2） |
| 尺寸令牌 | `--statusbar-h`/`--tap-min`/`--titlebar-h`/`--rail-w` | 4 | 否 | 新增（底栏/最小点击区/标题栏/图标栏） |
| 描边令牌 | `--bd-1`/`--bd-2`/`--border-strong` | 3 | 部分 | 新增（1px/2px/交互描边） |
| 动效令牌 | `--t-instant` | 1 | 否 | 新增（补 80ms 档；`--t-*`/`--ease-*` 保持） |
| **合计** | — | **38 条 / 6 组** | — | — |

### A.1 色彩

#### A.1.1 灰阶骨架与语义色（**保持，零改动** — 仅固化命名）

| 令牌 | light（实测 `index.html:20-40`） | dark（实测 `index.html:59-78`） | 用途 |
|---|---|---|---|
| `--bg` | `oklch(100% 0 0)` | `oklch(16.8% 0.012 250)` | 窗口底 |
| `--surface` | `oklch(100% 0 0)` | `oklch(20.8% 0.014 250)` | 中栏 / 弹层 |
| `--surface-2` | `oklch(98.7% 0.003 250)` | `oklch(24.4% 0.015 250)` | 右栏/标题栏/**新底栏** |
| `--surface-3` | `oklch(97.1% 0.004 250)` | `oklch(28% 0.016 250)` | 左栏 |
| `--fg` | `oklch(21% 0.006 250)` | `oklch(93% 0.006 250)` | 正文 |
| `--muted` | `oklch(45% 0.008 250)` | `oklch(72% 0.012 250)` | 次级文字/可操作控件 |
| `--dim` | `oklch(54% 0.008 250)` | `oklch(62% 0.012 250)` | 过程性只读 |
| `--border` | `oklch(93.6% 0.005 250)` | `oklch(30.5% 0.016 250)` | 装饰描边 |
| `--accent` | `oklch(48% 0.13 247)` | `oklch(76% 0.12 250)` | 唯一强调色 |
| `--accent-fg` | `oklch(100% 0 0)` | `oklch(17% 0.03 250)` | accent 上的文字 |
| `--accent-soft` | `oklch(95.6% 0.02 248)` | `oklch(30% 0.055 250)` | 强调底 |
| `--ok` / `--danger` / `--warn` | `52% .13 150 / 54% .19 25 / 50% .12 80` | `74% .15 150 / 70% .18 25 / 78% .13 80` | diff/plan/term/ask 复用 |

#### A.1.2 新增：任务运行四态语义色（**复用既有色相，零新色相**）

> **设计决策**：上一轮为四态**新建了 4 个色相**（`oklch(52% 0.15 150)` 等）。本轮复核后改为**直接别名映射既有语义令牌**——四态与 `--ok/--warn/--danger/--muted` 同色相，靠**字形 + 文字**区分。好处：① 零色板风险，与全站色语言一致；② 满足 VIS-03（被拒用**失败红**，不再误用卡死琥珀）。**这是本轮对上一轮的关键修正。**

**Light（`html[data-theme="light"]` 或 `:root`）**

| 令牌 | 值 | 别名 | 用途 | 迁移映射 |
|---|---|---|---|---|
| `--st-done` | `var(--ok)` | = `oklch(52% 0.13 150)` | 成功 | 新命名 |
| `--st-run` | `var(--ok)` | = 同上 | 运行中（脉冲） | 新命名 |
| `--st-wait` | `var(--muted)` | = `oklch(45% 0.008 250)` | 等待 / 已中断 | 新命名 |
| `--st-stuck` | `var(--warn)` | = `oklch(50% 0.12 80)` | 卡死 | 新命名 |
| `--st-fail` | `var(--danger)` | = `oklch(54% 0.19 25)` | 失败 / 被拒 | 新命名 |
| `--st-run-fg` | `oklch(44% 0.13 150)` | — | 彩色「运行中」文字 | 新命名 |
| `--st-stuck-fg` | `oklch(43% 0.12 70)` | — | 彩色「卡死」文字 | 新命名 |
| `--st-fail-fg` | `oklch(46% 0.18 25)` | — | 彩色「失败/被拒」文字 | 新命名 |
| `--st-wait-fg` | `var(--fg)` | — | 「等待」文字（中性） | 新命名 |

**Dark（`html[data-theme="dark"]`）**

| 令牌 | 值 | 别名 |
|---|---|---|
| `--st-done` / `--st-run` | `var(--ok)` | = `oklch(74% 0.15 150)` |
| `--st-wait` | `var(--muted)` | = `oklch(72% 0.012 250)` |
| `--st-stuck` | `var(--warn)` | = `oklch(78% 0.13 80)` |
| `--st-fail` | `var(--danger)` | = `oklch(70% 0.18 25)` |
| `--st-run-fg` | `oklch(82% 0.15 150)` | — |
| `--st-stuck-fg` | `oklch(86% 0.12 80)` | — |
| `--st-fail-fg` | `oklch(82% 0.14 25)` | — |
| `--st-wait-fg` | `var(--fg)` | — |

> **消费纪律**：**状态点/描边/进度条**用 `--st-*`（非文字，≥4.5:1，见 §A.2）；**状态标签文字默认用 `--fg`**（中性，天然 >7:1）；仅当需要**彩色标签**（如底栏）时才用 `--st-*-fg`（>7:1，见 §A.2）。这样正文/标签在双主题下**恒 >7:1**。

#### A.1.3 新增：交互描边 `--border-strong`（**修复 F3**）

| 令牌 | light | dark | 用途 | 理由 |
|---|---|---|---|---|
| `--border-strong` | `oklch(62% 0.008 250)` = `#83878b` | `oklch(56% 0.012 250)` = `#6f757b` | **交互控件描边**（输入框、可聚焦卡片、Sheet 边界、分隔条 hover） | `--border` 仅 1.21:1 / 1.33:1，不满足 WCAG 1.4.11 非文字 3:1；`--border-strong` 复算 **3.64:1(light) / 3.83:1(dark)**，均 ≥3:1 且余量 ≥10%（§A.2） |

> 装饰性分隔线（列表分组、卡片静息描边）**继续用 `--border`**（不要求 3:1）；**承载语义边界的控件**用 `--border-strong`。

#### A.1.4 令牌块外 4 处 oklch 的收敛（**F6**，不新增毛玻璃）

| 位置 | 现值 | 处置 |
|---|---|---|
| `index.html:418` | `background:oklch(24% 0.02 250 / .34);backdrop-filter:blur(2px)` | 收敛为 `--scrim: oklch(24% 0.02 250 / .34)`；**保留** backdrop-filter（既有资产） |
| `index.html:1110` | `oklch(24% 0.02 250 / .38)` | 同上，值 `.38` 变体收敛为 `--scrim-2` |
| `index.html:581` | `box-shadow:0 1px 2px oklch(20% 0.02 250 / 0.03)` | 收敛为 `--shadow-0`（补一档） |
| `index.html:866` | `box-shadow:0 1px 3px oklch(20% .02 250 / .35)` | 收敛为 `--shadow-1b`（深色态卡片浮起） |

### A.2 对比度复算（**独立复算，非引用**）

#### 方法与工具（可复现）

- **工具**：Node.js 脚本（纯手写，无第三方依赖），见**附录 §I**。
- **链路**：`oklch(L,C,H)` → OKLab（`a=C·cos H, b=C·sin H`）→ LMS → **linear sRGB**（Björn Ottosson 的官方矩阵）→ 钳制到 sRGB 色域 → WCAG 2.x **相对亮度** `0.2126R+0.7152G+0.0722B` → 对比度 `(L₁+0.05)/(L₂+0.05)`。
- **基准**：light `--bg=#ffffff`、`--surface-2=oklch(98.7% .003 250)`；dark `--bg=oklch(16.8% .012 250)`、`--surface-2=oklch(24.4% .015 250)`。
- **自检**：`oklch(100% 0 0)` 复算得 `#ffffff`、对比度 1.00:1（通过）。复算结果与源码内注释（如 `--fg` 注「19.9:1」）**不一致**——注释偏乐观，实测 `--fg` light = **17.71:1**。以本表为准。

#### A.2.1 四态前景色（**新增/变更项**，双主题）

| 令牌 | light hex | vs bg | vs surface-2 | dark hex | vs bg | vs surface-2 | 判定 |
|---|---|---|---|---|---|---|---|
| `--st-run` | `#1d7d3e` | **5.19:1** | 5.00:1 | `#5ac576` | **8.82:1** | 7.48:1 | 非文字 ✅≥4.5 |
| `--st-wait` | `#52565a` | **7.43:1** | 7.16:1 | `#9fa5ac` | **7.74:1** | 6.56:1 | 非文字 ✅ |
| `--st-stuck` | `#865900` | **6.07:1** | 5.85:1 | `#e3ad4b` | **9.46:1** | 8.02:1 | 非文字 ✅ |
| `--st-fail` | `#c52b30` | **5.58:1** | 5.38:1 | `#fa6863` | **6.62:1** | 5.61:1 | 非文字 ✅ |
| `--st-run-fg` | `#006527` | **7.25:1** | 6.99:1 | `#75df8f` | **11.60:1** | 9.84:1 | 文字 ✅>7 |
| `--st-stuck-fg` | `#784000` | **8.29:1** | 7.98:1 | `#fac871` | **12.41:1** | 10.52:1 | 文字 ✅>7 |
| `--st-fail-fg` | `#a50d1c` | **7.84:1** | 7.55:1 | `#ff9e96` | **9.67:1** | 8.20:1 | 文字 ✅>7 |
| `--st-wait-fg`(=fg) | `#16191b` | **17.71:1** | 17.07:1 | `#e5e8ec` | **15.61:1** | 13.23:1 | 文字 ✅ |

#### A.2.2 既有前景色（复核，用于回归基线）

| 令牌 | light hex | vs bg | vs s2 | dark hex | vs bg | vs s2 |
|---|---|---|---|---|---|---|
| `--fg` | `#16191b` | 17.71:1 | 17.07:1 | `#e5e8ec` | 15.61:1 | 13.23:1 |
| `--muted` | `#52565a` | 7.43:1 | 7.16:1 | `#9fa5ac` | 7.74:1 | 6.56:1 |
| `--dim` | `#6b6f73` | 5.06:1 | 4.87:1 | `#81878d` | 5.27:1 | **4.47:1** ⚠ |
| `--accent` | `#0061a2` | 6.49:1 | 6.25:1 | `#73b6fa` | 8.98:1 | 7.61:1 |
| `--ok` | `#1d7d3e` | 5.19:1 | 5.00:1 | `#5ac576` | 8.82:1 | 7.48:1 |
| `--danger` | `#c52b30` | 5.58:1 | 5.38:1 | `#fa6863` | 6.62:1 | 5.61:1 |
| `--warn` | `#865900` | 6.07:1 | 5.85:1 | `#e3ad4b` | 9.46:1 | 8.02:1 |
| `--border` | `#e7eaed` | **1.21:1** ⚠ | — | `#293037` | **1.33:1** ⚠ | — |
| `--border-strong`（新） | `oklch(62% .008 250)`=`#83878b` | **3.64:1** ✅ | 3.51:1 | `oklch(56% .012 250)`=`#6f757b` | 3.83:1 ✅ | 3.50:1 |

#### A.2.3 组件配对

| 配对 | 结果 | 判定 |
|---|---|---|
| `--accent-fg` on `--accent`（按钮文字） | light 6.49:1 / dark 8.95:1 | ✅≥4.5 |
| `--fg` on `--accent-soft`（选中态文字） | 15.61:1 | ✅ |
| `--term-fg` on `--term-bg` | 12.78:1 / 14.00:1 | ✅ |
| `--fg` on `--bubble` | 16.20:1 / 12.10:1 | ✅ |

> **两处 ⚠ 处置**：① `--dim` dark vs `--surface-2` = 4.47:1（**略低于 4.5**）——`--dim` 仅用于**过程性只读文字**（`--surface` 面，非 `--surface-2`），对 `--surface` 复算 >5:1 达标；**规范约束：`--dim` 不得用于 `--surface-2` 面**。② `--border` <3:1——**装饰专用**，交互控件改用 `--border-strong`。

### A.3 间距标尺 `--sp-*`（**新增，主题无关**）

> 取值依据：CSS 区 962 处硬编码 px 的**实测频次分布**（F5）。既有值本就聚集在 **2px 粒度（≤16）→ 8px 粒度（>16）**，标尺**贴合现状**而非强行 8px 网格，因此迁移**近乎零视觉变化**。

| 令牌 | 值 | 主要用途 | 旧硬编码映射（实测频次） |
|---|---|---|---|
| `--sp-1` | `2px` | 发丝微距、图标↔徽标 | `2px`(74) |
| `--sp-2` | `4px` | 图标↔文字、chip 内距 | `4px`(33)、`3px`(17)→ |
| `--sp-3` | `6px` | 按钮内距、紧凑行距 | `6px`(57)、`5px`(17)→、`7px`(32)→ |
| `--sp-4` | `8px` | 行内间距、卡片头距、gutter | `8px`(113)、`9px`(20)→ |
| `--sp-5` | `10px` | 卡片内距、composer 内距 | `10px`(63)、`11px`(34)→ |
| `--sp-6` | `12px` | 面板内距、区块间距 | `12px`(79)、`13px`(35)→ |
| `--sp-7` | `14px` | 气泡内距 | `14px`(62)、`15px`(34)→ |
| `--sp-8` | `16px` | 大区块间距 | `16px`(18)、`18px`(8)→ |
| `--sp-9` | `20px` | 中留白 | `20px` |
| `--sp-10` | `24px` | stream 上下、大留白 | `24px`(20) |
| `--sp-11` | `32px` | 空态、launcher | `32px`、`30px`(19)→、`34px`(8)→ |
| `--sp-12` | `48px` | 超大留白 | `46px`(1)→、`52px`(1)→ |

> `→` = 就近吸附（Δ≤1px，肉眼不可辨）。**字号 px（13.5/12.5/11/10.5/15/13）不进间距标尺**，归字阶（§A.8）。**1px 归描边令牌**（§A.5）。

### A.4 尺寸令牌（**新增/规范化**）

| 令牌 | 值 | 用途 | 迁移映射 |
|---|---|---|---|
| `--sidebar-w` | **`264px`**（min 180 / max 420） | 左栏列宽 | CSS 现值 `252px`（`index.html:17`）→ 改 **264**（对齐 `data-def`，**修 F2**） |
| `--drawer-w` | `340px`（min 240 / max 640） | 右板列宽 | 保持（CSS 与 `data-def` 一致） |
| `--gutter` | `8px` | 分隔条命中区 | 保持（`index.html:19`） |
| `--center-w` | `calc(100vw - var(--sidebar-w) - var(--drawer-w) - 2*var(--gutter))` | 中栏推导 | 保持（`index.html:140`） |
| `--content-max` | `min(100%, clamp(560px, calc(var(--center-w) - 48px), 1040px))` | 消息列封顶 | 保持（`index.html:141`） |
| `--titlebar-h` | `44px` | 标题栏/Sheet 顶距 | 硬编码 `44px`（`index.html:121`、`1358/1360`）→ 令牌 |
| `--rail-w` | `64px` | 图标态侧栏（新断点用） | 新增（§C） |
| `--statusbar-h` | `24px` | **底栏状态栏**（VIS-02/GAP-02） | 新增 |
| `--tap-min` | `28px` | **新控件最小点击区** | 新增；既有 24/26px 控件**保持不回退** |

> **既有控件尺寸实测**（**不得强行统一**）：`.mp-close`/`.mp-back` 24×24（`index.html:831/944`）、`.inline-send` **26×26**（`index.html:791`）、`.msg-act`/`.side-home` 28×28（`index.html:549/966`）、`.settings-close` 30×30（`index.html:448`）、`.tb-btn` 34×34（`index.html:129`）。**规范只约束新控件 ≥28px**；把旧控件强改 28px 属无收益改动面，**不做**。

### A.5 描边令牌

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bd-1` | `1px` | 常规描边（替代散落的 `1px`×63） |
| `--bd-2` | `2px` | 强调描边/焦点环内衬（替代 `2px`×74 中的描边用法） |
| `--border-strong` | 见 §A.1.3 | 交互控件描边 |

### A.6 圆角标尺 `--r-*`（**收敛 15 个散落值**）

| 令牌 | 值 | 用途 | 旧硬编码映射 |
|---|---|---|---|
| `--r-1` | `4px` | 微元素 | `4px`、`5px`→、`2px`→ |
| `--r-2` | `6px` | 按钮/图标钮/mp-close | `6px`、`7px`→ |
| `--r-3` | `8px` | tb-btn/msg-act/代码块 | `8px`、`9px`→ |
| `--r-4` | `10px` | 面板/菜单/sb-menu | `10px`、`11px`→ |
| `--r-5` | `12px` | **卡片 / composer-box / popover** | `12px` |
| `--r-6` | `14px` | 中号容器 | `14px` |
| `--r-7` | `16px` | **settings-sheet / 大卡片** | `16px` |
| `--r-pill` | `999px` | chip / toast / switch | `999px` |
| `--r-full` | `50%` | 圆钮 / 圆点 | `50%` |

> 实测 `.composer-box` 圆角 = **12px**（`index.html:780`）→ `--r-5`；**上一轮写 14px 属错误**（§0.2 #6）。

### A.7 动效令牌（**沿用真实命名**）

| 令牌 | 值 | 用途 | 现状 |
|---|---|---|---|
| `--t-fast` | `120ms` | hover / 颜色 / 背景 | 保持（`index.html:53`） |
| `--t-base` | `160ms` | 面板宽过渡 / 淡入 | 保持（`index.html:54`） |
| `--t-slow` | `240ms` | 消息入场 / popover | 保持（`index.html:55`） |
| `--t-instant` | `80ms` | **新增**：按下反馈 / 图标变色 | 新增 |
| `--ease-out` | `cubic-bezier(.2,.7,.3,1)` | 标准 | 保持（`index.html:51`） |
| `--ease-spring` | `cubic-bezier(.2,.85,.3,1.08)` | 弹入 | 保持（`index.html:52`） |

> ⚠️ **上一轮虚构了 `--dur-*`/`--ease-enter`/`--ease-standard`**（§0.2 #5），**实际不存在**。施工一律用上表真实名。

### A.8 字阶（固化，**不换字体**）

> 实测字体栈（`index.html:91-93`）：`--font-display/body` = `-apple-system, BlinkMacSystemFont, 'SF Pro Display/Text', 'PingFang SC', system-ui, sans-serif`；`--font-mono` = `'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace`。**非 Geist**，本轮不换。

| 层级 | 建议 class | font-size | 字重 | line-height | 用途 |
|---|---|---|---|---|---|
| 页面标题 | `.t-page` | `15px` | 500 | 1.4 | 视图主标题 / 设置 h2 |
| 区块标题 | `.t-section` | `13px` | 500 | 1.45 | 设置分区、面板小节 |
| 行标题 | `.t-row` | `13.5px` | 400 | 1.5 | 会话行 / 任务行 |
| 正文 | `.t-body` | `13.5px` | 400 | 1.6 | 消息正文（实测 `body` = 13.5px，`index.html:101`） |
| 描述/次级 | `.t-desc` | `12.5px` | 400 | 1.5 | 描述、think |
| 元信息（等宽） | `.t-meta` | `10.5–11px` | 400 | 1.4 | 时间/tokens/耗时 |

> **收敛**：现状 `.t`/`.dur`/`.tok` 分散定义（CSS `.think-head .t` 在 `index.html:540`；模板产出在 `app.js:934/935`），收敛为 `.t-meta`，**视觉值不变**。

### A.9 迁移映射总表（旧硬编码 → 新令牌，**施工用**）

| 旧值（实测频次） | 新令牌 | 说明 |
|---|---|---|
| `1px`(63) | `--bd-1` | 描边专用 |
| `2px`(74) | `--sp-1`（间距）/ `--bd-2`（描边） | 按用途二分 |
| `3px`(17) | `--sp-2` | Δ1 |
| `4px`(33) | `--sp-2` | — |
| `5px`(17) | `--sp-3` | Δ1 |
| `6px`(57) | `--sp-3` | — |
| `7px`(32) | `--sp-3` | Δ1 |
| `8px`(113) | `--sp-4` | 主步进 |
| `9px`(20) | `--sp-4` | Δ1 |
| `10px`(63) | `--sp-5` | — |
| `11px`(34) | `--sp-5` | Δ1（字号除外） |
| `12px`(79) | `--sp-6` | 主步进 |
| `13px`(35) | `--sp-6` | Δ1（字号除外） |
| `14px`(62) | `--sp-7` | — |
| `15px`(34) | `--sp-7` | Δ1（字号除外） |
| `16px`(18) | `--sp-8` | — |
| `18px`(8) | `--sp-8` | Δ2 |
| `20px` | `--sp-9` | — |
| `24px`(20) | `--sp-10` | — |
| `30px`(19) | `--sp-11` | Δ2 |
| `32px` | `--sp-11` | — |
| `34px`(8) | `--sp-11` | Δ2 |
| 圆角 5/7/9/11px | `--r-1/2/3/4` | 就近 |
| 圆角 12/14/16px | `--r-5/6/7` | 保持 |
| `252px`(`--sidebar-w`) | `264px` | **修 F2** |

---

## §B 状态编码规格（VIS-01 / 03 / 04 / 05）

### B.1 七态三重编码（色 + 形 + 字）

> **完整状态集 = 成功 + 运行四态 + 被拒 + 已中断（共 7 项）**。硬约束：**全部转灰后，仅凭图形 + 文字仍能区分 7 态**。

| 状态 | 颜色令牌 | 图形（**内联 SVG**，形状本身可辨） | 文字（中文标签） | 动效 / reduced-motion 降级 |
|---|---|---|---|---|
| 成功 | `--st-done` | ✓ 对勾（描边圆） | `成功` | 无 |
| 运行 | `--st-run` | 实心圆点 + 外圈脉冲环 | `运行中` | 脉冲；**降级=静态实心点** |
| 等待 | `--st-wait` | **空心圆环** | `等待` | 无 |
| 卡死 | `--st-stuck` | 实心点 + 内嵌 `!` | `卡死` | 可选 2.6s 慢闪；**降级=静态** |
| 失败 | `--st-fail` | 实心点 + 内嵌 `×` | `失败` | 无 |
| 被拒 | `--st-fail` | 实心点 + 内嵌 `⊘`（**SVG 斜杠圆**） | `被拒` | 无 |
| 已中断 | `--st-wait` | **空心圆环 + 内嵌 `‖` 双竖线** | `已中断` | 无 |

**两处刻意的「同色不同形」**（优先不新增色相）：
- **被拒 vs 失败**：同用 `--st-fail`，但形可辨（`⊘` vs `×`）+ 文字不同。
- **已中断 vs 等待**：同用 `--st-wait`，但形可辨（空心环+`‖` vs 纯空心环）+ 文字不同。

> **VIS-03 修复**：「被拒」**用失败红 `--st-fail`**，与「卡死」的琥珀 `--st-stuck` 分离——色相 ΔH ≈ 55°（25 vs 80），可量化可辨。
> **VIS-04 修复**：「已中断」= 空心环 + `‖`；「等待」= 纯空心环 → **DOM 结构不同**（前者含 `<path d="M9 8v8M15 8v8">`），遮挡文字后仍可辨。
> **VIS-05 修复**：全部状态带 SVG 图形编码，与文字冗余。

### B.2 字形可用性复核（**本机字体栈实测**）

**验证方式**（可复现）：用纯 Python 解析 CSS 字体栈所解析字体的 `cmap`（format 4 + format 12 子表），逐个码位比对覆盖；栈内全缺的码位会落到 `Apple Color Emoji`（**变彩色 emoji**）或 `.notdef`（豆腐块）。

**实测结果**（字体栈 `-apple-system` → `SFNS.ttf`；再 `PingFang SC`；再 `system-ui`）：

| 码位 | 字符 | 语义 | `SFNS.ttf`(`-apple-system`) | `Apple Symbols` | 结论 |
|---|---|---|---|---|---|
| U+2713 | ✓ | 成功 | **有** | — | ✅ 主栈直出（代码库已用：`index.html:1468`） |
| U+2717 | ✗ | 失败 | **有** | — | ✅ 主栈直出（代码库已用：`app.js:1849`） |
| U+25CF | ● | 运行/实心点 | **有** | 有 | ✅ 主栈直出 |
| U+25CB | ○ | 等待/空心环 | **有** | 有 | ✅ 主栈直出 |
| U+00D7 | × | 失败内嵌 | 有（Latin-1） | 有 | ✅ |
| U+0021 | ! | 卡死内嵌 | 有 | 有 | ✅ |
| U+2298 | ⊘ | 被拒 | **无** | 有 | ⚠ 落到 Apple Symbols（**字重/风格不一致**） |
| U+23F8 | ⏸ | 暂停 | **无** | **无** | ❌ **全栈缺失 → 变彩色 emoji** |
| U+23F3 | ⏳ | 沙漏 | **无** | **无** | ❌ 同上 |
| U+275A | ❚ | 双竖线 | **无** | **无** | ❌ 同上 |
| U+26A0 | ⚠ | 警告 | 无 | 有 | ⚠ emoji 呈现风险 |

> **结论（硬性）**：**7 态字形一律用内联 SVG 绘制，不依赖字体覆盖**（代码库已有 30+ 内联 SVG 先例，风格统一）。若必须用文字字形，**仅允许安全集 `{✓ ✗ × ! ● ○}`**，**禁止 `⊘ ⏸ ⏳ ❚ ⚠`**。
> **SVG 契约**：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"`（与既有图标一致）；状态点容器 `<span class="st-dot" data-st="run|wait|stuck|fail|rejected|interrupted|done" aria-hidden="true">`，**语义由相邻文字承载**（避免图标单独承载语义，满足 A11Y）。

---

## §C 四档响应式规格（RESP-01…04）

### C.1 逐档布局规则表

| 档位（视口宽） | 侧栏 | 右板 | 主区最小宽 | 输入区 | 消息列 | CSS 落点 |
|---|---|---|---|---|---|---|
| **≥1600** | 列 `264px`（可拖 180–420） | 列 `340px`（可拖 240–640） | `≥640px` | **不折叠** | `--content-max` 封顶 1040，**居中不拉伸** | `@media (min-width:1600px)` |
| **1280–1599** | 列 `264px` | 列 `340px`（**≥300 ✅ RESP-03**） | `≥480px` | **不折叠** | `clamp(560, center−48, 1040)` | 默认（`@media (max-width:1599px)` 仅固化变量） |
| **1024–1279** | **图标栏 `64px`**（`--rail-w`） | **覆盖式 Sheet**（**1024 即 Sheet ✅ RESP-03**） | `≥480px` | **不折叠** | 用满宽 | `@media (max-width:1279px)` |
| **960–1023** | **覆盖式 Sheet（抽屉）** | **覆盖式 Sheet** | `≥480px` | **不折叠** | 用满宽 | `@media (max-width:1023px)` |

> **窗口最小尺寸建议**：`960 × 600`（`minWidth:960, minHeight:600`）——在 960 下主区 = 960 − 0（侧栏 Sheet）+ Sheet 右板覆盖 → 实际主区 ≥ 960，满足 ≥480 且有余量；600 高保证 composer（≈ 24 + 40 + 24）+ 标题栏 44 + 底栏 24 + 消息区 ≥ 300。
> **输入区永不折叠**（RESP-03 硬约束）：`.composer` **不参与任何断点隐藏**。

### C.2 媒体查询骨架（**增量，替换单一 920 断点**）

```css
/* —— 位置：index.html:1353-1365（"responsive" 段）—— 整体替换原 @media (max-width:920px) —— */
@media (min-width:1600px){
  .shell{ --content-max: min(100%, 1040px); }      /* 宽屏封顶，居中不拉伸 */
}
@media (max-width:1599px){ /* 标准三栏：无需额外规则，仅固化 --content-max */ }
@media (max-width:1279px){
  .sidebar{ width: var(--rail-w); }                 /* 图标栏：收为 64px */
  .sidebar .s-txt,.sidebar .f-name,.sidebar .new-chat span,.sidebar .archive-toggle span{ display:none; }
  .drawer{ position:fixed; right:0; top:var(--titlebar-h); bottom:0; z-index:40;
           width:min(var(--drawer-w),88vw); transform:translateX(100%);
           transition:transform var(--t-base) var(--ease-out); box-shadow:var(--shadow-2); }
  .drawer.open-m{ transform:translateX(0); }
  .gutter{ display:none; }                          /* 窄档取消固定列拖拽（RESP-04） */
  .shell{ --content-max:none; }
}
@media (max-width:1023px){
  .sidebar{ position:fixed; left:0; top:var(--titlebar-h); bottom:0; z-index:40;
            width:min(var(--sidebar-w),88vw); transform:translateX(-100%);
            transition:transform var(--t-base) var(--ease-out); box-shadow:var(--shadow-2); }
  .sidebar.open{ transform:translateX(0); }
  .drawer.collapsed.open-m{ transform:translateX(100%); }
  .bubble{ max-width:92%; }
}
```

**与现有 920 断点如何共存（**无冲突**）**：
- 原 `@media (max-width:920px)`（`index.html:1354-1365`）的规则（`.gutter{display:none}` / `.shell{--content-max:none}` / `.sidebar` 浮层 / `.drawer` Sheet / `.bubble 92%`）**逐条被 1279 与 1023 两档吸收**（1023 ⊃ 920）。
- **处置：删除 1354-1365 块**，由 1279 + 1023 取代。**保留 `.drawer.open-m` 机制**（`index.html:1362`）——Sheet 开合复用它，`app.js:666-672` `setDrawer()` 逻辑不变。
- 4 个查询串 `min-width:1600` / `max-width:1599` / `max-width:1279` / `max-width:1023` **均出现**，满足 RESP-01 的 `grep -c ≥ 3`。

### C.3 与 JS 尺寸逻辑的协调（**F4**）

- `app.js:580` `const KEEP_CENTER = 380` 是中栏的**事实下限**，**低于 RESP-03 的 480**。
- **规范**：把 `KEEP_CENTER` 提到 **`480`**（对齐 RESP-03），或在 `remap()`（`app.js:647`）内按断点分档；`sideMax()/drawerMax()`（`app.js:581-582`）随之更新。
- **栏宽持久化优先级**：**手动拖动 > 断点默认**（`localStorage 'forge-sidebar-w'/'forge-drawer-w'`，`app.js:586/601/643`）；未拖过则用断点默认。
- **RESP-04**：≤1279 时 `.gutter{display:none}` → 拖拽手柄不可用，右板改**覆盖式开合**；键盘开合复用既有 `drawerToggle`（`index.html:1374`）+ `setDrawer()`，`ArrowLeft/Right` 由 `app.js:630-640` 的 gutter 键盘逻辑提供（焦点环见 §G）。

---

## §D 组件施工图（MAINT-03）

### D.1 统一卡片骨架（`.card > .card-head + .card-body + .card-foot`）

```
<div class="card card--{kind} [collapsed]" data-card="{kind}">
  <button class="card-head" type="button" aria-expanded="false" aria-controls="{id}"
          data-card-toggle data-card="{kind}" [data-doc="{path}"]>
    {svg 图标}<span class="ct">{标题}</span><span class="tag">{状态位}</span>
    <svg class="chev" aria-hidden="true"/>
  </button>
  <div class="card-body" id="{id}">{内容}</div>
  <div class="card-foot" role="group" aria-label="卡片操作">{操作}</div>
</div>
```

- **头** `.card-head`：既有（`index.html:1450`、`app.js:1941/2134`）；`data-card-toggle` 折叠由 `app.js:1630-1638` 委托，**零重命名**。
- **体** `.card-body`：**新增语义类**；既有代码用 `.body`（`app.js:2138`）→ **保留 `.body` 为别名**（`.card-body, .card > .body {…}`）。
- **脚** `.card-foot`：**新增**——收敛既有 `.plan-acts`（`app.js:1948`）、`.ask-acts`/`.ask-pop-acts`（`app.js:2038`）。
- **状态钩子**：`data-card="{kind}"`（折叠）+ `data-st="{state}"`（**新增**，七态，§B）；`aria-expanded`/`aria-controls` 既有。

### D.2 变体清单

| 变体 | class | 现状（实测） | 处置 | 必需 `aria-*` | 状态钩子 |
|---|---|---|---|---|---|
| plan | `.card--plan` | `.card` + `.plan-steps` + `.plan-acts`（`app.js:1932-1966`、`index.html:1449-1461`） | 保留 + 收敛骨架；**新增进度可视化** | `aria-expanded/controls`；进度条 `role="progressbar" aria-valuenow/min/max` | `data-card="plan"` `data-st` |
| diff | `.card--diff` | `.tool-item > .diff`（`app.js:1798/1894-1931`） | 保留；可选独立 `.card--diff`（`overflow-x:auto`） | `aria-expanded/controls` | `data-card="diff"` `data-doc` |
| tool | `.card--tool` | `.tool-item` in `.toolgroup`（`app.js:1870-1893`） | 保留（工具组两级折叠） | `aria-expanded`；`.ti-state` 加 `aria-label` | `data-tool-toggle` |
| approval | `.card--approval` | `.card.ask[data-ask]` + `.ask-pop`（`app.js:2089/2126-2144`） | **保留 `data-ask`**（live 唯一审批钩子）；`ask-pop` 收敛为 Sheet 变体 | `aria-modal`(pop) / `aria-expanded` / 状态 `aria-label` | `data-ask` `data-st` |
| verify | `.card--verify` | `.tool-item > .term`（`app.js:1973-1994`） | 保留 + 收敛；`#N` 重试序号 | `aria-expanded` | `data-card="verify"` `data-st` |
| report | `.card--report` | **无** | **新建**（run 产出汇总，`role="region"`） | `role="region" aria-label` | `data-card="report"` `data-st` |
| usage | `.card--usage` | **无**（仅 `msg-actions` 内 `.tok`） | **新建**或并入底栏（VIS-02） | `role="status"` | `data-card="usage"` |
| clarify | `.card--clarify` | **无** | **新建**（表单卡，见 React `clarify-form.tsx`） | 表单 `label`/`aria-required`；提交 `aria-live` | `data-card="clarify"` |
| compaction | `.card--compaction` | 仅 toast（`app.js:1999-2001`） | **新建**卡（或保留 toast，二选一，报告标注） | `role="status"` | `data-card="compaction"` |
| promote | `.card--promote` | **无** | **新建**（sidechat 结论提升） | `aria-label` | `data-card="promote"` |
| agent | `.card--agent` | **无** | **新建**（多 agent 指挥，对应 GAP-01） | `role="group" aria-label` | `data-card="agent"` `data-st` |

### D.3 vanilla ↔ React `cards/registry.tsx` 10 类对照映射表（MAINT-05 输入）

> React 侧 `KNOWN_CARD_TYPES = Object.keys(REGISTRY)`（`cards/registry.tsx:214`），10 类：`approval / diff / report / usage_summary / clarify_form / plan / verify_result / compaction / promote / agent_card`（`:201-212`）。

| React 卡片 | vanilla 现状（实测） | 判定 |
|---|---|---|
| `plan` | ✅ `.card[data-card="plan"]`（`app.js:1932`） | **已有**，收敛骨架 |
| `diff` | ✅ `.tool-item > .diff`（`app.js:1894/1798`） | **已有**（作为工具条目），保留 |
| `verify_result` | ✅ `.tool-item > .term`（`app.js:1973`） | **已有**，收敛 |
| `approval` | ✅ `.card.ask[data-ask]` + `.ask-pop`（`app.js:2089/2130`） | **已有**（形态不同：输入框上方弹层），保留 |
| `report` | ❌ 无 | **需新建** |
| `usage_summary` | ❌ 无（仅 `.tok` 内联） | **需新建** 或并入底栏 |
| `clarify_form` | ❌ 无 | **需新建**（`clarify-form.tsx` 115 行为参照） |
| `compaction` | ⚠ 仅 toast | **需新建**卡（或明确保留 toast） |
| `promote` | ❌ 无 | **需新建** |
| `agent_card` | ❌ 无 | **需新建**（对应 GAP-01 任务视图） |
| （vanilla 独有）`tool` | ✅ `.tool-item`（两级折叠） | **保留**（React 无对等，勿丢） |

> **统计**：已有 4 / 需新建 5 / 明确保留 toast 1（compaction）。**注册表**：vanilla 层建 `KNOWN_CARD_TYPES` 等价常量，条目 **≥10**（对齐 MAINT-03 验收），统一经 `renderCard(kind, payload)` 入口产出。

---

## §E 冻结钩子清单（复核版）+ 探针改指映射（MAINT-06 输入）

### E.1 live 层真实冻结清单（**零重命名**）

> 本轮对 `index.html` + `app.js` 全量枚举 `data-*` / `dataset.*`（共 65 个 token）。**下表为发货层真实存在、`app.js` 直接依赖者**。**原型构建师不得重命名/删除。** 标注：**保持** / **需扩展** / **需新增**。

| 钩子 | 实测命中 | 位置 | 判定 |
|---|---|---|---|
| `data-theme` | 2 | `index.html:2`；`app.js:560/565` | 保持 |
| `data-od-id` | 27 | `index.html` 多处 | 保持（设计锚点） |
| `data-drawer` | 4 | `index.html:1379`（shell）；`app.js:668` | 保持 |
| `data-panel` + `data-min/max/def` | 2 + 2/2/2 | `index.html:1414/1638`；`app.js:585-590` | 保持 |
| `data-view` | 7 | `index.html:1655/1661/1667/1673`；`app.js:816/822/856` | **需扩展**（新增 git/任务/历史视图值） |
| `data-close` | 3 | `app.js:819/844/851` | 保持 |
| `data-card-toggle` | 5 | `index.html:1450`；`app.js:1615/1631/1941/2134` | 保持 |
| `data-card` | 2 | `app.js:1941/1616` | **需扩展**（plan→10 类） |
| `data-doc` | 1 | `app.js:1623` | 保持 |
| `data-label` | 7 | `index.html:1428/…`；`app.js:1005` | 保持 |
| `data-msg-act` | 8 | `index.html:1428-1500`；`app.js` | 保持 |
| `data-id` | 2 | `app.js:419/425` | 保持 |
| `data-folder` | 1 | `app.js:156/410` | 保持 |
| `data-act` | 9 | `app.js:124/141/144/425-434` | 保持 |
| `data-sid` | 1 | `app.js:136` | **新收录**（冻结） |
| `data-grp` | 4 | `index.html:1730/1758/1766` | 保持 |
| `data-val` | 13 | `index.html:1731-1771`；`app.js:535` | 保持 |
| `data-switch` | 7 | `index.html:1726/…` | 保持 |
| `data-set-theme` | 4 | `index.html:1789-1790`；`app.js:546` | 保持 |
| `data-reduce-motion` | 2 | `index.html:1795`；`app.js:542` | 保持 |
| `data-sec` | 10 | `index.html:1692-1830`；`app.js:502-504` | 保持 |
| `data-model` | 3 | `index.html:1609/1614/1619` | 保持 |
| `data-desc` | 3 | `index.html:1609-1619` | 保持 |
| `data-term` | 1 | `app.js:775/860-862` | 保持 |
| `data-branch` | 1 | `app.js:789/1404-1406` | 保持 |
| `data-ws` | 2 | `app.js:1227-1229` | 保持 |
| `data-perm` | 1 | `app.js:1327-1329` | 保持 |
| `data-ask` | 1 | `app.js:2130` | 保持（**live 唯一审批钩子**） |
| `data-live` | 5 | `app.js:1706/1710/…` | 保持 |
| `data-stream` | 3 | `index.html:1508`；`app.js:1072/1121` | 保持 |
| `data-empty` | 2 | `index.html:1652`；`app.js:826` | 保持 |
| `data-doc-active` | 1 | `app.js`（文件树激活） | **新收录**（冻结） |
| `data-v` | 1 | `app.js:2053`（审批作用域选项） | **新收录**（冻结） |
| **`data-tool-toggle`** | **6** | `index.html:1464/1473/1484`；`app.js:1640-1656/1822/1878/1983` | **⚠️ 简报遗漏，本轮补录，必须冻结（修 F1）** |
| `data-archived`（`dataset.archived`） | 2 | `app.js:419/465` | 保持（**死代码，见 VIS-06**，修复时**不得删除钩子名**） |
| `data-tokenized`（`dataset.tokenized`） | 2 | `app.js:105/107` | 保持（diff 着色幂等） |
| `data-scope` / `data-ask-id`（`dataset`） | 3 / 5 | `app.js:2059/2151`；`app.js:2029/2101` | 保持 |

> **VIS-06 死代码复核（实测）**：`sessionItemHTML`（`app.js:122-152`）**从不输出 `data-archived`**；`renderArchive`（`app.js:483-497`）输出 `.arch-row[data-id]`；守卫 `if (item && !item.dataset.archived)`（`app.js:419`、`app.js:465`）**恒为真**。→ **修复方向**：归档行改由 `.arch-row` 分支处理（归档区点击走 `app.js:548-555` 的 `archListEl` 委托），**活跃列表与归档区用真实判别分开**，且**保留 `data-archived` 钩子名**（零重命名铁律）。

### E.2 探针改指映射表（7 个 `data-m1e-*` → vanilla 真实目标，**MAINT-06 输入**）

> `scripts/panels-check.ts` 的 7 个 CDP 探针（`panels-check.ts:251/257/260/264/265/269/271/278/286/299/327`）当前指向 **dead React DOM**，vanilla 层命中全 0。**严禁伪造 `data-m1e-*`**。改指如下：

| 探针（panels-check 行号） | 改指 vanilla 真实目标 | 依据 |
|---|---|---|
| `[data-m1e-event-count]`（:251） | **`#eventCount`**（新增于底栏 `.statusbar`，真实消费事件数） | 需真实递增节点（VIS-02） |
| `[data-m1e-item]`（:257/260/271） | **`.stream-inner > .msg`**（消息节点，`index.html:1421/1423/1434`） | 真实消息 DOM |
| `[data-virtuoso-scroller]`（:264/265/269） | **`.stream`**（`index.html:1420`，真实滚动容器） | vanilla 无 virtuoso，用原生滚动容器 |
| `[data-approval-badge]`（:278） | **`.card.ask[data-ask]`**（`app.js:2130`）或新增 **`.approval-dot`** | live 审批真实节点 |
| `[data-panel-toggle="git"]`（:286） | **`[data-view="git"]`**（需新增 git 视图；或复用 `[data-view]`） | live 用 `data-view` |
| `[data-panel-id="git"]`（:327） | **`[data-view="git"]` 的打开态**（同上） | 同上 |
| `[data-m1e-settings-open]`（:299） | **`#settingsOpen`**（`index.html:1401`） | live 真实设置入口 |

> **附加依赖（D1 归档前提）**：`panels-check.ts:12` 硬 `import { projectDiffCards, projectTokenUsage } from "../src/renderer/projections"`，`:344-346/:369` replay 子进程复用。→ **`projections.ts` 需保留**（或把这两个投影函数迁到独立模块），**这是 React 树归档的前置**。
> **纪律**：改指后探针命中数须 **全部 ≥1**，且被指元素为**真实交互/数据节点**（删除会导致功能失效）。**不设计任何伪造钩子方案**。

---

## §F 组件库取舍（MAINT-05）

> **总原则**：**不引入 Tailwind 4 / shadcn 运行时**（发货层是 vanilla，`index.html` 无构建链，CSP `script-src 'self'`，`index.html:7`）。`components/ui/*` 29 文件 + `components.json` 全部**归档**；**仅把"能力"移植为 vanilla 等价物**。

| # | shadcn 组件（实测 29） | 判定 | 理由 / vanilla 等价物 |
|---|---|---|---|
| 1 | `message-scroller`（131） | **移植** | 虚拟化是 PERF-01 核心；vanilla 实现窗口化（`--content-max` 列内复用节点池） |
| 2 | `resizable`（47） | **vanilla 替代** | 已有 gutter 拖拽（`app.js:603-648`） |
| 3 | `progress`（28） | **移植** | plan 进度可视化需要；vanilla 等价物 = `.tp-fill` + `role="progressbar"` |
| 4 | `table`（113） | **移植（按需）** | 仅当 run 汇总/历史需要表格时；否则**放弃** |
| 5 | `radio-group`（41） | **vanilla 替代** | 已有 `.set-choice`/`data-grp`（`index.html:1730`）+ `role="radiogroup"`（`index.html:1608`） |
| 6 | `checkbox`（32） | **vanilla 替代** | 已有 `.risk-ack role="checkbox"`（`index.html:1851`） |
| 7 | `field`（238） | **移植（按需）** | clarify 表单卡需要；否则用 `aria-label` |
| 8 | `attachment`（204） | **vanilla 替代** | 已有 `.ctx-upload` + `#fileInput`（`index.html:1545-1548`） |
| 9 | `empty`（103） | **vanilla 替代** | 已有 `.settings-empty` / `data-empty`（`app.js:486/826`） |
| 10 | `skeleton`（13） | **放弃** | 无异步骨架屏需求；加载态用 `.run-grid` |
| 11 | `spinner`（10） | **vanilla 替代** | 已有 `.run-grid` 九宫格（`app.js:21-24`） |
| 12 | `sidebar`（700） | **vanilla 替代** | 已有 `.sidebar`（`index.html:1381`） |
| 13 | `select`（189） | **vanilla 替代** | 已有 `.ctx-pop` 自绘弹层（`index.html:1535`） |
| 14 | `dialog`（166） | **vanilla 替代** | 已有 `.settings-overlay` / `.risk-scrim`（`aria-modal`，`index.html:1688/1836`） |
| 15 | `sheet`（145） | **vanilla 替代** | 已有 `.drawer.open-m` Sheet（`index.html:1362`） |
| 16 | `message`（91） | **vanilla 替代** | 已有 `.msg`（`index.html:1423`） |
| 17 | `bubble`（124） | **vanilla 替代** | 已有 `.bubble`（`index.html:1426`） |
| 18 | `card`（102） | **vanilla 替代** | 已有 `.card`（`index.html:1449`），本轮收敛骨架（§D） |
| 19 | `tabs`（89） | **vanilla 替代** | 已有 `.side-tab`/`side-tabs`（`index.html:1647`） |
| 20 | `button`（66） | **vanilla 替代** | 原生 `<button>` + 既有 class |
| 21 | `tooltip`（56） | **vanilla 替代** | 用 `title` + `aria-label`（既有） |
| 22 | `scroll-area`（52） | **vanilla 替代** | 原生 `overflow` + `::-webkit-scrollbar`（`index.html:114-116`） |
| 23 | `badge`（48） | **vanilla 替代** | 已有 `.tag`（`index.html:1452`） |
| 24 | `collapsible`（33） | **vanilla 替代** | 已有 `data-card-toggle`/`data-tool-toggle` 委托 |
| 25 | `separator`（27） | **vanilla 替代** | 已有 `.gutter role="separator"`（`index.html:1410`） |
| 26 | `label`（23） | **vanilla 替代** | 用 `<label>`/`aria-label`（既有） |
| 27 | `input`（18） | **vanilla 替代** | 原生 `<input>`（`index.html:1389`） |
| 28 | `textarea`（17） | **vanilla 替代** | 原生 `<textarea>`（`index.html:1551`） |
| 29 | `marker`（68） | **放弃** | 无对应需求 |

> **汇总**：**移植 4**（message-scroller / progress / table / field，后两者按需）；**vanilla 替代 23**；**放弃 2**（skeleton / marker）。**Tailwind 4 + `components.json`**：**明确放弃**（不引构建链，vanilla 层用令牌 + 手写 CSS）。**逐项无 `TBD`**，满足 MAINT-05 验收。

---

## §G A11Y 规范（A11Y-01 / 02 / 03）

### G.1 既有资产（**不得回退**，实测基线）

| 项 | 实测 | 约束 |
|---|---|---|
| `aria-*` | **298** | 重构后 `grep -c 'aria-'` **≥298** |
| `role=` | **30** | **≥30** |
| `prefers-reduced-motion` 降级块 | **13**（`index.html:378/533/573/627/660/714/753/950/1065/1160/1163/1333/1346`）+ 全局 `html.reduce-motion`（110-112） | **≥13** |
| 焦点环 | `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`（`index.html:107`） | 全部可交互元素可见 |
| 其他 | `.sr-only`（113）、`role="status"` toast（1863）、`aria-modal`（1688/1836） | 保持 |

### G.2 新增动效的降级覆盖（A11Y-03）

> 任何**新增动效**必须各自补一条 `@media (prefers-reduced-motion: reduce)` 降级。**降级计数 = 13 + 新增动效数**。

| 新增动效 | 降级规则 |
|---|---|
| 四态「运行中」脉冲环 | `.st-dot[data-st=run]{animation:none}`（静态实心点） |
| 卡死慢闪（可选） | `animation:none`（静态） |
| 底栏阶段过渡 | `transition:none` |
| Sheet 滑入（1279/1023 档） | `transition:none`（直接显隐） |
| 回到底部浮钮 | 无位移（直接显隐） |
| 命令面板淡入 | `animation:none` |

### G.3 自动化 a11y 断言清单（**A11Y-01 门禁禁用项，供 `gate-manifest.ts` 登记**）

> 脚本建议：`scripts/a11y-check.ts`（CDP 注入 axe-core，`TERM=dumb` 运行）。

| # | 断言 | 阈值 | 视图 |
|---|---|---|---|
| A1 | axe-core `critical + serious` 违规数 | **= 0** | 主对话 / 设置 / 右板（3 视图） |
| A2 | `grep -c 'aria-'`（index.html+app.js） | **≥298** | 全仓 |
| A3 | `grep -c 'role='` | **≥30** | 全仓 |
| A4 | `grep -c 'prefers-reduced-motion'` | **≥13 + 新增动效数** | `index.html` |
| A5 | 全部 `[role=button]`/`button`/`a[href]` 可 Tab 达（无 `tabindex="-1"` 误用） | 100% | 3 视图 |
| A6 | 焦点可见：`Tab` 遍历无「焦点丢失」（`document.activeElement` 恒非 body） | 100% | 3 视图 |
| A7 | 交互控件非文字对比 ≥3:1（用 `--border-strong`） | 100% | 表单/按钮 |
| A8 | 状态点均带 `aria-hidden` + 相邻文字标签（无「仅图标承载语义」） | 100% | 消息流 |
| A9 | `role="progressbar"` 带 `aria-valuenow/min/max` | 100% | plan 卡 |
| A10 | 弹层（settings/risk/Sheet/ask-pop）带 `aria-modal` + 焦点陷阱 + Esc 关闭 | 100% | 弹层 |

---

## §H 需求覆盖对照

| 需求 | 本规范落点 |
|---|---|
| **VIS-01** 四态语义色落地 | §A.1.2（`--st-*` 9 条，复用既有色相）+ §B.1 消费纪律；`grep -- '--st-'` ≥4 定义 + 每态 ≥1 消费点 |
| **VIS-02** 全局底栏 | §A.4 `--statusbar-h`；§C.1 全档可见；`.statusbar` 承载沙箱/事件数/tokens |
| **VIS-03** 「被拒」误用琥珀 | §B.1（被拒 = `--st-fail` 红，ΔH≈55° vs 卡死） |
| **VIS-04** 「已中断」vs「等待」同形 | §B.1（空心环+`‖` vs 纯空心环，DOM 不同） |
| **VIS-05** 状态靠文字无图形 | §B.1 七态全带内联 SVG 图形编码 |
| **VIS-06** 归档守卫死代码 | §E.1 复核 + 修复方向（保留钩子名，用 `.arch-row` 分支） |
| **A11Y-01** 无自动化门禁 | §G.3 断言清单 A1–A10 |
| **A11Y-02** 既有资产不回退 | §G.1（298/30/13 基线 + 焦点环）；**新增约束（§A.2.2）**：`--dim` dark vs `--surface-2` = 4.47:1 <4.5，**`--dim` 不得用于 `--surface-2` 面**（仅用于 `--surface` 面，>5:1）；交互控件描边须用 `--border-strong`（3.64:1/3.83:1 ≥3:1），不得用 `--border`（1.21:1/1.33:1） |
| **A11Y-03** 新增动效降级 | §G.2（逐条降级规则） |
| 支撑：MAINT-03/05/06/07 | §D（骨架/注册表/映射）、§E（钩子/探针）、§A.7（CSS 分层输入） |
| 支撑：RESP-01…04 | §C（四档 + 落点 + 无冲突） |
| 支撑：PERF-02 | §E.2（滚动容器探针改指 `.stream`） |

---

## §I 附录：对比度复算脚本（可复现）

```js
// node contrast.mjs —— 无第三方依赖；OKLCh → linear sRGB → WCAG 对比度
const clamp = x => Math.min(1, Math.max(0, x));
function oklch(L, C, H) {                       // → linear sRGB
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;
  const l = l_**3, m = m_**3, s = s_**3;
  return [
    +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s,
  ];
}
const lum = v => 0.2126*clamp(v[0]) + 0.7152*clamp(v[1]) + 0.0722*clamp(v[2]);
const hex = v => '#' + v.map(x => { x = clamp(x);
  const s = x <= 0.0031308 ? 12.92*x : 1.055*Math.pow(x, 1/2.4) - 0.055;
  return Math.round(s*255).toString(16).padStart(2, '0'); }).join('');
const ratio = (a, b) => { const la = lum(a), lb = lum(b);
  return (Math.max(la,lb)+0.05) / (Math.min(la,lb)+0.05); };
// 自检：oklch(1,0,0) 应为 #ffffff / 1.00:1
// 示例：--st-fail light vs bg
console.log(hex(oklch(0.54,0.19,25)), ratio(oklch(0.54,0.19,25), oklch(1,0,0)).toFixed(2));
```

> 运行：`node contrast.mjs`。本规范 §A.2 全部数值由该脚本产出（自检 `oklch(1,0,0) → #ffffff`）。
> **字形覆盖复核脚本**：纯 Python 解析 `SFNS.ttf`/`Apple Symbols.ttf`/`Hiragino Sans GB.ttc` 的 `cmap`（format 4/12），逐个码位比对（§B.2 结果）。

---

## 附：硬约束自检

| 约束 | 自检 |
|---|---|
| 不改 `src/` | ✅ 本轮只写本 md |
| 不换字体/色板/组件库 | ✅ 字体栈、灰阶、accent 零改动；不引 Tailwind/shadcn 运行时 |
| 不新增色相 | ✅ 四态**复用** `--ok/--warn/--danger/--muted`，**零新色相**（较上一轮更保守） |
| 双主题 AA | ✅ §A.2 独立复算：非文字 ≥4.5:1、彩色文字 >7:1、正文 >7:1 |
| 状态不单独依赖颜色 | ✅ §B.1 七态三重编码（色+形+字），字形经 §B.2 实测 |
| 钩子零重命名 | ✅ §E.1 全量复核（含补录 `data-tool-toggle`） |
| 不伪造 `data-m1e-*` | ✅ §E.2 只给**改指真实节点**的映射 |
| 断点无冲突 | ✅ §C.2 删除 920 块，由 1279/1023 吸收 |
| 无障碍不回退 | ✅ §G.1 13 处降级 + 298 aria + 30 role 基线锁定 |
| 所有行号与当前工作树一致 | ✅ 引用前逐条抽查；**不写死行数**（本轮实测 `index.html` 1969 行 / `app.js` 2360 行，改代码即漂移，仅作定位线索） |

---

## 修订记录（Phase 4 审查后）

**修订 1：`--border-strong` light 值自相矛盾（审查官退回项）**

- **根因**：**取值不一致，非复算错误**。§A.1.3 原文把 light 值写成 `oklch(64% 0.008 250)`（= `#898d91`，复算 **3.36:1**），而 §A.2.2 表用的是 `#83878b`（= `oklch(62% 0.008 250)`，复算 **3.64:1**）。两处是**两个不同的值**，各自的对比度数字都对。
- **定值**：统一采用**更深、余量更大**的 `oklch(62% 0.008 250)` = `#83878b` = **3.64:1**（vs bg）/ **3.51:1**（vs `--surface-2`），余量 **21% ≥ 10%**。dark 维持 `oklch(56% 0.012 250)` = `#6f757b` = **3.83:1**（审查官已认可）。
- **改动两处**：
  - §A.1.3：`oklch(64% 0.008 250)` → `oklch(62% 0.008 250)`，对比度 `3.36:1(light)` → `3.64:1(light)`；并补出 dark hex。
  - §A.2.2：将该行 light/dark 明确标注为 `oklch(62% .008 250)=#83878b` / `oklch(56% .012 250)=#6f757b`，数值 **3.64:1 / 3.83:1 不变**。
- **阈值判定**：交互控件非文字目标 ≥3:1；修正后 light 3.64:1、dark 3.83:1，**双主题稳过且余量 ≥10%**，无需再调色值。
- **复算命令**（`node`，无依赖）：

```
node -e '
const f=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
const lum=h=>{const n=parseInt(h.slice(1),16),r=f((n>>16&255)/255),g=f((n>>8&255)/255),b=f((n&255)/255);
  return 0.2126*r+0.7152*g+0.0722*b;};
const cr=(a,b)=>{const la=lum(a),lb=lum(b);return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);};
console.log("#83878b vs #ffffff =", cr("#83878b","#ffffff").toFixed(3)+":1");   // 3.619
console.log("#898d91 vs #ffffff =", cr("#898d91","#ffffff").toFixed(3)+":1");   // 3.343
'
```

  - oklch 路径（`oklch(62% .008 250)`）得 **3.638:1**；直接 hex 路径得 **3.619:1**；两路径一致 → 取 **3.64:1**。
  - 对照：`#898d91`（即 `oklch(64%)`）两路径分别为 **3.361 / 3.343** → **3.36:1**（审查官独立复算的 3.36 即此值）。

**修订 2：`--dim` 约束已登记进 §H**

- 已在 §H **A11Y-02** 行明确登记：`--dim` dark vs `--surface-2` = **4.47:1 <4.5**，**约束 `--dim` 不得用于 `--surface-2` 面**（仅用于 `--surface` 面，>5:1）；同处一并登记「交互控件描边须用 `--border-strong`（≥3:1），不得用 `--border`」。约束不再只存在于 §A.2.2 正文，**不会丢失**。

> 硬约束遵守：未改 `src/`；未改他人文件；令牌名零重命名（仅修正 1 个**取值**，名不变）。
