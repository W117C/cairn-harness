> **⚠️ 存档（2026-09-18 裁定）**：本文降为存档，**不可直接施工**，且**范围自限于 A 类**（肉眼可见），B 类不在本文——不可当全量权威（包亦不完整：仅 `02`/`04`/`05`，无 `00`/`01`/`03`）。
> **两条自报数已被复测推翻**：C4 reduced-motion 自报 13→**17**，实为 **13**（`docs/ui-fact-baseline.md` F15）；C6 自报新增 z-index **30**/40，实测档位 **6/40/60/61/70/71/80/90，无 30**（F17）。**两面权威**：意图 = `agent-plan.md` §10.1；事实 = `docs/ui-fact-baseline.md`。正文一字未改。

# 质量审查报告 · 桌面端 P1→P2 优化 · Phase 4 原型（2026-09-17）

> 审查官：严过审（Yan）
> 对象：`outputs/desktop-optimize-2026-09-17/prototype/core.html`（75KB / 1368 行）· `longlist.html`（52KB / 1034 行）
> 实测基线：headless Chrome 1320×1000 / 1280×800，CDP + 真实截图（每像素都自己取，不采信作者自评）
> 探针脚本：`scripts/tmp-critique-probe.ts`（约 530 行），结果落 `/tmp/critique-probe.json`，截图 `/tmp/critique-core-*.png` `critique-longlist-*.png`
> 验证纪律：色板逐项与 `src/renderer/index.html:15-138` 比对一致；状态 SVG 用真实灰度截图比对（非作者结构断言）；节点数 / DOM 高度 / 对比度 / reduced-motion 行为全部由 CDP 直接读 computed style 与像素

---

## §0 结论

| 维度 | 评分 | 评语 |
|---|---|---|
| 设计哲学 | **4 / 5** | 「Tech Utility 行为 + Modern Minimal 色板」混合体路线清晰、单一钢蓝、未引入新色板、未引入渐变 / 毛玻璃 / 圆角色块；不靠颜色区分的形态守则（虚线归档边 / 三态形状 / 内联 SVG 状态点）落地 |
| 视觉层次 | **4 / 5** | S1 三栏、S2 收窄 + Sheet 覆盖、S4 归档并置比对、longlist 6 项指标条为屏面之王——每屏意图都立得住；侧栏 active 行用 2px 强调框而非色彩加深，层级一致 |
| 执行质量 | **3 / 5** | **存在 4 个可实测复现的代码级 bug**（见 §2 P0），作者自评里有 3 个没标记 |
| 特异性 | **5 / 5** | 内容是 `bus.ts:88` / `app.js:1087` / `emit()` 交错派发 / `chore/tw4` 等真实仓库路径与历史；不是「Feature one / Feature two」；没有编造统计数字（PERF-01「冻结主线程 90s」标了**真实门禁实测值**） |
| 克制 | **4 / 5** | 单 accent、零渐变、无毛玻璃、无 emoji-as-icon（除 `.browser-bar` 里模仿 Chrome 地址栏锁头的 🔒，一处边界）、同字号 11.5–13.5 一档；S1 末尾塞了三块可见 `.sk` 算装饰冗余 |

**总分 20 / 25 ｜ 维度全部 ≥3 ｜ P0 = 4 个（不通过）｜ P1 = 8 个（不通过）**
**结论：REVISE。** 须修 4 个 P0 + 至少 3 个 P1 后才能动产品代码。

---

## §1 五维度复算证据（不复算请不要采信）

### 1.1 设计系统合规性（逐项 vs `02-design-tokens.md` + `src/renderer/index.html`）

