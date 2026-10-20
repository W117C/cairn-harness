# Claude Desktop 设计令牌逆向报告

> 目标：Claude Desktop 2.42304.2（`/Applications/Claude.app`），从已解包的编译产物 CSS 中抽取完整可复用设计令牌体系。
> 所有数值均为**从文件实测抽取**，每条注明来源文件与声明原文。抽不到的已明确标注「未找到」。
>
> 来源文件简称（全文沿用）：
> - **MW** = `x/.vite/renderer/main_window/assets/MainWindowPage-DTxMhyWF.css`（251,081 B，压缩单行，tailwindcss v4.3.3 产物）
> - **SH** = `x/.vite/renderer/about_window/window-shared.css`（8,078 B，Tailwind v4 入口，每窗口 HTML 内联导入）
> - **LP** = `x/.vite/renderer/about_window/window-legacy-pins.css`（6,289 B）
> - **HTML** = `x/.vite/renderer/main_window/index.html`（9 KB）
> - **BW** = `x/.vite/renderer/buddy_window/assets/main-a4mzyXdA.css`
> - **CQ** = `x/.vite/renderer/main_window/assets/clawdQuestEngine-C2Z1JudX.css`
> - **FIP** = `x/.vite/renderer/find_in_page/assets/FindInPage-BLyCri-A.css`、`main-CiwjW8Wn.css`

---

## 0. 结论速览（最重要的 12 个数值）

| 令牌 | 亮色 | 暗色 |
|---|---|---|
| `--claude-background-color` | `#fcfcfb` | `#151515` |
| `--claude-foreground-color` | `black` | `white` |
| `--accent-brand`（HSL 分量） | `15 63.1% 59.6%` | `15 63.1% 59.6%`（**同值**） |
| `--cds-page-bg` | `var(--cds-surface-0)` → `--cds-gray-20` `#f9f9f7` | `--cds-gray-900` `#0b0b0b` |
| `--cds-border` | `var(--cds-alpha-2)`（neutral-900 @10%） | `var(--cds-alpha-2)`（neutral-900→gray-0 @10%） |
| `--cds-radius`（comfortable） | `.5rem` = **8px** | 同 |
| `--cds-h-control`（comfortable） | `2rem` = **32px** | 同 |
| `--cds-icon`（comfortable） | `1.25rem` = **20px** | 同 |
| `--spacing` | `.25rem` = **4px** | 同 |
| `--cds-ease-out` | `cubic-bezier(.165,.84,.44,1)` | 同 |
| `--cds-dur-snap` | `.12s` | 同 |
| `--cds-font-weight-semibold` | **580**（非常规） | 同 |

---

## 1. 颜色令牌

### 1.1 三套「亮/暗」机制并存 —— 必须先分清

这是本次抽取最重要的架构发现。CSS 里**同时存在三套不同的明暗切换机制**，极易混淆：

| 机制 | 载体 | 作用域 | 说明 |
|---|---|---|---|
| **A. CDS 模式系统** | `data-mode="dark"` / `"light"` / `"system"` + `.cds-root` | 组件层 | 现代令牌体系，`.cds-root` 基础块为**亮色默认值**；暗色由 `[data-mode=dark]` / `system`+媒体查询**覆盖** |
| **B. 遗留 claude.ai 调色板** | `:root` vs `.darkTheme` 类 | 文档层 | HSL 分量形式，`--accent-*` / `--brand-*` / `--bg-*` / `--text-*` |
| **C. 首帧 shell 色** | `@media (prefers-color-scheme:dark)` 内联样式 | body | `--claude-*`，仅两个变量 |

**关键结论（回答提问中的「哪块是暗色默认值」）：**

- **CDS 体系里，没有任何一块是「暗色默认值」。** `.cds-root{…}`（MW，464 条声明）是**亮色默认**；暗色是**纯覆盖块**，选择器为
  `@media screen{[data-mode=dark] .cds-root:not([data-mode=light]):not([data-mode=system]),.cds-root[data-mode=dark]{…}`
  （MW，字节偏移 186213），以及对应的 `@media screen and (prefers-color-scheme:dark){[data-mode=system] …,.cds-root:not([data-mode]):not([data-mode] *){…}}`（偏移 194952）和 `.cds-dark-scope[data-mode=dark]`（偏移 211072）。这三块内容**逐字节相同**。
- **`[data-mode=light]` 从不作为「定义暗色的反面」出现**：全文 29 处 `data-mode=light` 全部出现在 `:not([data-mode=light])` 否定式里，**没有任何一处 `[data-mode=light]` 块主动定义亮色令牌**——亮色就是不匹配的默认值。
- **`:root:not([data-mode=light])` 只在 MW 中出现 1 次**，且**不承载颜色令牌**，仅承载 3 个 pictogram 令牌：
  ```css
  /* MW */
  @media screen and (prefers-color-scheme:dark){:root:not([data-mode=light]){
    --cds-pictogram-highlight-default:var(--cds-gray-650);
    --cds-pictogram-highlight-heather:var(--cds-plum);
    --cds-pictogram-highlight-cactus:var(--cds-mineral)}}
  ```
  它的作用是给**文档根**（非 `.cds-root` 组件根）在暗色下也修好 pictogram 高亮色。
- **遗留体系里 `.darkTheme` 才是暗色**（SH:157-198 `.darkTheme{…}`），由 JS 在模块图加载完后加到 html 上（SH 注释：`windowBaseCore.ts only adds .darkTheme once its module graph has loaded`）。

### 1.2 中性色阶 `--cds-gray-*`（实测原值，来源：MW `:where(:root,:host)`）

这是**唯一一套硬编码 hex 的色阶**，全档 **35 级**（实测枚举：`0,10,20,30,40,50,60,70,80,90,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,810,820,830,840,850,860,870,880,890,900`），不随模式变化（模式只改 `--cds-neutral-*` 的映射方向）。

| 令牌 | 值 | 令牌 | 值 |
|---|---|---|---|
| `--cds-gray-0` | `#fff` | `--cds-gray-300` | `#a5a49a` |
| `--cds-gray-10` | `#fcfcfb` | `--cds-gray-350` | `#97958d` |
| `--cds-gray-20` | `#f9f9f7` | `--cds-gray-400` | `#898781` |
| `--cds-gray-30` | `#f6f6f4` | `--cds-gray-450` | `#7b7974` |
| `--cds-gray-40` | `#f3f3f0` | `--cds-gray-500` | `#6d6b67` |
| `--cds-gray-50` | `#f0efec` | `--cds-gray-550` | `#5f5e5a` |
| `--cds-gray-60` | `#edece8` | `--cds-gray-600` | `#52514e` |
| `--cds-gray-70` | `#eae9e4` | `--cds-gray-650` | `#454442` |
| `--cds-gray-80` | `#e7e6e1` | `--cds-gray-700` | `#383835` |
| `--cds-gray-90` | `#e4e3dd` | `--cds-gray-750` | `#2c2c2a` |
| `--cds-gray-100` | `#e1e0d9` | `--cds-gray-800` | `#20201f` |
| `--cds-gray-150` | `#d2d1c7` | `--cds-gray-810` | `#1e1e1d` |
| `--cds-gray-200` | `#c3c2b7` | `--cds-gray-820` | `#1c1c1b` |
| `--cds-gray-250` | `#b4b3a8` | `--cds-gray-830` | `#1a1a19` |
| | | `--cds-gray-840` | `#181817` |
| | | `--cds-gray-850` | `#151515` |
| | | `--cds-gray-860` | `#131313` |
| | | `--cds-gray-870` | `#111` |
| | | `--cds-gray-880` | `#0f0f0f` |
| | | `--cds-gray-890` | `#0d0d0d` |
| | | `--cds-gray-900` | `#0b0b0b` |

声明原文示例（MW）：`--cds-gray-0:#fff`、`--cds-gray-850:#151515`、`--cds-gray-900:#0b0b0b`

> **规律**（实测步进差分 `10×10, 50×14, 10×10`）：0→100 每 10 一档，100→800 每 50 一档，**800→900 每 10 一档**（810/820/…/890）。暗端加密是为了给深色背景分层。色相恒定暖灰（R>G>B），`#151515` 反而退化成纯中性（与窗口背景色 `#151515` 完全一致，是刻意的）。
>
> 已核对：其余 8 族（red/orange/yellow/green/aqua/blue/violet/magenta）**使用完全相同的 35 级阶梯**（脚本逐族枚举比对，全部 `SAME as gray`）。

### 1.3 `--cds-neutral-*` —— **模式无关语义色阶（本设计的精髓）**

`--cds-neutral-*` 不是新色，而是**指向 gray 色阶的指针**，在暗色下**整体翻转**。这是整套系统的核心抽象：`neutral-900` 在亮色是「最深」、在暗色是「最浅」，所以组件只写 `var(--cds-text-primary)` 就自动明暗。

**亮色（MW `.cds-root`，默认）**：`--cds-neutral-N: var(--cds-gray-N)` —— 恒等映射。

**暗色（MW 偏移 186213 覆盖块）**：`--cds-neutral-N: var(--cds-gray-（900-N 的镜像))`

| 令牌 | 亮（MW `.cds-root`） | 暗（MW `@media screen{[data-mode=dark]…}`） | 暗色实际 hex |
|---|---|---|---|
| `--cds-neutral-0` | `var(--cds-gray-0)` | `var(--cds-gray-900)` | `#0b0b0b` |
| `--cds-neutral-100` | `var(--cds-gray-100)` | `var(--cds-gray-800)` | `#20201f` |
| `--cds-neutral-200` | `var(--cds-gray-200)` | `var(--cds-gray-700)` | `#383835` |
| `--cds-neutral-300` | `var(--cds-gray-300)` | `var(--cds-gray-600)` | `#52514e` |
| `--cds-neutral-400` | `var(--cds-gray-400)` | `var(--cds-gray-500)` | `#6d6b67` |
| **`--cds-neutral-450`** | `var(--cds-gray-450)` | **`var(--cds-gray-450)`** | `#7b7974`（**翻转轴心，两模式同值**） |
| `--cds-neutral-500` | `var(--cds-gray-500)` | `var(--cds-gray-400)` | `#898781` |
| `--cds-neutral-600` | `var(--cds-gray-600)` | `var(--cds-gray-300)` | `#a5a49a` |
| `--cds-neutral-700` | `var(--cds-gray-700)` | `var(--cds-gray-200)` | `#c3c2b7` |
| `--cds-neutral-800` | `var(--cds-gray-800)` | `var(--cds-gray-100)` | `#e1e0d9` |
| `--cds-neutral-900` | `var(--cds-gray-900)` | `var(--cds-gray-0)` | `#fff` |

> **翻转规律：`neutral-N`（暗） = `gray-(900-N)`，唯一不动点是 450。** 脚本实测：35 个 neutral 令牌中，`light===dark` 的**只有 `--cds-neutral-450` 一个**（亮 `gray-450` / 暗 `gray-450`），即枢轴在 450 而非 500。
>
> ⚠️ **与 `out/00-master-evidence.md` 的冲突**：该文档 §1 称「中轴在 500 不动」（`neutral-500` → `gray-500`）。**本条实测不支持**——`--cds-neutral-500` 亮色 `var(--cds-gray-500)`、暗色 `var(--cds-gray-400)`，**是变的**；不动的是 450。同文档称 gray 为「35 阶」，与此处一致。建议以 450 为准（有逐键脚本比对为证）。

### 1.4 `--cds-alpha-*` —— 相对 current-neutral 的透明度阶（MW `.cds-root`）

用 CSS 相对颜色语法 `hsl(from …)` 从 `--cds-neutral-900` 取色相，只改 alpha。因为 neutral-900 在暗色翻成 `#fff`，**alpha 阶自动跟着反色**：

```css
/* MW .cds-root —— 亮色下 neutral-900 = #0b0b0b，暗色下 = #fff */
--cds-alpha-0: hsl(from var(--cds-neutral-900) h s l / 0%);
--cds-alpha-1: hsl(from var(--cds-neutral-900) h s l / 5%);
--cds-alpha-2: hsl(from var(--cds-neutral-900) h s l / 10%);
--cds-alpha-3: hsl(from var(--cds-neutral-900) h s l / 20%);
--cds-alpha-4: hsl(from var(--cds-neutral-900) h s l / 35%);
--cds-alpha-5: hsl(from var(--cds-neutral-900) h s l / 50%);
--cds-alpha-6: hsl(from var(--cds-neutral-900) h s l / 60%);
--cds-alpha-7: hsl(from var(--cds-neutral-900) h s l / 70%);
--cds-alpha-8: hsl(from var(--cds-neutral-900) h s l / 85%);
--cds-alpha-9: hsl(from var(--cds-neutral-900) h s l / 95%);
```

