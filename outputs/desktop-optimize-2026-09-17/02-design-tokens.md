> **⚠️ 存档（2026-09-18 裁定）**：本文降为存档，**不可直接施工**，且**范围自限于 A 类**（肉眼可见），B 类不在本文——不可当全量权威（包亦不完整：仅 `02`/`04`/`05`，无 `00`/`01`/`03`）。
> **两条自报数已被复测推翻**：C4 reduced-motion 自报 13→**17**，实为 **13**（`docs/ui-fact-baseline.md` F15）；C6 自报新增 z-index **30**/40，实测档位 **6/40/60/61/70/71/80/90，无 30**（F17）。**两面权威**：意图 = `agent-plan.md` §10.1；事实 = `docs/ui-fact-baseline.md`。正文一字未改。

# DSH 桌面端优化 · 本轮设计令牌与视觉验收口径（2026-09-17）

> 负责人：设计系统专家 彩格调（Cai）。
> 事实来源：**本轮对当前工作树逐行复核**（`src/renderer/index.html` / `src/renderer/app.js` / `src/events/index.ts`），全部计数与对比度**独立复算**，未引用既有文档数字。
>
> ⚠️ **数值纪律**：本报告每个数字都由本人 `grep`/`node` 复算后写出。**行号只作定位线索、不作判据**（`app.js` 本轮实测 2371 行，既有设计系统文档写 2360 —— 已漂 +11）。
> 范围：**只有 A 类（肉眼可见）**。B 类（模块拆分 / 单一状态源 / 卡片注册表 / 差量重绘 / React 判定表 / 事件委托 / CSS `@layer`）**不在本文**。
> 硬约束：**未改 `src/` 下任何代码**；冻结钩子**零重命名**；不换色板、不换字体、不引组件库、不引毛玻璃/渐变。
> 命令行一律 `grep -E`，词边界用 `-w`，**禁用 `\b`**（BSD grep 不支持，恒返回 0）。

---

## §0 结论先行

### 0.1 沿用既有设计系统的决定

**沿用 `outputs/frontend-refactor-2026-09-17/02-design-system.md`，不换系统。**

理由（一句话）：本项目的视觉资产（oklch 双主题灰阶 + 单一钢蓝 accent + SF/PingFang 字体栈）已经**落成可运行代码并带门禁基线**，本轮需求全部是"补齐表现层"（骨架屏/归档区分/三态形状/窄档 Sheet/底栏密度），**没有一项需要新的视觉基因**；换系统等于用一次全量色板重写去换零收益。

### 0.2 交叉校验（为证伪而做，不是为替换）

> **环境说明（诚实标注）**：71 套品牌级系统中，本环境仅落地了 `references/visual-directions.md`（5 大视觉方向，可读可引）+ 分类清单；**各品牌的 DESIGN.md 令牌文件不在磁盘上**。因此品牌层的对照只做**方向性定性判断**，**不产出任何品牌色值**，也不作为判据。所有可判据的数字一律来自本项目实测。

#### 0.2.1 5 大视觉方向定位（磁盘可查，可引）

| 方向 | 定义的关键特征 | 本项目是否吻合 |
|---|---|---|
| **Tech Utility** | 高信息密度、紧凑间距、多列、数据表格、状态指示器、等宽/半等宽优先 | **行为层吻合**：三栏 + 5 视图、长时盯运行状态、底栏常驻指标、tabular-nums 防跳动 |
| **Modern Minimal** | 黑白灰为主 + **一个**强调色、严格栅格、克制 | **色板层吻合**：单 accent 钢蓝、中性灰阶骨架、1px 冷灰描边 |
| Editorial Monocle | 衬线 + 大留白 + 暖调 | ❌ 与"高信息密度"直接冲突 |
| Brutalist | 粗边框 + 撞色 + 破格 | ❌ 与"克制精致"直接冲突 |
| Soft Warm | 暖色 + 大圆角 + 低对比 | ❌ 与"长时会话护眼 / 双主题"直接冲突 |

> **关键结论（本轮最有价值的一条）**：本项目是 **Tech Utility 的"行为" + Modern Minimal 的"色板"** 的混合体。
> ⚠️ **因此禁止照抄 Tech Utility 的规范色板**——该方向定义的是 `oklch(15% 0.01 260)` 深蓝黑底 + `oklch(75% 0.20 160)` **霓虹绿 accent**（见 `visual-directions.md` §3）。若搬进来会：① 推翻既有 `--accent: oklch(48% 0.13 247)` 钢蓝；② 推翻 light 主题；③ 命中"既有 oklch 双主题色板不得回退"红线。**方向只借"信息密度与状态指示"的方法论，不借色值。**

#### 0.2.2 3 个品牌类比（定性，仅作方向校验）

| 类比 | 与 DSH 的可比点 | 校验结论 |
|---|---|---|
| **Linear**（开发工具） | 三栏、键盘优先、极高密度、单一低饱和 accent、动效克制 | 与本项目**几乎同位**。其"状态用形状+文字冗余编码"的做法已被本项目 §1.3 采纳 |
| **Cursor**（AI 编程 agent） | 同品类：AI 编程 agent、流式输出、工具调用卡、审批 | 佐证"三栏 + 消息流 + 右板"布局方向正确，**无需改布局范式** |
| **Raycast**（macOS 桌面效率） | 同平台：macOS 原生窗口、hiddenInset 交通灯、⌘K 面板、紧凑行 | 佐证"macOS 原生壳体 + 高密度列表"正确；其 44px 标题栏高度与本项目 `--titlebar-h: 44px` 实测一致 |

