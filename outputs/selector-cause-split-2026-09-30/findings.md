# 「零命中」的四种成因（2026-09-30，第 233 页取料面）

本页要推翻的是一句我自己上一笔写下的话。第 230 页 §7.1 我写：

> 放宽之后还选不中，就只剩「用例改过名或压根没有」这一种成因。

**这句错了**，而错的方式正是本仓反复钉的那一族：把我这把尺看不见，写成盘上只可能有那两种。
逐条读判卷文件 + 拿真 `vitest -t` 跑一次，全表当时那 2 条零命中没有一条属于"改了名"。

## 现读（改前，表 1086 条）

`--check-needles` 那一格原文（见 `../selector-uniqueness-2026-09-30/needles-at-b4919e3.log` 与本页 `needles-after.log`）：

```
零命中 2 条（指针在那份判卷里对不上任何标题，多半是用例改了名 ⇒ -t 会一条也选不中）：
  shape-leading-env-assignment-not-skipped(0)、pb-control-arm-always-wired(0)
```

### ⑴ `pb-control-arm-always-wired` —— 指针写的是一条 `describe` 的名字

`tests/prune-batching.test.ts:132` 是 `describe("对照臂判据：门槛旋钮接得上", …)`，其下有两条 `it`（:133、:147）。
标题抽取只认 `it`/`test`，所以静态 0 命中；而 `--testNamePattern` 匹配的是**整条名**（describe 前缀＋it 标题）⇒
实测（`run-t-describe-pointer.log`）：

```
Tests 2 passed | 16 skipped (18)
```

⇒ **不是选不中，是不唯一**：它一次选中该支两条用例，红的是哪条说不清（规则 248「恰好 1 条」／255 并集证人）。
修法是把指针收到真正会红的那一条上（:133 那条），本笔就这么做了 ⇒ 选择子 1085/1089 → 1086/1089，零命中 2 → 1。

### ⑵ `shape-leading-env-assignment-not-skipped` —— 标题由循环变量给出

`tests/command-shape.test.ts:14-36`：`const WRAPPED = […, "GIT_PAGER=cat git push --force", …]`，然后
`for (const cmd of WRAPPED) { it(cmd, () => …) }`。运行时标题就是那条命令本身；静态只看得见字符串数组里的字节，看不见 `it(cmd`。
实测（`run-t-variable-title.log`）：

```
Tests 1 passed | 35 skipped (36)
```

⇒ **运行时恰好选中 1 条**，静态数不清（要数据流才知道 `cmd` 会取哪些值）。这一条**不该**被说成改了名，也不该被当成缺陷。

## 那要不要为它做一层"运行时反查 selectable"？——按钱裁：不做

`whole-cost-of-4-degraded.log`（同一棵树、同样 4 条失准锚点、`--budget-ms 480000`，机器原文）：

```
[mutate-verify] 本次耗时 4.2s · 跑了 4/4 条 · 预算 480s
成本分母：判卷 spawn 8 次／4 条（每条次数分布 2×4）· 单次中位 第1次 0.5s／第2次 0.3s· 最贵一条 shape-leading-env-assignment-not-skipped 1.2s
跑法单价：selector 0 拍·这一支本次没有 spawn ⇒ 没有分母 vs whole 8 拍·中位 0.35s·坏拍（没量到或 0 条）0
```

⇒ 这 4 条整文件跑法一共 4.2s，中位 0.35s／拍。**为省这一点钱再叠一层判据（多一次 spawn 反查、缓存、"这条是按什么算的"的标注）不划算。**
第 230 页那 10 条之所以值得改，是因为它们的宿主是 33.7s 那种大判卷；这一批不是。
**反转条件**（写在这儿，免得下次凭感觉重开）：当某条"静态数不清"的锚点的整文件跑法**单拍超过 ~5s**，或这样的锚点攒到 5 条以上，
再考虑那层反查；今天两条都不满足。

## 本笔真正买到的东西

读数不再指责任人：`零命中 N 条（按成因点名：指在 describe 上 a｜标题由变量给出 b｜文件里没这句话 c｜说不清 d）`，
四档**0 也印**。改后（`needles-after.log`）：

```
选择子：1086/1089 条能只跑自己那条 killer 用例…·零命中 1 条（按成因点名：指在 describe 上 0｜标题由变量给出 1｜文件里没这句话 0｜说不清 0…）
```

`指在 describe 上 0` 是这一格自己前后对照的证人：不是我把那条从名单里删了，是**成因说对了之后它有了一条正确的修法**，并且那条修法已经落地。