| 令牌 | alpha | 亮色等效（叠在 `#f9f9f7` 上，换算值） | 暗色等效（叠在 `#0b0b0b` 上，换算值） |
|---|---|---|---|
| `--cds-alpha-0` | 0% | 透明 | 透明 |
| `--cds-alpha-1` | 5% | ≈ `#f2f2f0` | ≈ `#171717` |
| `--cds-alpha-2` | 10% | ≈ `#ebebe8` | ≈ `#232323` |
| `--cds-alpha-3` | 20% | ≈ `#d7d7d3` | ≈ `#353535` |
| `--cds-alpha-4` | 35% | ≈ `#b6b6b2` | ≈ `#5a5a5a` |
| `--cds-alpha-5` | 50% | ≈ `#959591` | ≈ `#808080` |
| `--cds-alpha-6` | 60% | ≈ `#81817d` | ≈ `#999999` |
| `--cds-alpha-7` | 70% | ≈ `#6d6d69` | ≈ `#b3b3b3` |
| `--cds-alpha-8` | 85% | ≈ `#4c4c48` | ≈ `#dadada` |
| `--cds-alpha-9` | 95% | ≈ `#3a3a36` | ≈ `#f2f2f2` |

> 换算说明：亮色页背景取 `--cds-surface-0`=`--cds-gray-20`=`#f9f9f7`，暗色取 `--cds-gray-900`=`#0b0b0b`；alpha 合成 `result = base*(1-a) + fg*a`，fg 亮色 `#0b0b0b`、暗色 `#ffffff`。**这是近似值**，真值取决于实际叠放底色。

### 1.5 `--cds-blue-*`（实测，MW `:where(:root,:host)`）

用户点名要的 blue 族全档（另含 red/orange/yellow/green/aqua/violet/magenta 同构，共 **9 族 × 35 级**，阶梯完全相同；因篇幅只列 blue，其余族命名规则完全一致）：

| 令牌 | 值 | 令牌 | 值 | 令牌 | 值 |
|---|---|---|---|---|---|
| `--cds-blue-0` | `#fff` | `--cds-blue-300` | `#6da7ec` | `--cds-blue-800` | `#032042` |
| `--cds-blue-10` | `#fafcff` | `--cds-blue-350` | `#5598e7` | `--cds-blue-810` | `#031e3d` |
| `--cds-blue-20` | `#f5f9fe` | `--cds-blue-400` | `#3987e5` | `--cds-blue-820` | `#021c39` |
| `--cds-blue-30` | `#f0f7fe` | `--cds-blue-450` | `#2a78d6` | `--cds-blue-830` | `#021a36` |
| `--cds-blue-40` | `#ebf4fc` | `--cds-blue-500` | `#256abf` | `--cds-blue-840` | `#021831` |
| `--cds-blue-50` | `#e7f1fb` | `--cds-blue-550` | `#1c5cab` | `--cds-blue-850` | `#03162c` |
| `--cds-blue-60` | `#e2eefa` | `--cds-blue-600` | `#184f95` | `--cds-blue-860` | `#051426` |
| `--cds-blue-70` | `#ddebfa` | `--cds-blue-650` | `#104281` | `--cds-blue-870` | `#07121f` |
| `--cds-blue-80` | `#d7e8fa` | `--cds-blue-700` | `#0d366b` | `--cds-blue-880` | `#091018` |
| `--cds-blue-90` | `#d2e5fa` | `--cds-blue-750` | `#062b57` | `--cds-blue-890` | `#0a0d11` |
| `--cds-blue-100` | `#cde2fb` | | | `--cds-blue-900` | `#0b0b0b` |
| `--cds-blue-150` | `#b7d3f6` | | | | |
| `--cds-blue-200` | `#9ec5f4` | | | | |
| `--cds-blue-250` | `#86b6ef` | | | | |

声明原文：`--cds-blue-450:#2a78d6`（MW）、`--cds-blue-700:#0d366b`（MW）

> **注意**：MW 的 `--cds-blue-*` 是 **CDS 自己的蓝**，与 SH 里 `@theme{--color-blue-600:#2563eb}` 的 **Tailwind 默认蓝**是两套。SH 注释明确说明后者是**故意钉死**的，为了让 `@tailwindcss/forms` 插件输出与 v3 时代逐字节一致：
> ```css
> /* SH:44-46 */
> @theme { --color-gray-500:#6b7280; --color-blue-600:#2563eb; }
> ```

### 1.6 `--accent-*` / `--brand-*` / 遗留调色板（HSL 分量形式）

来源 **SH:114-155**（`:root`）与 **SH:157-198**（`.darkTheme`），MW 内 `@layer base >> :root`（40 条）与 `@layer base >> .darkTheme`（41 条）为同一份编译副本。

SH 注释标注取样时间：`/* Values taken from claude.ai on 2025-10-17T02:46:12.721Z */`

| 令牌 | 亮色 `:root`（SH 原文） | 换算 hex | 暗色 `.darkTheme`（SH 原文） | 换算 hex |
|---|---|---|---|---|
| **`--accent-brand`** | `15 63.1% 59.6%` | **`#d97757`** | `15 63.1% 59.6%` | **`#d97757`** |
| `--brand-000` | `15 54.2% 51.2%` | `#c6613f` | `15 54.2% 51.2%` | `#c6613f` |
| `--brand-100` | `15 54.2% 51.2%` | `#c6613f` | `15 63.1% 59.6%` | `#d97757` |
| `--brand-200` | `15 63.1% 59.6%` | `#d97757` | `15 63.1% 59.6%` | `#d97757` |
| `--brand-900` | `0 0% 0%` | `#000000` | `0 0% 0%` | `#000000` |
| `--accent-pro-000` | `251 34.2% 33.3%` | `#433872` | `251 84.6% 74.5%` | `#9b87f5` |
| `--accent-pro-100` | `251 40% 45.1%` | `#5645a1` | `251 40.2% 54.1%` | `#6c5bb9` |
| `--accent-pro-200` | `251 61% 72.2%` | `#9d8de3` | `251 40% 45.1%` | `#5645a1` |
| `--accent-pro-900` | `253 33.3% 91.8%` | `#e6e3f1` | `250 25.3% 19.4%` | `#29253e` |
| `--accent-000` | `210 73.7% 40.2%` | `#1b67b2` | `210 65.5% 67.1%` | `#74abe2` |
| `--accent-100` | `210 70.9% 51.6%` | `#2c84db` | `210 70.9% 51.6%` | `#2c84db` |
| `--accent-200` | `210 70.9% 51.6%` | `#2c84db` | `210 70.9% 51.6%` | `#2c84db` |
| `--accent-900` | `211 72% 90%` | `#d3e5f8` | `210 55.9% 24.6%` | `#1c3f62` |
| `--bg-000` | `0 0% 100%` | `#ffffff` | `60 2.1% 18.4%` | `#30302e` |
| `--bg-100` | `48 33.3% 97.1%` | `#faf9f5` | `60 2.7% 14.5%` | `#262624` |
| `--bg-200` | `53 28.6% 94.5%` | `#f5f4ed` | `30 3.3% 11.8%` | `#1f1e1d` |
| `--bg-300` | `48 25% 92.2%` | `#f0eee6` | `60 2.6% 7.6%` | `#141413` |
| `--bg-400` | `50 20.7% 88.6%` | `#e8e6dc` | `0 0% 0%` | `#000000` |
| `--bg-500` | `50 20.7% 88.6%` | `#e8e6dc` | `0 0% 0%` | `#000000` |
| `--border-100`~`400` | `30 3.3% 11.8%` | `#1f1e1d` | `51 16.5% 84.5%` | `#dedcd1` |
| `--danger-000` | `0 58.6% 34.1%` | `#8a2424` | `0 98.4% 75.1%` | `#fe8181` |
| `--danger-100/200` | `0 56.2% 45.4%` | `#b53333` | `0 67% 59.6%` | `#dd5353` |
| `--danger-900` | `0 50% 95%` | `#f9ecec` | `0 46.5% 27.8%` | `#682626` |
| `--oncolor-100` | `0 0% 100%` | `#ffffff` | `0 0% 100%` | `#ffffff` |
| `--oncolor-200/300` | `60 6.7% 97.1%` | `#f8f8f7` | `60 6.7% 97.1%` | `#f8f8f7` |
| `--success-000` | `125 100% 18%` | `#005c08` | `97 59.1% 46.1%` | `#65bb30` |
| `--success-100/200` | `103 72.3% 26.9%` | `#2f7613` | `97 75% 32.9%` | `#459315` |
| `--success-900` | `86 45.1% 90%` | `#e7f1da` | `127 100% 13.9%` | `#004708` |
| `--text-000/100` | `60 2.6% 7.6%` | `#141413` | `48 33.3% 97.1%` | `#faf9f5` |
| `--text-200/300` | `60 2.5% 23.3%` | `#3d3d3a` | `50 9% 73.7%` | `#c2c0b6` |
| `--text-400/500` | `51 3.1% 43.7%` | `#73726c` | `48 4.8% 59.2%` | `#9c9a92` |

> **换算方法**：`colorsys.hls_to_rgb(h/360, l/100, s/100)` → 8-bit 取整。所有换算值由脚本 `/tmp/claude-rea/hsl.py` 生成，非手算。

### 1.7 `--claude-background-color` / `--claude-foreground-color`（**已核实，并补第三个**）

用户已知值完全正确。实测来源：

```css
/* SH:202-205 —— 注释：NB: Legacy color variables - claude-* needs to be synced with updateTitleOverlayColors */
:root{ --claude-foreground-color:black; --claude-background-color:#fcfcfb; }

/* SH:215-221 —— 首帧防闪白 */
@media (prefers-color-scheme:dark){
  :root{ --claude-foreground-color:white; --claude-background-color:#151515; --claude-text-500:#a6a39b; }
}

/* SH:223-227 */
.darkTheme{ --claude-foreground-color:white; --claude-background-color:#151515; --claude-text-500:#a6a39b; }
```

| 令牌 | 亮色 | 暗色 | 来源 |
|---|---|---|---|
| `--claude-background-color` | `#fcfcfb` ✅已核实 | `#151515` ✅已核实 | SH:204 / SH:218,225 |
| `--claude-foreground-color` | `black` ✅已核实 | `white` ✅已核实 | SH:203 / SH:217,224 |
| **`--claude-text-500`** | **未找到**（`:root` 无定义） | `#a6a39b` | SH:219,226 |

> **`--claude-text-500` 亮色未定义** —— 只在两个暗色块里出现。这是一个**不对称的遗留变量**，亮色下引用它会得到空值。

消费方式（SH:229-241）：
```css
html,body{ color:var(--claude-foreground-color); margin:0; padding:0; height:100%;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
body{ background-color:var(--claude-background-color); }
```

### 1.8 品牌固定色 `--cds-clay` 等（模式无关，MW `.cds-root` 与 `:root` 双定义）

```css
--cds-clay:#d97757            /* 注意：= --accent-brand 的 hex 换算值 */
--cds-clay-emphasized:#c6613f /* = --brand-000 的 hex 换算值 */
--cds-heather:#cbcadb
--cds-plum:#827dbd
--cds-cactus:#bcd1ca
--cds-mineral:#629987
--cds-black:#000
--cds-oncolor-200:#f8f8f7bf
--cds-oncolor-300:#f8f8f780
```

> **交叉验证**：`--cds-clay:#d97757` 与 `--accent-brand: 15 63.1% 59.6%` 换算值 **完全一致**；`--cds-clay-emphasized:#c6613f` 与 `--brand-000: 15 54.2% 51.2%` 换算值一致。两套体系在品牌色上对齐了。

Pictogram 高亮（模式相关）：
```css
/* 亮 MW .cds-root */  /* 暗 MW 186213 / :root:not([data-mode=light]) */
--cds-pictogram-highlight-default:var(--cds-gray-80);   → var(--cds-gray-650)
--cds-pictogram-highlight-heather:var(--cds-heather);   → var(--cds-plum)
--cds-pictogram-highlight-cactus:var(--cds-cactus);      → var(--cds-mineral)
```

