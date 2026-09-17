# Forge 前端优化 · 总方案（Phase 6 / 2026-09-17）

> **主理人画统筹（Hua）汇编。** 本文件是用户问题的直接回答，细节施工请下钻对应分册。
> 事实来源：全团对**当前工作树逐行实测**（`src/renderer/app.js` 2281 行 / `src/renderer/index.html` 1866 行）+ 门禁脚本 + git 状态。所有数值可复核。

---

## 0. 一句话结论

**你的前端不是"烂代码"，是"好手艺 + 零工程护栏"。**

对话底子扎实——oklch 双主题令牌体系完整、无障碍资产齐全（298 个 `aria-*`、30 个 `role`、13 处动效降级、Enter/Space 键盘可达性实测正确）、色板对比度全部达标。真正的问题是三件事：

1. **结构**：4147 行发货代码挤在两个文件里（`index.html` 1866 + `app.js` 2281），且是「跑 mock 的原型」与「追加式真实桥接」的拼接体，两半靠共享模块级变量隐式耦合。
2. **护栏**：**发货的 4147 行零静态检查**——`tsconfig` 的 `allowJs` 未开启（`app.js` 不被 typecheck 覆盖），且全仓无 eslint/prettier/stylelint、无 CI。唯一有类型保障的，是**已经死掉的 React 树**。
3. **口径**：`panels-check` 的 7 个 CDP 探针指向 dead React DOM，在发货层命中**全 0** → **门禁不可能全绿，性能口径无人守**。

→ 所以优化重点应放在**护栏 + 结构 + 口径**，**不是重写视觉**。

---

## 1. 现状诊断：需要改进的部分（实测，可复核）

### 1.1 渲染层正在迁移且未收口

| | 已入库 HEAD `5e8a10b` | 工作区（**未提交**） |
|---|---|---|
| `index.html` | 17 行，`<script src="/main.tsx">` | **1866 行**，自包含，`/app.js` |
| 渲染方式 | React 19 + shadcn + Tailwind 4 | **vanilla JS** |
| `main.tsx` / `styles.css` / `error-boundary.tsx` | 主入口 | **已删除**（git 状态 `D`） |
| 构建产物 | — | `react` 出现 **0 次**（实测），跑的就是 vanilla |

**React 组件树已失去入口**（全仓无运行时引用）：`components/ui/*`(29 文件)、`cards/*`(8)、`panels/registry.tsx`(1281)、`projections.ts`(591)、`store.ts`(141)、`onboarding.tsx`(307)、`conversation.tsx`(91)、`theme.ts`(43)。
它们**只被单测与门禁脚本引用**——于是出现了「**测试覆盖的是死代码，发货代码没人测**」的倒挂。

### 1.2 三个 🔴 级结构问题

| # | 问题 | 实测证据 |
|---|---|---|
| **A** | **持久化布局 schema 完全绑死在已死的 React 层** | `src/main/settings.ts` 的 `layout.open` 是 8 个 **React 面板 id**（`approvals/token/git/memory/plugins/sidechat/agents/schedule`），而 vanilla 视图集是 `files/browser/review/terminal`（`app.js:684-689`）——**零重叠**；单位也不一致（schema 百分比 `width:32` vs CSS 像素 `--sidebar-w:252px`）。<br>⚠️ 更隐蔽的是：**`panels-check` A1/A2 是"无意义的绿"**——它断言 `layout.open.git===true`，能过，但断言的是**发货层根本不用的数据结构**。 |
| **B** | **发货 4147 行零静态保障** | `tsconfig.json` `include:["src","scripts","tests"]` 但 **`allowJs` 未开启** → `.js` 不进编译程序，`app.js` 2281 行**完全不被检查**；1358 行内联 CSS 同理。无 eslint/prettier/stylelint、无 `.github/`。 |
| **C** | **长会话无任何虚拟化/上限** | `app.js:2209-2230` `selectSession`：`r.events.forEach(renderEvent)` —— 打开 10000 事件的会话 = **同步渲染 10000 个节点**。全仓检索无任何消息数量上限逻辑；`react-virtuoso` 仅被已死的 `conversation.tsx` 引用。<br>旧验收口径「1 万条 → DOM ≤ 300 + 滚动一屏 ≤ 200ms」**当前无人守，且即使修好探针也必然红**。 |

### 1.3 其余缺口（分组）