> **结论**：3 个类比全部落在"高密度 + 单 accent + 系统字体"同一族，与既有系统**同向**，**没有任何一条指向换系统**。交叉校验通过，闭环。

### 0.3 本轮实测基线（本人复算，含与既有文档的偏差）

| 项 | 本人实测 | 既有设计系统文档写 | 处置 |
|---|---|---|---|
| `index.html` 行数 | **1969** | 1969 | 一致 |
| `app.js` 行数 | **2371** | 2360 | **漂 +11**，不写死 |
| `prefers-reduced-motion` | **13** | 13 ✅ | 计数一致；**行号全变**（见 §2.1） |
| `aria-*` 出现次数 | **303**（index 194 + app 109） | 298 | ⚠️ **298 无法复现**；按行计为 245（144+101）。门禁建议改口径为 **≥303**，见 §2.2 |
| `role=` 出现次数 | **31**（index 22 + app 9） | 30 | ⚠️ 差 1，同口径问题 |
| `data-*` 钩子名种类 | **38**（字面量，167 处） | 「65 个 token」 | 口径不同（65 含 `dataset.*` 且未归一）。另有 **4 个仅以 `dataset.*` 形式存在**的键：`doc` / `askId` / `scope` / `tokenized`（字面量 grep 命中 0，已验证） |
| `src/events/index.ts` 行数 / `runId` 命中 | **707 行 / 0 处** | — | **GAP-03 硬阻塞坐实**，见 §0.4 |
| 四档断点 | 已落地（1423/1427/1429/1445） | 设计值 | ✅ 已施工 |
| 骨架屏 skeleton | **0 处**（`grep -E 'skeleton\|shimmer'` 空） | 上一轮判「放弃」 | **本轮因 PERF-01 复活**，见 §1.1 |
| `--st-*` 令牌 | 已落地（`index.html:58-66/107-115`） | 设计值 | ✅ 已施工 |
| `data-st` / `.st-dot` 三态形状 | **0 处** | 设计值 | ❌ **未施工**，本轮交付形状规格 §1.3 |

#### 0.4 GAP-03 阻塞的独立复核（⚠️ 硬阻塞，不可承诺功能）

```
grep -rn -w 'runId' src/events/index.ts        → 0 命中（文件 707 行）
grep -rn -w 'run_id' src/                      → 0 命中
grep -rn -w 'runID'  src/                      → 0 命中
grep -rn -w 'runId'  src/                      → 仅 3 处，全在 app.js:1087/1088/1151
```

且 `app.js:1087` 的 3 处是 `const runId = selectedId;`——**会话 id 的局部别名，不是 run 维度标识**。
→ **结论**：内核事件模型（`src/events/index.ts`，15–290 行定义 20+ 事件类型）**不存在 run 维度字段**。run 历史**只能落空态占位**，不得承诺翻页/跳转/重试/时间筛选。

---

## §1 本轮新增 / 补齐的设计令牌

> **插入位置**：色彩类进 `:root`（`index.html:15-75`）与 `html[data-theme="dark"]`（`76-124`）；主题无关标尺进第二个 `:root`（`125-138`）。**不动任何既有令牌名。**
> ⚠️ **命名冲突预警（实测）**：`--st` 这个**自定义属性名已被 `.run-grid i` 占用**作动画步进变量（`index.html:426-433`，`--st:0..7`）。故三态**只用 `data-st` 属性**承载语义，**绝不新增 `--st` 变量**；色值仍走既有 `--st-*` 前缀（不冲突）。

### 1.1 骨架屏 Skeleton（PERF-01 观感）

> 上一轮判「无异步骨架屏需求，放弃」。**本轮因窗口化复活**——窗口外必须有占位块，否则滚动时内容高度塌陷、产生跳动。这是**观感需求**，DOM≤300 是结构指标（B 类，不归本文）。

| 令牌 | light | dark | 用途 |
|---|---|---|---|
| `--sk-block` | `oklch(93% 0.005 250)` = `#e5e8eb` | `oklch(30% 0.016 250)` = `#282f36` | 占位块底色 |
| `--sk-sheen` | `oklch(97.5% 0.004 250 / .9)` | `oklch(42% 0.018 250 / .55)` | 微光带峰值色（叠在 `--sk-block` 上） |
| `--sk-r` | `var(--r-2)` = `6px` | 同 | 占位块圆角（复用既有标尺，不新增值） |
| `--sk-dur` | `1400ms` | 同 | 单次扫光周期（**≥1200ms**，低于此值会显闪烁） |
| `--sk-ease` | `linear` | 同 | 扫光缓动（**必须 linear**，ease 会在首尾停顿形成"呼吸"错觉） |
| `--sk-h-line` | `14px` | 同 | 单行文本占位高 |
| `--sk-h-msg` | `40px`（**初值，须按真实 `.msg` 实测校准**） | 同 | 消息行占位高 |
| `--sk-h-card` | `36px`（初值，须校准） | 同 | 卡片头占位高 |

**对比度实测（本人复算）**

| 配对 | light | dark | 判定 |
|---|---|---|---|
| `--sk-block` vs `--surface` | **1.23:1** | **1.31:1** | 落在 1.15–1.45 带内 ✅ |
| `--sk-block` vs `--surface-2` | 1.18:1 | 1.19:1 | 同上 ✅ |

