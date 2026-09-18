# 设计矛盾台账 + 待办清单 · 2026-09-18

> **性质**：调研产物。**未改 `src/`、未跑门禁、未创建提交、未开始任何实现。**
> 基线 HEAD `d063003`（R1a）。每条**文档矛盾**都配一条**本机可复跑的实测证据**；
> 只采信我自己复测过的数字，子代理报告里未复核的部分已剔除。
> 配套调研：`outputs/desktop-ui-research-2026-09-18.md`。

---

## 第一部分 · 矛盾台账

### 类 1｜文档称「已施工」，代码里不存在 —— **最危险**（下一轮会拿它当前提）

| # | 文档说法 | 实测 | 证据 |
| --- | --- | --- | --- |
| C1 | `--tap-min: 28px`「适用于新控件」（`ui-v3-forge/02` §A.4） | **声明 2 次，引用 0 次** | `grep -o 'var(--tap-min)' index.html` → 空 |
| C2 | 7 态**三通道编码**（色+形+字）已裁决（`ui-v3-forge/05` §3.4 / `refactor/02` §B.1） | `data-st` **0 次**、`.st-dot` **0 次**；且令牌只有 **5 态**（`--st-done/run/wait/stuck/fail` + 各自 `-fg`） | 实测枚举 `--st-*` |
| C3 | 「4 条断点已施工」（`refactor/06` §1③） | 实测 **3 条**：`min:1600` / `max:1279` / `max:1023` | `@media (min|max)-width` 枚举 |
| C4 | 自报 reduced-motion **13 → 17**（`desktop-optimize/02`），并建议门槛 `≥17` | 实测 **13** | `grep -c prefers-reduced-motion` |
| C5 | 建议门槛 `aria ≥303`（且 298 基线「无法复现」） | 静态 HTML `aria-*` 出现 **195** 次（P0 落笔前测得 194，差 1 来自未提交的 `ic-send`/`ic-stop` 两个 `aria-hidden`；复跑见 `docs/ui-fact-baseline.md` F16）；且 `a11y-check` **根本不做计数断言**（跑的是对比度 / `aria-selected` 值域 / orphan `aria-controls` / `aria-hidden` 内可聚焦） | `scripts/a11y-check.ts:245-298` |
| C6 | 「新增 z-index 30/40」（`desktop-optimize/02`） | 实测档位 **6 40 60 61 70 71 80 90**，**没有 30** | `z-index:` 枚举去重 |
| C7 | 64px 图标栏设计 → 改 208px 窄列（`refactor/06` §2.3） | 决策一致，但 `--rail-w` **声明 2 次引用 0 次** = 死令牌 | 同 C1 方法 |

⇒ **C4/C5 合起来是一条判卷问题**：两个门槛数字只活在文档里，从未接进门禁。
若哪天有人真按 `≥17 / ≥303` 写断言，今天**必红**（13 / 195）。按本仓纪律应走 `BLOCKED.md` 要求换判据，不是改代码凑数。

### 类 2｜代码自身矛盾：同一件事多套实现