| 组 | 实测现状 | 缺口 |
|---|---|---|
| **响应式** | **仅 1 个宽度断点** `@media (max-width:920px)`（`index.html:1354`）；其余 13 个 `@media` 全是动效降级 | 1024/1280/1600 三档零适配；主窗口**未设 `minWidth/minHeight`**（拖小即碎裂）；`--sidebar-w: 252px`（`:17`）与拖动条 `data-def="264"`（`:1414`）**矛盾 12px** |
| **视觉一致性** | 颜色纪律**良好**（令牌块外仅 4 处 oklch 字面量） | **尺寸纪律薄弱**：944 处硬编码 px、**60 个不同数值**（含 12.5px×30、10.5px×15），无间距标尺；四态语义色 `--st-*` **未落地**（命中 0）；状态**只靠文字**（`2/4 已完成`），违反「删色可辨」 |
| **可访问性** | 资产扎实：298 `aria-*` / 30 `role=` / 13 处 reduced-motion / `.sr-only` / 焦点环 / 键盘可达性实测正确 | **`aria-live` 全仓仅 1 处**（toast）→ **流式输出与运行状态对屏幕阅读器零播报**；**无自动化 a11y 门禁** |
| **性能** | — | `scrollStream()`（`app.js:894-897`）读 `scrollHeight` **强制同步重排**，被打字机每 6 字符调一次（`:994`/`:1109`）→ 读写交替的**布局抖动**；打字机用 `setInterval` 逐字符写 `textContent`，未合帧 |
| **组件复用** | 卡片全部由 `app.js` 模板字符串产出 | **无统一骨架、无注册表**（React 树有 `cards/registry.tsx` 10 类可作分类参照）；322 个 CSS 类 × 62 处 `classList` 是**纯字符串契约**（无任何静态校验）；69 处直接 `addEventListener`（仅 11 处 document 级委托） |

### 1.4 已核实**健康**、不得回退的资产

| 项 | 实测 |
|---|---|
| 键盘可达性 | `app.js:459` `if (e.key !== 'Enter' && e.key !== ' ') return;` —— **Enter 与 Space 都处理** |
| 焦点管理 | 全局 `:focus-visible`；弹层关闭后 `.focus()` 回位（`app.js:450`） |
| 色板 | 全部文字令牌实测 ≥ 5.06:1；`accent` 6.49:1(light)/8.98:1(dark) |
| 动效降级 | 13 处 `prefers-reduced-motion` 块 + `html.reduce-motion` 全局降级 |
| 转义 | `esc()` 存在且在模板拼接中使用 |

---

## 2. 优化目标（四维 + 结构性缺口，共 27 条）

详见 `01-requirements.md`。**每条都有可判定验收口径**，不含「更好看」「更流畅」这类不可判定表述。

| 组 | 条数 | 核心目标 |
|---|---|---|
| **MAINT** 可维护性与组件复用 | 7 | 单体分层、单一状态源、卡片/面板注册表、差量重绘、React 树逐项判定、探针改指、CSS 分层 |
| **RESP** 响应式布局 | 4 | 四档断点、窗口最小尺寸、中窄视口适配、右板覆盖式降级 |
| **VIS** 视觉一致性 | 6 | 四态语义色、7 态三重编码、尺寸标尺、底栏状态栏、图形编码、死代码修复 |
| **A11Y** 可访问性 | 3 | 自动化门禁、流式播报、新动效降级 |
| **PERF** 运行时性能 | 3 | 长会话窗口化、口径恢复、事件合帧 |
| **GAP** 结构性缺口 | 4 | 任务执行视图、全局状态底栏、run 批次历史、IPC 接口需求单 |

**P0 = 7 条**：MAINT-06（探针改指）、RESP-01（四档断点）、RESP-02（窗口最小尺寸）、VIS-01（四态色）、PERF-02（口径恢复）、GAP-04（接口需求单）、A11Y-01（a11y 门禁）。

---

## 3. 重构与设计方案

### 3.1 目标架构：7 层单向依赖

详见 `03-refactor-design.md` §1。**核心是把"拼接体"变成"分层体"**：

```
工具层(utils) → 状态层(单一 store) → 投影层(复用 projections.ts)
                                        ↓
                     组件层(卡片/面板注册表) → 视图层(render/*.js)
                                        ↓
                            桥接层(bridge/ipc.js) → 启动层(main.js)
```

