> **⚠️ 过时（2026-09-17 起）**：本文属上一轮设计（`ui-v3-forge`），其**色值 / 令牌名 / 尺寸 / 行号 / 函数名**多数已漂移。
> **已被推翻结论的逐条清单见 `outputs/frontend-refactor-2026-09-17/02-design-system.md` §0.2**（15 条，逐条给出实测复核值）。
> 当前权威规范 = 该包（`00`–`06`）；本文**为存档保留**、正文未改写，**不可直接施工**。

# Forge 桌面端 Agent 应用 UI 结构化优化 · 设计系统规范（Phase 2）

> 作者：设计系统专家 彩格调（Cai） · 事实来源：`src/renderer/index.html`（内联 CSS 实测行号）、`src/renderer/app.js`（实测函数/行号）、`scripts/panels-check.ts`（CDP 探针实测选择器）、`01-requirements.md`、`00-recon-brief.md`
> 口径：**所有「现有值」均为实测**（文件 + 行号）。本规范是「增量修订」，不是重写；每个令牌都给出「现有值 → 修订值 → 理由」。
> 施工对象：`index.html` 内联 CSS + `app.js` 模板字符串（vanilla 层）。**不引 React、不换字体、不换组件库、不引毛玻璃/渐变。**

---

## 0. 结论先行（TL;DR）＋ 一条必须先对齐的实测事实

**TL;DR**
1. 视觉体系**不动**：oklch 中性灰阶骨架、Geist 字体栈（实为 `-apple-system/PingFang SC`，见 §A.3 说明）、单一强调色 `--accent oklch(55% 0.18 255)` 全部保持。本轮只做两件增量：**① 新增任务运行四态语义色（TASK-6 唯一允许的新色相）；② 补齐容器/组件规范与四档响应式**。
2. 四态色值已**实测对比度**（§A.1.2）：次级（图标/圆点/描边）全部 ≥4.5:1，正文级（彩色状态文字）全部 >7:1，light/dark 双主题达标。
3. 现有三栏尺寸（sidebar 264 / gutter 9 / drawer 340）与 `--content-max` 推导链**原样保留**，仅新增**底栏状态栏 h-6(24px)** 与**最小点击区 28×28 的固化**。

**⚠️ 必须先对齐的实测事实（影响 TASK 模块与验收 G-2）**

| 项 | 实测结论 | 证据 |
|---|---|---|
| 发货中的渲染层 | **只有** `index.html` + `app.js`（vanilla） | `index.html` 末尾唯一入口 `<script type="module" src="/app.js">`；`out/renderer` 产物内 `react` 出现 0 次 |
| 右抽屉现有面板 | **只有 4 个视图**：`files / browser / review / terminal` | `app.js:684-689` `VIEW_META`；`app.js:803-809` `viewHTML()` 仅这 4 个 |
| `approvals / token / git / memory / plugins / agents / schedule` 面板 | **live 层不存在**，只存在于 dead React（`panels/registry.tsx`、`cards/*.tsx`） | 全仓 `src/renderer/*.{js,html}` 搜 `approval\|worker\|agents\|schedule\|memory\|plugins` **零命中**；命中全部落在 `.tsx` |
| `data-m1e-item / data-m1e-event-count / data-virtuoso-scroller / data-approval-badge / data-panel-toggle / data-panel-id / data-m1e-settings-open` | **live 层不存在**，仅 `conversation.tsx`(dead) 与 `scripts/panels-check.ts` 引用 | 全仓检索：这 7 个钩子**没有一个**出现在 `index.html`/`app.js` |
| 审批 UI 的真实形态 | live 层有**消息内审批卡** `.card.ask[data-ask]`，**无**全局 `data-approval-badge` | `app.js:1880-1915` `askCard()`；`app.js:1916-1926` `onAsk/onAskDone` |

> **含义**：`01-requirements.md` §G-2 里「`data-m1e-item`、`data-panel-toggle`、`data-approval-badge` 等现有 `data-*` 属性名零重命名」这一句，**与发货代码不符**——这些钩子在 live 层**根本不存在**，因此原型构建师**无法「保留」它们**，`pnpm panels-check` 的 B 相（1 万条虚拟化 / 审批徽标 / 布局持久化）探测的也是 **dead React 代码**。**处理办法**：本规范 §D 给出**「live 层真实冻结清单」**（必须零重命名）与**「panels-check 依赖但 live 缺失清单」**（风险项，需主理人裁决：要么接线 React 版并单列迁移成本，要么把探针改指 vanilla 层）。TASK 模块的 worker/依赖链/审批聚合在 live 层是**全新构建**，不是「增强现有」。

---

## A. 设计令牌（增量修订表）

> 全部令牌为**可直接粘贴进 CSS 的 oklch 字面量**。`现有值` 列凡写「= 现状」者表示**不改**，仅为固化命名。

### A.1 色彩

#### A.1.1 灰阶骨架（保持，零改动）

| 令牌 | 现有值（light） | 现有值（dark） | 修订 | 理由 |
|---|---|---|---|---|
| `--bg` | `oklch(100% 0 0)` | `oklch(16.5% 0.012 250)` | 保持 | 品牌骨架，不动 |
| `--surface` | `oklch(100% 0 0)` | `oklch(20.5% 0.013 250)` | 保持 | 中栏底 |
| `--surface-2` | `oklch(98.6% 0 0)` | `oklch(24% 0.014 250)` | 保持 | 右栏/标题栏底 |
| `--surface-3` | `oklch(97.1% 0 0)` | `oklch(27.5% 0.015 250)` | 保持 | 左栏底 |
| `--fg` | `oklch(21% 0.006 250)` | `oklch(93% 0.006 250)` | 保持 | 正文（实测 19.9:1 / 16.4:1） |
| `--muted` | `oklch(45% 0.008 250)` | `oklch(72% 0.012 250)` | 保持 | 次级文字（7.8:1 / 8.1:1） |
| `--dim` | `oklch(54% 0.008 250)` | `oklch(62% 0.012 250)` | 保持 | 过程性只读（5.2:1 / 5.5:1） |
| `--border` | `oklch(94.5% 0 0)` | `oklch(30% 0.015 250)` | 保持 | 描边 |
| `--accent` | `oklch(55% 0.18 255)` | `oklch(72% 0.14 255)` | 保持 | 唯一强调色（4.93:1 / 亮色下不可作正文） |
| `--accent-soft` | `oklch(96.4% 0.016 255)` | `oklch(28% 0.06 255)` | 保持 | 强调底 |
| `--ok / --danger / --warn` | `55% .16 145 / 55% .2 25 / 52% .14 75` | `74% .15 150 / 70% .18 25 / 78% .13 80` | 保持 | diff/plan/term/ask 复用，**不改**（见 §A.1.3 纪律） |

#### A.1.2 新增：任务运行四态语义色（TASK-6 唯一例外）

