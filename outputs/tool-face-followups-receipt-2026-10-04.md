# 施工回执：四条老坑的处理（2026-10-04）

上游：[易变侧回执](tool-face-volatile-account-receipt-2026-10-03.md) §6 列出的四条。
用户 2026-10-03 指示「都需要处理」。目标树：本仓 `m0-agent-loop`（甲口径）。

**先说结论：四条里只有两条是真问题，我上一轮把 ② ③ 说重了。** 实测推翻了自己的说法，
这两条改的是注释不是代码——理由写进代码是为了让下一个人不会再去"修"它。

---

## ① 两条契约互斥 —— 真问题，已钉成可见

**事实**：`surface_account` 排在最终硬闸之前 ⇒ **有工具面 + 硬闸拦下**时盘上会留一条账；
而 `tests/final-budget.test.ts:20` 断言那一格盘上「零字节」。今天不冲突**只因那条判据的用例
不传工具面**（`surface === null` ⇒ 根本不产账）。这是先于 P0 就埋下的地雷。

**取舍：判据赢。** fail-closed 的语义是「这轮没发生」，让观测去改盘就是让它改写了一件事；
而硬闸抛的 `[context_budget_exceeded] final estimated input N; available M` 已经带足诊断信息。
⇒ 将来真出现那个组合，**该动的是事件落点**（挪到硬闸通过之后），**不是放宽那条判据**。

**做了两件事，都不改行为**：

| 改 | 位置 |
|---|---|
| 把落点注释改写成真话（不再宣称「硬闸拦下时仍留一条」是无条件保证），写明互斥点、今天的成因、以及判据赢的取舍 | `src/agent/glm-session.ts` 调用点 |
| **新增一条判据把当前真值钉住**：「硬闸拦下：有工具面时盘上留一条账」——有人给 `final-budget.test.ts` 补上工具面时，这条会先红并指向取舍说明 | `tests/surface-account.test.ts`（9 → **10** 条） |

顺带订正了一处不准确：`compaction.test.ts:481` 之外，`compact-wiring.test.ts:77` 与
`hook-precompact-producer.test.ts:232` 虽然也断言「compaction 最后一条」，但它们走
`runCompaction`，**不经本函数**。原先注释写「三条判据」是把同族断言数成了同路径数。

## ② 地图的 token 尺用 chars/4 —— **我说错了，不是缺陷**

我上一轮说「同一个 token 字有两把尺，混用会差 4 倍」。**实测不成立。**

地图注入的是**文件路径与符号名**。在本仓工作区跑三组问句（含纯中文问句）：

| 问句 | 文本字符 | 宽字符占比 | chars/4 | CJK 感知 | 比值 |
|---|---:|---:|---:|---:|---:|
| 本仓的工具面与易变侧成本 | 3,978 | 1.7% | 995 | 1,047 | 1.052 |
| fix the flaky compaction test | 3,988 | 1.7% | 997 | 1,049 | 1.052 |
| 记忆注入预算 | 3,973 | 1.7% | 994 | 1,045 | 1.051 |

**实际只差 5.2%。** 那个 3–4 倍的警告对**散文块**成立（记忆注入 / skill 重挂 / hook 上下文，
它们确实用 `text-budget.ts` 那把 CJK 感知尺），对**地图这一族不成立**。

⇒ 换成 CJK 感知只会让每张地图缩水约 5%、换不到准确度，还要牵动二分渲染的收敛判据。**不改代码。**
在 `map/render.ts` 的 `mapTokensOf` 上写清这段实测，让下一个人别把它当 bug 修掉，并点明三族不许混算。

## ③ 地图预算是 1024 而非 4096 —— **不是 bug**

`clampBudget(undefined, 128_000)` 返回 **1024**，而 `MAP_TOKENS_DEFAULT` 本来就是 1024。
生产跑的就是文档写的缺省值，`MAP_TOKENS_MAX`（4096）是**上限**——只有显式请求更大预算时才取得到，
生产从未取到过。我上一轮把常量名当成了生效值。

**只做一处零行为变化的显式化**：`glm-session.ts` 的地图调用点补 `budgetTokens: MAP_TOKENS_DEFAULT`，
让「将来要调预算必须动这一行」成为事实，而不是被一个没人注意的默认值悄悄改掉。
同时在 `map/render.ts` 文件头点明三个常量是**三种身份**（缺省 / 下限夹取 / 上限）。

## ④ `attachmentContext` 在 provider 层无界 —— 真问题，已补

**事实**：入口 `validateRunAttachments` 限的是**路径总字符**（`MAX_TOTAL_PATH_CHARS = 16_384`），
渲染后的块还要加每行包装与头尾两行 ⇒ 正常产物约 17.4k 字符。但 **provider 层零校验**——
worker / gym / 脚本 / 单测都直接构造 provider，那条闸管不到。

**后果**：超长字符串会一路走到最终硬闸才炸，报成
`[context_budget_exceeded] final estimated input N`——把「参数写错了」报成「上下文装不下」。

**做法**：provider 工厂加一道 `ATTACHMENT_CONTEXT_CHAR_LIMIT = 32_768` 的 **fail-closed** 闸
（越界直接抛，带两个数字与一句成因）。选 fail-closed 而非截断的理由写进注释：
截断出的附件清单是**残缺的**，模型会以为工作区里就那几个附件——与「工作区真的没有别的附件」同形；
抛错至少让调用方知道自己写错了。32,768 是按入口产物 17.4k 留约 1.9 倍余量，只拦绕过入口的无界输入。

两处常量是**两个量纲**（路径字符 vs 块字符），已在 `run-attachments.ts` 互相点名，不互相顶替。

**判据**：`tests/run-attachments.test.ts` 新增 1 条——恰好等于帽放行（边界本身也要有判据，
否则「> 还是 >=」是猜的）、超一字符抛且错里带得出两个数字、且错里不含 `truncated`（钉「不静默截断」）。

---

## 验证

| 项 | 结果 |
|---|---|
| 定点回归 | `surface-account` 10、`run-attachments` 7、`map-render` 5、`final-budget` 1、`compaction` 30 —— **53/53 通过** |
| 全量核心套件 | 299 文件 / 4262 用例：**4261 通过、1 失败**。失败为 `tests/loop.test.ts:197`，**非本次改动**：该文件本身干净，红在旁 session 未提交的 `src/agent/loop.ts`（其 diff 新增 `type: "verify_result"` 落盘），与该断言直接冲突 |
| `node --import tsx scripts/typecheck.ts` | 本次改的文件**零报错**。唯一报错文件 `tests/autonomy.test.ts` 为 tracked 且脏、旁 session 所有（归因器已判） |
| `node --import tsx scripts/docs-check.ts` | **受检项全绿**（3 项未检：STATE.md 不存在，迁移前属正常） |
| 实测复核 | `clampBudget(undefined, 128_000) === 1024`；地图 CJK 比值 1.051–1.052（三组问句）；provider 帽边界 32768 放行 / 32769 抛 |

## 本轮未动（明确不做）

- **`compaction.test.ts:490-497` 拿数组下标当事件 id**：任何多落的事件都会让两向断言同时错位。
  这是脆弱耦合，但改它要动判据，且今天不触发。**记下来，不动。**
- **`HOOK_CONTEXT_TOTAL_CHAR_LIMIT`（24,000）与 `MODEL_SURFACE_TOTAL_CHAR_LIMIT`（24,000）同值**：
  同值不构成耦合，两者量纲与归属都不同（hook 上下文 vs 固定面）。已在
  `model-surface.ts` 文件头点名，但**不改数值**——改任一个都是在没有读数支撑时动一顶帽。