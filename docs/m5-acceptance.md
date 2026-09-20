# M5 验收对表（三态）

> 出具：2026-09-14。对表对象：`docs/m5-proposal.md`（v3，评审后批准）。
> 口径沿用：**已证** = 有可复跑断言；**未证** = 断言没跑到（无 `M0_API_KEY` 的暗卷段）——**不等于通过**，必须显式打印 skipped；**M6** = 明确留位不偷做。
> 复跑一律 `TERM=dumb`。门数：23 → **26**（+gym-check / +routing-check / +supervisor-check）。

## 门禁现状

`TERM=dumb pnpm gates`：**26 道全绿 + 恒真式/析取式体检零命中 + 门清单漂移校验通过**；未证 9 项如实标注（testdino 远程 MCP、provider:check 需联网凭据 + 各 check 暗卷段）——**未证 ≠ 通过，不宣称全绿**。

## M5a：尺子与地基

| # | 项 | 状态 | 证据指针 |
|---|---|---|---|
| A1 | `routing_decision` 事件三处同步（接口 / `AgentEvent` 联合 / `KNOWN_TYPES`），旧日志重放逐字不变 | **已证** | `tests/routing-events.test.ts`（roundtrip 无损 + `fixtures/agents/*.jsonl` 全部逐字重放 + 未登记类型抛错）；sidechat 只读投影 switch 同步补 `routing_decision` 分支（typecheck 强制） |
| A2 | 靶场骨架：清单加载 / 反例控制 / 冻结 | **已证** | `gym-check` 段 A（A1 三件套齐备 / A2 三个 case 的 negative 全部判失败 / A3 判卷面 25 文件 sha256 与冻结表逐字一致）；正向控制冒烟：三个 case 的正确解法 score=1（见实施记录） |
| A3 | 反事实回放跑器：模式① 从头跑 / 模式② 分叉重跑 | **已证** | `gym-check` 段 B（B1 明卷两次跑逐字段一致 / B2 forkSession 分叉前 N 条逐字节一致 + 原文件 sha256 不变 / B3 暗卷缺席显式跳过）；`gym-run.ts` CLI（--out/--compare/--fork/--resume-script） |
| A4 | 基线快照 + 回退护栏 | **已证** | `fixtures/gym/baseline.json`（scripted 100%，tokens 645）；`gym-run --compare` 成功降 >2% / 用量升 >5% 判回退 |
| A5 | gym 判卷区纳入冻结漂移守卫 | **已证** | `src/frozen.ts` frozenCoverageDrift 扩展 `fixtures/gym/cases/**` + index.json；gate-check H7 双向一致（onDisk/inTable 均空） |

## M5b：模型路由

