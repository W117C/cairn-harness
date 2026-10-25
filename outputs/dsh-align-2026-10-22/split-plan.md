# 桌面端与代码结构优化 —— 切分方案（S1）

> 本文件是 **Phase 0 的落盘产物**：先落方案再动代码。
> 读数为 2026-10-22 现读；执行中若与盘上不符，以盘上为准并如实说明差异（见 §5「与盘上的差异」）。
> 目标执行体：本仓工作树（**不提交**）。

---

## 0. 基线读数（Phase 0 现读）

| 面 | 读数 | 判据 |
|---|---|---|
| HEAD | `d0708a0` | 提示词写作 `d0708a0`；执行期间另一会话落了两笔（`d0708a0` 动效/memo 边界、`d0708a0` 现态页 rev）⇒ **以盘上为准**，基线已在新 HEAD 上重跑一遍 |
| 路由体积 | initial **160,685 B**／main **538,102 B**／popout **376,021 B** | 上限 800,000／600,000／400,000 ⇒ main 余量 ≈10.3%，popout 余量 ≈6.0% |
| 桌面判卷 | **191 文件 / 1,317 用例**：1 失败 / 1,316 通过 | 唯一失败是 `desktop-review-batch.test.ts > 测量脚本要有预算 > 原生宿主实际运行` —— Electron Mach port 被外层沙箱拒（**环境债**，§2.5） |
| 核心判卷 | 未在 Phase 0 跑（`pnpm test:capped` 量大，留到终局门统一跑） | 计数必须带 `--maxWorkers=2` |
| typecheck | 0 报错 | `node --import tsx scripts/typecheck.ts` |
| 边界门 | 绿 | `pnpm desktop-boundary-check` |
| 脏项 | `ab.py`（未跟踪）、`apps/desktop/scripts/zindex-map.mjs`（未跟踪，另一会话）、`apps/desktop/outputs/`（体积审计产物，本轮生成） | 提示词列的 `styles.css` / `micro-interaction.test.ts` 在现读时**已不在脏集**（已被另一会话落库）⇒ 以盘上为准 |

---

## 1. 状态簇 → 目标模块 的映射表

簇不是按文件大小切的，是按**「这堆状态是为了什么」**切的。簇边界来自对 `App.tsx` 的实读（79 个 `useState`），不采信任何外部清单。

| 簇 | 成员（`useState` 名） | 归宿 | 迁移顺序 | 该批次的判卷命令 |
|---|---|---|---|---|
| **外观与布局** | `themePref` `uiSize` `textSize` `sidebarWidth` `sidebarCollapsed` `pluginSidebarWidth` `pluginSidebarOpen` `focusMode` `viewMode` | `state/useChrome.ts` | 3 | 桌面判卷 + typecheck + 体积 |
| **覆盖层与临时态** | `paletteOpen` `findOpen` `settingsOpen` `settingsSection` `newProjectOpen` `outlineOpen` `outlineCurrent` `cheatOpen` `archiveConfirm` `deleteConfirm` `wtDiscard` `revertConfirm` `projectRemoveConfirm` `barRenaming` `viewToast` `logTarget` `deliveryExpandedFor` | `state/useOverlays.ts` | 3 | 同上 |
| **输入与草稿** | `injectedText` `injectedTextSeq` `injectedAttachment` `injectedAppend` `pickSignal` `composerMenuSignal` `draftIds` `draftRemap` `draftRestore` `editCtx` | `state/useComposerDrafts.ts` | 3 | 同上 |
| **运行生命周期** | `elapsedSec` `pendingSend` `stoppedIds` `flashRound` `queueLoading` | `state/useRunLifecycle.ts` | 3 | 同上 |
| **会话与工程** | `sessions` `sessionsLoaded` `sessionsLoadError` `sessionErrors` `sessionNotices` `projects` `activeWorkspace` `preview` `mode` | 留在 `App.tsx`（与 IPC 订阅耦合太紧，强行抽会漂行为） | — | — |
| **纯投影** | `projections.ts` 的 21 个导出 | `derived/{session,run,usage,trail}.ts` | 2 | 同上 + 纯度门 |
| **视图层 JSX** | `App.tsx` 的 `return`（约 790 行） | `panes/{EmptySurface,ConfirmScrims,InspectorPanel,OverlayStack,AppToolbar,StreamColumn}.tsx` | 4 | 同上 |

