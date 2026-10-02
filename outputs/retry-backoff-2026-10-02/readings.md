# 有帽重拨（能力 4 落在度量台上）取证 · 2026-10-02

三笔一簇：`44c71d8`（机制＋13 判卷＋4 锚点）→ `7cc9605`（修上一笔造成的两处红，其中一处是真缺陷）。
这条线对应业主第 4 条「遇到失败能重试、换路径，而不是卡死」，落点在**基准跑器**——
不是主 loop（主循环"绝不停闸"是既有裁决，见 [[dsh-loop-repeat-blindspot]]）。

## 一、为什么这一格非做不可（现读）

`outputs/bench-reps3-2026-10-02/readings.json`（36 趟真跑）：

| 读数 | 值 |
|---|---|
| 总趟数 | 36 |
| `requests=0`（未起步） | 32 |
| provider 侧打断 | 33 |
| `g.fails` 里带 `X-RateLimit-Reset` | **0** |
| `r.exitError` 里带 reset | **33／33** |

⇒ 修前的机制即使写好，**帽那一档命中 0/36**：`grade` 把 exitError 截到 60 字（`loop-eval.ts:505`），
reset 在 150 字往后。这就是规则 356 那条「加一档之前先量这一档能被喂到几次」。

## 二、机制（`scripts/lib/eval-retry.ts`）

四态判据 `retryVerdict(fails, attempt, {nowMs})`：
① 非 provider 打断 ⇒ **不重拨**（模型自己干坏事不给第二次机会；同一份 fails 在分母那头判「算数」）；
② 到帽（缺省 3 趟）⇒ 停，并印「已拨到第 N 趟（帽 3）」；
③ 端点给的 reset 在帽内（≤5 分钟）⇒ 就等它给的时长；reset 已过 ⇒ 不等直接再拨；没给 reset ⇒ 等基础 20s；
④ reset 在帽外（日配额）⇒ **判不重拨**，并把「要等多久」这个数说出口
   （判卷里那个 `1516427 分钟` 是我造的假 NOW 算出来的，只为把算术钉住；
   真语料那次 reset 是 `2026-10-03T00:00:00Z`，距 10-02 那趟约 **1200 分钟**＝20 小时）。
执行壳 `withProviderRetry` 把 `attempts / waitedMs / stoppedWhy` 当**返回值**交回，跑器印进逐趟读数
（`拨数=` 与 `〔重拨账：…〕`）——次数不印出来，「退避有效」就只是说法。

## 三、5 条锚点逐条杀（HEAD `7cc9605`，`anchors-at-7cc9605.log`）

`✅ retry-retries-model-failure`（坏行为也重拨）·`✅ retry-wait-cap-dropped`（去掉等待帽）·
`✅ retry-max-attempts-blind`（判据不看帽）·`✅ bench-retry-not-wired`（跑器摘掉 exitError 那半）·
`✅ retry-reset-read-from-truncated-face`（reset 只读被截断那条）——汇总行 `全部变异被正确杀死（断言非恒真）`。

## 四、上一笔（44c71d8）认证**失败**的两条红，与它们各自的性质

`head-cert.log` 原文：`Test Files 1 failed | 278 passed (279)｜Tests 1 failed | 3737 passed (3738)｜exit=1`，
红的是 `prose-needle-scan`「真仓读数必须在帽内」：**顶包候选 12（已提交 12 ＋ 在飞 0）> 帽 10**。

1. **措辞撞针脚**（我的账）：新写的 `... 分钟才放行，超过帽 ...` 撞上既有判卷 `head-cert-deps:525` 的「超过帽」；
   而 `eval-retry.test.ts:47` 断言 `toContain("分钟")` 本身在生产面有 3 处 ⇒ 改哪一处都不响。
   修法：生产措辞改「超出可等待上限」；判卷改成**自己算出来的数位**
   （`QUOTA_WAIT_MIN = round((reset-NOW)/60000)`）⇒ 测试里不留任何生产原话，改算法照样红。
2. **为什么主树预检没抓到**（工具边界，规则 355）：这把尺的生产面取料是 `git ls-files`
   （`scripts/prose-needle-scan.ts:613`）⇒ 我那两个新文件当时**未跟踪**，对它不存在。
   ⇒ 教训不是"下次注意"，是：带新生产文件的交笔，绿色必须以**已入库态那棵树**的读数为准。

`7cc9605` 的复跑读数见 `head-cert-7cc9605.log`（跑完补数）。

## 五、仍未证的（别当已闭）

- **一次真收益没量**：今天免费档日配额已满 ⇒ 「重拨把某趟从 0 请求救回来」没有被观测过。
  已证的只有判据与接线（假时钟、假 sleep）。挂成任务 #10：配额窗口内跑 12×3，
  看 `拨数>1 的趟数`／`被救回的 0 请求趟`／`有效分母是否从 3/36 抬起来`。
- 日配额这一档在**帽外 ⇒ 不重拨**是设计选择（不坐等 25 万分钟）；如果业主希望"到点自动续跑"，
  那是另一格（要一个跨天队列），当前没有。
- 台账页 `PROGRESS.md` 未落（热串行点，归整合的那笔）。

## 六、顺带清掉的两处过期文案（同簇第二笔）

| 位置 | 从前写的 | 现读 | 处理 |
|---|---|---|---|
| `src/agent/plugins/skills.ts:55` | 「静态 10 把 ＋ 运行期注入 **13 把**」 | `INJECTED_TOOLS` **16 条**（逐条数过） | 去掉数量、点名两份唯一清单；第 121 页那条历史结论保留但标成"当时 13 把"，并说明它钉的是**形状**不是数量 |
| `.github/workflows/verify.yml:31-33` + `scripts/ci/README.md:26-34` | 排除 `gate-check`／`mutate-needles-check`「两道已知红」 | 认证树 `绿 22 道`、`✅ mutate-needles-check exit=0` ⇒ **两道都绿了** | 名单加回（`--only` 显式 22 道），README 那一节从"现状"改成"结案登记" |

名单与 `CERT_GATES` 的**集合相等**是脚本核的，不是眼估：两边各 22 道、双向差集为空
（`CERT_GATES` 条目是 `{name, budgetMs}` 对象，比对要取 `name`——直接拿数组比会得到 22 个 `[object Object]`，
这也是"集合相等"这类断言最容易糊过去的一格）。

⚠️ 这笔**改变不了 CI 从没跑过这件事**：本仓没有 git remote ⇒ workflow 的 push/PR/dispatch 三个触发器都够不着。
所以这里只是"名单不再谎报红灯"，真正的兜底仍然是本地 `head-cert`。接不接远端是业主裁决项。
