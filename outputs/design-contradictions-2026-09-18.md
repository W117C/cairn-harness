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
| D3 | 折叠机制 | **2 套且状态名相反**（R1b 后从 3 降到 2，**不是降到 1**——事实面 F4 原记「1」是过度自证，已同步更正）：① 真跑路径 = 一个委托处理器 `[data-tool-toggle]` → `.collapsed`，卡片/工具项/工具组三类容器共用（`app.js:1736-1744`，落 `4afcee9`）；② 演示路径 = `.think-head` → **`.expanded`**（`app.js:1695-1702`），**只服务演示 `send()`**（`app.js:1100` 打字机假回复 + `index.html:1526` 静态演示转录），真跑路径永不产出 `.think` 块。原生 `<details>` 确已归零（原记 1 处 = 重放渲染器 `app.js:1876`，随 `b696a62` 删第二套渲染器一并消失）⇒ **「两套渲染器在要不要原生件上互相矛盾」这条已随第二套渲染器一起闭环** | 逐笔实测：`details` 1→0 @`b696a62`、`[data-tool-toggle]` 处理器 0→1 @`4afcee9`、`toggle('expanded')` 恒为 1（R1b 全程未触及）；CSS 侧 `.collapsed` 10 / `.expanded` 3 |
| D4 | 抽屉显示 | **2 套且同名反义**：≥1280 用 `.drawer.collapsed{width:0}`（`:1031`）；≤1279 用 `.drawer.collapsed{width:min(--drawer-w,88vw)}` + `.open-m{transform}` + `.collapsed.open-m{translateX(100%)}`（`:1435-1449`）⇒ **同一个 `.collapsed` 在两个断点下含义不同，窄屏还要第二个 class 反转** | 见行号 |
| D5 | 函数双实现（后一份覆写前一份） | **7 个**（行号按 HEAD `cd101fa` 重取，原行号随 R1b 入库整体下移）：`openView`:1293 / `closeView`:1295（`const _openView = openView; openView = function…` 那一对）+ `send`:2604 / `selectSession`:2648 / `deleteSession`:2701 / `archiveSession`:2723 / `renderSide`:2744（全在 `window.agent` 块内）。复跑：`grep -nE "^[[:space:]]*(send\|selectSession\|deleteSession\|archiveSession\|renderSide\|openView\|closeView) = (async )?function" src/renderer/app.js` | 见左列 |
| D6 | 主题令牌两份全量块 | **79 个名字 / 128 处声明 / 42 个名字重复声明**（原记 81 / 132 / 44，差 **−2 / −4 / −2** 恰为 `7d2c880` 删掉的 `--tap-min`+`--rail-w` 各两处声明 —— 三条数同源不同刻，已按 HEAD 重取并与 F9 对齐） | `node -e 'const s=require("fs").readFileSync("src/renderer/index.html","utf8");const a=[...s.matchAll(/(--[\w-]+):/g)].map(m=>m[1]);const d=a.filter((v,i)=>a.indexOf(v)!==i);console.log(a.length,new Set(a).size,new Set(d).size)'` |
| D7 | 死界面 | **101 个 id 中 37 个无 JS 引用**（部分是 `aria-controls`/CSS 锚点属合法，须逐个归因）；5 张 quick-card 全靠 `[data-view]` 委托，自身 id 从不被读 | 复跑脚本已给 |
| D8 | 演示残留活在真实模式 | **原记两条，复跑后一条已闭环、一条仍在**：<br>① 「`INITIAL_TRANSCRIPT` 每次切会话重注入」——**不成立**（HEAD 复跑）：Electron 里 `selectSession` 被 `window.agent` 块整体覆写（`app.js:2648`），覆写版在取盘事件**之前**就 `clearTranscript()`（`:2662`，且 `showHistory` 首行再清一次 `:2573`）⇒ 假对话进不了真会话的任一时刻。会重注入的是**演示版** `selectSession`（`:260`），它在 `window.agent` 在场时不可达。<br>② `WORKSPACES`（`:709`）/ `BRANCHES`（`:818`）**仍是演示常量**，右栏上下文芯片与权限面板照它们显示 ⇒ 真化要连 IPC，AGENTS.md 已归 R2，仍在账上 | `grep -n "clearTranscript()" src/renderer/app.js` → 定义 1859 + 调用 2573（`showHistory` 首行）/ 2662（覆写版 `selectSession`）/ 2711（删除会话后）；`grep -n "^const WORKSPACES\|^const BRANCHES" src/renderer/app.js` → 709, 818 |
| D9 | 折叠第二套的**宿主**本身就是演示件（新发现，2026-09-19） | `.think` / `.think-head` / `.expanded` 这一套折叠机制（`app.js:1695-1702`）唯一的产出者是**演示 `send()`**（`app.js:1100-1181`）：假「已深度思考 `2+rand(7)`s」、**两条写死的思考正文**、逐字打字机、以及**伪造的 token 数** `tokN = 700 + full.length * 14`（`:1170`）。⇒ F4 从 2 降到 1 的**前置不是改折叠代码，是裁「浏览器直开原型模式还发不发货」**：删演示 `send()` 一并带走 D3②、`send` 这条双实现（F12 7→6）与假 token 面；保留则必须接受"事实面写 1 套、代码 2 套"长期带限定语 | 演示路径可达性：`grep -n "^function send()" src/renderer/app.js` → 1100；覆写点 `grep -n "send = async function" src/renderer/app.js` → 2604（在 `window.agent` 块内） |

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
      ⚠️ **本条原记账口径太窄**：普查全体后发现真值是 **27 / 79 名（34%）零引用令牌**——
      `--sp-*` 缺 10/12、`--r-*`+`--r-pill` 全 8、`--st-*` 缺 5、另 `--code-bg`/`--ease-spring`/`--font-display`/`--t-instant`。
      我原先只查了那两个名字就记「已清」，属本页自己的 C1 类缺陷。复跑与清单见 `docs/ui-fact-baseline.md` F13/F13b。
      （**本行数字曾写 28 / 35%、剩余 26** —— 三处互斥且都偏高：28 里含 1 个判据假阳性 `--st`，
      它其实被 `var(--st, 0)` 读着（`index.html:416` 运行指示环相位），旧判据的字面量 `includes("var(--x)")` 看不见带回退值的写法。
      判据已收紧并全表复跑，见 F13/F13c。10+8+5+4 = **27**，与"剩余"同一口径。）
      **剩余 27 个未动**：R1b 已合回（`0bae71c` 是 `cd101fa` 的祖先），停手前提解除；
      处置按 `--sp-*`+`--r-*` 18 / `--st-*` 5 / 杂项 4 三组分卡推进，`--st-*` 那 5 个随 T6 施工接线而非单删。
      **性质已核实为漂移而非有意预留**（避免把 grep 命中当缺陷）：尺寸/圆角/字号属性里
      **字面 px 声明 738 处**，而同族令牌读取 `var(--sp-*)` + `var(--r-*)` 合计只用 **4** 次
      （`--sp-*` 3、`--r-*` 1）⇒ 比例 184:1，规模被声明出来后被 CSS 直接绕开。
      复跑：`grep -oE '(padding|margin|gap|width|height|font-size|border-radius)[a-z-]*:[^;]*[0-9]px' src/renderer/index.html | wc -l`
      与 `grep -oE 'var\(--(sp|r)-[a-z0-9]+' src/renderer/index.html | wc -l`。
      （本行原写「492 处」——无可复现命令，属本页自报数，已按上述口径重测替换；方向与结论不变。）
      **根因**：存档规格 `outputs/desktop-optimize-2026-09-17/02-design-tokens.md:317` 的原话是
      「… + `--sp-1..12` + `--r-1..7/pill/full` + `--t-instant` —— **全部保持，本轮零改动**」，
      即"保留"被当成了"施工"——声明齐了就记账为完成，没人要求有任何一处读取。
      （本行原引作「存档规格 `06` §1②」——该路径下没有 `06` 号文件，属悬空引用，已换成可 `grep` 的文件:行。）
