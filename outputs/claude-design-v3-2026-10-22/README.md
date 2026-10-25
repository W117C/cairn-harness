# Claude Desktop v3 设计复核（第二轮 · 2026-10-22）

> 目的：**扩展**上一轮的语料（`outputs/claude-design-v3-2026-10-21/`），不是重做它。
> 上一轮把 904 个 `--cds-*` 令牌抽成了「同名取首次出现」的字面表；这一轮补的是它**缺的那一维**：
> **作用域**（哪个值在哪个作用域生效）与**我们仓里还没吸收的族**。

## 一、对象身份（现读，REA）

| 项 | 值 |
|---|---|
| 应用 | `/Applications/Claude.app`（版本 **3.1623.0**，与设计规范已引的版本同号 ⇒ 无版本漂移） |
| 归档 | `Contents/Resources/app.asar` |
| asar sha256 | `760e7cbb6f861f0bc0e71e71fd9c6b721ba735f0f638b6ea623645daff4261a7`（与上一轮同值 ⇒ 语料仍有效） |
| 主窗口 CSS | `.vite/renderer/main_window/assets/MainWindowPage-Bbug2Ph5.css`（233,932 B） |
| REA 证据 | `open_binary` → sha 如上；`extract_artifact` → `ev_ef86b32224afc23aae16f887f2c3c94f0699420fe7c8ea9dd42547a18c1ac571`（575 节点 / 601 occurrences / 600 edges；8 条完整性矛盾＝解包原生二进制 + 去签名，与上一轮同型） |

`extract_artifact` 的产物目录是 REA 自建的临时目录（`/var/folders/…/rea-extracted-…`），
**不留存**⇒ 本轮另写了一个可复跑的只读抽取器（不执行 Claude 任何代码）：
`extract-axis-and-gaps.mjs`（直接解 asar 头 + 取 CSS 文本 + 逐规则解析作用域）。

```
node outputs/claude-design-v3-2026-10-22/extract-axis-and-gaps.mjs
# ⇒ axis-and-gaps.json（本页所有读数的机器可读形态）
```

## 二、本轮新读数：字重轴是**两套作用域**，不是一套

上一轮的 `tokens-v3.json` 把 `--cds-font-wght-regular` 记成 `normal`（首次出现处），
把 `"wght" 360` 记成另一条 ⇒ **暗色轴在旧表里读不出来**。这一轮按规则逐条解析作用域后：

| 作用域 | 令牌 | 值 |
|---|---|---|
| 亮色（`:root` / `.cds-root`） | `--cds-font-weight-regular / medium / semibold / bold` | **400 / 500 / 580 / 600** |
| 暗色（`[data-mode=dark] .cds-root`） | `--cds-font-wght-regular / medium / semibold / bold` | **"wght" 360 / 460 / 540 / 560** |
| 暗色（`prefers-color-scheme:dark` + `[data-mode=system]`） | 同上 | **同上** |
| 暗色（`.cds-dark-scope[data-mode=dark]`） | 同上 | **同上** |

⇒ 亮色用**静态字重**、暗色换**可变字体轴实例**；暗色四档相对亮色**各减 40**
（400→360、500→460、580→540、600→560），**不是**「逐档减 20」。
`semibold = 580`（亮色）本身就是非标准档（不是 600）。

## 三、我们仓里的偏差（本轮已修的那一处）

`apps/desktop/src/renderer/tokens.css` 的暗色块此前写的是 **360 / 480 / 560 / 580**。
对照上表：只有 `regular` 拿到了实测补偿；`medium`/`semibold`/`bold` 是作者按「逐档减 20」补的
——而 `semibold: 560` 恰好等于蓝本**亮色 semibold**的值、`bold: 580` 等于蓝本**亮色 semibold**的值，
⇒ **最重的两档在暗色里几乎没减重**（补偿只落在两档上）。

本轮按实测改齐为 **360 / 460 / 540 / 560**（四档各减 40），并把判卷（`apps/desktop/tests/tokens.test.ts`）
钉成「四档各减 40」这条规则（`heavy` 是 Cairn 自有档，蓝本无对应物，不参与该断言）。

⚠️ **口径（不许被读成「渲染结果与 Claude 一致」）**：360/460/540/560 是 **Anthropic 字体的轴取值**；
本仓用**系统栈**（设计规范 §4.3 裁决：不做自研字体）⇒ 实际渲染出的字重由系统字体匹配决定。
本轮对齐的是**档位映射与补偿规则**，不是渲染结果。设计规范 §4.3 那句「不复制 Anthropic 可变字重轴」
已按事实更正（字体栈不变，字重档位照实测落齐）。

## 四、还没吸收的族（下一轮的候选清单）

`axis-and-gaps.json` 的 `gapTable` 逐族给了蓝本条数与样例。**同义面一列是名字根的粗判**（不是等价证明），
真伪要各自量：

