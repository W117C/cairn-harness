# 定时五件摘/挂 · 裁决前取证（2026-10-05）

取料面 **HEAD=`05d3d0f3`**（`git archive HEAD src` → 本目录 `head/`，探针 `measure.ts` 只读现算；未跑任何判卷/门/vitest/typecheck）。

## 1 五件与定义处
create/update/delete/run_now/list：`src/agent/automation-surface.ts:25-31`（字段表）`:56-69`（渲染）`:71-78`（描述）；实现 `src/main/agent-runner.ts:1207`（`:1227/:1242/:1263/:1278/:1291`）；进面 `src/agent/glm-session.ts:398`。

## 2 挂/摘判据
唯一开关 `automationTools`（`RunOptions:1368`／`RunOverrides:2039`）：规格面 `:727`、执行面 `:975/:1084` 同字段。传值——CLI 一次性 `false`（`src/cli.ts:1124`）；`--serve` 强装（`:1158`）；定时触发不传⇒装（`:1180`）；desktop 两条 run 都不传⇒装（`kernel-host.ts:222,229`；`:2134` 只认 `=== false`）。
`installTimeOmitTools`（`:1529-1543`）只有 goal/memory/lsp/subagents 四支，**缺 automation 这一支**；五件走旁路布尔，`installAppTools` 第一场定终身、异值即抛（`:991-1000`）。

## 3 摘了会坏什么
`Scheduler.start` 读 `<ws>/.agent/schedules/automations.json`（`src/main/scheduler.ts:481,498`）——人手写即可被触发，不需模型。`scheduler.upsert` 只有两类调用者：UI 侧 `handleScheduleUpsert`（`:1192`）与模型侧（`:1236/:1257`）。
UI 侧不通：协议与通道名在（`src/main/ipc-protocol.ts:223`、`apps/desktop/src/main/channels.ts:46`），但 desktop `wired` 表没这四行（`apps/desktop/src/main/index.ts:102-164`）⇒ 调用即 No handler registered；且 `initScheduler` 唯一生产调用者是 `serveScheduler`（`:1157-1164` ← `cli.ts:918`），desktop 从不初始化 ⇒ `:1190` 恒「调度器未初始化」。
模型侧也不通：update/delete/run_now/list 先 `needScheduler()`（`:1245/:1266/:1281/:1294`），create 先审批后查（`:1232-1234`）＝白烧一张卡；`--serve` 才有调度器，那里只跑 unattended，门即刻拒（`src/main/ask-gate.ts:61-64`；`:2163`）⇒ 四件必拒，唯 `list` 有回执。
⇒ HEAD 无「模型建成任务」的生产路，摘＝可达能力零损失；但五件是眼下唯一活着的写入者，摘应与「补 `wired` 四行」同笔。

## 4 真实字节（HEAD，仓内尺）

| 读数 | 值 | 尺 |
|---|---|---|
| 五件规格合计 | **2,482 字符**（帽 2,600 ⇒ 余量 **118**） | `model-surface.ts:89`／帽 `tests/automation-tool-surface.test.ts:98` |
| 逐件 | update 930／create 924／run_now 240／delete 216／list 166 | `model-surface.ts:102` 同账 |
| 摘后每轮省 | **2,481 字符**（22→17 件，固定面 11,492→9,011＝21.6%） | 同上 |
| 生产现读（default 已摘 goal+lsp） | 20 件 10,514 → 15 件 8,033 | 同上 |
| token | CJK 913；`/3.6` 689 | `estimateTextTokens`／`scripts/prompt-cost.ts:32` |

**证伪**：2,569 与 12,520 都是**脏树**读数。同形状实测——脏 679＋11,841＝12,520，HEAD 679＋9,835＝10,514；差的 2,006 全在工具 JSON（1,919 在别处脏改动，五件本身 87）。HEAD 真值 2,482、省 2,481。
前置件＝**create**：另三件 `id` 描述写「create 的回执里有」（`:40`），update 描述写「同 create」（`:74`），kind 文档（149 字符）只在 create/update ⇒ 五件同进同退。

## 5 裁决：按条件摘
条件＝本进程调度器接没接起来，判据读 `getScheduler() !== null`（`:1135`；`stopScheduler` 不清 null ⇒ 单调真），同 `lspConfigured` 读盘、`installTimeAutoMemory` 读 settings 一族；不造 settings 键。
最小改法（**只动 `agent-runner.ts`**）：`runAgent` 里与 `memoOn/lspOn` 同段（`:1551-1564`）加归一——`opts.automationTools === undefined && getScheduler() === null` 时重绑 `{...opts, automationTools: false}`。`:1566` 与 `:1768` 两个字面原样保留 ⇒ `tests/automation-tool-surface.test.ts:133/135/137`、`tests/cli-surface.test.ts:318` 不红；`:727` 已有 filter，不加新逻辑。帽 2,600 与上列判卷行不动。
要加的判卷：runAgent 级接线读数（无调度器 ⇒ 面少五件；先 `initScheduler` ⇒ 五件在）——现判卷只直调 `sessionToolFace`，测不到这格。
撞面：四条锚点（`scripts/mutate-verify.mjs:7051/7059/7067/7075`；真名 `automation-face-in-read-only`，任务书所列三名之一不存在）apply 目标都在 `glm-session.ts`/`automation-surface.ts`，本改法不触；`tests/tool-surface-parity.test.ts:113` 与 `src/agent/tool-surface.ts:44-48` 读源文本形状与静态面，实现不删就不红；`tests/prompt-surface-check.test.ts:307` 分母走 `sessionToolSpecs`，不受影响。
风险：`--serve` 里 `:1158` 先定身 ⇒ 之后每场必须算出 true，靠单调判据满足；若首场 run 之后才 `initScheduler`，false→true 当场抛 ⇒ 须沿用 `omittedForever` 的「需要时永久放回」累积纪律。隔壁那一笔（2,482→2,569，余量只剩 31）应先入库。