### 1.9 `--cds-page-bg` / `--cds-border` / 边框族

| 令牌 | 亮（MW `.cds-root`） | 暗（MW 186213） |
|---|---|---|
| `--cds-page-bg` | `var(--cds-surface-0)` → `var(--cds-gray-20)` = `#f9f9f7` | `var(--cds-surface-0)`；而 `--cds-surface-0` 在暗块被覆盖为 `var(--cds-gray-900)` = `#0b0b0b` |
| `--cds-border` | `var(--cds-alpha-2)` | `var(--cds-alpha-2)`（写法不变，值随 neutral 翻转） |
| `--cds-border-line` | `initial` | （未覆盖） |
| `--cds-border-strong` | `var(--cds-alpha-3)` | （未覆盖，值随 neutral 翻转） |
| `--cds-border-stronger` | `hsl(from var(--cds-neutral-900) h s l / 40%)` | 同，随 neutral 翻转 |
| `--cds-border-accent` | `var(--cds-role-accent-250)` | `var(--cds-role-accent-700)` |
| `--cds-border-danger` | `var(--cds-role-danger-250)` | `var(--cds-role-danger-700)` |
| `--cds-border-success` | `var(--cds-role-success-250)` | `var(--cds-role-success-700)` |
| `--cds-border-warning` | `var(--cds-role-warning-250)` | `var(--cds-role-warning-700)` |
| `--cds-border-pro` | `var(--cds-role-pro-250)` | `var(--cds-role-pro-700)` |
| `--cds-border-editor-comment` | `var(--cds-yellow-400)` | `var(--cds-yellow-300)` |
| `--cds-border-editor-comment-open` | `var(--cds-yellow-450)` | `var(--cds-yellow-200)` |

> **注意**：`:root` 里还有一个 `--cds-border: currentColor`（MW `:root`），是给**非 `.cds-root` 作用域**的 fallback。LP:55-62 把 `html:where(.cds-root) *` 的 border-color 钉回 `currentColor`，因为「Tailwind v3 的默认值是 currentColor，此应用调色板没有 border DEFAULT」。

### 1.10 `--cds-text-git-*`（用户点名，实测双档）

```css
/* 亮 —— MW :where(:root,:host,.cds-root[data-mode],[data-mode] .cds-root:not([data-mode])) */
--cds-text-git-added:#1e9e3c;      --cds-text-git-removed:#cd2054;
--cds-text-git-modified:#98801f;   --cds-text-git-merged:#8e6bd9;
--cds-text-git-closed:#ff3a30;     --cds-text-git-conflicting:#c5621b;
--cds-text-git-draft:#737373;
/* 暗 —— MW @media screen{[data-mode=dark] .cds-root:not([data-mode=light]):not([data-mode=system]),…} */
--cds-text-git-added:#32d74b;      --cds-text-git-removed:#ff2c56;
--cds-text-git-modified:#ffd014;   --cds-text-git-merged:#b796ff;
--cds-text-git-closed:#ff6159;     --cds-text-git-conflicting:#fa832e;
--cds-text-git-draft:#a6a6a6;
```

| 令牌 | 亮 | 暗 |
|---|---|---|
| `--cds-text-git-added` | `#1e9e3c` | `#32d74b` |
| `--cds-text-git-removed` | `#cd2054` | `#ff2c56` |
| `--cds-text-git-modified` | `#98801f` | `#ffd014` |
| `--cds-text-git-merged` | `#8e6bd9` | `#b796ff` |
| `--cds-text-git-closed` | `#ff3a30` | `#ff6159` |
| `--cds-text-git-conflicting` | `#c5621b` | `#fa832e` |
| `--cds-text-git-draft` | `#737373` | `#a6a6a6` |
| `--cds-text-git-opened` | `var(--cds-text-git-added)` | 同 |
| `--cds-text-git-queued` | `var(--cds-text-git-modified)` | 同 |

派生的 fill / bg / border（MW `.cds-root`，**亮色**定义）：
```css
--cds-fill-git-added:#1a8633;  --cds-fill-git-added-hover:#1e9b3b;
--cds-fill-git-removed-hover:#de295f;  --cds-fill-git-modified:#8b751c;
--cds-fill-git-modified-hover:#a08720; --cds-fill-git-merged:#855fd6;
--cds-fill-git-merged-hover:#9473db;   --cds-fill-git-closed:#ed0b00;
--cds-fill-git-closed-hover:#ff1307;   --cds-fill-git-conflicting:#b85b19;
--cds-fill-git-conflicting-hover:#c5621b; --cds-fill-git-draft-hover:gray;
--cds-bg-git-added:color-mix(in srgb, var(--cds-text-git-added) 20%, transparent);
--cds-border-git-added:color-mix(in srgb, var(--cds-text-git-added) 40%, transparent);
```
暗色下这些**降级为直接引用文本色**：`--cds-fill-git-added:var(--cds-text-git-added)`、`--cds-bg-git-*:var(--cds-text-git-*)`、`--cds-border-git-*:var(--cds-text-git-*)`。

> **`--cds-fill-git-draft-hover:gray`** —— 这是实测到的一个**疑似 bug**：全文件唯一一个非 hex/var 的颜色字面量关键字，其余 git 令牌全是 hex。照抄时应修正（建议 `var(--cds-text-git-draft)` 或取 draft 的深色档）。

### 1.11 语义角色色 `--cds-role-*`（MW `:where(:root,:host)`）

accent 角色映射到 blue 族（**注意：CDS 的 accent 是蓝色，不是品牌 clay 橙**）：
```css
--cds-role-accent-50:var(--cds-blue-50);   --cds-role-accent-100:var(--cds-blue-100);
--cds-role-accent-250:var(--cds-blue-250); --cds-role-accent-300:var(--cds-blue-300);
--cds-role-accent-400:var(--cds-blue-400); --cds-role-accent-450:var(--cds-blue-450);
--cds-role-accent-600:var(--cds-blue-600); --cds-role-accent-700:var(--cds-blue-700);
--cds-role-accent-800:var(--cds-blue-800); --cds-role-accent-850:var(--cds-blue-850);
--cds-role-accent-fill:var(--cds-role-accent-450);       /* #2a78d6 */
--cds-role-accent-fill-hover:var(--cds-role-accent-400); /* #3987e5 */
--cds-role-accent-on:var(--cds-gray-0);                  /* #fff */
```
danger→red、success→green、warning→yellow、pro→violet 同构。`--cds-role-success-on:var(--cds-gray-900)` 与 `--cds-role-warning-on:var(--cds-gray-900)` 是例外（深字压浅底），其余 `-on` 为 `--cds-gray-0`。

文本色（模式相关）：

| 令牌 | 亮 | 暗 |
|---|---|---|
| `--cds-text-primary` | `var(--cds-neutral-900)` = `#0b0b0b` | `var(--cds-gray-50)` = `#f0efec` |
| `--cds-text-secondary` | `var(--cds-neutral-600)` = `#52514e` | `var(--cds-gray-200)` = `#c3c2b7` |
| `--cds-text-muted` | `var(--cds-neutral-400)` = `#898781` | `var(--cds-gray-400)` = `#898781` |
| `--cds-text-disabled` | `var(--cds-alpha-4)` | 同（随 neutral 翻转） |
| `--cds-text-accent` | `var(--cds-role-accent-600)` = `#184f95` | `var(--cds-role-accent-300)` = `#6da7ec` |
| `--cds-text-danger` | `var(--cds-role-danger-600)` | `var(--cds-role-danger-300)` |
| `--cds-text-success` | `var(--cds-role-success-600)` | `var(--cds-role-success-400)` |
| `--cds-text-pro` | `var(--cds-role-pro-600)` | `var(--cds-role-pro-300)` |

> `--cds-text-muted` 亮暗**都解析到 `#898781`** —— 因为亮 `neutral-400`→`gray-400`，暗直接写 `gray-400`。这是刻意的「muted 不动」。

填充色：`--cds-fill-primary:var(--cds-neutral-900)`；`--cds-fill-brand:var(--cds-clay-emphasized)`（= `#c6613f`）、`--cds-fill-brand-hover:var(--cds-clay)`（= `#d97757`）。
表面色：`--cds-surface-0:var(--cds-gray-20)` / `-1:gray-10` / `-2:gray-0` / `-3:gray-0`（亮）；暗：`gray-900` / `gray-850` / `gray-830` / `gray-800`。`--cds-surface-popover:var(--cds-surface-3)`、`--cds-surface-panel:var(--cds-surface-2)`。

> ⚠️ **令牌值 vs 真机实测的偏差**：按令牌，暗色 `--cds-page-bg` = `--cds-surface-0` = `--cds-gray-900` = **`#0b0b0b`**。但 `out/00-master-evidence.md` §1 真机采样主区底色为 `rgb(21,21,21)` = **`#151515`**，而 `#151515` 是暗色 **`--cds-surface-1`**（`var(--cds-gray-850)`）。即**真机主区用的是 surface-1 而非 page-bg/surface-0**。照抄时若要像素级复刻真机，主区底应取 `#151515`，不要盲信 `--cds-page-bg`。
>
> **侧栏 `#111111` 的来源已定位**（不是任何 gray 令牌）：它精确等于**首帧 boot placeholder 的侧栏公式**——`color-mix(in srgb, #151515 80%, black)` 计算得 `#111111`（HTML:139）。`--cds-gray-870:#111` 数值相同但**无引用关系**，属巧合。所以真机截到的侧栏很可能是**启动占位层尚未卸载**时的画面，而非稳态 surface 令牌。

---

## 2. 密度体系

### 2.1 只有一档：`comfortable`

**全仓库实测**（`grep -roE 'data-density=[a-z]+' x/.vite/renderer/`）：

```
about_window/about.html          data-density=comfortable
buddy_window/buddy.html          data-density=comfortable
find_in_page/find-in-page.html   data-density=comfortable
main_window/assets/…css          data-density=comfortable
quick_window/quick-window.html   data-density=comfortable
```

> **结论：`compact` / `spacious` / 任何其他 density 档位在所有解包文件中均未找到。** 只有 `comfortable` 一档，且被硬写在每个窗口的 `<html>` 上（HTML:12 `data-density="comfortable"`）。

### 2.2 `[data-density=comfortable]` 块内容（MW，118 条声明，分 3 个物理块）

它**不是**定义 `--cds-rem-scale`，而是**覆写整套尺寸/排版基值**（每值都 × `var(--cds-rem-scale,1)`）：

```css
/* MW: .cds-root[data-density=comfortable]{…} */
--cds-radius:calc(.5rem * var(--cds-rem-scale,1));           /* 8px  */
--cds-radius-composer:calc(.875rem * var(--cds-rem-scale,1));/* 14px */
--cds-h-control:calc(2rem * var(--cds-rem-scale,1));         /* 32px */
--cds-h-control-nested:calc(1.375rem * var(--cds-rem-scale,1));/* 22px */
--cds-icon:calc(1.25rem * var(--cds-rem-scale,1));           /* 20px */
--cds-pad-xs:calc(.375rem * var(--cds-rem-scale,1));         /* 6px  */
--cds-pad-sm:calc(.5rem * var(--cds-rem-scale,1));           /* 8px  */
--cds-pad-md:calc(.75rem * var(--cds-rem-scale,1));          /* 12px */
--cds-pad-lg:calc(1rem * var(--cds-rem-scale,1));            /* 16px */
--cds-pad-xl:calc(1.5rem * var(--cds-rem-scale,1));          /* 24px */
--cds-gap-xs:calc(.5rem * …);      /* 8px  */
--cds-gap-sm:calc(.75rem * …);     /* 12px */
--cds-gap-md:calc(1rem * …);       /* 16px */
--cds-gap-lg:calc(1.75rem * …);    /* 28px */
--cds-gap-xl:calc(2.5rem * …);     /* 40px */
--cds-font-size-caption:calc(.75rem * …);   /* 12px */
--cds-font-size-footnote:calc(.8125rem * …);/* 13px */
--cds-font-size-code:calc(.8125rem * …);    /* 13px */
--cds-font-size-body:calc(.875rem * …);     /* 14px */
--cds-font-size-prose:1rem;                 /* 16px ← 唯一不随 rem-scale */
--cds-font-size-heading:calc(.9375rem * …); /* 15px */
--cds-font-size-title:calc(1.375rem * …);   /* 22px */
--cds-leading-caption:calc(1.0625rem * …);  /* 17px */
--cds-leading-footnote:calc(1.0625rem * …); /* 17px */
--cds-leading-code:calc(1.1875rem * …);     /* 19px */
--cds-leading-body:calc(1.25rem * …);       /* 20px */
--cds-leading-prose:1.5rem;                 /* 24px ← 唯一不随 rem-scale */
--cds-leading-heading:calc(1.25rem * …);    /* 20px */
--cds-leading-title:calc(1.75rem * …);      /* 28px */
--cds-avatar-xs:calc(1.25rem*…); --cds-avatar-sm:calc(1.5rem*…);
--cds-avatar-md:calc(2rem*…);    --cds-avatar-lg:calc(2.5rem*…);
--cds-avatar-text-xs:calc(.5625rem * …);    /* 9px */
--cds-checkbox:calc(1.25rem*…);  --cds-checkbox-glyph:calc(1rem*…);
--cds-checkbox-radius:calc(.3125rem*…); --cds-panel-radius:calc(.75rem*…); /* 12px */
```
加上 3 组 `--*-–xs/sm/lg` 变体与 `--*-–textsm/textmd/textlg` 变体（见 §3.4）。