| # | 现象 | 实测份数 | 证据 |
| --- | --- | --- | --- |
| D1 | 浮层机制 | **4 套**：`showPop`+`getBoundingClientRect`（`app.js:1194-1215`）/ `.sb-menu` 重挂 body / `#askPop` 运行时构建 / `#modelPop` absolute | `app.js:395,1194,1198,1215,1539` |
| D2 | 模态机制 | **2 套**：`#settingsOverlay` / `#riskScrim`，手写 `inert` 共 **6 处**（html 2 + `app.js` 4；原记「4 处」漏了 JS 侧写入点，已按 `docs/ui-fact-baseline.md` F11b 复跑更正） | `index.html:1795,1943`；`app.js:521,529,1442,1448` |
| D3 | 折叠机制 | **3 套且状态名相反**：`.collapsed`（10 处）vs `.expanded`（3 处）。`<details>` 实测 **1 处**（`app.js:1876`，重放渲染器）——⇒ **两套渲染器在「用不用原生件」上互相矛盾**：重放侧已走原生 `<details>`，live 侧仍手写三套 | `index.html:1031,1677,1690`；`app.js:1876` |
| D4 | 抽屉显示 | **2 套且同名反义**：≥1280 用 `.drawer.collapsed{width:0}`（`:1031`）；≤1279 用 `.drawer.collapsed{width:min(--drawer-w,88vw)}` + `.open-m{transform}` + `.collapsed.open-m{translateX(100%)}`（`:1435-1449`）⇒ **同一个 `.collapsed` 在两个断点下含义不同，窄屏还要第二个 class 反转** | 见行号 |
| D5 | 函数双实现（后一份覆写前一份） | **7 个**：`openView`/`closeView`（`app.js:1243-1246` `const _openView = openView; openView = function…`）+ `send`:2462 / `selectSession`:2502 / `deleteSession`:2555 / `archiveSession`:2577 / `renderSide`:2598（`window.agent` 分支内） | 见行号 |
| D6 | 主题令牌两份全量块 | 81 个名字 / **132 处声明 / 44 个名字重复声明** | `(--[\w-]+)\s*:` 计数 |
| D7 | 死界面 | **101 个 id 中 37 个无 JS 引用**（部分是 `aria-controls`/CSS 锚点属合法，须逐个归因）；5 张 quick-card 全靠 `[data-view]` 委托，自身 id 从不被读 | 复跑脚本已给 |
| D8 | 演示残留活在真实模式 | `INITIAL_TRANSCRIPT` 每次切会话重注入；`WORKSPACES`/`BRANCHES` 仍是演示数据（AGENTS.md 归为 R2） | `app.js:922,704,813` |

### 类 3｜文档彼此矛盾（轮间，共 8 处，取有施工影响的）

| # | 冲突 | 影响 |
| --- | --- | --- |
| E1 | 轮 1「四态新增 4 色相」→ 轮 2「**不新增色相**，别名 `--ok/--muted/--warn/--danger`」 | 色板以哪份为准未定 |
| E2 | 轮 1 断言 `⊘/⏸` 浏览器实测单色可辨 → 轮 2/3 判「缺字/emoji，须内联 SVG」 | 状态字形实现路径未定（与 C2 叠加） |
| E3 | 轮 2「骨架屏**放弃**」→ 轮 3「因 PERF-01 **复活**」 | 是否新增一个组件未定 |
| E4 | `MAINT-06` 在 `01` 与 `03` 给出**相反的验收口径** | 该条不可判 |
| E5 | `--border-strong` 同值两数（3.64 vs 3.36；暗色 3.83/4.13/3.50 都称"正确"），根因**基线面未标注** | 对比度门无法复核 |
| E6 | 状态数 7（轮 1/2）→ 3 形状（轮 3）；实测**令牌 5 态**（C2） | 7 份说法、0 份落地 |
| E7 | 各文档并存 5 个不同"钩子计数"（30/32/41/65/38） | 无法判定哪个是真 |
| E8 | 门禁数文档 26→28 两种说法；**实测 `GATES` = 29 条**（`scripts/gate-manifest.ts`，含 `mutate-verify`） | AGENTS.md 已警告过这是漂移磁铁 |

### 类 4｜门禁可信度矛盾

| # | 现象 |
| --- | --- |
| F1 | `panels-check` 的 `#eventCount` 与探针 `[data-m1e-event-count]` **语义不等价**（轮 2 主理人已自纠）；`:285` 是上界恒真、`:280` 分不清"快"与"根本没滚" |
| F2 | `renderer-arch-check` 与 `a11y-check` **默认 `--static`**，源码注释直说"本宿主 Electron 交付壳起不来"（`scripts/renderer-arch-check.ts:11-12`）⇒ 两道门**从未在真实交付壳上绿过**，其绿灯不等于线上壳通过 |
| F3 | 轮 1/2 设计的 task/run 视图，内核 `grep -c runId src/events/index.ts` → **0**：聚合单位不存在，P2 排期建立在不存在的数据上 |

### 类 5｜已自行消解（记为闭环，别再重查）