命名：`--st-run`（运行）/ `--st-wait`（等待）/ `--st-stuck`（卡死）/ `--st-fail`（失败）；每个状态另给 `-fg` 变体（**彩色状态文字**专用，>7:1）。

**Light 主题**（`html[data-theme="light"]`，对比基准：`--bg #ffffff` / `--surface-2 oklch(98.6%)`）

| 令牌 | 建议值（oklch） | 实测 hex | 对比度 vs bg | vs surface-2 | 用途 |
|---|---|---|---|---|---|
| `--st-run` | `oklch(52% 0.15 150)` | `#007f35` | **5.11:1** | **4.91:1** | 运行中：圆点/描边/脉冲 |
| `--st-wait` | `oklch(45% 0.008 250)` | `#52565a` | 7.43:1 | 7.14:1 | 等待：灰点（= `--muted`） |
| `--st-stuck` | `oklch(50% 0.14 70)` | `#945000` | **6.15:1** | **5.91:1** | 卡死：黄点/黄描边 |
| `--st-fail` | `oklch(53% 0.2 25)` | `#c51d28` | **5.86:1** | **5.63:1** | 失败：红点/红描边 |
| `--st-run-fg` | `oklch(44% 0.13 150)` | `#006527` | **7.25:1** | 6.97:1 | 彩色「运行中」文字 |
| `--st-stuck-fg` | `oklch(43% 0.12 70)` | `#784000` | **8.29:1** | 7.96:1 | 彩色「卡死」文字 |
| `--st-fail-fg` | `oklch(46% 0.18 25)` | `#a50d1c` | **7.84:1** | 7.53:1 | 彩色「失败」文字 |
| `--st-wait-fg` | `var(--fg)` | `#191d21` | 19.9:1 | 19.4:1 | 「等待」文字直接用正文色 |

**Dark 主题**（`html[data-theme="dark"]`，对比基准：`--bg oklch(16.5%)` / `--surface-2 oklch(24%)`）

| 令牌 | 建议值（oklch） | 实测 hex | 对比度 vs bg | vs surface-2 | 用途 |
|---|---|---|---|---|---|
| `--st-run` | `oklch(74% 0.15 150)` | `#5ac576` | **8.86:1** | **7.56:1** | 运行中 |
| `--st-wait` | `oklch(76% 0.012 250)` | `#acb2b9` | 8.98:1 | 7.66:1 | 等待 |
| `--st-stuck` | `oklch(80% 0.13 80)` | `#e9b452` | **10.19:1** | **8.69:1** | 卡死 |
| `--st-fail` | `oklch(76% 0.16 25)` | `#ff847c` | **8.11:1** | **6.92:1** | 失败 |
| `--st-run-fg` | `oklch(82% 0.15 150)` | `#75df8f` | 11.66:1 | 9.95:1 | 彩色「运行中」文字 |
| `--st-stuck-fg` | `oklch(86% 0.12 80)` | `#fac871` | 12.46:1 | 10.64:1 | 彩色「卡死」文字 |
| `--st-fail-fg` | `oklch(82% 0.14 25)` | `#ff9e96` | 9.72:1 | 8.29:1 | 彩色「失败」文字 |
| `--st-wait-fg` | `var(--fg)` | `#e9ecef` | 16.4:1 | 15.9:1 | 「等待」文字 |

> **测量方法**：oklch → oklab → linear sRGB → WCAG 相对亮度 → 对比度（脚本可复算）。**结论**：四态「非文字用途」（圆点/图标/1px 描边/进度条）全部 ≥4.5:1；四态「彩色文字用途」用 `-fg` 变体全部 >7:1；「等待」不引入色相，复用灰阶。**达标 AA。**

#### A.1.3 状态呈现纪律（不单独依赖颜色 — 硬约束）

**完整状态集 = 成功 + 运行四态 + 被拒 + 已中断（共 7 项）**。每项**必须**「颜色 + 图形 + 文字」三重编码，任一项缺失即判不合格（对应 TASK-6 / G-6 验收：删掉颜色后仍可辨）：

| 状态 | 颜色令牌 | 图形（形状本身可辨） | 文字（中文标签） | 动效（reduced-motion 降级） |
|---|---|---|---|---|
| 成功 | `--ok` | ✓ 对勾 | `成功` | 无 |
| 运行 | `--st-run` | 实心圆点 + 外圈脉冲环 | `运行中` | 脉冲；降级=静态实心点 |
| 等待 | `--st-wait` | 空心圆点 | `等待` | 无 |
| 卡死 | `--st-stuck` | 圆点 + 内嵌「!」 | `卡死` | 无（或 2.6s 慢闪）；降级=静态 |
| 失败 | `--st-fail` | 圆点 + 「×」 | `失败` | 无 |
| **被拒** | `--st-fail` | 圆点 + 「⊘」（字体回退时用「—」） | `被拒` | 无 |
| 已中断 | `--st-wait` | 空心圆点 + 「⏸」 | `已中断` | 无 |

> **颜色仅作强化**：删掉颜色后仍能靠**形状 + 文字**区分——这是「不单独依赖颜色」的判定方式。
>
> **两处刻意的「同色不同形」取舍**（不新增色相优先于色相区分度）：
> - **被拒 vs 失败**：同用红族 `--st-fail`，但形状可辨（`⊘` vs `×`）+ 文字不同（`被拒` vs `失败`）。
> - **已中断 vs 等待**：同用灰 `--st-wait`，但形状可辨（空心点+`⏸` vs 空心点）+ 文字不同（`已中断` vs `等待`）。
>
> 判定方式：把三处彩色全部转灰后，**仅凭 glyph 与文字标签仍能区分全部 7 态**即合格。

### A.2 层级（五级层次规范）

沿用现有 `--surface` 家族派生，**不新增层级令牌**，只固化「每级用于什么」：

| 层级 | 令牌 | light | dark | 用于 | 现状 |
|---|---|---|---|---|---|
| L0 背景 | `--bg` | `100%` | `16.5%` | 窗口底、mini-frame body | 保持 |
| L1 卡片/内容面 | `--surface` | `100%` | `20.5%` | 中栏、settings-sheet、popover、搜索框 | 保持 |
| L2 面板面 | `--surface-2` | `98.6%` | `24%` | 右栏底、标题栏、diff/term 容器、composer 芯片 | 保持 |
| L3 侧栏面 | `--surface-3` | `97.1%` | `27.5%` | 左栏底、sb-menu、已选 tab | 保持 |
| L4 弹层 | `--surface` + `--shadow-2` | — | — | settings-sheet / model-pop / 命令面板 / Sheet | 保持 |
| L5 浮起（toast） | `--fg` 反相 + `--shadow-2` | — | — | toast、浮钮 | 保持 |

**新增容器落位**：底栏状态栏用 `--surface-2`（与标题栏同层，读作 chrome）；⌘K 命令面板用 `--surface` + `--shadow-2`（L4）；回收态条用 `--surface-3`。