> **为什么不做 ≥3:1（关键设计判断）**：骨架屏是**装饰性加载指示**，不是 UI 组件；"正在加载"这一语义由既有 `aria-busy="true"`（`index.html:1593`）+ 相邻文字承载，骨架块**不单独承载语义**，故 WCAG 1.4.11 不适用。
> **反过来它也不能太强**——若骨架做到 3:1（约 `#9a9a9a`），会被误读为真实内容。故规定**双向带**：**≥1.15:1（可感知）且 ≤1.45:1（不冒充内容）**，这是可判定口径（验收项 D4）。

**动效与降级**

```css
@keyframes sk-sheen{ from{background-position:-160% 0} to{background-position:260% 0} }
.sk{
  background-color:var(--sk-block);
  background-image:linear-gradient(90deg,transparent 0,var(--sk-sheen) 50%,transparent 100%);
  background-size:220% 100%;background-repeat:no-repeat;border-radius:var(--sk-r);
  animation:sk-sheen var(--sk-dur) var(--sk-ease) infinite;
}
/* 降级：静态块，不闪、不消失 */
@media (prefers-reduced-motion: reduce){ .sk{animation:none;background-image:none} }
```

### 1.2 归档态 Archived（VIS-06）

> **实测现状**：归档会话从 `sessions` 移出（`app.js:270` `splice`）→ 只存在于 `archived[]` → 由 `renderArchive()`（491-503）渲染为 `.arch-row`（`index.html:545-559`），承载面 = 设置面板 `--surface`。**活跃行是侧栏 `.session`**（承载面 `--surface-3`）。两者**不在同一列表**，因此"区分度"要跨两个容器成立。
> **实测缺陷**：`.arch-row` 的 `background:var(--surface-2)` 与父面板 `--surface` 只有 **1.04:1(light) / 1.09:1(dark)** —— 行边界**肉眼几乎不可辨**，更远低于 3:1。

| 令牌 | light | dark | 用途 |
|---|---|---|---|
| `--arch-bd` | `var(--border-strong)` = `oklch(62% 0.008 250)` `#83878b` | `oklch(56% 0.012 250)` `#6f757b` | 归档行**虚线**描边 |
| `--arch-bd-style` | `dashed` | 同 | **非颜色区分子**：虚线 vs 活跃行无描边 |
| `--arch-fg` | `var(--muted)` `#52565a` | `#9fa5ac` | 归档行标题文字 |
| `--arch-ico` | `var(--muted)` | 同 | 归档图标色 |
| `--arch-bg` | `var(--surface-2)` | 同 | 行底（保留，仅作层次，不承担区分） |

**对比度实测（本人复算）**

| 配对 | light | dark | 判定 |
|---|---|---|---|
| `--arch-bd` vs 面板底 `--surface` | **3.64:1** | **3.83:1** | **≥3:1 ✅（余量 21%/28%）** |
| `--arch-bd` vs 行底 `--surface-2` | **3.51:1** | **3.50:1** | **≥3:1 ✅（余量 17%/17%）** |
| `--arch-fg` vs 行底 `--surface-2` | **7.16:1** | **6.56:1** | 文字 ≥4.5:1 ✅ |
| 对照：活跃行 `--fg` vs `--surface-3` | 16.29:1 | 11.86:1 | 层级差成立 ✅（归档 7.16/6.56 明显退后） |

> **三重区分（不靠颜色）**：① **虚线边框**（活跃行无边框）；② **归档图标**（`.ar-ico`，活跃行无）；③ **操作集不同**（归档行=恢复/删除，活跃行=选中/更多）。转灰后三者全部保留。

**点击行为（零重命名）**：`data-archived` 钩子名保留；守卫用 `!== 'true'`（`app.js:427/473`，本轮实测已修）。归档行**非按钮区不触发选中会话**，只有「恢复」「删除」可点。

### 1.3 三态 run / wait / fail（VIS-03 / 04 / 05）

> **实测**：`--st-*` 色令牌已落地（`index.html:58-66 / 107-115`），但 **`data-st` 与形状编码 0 处施工**。本轮补形状规格。

#### 1.3.1 🔴 为什么"不能只靠颜色"——实测证据

把三态色**转灰（取相对亮度）后两两对比**：

| 状态对 | light 灰度对比 | dark 灰度对比 |
|---|---|---|
| run ↔ wait | 1.43:1 | 1.14:1 |
| wait ↔ fail | 1.33:1 | 1.17:1 |
| **run ↔ fail** | **1.08:1** ⚠️ | 1.33:1 |

> **light 主题下 run(绿) 与 fail(红) 转灰后只差 1.08:1 —— 实质上是同一个灰点。** 这就是"三态必须补形状"的**量化理由**，不是审美主张。

#### 1.3.2 形状规格（内联 SVG，禁用字体字形）

> **沿用既有铁律**（既有设计系统 §B.2 已实测）：`⏸ ⏳ ❚ ⊘ ⚠` 在本机字体栈**缺失或落 Apple Symbols/彩色 emoji** → **状态图形一律内联 SVG**。既有 SVG 契约：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"`。

