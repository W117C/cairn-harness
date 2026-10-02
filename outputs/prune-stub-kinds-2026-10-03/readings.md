# 第 310 页 · 把「附件=0 条」这一格拆成能行动的诊断（2026-10-03）

## 0. 起点：探针判红的那一句，读数只给了一半

`scripts/probe-promise-recall.ts`（面登记表那一格 `src/main/agent-runner.ts#body`）报：那句「原文可从附件目录回取」在此刻**为假**。
上一版的读数只有一句 `附件写出=0 条`。0 有两种成因，而这句话分不了：

- ① 那句承诺真为假（调用点没给 `attachmentsDir`）；
- ② 是我这一趟的取料没触发落盘那一支（量法坏了，缺陷其实不在那儿）。

**把 0 拆成分母**：同一份事件 fixture，只变「传给 `computePrune` 的实参形状」，跑三栏。

## 1. 三栏读数（现取，同一趟）

取料：`node --import tsx scripts/probe-promise-recall.ts`，全文在 `probe-promise-recall.log`（退 1，红面 1 条）。

| 栏 | 实参形状 | 交出地址 | 占位语义 |
| --- | --- | --- | --- |
| 栏一 | 只给 `events`（＝`agent-runner.ts` 那一行逐字如此） | 0 条 | 裸占位 |
| 栏二 | ＋ `attachmentsDir`（工作区不给） | 4 条 | 读不到声明 |
| 栏三 | ＋ `attachmentsDir` ＋ `workspace`（目录在工作区内） | 4 条 | 带可取路径 |

逐字读数：`why=saved｜栏一（调用点形状）附件=0 条、占位=裸占位｜栏二（只给目录）附件=4 条、占位=读不到声明｜栏三（目录在工作区内）附件=4 条、占位=带可取路径`

三栏之差读出来的结论：

- 栏一 vs 栏二 ⇒ 缺的是**那一个实参**（`attachmentsDir`）。
- 栏二 vs 栏三 ⇒ **还缺工作区**：`workspaceUsablePath` 是 fail-closed 的（要 realpath 得到工作区），只补目录时 producer 交的是「模型侧读不到」那句实话，不是地址。
- ⇒ 修法因此是**两件事**，不是一件。这条是本页要钉住的结论，不是顺手写下的推论：栏二与栏三交出的地址**同样多（4 条）**，唯一变量是 `workspace` ⇒ 差的不是"落没落盘"，是"模型读不读得到自己刚落盘的东西"。

### 一处措辞纠正（自己抓的）

`computePrune` 不写盘——落盘在 `prune.ts#writePruneAttachments` 那支异步函数里。所以旧读数里那句「附件**写出**=0 条」是我说错了动作：这一层只到"交出地址"。列名与接口都改成 `wrote`＝**交回的附件路径条数**，判卷据此只声称"有没有地址"。

## 2. 尺的形状

- `classifyPruneStub(stub) → RecallStubKind`：占位串的三种语义（裸占位／读不到声明／带可取路径）。**只认 producer 自己那两句措辞**（`pruneRecallSuffix` 的两个分支），不认"像不像有路径"；认不出的串 fail-closed 落到最低那一档（宁可低报通道，也不许让模型以为能取回）。
- `pruneStubMatrix() → PruneStubColumn[]`：三栏本体，纯函数（不起进程、不碰真会话盘）。
- `hopMapDemo()`：只把三栏**印**成那句话。判卷吃结构（前两格），不吃我印的串；另配一条判卷钉"印出去的栏数＝量出来的栏数"。

为什么不留成"跑两栏"：两栏只能证"缺实参"，那半句结论会被读成"补上目录就修好了"——而它并不成立。

## 3. 判卷（`tests/prune.test.ts`，describe「被裁占位串的三种语义」）

4 条，输入全部由 producer 现生成（`pruneRecallSuffix` 两个分支 ＋ `PRUNED_PLACEHOLDER`），不是我手抄的串。

