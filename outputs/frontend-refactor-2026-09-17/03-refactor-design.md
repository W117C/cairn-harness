> **⚠️ 存档（2026-09-18 裁定）**：本包降为存档，**不可直接施工**——其事实基线已漂移：自报 `app.js` 2281 / `index.html` 1866，HEAD `eafcbfb` 实测 **2690 / 1977**（+409 / +111，复跑见 `docs/ui-fact-baseline.md` F18）。
> **两面权威**：意图 = `agent-plan.md` §10.1 七条布局定稿；事实 = `docs/ui-fact-baseline.md`（每项配复跑命令）。本包**仍有效**的只有 §1 裁决记录（2026-09-17 用户拍板）与「不引框架 / 不引组件库」取向；正文一字未改。

# Forge 前端重构 · 目标架构与重构施工图（Phase 3 / 2026-09-17）

> 负责人：原型构建师 筑原型（Zhu）。
> 事实来源：**本轮对当前工作树逐行实测**（`src/renderer/app.js` 2281 行 / `src/renderer/index.html` 1866 行 / `src/main/settings.ts` / `src/main/index.ts` / `scripts/panels-check.ts` / `scripts/gate-manifest.ts` / `src/renderer/cards/registry.tsx` / `src/renderer/projections.ts` / `src/preload/index.ts` / `src/main/ipc-protocol.ts` / `src/events/index.ts`），并复用 `00-recon-brief.md`（下称「简报」）、`01-requirements.md`（下称「需求」）、`02-design-system.md`（下称「规范」）。
> **本文是施工图，不是愿景。** 每条结论落到「某文件某行 + 改动性质 + 验证方式」。
> 覆盖：**需求 §2 的 27 条（MAINT-01…07 / RESP-01…04 / VIS-01…06 / A11Y-01…03 / PERF-01…03 / GAP-01…04）逐条给出实现方案**，见 §11 覆盖矩阵。
> **令牌与断点一律消费 `02-design-system.md`**（`--sp-*` / `--r-*` / `--st-*` / `--border-strong` / 四档断点），**不另起一套**。

**硬约束（全篇遵守，§12 自检）**：
- **不改 `src/` 下任何代码**——本轮只写本 md。
- **严禁伪造 `data-m1e-*` 钩子**；探针只允许**改指真实存在的元素**。
- **现有 32 个冻结钩子零重命名**；新增钩子必须在 §7.7 显式列出。
- 发现判据有缺陷 → **立 BLOCKED 要求换判据**，**不设计绕过方案**（§7.5）。
- 所有行号与当前工作树一致（引用前已抽查；**行数不写死**——成文时 `app.js` 2281 / `index.html` 1866，**此后已漂移到 2360 / 1969**，故**引用行号前必须重新 grep 核对**，本文件行号只作定位线索、不作判据）。

---

## §0 结论先行（TL;DR）

1. **架构分 7 层**：工具层 → 状态层（单一 store）→ 投影层（复用现有 `projections.ts`）→ 组件层（卡片/面板注册表）→ 视图层（render）→ 桥接层（IPC 适配）→ 启动层。**单向依赖，桥接层是唯一能碰 `window.agent` 的地方。**
2. **隐式耦合的根治**：桥接 IIFE（`app.js:1660-2281`）当前**不拥有状态**，靠覆写原型函数（`send` `selectSession` `deleteSession` `archiveSession`）+ 共享模块级变量（`sessions`/`selectedId`/`archived`/`real`）工作。目标态：**状态收敛到单一 store**；**mock 降级为可选 seed 源**（`!window.agent` 时注入 store），**桥接层只做 IPC → store.dispatch 的映射**，不再覆写任何函数。
3. **迁移分 11 步（M0…M10）**，每步结束**门禁可跑 + UI 可用**；用「同名 shim 转发 + 开关并行」手法把 4147 行拆开。**最高风险步 = M2 抽状态层**（两半共享根），次高 = M5 桥接层重写。
4. **改动范围**：`app.js` 拆为 9 个模块（2281 → 删除/降为 bootstrap）；`index.html` 拆出 5 层 CSS + 骨架调整；`src/main/settings.ts` 改 layout schema（F-1）；`src/main/index.ts` 加 `minWidth/minHeight`；`scripts/panels-check.ts` 换判据（**需 BLOCKED 批准**）；新增 `scripts/a11y-check.ts` + 登记 `gate-manifest.ts`；React 树按 §7 判定表逐项归档/移植。
5. **最容易被低估的工作量**：① 桥接层的**行为等价回归**（覆写语义含权限映射 / running 守卫 / ask 卡 / 两级折叠，难以自动测）；② **CSS 出层的静默破坏面**（322 选择器 × 62 处 `classList` 纯字符串契约）；③ **`projections.ts` 的依赖面远比简报记录的大**——它被 **4 个门禁脚本 + 4 个测试文件 + store.ts + cards/panels** 引用（§7.4），**不是「随 React 树归档」，而是要提升为共享投影层**。

---

## §1 目标分层架构

### 1.1 模块边界图（文字版，箭头 = 依赖方向，严格单向）

```
┌──────────────────────────────────────────────────────────────────────┐
│  启动层  main.js（bootstrap）                                          │
│    createStore() → 选 mock seed 或 bridge → mount(store) → 挂委托监听   │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 只被 main 装配，不反向依赖
   ┌────────────┴─────────────┐        ┌───────────────────────────────┐
   ▼                          ▼        │  桥接层  bridge/ipc.js          │
┌───────────────┐   ┌──────────────────┴──┐  · window.agent 唯一出现处     │
│ mock 层        │   │  视图层 render/*.js  │  · api.* → store.dispatch      │
│ mock/seed.js   │   │  纯函数：state → DOM │  · api.onEvent → dispatch(fold)│
│ （dev-only）    │   └──────────┬──────────┘  · 不覆写函数、不持状态        │
└───────┬───────┘              │            └──────────────┬────────────────┘
        │ seed(state)          │ render(state)               │ dispatch/select
        ▼                      ▼                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  状态层  store.js（唯一状态源 + reducer + 订阅）                         │
│    state = { sessions, archived, folders, selectedId, sortBy, query,    │
│              ui{view,drawerOpen,theme,reduceMotion,layout},             │
│              run{id,running,startedAt,usageIn,usageOut,toolGroup},      │
│              cards:Map, asks:Map, statusbar{sandbox,eventCount,tokens} } │
│    dispatch(action) / getState() / subscribe(fn) / 选择器               │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 纯投影（无 DOM、无 React）
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  投影层  projections.ts（复用现有 591 行，框架无关）                      │
│    projectTokenUsage / projectDiffCards / projectAgentPanel / …          │
└──────────────────────────────────────────────────────────────────────┘
                ▲
                │ 被视图层与组件层消费
┌───────────────┴──────────────────────────────────────────────────────┐
│  组件层  components/registry.js                                        │
│    KNOWN_CARD_TYPES（≥10）/ renderCard(kind,payload) / cardShell()      │
│    renderPanel(id,payload) / 面板注册表                                 │
└───────────────┬──────────────────────────────────────────────────────┘
                ▲
                │
┌───────────────┴──────────────────────────────────────────────────────┐
│  工具层  utils.js（无状态纯函数）                                        │
│    $ $$ esc fmtTime nowTime toast ICONS highlightDiffLine runGrid clamp  │
└──────────────────────────────────────────────────────────────────────┘

样式层（与 JS 并行，不入依赖图）：css/tokens.css → base → layout → components → utilities（@layer）
```

### 1.2 各模块职责 / 输入输出

| 模块 | 文件（目标） | 职责 | 输入 | 输出 | 禁止 |
|---|---|---|---|---|---|
| 工具层 | `src/renderer/utils.js` | 无状态纯函数 | 值 | 值 / DOM 查询结果 | 持状态、订阅、碰 IPC |
| 状态层 | `src/renderer/store.js` | 唯一状态源 + reducer + 订阅广播 | action | 新 state / 通知 | 碰 DOM、碰 IPC、渲染 |
| 投影层 | `src/renderer/projections.ts` | 事件数组 → 视图模型（token/diff/agent/ask…） | `AgentEvent[]` | 投影对象 | 碰 DOM、碰 IPC、碰 store |
| 组件层 | `src/renderer/components/registry.js` | 卡片/面板统一骨架 + 注册表 | `(kind, payload, ctx)` | HTML 字符串 / 节点 | 持状态、直接改 store |
| 视图层 | `src/renderer/render/*.js` | state → DOM（纯渲染） | `state`（选择器切片） | DOM 写入 | 持状态、直接改 store、碰 IPC |
| 桥接层 | `src/renderer/bridge/ipc.js` | IPC ↔ store 适配 | `window.agent` + store | dispatch 调用 | **覆写视图层函数**、持状态、渲染 |
| mock 层 | `src/renderer/mock/seed.js` | dev seed + mock run 适配器 | 无 / action | seed 数据 / 模拟事件 | 在生产路径被引用（仅 `!window.agent` 启用） |
| 启动层 | `src/renderer/main.js` | 装配 | — | 副作用装配 | 业务逻辑 |

### 1.3 隐式耦合的根治（**MAINT-02 的核心**）

**现状实测**：`app.js` 前半（`1-1659`）声明并持有模块级可变状态：

```
28  let sortBy      35  let sessions      46  let archived
50  let selectedId  51  let archiveOpen   52  let query      (app.js)
```

桥接 IIFE（`1660-2281`）**追加式**工作：不声明自己的状态，而是① 直接读写这些变量（`1680` `sessions = list…`、`2213` `selectedId = id`）；② **覆写**原型函数：

```
2181  send = async function () { … }
2209  selectSession = async function (id, force) { … }
2251  deleteSession = function (id) { … }
2268  archiveSession = function (id) { … }
```

两半**隐式耦合**：任一侧改动可静默破坏另一侧；且 `send`/`selectSession` 在原型层是 `function` 声明（`app.js:1047` / `235`），桥接层用 `=` 覆写 → **同名字段语义漂移**，无静态校验（`allowJs` 未开，见简报 F-2）。

**目标态（迁移方向）**：

1. **单一 store 拥有全部状态**。`sessions/selectedId/archived/real/ui` 收敛进 `store.state`；`app.js:28-52` 的 `let` 全部删除。
2. **视图层不再持有可写状态**。`render()`（`app.js:165`）、`sessionItemHTML`（`122`）、`renderArchive`（`483`）改为 `renderX(state)` 纯函数。
3. **桥接层不覆写函数**，改为：
   ```js
   // bridge/ipc.js（目标）
   export function createBridge(api, store) {
     const off = api.onEvent(e => store.dispatch({ type: 'event', e }));
     store.dispatch({ type: 'bridge/ready', api });          // 声明数据源已就绪
     return { loadSessions, openSession, createSession, deleteSession, renameSession, archiveSession, send, decide, decidePlan, cancel, off };
   }
   ```
   每个方法内部只做 `api.*(...) → store.dispatch(...)`。
