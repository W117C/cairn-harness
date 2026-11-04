# 桌面端对话面修复 · 2026-11-02（第 1005 页交付）

工作目录 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `7e23cdd6`（HEAD **不含**本批改动：本批全部未提交）。
本批起点是业主的一张截图：一轮对话里，助手行的**署名条**（复制/置顶/撤回/分叉/赞/踩 + 「2 分钟前」）画在末尾那张**交付卡**的边框**里面**，图标读起来像卡片自己的工具条。

## 一、两处真几何缺陷（量出来的，不是看出来的）

| # | 现象 | 实测（真 renderer，1440×900，夹具＝末行助手行 → 交付卡） | 根因 |
|---|---|---|---|
| 1 | 详见署名条压进交付卡表头 | `overlap = footer.bottom − card.top = **22px**`；6 枚图标字形全在卡顶**之下**（最深 +13px）；卡头左侧 0–21px 的命中带全部返回 `row-actions`（表头的点击也被吃掉） | 卡片顶距 `styles.css` 的 `.changes-card` 写 `var(--space-sm)`=8px，而署名条是盒高 30px 的绝对定位浮层（`stream-process.css` 的 `.row.assistant > .assistant-footer`，`top:100%`）⇒ 30−8=22 |
| 2 | 隐形横带吃点击（幽灵点击） | 不悬停该行时，在卡头 `head.top+5` 派发真 click ⇒ `aria-expanded` false→false（**什么都没发生**）；容器的 `pointer-events` computed = **auto** | 裁决 4「隐藏态不吃指针」只写给了里面的 `.row-actions` 与 `.meta`，**容器 `.assistant-footer` 自己一直 auto**——672×30 的隐形横带盖住下一段最上面 6px |

## 二、改法（两处都按「结构优先，不加装饰」）

1. `apps/desktop/src/renderer/styles.css`：`.changes-card` 顶距 `--space-sm`(8) → `var(--turn-gap)`(24)。
   这不是新发明的间距：ADR 0008 裁决 2 本来就规定轮内每一段之间恒为 24px，卡片是唯一的例外。回到一档后，图标字形**全部落在卡片之上**（最浅 −3px）。
2. `apps/desktop/src/renderer/components/stream-process.css`：`.row.assistant > .assistant-footer` 加 `pointer-events: none`，并追加
   `.row.assistant:hover > .assistant-footer, .row.assistant:focus-within > .assistant-footer { pointer-events: auto; }`——与内层同一条口径。

## 三、判据

| 判卷 | 加了什么 | 造红方式 |
|---|---|---|
| `apps/desktop/tests/conversation-rail.test.ts` ⑨（新） | 卡片顶距读 `--turn-gap`；且**数值关系** `条高 − 一档 ≤ 6px` | 卡片顶距改回 `--space-sm`、或操作条再长高 ⇒ 红 |
| 同文件 ④（扩） | 钉**容器**自己 `pointer-events: none` + hover/focus 恢复 | 把容器那两条删掉 ⇒ 红（内层 none 外层 auto 等于没写） |
| `apps/desktop/tests/design-minimal.test.tsx` ⑥（形状适配） | 顶距那一格随产品口径更新（左轨、右缘两格逐字不动） | — |
| `apps/desktop/tests/settings-advanced-section.test.tsx`（+3 条） | 语言服务器状态行的通道消费点 + 三种「没有可读读数」分开说 + 台数/信任态上屏 | 删掉消费点 ⇒ 红（同时 `invoke-consumer-census` 也红） |

## 四、同批修掉的另外三处（都是工作树在途改动留下的）

- **真缺陷 · 空胶囊**：`settings-sections.tsx` 的 `<Badge text="未收集" />` —— `Badge`（`settings-ui.tsx:135`）的正文是 `children`，`text` 被丢掉 ⇒ DOM 里是一片空 `<span class="ss-badge neutral">`，判卷 `settings-advanced-section` 第 57 条一直红，typecheck 也报 TS2322。改成 `<Badge>未收集</Badge>`。
- **两条判卷字面量过期**（在途重构把代码搬了家，行为仍在）：
  - `pane-shortcuts.test.ts`：菜单行从 `PANE_OPENABLE.filter(...)` 换成 `WORKBENCH_PANES.filter(k => k !== "changes" && …)`；
  - `plugin-sidebar.test.ts`：关闭侧栏的落盘从 close 处理器搬进 `state/chrome.ts` 的一条 effect（`pluginSidebarOpen ? "1" : "0"`）。
  两条都做了**形状适配**（注释里写明原意图逐条保留、为什么不是削弱断言）。
