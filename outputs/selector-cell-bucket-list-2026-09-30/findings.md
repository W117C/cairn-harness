# 选择子那一格的 id 名单：从「并排印在行末」改成「分桶挂标签」（2026-09-30，第 236 页）

## 缺陷形状（第 235 页凭证 §7-④ 登记的，本目录是它的取料面）

`selectorCell`（`scripts/lib/mutate-gates.ts`）把 `problems` 全集的 id 名单接在**整行末尾**，
而它前面的标签各说各的数（`零命中 N 条`／`多命中 M 条`）。真表读数（改前，本会话留档于
`outputs/scratch-face-foreign-2026-09-30/needles-at-e9d3155.log` 第 3 行）：

> ℹ️  选择子：1088/1091 条能只跑自己那条 killer 用例（…）·零命中 1 条（按成因点名：指在 describe 上 0｜标题由变量给出 1｜文件里没这句话 0｜说不清 0；共同后果是 -t 一条也选不中 ⇒ 走整文件跑法）·多命中 2 条（选择子不唯一）：shape-leading-env-assignment-not-skipped(0)、settings-default-on-key-read-by-strict-true(2)、settings-auto-verify-default-reverted(2)

读的人在这里会得出「`shape-…` 是一条多命中」——**它是唯一的零命中条**。
零命中要改用例指针的落点（那条标题由循环变量给出 ⇒ 走整文件跑法），多命中要给指针配唯一后缀：两种坏读数修法相反（规则 261/262 的反面：两态不许同形）。

计数本身从来没错过：`1088 = 1091 − 3`、`1 ＋ 2 = 3`，坏的只是名单不挂桶名。

## 改法

名单改由各桶自己挂（`selectorBucketList(rows)`，`zero`∪`many` ＝ `problems` 全集，`hits===1` 的进不了 `problems` ⇒ 分桶印不丢条），
整行末尾那份并排名单删掉。改后读数（本目录 `needles-at-236-working.log`，工作树态、表 1093 条＝＋2 支新锚点）：

> ℹ️  选择子：1090/1093 条能只跑自己那条 killer 用例（…）·零命中 1 条（按成因点名：指在 describe 上 0｜标题由变量给出 1｜文件里没这句话 0｜说不清 0；共同后果是 -t 一条也选不中 ⇒ 走整文件跑法）：shape-leading-env-assignment-not-skipped(0)·多命中 2 条（选择子不唯一）：settings-default-on-key-read-by-strict-true(2)、settings-auto-verify-default-reverted(2)

**同分母说明**：两份读数的表长不同（1091 vs 1093，差的是本笔新登记的两支锚点），
但 `problems` 那 3 条一字未变（同一个 id、同一个 hits、同一个成因），所以这一格的对照只用于**文字形状**，
不用于任何计数或单价比较；两条里 selectable 数各为 1088／1090，也与本笔无关（新增的两支锚点自己能被 `-t` 选中）。

## 判卷与锚点

- 新判卷（`tests/mutate-verify-gates.test.ts`）：`id 名单要挂在各自的桶名下：并排印在行末＝把唯一的零命中条指成「多命中」的一员`。
  判据取的是**区间**：`零命中`→`多命中` 之间必须含 `zero(0)` 且不含 `two(2)`；`多命中` 之后必须含 `two(2)` 且不含 `zero(0)`。
  只写 `toContain` 不算（旧形状也能过，规则 236 那一族）。
- 反向哨兵：既有那条 `零命中与多命中分开印，并点名是哪几条` 仍绿 ⇒ 本笔没有把名单删没。
- 两支新锚点（`scripts/mutate-verify.mjs`，表 1091→1093）：
  - `selector-bucket-list-not-appended`：多命中那段不挂名单 ⇒ 名单只剩一半；
  - `selector-bucket-lists-swapped`：零命中那段挂多命中的名单 ⇒ 名单还在、责任人换了。