| 用例 | 钉什么 |
| --- | --- |
| 三类各占一字且互不相同；认不出的串 fail-closed | 分类函数有分辨力，且默认值在最低档 |
| 探针那一格必须交得出三栏，且三栏彼此可分辨 | 三栏齐备：`["裸占位","读不到声明","带可取路径"]`，栏一地址=0、栏三>0 |
| 反向对照：只补 attachmentsDir 仍拿不到可取路径 | 栏二/栏三地址数相等且>0、占位语义必须不同 ⇒ "两件事"这条结论有尺 |
| 报告要把三栏都印出来 | 读数与结构同源，藏一栏即红 |

判卷自己踩的两个坑（都写进注释了，免得下次再踩）：
1. 第一版把"工作区"写死成 `/ws`，而 `workspaceUsablePath` 要 realpath 得到工作区 ⇒ "带可取路径"那一支永远走不到，判卷红在我自己的取料上。改用 `tmpdir()`。
2. 第一版的"工作区之外"路径其实**还在 tmpdir 里面**（`join(tmpdir(), "dsh-outside-of-any-workspace", …)`）⇒ 那条反例不反，把"读不到"这一类测成了"可取"。改成 `resolve(ws, "..")` 之下的兄弟路径。

## 4. 四台造红（同一台机器，34 台跑到底）

日志：`red-machines-34.log`。本笔 4 条锚点各红在**不同 killer**，存活 0，残骸 0（被测面复原后与备份逐字节一致）。

| 台（锚点 id） | 改法 | 红在哪条 killer | 顺带 |
| --- | --- | --- | --- |
| `prune-stub-classifier-fails-open` | 默认档从"裸占位"改成"带可取路径" | 三类各占一字… | ＋「三栏彼此可分辨」（栏一被认成有路） |
| `prune-stub-third-column-drops-workspace` | 栏三丢掉 `workspace` | 反向对照…两件事 | ＋「三栏彼此可分辨」 |
| `prune-stub-report-hides-a-column` | 报告里抽掉一栏 | 报告要把三栏都印出来 | — |
| `prune-stub-face-left-unregistered` | 撤掉这一面的登记 | 每一处模型可见的承诺面都有判定归属 | 与第 309 页 `promise-web-face-left-unregistered` **共用** killer |

共用 killer 那一格要说清，否则就是红旗清单里的形状（两台红在同一条＝其中一条没分辨力）：
这两条是**集合型判据**（`unjudged` 必须为空数组）的两个成员，撤 A 与撤 B 都该红、且报的文字点名不同的键。分辨力的证明不是"两条用例标题不同"，而是撤登记前后 `unjudged` 的内容差 —— 见 `audience-check.mts` 读数：撤 `src/main/agent-runner.ts#body` ⇒ `unjudged=1 条：src/main/agent-runner.ts#body`。
（同一支还答了造锚点前的前置问题：那一面受众＝`model`、当前 `unjudged=0` ⇒ 这条锚点不是空操作。）

## 5. 只记不修的那一格

修复位是 `src/main/agent-runner.ts`（调用点要把 `attachmentsDir` 与 `workspace` 一起给，且工作区得可证明）。
该文件此刻由隔壁会话持有（`M`，桌面端 M2-5 那笔刚落在 `d70d23b`）。本页因此**只落诊断与尺**，不动那一个文件——按本仓规矩：新尺抓到别人在飞的面时只记不修。
挂钩：任务 #23。

## 6. 同轮声明的门耗时与判卷条数

- 本笔新增判卷 4 条、锚点 4 条；针脚体检 `1328 条 —— 阻断 3（＝本笔在飞文本，落库后归零），钉在飞文本 3，killer 指针失效 0`，`选择子 1325/1328`（本笔 4 条都有唯一选择子）。
- 秒级：`tests/prune.test.ts` 单文件 28 条 245ms；typecheck 0 报错。
- 全量判卷与认证的数在下文补凭证里，不在本页引用（四个量纲不许互借）。