| 状态 | `data-st` | 颜色令牌 | **形状（静态可辨，不依赖动画）** | SVG 结构断言 |
|---|---|---|---|---|
| 运行 | `run` | `--st-run`(=`--ok`) | **实心圆 + 同心外环**（双 circle） | `circle` 数 = 2，其一 `fill="none"` |
| 等待 | `wait` | `--st-wait`(=`--muted`) | **空心环**（单 circle，无填充） | `circle` 数 = 1 且 `fill="none"` |
| 失败 | `fail` | `--st-fail`(=`--danger`) | **实心圆 + 内嵌 ×** | `circle` 数 = 1 有填充 **且** 含 `path`（×） |

```html
<span class="st-dot" data-st="run" aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="8.2" fill="none"/>
  </svg>
</span>
<!-- wait: <circle cx="12" cy="12" r="6.4" fill="none"/> -->
<!-- fail: <circle cx="12" cy="12" r="6.6" fill="currentColor" stroke="none"/>
           <path d="M9.3 9.3 14.7 14.7 M14.7 9.3 9.3 14.7" stroke="var(--st-dot-ink)" stroke-width="1.8"/> -->
```

| 令牌 | 值 | 说明 |
|---|---|---|
| `--st-dot` | `12px` | 状态点外框（≥12px，内嵌 × 才看得清） |
| `--st-dot-stroke` | `1.8` | 描边宽（沿用既有图标 1.8） |
| `--st-dot-ink` | `var(--surface)` | × / 内嵌标记的**底色**（画在填充圆上） |
| `--st-pulse-dur` | `1600ms` | 运行态外环脉冲周期（**仅装饰增强**，去掉不影响识别） |

**对比度实测**

| 配对 | light | dark | 判定 |
|---|---|---|---|
| `--st-run` vs `--bg` / `--surface-2` | 5.19 / 5.00 | 8.82 / 7.48 | 非文字 ≥4.5 ✅ |
| `--st-wait` vs `--bg` / `--surface-2` | 7.43 / 7.16 | 7.74 / 6.56 | ✅ |
| `--st-fail` vs `--bg` / `--surface-2` | 5.58 / 5.38 | 6.62 / 5.61 | ✅ |
| `--st-dot-ink`(×) vs `--st-fail`(圆) | **5.58:1** | **6.14:1** | 内嵌标记 ≥3:1 ✅ |

**reduced-motion 降级**：外环脉冲 `animation:none` → **退化为静态"实心圆+外环"**，与 wait（空心环）、fail（实心圆+×）**形状仍三者互异**。这是本规格刻意的设计：动画只做增强，识别不依赖动画。（降级计数见 §2.1）

### 1.4 中窄断点 Sheet（RESP-03 / 04）

> **实测现状**：1279 档（`index.html:1429-1443`）把 `.drawer` 变 `position:fixed` 覆盖式，**但没有遮罩、没有焦点陷阱、没有 Esc**——用户看不到"我盖住了什么"，也无法用键盘退出。1023 档同理（1445-1451）。
> 既有遮罩资产：`.settings-overlay` = `oklch(24% 0.02 250 / .34)` + `blur(2px)` z-index **80**（`index.html:485`）；`.risk-scrim` = `/.38` + blur z-index **90**（`1177`）。**Sheet 应比这两个模态层更轻**（它可从工具栏反复开合）。

| 令牌 | light | dark | 用途 |
|---|---|---|---|
| `--sheet-scrim` | `oklch(24% 0.02 250 / .28)` | `oklch(0% 0 0 / .45)` | Sheet 遮罩（**轻于** 0.34/0.38 模态层） |
| `--sheet-scrim-blur` | `0px` | `0px` | **不加模糊**——Sheet 是高频开合面板，blur 会造成可感知的掉帧 |
| `--sheet-shadow-r` | `-10px 0 32px oklch(20% 0.02 250 / .14)` | `-10px 0 32px oklch(0% 0 0 / .5)` | 右侧 Sheet 投影（**单侧**，不用 `--shadow-2` 的四向） |
| `--sheet-shadow-l` | 上值取正 `10px` | 同 | 左侧抽屉投影 |
| `--z-sheet-scrim` | `30` | 同 | 遮罩层（**低于** Sheet 40，**高于**内容区最高 6） |
| `--z-sheet` | `40` | 同 | 既有值，保持（实测 `index.html:1435/1446`） |
| `--sheet-dur` | `var(--t-base)` = 160ms | 同 | 转场（复用既有动效档，不新增） |

**Z-index 实测全景（供核对，避免撞层）**：`6`（内容）/ `40`（Sheet，新增）/ `60,61`（气泡弹层）/ `70,71`（ask-pop）/ `80`（settings）/ `90`（risk）。新遮罩 `30` **不撞任何既有值** ✅

**交互契约**：≤1279 时右板 Sheet = **模态**（`role="dialog"` + `aria-modal="true"` + 焦点陷阱 + Esc 关闭 + 点遮罩关闭）；≥1280 恢复为非模态并移除 `aria-modal`。JS 判定 `matchMedia('(max-width:1279px)').matches`。
> ⚠️ 这条会**新增** `aria-modal`/`role`，只做**加法**，不删既有钩子。

### 1.5 底栏密度（VIS-02）