### 2.3 `--cds-rem-scale` —— **从未被定义**（重要实测结论）

`grep -rnoE '\-\-cds-rem-scale *: *[^;,})]+' x/.vite/renderer/` → **0 命中**。
全文 300+ 处全是 `var(--cds-rem-scale,1)` 的**消费**，fallback 恒为 `1`。

> **含义**：`--cds-rem-scale` 是一个**留给宿主注入的全局缩放钩子**（大概率由 Electron 的 zoom factor 在运行时写到 `:root`），默认 1。实现时**必须保留这个 fallback 写法**，否则窗口缩放会失效。

### 2.4 密度与 `data-step` 的等价关系（关键发现，已数值验证）

MW 里还存在一套 **`[data-step="1"…"5"]`** 的 5 档尺寸阶梯（每档 17 条声明）。我把它们与 density 逐键比对：

| 对比 | 结果 |
|---|---|
| `.cds-root`（无 density，无 step） **vs** `[data-step="2"]` | **17/17 键完全一致，0 处差异** |
| `[data-density=comfortable]` **vs** `[data-step="4"]` | **17/17 键完全一致，0 处差异** |

验证脚本输出：
```
keys in step2: 17
--- base(.cds-root) == step2 ? ---  diffs: 0
--- comfortable == step4 ? ---      diffs: 0
```

**5 档 step 阶梯（每档 `--cds-radius` / `--cds-h-control` / `--cds-icon` / `--cds-font-size-body`）：**

| step | radius | h-control | h-control-nested | icon | pad-xs/sm/md/lg/xl | font-body | font-prose | leading-body | leading-prose |
|---|---|---|---|---|---|---|---|---|---|
| **1** | `.3125rem` 5px | `1.25rem` 20px | `1rem` 16px | `.75rem` 12px | .125/.25/.375/.625/.875 | `.75rem` 12px | `.8125rem` | `1.0625rem` | `1.1875rem` |
| **2** = 默认 | `.375rem` 6px | `1.5rem` 24px | `1.125rem` 18px | `1rem` 16px | .25/.375/.5/.75/1.25 | `.8125rem` 13px | `.875rem` | `1.1875rem` | `1.25rem` |
| **3** | `.4375rem` 7px | `1.75rem` 28px | `1.25rem` 20px | `1rem` 16px | .375/.5/.625/.875/1.375 | `.875rem` 14px | `.9375rem` | `1.25rem` | `1.375rem` |
| **4** = comfortable | `.5rem` **8px** | `2rem` **32px** | `1.375rem` 22px | `1.25rem` **20px** | .375/.5/.75/1/1.5 | `.875rem` 14px | `1rem` | `1.25rem` | `1.5rem` |
| **5** | `.625rem` 10px | `2.5rem` 40px | `1.75rem` 28px | `1.5rem` 24px | .5/.75/1/1.25/1.75 | `.9375rem` 15px | `1.125rem` | `1.375rem` | `1.6875rem` |

**默认（无属性）比 comfortable 小两档。** 这是照抄时最容易踩的坑：`index.html` 同时写了 `data-density="comfortable"`（HTML:12），所以主窗口走 step-4 尺度；但任何没继承到该属性的子树会掉回 step-2。

另有 `[data-size=xs|sm|lg]`（各 17 条），它们**不是绝对值而是重定向**：`--cds-radius:var(--cds-radius--lg)` 等。

---

## 3. 排版

### 3.1 字体栈（实测原值）

```css
/* MW :root —— 系统 sans（CDS 内置 fallback） */
--cds-font-system:ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
  "PingFang SC", "PingFang TC", "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;

/* MW .cds-root —— 实际使用的 sans（Anthropic Sans 优先） */
--cds-font-sans:var(--font-anthropic-sans,var(--cds-font-system)), var(--cds-font-system);
--cds-font-sans-display:var(--font-anthropic-sans-display,var(--cds-font-sans)), var(--cds-font-sans);
--cds-font-voice:var(--font-anthropic-serif,ui-serif), ui-serif, Georgia, "Times New Roman", serif;
--cds-font-mono:var(--cds-font-mono-override,) var(--font-anthropic-mono,"SF Mono"), "SF Mono", ui-monospace, Menlo, Consolas, monospace;
--cds-font-mono-ui:var(--font-anthropic-mono,"SF Mono"), "SF Mono", ui-monospace, Menlo, Consolas, monospace;

/* MW :root（旧路径，无 Anthropic 变量时） */
--cds-font-sans:var(--cds-font-system);
--cds-font-sans-display:var(--cds-font-sans);
--cds-font-mono:var(--cds-font-mono-override,) ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
```

`--font-anthropic-sans` / `--font-anthropic-serif` 的**实际定义**在窗口 HTML 内联样式里（FIP `main-CiwjW8Wn.css`、BW 尾部、`about.html:16` 等），MW 内只有消费：

```css
--font-anthropic-sans:"anthropic-sans", ui-sans-serif, -apple-system, BlinkMacSystemFont,
  "Segoe UI", "PingFang SC", "PingFang TC", "Hiragino Sans", "Apple SD Gothic Neo",
  "Kohinoor Devanagari", "Kohinoor Bangla", "Kohinoor Telugu", "Tamil Sangam MN",
  "Kohinoor Gujarati", "Malayalam Sangam MN", "Nirmala UI", "Noto Sans Devanagari UI",
  "Noto Sans Devanagari", "Noto Sans Bengali UI", "Noto Sans Bengali", "Noto Sans Telugu UI",
  "Noto Sans Telugu", "Noto Sans Tamil UI", "Noto Sans Tamil", "Noto Sans Gujarati UI",
  "Noto Sans Gujarati", "Noto Sans Kannada UI", "Noto Sans Kannada", "Noto Sans Malayalam UI",
  "Noto Sans Malayalam", Thonburi, "Leelawadee UI", "Noto Sans Thai UI", "Noto Sans Thai",
  Kefa, Ebrima, "Noto Sans Ethiopic", "Abyssinica SIL", sans-serif;

--font-anthropic-serif:"anthropic-serif", ui-serif, Georgia, "Times New Roman",
  "Kohinoor Devanagari", …（同上南亚/东南亚回退链）…, "Abyssinica SIL", serif;
```

**`--font-anthropicons`** —— MW 内**未找到定义**，只在消费处出现：
```css
font-family:var(--font-anthropicons,Anthropicons-Variable)
```
其 `@font-face` 在 **FIP `FindInPage-BLyCri-A.css`**（该文件唯一内容）：
```css
@font-face{font-family:Anthropicons-Variable;
  src:url(./anthropicons-variable-cvFTkbeX.woff2) format("woff2-variations");
  font-weight:400 700; font-display:block}
```

**`@font-face` 家族（MW 内 4 条，全为变体字重 300–800）**：
```css
@font-face{font-family:anthropic-sans; src:url(./AnthropicSans-Roman-Variable-DDVos-BJ.woff2) format("woff2");
  font-weight:300 800; font-style:normal; font-display:swap; font-feature-settings:"dlig" 0}
@font-face{font-family:anthropic-sans;  …Italic-Variable-CJtkx3-S.woff2…  font-style:italic; …}
@font-face{font-family:anthropic-serif; …Roman-Variable-2VcCjn5t.woff2…   font-style:normal; …}
@font-face{font-family:anthropic-serif; …Italic-Variable-Dcb-9NUS.woff2…  font-style:italic; …}
```
> 关键细节：`font-feature-settings:"dlig" 0` —— **全局关掉 discretionary ligatures**。照抄时别漏。

### 3.2 字重与可变字体轴

```css
/* MW .cds-root 与 :root 双定义，两模式相同 */
--cds-font-weight-regular:400;
--cds-font-weight-medium:500;
--cds-font-weight-semibold:580;   /* ← 非标准！不是 600 */
--cds-font-weight-bold:600;       /* ← 非标准！不是 700 */
--cds-font-grad-semibold:180;
--cds-font-grad-bold:200;
```

**`--cds-font-axis-wght` / `--cds-font-wght-*` / `--font-opsz-axis`** 的亮暗差异（暗色下的「字重补偿」机制）：

```css
/* 亮 MW .cds-root —— 全为空/initial，即不做补偿 */
--cds-font-wght-regular:normal; --cds-font-wght-medium:normal;
--cds-font-wght-semibold:normal; --cds-font-wght-bold:normal;
--cds-font-axis-wght-regular: ; --cds-font-axis-wght-medium: ;
--cds-font-axis-wght-semibold: ; --cds-font-axis-wght-bold: ;

/* 暗 MW 186213 —— 暗底白字需要减重 */
--cds-font-wght-regular:"wght" 360;   --cds-font-axis-wght-regular:var(--cds-font-wght-regular),
--cds-font-wght-medium:"wght" 460;    --cds-font-axis-wght-medium:var(--cds-font-wght-medium),
--cds-font-wght-semibold:"wght" 540;  --cds-font-axis-wght-semibold:var(--cds-font-wght-semibold),
--cds-font-wght-bold:"wght" 560;      --cds-font-axis-wght-bold:var(--cds-font-wght-bold),
```

> **暗色字重整体下调**：regular 400→**360**，medium 500→**460**，semibold 580→**540**，bold 600→**560**。这是可变字体在深色背景上的光学补偿，照抄时是必需的（否则暗色下文字显胖）。

消费模板（MW，全文统一）：
```css
font-variation-settings:var(--font-opsz-axis,) var(--cds-font-axis-wght,) "GRAD" var(--cds-font-grad,0)
```
> `--font-opsz-axis` 自身**未找到定义**（只有 `var(--font-opsz-axis,)` 的空 fallback 消费）。同理 `--cds-font-grad` 只有 `var(--cds-font-grad,0)`，`--cds-font-grad-semibold/bold` 定义了但需由组件自行挂到 `--cds-font-grad`。

字体工具类重映射（MW `@media screen{[data-mode=dark]…}` + `prefers-color-scheme:dark` 镜像）：
```
.font-normal   → --cds-font-axis-wght:var(--_cds-font-axis-wght-role,var(--cds-font-axis-wght-body,var(--cds-font-axis-wght-regular)))
.font-medium   → …var(--cds-font-axis-wght-medium)
.font-semibold → …var(--cds-font-axis-wght-semibold)
.font-bold     → …var(--cds-font-axis-wght-bold)
:is(b,strong):where(:not([class*=font])) → --cds-font-axis-wght:var(--cds-font-axis-wght-bold)
.font-thin/.font-extralight/.font-light/.font-extrabold/.font-black → --cds-font-axis-wght:initial
```
> **SH:25 明确导入了 `@ant/cds/root-weight-pin.css`**，注释说这是「opt out of CDS's lighter dark-mode weight」——但 MW 里这些 `.font-*` 暗色规则依然存在（`root-weight-pin.css` 内容未随本包解出，**未找到**其源码）。

### 3.3 字号 × 行高 pairing 表（comfortable / step-4，主窗口实际生效值）