| # | 原记载 | 现状 |
| --- | --- | --- |
| G1 | `desktop-optimize/07` §5.1「960×600 最小窗口已编码但**未提交**」 | **已提交**：`src/main/index.ts:68 minWidth: 960`，`git diff HEAD` 无输出 |
| G2 | 「空态已统一」——无人这么写过，但代码形状会让人这么假设 | **曾是两处假象**：删除当前会话那条路径直写 `streamInner.innerHTML = CHAT_EMPTY_HTML`，绕过 `showEmptyStream()` ⇒ 「返回上一个对话」按钮**没接监听器 = 死控件**。已由 R1b 修（`4afcee9`：改回复用 `showEmptyStream()`，并把按钮目标改成按调用时解析 `selectedId || sessions[0].id`，无会话时给提示而非静默） |
| G3 | 同上——「空态就是那个空态卡片」 | **曾是真的**：真实 app 在零会话（首次启动 / 删完最后一个）时，`.stream-inner` 里留着 `index.html` 的演示对话（`INITIAL_TRANSCRIPT = streamInner.innerHTML` 就是从那段抓的）⇒ 用户看到的是**假对话**而不是空态。已由 R1b 修（`4afcee9`：启动分支补 `else if (loaded && !real.id && !sessions.length) showEmptyStream()`） |

---

## 第二部分 · 待办清单

**排序原则**：先让文档与代码一致（否则每轮都在错误前提上施工）→ 再补 bug 级能力 → 再做减法 → 最后才谈重排。
**每条都给了验收方式**，没写验收方式的不要开工。

### P0｜bug 级，不属审美分歧，建议不等设计轮

> **2026-09-18 实施更新（本会话，TDD 先红后绿）**：三条都已实现，全量 `test` **845/845**、`build`、
> `panels-check` 全绿。过程中又挖出两条更底层的**在跑 bug**，一并修：
> ① `app.js:1173` 原为 `addEventListener('click', send)`——**按值捕获**演示版 `send`，
>   真实 `send` 要到 `window.agent` 块内才重赋值 ⇒ **点发送按钮走打字机假回复、按回车才走真 agent**
>   （正是 D5 双实现的直接受害者）。
> ② `api.run` 要等整轮跑完才 resolve，而 `real.running` 只在**失败**路径复位 ⇒
>   **成功跑完一轮后，发送 / 切会话 / 新建全被自己的「请先等待完成」toast 永久挡死**。
> 另：T2 只补 live 渲染器等于没修——重放走 `projectHistory`+`renderHistoryRow`，
>   原会把 error 折成通用「查看记录」桩（重开会话即失败不可见），已两路都补并共用同一句恢复动作。
> ✅ **已落库 `eafcbfb`**（13 文件 +518/−16，索引自证零外来文件）。过程中曾被并发写阻挡约一小时：
>   `loop.ts` / `events/index.ts` 当时与另一会话未完成的「能力 5 收束闸」混在同一文件。
>   按协调规则 2 未代提交、未改写对方 diff；对方以 hunk 级落库 `d60dbcc` 后（实测其提交里
>   `RunErrorEvent`/`isAbortLike` 均 0 命中，没扫走我的行），我的簇才单独入库。
>   **提交后复跑**：`typecheck` 0 / `test` 88 files 845 passed / `e2e` 0 / `ipc:check` 0 /
>   `panels-check` 全绿（scrollTop 实测 449853）/ `sidechat-check` 33✅0❌ / `renderer-arch-check` 0 / `a11y-check` 0。

- [x] **T1 补「停止运行」按钮**（`eafcbfb`）。做法：`#sendBtn` 一键两用——运行中 = 停止（形状 ↑→■，**不新增色相**），
      空闲 = 发送；`real.running` 与 `api.runCancel()` 经 `runControl` **单一分派器**注入，消除按值捕获。
      *验收*：`tests/renderer-run-control.test.ts`（含「点击必须按调用时解析 send」这条，直接锁死 ① 的回归）。