- 钢蓝 `--accent: oklch(48% 0.13 247)` light、`oklch(76% 0.12 250)` dark 与冻结值**逐字节一致**
- oklch 双主题色板全部未改（脚本逐项读 computed style 验证，22 项令牌 light+dark 全过）
- 新增色值仅 `--sk-block`（light `oklch(93% 0.005 250)` / dark `oklch(30% 0.016 250)`）—— 满足 §G7「≤2」
- 冻结钩子零改动（`data-archived` / `data-st` 仅做加法）
- 状态图形全部内联 SVG，未用 ⏸ ⏳ ⊘ 等字体字形
- ❌ **约束 #1 「`--dim` 不得用于 `--surface-2` 面」被违反 3 处**（dark 实测 4.47:1 < 4.5）：
  - `core.html:433` `.cmp-list li::before{color:var(--dim)}`（父 `.cmp-col` bg=`--surface-2`）
  - `core.html:457` `.settings-empty svg{color:var(--dim)}`（`.settings-empty` bg=`--surface-2`，22px 图标）
  - `longlist.html:176` `.tb-sub{color:var(--dim)}`（`.titlebar` bg=`--surface-2`，文本）

### 1.2 复核作者关键数字（独立探针结果）

| 作者说法 | 作者数字 | 我实测 | 判定 |
|---|---|---|---|
| ±5 默认达标 | 167 | **114–246（中位 190），41/41 位置 ≤300** | ✅ 数字区间真实，作者单点取值偏乐观 |
| ±20 超标 | 540 | **329–616（中位 561），41/41 位置 >300** | ✅ 数字站得住；**而且 min 也 >300，没有任何位置达标** |
| ±60 | 1559 | **779–1670（中位 1528）** | ✅ |
| D7 锚点漂移 | 0.00px | mDrift 文本 0.5px（不同轮次不同，量级一致） | ⚠️ **见 §2 P1-6** —— 这是被代码构造性保证的（`stream.scrollTop = top + delta`），不是无补偿下的真实漂移 |
| D2 骨架 vs 真实偏差 ≤2px | 「应为 0px」 | **实测 max = 15px**（i=3112: sk 255 vs real 270） | ❌ **不达标**。根因：skeleton 高度 = `H[i] - 12`，而 `H[i]` 是 fill 瞬间的估算值，水合后才有真实值 |
| 单行最大估算误差 | 16.6px | mEst 红字 19.4px（不同次实测 10.9→19.4） | ✅ 同一数量级 |
| 首屏 40ms（其中 35ms 行高校准） | 40ms / 35ms | 25.9ms / 21.7ms（含双 rAF + 强制布局） | ✅ 同量级 |
| 稳态单帧 | 0.1ms | 0.8ms（取双 rAF 后第一帧） | ✅ 同量级 |
| 归档行 vs 面板底对比 ≥3:1 | ≥3:1 | light 3.62 / dark 3.83 | ✅（`--arch-bd` 实测 `[131,135,139]` light 与 tokens 文档对齐） |
| 三态灰度 run/fail | 1.08:1 light | run-gray=108.9 vs fail-gray=103.9 | ✅ 转灰后**亮度差 5**，肉眼可分（但要靠形状，不靠亮度） |
| 三态真实截图互异（结构断言） | 真截图转灰未做 | **真截图 4× 像素比对**：run vs fail meanAbsDiff=62.94（35.7% 像素差 >25）；run vs wait =59.64；wait vs fail =37.97。**三态结构互异成立** | ✅ |
| run 历史空态 button = 0 | 0 | 0 ✅ | ✅ |

---

## §2 问题清单

### P0（必须修复，阻断动产品代码）

#### P0-1 · `longlist.html` 行高校准盒宽度与真实渲染行宽度不一致 48px → 估算系统性偏低

**探针实测**：

```json
"ll_calibration": {
  "spacerClientW": 920,
  "renderedRowW":  872,   ← 真实渲染行（.row { left:24px; right:24px }）
  "calboxW":      920,   ← 校准盒
  "deltaPx":      48
}
```

**根因**：`init()` 里 `calbox.style.width = (spacer.clientWidth || 872) + 'px'`，但 `calbox` 内的 `measureRow` 设 `d.style.position='relative'` → 子行占满 calbox 全宽（920px）；真实渲染的 `.row` 是 `position:absolute; left:24px; right:24px` → 实际宽度 872px。**校准样本的文本容器比真实行宽 48px ≈ 5.2%，导致「同一字符数换行更少」→ 行高被低估**。骨架占位与真实高度间这部分偏差虽会被水合后 `H[i] = node.offsetHeight` 替换掉，但**初始的 12 次校准样本全跑在错误宽度上**，是 `mEst` 经常红字的根因之一。

