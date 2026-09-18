> **⚠️ 历史快照（2026-09-15 评审轮）**：本文是那一轮的概览，**其中的「现状」判断按当时快照保留、不追改**（改写即伪造历史）。
> 已过时之处举例：文中所称「渲染层迁移**进行中**、本轮不做任何删除/恢复」——**迁移已完成**，
> vanilla 渲染层已入库（提交 `e259113`，作用域限定 `src/renderer/`），React 树不在运行时路径。
> **当前权威**：`AGENTS.md` + `outputs/frontend-refactor-2026-09-17/`（`06-p0-implementation.md` 实施轮 / `07-todo-closure.md` 收口轮）+ `overview-p0-fix.md`。
>
> **⚠️ 2026-09-19 存档追注（入库时加；上面第 1–4 行一字未改）**：第 4 行那条「当前权威」如今是一条
> **活的假指针**——它指向的 `outputs/frontend-refactor-2026-09-17/` 已在 2026-09-18 被补上存档 banner
> 并由 T4 裁定**降为存档**（其数字层实测漂移：自报 `app.js` 2281 / `index.html` 1866，
> 现 HEAD 态 **2690 / 1973**，复跑见 `docs/ui-fact-baseline.md` F18）。照第 4 行施工就会拿一轮
> 漂移过的数字当现状。**现权威两面**：意图 = `agent-plan.md` §10.1 七条布局定稿；
> 事实 = `docs/ui-fact-baseline.md`（每个可判定量配各自复跑命令）。本文其余内容按 2026-09-15 快照原样保留。

# 概览 · DSH Agent 综合评审（2026-09-15）

## 做了什么

对 `/Users/ze/Downloads/deepseek harness`（DSH，Electron 桌面编程 Agent，`src` 26,349 行 / 129 文件）做了一次**只读**的架构 + 功能缺口 + 性能优化评审。由架构师与工程师分头实证，主理人汇总并独立核验关键断言。

**未改动任何 `src` 代码，未跑门禁。**

## 核心结论

1. **【P0·功能性】完整 agentic 能力没接上生产热路径** —— `agent-runner.ts:797` 在 `M0A_PROVIDER=glm` 时返回的是「单轮、无 tools、忽略 messages」的演示 provider；具备压缩/prune/记忆注入/符号地图/工具回灌能力的 `createGlmSessionProvider`（`glm-session.ts:285`）只被 `scripts/gate-check.ts:233`（暗卷）和 tests 消费。
2. **【P0·可用性】模型/网络错误无事件化** —— `loop.ts:79` 的 `for await` 无 try/catch，`AgentEvent` union 与 `KNOWN_TYPES` 均无 error 类型 ⇒ 事件流看不到失败、UI 静默。
3. **【P0·性能·实测新发现】事件落盘是「每事件一次 open+write+close」** —— `loop.ts:80` 对**每个**事件（含每个流式 token 块）`await events.append()`，而 `events/index.ts:427` 的 append 实现是 `appendFile()`。**实测 1,930 µs/事件**；对照：常驻文件句柄 **9.8 µs**（快 196×）、常驻句柄 + 32 条微批 **0.56 µs**（快 3,446×）。一轮 2,000 个流式块的回答 = **约 3.9 秒纯磁盘 I/O**，且 `await` 位于模型流的 `for await` 之内 ⇒ **逐 token 阻塞模型流**。这是本轮唯一被实测证实的真实延迟瓶颈。
4. **【P2·性能】「每轮 O(n) 全量重算」形状成立但量级很小（已下调）** —— `projectContext` + `calibrateFactor` 在四处调用点每轮全量遍历，O(n²) 成立；但**实测** 15,840 事件单次投影仅 **1.24 ms**，800 轮会话累计 1.5 s、末轮 3.8 ms ⇒ 相对 LLM 往返可忽略。**原 P0-1 严重度经实测下调为 P2**（工程师原判「全仓最大的延迟放大器」不成立）。
5. **代码卫生是硬成绩** —— `as any` 0、`: any` 0、`@ts-ignore` 0、`TODO/FIXME` 0、无反向依赖、Abort 监听成对、子进程统一收口。

## 关键裁决

**渲染层现行 UI 是 `app.js`（原生 JS 原型），约 5,000 行 React 树已不在运行时路径。** 证据：`index.html:1668` 唯一 module script 指向 `/app.js`；构建产物含 `//#region src/renderer/app.js`；`git status` 显示 `main.tsx`/`styles.css`/`error-boundary.tsx` 已删除，`app.js` 未跟踪。**这是一次进行中的迁移（他处 in-flight），本轮不做任何删除/恢复** —— 且 `projections.ts` 是 3 道门禁的判据来源，误删即红门。

## 第二轮：实施优化（同日深夜，9 项落地）

