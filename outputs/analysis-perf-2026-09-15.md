> **⚠️ 存档（2026-09-19 入库时追注，正文一字未改）**：本文基于 HEAD `5e8a10b` 的带日期快照，
> 其中最高价值的一条（事件落盘「每事件 open+write+close」= **1,930 µs/事件**）已实施：
> 常驻 `FileHandle` 方案现仍在 `src/events/index.ts`（复跑：`grep -n "LOG_HANDLE_MAX\|resolveHandleInner" src/events/index.ts`）。
> 其余按 20 条清单排期的项**未全部落地**，引用前先复跑；规模计数也已漂移——
> 文中「`src/**` = **129 文件 / 26,349 行**」今日实测 **95 文件 / 23,495 行**（React 树删除后缩水）；
> **现权威两面**：意图 = `agent-plan.md` §10.1；事实 = `docs/ui-fact-baseline.md`（每项配复跑命令）。

# DSH（deepseek harness）性能 / 资源 / 代码质量三维分析报告

- 仓库：`/Users/ze/Downloads/deepseek harness`，分支 `codex/dsh-structural-hardening`，HEAD `5e8a10b`（工作树有未提交改动，见 §0.2）
- 方式：**纯只读**静态分析（Read / Grep / Glob / wc），未修改任何 `src` 代码；未运行测试与门禁
- 规模实测：`src/**/*.{ts,tsx}` = **129 文件 / 26,349 行**；另有运行时渲染层 `src/renderer/app.js`（2,034 行 / 94KB）+ `src/renderer/index.html`（1,670 行 / 105KB）
- 本文所有条目均带 `file:line` 或实测计数；**凡推断而非实测的，显式标注「待证」**

---

## 0. 方法与范围

### 0.1 热点文件实测行数（`wc -l`）

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/agent/orchestrator.ts` | **2812** | spawn / 审批 / 取消 / pipeline / supervise / race / worktree 合并 / 卡死检测 / worker 工具表 / 安全流水 |
| `src/main/agent-runner.ts` | **1793** | Electron 主进程全部 IPC handler + run 装配 + sidechat + 调度 + 记忆快照 |
| `src/renderer/panels/registry.tsx` | **1281** | React 面板注册表（**当前运行时未引用**，见 §2.2） |
| `src/main/scheduler.ts` | 934 | 定时任务双轨存储 + 准入管线 |
| `src/renderer/components/ui/sidebar.tsx` | 700 | shadcn 生成组件 |
| `src/agent/compaction.ts` | 613 | 压缩切点 / 序列化 / 摘要器 |
| `src/events/index.ts` | 602 | JSONL 事件流 + 重放 + 增量重放 |
| `src/renderer/projections.ts` | 591 | 面板投影纯函数（**运行时未引用**） |
| `src/tools/lsp.ts` | 547 | LSP 子进程 / 会话复用 / 诊断回流 |
| `src/agent/sidechat.ts` | 462 | 旁路会话 |
| `src/agent/glm-session.ts` | 426 | 暗卷会话型 provider（每轮组装点） |

### 0.2 工作树状态（影响解读，重要）

`git status --short` 实测：

```
 M src/renderer/index.html
 D src/renderer/main.tsx
 D src/renderer/styles.css
 D src/renderer/error-boundary.tsx