**修复**：把 `calbox` 的可见宽度设置改为

```js
calbox.style.width = (spacer.clientWidth - 48) + 'px';
// 或更稳：
calbox.style.cssText = 'position:fixed;left:-30000px;top:0;visibility:hidden;width:' + (spacer.clientWidth - 48) + 'px';
```

> 这是用户在提示里要求的「第三条路」之一：**不定高问题的正确解法不是加大缓冲，而是让估算本身收敛**。

#### P0-2 · `longlist.html:460` 重复闭合标签 `</ul>`

**实测**：`grep -n -E '</ul>' longlist.html` → 行 459、460 双 `</ul>`，line 460 是多余的（在 `</ul>` 之后再一个 `</ul>`）。

**修复**：删 line 460。

#### P0-3 · `--dim` 用于 `--surface-2` 面的 2 处文本 + 1 处图标（dark 4.47:1 < 4.5）

**实测对比**（脚本 `core_contrast`）：

| 位置 | 元素 | 父底色 | light 对比 | dark 对比 | 状态 |
|---|---|---|---|---|---|
| `core.html:433` | `.cmp-list li::before` (`·` 文本) | `--surface-2` | 4.88 | **4.47** | P0 |
| `core.html:457` | `.settings-empty svg`（22px 图标，非文本） | `--surface-2` | 4.88 | **4.47** | P1（图标非文本但与约束冲突） |
| `longlist.html:176` | `.tb-sub`（副标题，文本） | `--surface-2` | 4.88 | **4.47** | P0 |

**修复**：

- `core.html:433` 改为 `color:var(--muted)` 或 `color:var(--dim)` 但放在 `.cmp-col` 改成 `var(--surface)` 底
- `longlist.html:176` 改为 `color:var(--muted)`（dark 6.53:1 ≥ 4.5）
- `core.html:457` 改为 `color:var(--muted)`（图标非文本 3:1 即可，但「`--dim` on `--surface-2`」是文档明文约束，按约束修）

#### P0-4 · D2 「骨架 vs 真实节点偏差 ≤2px」在 `逐行已知高度` 模式下不成立

**实测**（脚本 `ll_skeleton`）：

```
d2MaxDiff: 15
d2Samples:
  i=3111: sk=126, real=117, d=9
  i=3112: sk=255, real=270, d=15
  ...
reproducibilityMaxDiff: 15   ← 同一 index 两次滚回骨架高度也差 15px
```

**根因**：`fill(node, i, true)` 把 `H[i] - 12` 写进 `.sk` 内联 height，但 `H[i]` 是 fill 瞬间的**估算值**；水合（16ms）后 `render()` 才把 `H[i] = node.offsetHeight`（实测值）写回。骨架总比真实早 ~1 帧存在，**它必然继承估算误差**。`±0.42px 平均 0.50px 单行最大 16.6px` 的数字直接等于 D2 的下界。

**作者自评写「D2 应为 0px」是错的**。修法三选一：
- **A**（推荐）：放宽 D2 阈值为「|skeleton - real| ≤ maxEst 估算误差（≤20px）」，并在 `tokens` §1.1 把 `--sk-h-*` 注释从「须按真实 .msg 实测校准」改为「= 估算行高，由首屏行高校准保证 ≤20px」
- **B**：fill 前先做一次 `requestAnimationFrame` 等真实行先排版过、再把 `H[i]` 替换为实测——成本：首屏 +1 帧
- **C**（最差）：真上「卡片注册表 / 已知高度」，但需逐行校对数据，超出原型范围

> 这是用户问的第三条路在**度量层面**的正确答案：**P1 口径的 300 / 2px 是估算精度的函数，不是不等高列表的函数**。

---

### P1（建议修复，影响产品代码落地）

#### P1-1 · 三态在侧栏会话行 / AI 行无相邻文字标签 → C1 不达标

**实测**（`core_states`）：侧栏 `.session .st-dot[data-st="run"]` 周围唯一可见文字是会话标题与「main · 2 分钟前」，**没有任何 run/wait/fail 文本**。`aria-hidden="true"` 在 dot 上 → 屏幕阅读器完全读不到状态。