### A.3 字阶（现有字号规范化）

> **字体栈实测说明**：`--font-display/body` 实为 `-apple-system, BlinkMacSystemFont, 'SF Pro Display/Text', 'PingFang SC', system-ui, sans-serif`（`index.html:81-83`），**并非 Geist 变量字体**。本轮**不换字体**（用户边界），仅**固化字号层级**。若后续要接 Geist，需单列迁移（Out of Scope）。

| 层级 | 建议 class | font-size | 字重 | line-height | 用途 | 现有依据 |
|---|---|---|---|---|---|---|
| 页面标题 | `.t-page` | `15px` | `500` | `1.4` | 视图主标题 / 设置页 h2 | `.settings-head h2`(428) / `.ce-title`(500) |
| 区块标题 | `.t-section` | `13px` | `500` | `1.45` | 设置分区、面板小节、分组 | `.set-sec-title`(437) |
| 行标题 | `.t-row` | `13.5px` | `400` | `1.5` | 会话行 / 任务行 / 历史行标题 | `.session-title`(238) |
| 正文 | `.t-body` | `14px` | `400` | `1.6` | 消息正文 / 助手文本 | `body`(91) / `.ai-text`(566) |
| 描述/次级 | `.t-desc` | `12.5px` | `400` | `1.5` | 描述、think、次要说明 | `.set-sec-desc`(438) / `.think-head`(574) |
| 元信息（等宽） | `.t-meta` | `10.5–11px` | `400` | `1.4` | 时间 / tokens / 耗时 / 路径 | `.t`(542) / `.dur`(540) / `.tok`(543) |

**修订**：`--font-mono` 保持 `'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace`（`index.html:83`）。新增一个**等宽元信息统一 class** `.t-meta`，避免散落的 `.t/.dur/.tok` 各自定义（现状三处重复，收敛为一个即可，视觉值不变）。

### A.4 间距与尺寸（8px 基准网格）

**间距刻度**（`--sp-*` 为**新增命名**，值为现有散落间距的归并，不改变任何既有渲染）：

| 令牌 | 值 | 用于 | 现有对应 |
|---|---|---|---|
| `--sp-1` | `4px` | 图标与文字、chip 内微距 | `gap:4/2/3` |
| `--sp-2` | `8px` | 行内间距、按钮内距 | `gap:8` `padding:8` |
| `--sp-3` | `12px` | 卡片内距、面板内距 | `padding:12` |
| `--sp-4` | `16px` | 区块间距、composer 上下 | `padding:16` |
| `--sp-5` | `24px` | 大留白、stream 上下 | `padding:24/28` |
| `--sp-6` | `32px` | 空态、launcher | `padding:32/34` |

**尺寸令牌**：

| 令牌 | 现有值 | 修订值 | 理由 |
|---|---|---|---|
| `--sidebar-w` | `264px`（min 180 / max 420） | **保持** | 三栏骨架，实测 `index.html:14`、`data-min/max/def`(1234) |
| `--gutter` | `9px` | **保持** | 分隔条命中区，`index.html:16` |
| `--drawer-w` | `340px`（min 240 / max 640） | **保持** | 右板，`index.html:15`、`data-def`(1442) |
| `--center-w` | `calc(100vw − sidebar − drawer − 2×gutter)` | **保持** | 中栏推导，`index.html:134` |
| `--content-max` | `min(100%, clamp(560px, center−48, 1040px))` | **保持** | 消息列居中封顶，`index.html:135` |
| `--statusbar-h` | 无（新容器） | **新增 `24px`（= h-6 语义，规范值非实测）** | 底栏状态栏；不占侧栏高度、不遮主内容（TASK-2） |
| `--tap-min` | 既有控件**实测 24 / 26 / 28px 不等**：`.sb-trigger` 24×24(`index.html:289`)、`.mp-close`/`.mp-back` 24×24(`:738/:851`)、`.icon-btn` 26×26(`:298`)、`.msg-act`/`.inline-send`/`.side-home` 28×28(`:530/:697/:873`) | **新增控件下限 = `28px`**；既有控件**保持现状、不回退**（**不**把既有 24/26px 控件强改 28px） | 无障碍最小点击区（G-5）：新控件达标即可；旧控件强行统一属无收益改动面 |
| 窗口最小 | 无 | **`960×600`（minWidth/minHeight）** | RESP-2；`src/main/index.ts` 建窗处补 |

> **composer 输入区修订**：**实测**现有 `textarea` `min-height:24px` / `max-height:140px`（`index.html:692`）≈ 6.7 行（行高 1.5×14=21px）。**规范值 `max-height:168px`（8 行 × 21px，为推导值、非实测）** 以满足 CONV-5「1–8 行自适应」；`min-height:24px`（1 行）**实测保持**。

### A.5 圆角与阴影

**圆角**（`--r-*` 为新增命名，值取现有各档，**不改变渲染**）：

| 令牌 | 值 | 用于 | 现有对应 |
|---|---|---|---|
| `--r-1` | `6px` | 菜单项、sb-item、mp-close | `border-radius:6` |
| `--r-2` | `8px` | 按钮、图标钮、tb-btn | `border-radius:8` |
| `--r-3` | `10px` | sb-menu、arch-row | `border-radius:10` |
| `--r-4` | `12px` | **卡片 / diff / term / popover / 弹层** | `border-radius:12` |
| `--r-5` | `14px` | **composer-box** | `border-radius:14` |
| `--r-6` | `16px` | **气泡 / settings-sheet** | `border-radius:16` |
| `--r-pill` | `999px` | chip、toast、switch | `border-radius:999` |

**卡片/输入/按钮/弹层取档约定**：卡片=`--r-4`、输入=`--r-5`、按钮=`--r-2`、弹层/Sheet=`--r-4`(菜单)~`--r-6`(Sheet)。

**阴影**（保持两档，不新增）：

| 令牌 | 现有值 | 用于 |
|---|---|---|
| `--shadow-1` | `0 1px 2px …/0.04, 0 3px 12px …/0.05` | 静息卡片、quick-card、switch 滑钮 |
| `--shadow-2` | `0 8px 32px …/0.12` | 悬停卡片、弹层、Sheet、toast、浮钮、Sheet 侧栏 |

### A.6 动效（时长与缓动档位）

| 令牌 | 值 | 用于 | 现有依据 |
|---|---|---|---|
| `--dur-1` | `120ms` | hover / 颜色 / 背景 | `transition:… .12s`（多处） |
| `--dur-2` | `180ms` | chev 旋转 / 开关 | `.think .chev .18s`(585) |
| `--dur-3` | `200ms` | 面板宽过渡 / 浮层淡入 | `.drawer width .2s`(868) |
| `--dur-4` | `240ms` | 消息入场 / popover / Sheet | `.msgIn .24s`(512) |
| `--ease-enter` | `cubic-bezier(.2,.8,.3,1)` | 弹层入场 | `popIn`(735) |
| `--ease-standard` | `cubic-bezier(.2,.7,.3,1)` | 消息/卡片 | `msgIn`(512) |