- **一条死通道**：在途新增的 `lspStatus`（协议 v52）主进程接了、渲染层零调用点 ⇒ `invoke-consumer-census` 红（它红的正是「功能齐全但 UI 不可达」）。补了真消费者：设置「高级」段新增「语言服务器」行，读同一条通道；`settings-sections.tsx` 已顶到 1200 行帽，故该行独立成 `components/settings/LspStatusRow.tsx`（`renderer-layer-check` 复绿，184 个源文件）。

## 五、读数（全部本轮实测）

- **桌面判卷全量**：`pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=2`（**并发 2**）⇒ **314 文件 / 2155 条全绿**，见 `desktop-suite.log`。修改前同一命令：314/2152，**3 红**（census、pane-shortcuts、plugin-sidebar）。
- **typecheck**：根 `node --import tsx scripts/typecheck.ts` 0 报错；`pnpm --filter cairn-desktop run typecheck` EXIT=0，见 `gates.log`。
- **门**：`renderer-layer-check` 绿（184 个渲染层源文件）、`desktop-boundary-check` 绿，见 `gates.log`。
- **视觉前后对比**：同夹具、同视口、真 hover。`overlap 22 → 6`；6/6 字形从「卡顶之下（最深 +13px）」变为「卡顶之上（最浅 −3px）」；卡顶下 0–10px 带深色像素 1148 → 0。图：[before-card-zoom.png](<before-card-zoom.png>) / [after-card-zoom.png](<after-card-zoom.png>)，原始读数 [card-overlap.json](<card-overlap.json>)。
- **指针可达性**（差点被我修坏的那个前提，专门验了）：真输入事件逐格滑动 + 真 click ⇒ 不悬停时 footer/actions/button 的 `pointer-events` 全 none、点击落到下方元素；悬停行体后滑到条上，`rowHover` 全程 true、`actionsOpacity` 1，点「复制这行输出」**命中**（chain: row-action → row-actions → assistant-footer → row assistant）。读数 [mouse-path.json](<mouse-path.json>)、[pointer-events.json](<pointer-events.json>)。
- 独立视觉/几何取证由 teammate `surface-audit` 完成，原始报告 [AUDIT-REPORT.md](<AUDIT-REPORT.md>)；红项归属复核由 teammate `red-baseline` 完成（结论：能复现的红全部来自未提交的在途改动，HEAD 上没有一条）。

## 六、边界（不冒充的部分）

- **未提交、未推送**：本批全部在工作树里；`gates` / `head-cert-check` / `mutate-verify` 量的都是 **HEAD**，因此**没有**跑，历史认证不转移到本批。
- **残余 6px 是几何，不是功能**：署名条的盒子仍压到卡边 6px（与它压在工具簇上时同口径，ADR 0008 裁决 3 认可的那 6px）；但**字形不进卡**、**点击不被吃**。要把这 6px 也归零只有两条路：把操作条改回 22px（推翻业主「操作条做宽」的裁决，不做），或把卡片顶距提到 ≥ 条高（多出 6px 空档换 0 像素重叠）。本批选了后者之外的那条（回到一档），并把选择理由写进判卷 ⑨。
- **真机观感未验收**：渲染走的是真 renderer + 假 AgentApi + `capturePage`（Electron 可用，非 SSR 拼页面）；真机上最终观感仍须业主过目。
- **未跑 core 全量**：本批没碰 `src/`（LSP 那行的读取走的是既有 `lspStatus` 通道），core 判卷未复跑。
- 工作树里仍有他人的在途改动（会话标识、LSP 运行态、CI 引用、进化判卷等），本批不替它们打包提交。