?? src/renderer/app.js
?? src/renderer/window.d.ts
?? src/agent/impact/          ← M7 新模块
?? fixtures/impact/
?? proto/
```

即：**渲染层正在从 React 迁移到原生 JS 原型**（`index.html` 内联 CSS + `app.js` IIFE，`app.js:1643-1649` 自述「真实数据桥接（Electron renderer：window.agent 存在时启用，主 UI 以原型为准）」）。这不是本次分析引入的状态，但它决定了 §2.2 / P1-3 的解读——**该迁移归属需主理人裁决**。

### 0.3 全仓度量基线（Grep 实测）

| 指标 | 实测值 | 解读 |
|---|---|---|
| `as any` | **0** | 类型纪律良好 |
| `: any` | **0** | 同上 |
| `@ts-ignore` / `@ts-expect-error` | **0** | 无静默逃逸 |
| `as unknown as` | 18（11 文件） | 集中在 `agent-runner.ts`(5)、`plugins/mcp.ts`(3)、`map/parse.ts`(2) |
| `as never` | 8 | `orchestrator.ts` 工具表 / `loop.ts` allowedTools 类型窄化 |
| `TODO` / `FIXME` / `HACK` | **0** | 无遗留标记（注释即文档风格） |
| `readFileSync` 等同步 IO | 10 处 / 7 文件 | 见 P0-3、P2-11 |
| `JSON.parse` | 48 处 / 30 文件 | 逐行解析重复实现见 P2-1 |
| `setInterval` / `setTimeout` | 46 处 | 定时器清理面见 §3.2 |
| `addEventListener` / `.on(` | ~136 处 | `app.js` 76 处（0 处 remove） |
| `await replay(` | 18 处 | 全量读盘调用点，见 P0-2 / P1-4 |

---

## 1. 总评

1. **代码卫生度高，结构债集中**：`any`/`@ts-ignore`/`TODO` 全零，事件流 append-only + 投影纯函数 + 单事实源的架构纪律执行得很彻底；问题不在「脏」，在**单文件体量与重复实现**——`orchestrator.ts` 一个文件同时承担 11 类职责。
2. **延迟热点是「每轮 O(n) 全量重算」而非单点慢函数**：上下文组装、token 校准、记忆注入预算三个 O(n) 级重算在每轮/每次工具调用上叠加，会话越长越慢（§3.1 P0-1、P1-1）。
3. **资源风险是「进程级 Map 无淘汰」**：`callIdIndexCache`、LSP `openDocs`、scheduler 内存 journal 三处无上限，长时运行（桌面 app 常驻）单调增长（§3.3）。
4. **渲染层存在约 5,000 行运行时死代码**（React 面板树被原型替换，仅测试与 check 脚本引用），是当前最大的可维护性负债（§2.2）。
5. **无 P0 级功能正确性缺陷**；P0 全部是「长会话/长运行下退化」的性能与阻塞项。

---

## 2. 维度一 · 代码质量

### 2.1 超大文件与单一职责失衡

`orchestrator.ts`（2812 行）内部至少混装 11 类职责，可按下述**已存在的天然边界**拆分（每块都是自洽的，不需要重写逻辑）：

| 目标文件 | 迁出成员（现行号） | 说明 |
|---|---|---|
| `agent/worker-tools.ts` | `workerToolSpecs`(292)、`shell_ro`(203)、`shell_rw`(274)、`isReadOnlyShellCommand`(188)、`checkShellSegment`(168)、`flagViolation`(145)、`interceptDestructiveGit`(238)、`gitInvocation`(228)、`buildWorkerToolTable`(2632)、`filterWorkerTable`(2370)、`filterWorkerSpecs`(2387)、`gatedWorkerTool`(2699) | 纯工具面，零编排状态 |
| `agent/glob.ts` | `globIntersects`(2455)、`matchesGlob`(2462)、`globToRegExp`(2472) | 与 `tools/glob.ts` 同类语义（见 P2-3） |
| `agent/approval.ts` | `waitForApproval`(1191)、`requestSpawnApproval`(1204)、`requestChainApproval`(1545)、`requestSuperviseApproval`(1516)、`requestWorkerApproval`(2329)、`decideWorkerApproval`(1267)、`pendingApprovalIds`(1280) + `approvalOwners`(448) | 审批协议一族 |
| `agent/spawn.ts` | `spawn`(739)、`spawnInternal`(925)、`spawnReserved`(949)、`leaseConflicts`(1172)、`respawn`(791)、`nextAgentId`(457) + `agentOwners`(447) | spawn 生命周期 |
| `agent/pipeline.ts` | `spawnPipeline`(1292)、`runChain`(1568)、`failChain`(1648)、`emitSequencerStatus`(1664)、`resolveStageRole`(1674)、`spawnSupervise`(1341)、`spawnRace`(809)、`resolveDependents`(1699)、`triggerDeferredSpawn`(1719)、`waitForAgentTerminal`(1744)、`resolveTerminalWaiters`(1756) | 编排/依赖链 |
| `agent/stuck.ts`（已存在，迁入编排侧） | `armStuckSilence`(1802)、`triggerStuck`(1815)、`evaluateStuck`(1829)、`recordStuckTurn`(1841)、`resumeAgent`(1766)、`stuckGate`(1780) | 现纯函数在 `stuck.ts`，编排侧却留在 orchestrator |
| `agent/merge.ts` | `mergeWorker`(2213)、`rejectWorker`(2267)、`cleanupWrite`(2190) + `mergeOwners`(451) | worktree 合并控制塔 |

拆分后 `orchestrator.ts` 预计剩 ~400 行（`Orchestrator` 类骨架 + `WorkerHandle` 类型 + `finishInner`），`WorkerHandle` 接口（517-578）需随 `worker-tools` 一起下沉或用 `Pick<>` 收窄（现 `filterWorkerTable` 已用 `Pick<>`，先例可循）。

> 风险：拆分会动 `agentOwners`/`approvalOwners`/`mergeOwners` 三个模块级 Map 的归属——它们必须与 `Orchestrator` 实例同模块或经显式注册表导出，否则 `orchestratorForAgent` 等跨编排器路由（461-472）会断。**建议按上表逐个文件小步搬，每步跑 `pnpm gates`**，不要一次拆完。

### 2.2 运行时死代码：约 5,000 行 React 渲染树（实测）

`src/renderer/` 下 React 模块**不被任何运行时源码 import**，只被 `tests/` 与 `scripts/*-check.ts` 引用：

```
grep -rn "panels/registry|cards/registry" src tests scripts
→ 命中仅 tests/sidechat.test.ts:9-10、tests/panels.test.ts:5、tests/cards.test.ts:4
→ src/ 内零运行时命中（唯一 src 命中是 panels/registry.tsx:18 自引用 cards/registry）

grep -rn "renderer/projections" → 命中 tests/*(4)、scripts/*-check.ts(4)、src/renderer/{store.ts,cards/*,panels/registry.tsx}
   ——而 store.ts / cards / panels 自身也是运行时死代码
```

即被原型 `app.js` 取代的整棵 React 树仍在仓库里：`panels/registry.tsx`(1281) + `cards/*`(7 文件) + `components/ui/*`(30+ 文件) + `projections.ts`(591) + `store.ts` + `conversation.tsx` + `onboarding.tsx` + `theme.ts`。

**这不是简单删除就能了事**：`projections.ts` 是 `panels-check` / `agents-check` / `sidechat-check` 的断言面（`scripts/agents-check.ts:26`、`scripts/panels-check.ts:12`、`scripts/sidechat-check.ts:25`），删它 = 删门禁判据。正确路径二选一：
- (A) 原型确认为正式 UI → 把 `projections.ts` 降级为「纯投影库（被 check 引用）」保留，删除 `panels/`、`cards/`、`components/ui/`、`store.ts`、`conversation.tsx`、`onboarding.tsx`、`theme.ts`，并把 `tests/{panels,cards,sidechat}.test.ts` 的断言迁到投影库；
- (B) 原型只是预览 → 恢复 `main.tsx` 入口，`app.js` 移入 `proto/`。

**待主理人裁决（本次分析不预设结论）**。

### 2.3 重复实现（同类解析/校验/序列化多份）

| 重复面 | 位置 | 份数 |
|---|---|---|
| JSONL「逐行 trim → JSON.parse → 过滤」 | `events/index.ts:446`、`events/index.ts:528`、`events/index.ts:553`、`orchestrator.ts:2517`、`agent-runner.ts:1627`、`scheduler.ts:165`、`gym/runner.ts:39`、`providers/mock.ts:26` | **8** |
| 半行/字节偏移推进（append-only 尾部读） | `events/index.ts:514-567`（`replayIncrementalInner`）与 `orchestrator.ts:2504-2539`（`advanceCallIdIndex`）逻辑近乎逐字同构（都是 ino/offset/parts.pop/consumed 累加） | 2 |
| glob → RegExp 匹配 | `orchestrator.ts:2472-2493`（内联 `globToRegExp`）vs `tools/glob.ts`（走 rg 通配） | 2 |
| 「agent 状态 → 徽标」映射 | `projections.ts:563`（唯一实现）已被抽出，但原型 `app.js` 又写了一份状态→CSS class 映射 | 2（待证：app.js 侧语义是否等价） |
| 工具输出截断（32KB + 截断提示） | `lsp.ts:474-478`、`glob.ts`（32MB 上限）、`run_shell.ts`、`read_file.ts` 各写各的 | ≥4 |
| `resolveSafeMode` / settings 惰性单例 / 环境变量读取 | `agent-runner.ts:497`、`agent-runner.ts:1446`、`orchestrator.ts` 多处 `process.env.M0_API_KEY` | — |

### 2.4 耦合与依赖方向

- **无 3 级相对路径**：`from "../../.."` 命中 **0**；2 级 `../../` 命中 23 处（正常）。
- **依赖方向干净**：`events` → 无业务依赖；`agent/*` → `events`/`providers`/`tools`/`permissions`；`main/*` → `agent/*`。未发现反向 import（`agent` 不 import `main`）。
- **但 `main/agent-runner.ts` 是超级扇入点**：它同时 import `agent/`(13 个模块) + `main/`(10 个) + `permissions/` + `tools/` + `providers/` + `plugins/`（`agent-runner.ts:5-112`，**108 行 import 块**）。任何模块改签名都会打到它；且 `index.ts` 从它 import 38 个符号（`main/index.ts:9-51`）。建议把「run 装配」与「IPC handler」拆成 `agent-run` / `ipc-handlers` 两个文件。
- **模块级可变单例**：`session` / `activeOrchestrator` / `interactiveRunAbort` / `lastLogPath` / `lastWorkspace` / `scheduler` / `settingsStore` / `sandboxState` / `installed`（`agent-runner.ts:142-159, 515, 586, 1439, 770`）。`RunScope`(ALS, 170-182) 只隔离了 `session`/`orchestrator` 两项，注释自述其余仍是共享面。这是「机制完备但边界未收口」的典型，新增并发路径（定时任务 + 交互 run 同工作区）时会踩（`agent-runner.ts:161-169` 已备案）。

### 2.5 类型安全

`any` / `@ts-ignore` 全零是硬成绩。残留的窄化点集中在三处，均为「跨层边界」：
- `as unknown as Record<string, Tool>` 把 `TOOLS` 静态表当可变注册表注入（`agent-runner.ts:364, 547, 564, 673, 1069`）——运行时注入 9+ 工具，类型系统看不见。建议改为显式 `ToolRegistry` 类型 + `Object.assign` 的受控出口。
- `Record<string, unknown>` 参数解析（`parseWorkerContext` 2443、`parseStringList` 2438、`handleCardAction` 1150）——**这些是安全边界**，已经写得比多数项目严（fail-closed + 形状校验），保持即可。
- `as never` 8 处（`evaluate(name as never, ...)` 2703、`allowedTools as never` 1909）——类型窄化借道，可读性差，建议给 `evaluate` 一个 `string` 重载。

---

## 3. 维度二 · 响应延迟热点 & 维度三 · 资源消耗

### 3.1 延迟热点（含实测）

**H1 · 每轮全量投影 → 会话内 O(n²)**
`projectContext(events)`（`context.ts:54-131`，遍历全部事件）+ `calibrateFactor(events)`（`compaction.ts:48-67`，遍历全部事件且对每个 `tool_call` 做 `JSON.stringify(e.args)`）。调用点：

| 调用点 | 频率 |
|---|---|
| `loop.ts:79` `projectContext(seen)` | 主会话每轮一次 |
| `orchestrator.ts:2760-2766` `calibrateFactor` + `projectContext` | **worker 每轮**（B9 注释自述「每轮只投影一次」，但仍是 O(n)/轮） |
| `glm-session.ts:318-327` `replayIncremental` + `computePrune` + `projectContext` | 暗卷主会话每轮 |
| `sidechat.ts:243` `projectContext(own)` | sidechat 每轮 |

`replayIncremental` 已把**读盘**降为增量（`events/index.ts:503-567`，审查 A5 成果，值得肯定），但**投影仍是全量**——`events/index.ts:483` 自述「投影本身仍是每轮全量（O(n)），增量折叠……留位第三批」。以本 agent 的事件密度（每次工具调用产生 `tool_call`+`tool_result`+`usage`，流式再叠加 `assistant_delta`），长会话 5,000+ 事件、100+ 轮是常态 → 累计约 25 万次事件访问 + 每次 `calibrateFactor` 对全部 tool_call 做 `JSON.stringify`。**这是全仓最大的延迟放大器**（P0-1）。

**H2 · `agent:state` 是 IO 风暴**
`handleAgentState`（`agent-runner.ts:1319-1368`）每次被 UI 调用都会：
1. `memorySnapshot()` → `memoryLayerSnapshot` ×2（项目层 + 全局层），每层：`loadExternalRefState()` 读盘 + 读 `MEMORY.md` + `listTopics` **串行**读每个 topic 文件 + 项目层再串行读根三文件 + 对全部文本跑 `extractExternalRefs`（`agent-runner.ts:1283-1308`）；
2. `scanOrphanWorktrees()` → **全量 `replay(lastLogPath)`**（`agent-runner.ts:1371-1379`）；
3. `handleSidechatState()` → `listSidechatSessions` + **串行**逐个 `readSidechatEvents`（全量读每个 sidechat 文件）+ 全量 `readSessionEvents` 读主会话（`agent-runner.ts:1716-1762`）；
4. `handleScheduleSnapshot()` → `scheduler.snapshot()`（`scheduler.ts:828-876`，遍历全部 journal 条目）；
5. `handleLicenseStatus()` + `handleProviderKeyStatus()` 各自读盘。

全是 `await` 串行。**UI 轮询 = 每轮一次「全量 replay + 全量记忆读 + 全量 sidechat 读」**（P0-2）。

**H3 · LSP 配置同步读盘进最热工具路径**
`loadLspConfig` 用 `readFileSync`（`lsp.ts:50-57`），而它被 `prefetchLsp`（`lsp.ts:373-379`）调用——`prefetchLsp` 在**每次 `read_file` 命中源码后缀时**被触发（`lsp.ts:372` 注释「read 命中源码文件时的后台预热」）。即：最常见的工具调用 → 一次同步磁盘读 + JSON.parse，阻塞事件循环；且 `lsp` 工具每次调用也读一次（`lsp.ts:488`）。`openFile` 另有 `readFileSync(absPath)`（`lsp.ts:157`）在文件未显式传 text 时同步读全文（P0-3）。

**H4 · `spawnRace` 25ms 全量 replay 轮询**
`orchestrator.ts:851-872`：`while (Date.now() < deadline) { const log = await replay(this.opts.logPath)…; await sleep(25); }`——**每 25ms 重读并重新解析整个会话 JSONL**，最长 120s（`raceDeadlineMs`）→ 最坏 4,800 次全量解析。审查 S2-8/S2-9 修了「空转」与「漏杀」，但轮询式读取本身未改（P1-4）。同一文件已有 `replayIncremental` 与 `waitForAgentTerminal`（事件驱动，1744）可用——race 完全可以用「等 k 个 terminal 事件」替代轮询。

**H5 · 地图/影响面每次构建都全量扫盘**
`createMapBuilder.build`（`map/build.ts:190-209`）先 `scanSourceFiles`（spawn `rg --files` + 对每个文件 `await stat`，`map/build.ts:35-75`）**再**查渲染缓存——即命中缓存时省掉了 parse，但**没省掉 rg 子进程 + N 次 stat**。`buildImpact` 更彻底：完全无内存图缓存，每次 `fileImpact` 都重跑 `scanSourceFiles` + 重建全部边（`impact/index.ts:110-152, 250-257`）。

**H6 · prune 已优化，但仍有残余**
`computePrune` 的 O(n²) 已修（`prune.ts:147-150` 预建索引，审查成果）。残余在 `compaction.ts:258-262`：`for (guard<1000) { ctx.units.find(...) }` —— 每次 `find` 是 O(units)，最坏 1000×units。可用指针/二分替代（`keepFirstSet:190-201` 已有二分先例）。

### 3.2 定时器与监听器

| 类别 | 实测 | 结论 |
|---|---|---|
| Abort 监听 | 注册 6 处 / 摘除 6 处（`orchestrator.ts:1100↔2115`、`1786↔1797`、`ask-gate.ts:97↔73`、`gates.ts:38↔26`、`run_shell.ts:66↔71`） | **成对，无泄漏** |
| `setInterval`/`setTimeout` | 46 处；`clear*` 覆盖 scheduler（`scheduler.ts:488-491`）、lsp（`lsp.ts:128, 190, 216, 227`）、glob/ripgrep（超时击杀）、app.js（自清） | 未见明显未清理；`orchestrator.ts:1811` 用 `t.unref?.()` 防拽进程退出（好实践） |
| 子进程 | `will-quit` 统一 `killAllTrackedChildren()` + `closeAllLspClients()`（`main/index.ts:339-346`） | 收口正确（审查 D8/S2 成果） |
| `app.js` 监听器 | `addEventListener` **76** 处 / `removeEventListener` **0** 处 | 单页静态 DOM 可接受，但「初始转录可被整体替换」+ 委托模式混用（`app.js:1602` 注释自述「直接绑定会失效」）→ 每次替换转录后旧监听随节点 GC，风险低但**无显式生命周期**（P2-9） |

### 3.3 内存增长

| 结构 | 位置 | 上限 | 判定 |
|---|---|---|---|
| `replayCache` | `events/index.ts:484-485` | 32（LRU 淘汰首个） | ✅ 有界 |
| `replayChain` / `callIdIndexChain` / `journalChain` / `writeChains` | `events:501`、`orchestrator:2502`、`scheduler:115`、`store:155` | 无并发即回收 | ✅ 有界 |
| `callIdIndexCache` | `orchestrator.ts:2498` | **无上限，且从不淘汰** | ❌ 每个访问过的会话日志路径留一条 `Map<callId,行号>`；进程内开过的会话越多越大（P2-2） |
| LSP `openDocs` / `latestDiags` | `lsp.ts:109-111` | **无上限** | ❌ 每个 didOpen 过的文件**全文**常驻（`openDocs.set(uri,{version,text})`）；长会话读 500 个文件 = 500 份全文（P1-5） |
| LSP `clients` / `broken` | `lsp.ts:99-100` | 无上限 | ⚠️ 条目少（按 (root,server)），可接受 |
| `scheduler.journalKeys` / `journalByTask` | `scheduler.ts:415, 418` | **内存无界** | ❌ 磁盘 journal 有 D7 收敛（`compactJournalIfLarge` 只截文件，`scheduler.ts:142-153`），**内存 `journalByTask`/`journalKeys` 从不同步收缩**（`pushJournalEntry:676-686` 只 push）→ 1min tick × 常驻 app，长期单调增长（P1-9） |
| `scheduler.completions` | `scheduler.ts:420, 776` | 无界 | ❌ 每个 occurrence 一条，从不删（P1-9 同族） |
| `scheduler.termCache` | `scheduler.ts:422` | 512（淘汰首个） | ✅ 有界 |
| `orchestrator.diffVersions` | `orchestrator.ts:656, 2124-2128` | 无界（每 agent 一条 number） | ⚠️ 增长极慢，P2-8 |
| `orchestrator.workers` | `orchestrator.ts:646` | 按设计保留终态 handle（路由需要，2108-2112 注释） | ⚠️ `releaseWorkerMemory` 已裁 `w.events`，但 `w.snapshots`/`w.editAnchors` 是**写前全文快照**（540-542），仅在 read worker 或 write 过合并决策点时才裁（2118-2120）——write worker 若停在「待合并」，每个 worker 留全部改过文件的改前全文（P1-5 同族） |
| `langCache`/`queryCache` | `map/parse.ts:45, 106` | 按语言（4 种） | ✅ |
| `agent-runner` 模块级 `session`/`activeOrchestrator` | `agent-runner.ts:142, 155` | 单例 | ⚠️ `activeOrchestrator` 在 run 收束后**刻意不清空**（153-154 注释，审批路由需要）→ 每个会话保留一个完整 Orchestrator（含 workers Map）。会话切换频繁时累积（P2-12，待证：是否有切换即替换） |

### 3.4 渲染层

- `app.js` `render()` 被 20 处调用（含**每次搜索输入** `app.js:468` `input → render()`），而 `render()` 里 `sessionList.innerHTML = html`（`app.js:208`）**整块重建侧栏 DOM**。逐键重建 = 输入抖动 + 焦点/滚动位置丢失（P1-8）。
- 全文件 `innerHTML` **30** 处；无虚拟列表（`react-virtuoso` 在 `package.json` 但属 React 死树）。长转录下每次事件追加都走 `innerHTML`/`insertAdjacentHTML`（`app.js:1713, 1752` 等）。
- `index.html` 105KB 内联 CSS（1,670 行里绝大部分是样式），dev 下每次改动无法被 vite 增量处理；`AGENTS.md:34` 已备案 CSP 需 `unsafe-inline`。
- 流式「打字机」用 `setInterval(24ms)`（`app.js:992`、`1107`）逐字 `textContent` 更新，每 6 字 `scrollStream()`——**每 24ms 一次强制布局**（P2-9）。

---

## 4. 维度四 · 分级优化清单（交付物主体）

> 每条：编号 · 标题 | 严重度 | 位置 | 现状（实测） | 优化手法 | 预期收益 | 风险 | 工作量

### P0（长会话/长运行退化，建议本轮排期）

**P0-1 · 上下文组装每轮全量重算（会话内 O(n²)）** | P0 | `orchestrator.ts:2759-2767`、`glm-session.ts:316-327`、`loop.ts:79`、`sidechat.ts:243`
- 现状：`replayIncremental` 已增量读盘，但 `projectContext(events)` 与 `calibrateFactor(events)` 每轮仍遍历全部事件（`context.ts:84`、`compaction.ts:52`）；`calibrateFactor` 还对每个 `tool_call` 做 `JSON.stringify(e.args)`。4 处调用点 × 每轮。
- 手法（小步）：① 先给 `projectContext` 加**投影缓存**：以 `(events.length, 最新 compaction 事件 id, replacements 引用)` 为键缓存上次结果，命中即复用（无 compaction、无 prune 变化时投影结果按定义不变，因为投影是纯函数）；② `calibrateFactor` 改为**增量累计**（缓存 `{chars, tokens, pending}` 三元组 + 已消费事件数，只处理尾部新增）；③ worker provider 每轮已 `readEvents()` 一次，缓存可直接挂在 `WorkerHandle` 上。
- 收益：主/worker/sidechat 三路径每轮 O(n)→O(Δn)；长会话（5k 事件）延迟预期降一个数量级。**待证：需实测 n=1000/5000 事件下的组装耗时基线**。
- 风险：缓存失效条件必须覆盖 compaction 追加（`compaction` 会改写 excludedIds/summary_offset，使历史投影整体失效）——这正是 `events/index.ts:483` 自述「增量折叠需显式失效语义」的原因。**建议先只做 `calibrateFactor` 增量（无失效语义问题），再做投影缓存**。
- 工作量：M

**P0-2 · `agent:state` 每次调用 = 全量 replay + 串行 IO 风暴** | P0 | `agent-runner.ts:1319-1368`（含 `1283-1308`、`1371-1379`、`1716-1762`）
- 现状：一次 `handleAgentState` 触发 ≥7 个串行 `await` 块，其中 `scanOrphanWorktrees` **全量 `replay(lastLogPath)`**（1375）、`memoryLayerSnapshot` 串行读全部 topic（1290-1293）+ 全部文本跑正则（1301）、`handleSidechatState` 串行读每个 sidechat 文件（1722-1728）。
- 手法：① `scanOrphanWorktrees` 改用 `replayIncremental`（已有 API）并**按 mtime 缓存结果**（worktree 目录 mtime + 日志 size 为键）；② `memoryLayerSnapshot` 的 topic 读取改 `Promise.all`（互相独立）；③ `handleSidechatState` 的 per-session 读取改 `Promise.all`；④ 给整个 state 快照加 **300ms 去抖缓存**（UI 轮询下同一秒内重复请求复用）。
- 收益：UI 轮询单次耗时预期下降 5–20×（取决于 topic/sidechat 数量）。**待证：需实测 topic 数 × 单次读盘耗时**。
- 风险：缓存引入「状态陈旧」——用短 TTL（300ms）+ 事件驱动失效（`hooks.onEvent` 时清缓存）控制。
- 工作量：S–M

**P0-3 · LSP 配置/文件同步读盘在最热路径** | P0 | `lsp.ts:50-57`（`readFileSync`）、`lsp.ts:373-379`（`prefetchLsp`）、`lsp.ts:155-157`（`openFile` 的 `readFileSync`）、调用点 `lsp.ts:372`
- 现状：`read_file` 每读一个源码文件 → `prefetchLsp` → `loadLspConfig` → **`readFileSync` + JSON.parse 阻塞事件循环**；`lsp` 工具每次调用再读一次（488）；`openFile` 未传 text 时再同步读全文（157）。
- 手法：① `loadLspConfig` 改 async `readFile`，或（更好）加进程内 `Map<workspace, LspConfig>` 缓存 + 以 `.agent/lsp.json` 的 `mtime` 失效；② `prefetchLsp` 里配置读取走缓存，失败静默（它本就是 best-effort，372 注释）；③ `openFile` 统一由调用方传 text（`collectDiagnostics:359` 已 async 读好了，但 `lsp.ts:515` 的 `client.openFile(abs)` 没传）。
- 收益：消除最常见的工具调用路径上的同步磁盘 IO；`read_file` 响应不再受语言服务器配置读盘影响。
- 风险：缓存需覆盖「用户改 `.agent/lsp.json` 后不重启」——用 mtime 失效即可。
- 工作量：S

### P1（结构性 / 显著）

**P1-1 · 记忆注入预算循环 O(L²)** | P1 | `src/agent/memory/inject.ts:192-198`
- 现状：`while (estimateTokens(totalChars(),1) > charsLimit) { const ordered = [...flatten(projectSections), ...flatten(globalSections)]; victim.sec.lines.splice(...); }`——**每轮循环重算 `totalChars()`（O(sections)）并重建 `flatten` 数组（O(总行数)），而每轮只删 1 行**。L = 记忆总行数（ARCHITECTURE ≤4KB 大纲 + DECISIONS 20 条 + 两个 MEMORY.md 索引，可达数百至数千行）→ 最坏 L² ≈ 10⁶ 次操作。且 `buildMemoryInjection` 每轮被主会话、每个 worker（`orchestrator.ts:2597`）、sidechat（`sidechat.ts:255`）各调一次。
- 手法：一次 `flatten` 建索引数组 + 维护累计 `chars` 游标，按序删行并从累计值里减（O(L)）；`totalChars` 只算一次 + 增量维护。
- 收益：该函数从 O(L²) 降到 O(L)；记忆体量越大收益越明显（L=1000 时约 1000×）。
- 风险：低（纯函数，语义等价）；建议补一条「删行顺序 = 项目 ARCH → DECISIONS → 项目索引 → 全局索引」的单测锁行为。
- 工作量：S

**P1-2 · `orchestrator.ts` 2812 行 God Object** | P1 | `src/agent/orchestrator.ts` 全文件（拆分表见 §2.1）
- 现状：11 类职责同文件，`import` 块 77 行，模块级 3 个 Map + 1 个全局计数器。
- 手法：按 §2.1 表**逐块搬**，每块独立成文件、每步跑门禁。
- 收益：可维护性 / 可测试性显著提升；`worker-tools` / `glob` / `approval` 三块可被单测直接覆盖（现只能经 `Orchestrator` 实例）。对运行时性能**无直接收益**。
- 风险：`agentOwners`/`approvalOwners`/`mergeOwners` 归属与跨编排器路由（`orchestratorForAgent` 461）易被搬断；需保持「同一模块内导出注册函数」。**禁止一次拆完**。
- 工作量：L（可分 7 步，每步 M 以内）

**P1-3 · 约 5,000 行运行时死代码（React 渲染树）** | P1 | `src/renderer/panels/registry.tsx`(1281)、`cards/*`、`components/ui/*`、`projections.ts`(591)、`store.ts`、`conversation.tsx`、`onboarding.tsx`、`theme.ts`
- 现状：实测无运行时 import，仅 `tests/*.test.ts`(4 处) 与 `scripts/{panels,agents,sidechat}-check.ts` 引用 `projections.ts`/`panels/registry`。
- 手法：见 §2.2 的 (A)/(B) 二选一（需主理人裁决原型归属）。
- 收益：删除后 `src` 减 ~19% 行数；构建产物体积下降；消除「改一处忘改另一处」的双实现漂移风险。
- 风险：**高**——`projections.ts` 是 3 道门禁的判据来源（`scripts/panels-check.ts:12` 等），误删即红门；且迁移归属未定。
- 工作量：M（(A) 路径） / S（(B) 路径）

**P1-4 · `spawnRace` 以 25ms 全量 replay 轮询等待候选** | P1 | `orchestrator.ts:851-872`
- 现状：`while (now<deadline) { await replay(logPath); …; await sleep(25); }`，最长 120s → 最坏 ~4800 次全量读+解析整个会话 JSONL。
- 手法：改为**事件驱动**：复用现成的 `waitForAgentTerminal(agentId)`（1744）——`Promise.race(k 个 terminal promise + 一个 deadline timer)`；judge 命中即 `cancelAgent` 其余。删除轮询循环。
- 收益：竞速期间磁盘 IO 与 CPU 从「持续满负荷」降为 0（仅事件到达时唤醒）。
- 风险：`waitForAgentTerminal` 依赖 `finishInner` 的 `resolveTerminalWaiters`（1756），需确认 race 派发的 worker 走同一 finish 路径（读代码看是同一 `runWorker` → `finish`，✅）。需保留「主会话已取消」的检查（现 852）。
- 工作量：S–M

**P1-5 · LSP `openDocs`/worker `snapshots` 无界保留文件全文** | P1 | `lsp.ts:109-111, 161, 167`；`orchestrator.ts:540-542, 1074-1075, 2648-2677`
- 现状：① `LspClient.openDocs` 对每个 didOpen 过的 uri 永久保留 `{version, text}` 全文（只在内容变化时更新，从不删）——长会话读 500 个文件即 500 份全文常驻；② write worker 的 `w.snapshots`（改前全文）+ `w.editAnchors` 仅在 `releaseWorkerMemory` 的特定分支清空（`orchestrator.ts:2118-2120`），停在「待合并」的 write worker 保留全部改过文件的两个版本。
- 手法：① `openDocs` 加 LRU 上限（如 200 条）+ 超限 `didClose` 最旧 uri（LSP 协议支持）；② `snapshots` 在 `finishInner` 的 done 分支（安全流水跑完后）即清空——findings 绝对行号换算只在 `emitWorkerDiffSecurity`（2132）里用，跑完即无消费者（`w.lastFindings` 才是留存物）。
- 收益：长会话内存曲线从「随读取文件数线性增长」变为有界。
- 风险：清 `snapshots` 需确认无后续消费者（`mapFindingsToAbsolute` 只在 2135 调用）；`didClose` 后若再 hover 同文件需重新 didOpen（`openFile` 已幂等处理）。
- 工作量：S

**P1-6 · 地图/影响面每次构建都全量 `scanSourceFiles`（rg + N×stat）** | P1 | `map/build.ts:190-209`（缓存判定在扫描之后）、`map/build.ts:35-75`、`impact/index.ts:110-152`
- 现状：`createMapBuilder.build` 先 `await scanSourceFiles(...)`（spawn `rg --files` + 对每个文件 `await stat`，串行 for 循环 64-72）**再**查渲染缓存（196-209）。缓存命中只省 parse，不省 rg 子进程与 N 次 stat。`impact` 无任何内存缓存。
- 手法：① 把 `scanSourceFiles` 的 `for (const rel of rels) await stat` 改 `Promise.all`（纯 I/O，可并行；`impact` 与 `map` 共用）；② 渲染缓存命中判定提到扫描之前（用 workspace 目录 mtime 或短 TTL 近似）；③ 给 `buildImpact` 加进程内 `Map<workspace, {fingerprint, graph}>`（与 map 的 `cache` 同款）。
- 收益：map 在缓存命中时省掉一次 rg + N stat；impact 从「每次编辑全量建图」变为指纹命中即复用。
- 风险：`Promise.all` 在超大仓库可能打满 fd（可分批，如 64 并发）；缓存指纹需含文件集 mtime/size（`mapFingerprint:156-172` 已有实现可复用）。
- 工作量：S–M

**P1-7 · `fileImpact` 每次编辑全量重建影响图** | P1 | `impact/index.ts:250-257`（`fileImpact` → `buildImpact`）
- 现状：`fileImpact` 无缓存，每次调用 `buildImpact`（全量 scan + 全量 defs/refs 表 + O(refs×defs) 边构建 157-169）。`defaultImpactHook`（279）设计为 `write_file`/`edit_file` 成功后调用 → **每次编辑一次全量建图**。
- 手法：同 P1-6③（进程内图缓存 + 指纹失效）；此外 `fileImpact` 里 `graph.files.includes(normalized)`（257）与 `[...graph.defs.keys()].filter(...)`（258-260）是 O(F)/O(defs) 线性扫描，可改 `Set`/倒排索引 `Map<file, symbols[]>`（在 `buildImpact` 里顺手建）。
- 收益：编辑后影响面从「秒级全量」降到「毫秒级查询」。
- 风险：**该 hook 当前尚未接线**（实测：`defaultImpactHook`/`fileImpact`/`buildImpact` 在 `src/` 内除自身外**零引用**，仅 `tests/impact.test.ts` + `fixtures/impact/`）→ 属 M7 进行中。**建议在接线前先落图缓存**，否则接线即引入 P1 级退化。
- 工作量：M

**P1-8 · 原型 `render()` 每次全量 innerHTML 重建侧栏（含逐键输入）** | P1 | `src/renderer/app.js:208`（`sessionList.innerHTML = html`）、`app.js:468`（`input → render()`）
- 现状：`render()` 被 20 处调用，其中搜索框 `input` 事件直接 `render()`（468）→ **每次击键整块重建会话列表 DOM**；`render()` 内部多处 `innerHTML`（208、485、489、815、821）。
- 手法：① 搜索输入加 120ms 去抖；② 会话列表改为**差量更新**（按 session id 复用现有 `<li>`，只改变化的 title/time/class）或至少「重建前保存 scrollTop/焦点并恢复」；③ 静态部分（文件夹分组骨架）不参与重建。
- 收益：输入不再卡顿；列表滚动位置与焦点不再丢失。
- 风险：差量更新引入状态同步复杂度——先做去抖（S），差量化按需。
- 工作量：S（去抖） / M（差量化）

**P1-9 · scheduler 内存 journal 表与 completions 无界增长** | P1 | `scheduler.ts:415-420`（`journalKeys`/`journalByTask`/`completions`）、`676-686`（只 push）、`142-153`（只截磁盘文件）
- 现状：`compactJournalIfLarge` 只把**磁盘文件**截到 4000 条（`JOURNAL_KEEP_ENTRIES`），内存 `journalKeys`(Set) 与 `journalByTask`(Map) 只增不减；`completions` 每个 occurrence 一条、永不删。桌面 app 常驻 + 1min tick（`TICK_MS:29`）→ 长期单调增长。
- 手法：`compactJournalIfLarge` 收敛后**同步重建内存表**（把返回的 `keep` 列表回灌 `journalKeys`/`journalByTask`）；`completions` 加容量帽（如 500，淘汰最旧）——`termCache` 已有「512 + 淘汰首个」先例（906-909）可照抄。
- 收益：长时运行内存不再随运行历史线性增长。
- 风险：内存表重建时若恰有 in-flight occurrence 的 key 被截掉，`snapshot()` 的 `inflight.get` 仍能兜住（842-846 先查 inflight）——需保持该优先级。
- 工作量：S

### P2（局部优化 / 卫生）

**P2-1 · JSONL 逐行解析重复实现 8 份** | P2 | `events/index.ts:446,528,553`、`orchestrator.ts:2517`、`agent-runner.ts:1627`、`scheduler.ts:165`、`gym/runner.ts:39`、`providers/mock.ts:26`
- 现状：8 处各自实现 `raw.split("\n") → trim → 过滤空行 → JSON.parse → 类型守卫`，容错口径（坏行跳过/占行号）需在 8 处保持一致。
- 手法：抽出 `parseJsonl<T>(raw, guard)` + `readJsonlTail(fh, offset, state)` 两个工具函数（`events/index.ts` 导出），逐处替换。`orchestrator.advanceCallIdIndex` 与 `replayIncrementalInner` 的半行/偏移推进逻辑可直接合并（§2.3）。
- 收益：行号语义（1-based 行号 = 事件 id 的跨文件契约）只有一处实现，杜绝漂移。
- 风险：**高价值但需谨慎**——`events/index.ts:436-440` 明确「中段坏行不得跳过」，替换时不能顺手放宽容错。
- 工作量：M

**P2-2 · `callIdIndexCache` 无淘汰** | P2 | `orchestrator.ts:2498, 2505-2509, 2552`
- 现状：`Map<logPath, {ino, offset, lines, index: Map<callId, 行号>}>` 只增不减；`replayCache`（`events:485`）有 `REPLAY_CACHE_MAX = 32` 的淘汰先例，此处缺。
- 手法：照抄 `replayCache` 的容量帽 + 淘汰首个（`events/index.ts:537-540`）。
- 收益：会话数增长时内存有界。
- 风险：淘汰后下次访问重扫该日志（可接受，与 replayCache 同语义）。
- 工作量：S

**P2-3 · glob→RegExp 实现重复** | P2 | `orchestrator.ts:2455-2493`（`globIntersects`/`matchesGlob`/`globToRegExp`）vs `tools/glob.ts`
- 现状：租约相交用自写 glob→RegExp（支持 `**`/`*`/`?` + 目录前缀语义），`tools/glob.ts` 走 ripgrep 通配——两套「glob 语义」在同一仓库。
- 手法：抽 `src/util/glob.ts` 导出 `globToRegExp`/`globIntersects`，`orchestrator` 与工具侧共用（工具侧仍走 rg，但语义注释与单测同源）。
- 收益：租约判定与工具行为不会各说各话；`globIntersects` 可独立单测。
- 风险：低（纯函数搬移）。工作量：S

**P2-4 · `selectCut` 用 `find` 定位原子单元** | P2 | `compaction.ts:258-262`
- 现状：`for (guard<1000) { ctx.units.find(m => tailStart > m.lo && tailStart <= m.hi) }`——每次 O(units)，最坏 1000×units。
- 手法：`units` 已按 `lo` 升序且互不重叠（`atomicUnits:133`），改二分（`keepFirstSet:190-201` 已有二分先例）。
- 收益：压缩触发路径（长会话必经）去掉一处最坏 O(1000·units)。
- 风险：低。工作量：S

**P2-5 · 记忆/topic 读取串行化** | P2 | `store.ts:300-311`（`listTopics` 串行 `readOrNull`）、`agent-runner.ts:1290-1293`（串行读每个 topic）、`agent-runner.ts:1722-1728`（串行读每个 sidechat）
- 手法：`Promise.all`（含并发上限分批）。
- 收益：topic/sidechat 数 × 单次读盘耗时 → 最慢一次。**待证：需实测 topic 数**。
- 风险：低。工作量：S

**P2-6 · `scheduler.snapshot` 内 `findSessionIdByKey` 造成 O(n²)** | P2 | `scheduler.ts:855`（循环内调用）、`878-884`（每次遍历全部 `journalByTask`）
- 现状：`snapshot` 对每条历史条目调 `findSessionIdByKey`，后者遍历全部任务的全部条目 → O(n²)。
- 手法：预建一次 `Map<occurrence_key, session_id>`（在 `ingestJournal`/`pushJournalEntry` 时维护），查询 O(1)。
- 收益：历史条目多时 `snapshot` 从秒级降为毫秒级。
- 风险：低。工作量：S

**P2-7 · 死代码 / 空操作残留** | P2 | `orchestrator.ts:717-719`（`statusOf` 恒返回 `null`，无调用方）、`orchestrator.ts:2533`（`void trailing;` 空操作）、`impact/index.ts:279`（`defaultImpactHook` 未接线，M7 进行中）
- 手法：删除 `statusOf`（注释已说明「状态一律由事件流投影」，方法本身是负资产）；`void trailing` 改为 `// 未完整落盘的尾行留待下次` 注释（去掉假代码）；`defaultImpactHook` 在接线前保留但加 `@internal 未接线（M7）` 标注。
- 收益：减少「这函数干嘛的」的阅读成本。风险：低。工作量：S

**P2-8 · `diffVersions` 无清理** | P2 | `orchestrator.ts:656, 2124-2128`
- 手法：随 `releaseWorkerMemory`（2113）一并 `delete`（该函数已有幂等语义与多处调用点）。
- 收益：微（每 agent 一个 number）。风险：低。工作量：S

**P2-9 · 原型层 DOM/定时器卫生** | P2 | `app.js`：30 处 `innerHTML`、76 处 `addEventListener`/0 处 `remove`、`setInterval(24ms)` 打字机（992、1107）、`INITIAL_TRANSCRIPT` 快照（887）
- 手法：① 打字机改 `requestAnimationFrame` + 按时间片批量追加（现每 24ms 强制一次布局 + 每 6 字 `scrollStream()`）；② 转录整体替换后显式 `removeEventListener` 或统一走事件委托；③ `innerHTML` 拼接一律过 `esc()`（已有 `esc`，抽查 106/314 用了，**待证：30 处是否全部转义**——这是 XSS 面，属代码质量而非性能）。
- 收益：长转录滚动流畅度；消除潜在 XSS 面。
- 风险：低。工作量：M

**P2-10 · `index.html` 105KB 内联 CSS** | P2 | `src/renderer/index.html`（1,670 行 / 105,636 字节）
- 手法：CSS 抽到 `src/renderer/styles.css`（vite 会 hash + 产出 `<link>`，`AGENTS.md:34` 已说明构建产物是 link 文件，不受 CSP 影响）；HTML 骨架保留。
- 收益：dev 增量构建、缓存粒度、可读性。风险：低（需确认 `app.js` 不依赖内联样式块的插入时机）。工作量：S

**P2-11 · 其余同步 IO 审查** | P2 | `permissions/rules.ts:85`（`readFileSync`，每次 run 读规则库）、`main/index.ts:322`（`existsSync`）、`sidechat.ts:206-211`（`lstatSync`/`realpathSync`/`readFileSync`，仅用户 @ 引用时）、`sandbox.ts:26`（`realpathSync`，安全检查，可接受）
- 手法：`loadPermissionRules` 是 run 级一次性（可接受）；`readAtRef` 仅用户主动 `@` 时触发（可接受）。**结论：这几处可不改**，仅记录——真正需要动的是 P0-3 的 LSP 路径。
- 工作量：— （不改）

**P2-12 · `activeOrchestrator` 跨 run 保留（待证）** | P2 | `agent-runner.ts:155, 902, 1062`
- 现状：`activeOrchestrator` 刻意不在 run 收束时清空（153-154 注释：审批路由需要），而 `Orchestrator` 持有 `workers`/`chains`/`deferredSpawns` 等 Map。
- 手法：**待证**——需确认会话切换（`handleSessionOpen`）时是否替换/释放旧 orchestrator；若是累积，则应在 `session:open` 时显式释放非当前会话的编排器（并保留终态 handle 的必要子集）。
- 收益：会话频繁切换场景下的内存有界。风险：中（审批路由可达性是硬约束，153 注释是踩过坑的）。工作量：M

---

## 5. 值得肯定的部分（避免只报忧）

1. **类型纪律**：`any`/`@ts-ignore`/`@ts-expect-error` 全仓 **0**；`TODO`/`FIXME` 全仓 **0**。
2. **增量重放已落地**：`replayIncremental`（`events/index.ts:503-567`）按 `(ino, 字节偏移)` 缓存，把每轮读盘从 O(文件) 降为 O(新增)；`replayCache` 有 32 条上限；并发用 Promise 链串行化防重复消费（498-512，审查 S1-2）。
3. **有界缓存的先例已存在**：`replayCache`(32)、`scheduler.termCache`(512)、`scheduler` journal 磁盘收敛(4000)、`prune` 预建索引、`compaction` 二分查找——**P1-5/P1-9/P2-2 只需照抄既有模式**。
4. **子进程/监听器收口正确**：`will-quit` 统一 `killAllTrackedChildren` + `closeAllLspClients`（`main/index.ts:339-346`）；LSP 用 `detached + killGroup` 收整棵进程树（`lsp.ts:243-244`）；Abort 监听 6 处注册/6 处摘除成对。
5. **写路径并发安全**：`serializeOn`（`store.ts:155-167`）、`onJournalPath`（`scheduler.ts:115-128`）、`journalChain`/`replayChain` 四处独立锁 + 唯一 tmp 名，避免了 read-modify-write 竞态（审查 E9/S2-10/S2-11 成果）。
6. **降级链显式且 fail-visible**：`buildMap` 异常 → `ok:false` 空地图（`map/build.ts:274-278`）；记忆注入失败静默跳过但注释标注；`fileImpact` 的 grammar 失败 **fail-loud**（`impact/index.ts:137-143`）与 map 的静默降级形成有意的差异（护栏 vs 增强）。

---

## 6. 未覆盖 / 待证清单（诚实边界）

| 项 | 说明 |
|---|---|
| 所有「预期收益」中的倍数 | **未实测**。本次为纯静态分析，未跑基线（无 profiling 数据）。建议落地 P0-1 前先补 `n=1000/5000` 事件下的组装耗时基线 |
| `app.js` 30 处 `innerHTML` 是否全部转义 | 仅抽查 2 处用了 `esc()`；**未逐处核验**，若存在未转义拼接即为 XSS 面（P2-9③） |
| 循环 import | 未用工具（madge/tsc --traceResolution）验证；静态阅读未发现 `agent`↔`main` 反向依赖，但**未证** |
| `activeOrchestrator` 是否真累积 | P2-12 标「待证」——需读 `handleSessionOpen` 全链 + 实测多会话切换后的 `workers` 数 |
| `renderer/app.js` 与 React 树的语义等价性 | 迁移正确性不在本次范围；仅确认「React 树无运行时引用」这一事实 |
| `.codegraph/`（18MB `codegraph.db` + 常驻 daemon）与 `proto/` | 属开发辅助/原型目录，非 `src` 运行时，未纳入资源分析 |
| 门禁是否仍全绿 | 未跑 `pnpm gates`（只读分析约定）。**任何修复后必须跑 `pnpm gates` + 恒真式体检** |

---

## 7. 建议落地顺序（小步、可验证）

| 批次 | 条目 | 理由 |
|---|---|---|
| 第 1 批（S，低风险，先拿收益） | P1-1、P0-3、P2-2、P2-4、P2-6、P1-9、P2-8 | 全是「照抄既有有界缓存/二分/去 O(n²)」模式，单文件改动，可独立验证 |
| 第 2 批（S–M，需实测基线） | P0-1（先 `calibrateFactor` 增量）、P0-2、P1-4、P1-8（先去抖） | 触及热路径，需先有耗时基线；P0-1 分两步（校准 → 投影缓存） |
| 第 3 批（M，需确认归属） | P1-3（死代码裁决）、P1-5、P1-6、P1-7 | P1-3 需主理人裁决原型归属；P1-7 需在 M7 接线前落地 |
| 第 4 批（M–L，结构性） | P1-2（orchestrator 拆分 7 步）、P2-1（JSONL 解析收敛） | 动结构，必须逐块跑门禁；建议排在功能里程碑间隙 |

**约束提醒（来自 `AGENTS.md`）**：`fixtures/todo-app/tests/**`、`fixtures/mock/**` 是 sha256 冻结判卷文件，本次清单**未涉及**；修复后验收一律 `TERM=dumb pnpm gates`；沙箱内跑测试用 `node node_modules/vitest/vitest.mjs run --pool=threads`。

## 追注（2026-09-23）：P1-6 的「手法①」被实测否掉，别照着做

上表 P1-6 的手法① 建议把 `scanSourceFiles` 的串行 `await stat` 改成 `Promise.all`。
同一条路径今天量了一次（本仓 441 个候选，同一进程内连跑）：

| 段 | 实测 |
| --- | --- |
| `scanSourceFilesAll` 全量 | **50ms** |
| 其中 rg 子进程（`--files --hidden` + 4 条噪声取反） | 8ms 输出 967 条 |
| 其中 N 次 stat，串行 | **4ms** |
| 同样的 stat，`Promise.all` | 1ms |

⇒ stat 只占整段的 8%，并行化最多省 3ms，而整段是**每次建图**的成本、且真正的大头在别处
（parse/边构建与「每次编辑全量建图」）。所以手法① 收益≈0，不该做；
手法②③（缓存判定提到扫描之前 / `buildImpact` 加进程内图缓存）仍然有效——
它们省的是整段而不是零头。原文不回改，判据挂在这里：**要动这条线，先复跑上面那四个数**。