**`prefers-reduced-motion` 降级 — 不得回退**：现网实测 **12 处**降级块（`index.html:357/514/554/595/621/659/856/968/1063/1066` + `html.reduce-motion` 全局块 100-102），另有设置项「减少动效」`data-reduce-motion`（`index.html:1599`）。**新增动效（四态脉冲、回到底部浮钮、命令面板、Sheet）必须各自补一条 `@media (prefers-reduced-motion: reduce)` 降级**，降级后为静态。

---

## B. 组件规范（施工图）

> 格式：**结构（DOM 骨架 + 语义标签）｜状态｜尺寸｜交互｜无障碍**。`新增` = live 层需新建；`既有` = 复用现有 class。DOM 用 vanilla 字符串模板风格（`app.js` 风格）。

### B.1 对话窗口（Conversation）

#### B.1.1 消息气泡（既有）
- **结构**：`<div class="msg user|ai"><div class="msg-body"><div class="msg-meta"></div><div class="bubble">…</div> 或 <div class="ai-text">…</div><div class="msg-actions">…</div></div></div>`
- **状态**：流式中 `.msg.ai[data-stream][aria-busy="true"]`（既有 `index.html:1312`）；新增 `.msg.interrupted`（已中断）。
- **尺寸**：`.bubble max-width:78%`（保持，满足 CONV-1 ≤85%）；圆角 `--r-6`；内距 `10px 14px`。
- **交互**：助手侧不署名，正文即内容（既有）；diff/表格 `overflow-x:auto`（既有 `.diff`）。
- **无障碍**：`.msg-meta` 空（助手）；`.msg-actions` 按钮 `aria-label`（既有 `data-label`）。

#### B.1.2 think 折叠块（既有 + 两态增强，CONV-3）
- **结构**：`<div class="think [running|done]"><button class="think-head" aria-expanded aria-controls><span class="run-grid proc"></span> {文字} <span class="t">Ns</span><svg class="chev"/></button><div class="think-body" id></div></div>`
- **状态**：
  - 思考中 `.think.running`：`run-grid` 九宫格脉冲 + 文案「思考中」；`aria-live="polite"`。
  - 完成 `.think.done`：静态图标 + 文案「已深度思考 Ns」（既有）。
- **尺寸**：`think-head` `12.5px`，`padding:6px 0`（既有）。
- **交互**：点头部展开/收起（既有 `app.js:1595-1597`）。
- **无障碍**：`aria-expanded` / `aria-controls` 既有；**两态除颜色外有文字差异**（「思考中」vs「已深度思考」）满足 CONV-3 验收；reduced-motion 下 `run-grid` 降级为静态隔格点亮（既有 `index.html:357-361`）。

#### B.1.3 统一卡片骨架 + 6 类变体（CONV-4，核心施工图）
- **统一骨架（新增 `.card-body`/`.card-foot` 收口，兼容既有 `.body`）**：
```
<div class="card card--{kind} [collapsed]" data-od-id="{kind}-card">
  <button class="card-head" type="button" aria-expanded aria-controls="{id}" data-card-toggle data-card="{kind}" [data-doc]>
    {icon}<span class="ct">{标题}</span><span class="tag">{状态位}</span><svg class="chev"/>
  </button>
  <div class="card-body" id="{id}">{内容}</div>
  <div class="card-foot" role="group" aria-label="卡片操作">{操作}</div>  <!-- 新增：脚=操作区 -->
</div>
```
  - **头**：图标 + 标题(`.ct`) + 状态位(`.tag`) + chev —— 既有结构，`index.html:1270-1274`、`app.js:1752-1758`。
  - **体**：`.card-body`（既有代码用 `.body`，`app.js:1768`；**建议保留 `.body` 为别名，新增 `.card-body` 语义类**）。
  - **脚**：`.card-foot`（**新增**）—— 承载操作区（既有 plan 卡用 `.plan-acts`、审批卡用 `.ask-acts`，统一收敛到 `.card-foot`）。
- **6 类变体**：

| 变体 | class | 现有实现 | 修订/新增 | 状态位示例 |
|---|---|---|---|---|
| plan | `.card--plan` | `.card` + `.plan-steps`(既有 1269) | **新增进度可视化**（进度条/步骤点），保留 `2/4 已完成` 文案 | `2/4 已完成` / `待确认` / `已批准` / `已拒绝` |
| diff | `.card--diff` | `.card` + `.diff`(既有 1283) | 保持；`overflow-x:auto` | `+12 −4` |
| tool | `.card--tool` | `.card` + `.term`（`app.js:1796` tool_call 建卡） | 保持 | `…` → `ok`/`fail` |
| approval | `.card--approval` | `.card.ask[data-ask]`(既有 `app.js:1880`) | **保留 `data-ask`**；新增「全局提示联动」（§B.2.5） | `high` / `已批准 · 原因` |
| verify | `.card--verify` | `.card` + `.term`（`app.js:1857` verify_result） | 保持，`#N` 重试序号 | `ok`/`fail` |
| report | `.card--report` | **无** | **新增**（run 产出报告汇总） | `完成` / `N 项` |

- **尺寸**：卡片圆角 `--r-4`；`diff/term` 描边 `1px var(--border)`（既有 `index.html:607-608`）；头 `padding:4px 0`（`.chat .card-head`）。
- **交互**：点头折叠（既有 `app.js:1615-1633`）；`data-card="diff"` 展开时高亮右栏文件树（既有 `activeFileDoc`，`app.js:1623`）。
- **无障碍**：`aria-expanded`/`aria-controls` 既有；进度条需 `role="progressbar" aria-valuenow/valuemin/valuemax`；**不改变任何 `data-*` 钩子**。

#### B.1.4 输入区 composer（CONV-5）
- **结构**（既有）：`.composer > .composer-inner > .ctx-rail（芯片）+ .composer-box(textarea + .inline-send) + .composer-foot`
- **修订**：
  - textarea `max-height: 140px → 168px`（1–8 行，§A.4）。
  - 发送钮新增**运行中→停止**态：`.inline-send` 增加 `[data-state="stop"]`（图标由 ↑ 变 ■，`aria-label="停止"`）。
  - 左侧新增 `+` 附件/引用入口：`.ctx-chip.ctx-upload`（**已有样式** `index.html:681-683`，接入即可）。
  - 新增待发队列条 `.queue-bar`（流式中显示「已排队 N 条」）。
- **状态**：idle / running（停止钮 + queue-bar）/ interrupted（`.composer.interrupted` 提示「已中断，可继续」）。
- **尺寸**：`composer-box` 圆角 `--r-5`；`inline-send` 28×28（`--tap-min`）。
- **交互**：Enter 发送 / Shift+Enter 换行；运行中可继续输入并排队（CONV-2）。
- **无障碍**：`textarea aria-label`；停止钮 `aria-label`；队列条 `role="status" aria-live="polite"`；reduced-motion 下无强制动画。

