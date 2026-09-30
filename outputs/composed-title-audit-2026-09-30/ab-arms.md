# 第 240 页的两臂与两格现读（2026-09-30）

同一棵独立树 `.worktrees/verify-307ceb2`（`git worktree add --detach` ＋ `cp -al node_modules`，`status --porcelain` 现读 0 项），
两条命令相邻跑，所以两侧的条件项一致：同一棵树、同一台机器、同一分钟窗口。

## 臂 A：那 2 条走整文件跑法的锚点（`ab-whole-arm.log`）

```
[mutate-verify] 本次耗时 1.6s · 跑了 2/2 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）
成本分母：判卷 spawn 4 次／2 条（每条次数分布 2×2）· 单次中位 第1次 0.4s／第2次 0.3s· 最贵一条 settings-default-on-key-read-by-strict-true 0.8s
跑法单价：selector 0 拍·这一支本次没有 spawn ⇒ 没有分母 vs whole 4 拍·中位 0.32s·坏拍（没量到或 0 条） 0
```

## 臂 B：本会话第 237 页那 2 条 selector 锚点（`ab-selector-arm.log`）

```
[mutate-verify] 本次耗时 1.5s · 跑了 2/2 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）
成本分母：判卷 spawn 4 次／2 条（每条次数分布 2×2）· 单次中位 第1次 0.3s／第2次 0.3s· 最贵一条 selector-bucket-list-not-appended 0.7s
跑法单价：selector 4 拍·中位 0.33s·坏拍（选中≠1） 0 vs whole 0 拍·这一支本次没有 spawn ⇒ 没有分母
```

⇒ `whole 中位 0.32s` 与 `selector 中位 0.33s` 是同一个数（差异在噪声里）。两个分母都是 4 拍／2 条、每条 2 次，
所以这一对是**同分母可比**的；结论：给 `tests/settings.test.ts`（17 条的小宿主）上的锚点配整条名口径，省不到时间。
两臂各自的另一支都印「没有分母」，照贴不补零——本次实测**没有**给出跨跑法的混合比值，也没有那个资格。

与第 168/170 页的关系：那两页量的是**大宿主**（23.1s/条 vs 1.1s/条＝20.6×）。本文件不推翻它，
只说明"3 条选不中的锚点都落在小宿主上"这一具体人群里，两种跑法没有可测差。

## 现读一：全表含 `" > "` 的指针 3 条（都不是整条名）

```
attribution-fail-face-drops-x-marker | tests/mutate-verify-gates.test.ts | 红的那条正是声明的那条 ⇒ 认；`FAIL … > 标题` 与 `×` 两种失败面都要认
usage-name-of-skips-callable-check   | tests/usage-attribution.test.ts   | 取值只有一个入口，且优先级写在式子里：自述名 > 路由 spec > 缺省档
usage-name-of-accepts-non-string     | tests/usage-attribution.test.ts   | 取值只有一个入口，且优先级写在式子里：自述名 > 路由 spec > 缺省档
```

⇒ 三条都是**用例标题文字里本来就有 `" > "`**。所以「指针含连接符」不能当"这条是整条名"的判据；
将来真要学整条名，必须按位置抽 describe 链，否则会把这些指针读成别的东西。

## 现读二：`foreign` 那格为什么一直没响（两棵非本会话的树）

```
.claude/worktrees/goofy-satoshi-0edc69                                      dirty=0   分支=claude/goofy-satoshi-0edc69   detached=否
.claude/worktrees/goofy-satoshi-0edc69/.claude/worktrees/audit-zcode        dirty=22  分支=HEAD(detached)               一笔=d2d44a6
提交可达性：3a6d63c merge-base --is-ancestor … zcode ＝ yes；d2d44a6 ＝ yes
```

规则 120 要求 **detached ∧ 0 项在飞 ∧ 那一笔已入库** 三条同时成立才算残留：
第一棵缺「detached」，第二棵缺「0 项在飞」⇒ 两棵都不进任何桶。
所以 `另有 N 棵不住本仓 scratch 面的残留形树` 那一格今天印不出来，是**合格对象为空**，不是抽取器瞎
（与第 230 页那种"文件读到了却抽不到标题"的瞎是两回事，那一种才需要修尺）。
⇒ 要把这一格从"用例见证"升到"真机见证"，唯一诚实的做法是自己造一棵 **外域＋detached＋干净** 的树、跑那一格、再收掉它；
而不是把判据放宽去凑一次输出。
