# 第 308 页读数：查询端（`impact_query`）与注入端同口径

日期 2026-10-02/03。被测面 `src/tools/impact-query.ts`、`src/agent/impact/attribution.ts`、`src/agent/impact/index.ts`。
判卷面 `tests/impact-query.test.ts`。锚点面 `scripts/mutate-verify.mjs`（本笔 7 枚：新增 2、重指 4、沿用 1）。

## 1. 这一页抓到的第一件事实：那句模型可见文案是**假话**，且零观测者

`unionNote` 在 HEAD（`b1b4b51`）里写的是：

```
（同名歧义：… ⇒ 下面波及清单是**各份定义的并集**，本图只按名字连边、不认 import；要收窄就先 grep 它的 import 确认归属，或按文件查 {file:…}）
```

从第 305 页（`1183500`）起，图带 import 落料面并按「同名但另有出处」的反证摘边 ⇒ 「不认 import」这句**当时就是假的**。
现读（HEAD `b1b4b51` 的 `tests/impact-query.test.ts`）：

| 那句里的两半 | HEAD 判卷点过几次 |
| --- | --- |
| 「各份定义的**并集**」（真话那一半） | `并集` **11** 次 |
| 「本图只按名字连边、**不认 import**」（假话那一半） | `不认 import` **0** 次 |
| （整句的出处 `unionNote` 被直接 import 进判卷） | **0** 次 |

⇒ 形状很干净：**真话有证人，假话没有**。所以第 305 页把假那半变成假时，一条用例都没动。
同一句里两半的可观测性不对称，正是「写一句承诺就配一支探针」这条纪律要按**分句**用的原因
（与「两头断」那一族同形：一句话里 A 半有实现有判卷、B 半谁都没管）。
修法：`unionNote` 抽成纯函数直接进判卷，正反两半各钉一次（不许说做不到的、也不许夸成已经做到）。
HEAD 的 `src/tools/impact-query.ts` 里 `attributionNote` 出现次数现读 **0** ⇒ 三支查询的归属自述整块是本页新接的。

现读（`query-face-reading-after-order-fix.log`，真仓＝本仓自身）：

```
[impact] readFile 的定义在 1 个文件：跨文件调用点 8 处，波及 5 个文件；归属判定：1689 处已按「同名但另有出处」排除
[impact] src/agent/ledger.ts（…）（同名歧义：… ⇒ 清单仍是各份同名定义的并集：图已按 import 反证摘过一轮，但归得上任一定义的都留着；…）：跨文件调用点 43 处，波及 17 个文件；本次清单里 4 处只归得到别处那份同名定义（按 import 反证判定）；归属判定：1689 处已按「同名但另有出处」排除
[impact] src/agent/ledger.ts 引用的外部定义（我在调用谁）：引用的外部定义 15 处，分布在 12 个文件；归属判定：1689 处已按「同名但另有出处」排除
```

三态分母：`kept=45271 dropped=1689 noEvidence=0`；`fileImpact` 那份报告 `sitesOnlyToOtherDef=4`、`up=43` 处。

## 2. 本页自己造出来的第二个缺陷（靠读数日志抓到，不是靠判卷）

把两句自述拼进 **head** 之后，真仓读数变成：

```
[impact] src/agent/ledger.ts 引用的外部定义（我在调用谁）；归属判定：1689 处已按「同名但另有出处」排除：引用的外部定义 15 处，分布在 12 个文件
```

`sitesNote` 的形状是 `head + "：" + 计数句` ⇒ 自述句插在中句，最要紧的那个数被挤到句子末尾，
而「排除：」读起来像在解释归属判据（`query-face-reading.log` 第一版就是这个形状，已在页内留作反向证人）。
注入端 `contextNoteFor` 的顺序是**先给数、再交代这数被谁筛过** ⇒ 两端不同序，模型在主动查询与被动回注里
读到的是两种句子形状。

修法：尾巴改走 `sitesNote` 的第 4 个参数，落在**第一行末尾**；空清单那一支（`波及半径为 0`／`依赖面为 0`）同样接尾巴。
复原后的顺序读数见 §1（`…分布在 12 个文件；归属判定：…`）。