#### B.1.5 消息级操作条（CONV-6，既有 + 补「引用」）
- **结构**：`.msg-actions > .msg-act[data-msg-act]`（copy/undo/regen/fork 既有 `index.html:1300-1304`）+ 新增 `data-msg-act="quote"`（引用，回填输入区）。
- **尺寸**：`.msg-act` 28×28（`--tap-min`），圆角 `--r-2`。
- **交互**：hover/聚焦提亮（既有）；引用点击后把该消息文本回填 `#promptInput`。
- **无障碍**：每个 `.msg-act` 有 `aria-label` + `data-label`（既有）；`.msg-act.is-done` 反馈（既有）。

#### B.1.6 回到底部浮钮（CONV-7，新增）
- **结构**：`<button class="scroll-bottom-btn" aria-label="回到底部">↓<span class="sbb-count">3</span></button>`
- **状态**：`hidden`（默认，`stream.scrollTop` 触底时）→ `.show`（上滚 ≥1 屏出现）；有新消息时显示未读数。
- **尺寸**：36×36，圆角 `--r-pill`，`--shadow-2`，定位于 `.chat` 右下（`bottom: 88px; right: 24px`，避开 composer）。
- **交互**：点击 `stream.scrollTop = stream.scrollHeight`。
- **无障碍**：`aria-label` + `aria-live="polite"` 播报未读数；reduced-motion 下无位移动画（直接显隐）。

#### B.1.7 卡片类型过滤器（CONV-7，新增）
- **结构**：`<div class="card-filter" role="toolbar" aria-label="按卡片类型过滤"><button class="cf-chip" data-filter="diff" aria-pressed>diff</button>…<button data-filter="plan">plan</button><button data-filter="approval">审批</button></div>`
- **状态**：`aria-pressed` 切换；点击后 `stream` 内非目标卡片 `.card.dimmed`（降透明度并折叠），并显示「匹配 N 条」。
- **尺寸**：chip `h 26px`，圆角 `--r-pill`，复用 `.ctx-chip` 视觉。
- **交互**：多选过滤；「定位下一条」按 `data-card` 跳转（配合回到底部浮钮）。
- **无障碍**：`role="toolbar"` + `aria-pressed`；键盘 Tab 可达；过滤结果 `role="status"` 计数。

### B.2 任务执行面板（Task / Execution）—— 全新构建

> **前提**：live 层无 `agents/approvals/token/git/schedule` 面板，本模块**全部为新增 vanilla 组件**（§0 事实）。数据源：`app.js` 事件流（`api.onEvent`），若内核缺 run 聚合字段，按 `01-requirements.md` §Q3 用**结构占位**并在报告标注「需内核补 run 聚合接口」。

#### B.2.1 任务列表行（TASK-1）
- **结构**：`<button class="task-row" role="row" aria-selected><span class="tr-dot" data-state="run"></span><span class="tr-name">…</span><span class="tr-phase">执行</span><span class="tr-prog"><span class="tp-fill" style="width:62%"></span></span><span class="tr-time">02:14</span></button>`
- **状态**：`run / wait / stuck / fail / rejected / interrupted / done`（完整 7 态，与 §A.1.3 一致；`done`=成功）。
- **尺寸**：行高 40px；圆角 `--r-2`；进度条 `h 4px` 圆角 `--r-pill`。
- **交互**：点击选中并在主区展开；≥1280 可作为一级视图（§C）。
- **无障碍**：`role="row"`/`aria-selected`；状态点 `aria-hidden` + 文字标签；`role="progressbar"`。

#### B.2.2 全局运行状态条（TASK-2，三档宽度均可见且不遮主内容）
- **结构（底栏，新增）**：`.statusbar[data-run="1"]`（h=`--statusbar-h` 24px，`--surface-2`）内含：`沙箱` · `事件数` · `tokens` · `阶段: 规划→执行→验证→合并` + `.sb-prog`。
- **顶栏状态点（新增）**：`.run-dot`（标题栏右侧，四态色 + 图形）。
- **状态**：`idle`（隐藏阶段）/ `run`（阶段 + 进度）/ `stuck`（黄 + 「恢复」按钮）/ `fail`（红 + 「重试」）。
- **尺寸**：24px 高，字号 `12px`，`--surface-2` 底 + 上边框 `1px var(--border)`。
- **交互**：点状态条展开任务视图；`stuck` 时提供「恢复」动作并给 toast 反馈。
- **无障碍**：`role="status" aria-live="polite"`；进度 `role="progressbar"`；**不遮挡主内容**（占独立 24px 底栏，非浮层）。
- **验收要点**：1024 / 1280 / 1600 三档窗口下**均可见**（底栏常驻，不随断点隐藏）。

#### B.2.3 worker 节点卡（TASK-3）
- **结构**：`<div class="worker-node" data-state="run"><span class="wn-dot"></span><span class="wn-name">worker-1</span><span class="wn-ev">read_file src/x.ts</span><button class="wn-open" aria-label="查看事件流"/></div>`
- **状态**：`run / wait / stuck / fail / rejected / interrupted` + `recovering`；色+形+文三重（§A.1.3）；`stuck` 内嵌「!」、`fail`「×」、`rejected`「⊘」、`interrupted`「⏸」；`recovering` 时 `.worker-node.recovering`（脉冲 + 「恢复中」）。
- **尺寸**：节点宽 168px，内距 `--sp-2`，圆角 `--r-4`。
- **交互**：点节点滑出该 worker 事件流（右侧 Sheet 或主区下钻）。
- **无障碍**：状态点 `aria-hidden` + 文字；节点 `role="button" tabindex="0"`；事件流 `aria-label`。

#### B.2.4 依赖链连线（TASK-3）
- **结构**：`.dep-chain`（容器）+ `<svg class="dc-lines" aria-hidden="true">`（贝塞尔连线）+ `.worker-node` 节点。
- **规范**：连线 `1px var(--border)`，激活路径用 `--st-run`；节点按拓扑分层（列），边=依赖方向。
- **尺寸**：列间距 `--sp-5`；连线不与节点文字重叠。
- **无障碍**：连线 `aria-hidden`；依赖关系另以 `aria-describedby` 文字「依赖：worker-1」表达（不单独靠图形）。