| 角色 | 字号令牌 | 字号 | 行高令牌 | 行高 | 比值 |
|---|---|---|---|---|---|
| caption | `--cds-font-size-caption` | `.75rem` 12px | `--cds-leading-caption` | `1.0625rem` 17px | 1.42 |
| footnote | `--cds-font-size-footnote` | `.8125rem` 13px | `--cds-leading-footnote` | `1.0625rem` 17px | 1.31 |
| code | `--cds-font-size-code` | `.8125rem` 13px | `--cds-leading-code` | `1.1875rem` 19px | 1.46 |
| **body** | `--cds-font-size-body` | `.875rem` **14px** | `--cds-leading-body` | `1.25rem` **20px** | 1.43 |
| **prose** | `--cds-font-size-prose` | `1rem` **16px** | `--cds-leading-prose` | `1.5rem` **24px** | 1.50 |
| heading | `--cds-font-size-heading` | `.9375rem` 15px | `--cds-leading-heading` | `1.25rem` 20px | 1.33 |
| title | `--cds-font-size-title` | `1.375rem` 22px | `--cds-leading-title` | `1.75rem` 28px | 1.27 |
| page-header title | `--cds-page-header-title-size` | `1.5rem` 24px | `--cds-page-header-title-leading` | `2rem` 32px | 1.33 |

> **`--cds-font-size-prose` 与 `--cds-leading-prose` 是唯一两个不乘 `--cds-rem-scale` 的排版令牌**（硬写 `1rem` / `1.5rem`），其余全部 `calc(… * var(--cds-rem-scale,1))`。推测：prose 是用户可调的阅读字号，走独立通道。

### 3.4 会话文本尺寸档 `[data-text-size=sm|md|lg|own]`（MW）

```css
[data-text-size=sm]  → --cds-font-size-body:var(--cds-font-size-body--textsm);  /* .8125rem 13px */
[data-text-size=md]  → --cds-font-size-body:var(--cds-font-size-body--textmd);  /* .875rem 14px */
[data-text-size=lg]  → --cds-font-size-body:var(--cds-font-size-body--textlg);  /* .9375rem 15px */
[data-text-size]     → --cds-font-size-body:var(--cds-font-size-body--own);     /* .8125rem 13px */
```
comfortable 下完整值：`--*-textsm:calc(.8125rem*…)`、`--*-textmd:calc(.875rem*…)`、`--*-textlg:calc(.9375rem*…)`、`--*-own:calc(.875rem*…)`；prose 各档 `--textsm:.9375rem` / `--textlg:1.125rem`；leading-body 各档 `1.1875 / 1.25 / 1.375`。

### 3.5 Tailwind 层排版令牌（MW `@layer theme >> :root,:host`）

```css
--text-xs:.75rem;      --text-xs--line-height:calc(1 / .75);
--text-sm:.875rem;     --text-sm--line-height:calc(1.25 / .875);
--text-lg:1.125rem;    --text-lg--line-height:calc(1.75 / 1.125);
--text-xl:1.25rem;     --text-xl--line-height:calc(1.75 / 1.25);
--text-2xl:1.5rem;     --text-2xl--line-height:calc(2 / 1.5);
--tracking-wider:.05em;  --leading-relaxed:1.625;
```

---

## 4. 间距与圆角

### 4.1 `--spacing`（基础栅格）

```css
/* MW @layer theme >> :root,:host */
--spacing:.25rem;   /* 4px */
```
所有 Tailwind 间距工具类都是 `calc(var(--spacing) * N)`。实测消费的最大倍数到 `120`，且有几个异常值：`--spacing) * 401`、`* 44996`、`* 84`、`* 48`（应为组件级硬编码覆盖）。

### 4.2 `--cds-pad-*` / `--cds-gap-*`（comfortable 实测）

| 令牌 | comfortable | px | 默认(step-2) | px |
|---|---|---|---|---|
| `--cds-pad-xs` | `.375rem` | 6 | `.25rem` | 4 |
| `--cds-pad-sm` | `.5rem` | 8 | `.375rem` | 6 |
| `--cds-pad-md` | `.75rem` | 12 | `.5rem` | 8 |
| `--cds-pad-lg` | `1rem` | 16 | `.75rem` | 12 |
| `--cds-pad-xl` | `1.5rem` | 24 | `1.25rem` | 20 |
| `--cds-gap-xs` | `.5rem` | 8 | `.375rem` | 6 |
| `--cds-gap-sm` | `.75rem` | 12 | `.5rem` | 8 |
| `--cds-gap-md` | `1rem` | 16 | `.75rem` | 12 |
| `--cds-gap-lg` | `1.75rem` | 28 | `1.25rem` | 20 |
| `--cds-gap-xl` | `2.5rem` | 40 | `2rem` | 32 |

> **规律**：pad 与 gap 都近似 ×2 等比（4/8/12/16/24），但 gap 的高端（28/40）跳得比 pad 大 —— gap 是「区块间留白」，pad 是「容器内边距」，两套曲线不同，不要混用。

### 4.3 圆角

| 令牌 | comfortable | px | :root 裸值 | 默认 step-2 |
|---|---|---|---|---|
| `--cds-radius` | `.5rem` | **8** | `.25rem` (4px) | `.375rem` (6px) |
| `--cds-radius-composer` | `.875rem` | 14 | — | `.75rem` (12px) |
| `--cds-radius--xs` | `.375rem` | 6 | — | `.3125rem` (5px) |
| `--cds-radius--sm` | `.4375rem` | 7 | — | `.3125rem` (5px) |
| `--cds-radius--lg` | `.625rem` | 10 | — | `.4375rem` (7px) |
| `--cds-panel-radius` | `.75rem` | 12 | — | `.625rem` (10px) |
| `--cds-checkbox-radius` | `.3125rem` | 5 | — | `.25rem` (4px) |
| `--radius-card` | `calc(var(--cds-radius) + calc(.25rem * var(--cds-rem-scale,1)))` | 8+4=**12** | — | — |
| `--radius-md` / `--radius-lg` | — | — | `.375rem` / `.5rem` | — |

> **三级 `--cds-radius` 并存**：`:root` 裸值 `.25rem`（4px，Tailwind 时代遗留，见 LP:99-110 注释「bare rounded becomes var(--cds-radius) (8px at comfortable density, was 4px)」）、`.cds-root` 默认 `.375rem`、`[data-density=comfortable]` 覆写 `.5rem`。LP 明确说明这是 v3→v4 的行为变更，并**把 `.rounded` 钉回 `0.25rem`** 以保旧界面不变。

### 4.4 控件高度与图标尺寸

| 令牌 | comfortable | px | 默认 step-2 | px |
|---|---|---|---|---|
| `--cds-h-control` | `2rem` | **32** | `1.5rem` | 24 |
| `--cds-h-control--xs` | `1.5rem` | 24 | `1.25rem` | 20 |
| `--cds-h-control--sm` | `1.75rem` | 28 | `1.25rem` | 20 |
| `--cds-h-control--lg` | `2.5rem` | 40 | `1.75rem` | 28 |
| `--cds-h-control-nested` | `1.375rem` | 22 | `1.125rem` | 18 |
| `--cds-icon` | `1.25rem` | **20** | `1rem` | 16 |
| `--cds-icon--xs` | `1rem` | 16 | `.75rem` | 12 |
| `--cds-icon--sm` | `1rem` | 16 | `.75rem` | 12 |
| `--cds-icon--lg` | `1.5rem` | 24 | `1rem` | 16 |
| `--cds-avatar-xs/sm/md/lg` | 1.25/1.5/2/2.5rem | 20/24/32/40 | 1/1.25/1.75/2.25rem | 16/20/28/36 |
| `--cds-checkbox` | `1.25rem` | 20 | `1rem` | 16 |
| `--cds-switch-h` | `1rem`* | 16* | `1rem` | 16 |

> *comfortable 块中 `--cds-switch-h` **未找到**（只在 `--cds-switch-h--xs:.875rem` / `--sm:.875rem` 有值；`.cds-root` 默认块有 `--cds-switch-h:calc(1rem*…)`）。

### 4.5 其他间距令牌（MW `.cds-root`）

```css
--cds-panel-inset:calc(.5rem * var(--cds-rem-scale,1));        /* 8px  */
--cds-panel-gap:calc(.5rem * var(--cds-rem-scale,1));          /* 8px  */
--cds-panel-header-pad-block:calc(.25rem * var(--cds-rem-scale,1));
--cds-panel-header-pad-inline:calc(.25rem * var(--cds-rem-scale,1));
--cds-toolbar-pad-block:calc(.25rem * var(--cds-rem-scale,1));
--cds-toolbar-pad-inline:calc(0rem * var(--cds-rem-scale,1));
--cds-toolbar-title-pad:calc(.25rem * var(--cds-rem-scale,1));
--cds-toolbar-icon-box:calc(0rem * var(--cds-rem-scale,1));
--cds-menu-gutter:initial;  --cds-panel-line:0px; --cds-toolbar-line:0px;
--cds-scroll-fade-size:28px;   /* @property 声明，inherits:false, initial 28px */
```

---

## 5. 阴影与环

### 5.1 `--cds-shadow-*`（亮/暗双值，来源 MW `.cds-root` 与暗色覆盖块 186213）

| 令牌 | 亮色（MW `.cds-root`） | 暗色（MW 186213） |
|---|---|---|
| `--cds-shadow-color` | `hsl(from var(--cds-gray-900) h s l / 8%)` | **`#0000003d`**（24%）—— 暗色改用固定黑、加重 |
| `--cds-shadow-sm` | `0 1px 2px 0 hsl(from var(--cds-gray-900) h s l / 6%), 0 2px 8px 0 var(--cds-shadow-color)` | （不覆盖，值随 shadow-color 变重） |
| `--cds-shadow-md` | `0 2px 4px 0 hsl(… / 7%), 0 6px 16px 0 var(--cds-shadow-color)` | 同 |
| `--cds-shadow-lg` | `0 4px 8px 0 hsl(… / 8%), 0 12px 28px -2px var(--cds-shadow-color)` | 同 |
| `--cds-shadow-popover` | `0 8px 24px #0000001f, 0 2px 6px #00000014` | `0 8px 24px #00000052, 0 2px 6px #0003` |
| `--cds-shadow-drop-ring` | `inset 0 0 0 2px var(--cds-fill-accent)` | 同 |
| `--cds-shadow-drop-ring-danger` | `inset 0 0 0 2px var(--cds-fill-danger)` | 同 |
| `--cds-shadow-drop-glow` | `inset 0 0 24px -2px hsl(from var(--cds-fill-accent) h s l / 20%)` | 同 |
| `--cds-panel-shadow` | `0 0 0 1px var(--cds-border), var(--cds-shadow-sm)` | — |

> **层级**：sm（1–2px 近距）→ md（2–6px 中距）→ lg（4–12px 远距）→ popover（8–24px 浮层）。**每段阴影都是双层**：一层紧实接触阴影 + 一层大范围扩散阴影，扩散层颜色统一走 `--cds-shadow-color`。这是标准的「两层材质阴影」做法。
>
> `:root` 里另有一组**简化版**（MW `:root`，无 `hsl(from…)`，给非 CDS 作用域）：
> `--cds-shadow-sm:0 1px 2px 0 #0000000d`、`--cds-shadow-md:0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a`、`--cds-shadow-lg:0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a` —— 这正是 Tailwind 默认阴影值。

### 5.2 `--cds-ring-*`（描边环）

| 令牌 | 亮（MW `.cds-root`） | 暗（MW 186213） |
|---|---|---|
| `--cds-ring-outer` | **`1px`** | **`0px`** |
| `--cds-ring-inner` | **`0px`** | **`1px`** |
| `--cds-ring-color` | `var(--cds-border)` | `var(--cds-alpha-2)` |
| `--cds-ring-hairline` | `1px`（另有 `.5px` / `calc(1px/3)` / `calc(1px/4)` 用于不同 DPR） | — |

> **亮暗 ring 方向反转**：亮色在**外侧**画 1px 描边（把浅色卡片从浅色背景里托出来）；暗色改画**内侧** 1px（暗底上外描边会脏）。这是本设计系统里最讲究的一处细节，照抄时必须保留。

### 5.3 焦点环