- [x] **T2 失败可见性**。做法：`RunErrorEvent` + `KNOWN_TYPES` 注册；`loop.ts` 在**模型流边界**包一层守卫，
      落 error 后**原样上抛**（调用方语义逐字不变）；取消（AbortError / signal.aborted）**不落** error；
      渲染层 live + replay 各一张失败卡（原因逐字 + 恰好一个恢复动作 + `role="alert"`，replay 走 `textContent` 无注入面）；
      `sidechat` 只读投影纳入。**刻意未碰**在飞的 `glm-session.ts` / `providers/registry.ts`。
      *验收*：`tests/loop-error-event.test.ts` 5 条 + `renderer-run-control.test.ts` 失败可见性 6 条。
- [x] **T3 滚动跟随策略**。做法：距底 `> SCROLL_FOLLOW_LOCK_PX(100)` 不吸底；
      `force` 参数保留三处结构性重挂（`showHistory` / `appendUser` / 拖分隔条改宽）必须吸底
      ——否则打开会话落在顶部、`panels-check` 的 scrollTop 断言会假红。
      *验收*：`tests/renderer-scroll-follow.test.ts` 6 条；`panels-check` 实测 scrollTop 落位 449853 仍绿。


### P1｜矛盾收口（让下一轮拿到正确前提）

- [x] **T4 权威问题已由协调会话裁定（2026-09-18）**：**不存在、也不应存在单一「权威设计文档」**。
      权威拆两面各自唯一：① **意图面** = `agent-plan.md` §10.1 七条布局定稿
      （含第 4 条「同一事件流的两个视图，不产生第二事实源」——直接判死渲染器/折叠/空态的多份重复）；
      ② **事实面** = `docs/ui-fact-baseline.md`（每个可判定量 + 复跑命令）。
      三轮旧文档降为存档、只加 banner 不改写正文。
- [x] **T5 死令牌处置**：`--tap-min`、`--rail-w` 各「声明 2 / 引用 0」→ **选删**（接线要给一个没人要的点击尺寸，且当前控件另有既有值在用）。
      已落 `7d2c880`（1 文件 −4 行）。删前全查引用面：`scripts/` / `tests/` / `src/` 除自身声明外**零命中**。
      复验：`build` 0、`a11y-check` 0（52✅）、`renderer-arch-check` 0（29✅）、`panels-check` 全部断言通过。
      ⚠️ **本条原记账口径太窄**：普查全体后发现真值是 **28 / 79 名（35%）零引用令牌**——
      `--sp-*` 缺 10/12、`--r-*`+`--r-pill` 全 8、`--st-*` 缺 5、另 `--code-bg`/`--ease-spring`/`--font-display`/`--t-instant`。
      我原先只查了那两个名字就记「已清」，属本页自己的 C1 类缺陷。复跑与清单见 `docs/ui-fact-baseline.md` F13/F13b。
      **剩余 26 个未动**（属 `src/renderer/`，R1b 正在写 `app.js`/`history-window.js`，按调度停手）。
      **性质已核实为漂移而非有意预留**（避免把 grep 命中当缺陷）：尺寸/圆角/字号属性里
      **字面 px 声明 492 处**，而 `var(--sp-*)` 只用 **3** 次、`var(--r-*)` 只用 **1** 次
      ⇒ 规模被声明出来后被 CSS 直接绕开；存档规格 `06` §1② 的原话是「`--sp-1..12` + `--r-1..7/pill/full`
      + `--t-instant`——**全部保持**」，即"保留"被当成了"施工"。
