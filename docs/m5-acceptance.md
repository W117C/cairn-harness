# M5 验收状态

> 更新：2026-10-11。这里的 M5 指 [`m5-proposal.md`](m5-proposal.md) 中 2026-09-13 的「结果信号回流」提案，不是 2026-10-01 路线图里的 M5/M6。
> 本页记录当前可复跑的工程证据；scripted 门禁通过不代表真实模型效果已达标。

## 当前证据

| 范围 | 证据 | 状态 |
|---|---|---|
| M5a 靶场、反例控制、确定性与分叉 | `pnpm gym-check`：33 通过、0 失败；冻结的 4 个 case 正向通过，反例均失败 | 工程判据通过 |
| M5b 路由、bandit、级联与价格表 | `pnpm routing-check`：39 通过、0 失败 | 工程判据通过 |
| M5c Supervisor、有限重试与 Best-of-N | `pnpm supervisor-check`：81 通过、0 失败 | 工程判据通过 |
| 真实模型暗卷 | `gym-check` 因缺少 `CAIRN_API_KEY` 显式跳过 | 未验证，不计通过 |

## 效果目标

`fixtures/gym/baseline.json` 的 scripted 基线记录于 `2026-09-19T01:15:39Z`：4 个 case 成功率 100%，总计 1,416 tokens。2026-10-11 运行
`node --import tsx scripts/gym-run.ts --all --compare fixtures/gym/baseline.json` 后仍为 1,416 tokens、成功率 100%。因此：

- 提案要求的 token 用量下降至少 20%：**未达成**，当前 scripted 读数下降 0%。
- 成功率不低于基线：**scripted case 达成**；不能外推到真实用户任务。
- review-fail 的生产自愈率至少 50%：**已可测量，未达成**。复跑尺 <!-- replay:effect-sampler -->（2026-10-14，140 个 jsonl）
  读出 5/17 = 29%——分母是「出过红灯的轮」，不含没红过的轮。`supervisor-check` 的 81 条绿证的是规则与边界，
  不是这个发生率；这一格现在有分母了，不再是非真非假的第三态。
- 所有生产 spawn 都留下路由决策：**分母有了，分子为 0**。同一支读出 0/12 = 0%，且整批语料
  `routing_decision` 事件 0 条 ⇒ 读数是「路由在生产路径上一次都没上场」，不是「上场了却漏记」——
  这两件事的修法相反，别读串。此前「只有测试路径已覆盖」的说法保留：测试面由 `routing-check` 证。

## 后续验收

1. 保留现有基线，不用新结果覆盖它；新增或扩充代表真实任务的冻结 case 后，单独记录新基线和前后差异。
2. 在有可用 `CAIRN_API_KEY` 的环境复跑暗卷，并把跳过改为实测结果。
3. 收集真实任务的 verify、token 与路由事件样本，再判断 20% 用量目标和生产级路由覆盖率。
4. 上两格的读数随语料增长而变，引用时必须连日期与文件数一起引（`replay:effect-sampler` 自己会印）；
   路由那一格在跑过一轮 `routing:true` 的编排会话之前，恒读 0/12 这个形状。