```css
/* 亮 MW .cds-root */
--cds-focus-shadow:inset 0 0 0 1px var(--cds-page-bg), 0 0 0 1px var(--cds-fill-accent), 0 0 6px 1px var(--cds-bg-accent);
/* 暗 MW 186213 —— 第三层换成 accent-600 的 60% 透明度 */
--cds-focus-shadow:inset 0 0 0 1px var(--cds-page-bg), 0 0 0 1px var(--cds-fill-accent), 0 0 6px 1px hsl(from var(--cds-role-accent-600) h s l / 60%);
--cds-focus-shadow-danger:…（同构，fill-danger / role-danger-600）
```
> 三层结构：内衬页底色（1px，制造「挖空」感）→ 实色主环（1px）→ 外发光（6px blur / 1px spread）。

### 5.4 `--tw-shadow`（Tailwind 运行时变量，实测全部取值）

```css
--tw-shadow:0 0 #0000                                    /* 初始 */
--tw-shadow:var(--cds-shadow-sm)
--tw-shadow:var(--cds-shadow-popover)
--tw-shadow:var(--cds-focus-shadow) / var(--cds-focus-shadow-danger)
--tw-shadow:inset 0 0 0 var(--cds-ring-inner) var(--cds-ring-color), 0 0 0 var(--cds-ring-outer) var(--cds-ring-color)
--tw-shadow:inset 0 0 0 …ring…, var(--cds-shadow-sm)          /* panel-sm */
--tw-shadow:inset 0 0 0 …ring…, var(--cds-shadow-popover)     /* panel */
--tw-shadow:inset 0 0 0 1px var(--tw-shadow-color,var(--cds-border-strong))
--tw-shadow:inset 0 0 0 1px var(--tw-shadow-color,var(--cds-fill-field-ring))
--tw-shadow:inset 0 0 0 1px var(--tw-shadow-color,var(--cds-fill-secondary-ring)), 0 1px 2px 0 var(--tw-shadow-color,#0000000d)
--tw-shadow:inset 0 0 0 1px var(--tw-shadow-color,var(--cds-fill-secondary-pressed-ring)), 0 1px 2px 0 var(--tw-shadow-color,#0000000d)
--tw-shadow:0 0 0 2px var(--tw-shadow-color,var(--cds-gray-0)), 0 0 0 4px var(--tw-shadow-color,var(--cds-role-accent-700))
--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a)
```
> 「panel」类阴影统一是 **ring（内外）+ 一层材质阴影** 的三段组合：`inset ring-inner + ring-outer + shadow-sm|popover`。

---

## 6. 动效

### 6.1 全部缓动曲线（实测去重，来源 MW）

| 曲线 | 令牌 / 出处 |
|---|---|
| `cubic-bezier(.165, .84, .44, 1)` | **`--cds-ease-out`**（MW `.cds-root`） |
| `cubic-bezier(0, 0, .2, 1)` | `--cds-ease-out`（MW `:root`，旧路径） |
| `cubic-bezier(.165,.84,.44,1)` | `--cds-ease-out` 压缩写法 |
| `cubic-bezier(.32, .72, 0, 1)` | **`--cds-ease-snap`**（MW `.cds-root`） |
| `cubic-bezier(.34, 1.3, .64, 1)` | **`--cds-ease-overshoot`**（MW `.cds-root`，回弹） |
| `cubic-bezier(.4, 0, .2, 1)` | `--ease-in-out` / `--default-transition-timing-function`（Tailwind 默认） |
| `cubic-bezier(.4, 0, 1, 1)` | `--ease-in`（Tailwind 默认） |
| `cubic-bezier(.165,.85,.45,1)` | `--tw-ease`（`ease-[cubic-bezier(0.165,0.85,0.45,1)]` 工具类） |
| `cubic-bezier(.215,.61,.355,1)` | 工具类内联（easeOutCubic） |
| `cubic-bezier(.45,0,.55,1)` | 工具类内联（easeInOutQuad） |
| `cubic-bezier(.55,.055,.675,.19)` | 工具类内联（easeInCubic） |
| `cubic-bezier(.714,.121,.211,.888)` | 工具类内联 |
| `cubic-bezier(.4,.15,.6,.85)` | 工具类内联 |
| `linear(0, .2459, .6526, .9468, 1.0764, 1.0915, 1.0585, 1.0219, .9993, .9914, .9921, .9957, .9988, 1.0004, 1)` | **`--cds-btn-spring`**（MW `.cds-root`，15 点弹簧曲线） |

> **`--cds-btn-spring` 是本设计里最特别的一条**：用 `linear()` 采样了一条**带过冲（峰值 1.0915）后收敛**的弹簧曲线，用于按钮按下反馈。CSS `linear()` 是较新特性（Chrome 113+）。

### 6.2 时长令牌

| 令牌 | 值 | 来源 |
|---|---|---|
| `--cds-dur-fast` | `60ms` | MW `.cds-root` |
| `--cds-dur-snap` | `.12s` | MW `.cds-root` |
| `--cds-dur-base` | `.2s` | MW `.cds-root` |
| `--cds-dur-sheet` | `.3s` | MW `.cds-root` |
| `--cds-dur-slow` | `.45s` | MW `.cds-root` |
| `--default-transition-duration` | `.15s` | MW `@layer theme` |
| `--tw-duration` | `.15s` / `.1s` / `.2s` / `.3s` / `0s` / `initial` / `var(--cds-dur-fast)` / `var(--cds-dur-snap)` | MW utilities |

> **节奏层级**：fast 60ms（微反馈）→ snap 120ms（快速进出）→ base 200ms（默认）→ sheet 300ms（面板/抽屉）→ slow 450ms（大范围/弹簧）。

### 6.3 复合动效配方（实测原文）

```css
/* 气泡 pill 落位：先 overshoot 弹出，再 fade-in */
animation:cds-pill-pop-up var(--cds-dur-base) var(--cds-ease-overshoot), cds-fade-in var(--cds-dur-base) var(--cds-ease-out);
animation:cds-pill-pop-down calc(var(--cds-dur-base) * .6) var(--cds-ease-overshoot) calc(var(--cds-dur-base) * .4);  /* 延迟 80ms */
/* pill 沉浮：分两段，各占 (snap+40ms)/2 = 80ms */
animation:cds-pill-dip-up calc((var(--cds-dur-snap) + 40ms) / 2) var(--cds-ease-out) calc((var(--cds-dur-snap) + 40ms) / 2);
animation:… var(--cds-dur-snap) linear both;
/* 按钮弹簧 */
animation:… var(--cds-dur-slow) var(--cds-btn-spring);
```

### 6.4 按压变换（MW `.cds-root` / `.cds-btn-squish`）

```css
--cds-card-press-sx:.99;  --cds-card-press-sy:.99;   /* 卡片 */
--cds-btn-press-sx:.975;  --cds-btn-press-sy:.975;   /* 按钮（压得更狠） */
transform-origin:50%;
```

### 6.5 关键帧（MW，54 个，按族）

`cds-fade-in` · `spin` · `cds-shimmer` / `cds-shimmer-text-band(-rtl)(-strong)(-rtl)` / `cds-shimmer-text-shine…` · `cds-skeleton-breathe` / `cds-skeleton-sweep` · `cds-pill-in/out/up/down/dip-up/dip-down/pop-up/pop-down/roll-in-up/roll-in-down/roll-out` · `cds-chip-in` · `cds-morph-in` · `cds-reveal-in/out` · `cds-flipbook` · `cds-slide-in-start/end` · `cds-attachment-out` · `cds-dot-pulse` · `cds-drop-icon-rise` / `cds-drop-ring-in` · `cds-editor-comment-working` · `cds-grid-rows-in` · `cds-page-tabs-arrive` / `cds-page-title-leaves` · `cds-placeholder-reveal` · `cds-resolve-glyph` / `cds-resolve-square` · `cds-scroll-fade-top/bottom/left/right/strip-in/strip-out/strip-active/x-active/y-active` · `cds-sticky-edge-start/end/active` · `cds-working-dot-halo/lands/veil`

---

## 7. 消息气泡与会话专有令牌

### 7.1 用户点名的两个（实测）

```css
/* MW —— [data-cds=UserMessage], [data-cds=AssistantMessage][data-variant=bubble], …bubble-stack */
--cds-message-bubble-radius:calc(var(--cds-radius) + calc(.25rem * var(--cds-rem-scale,1)));
   /* comfortable: .5rem + .25rem = .75rem = 12px */
--cds-message-bubble-pad-x:var(--cds-pad-lg);   /* comfortable 1rem = 16px */
--cds-message-bubble-pad-y:var(--cds-pad-md);   /* comfortable .75rem = 12px */

/* MW .cds-root [data-cds=AssistantMessage][data-cds-bubble-stack] */
--cds-message-bubble-stack-gap:4px;
--cds-message-bubble-radius-meeting:4px;
--cds-message-bubble-radius-head:var(--cds-message-bubble-radius);
--cds-message-bubble-radius-foot:var(--cds-message-bubble-radius);

/* MW .cds-root [data-cds=AssistantMessage][data-variant=bubble] */
--cds-message-bubble-stack-gap:2px;   /* 单气泡模式 gap 更小 */

/* MW .cds-root [data-cds=MessageActions][data-reveal] */
--cds-message-actions-opacity:0;
opacity:var(--cds-message-actions-opacity);
scale:var(--cds-message-actions-reveal-scale);
transform-origin:var(--cds-message-actions-reveal-origin);
transition-property:opacity,scale;
transition-duration:var(--cds-message-actions-reveal-out-duration);
transition-timing-function:var(--cds-message-actions-reveal-out-ease);
```

`--cds-message-actions-opacity` 是**带 `@property` 注册的可动画数值**：
```css
/* MW */
@property --cds-message-actions-opacity{syntax:"<number>";inherits:true;initial-value:1}
```
> `initial-value:1`（默认可见），组件在 reveal 时覆写为 `0` 再过渡回 `1`。注册它才能让 `opacity:var(...)` 参与 transition。

### 7.2 会话动作显现（reveal）令牌（MW `.cds-root`）

```css
--cds-message-actions-reveal-in-duration:var(--cds-dur-snap);    /* .12s */
--cds-message-actions-reveal-in-ease:var(--cds-ease-snap);       /* cubic-bezier(.32,.72,0,1) */
--cds-message-actions-reveal-in-delay:.1s;
--cds-message-actions-reveal-out-duration:var(--cds-dur-fast);   /* 60ms */
--cds-message-actions-reveal-out-ease:var(--cds-ease-snap);
--cds-message-actions-reveal-out-delay:0s;
--cds-message-actions-reveal-scale:none;
--cds-message-actions-reveal-origin:top;
```
> **进慢出快**：进入 120ms + 100ms 延迟，退出 60ms 无延迟。这是「悬停显现」类交互的标准做法。

### 7.3 其余会话令牌（MW）

```css
--cds-message-bubble-item-gap:0px;
--cds-message-bubble-join-gap:min(8px, var(--cds-message-bubble-pad-y));
--cds-message-bubble-measure:85%;
--cds-message-bubble-measure:clamp(85%, 448px, 100%);   /* 窄屏改 clamp */
--cds-message-bubble-meet-above:calc(var(--cds-message-bubble-stack-gap) - var(--cds-message-bubble-item-gap));
--cds-message-bubble-meet-above:0px!important;
--cds-message-bubble-pad-block-start:var(--cds-message-bubble-radius-meeting);
--cds-assistant-message-text-inset:4px;                       /* 非气泡 */
--cds-assistant-message-text-inset:var(--cds-message-bubble-pad-x);  /* 气泡 */
--cds-assistant-message-text-stop:0px;
--cds-bg-user-message:var(--cds-bg-neutral);
--cds-bg-user-message-personal:var(--cds-bg-tint-blue);
--cds-text-user-message-personal:var(--cds-text-tint-blue);
--cds-attachment-vt-name:…（组件内）
--cds-badge-x-wght:577.8;   /* @property 注册，inherits:true */
```

---

## 8. 首帧与第一屏（实证）

来源：**HTML** = `x/.vite/renderer/main_window/index.html`

### 8.1 令牌作用域戳（stamp）—— 首帧即生效

```html
<!-- HTML:3-14 -->
<html class="cds-root" data-mode="system" data-density="comfortable" data-platform="desktop">
```
注释原文（HTML:3-8）：
> CDS token scope stamp, static so every CDS custom property resolves from the first frame (precedent: apps/claude-ai/index.html). `data-mode="system"` follows the app's saved theme via Electron's nativeTheme. **Deliberately no `data-font`, no CDS text color class, and no inline font size**: those change the document's inherited font and color. Add them only when this window's styles are CDS-based.