**修复**：在 `.session` 行内追加

```html
<span class="sr-only" data-st-label>运行中</span>
```

由 `sbDataST` 同时映射文本。`longlist.html` 的 `.ai-meta` 同理（`<span style="color:var(--dim)">#1</span>` 不是状态）。

#### P1-2 · A3 「`drawer.position === 'fixed'`」在原型里不成立 → 跑门禁必假阳性

**实测**：`S2 drawer.position === 'absolute'`（作者自报、用容器内定位避免 fixed 逃逸；`.shell` 是 `display:flex` 而非 `transform` 容器，fixed 不会逃但作者为了断点可控选了 absolute）。

**修复**：在 `02-design-tokens.md` §3 A3 旁加备注：「原型阶段用 `absolute` 视觉等价；真机走 `fixed`；判定口径改为 `position !== 'static'`（窄档）」或保留严格 `=== 'fixed'` 但在真机交付物里断言。

#### P1-3 · `longlist.html` 报告「快滚 80 帧 80/80 出现骨架」→ 我独立复测 = 77/80（几乎一致），但需说清这是「≈1 帧闪烁」不是「可读占位」

**实测**（`ll_sk_visibility`，单 rAF 探针）：80 步中 77 帧存在 `.row.is-sk`，最多同时 11 行。**单帧存活时间 = 水合延迟 = 16ms ≈ 1 帧**。

**含义**：在 16ms 同步延迟下，骨架本质是**闪烁**（perceptual 1-frame flash），不是持续可读占位。**作者自评第 3 条「骨架屏在快滚时可见」写成「成立」**误导了读者——它能看见，但看不见内容。

**修复**：
- 文档诚实标注：「默认 16ms 下骨架只闪过 1 帧，不构成占位；要可读占位需把 delay 提到 ≥80ms」
- 或把默认 delay 提到 80ms，并接受 DOM 节点会因 schema 降低而 ±5 缓冲有可能顶到 300+

#### P1-4 · `longlist.html` `mEst` 红字 19.4px 与 §3 D2 验收口径冲突

`02-design-tokens.md` §3 D2 = ≤2px，但 `ll_baseline.mEst = 19.4px`（红字）。**两者在同一文档里互斥**。

**修复**：要么改 §3 D2（见 P0-4 修法 A），要么把 mEst 阈值改为 ≤20px 并把 `--sk-h-*` 注释对齐。

#### P1-5 · `longlist.html` 滚动条长度随滚动变化（自评未提）

**实测**：`contentHStart 1346830 → contentHEnd 1347920`（sweep 后 +0.08%）；快滚 80 × 900px 后 `contentHEndAfterFastScroll 1357850`（+0.77%）。**总内容高在用户滚动的过程中会增长** → 滚动条 thumb 长度在变。绝对值只有 1 万分之一，但属于「可见的」变化。

**修复**：在自评面板加一行「代价 7：滚动条长度随滚动轻微变化（≈0.8%，用户基本不可见但确存在）」。

#### P1-6 · D7 0.00px 是被代码构造性保证的，不是无补偿下的真漂移

`render()` 里 `stream.scrollTop = Math.max(0, top + delta)` 之后才量 `drift = |(OFF[anchor] - scrollTop) - relBefore|`。所以 **drift ≤ |delta| 是恒等式**，再被补偿消去 → 0.00px 不是「无漂移」的证明，是「补偿生效」的证明（也证明了补偿正确，但不可作为「无跳」的唯一证据）。

**修复**：补一个独立测试：从顶部直接跳到中段，量「未补偿情况下的视觉跳」——把 `delta` 计算旁路掉，量 `OFF[anchorIdx] - top` 与 hydration 后 `OFF[anchorIdx] - newScrollTop` 之差。我做了**边缘测试**（跳到 1.2M 再回 0）：`topRowRelBefore=24px` → `topRowRelAfter=24px`，0 跳变，**符合预期**。但仍未测中段。建议把这个补到 §3 D7 旁注。

#### P1-7 · 窗口化 buffer 选择 ±5 vs ±20 实质上「二选一」，没有第三条路的工程化选项

