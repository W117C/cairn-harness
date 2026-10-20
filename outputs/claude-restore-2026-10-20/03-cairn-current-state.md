# Cairn 桌面端 · 当前实现 vs 设计规范 §1–§9 完成度审计

> 审计日期：2026-10-20（工作树快照，含在飞未提交改动）
> 审计对象：`apps/desktop/`（renderer 层为主，main 层只查后端通道是否接通）
> 规范来源：`apps/desktop/design/desktop-design-spec.md`（1908 行）
> 纪律：只读审计，未修改任何文件、未做 git 操作。每条判定带 `file:line`。规范值与实测值不一致时两个数都写。
> 注：工作树有大量在飞改动（`git status --porcelain` 显示 renderer/App.tsx、Composer.tsx、ModelPicker.tsx、PopoutApp.tsx、projections.ts 等 `M`），下列行号对应**此刻磁盘内容**。

---

## 0. 结论速览（缺口优先排序 · 按"离 Claude 还原目标影响最大"）

| 排序 | 缺口 | 影响面 | 判定 |
|---|---|---|---|
| **G1** | **插件（mod）侧栏完全不存在**：无 280px 侧栏、无 `Option+Cmd+B`、无消息框上方按钮带 | §3.11 两项 + §3.4 结构面。Claude 桌面端的右栏 mod 面板是标志性形态 | **未实现** |
| **G2** | **双轴变体（组件尺寸轴 --sm/--md/--lg）零实现**：只有文字轴 `--rem-scale` | §4.5 尾"组件尺寸与用户字号各调各的"——现在改字号会连控件一起放大，正是规范要防的 | **未实现** |
| **G3** | **`--alpha-*` 不是从单一基色派生**（10 条手写字面透明度，且暗色块未重定义） | §4.2 明文"全部从单一基色派生（`hsl(from …)`），不手写 10 个值" | **实现但与规范不符** |
| **G4** | **Git worktree 会话隔离**：全仓 `worktree` 未进 `apps/desktop/src/`；`.worktreeinclude` 无实现 | §3.7 表"并行会话可选 worktree" | **未实现** |
| **G5** | **跨面接力（§3.9）无"Open in → CLI"入口**；会话菜单只有 6 项（置顶/重命名/分叉/归档/删除） | §5.1-6 必抄条 | **未实现** |
| **G6** | **消息操作条缺 `pin` 与时间恒显**：pin 无实现、time 只有 hover 才出（§9 2026-10-15 第 1 条明确把时间戳改成"hover/活跃才显"） | §3.11 "copy / branch / pin / read aloud / time" | **部分实现** |
| **G7** | **侧栏宽度实际域 240–280、缺省 240**，规范要求"把手停在 242px" | §3.11 | **实现但与规范不符（有据偏差）** |
| **G8** | **`--text-100` 未定义但被 styles.css 两处引用**（悬空 var → 继承色） | §4.1 | **实现但与规范不符** |
| **G9** | **`--success` 值与规范表不符**（`#15803D` / `#4ADE80` vs 规范 `103 72.3% 26.9%` / `97 75% 32.9%`） | §4.1 | **实现但与规范不符** |
| **G10** | **双向断路器（§2.2）在 desktop 层无痕迹** | §5.1-3 必抄条的"自动档退路" | **未找到实现证据** |

**完成度粗估**：令牌层 ≈ 82%｜布局密度 ≈ 74%｜组件清单 ≈ 90%｜§5.1 必抄 8 条 ≈ 6/8 落地｜§3 UI 与交互 ≈ 71%。加权总评 **≈ 76%**（详见 §6）。

---

## 1. 令牌层（规范 §4）——逐条核对 `tokens.css`

### 1.1 语义令牌存在性

| 令牌 | 规范要求 | tokens.css 实测 | 判定 |
|---|---|---|---|
| `--bg-000` | `#FFFFFF` / `#30302E` | ✅ `:root` L48 / dark L262 | 已实现 |
| `--bg-100` | `#FAF9F5` / `#262624` | ✅ L49 / L263 | 已实现 |
| `--bg-200` | `#F5F4ED` / `#1F1E1D` | ✅ L50 / L264 | 已实现 |
| `--bg-300` | `#F0EEE6` / `#141413` | ✅ L51 / L265 | 已实现 |
| `--bg-400/500` | `#E8E6DC` / `#000000` | ✅ L52–53 / L266–267 | 已实现 |
| `--text-000` | `#141413` / `#FAF9F5` | ✅ L59 / L271 | 已实现 |
| `--text-200/300` | `#3D3D3A` / `#C2C0B6` | ✅ L60–61 / L272–273 | 已实现 |
| `--text-400/500` | `#73726C` / `#9C9A92` | ⚠️ L62–63 实测 `#66655C`；dark L274–275 实测 `#A8A69E` | **偏差**（tokens.css:45–47 注释登记：原值过不了 4.5:1 闸，压暗/提亮；§9 在册） |
| `--accent-brand` | `#D97757` 双主题同值 | ✅ L66 `15 63.1% 59.6%` ≈ `#D97757`，dark 未重定义（同值） | 已实现 |
| `--accent-100/200` | `#2C84DB` | ✅ L69–70 `210 70.9% 51.6%` | 已实现 |
| `--accent-000` | `#1B67B2` / `#74ABE2` | ✅ L68 / L277 | 已实现 |
| `--accent-900` | `#D3E5F8` / `#1C3F62` | ✅ L71 / L278 | 已实现 |
| `--success` | `103 72.3% 26.9%` / `97 75% 32.9%` | ❌ L87 `142.4 71.8% 29.2%`（`#15803D`）／L290 `142 69.2% 58%`（`#4ADE80`） | **值与规范不符**（色相完全不同：规范是黄绿 103°/97°，实现是纯绿 142°） |
| **`--text-100`** | §4.1 表未列此令牌 | ❌ **未定义**，但 `styles.css:1315`、`:1804` 两处 `hsl(var(--text-100))` 引用 | **悬空引用**（拿不到值 → 该声明无效/继承） |
| `--bg-elevated` | 规范表未列，代码有 | ✅ L54 / L268（额外令牌，不违规） | 已实现（超集） |

