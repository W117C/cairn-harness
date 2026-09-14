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
| B5 | 级联升级（verify 门控 / maxRungs 有界 / fail-closed） | **已证** | `routing-check` 段 C（C1 恰好升级一次 / C2 maxRungs 上限 / C3 无 verify 不升级 + 显式说明） |
| B6 | 真多 provider 拨号 / 价格表 / bandit 运行时接线 | **M6** | §4.3 权衡：单 provider 多档位（零新依赖/零新 key 面）；registry 预留 `provider` 字段 M6 开白名单零重构；档位模型名为占位，M5b 步骤 6 实测校准（见 Follow-up 2） |

## M5c：编排自适应

| # | 项 | 状态 | 证据指针 |
|---|---|---|---|
| C1 | 受限 Supervisor：封闭动作枚举 + 有界三重保险（maxStages / 预算闸 / 防死循环） | **已证** | `supervisor-check` 段 A（任意输入 → 枚举，畸形 → escalate）/ 段 B（B1 永远 fail → 第 6 环后必 abort / B2 第 3 次出现 → escalate）；src/agent/supervisor.ts 纯规则 V1 |
| C2 | Best-of-N 竞争编排 spawnRace（N≤3 / judge 命中早停 / 复用取消链与成本闸） | **已证** | `supervisor-check` 段 C/D（C 选中全绿者 + 早停触发 / D 其余终态 cancelled + accountable usage 严格小于跑满 80<1080） |
| C3 | gate/loopback 留位闭合 | **已证** | `docs/m3-acceptance.md` 九之 2 改「已证」，证据指针 supervisor-check 段 B |
| C4 | supervise 模式运行时接线（AgentMode 扩 supervise + 审批卡双轨 {goal,budget,forbidden,maxStages} 落地编排器/渲染面） | **M6** | 理由（诚实留位）：这是 M5 中爆炸半径最大的改动面——动审批卡即动 M3c 冻结语义（§5.1 最高风险），agent-plan 门禁要求合并即全绿；已交付双轨契约形态与摘要（supervisor-check A3 + src/agent/supervisor.ts SuperviseApprovalContract），编排器 spawn 路径与渲染接线留 M6 单独一轮，不在同一 PR 里赌既有 23 道门 |
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