4. **mock 降级为 seed 源**（**不是平行实现**）：
   - `mock/seed.js` 导出 `seedStore(store)`：把 `FOLDERS`/`sessions`/`archived`（`app.js:30-48`）作为**初始数据** dispatch 进 store。
   - 原型的打字机 `send`（`app.js:1047-1136`）改造为 `mock/mockRun.js` 的 **dev 适配器**：它产出的事件经 **同一 `store.dispatch({type:'event'})`** 入口进入状态层——与真实桥接**走同一条数据流**，视图层无法区分二者。
   - `main.js` 装配：`window.agent?.listSessions ? createBridge(...) : seedStore(store)`。
5. **验证对齐 MAINT-02 验收口径**：
   - `grep -n 'window\.agent' src/renderer/**/*.js` **仅命中 `bridge/ipc.js`**；
   - `grep -cE '= (async )?function' src/renderer/**/*.js`（覆写式赋值）**= 0**；
   - `grep -nE 'let (sessions|selectedId|archived)' src/renderer/*.js` **命中数 = 1**（仅 `store.js`）。

> **为什么不选「保留两半、只加类型」**：覆写式契约无法用类型表达（`send` 从 `() => void` 变成 `async () => void` 且语义完全不同）。根治只能靠**收敛状态 + 单向数据流**，这也是 MAINT-01/02 的目标态原文（需求 §2.1）。

### 1.4 目标目录结构

```
src/renderer/
├── index.html              # 仅剩骨架 + <link> 引 CSS + <script type="module" src="/main.js">
├── css/
│   ├── tokens.css          # 令牌层：index.html:15-94 语义原样搬迁 + 规范 §A 新增令牌
│   ├── base.css            # 基础层：reset / :focus-visible / 滚动条 / .sr-only / .app / .titlebar
│   ├── layout.css          # 布局层：.shell / .sidebar / .gutter / .chat / .stream / .composer / .drawer
│   ├── components.css      # 组件层：.card / .msg / .bubble / .chip / .tool-item / .tab / .menu / .statusbar
│   └── utilities.css       # 工具层：状态修饰类 + 13 处 reduced-motion 降级（含新增）
├── utils.js                # 工具层
├── store.js                # 状态层（单一状态源）
├── projections.ts          # 投影层（复用，见 §7.4）
├── components/
│   └── registry.js         # 卡片 + 面板注册表
├── render/
│   ├── sessionList.js  chatStream.js  message.js  cards.js
│   ├── drawer.js  statusbar.js  taskView.js  historyView.js
├── bridge/
│   └── ipc.js              # 桥接层（window.agent 唯一出现处）
├── mock/
│   ├── seed.js  mockRun.js # dev seed + mock 运行适配器
└── main.js                 # 启动层
```

**依赖规则（护栏，可用脚本断言）**：
- `utils.js` 不 import 任何本项目模块。
- `store.js` 只 import `projections.ts`（类型 + 投影）。
- `render/*` 只 import `utils` / `components` / `projections`，**不 import store**（state 由 main 传入或经 `store.getState()` 只读注入）。
- `bridge/*` 是唯一 import 到 `window.agent` 的层。
- **禁止环**：任何模块不得 import `main.js`。

### 1.5 护栏（F-2 的正面回应）

现状「唯一有静态保障的是已死的 React 树，真正发货的 4147 行零保障」（简报 F-2）。目标态护栏：

| 护栏 | 落点 | 对应需求 |
|---|---|---|
| `tsconfig.json` 开 `allowJs: true` + `checkJs: true`（或对 `.js` 加 `// @ts-check` + JSDoc） | `tsconfig.json` | MAINT-01/02 |
| ESLint + Prettier（禁 `innerHTML` 白名单外使用、禁 `= function` 覆写） | `.eslintrc` / `package.json` | MAINT-01/04 |
| Stylelint（禁令牌外 px / 色值） | `.stylelintrc` | MAINT-07 / VIS |
| 依赖方向断言脚本 | `scripts/renderer-arch-check.ts`（新增） | MAINT-01/02 |

> 本轮 D3 不改 `src/`，上表为**落地轮**的护栏清单；每项登记 `gate-manifest.ts`（§9）。

---

## §2 分步迁移策略

### 2.1 原则

1. **每步结束，`pnpm gates` 仍可跑、UI 仍可用**（需求硬约束）。
2. **Strangler（绞杀者）**：新模块先建，**在 `app.js` 内保留同名 shim（转发到新模块）**，等所有调用点迁移完再删 shim。任一时刻新旧路径并存。
3. **并行运行 + 开关**：状态层/桥接层重写用 `?arch=next`（URL 参数）或 `window.__FORGE_ARCH__` 开关切换；**两路径同时可跑**，diff 行为一致后删旧。
4. **不改判卷文件**：M6（探针换判据）以 **BLOCKED 批准**为前提（§7.5），未批准则门禁保持红——**不伪造绿**。

### 2.2 步骤表（M0…M10）

| 步 | 名称 | 抽/改什么 | 手法 | 结束判据（门禁 + UI） | 需求 |
|---|---|---|---|---|---|
| **M0** | 冻结基线 | 加「特征测试」（characterization）：对 `render()` / `renderEvent()` / 桥接 4 覆写函数拍 **DOM golden 快照** | 新增 `tests/renderer-golden.test.ts`，只读断言 | 新测试绿；其余门禁不变 | MAINT-01 |
| **M1** | 抽工具层 | `$ $$ esc toast ICONS fmtTime runGrid highlightDiffLine(s)` → `utils.js`；`app.js` 顶部 `import` 同名 shim | 纯函数迁移，零状态 | `grep -c '^import' app.js ≥ 1`；UI 逐像素不变 | MAINT-01 |
| **M2** | **抽状态层（最高风险）** | `let sortBy/sessions/archived/selectedId/archiveOpen/query`（`app.js:28-52`）+ 桥接 `real`（`1670`）→ `store.js`；`app.js` 内变量改为 `const S = createStore(); const sessions = () => S.getState().sessions` 等**只读访问器** | 双跑：`?arch=next` 走 store，默认走旧变量，diff 快照 | 双路径 DOM 快照逐字一致；`grep -cE 'let (sessions\|selectedId\|archived)' src/renderer/*.js` 收敛到 store | MAINT-02 |
| **M3** | 抽视图层 | `render()`（`165`）+ `sessionItemHTML`（`122`）+ `folderRowHTML`（`154`）+ `renderArchive`（`483`）+ `renderEvent`（`1854`）→ `render/*.js` 纯函数 | 保持 DOM 契约（类名/钩子零改） | 快照一致；`grep -c 'innerHTML'` 不增加 | MAINT-01/04 |
| **M4** | 抽组件注册表 | 卡片产出（`askCard` `2089` / plan `1932` / verify `1973` / diff `1894`）→ `components/registry.js` 的 `renderCard` | 建骨架 + 注册表，**逐个改调用点** | `KNOWN_CARD_TYPES.length ≥ 10`；抽查 3 类走同一 `renderCard` | MAINT-03 |
| **M5** | **桥接层重写（次高风险）** | 覆写 IIFE（`1660-2281`）→ `bridge/ipc.js` 的 `createBridge` | 开关并行；新旧桥接对同一会话产出**同 DOM** | `grep -n 'window.agent'` 仅在 `bridge/ipc.js`；覆写赋值 = 0 | MAINT-02 |
| **M6** | mock 降级为 seed | 原型数据 `30-48` → `mock/seed.js`；打字机 `send`（`1047`）→ `mock/mockRun.js`，产出走 `dispatch({type:'event'})` | 仅 `!window.agent` 启用 | 纯浏览器打开原型仍可交互；生产路径不引用 mock | MAINT-02 |
| **M7** | CSS 出层 | `index.html:9-1367` 拆 5 层（§1.4）；令牌段 `15-94` **语义原样** | `@layer` 声明 + 文件拆分；先物理拆、后收令牌 | `grep -c '@layer' ≥ 4`；令牌集合为当前超集 | MAINT-07 |
| **M8** | 响应式 + 状态底栏 + 缺口视图 | 四档断点（规范 §C）、`.statusbar`、`tasks`/`history` 视图 | 见 §4 / §8 | RESP-01…04 / VIS-02 / GAP-01…03 验收 | RESP/VIS/GAP |
| **M9** | 性能 | 虚拟化窗口、rAF 合帧、`scrollStream` 改造 | 见 §5 | PERF-01/02/03 验收 | PERF |
| **M10** | D1 收口 | 探针换判据（BLOCKED 批准后）、`projections.ts` 位置、React 树归档 | 见 §7 | MAINT-05/06 验收 | MAINT-05/06 |

> 依赖顺序：M0 → M1 → **M2** → M3 → M4 → **M5** → M6 → M7 → M8 → M9 → M10。M7（CSS）可与 M3 并行（不共享文件）；M8/M9 依赖 M2/M3/M5 完成。

### 2.3 4147 行拆解顺序与风险（**先抽什么、后抽什么**）

**抽取顺序 = 按「状态耦合度」从低到高**：

1. **先抽工具层（M1）**——零状态纯函数，**零风险**，先建立 `import` 机制与模块纪律。
2. **再抽视图层（M3）**——纯渲染，但要小心 `renderEvent`（`1854`）内的隐式状态读（`real.cards`、`real.toolGroup`）；此步**必须先把这些隐式状态显式化为参数**。
3. **再抽状态层（M2，最高风险）**——两半的**共享根**。一次移动 `sessions/selectedId/archived/real`，任一处遗漏即静默断链（如 `loadSessions`（`1680`）写 `sessions`、`selectSession`（`2213`）写 `selectedId`）。**缓解**：特征测试 + 双跑 diff + 只读访问器过渡（写点先集中到 store action）。
4. **再抽桥接层（M5，次高）**——把 4 个覆写函数改成 adapter 方法；语义等价最难（权限映射 `1669` / running 守卫 `2184/2210` / ask 卡 `2130` / 两级折叠 `1630-1656`）。
5. **最后 mock 降级（M6）**——依赖前三步已建立「事件 → dispatch → 渲染」单一数据流。

**风险最高步 = M2**（理由：状态是两半唯一交汇面；无类型保障（F-2）；`app.js` 2281 行里对这几个变量的读写点分散）。

