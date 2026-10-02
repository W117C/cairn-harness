# 基准钱轴：归因键（188b7e3）＋ 钱的出处（155b151）取证

两笔一簇，口径都是「机制＋判卷＋锚点同笔落」（规则 217）。退出码一律直接取、不接管道。

## 一、修的是什么（三条同族的第三次命中）

| 时间 | 那一格的样子 | 现在 |
|---|---|---|
| 09-23 | 钱闸与回执分叉两把尺（全部 token × 会话档 ⇒ 比实付低 40 倍） | 已收成 `bucketsSpendUsd` |
| 09-27 | 生产 usage 事件没有归因键 ⇒ 钱轴报「不可测」 | `createUsageAttributor` 接进 agent-runner |
| 10-02 | **基准路径绕过归因层** ＋ **缺省价替所有档位定价** | 本目录这两笔 |

## 二、188b7e3（归因键）

- 跑器改用生产那一份盖章器：`createUsageAttributor(glmDefaultModelName)`，stamp 在 `log.append` **之前**
  （纪律：盖在事件本身上，live ≡ 盘）。模型名不另算缺省——跑器启动时已把 `M0_MODEL` 归一成真正要拨的那一档。
- `readings.json` 行内加 `model`：跑器每趟删临时目录 ⇒ 盘上留得住的只有 readings。
- 对账面 `modelFace()` 三态：`same` / `differs`（含**同一臂内混档**）/ `unknown`（缺键 ⇒ 取不到＝未证）。
- 判卷 +9 条：`tests/usage-attribution.test.ts` +3（含**全仓普查**：建盖章器与调 stamp 的都必须恰好
  ＝｛agent-runner, loop-eval｝——原先只数自己那份文件，挡得住多抄、挡不住少一个消费者）、
  `tests/eval-report.test.ts` +6。
- 锚点 +4：`bench-usage-stamp-dropped`、`model-face-unknown-degrades-to-same`、
  `model-face-mixed-arm-blind`、`model-face-not-printed`。
- 顺带改真两处过期承诺：用例标题「全仓只有这一处盖章」→「这一份文件里只有这一处盖章」，
  两条旧锚点（`usage-stamp-call-dropped`／`usage-stamp-after-append`）的 killer 指针同一笔跟上新标题。

## 三、155b151（钱的出处）

- `priceFace(rawIn, rawOut)`：只认**给全且非负有限**的那一组；缺任何一个 ⇒ 不可知且 `why` 点名缺谁；
  `0/0` 是合法价（免费档就该报得出 ¥0）。`PRICE_UNKNOWN` 常量唯一化措辞，判卷引用常量（同 1acc3c0 纪律）。
- 跑器：不可知 ⇒ `cny=NaN` ⇒ 汇总另走一条印「实付=价不可知 · 每达标任务=价不可知 〔缺谁〕」；
  `costSplit` 早就按 `Number.isFinite` 收口 ⇒ NaN 不会污染分面；用法头注释补上 `EVAL_PRICE_IN/OUT`。
- 判卷 +4（给全／缺一边（双向钉）／坏价目含 0 价哨兵／不可知的写法）＋ 接线①②③；锚点 +4
  （`price-face-missing-blind`、`price-face-negative-ok`、`money-text-unknown-degrades`、`bench-price-face-bypassed`）。

### 更正我自己发布过的数（就地写明，不静默）

`实付≈¥0.2774`、`每达标任务 ¥0.0993`、`白花 ¥0.0789` 是**名义值**：按缺省 0.8/2.8 算，
而那一趟真拨的是 OpenRouter 免费档（`limit_source=openrouter_free_tier_daily`，
`outputs/bench-reps3-2026-10-02/README.md`）⇒「实付」当时不成立。
**比值 39.7% 不受影响**（分子分母同一把尺）。这条更正已写进 `scripts/lib/eval-validity.ts` 的注释，
就在原来那两个数旁边。