**三条硬规则**：
1. **桥接层是唯一能碰 `window.agent` 的地方**（现状：`app.js:1660-2281` 的 IIFE 覆写原型函数，与原型层共享 `sessions`/`selectedId`/`archived`）。
2. **状态收敛到单一 store**；**mock 降级为可选 seed 源**（`!window.agent` 时注入 store），不再是平行实现。
3. **桥接层只做 `IPC → store.dispatch` 映射**，**不再覆写任何函数**（消除 `send = async function(){...}` / `selectSession = async function(){...}` 这类覆写，`app.js:2181`/`2209`）。

### 3.2 迁移策略：11 步，每步门禁可跑 + UI 可用

详见 `03-refactor-design.md` §2。用「**同名 shim 转发 + 开关并行**」把 4147 行拆开。
**最高风险步 = M2 抽状态层**（两半共享根），次高 = M5 桥接层重写。

### 3.3 设计系统：补齐标尺，不换视觉

详见 `02-design-system.md`。**方向是"演进而非推翻"**：

| 决策 | 内容 |
|---|---|
| 保持 | oklch 灰阶骨架、`-apple-system/SF Pro/PingFang SC` 字体栈、单一钢蓝 accent、**不动任何既有令牌名** |
| 新增 | 间距标尺 `--sp-*`(12)、圆角标尺 `--r-*`、四态语义色 `--st-*`、`--border-strong`、`--statusbar-h`、`--tap-min` |
| 关键取舍 | **四态不新增色相**——映射到既有 `--ok/--muted/--warn/--danger`，把"四态"从"新色"降级为"新命名 + 三重编码"，零色板风险 |
| 状态编码 | **7 态三重编码（色 + 形 + 字）**，硬约束：**全部转灰后仅凭图形 + 文字仍能区分 7 态** |
| 字形实测 | `⊘` 仅 Apple Symbols 有、`⏸/⏳/❚` **全栈缺失（会落到彩色 emoji）** → **状态字形一律用内联 SVG**（代码库已有 30+ 先例） |
| 四档断点 | `min-width:1600 / max-width:1599 / max-width:1279 / max-width:1023`，**整体替换**单一 920 断点（920 由 1023 档吸收，**无冲突**） |

### 3.4 性能方案（每条都有可测指标）

| 手段 | 目标指标 | 测量 |
|---|---|---|
| 长会话**窗口化** | 10k 事件 DOM 消息节点 **≤ 300** | CDP `querySelectorAll('.stream-inner > .msg').length` |
| 滚动 | 一屏 **≤ 200ms** | CDP 3 次 `performance.now()` 取 max |
| 首帧 | 打开 10k 会话 **≤ 1s** | CDP 注入计时 |
| `scrollStream` 重排消除 | 打字机期间 **forced reflow = 0** | DevTools Performance「Layout」计数 |
| 事件合帧 | rAF 批处理，不再逐字符 `setInterval` | 同上 |
| 差量重绘 | `innerHTML` 处数 **≤ 12**（现 36） | `grep -c` |

### 3.5 D1 收口：React 树逐项判定 + 探针改指

详见 `03-refactor-design.md` §7。**关键纠正**：`projections.ts` **不是"随 React 树归档"**，实测被 **3 个门禁脚本**（`panels-check`/`agents-check`/`sidechat-check`）+ **4 个测试文件**引用 → 应**升格为共享投影层**（vanilla 与门禁共同消费的纯函数模块）。

**7 个探针改指**（**严禁伪造 `data-m1e-*`**）：

| 探针 | → vanilla 真实目标 |
|---|---|
| `[data-m1e-event-count]` | `#eventCount`（新增于底栏 `.statusbar`） |
| `[data-m1e-item]` | `.stream-inner > .msg` |
| `[data-virtuoso-scroller]` | `.stream`（`index.html:1420`） |
| `[data-approval-badge]` | `.card.ask[data-ask]`（`app.js:2130`） |
| `[data-panel-toggle="git"]` / `[data-panel-id="git"]` | `[data-view="git"]`（需新增该视图） |
| `[data-m1e-settings-open]` | `#settingsOpen` |

⚠️ **改 `scripts/panels-check.ts` 属判据变更，按纪律须先立 `BLOCKED.md` 获批**——不许直接改代码去绕。

### 3.6 结构性缺口：一处实测阻断