**降低「不停机」风险的三条具体手法**：
- **同名 shim 转发**：M1-M5 每步都在 `app.js` 内保留旧名符号（转发到新模块），**删 shim 是最后一步**，因此任意时刻旧调用点仍有效。
- **双跑 diff**：M2/M5 用 `?arch=next` 挂载新路径，用 §M0 的 golden 快照对新旧 DOM 逐字 diff。
- **开关即回滚**：开关默认旧路径；新路径出错时删开关即回到旧实现，**无需回滚提交**。

### 2.4 切换开关 / 并行运行

```js
// main.js（目标）
const useNext = new URLSearchParams(location.search).get('arch') === 'next';
const store = createStore();
if (!window.agent?.listSessions) seedStore(store);            // 纯浏览器 dev
else if (useNext) createBridge(window.agent, store);          // 新桥接
else legacyBridge(window.agent, store);                       // 旧覆写（M5 前保留）
mount(store, { engine: useNext ? 'next' : 'legacy' });
```

### 2.5 每步的门禁与回滚

- **门禁**：每步结束跑 `TERM=dumb pnpm gates`（26 道）；M2/M5 额外跑 `tests/renderer-golden.test.ts`。
- **回滚**：删开关/恢复 shim 即可；每步单独提交，粒度 = 一个模块。
- **沙箱内跑测试**：`node node_modules/vitest/vitest.mjs run --pool=threads`（简报 §8）。

---

## §3 组件注册表方案

### 3.1 统一卡片骨架（消费规范 §D.1，**逐字对齐**）

```
<div class="card card--{kind}" data-card="{kind}" data-st="{state}">
  <button class="card-head" type="button" aria-expanded="false" aria-controls="{id}"
          data-card-toggle data-card="{kind}" [data-doc="{path}"]>
    {svg 图标}<span class="ct">{标题}</span><span class="tag">{状态位}</span>
    <svg class="chev" aria-hidden="true"/>
  </button>
  <div class="card-body" id="{id}">{内容}</div>
  <div class="card-foot" role="group" aria-label="卡片操作">{操作}</div>
</div>
```

- **头** `.card-head`：既有（`index.html:1450`、`app.js:1941/2134`）；折叠由 `data-card-toggle` 委托（`app.js:1630-1638`），**零重命名**。
- **体** `.card-body`：新增语义类；既有 `.body`（`app.js:2138`）**保留为别名**（`.card-body, .card > .body {…}`）。
- **脚** `.card-foot`：新增，收敛 `.plan-acts`（`app.js:1948`）、`.ask-acts`/`.ask-pop-acts`（`app.js:2038`）。
- **状态钩子**：`data-card="{kind}"`（既有）+ **`data-st="{state}"`（新增，7 态，§3.4）**；`aria-expanded`/`aria-controls` 既有。

### 3.2 变体清单（对齐规范 §D.2，**11 类**：React 10 类 + vanilla 独有 `tool`）

| 变体 | class | 现状（实测） | 处置 | 必需 `aria-*` | 状态钩子 |
|---|---|---|---|---|---|
| plan | `.card--plan` | `.card` + `.plan-steps` + `.plan-acts`（`app.js:1932-1966`） | 保留 + 收敛骨架 + 新增进度 | `aria-expanded/controls`；进度 `role="progressbar" aria-valuenow/min/max` | `data-card="plan"` `data-st` |
| diff | `.card--diff` | `.tool-item > .diff`（`app.js:1894-1931`） | 保留；可选独立 `.card--diff` | `aria-expanded/controls` | `data-card="diff"` `data-doc` |
| tool | `.card--tool` | `.tool-item` in `.toolgroup`（`app.js:1870-1893`） | 保留（两级折叠） | `aria-expanded`；`.ti-state` 加 `aria-label` | `data-tool-toggle` |
| approval | `.card--approval` | `.card.ask[data-ask]` + `.ask-pop`（`app.js:2089/2126-2144`） | 保留 `data-ask`；`ask-pop` 收敛为 Sheet | `aria-modal`/`aria-expanded`/状态 `aria-label` | `data-ask` `data-st` |
| verify | `.card--verify` | `.tool-item > .term`（`app.js:1973-1994`） | 保留 + 收敛 | `aria-expanded` | `data-card="verify"` `data-st` |
| report | `.card--report` | 无 | 新建（`role="region"`） | `role="region" aria-label` | `data-card="report"` `data-st` |
| usage | `.card--usage` | 无（仅 `.tok`） | 新建或并入底栏（VIS-02） | `role="status"` | `data-card="usage"` |
| clarify | `.card--clarify` | 无 | 新建（参照 `cards/clarify-form.tsx` 115 行） | 表单 `label`/`aria-required`；提交 `aria-live` | `data-card="clarify"` |
| compaction | `.card--compaction` | 仅 toast（`app.js:1999-2001`） | 新建卡（或保留 toast，二选一，报告标注） | `role="status"` | `data-card="compaction"` |
| promote | `.card--promote` | 无 | 新建（sidechat 结论提升） | `aria-label` | `data-card="promote"` |
| agent | `.card--agent` | 无 | 新建（多 agent 指挥，对应 GAP-01） | `role="group" aria-label` | `data-card="agent"` `data-st` |

### 3.3 注册表 API（vanilla 等价 `cards/registry.tsx`）

```js
// components/registry.js（目标）
export const CARD_KINDS = {
  plan:        { render: renderPlanBody,        aria: { toggle: true },           state: true },
  diff:        { render: renderDiffBody,        aria: { toggle: true, doc: true } },
  tool:        { render: renderToolBody,        aria: { toggle: true } },
  approval:    { render: renderApprovalBody,    aria: { modal: true },            state: true },
  verify:      { render: renderVerifyBody,      aria: { toggle: true },           state: true },
  report:      { render: renderReportBody,      aria: { region: true },           state: true },
  usage:       { render: renderUsageBody,       aria: { status: true } },
  clarify:     { render: renderClarifyBody,     aria: { form: true } },
  compaction:  { render: renderCompactionBody,  aria: { status: true } },
  promote:     { render: renderPromoteBody,     aria: { label: true } },
  agent:       { render: renderAgentBody,       aria: { group: true },            state: true },
};
export const KNOWN_CARD_TYPES = Object.keys(CARD_KINDS);   // 11 ≥ 10 ✅ MAINT-03

/** 未知 kind 落兜底卡，绝不抛异常（对齐 React FallbackCard，registry.tsx:188）。 */
export function renderCard(kind, payload, ctx) {
  const def = CARD_KINDS[kind];
  const body = def ? def.render(payload, ctx) : renderFallbackBody(payload);
  return cardShell(kind, payload, body, def);
}
```

- **新卡片只注册不改骨架**：加一条 `CARD_KINDS` 项 + 一个 `renderXBody`，`cardShell` 不动 → 满足 MAINT-03 人工步骤（加注册项后渲染不报错）。
- **抽查 3 类走同一入口**：plan/diff/agent 的产出全部经 `renderCard`（验收：`grep -n 'renderCard('` 命中且旧内联模板删除）。

### 3.4 七态三重编码（消费规范 §B.1，**状态点契约**）

状态点容器：`<span class="st-dot" data-st="run|wait|stuck|fail|rejected|interrupted|done" aria-hidden="true">`（**新增钩子 `data-st`**，§7.7），语义由相邻文字承载（满足 A11Y-08）。**7 态字形一律内联 SVG**（规范 §B.2 实测：`⊘ ⏸ ⏳ ❚ ⚠` 在本机字体栈全缺，会落 emoji）。

| 状态 | 颜色令牌 | 图形 | 文字 | reduced-motion 降级 |
|---|---|---|---|---|
| 成功 | `--st-done` | ✓ 描边圆 | 成功 | 无 |
| 运行 | `--st-run` | 实心点 + 脉冲环 | 运行中 | 静态实心点 |
| 等待 | `--st-wait` | 空心圆环 | 等待 | 无 |
| 卡死 | `--st-stuck` | 实心点 + `!` | 卡死 | 静态 |
| 失败 | `--st-fail` | 实心点 + `×` | 失败 | 无 |
| 被拒 | `--st-fail` | 实心点 + `⊘`(SVG 斜杠圆) | 被拒 | 无 |
| 已中断 | `--st-wait` | 空心环 + `‖`(SVG 双竖线) | 已中断 | 无 |

> **VIS-03/04/05 的落地点**：「被拒」用 `--st-fail` 红（≠ 卡死琥珀，ΔH≈55°）；「已中断」= 空心环+`‖` vs「等待」= 纯空心环（DOM 不同，遮挡文字可辨）；全部状态带 SVG 图形编码。

### 3.5 面板注册表（对齐 React `panels/registry.tsx` 8 类 → vanilla 10 视图）

```js
// components/registry.js
export const PANEL_KINDS = {
  files:    { title: '工作区文件', icon: FOLDER_ICON, render: renderFilesPanel },   // 已有 app.js:736
  browser:  { title: '内置浏览器', icon: GLOBE_ICON,  render: renderBrowserPanel }, // 已有 app.js:684
  review:   { title: '审阅',       icon: REVIEW_ICON, render: renderReviewPanel },  // 已有 app.js:722
  terminal: { title: '终端',       icon: TERM_ICON,   render: renderTerminalPanel },// 已有 app.js:727
  git:      { title: '变更',       icon: BRANCH_ICON, render: renderGitPanel },     // 新增（对齐 React git 面板）
  tasks:    { title: '任务执行',   icon: AGENT_ICON,  render: renderTasksPanel },   // 新增（GAP-01，对齐 React agents）
  history:  { title: '运行历史',   icon: CLOCK_ICON,  render: renderHistoryPanel }, // 新增（GAP-03，对齐 React schedule）
  memory:   { title: '记忆',       icon: MEM_ICON,    render: renderMemoryPanel },  // 新增（§7.3 判定：移植）
  plugins:  { title: '插件',       icon: PLUG_ICON,   render: renderPluginsPanel }, // 新增（§7.3 判定：移植）
  sidechat: { title: '辅助对话',   icon: SIDE_ICON,   render: renderSidechatPanel },// 新增（§7.3 判定：移植）
};
```
> `VIEW_META`（`app.js:684-689`）现有 4 视图 → 扩为 **10**（`data-view` 值扩展，§7.7）。`data-view` 零重命名（既有值保留）。React 8 面板的落点：`git→git`、`agents→tasks`、`schedule→history`、`memory/plugins/sidechat→同名视图`、`approvals→内联消息流`、`token→底栏`（§7.3）。

---

## §4 响应式实现方案

> **全部消费规范 §C**，不另起一套。四档：`≥1600` / `1280–1599` / `1024–1279` / `960–1023`。

### 4.1 四档断点实现