**实测**：±5 在 41/41 位置 ≤300；±20 在 41/41 位置 >300（min=329）。**两个选项在当前 P1 阈值下不交叠**。作者默认 ±5，承认快滚可能空白。

**用户提示要的第三条路评估**：

- **±10**（线性内插）估算 ≈ 220–430（min 也 >200），**在当前 300 阈值下大概率超标**。不可行
- **预校准 + 卡片注册表**（已知高度而非估算）：**这是 P0-4 修法 A** 的延伸，是真正的第三条路。但需要逐行校对数据，是数据契约工作，超出原型范围
- **DOM 节点预算调整到 400**：能 ±10 → 190–350（部分位置超标），未彻底解决

**诚实结论**：作者对 ±5 vs ±20 的取舍是**正确的、诚实的、且穷举尽了原型能动的手**。但**应明确告知用户**：要么接受「快滚空白 + DOM ≤300」（默认），要么放开 DOM 上限到 400 才能用 ±10 让空白面积减半。这是**门禁阈值层的政策决定**，不是原型责任。

#### P1-8 · 骨架 `.sk` 占位块在 `core.html` S1 主区**可见**（不应可见）

`core.html:700-702` 在 S1 主区消息流末尾塞了三块 `.sk .sk-msg` / `.sk-msg` / `.sk-line`，配合 `pn` 注释「窗口外占位骨架」。**但 S1 主区没滚动**，这三块就在视口里——评审时**会被误读为「产品状态」**。

**修复**：要么移到 `.pn` 注释后用 `<details>` 折叠；要么只渲染 `.pn` 注释、占位块用 `<template>` 隐藏。

---

### P2（可选，锦上添花）

- 🔒 emoji 用于 `.browser-bar`（core.html:747/932）— 一处边界，模仿 Chrome 地址栏
- `⌕` 搜索字符（core.html:575）— 字体字形依赖，换字体可能 fallback 到「?」
- `✕` 关闭（core.html:910）— 安全集内、可接受
- `<button class="s-more">` 嵌套在 `<div role="button" tabindex="0">` 内（a11y 反模式）— 应改成 `<button class="session-row">` 整行作为 button
- `core.html:226` 双声明 `overflow:hidden;overflow:clip` — 保留 `hidden` 作 fallback 是有意为之，但注释误导读者
- longlist.html `stream.scrollTop` 在 scroll 事件里被 `render()` 改写 → 与 macOS 触控板惯性滚动可能打架——已通过 `Math.max(0, ...)` 钳制，最坏情形是顶部到底部之间 1 帧的 stop-then-jump。可后续在 production 用 `requestAnimationFrame` 串接

---

## §3 Anti-Slop 检查表

| P0 项 | 检查 | 命中 |
|---|---|---|
| 紫色/彩虹渐变 | grep 无命中 | ✅ |
| 编造统计/虚假证言 | 无；只有真实仓库路径 | ✅ |
| 通用 emoji 代图标 | 仅 1 处（🔒），其它全内联 SVG | ✅ 边界 |
| 圆角卡片 + 左侧彩色边框 | `.session[aria-current="true"]` 用 `box-shadow:inset 2px 0 0 var(--accent)` —— **有条件地**用 accent 2px 边，不是 AI 套路；归档行用 `dashed` 形状而非色块，**不依赖颜色** | ✅ |
| 手绘 SVG 人物 | 无 | ✅ |
| 文本对比度（WCAG AA） | 全部 ≥4.5:1，dark `--dim on --surface-2` 4.47:1 是**唯一**不达 | ⚠️ P0-3 |
| 完整响应式 | S1/S2/S4 三档，longlist 1280×800 | ✅ |