> **实测现状**：`.statusbar`（`index.html:215-231`）24px 高、承载面 `--surface-2`、`font-size:11.5px`、`gap: var(--sp-7)`(14px)、`padding: 0 14px`、数值已带 `tabular-nums`（225 行）。三项 = 沙箱态 / 事件数 / Tokens（`1778-1783`）。
> **实测缺陷**：`.sb-item[data-label]::before{color:var(--dim)}`（`index.html:228`）→ `--dim` 落在 `--surface-2` 面上，dark 实测 **4.47:1 < 4.5**，违反既有 A11Y-02 约束「`--dim` 不得用于 `--surface-2` 面」。

| 令牌 | light | dark | 用途 |
|---|---|---|---|
| `--sb-label` | `var(--muted)` `#52565a` | `#9fa5ac` | 项名（"事件"/"Tokens"）— **替换现状 `--dim`** |
| `--sb-value` | `var(--fg)` `#16191b` | `#e5e8ec` | 数值本体（**提级到 fg**，强化可读性） |
| `--sb-fs` | `11.5px` | 同 | 现状值固化，不改 |
| `--sb-gap` | `var(--sp-4)` = `8px` | 同 | 组间距（**从 14px 收紧到 8px**，提密度） |
| `--sb-item-gap` | `var(--sp-2)` = `4px` | 同 | 图标↔文字间距 |
| `--sb-num-min` | `6ch`（初值；若实际数值会超 6 字符，按实测上调，但**必须保持固定**） | 同 | 数值槽最小宽（防位数增长推动布局） |
| `--sb-num-feature` | `"tnum" 1, "lnum" 1` | 同 | 等宽数字 + 等高数字（**补齐** `font-feature-settings`，`tabular-nums` 在部分字体需显式开启） |

**对比度实测（修复前后）**

| 配对 | light | dark | 判定 |
|---|---|---|---|
| **修复前** `--dim` vs `--surface-2` | 4.87:1 | **4.47:1 ⚠️** | 不达标 |
| **修复后** `--sb-label`(muted) vs `--surface-2` | **7.16:1** | **6.56:1** | ✅ |
| `--sb-value`(fg) vs `--surface-2` | **17.07:1** | **13.23:1** | ✅ |
| 沙箱点 run/fail/wait vs `--surface-2` | 5.00 / 5.38 / 7.16 | 7.48 / 5.61 / 6.56 | 非文字 ≥3:1 ✅ |

**防跳动（可判定口径）**：数值用 `tabular-nums` + `font-feature-settings:"tnum" 1` + `min-width:var(--sb-num-min)` → 位数在 1→6 位内增长时 `#eventCount` 的 `offsetWidth` **变化次数 ≤1**（只在突破 6ch 时变一次）。

### 1.6 本轮令牌总表

| 组 | 前缀 | 条数 | 主题相关 | 性质 |
|---|---|---|---|---|
| 骨架屏 | `--sk-*` | 8 | 部分 | **新增** |
| 归档态 | `--arch-*` | 5 | 部分 | **新增**（色值全部别名既有 `--border-strong`/`--muted`，**零新色**） |
| 三态形状 | `--st-dot*` / `--st-pulse-dur` | 4 | 否 | **新增**（颜色沿用既有 `--st-*`，**零新色**） |
| 中窄 Sheet | `--sheet-*` / `--z-sheet*` | 7 | 部分 | **新增** |
| 底栏密度 | `--sb-*` | 7 | 部分 | **新增**（`--sb-label/value` 替换违规 `--dim`，**零新色**） |
| **合计** | — | **31 条 / 5 组** | — | **新增色值仅 2 个**（`--sk-block` light/dark），其余全为别名或尺寸 |

> **色彩克制自检**：31 条里**只有 `--sk-block` 引入了新色值**（骨架屏必须独立于一草木）。其余 29 条**全部别名既有令牌**或纯尺寸/时长。既有 oklch 双主题色板**零改动**。

---

## §2 「不得回退」清单

### 2.1 13 处 `prefers-reduced-motion`（实测行号，本轮重测）

```
index.html:445 600 640 694 727 781 820 1017 1132 1227 1230 1400 1413   （共 13）
+ 全局手动开关 html.reduce-motion（index.html:154-156）
```

> ⚠️ 既有设计系统文档写的是 `378/533/573/627/660/714/753/950/1065/1160/1163/1333/1346` —— **13 这个计数仍成立，但行号已全部漂移**，引用请以本表为准。

**本轮新增动效 = 4，故降级计数目标 = 13 + 4 = 17**

| # | 新增动效 | 降级规则 |
|---|---|---|
| 1 | 骨架屏扫光 `sk-sheen` | `.sk{animation:none;background-image:none}`（**静态块，不消失**） |
| 2 | 运行态外环脉冲 | `.st-dot[data-st=run] circle:last-child{animation:none}`（**静态实心圆+外环**） |
| 3 | 右板 Sheet 滑入（≤1279） | `transition:none`（直接显隐） |
| 4 | 左抽屉 Sheet 滑入（≤1023） | `transition:none` |

### 2.2 `aria-*` / `role=` 基线（本轮重测，口径已统一）

| 项 | 实测命令 | 实测值 | 门禁阈值 |
|---|---|---|---|
| `aria-*` | `grep -o -E 'aria-' src/renderer/index.html src/renderer/app.js \| wc -l` | **303** | **≥303** |
| `role=` | `grep -o -E 'role=' src/renderer/index.html src/renderer/app.js \| wc -l` | **31** | **≥31** |
| `prefers-reduced-motion` | `grep -c -E 'prefers-reduced-motion' src/renderer/index.html` | **13** | **≥17**（含本轮 +4） |