**迁移顺序的定法**：先做**读路径改造**（批次 1），再做**纯投影**（批次 2），再做**状态簇**（批次 3），最后做**视图层**（批次 4）。
理由：读路径不先改，后面任何一次搬动都会让 67 个「读源文本断言」的判卷**静默变弱**（`not.toContain` 断言会因代码搬走而空过）。

---

## 2. 依赖方向图与四条不变量的判卷落点

```
                 ┌──────────────┐
                 │  App.tsx     │  ← 组合根：只做接线与布局
                 └──────┬───────┘
        ┌───────────────┼───────────────┬──────────────┐
        ▼               ▼               ▼              ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐   ┌─────────┐
   │  panes/ │    │ state/   │    │ derived/ │   │components│
   └────┬────┘    └────┬─────┘    └──────────┘   └────┬────┘
        │              │                              │
        └──────────────┴──────────────────────────────┘
                       │  props 进 / 事件出
                       ▼
                 （无反向 import）
```

| 不变量 | 判卷落点 | 怎么造红 |
|---|---|---|
| **I1** `components/` 与 `panes/` 不得 import `App.tsx` | `scripts/renderer-layer-check.ts` | 在 `panes/` 里加一行 `import { App } from "../App"` ⇒ 门红并点名 file:line |
| **I2** `state/` 下的 hook 不得 import 任何 `components/` | 同上 | 在 `state/useChrome.ts` 里 import `components/Sidebar` ⇒ 红 |
| **I3** `derived/` 下的函数必须纯（同输入同输出、无 IO、无 `Date.now`/random） | 同上（静态扫 `derived/**` 的文本与 import 面） | 在 `derived/run.ts` 里插一行 `Date.now()` ⇒ 红 |
| **I4** 单文件行数上限 | 同上 | 把某文件撑过上限 ⇒ 红 |

**行数上限选 1,200（+ App.tsx 900），理由**：
- 1,200 刚好高于现读第二大的 renderer 模块（`components/PaneDock.tsx` = 1,194）⇒ 这道门**逼 `App.tsx` 这个单体必须拆**，却不会顺手逼本轮不相关的模块一起拆；
- `App.tsx` 单列 900：现读 3,524，其中约 790 是 JSX 返回 ⇒ 抽走 `state/` 与 `panes/` 之后的余量是「组合 + 接线」，落在 900 以内是守得住的；
- 阶梯写进文档：**1,200 → 900 → 600**，每一档一��。本轮只到 900；600 是下一轮的事（`PaneDock` / `Composer` / `Sidebar` / `AppPage` / `settings-sections` 各自再拆一批）。

---

## 3. 每批次：改哪些文件、动线是几行、验收判据、回退手段

### 批次 1 — 读路径改造（`apps/desktop/tests/helpers/app-surface.ts`）

- **改哪些**：新增 1 个 helper；**改 67 个判卷文件的「读哪个文件」那一行**。
- **动线**：新增 `readAppSurface()` = `App.tsx` 在前 + `state/` `derived/` `panes/` `components/` + 其余顶层 renderer 文件（按路径排序，顺序稳定）。判卷文件把 `readFileSync(.../App.tsx)` 换成 `readAppSurface()`。
- **验收判据**：桌面判卷仍是 **1 失败（环境债）/ 1,316 通过**；**没有一条断言文本被改过**（可 diff 证明）。
- **为什么先做**：源码文本断言有正有负。负断言（`not.toContain`）在代码搬走后会**空过**——那是**变弱**，本仓明令禁止。读路径先改，负断言才继续盯着它要盯的地方。
- **回退**：删掉 helper，把 67 个文件那一行改回去（`git diff` 里只有那一行）。

### 批次 2 — `derived/` 纯投影层