- [ ] **T6 状态编码定案**（C2 + E6）：文档 7 态 / 令牌 5 态 / 落地 0 态。选定态数后**要么**补 `data-st` + 形状通道，**要么**正式放弃三通道并改文档。别留"文档说做了"。
- [x] **T7 / T8 / T10 三条合并收口，但修法换了**——原定「从文档删除 / 以代码为准重写」**不可执行**：
      已裁「三轮旧文档只加 banner、正文一字不改（改写即伪造历史）」。故改为**两步合规法**：
      ① **勘误指针挂在 banner 上**（banner 是我们拥有、可改的部分）——`desktop-optimize` 三份的 banner
      已写明 C4（reduced-motion 13 非 17）、C6（z-index 无 30 档）；`frontend-refactor` 八份的 banner
      已写明数字层作废 + 漂移实值 + 仍有效部分。② **实数落在事实基线页**（F15=13、F16=195、F17 无 30、F20=29）。
      ⇒ 存档正文一字未动，但错数已在两处被标注为不可信。
      ⚠️ 遗留一处**未修**：`AGENTS.md:81` 自己写着「28 / 28 退出码全 0」，而 `AGENTS.md:8`/`:147` 明文
      「一律不写死门数」——**它破了它自己定的规矩**，实测 HEAD 态为 29 条（工作树 30，他人在飞加 `ipc-reachability-check`）。
      我按那一行是「2026-09-17 实测」的**带日期记录**处理，未改写，只在此登记；改它需你授权（AGENTS.md 管辖所有后续会话）。
- [x] **T9 对比度基线面标注**（E5）：**改为实测矩阵而不是"标注意见"**——见本文第三部分。
      结论：三套自称正确的值全部为真、各自对应一个基线面；最低 3.14，八格全 ≥3.0，
      ⇒ 令牌本身合规、**不需改色值**，只需引用时带面。`--fg`/`--muted`/`--dim` 亦全过。
- [x] ~~T10 门禁数以脚本输出为准~~ —— 已并入上方「T7 / T8 / T10 合并收口」行（本行原为未勾，与合并行互斥，故就地标注，避免同一份账里两个答案）。

### P2｜减法（把重复机制换成平台原生件；0 依赖、0 构建、不碰 CSP）

> **前置 T11（硬闸）**：本组所有条开工前，先做一次 CDP 探针确认
> `CSS.supports('anchor-name: --a')` / `'popover' in HTMLElement.prototype` /
> `CSS.supports('color: light-dark(red,blue)')` / `CSS.supports('field-sizing: content')`
> 在**本仓渲染进程**为 true。运行时是 Chromium 152.0.7977.76（已从二进制实测），
> 但可用性目前**只是版本推断，未实测** —— 不背书。
- [ ] **T12 先出 `panels-check` 钩子白名单**（F1 未闭），列出哪些 class/id 被探针消费；白名单外的才允许删。
- [ ] **T13 浮层 4 → 1**（D1）：`popover` + `popovertarget` + CSS 锚点定位。删 `showPop` 测距、outside-click、Esc、焦点管理。
- [ ] **T14 模态 2 → 1**（D2）：`<dialog>` + `showModal()` + `::backdrop`；删手写 `inert` 4 处与三档 Esc。
- [ ] **T15 折叠 3 → 1**（D3）：`<details>/<summary>`，`aria-expanded` 与键盘行为由平台负责；统一命名。
- [ ] **T16 抽屉两机制合一**（D4）：消除 `.collapsed` 在两个断点下的反义。
- [ ] **T17 monkey-patch 收单实现**（D5）：7 个双实现函数各留一份。
- [ ] **T18 主题令牌 2 份块 → `light-dark()` 一份**（D6）：44 个重复声明，暗色只写差异项。
- [ ] **T19 composer 测高改 `field-sizing: content`**：删 `app.js:994` 隐藏 textarea 量高。
- [ ] **T20 断点 3 档 → 容器查询 `@container`**：删 `--center-w` 三处重算（`:184`/`:205` 等），面板按自身宽度响应。
- [ ] **T21 37 个无 JS 引用 id 逐个归因**（D7）：合法 aria/CSS 锚点保留并注记，其余删。
- [ ] **T22 删 `INITIAL_TRANSCRIPT` 静态演示对话**（D8）：空态走 `panelEmptyHTML()` 同口径。
- [ ] **T23 宽屏正文行宽封 72ch**：`--content-max` 1040 封顶在 ≥1660 视口 → 992px ≈ 147 字符/行；prose 收窄，**code/diff 允许更宽**。1440 档（736px）本已在带内，别动。

      *P2 组统一验收*（可判定量，替代"看着简单了"）：界面数 35→≤20；浮层/模态/折叠 4/2/3→**1/1/1**；
      双实现函数 7→0；无引用 id 37→0；令牌声明 132→≈81；前端依赖数维持 **0**；`index.html`/`app.js` 行数**下降**。

