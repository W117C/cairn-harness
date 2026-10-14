++
# 第 483 页取料：M5 两格从未测量变成读数 + 一条活了很久的变异锚点

出证 2026-10-14；工作树 `/Users/ze/Downloads/Cairn/deepseek harness`，分支 `zcode`，HEAD `a450b0f8`。

## 1. 这一页的入口不是计划，是一次假绿

全量判卷跑出 1 条红：`tests/acceptance-sampler.test.ts` 的
`expect(formatRate(...)).not.toContain("0%")` 红在
`'自愈率：不可测（分母 0 ⇒ 不许折成 0%）'` 上。

一句话：**那句话自己声明「不许折成 0%」，同时把 `0%` 印了出来。** 三态纪律（读到 0 与没有尺
是两件事）在这条文案上自我否证。改成「这一格没有尺，读数不是零」。

反向验证（见 `repro.log`）：把文案磨回旧写法 ⇒ 同一条断言立刻红 ⇒ 判据有牙，不是恒真。

## 2. 顺着这条线挖到的第二个缺陷（更贵）

`routingDecisionCoverage` 的 join 键读的是 `agent_spawned` 事件上的 `routing_decision`
**字段**；而生产侧它是**独立事件**，先 emit 决策、再 emit spawned，两者按 `agent_id` 一对一
（`src/agent/orchestrator.ts:776`，`src/events/index.ts:457` 的类型里根本没有那个字段）。

⇒ 按字段读，**真实语料里恒为 0**，而且读出来的是形状错、不是「路由没上场」。
实测：140 个 jsonl、152 条流、12 次 spawn，`routing_decision` 事件 **0 条**。

判卷同步改钉真实事件形状，并补两条：跨 id 不配对、同一 id 多条决策只算一次。
反向验证：把 join 键磨回字段读法 ⇒ 那两条当场红。

## 3. 采样器此前零消费者 ⇒ 立复跑面

`src/agent/acceptance-sampler.ts` 两个采样器写完之后**没有任何消费方**——本仓点过名的
「只有验收脚本在调」那一族。没有复跑面，`docs/m5-acceptance.md` 那两格就永远停在
非真非假的第三态。新面 `replay:effect-sampler`（`scripts/replay/effect-sampler.ts`）：

- 自检 10 格（合成对照：该抓的抓到 / 反控不被抓 / 裁决两条反向分支各走一次）；
- 三态守卫同 join-lapse / run-scorecard：零语料、两格都没分母 ⇒ 红着退出说「不可测」；
- **池化不取均值**：按文件取均值会让一个 1 轮的文件与一个 17 轮的文件等权，
  读数随文件粒度漂移（用例里用 1/1、0/1、1/2、1/3 四份把两种算法分开：池化 3/7=43%，
  文件级均值 46%）；
- 分辨力格：分母在而 `routing_decision` 事件 0 条 ⇒ 明说「路由没上场」，不说「漏记」。

读数（`reading.log`，140 个 jsonl）：

| 格 | 读数 | 判定 |
|---|---|---|
| review-fail 自愈率 | 5/17 = 29% | M5 目标 ≥50% ⇒ **未达成**（第一次有分母） |
| 生产 spawn 路由决策覆盖率 | 0/12 = 0% | 路由在生产路径上一次都没上场（≠ 漏记） |

## 4. 一条活了很久的变异锚点（本页最实的一格）

全表变异抓到 1 条存活：`scripted-flag-equals-form-dropped`。根因不是判据松，是
**apply 打在死代码上**：

```ts
const scriptedEq = argv.find((a) => a.startsWith("--scripted="));
const SCRIPTED = scriptedEq !== undefined ? scriptedEq.slice("--scripted=".length) : pick("--scripted", "");
```

而 `pick` 的头两行本来就认 `--flag=value` ⇒ 那一支三元与 `pick` 的结果**恒等**。
磨掉它行为一字不变，判卷当然全绿 ⇒ 变异「存活」，而代码其实是好的。

修法分三步（缺一步都不算修完）：

1. 删掉那支死代码，`SCRIPTED = pick("--scripted", "")`，并把「`pick` 两种写法都认」
   写进注释——原注释写的是「`pick` 只认空格写法」，与事实相反；
2. 锚点改打 `pick` 的取键处（`pick("--scripted ", "")` ⇒ 等号支整个失效）；
3. 判卷补一条问「等号写法有没有**真的拿到**值」。

第 3 步踩了一次自己的坑，写下来因为它不是手滑：第一版判据问「两种写法的输出是否
逐字相同」——值一起失效时两种写法**同时**掉进空值闸，输出当然一字不差 ⇒ **那条断言恒真**，
变异照样存活（`survived` 二次复现）。改成问值有没有真进来：缺文件那句回显的路径就是证人
（拿不到值就不会走到缺文件闸），并补空值闸的反向格。

实测（`mutate-anchor.log`）：磨掉 `pick` 的等号支 ⇒ 5 条红，含新补那条；锚点在干净 worktree
里 `✅ 全部变异被正确杀死`。其间还撞了一次 `misattributed`（红了但没红在点名那条上）
⇒ `expectFail` 标题同步到改后的用例名。

## 5. 读数

- `pnpm gates`：**34 / 34 绿**（含 `mutate-verify` 1557 条全杀、`head-cert-check`
  373 文件 5323 条，且认证面明示判卷四面与 HEAD 逐字一致 ⇒ 本表即 HEAD 认证）；
- 核心判卷 373 文件 **5323 条**（＋13）；桌面 17 文件 **173 条**；typecheck 0 报错；
- `--check-needles` 1557 条｜阻断 0｜钉在飞文本 0（`needles.log`）；
- 门表另有 **9 项未证**（连网/凭据限制：`gate-check` 1、`docs-check` 3、`autonomy-check` 1、
  `compaction-check` 1、`provider:check` 1、`plugins-check` 1、`gym-check` 1）——不等于通过。

## 6. 仍未证（不许读成绿）

① 自愈率 29% 是**结构推导 + 判据验证**，没有运行时复现另一条真实会话（语料是既有的 140 份）；
② 覆盖率 0/12 只证明「这批语料里路由没上场」，**不证明生产路径永远不上场**——
   反转条件是出现一轮 `routing:true` 的编排会话；
③ 真模型/生产行为未跑（`gym-check` 的暗卷仍因缺 `CAIRN_API_KEY` 跳过）；
④ `mutate-verify` 全表这一次是绿的，但它量的是 HEAD；工作树后续每笔改动都要重证。