| 编号 | 目标 | 内核依赖 |
|---|---|---|
| GAP-01 任务执行视图 | `data-view="tasks"`，数据用**已存在**的 `projectAgentPanel`（`projections.ts:449`） | **否** ✅ |
| GAP-02 全局状态底栏 | `.statusbar`，沙箱来自 `getState().sandbox`（`ipc-protocol.ts:43`） | **否** ✅ |
| GAP-03 run 批次历史 | `data-view="history"` | **是** 🔴 |

**🔴 实测阻断**：`src/events/index.ts` 全部事件**无 `runId`/批次 id/时间戳**；`openSession(id) => {events}` 无分页/聚合；`SessionInfoPayload` 仅会话级。唯一存在的批次历史是**定时任务**的 `ScheduleSnapshot.history`。
→ **GAP-03 降级为结构占位**（空态「暂无批次数据 · 需内核暴露 run 聚合」），并单列 IPC 接口需求单（建议 `listRuns(sessionId) => RunInfo[]` 或事件增 `runId`+`ts`）。**不改内核 IPC 语义。**

---

## 4. 预期改动范围

详见 `03-refactor-design.md` §9（24 行逐文件清单）。

**总览**：**删除约 40 文件**（React 树）· **新增约 20 文件** · **改写 4 文件** · `app.js` 2281 行 → **拆为 9 文件**（各 ≤500）· `index.html` 1866 → **~500 骨架 + 5 层 CSS**。

**风险最高的 3 处**：

| 排名 | 文件 | 风险 | 回归方式 |
|---|---|---|---|
| 🔴 1 | `src/renderer/app.js`（拆分 + 状态收敛） | 最高：F-2 无类型保障 | golden 快照 + 双跑 diff + 全门禁 |
| 🔴 2 | `scripts/panels-check.ts`（判据变更） | 高：牵动门禁绿红，**需 BLOCKED 批准** | 换判据后 7 探针命中 ≥1 |
| 🟠 3 | `src/renderer/index.html` → `css/*`（CSS 出层） | 高：**静默破坏面**（322 选择器 × 62 处 `classList` 纯字符串契约） | 逐像素对比 + 截图 diff |

**改动面最小的 P0 项**（低成本高收益，建议先落）：`src/main/index.ts` **+2 行**（`minWidth/minHeight`）· `gate-manifest.ts` **+1 行**（登记 a11y-check）。

**最容易被低估的三项工作量**：① 桥接层**行为等价回归**（覆写语义含权限映射/running 守卫/ask 卡/两级折叠，难自动化测）；② **CSS 出层的静默破坏面**；③ `projections.ts` 的依赖面（比初判大得多）。

---

## 5. 验证方式

### 5.1 分层验证矩阵

| 层 | 方式 | 判定 |
|---|---|---|
| 全量回归 | `pnpm gates`（**26 道**） | ⚠️ **9 项未证，未证 ≠ 通过，不得宣称全绿** |
| 探针/钩子 | `pnpm panels-check`（**须先按 §3.5 改判据并获批**） | 7 探针命中 ≥1；被指元素删除即功能失效 |
| 响应式 | 960/1024/1280/1600 四档截图 | 主区 ≥480px、输入区不折叠、960–1023 右板为覆盖式 Sheet、无横向溢出 |
| 双主题 | light/dark 逐屏目检 + **对比度复算** | 正文 >7:1、次级 >4.5:1、非文字图形 ≥4.5:1 |
| 无障碍 | 新增 `scripts/a11y-check.ts`（CDP + axe-core）登记进门禁（26→27） | 3 视图 critical+serious = 0；13 处 reduced-motion **零回退** |
| 性能 | CDP 探针（对齐 §3.4 指标表） | 10k → DOM ≤300；滚动 ≤200ms；首帧 ≤1s |
| 架构 | 新增 `scripts/renderer-arch-check.ts`（依赖方向断言） | 桥接层外不得出现 `window.agent`；覆写赋值 = 0 |
| 删色可辨 | 7 态截图转灰 | 仅凭图形 + 文字仍可区分 7 态 |
| 特征测试 | 新增 `tests/renderer-golden.test.ts` | 重构前后 DOM 快照一致 |

### 5.2 本轮已执行的**独立验证**（不是自评）

