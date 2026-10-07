# 认证退出码自印：造红与锚点读数（第 426 页簇，2026-10-08）

## 1. 那一格从前长什么样（现读，取料面＝工作树）

```text
scripts/head-cert.ts:388  const code = certifiable && tc.status === 0 && (testStatus === null || testStatus === 0)
                                   && gateReds.length === 0 && dirtyCount === 0 && drift === null ? 0 : 1;
```

码算出来了，但**只交给 `process.exit`**——stdout／`summary.txt`／`provenance.md` 三处读数里都没有它。
于是认证常是 `nohup` 起的那几趟（第 421／423／425 页）每页都得留一句「`HEADCERT_EXIT` 没直取」。
同一疏忽第三次出现 ⇒ 按口径不再写「下次注意」，让被度量者自己记下那一格。

## 2. 形状：判决与读数同源，别做第二份事实源

新增三个纯函数（`scripts/lib/head-cert-provenance.ts`，与 `trustFilePathOf` 那类同顶——本模块原本就声明「不碰盘、不起进程」）：

| 函数 | 职责 | 为什么要单独存在 |
| --- | --- | --- |
| `certFailingDims(o)` | 逐维点名红的维（`treeDrifted` **不在这一列**） | 作废是第三种态，混进「红的维」就把「什么都没认证」读成「代码有问题」 |
| `certExitCode(o)` | 六维合取 ⇒ `0｜1` | 判决只有一个算法 |
| `certExitCodeCell(o)` | 那句读数，内部调 `certExitCode` | 读数自己算一遍＝页上引的与真的退出码分叉（本仓点名的形状） |

调用点改成 `const outcome: CertOutcome = {…}` ＋ `const code = certExitCode(outcome);` ＋ `say(certExitCodeCell(outcome))`，
且 `say` 必须在 `summary.txt` 与 `provenanceDoc` 两次写盘**之前**——顺序倒了不是少一行，是入库那两份没有它，
而凭证页引用的恰恰是入库的那份。文案里点名「这是 head-cert 这道门自己的码，不是它跑进去的 test runner 的码」：
汇总里已有一行 `exit=1（退出码直接取）`，那是 runner 的码，两个码同屏不写归属就会被抄错（第 425 页差点如此）。

## 3. 判卷按层拆开（新 `tests/head-cert-exit-code-cell.test.ts`，17 条）

第一版把「判决＋dims＋文案」三问写在同一条用例里，造红时立刻暴露一个真问题：**两台变异红在同一条**
＝其中一台的守卫是冗余的。于是拆成三层——判决（①②③）、读数（④⑤⑥⑦⑧⑨）、装配（⑩⑪⑫⑬）。

## 4. 四台造红（跑完即复原，一律 `cp` 备份＋`cmp` 逐字节校验；每台都有一条只属于它的证人）

| 台 | 改法 | 红在哪些用例 | 独有证人 | 读数体积 |
| --- | --- | --- | --- | --- |
| A | 判决摘掉「作废」那一维（`&& !o.treeDrifted` 去掉） | ③④ | ③（只看判决函数） | 5163 B |
| B | 门表那一维从 `> 0` 挪成 `> 2` | ②⑤⑧ | ②（只有门表这一维红） | 6319 B |
| C | 读数自己算一遍（`const code = 0;`） | ④⑤⑦⑧ | ⑦（八张面各问一次 cell 码＝判决码） | 7642 B |
| D | 调用点重写合取式（只留 typecheck 与门表两维） | ⑩ | ⑩（这一格只许一条算式） | 4120 B |

四台复原后基线重跑 **17 passed**；残骸 0（`find . -name '*.mutbak'` 无命中）。

## 5. 锚点四根与表长（消费者现读）

`cert-exit-code-drift-dim-dropped`／`cert-exit-code-gate-threshold-loosened`／
`cert-exit-code-cell-decodes-its-own-verdict`／`cert-exit-code-decision-inlined-at-call-site`。

- `--list` 行数：改动前 **1496** → 改动后 **1500**（＋4 全在本表；四条 id 各命中 1 次）。
- `node --check scripts/mutate-verify.mjs` exit 0。
- `--check-needles`（脏主树，本笔未落库）：`1500 条 —— 阻断 16，待复认 2，未覆盖 1，逐行式 5，未入库面 4，钉在飞文本 8，killer 指针失效 0`。
  钉在飞 8 ＝ 我的 4（钉在本笔未提交的实现文本上，落库即归零）＋ 隔壁 `d13-*` 4；未入库面 4 含我这份新判卷文件（未 add 前 HEAD 读不到）。
  `killer 指针失效 0` 是对四根 `expectFail` 逐字对上用例标题的那一维——第一版把标题改成 ⑦⑧⑨⑩ 时这里就会喊「失效」，改号跑在落库前。

## 6. 归属（本笔不代走别人的面）

| 文件 | 工作树 vs HEAD | 我的 | 隔壁在飞 |
| --- | --- | --- | --- |
| `scripts/lib/head-cert-provenance.ts` | +50/−0 | 全部 | 0（开工前现读为干净） |
| `scripts/head-cert.ts` | +13/−2 | 全部 | 0（开工前现读为干净） |
| `scripts/mutate-verify.mjs` | +73/−0 | 36 行（4 根） | 37 行（`d13-*` 四根，钉 `scripts/docs-check.ts` 的在飞实现） |
| `PROGRESS.md` | +1/−1 | 追加本页面后才分叉 | 那一处 `cli.ts`→`src/cli.ts` |

⇒ 只有 `mutate-verify.mjs` 与 `PROGRESS.md` 混着别人的 hunk，两处走临时 index（blob 由 `git show HEAD:<path>` 构造并逐条断言命中＝1）；
另两个文件工作树内容就是我这簇，直接取工作树 blob。

## 7. 门耗时（本轮实测，秒级面）

`typecheck exit=0`；`head-cert-exit-code-cell 判卷 17 条`（两趟：基线绿＋一台红，各 <1s 级）；
`mutate-needles-check`（脏树）本次读数 1500 条那一趟；`docs-check` 见页 §8。**一道门 ≠ 认证树全量 ≠ 整张变异表**，三个量纲不互借。