> ⚠️ **口径纠偏**：既有文档写 `aria-`=298 / `role=`=30，本轮按「出现次数」实测为 **303 / 31**，按「行数」实测为 **245 / 31**。**298 无法复现**。建议门禁统一为**出现次数**口径并取 **303**（更严，且当前即达标）。此项需 team-lead 确认后再改 `gate-manifest`——**本文不改门禁文件，只报数**。

### 2.3 冻结钩子（零重命名）

**38 个字面量 `data-*` 名**（`index.html` + `app.js`，167 处）：

```
data-act  data-archived  data-ask  data-branch  data-card  data-card-toggle  data-close
data-def  data-desc  data-doc-active  data-drawer  data-empty  data-folder  data-grp
data-id  data-label  data-live  data-max  data-min  data-model  data-msg-act  data-od-id
data-panel  data-perm  data-reduce-motion  data-sec  data-set-theme  data-sid  data-state
data-stream  data-switch  data-term  data-theme  data-tool-toggle  data-v  data-val
data-view  data-ws
```

**另有 4 个仅以 `dataset.*` 形式存在**（字面量 grep 命中 0，已单独验证）：`dataset.doc` / `.askId` / `.scope` / `.tokenized`。

> **本轮新增的钩子只允许做加法**：`data-st`（三态）、`data-sk`（骨架占位，可选）。**不得修改/删除上表任何一项**。

### 2.4 既有 oklch 双主题色板（冻结，逐项未改）

`:root`（`index.html:20-47`）与 `html[data-theme="dark"]`（`77-103`）中：`--bg/--surface/--surface-2/--surface-3/--fg/--muted/--dim/--border/--accent/--accent-fg/--accent-soft/--code-bg/--bubble/--term-bg/--term-fg/--hover/--ok/--danger/--warn` + 7 个 `--tk-*` diff 色 + `--shadow-1/2` + `--ease-out/spring` + `--t-fast/base/slow` + `--st-*` + `--border-strong` + `--statusbar-h/--tap-min/--titlebar-h/--rail-w` + 字体栈 `--font-display/body/mono` + `--sp-1..12` + `--r-1..7/pill/full` + `--t-instant` —— **全部保持，本轮零改动**。

**已登记的既有约束（不得违反）**：
1. `--dim` **不得用于 `--surface-2` 面**（dark 4.47:1 < 4.5）。
2. 交互控件描边**必须用 `--border-strong`**（3.64 / 3.83），**不得用 `--border`**（1.21 / 1.33）。
3. 状态图形**禁用字体字形** `⊘ ⏸ ⏳ ❚ ⚠`；安全集仅 `{✓ ✗ × ! ● ○}`；**一律优先内联 SVG**。
4. `--st` **不得作为自定义属性名新增**（已被 `.run-grid i` 的 `--st:0..7` 动画步进变量占用）。

---

## §3 原型视觉验收口径（可判定，供 Phase 4 质量审查）

> **原则**：每条都是**脚本可判定的布尔表达式**或**带阈值的数值**，不含"好看/协调/舒适"类形容词。
> 判定环境：Electron 窗口，视口 **1280×800** 与 **1024×768** 两档；**light / dark 双主题各跑一遍**。

### A 组 · 中窄适配（RESP-03 / 04）

| # | 断言 | 阈值 | 档位 |
|---|---|---|---|
| A1 | `document.documentElement.scrollWidth <= window.innerWidth`（无横向溢出） | 100% | 1280 / 1024 |
| A2 | `.stream` 的 `getBoundingClientRect().width` | **≥480px** | 1280 / 1024 |
| A3 | ≤1279 时 `getComputedStyle(drawer).position === 'fixed'`；≥1280 时 `!== 'fixed'` | 双档反向成立 | 1280 / 1024 |
| A4 | ≤1279 时 `getComputedStyle(gutter).display === 'none'` | true | 1024 |
| A5 | Sheet 打开时遮罩存在且 `opacity > 0`；点击遮罩后 Sheet 关闭 | 100% | 1024 |
| A6 | Sheet 打开时按 Esc 关闭；且 Tab 循环时 `document.activeElement.closest('.drawer') !== null`（焦点陷阱） | 100% | 1024 |
| A7 | `--content-max` 在 ≤1279 为 `none`（实测 `index.html:1442`） | true | 1024 |
| A8 | 输入区 `.composer` 在两档均**可见且未被折叠**（`offsetHeight > 0`） | 100% | 1280 / 1024 |

### B 组 · 底栏密度（VIS-02）

| # | 断言 | 阈值 |
|---|---|---|
| B1 | `#statusbar.offsetHeight === 24` 且 `getBoundingClientRect().bottom <= innerHeight` | 四档断点全过 |
| B2 | `#statusbar.scrollWidth <= clientWidth`（三项无裁切） | 1280 / 1024 |
| B3 | 数值项 `font-variant-numeric` 含 `tabular-nums` 且 `font-feature-settings` 含 `tnum` | 100% |
| B4 | `#eventCount` 数值从 1 位增长到 6 位（≤6 字符，**不加千分位**），`offsetWidth` 的**变化次数 ≤1** | ≤1 次 |
| B5 | `--sb-label` / `--sb-value` vs `--surface-2` 对比度 | **≥4.5:1**（实测 7.16/6.56 与 17.07/13.23） |
| B6 | 沙箱点三态（ready/down/wait）非文字对比 | **≥3:1**（实测 5.00/5.38/7.16 与 7.48/5.61/6.56） |

