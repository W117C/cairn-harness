# provider BYOK 可达性：实测链、三处副本、合取判据（2026-09-23）

来源：`outputs/gap-fix-proposal-2026-09-23.md` 的 **P2-6**（跨厂商双模型「只能半跑」）。
本页 = 施工前的实测复现 + 施工后的回执。**只动 clean-vs-HEAD 的面**（providers/registry、main/provider-keys、
main/provider-key-inject、scripts/providers-check、tests/providers + provider-keys），不碰在飞文件。

## 一、实测：链是通的，入口不通，且模型自己能把 worker 开进死路

| 面 | 事实源 | 当前值 |
|---|---|---|
| 可路由 provider | `src/providers/registry.ts:23` `PROVIDER_IDS` | `["glm","openai","anthropic","gemini"]` |
| 档位表 provider | `src/providers/registry.ts` `DEFAULT_MODEL_TABLE` | 12 行 = 4 家 × 3 档 ⇒ **9 行是跨家** |
| key 存储白名单 | `src/main/provider-keys.ts:24` `PROVIDER_IDS` | `["glm"]` |
| 启动注入 | `src/main/provider-key-inject.ts:11` | 硬编码 `getProviderKey("glm")` → 只写 `M0_API_KEY` |
| 设置面通道选项 | `src/main/settings.ts:122` `PROVIDER_KINDS` + `index.html:2324` | `["demo","glm"]`（UI 两枚按钮） |

`spawn_agent` 的 `args.model` 由**模型自己填**（`src/agent/orchestrator.ts:504-510` 把它当 `pin` 交给 `routeFor`），
而 `routeFor` 的 pin 面 = 整张 `DEFAULT_MODEL_TABLE`（12 个 id 全合法）。于是跨家死路是**可达**的，不是留位：

```sh
# 复跑（本仓 HEAD 实测，2026-09-23；env 里撤掉三家 key）
TERM=dumb node --import tsx -e '… for (const id of ["anthropic-standard","openai-cheap","gemini-strong","glm-standard"])
  { const fn = toWorkerModel(resolveModel(DEFAULT_MODEL_TABLE, id)); for await (const _ of fn([{role:"user",content:"hi"}], [])) … }'
# 实测（首次取事件即抛，四家同形）：
#   anthropic-standard => THREW: ANTHROPIC_API_KEY 未设置（key 只从环境变量读取，不落文件）
#   openai-cheap       => THREW: OPENAI_API_KEY 未设置（key 只从环境变量读取，不落文件）
#   gemini-strong      => THREW: GEMINI_API_KEY 未设置（key 只从环境变量读取，不落文件）
#   glm-standard       => THREW: M0_API_KEY 未设置（key 只从环境变量读取，不落文件）
```

⚠️ **取料写法的一条自纠**：第一版探针 `await fn(msgs, tools)` 打印 `NO THROW` —— `RegistryWorkerModel`
返回的是 async generator，**不消费就不执行函数体**。改成 `for await` 逐事件消费后才出真读数。
⇒ 凡"调一下就当它跑过"的探针在本仓一律按未测处理。

三条后果，按本仓已有名字归族：
1. **门 0 可达性同族**（能力已发货、入口没通）：M6 的四家白名单 + 12 档表 + 按 provider 路由都在，
   但除 glm 外**没有任何路径能把 key 交给它**（存储白名单一家、注入硬编码一家、UI 两枚按钮）。
2. **误归因**（§9 第 0 步同族，`docs/judgment-layer-calibration-proposal.md` §9）：这是一次**配置**失败，
   却以 worker 终态失败的面出现 ⇒ 涨 attempt、喂 bandit 的 β（把"没 key"学成"这档不行"）、进失败沉淀。
3. **同族出口副本**（第七/十族的形）：`provider → env 变量名` 这件事在**三处各写一遍**——
   适配器默认值（`anthropic.ts:143` / `openai.ts:115` / `gemini.ts`）、注入面（硬编码 `"glm"` + `M0_API_KEY`）、
   判卷面（`providers-check` ⑥ 段 `DARKS` 里三条 env 字面量）。改一处即静默失配。

## 二、修法（本笔做的）与不做的

**做**：把"哪家有 key 通道"收成**一份事实源**，再让判据挂在**机制**上而不是挂在登记表上。

- 新 `src/providers/env-keys.ts`：`PROVIDER_ENV_KEYS = { glm:"M0_API_KEY", openai:"OPENAI_API_KEY",
  anthropic:"ANTHROPIC_API_KEY", gemini:"GEMINI_API_KEY" }` —— 注入面与判卷面都改读它（消掉第二、三处副本）。
- `injectStoredProviderKey(providers = PROVIDER_IDS)`：遍历白名单逐个注入到**各自**的 env 名。
  今日白名单只有 glm ⇒ **零行为**（既有 `tests/provider-keys.test.ts` 的 env 优先用例逐字不变地继续判卷）。
  形参是给判卷留的缝：判据要能问"白名单变成 4 家时注入面跟不跟得上"，而不只是问今天。
