# 第 417—420 页这一簇的落库与杀锚读数（2026-10-08，全部现读）

## 1. 提交链（每一笔的暂存交接物 = `git show --numstat` 逐行相同）

| 笔 | 内容 | numstat 原文 |
| --- | --- | --- |
| `b35cbd2` | 第 417 页：apply_patch 判卷面冻结闸（实现＋判卷＋3 根锚点＋页） | `11 0 PROGRESS.md`／`30 0 scripts/mutate-verify.mjs`／`106 10 src/permissions/autonomy.ts`／`102 0 tests/judge-frozen-gate.test.ts` |
| `9ef2095` | 第 418 页：逐名读者接线 ＋ **错位修正** | `135 0 scripts/lib/eval-named-sets.ts`／`60 0 scripts/loop-eval.ts`／`90 31 scripts/mutate-verify.mjs`／`329 0 tests/eval-named-sets.test.ts` |
| `205a098` | 第 419 页：路由换档行为证人 | `317 0 tests/main-run-routing-bandit.test.ts` |
| `54df77f` | 台账补页（418／419 两页此前没进暂存面） | `20 0 PROGRESS.md` |
| `adbedbb` | 锚点补正：两根把 killer 挂反了 | `2 2 scripts/mutate-verify.mjs` |
| `6c684f6` | 第 420 页：撤回那个证人（它验的代码没入库） | `9 0 PROGRESS.md`／`62 0 outputs/head-cert-adbedbb-2026-10-07-1907/provenance.md`／`0 317 tests/main-run-routing-bandit.test.ts` |

`b35cbd2` 那一笔的 `scripts/mutate-verify.mjs` 后来被 `9ef2095` 整段摘掉重插——**摘完与 `8ba76e7a` 那份逐字节相同**，这句是本簇唯一能证明「只删了我加的」的等式。

## 2. 九根锚点在干净树（`verify-54df77f8`，0 项在飞）的实跑

| 锚点 | 钉的死法 | killer 用例 | 实测 |
| --- | --- | --- | --- |
| `judge-patch-targets-not-merged` | 算出来不接 | ⑩ 多文件补丁命中冻结表 ⇒ deny 并点名 | ✅ 2.4s／2 拍 |
| `judge-patch-second-target-not-judged` | 只判第一条 | ⑫ 冻结文件在第二位／中间位 | ✅ 1.5s／2 拍 |
| `judge-patch-unreadable-folds-to-safe` | 读不到折成读得到 | ⑬ 畸形补丁出声 deny | ✅ 1.5s／2 拍 |
| `namedsets-noisy-command-folded-into-verdict` | 噪音命令折进裁决 | 没接住测试名的命令不参与裁决 | ✅ 0.6s／2 拍 |
| `namedsets-unreadable-read-as-pass` | 第三态读成过 | 结尾汇总没了 ⇒ unreadable 且不许算过 | ✅ 0.6s／2 拍 |
| `namedsets-wired-to-first-verify-beat` | 接线取第一拍 | 跑器调读者，吃最后一次 verify 拍 | ✅ 0.6s／2 拍 |
| `namedsets-unmatched-folds-to-green` | 对不上号蒙成绿 | 名字对不上 ⇒ 第三态并点名 | ✅ 0.6s／2 拍 |
| `swebench-judge-face-not-emitted` | 数据层断产出 | 先挂反（parseTaskSetJson 那格）⇒ **存活**；补正后指向 fromSweBenchJsonl 那格 ⇒ ✅ | 首跑 0.6s 存活／补正 ✅ |
| `task-fields-registry-drops-judge` | 字段登记表不收 | 先挂反（fromSweBenchJsonl 那格）⇒ **存活**；补正后指向 parseTaskSetJson 那格 ⇒ ✅ | 首跑 0.6s 存活／补正 ✅ |

合计：首趟 9 条里 7 杀 2 存活（`成本分母：判卷 spawn 18 次／9 条`），补正后 2/2 全杀（`本次耗时 1.4s · 跑了 2/2 条`，末行「全部变异被正确杀死」，`MV_EXIT=0`）。
两根存活都不是「实现搬家」而是**指针挂反**：同一文件、两个 describe 家族，各自指到了对面那条——标题在场、尺查不出，只有实跑杀一次才知道（规则 234 说的第二根指针，本轮补上第三种脆法：指针指向在场但不走这条路的用例）。

## 3. 针脚体检两态（用来互相印证归因）

- 脏主树（落库前）：`针脚体检：1489 条 —— 阻断 15，待复认 2，未覆盖 1，逐行式 5，未入库面 5，钉在飞文本 8，killer 指针失效 0（其中 HEAD 侧 0）`。15 条里 **9 条是本簇两根面未入库的锚点**（同笔落库后归零），另 6 条具名属隔壁：4 条 `d13-*`（钉在飞文本）＋ 2 条针脚被搬走（`cascade-ladder-cross-provider`／`goal-stopped-flag-ignored`）。
- 干净 HEAD（`54df77f8`）：`针脚体检：1485 条 —— 阻断 0，待复认 2，未覆盖 1，逐行式 5，未入库面 0，钉在飞文本 0，killer 指针失效 0`，`NEEDLES_EXIT=0`。1485 = HEAD 侧 1476 ＋ 本会话 9。

## 4. 本簇自己被抓到的四次（都记在页上，不只记在这儿）

1. **构造 blob 用 `lastIndexOf("];")` 取数组收尾** ⇒ 第 417 页那 3 根插进了文件里的第二张数组（`node --check` 照样过、`--check-needles` 照样报「九根在场」——因为它读的是整份文件）。发现位：干净树 `--changed-since` 之外的一次实跑＋表长集合对比（1488 vs 1485）。修法：按「`const MUTATIONS = [` 之后第一个独占行 `];`」定位，并把「多出的九根逐名列出＋既有锚点一根没少」做成断言。
2. **落库脚本把 PROGRESS 加进 `files` 而暂存循环读 `step.files`** ⇒ 第 418／419 页没进那一笔，而**自检循环读的是同一份漏项清单**，于是门一声不响。修法：验证面独立取料（`git show HEAD:PROGRESS.md` 反查页标题行）。
3. **判「这一页在不在」用裸串 includes** ⇒ 第 417 页正文里写着「与第 418 页的锚点」，includes 把交叉引用读成已入库。修法：只认 `^## .*第 NNN 页` 那一行。
4. **证人跑在它验的代码之前** ⇒ `tests/main-run-routing-bandit.test.ts` 在脏主树 6/6 绿、在干净 HEAD 6 条全红且带红 typecheck；根因是隔壁的 `effectiveModelTable` 与第 410 页的级联开关都还没入库。发现位：`head-cert` 的 `head-import-check`。修法：把整支从树里撤回、盘上留文件（第 420 页）。**这一条是本簇最贵的：落库前的秒级门里没有一格看「判卷 import 的符号在不在 HEAD」**，登记在页上等发生率。