#### B.2.5 审批待办入口（TASK-4）
- **结构**：顶栏 `.approval-dot`（黄脉冲 + 计数徽标）+ 抽屉常驻「审批」入口 `.approval-entry`。
- **状态**：无待办=隐藏；有待办=`.approval-dot.show` 黄脉冲（`--st-stuck`）+ 计数；reduced-motion 降级为静态黄点。审批结果为 `被拒`（`--st-fail` + `⊘`）/ `已批准`（`--ok` + ✓）。
- **尺寸**：点 8px；徽标 `h 16px` 圆角 `--r-pill`。
- **交互**：1 次点击到达审批聚合；到达时触发 macOS Dock badge（`app.dock.setBadge`，需主进程配合，标注「需主进程 API」）。
- **无障碍**：`aria-label="N 条待审批"`；reduced-motion 静态；**不单独依赖颜色**（配数字徽标）。

#### B.2.6 run 产出汇总区（TASK-5）
- **结构**：`.run-output`（分段）：`.ro-diff`（diff 汇总）/ `.ro-verify`（verify 结果）/ `.ro-report`（报告）。
- **状态**：加载 / 完成 / 部分失败。
- **尺寸**：分区标题 `--t-section`；内容复用 `.diff` / `.term` 容器。
- **交互**：与 HIST-2 联动（同 run 在历史可回溯）；diff 行可点击跳文件树。
- **无障碍**：分区 `role="region" aria-label`；复用既有 `.diff`/`.term` 语义。

#### B.2.7 卡死 / 恢复中呈现（TASK-6）
- **结构**：`.worker-node.stuck` + `.recover-btn`；恢复中 `.worker-node.recovering` + `role="status"` 文案「恢复中…」。
- **交互**：点「恢复」→ 触发恢复动作 → 成功/失败 toast。
- **无障碍**：状态用色+图形+文字三重；reduced-motion 下脉冲降级为静态。

### B.3 历史记录管理（History）

#### B.3.1 会话历史行（HIST-1，既有，不回退）
- **结构/交互**：`.session[data-id]` + `.session-row` + `.session-actions`（pin/archive/rename/delete，既有 `app.js:250-308, 418-434`）；分组 today/yesterday/week/earlier + 文件夹折叠（既有）。
- **修订**：**零回退**；仅补 HIST-4 的**状态筛选**（§B.3.4）与 HIST-3 检索范围（§B.3.3）。

#### B.3.2 run 批次历史行（HIST-2，新增）
- **结构**：`<div class="run-history-row" role="button" aria-expanded><span class="rh-dot"></span><span class="rh-title">批次 #42 · 重构认证</span><span class="rh-meta">3 worker · 2m14s</span><span class="rh-chev"/></div>` + 展开区 `.rh-detail`（worker 产出 / verify / diff 汇总）。
- **状态**：成功 / 失败 / 被拒 / 已中断 / 进行中（五态，映射 §A.1.3 的 `done / fail / rejected / interrupted / run`）。
- **尺寸**：行高 44px；展开区复用 `.diff`/`.term`。
- **交互**：点击展开/收起。
- **无障碍**：`aria-expanded`/`aria-controls`；状态点配文字。

#### B.3.3 检索框（HIST-3）
- **结构**：复用 `.search`（既有 `index.html:175-180`）+ 新增范围 chips `.search-scope`（标题/正文/工具/文件）。
- **状态**：空 / 有结果（计数）/ 无结果。
- **交互**：输入即过滤；范围可切换；结果可定位到会话或 run。
- **无障碍**：`<input aria-label="搜索">`；结果数 `role="status"`。

#### B.3.4 状态筛选 chips（HIST-4，新增）
- **结构**：`.filter-chips[role="toolbar"] > .fc-chip[data-status][aria-pressed]`：成功 / 失败 / 被拒 / 已中断 / 进行中（状态点复用 §A.1.3 glyph：`✓ / × / ⊘ / ⏸ / 实心点`）。
- **交互**：多选；筛选后显示正确计数。
- **无障碍**：`role="toolbar"` + `aria-pressed`。

#### B.3.5 回收态（HIST-5，新增）
- **结构**：删除先进 `.trash-row`（`--surface-3` 底 + 「撤销」按钮）+ 顶置 toast「已删除 · 撤销」。
- **状态**：`.trash-row` 显示 N 秒后转永久删除（撤销窗口）。
- **交互**：点「撤销」恢复；回收区与归档区（既有「已归档」`archive-toggle`）**视觉分区清晰**。
- **无障碍**：`role="status" aria-live="assertive"`；撤销按钮 `aria-label`。

#### B.3.6 时间轴视图（HIST-6，新增）
- **结构**：`.timeline[data-grain="day|week"]` + `.tl-item`（会话/run 沿时间排列）。
- **交互**：切换粒度（日/周）；点项定位。
- **无障碍**：粒度切换 `role="radiogroup"`；时间轴 `role="list"`。

### B.4 新增容器

#### B.4.1 底栏状态栏（TASK-2 / Q2 默认）
- **结构**：`<footer class="statusbar" role="contentinfo">…</footer>`，`h = --statusbar-h`（24px），`--surface-2`，`border-top:1px var(--border)`。
- **内容**：沙箱态 · 事件数 · tokens · 当前阶段 + 进度。
- **尺寸**：24px；字号 12px；不遮挡主内容（占布局底部固定行，非浮层）。
- **无障碍**：`role="contentinfo"`；阶段 `aria-live="polite"`。

#### B.4.2 ⌘K 命令面板（RESP-4，新增）
- **结构**：`.cmdk-overlay > .cmdk > .cmdk-input(input, role="combobox" aria-expanded) + .cmdk-list(role="listbox")`。
- **状态**：关闭 / 打开 / 空结果。
- **尺寸**：宽 `min(560px, 92vw)`；居中偏上（`top: 18%`）；圆角 `--r-4` + `--shadow-2`。
- **交互**：`⌘K` 开合、↑↓ 选择、Enter 执行、Esc 关闭；覆盖会话搜索 + 动作（新建/切换面板/主题）。
- **无障碍**：`role="combobox"`/`listbox`/`option` + `aria-activedescendant`；焦点陷阱；Esc 关闭。快捷键层见 §C（RESP-4）。

---

## C. 响应式规则（对应 RESP-1..4）

### C.1 四档断点表

| 断点 | 侧栏态 | 右板态 | 主内容区最小宽 | 输入区 | 消息列 |
|---|---|---|---|---|---|
| **≥1600** | 列 `264px`（全开，可拖 180–420） | 列 `340px`（全开，可拖 240–640） | `≥480px` | 不折叠 | `--content-max` 封顶 1040，**居中不拉伸** |
| **1280–1599** | 列 `264px`（默认） | 列 `340px`（默认） | `≥480px` | 不折叠 | `clamp(560, center−48, 1040)` 居中 |
| **1024–1279** | **icon 态 `64px`**（收为图标栏） | 列 `240–340px`（可收起） | `≥480px` | 不折叠 | `clamp(560, center−48, 1040)` |
| **960–1023** | icon 态 `64px` | **覆盖式 Sheet**（复用 `index.html:1177` `.drawer.open-m` 机制） | `≥480px` | 不折叠 | 用满宽（`--content-max:none`） |