| # | 项 | 状态 | 证据指针 |
|---|---|---|---|
| B1 | provider 档位表 + `toWorkerModel` 薄适配 | **已证** | `tests/providers.test.ts` M5b 段（三档齐备 / 未知 id fail-visible / toWorkerModel 构造零拨号、无 key 调用才失败） |
| B2 | 路由策略层（pin > 档位表 > 降级链） | **已证** | `tests/routing-policy.test.ts`（9 断言：pin 优先 / 未知角色回落 standard / 缺档降级 reason=fallback+from / 空表 fail-visible） |
| B3 | 编排器接入：每次 spawn 恰一条 `routing_decision` + agent_id 匹配 + respawn 按 pin | **已证** | `routing-check` 段 A（A1/A2/A3/A4 共 11 断言）；agent_spawned.model 填 picked；老路径零 routing_decision |
| B4 | bandit 在线学习（可播种 RNG / Thompson / 代价感知） | **已证** | `routing-check` 段 B（B1 200 轮便宜档 >0.8 / B2 奖励取反收敛强档（非恒真）/ B4 同 seed 轨迹逐字段一致 / B3 settings 白名单未吞 + 非布尔回退） |
| B5 | 级联升级**纯函数行为**（verify 门控 / maxRungs 有界 / fail-closed） | **已证** | `routing-check` 段 C（C1 恰好升级一次 / C2 maxRungs 上限 / C3 无 verify 不升级 + 显式说明）；`tests/cascade.test.ts`（runCascade 7 条 + cascadeLadder 6 条：起始档不重跑 / 预算是真上限 / 最高档交空表 / 缺档不凑数） |
| B5b | 级联升级**产品路径**（sequencer 环真的按客观判据升档） | **已证**（2026-09-20 接线，任务 #45） | 本行此前把 B5 的纯函数证据当成整条能力的证据，而 `runCascade` 在 `src/` 里**零调用者**——「便宜档先跑、红则升一档」在产品里从未发生过（第 7 次「两头断」）。现已接进 `orchestrator.runChain`：判据只取 worker 自己事件流的 `agent_result.artifacts.verified`（failed/stale 才升；模型自报 verdict 不算），阶梯只在**同一模型家族内**取（跨厂商升档会悄悄换掉用户的 BYOK key；决策面拆成 `cascadePlanFor`，runChain 保持「哑 sequencer」——见 agents-check N6c），升上来的那一档必须自己交出 `verified`，预算是**整链**的 `cascadeLeft` 而非每环各一份；终态 failed/cancelled 属**另一类失败**，从第一档起就停止爬升（首环与每一档同一判据）。证据：`tests/cascade-wiring.test.ts`（9 条 e2e：升一档重跑 + 快照 agentId 指向末档 + 被淘汰档 worktree 回收 / absent 不升级 / 首档绿零重跑 / 预算用尽整链红 / 升上来的那档 absent 不算收敛 / 缺省零行为 / 未路由不级联 / 崩档停止爬升 / done+客观红不给 bandit 加分）+ 变异锚点 10 条（`cascade-trigger-wider-than-objective-fail`、`cascade-rung-accepts-absent-evidence`、`cascade-ladder-cross-provider`、`cascade-ready-ignores-routing`、`cascade-ladder-includes-start-tier`、`cascade-climbs-past-other-class-failure`、`bandit-rewards-self-reported-done`、`terminal-sync-reads-finished-not-resolved`、`join-settled-reads-finished`、`finish-throw-orphans-terminal-waiters`）。**未证**：① 真 `createVerifyHook` 在真目标仓库判红（测试用 `workerVerify` 注入 seam，真沙箱 exec 那条跳没跑）；② 换更强的模型是否真能把红的验成绿——需要 M0_API_KEY 联网实测，本轮只证明「触发/记账/收口」正确，没证明「升档有用」；③ `stale`（验完又写盘）离线剧本无生产路径可造，只被 `objectiveFail` 的字面判据覆盖；④ 取消/成本闸与级联的交互只做了代码路径（`stopClimb` 与「另一类失败」共用一条出口，后者有测），没有单独的「跑到一半用户点停止」用例。双指标口径：**接上 ≠ 划算**——$ / 成功任务 的读数要等 ② 的实测，缺省 `routingCascade=false` 正是为此（花真钱的开关默认关，且必须给读数才开）。**留位待裁决**：被淘汰那一档的 worktree+分支走的是 supervise reject 的同一条 `cleanupWrite`（`git worktree remove --force` + `branch -D`），也就是**harness 自己判定一份未合并改动作废**——与「合并权永远在人」「操作可回滚」有张力（补丁正文此前已作为 `[diff]` tool_result 落进事件流，不是彻底消失，但拿不回可合并的实体）。要么改成退役为显式候选交人裁决，要么加二次确认，属产品裁决。 |
| B5c | sequencer 同步点的**收尾窗口**竞态（接线时实测抓到） | **已证**（2026-09-20） | `finishInner` 开头即置 `finished=true`，但 done 分支在此之后还要 await git diff + 安全流水 + emit 才挂 `lastResult`；只看 `finished` 的读取方在窗口里拿到「done + result 空」。后果实测复现：级联把交出绿证据的那一档判成失败环，白烧一档再误报整链 failed。判据改为 `WorkerHandle.terminalResolved`，同族 reader 逐处收口：`waitForAgentTerminal` 早退 / `waitForAgents` 的 `snapshot` 状态与 `settled` 过滤 / `dependsGate` 的「等不等前环」 / **`mergeWorker` 的收敛校验**（这一处是授权面：gate 档下窗口里 `lastFindings` 还没填，安全扫描会被空数组假通过）/ 收尾中途抛异常的 `catch` 放行（否则无超时的等待永挂，且 `cancelAgent` 因 finished 已真而拒绝）。评审重启路径同步复位 `terminalResolved`/`terminalStatus`/`lastResult`（只清 finished 会让下一轮读到上一版的报告）。证据：`tests/terminal-sync-window.test.ts`（把 `agent_result` 的 emit 按住以确定性造窗口，断回执说 running + timedOut 点名而非 done + 空报告；另一条让 emit 抛，断这条红真的到达而不是挂死；第三条在窗口正中叫 `mergeWorker` ⇒ 必须拒（旧写法会一路放过：此时 `lastFindings` 还空着，gate 档被「零条高危」假通过，未扫描的代码被系统代为 commit 并进主树）+ 4 条 terminal/finish 锚点（含 `merge-admits-worker-still-in-finish-window`）。**未证**：`dependsGate` 那一处只改了判据，没有单独造一次"窗口里父模型抢着起后环"的用例（要走父 loop 才测得到）。 |
| B6 | 真多 provider 白名单 / 价格表接线 | **已证**（M6 收口，2026-09-14） | `PROVIDER_IDS = [glm, openai, anthropic, gemini]` + 12 档位 spec（§4.3 预留面开闸，零重构）；`toWorkerModel` 按 provider 路由（tests/providers.test.ts：anthropic 格式 SSE 只被 anthropic 消化 = 路由判别）；`src/routing/pricing.ts` 价格表 + `costUsd` 真钱折算 + `priceCoverage` 漂移护栏（routing-check 段 F：覆盖 12 id / $18 已知用例 / 真钱代价 bandit 收敛 cheap>0.8 / 价格对调反向验证 / 同 seed 确定性）；`updatePriced` 接进 bandit 代价项（§1.3 口径升级：token 代理 → 真钱）。**留位**：bandit 运行时接线（app 读 settings.routingBandit + 真实 usage 喂 routeFor）仍 M6；价格/模型名为占位，需联网实测校准（C5） |