## 四、读数

| 项 | 命令 | 结果 |
|---|---|---|
| 锚点（188b7e3） | `pnpm mutate-verify <4 归因键 ids>` | exit=0，`全部变异被正确杀死`；`本次耗时 4.4s · 跑了 4/4 条`；`spawn 8 次／4 条（每条 2×4）·单次中位 0.3s／0.3s·最贵一条 bench-usage-stamp-dropped 2.1s`（`anchors.log`） |
| 针脚体检（155b151） | `pnpm mutate-needles-check` | exit=0：`针脚体检：1234 条 —— 阻断 0，待复认 1（存量 verify-lang-timeout-same-as-npm），钉在飞文本 0` |
| 锚点（155b151） | `pnpm mutate-verify <4 价目 ids>` | exit=0；`本次耗时 2.8s · 跑了 4/4 条`；`spawn 8 次／4 条·最贵一条 price-face-missing-blind 0.7s`（`price-anchors.log`） |
| 判卷（主树，含他人在飞面） | 六个文件 | 429 条全绿（含 `prose-needle-scan` 的水位那条 ⇒ 本笔新增判卷没进顶包候选） |
| 认证（155b151） | `pnpm head-cert-check` | **exit=0**：`认证门面=22 道（跑到 22）｜绿 22 道｜⚠️ 超预算 0`；`TREE=155b151 DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔`；`Test Files 278 passed (278)｜Tests 3725 passed (3725)｜exit=0`；`并发判卷=起前 0 套／跑完 0 套（两端独占）`（`head-cert-155b151.log`）。3725 与 188b7e3 留档的 3721 之差＝4，正是本笔列得出的四条价目判卷 |

### 一处由我自己造成的红，以及修法（换取料，不削判据）

188b7e3 那次认证**红 1 条**：`head-cert` 汇总原文
`Test Files 1 failed | 277 passed (278)｜Tests 1 failed | 3720 passed (3721)｜exit=1`，
失败的是 `tests/head-cert-deps.test.ts`「真机整表」，成因是**我改了用例标题**，
而那把尺按标题回源码取预算 ⇒ `notResolved=1`。判卷自己写的办法是
「不是 0 就先修取料，别把名单当准」⇒ 在 188b7e3 上独占重跑一趟全量做新语料
（`outputs/judge-timeout-2026-10-02/suite-quiet.json`，278 文件／3721 条），把取料指向它；
10-01 那份留档**没动**（它是那天的证据；工作树里它被别人改了 1 行，与本笔无关、本笔不提交）。
**修完复跑**：155b151 那次认证 22/22 绿、全量 3725 条绿、退出码 0 ⇒ 那条红确实是取料过期，不是代码坏了。

## 五、仍未证的（别当已闭）

- **钱轴还没有一次"真数"**：`EVAL_PRICE_*` 现在必须显式给，而今天没跑成（免费档日配额）。
  ⇒ 「$/成功任务」这条轴仍是**等一次带价目的真会话**，与 09-27「等一次真会话」同口径。
- 存量语料（36 趟那批）没有 `model` 键 ⇒ 按模型分臂的历史读数**不可回算**。
- 台账页 `PROGRESS.md` 未落（热串行点，归整合的那笔）。
- `gate-manifest.ts` 里 `mutate-needles-check` 的预算 20000ms：**三趟实测跨度很大**——
  b44976a 15035ms／188b7e3 **26737ms（`⚠️ 超预算 1`）**／155b151 13597ms。
  表从 1226 → 1234 条只多 8 条，而中间那趟是隔壁会话同时在写盘时取的 ⇒
  现有证据只够写「帽余量偏紧、机器负载高时会越」，**不够写「加锚点把它推过帽」**。
  那个文件此刻在隔壁手里（未提交）⇒ 我不动它，只把三个数都记在这里：**要调帽得由改那份名单的人做**。