- `providers-check` 新段（合取 + 只降不升水位）：
  ① 设置面选项 ⊆ key 存储白名单 ∪ {demo}；
  ② 档位表里出现的每家 provider 必须有 env 名映射，且注入面遍历到它（**跑真函数**，不是查表）；
  ③ 「可路由但存不进 key」的集合须**逐字等于**登记水位 `{openai,anthropic,gemini}`——新增一家没登记 ⇒ 红；
     某家已开白名单却还挂在水位上 ⇒ 也红（陈旧豁免）；
  ④ 映射与适配器**实际取料面**一致：撤掉 env、不传 key，抛错消息里必须出现映射表里那个变量名。
     这一条把"表写对了但适配器其实读别的"钉死，也正是 ②③ 自己不看的方向。

**不做**（沿 `gap-fix-proposal` §三的裁决，不擅自翻）：不把 openai/anthropic/gemini 开进 key 存储白名单，
也不给它们加 UI 选项——反转条件仍是"同一靶面上跨家一次省多少 + 准确率掉多少两个数都出来"。
本笔只把这条边界从"散在三处字面量里的现状"变成"一条会红的判据 + 一份可审计水位"。

## 三、回执（施工后追加）

**改动清单（一笔原子单元：纯函数 + 用例 + 门断言 + 锚点，拆开即 HEAD 悬空）**
`src/providers/env-keys.ts`（新，事实源）· `src/providers/byok.ts`（新，缺口对账纯函数）·
`src/main/provider-key-inject.ts`（遍历白名单 + 缺映射即崩）· `src/main/settings.ts`（导出 `PROVIDER_KINDS` 供对账）·
`scripts/providers-check.ts`（新增 ⑦⑧）· `tests/providers.test.ts`（+3 用例）· `tests/provider-keys.test.ts`（+2 用例）·
`scripts/mutate-verify.mjs`（+4 锚点）。**零产品行为变更**：今日白名单只有 glm ⇒ 注入面与旧实现逐字同果。

**同口径读数（同一道门、同一条命令 `TERM=dumb pnpm run providers-check`）**：
`19 ✅ / 0 ❌ / exit 0` → **`30 ✅ / 0 ❌ / exit 0`**（+11 条断言）。锚点表 782 → 786。

**当场造红三次（每次跑完即撤销，均为真实失效方式而非形似变异）**：
① 注入面退回硬编码 glm ⇒ `❌ 启动注入面对 env 表每家真注入到各自 env 名（已注入: glm）` exit 1。
   同一次里 `可存 key 的每家都被注入面覆盖` 仍绿 —— 印证这条门**必须**按 env 表全量对账：
   只看白名单的话，旧实现永远抓不住（本仓点名的「判据在、组合面没接」）。
② 路由白名单加一家 `mistral` 不给映射 ⇒ 两条同时红（`缺: mistral` + 水位实测多出一项）exit 1。
③ 反向一侧：存储白名单加 `openai` 而水位未撤 ⇒ `❌ 「可路由但存不进 key」逐字等于登记水位` exit 1。
   （只测 ② 会漏掉「开了通道忘了撤水位」这半边，故两侧各造一次。）

**新用例第一次红的一条自纠**：我起初把「扩家漏注入」那格写成 `storable` 扩、`injected` 不动，
实测 `expected [] to deeply equal ['anthropic']` —— 是我的**夹具**取料面选错（`injected` 当时等于整张 env 表），
不是 `byokGapsOf` 说谎；改成显式 `injected: ["glm"]` 并对称补一条「白名单未扩家时该格为空」，
这才把「旧实现为什么抓不住」写进用例本身。判据修正后 58/58 绿、`tsc --noEmit` 0 错。

**探针取料的一处坑**：`RegistryWorkerModel` 返回 async generator，`await fn(msgs, tools)` 零副作用
⇒ 第一次实测的 `NO THROW` 是**假读数**；必须 `for await` 消费首事件才算跑过。

**锚点首轮跑出的一条自我纠正（`expectFail` 必须逐字抄用例标题）**：第一版四条锚点里有一条报
`❌ 测试红了但没红在期望用例「…」上——可能误伤无关用例`——红是红了，但 needle 我写成了散文，
而标题里有 `**清单**` 两个星号 ⇒ 匹配不上。修法两条一起做：① 标题去掉 markdown 星号、needle 逐字抄标题；
② 把"未登记 env 名即崩"那条断言从合并用例里**拆成独立用例**，让每条锚点各有自己的靶子
（否则两条锚点共指一条用例，红了也分不清是哪半失效）。锚点表 782 → 786 不变。

**留位（未做，不偷做）**：
- 跨家 BYOK 的开闸（把 openai/anthropic/gemini 放进 `provider-keys.PROVIDER_IDS` + UI 选项）沿
  `gap-fix-proposal` §三的裁决**不动**，反转条件不变。本笔只把那条边界变成机器可判的。
- **误归因那一半仍未闭合**：模型经 `spawn_agent(args.model)` 选到跨家档 ⇒ 现仍在 worker 终态上记一次失败
  （涨 attempt / 喂 bandit β / 进沉淀）。真解法是 `docs/judgment-layer-calibration-proposal.md` §9 的
  `verify_result.cause` / 配置类失败归因（P1-3）；其接线面 `loop.ts`、`events/index.ts`、`orchestrator.ts`、
  `distill.ts` 全是别人的在飞原子单元，本轮不碰。水位那条断言把「几家会踩这个坑」钉成了可数的数：**今天 = 3**。