### P3｜依赖内核，先补数据再画 UI

- [ ] **T24 内核加 `runId` 聚合单位**（F3）：现在 `runId` 在 `src/events/index.ts` 出现 0 次。**在它有生产者之前，task 视图 / run 批次历史一律不做**。
- [ ] **T25 `WORKSPACES` / `BRANCHES` 真化**（= AGENTS.md 的 R2）：⚠️ **并发会话可能正在做，先查在飞改动，别撞车**。

### 贯穿项

- [ ] **T26 与你确认并发顺序**：`src/renderer/` 有 R1a→R2 在推进，P2 组改的是同一批文件。
- [ ] **T27 每步验收一律 `TERM=dumb pnpm gates`**；构建假红时按 AGENTS.md 的 `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR=` 绕法，别去改探针。
- [ ] **T28 判据有缺陷 → 写 `BLOCKED.md` 要求换判据，不许改代码去绕**（本清单里 T2/T7/T12 都可能触发）。

---

## 第三部分 · T9 实测：`--border-strong` 对比度矩阵（E5 就此了结）

E5 的病根是「基线面未标注」——三套都自称正确的值其实是**同一个令牌落在不同表面上**。
本机复算（oklch → 线性 sRGB → WCAG 相对亮度；不经过二次 gamma）：

| 基线面 | light 令牌值 | light 比 | dark 令牌值 | dark 比 |
| --- | --- | --- | --- | --- |
| `--bg` | `oklch(62% 0.008 250)` | **3.64** | `oklch(56% 0.012 250)` | **4.13** |
| `--surface` | 同上 | **3.64** | 同上 | **3.83** |
| `--surface-2` | 同上 | **3.51** | 同上 | **3.50** |
| `--surface-3` | 同上 | **3.35** | 同上 | **3.14** |

**结论**：三套「正确值」全部为真，各自对应一个面——`3.64`=bg/surface、`3.50/3.51`=surface-2、
`3.83/4.13`=dark 的 surface/bg，`3.36`≈dark `--surface-3` 侧的近似。争议不是算错，是**没写基线面**。
最低 **3.14**，八格全部 ≥ 3.0 ⇒ **该令牌在双主题每个实际表面上都满足 WCAG 1.4.11 非文字对比度**，
无需改色值；要做的只是标注。附带复算 `--fg` / `--muted` / `--dim` 对 `--surface`：
light `17.71 / 7.43 / 5.06`，dark `14.48 / 7.18 / 4.89` —— 正文三级灰全部 ≥4.5，无一需要动。

**因此 T9 的处置 = 只标注、不改色**：以后引用 `--border-strong` 必须带面（如「3.64 on `--bg`」），
任何「自报对比度」不带基线面的写法一律视为不可复核。

---

## 未证边界

- 原生件可用性由 **Chromium 152 实测版本号**推得，**未在本仓渲染进程跑过 `CSS.supports`**（T11 是硬闸）。
- 行宽 ≈147 字符按 0.5em 均值**估算**，未实测排版。
- **P0 与 P1-T5 已跑门禁**（原记「未跑任何门禁」已过期）：`eafcbfb` 落库前跑齐 `test` 845/845、
  `build`、`e2e`、`ipc:check`、`panels-check`、`sidechat-check`、`renderer-arch-check`、`a11y-check` 全 0；
  `7d2c880` 落库前跑 `build` / `a11y-check` / `renderer-arch-check` / `panels-check` 全 0。
  **P1 其余条与 P2 全组仍未验证**（未开工，自然无门禁）。
- 外部对标是二手公开文章与 HIG 摘要，非对真实 app 窗口的截图测量。
- `a11y-check` 的 `--static` 分支是否覆盖了三态（默认/抽屉开/设置开）全部规则，未逐条核。