| 档位 | 侧栏 | 右板 | 主区最小宽 | 输入区 | CSS 落点 |
|---|---|---|---|---|---|
| ≥1600 | 列 `264px` | 列 `340px` | ≥640px | 不折叠 | `@media (min-width:1600px)` |
| 1280–1599 | 列 `264px` | 列 `340px`（≥300 ✅RESP-03） | ≥480px | 不折叠 | 默认 |
| 1024–1279 | 图标栏 `64px`（`--rail-w`） | **覆盖式 Sheet**（1024 即 Sheet ✅RESP-03） | ≥480px | 不折叠 | `@media (max-width:1279px)` |
| 960–1023 | 覆盖式 Sheet（抽屉） | 覆盖式 Sheet | ≥480px | 不折叠 | `@media (max-width:1023px)` |

- **落点**：`index.html:1353-1365`（"responsive" 段）**整体替换**单一 `@media (max-width:920px)`（`1354`）。
- **`grep -c 'max-width:1599\|max-width:1279\|max-width:1023\|min-width:1600'` ≥ 3** ✅（4 串均出现，RESP-01 验收）。
- **`--rail-w: 64px`**（规范 §A.4 新增令牌）用于 1024–1279 图标栏。

### 4.2 与现有 920 断点共存/替换（**无冲突**）

原 `@media (max-width:920px)`（`index.html:1354-1365`）的规则逐条被吸收：
- `.gutter{display:none}`（`1356`）→ 由 1279 档吸收；
- `.shell{--content-max:none}`（`1357`）→ 1279 档；
- `.sidebar` 浮层（`1358`）→ 1023 档；
- `.drawer` Sheet（`1360-1363`）→ 1279 档（1023 ⊃ 920）；
- `.bubble{max-width:92%}`（`1364`）→ 1023 档。

**处置：删除 `1354-1365` 块**，由 1279 + 1023 取代。**保留 `.drawer.open-m` 机制**（`1362`）——`setDrawer()`（`app.js:666-672`）逻辑不变（Sheet 开合复用它）。→ 满足「与现有 920 断点共存/替换」且**无断点冲突**。

### 4.3 窗口最小尺寸（**RESP-02，P0 崩溃级**）

**现状实测**：`src/main/index.ts:63` `createWindow()`，`64-66` `new BrowserWindow({ width:1280, height:832, … })`，**无 `minWidth`/`minHeight`**。

**改法**（落地轮）：
```ts
// src/main/index.ts:64-66
win = new BrowserWindow({
  width: 1280, height: 832,
  minWidth: 960, minHeight: 600,     // ← 新增（对齐规范 §C.1 建议）
  …
});
```
- **验收（与 RESP-01 断点自洽的准确表述）**：`grep -n 'minWidth\|minHeight' src/main/index.ts` ≥ 2 ✅；**最小尺寸 960 落在 ≤1023 档**——此时侧栏与右板**均为覆盖式**（`position:fixed` 浮层，**不占列宽**），主区**常驻全宽 960px ≥ 320px**；两板经 `drawerToggle`（`index.html:1374`）/键盘**可达**。
  > ⚠️ **表述校正**：RESP-02 原文「三栏均可见」在四档规格下应读作「三栏**均可达/均不缺失**」——**同屏并列**只存在于 **≥1280 档**；960–1023 档两板为**覆盖态**（打开时叠加于主区之上，关闭时不占位）。**主区宽度恒 ≥ 320px 恒成立**（覆盖层不挤压主区）。此校正与 `01-requirements.md` RESP-02 的措辞修订一致。
- **600 高**：标题栏 44 + composer（≈24+40+24）+ 底栏 24 + 消息区 ≥300。

### 4.4 右板覆盖式降级（RESP-03/04）

- **≤1279**：`.drawer` 改 `position:fixed; right:0; top:var(--titlebar-h); transform:translateX(100%)`，`.drawer.open-m{transform:translateX(0)}`；`.gutter{display:none}`（**取消固定列拖拽**）。
- **≤1023**：`.sidebar` 改浮层抽屉（`.sidebar.open` 展开）。
- **RESP-04 验收**：1024px 视口下拖拽手柄不可越界（`.gutter` 已隐藏）；键盘 `ArrowLeft/Right` 开合右板（复用 `app.js:630-640` 的 gutter 键盘逻辑 + `drawerToggle`（`index.html:1374`）），焦点环可见（§6）。
- **RESP-03 验收**：1024px 下右板为 Sheet 且主区 ≥480px；1280px 下三栏共存且右板 ≥300px。

### 4.5 布局持久化 + **F-1 schema 错位修复**

**现状实测（F-1）**：`src/main/settings.ts:13-20` `LayoutState = { open: Partial<Record<PanelId,boolean>>, activePanel: PanelId|null, width: number }`；`PANEL_IDS`（`settings.ts:10`）= **8 个 React 面板 id**（`approvals/token/git/memory/plugins/sidechat/agents/schedule`）；`DEFAULT_SETTINGS.layout`（`51-56`）`width: 32`（**百分比**）。而 vanilla 视图集是 `files/browser/review/terminal`（`app.js:684-689`）→ **零重叠 + 单位不一致**（schema 百分比 vs CSS 像素）。且 `panels-check` A1/A2（`30-35`）断言 `open.git`/`activePanel='git'` 是**无意义的绿**。

**修复方案（向后兼容迁移，非破坏性）**：

1. **视图集对齐**：新增 vanilla 视图 `git`（§3.5）→ 使 `git` 成为**真实 vanilla 视图**，则 `open.git`/`activePanel='git'` **语义仍然成立**（A1/A2 无需改判据即自洽）。
2. **schema 扩展为超集**（不删旧键）：
   ```ts
   // src/main/settings.ts（目标）
   export const VIEW_IDS = ["files","browser","review","terminal","git","tasks","history","memory","plugins","sidechat"] as const;
   export type ViewId = (typeof VIEW_IDS)[number];
   export interface LayoutState {
     open: Partial<Record<PanelId | ViewId, boolean>>;   // 旧 React id 保留可读（兼容）
     activePanel: PanelId | ViewId | null;
     /** 兼容旧百分比：读入时若 ≤70 视为百分比并换算；新写一律像素。 */
     width: number;
     /** 新增：分栏像素宽（权威）。 */
     sidebarWidth?: number;   // 默认 264（对齐 data-def）
     drawerWidth?: number;    // 默认 340
   }
   ```
3. **迁移读逻辑**（`validateSettings` `80-126`）：读到旧 `width:32`（百分比）→ 按 `round(innerWidth*0.32)` 换算为 `drawerWidth` 并**回写**；读到 `sidebarWidth/drawerWidth` 优先。
4. **单位统一**：vanilla 层持久化**只用像素**（`--sidebar-w`/`--drawer-w`），与 `localStorage 'forge-sidebar-w'/'forge-drawer-w'`（`app.js:586/601/643`）合并——**布局持久化单一来源 = settings（跨重启）+ localStorage（同会话）**，后者为前者的缓存。
5. **`panels-check` A1/A2 处置**：因 `git` 仍为真实视图，A1/A2 **保持有效**（无意义绿被「git 成为真实视图」修复）；但 **B3/B4**（`286/327` 探针 `[data-panel-toggle=git]`/`[data-panel-id=git]`）仍需换判据（§7.5）。
6. **验收**：写入后重载一致（A1）；非法值回退默认（A2）；`grep -c 'layout.width' ` 使用点改为像素语义。

### 4.6 `--sidebar-w` 与 `data-def` 矛盾修复（**F2**）

- CSS `--sidebar-w: 252px`（`index.html:17`）vs 拖动条 `data-def="264"`（`index.html:1414`）→ JS 启动 `apply()`（`app.js:594`）用 `data-def` 覆盖为 **264px**（JS 胜出）。
- **修法**：CSS 令牌改 **`264px`**（对齐权威默认），`data-def` 保持 264。→ 消除 12px 矛盾（规范 §A.4 已定 264 为权威）。

### 4.7 `KEEP_CENTER` 与断点协调（**F4**）

- `app.js:580` `const KEEP_CENTER = 380` **低于** RESP-03 的 480。
- **修法**：提到 **`480`**（对齐 RESP-03），或 `remap()`（`app.js:647`）内按断点分档；`sideMax()/drawerMax()`（`app.js:581-582`）随之更新。
- **栏宽优先级**：手动拖动 > 断点默认（`localStorage` 优先，未拖过用断点默认，§4.5 第 4 点）。

---

## §5 性能方案

> 每条给**目标指标 + 测量方法**，对齐 PERF-02 口径：**10k 事件下 DOM ≤ 300、滚动一屏 ≤ 200ms**（`panels-check` B1，`panels-check.ts:261/267`）。

### 5.1 长会话渲染（PERF-01）——窗口化（windowing）

**现状（F-3）**：`selectSession`（`app.js:2209-2230`）里 `r.events.forEach(renderEvent)`（`2223`）→ **全量同步渲染**，无上限/分批/合帧；全仓无 `slice(-`/`LIMIT`/`MAX_` 上限逻辑。

**方案**：`.stream-inner`（`index.html:1420` 区）内实现**可视窗口 + 节点池**：
- 只渲染**可视区 ± overscan（如 2 屏）**的消息；上下各放一个**占位 spacer**（`height = 未渲染项估算高之和`）维持滚动高度。
- 复用节点池（避免反复 create/destroy）。
- **保持 DOM 契约**：消息节点仍是 `.stream-inner > .msg`（探针改指目标，§7.5）；窗口化只控制**存在性**。

**目标指标**：10k 事件 → `document.querySelectorAll('.stream-inner > .msg').length ≤ 300`。
**测量**：`panels-check` B1（`261`）探针改指 `.stream-inner > .msg`（原 `[data-m1e-item]`，`257/260/271`）。

### 5.2 分段增量渲染

- `assistant_delta`（`app.js:1865-1869`）当前逐 delta 写 `textContent`（好），但**打字机 mock**（`992/1107`）用 `setInterval` 每字符写 + 每 6 字符 `scrollStream()` → 高频。
- **方案**：delta 走**单文本节点累加**（已是）+ **rAF 合帧**（§5.3）；历史会话按**分片**（每帧 50 条）用 `requestIdleCallback`/rAF 渲染，首屏优先。

**目标**：打开 10k 会话首帧可交互 ≤ 1s（`performance.now()` 从 `openSession` 返回到首帧）。
**测量**：CDP `Performance.getMetrics` 或注入计时。

### 5.3 事件合帧（PERF-03 的运行时面）

- `api.onEvent(e => renderEvent(e))`（`app.js:2176-2178`）**逐事件同步渲染**。
- **方案**：`store.dispatch` 入队，**rAF 批量 flush**；一帧内多事件合并为一次 DOM 更新。事件绑定统一为**容器级委托**（对齐 PERF-03：`render()` 后无新增监听）。

