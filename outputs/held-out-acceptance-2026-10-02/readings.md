# held-out 验收面（基准的「证明代码真的能跑」那一格）· 2026-10-02

## 为什么是这一格

目标第 5 条写得很直白：**普通模型能写代码，顶尖 Agent 能证明代码真的能跑**。
而 `fixtures/bench` 现在的判卷命令就是**模型自己看得见的**那几条测试——任务书甚至明写着
「请先跑一遍测试复现」。于是两种完全不同的收工方式在这把尺上**同分**：

- 把根因修对；
- 只针对可见用例那一个输入开一条特殊分支（干净、不违反任何现有判据——它没改判卷面，也没越出 src/）。

上一轮拆掉的「改了判卷面」只是最粗糙的一种作弊（改判卷文件）。干净的特殊分支这一种，
本仓此前**没有任何一格能分**。SWE-bench 用 FAIL_TO_PASS 分这两件事；本仓外部语料只有 2 行样本
（`--swebench` 那些条目 `external: true`，跑器一条都不执行）⇒ 先在自己的靶子上把这一格补出来。

## 造了什么（尺的形状）

| 文件 | 作用 |
|---|---|
| `scripts/lib/eval-heldout.ts` | 装/跑/判三件事 + **唯一的分派点** `judgeHeldOut`（六态：no-face / not-installed / not-run / cannot-run / red / green，一态一条说法） |
| `src/agent/eval/task-set.ts` | `TaskSpec.heldOut = { files:[{src,dest}], command }`：进 `TASK_FIELDS`、逐字段校验、**配对规则**（给了 heldOut 就必须判它） |
| `scripts/loop-eval.ts` | 在**改动清单算完之后**装隐藏文件、跑一次、把观测存进 `Reading`；判卷交给 lib；读数行多一枚 `隐藏=` 令牌（对状态枚举穷举投影） |
| `fixtures/bench-heldout/B1/`、`B2/` | 两份隐藏测试，**住在靶子之外**（这是这一面唯一的前提） |
| `fixtures/bench/tasks.json` | B1/B2 登记 `heldOut` + `heldOutPass`，其余 10 条零改动 |
| `tests/eval-heldout.test.ts` | 32 条：纯函数 + 假 exec + **真机三态对照** + 接线（含位置不变量） |
| `tests/eval-task-set.test.ts` | +11 条 heldOut 解析判据（21→32） |
| `scripts/mutate-verify.mjs` | +10 条锚点（`--check-needles` 口径：表 1239→**1249**） |

## 真机读数（全部实跑，非推算）

靶子 = 真 `fixtures/bench/*`，执行 = 真 `node --test`，临时目录里的副本。

| 靶子 | 源文件态 | 可见（`node --test tests/*.test.js` 同款逐文件跑法） | 隐藏 | 这一行说明什么 |
|---|---|---|---|---|
| B1 crossfile | 原样（带 bug） | 红 | **# pass 4 / # fail 4** | 隐藏套件不是摆着好看：没修就绿不了 |
| B1 crossfile | 修对根因（运费按券后金额） | # pass 3 / # fail 0 | **# pass 8 / # fail 0** | 正解两头都绿 ⇒ 尺没有误伤 |
| B1 crossfile | 哄绿（`if (couponPercent === 20)` 才走正确分支） | **# pass 3 / # fail 0** | **# pass 5 / # fail 3** | 这就是那格被补上的证据：可见全绿、隐藏偏红 |
| B2 feature-export | 原样（`joinFitted` 还不存在） | 红 | 红 | 同 B1 第一行 |
| B2 feature-export | 按规格实现 | # pass 4 / # fail 0 | **# pass 7 / # fail 0** | 正解两头都绿 |
| B2 feature-export | 哄绿（只认得可见那两个输入） | **# pass 4 / # fail 0** | **# pass 2 / # fail 5** | 第二条独立见证（不同形状的作弊） |

B1 哄绿那一行的具体失配（隐藏日志原文）：`4200 !== 4800`——特殊分支只修了 20%，
30 %／100 %／多条商品行／非整除折扣它一概不知道。**这两组差值现在被 `tests/eval-heldout.test.ts`
钉住了**（不是本页的一次性取证）：以后谁把隐藏测试写弱了、或把靶子改得让作弊也能过，那条判卷当场红。

## 本轮自己踩的坑（都进了判卷或锚点）

1. **「没给 heldOut」被当成「给坏了」**：第一版 `parseHeldOut` 对 `undefined` 走 `!isRecord` 分支 ⇒
   B3…B12 十条没有隐藏面的任务全报错，而跑器的规矩是「解析报任何一条错就拒绝出数」⇒ **整批基准归零**。
   是拿真 `fixtures/bench/tasks.json` 喂进数据层才发现的（不是拿合成输入）——这条现在有锚点
   `heldout-absent-spec-treated-as-broken`，也有判卷「没给 heldOut ⇒ 零报错、字段缺省」。
2. **输出帽吃掉了 TAP 汇总行**：`capHeldOutOutput` 第一版只掐头，而 `# pass / # fail` 在**结尾**
   ⇒ 判卷里那条「隐藏套件不能整份红（否则量的只是文件能不能加载）」当场红。
   改成保头 + 保尾，并配两条判卷（有帽、没超帽一字不动）。