| 手段 | 结果 |
|---|---|
| **两次独立对比度复算**（主理人 Python 手写 vs 设计系统专家 Node 手写，互不引用） | **14 个数值逐位吻合**；且双方独立得出同一结论：**源码注释宣称的 `--fg` 19.9:1 实为 17.71:1**（注释偏乐观，最大偏差 2.19） |
| 构建产物反查 | `react` 在 `out/renderer/assets/*.js` 中出现 **0 次** → 发货确为 vanilla |
| 行号抽查 | 规范中 `data-tool-toggle`(6 处)、`.stream`(`index.html:1420`)、`--sidebar-w:252` vs `data-def:264`、`--dur`/`--ease-enter` 不存在 —— **逐条验证为真** |
| 依赖面核对 | `projections.ts` 被 3 门禁脚本 + 4 测试文件引用 —— **修正了简报初判** |

### 5.3 流程纪律（本轮遵守，后续请保持）

- **禁止伪造 `data-m1e-*` 钩子**迎合探针——那是**制造假绿，比红门更糟**。
- 发现判据有缺陷 → **写 `BLOCKED.md` 要求换判据，不许改代码去绕**。
- 判卷文件（`fixtures/todo-app/tests/**`、`fixtures/mock/**`）sha256 冻结，**改它们等于作弊**。
- **未证 ≠ 通过**：报告必须如实标注未证项，不得宣称全绿。

---

### 5.4 质量审查结果（Phase 4，独立审查官）

**结论：PASS，21 / 25**（设计哲学 5 / 视觉层次 4 / 执行质量 3 / 特异性 5 / 克制 4），**P0 = 0，P1 = 2，P2 = 8，P3 = 8**。

审查官**不是复述文档**，而是逐条去打。它实际做的：

| 手段 | 结果 |
|---|---|
| **自写第三份对比度复算**（与文档脚本、与主理人 Python 脚本**均无复用**） | 抽查 16 令牌 × 双主题 × 2 基准面，**13 组逐位吻合**；3 组不吻合全部集中在 `--border-strong`/`--border` 的数值与**基准列标**上，**不改变结论方向** |
| **行号抽查 ~100 处** | **仅 1 处错**（`02 §0.2#12` 一处函数名张冠李戴）——「行号精度」是本轮最大风险点，结果优秀 |
| 钩子全量枚举 | **完全吻合**（65 个 token 无一遗漏、无一虚报） |
| 需求覆盖核对 | **27 条全覆盖**，仅 1 条口径含糊 |
| 自解析 TTF cmap | 独立验证了「`⏸` 全栈缺字、`✓/✗/●/○` 在 `-apple-system` 可用」的字形结论 |
| 反事实检查 | **未回避难点**（迁移策略、性能指标、阻断项都给了可执行内容） |
| 红线核查（4 条） | **全部通过**：无伪造 `data-m1e-*` 建议、无重命名冻结钩子、未改 `src/`、未宣称门禁全绿 |

**P1 两条已修**（按流程退回**原作者**修，主理人未代改成员产出）：
1. `01 ↔ 03` 对 `MAINT-06` 给出**相反**验收口径 → 已统一为「`projections.ts` **升格为共享投影层**（保留）」（依据 `03 §7.4` 实测：3 门禁脚本 + 4 测试文件引用它）。
2. `A11Y-02` 口径 `grep -c 'aria-' ≥298` **不可判定**（`grep -c` 得的是**行数** 241，298 是**出现次数**）→ 已改为明确的出现次数口径。

**P2 关键项已修**：`--border-strong` 数值自相矛盾 → 根因是**两个不同的 oklch 值**（62% → 3.64:1、64% → 3.36:1）被混用，已统一到 62%（余量 21%），两处表格一致；主理人独立复算 `#83878b` vs 白 = **3.62:1**，确认 ≥3:1 成立。`MAINT-05` 残留的 6 项 TBD 已逐项闭环（原型构建师把唯一不确定点显式写成「假设 A1」并给出翻转路径，未含糊带过）。

**残留项已定案（主理人收尾复算）**：`--border-strong` **dark** 曾被记为三处不一致（文档 3.83 / 审查 4.13 / 3.50）。复算后确认——**三个数都对，根因是「基准面未标注」**：

| `--border-strong` dark `oklch(56% .012 250)` = `#6f757b` | 对比度 |
|---|---|
| vs `--bg` `#0b0f14` | **4.12:1**（= 审查官的 4.13） |
| vs `--surface` `#13181e` | **3.83:1**（= 文档的 3.83） |
| vs `--surface-2` `#1b2127` | **3.48:1**（= 审查官的 3.50） |