### C 组 · 三态修复（VIS-03 / 04 / 05）

| # | 断言 | 阈值 |
|---|---|---|
| C1 | 每个状态点带 `data-st`，SVG 带 `aria-hidden="true"`，**相邻有可见文字标签** | 100%（无"仅图标承载语义"） |
| C2 | **形状断言**：`[data-st=run] svg circle` 数 = **2**；`[data-st=wait] svg circle` 数 = **1 且 `fill="none"`**；`[data-st=fail] svg` 含 `circle`(有填充) **+ `path`** | 三态结构互异 |
| C3 | **灰度可辨**：三态截图转灰后，形状断言 C2 仍成立（即识别不依赖颜色） | 100% |
| C4 | **降级可辨**：`prefers-reduced-motion: reduce` 下 `run` 的 `animationName === 'none'`，且 C2 仍成立 | 100% |
| C5 | 内嵌 ×（`--st-dot-ink`）vs 填充圆对比度 | **≥3:1**（实测 5.58 / 6.14） |
| C6 | 状态点外框 `offsetWidth >= 12` | 100% |

### D 组 · 长列表窗口化观感（PERF-01）

| # | 断言 | 阈值 |
|---|---|---|
| D1 | 窗口外占位 `.sk` 存在且 `getComputedStyle().backgroundColor !== 'rgba(0,0,0,0)'` | 100% |
| D2 | **防跳动**：同一 index 的骨架 `offsetHeight` 与真实节点 `offsetHeight` **偏差 ≤2px** | 100% |
| D3 | **固定高度**：骨架高度**不随机**——同类（msg / card）骨架 `offsetHeight` 的**方差 = 0** | 方差 0 |
| D4 | `--sk-block` vs 承载面对比度落在 **[1.15, 1.45]** 带内 | 实测 1.23(light) / 1.31(dark) |
| D5 | 扫光周期 `animationDuration >= 1200ms` | 实测 1400ms |
| D6 | `prefers-reduced-motion` 下 `.sk` 的 `animationName === 'none'` **且** 背景色仍非透明（**不消失**） | 100% |
| D7 | 快速滚动 500 行，取一个已渲染锚点节点，`getBoundingClientRect().top` 的**累计异常位移 ≤4px**（排除正常滚动量） | ≤4px |

> D7 判定方法（避免"看着不跳"这种主观口径）：记录滚动前锚点相对 `.stream` 的 `offsetTop`，滚动后再次测量，**两次 `offsetTop` 差 ≤4px**。

### E 组 · 归档区（VIS-06）

| # | 断言 | 阈值 |
|---|---|---|
| E1 | `.arch-row` 的 `borderStyle === 'dashed'` | 100% |
| E2 | `--arch-bd` vs 行底 / vs 面板底对比度 | **≥3:1**（实测 3.51/3.50 与 3.64/3.83） |
| E3 | `--arch-fg` vs 行底对比度 | **≥4.5:1**（实测 7.16 / 6.56） |
| E4 | **非颜色区分**：归档行同时具备 ①虚线边框 ②归档图标 ③恢复/删除按钮；活跃行 `.session` 三者皆无 | 100% |
| E5 | **点击行为**：点击 `.arch-row` 非按钮区**不切换会话**；点「恢复」后该项从归档列表移除并出现在侧栏活跃列表 | 100% |
| E6 | `data-archived` 钩子名仍存在（`grep -c 'data-archived' >= 1`） | ≥1 |
| E7 | 灰度下 E4 的 ①②③ 仍全部成立 | 100% |

### F 组 · run 历史空态（GAP-03，⚠️ 硬阻塞）

| # | 断言 | 阈值 |
|---|---|---|
| F1 | run 历史视图渲染空态占位，结构与既有 `.settings-empty` 一致（图标 + `<p>` 说明） | 100% |
| F2 | **不可承诺功能**：占位内**不得**出现可点击的「重试 / 加载更多 / 跳转 run / 刷新」按钮（`querySelectorAll('button').length === 0`） | **=0** |
| F3 | 占位文案**明确说明原因**（含"尚未接入 / 暂无数据 / 内核无 runId 字段"语义），不写"加载中"等误导性进度语义 | 100% |
| F4 | 占位区可被读屏读到（`aria-hidden` 不为 `true`） | 100% |
| F5 | **阻塞复核**：`grep -c -w 'runId' src/events/index.ts` | **实测 = 0**；若该值 >0，须重新评估解锁（**本文不解锁**） |

### G 组 · 全局不回退门禁

| # | 断言 | 阈值 |
|---|---|---|
| G1 | `grep -o -E 'aria-' index.html app.js \| wc -l` | **≥303**（实测 303） |
| G2 | `grep -c -E 'prefers-reduced-motion' index.html` | **≥17**（实测 13 + 本轮新增 4） |
| G3 | `grep -o -E 'role=' index.html app.js \| wc -l` | **≥31**（实测 31） |
| G4 | §2.3 的 38 个 `data-*` 名**全部仍存在** | 38/38 |
| G5 | `:root` 与 `html[data-theme="dark"]` 均存在；§2.4 色板逐项**值未变** | 100% |
| G6 | 焦点环 `:focus-visible` 仍为 `2px solid var(--accent)` + `outline-offset:2px`（`index.html:151`） | 100% |
| G7 | **新增色值数量 ≤2**（仅 `--sk-block` light/dark） | ≤2 |