> **四个属性一次性决定全部令牌解析**：`cds-root`（组件作用域）、`data-mode=system`（跟随系统）、`data-density=comfortable`（step-4 尺度）、`data-platform=desktop`（光标约定：按钮箭头、链接手型）。

### 8.2 首帧背景规则（三处，unlayered 以压过 `@layer base`）

```css
/* HTML:100-127 —— 注释：these unlayered rules outrank that sheet's @layer base for the document's life */
html,body{ margin:0; padding:0; height:100%; }
body{ background-color:#fcfcfb; color:black; }
@media (prefers-color-scheme:dark){ body{ background-color:#151515; color:white; } }
body.darkTheme{ background-color:#151515; color:white; }
.nc-no-drag{ -webkit-app-region:no-drag; }  .nc-drag{ -webkit-app-region:drag; }
```
> **核实结果：亮 `#fcfcfb` / 暗 `#151515` 完全正确。** 且与 SH 的 `--claude-*-color` 由 `build/mainWindowFirstFrame.test.ts` 强制钉为相等（HTML:91-99 注释）。
> 注意这里颜色是**硬编码字面量**，不走 `var(--claude-background-color)` —— 因为这时 CSS 变量还没加载。

### 8.3 Boot placeholder 机制（第一帧真正看到的东西）

**启用条件**（HTML:48）：`placeholder.enabled !== true` 直接 return —— 即由 `globalThis.desktopBootPlaceholder` 注入，默认关闭。

**两个脚本，两阶段**：`<head>` 内以 `"head"` 调用（创建/测量），`<body>` 内以 `"body"` 调用（重绘）。判据：`root.getAttribute("data-boot-placeholder-frame") === "sidebar"`。

**测得的几何**（HTML:129-190）：

```css
html[data-boot-placeholder] body{
  background-color:#fcfcfb;
  --boot-placeholder-sidebar:color-mix(in srgb, #f9f9f7 50%, #fcfcfb);  /* #f9f9f7 = --cds-gray-20 */
  --boot-placeholder-seam:rgba(11, 11, 11, 0.1);    /* #0b0b0b = --cds-gray-900 */
  --boot-placeholder-row:rgba(11, 11, 11, 0.05);
}
@media (prefers-color-scheme:dark){
  html[data-boot-placeholder] body{
    background-color:#151515;
    --boot-placeholder-sidebar:color-mix(in srgb, #151515 80%, black);  /* = #111111 */
    --boot-placeholder-seam:rgba(255, 255, 255, 0.1);
    --boot-placeholder-row:rgba(255, 255, 255, 0.075);
  }
}
html[data-boot-placeholder] body.darkTheme{ …同上暗色… }

#boot-placeholder-sidebar{
  display:none; position:fixed; top:0; bottom:0; left:0;
  width:var(--boot-placeholder-sidebar-width);
  box-sizing:border-box;
  border-right:calc(0.5px * var(--boot-placeholder-scale, 1)) solid var(--boot-placeholder-seam);
  background-color:var(--boot-placeholder-sidebar);
  pointer-events:none; font-family:system-ui;
}
#boot-placeholder-sidebar-rows{ position:absolute; inset:0; overflow:hidden; }
#boot-placeholder-sidebar-rows > div{ position:absolute; background-color:var(--boot-placeholder-row); }

#boot-placeholder-drag-strip{
  display:none; position:fixed; top:0; left:0; right:0;
  height:calc(48px * var(--boot-placeholder-scale, 1));   /* ← 48px drag strip */
  -webkit-app-region:drag;
}
```

**关键数值**：

| 项 | 值 | 来源 |
|---|---|---|
| **48px drag strip** | `calc(48px * var(--boot-placeholder-scale, 1))` | HTML:184 |
| **sidebarWidth 默认值** | **未找到硬编码默认值** —— 由 `frame.sidebarWidth * scale` 运行时计算后写入 `--boot-placeholder-sidebar-width` | HTML:78-81 |
| **scale** | `frame.zoomFactor / placeholder.shellZoomFactor`，写入 `--boot-placeholder-scale` | HTML:64-76 |
| 骨架行 | `frame.shapes[]` 的 `{top,left,width,height,radius}` × scale，绝对定位 div | HTML:19-35 |
| 折叠阈值 | `frame.collapsed \|\| window.innerWidth / scale <= frame.narrowViewportMaxWidth` | HTML:73-75 |
| 侧栏底色（亮） | `color-mix(in srgb, #f9f9f7 50%, #fcfcfb)` ≈ `#faf9f8` | HTML:132 |
| 侧栏底色（暗） | `color-mix(in srgb, #151515 80%, black)` = `#111111` | HTML:139 |
| 分隔缝（亮/暗） | `rgba(11,11,11,.1)` / `rgba(255,255,255,.1)` | HTML:133 / 140 |
| 骨架行（亮/暗） | `rgba(11,11,11,.05)` / `rgba(255,255,255,.075)` | HTML:134 / 141 |
| 缝宽 | `calc(0.5px * var(--boot-placeholder-scale,1))` —— **半像素发丝线** | HTML:158 |

> **`sidebarWidth 没有静态默认值`**：这是明确结论。它完全由 Electron 主进程通过 `globalThis.desktopBootPlaceholder.frame.sidebarWidth` 传递，JS 计算后才 setProperty。静态 CSS 里只有 `width:var(--boot-placeholder-sidebar-width)`（未设置时该变量为空 → 宽度 0，且此时 `display:none` 也不会显示）。

### 8.4 首帧完整时序

1. `<html>` 带 4 个令牌属性 → 所有 CDS 变量可解析
2. `<head>` 内联 `<style>`：`body` 硬编码 `#fcfcfb`/`#151515`（按 `prefers-color-scheme`）
3. head 脚本：若 `enabled`，写 `data-boot-placeholder`、`data-boot-placeholder-drag`、`--boot-placeholder-scale`、`--boot-placeholder-sidebar-width`、`data-boot-placeholder-frame`
4. body 脚本：按 stamped scale 重绘骨架行
5. `#boot-placeholder-sidebar`（`display:block` 当 `frame="sidebar"`）+ `#boot-placeholder-drag-strip`（48px）
6. 加载 `assets/main-GXcWsgXC.js` → `windowBaseCore` 加 `.darkTheme` → `MainWindowPage` chunk 带来 Tailwind/CDS + 字体
7. 出错时：`body:has([data-load-error-overlay]) #boot-placeholder-sidebar{ display:none }`（HTML:166-168）让位给错误浮层

---

## 9. CSS 层级架构

### 9.1 `@layer` 顺序（实测，按 MW 文件字节偏移）

```css
/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
```

| # | 层 | 起始字节 | 职责 |
|---|---|---|---|
| 1 | **`properties`** | 66 | `@property` 注册（CDS 的 `--cds-*` + Tailwind 的 `--tw-*`，共 20+30 条），包裹在 `@supports` 特性探测里 |
| 2 | **`cds-card`** | 2573 | CDS Card 组件的 `.cds-card-fill` 等底层填充规则 |
| 3 | **`theme`** | 4067 | Tailwind 主题变量（`--text-*` / `--spacing` / `--radius-*` / `--ease-*` / `--font-*`）与 CDS 桥接 |
| 4 | **`base`** | 5698 | preflight（`box-sizing`、`margin:0`、媒体元素 block）+ 遗留 `:root`/`.darkTheme` 调色板 + `--claude-*` |
| 5 | **`components`** | 19874 | CDS 组件规则 + 本文件的组件级样式 |
| 6 | **`utilities`** | 24059 | Tailwind 工具类（体积最大，占文件 ~90%） |

> **顺序语义**：数字越小优先级越低。`properties` 最低（它只注册类型，不产生样式）；`utilities` 最高（工具类必须能压过一切）。
>
> **`cds-card` 必须排第二（最低的样式层）** —— SH:18 与注释明确：
> ```css
> @layer cds-card;   /* 必须是第一行！ */
> ```
> SH:8-10 原文：「the bare `@layer cds-card;` line must stay first so that layer sorts lowest (packages/cds docs/getting-started.md section 2; **without it CdsRoot logs an error in dev**)」。
> 且 SH:11-12 补充：「the imports must come directly after it: **CSS ignores an `@import` that follows any statement other than `@charset` or an `@layer` declaration**」——这是 CSS 规范限制，顺序错了静默失败。

### 9.2 `@config "../tailwind.config.js"`（SH:27）说明什么

- Tailwind **v4 是 CSS-first** 配置（`@theme` 块），不再需要 JS 配置文件。
- 这一行是**向后兼容逃生舱**：继续加载 v3 时代的 `tailwind.config.js`，供「仍在使用其 theme 的 shell 样式」读取。
- SH:15-16 原文：「The legacy v3 JS config stays loaded via `@config` while shell styles still use its theme.」
- 配合 SH:44-65 的 `@theme` 块（`--color-gray-500` / `--color-blue-600` / `--font-sans` / `--font-mono`），作用是把 v3 的具体值**钉住**，防止 CDS 的 `theme.css` 重定义 ramps 后**静默改色**所有 forms 控件。
- SH:13-14 还指出：`theme.css` 自己会 import `tokens.css`，**此处不能重复 import tokens.css**，否则令牌集被打包两次。

> **一句话**：这一行代表该应用处于 **v3 → v4/CDS 迁移的中间态**，两套配置共存，靠显式的 pin 值维持旧界面像素不变。

### 9.3 `@property` 注册（MW `@layer properties`，实测）

CDS 侧（20 条，全部 `inherits:false` 除 sticky-edge 与两个 opacity）：
```css
@property --cds-message-actions-opacity{syntax:"<number>";inherits:true;initial-value:1}
@property --cds-badge-x-wght{syntax:"<number>";inherits:true;initial-value:577.8}
@property --cds-outset-x{…"<length-percentage>";inherits:false;initial-value:0}
@property --cds-scroll-fade-size{syntax:"<length>";inherits:false;initial-value:28px}
@property --cds-scroll-fade-{top,bottom,left,right}{…initial-value:0}
@property --cds-scroll-fade-{top,bottom,left,right}-raw{…initial-value:0}
@property --cds-scroll-fade-{y,x}-active{syntax:"<number>";…initial-value:0}
@property --cds-scroll-fade-{top,bottom,left,right}-on{syntax:"<number>";…initial-value:1}
@property --cds-scroll-fade-strip-{raw,active}{…initial-value:0}
@property --cds-sticky-edge-{start,end,active}{syntax:"<number>";inherits:true;initial-value:0}
```
Tailwind 侧 `--tw-*`（30+ 条，`syntax:"*"`）亦然。
包裹条件（MW 文件首行后）：
```css
@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))
```
> 这是 lightningcss 的**浏览器能力探测**：只在「支持 `-webkit-hyphens` 但不支持 `margin-trim`」或「Firefox 系」的引擎上注册。作用是避免 `@property` 在不支持的引擎上破坏继承。

### 9.4 `--lightningcss-light/dark` 与 `light-dark()`

```css
/* MW .cds-root 末尾 */
--lightningcss-light:initial; --lightningcss-dark: ; color-scheme:light
/* MW @media screen{[data-mode=dark]…} */
--lightningcss-light: ; --lightningcss-dark:initial; color-scheme:dark
```
> 这是 lightningcss 编译 `light-dark()` 函数时的**降级开关变量**。本文件 `grep -c 'light-dark'` = **0**（源码里的 `light-dark()` 已被完全展开成上述变量切换），所以**不需要**保留这两个变量以外的东西。

### 9.5 光标约定（platform 相关）

```css
/* MW .cds-root */
--cds-cursor-interactive:pointer;
```
LP:65-80 注释解释：CDS 在 `data-platform="desktop"` 下把交互光标解析为 `default`（**CDS 桌面约定：按钮箭头、链接手型**），而 Tailwind v3 preflight 给按钮 `pointer`。LP 把 `button:not(:disabled),[role=button]:not(:disabled){cursor:pointer}` 钉回来，保旧界面。

### 9.6 LP 其余 pin（迁移期补丁，照抄时**不要**复制）