> **与主理人口述的一处差异**：主理人消息写「1024–1279 起右板改覆盖式 Sheet」，而验收口径 **RESP-1** 写「1024–1279 左栏收为 icon 态；**960–1023** 右板改覆盖式 Sheet」。本表**按权威验收口径 RESP-1 落地**。若主理人确认要 1024 就切 Sheet，只需把 `@media (max-width:1279px)` 内的右板 Sheet 规则上移一档即可（一行改动，已预留）。

**媒体查询骨架（增量，叠加在现有 `@media (max-width:920px)` 之上）**：
```css
/* 新增三档；现有 920 断点保留为 <960 的兜底（两侧均 Sheet） */
@media (max-width:1599px){ /* 默认三栏，无需额外规则，仅固化 --content-max */ }
@media (max-width:1279px){ .sidebar{width:64px} /* icon 态：隐藏 .s-txt/.group-label，仅留图标 */ }
@media (max-width:1023px){ .drawer{position:fixed;right:0;top:44px;bottom:0;z-index:40;width:min(340px,88vw);transform:translateX(100%);transition:transform .2s;box-shadow:var(--shadow-2)} .drawer.open-m{transform:translateX(0)} .shell{--content-max:none} }
```
> `--center-w` 推导（`index.html:134`）与 `--content-max`（`index.html:135`）**保持**；icon 态侧栏需把 `--sidebar-w` 覆盖为 `64px` 以让中栏自动扩宽。

### C.2 其它响应式规则

| 项 | 规范 | 落点 |
|---|---|---|
| **最小窗口** | `960×600`（RESP-2） | `src/main/index.ts` 建窗处 `minWidth:960, minHeight:600` |
| **主内容区下限** | 任何断点 `≥480px`（RESP-3） | 由 icon 态侧栏 + Sheet 右板保证 |
| **输入区** | **永不折叠**（RESP-3） | `.composer` 不参与任何断点隐藏 |
| **栏宽持久化优先级** | **手动（拖动）> 自动（断点）**：用户拖过的宽度写入 `settings.json layout`，重开优先于断点默认值；未拖过则用断点默认 | 复用既有 `data-min/max/def`（`app.js:585-590`）+ `localStorage 'forge-drawer'`（`app.js:670`） |
| **4K 缩放** | 支持 100% / 125% / 150%；px 字阶在 150% 下不裁切（不设固定行高容器） | 全局；statusbar/行高用 min-height 而非 height 固定值 |

### C.3 快捷键层（RESP-4）

| 快捷键 | 动作 | 现状 |
|---|---|---|
| `⌘K` | 命令面板（会话搜索 + 动作） | **新增** |
| `⌘N` | 新会话 | **新增** |
| `⌘1–⌘9` | 直达右板第 N 个面板 | **新增** |
| `⌘⌥E` | 文件 | 既有（`app.js:873`） |
| `⌘T` | 浏览器 | 既有（`app.js:874`） |
| `⌘⇧G` | 审阅 | 既有（`app.js:875`） |
| `⌘⇧J` | 终端 | 既有（`app.js:876`） |
| `Esc` | 关闭浮层/面板 | 既有 |

> 新增快捷键追加到 `app.js:869-877` 的同一 `keydown` 监听器，**不改动现有 4 条分支**。

---

## D. 与现有实现的映射表

### D.1 新规范 → class / 函数 落点

| 新规范 | 落点：`index.html` class | 落点：`app.js` 函数 |
|---|---|---|
| 四态语义色 | 新增 `:root` / `html[data-theme=dark]` 令牌块（紧接 `index.html:36` 与 `:68` 之后） | — |
| 底栏状态栏 `--statusbar-h` | 新增 `.statusbar`（`.shell` 之后、`</div>` 前，约 `index.html:1490`） | 新增 `renderStatusbar()`，订阅 `api.onEvent` |
| 卡片骨架 `.card-body/.card-foot` | `.card` 段（`index.html:598-621`）追加 `.card-body`/`.card-foot` | `newCard()`(`app.js:1748`) / `setCardBody()`(`app.js:1764`) 改用 `.card-body` |
| think 两态 | `.think` 段（`index.html:568-597`） | `app.js:1595-1597`、`1715-1729` 加 `.running/.done` |
| composer 8 行 + 停止钮 | `.composer-box textarea`（`index.html:690-694`）、`.inline-send`（696-704） | `send`(`app.js:1934`)、`api` 运行态回调 |
| 回到底部浮钮 | 新增 `.scroll-bottom-btn`（`.chat` 内） | 新增 `initScrollBottom()`，监听 `.stream` scroll |
| 卡片类型过滤器 | 新增 `.card-filter`（`.stream` 顶部） | 新增 `initCardFilter()`，按 `data-card` 过滤 |
| 任务列表 / worker / 依赖链 | 新增 `.task-row/.worker-node/.dep-chain`（新视图容器） | 新增 `renderTaskView()`（读事件流，结构占位） |
| 审批全局提示 | 新增 `.approval-dot`（`.titlebar` 内，`index.html:1191` 附近） | 扩展 `api.onAsk/onAskDone`(`app.js:1916-1926`) |
| run 产出汇总 / run 历史 | 新增 `.run-output/.run-history-row` | 新增 `renderRunHistory()` |
| 检索范围 / 状态筛选 / 回收态 / 时间轴 | 新增 `.search-scope/.filter-chips/.trash-row/.timeline` | 扩展 `renderSide()`(`app.js:814`)、新增 `initHistoryFilters()` |
| ⌘K 命令面板 | 新增 `.cmdk-overlay/.cmdk`（body 末尾，`index.html:1660` 前） | 扩展 `keydown`(`app.js:870`) |
| 四档断点 | 追加 `@media (max-width:1279/1023px)`（`index.html:1182` 之后） | `gutters.remap()`(`app.js:584-654`) |
| 最小窗口 | — | `src/main/index.ts:86` 附近 `new BrowserWindow({minWidth,minHeight})` |

### D.2 `data-*` 钩子冻结清单（**live 层实测存在，零重命名**）

> 下列钩子**确实存在于发货中的 vanilla 渲染层**，`app.js` 直接依赖；**原型构建师不得重命名/删除**。

