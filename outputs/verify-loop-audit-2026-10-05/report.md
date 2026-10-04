# 执行-验证-修正闭环取证（能力 5）— 2026-10-05

作者：只读子代理（无写权，主线程落盘）。**全部读 HEAD**（11 个目标路径 `git status` 无输出＝与 HEAD 逐字节同；主树另有 162 项他人未提交改动）。

## 一、链的每一环（环／file:line／通不通）
1. 写盘记账 `src/agent/loop.ts:567-571`，写向谓词唯一 `src/agent/write-face.ts:28`（含 shell）— **通**
2. 谁何时跑验证 `src/agent/loop.ts:583-585`（纯文本收束轮 ＋ `verify && autoVerify===true && wroteThisRun && (firstBeat||repairBeat)` ＋ `surface()!==false`）— 条件通、**执行不通**
3. 执行 `src/agent/verify.ts:365-396` → `src/agent/verify-trust.ts:41`：`loadVerifyConfig`（`verify.ts:236`）只出 `config|probed|none`，带命令的 `host` 分支**不可达**；`agent-runner.ts:1820/344/1655/2128` 四处 `trustedRepo ?? false`，而**生产入口无一置真**（`cli.ts:1091-1125`、`agent-runner.ts:1173`、IPC 白名单 `run-request.ts:10-18` 无该键、`apps/desktop` 零命中）⇒ `surface()` 返 false（`verify.ts:385`）**整段跳过 —— 断在这一环**
4. 落事件 `src/agent/loop.ts:235-245` `verify_result{auto:true}`（哨兵 callId `loop.ts:152`）— 机制通，**今日零生产者**
5. 谁读它 `src/agent/worker-report.ts:87` 四态 → `goal.ts:108/145`、`supervisor.ts:85-87`、`orchestrator.ts:2091`、`tool-choice.ts:135-142`、`events/index.ts:377`
6. 红字回流 `src/agent/context.ts:74-104`＋`:311`（只投最新一份 auto 红为 user 消息）— **通但迟到**：同 run 返修下一拍可见（`loop.ts:372` 重投影 `seen`），否则要等下一个 run，而非 goal 会话根本没有下一个 run；文案还写着「再继续新任务」（`context.ts:92`）
7. 改完重验 `loop.ts:584/610-612`，需 `autoVerifyRepair` — 默认关，且 worker 永远拿不到
8. 完成判定 `goal.ts:108` 只认 `verified`，`goalNextTurn` `agent-runner.ts:2194/2222-2245` — 判据本身通

## 二、默认值与「未裁」到底是什么
`LoopOptions` 缺省 false（`loop.ts:52`），生产装配走 settings：`autoVerify: true`（`settings.ts:134`，回退 `:214`，2026-09-23 翻的）、`autoVerifyRepair: false`（`:135/:216`）。override 只有 autoVerify 有（`agent-runner.ts:2127`；`--auto-verify` `cli.ts:328` **只能置真不能置假**），repair 仅盘上 settings（`:2142`）。
「未裁」＝台账要求「准确率 ∧ $/成功任务」**并列双读数**（`PROGRESS.md:7829`）。已有读数只在成本侧：`outputs/auto-verify-readout-2026-09-20.md` §2/§3（一拍 242–804ms 墙钟、**0 次额外模型请求**、红字 ≈687 token/轮）；收益侧普查两次归零：`PROGRESS.md:9897`（48 份日志 50 条 verify_result，`auto:true` **0 条**）、第 362 页 `:12586`（返修真暴露 ≤2/131≈1.5%）⇒ `:12588` 裁「别翻」；A/B 两臂未起（`:12570`）。

## 三、信任门把闭环按死，且不止按死
除第 3 环外，**拒答被记成假红**：`verify.ts:393` 返 `{ok:false,results:[],skipped}`，而 `skipped` **全仓零消费者**；`loop.ts:216-228` cause 缺席＝code（`events/index.ts:133/157`）⇒ 烧掉 1/3 修复额度、注入「verify 失败（无详细输出）」（`verify.ts:410`）教模型去改**本来正确的代码**；`verifyAttempts>0` 使 `firstBeat` 永假（`loop.ts:583`），连自动拍都被这条假红顶掉；证据落 `failed` ⇒ goal 永远 continue。

## 四、stale 谁在算、对不对
`worker-report.ts:87-113` 三条都对：次序判据 `lastWrite > lastVerify`、写向唯一谓词、环境拍不记账不占位（`:102-109`）。
**错在取料**：`goal.ts:246` 把它用在**合并后的主流**上，而 worker 子流带 `agent_id` 落同一份 JSONL（`orchestrator.ts:1898-1899` → `agent-runner.ts:1634`），本函数**不过滤归因**，而四处同类消费者都滤（`context.ts:77`、`tool-choice.ts:140/168`、`agent-runner.ts:1635` 注释「同投影同口径」）
⇒ **worker 的绿拍＝父会话 `verified`＝假完成**；worker 在 worktree 的写＝父绿 `stale`＝白烧一轮。
（`orchestrator.ts:2091` 用未装饰的 `w.events` 那一支是对的；窗口 `goal.ts:242` 只取末条 `goal_set` 之后也对。另：`supervisor.ts:75` 那条注释已过期。）

## 五、主线程处置（按代价排序，不是一次全做）
| 格 | 改法 | 文件 | 现读归属 | 状态 |
|---|---|---|---|---|
| 假完成（worker 绿拍替父宣布 verified） | `goal.ts:246` 的证据取料改吃**同一份归因过滤**（照 `context.ts:77` 那条口径），并配一条「带 `agent_id` 的绿拍不得替父会话宣布 verified」的判卷 | `src/agent/goal.ts`（＋`tests/goal-stop-decision.test.ts`） | 干净 | **本线程接，下一个原子簇** |
| 拒绝被记成代码红 | `loop.ts:208 verifyBeat` 认 `skipped` 为**第三结局**：不 charge、不落 code 红、reason 原样回注 | `src/agent/loop.ts`、`src/agent/verify.ts` | 干净 | 登记 `#93`（要同笔，单独开闸就同时打开假红通道） |
| 闭环压根跑不起来 | 三处装配（`agent-runner.ts:1820/344/1655`）的 `trustedRepo` 由常量 false 改为按 repoDir＋verify 面内容指纹查 `src/agent/plugins/trust.ts:148 trustOf`/`:167 decide`，首次经 `appAskGate` 出审批卡 | `agent-runner.ts`（本线程在飞）＋信任面 | 冲突面 | **待裁决**（这是安全授权形状的改变，须人拍板，已向用户提问） |
| 红字迟到一轮 | 非 goal 会话没有下一个 run ⇒ 回流只在同 run 返修那一拍生效；文案「再继续新任务」（`context.ts:92`）与实况不符 | `src/agent/context.ts` | 干净 | 登记 `#94` |

判卷现状与本笔相关：`tests/verify-trust.test.ts`（手写 `trustedRepo:true` 的证人，闸门一改就要跟着走审批路径）、`tests/auto-verify-wiring.test.ts:87`、`tests/goal-stop-decision.test.ts`。
