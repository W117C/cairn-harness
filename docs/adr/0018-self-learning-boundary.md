# ADR 0018：自学习面能力地图与边界（四套并行不合并，词汇与流向钉死）

- **状态**：**Accepted**（2026-11-19，业主统一授权；裁决基于当日对四套模块头注释与消费面的逐一定证）
- **日期**：2026-11-19
- **依据**：第 1330/1331 页审计 D2「自学习四套并行，同一对标（AWM/Voyager）两份实现」。

## 能力地图（每套一句话，全部经源码头注释核实）

| 能力 | 真身 | 治理 | 落点 | 消费者 |
|---|---|---|---|---|
| 负向教训 | `src/agent/memory/lessons.ts` | 复现 ≥2、每条带证据指针（callId+session） | project 记忆 | M7 RECALL / 注入面 |
| **正向快路**（打法） | `src/agent/memory/workflow.ts` | 复现 ≥2 且每次绿 verify；签名不带值 | project 记忆（`workflow-<hash>`） | M7 RECALL |
| **正向慢路**（技能） | `src/agent/evolve/skills.ts` | 同签名 Episode 聚合 → **candidate** → shadow → 实验 → SEMA → 才可 active | playbook 条目 | evolve 实验漏斗 |
| 策略补丁闭环 | `src/agent/evolution/`（signal→advice→patch-gates） | 阈值单源（COST_PER_BOUNDARY_LIMIT 只在 signal.ts） | 路由/压缩/停止建议 | session-provider 装配 |
| 进化面宿主 | `src/main/evolution/`（canary/registry/evaluator/installer） | canary 四态、权限 broker | shadow/实验宿主侧 | evolve/evolution 引擎 |
| evolve 线宿主 | `src/main/evolve/`（实验/晋升/退役 CLI 面） | 预注册实验、Pareto | 候选→active 的宿主 | playbook |
| 计数摘要 | `src/agent/distill.ts` | 无结构，喂模型自由总结 | 提示词 | 模型面 |

## 裁决

1. **不合并**：正向两条腿的差别**不在产出物**（都是"复现+绿验证"的工具序列），在**治理漏斗**——
   快路写记忆（M7 直接可命中），慢路过实验（candidate→shadow→SEMA 才常驻）。合并 = 把记忆面与
   实验面焊死：实验面故障会拖累记忆面，反之亦然。两个消费者、两种生命周期、两套故障半径。
2. **词汇单源延伸（ADR 0017 规则适用）**：「打法（workflow）」「技能（skills）」「教训（lessons）」
   三个词的定义权：打法/技能的判据字段（复现数、绿验证、签名形状）收敛在各自模块头注释
   （本 ADR 是总图）；**不许在第三处再写一遍判据**（抄判据 = 第二事实源）。
3. **禁止第三条正向蒸馏腿**：任何新的"从成功轨迹提炼 X"需求，先答「它该走快路还是慢路」——
   答不了的（两种都要）= 两条路各缺一格判据，先补那格，不是开第三条腿。
4. **负向面维持 lessons/distill 双出口**（distill.ts 头注释已自裁：两个消费者、两种形状、两种
   生命周期，合并只会让提示词里长出结构化字段）——本 ADR 复核后维持该裁决。

## 后果

- 新人问「为什么有两套 AWM」有了单点答案：治理漏斗不同，故障半径隔离。
- 二阶影响：正向知识从快路（记忆）毕业到慢路（技能）的**晋升通道**目前不存在——一个打法要
  变成常驻技能须重走 candidate 漏斗。刻意保留：晋升通道是实验设计问题（§证据纪律），不是
  接线问题，等有"同一打法两条路打架"的实测案例再立 ADR。