**为什么判卷没抓到它**：本页先写的 4 条判卷全是 `toContain`（问"有没有这句"），对**同行次序**全盲——
本仓第 4 形态的新实例（用例存在＋标题承诺了 ≠ 正文在判那件事）。补的两条：
- `自述句落在计数句**之后**…`：钉同行次序（一条负控 `/排除：|判定）：/` ＋一条正控 `/，(波及|分布在) \d+ 个文件；/`，三支各跑一遍）；
- `零清单那两支也带自述…`：钉两个空分支（up 空与 deps 空各自断言，缺一支就红）。

## 3. 25 台造红（`red-machines-25.log`，`MACHINES_EXIT=0`）

```
汇总：25 台｜杀手命中 25｜存活 0｜残骸 0
25 台 → 25 个不同 killer；重复声明：0 ✅
基准（未改任何文件）：四个判卷文件逐个先绿，否则该判卷上的红说明不了任何事
残骸复查：attribution.ts / index.ts / persist.ts / impact-query.ts 与备份逐字节一致 ✅
```

本笔 7 枚锚点每台红在自己那条：

| 锚点 id | 改法 | 红在哪条 |
| --- | --- | --- |
| `impact-query-union-note-denies-imports` | 把那句回退成「本图只按名字连边、不认 import」 | 文案两半各钉一次 |
| `impact-query-deps-arm-loses-attribution` | deps 支丢掉尾巴 | deps 支也带同一句 |
| `impact-query-symbol-arm-loses-attribution` | symbol 支尾巴换成空串 | symbol 支要说出收了多少 |
| `impact-query-file-arm-loses-denominator` | file 支尾巴换成空串 | file 支数得出「几处只归得到别处」 |
| `impact-query-notes-land-before-the-count` | 尾巴拼回计数句**之前** | 自述句落在计数句之后（次序） |
| `impact-query-empty-list-loses-notes` | 空清单那一支不接尾巴 | 零清单那两支也带自述 |
| `impact-mixed-note-prints-zeros` | 拆掉分母句的 0 闸 | 那句分母只有一处文字 |

另有 4 枚**重指**（不是新增）：`impact-query-deps-noun-leaks-into-up` 的针脚随 `sitesNote` 加了第 4 参数而搬到入参那一行
（`sitesNote(head, r.up, UP_NOUN,` → `DEP_NOUN`）。落库前针脚尺报的 7 条「钉在飞文本」＝本页 7 枚锚点钉的是未落库实现，
同笔预期读数（规则 217），提交后应归零。

## 4. 文案的代价（同分母，只算这次多出来的字节）

- `unionNote` 返回体：HEAD 119 chars／225 bytes ⇒ 现在 138 chars／286 bytes（**+19 chars**，改假话顺带把出路指到那个分母上）。
- 每支查询新增自述（非空时）：symbol 支 25 chars、file 支 62 chars、deps 支 25 chars ⇒ 按本仓 chars/4 口径 ≈ **6／16／6 token 量纲**。
- 全 0 时一句都不出（`attributionNote`/`mixedSitesNote` 的 0 闸），所以缺省路径字节不变；
  而这一面本身要 `impactAnalysis` 开着、且模型主动调用 `impact_query` 才付钱（真语料里该工具调用次数为 0，见第 306 页 §4）。
- 顺序修正前后：三支第一行 chars **逐字不变**（73／346／92），只是尾巴换了落点 ⇒ 这次重排不花一个字节。

## 5. 与第 307 页的一句自我更正

307 页 §6 写过「不动查询端 `tools/impact-query.ts` 那句（它读图上的并集事实、字段来源不同，硬共用会逼出一层新抽象）」。
本页实测：共用**没有**逼出新抽象——只需把那句抽成 `attribution.ts` 里的 `mixedSitesNote(count)` 一个导出函数，
两端各自在原来的位置调用。所以那句预判是错的，留在这儿而不是删掉：
判断"要不要抽一层"的依据是**句子是否同一件事实**，不是字段来源是否同一份。