**目标 / 范围 / 优先级**：只做「零语义变化 + 有实测收益」的性能项，不动功能、不动冻结判据、不动他处 in-flight 的渲染层迁移。

| 编号 | 内容 | 收益 |
| --- | --- | --- |
| **A1** | `events/index.ts` 事件落盘改**有界常驻 `FileHandle`**（32 条 + inode 校验 + 淘汰关闭） | **1,930 → 9.8 µs/事件（196×）** |
| **X1** | A1 残余风险：每次 append 复核句柄实例（防 32 条淘汰后 `EBADF` 炸掉整轮） | 回退验证复现 `Error: file closed` ✅ |
| **X2** | `scheduler.ts` 日志复用常驻句柄 + 同链失效（绕开 `mkdir` 2.1 ms/次） | 23.1 s → **302 ms** |
| **B1–B6** | orchestrator 内存释放条件修正 / `callIdIndex` 有界 32 / `selectCut` 二分 / 记忆预算 O(L²)→O(L) / scheduler O(1) 查表 + 日志压缩后重建内存表 | 正确性 + 有界内存 |

新增测试 8 条（`events` 5 / `memory` 2 / `schedule` 1）。**主理人实测：`typecheck` exit 0、冻结判卷 28/28 sha256 全等、全量测试 61 files / 2 failed（失败两文件均基线同红，见第三轮）——零新增回归。**

## 第三轮：红门定案（主理人实测为 **绿 21/26，红 5**）

`pnpm gates` 红 `test`、`ipc:check`、`build`、`panels-check`、`map-check`，逐一定因：

| 门 | 定因 | 决定性证据 |
| --- | --- | --- |
| `build` | **沙箱垫片的「轮级」删除预算**（阈值 50）拦掉 Vite `prepareOutDir → emptyDir → rmSync(out/main/index.js)` | `panels-check` 日志里的完整栈；未注入垫片的那次单跑 `pnpm build` **exit=0** |
| `panels-check` | **同 `build` 同一根因**（B 相即 spawn 一次 `electron-vite build`）。原稿记的「宿主拒载 Chromium 沙箱」**不成立** | 同上栈；且构建中止后 `electron.vite.config.*.mjs` 残留 4 → 6，新增两个正落在本次之后 ⇒ 残留是**症状** |
| `test` | **非回归**·两个独立成因：`path-boundary` 撞删除预算（`targetCount:1` 却报 `count:60` ⇒ 轮级累计）+ `map-build` 撞 tags 缓存时序 | 见 `BLOCKED.md` 两条立案 |
| `map-check` | **非回归**，pristine 同红同断言 | 基线复现 `❌ ④…（fromTagsCache=198/237）`；另有沙箱拒建缓存目录 `Brokered host mkdir requires an available runtime file rule` |
| `ipc:check` | **无异常** | 单跑 **exit=0**，「全部断言通过（分支 B 降级链）」 |

**回归判定的定量结论（决定性）**：`git worktree` 拉 HEAD `5e8a10b` 作基线（不含本轮改动），两棵树跑同一套命令——

| | 基线 | 本轮改动后 |
| --- | --- | --- |
| Test Files | **5 failed** / 55 passed | **2 failed** / 59 passed |
| Tests | **10 failed** / 555 passed | **5 failed** / 595 passed |
| 失败文件集 | `gated-tools`、`map-build`、`path-boundary`、`runner-gates`、`schedule` | `map-build`、`path-boundary` |

⇒ **本轮失败集是基线的真子集，失败用例 10 → 5，零新增**；基线红的 `schedule`（本轮直接触及）**转绿**。

> ⚠️ **诚实边界**：`pnpm gates` 在本沙箱内**不可判**——删除预算按轮累计，跑到 `build` 时必然耗尽，红与代码无关。
> 且**原稿「全量测试 600/600 全绿」主理人反复尝试均未复现**（本会话 4 次全量运行一致为 2 files failed），
> 已按实测更正；本轮的「零回归」结论**由基线判别实验独立支撑，不依赖任何自述数字**。

## 第四轮：宿主（非沙箱）收口实测 —— **绿 25 / 26**

上一节是**沙箱内**的账。主理人在**宿主非沙箱**环境（`Sandbox bypassed`，真实 fs、无删除预算）另跑一次，
结果不同，**两套环境的账必须分开记，不能混**：

```
绿 25 / 26，红 1（panels-check）
逐道退出码：typecheck=0 test=0 e2e=0 ipc:check=0 sandbox:check=0 build=0 fork-check=0
  gate-check=0 autonomy-check=0 compaction-check=0 panels-check=1 tools-check=0
  map-check=0 prune-check=0 providers-check=0 provider:check=0 memory-check=0
  plugins-check=0 sidechat-check=0 security-check=0 agents-check=0 schedule-check=0
  commercial-check=0 gym-check=0 routing-check=0 supervisor-check=0
断言体检：零命中 ｜ 清单漂移校验：通过 ｜ ⚠️ 未证 9 项（如实标注，不等于通过）
```