- **改哪些**：新增 `derived/*.ts`；`projections.ts` 变成只做再导出的桶。
- **动线**：逐个导出函数**审纯度**：无时钟、无随机、无 IO 的搬进 `derived/`；内部读 `Date.now()` 的**留在原地**并在报告里点名（`elapsedSecondsFor` 一类已经是「时钟由调用方传入」的纯形状）。
- **验收判据**：导出面**逐名不变** ⇒ 15 个 renderer 模块 + 17 个判卷文件**零改动**；纯度门绿。
- **回退**：`derived/` 目录删除 + `projections.ts` 还原。

### 批次 3 — `state/` 状态簇

- **改哪些**：新增 `state/use{Chrome,Overlays,ComposerDrafts,RunLifecycle}.ts`；`App.tsx` 改成解构这些 hook 的返回值。
- **动线**：**按声明整段搬**，能逐字保留的逐字保留（`session-stream-isolation.test.ts` 按 `}, [` 切源文本、多数判卷按声明头切）。
- **验收判据**：桌面判卷读数不变；`state/**` 不 import `components/**`（I2）。
- **回退**：新目录删除 + `App.tsx` 还原。

### 批次 4 — `panes/` 视图层

- **改哪些**：新增 `panes/*.tsx`。
- **动线**：props 进 / 事件出；**不引入新的状态容器**。
- **验收判据**：桌面判卷读数不变；`panes/**` 不 import `App.tsx`（I1）；main 路由**不变大**。
- **回退**：新目录删除 + `App.tsx` 还原。

### 批次 5 — 门与账

- **改哪些**：`scripts/renderer-layer-check.ts`、`tests/renderer-layer.test.ts`；`package.json` 与 `scripts/gate-manifest.ts` 的登记。
- **验收判据**：四条不变量各自**先红后绿**；`pnpm gates` 无孤儿门。

---

## 4. 体积影响预估与实测口径

- **预估**：拆 `App.tsx` 本身**不改变** main 路由的依赖闭包（所有 import 仍在同一 chunk 内），所以 main 应**持平或略降**（去掉重复的类型擦除与被摇掉的死代码）。**风险不在体积，在「拆分把某个模块从 lazy 变成 eager」**——本轮不做这件事。
- **实测口径**：每批次跑
  `pnpm --filter cairn-desktop exec node scripts/bundle-audit.mjs outputs/bundle-phase2.json`
  三个数（initial / main / popout）与基线比；**不许调 `CAIRN_BUNDLE_*_BUDGET_BYTES` 上限**来让审计变绿。
- **基线**：160,685 / 538,102 / 376,021（上限 800,000 / 600,000 / 400,000）。

---

## 5. 与盘上的差异（如实记录）

1. **HEAD 不符**：提示词写 `d0708a0`；现读 `d0708a0`（执行期间另一会话落库两笔）。已在新 HEAD 上**重跑基线**，数字见 §0。
2. **脏项不符**：提示词列的 `styles.css`（已修改）与 `micro-interaction.test.ts`（未跟踪）在现读时**已不在脏集**；现读脏项是 `ab.py`、另一会话的 `apps/desktop/scripts/zindex-map.mjs`，以及本轮生成的 `apps/desktop/outputs/`。⇒ **不碰 `styles.css` 的理由由「他人脏改动」改为「Phase 4 才动它」**。
3. **判卷计数不符**：提示词写桌面 189 文件 / 1,306 用例；现读 **191 文件 / 1,317 用例**（含 1 条环境债失败）。以盘上为准。
4. **体积数字微差**：提示词写 main 538,062 / popout 375,981；现读 **538,102 / 376,021**（差 40 B，为另一会话那笔 memo 边界提交）。以盘上为准。
5. **另一会话在飞**：本轮全程有别的会话在同一棵树上落库。**每一批交付都要重新 `git status --short` 比对**，本轮只认自己改的文件。

---

## 6. 范围边界（明确排除）

- 不碰 `src/` 核心的 agent 语义（Phase 1 只在 **G2 明确要求**的事件种类/字段/会话模型上动，且**只增不改**）。
- 不改 `dsh-refs/`、`pel-runs/`、仓外台账。
- 不做登录/同步/多端；**不引入新的运行时依赖**（本轮零新依赖）。
- 不提交。全部证据覆盖**工作树**，不是任何提交；`pnpm mutate-verify` / `pnpm head-cert-check` 量的是提交，**本轮不适用**，不许当本轮证据引用。