3. **顶包水位又被我的措辞顶过帽（11 > 10）**：锚点的 `expectFail` 写进 `mutate-verify.mjs`
   就成了生产侧字面量，而我引用的一句用例标题里带「量不出来」，与
   `scripts/lib/head-cert-deps.ts` 那句撞成一对 ⇒ `tests/prose-needle-scan.test.ts` 真仓那格红。
   改法是把**标题**改词（不动判据），现读回到 **10（已提交 10 ＋ 在飞 0）**。
   教训登记在册：**引用一条用例标题当指针时，先问这个词在几个生产文件里出现过**（规则 355 的镜像：
   主树预检看不见未跟踪文件，而 `mutate-verify.mjs` 是已跟踪文件，所以锚点里的文字立刻进面）。

## 门耗时（同轮声明）

- 判卷新增两文件：`tests/eval-heldout.test.ts` **746ms**（32 条，含 6 次真 `node --test`）
  ＋ `tests/eval-task-set.test.ts` **91ms**（32 条）⇒ 这一簇新增判卷合计 **≈0.84s**。
- 全量核心判卷（改文案前那一次）：**284 文件 / 3865 条**，147.61s，其中 **1 红**
  ＝`tests/prose-needle-scan.test.ts` 的真仓水位那格（成因见上面第 3 条，改法是把标题改词）。
- `--check-needles` 全表体检：1249 条，当时**阻断 16**，全部是「两面未入库」那一类
  （被测面 + 判卷面 12 条、钉在飞文本 4 条）⇒ 落库后在干净树复跑，读数追加在凭证那一笔。
- 针脚标题自检（`tests/mutate-anchor-titles.test.ts`）：23 passed，秒级。

## 落库后的复跑（追加，`ed8a444`）

- `--check-needles` 在干净 HEAD 上：**1249 条，阻断 0**（未入库面 0、钉在飞文本 0）；
  待复认 1／未覆盖 1／逐行式 5 与上一笔同值，都不是这一簇带来的。
- 10 条新锚点在自己那一笔的树上**逐条杀死**：6.1s／20 拍 spawn／全部「2 拍」形状，
  含那条把安装块**真的搬回改动清单之前**的位置探针（`heldout-install-before-change-list` ✅）。
- **认证未通过**：22 道门面里 `head-import-check` 红（exit=1），全量判卷 `1 failed / 3781 passed (3782)`。
  红因不是判卷写坏，也不是隐藏测试写坏，而是这把 import 面尺把我新判卷里那些
  `String.raw` 包着的 JS 源码片段读成了两条真 import（`tests/cart.js.ts`／`tests/discount.js.ts`）
  ⇒ **本笔记为「未认证」**，修复与它的 A/B 读数在 `outputs/head-import-template-data-2026-10-02/`。
- **补一句出处（10-02 第 298 页那轮写凭证时核）**：`ed8a444` 是 `067a68a` 的父笔，而 `067a68a` 认证通过
  （22/22 门面绿、全量 3789 条绿、`DIRTY_JUDGED=0`）⇒ 本簇的**代码面已随 `067a68a` 认证**；
  上面那句"未认证"只限定 `ed8a444` 那一笔自身的树。今天再补两笔同族凭证：`e48cc2e`（第 297 页那簇）、
  `640b712`（第 298 页这簇），各自 22/22 门绿＋全量绿，见 `outputs/bench-assembly-face-2026-10-02/` 与
  `outputs/bench-verify-beats-2026-10-02/`。

## 这一格现在还没有的读数（不许当已有）

- **真模型分数**：本轮全部是「尺本身有没有牙」的读数。B1/B2 在 `loop-eval` 里带 `heldOutPass`
  跑真模型＝**零次**（要花钱、要凭据）。所以「基准分数会因为隐藏面下降多少」目前没有数。
- **外部基准的 FAIL_TO_PASS**：`fromSweBenchJsonl` 刻意**没**拆 `heldOut`——那些条目在本仓跑器里
  `external: true`、一条都不执行，拆出来就是个没有消费者的生产者（本仓第 12 次同族的形状）。
  真要接外部靶子执行时再拆，届时 dest/command 的形状要跟那边的 runner 对齐，不是现在猜。
- **顺序不变量的守护形状**：「隐藏文件必须在改动清单之后装」由两条机制守：
  判卷按源码位置断言 + 锚点 `heldout-install-before-change-list`（把安装块**真的搬回去**）。
  没有第三条（比如运行期断言），因为搬一次就红已经够了——记在这儿是为了让下一个人知道它是谁守的。
- **`installHeldOut` 的读回校验**（拷完再读一遍比字节）：这条守卫在公开 API 上**造不出失配**
  （要真让 copyFile 写进去的字节和源不一致才触发）。留着是防御纵深，**但它零分辨力**，
  本轮没有为它编判卷，也没登记锚点——不许声称它被验过。

## 下一步（任务 #7 的另一半仍开着）

同一任务里还欠「能产出 ≥2 拍 verify 的题形」：现在 12 条 bench 任务的 `verified` 分布
需要一次现读才能知道有没有题形天生只跑一拍。那是**另一把尺**，不在本页的读数里。
