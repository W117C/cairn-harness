# ADR 0009：对标 Codex / Claude 的一手取证与两批落地（模型选择器 + 输出动效）

- 状态：**已接受**——2026-10-28 业主定案「桌面端要做到 Codex / Claude 顶尖水平」，并要求「直接去研究学习」
- 日期：2026-10-28
- 决策者：仓库所有者
- 取代：无（**不推翻**任何既有契约；本 ADR 只在两处记录了对既有判卷的形状适配与理由）
- 关联：`apps/desktop/src/renderer/components/ModelPicker.tsx`、`apps/desktop/src/renderer/markdown.tsx`、`apps/desktop/src/renderer/styles.css`、`apps/desktop/src/renderer/tokens.css`、`apps/desktop/tests/model-picker-axis.test.tsx`、`apps/desktop/tests/output-motion.test.tsx`

## 一、取证路径：REA 不可用 ⇒ 走同样的一手路线

业主点名用 REA（`rea:reverse-engineer-anything`）去研究。诊断结果**如实记录**：

- 插件声明的 `rea` stdio MCP **未挂载**（`mcp list` 为空）；
- 插件的获取通道也断在本机沙箱里：`npx -y rea-agents@6.4.0 mcp doctor --json` 两次都报
  `EPERM unlink`（npm 写不了缓存，默认缓存与全新临时缓存 alike）；
  按插件约定**不擅自改宿主配置、不换 latest**。

⇒ 改走**同一条一手路线**（REA 的 JS/Electron 路线就是「解包产物读渲染层」）：
本机正好装着两个目标，**直接读它们的产物**，不靠博客、不靠二手转述：

| 目标 | 产物 | 版本 | 取到的证据 |
|---|---|---|---|
| Claude Desktop | `/Applications/Claude.app/Contents/Resources/app.asar`（52.6 MB） | **3.6556.2** | 主窗口 CSS（237 KB）、`@keyframes` 全表、CDS 令牌 |
| Codex 桌面端 | `/Applications/ChatGPT.app/Contents/Resources/app.asar`（660 MB） | **26.1023.51421** | webview CSS/JS（`app-initial` / `app-primary` / `app-shared`） |
| Codex 模型目录 | `~/.codex/cc-switch-model-catalog.json` | — | 模型选择的**数据契约**（schema） |

（解包脚本按 asar 格式手写：16 字节头 + JSON 目录 + 数据段；没有引入任何新依赖。）

## 二、一手证据（本轮读到的事实，不是印象）

### 2.1 Claude Desktop 3.6556.2

- **技术栈**：渲染层是 **Tailwind CSS v4.3.3** + CDS 令牌（`--cds-*`）。
  ⇒ 本仓 vendored 的 CDS 薄**不落后**：`vendor/cds-official/UPSTREAM.json` 记的正是
  同一个 `3.6556.2` 与同一个 asar sha256 ⇒ 令牌层已对齐，**差距不在令牌**。
- **动效刻度**（实发值）：时长 `.12s / .2s / .3s / .45s / 60ms`；
  缓动 `cubic-bezier(.165,.84,.44,1)`（out）、`(.32,.72,0,1)`（snap）、`(.34,1.3,.64,1)`（overshoot）、`(0,0,.2,1)`。
  ⇒ 与本仓 `tokens.css` 的 `--t-*` / `--ease-*` **已同值**（第 734 页照抄过一次）。
- **输出动效 = shimmer 扫光**（不是光标）：
  `[data-cds-shimmer-clone]` 是正文的**克隆层**（`text-fill-color: transparent` + `mask-image`/`mask-clip: text`），
  其 `::after` 画一条 `120deg` 的线性渐变光带（`transparent 37.5% → 峰值 50%±plateau → transparent 62.5%）`，
  动画 `3s linear infinite cds-shimmer-text-band`（关键帧 `translate: -62.5% → -12.5%`）。
  减弱动效走**根节点属性** `data-reduce-motion`（不是只有媒体查询）。
- **模型/数值芯片的动效族**（`cds-pill-*`）：
  `cds-pill-in`（scale .8→1 + 淡入，overshoot）/ `cds-pill-pop`（**上冲 1.32 再落回**：
  上冲 40% 时长、下落 60% 时长用 overshoot）/ `cds-pill-dip`（按下 scale .82）/ `cds-pill-roll-in-up`（translateY 70% + 淡入）。
  ⇒ **值变了要弹一下**是 Claude 的既有做法，不是自创。

### 2.2 Codex 桌面端 26.1023.51421

- **输出动效 = 逐词到达**：
  `@keyframes _reveal-response-word` = `0%{color: 强调色; opacity:0} → 20%{opacity:.6} → 65%{opacity:1} → to{color:inherit}`
  （另有 `_reveal-word`、`_typing-dot-wave`（`steps(6,end)` 的三点波）、`loading-shimmer` + `loading-shimmer-mask`
  （用**自定义属性** `--loading-shimmer-mask-offset` 驱动遮罩）、`token-pulsing-dot`、
  `_progression-donut-fill`（上下文环填充））。
- **模型选择是「多轴」结构**（`app-primary` 里的 `ModelPicker` / `reasoningEffort`）：
  - 每个模型带 `supportedReasoningEfforts[]`（每档带一句**人话说明**）与 `defaultReasoningEffort`；
  - 归位函数（产物里的原样）：当前档不被该模型支持 ⇒ 落到该模型的缺省档 ⇒ 再退到声明的第一档；
  - 模型没声明档位时回落默认档位表（说明为空）。
  - 模型目录 schema 里还有 **verbosity**（冗长度）、**service_tiers**（速度档）、
    `context_window` / `effective_context_window_percent`、`priority` / `visibility`（列表排序）等轴。