---

## §4 需求覆盖对照

| 需求 | 本文落点 |
|---|---|
| **RESP-03** 右板窄档转覆盖式 Sheet、主区 ≥480 | §1.4（Sheet 令牌 + 交互契约）+ §3 A1/A2/A3 |
| **RESP-04** 窄档取消拖拽、改覆盖式开合 | §1.4（`--z-sheet*`、`--sheet-dur`）+ §3 A4/A5/A6 |
| **VIS-02** 底栏三项信息密度 | §1.5（7 条 `--sb-*`，含修复 `--dim` 违规）+ §3 B1–B6 |
| **VIS-03/04/05** 三态形状区分 | §1.3（形状规格 + 灰度实测证据 1.08:1）+ §3 C1–C6 |
| **PERF-01** 窗口化观感（骨架屏/防跳动） | §1.1（8 条 `--sk-*`）+ §3 D1–D7 |
| **VIS-06** 归档行区分与点击行为 | §1.2（5 条 `--arch-*`，虚线为形状编码）+ §3 E1–E7 |
| **GAP-03** run 历史空态（硬阻塞） | §0.4（阻塞复核）+ §1.x 无新增 + §3 F1–F5（**不含可用功能**） |
| 不得回退 | §2.1（13 处降级 +4）/ §2.2（303/31）/ §2.3（38 钩子）/ §2.4（色板冻结） |

---

## §5 复算方法与命令（可复现）

**对比度链路**：`oklch(L,C,H)` → OKLab(`a=C·cosH, b=C·sinH`) → LMS → **linear sRGB**（Ottosson 矩阵）→ 钳制 → WCAG 相对亮度 `0.2126R+0.7152G+0.0722B` → `(L₁+.05)/(L₂+.05)`。

**⚠️ 本次复算踩到的坑（记录在案，避免后人重犯）**：第一版脚本在 `lum()` 里对 linear 值又做了一次 **gamma 编码**（`srgb()`），导致 `#16191b vs #ffffff` 算出 **7.24:1**（正确值 **17.71:1**）。自检项 `oklch(100% 0 0) → #ffffff` 通过了但**发现不了这个 bug**——因为白对白恒为 1:1。**有效自检必须是一个已知的非平凡值**。修正后用两条独立路径交叉验证：oklch 路径 **17.71** vs hex 路径 **17.66**（差值来自 hex 量化），链路确认无误后才采信。**WCAG 亮度必须用 linear sRGB，不能用 gamma 编码值。**

**基线复核命令（本轮实测值来源）**

```bash
cd "/Users/ze/Downloads/deepseek harness"

# 行数
wc -l src/renderer/index.html src/renderer/app.js src/events/index.ts
# → 1969 / 2371 / 707

# reduced-motion（13）
grep -n -E 'prefers-reduced-motion' src/renderer/index.html

# aria / role（按出现次数：303 / 31）
grep -o -E 'aria-'  src/renderer/index.html src/renderer/app.js | wc -l
grep -o -E 'role='  src/renderer/index.html src/renderer/app.js | wc -l

# 冻结钩子（38 个名字 / 167 处）
grep -ho -E 'data-[a-z0-9-]+' src/renderer/index.html src/renderer/app.js | sort -u | wc -l
grep -o  -E 'data-[a-z0-9-]+' src/renderer/index.html src/renderer/app.js | wc -l

# GAP-03 阻塞（全 0 / 全 0 / 全 0 / 仅 3 处且为会话 id 别名）
grep -rn -w 'runId'  src/events/index.ts
grep -rn -w 'run_id' src/
grep -rn -w 'runID'  src/
grep -rn -w 'runId'  src/

# 骨架屏现状（空）
grep -n -E 'skeleton|shimmer' src/renderer/index.html src/renderer/app.js

# 断点（四档已落地）
grep -n -E '@media' src/renderer/index.html
```

---

## 硬约束自检

| 约束 | 自检 |
|---|---|
| 不改 `src/` | ✅ 本轮只写本 md |
| 不换设计系统 / 色板 / 字体 / 组件库 | ✅ §0.1–0.2 交叉校验后沿用；31 条新令牌中 **29 条为别名或尺寸**，新增色值仅 2 个 |
| 不照抄 Tech Utility 霓虹绿色板 | ✅ §0.2.1 明确列为禁区 |
| 对比度全部独立复算 | ✅ §1.1/1.2/1.3/1.5 各表，脚本见 §5，含 bug 复盘 |
| 状态不单独依赖颜色 | ✅ §1.3.1 给出量化证据（run/fail 灰度 1.08:1）+ §1.3.2 形状规格 + 降级后仍可辨 |
| 归档态 ≥3:1 | ✅ §1.2 实测 3.51/3.50（vs 行底）、3.64/3.83（vs 面板底） |
| 钩子零重命名 | ✅ §2.3 全量枚举 38 + 4；本轮只做加法 |
| 无障碍不回退 | ✅ §2.1（13+4=17）/ §2.2（303 / 31）/ §2.4（4 条既有约束） |
| 不承诺 GAP-03 可用功能 | ✅ §0.4 阻塞坐实；§3 F2 断言"按钮数 = 0" |
| 数值自己复算 | ✅ 全部 `grep` / `node` 复算；行号/计数与既有文档的偏差已在 §0.3 逐条标注 |