| 钩子 | 实测位置 | 用途 |
|---|---|---|
| `data-theme` | `index.html:2` | 主题切换（`app.js:560-566`） |
| `data-od-id` | `index.html` 多处（titlebar/sidebar/chat/composer/drawer/quick-card…） | 设计标注锚点，**保持** |
| `data-drawer` | `index.html:1197`（shell） | 右板收起态（`app.js:668`） |
| `data-panel="sidebar"\|"drawer"` + `data-min/max/def` | `index.html:1234`、`1442` | 分隔条拖动尺寸（`app.js:585-590`） |
| `data-view` | `index.html:1459/1465…`、`app.js:816/822/856` | 侧 tab / quick-card 打开视图 |
| `data-close` | `app.js:819/844/851` | 关闭侧 tab |
| `data-card-toggle` / `data-card` / `data-doc` | `index.html:1270/1284/1293`、`app.js:1753/1615/1623` | 卡片折叠 + 文件树联动 |
| `data-msg-act` / `data-label` | `index.html:1248-1304`、`app.js:1005-1009` | 消息级操作 |
| `data-act` / `data-archived` / `data-id` / `data-folder` | `app.js:410/419/425-434/551` | 会话行操作/归档 |
| `data-sec` / `data-grp` / `data-val` / `data-switch` / `data-set-theme` / `data-reduce-motion` | `index.html:1496-1611`、`app.js:501-546` | 设置面板 |
| `data-model` / `data-desc` | `index.html:1413-1423`、`app.js:1579-1588` | 模型选择 |
| `data-term` | `app.js:775/860-862` | 终端子标签 |
| `data-branch` | `app.js:789/1404-1406` | 分支选择 |
| `data-ws` / `data-perm` | `app.js:1227-1229/1327-1329` | 工作区 / 权限档 |
| `data-ask` | `app.js:1884/1918` | 审批卡（**live 层唯一审批钩子**） |
| `data-live` / `data-stream` | `app.js:1688/1715/1733`、`index.html:1312` | 流式消息标记 |
| `data-empty` | `index.html:1456`、`app.js:826` | 右栏空态 |
| `data-tokenized` | `app.js:105-107` | diff 着色幂等标记 |

### D.3 ⚠️ panels-check 依赖但 **live 层缺失**的钩子（风险清单，需主理人裁决）

| 钩子 | panels-check 用途 | live 层实测 | 处置建议 |
|---|---|---|---|
| `data-m1e-item` | 1 万条虚拟化 DOM 计数（`panels-check.ts:257-271`） | **不存在**（仅 `conversation.tsx:71` dead） | 探针改指 `.msg`/vanilla 列表，或接线 React 版 |
| `data-m1e-event-count` | 侧栏事件计数=10000（`:251`） | **不存在** | 同上 |
| `data-virtuoso-scroller` | 滚动性能探针（`:264-269`） | **不存在**（react-virtuoso 专属） | 改指 `.stream` 或 `.session-scroll` |
| `data-approval-badge` | 审批徽标 ≤1s（`:278`） | **不存在**（live 只有 `.card.ask[data-ask]`） | 用 `.approval-dot`（本规范新增）替代探针目标 |
| `data-panel-toggle="git"` | 面板开关持久化（`:286`） | **不存在**（live 用 `data-view`） | 改指 `[data-view=git]`，或新增 git 视图 |
| `data-panel-id="git"` | 重启还原断言（`:327`） | **不存在** | 同上 |
| `data-m1e-settings-open` | 打开设置（`:299`） | **不存在**（live 用 `#settingsOpen`，`index.html:1221`） | 改指 `#settingsOpen` |

> **结论**：`panels-check` 的 B 相**当前探测的是 dead React 代码**，与发货 vanilla 层错位。这是 `01-requirements.md` §G-2 的表述误差，**不影响本规范的令牌/组件落地**，但**阻塞「`pnpm panels-check` 全绿」这条验收**。**建议主理人在 Phase 3 前裁决**：① 探针改指 vanilla 层（推荐，成本低）；② 或接线 React 版并单列迁移成本（G-1 要求）。

---

## E. 落地优先级（P0/P1/P2）

> 回归方式：`pnpm panels-check`（CDP 探针）+ `pnpm gates`（26 道）。每批标注改动性质。

### P0 — 令牌级 + 结构级（低风险，先落）
| 项 | 性质 | 回归 |
|---|---|---|
| 新增四态语义色令牌（light/dark） | **纯令牌级** | `pnpm gates`（无 DOM 变化） |
| `--statusbar-h / --tap-min / --sp-* / --r-* / --dur-*` 命名固化 | **纯令牌级** | `pnpm gates` |
| 底栏状态栏 `.statusbar`（h-6） | **结构级** | `panels-check` + 4 档截图 |
| composer `max-height 168px` + 停止钮 + `+` 入口 | **结构级** | 目检 + 截图 |
| think 两态 `.running/.done` | **结构级** | 目检（reduced-motion 检查） |
| 四档断点补齐（含 icon 侧栏 + Sheet 右板） | **结构级** | 960/1024/1280/1600 四档截图 |
| 最小窗口 960×600 | **结构级** | 拖窗目检 |

### P1 — 交互级（中风险）
| 项 | 性质 | 回归 |
|---|---|---|
| 卡片统一骨架 `.card-body/.card-foot` + plan 进度可视化 | **交互级** | `panels-check`（卡片折叠钩子不破） |
| 回到底部浮钮 + 卡片类型过滤器 | **交互级** | 目检 + 键盘可达 |
| 消息级「引用」入口 | **交互级** | 目检 |
| 审批全局提示 `.approval-dot`（顶栏黄脉冲 + 计数） | **交互级** | reduced-motion 检查 |
| ⌘K 命令面板 + ⌘N / ⌘1–9 | **交互级** | 键盘可达 + Esc 不回退 |
| 历史：检索范围 / 状态筛选 / 回收态 / 时间轴 | **交互级** | 目检 |

### P2 — 全新视图（较高风险，依赖内核数据）
| 项 | 性质 | 回归 |
|---|---|---|
| 任务执行视图（任务列表 / worker 节点 / 依赖链 / 卡死恢复） | **结构+交互级** | `panels-check` + 4 档截图；**若内核缺 run 聚合字段，用结构占位并在报告标注** |
| run 产出汇总 + run 批次历史 | **结构+交互级** | 同上 |
| `panels-check` 探针与 vanilla 层对齐（D.3 裁决项） | **验收级** | `pnpm panels-check` 全绿 |

---

## 附：本规范的硬约束自检

| 约束 | 自检 |
|---|---|
| 不换字体/色板/组件库 | ✅ 字体栈保持；灰阶/强调色零改动；无新组件库 |
| 不引毛玻璃/渐变 | ✅ 新增令牌均为纯色/oklch 字面量；无 backdrop-filter/linear-gradient 新增 |
| 不新增色相（四态除外） | ✅ 唯一新色相 = 四态语义色（TASK-6 授权） |
| 双主题 AA | ✅ 四态实测：非文字 ≥4.5:1，彩色文字 >7:1（§A.1.2） |
| 状态不单独依赖颜色 | ✅ 三重编码（色+图形+文字，§A.1.3） |
| 无障碍不回退 | ✅ 12 处 reduced-motion 保留；新增动效各补降级；28×28 固化 |
| `data-*` 零重命名 | ✅ live 层冻结清单见 §D.2；缺失钩子风险见 §D.3（需主理人裁决） |
| 增量、不推翻信息架构 | ✅ 全部「现有值 → 修订值 → 理由」；三栏尺寸与 `--content-max` 保持 |