| 族 | 蓝本条数 | 我们的现状（现读） |
|---|---|---|
| `--cds-leading-*`（行高刻度） | 78 | **我们零行高令牌**：`styles.css` 里 51 处裸 `line-height`（蓝本把行高跟字号成对定义） |
| `--cds-z-*`（层叠刻度） | 5（coachmark 35 / modal 40 / popover 50 / tooltip 50 / toast 60） | **我们无层叠刻度**：`styles.css` 里 23 处裸 `z-index`（2…200，含 115/116 这种贴脸值） |
| `--cds-gap-*` / `--cds-pad-*` | 10 / 85 | 我们有 `--s-*` 间距刻度（4/8/12/16/24/32），蓝本是 5 档 × 密度变体 |
| `--cds-message-bubble-*` | 4 | 我们有 `--radius-composer`（气泡圆角） |
| `--cds-message-actions-*` | 18 | 我们有消息操作条，但无蓝本那套显隐动效令牌（reveal-in/out delay/duration/ease） |
| `--cds-font-size-*` | 98 | 我们有 `--fs-*`（caption 四档 + body 四档 + title/prose） |

⇒ 下一轮最值当的两格：**行高刻度**（排版第一观感面，我们零令牌）与**层叠刻度**（23 处裸值有贴脸冲突）。
两格都是「加一小组令牌 + 收一处裸值」，不需要改结构。

## 五、REA 的已知阻塞（现读，附本轮新数据）

主进程 JS 图仍读不动（上一轮结论：worker 堆耗尽）。本轮量到解包后的 **renderer** 资产大小，
给下一轮一条更小的入口：

| 资产 | 大小 |
|---|---|
| `clawdQuestEngine-D_0Q_rSd.js` | 1,232,059 B |
| `attachReactWithSelector-Cf2vt4U-.js` | 183,023 B |
| `main-uIZ6_Spc.js` | 85,466 B |
| `react-intl-BNigumQn.js` | 56,287 B |
| `MainWindowPage-CkTqJGUa.js` | 11,544 B |

⇒ 下一轮走 **per-module** 路（`analyze_javascript_application` + `source_paths` 逐模块），
先吃 `MainWindowPage-CkTqJGUa.js`（11 KB）与 `main-uIZ6_Spc.js`（85 KB），
而不是整包 7 MB 的入口 chunk。`renderers` 目录另有 `about_window / buddy_window / file_viewer /
find_in_page / local_exec_consent / quick_window` 六个窗口面。

## 六、Assets.car：品牌珊瑚是 **Display P3** 存的（REA 现读，2026-10-22 第二轮加读）

上一轮只读了 asar 里的 CSS；这一轮把 REA 的对象扩到 app bundle 本身
（`open_binary` → `/Applications/Claude.app/Contents/MacOS/Claude`，mach-o arm64，
sha256 `9cda504cf0bf64709e2da71f4cecd7dbd5b523273603abd231dcbe83d9cccb22`），
`inspect_asset_catalog` 读 `Contents/Resources/Assets.car`
（sha256 `e4e15f7cf96c3244350ed3ffb15d0842fecbca4342b98ea965afc2691f902d10`，**32 条记录**，
catalog 记录里带 `Appearances: {ISAppearanceTintable, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSAppearanceNameSystem}`）。
REA 证据：`ev_44a634901452f1da7b398ba68eff33c23b8b0ee955fd19f239c37c28a645ca7f`（shipped-artifact 权威）。

**读数（逐条分量，非抄 hex）**：

| 资产 | 分量 | 色彩空间 | 按 sRGB 解释等于 |
|---|---|---|---|
| `Claude_Assets/Color-1` | [1, 1] | extended gray | #FFFFFF |
| `Claude_Assets/Color-2` | [0.851, 0.467, 0.341] | **p3** | **#E8704E** |
| `Claude_Assets/Color-3` | [0.859, 0.408, 0.263] | **p3** | #E4683B |
| `Claude_Assets/Color-4` | [0.192, 1] | gray gamma 22 | 灰 |

⇒ **`Color-2` 的 P3 分量在 P3 屏上呈现为 `#D97757`**（本仓 `--accent-brand` 的取值），
但在 sRGB 屏上只呈现为 `#E8704E`（更橙、更饱和）。
⇒ 推论：Claude 的品牌珊瑚是**宽色域原生**的；本仓令牌写的是 sRGB `#D97757`
（`--accent-brand: 15 63.1% 59.6%`），**在宽色域屏上比 Claude 淡**。
⇒ 现读本仓令牌文件里 `color(` / `display-p3` 命中 **0** ⇒ 整个色板只说 sRGB。

**这一格本轮只登记、不动令牌**：改品牌珊瑚会牵动 role-accent 全族与对比度判卷，
不是「顺手换一个 hex」的量级；下一片要么显式给 P3 变体（`color(display-p3 …)` ＋ sRGB 回退），
要么明确接受 sRGB 差异 —— 两个选项都要先过对比度那把尺。