**目标**：`grep -c 'addEventListener'`（当前 80）显著下降；`render()` 后无逐条新增监听。
**测量**：代码层复核 + `panels-check` 事件流压测不超时。

### 5.4 `scrollStream` 重排消除（**F-4**）

**现状（F-4）**：`scrollStream()`（`app.js:894-897`）`stream.scrollTop = stream.scrollHeight` —— **读 `scrollHeight` 强制同步重排**，且被打字机每 6 字符调一次（`994`/`1109`）。

**方案**：
```js
// 目标：底部哨兵 + 粘性滚动 + rAF 合帧
let ticking = false;
function scrollStream() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const stream = $('.stream');
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
    if (nearBottom) stream.scrollTop = stream.scrollHeight;   // 仅贴底时自动跟
  });
}
```
- 消除「每 6 字符读写交替」的布局抖动；用户上滚时**不打断**（粘性滚动）。

**目标指标**：滚动一屏 ≤ 200ms（PERF-02）。
**测量**：`panels-check` B1（`265`）改指 `.stream`（原 `[data-virtuoso-scroller]`），连续 3 次 `performance.now()` 取 max。

### 5.5 模板字符串渲染开销控制（MAINT-04）

- **现状**：37 处 `innerHTML`（`app.js`）+ 1 处 `insertAdjacentHTML`，**全量重写**（如 `render()` `app.js:208` `sessionList.innerHTML = html`）。
- **方案**：① 静态模板缓存（`ICONS` 已是常量）；② 列表用 **DocumentFragment + 差量 patch**（按 `data-id` 复用节点，仅改变化项）；③ 状态类切换走 `classList`（保留）而非重建。
- **目标**：`grep -c 'innerHTML' src/renderer/*.js ≤ 12`（MAINT-04）；重绘范围 = 数据变更范围。
- **测量**：`grep -c` + `panels-check` B1。

### 5.6 指标汇总

| 指标 | 目标 | 测量方法 | 需求 |
|---|---|---|---|
| 10k 事件 DOM 消息节点 | ≤ 300 | CDP `querySelectorAll('.stream-inner > .msg').length` | PERF-01 |
| 滚动一屏耗时 | ≤ 200ms | CDP 3 次 `performance.now()` max | PERF-02 |
| 打开 10k 会话首帧 | ≤ 1s | CDP 注入计时 | PERF-01 |
| `innerHTML` 处数 | ≤ 12 | `grep -c` | MAINT-04 |
| `addEventListener` 处数 | 显著下降 | `grep -c` | PERF-03 |
| 打字机期间 forced reflow | 0（rAF 合帧） | DevTools Performance「Layout」计数 | PERF-02 |

---

## §6 A11Y 实现方案

### 6.1 现状缺口（**A11Y-01 的核心**）

**实测**：全仓 `aria-live` **仅 1 处**（toast，`index.html:1863`）。→ **流式输出（`assistant_delta`）与运行状态（`run`/工具调用/审批）对屏幕阅读器零播报**。资产好（298 `aria-*` / 30 `role=` / 13 处 reduced-motion，§G.1），但**无自动化门禁**。

### 6.2 流式与运行状态播报（补法）

| 场景 | 方案 | 令牌/属性 |
|---|---|---|
| 运行状态（开始/完成/失败/中断） | 底栏 `.statusbar` 内 **`role="status" aria-live="polite"`** 区域，播报「运行中 / 已完成 / 失败」 | `data-run-state` |
| 流式正文 | **禁止**把 `aria-live` 挂在逐字符流上（会刷屏）；改为**完成时**经 polite 区播报「回复完成，共 N 字」，流式期间 `aria-busy="true"` | `.ai-text[aria-busy]` |
| 工具调用 | polite 区播报「调用 {name}…」（**节流**：≥2s 合并） | — |
| 审批请求 | **`aria-live="assertive"`**（需立即注意） | `.card.ask[data-ask]` 邻接 live 区 |
| 状态点 | `aria-hidden` + 相邻文字标签（§3.4，无「仅图标承载语义」） | `data-st` |

> **实现落点**：新增 `.sr-only` live 区（复用既有 `.sr-only`，`index.html:113`），挂 `role="status"`；底栏 `role="status"`（VIS-02）。

### 6.3 状态三重编码的 a11y（VIS-01/03/04/05）

- 7 态状态点**全部** `aria-hidden`，语义由**相邻文字**（成功/运行中/等待/卡死/失败/被拒/已中断）承载 → 满足 A8。
- plan 进度：`role="progressbar" aria-valuenow/min/max`（A9）。
- 弹层：`aria-modal` + 焦点陷阱 + Esc 关闭（A10；既有 `aria-modal` `index.html:1688/1836`）。

### 6.4 自动化 a11y 断言清单（**A11Y-01 门禁**）

> 脚本 `scripts/a11y-check.ts`（CDP 注入 axe-core，`TERM=dumb`），登记 `gate-manifest.ts`（26 → 27，§9）。

| # | 断言 | 阈值 | 视图 |
|---|---|---|---|
| A1 | axe-core `critical + serious` 违规 | = 0 | 主对话 / 设置 / 右板 |
| A2 | `grep -c 'aria-'`（index+app） | ≥ 298 | 全仓 |
| A3 | `grep -c 'role='` | ≥ 30 | 全仓 |
| A4 | `grep -c 'prefers-reduced-motion'` | ≥ 13 + 新增动效数 | `index.html` |
| A5 | 全部 `button`/`a[href]`/`[role=button]` 可 Tab 达 | 100% | 3 视图 |
| A6 | 焦点可见（Tab 遍历无焦点丢失，`activeElement` 恒非 body） | 100% | 3 视图 |
| A7 | 交互控件非文字对比 ≥3:1（用 `--border-strong`） | 100% | 表单/按钮 |
| A8 | 状态点带 `aria-hidden` + 相邻文字 | 100% | 消息流 |
| A9 | `role="progressbar"` 带 `aria-valuenow/min/max` | 100% | plan 卡 |
| A10 | 弹层带 `aria-modal` + 焦点陷阱 + Esc | 100% | 弹层 |

**A11Y-03**：新增动效（脉冲环 / 卡死慢闪 / 底栏过渡 / Sheet 滑入 / 回到底部浮钮 / 命令面板淡入）**各补一条** reduced-motion 降级（规范 §G.2）→ 计数 = 13 + 新增数。

---

## §7 D1 收口执行方案

> D1 裁决：**收口到 vanilla**（简报 §0）。本节给**逐项判定表**（移植 / vanilla 等价替代 / 明确放弃），**不得静默丢弃**（MAINT-05）。

### 7.1 `components/ui/*`（29 文件）逐项判定（消费规范 §F）

| # | 组件（行数） | 判定 | 理由 / vanilla 等价物 |
|---|---|---|---|
| 1 | message-scroller（131） | **移植** | 虚拟化是 PERF-01 核心；vanilla 窗口化（§5.1） |
| 2 | resizable（47） | **替代** | 已有 gutter 拖拽（`app.js:603-648`） |
| 3 | progress（28） | **移植** | plan 进度可视化；`.tp-fill` + `role="progressbar"` |
| 4 | table（113） | **移植（按需）** | 仅 run 汇总/历史需要时；否则放弃 |
| 5 | radio-group（41） | **替代** | `.set-choice`/`data-grp`（`index.html:1730`）+ `role="radiogroup"` |
| 6 | checkbox（32） | **替代** | `.risk-ack role="checkbox"`（`index.html:1851`） |
| 7 | field（238） | **移植（按需）** | clarify 表单卡需要；否则 `aria-label` |
| 8 | attachment（204） | **替代** | `.ctx-upload` + `#fileInput`（`index.html:1545-1548`） |
| 9 | empty（103） | **替代** | `.settings-empty`/`data-empty`（`app.js:486/826`） |
| 10 | skeleton（13） | **放弃** | 无异步骨架屏需求 |
| 11 | spinner（10） | **替代** | `.run-grid` 九宫格（`app.js:21-24`） |
| 12 | sidebar（700） | **替代** | `.sidebar`（`index.html:1381`） |
| 13 | select（189） | **替代** | `.ctx-pop` 自绘弹层（`index.html:1535`） |
| 14 | dialog（166） | **替代** | `.settings-overlay`/`.risk-scrim`（`aria-modal`） |
| 15 | sheet（145） | **替代** | `.drawer.open-m` Sheet（`index.html:1362`） |
| 16 | message（91） | **替代** | `.msg`（`index.html:1423`） |
| 17 | bubble（124） | **替代** | `.bubble`（`index.html:1426`） |
| 18 | card（102） | **替代** | `.card`（`index.html:1449`），本轮收敛骨架（§3） |
| 19 | tabs（89） | **替代** | `.side-tab`/`.side-tabs`（`index.html:1647`） |
| 20 | button（66） | **替代** | 原生 `<button>` + 既有 class |
| 21 | tooltip（56） | **替代** | `title` + `aria-label` |
| 22 | scroll-area（52） | **替代** | 原生 `overflow` + `::-webkit-scrollbar`（`index.html:114-116`） |
| 23 | badge（48） | **替代** | `.tag`（`index.html:1452`） |
| 24 | collapsible（33） | **替代** | `data-card-toggle`/`data-tool-toggle` 委托 |
| 25 | separator（27） | **替代** | `.gutter role="separator"`（`index.html:1410`） |
| 26 | label（23） | **替代** | `<label>`/`aria-label` |
| 27 | input（18） | **替代** | 原生 `<input>`（`index.html:1389`） |
| 28 | textarea（17） | **替代** | 原生 `<textarea>`（`index.html:1551`） |
| 29 | marker（68） | **放弃** | 无对应需求 |

> **汇总**：移植 4（message-scroller / progress / table / field，后两者按需）；替代 23；放弃 2。**Tailwind 4 + `components.json` 明确放弃**（不引构建链，CSP `script-src 'self'`，`index.html:7`）。逐项无 `TBD`。

### 7.2 `cards/*`（8 文件）逐项判定

| React 文件 | 行数 | 判定 | vanilla 落点 |
|---|---|---|---|
| `registry.tsx` | 219 | **参照重建** | `components/registry.js` 的 `CARD_KINDS`（§3.3）——**逻辑参照，不移植 JSX** |
| `clarify-form.tsx` | 115 | **移植** | `.card--clarify`（§3.2），表单 a11y（A9/A10） |
| `plan.tsx` | 96 | **已有** | `.card--plan`（`app.js:1932`）→ 收敛骨架 + 进度可视化 |
| `agent-card.tsx` | 88 | **移植** | `.card--agent`（对应 GAP-01 任务视图） |
| `compaction-card.tsx` | 77 | **移植** | `.card--compaction`（或明确保留 toast，二选一，报告标注） |
| `verify-result.tsx` | 55 | **已有** | `.card--verify`（`app.js:1973`）→ 收敛 |
| `promote.tsx` | 54 | **移植** | `.card--promote`（sidechat 结论提升） |