**最低值 3.48:1 仍 ≥3:1 → `--border-strong` 结论成立，无需改色。** 同一根因也解释了 `--border` 的「列标写 vs bg、实算 vs surface」——审查官那条「基准错标」判断是对的。

> **流程改进（建议并入规范硬约束）**：**对比度数值必须连"基准面"一起标注**（如「3.83:1 @ `--surface`」）。本轮三份独立复算全部算对，却因基准面未标注而看起来互相矛盾，白白产生一轮"残留待核"。**未标注基准的对比度数字不可用于决策。**

---

## 6. 落地路线（P0 → P2）

| 级别 | 内容 | 完成标准（可判定） |
|---|---|---|
| **P0** | 探针改判据（**先 BLOCKED**）· 四档断点替换 920 · `minWidth/minHeight` · 四态色 + 每态 ≥1 消费点 · 性能口径恢复 · IPC 接口需求单 · a11y 门禁 | 7 探针命中 ≥1；`grep 'minWidth\|minHeight'` ≥2；`--st-*` ≥4 处；`gate-manifest` 26→27 |
| **P1** | 模块拆分 + 单一状态源 · 注册表 + 差量重绘 · React 逐项判定表 · 中窄适配 · 底栏 + 三态修复 · 窗口化 + 委托 | 覆写赋值 = 0；`let sessions` 命中 = 1；`KNOWN_CARD_TYPES ≥ 10`；`innerHTML ≤ 12`；10k DOM ≤300 |
| **P2** | CSS 分层 · 死代码修复 · run 历史占位（依赖 GAP-04 接口） | `@layer` 结构就位；归档区点击路径真实分离；占位空态不报错 |

**建议的推进顺序**：先做 **P0 里那两项「+1/+2 行」的低成本项**（窗口最小尺寸、门禁登记），立刻拿到可感知收益；同时立 `BLOCKED.md` 走探针判据变更——**它是后续一切验收的前置**。

---

## 7. 需要你决策的事项

| # | 事项 | 说明 |
|---|---|---|
| 1 | **探针判据变更（BLOCKED）** | `panels-check` 7 探针改指 vanilla 真实钩子，属**判卷文件变更**，按仓库纪律须先立 `BLOCKED.md` 获批。**建议优先**——不解则门禁结论无意义。 |
| 2 | **未提交的 vanilla 迁移是否入库** | 当前工作区 `index.html` 已改、`app.js` 未跟踪、`main.tsx`/`styles.css`/`error-boundary.tsx` 已删——**这是一笔未提交的架构变更**。建议先收口提交，再谈重构。 |
| 3 | **React 树归档时机** | 判定表已出（移植 4 / 替代 23 / 放弃 2）。**`message-scroller` 的虚拟化能力需先移植**，否则删了就没得参考。 |
| 4 | **GAP-03 是否接受结构占位** | 通用 run 批次回溯**依赖内核补字段**（`runId`+`ts`）。接受占位 → 前端先落骨架；要完整功能 → 需内核排期。 |
| 5 | **文档漂移清理** | `docs/` 下验收截图与 `outputs/ui-design-*.md` 两份历史提案**均按 React 版描述现状**，会持续误导。 |

---

## 8. 交付物索引

| 文件 | 内容 | 规模 |
|---|---|---|
| `00-recon-brief.md` | 侦察简报（全团事实基线） | 236 行 |
| `01-requirements.md` | **需求摘要**：27 条需求 + 可判定验收口径 + P0/P1/P2 | 261 行 |
| `02-design-system.md` | **设计系统规范**：令牌/状态编码/四档断点/组件施工图/钩子清单/探针改指/A11Y | 693 行 |
| `03-refactor-design.md` | **重构施工图**：目标架构/迁移策略/性能方案/**改动范围清单**/落地计划 | 861 行 |
| `04-critique.md` | **质量审查报告**：5 维评分 + 独立验证记录 + 缺陷分级 | 见文件 |
| `evidence/contrast-recompute.md` | 对比度独立复算 + 交叉验证（含脚本） | — |
| `evidence/lead-findings.md` | 主理人独立实测 8 条发现 | — |
| `05-master-plan.md` | 本文件 | — |