### 1.2 alpha 阶（规范 §4.2 尾：`--alpha-0…9` 从单一基色派生）

| 项 | 规范要求 | 实测 | 判定 |
|---|---|---|---|
| `--alpha-0 … --alpha-9` 存在 | 10 枚 | ✅ 全部存在，`tokens.css:112–121` | 已实现（枚数） |
| 派生方式 | **"全部从单一基色派生（`hsl(from …)`），不手写 10 个值"** | ❌ 实测为**逐条手写**：`--alpha-0: hsl(var(--text-000) / 0%);` `--alpha-1: …/ 5%);` … `--alpha-9: …/ 95%);`（L112–121），全仓 `hsl(from` 出现次数 = **0** | **实现但与规范不符** |
| 百分比序列 | 0/5/10/20/35/50/60/70/85/95 | ✅ L112–121 完全一致 | 已实现 |
| 暗色块重定义 | 基色随主题自翻转 | ⚠️ `[data-theme="dark"]` 块（L261–314）**未重定义 alpha 阶**——但亮色块里基色写的是 `var(--text-000)`，暗色 `--text-000` 已在 L271 重定义为暖白 ⇒ 靠变量间接翻转成立 | 已实现（借道变量，非 `hsl(from)`） |

> 结论：功能等效（基色确为单一 `--text-000`，随主题翻转），但**写法违规范明文**——规范点名 `hsl(from …)` 并要求"不手写 10 个值"。属"实现但与规范不符"，非功能缺陷。

### 1.3 刻度与双轴

| 项 | 规范要求 | 实测 | 判定 |
|---|---|---|---|
| `--h-control` 五档 20/24/28/32/40 | §4.5 | ✅ `tokens.css:152–156`（xs/sm/md/lg/xl） | 已实现 |
| 嵌套控件高 1/1.125/1.25/1.375/1.75 | §4.5 | ✅ L159–163 | 已实现 |
| 圆角**四档** + composer 独立档 | §4.5"圆角四档、composer 圆角独立一档（.75–.875）" | ⚠️ L166–173 共 7 枚：`xs=6 / sm=6 / md=10 / lg=10 / composer=14 / pop=14 / field=8 / pill`。**xs 与 sm 同值、md 与 lg 同值 ⇒ 实为 3 个不同值 6/10/14**，规范要四档 | **部分实现**（缺第四档） |
| `--rem-scale` | §4.7 由 `html` 根 + settings 持有 | ✅ `tokens.css:125` + `:317–318`；`App.tsx:460–461` 写 `data-text-size` | 已实现 |
| **双轴变体：组件尺寸轴 `--sm/--md/--lg`** | §4.5 尾"每档出 `--sm/--md/--lg`（组件尺寸）与 `--textsm/--textmd/--textlg`（随用户字号）两套**正交**变体" | ❌ 全仓 grep `--sm/--md/--lg` 尺寸轴 = **0** 命中；`--textsm/textmd/textlg` = **0** 命中 | **未实现** |
| 双轴文字轴 | 同上 | ✅ 只有这一轴（`--rem-scale` 0.92/1/1.08，`tokens.css:317–318`） | 部分实现（只有一轴） |
| 输入框字号下限 16px（`--font-size-text-entry-floor`） | §4.4 尾 | ⚠️ 令牌改名为 `--fs-entry-floor: 16px`（`tokens.css:149`），且 grep 显示**无任何消费方** | **部分实现**（有令牌无消费） |
| 字号刻度 caption/body/heading/title/prose/footnote/code | §4.4 | ✅ L128–148 全在；但 caption 四档 `.625/.78125/.78125/.78125`（10/12.5/12.5/12.5），规范要 `.625/.6875/.75/.8125`（10/11/12/13） | **偏差**（caption 档被压平成 12.5） |
| 正文 14.5 / 行高 1.7 | §4.4 | ✅ `--fs-body-md: 0.90625rem`=14.5（L133）；`styles.css:14` 行高 1.7 | 已实现 |

### 1.4 字体体系（§4.3）

| 项 | 规范要求 | 实测 | 判定 |
|---|---|---|---|
| UI 系统栈 `ui-sans-serif, system-ui, -apple-system, "PingFang SC"` | §4.3 | ⚠️ `styles.css:14`：`-apple-system, "PingFang SC", "Segoe UI", system-ui, sans-serif`——**缺 `ui-sans-serif`**，多了 `Segoe UI` | 部分实现（同精神，字面不全） |
| 等宽 `ui-monospace, SFMono-Regular, Menlo` | §4.3 | ✅ `tokens.css:240` | 已实现 |
| lucide-react 图标 | D4 | ✅ `apps/desktop/package.json:25` `"lucide-react": "^1.56.0"` | 已实现 |
| 字重 400/500/600 | §4.3 | ✅ 代码中大量 `font-weight: 500/600` | 已实现 |

### 1.5 组件库（§6 / D4）

| 库 | 规范要求 | 实测 | 判定 |
|---|---|---|---|
| Radix Themes | 主库 | ✅ `package.json:20–21`（`@radix-ui/themes` + `react-dropdown-menu`） | 已实现 |
| lucide-react | 图标 | ✅ 同上 | 已实现 |
| cmdk | slash/命令 | ✅ `:24` | 已实现 |
| sonner | 回执 | ✅ `:29` | 已实现 |
| react-resizable-panels | 窗格拖拽 | ✅ `:28` | 已实现 |