> **已有 4 / 需新建 5 / 明确保留 toast 1**（对齐规范 §D.3）。

### 7.3 `panels/registry.tsx`（1281）逐项判定

| React 面板 | vanilla 落点 | 判定 |
|---|---|---|
| git | 新增 `git` 视图（§3.5） | **移植**（并解决 F-1 schema 语义） |
| agents | 新增 `tasks` 视图（GAP-01） | **移植**（用 `projectAgentPanel` 投影，§8） |
| schedule | 新增 `history` 视图（GAP-03） | **部分移植**（依赖 GAP-04 IPC 字段，未暴露则占位） |
| approvals | 既有 `.card.ask[data-ask]`（`app.js:2130`） | **替代**（审批已内联于消息流） |
| token | 并入底栏 `.statusbar`（VIS-02） | **替代**（token 计数迁底栏） |
| memory | 新增 `memory` 视图（§3.5） | **移植**：`getState().memory`（`ipc-protocol.ts:45/115-118`，`MemorySnapshot`）+ `deleteMemory`（`preload/index.ts:34`）IPC **完整接线、无技术阻断** |
| plugins | 新增 `plugins` 视图（§3.5） | **移植**：`getState().plugins`（`ipc-protocol.ts:47`）+ `pluginDecide`（`ipc-protocol.ts:153`）IPC 完整接线 |
| sidechat | 新增 `sidechat` 视图（§3.5） | **移植**：4 个 sidechat IPC（`sidechatCreate/Ask/Promote/State`，`ipc-protocol.ts:155-164`）+ `getState().sidechat` 完整接线 |

> **判定依据（假设 A1，见文末「修订记录」）**：上表 **memory / plugins / sidechat 三项**均判**移植**，依据 = 简报 §3「D1 收口时必须逐项判定：移植 / 用 vanilla 等价物替代 / 明确放弃——**不能静默丢弃**」+ D1「React 独有面板能力按需移植」，且三者 IPC **完整接线、无技术阻断**。**若用户对 D1「按需」取更窄解释（仅四目标 + 三缺口），则这 3 项应改判「明确放弃」**（IPC 保留、UI 无入口）。三者的落地排在 **P2**（不在 D4 点名的 3 缺口内，见 §10）。

### 7.4 `projections.ts` 依赖解除（**纠正简报框架**）

**简报 §4 说**：「`panels-check.ts:12` 硬 import projections → `projections.ts` 仍需保留（或把这两个投影函数迁独立模块）。这是 React 树归档前置。」

**实测复核（本轮新证据，比简报更完整）**：`projections.ts`（591 行）被**远超 2 处**引用：

| 引用方 | 行 | 用到 |
|---|---|---|
| `scripts/panels-check.ts` | 12 / 344 | `projectDiffCards` `projectTokenUsage` |
| `scripts/sidechat-check.ts` | 25 | `projectPromoteBadges` |
| `scripts/agents-check.ts` | 26 | `projectTokenUsageByAgent` `projectMergeTower` |
| `src/renderer/store.ts` | 6 | `pendingApprovals` `projectDiffCards` `projectMemoryWrites` `projectTokenUsage` |
| `src/renderer/panels/registry.tsx` | 34 | 多个投影 |
| `src/renderer/cards/registry.tsx` | 18 | `firstPathOfStat` `parsePatchLines` |
| `src/renderer/cards/agent-card.tsx` | 8 | `agentStatusBadge` |
| `tests/panels.test.ts` | 6 / 159 | 多投影 |
| `tests/agents.test.ts` | 26 | 多投影 |
| `tests/sidechat.test.ts` | 17 | 多投影 |
| `tests/m3b.test.ts` | 13 | `projectMergeTower` `parsePatchLines` |

**结论（关键修正）**：`projections.ts` **不是 React 树的一部分**——它是**纯 TS、框架无关的投影层**，且是**全仓唯一被 typecheck 覆盖的投影实现**。**正确处置 = 保留并提升为共享投影层**（§1.4），**vanilla 桥接层应当消费它**，而非归档它。

- **对 MAINT-06 的落点**：不是「迁走 2 个函数让 projections 归档」，而是**让 vanilla 层复用 `projections.ts`**（消除 `app.js` 内 `tokStr()`（`app.js:1728`）/ `diffHtml`（`app.js:1908`）的**重复实现**）。这样 `panels-check.ts:12/344` 的 import **无需改指**，`projections.ts` **保留**。
- **`projections.ts` 位置**：可留在 `src/renderer/projections.ts`（被 `.ts` 消费者引用），**不删**。
- **验收**：`panels-check.ts` 的 import 目标**仍是** `projections.ts`（保留即达标）；`app.js` 内投影重复实现删除（`grep -c 'tokStr\|function diffHtml' src/renderer/**/*.js` 收敛）。

### 7.5 7 探针改指映射 + **BLOCKED（判据缺陷）**

> **纪律（铁律）**：7 个 CDP 探针指向 **dead React DOM**，vanilla 层命中全 0（简报 §4）。**这是判据本身有缺陷** → 按需求 §3.3 **必须立 `BLOCKED.md` 要求换判据**，**不设计绕过方案**，**严禁伪造 `data-m1e-*`**。

**应立 BLOCKED 项**：`scripts/panels-check.ts` 的 7 探针（`251/257/260/264/265/269/271/278/286/299/327`）判据失效。**本设计只提供「建议换判据」的目标（真实元素），不修改判卷文件。**

**换判据建议映射（待 BLOCKED 批准后由判卷方实施）**：

| 探针（panels-check 行号） | 建议改指 vanilla 真实目标 | 依据 |
|---|---|---|
| `[data-m1e-event-count]`（`:251`） | **`#eventCount`**（底栏新增，真实消费事件数） | VIS-02 |
| `[data-m1e-item]`（`:257/260/271`） | **`.stream-inner > .msg`**（`index.html:1421/1423/1434`） | 真实消息 DOM |
| `[data-virtuoso-scroller]`（`:264/265/269`） | **`.stream`**（`index.html:1420`，真实滚动容器） | vanilla 无 virtuoso |
| `[data-approval-badge]`（`:278`） | **`.card.ask[data-ask]`**（`app.js:2130`）或新增 `.approval-dot` | live 审批真实节点 |
| `[data-panel-toggle="git"]`（`:286`） | **`[data-view="git"]`**（新增 git 视图） | live 用 `data-view` |
| `[data-panel-id="git"]`（`:327`） | **`[data-view="git"]` 的打开态** | 同上 |
| `[data-m1e-settings-open]`（`:299`） | **`#settingsOpen`**（`index.html:1401`） | live 真实设置入口 |

> **改指后命中须全部 ≥1，且被指元素为真实交互/数据节点**（删除会导致功能失效）。**不设计任何伪造钩子方案。** 未获 BLOCKED 批准前，`panels-check` B 相保持红——**不宣称绿**。

### 7.6 其他 React 文件判定

| 文件 | 行数 | 判定 | 理由 |
|---|---|---|---|
| `store.ts` | 141 | **保留/复用** | reducer + `foldEvent`，框架无关，被单测覆盖；作 vanilla `store.js` 的基础 |
| `theme.ts` | 43 | **保留/合并** | `applyScheme`/`watchSystemTheme` 被单测引用；vanilla 已有 `initTheme`（`app.js:570-575`）→ 合并为单一主题模块 |
| `onboarding.tsx` | 307 | **移植** | `onboarded` 标志已固化于 `AppSettings`（`settings.ts:42`，注释明写「首启弹向导；完成后不再弹，设置页可重跑」）并经 `setSettings` 可达；不移植则该标志成**死数据**、文档化首启 UX 丢失。落点：`render/onboarding.js`（vanilla 首启向导，七组对齐 §13） |
| `conversation.tsx` | 91 | **明确放弃** | 断链（简报 §3） |
| `main.tsx` / `styles.css` / `error-boundary.tsx` | — | **已删除**（工作区实测 D 状态） | 已被 vanilla 取代 |
| `hooks/use-mobile.ts` | 1 | **明确放弃** | 唯一消费者 `components/ui/sidebar.tsx:6`（随 §7.1 #12 归档）；vanilla 用 CSS 断点（§4.1）判窄视口，无需 JS 移动检测 |
| `lib/utils.ts` | 1 | **明确放弃** | `export { cn } from "cn"`；全仓**无** `@/lib/utils` 引用（实测 28 个 ui 组件均直接从 `"cn"` 包导入）→ 孤儿文件 |

### 7.7 钩子清单：冻结（零重命名）+ 新增（显式列出）

**冻结（零重命名，实测复核，简报 §5 + 规范 §E.1）**：`data-theme` `data-od-id` `data-drawer` `data-panel`(+min/max/def) `data-view` `data-close` `data-card-toggle` `data-card` `data-doc` `data-label` `data-msg-act` `data-id` `data-folder` `data-act` `data-sid` `data-grp` `data-val` `data-switch` `data-set-theme` `data-reduce-motion` `data-sec` `data-model` `data-desc` `data-term` `data-branch` `data-ws` `data-perm` `data-ask` `data-live` `data-stream` `data-empty` `data-doc-active` `data-v` **`data-tool-toggle`**（补录，F1）`data-archived`(dataset) `data-tokenized`(dataset) `data-scope`/`data-ask-id`(dataset)。

**新增钩子（本文显式列出，供落地轮实现；不改冻结项）**：

| 新增钩子 | 用途 | 落点 |
|---|---|---|
| `data-st` | 7 态状态编码（§3.4） | 卡片/消息/底栏 |
| `data-statusbar` | 底栏容器 | `index.html` 骨架（VIS-02） |
| `data-run-state` | 底栏运行态 | 底栏 |
| `data-approval-dot` | 审批徽标（探针目标） | 侧栏/底栏 |
| `data-view="git\|tasks\|history"` | **值扩展**（既有 `data-view` 键不重命名） | 右板 tab |
| `data-card` 值扩展 | report/usage/clarify/compaction/promote/agent/diff/verify | 卡片 |
| `data-task-id` | 任务执行视图项 | tasks 视图 |
| `data-batch-id` | run 批次历史项 | history 视图 |
| `data-vitem` | 虚拟化窗口节点（可选，或复用 `.msg`） | stream |

> **禁止新增 `data-m1e-*`**（§7.5 铁律）。

---

## §8 结构性缺口实现（GAP-01…04）