| P1 项 | 检查 |
|---|---|
| Inter 作展示字体 | 用 `-apple-system` / `SF Pro` / `PingFang` 系统栈，未引入 Inter ✅ |
| 过多圆角阴影 | 圆角 4–16px 单档；阴影 2 级 ✅ |
| 留白不足 | 信息密度符合 Tech Utility ✅ |
| 4+ 颜色同页 | 单 accent + 中性灰阶 ✅ |
| 动画 >0.3s 无降级 | sweep 1.4s / pulse 1.6s 都有 reduced-motion + reduced-motion class 双降级 ✅ |
| 段落 >75 字符 | `.msg p` 与 `.ai-text` 均未限宽；估计 ≥80 字符 ⚠️ P2（行高 LH=21.6 = 13.5×1.6 中文字约 40 字 / 行，可能超 75 char） |
| CTA 按钮一屏 >2 | `.cbox-foot` 一个 `.btn-primary` 发送；`.arch-row` 一行两按钮（恢复 / 删除）；`.ask-card` 三按钮（允许/拒绝/始终允许）—— `ask-card` 整卡三个按钮在视觉上一屏 1 卡不超，但滚动后可能 2+ 卡同屏 → 风险中 |

---

## §4 我对「±5 vs ±20」取舍的判断（回答 team-lead）

**作者是诚实的、穷举尽了、且取舍合理。**

但用户问「有没有被遗漏的第三条路」，我给的答案是 **「有，但不是加大缓冲」**：

1. **行高校准盒宽度修对**（P0-1）：48px 偏差会让所有估算偏 5%——修正后单行误差会从当前 16.6px 降到 ~5–10px，D2 立刻可达成 ≤10px 阈值的修订版
2. **卡片注册表 / 已知高度**（P1-7）：真正的第三条路，但要逐行校对数据，是数据契约工作，超出原型
3. **接受 DOM 上限从 300 调到 400**：能让 ±10 缓冲下节点数降到 200–350（部分位置超标），空白面积减半——这是**门禁阈值层的政策决定**，不是原型可决

**作者选择默认 ±5 + 文档诚实标注快滚空白 = 工程上正确的诚实决策。** 我**采信**这个取舍。**但**所有上面列出的 P0 必须修。

**最终判定：REVISE。** 修 4 P0 + 至少 3 P1（建议全修 P1）后重跑探针，确认 ±5 / 41 位置仍 ≤300 且 mEst 显著下降，方可进产品代码。

---

## §5 复算方法

```bash
# 启动探针（独立 headless Chrome + CDP）
node --import tsx scripts/tmp-critique-probe.ts
# → /tmp/critique-probe.json（约 11KB，全量结构化数据）
# → /tmp/critique-core-*.png（5 张）
# → /tmp/critique-longlist-{top,dark,note}.png（3 张）

# 静态交叉
grep -n -E '</ul>' outputs/.../prototype/longlist.html   # 双 </ul>
grep -n -E 'var\(--dim\)' outputs/.../prototype/*.html  # 3 处违规
grep -o -E 'aria-' src/renderer/index.html src/renderer/app.js | wc -l  # ≥303

# 对比度链路（关键 bug 复盘）
# oklch(L,C,H) → OKLab → LMS → linear sRGB → WCAG lum → (L1+.05)/(L2+.05)
# ⚠️ 不能用 gamma 编码值（design-tokens §5 踩过此坑）
```

**纪律声明**：本报告所有数字均为本人独立复算。脚本可重跑、截图可重看。`/tmp/critique-probe.json` 是单一事实来源——任何人发现数值冲突，先重跑探针，再回看代码，不要采信本报告内嵌的数字而无重跑。
---

## §6 复评（2026-09-17 · P0 修复后）

**判定：PASS。** 5 维 **4 / 4 / 4 / 5 / 4 = 21 / 25**（执行质量 3 → 4）。P0 = 0，P1 = 3（≤3）。

### 6.1 P0 四项复核

| P0 | 状态 | 证据 |
|---|---|---|
| #1 校准宽度 | ✅ **已修，且超出处方** | 见 §6.2 |
| #2 重复 `</ul>` | ✅ | `grep -n -E '</ul>'` 只剩 1 处（L463） |
| #3 `--dim` on `--surface-2` | ✅ | core 全文件 `var(--dim)` 命中 **0**；longlist 剩 L247/L744 均在 `--surface` 面，合规 |
| #4 D2 口径 | ✅ 判为诚实修正 | 见 §6.3 |

### 6.2 裁定一：`deltaPx` 指标错了，team-lead 判断正确

我原指标 `deltaPx = calbox容器宽 − 真实行宽 = 920 − 872 = 48`，**量的确实是外层容器**，容器本就该比行宽 48（`.row` 的 `left/right:24px`），**恒等于 48，与校准是否正确无关**。若固化成门禁会恒红。