### 2.3 与本仓现状的差距（现读代码）

| 面 | Claude / Codex 怎么做 | 本仓原状 | 差距 |
|---|---|---|---|
| 模型菜单的思考档 | 按**当前模型**出档（Codex） | 无论哪个模型都摆全局四档 | 能选到该模型**不支持**的档 ⇒ 请求被 provider 拒 |
| 换模型后的思考档 | 归位到新模型的缺省档（Codex） | 不归位 | 芯片显示一档、请求发另一档；或给不支持思考的模型发思考参数 |
| 模型芯片的值变化 | 弹一下（Claude `cds-pill-pop`） | 静默换字 | 换了但没反馈 |
| 输出中的正文 | 逐词到达（Codex）/ 扫光（Claude） | 只有一根 7×15 的品牌色方块光标在呼吸 | 阅读面「啪地出现」一段字，没有「字在到」 |

## 三、裁决

### 3.1 批次 A：模型选择器（多轴 + 归位 + 芯片动效）

1. **档位跟模型走**：`ModelOption` 带上该模型自己声明的 `thinkingLevels` / `thinkingDefault`
   （来自 `capability.thinking`，唯一事实源仍是 `getProviderInfo()`，本层不造第二份）；
   菜单的思考段**只出该模型声明的档**；没声明 ⇒ 沿用四档但整段禁用（fail-visible，不谎称可调）。
2. **归位是状态更新，不是显示层偷换**：`reconcileThinkingLevel()`（纯函数、可判卷）算出落点；
   由两条路径写回状态——用户在菜单里点模型（`pick`）与父级换 value（`useEffect`）。
   **芯片仍显示「当前档」**（既有契约：显示的 = 发出去的）；归位后状态变了，芯片自然跟着变。
   ⇒ 显示层与请求层**永不**分叉。
3. **芯片的值变了要弹一下**：照抄 Claude 的数值——上冲 `scale(1.32)` 占 40% 时长（80ms，`ease-out`），
   落回占 60%（120ms，`ease-overshoot`）；进场另走一条（`scale .8→1` + 淡入）。
   触发方式：名字那一格用模型名做 `key` ⇒ 换模型即重挂 ⇒ 动画自动重播（不必手动重置动画状态）。

### 3.2 批次 B：输出动效（逐词到达）

1. 取 Codex 的 `_reveal-response-word` 那组值：`0%` 透明 + 强调色 → `20%` 0.6 → `65%` 不透明 → 落回正文色。
2. **只在正在写的那一块开**（`caret` 为真的那一个块）：历史正文一个字都不多包 ⇒ DOM 与改动前同形。
3. **词的 key 用词序**（`w0/w1/…`）而不是词本身：词本身会随流式增长而变 ⇒ 用它做 key 每来一个字符就重挂 ⇒ 动画反复重播。
4. 光标（业主定的元素）**保留**：逐词到达是叠加，不是替换。

### 3.3 不做的

- **不做 Claude 的 shimmer 扫光**：它要一层「正文克隆 + mask」的实现，且要测量覆盖层几何；
  本轮先取 Codex 那条（改动面小、判卷好写）。两条不叠加。
- **不引入 verbosity / 速度档**：本仓的 provider 协议还没有这两根轴（`src/main/ipc-protocol.ts` 里没有），
  先做有契约支撑的那两根（模型 + 思考档）。
- **不动光标的形态**：那是业主第 19 遍裁过的元素。

## 四、判卷

| 文件 | 条数 | 钉的是什么 |
|---|---|---|
| `apps/desktop/tests/model-picker-axis.test.tsx` | 10 | 归位四支 / 菜单按模型出档 / 芯片显示当前档 / 芯片动效两条动画分开 / pick 与 effect 两条归位路径的接线 |
| `apps/desktop/tests/output-motion.test.tsx` | 4 | 关键帧取值照抄 Codex / 只在写着的块开、历史不多包节点 / 光标仍在 / 词 key 用词序 |

### 对既有判卷的唯一一处改动（如实记录）

`tests/markdown.test.tsx` 的「流式光标落在最后一个文本块的行内」那条：逐词到达把正文包进了一层
**可选的** `<span class="md-word">`，原断言的正则要求正文与 `<span class="cursor">` **紧邻**，
字面上失配。处理：**判据放宽成「正文可被包一层，但光标仍紧跟其后、且仍在 `<p>` 里」**——
意图（光标行内、不独立一行）一点没松，期望的正文文本一个字没改。
⇒ 这是**形状适配**，不是削弱断言；本 ADR 把它记在这里，便于日后回查。

## 五、边界（明确不冒充的）

- **真机观感未验收**：本机 Electron 起不来（环境债）；本轮的视觉核对走「浏览器 + 真构建产物 +
  真渲染代码 + 假 AgentApi」，**动效的观感**（节奏、幅度、是否太闹）**必须由业主在真机上看**。
- 本轮**只动了模型选择器与输出动效**两处；业主说的「其他全部都需要优化」尚未开始，
  下一批的入口与优先级见 `PROGRESS.md` 第 757 页。
- 词级 DOM 包装只发生在**正在写的那一块**；长会话的节点数影响未量（下一批用
  `apps/desktop/scripts/projection-bench.mjs` 一类基准量）。
