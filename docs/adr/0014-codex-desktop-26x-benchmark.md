# ADR 0014：对标 Codex 桌面端 26.1106.51428 —— 实测与现读对照，**未发现新的机械差距**

- 状态：**已接受**——2026-11-12 业主令「按照我们调研的数据开始优化我们的项目」
- 日期：2026-11-12
- 决策者：仓库所有者
- 取代：无（**不推翻** ADR 0009 的任何裁决；只把它的「Codex 那一节是 2026-10-28 的读数」这件事补上**新读数**）
- 关联：`outputs/codex-desktop-benchmark-2026-11-12/`、`docs/adr/0009-codex-claude-benchmark.md`、
  `apps/desktop/src/renderer/components/UsageMeter.tsx`、`apps/desktop/src/renderer/context-breakdown.ts`

## 一、为什么要重做这一轮

上一次对标 Codex 是 **2026-10-28**（26.1023.51421，asar 660 MB）。本轮现读本机是
**26.1106.51428**（asar **773 MB**，sha256 `3695c17e…`）——**隔了两周、产物大了 113 MB**。
⇒ 旧读数不可沿用，重取。

## 二、取证

- REA `analyze_javascript_application`（`ev_904d04ee…` 视图／`ev_dc5117c0…` 分析）：
  相关文件 10,958、解析成功 JS 1,056（**解析失败 0**）、读入文本 570,862,140 B、AST 节点 6,510,525、
  findings 2,301、modules 71、覆盖 **partial**（语义图截断）。
  客户端 120 s 超时但**服务端已完成**，用 `get_evidence_bundle` 取回，**未重跑**。
- 字节层：19,995 个条目（`webview/` 19,021 / 745 MB、`node_modules/` 880、`.vite/` 28）、
  9,737 个 `.js`、603 个 `.css`、**无 source map 随包**。

## 三、实测到的新事实（与 10-28 那版不同或当时没测到的）

1. **上下文用量在本构建里是活的**：`Context window` 文案 × 2、`contextUsage` × 18、
   `contextWindow` × 30、`usageLimit` × 103 ＋ CSS 里的 `progression-donut-fill` 环。
   ⇒ **2026-11-02 记的「Codex 桌面端搜不到任何 context 用量文案」已过期**。
   但**没有**「剩余上下文 / 还剩多少」那类百分比文案 ⇒ 环是主要载体。
2. **`[data-codex-window-type]` 524 处，取值只有四个**（browser 256 / electron 105 / extension 89 /
   chrome-extension 69）⇒ **同一套 Web 应用跑四种宿主**；那 524 个钩子的成因在此。
3. **`[data-appearance-preset]` 277 处 = 社区主题预设**（catppuccin / nord / everforest / rose-pine /
   tokyo-night / gruvbox / github / linear / notion）。
4. **`[data-reduced-motion]` 258 处**，语义是「`=false` 或缺席 ⇒ 动效开」（属性名比 Claude 多一个 d）。
5. 84 个 `@keyframes`（Tailwind v4 哈希命名）；计时令牌 `--transition-duration-basic: .15s` /
   `--transition-duration-relaxed: .3s`；缓动 `--ease-enter-snappy`＝`cubic-bezier(.23,1,.32,1)`。
6. 桥面只有 **4 个 contextBridge API / 44 个 IPC 操作**（25 条字面通道）。

## 四、与本仓现读对照的结论

**没有发现新的机械差距。** 逐条先回本仓现读核实：

- **已对齐**：逐词到达（ADR 0009 批次 B）、滚动边缘渐隐（自有实现，按内容树挂）、计时刻度（5 档 vs 上游 2 档）、
  减弱动效（机制 + 本轮补的官方层覆盖）、暗色双写（`data-theme`＋`data-mode`，被官方 CDS 逼出来的必要做法）。
- **本仓领先**：上下文用量面（本仓是**环 ＋ 六桶分解** ＋ 低水位警示 ＋ 压缩入口 ＋ 缓存命中率；
  Codex 这一版只有环）、桥面域归属表（165 条通道按 18 域，本轮第 1174 页新增）、显式协议版本握手。
- **明确不抄**（附理由）：四宿主表面（Codex 的 524 个钩子源于「四种宿主要一套代码」，Cairn 没这个约束）、
  社区主题预设（与 `desktop-design-spec.md` §4.1「Claude 形制，维持」冲突）、输入卡变体轴
  （上游要支持同一张卡的五种长相，本仓形态已定）。

⇒ 本轮**没有代码改动**。唯一剩下的未决项是「要不要开社区主题预设这个口子」——**产品裁决**，非实现问题，登记不动。

## 五、顺带查清的一件环境事实（把「宿主限制」说准）

本轮跑全量 `pnpm gates`：`head-cert-check` 红在
`error: unable to create file fixtures/plugins/project/echo-suite/.mcp.json: Operation not permitted`。
现读核实：

- 该文件在**工作树**里是 600，但 **git 记录的是 100644** ⇒ 不是仓库缺陷；
- 实测沙箱行为：写**任何**名为 `.mcp.json` 的文件都被拒（`/tmp` 与仓库内都一样），
  普通文件可写；⇒ **这就是那 3 条 `settings-migration` 红与 `head-cert-check` 红的同一个成因**。

⇒ 台账此前写的「属本沙箱无 `$SHELL`/`HOME` 的宿主限制」**不准确**；准确说法是：
**沙箱专拒写 `.mcp.json`**（不写别的）。这四条红**不是**本仓代码缺陷，也**不是**任何一条改动引入的。

## 六、更正与边界

- 更正一：记忆里「Codex 桌面端当前构建搜不到任何 context 用量文案」（2026-11-02 读数）**已过期**——
  26.1106.51428 有 `Context window` 文案与 `contextUsage`/`contextWindow`/`usageLimit` 三组标识。
- 更正二：台账此前把 4 条桌面红归因为「无 `$SHELL`/`HOME` 的宿主限制」，准确成因见第五节。
- 边界：REA 覆盖 **partial**（1,056 个 JS 少于 asar 里的 9,737 个 `.js`），**桥面/通道面计数不足以当全貌**；
  样式层只量了最大的 6 个 CSS（2.06 MB）、JS 层只量了最大的 8 个 chunk（42.3 MB）；
  上下文用量的**界面形态**未从渲染产物还原（只推出存在性）；`.vite/`（Electron 壳）与
  `codex-cli/`、`artifact-template-picker/` 未展开。
- 本轮**零代码改动**；`pnpm gates` 除 `head-cert-check`（成因见第五节）外全绿。