- [x] **T6 状态编码定案**（C2 + E6）：用户 2026-09-19 拍 **7 态**。定案见
      `outputs/t6-run-state-spec-2026-09-19.md`——关键结论是**7 态可实现且零新增生产者**，
      但依据是 `AgentStatus`（6 值）× `reason`：卡死实为 `waiting_input + reason=stuck`
      （`orchestrator.ts:1865`），「等待」在内核其实是三态（审批 / 输入 / 卡死），正好补足 7。
      ⚠️ 同时纠掉文档原 7 里那个**无生产者**的「被拒」——`rejected` 只存在于 `approval_resolved`，
      建 `--st-rejected` 就会是**第 8 条「文档称施工、代码不存在」**。施工排在 R1b 合回之后
      （届时只剩一套渲染器，形状通道做一次；现在做要在 live 与 replay 两条路各写一遍）。
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

> ✅ **T11 硬闸已开（2026-09-19）**：不再靠「Chromium 152 版本号」推断——已在**本仓真实渲染进程**里
> 实测 27 项平台能力，**全 true**，连跑两次读数一致；UA 报 `Chrome/152.0.7977.76`，与我从
> `Electron Framework` 二进制读出的版本号独立吻合。工件：`outputs/native-capability-probe-2026-09-19.js`
> ＋捕获 `outputs/native-capability-2026-09-19.md`（含逐条对应到 T13/T14/T18/T19/T20 的映射表）。
> ⚠️ 该探针**不是随时可复跑**：宿主 load 5+ 时启动即挂（连脚本自带的 45s 看门狗都轮不到执行），
> 必须与 Electron 类门禁串行、低负载时跑。**挂住 ≠ 能力缺失**。
> 且原生件可用 **只证明平台提供**，不证明替换后行为等价——light-dismiss 对上 outside-click/Esc
> 是 T13 自己的验收面，且仍须先过 22 条钩子白名单。