| Pin | 值 | 原因（LP 原文） |
|---|---|---|
| `html.cds-root[data-mode]{color-scheme:normal}` | 覆盖 tokens.css 的 light/dark | 遗留文档假设默认 `normal` |
| `html.cds-root[data-mode]{font-variation-settings:normal}` | 关闭暗色字重补偿 | 遗留文本不需补偿 |
| `html:where(.cds-root) *{border-color:currentColor}` | 恢复 v3 默认 | palette 无 border DEFAULT |
| `.rounded{border-radius:.25rem}` | 4px（非 `--cds-radius` 8px） | v3 时代值 |
| `.font-bold{font-weight:700}` / `.font-semibold{600}` | 非 CDS 的 600/580 | v3 时代值 |
| `.font-mono{ui-monospace,SFMono-Regular,…}` | 不含 Anthropic Mono | v3 时代栈 |
| `.space-y-2 > :not([hidden]) ~ :not([hidden]){margin-top:.5rem}` | v3 的兄弟 margin-top | v4 改成 margin-bottom 语义 |

---

## 10. 其他窗口的独立令牌（非 CDS，仅供对照）

### 10.1 Buddy Window（BW，完全独立的小令牌集）

```css
:root{ --cream:#f4f3ee; --clay:#d97757; --clay-hover:#c86848;
       --ink:#2d2d2d; --ink-dim:#6b6862; --line:#2d2d2d1a;
       --ok:#2d7a3e; --err:#b33a3a; }
.buddy-body{ background:var(--cream); color:var(--ink); }
.buddy-stick{ background:linear-gradient(145deg,#f47b3e,#e8652a); border-radius:16px;
  width:115px; height:245px; padding:15px 19px 0;
  box-shadow:0 6px 20px #e8652a38, 0 2px 4px #0000001f, inset 0 1px #fff3; }
.buddy-card{ border:1px solid var(--line); background:#fff; border-radius:10px; }
.buddy-overlay pre{ … font-size:11px; } .buddy-overlay code{ … font-size:12px; }
--font-anthropic-sans:"anthropic-sans", ui-sans-serif, …（同主窗口）
```
> **`--clay:#d97757` 与主窗口 `--cds-clay` / `--accent-brand` 完全一致** —— 品牌橙三处对齐。

### 10.2 clawdQuest Engine（CQ，游戏内 UI，独立令牌）

| 令牌 | 亮 | 暗 |
|---|---|---|
| `--cq-bg` | `#faf9f5` | `#171717` |
| `--cq-bg-rgb` | `250,249,245` | `23,23,23` |
| `--cq-panel` | `#fffffff7` | `#1a1a1af7` |
| `--cq-chip` | `#ffffffe6` | `#1a1a1aeb` |
| `--cq-btn` | `#f1eee6` | `#262626` |
| `--cq-btn-active` | `#e5e1d7` | `#363636` |
| `--cq-ink` | `#2b2a27` | `#d8d8d8` |
| `--cq-ink-soft` | `#6f6c64` | `#8a8a8a` |
| `--cq-ink-faint` | `#9e9a90` | `#555` |
| `--cq-line` | `#dfdbd1` | `#333` |
| `--cq-line-2` | `#d6d2c7` | `#3a3a3a` |
| `--cq-line-3` | `#b7b3a8` | `#555` |
| `--cq-font-sans` | `"Anthropic Sans", system-ui, sans-serif` | `anthropic-sans, system-ui, sans-serif` |
| `--cq-font-serif` | `"Anthropic Serif", Georgia, serif` | `anthropic-serif, Georgia, serif` |
| `--cq-font-mono` | `"Anthropic Mono", ui-monospace, Menlo, monospace` | `anthropic-mono, "SF Mono", ui-monospace, Menlo, monospace` |

> **注意字形名的两种写法并存**：`"Anthropic Sans"`（带空格，CSS 字符串）与 `anthropic-sans`（连字符，裸标识符）。后者才是 `@font-face` 注册的 family 名。前者是**无效回退**。

---

## 11. 未找到 / 需说明的项

| 项 | 状态 |
|---|---|
| `--cds-rem-scale` 的**定义** | **未找到** —— 全仓库 0 处定义，只作为 `var(--cds-rem-scale,1)` 被消费。宿主注入钩子。 |
| `--font-opsz-axis` 的定义 | **未找到** —— 只有 `var(--font-opsz-axis,)` 空 fallback 消费 |
| `--cds-font-grad`（无后缀）的定义 | **未找到** —— 只有 `var(--cds-font-grad,0)`；定义了 `--cds-font-grad-semibold:180` / `-bold:200` |
| `--font-anthropicons` 的定义 | **未找到** —— 只有 `var(--font-anthropicons,Anthropicons-Variable)` 消费；字体定义在 FIP |
| `--font-anthropic-mono` 的定义 | **未找到** —— 只在 `var(--font-anthropic-mono,"SF Mono")` 中以 fallback 形式出现 |
| `--font-anthropic-sans-display` 的定义 | **未找到**（只作为 `var()` 的第一参数出现） |
| `--claude-text-500` 的**亮色**值 | **未找到** —— 仅在两个暗色块中为 `#a6a39b` |
| `compact` / `spacious` 密度档 | **未找到** —— 全仓库仅 `comfortable` |
| `light-dark()` 函数 | **未找到** —— 源文件 0 处，已被 lightningcss 完全展开为 `--lightningcss-light/dark` 变量 |
| `[data-mode=light]` 主动定义令牌的块 | **未找到** —— 29 处全在 `:not()` 内 |
| `--cds-switch-h` 在 comfortable 块的值 | **未找到**（仅在 `.cds-root` 默认块与 `--xs/--sm` 变体有值） |
| `tailwind.config.js` 本体 | **未找到**（未随 asar 解出到 `x/.vite/renderer/`） |
| `@ant/cds/root-weight-pin.css` 内容 | **未找到**（仅见 SH:25 的 import 语句） |
| `@ant/cds/theme.css` / `tokens.css` 源码 | **未找到**（已编译进 MW） |
| `--cds-fill-git-draft-hover` 的正常值 | **异常** —— 实测为 `gray`（CSS 关键字），疑为 bug |

---

## 12. 最小可照抄实现骨架

```css
/* ── 1. 层序（必须） ───────────────────────────── */
@layer cds-card;            /* 必须是第一条语句，否则 CdsRoot 报错 */
@import "tailwindcss";
@import "@ant/cds/theme.css";
@config "../tailwind.config.js";

/* ── 2. 原色阶（模式无关） ─────────────────────── */
:where(:root,:host){
  --cds-gray-0:#fff; --cds-gray-10:#fcfcfb; … --cds-gray-900:#0b0b0b;
  --cds-blue-0:#fff; … --cds-blue-900:#0b0b0b;     /* 8 族同构 */
  --cds-role-accent-fill:var(--cds-role-accent-450);
}

/* ── 3. 组件根：亮色默认 ───────────────────────── */
.cds-root{
  --lightningcss-light:initial; --lightningcss-dark: ; color-scheme:light;
  --cds-neutral-0:var(--cds-gray-0); … --cds-neutral-900:var(--cds-gray-900);
  --cds-alpha-1:hsl(from var(--cds-neutral-900) h s l / 5%); … -9:…/95%;
  --cds-surface-0:var(--cds-gray-20); … --cds-surface-3:var(--cds-gray-0);
  --cds-page-bg:var(--cds-surface-0); --cds-border:var(--cds-alpha-2);
  --cds-ring-outer:1px; --cds-ring-inner:0px; --cds-ring-color:var(--cds-border);
  --cds-ease-out:cubic-bezier(.165,.84,.44,1);
  --cds-ease-snap:cubic-bezier(.32,.72,0,1);
  --cds-ease-overshoot:cubic-bezier(.34,1.3,.64,1);
  --cds-dur-fast:60ms; --cds-dur-snap:.12s; --cds-dur-base:.2s;
  --cds-dur-sheet:.3s; --cds-dur-slow:.45s;
  --cds-btn-spring:linear(0,.2459,.6526,.9468,1.0764,1.0915,1.0585,1.0219,.9993,.9914,.9921,.9957,.9988,1.0004,1);
  --cds-font-sans:var(--font-anthropic-sans,var(--cds-font-system)), var(--cds-font-system);
  --cds-font-weight-semibold:580; --cds-font-weight-bold:600;
}

/* ── 4. 暗色：纯覆盖（不是默认值！） ───────────── */
@media screen{
  [data-mode=dark] .cds-root:not([data-mode=light]):not([data-mode=system]),
  .cds-root[data-mode=dark]{
    --lightningcss-light: ; --lightningcss-dark:initial; color-scheme:dark;
    --cds-neutral-0:var(--cds-gray-900); … --cds-neutral-900:var(--cds-gray-0);  /* 镜像翻转，轴心 450 */
    --cds-surface-0:var(--cds-gray-900); --cds-surface-1:var(--cds-gray-850);
    --cds-surface-2:var(--cds-gray-830); --cds-surface-3:var(--cds-gray-800);
    --cds-ring-outer:0px; --cds-ring-inner:1px;                                   /* 内外反转 */
    --cds-shadow-color:#0000003d;
    --cds-font-wght-regular:"wght" 360; … --cds-font-wght-bold:"wght" 560;        /* 减重补偿 */
  }
}
@media screen and (prefers-color-scheme:dark){
  [data-mode=system] .cds-root:not([data-mode=light]):not([data-mode=dark]),
  .cds-root[data-mode=system], .cds-root:not([data-mode]):not([data-mode] *){ …同上… }
}

/* ── 5. 密度：comfortable ≡ step-4 ─────────────── */
.cds-root[data-density=comfortable]{
  --cds-radius:calc(.5rem * var(--cds-rem-scale,1));        /* 8px  */
  --cds-h-control:calc(2rem * var(--cds-rem-scale,1));      /* 32px */
  --cds-icon:calc(1.25rem * var(--cds-rem-scale,1));        /* 20px */
  --cds-pad-xs:calc(.375rem * …); --cds-pad-sm:calc(.5rem * …);
  --cds-pad-md:calc(.75rem * …);  --cds-pad-lg:calc(1rem * …);  --cds-pad-xl:calc(1.5rem * …);
  --cds-gap-xs:calc(.5rem * …); … --cds-gap-xl:calc(2.5rem * …);
  --cds-font-size-body:calc(.875rem * …);  --cds-leading-body:calc(1.25rem * …);
  --cds-font-size-prose:1rem;              --cds-leading-prose:1.5rem;   /* 不缩放 */
}

/* ── 6. 首帧（HTML 内联，unlayered） ───────────── */
/* <html class="cds-root" data-mode="system" data-density="comfortable" data-platform="desktop"> */
/* body{background:#fcfcfb;color:black} */
/* @media (prefers-color-scheme:dark){body{background:#151515;color:white}} */
```

---

## 附：本次抽取的方法与校验

- 解析脚本 `/tmp/claude-rea/parse2.mjs`：剥离注释 → 括号栈跟踪 → 每条声明绑定**完整选择器栈**（含 `@media` / `@supports` 外层），输出 `decls.json`（MW 2842 条声明，其中 2188 条自定义属性，185 个不同的定义选择器）。
- 密度与 step 的等价关系用 `decls.json` 逐键（17 个键）比对验证，输出 `diffs: 0` / `diffs: 0`。
- HSL→hex 换算用 `colorsys.hls_to_rgb` 脚本（`/tmp/claude-rea/hsl.py`）生成，未手算。
- alpha 合成换算为近似值（叠放底色依赖具体上下文），已在表中注明。
- 暗色覆盖块的字节偏移（186213 / 194952 / 211072）经三次独立抽取确认内容一致。
- **声明级自检**：`/tmp/claude-rea/verify.sh` + `verify2.sh` 对报告中 35 条**具体数值主张**逐一 grep 回原文件比对，全部通过（`ALL VERIFIED`）。注意 SH 与 HTML 是**格式化**文本（`--accent-brand: 15 63.1% 59.6%` 带空格），MW 是**压缩**文本（`--accent-brand:15 63.1% 59.6%` 无空格），校验时需先归一化冒号后空白——这也是照抄时容易被编辑器自动格式化坑到的地方。
- **色阶/翻转轴的枚举校验**：9 个色族逐族枚举，全部 35 级且阶梯与 gray 完全一致；35 个 neutral 令牌逐键比对亮暗，确认**唯一不动点是 450**（非 500）。
- 与 `out/00-master-evidence.md` 的两处冲突已在正文 §1.3 / §1.11 中显式标注，未静默采信任一侧。