## M5c：编排自适应

| # | 项 | 状态 | 证据指针 |
|---|---|---|---|
| C1 | 受限 Supervisor：封闭动作枚举 + 有界三重保险（maxStages / 预算闸 / 防死循环） | **已证** | `supervisor-check` 段 A（任意输入 → 枚举，畸形 → escalate）/ 段 B（B1 永远 fail → 第 6 环后必 abort / B2 第 3 次出现 → escalate）；src/agent/supervisor.ts 纯规则 V1 |
| C2 | Best-of-N 竞争编排 spawnRace（N≤3 / judge 命中早停 / 复用取消链与成本闸） | **已证** | `supervisor-check` 段 C/D（C 选中全绿者 + 早停触发 / D 其余终态 cancelled + accountable usage 严格小于跑满 80<1080） |
| C3 | gate/loopback 留位闭合 | **已证** | `docs/m3-acceptance.md` 九之 2 改「已证」，证据指针 supervisor-check 段 B |
| C4 | supervise 模式运行时接线（AgentMode 扩 supervise + 审批卡双轨 {goal,budget,forbidden,maxStages} 落地编排器） | **已证**（M6 收口，2026-09-14） | `supervisor-check` 段 E（16 断言：E1 审批卡批准 {goal,budget,forbidden,maxStages} 双轨契约（非 stages 全表）/ E3 永远 fail → maxStages 有界中止 + [supervisor] 审计轨迹 + approval_resolved / E4 拒绝 fail-closed 零环 / E5 单环 pass → 接受（gate loopback 闭合））；实现 `src/agent/orchestrator.ts` spawnSupervise + requestSuperviseApproval；**渲染卡零改动**——审批卡只渲染 args_digest/risk_reasons（无 stages 硬编码），双轨手术在数据层完成；环 worktree 生命周期：accept 合并最终环（mergeWorker）/ 其余 reject，零泄漏（supervisor-check 后 .agents/ 空）；agents-check 252 断言（pipeline 冻结语义）不变红 |
| C5 | 档位表实测校准 / 主会话路由（providerInfo 硬编码 GLM） | **M6** | §1.3 口径备案：M5 不引入价格表，「成本」= token 用量代理；M5b 步骤 6 落地后先做档位可用性抽样再承诺指标（实施 Follow-up 2） |

## 反向验证（§6.3 纪律）

| # | 故意改坏 | 断言 | 实测 |
|---|---|---|---|
| 1 | negative.json 换成正确解法 | gym-check A2 必红 | 未触发（正向控制另行冒烟通过，负向 3/3 判失败） |
| 2 | bandit 奖励取反 | routing-check B2 必红 | B2 收敛强档通过（证明 B1 非恒真） |
| 3 | maxRungs 改 99 | routing-check C2 必红 | C2 上限断言通过 |
| 4 | 去掉 Supervisor maxStages 闸 | supervisor-check B1 必红 | B1 第 6 环 abort 通过 |
| 5 | 早停短路 | supervisor-check D2 必红 | D2 cancelled≥2 通过 |
| 6 | KNOWN_TYPES 漏加 routing_decision | routing-events 单测必红 | 通过 |
| 7 | settings 白名单漏加 routingBandit | routing-check B3b 必红 | B3b 持久化通过 |
| 8 | bandit 改回 Math.random() | routing-check B4 必红 | B4 同 seed 轨迹一致通过 |

## 未证项（如实标注）

- **暗卷**：gym-run --model real / routing-check 暗卷段 / agents-check M 段——无 `M0_API_KEY` 显式打印跳过 + `UNVERIFIED=1`，不计入 pass。
- 档位模型真实可用性与「token 用量降 ≥20%」目标：需联网实测（M5b 步骤 6 校准轮，见 m5-proposal §1.3 口径备案）。

## 实施记录（2026-09-14）

- 步骤 1–5（M5a）：事件 + 靶场 + 跑器 + 门禁接线 + 基线，全绿；冻结表 +25 文件（含 3 份 script.jsonl）。
- 步骤 6–10（M5b）：registry/policy/bandit/cascade + orchestrator 路由接入（opts.routing 缺省关闭 = 老路径逐字不变）+ settings 四改 + routing-check 25 断言，全绿。
- 步骤 11–12（M5c）：supervisor 模块 + spawnRace（修候选检测 bug：seen 增量登记）+ supervisor-check 32 断言，全绿。
- 测试：59 files / 531 passed / 0 skipped（新增 routing-events 4 + routing-policy 9 + providers-M5b 5 断言；supervisor/routing/gym-check 为脚本门不计入单测文件数）。
- 已知取舍：orchestrator 路由路径的 worker 无 key 时模型调用即失败（fail-closed 于调用期而非 spawn 期，routing-check 决策面断言不受影响）。