- [ ] **T12 先出 `panels-check` 钩子白名单**（F1 未闭），列出哪些 class/id 被探针消费；白名单外的才允许删。
- [ ] **T13 浮层 4 → 1**（D1）：`popover` + `popovertarget` + CSS 锚点定位。删 `showPop` 测距、outside-click、Esc、焦点管理。
- [ ] **T14 模态 2 → 1**（D2）：`<dialog>` + `showModal()` + `::backdrop`；删手写 `inert` 4 处与三档 Esc。
- [ ] **T15 折叠 2 → 1**（D3，**方案已随 R1b 反向**）：轮 3 原建议 `<details>/<summary>`，但 R1b B1 删第二套渲染器时把唯一那处 `<details>` 一并删了（`b696a62`：1→0），B3 又把卡片/工具两套并成**手写单一委托**（`4afcee9`）⇒ 现在改走 `<details>` 等于把已闭环的方向再翻一遍。**剩余那一套是 `.think-head` → `.expanded`（与主流极性相反）**，接线方向应是把 `.think` 并入 `[data-tool-toggle]` + `.collapsed`。⚠️ **前置是 D9 的裁决**：`.think` 的产出者只有演示 `send()`，「原型模式发不发货」没裁之前，这条没有可施工的落点。命名统一（`.collapsed`/`.expanded` 反义并存）同属这条。
- [ ] **T16 抽屉两机制合一**（D4）：消除 `.collapsed` 在两个断点下的反义。
- [ ] **T17 monkey-patch 收单实现**（D5）：7 个双实现函数各留一份。
- [ ] **T18 主题令牌 2 份块 → `light-dark()` 一份**（D6）：**42** 个重复声明（原记 44，差 2 = `7d2c880` 删的两个令牌），暗色只写差异项。
- [ ] **T19 composer 测高改 `field-sizing: content`**：删 `app.js:994` 隐藏 textarea 量高。
- [ ] **T20 断点 3 档 → 容器查询 `@container`**：删 `--center-w` 三处重算（`:184`/`:205` 等），面板按自身宽度响应。
- [ ] **T21 37 个无 JS 引用 id 逐个归因**（D7）：合法 aria/CSS 锚点保留并注记，其余删。
- [ ] **T22 与 D9 合并为同一条裁决：浏览器直开原型模式发不发货**（原口径「删 `INITIAL_TRANSCRIPT` 静态演示对话，因为演示残留活在真实模式」**前提不成立**，见 D8① 复跑：真 `selectSession` 在任何 await 之前就 `clearTranscript()`）。静态演示转录 + 演示 `send()` + `.think` 假思考块 + 假 token 数，是**同一份不可达代码**的四个面，删与留一次裁完：删 ⇒ F4 2→1、F12 7→6、D3②/D9 同时闭环；留 ⇒ 事实面永久带「真跑路径内」限定语，且 `index.html` 那份演示 markup 继续算在 101 个 id 里（T21 归因时要按此注记）。
- [ ] **T23 宽屏正文行宽封 72ch**：`--content-max` 1040 封顶在 ≥1660 视口 → 992px ≈ 147 字符/行；prose 收窄，**code/diff 允许更宽**。1440 档（736px）本已在带内，别动。

      *P2 组统一验收*（可判定量，替代"看着简单了"；**基线一律取 `docs/ui-fact-baseline.md` HEAD 态，2026-09-19 已随 R1b 重取**）：
      浮层 **4** →1（F10）；模态 **2** →1（F11）；折叠 **2** →1（F4，原写 3 是把已删的 `<details>` 算进来了）；
      双实现函数 **7** →0（F12）；无引用 id **37** →0（F8）；令牌声明 **128** →≈80、去重名 **79** →只减不增（F9/F13）；
      渲染器份数 **1** →1（F1，已闭）；空态 **2 套 / 3 标识符** →1（F5）；前端依赖数维持 **0**（F19）；
      `app.js` 行数 **2769** 下降（F18）。⚠️ 原写「132→≈81」「界面数 35→≤20」两个基线：132 是 `7d2c880` 前的旧值（现 128），
      「界面数 35」在 F1–F20 里**没有对应可判定量**，不再作为验收口径。

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

- ~~原生件可用性由版本号推得、未实测~~ → **已在本仓渲染进程实测 27 项全 true**（`eafcbfb` 之后，
  见 `outputs/native-capability-2026-09-19.md`）。新留下的未证是：**「平台提供该能力」≠「替换后行为等价」**，
  且该探针在宿主 load 5+ 时**复跑会挂**（须与 Electron 门串行、低负载跑）——不是随时可复验的工具。
- 行宽 ≈147 字符按 0.5em 均值**估算**，未实测排版。
- **P0 与 P1-T5 已跑门禁**（原记「未跑任何门禁」已过期）：`eafcbfb` 落库前跑齐 `test` 845/845、
  `build`、`e2e`、`ipc:check`、`panels-check`、`sidechat-check`、`renderer-arch-check`、`a11y-check` 全 0；
  `7d2c880` 落库前跑 `build` / `a11y-check` / `renderer-arch-check` / `panels-check` 全 0。
  **P1 其余条与 P2 全组仍未验证**（未开工，自然无门禁）。
- 外部对标是二手公开文章与 HIG 摘要，非对真实 app 窗口的截图测量。
- `a11y-check` 的 `--static` 分支是否覆盖了三态（默认/抽屉开/设置开）全部规则，未逐条核。