- `test` **=0**（全量 **61 files / 600 passed 全绿**）、`map-check` **=0** —— 与沙箱内结论不同，
  因为沙箱那两道红来自垫片删除预算 / 拒建缓存目录，**不是代码**；宿主环境无此限制即转绿。
  `map-check` 还额外受并发负载影响（tags 缓存写入 fire-and-forget 的毫秒级竞态，见下）。
- **唯一红门 `panels-check` 归属已二分清楚（非本轮引入）**：

| # | 组合（均在 scratch `git worktree` 上做，未动本仓） | `panels-check` |
| --- | --- | --- |
| 1 | pristine `5e8a10b` | ✅ 全通过 |
| 2 | pristine **+ 本轮 6 个源文件** | ✅ **全通过** |
| 3 | #2 + 渲染层迁移 delta（`app.js` 原型换掉 React 树） | ❌ 红 |
| 4 | #3 + `sidechat.ts` + 新增 `src/agent/impact/`（清 `out/` 全新构建） | ❌ 红（同 #3） |
| 5 | 主工作区（全部改动） | ❌ 红 |

  ⇒ **唯一变量是进行中的渲染层迁移**。这条硬证据直接喂给下方待裁决项 ②：选 (A) 原型即正式 UI，
  就必须把 panels-check B 相三条能力（1 万条事件虚拟化 DOM ≤300 / 审批徽标 ≤1s / 布局重启还原）
  在 `app.js` 原型上重做，否则这道门恒红；选 (B) 恢复 `main.tsx`，门自然回绿（#1 已证）。

## 交付物

| 文件 | 内容 |
| --- | --- |
| `outputs/agent-review-2026-09-15.md` | **综合交付报告**：架构与模块清单、四维度功能缺口（P0–P3）、6 个完善方案（A–F）、24 条性能优化清单、裁决与核验记录、4 批落地路线、未证边界 |
| `outputs/optimization-log-2026-09-15.md` | **实施记录**：9 项逐条的改动内容与验证证据；§四为**主理人亲测更正**（原稿「600/600 全绿」未复现，已按实测改写）+ 两段补记（红门定案） |
| `outputs/analysis-arch-2026-09-15.md` | 架构师原始报告（分层图 + 模块表 + 时序图 + 缺口 + 方案） |
| `outputs/analysis-perf-2026-09-15.md` | 工程师原始报告（20 条分级优化清单，含实测数字） |
| `BLOCKED.md`（新增三条） | ① map-build tags 缓存「返回即已落盘」时序判据（fire-and-forget 写入 + 紧邻断言，pristine 3/3 同红）；② **`pnpm gates` 在本沙箱内不可判**——垫片删除预算按轮累计，含完整栈证据；③ **panels-check 红门归属二分**（渲染层迁移引入，含 5 组对照，直接关联待裁决项 ②） |

## 需要你确认的两点

1. **生产单轮 provider 是否有意留位？** 若有，方案 A（生产会话接线）应降级为「文档化缺口」。
2. **渲染层迁移的归属与目标形态** —— (A) 原型即正式 UI，保留 `projections.ts` 作纯投影库、退役 React 树；还是 (B) 原型只是预览，恢复 `main.tsx`、`app.js` 移入 `proto/`。这决定约 5,000 行去留。

## 建议的下一步

- **先做 P0-A（事件落盘改常驻 `FileHandle`）**：实测 196× 收益、**零语义变化**（仍逐条落盘，append-only 与崩溃窗口不变）、单文件改动。这是投入产出比最高的一项。
- **再做方案 B（错误即事件）**：无依赖、收益最直接（`loop.ts:79` 包 catch + 新增 `AgentErrorEvent`）。
- **第 1 批性能项**（照抄既有有界缓存/二分模式）：P2-2、P2-4、P2-6、P1-9、P2-8。
- **P0-2（`agent:state` IO 风暴）与 P0-3（LSP 同步读盘）本轮未实测**，建议先补基线再改。
- 任何修复后一律 `TERM=dumb pnpm gates` 验收。

## 未证边界

**投影/校准、事件落盘、记忆预算三项已跑实测基线**（见主报告 §8；绝对耗时在沙箱 fs shim 下可能被放大，但相对倍数稳健）。仍**未证**：P0-2 / P0-3 的耗时、`app.js` 30 处 `innerHTML` 是否全部转义（潜在 XSS 面）、循环 import、`activeOrchestrator` 是否累积。门禁**未跑**（只读约定）。