已改为量**样本行实际排版宽度**（在 calbox 内造 `<div class="row">x</div>`，走与 `measureRow()` 完全同路径）：

```
sampleRowW: 872    renderedRowW: 872    sampleVsRealDelta: 0   ✅
legacy_deltaPx_containerMinusReal: 48   ← 旧指标，保留仅作对照
```

**修复有效，不是巧合。** 作者除去掉 `d.style.position='relative'` 外，还独立查出并修了 3 个我未指出的偏差源：
1. 2 点拟合 → **多点最小二乘** `fitN()`（换行是阶梯函数，2 点拟合把阶梯误差放大到近一行）
2. 采样区间 40..640 → **按真实数据范围** `rangeOf()`+`spread()`（user 实际 20..170、ai 26..298，长样本把拟合线拉偏）
3. 纯中文样本 → **复刻真实中英混排比例** `USER_SAMPLE/AI_SAMPLE`（纯中文比真实文本宽，系统性高估行数）
4. 新增运行时自检：样本宽 ≠ 真实行宽时 `console.warn`

结果 `mEst` 18.6 → **9.8px**，`d2MaxDiff` 15 → **10**。

### 6.3 裁定二：D2 口径变更是**诚实的修正**，不是变相放宽

独立实测把「已测行 / 未测行」分开量：

| 口径 | 实测 | 期望 | 判定 |
|---|---|---|---|
| 已测行（造访过→离开→快速回来） | **maxDiff = 0**（15 样本） | 0 | ✅ |
| 未测行（跳到从未造访区域） | **maxDiff = 10**（15 样本） | ≤20 | ✅ |
| 61 次 sweep 的 maxEst | **19.7**，破 20 次数 = **0** | ≤20 | ✅ 余量 1.5% |

判为诚实的四条理由：
1. **物理上真**：未渲染过的行不存在「真实高度」，原 D2 拿一个尚未定义的值当基准，是**断言本身病态**，不是实现偷懒（作者原话：「要压到 0 只能先渲染，那就失去窗口化意义」）
2. **界不是拍的**：20px ≈ 一个 line-height 21.6px，即换行取整量化的物理下限；实测 19.7 顶到界下沿，说明界取对了而非取松了
3. **先降数、后放宽**：作者没有改产物凑数，而是先修估算器让 15→10，**然后**才调口径
4. **主动加戏**：还补了我 P1-5 未强制要求的「代价 7：滚动条长度变化 ≈0.25%」

未测行 ≤20px 的残余跳动由锚定补偿吸收（`mDrift 0.0` / `pageDrift 0.6px` / `edge.growthPx 0`），不构成可见跳动。

### 6.4 剩余 P1 = 3（可接受，不阻断）

1. **longlist `.ai-meta` 三态仍 `aria-hidden="true"`**（L717 `stDot()`），无 `role="img"`/`aria-label` —— core.html 已补 8 个，longlist **未同步**。`.tool-item` 有「完成/失败/等待」文本故合规，但 `.ai-meta` 无状态文本 → C1 未全覆盖
2. **代价 3 仍写「80/80 帧出现骨架」**，未说明 16ms 延迟下骨架仅存活 ≈1 帧 = **闪烁**而非可读占位（我独立实测 79/80）
3. **core.html:718-720** S1 主区三块可见 `.sk` 未折叠/隐藏，评审时会被误读为产品状态（原 P1-8）

### 6.5 复算命令

```bash
node --import tsx scripts/tmp-critique-probe.ts   # → /tmp/critique-probe.json
# 关键字段：ll_calibration.sampleVsRealDelta（应为 0）
#           ll_d2_split.settled_maxDiff（应为 0）/ .fresh_maxDiff（应 ≤20）
#           ll_est_ceiling.maxEstObserved / .over20（应 =0）
```

**探针已永久修正**：`ll_calibration` 现输出 `sampleRowW` / `renderedRowW` / `sampleVsRealDelta`，旧 `deltaPx` 保留为 `legacy_deltaPx_containerMinusReal` 仅作对照，不得用作断言。
