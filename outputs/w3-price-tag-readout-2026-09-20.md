# W3②「价格标签」落地读数（2026-09-20）

spec `docs/superpowers/specs/2026-09-19-orchestration-design.md` §5 W3 与 §11 item 7 的未做项②
（「spawn 回执与终态结果带 `spent_usd`」）。本轮把它接上，并量了体积代价。

## 1. 改了什么（一句话）

worker 的钱此前**只喂 bandit**：`costUsd(w.routeModelId, w.usage)` 在 `rewardBandit` 里算完即丢，
派工时模型看不到单价、收队时看不到花了多少、终态结果里也没有机器可读的花费。
现在三个面都有：

| 面 | 字段 | 消费者 |
|---|---|---|
| spawn 回执 | `"price": "模型 glm-5.2｜档 glm-standard 表价 $2/$2 每百万 in/out（表价未标定·不可当省钱证据）｜本会话 worker 累计≈$0.0123"` | 主模型（派工决策当场） |
| `agent_result.artifacts` | `spent_usd` + `price_calibrated`（done / **failed 都带**） | 合并塔 / G-A 的 `$/成功任务` / 审计 |
| `wait_for_agents` payload | 每行 `spent_usd`、`price_calibrated` + note 整批合计 | 主模型（收队后复盘） |

价格只有一个事实源：`src/routing/pricing.ts` 的档位表 + `costUsd`。没开路由时按 worker **真实会用的模型名**
（`glmDefaultModelName()` = `M0_MODEL ?? glm-5.2`）反查档位，复用既有的 `findSpecByNameOrId`——
没有新建第二份反查表，也没有新建第二张价表。

## 2. 「不可知」不是 0（本轮唯一的设计红线）

三处宁可留空也不报 $0：

- `scriptedWorkerModel` 打了 `scripted: true` 标（`WorkerModel` 上的可选自述字段）。
  冻结剧本不拨号、不付钱 ⇒ `price = null` ⇒ 回执写「价格未知（脚本回放或未注册档位；不记为免费）」，
  `artifacts` 不带 `spent_usd`，收队行不带。**若这里报 $0，checks/demo 的轨迹就会长成「worker 免费」的样子**，
  而 demo 面正是打包后主对话的缺省 provider（`resolveProviderKind` 缺省 demo）——假绿的入口比想象近。
- 模型名反查不到档位（`M0_MODEL` 设成表外名）⇒ 只报模型名，不报价。
- 整批合计：全未知 ⇒ `joinPriceNote` 返回 `null`（不印「合计 $0」）；部分未知 ⇒ 明写
  「另有 N 个 worker 价格未知未计入」。

被整批帽（2400 token）摘掉摘要的行**仍带花费**——帽摘的是散文，钱是判分工值不值的读数
（锚点 `join-degraded-row-loses-spent`）。

## 3. 体积代价（实测，`estimateTextTokens` 同尺）

| 读数 | 值 |
|---|---|
| 回执 price 一行（已知档） | 82 chars / 143 bytes / **43 token** |
| 回执 price 一行（不可知） | 22 chars / **22 token** |
| 4-worker 收队 payload | 310 → 394 token ⇒ **+84 token / 次收队** |
| 其中整批合计一行 | 39 token |

对照量级：一个 worker 一轮上下波动辄 1–2 万 token；`+84 token` 是它的 ~0.5%。
且这两处都不是每轮重送的静态段（回执/payload 各只出现一次），与 W3 第一段的
「静态段 +269 字节/每请求」不是一笔账。

## 4. 这些数字**不能**用来宣称什么

- **不能当省钱证据**：GLM 三档单价在 `DEFAULT_PRICE_TABLE` 里仍是占位数（`calibrated` 未打标，
  定价页 JS 渲染未取到数）。`price_calibrated:false` 就是为这条而存在，文案里也写明。
  「标为待校准，联网实测后填」的裁决不变。
- **是上界不是账单**：worker 的 usage 只有 in/out 两桶，不分列缓存块 ⇒ 缓存段按输入价上界计。
  开了 `promptCache` 的 Anthropic 档会**高估**（与 bandit 代价项同一偏置，见 pricing.ts 文件头）。
- **不证明任何准确率**：本轮只加读数、不改决策。`$/成功任务` 要 G-A 出数（仍需 `M0_API_KEY`）。
  不得据本文说「调度更聪明」。

## 5. 顺带量到的一条现状（未改，已开任务）

按真实模型名反查档位时暴露：**未开 `routing` 的 worker 恒走 `defaultWorkerModel` = streamGlm**，
不跟随 `settings.model` / `M0A_PROVIDER`（`orchestrator.ts:2045` `opts.model ?? defaultWorkerModel`，
而 `agent-runner` 只在 `routingBandit` 开时才传 `routing:true`）。⇒ 用户选了 OpenAI 时，
主会话打 OpenAI、worker 仍打 GLM；若 `M0_API_KEY` 是 OpenAI 的 key，worker 第一跳即 401。
本轮**只让它可见**（回执现在写明 worker 真实模型名），没有改行为——那是独立裁决：
「worker 是否必须跟随会话档位」。

## 6. 验收

- 测：`tests/worker-spent-usd.test.ts`（12 条：反查唯一源 / env 副本不漂移 / 折算与标定 /
  不可知≠0 / 三个面真的接上 / 整批账）。
- 锚点：9 条（`spent-usd-unknown-as-zero`、`spent-usd-claims-calibrated`、`price-tag-silent-when-unknown`、
  `join-note-hides-unknown-count`、`join-degraded-row-loses-spent`、`receipt-drops-price-line`、
  `price-resolver-skipped`、`scripted-marker-never-set`、`glm-default-name-ignores-env`）。
  另把 `join-degraded-row-vanishes` 的针脚改指到加了 `...spent` 之后的那一行（改判据不放宽）。
- 邻面回归：`agents` / `m3a` / `m3b` / `orchestrator-join` / `worker-evidence` / `bandit-runtime` 共 85 条全绿。
- 后续加固（`9091480`，写完后自查发现的自家缺陷）：档位表与价格表是两张手写的表，只由 `priceCoverage()`
  （routing-check）对齐；原来 `spentUsdFor` / `priceTagText` 直接吃 `priceOf(id)`，一旦两表漂移就**抛错**，
  而它挂在 `finishInner` 的终态事件之前——"算不出钱"会把"交付已完成"一起炸掉。现按 `appendImpact` 同纪律：
  查不到价 / 非有限花费一律退回「价格未知」并 `console.warn` 出声（不静默吞）。测 +2、锚点 +2。
- 探针脚本：`/tmp/w3-size-probe.ts`（一次性，不入库；数字照抄自它的输出）。