| 编号 | 目标 | 实现落点 | 依赖内核字段？ | 降级 |
|---|---|---|---|---|
| **GAP-01** 任务执行视图 | 独立 `tasks` 视图，编排区 ≥640px | 新增 `render/taskView.js` + `data-view="tasks"`；数据用 `projectAgentPanel`（`projections.ts:449`，**已存在**）从 agent 事件（`AgentSpawned/Status/Message/Result`，`events/index.ts:173-235`）投影 | **否**（事件已含 agent 字段） | 无 |
| **GAP-02** 全局状态底栏 | `.statusbar` 常驻，含沙箱态/事件数/tokens，全 8 视图可见 | `render/statusbar.js`；沙箱来自 `getState().sandbox`（`ipc-protocol.ts:43`），事件数来自事件流计数，tokens 来自 `usage` 事件（`events/index.ts:25`） | **否**（`getState` 已暴露 sandbox） | 无 |
| **GAP-03** run 批次历史 | `history` 视图，按批次回溯/检索 | 新增 `render/historyView.js` + `data-batch-id`；**通用 run 批次字段不存在**（见下） | **是** 🔴 | **结构占位** + IPC 需求单 |
| **GAP-04** run 聚合数据源 | IPC 接口需求单 | §8.1 | — | — |

### 8.1 GAP-03 阻断与 GAP-04 接口需求单（**实测**）

**实测**：`src/events/index.ts` 全部事件接口**无 `runId` / 批次 id / 时间戳字段**（`session_meta` 仅 `branch_of/kind/parent_session_id/origin/automation_*`，`events/index.ts:29-37`）；`openSession(id) => { events }`（`ipc-protocol.ts:144`）**无分页/聚合**；`SessionInfoPayload`（`ipc-protocol.ts:90-97`）仅 `id/mtimeMs/lines/origin/automationId/automationName`。**唯一**存在的批次历史是**定时任务**的 `ScheduleSnapshot.history: HistoryEntry[]`（`scheduler.ts:394-396`），字段含 `task_id/task_name/occurrence_key/due_at/decision/session_id/state/reason/at`——**仅覆盖 scheduled run**。

**结论**：GAP-03 的通用 run 批次回溯 **🔴 依赖内核字段，当前 IPC 未暴露** → **降级为结构占位**（数据缺失时显示明确空态，不报错）。

**IPC 接口需求单（GAP-04）**：

| 需求字段 | 用途 | 当前 `AgentApi`（约 30 方法）差集 |
|---|---|---|
| 批次 id（runId） | 批次唯一标识 | ❌ 无 |
| 起止时间（startedAt/finishedAt） | 批次时间轴 | ❌ 无（事件无 ts） |
| 事件数 | 批次规模 | ⚠ 仅 `SessionInfoPayload.lines`（会话级，非批次级） |
| 批次状态（running/succeeded/failed/cancelled） | 状态列 | ❌ 无（仅 `ScheduleSnapshot.history.state` 覆盖 scheduled） |
| 建议新接口 | `listRuns(sessionId) => RunInfo[]` 或事件增 `runId`+`ts` | 新增 |

> **处置**：占位视图先落（`data-batch-id` 骨架 + 空态「暂无批次数据 · 需内核暴露 run 聚合」），**单列接口任务**，**不改内核 IPC 语义**（需求 §3.2）。

---

## §9 改动范围清单（**核心交付**）

> 逐文件：**文件 → 改动性质 → 预估规模 → 风险 → 回归方式**。行号 = 当前工作树。

| # | 文件 | 改动性质 | 预估规模 | 风险 | 回归方式 |
|---|---|---|---|---|---|
| 1 | `src/renderer/app.js`（2281） | **拆分/删除**（拆为 utils/store/render/components/bridge/mock/main；末态删除或降为 `main.js`） | 2281 → 9 文件，各 ≤500 | **🔴 最高**（状态收敛 + 桥接重写，F-2 无类型保障） | golden 快照 + 双跑 diff + 全门禁 |
| 2 | `src/renderer/index.html`（1866） | **拆分/改写**（CSS 出 5 层 + 骨架调整 + 断点替换 + 新增底栏/tasks/history 骨架） | 1866 → ~500 骨架 + 5 CSS | **🟠 高**（CSS 出层静默破坏，322 选择器 × 62 `classList`） | 逐像素对比 + `grep '@layer'` + 截图 diff |
| 3 | `src/main/settings.ts`（184） | **改写**（layout schema 扩展 + 迁移读，F-1） | +30 行 | **🟠 高**（持久化向后兼容） | panels-check A1/A2 + 迁移单测 |
| 4 | `scripts/panels-check.ts`（386） | **改判据**（7 探针换指 + 可选 import 保留）——**需 BLOCKED 批准** | 7 行 | **🔴 高**（判卷文件，牵动门禁绿红） | 换判据后 7 探针命中 ≥1 |
| 5 | `src/main/index.ts`（352） | **改**（`minWidth/minHeight`） | +2 行 | 🟢 低 | `grep` + 最小尺寸手测 |
| 6 | `src/renderer/projections.ts`（591） | **保留**（提升为共享投影层，非归档） | 0（位置可能迁移） | 🟢 低 | 4 门禁脚本 + 4 测试继续绿 |
| 7 | `src/renderer/store.ts`（141） | **保留/复用**（作 vanilla store 基础） | 0 | 🟡 中（单测覆盖） | tests 继续绿 |
| 8 | `src/renderer/theme.ts`（43） | **保留/合并**（与 `app.js:570-575` initTheme 合并） | 0 | 🟢 低 | 单测 + 主题手测 |
| 9 | `src/renderer/components/ui/*`（29） | **删除**（§7.1：移植 4 / 替代 23 / 放弃 2） | 删除 29 文件 | 🟡 中（含 message-scroller 虚拟化需先移植） | §7.1 逐项 + PERF-01 |
| 10 | `src/renderer/cards/*`（8） | **删除**（§7.2：参照重建/移植） | 删除 8 文件 | 🟡 中 | §7.2 逐项 + MAINT-03 |
| 11 | `src/renderer/panels/registry.tsx`（1281） | **删除**（§7.3：移植 6 / 替代 2） | 删除 1 文件 | 🟡 中（git/agents/memory/plugins/sidechat 需先建视图） | §7.3 逐项 |
| 12 | `src/renderer/onboarding.tsx`（307） | **移植**（§7.6：vanilla 首启向导） | 新增 `render/onboarding.js` ~250 行 | 🟡 中 | §7.6 + 手测首启 |
| 13 | `src/renderer/conversation.tsx`（91） | **删除**（断链） | 删除 | 🟢 低 | 无引用 |
| — | `src/renderer/hooks/use-mobile.ts` + `lib/utils.ts` | **删除**（§7.6：无消费者 / 孤儿） | 删除 2 文件 | 🟢 低 | 无引用 |
| 14 | `scripts/a11y-check.ts` | **新增**（axe-core 扫描） | ~150 行 | 🟡 中 | A1–A10 断言 |
| 15 | `scripts/gate-manifest.ts`（104） | **改**（GATES 登记 a11y-check，26 → 27） | +1 行 | 🟢 低 | gate-check 绿 |
| 16 | `scripts/renderer-arch-check.ts` | **新增**（依赖方向断言，§1.4） | ~80 行 | 🟢 低 | 依赖方向断言 |
| 17 | `src/renderer/css/*`（5 文件） | **新增**（tokens/base/layout/components/utilities） | ~1358 行迁入 | 🟠 高（同 #2） | 逐像素 + `@layer` |
| 18 | `src/renderer/render/*.js`（8 文件） | **新增**（视图层） | ~900 行 | 🟡 中 | golden 快照 |
| 19 | `src/renderer/components/registry.js` | **新增**（卡片/面板注册表） | ~250 行 | 🟡 中 | MAINT-03 验收 |
| 20 | `src/renderer/bridge/ipc.js` | **新增**（桥接层） | ~250 行 | **🔴 高**（行为等价） | 双跑 diff + 全门禁 |
| 21 | `src/renderer/mock/seed.js` + `mockRun.js` | **新增**（dev seed + mock run） | ~200 行 | 🟡 中 | 纯浏览器原型手测 |
| 22 | `src/renderer/main.js` | **新增**（启动层） | ~60 行 | 🟢 低 | 装配 + 开关 |
| 23 | `tsconfig.json` / `.eslintrc` / `.stylelintrc` | **新增/改**（护栏，§1.5） | — | 🟡 中 | typecheck/lint 门 |
| 24 | `tests/renderer-golden.test.ts` | **新增**（特征测试） | ~120 行 | 🟢 低 | 快照绿 |

**风险最高的 3 个文件**：① `src/renderer/app.js`（拆分 + 状态收敛，最高）；② `scripts/panels-check.ts`（判据变更，牵动门禁）；③ `src/renderer/index.html` / `css/*`（CSS 出层静默破坏面）。

**改动规模总览**：删除约 **40 文件**（React 树）；新增约 **20 文件**；改写 **4 文件**；`app.js` 2281 行 → 拆为 9 文件（各 ≤500）。

---

## §10 分阶段落地计划（P0/P1/P2）

> 对齐需求 §5 优先级。每批给**可判定完成标准 + 验证方式**。

### P0（不做则后续无法判定或体验崩溃）

| 编号 | 完成标准 | 验证 |
|---|---|---|
| **MAINT-06** | 7 探针换判据获批并改指；改指后命中全 ≥1 | `panels-check` B 相 7 探针命中 ≥1；被指元素删除即功能失效 |
| **RESP-02** | `minWidth/minHeight` 落地 | `grep -n 'minWidth\|minHeight' src/main/index.ts` ≥ 2；最小尺寸三栏可见 |
| **RESP-01** | 四档断点落地，替换 920 | `grep -c 'max-width:1599\|…\|min-width:1600'` ≥ 3；1440/1200/1024 无横向溢出 |
| **VIS-01** | `--st-*` 定义 + 每态 ≥1 消费点 | `grep -c -- '--st-run\|--st-wait\|--st-stuck\|--st-fail'` ≥ 4；灰度可辨 |
| **PERF-02** | 口径恢复可测 | 探针指真实滚动容器；10k 滚动一屏 ≤200ms |
| **GAP-04** | IPC 接口需求单产出 | 字段差集表（§8.1）；占位视图空态不报错 |
| **A11Y-01** | axe 扫描脚本 + 登记门禁 | 3 视图 critical+serious = 0；`gate-manifest` 26→27 |

### P1（目标核心，依赖 P0）