### 1.6 令牌纪律（§4.7 / §8-2）

| 纪律 | 实测 | 判定 |
|---|---|---|
| 令牌单一源 | ✅ 色值只在 `tokens.css`；`styles.css` 中 6 位 hex 字面量计数 = **0** | 已实现 |
| 组件零色阶直引 | ✅ grep `var(--gray-` / `var(--orange-` 在 styles.css 与 components/*.tsx = **0** 命中 | 已实现 |
| alpha 阶消费面 | ✅ `styles.css` 中 `var(--alpha-` 出现 **79** 次 | 已实现 |

---

## 2. 布局与密度（§3.11 表）——逐项实测

| 部位 | 规范值 | 实测值 | 证据 | 判定 |
|---|---|---|---|---|
| 侧栏会话行高 | 26px | **26px** | `styles.css:259` `.session { height: 26px; }` | ✅ 一致 |
| 侧栏会话行字号 | 13px | **14.5px**（`--fs-body-md`） | `styles.css:260` `font-size: var(--fs-body-md)` → `tokens.css:133` `0.90625rem` | ❌ **偏差 13 vs 14.5** |
| 分组上留白 | 12px | **12px** | `styles.css:225` `.group-head { margin-top: 12px; }` | ✅ 一致 |
| 侧栏宽度（把手停位） | **242px** | **域 240–280，缺省 240** | `App.tsx:185` `Math.min(280, Math.max(240, raw))`；`App.tsx:187` 缺省 `return 240`；拖拽 `App.tsx:203` 同域 | ❌ **偏差 242 vs 240**（CSS 注释 `styles.css:94` 仍写"停在 242px"，与代码 240 自相矛盾） |
| 侧栏顶栏 | 48px | **48px** | `styles.css:110` `.side-head { height: 48px; }` | ✅ 一致 |
| 侧栏页脚 | 48px | **48px** | `styles.css:310` `.side-foot { height: 48px; }` | ✅ 一致 |
| 头像槽 | 22px | **26px** | `styles.css:316` `.avatar { width: 26px; height: 26px; }`；注释明写"26px 命中区更从容" | ❌ **偏差 22 vs 26**（有意放大，未登记 §9） |
| 页脚"头像 + 用户名 + 套餐" | 三项 | **只有头像 `Z` + 设置 + provider 点** | `Sidebar.tsx:690` `<button className="avatar">Z</button>`；`:676` 设置钮；`:682` provider-dot。**无用户名、无套餐** | ❌ **未实现**（缺用户名/套餐） |
| 聊天顶栏 | 26px | **26px** | `styles.css:334` `.chat-bar { height: 26px; }` | ✅ 一致 |
| 聊天气沟 | 左右各 41px | **左右 41px** | `styles.css:428` `.reading { padding: 24px 41px 48px; }`；`:747` `.zone-gate`、`:843` `.zone-composer` 同为 `0 41px` | ✅ 一致 |
| 回复右侧留白 | 最多 56px | **56px** | `styles.css:473` `padding-right: min(56px, 8%)` | ✅ 一致 |
| 消息操作条 | 渲染即挂载（禁延迟构建）；copy/branch/pin/read aloud/time | **挂载是渲染即挂载**（`.row-actions` 常驻 DOM，仅 `opacity:0`→hover 显，`styles.css:458–459`）；实现项：copy ✅（`Stream.tsx:224`）、branch ✅（`:456`）、read aloud ✅（`:245` `onSpeak`）、time ✅（`:49` `.row-time`）。**pin ❌ 未找到** | `Stream.tsx:218–268` | ⚠️ **部分实现**（缺 pin；time 仅 hover/活跃才显，见 §9 2026-10-15 第 1 条） |
| 工具行 / 状态行 | "Ran 4 commands" / "37s · 189 tokens · Thinking…" | **未找到该类形态**：流内只有思考行计时（`Stream.tsx:309` `{elapsed}s`）；步数/token 在 composer 的 meter 弹层里（`Composer.tsx:1097`、`:705`），不在消息行上 | `Stream.tsx` 全文件无 `tool-row`；`strings.ts:235/248` 只有 `{n} 步` / `步数` | ❌ **未实现**（状态行形态不在规范落点） |
| 输入框 8 行后滚动 | 约 8 行 | **8 行**（`calc(8 * 1.7 * var(--fs-body-md))`） | `styles.css:865`；JS 读该上限 `Composer.tsx:530` | ✅ 一致 |
| 末条消息下方 48px 留白 | 48px | **48px** | `styles.css:428` `padding: 24px 41px 48px` | ✅ 一致 |
| **插件（mod）侧栏最小 280px** | 280px | **未找到任何 mod/plugin 侧栏** | grep `mod-side` / `pluginSide` / `mod panel` 在 renderer 全树 = **0** 命中。280px 的两处命中都是别的东西：`styles.css:344` `.goal-chip { max-width: 280px }`、`styles.css:653` `.outline-panel { width: 280px }` | ❌ **未实现** |
| **插件侧栏"消息框上方一行按钮带"** | 有 | **未找到** | 同上 | ❌ **未实现** |
| `Cmd+B` 左栏 | 有 | ✅ **已实现** | `App.tsx:1983–1986` `case "KeyB": … else { h.toggleSidebar(); }` | ✅ 已实现 |
| `Option+Cmd+B` 插件侧栏 | 有 | ⚠️ **键接了，但落点是检查器不是插件侧栏** | `App.tsx:1984` `if (e.altKey) { h.toggleInspector(); }`；速查表 `shortcuts.ts:36` 写"⌘⌥B 开合检查器" | ❌ **语义不符**（规范要插件侧栏） |

**§3.11 计分：13 项中 8 项完全一致（行高 26 / 分组 12 / 顶栏 48 / 页脚 48 / 聊天顶栏 26 / 气沟 41 / 56 / 8 行 / 48 留白 = 9 项），偏差 4 项（字 13→14.5、宽 242→240、头像 22→26、⌘⌥B 语义），未实现 3 项（页脚用户名+套餐、工具/状态行、插件侧栏二件）。**

---

## 3. 组件清单（规范点名 vs `components/` 实际）

### 3.1 存在且已接通

| 规范点名的组件 | 文件 | 规模 | 判定 |
|---|---|---|---|
| Composer | `components/Composer.tsx` | 65KB（最大组件） | ✅ 已实现 |
| ModelPicker | `components/ModelPicker.tsx` | 22KB | ✅ 已实现 |
| ApprovalCard | `components/ApprovalCard.tsx` | 5.5KB | ✅ 已实现 |
| PlanCard | `components/PlanCard.tsx` | 3.4KB | ✅ 已实现 |
| DiffView | `components/DiffView.tsx` | 4.7KB | ✅ 已实现（含行级评注） |
| Inspector | `components/Inspector.tsx` | 7.7KB | ✅ 已实现（改动/计划/时间线三档） |
| FindBar | `components/FindBar.tsx` | 5.0KB | ✅ 已实现（⌘F / ⌘G / ⇧⌘G） |
| CommandPalette | `components/CommandPalette.tsx` | 8.9KB | ✅ 已实现（⌘K） |
| ProviderBanner | `components/ProviderBanner.tsx` | 0.9KB | ✅ 已实现（批 15） |
| Outline | `components/Outline.tsx` | 3.6KB | ✅ 已实现（对话目录） |
| PaneDock | `components/PaneDock.tsx` | 52KB | ✅ 已实现（七窗格宿主） |
| PopoutApp | `components/PopoutApp.tsx` | 3.1KB | ✅ 已实现（`#pane=` 路由独立窗） |
| SidechatPane | `components/SidechatPane.tsx` | 7.8KB | ✅ 已实现（旁路，⌘;） |
| SendQueueStrip | `components/SendQueueStrip.tsx` | 2.1KB | ✅ 已实现（含"打断并发送"） |
| Sidebar | `components/Sidebar.tsx` | 39KB | ✅ 已实现 |
| Stream | `components/Stream.tsx` | 31KB | ✅ 已实现 |
| SettingsPanel / settings-sections / settings-nav | 同名文件 | 17KB/31KB/4KB | ✅ 已实现 |
| AppPage（插件/自动化/技能/记忆四页） | `components/AppPage.tsx` | 47KB | ✅ 已实现 |
| ChangeSummaryCard / ClarifyCard / GoalChip / ErrorStrip / ToastHost / ConfirmDialog / ModalSurface / Popover / Switch / TitleBar / PermissionMenu / PathMenu / QuickStarts / CustomProviderForm / NewProjectDialog / AddProjectMenu / ImportDiagnosisCard / TimelinePane | 同名文件 | — | ✅ 均已实现 |

### 3.2 缺失 / 未落规范落点

| 规范要求的面 | 落点 | 实测 | 判定 |
|---|---|---|---|
| **插件（mod）侧栏** | §3.11 / §3.4 | 全树 0 命中 | ❌ 未实现 |
| **代码审阅卡片**（`/code-review` 形态：按文件分组 / "Walk through in diff" / "Fix this one" / "Apply fixes"） | §3.6 | grep `Walk through` / `Fix this one` / `Apply fixes` / `codeReview` 在 renderer 全树 = **0** 命中 | ❌ 未实现（§3.6 自注"有后端链路才开面"，`src/agent/diff-review.ts` 存在于 core，但桌面面未开） |
| **Task chip**（越界工作→新 worktree 新会话） | §3.7 | 规范自裁"不做（无越界检测消费方）" | ➖ 规范豁免 |
| **MCPB 单文件扩展** | §5.2 | 规范裁"原则做、形制不照搬" | ➖ 规范豁免 |
| **计算机控制** | §3.10 | 规范裁"不做" | ➖ 规范豁免 |
| PR 监控 / auto-fix CI / auto-merge | §3.6 | 规范裁"不做" | ➖ 规范豁免 |
| 跨会话通信 | §3.7 | 规范裁"留门不做" | ➖ 规范豁免 |

**组件清单计分：规范点名的 13 个核心组件（Composer/ModelPicker/ApprovalCard/PlanCard/DiffView/Inspector/FindBar/CommandPalette/ProviderBanner/Outline/PaneDock/PopoutApp 等）全部存在 ⇒ 12/12 命中。** 缺的是 §3.6 的"代码审阅卡"与 §3.11 的"插件侧栏"两个**面**，不是组件文件。

---

## 4. §5.1 必抄 8 条 —— 逐条判定

| # | 必抄条 | 规范落点 | 实现证据 | 判定 |
|---|---|---|---|---|
| **1** | 一个输入框承接对话与任务 | §3.1 单入口 | ✅ 无 tab；聊天与任务共享同一 Composer（`App.tsx:2249` 附近唯一 `.zone-composer`；`Composer.tsx:795` 单一 textarea） | **已实现** |
| **2** | 停止与插话分开 | §3.2 Enter=排队 / ■=中断 | ✅ 运行中回车=排队（`Composer.tsx:531` 起 `submit()`，`App.tsx:1538` 注释"打断/停止的唯一实现"）；停止=独立 `send-btn stop`（`Composer.tsx:1128`）+ `⌘.`（`App.tsx:2015–2018`）；`⌘↩` = 入队并打断（`shortcuts.ts:73`）；队列条 `SendQueueStrip.tsx:37`「打断并发送」 | **已实现** |
| **3** | 权限分档显式 + 自动档退路 | §2.2 四档 + 双向断路器 | ⚠️ **四档显式 ✅**：`PermissionMenu.tsx:39` `MODE_ORDER = ["read-only","default","guided","auto"]`；四色点 `PermissionMenu.tsx:25–28`；auto 带 `warn: true`（`:19`）。**双向断路器 ❌**：grep `断路器` / `circuit` / `breaker` 在 `apps/desktop/src` 与 `src/agent/security` = **0** 命中 | **部分实现**（档位齐，断路器无证据） |
| **4** | 计划与 diff 先看再执行；销毁类唯一硬否决 | §2.5 + §3.6 + §3.7 归档硬闸 | ✅ **PlanCard** `PlanCard.tsx` 需 `onDecide` 决议；**diff 审阅** `PaneDock.tsx:650–653` 评注 → `composeReviewMessage` → `onReview`；**归档硬闸** `App.tsx:1749–1752` `requestArchiveSession` 无条件弹确认（`:2873–2889` ModalSurface），与权限档无关；删除另设 confirm（`:1754`） | **已实现** |
| **5** | 上下文余量与 token 可见 | §3.7 用量环 + 状态条 | ✅ 用量环 `Composer.tsx:1068–1080`（`.usage-slot`），环心百分数（`Composer.tsx:34` 注释 + `tests/composer-usage-ring.test.tsx`）；明细弹层 `Composer.tsx:1091–1109`（输入/输出/缓存/轮数/步数/上下文）。⚠️ **"plan 用量跨面"（§3.7 表"context 用量按会话、plan 用量跨面"）未找到** | **部分实现**（context 环有，plan 跨面无） |
| **6** | 跨端接管 + 配置跨面共享 | §3.9（两面版）+ §1.2 | ❌ **"Open in → CLI"入口未找到**：grep `Open in` / `openInCli` 在 renderer = **0** 命中（唯一 `openIn` 是浏览器窗格的 `openIn(viewId,url)`，`PaneDock.tsx:110`，与 CLI 无关）；会话菜单只有 6 项（`Sidebar.tsx:186–194`：置顶/重命名/分叉/归档/删除）。配置跨面共享（settings 共享存储）✅ 隐含成立 | **未实现** |
| **7** | Side chat 不回写 | §3.7 表 | ✅ `SidechatPane.tsx` 独立窗格；promote 是唯一显式回写（`SidechatPane.tsx:73` `sidechatPromote`）；⌘; 开（`pane-shortcuts.ts:27`） | **已实现** |
| **8** | 令牌体系四件套 | §4 全章 | ⚠️ 见 §1：bg/text/accent/success 三族齐全（success 值偏），alpha 阶写法违规范，双轴只落一轴 | **部分实现** |

**§5.1 计分：完全落地 4 条（1/2/4/7），部分落地 3 条（3/5/8），未落地 1 条（6）⇒ 4.5/8。**

---

## 5. §3 各项 UI 与交互 —— 逐条判定

### 5.1 §3.1 应用外壳：单入口 —— **已实现**
- 无 tab ✅；外壳结构 TitleBar（`components/TitleBar.tsx`）/ 侧栏（`Sidebar.tsx`）/ 主区（`App.tsx:2173` `.side-wrap` + `:2230` `.chat-bar` + 流 + Composer）/ 窗格层（`PaneDock.tsx`）/ 整页应用（`AppPage.tsx` 插件·自动化·技能·记忆）✅
- 聊天与任务共享输入框 ✅

### 5.2 §3.2 会话模型与提示框 —— **大部分已实现**
| 子项 | 实测 | 判定 |
|---|---|---|
| 发送前配置都在提示区 | ✅ `Composer.tsx` row3：附件/技能/插件（＋菜单，`Composer.tsx:1` 注释"＋菜单四入口"）、Model（`ModelPicker`）、Permission mode（`PermissionMenu`，`ctl` 芯片） | 已实现 |
| Environment 不设假选择器 | ✅ grep `Environment` 在 Composer.tsx = 0 命中（Cairn 只有 Local，不摆选择器） | 已实现（规范正是要求不摆） |
| Project folder（含 worktree） | ⚠️ 项目选择有（`AddProjectMenu` / `NewProjectDialog`）；**worktree 无**（见 §5.7） | 部分 |
| Enter 发送 / 运行中回车=排队 | ✅ `Composer.tsx:531` | 已实现 |
| 停止 = 立即中断（■ / `Cmd+.`） | ✅ `Composer.tsx:1128`；`App.tsx:2015` | 已实现 |
| `+` 按钮：附件 / 技能 / 插件 | ✅ `Composer.tsx:1` 注释明写四入口；技能接斜杠（`slash.ts`） | 已实现 |
| `@文件名` mention | ✅ `mention.ts` + `Composer.tsx:419/866` | 已实现 |
| 拖放文件进提示框 | ✅ `styles.css:877` `.composer-card[data-dragging="true"]` | 已实现 |
| **建议提示：回复后空提示框灰字建议，Tab/右箭头接受** | ⚠️ **已实现但形态被业主改窄**：`Composer.tsx:501–502` 注释"建议不再常驻——空框空闲只摆 Tab 键帽；按 Tab 才出手"；`Composer.tsx:903` Tab 触发。规范原文"回复后在空提示框显示灰字建议" ⇒ **常驻灰字已下架**，改为按需 | **部分实现**（§9 第二十四遍业主裁 A② 覆盖，属登记偏差） |
| 接受前按 Enter 不发送 | ✅ 建议态 Enter 不发送（`Composer.tsx:836/848` 菜单导航优先） | 已实现 |
| IME 组字中 Enter 不发送 | ✅ `Composer.tsx:498` `composing = useRef(false)`；`:824–825` `onCompositionStart/End` | 已实现 |
| 发送失败草稿回填 | ✅ `drafts.ts` + `Composer.tsx:163` 注释"发送失败回滚：把原文与附件还给对应会话的输入框" | 已实现 |

### 5.3 §3.3 权限模式呈现 —— **部分实现**
| 子项 | 实测 | 判定 |
|---|---|---|
| 模式选择器记住**按文件夹**的设置 | ❌ grep `modeByFolder` / `folderMode` / `byFolder` 在 renderer 与 main = **0** 命中；`App.tsx:434` 只从 `getSettings()` 取全局 `s.mode` | **未实现** |
| 切换动作在灰字里说明后果（auto 加警示） | ✅ `PermissionMenu.tsx:19` `auto: { …, warn: true }`；desc 文案 `strings.ts` `permissionModes.*Desc` | 已实现 |
| Plan 除外（Plan 是门/会话态） | ✅ PlanCard 独立于 mode（`PlanCard.tsx:7` 注释） | 已实现 |

### 5.4 §3.4 窗格系统（D1=全采纳）—— **已实现（含全集七窗格）**
| 子项 | 实测 | 判定 |
|---|---|---|
| 网格化 + 拖拽换位 + 弹出独立窗口 | ✅ `PaneDock.tsx:865–868` 网格宿主；`:945` `draggable` + `:947` `onDragStart` + `:967` `reorderTarget`；`:976–982` `⧉` 弹出 | 已实现 |
| 六/七窗格全集可开 | ✅ `panes.ts:9` `PaneKind = "changes"｜"plan"｜"tasks"｜"file"｜"terminal"｜"browser"｜"sidechat"`；`:22` `PANE_OPENABLE` 七项全在 | 已实现（规范列 8 种含 `chat`/`subagent`，实际 7 种；`subagent` 并入 tasks 的 worker 项 `panes.ts:102`） |
| 变更窗格：逐 hunk diff + 行级评注闭环 + `⌘Enter` 提交 | ✅ `PaneDock.tsx:650–653`（comments Map + `composeReviewMessage`）；`:671–676` 评审条"N 条评注待提交 / 提交评论（⌘Enter）"；`:669` `onKeyDown` 接 `⌘Enter`；`DiffView.tsx:1` 注释"行级评注（蓝本 §3.6）" | 已实现 |
| 文件窗格：懒加载树 + 只读预览 | ✅ `FilePane`（`PaneDock.tsx:1000`）；右键菜单 `onPathMenu`（`:590/606`） | 已实现 |
| 终端窗格：真 PTY | ✅ `src/main/terminal-host.ts:1` "python3 的 pty.spawn 分配 PTY"；`:8` 非 darwin fail-visible；xterm 依赖 `package.json:22–23` | 已实现 |
| 浏览器窗格：WebContentsView + 独立 profile | ✅ `src/main/browser-host.ts:8` `WebContentsView`；`:143` `partition: "persist:cairn-browser"` | 已实现 |
| 拖标题栏换位 / 拖边缘调大小 / `Cmd+\` 关聚焦 | ✅ `:945`；`:865` "格间分割线可拖行高"；`App.tsx:1975–1982` `case "Backslash"` 关最近打开（按 `paneOpenOrder`，`:1978` 注释） | 已实现 |
| 会话标题栏 Terminal / Changes / Browser 入口 + `⋮` | ✅ `App.tsx:2230` `.chat-bar`；`styles.css:334` 注释"会话名 13px + Terminal / Changes / Browser + ⋮" | 已实现 |
| **同类窗格以标签页组织**（不抄堆叠） | ✅ 浏览器窗格多标签 `PaneDock.tsx:298–299` `role="tablist"` | 已实现 |
| 终端与 agent 共享同一工作目录 | ✅ `terminal-host.ts:48` "起一个新终端（cwd = 工作区）" | 已实现 |
| 文件窗格右键菜单四项 | ⚠️ `onPathMenu` 接通（`:995`），菜单项文案待查——`PathMenu.tsx` 存在 | 已实现（菜单组件在） |
| **终端 resize（stty 通道）** | ❌ `terminal-host.ts:48` 注释"PTY 尺寸默认——resize 通道留后续" | **未实现**（规范 §3.4 自列"待后续切片"） |

### 5.5 §3.5 浏览器面 —— **已实现（两处待补）**
| 子项 | 实测 | 判定 |
|---|---|---|
| 多标签页 | ✅ `PaneDock.tsx:298` | 已实现 |
| 独立干净 profile | ✅ `browser-host.ts:143` | 已实现 |
| `Cmd+Shift+B` 打开 | ✅ `pane-shortcuts.ts:25` `{ kind:"browser", keys:"⌘⇧B", code:"KeyB", mod:"cmd", shift:true }`；`App.tsx:1959–1964` pane 表优先于 `case "KeyB"` ⇒ 无冲突 | 已实现 |
| 首次外链弹"内置还是默认浏览器" | ⚠️ 外链一律走 `shell.openExternal`（`src/main/index.ts:808`）——**没有"内置 vs 默认"的选择弹层**，直接出系统浏览器 | **部分实现**（行为不同：直接外抛，不问） |
| `Cmd+click` 直走默认浏览器 | ❌ grep `cmdClick` / `metaKey.*click` 在 `PaneDock.tsx` / `browser-host.ts` = **0** 命中 | **未实现** |
| 站点级权限卡 Allow once / 记住该域 / Deny | ✅ `PaneDock.tsx:405–407` 三钮：「允许本次」「记住该域」「拒绝」；`panes.ts:256–266` `sitePermissionFor` 本地免问 | 已实现（规范写 "Always allow"，实测文案"记住该域"≡同义） |
| 按站点（含子域）分别授权、设置可撤销 | ✅ `tests/browser-forget-hosts.test.ts` + `browser-host.ts:261` "清除浏览数据…清独立干净 profile"；逐个撤销 `tests/` 有专项 | 已实现 |
| 本地 dev server 与项目文件免授权 | ✅ `panes.ts:262–263` localhost/127.0.0.1/::1/0.0.0.0/`.local` → `"local"` | 已实现 |
| 外站写操作过安全面 | ✅ `panes.ts:254` 注释"外站的写操作在 browse 后端侧另有安全面" | 已实现（后端声明，未逐项验） |
| **dev server 探测配置写进 `.agent/launch.json`（JSONC）** | ❌ grep `launch.json` / `JSONC` 在 `apps/desktop/src` = **0** 命中 | **未实现** |
| `web_fetch` / `web_search` 结果卡片 | ⚠️ 未找到独立的"结果查看面"组件 | **未找到** |

### 5.6 §3.6 审阅与交付闭环 —— **部分实现**
| 子项 | 实测 | 判定 |
|---|---|---|
| diff 审阅：改动出现 `+12 −1` 统计指示器 | ✅ `PaneDock.tsx:724` `.change-diff-stat num` → `+${add} −${del}` | 已实现 |
| → 点击开审阅器（左文件列表、右内容） | ✅ `PaneDock.tsx:696` `.changes-list`（左）+ 展开区 `DiffView`（右） | 已实现 |
| → 点任意行写评论 | ✅ `DiffView.tsx:5` 注释"仅当传 onComment 时行 hover 出「＋」"；`PaneDock.tsx:730–735` | 已实现 |
| → 多处评论 `Cmd+Enter` 一次性提交 | ✅ `PaneDock.tsx:669` + `:671–676` | 已实现 |
| → agent 读完改完产生新 diff | ✅ 走 `onReview` → send → 新一轮 | 已实现 |
| 快照脚注（覆盖前快照已保留）在场才出 | ⚠️ 未找到"快照脚注"UI 面 | **未找到** |
| DiffView 完整可读（含 stat、动作徽标、色盲冗余） | ✅ `DiffView.tsx:3–4` 注释"色盲冗余：着色之外，符号与前缀始终在场"；`PaneDock.tsx:724` stat | 已实现 |
| **代码审阅卡片**（/code-review：按文件分组 / Walk through in diff / Fix this one / Apply fixes） | ❌ 见 §3.2 | **未实现** |
| PR 监控 / auto-fix CI / auto-merge | ➖ 规范裁"不做" | 规范豁免 |

### 5.7 §3.7 会话编排 —— **部分实现（worktree 是最大缺口）**
| 机制 | 规范 | 实测 | 判定 |
|---|---|---|---|
| `Cmd+N` 新会话 | 做 | ✅ `App.tsx:1999–2001` `case "KeyN"` → `h.newSession()`；实现 `:1102` | 已实现 |
| 切换会话（不引入不可关循环） | 侧栏点击 + `Cmd+Shift+[`/`]`，**不引入 `Ctrl+Tab`** | ✅ `App.tsx:1993–1998` `⌘⇧]`/`⌘⇧[`；`cycleSession` `:1691`。⚠️ **`Ctrl+Tab` 实际实现了但可关**：`App.tsx:1951–1957`，`ctrlTabCycle` 默认 `true`（`:344`），设置页可关 | **部分实现**（规范 §3.7 说"不引入"，实际引入但可关；§5.3-7 禁令只禁"不可关循环"，故不违规，但与 §3.7 字面有出入） |
| 分屏看会话（`Cmd+`点击侧栏） | 落点=窗格层 | ❌ grep `Cmd+点击` / `metaKey.*click` 在 `Sidebar.tsx` = **0** 命中 | **未实现** |
| **Git worktree 隔离** | 并行会话可选 worktree；`.worktreeinclude`；默认 `<root>/.agent/worktrees/` | ❌ grep `worktree` 在 `apps/desktop/src` = **0** 命中（core `src/` 有 `worktree` 痕迹但属工具层快照，非会话层）；`.worktreeinclude` 只在规范文本里出现 | **未实现** |
| 侧边栏筛选/分组 | 按状态/项目筛选、按项目分组 | ✅ `sessions-view.ts` `filterSessions` / `groupByWorkspace`；`Sidebar.tsx:400–406` | 已实现 |
| 自动 compact | 上下文满自动压缩 + `/compact` 主动 | ⚠️ `/compact` ✅（`App.tsx:841–852` `compactNow`，三入口共用）；core 有 `trigger=auto` 的压缩记录类型（`src/events/types.ts:217`）。**桌面端无自动触发 UI/阈值证据** | **部分实现** |
| 完成通知（不在看那个会话时） | 发 OS 通知 | ✅ `src/main/index.ts:126–134` `maybeNotifyRunSettled`；`:329` 调用；判据 ="窗口整体失焦"（注释 `:123–125` 如实记"近似口径"） | 已实现（口径降级，已登记） |
| **Side chat**（`Cmd+;` / `/btw`）读全部上下文、不回写、不落盘、关即失 | 有 | ✅ `SidechatPane.tsx` + `pane-shortcuts.ts:27` ⌘; | 已实现 |
| Tasks 窗格看后台工作 | 落点=窗格层 | ✅ `PaneDock.tsx:999` `kind === "tasks"` → `TasksPane`；worker 项 `panes.ts:102` | 已实现 |
| 跨会话通信 | 留门不做 | ➖ | 规范豁免 |
| **归档硬闸**（所有档位必问） | 唯一硬否决点 | ✅ `App.tsx:1749–1752` + `:2873–2889`，无条件（不看 mode） | 已实现 |
| Task chip | 不做 | ➖ | 规范豁免 |
| **用量环**（context 按会话 + plan 跨面，常驻可见） | 有 | ⚠️ context 环 ✅（`Composer.tsx:1068`）；**plan 用量未找到** | **部分实现** |

### 5.8 §3.8 视图三档 —— **已实现**
| 子项 | 实测 | 判定 |
|---|---|---|
| `Ctrl+O` 循环 Normal → Thinking → Verbose | ✅ `App.tsx:2000–2003` `case "KeyO": if (e.ctrlKey) h.cycleView()` | 已实现 |
| Thinking 档仅本会话产出过思考后才出现 | ✅ `view-mode.ts:11–13` `viewModesFor(hasThinking)`：`hasThinking ? [normal,thinking,verbose] : [normal,verbose]`——**不摆空档** | 已实现（严格照做） |
| 思考内容接线为前置；未接线时如实呈现"无思考内容" | ✅ `projections.ts:15` `thinking?: string`；`:134/150/176/181/199` 思考桶累计；`cases "thinking_delta"` | 已实现 |

### 5.9 §3.9 跨面接力 —— **未实现**
| 子项 | 实测 | 判定 |
|---|---|---|
| 会话菜单"Open in → CLI"给出等价命令 | ❌ **未找到**：renderer 全树 grep `Open in` / `openInCli` = 0（唯一 `openIn` 是浏览器窗格内部函数，与 CLI 无关）。会话菜单实测 6 项（`Sidebar.tsx:186–194`） | **未实现** |
| CLI 会话在桌面打开（共享 sessions 存储） | ⚠️ 共享存储成立（`src/main/ipc-protocol.ts` 会话面），但无 UI 入口 | **部分** |
| Dispatch / Remote Control / Cloud 会话不存在（不设占位） | ✅ 未找到相关占位 | 已实现（正确地没做） |

### 5.10 §3.10 计算机控制 —— **规范裁"不做"，实现确未做** ➖
grep `computer` / `screen control` / `鼠标控制` 在 renderer = **0** 命中。符合规范。

### 5.11 §3.12 组件命名分层
⚠️ 规范"落点=§6 实现载体的类名与 `data-*` 约定**随实施定稿**"。实际有 `data-*` 约定（`data-theme` / `data-text-size` / `data-sidebar` / `data-collapsed` / `data-round-anchor` / `data-on` / `data-status` / `data-ok` 等广泛存在），但**未找到四域前缀（外壳/对话面/窗格宿主/设计系统组件）的成文分层**。判定 **部分实现**。

---

## 6. 完成度汇总

| 维度 | 已实现 | 部分 | 未实现 | 完成度 |
|---|---|---|---|---|
| 令牌层（§4） | bg/text/accent 三族 + alpha 枚数 + 刻度 + 主题 + 纪律 | 圆角档位、caption 档、字体栈字面、`--fs-entry-floor` 无消费 | 双轴尺寸轴、alpha `hsl(from)` 写法、`--success` 值、`--text-100` 悬空 | **≈ 82%** |
| 布局密度（§3.11） | 9 项数值一致 + ⌘B | 4 项偏差（有据） | 3 项（页脚用户名+套餐 / 工具状态行 / 插件侧栏二件） | **≈ 74%** |
| 组件清单 | 规范点名组件 12/12 存在 | — | 2 个"面"（插件侧栏 / 代码审阅卡） | **≈ 90%** |
| §5.1 必抄 8 条 | 4 条 | 3 条 | 1 条（跨面接力） | **≈ 56%**（按条计）／按子项加权 ≈ 71% |
| §3 UI 与交互（3.1–3.12） | 3.1 / 3.4 / 3.8 全绿；3.2 / 3.5 大半绿 | 3.3 / 3.6 / 3.7 / 3.11 | 3.9（跨面接力）；3.7 的 worktree 与分屏 | **≈ 71%** |

**加权总评：≈ 76%**（权重：令牌 0.2 / 密度 0.25 / 组件 0.15 / §5.1 0.2 / §3 0.2）

**已实现但值得注意的"诚实口径"落地**（规范 §8-5 要求未接线不造假，实现照做）：
- Thinking 档无思考内容时不进环（`view-mode.ts:11`）
- 用量环拿不到读数时环心「—」且不假报 0（`tests/composer-usage-ring.test.tsx:6`）
- ProviderBanner 未知（还在读）不出（`ProviderBanner.tsx:5` 注释）
- DiffView 截断如实标注、不说"没有差异"（`DiffView.tsx:29–32`）
- 完成通知判据降级为"窗口整体失焦"，注释显式登记（`src/main/index.ts:123–125`）

---

## 7. 对"对照 Claude 桌面端做完整还原"的缺口处置建议（只读审计，不含改动）

按"离 Claude 还原目标影响最大"排序的补齐顺序：

1. **插件侧栏（G1）** —— 唯一的整块结构性缺失，且带两个 §3.11 数值（280px、按钮带）。要做就得同时立 `Option+Cmd+B` 的新落点（现在被检查器占着）。
2. **双轴变体（G2）** —— 令牌层唯一的结构性缺失。现在改字号会连控件一起放大，正是 §4.5 想防的。改法是在刻度族上补 `--sm/--md/--lg` 尺寸轴，与 `--rem-scale` 文字轴正交。
3. **alpha 阶改 `hsl(from …)`（G3）** —— 功能等效但写法违规范明文。属于"改一处换全局"的一次性成本，越早越便宜。
4. **worktree 会话隔离（G4）** —— §3.7 的灵魂项（"Code tab 的灵魂"），目前桌面层零痕迹，需要新增 IPC 通道。
5. **§3.9 跨面接力（G5）** —— §5.1-6 必抄条唯一未落地项，工作量小（菜单一项 + 等价命令文案）。
6. **小偏差收口**（G7/G8/G9）—— 页脚 22→26、侧栏 242→240、字 13→14.5、`--text-100` 悬空、`--success` 色相，逐个决定"改代码"还是"改规范并登记 §9"。

---

*审计结束。全程只读：未写入任何源文件、未执行 git 写操作。唯一写操作是本报告文件。*