| 编号 | 完成标准 | 验证 |
|---|---|---|
| MAINT-01/02 | 模块拆分 + 单一状态源 | `grep -c '^import'` ≥ 3；覆写赋值 = 0；`let sessions` 命中 = 1 |
| MAINT-03/04 | 注册表 + 差量重绘 | `KNOWN_CARD_TYPES ≥ 10`；`innerHTML ≤ 12` |
| MAINT-05 | React 逐项判定表 | 覆盖全部资产，无 `TBD` |
| RESP-03/04 | 中窄适配 + 拖拽禁用 | 1024 Sheet 主区 ≥480；1280 右板 ≥300 |
| VIS-02/03/04/05 | 底栏 + 三态修复 + 图形编码 | 全视图可见；被拒≠卡死；已中断≠等待 |
| PERF-01/03 | 窗口化 + 委托 | 10k DOM ≤300；`addEventListener` 下降 |
| A11Y-02/03 | 不回退 + 新动效降级 | aria ≥298 / role ≥30 / reduced-motion ≥13 |
| GAP-01/02 | 任务视图 + 底栏 | 编排区 ≥640px；三项实时更新 |

### P2（收尾/增强）

| 编号 | 完成标准 | 验证 |
|---|---|---|
| MAINT-07 | CSS 分层 | `grep -c '@layer'` ≥ 4；令牌集合为超集 |
| VIS-06 | 归档守卫修复 | 归档行点击不误触 `selectSession`；守卫不再恒真 |
| GAP-03 | run 批次历史 | 依赖 GAP-04；未暴露则占位 |
| MAINT-05（R1 连带） | memory / plugins / sidechat 三视图 + onboarding 首启向导（§7.3/§7.6 判定「移植」，P2 落地；假设 A1 见「修订记录」） | 各视图入口可切换、IPC 数据可渲染；onboarding 首启弹窗 + `onboarded` 落盘 |

---

## §11 需求覆盖矩阵（27 条）

| 需求 | 实现落点（本文） | 目标文件 |
|---|---|---|
| MAINT-01 模块边界 | §1.1–1.4 分层 + §2 迁移 | app.js → 9 模块 |
| MAINT-02 隐式耦合 | §1.3 状态收敛 + §2.2 M2/M5 | store.js / bridge/ipc.js |
| MAINT-03 卡片注册表 | §3 | components/registry.js |
| MAINT-04 全量 innerHTML | §5.5 | render/*.js |
| MAINT-05 React 归档 | §7.1–7.3 / 7.6 | 判定表 |
| MAINT-06 探针 + projections | §7.4 / §7.5 | panels-check（换判据） |
| MAINT-07 CSS 分层 | §1.4 / §2.2 M7 | css/* |
| RESP-01 四档断点 | §4.1–4.2 | index.html + css/layout |
| RESP-02 最小尺寸 | §4.3 | main/index.ts |
| RESP-03 中窄三栏 | §4.4 | css/layout |
| RESP-04 分隔条 | §4.4 | css/layout + app.js |
| VIS-01 四态语义色 | §3.4 | css/tokens |
| VIS-02 状态底栏 | §8 GAP-02 | render/statusbar.js |
| VIS-03 被拒色 | §3.4 | components/registry.js |
| VIS-04 已中断/等待 | §3.4 | components/registry.js |
| VIS-05 图形编码 | §3.4 | components/registry.js |
| VIS-06 归档死代码 | §10 P2 | render/sessionList.js |
| A11Y-01 自动门禁 | §6.4 | scripts/a11y-check.ts |
| A11Y-02 资产不回退 | §6.3 | 全仓 |
| A11Y-03 新动效降级 | §6.4 | css/utilities |
| PERF-01 长会话 | §5.1 | render/chatStream.js |
| PERF-02 口径恢复 | §5.4/5.6 | render/chatStream.js + panels-check |
| PERF-03 事件绑定 | §5.3 | render/*.js |
| GAP-01 任务视图 | §8 | render/taskView.js |
| GAP-02 状态底栏 | §8 | render/statusbar.js |
| GAP-03 run 历史 | §8 | render/historyView.js |
| GAP-04 IPC 需求单 | §8.1 | 文档 |

---

## §12 硬约束自检

| 约束 | 自检 |
|---|---|
| 不改 `src/` | ✅ 本轮只写本 md |
| 不伪造 `data-m1e-*` | ✅ §7.5 只给**换判据建议**（真实元素），并**立 BLOCKED** |
| 32 钩子零重命名 | ✅ §7.7 冻结清单全量列出（含补录 `data-tool-toggle`）；新增钩子显式列出 |
| 判据缺陷不绕过 | ✅ §7.5 立 BLOCKED 要求换判据 |
| 行号与工作树一致 | ⚠️ **成文时**抽查过（`settings.ts:10-56` / `main/index.ts:63-66` / `panels-check.ts:12/251-327` / `events/index.ts:29-37`）；但**行数已漂移**（成文时 `app.js` 2281 / `index.html` 1866 → 现 **2360 / 1969**）⇒ **行号只作定位线索、不作判据**，引用前必须重新 grep |
| 消费设计系统令牌/断点 | ✅ §3/§4/§6 逐条引用规范 §A/§B/§C/§D/§F/§G |
| 27 条需求逐条覆盖 | ✅ §11 矩阵 |
| 语言/风格 | ✅ 简体中文施工图 |

**MAINT-05 闭环声明**：§7.1（29 项）/ §7.2（7 项）/ §7.3（8 项）/ §7.6（6 项）判定表**已全部收敛为「移植 / vanilla 等价替代 / 明确放弃」三选一 + 理由，无 `TBD`/`待判定`**。原 6 项待判定（§7.3 memory/plugins/sidechat + §7.6 onboarding/hooks/lib）的最终判定与依据见文末「修订记录（Phase 4 审查后）」。

---

## 修订记录（Phase 4 审查后）

> 触发：Phase 4 审查（PASS 21/25）指出 §7 判定表残留 **6 项待判定/TBD**，违反 MAINT-05「覆盖全部资产，无 TBD」。本轮**只改本文件**，逐项落成明确判定。**未改 `src/`；未改他人文件；冻结钩子零重命名。**

### R1 六项待判定的最终判定

| # | 资产 | 位置（原） | **最终判定** | 一句理由 | 若移植 → 落点 |
|---|---|---|---|---|---|
| 1 | `memory` 面板 | §7.3 | **移植** | `getState().memory`（`ipc-protocol.ts:45/115-118`）+ `deleteMemory`（`preload/index.ts:34`）IPC 完整接线、无技术阻断 | `data-view="memory"`（§3.5 `PANEL_KINDS.memory` → `render/renderMemoryPanel`） |
| 2 | `plugins` 面板 | §7.3 | **移植** | `getState().plugins`（`ipc-protocol.ts:47`）+ `pluginDecide`（`ipc-protocol.ts:153`）IPC 完整接线 | `data-view="plugins"`（`PANEL_KINDS.plugins`） |
| 3 | `sidechat` 面板 | §7.3 | **移植** | 4 个 sidechat IPC（`sidechatCreate/Ask/Promote/State`，`ipc-protocol.ts:155-164`）+ `getState().sidechat` 完整接线 | `data-view="sidechat"`（`PANEL_KINDS.sidechat`） |
| 4 | `onboarding.tsx` | §7.6 | **移植** | `onboarded` 标志已固化于 `AppSettings`（`settings.ts:42`，注释明写「首启弹向导」）并经 `setSettings` 可达；不移植则该标志成死数据 | `render/onboarding.js`（vanilla 首启向导，七组对齐 §13） |
| 5 | `hooks/use-mobile.ts` | §7.6 | **明确放弃** | 唯一消费者 `components/ui/sidebar.tsx:6`，随 §7.1 #12 归档；vanilla 用 CSS 断点（§4.1）判窄视口，无需 JS 移动检测 | — |
| 6 | `lib/utils.ts` | §7.6 | **明确放弃** | `export { cn } from "cn"`；全仓**无** `@/lib/utils` 引用（实测 28 个 ui 组件均直接从 `"cn"` 包导入）→ 孤儿文件 | — |

**计数**：移植 4（memory / plugins / sidechat / onboarding）+ 明确放弃 2（hooks/use-mobile / lib/utils）；替代 0。**三选一齐全，无 TBD。**

### R2 判定依据（假设 A1，**已闭环，非 TBD**）

第 1–4 项判「移植」的共同依据 = **简报 §3 原文「D1 收口时必须逐项判定：移植 / 用 vanilla 等价物替代 / 明确放弃——不能静默丢弃」** + **D1「React 独有面板能力按需移植」**，且四者 IPC 均**完整接线、无技术阻断**（放弃将造成**能力回归**）。

> **假设 A1（显式声明，供用户一键翻转）**：本判定取「不能静默丢弃」为**优先条款**。**若用户对 D1「按需」取更窄解释**（「需」= 仅四目标 + D4 点名的 3 处缺口），则第 1–4 项应**改判「明确放弃」**（IPC 保留、UI 无入口）。此为**一次假设翻转**，非未决项——两种读法下判定均已明确给出。
> **落地排序**：第 1–4 项均排在 **P2**（§10「收尾/增强」），**不在 D4 点名的 3 缺口（GAP-01/02/03）内**，不阻塞 P0/P1。

### R3 RESP-02 表述自洽校正（§4.3）

审查指出 `01-requirements.md` RESP-02 原文「最小尺寸下**三栏均可见**」与本文四档断点规格（960–1023 右板为**覆盖式**）冲突。**本文 §4.3 表述本身自洽，但原文「三栏均可见」措辞含糊，已校正为**：

> 最小尺寸 **960 落在 ≤1023 档** → 侧栏与右板**均为覆盖式**（`position:fixed`，**不占列宽**）→ 主区**常驻全宽 960px ≥ 320px**；两板**可达**（`drawerToggle` / 键盘）。
> **准确说法**：「三栏**均可达 / 均不缺失**」；**同屏并列**仅存在于 **≥1280 档**。**主区 ≥ 320px 恒成立**（覆盖层不挤压主区）。

§4.1 断点表（≥1600 主区 ≥640 / 1280–1599 ≥480 / 1024–1279 ≥480 / 960–1023 ≥480）与本校正**自洽**。此校正与需求发现分析师对 `01-requirements.md` RESP-02 的措辞修订方向一致。

### R4 连带一致性更新（因 R1 判定而改）

- §3.5 面板注册表：`PANEL_KINDS` 由 7 类扩为 **10 类**（新增 `memory` / `plugins` / `sidechat`）；`VIEW_META` 4 → 10。
- §4.5 `VIEW_IDS`：同步扩为 10（新增 `memory` / `plugins` / `sidechat`），与 §3.5 一致。
- §9 改动范围清单：第 11/12 行由「待判定/决策项」改为明确判定；新增一行 `hooks/use-mobile.ts` + `lib/utils.ts`（删除）。
- §12：删除原「待判决策项」段，改为 MAINT-05 闭环声明。
