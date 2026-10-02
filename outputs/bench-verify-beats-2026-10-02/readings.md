# 闸补拍的计数 ＋ 返修那一拍接进基准 · 2026-10-02（能力 5 的返修那一格）

任务 #12（也是 #7 欠的另一半）。一句话：**布尔位把 1 拍与 2 拍压成同一个 true，而返修那一拍在基准上根本没有入口。**

## 1 现读（改动之前）

| 量 | 读数 | 取法 |
| --- | --- | --- |
| 盘上归档事件日志 | 48 份，其中 47 份含 `verify_result`，共 **50 条** | node 逐行 `JSON.parse`（解析失败 0 行 ⇒ 不是读不出来） |
| 其中带 `auto:true` 的 | **0 条**（每份最多 0 拍） | 同一趟遍历；生产者字段已核：`src/agent/loop.ts` 里 `...(auto ? { auto: true } : {})` |
| 哨兵 | 总数那一格读到 50（非 0）⇒ 计数面看得见 `verify_result`，这个 0 不是瞎 | 同上 |
| 第二拍的入口 | `loop.ts` 的返修分支要求 `opts.autoVerifyRepair === true`；产品缺省 `false`；基准**没有旗标**也没有实参 | 读 `loop.ts` 的 `repairPending` 那一支 ＋ `DEFAULT_SETTINGS.autoVerifyRepair` |

⇒ 「≥2 拍 verify 的题形」这句话在基准上既**不可达**（没入口）也**不可读**（布尔位）。本簇把两半都补上。

## 2 交付

- `scripts/lib/eval-validity.ts`：`autoVerifyBeats(rows)`（只数 `auto === true`）。口径放这里，因为这家 lib 已经管读数口径（`tally`/`costSplit`/`runValidity`）。
- `scripts/loop-eval.ts`：`harnessBeats` 算一次 ⇒ `autoVerifyBeats` 与 `autoVerifyBeat`（派生布尔）两格同值；读数行加 `闸拍=N`；批次末行加 `合计／单趟最多／≥2 拍的趟次`；新旗标 `--auto-verify-repair`。
- `scripts/lib/eval-assembly.ts`：新增第 5 个 face **`on-here`**（产品缺省关、本趟装了 ⇒ 这副读数是对照臂，不是产品缺省态）；
  `assemblyRows` 行集改成「缺省为真的键 **∪** 被旗标改过口的键」；`assemblyOverrides(autoVerify, autoVerifyRepair)` 是配对规则的**唯一**判点；
  `runLoopKnobsFromAssembly` 只认 `same|on-here`，且表自相矛盾（有返修没闸）时 fail-closed 不递。
- `scripts/mutate-verify.mjs`：**+6 条**锚点（`asm-pairing-rule-dropped`、`asm-projection-pairing-failopen`、`asm-on-here-not-counted-as-installed`、`asm-beats-count-truthy`、`asm-beats-count-not-wired`、`asm-beats-second-producer`），
  并把上一簇 3 条锚点的针脚跟着新实现重铸（`asm-projection-always-on`/`never-on`/`asm-override-flag-ignored`）——实现搬家后旧针脚 0 命中就是空操作锚点。

**这一簇不开任何东西**：两枚旗标都要显式带，且真跑一趟会多真跑 lint/test（钱）⇒ 归用户裁。

## 3 真机读数（零花费，`--feasibility`）

见 `face-three-states.log`：

- 两枚都带 ⇒ `autoVerify:same autoVerifyRepair:on-here`（面上多一枚，读数的 `assembly` 字段随之变）；
- 只带 `--auto-verify-repair` ⇒ 出声「被忽略：没装闸就没有对象」，面**不变**（配对没被静默放宽）；
- 都不带 ⇒ 今日那副 4 枚 off-here，逐字与上一簇相同。

## 4 分辨力：五台造红（备份 `cp` ⇒ 复原 `cmp` 逐字节一致，残骸 0）

| 台 | 改法 | 红在哪条用例 |
| --- | --- | --- |
| M1 | 投影把 `on-here` 不当装（只认 `same`） | 「两枚旗标都带 ⇒ 投影出的参数两枚都装着」＋「投影不给没闸的返修」（2 条） |
| M2 | 配对规则放宽（只带返修也进表） | 「缺省关而这一趟装了 ⇒ 进表记 on-here」 |
| M3 | 计数从 `=== true` 放宽成 truthy | 「脏值不算一拍」 |
| M4 | `runLoop({...})` 里摘掉投影摊开 | 「递给 runLoop 的是投影结果，不是第二个 if」 |
| M5 | 读数那位写成常数 0 | 「Reading 两格都从同一个值来」 |

五台各红在**不同**用例上；每台跑完即复原（脚本 `/tmp/asm2-redmachines.js` 的一次性执行，输出存 `red-machines.log`）。

## 5 门与耗时（分清是哪把尺，四个量纲不许互借）

- 本簇**不新增门**，`CERT_GATES` 仍 22 道（现读工作树＝HEAD）。
- 秒级判卷：`tests/eval-assembly.test.ts` **25 条**、`tests/eval-validity.test.ts` **15 条**，合跑 40 条 / ~12ms（`Duration 162ms` 那一趟是单文件）。
- 全量判卷：**288 文件 / 3959 条全绿，209.33s**（`suite-full.log`）。条数对账：上一笔认证是 3805 条（干净树），本次 3959 条里含隔壁会话已入库的新判卷；本簇自己净加 **12 条**（25−16 ＋ 15−12），与「改动前 3947 ⇒ 改动后 3959」逐笔吻合。
- 针脚体检：1263 → **1269** 条（本簇 +6 ✓），`killer 指针失效 0`、`改法语法体检 1269 条全部产出合法源文件`；
  `阻断 10 ＝ 钉在飞文本 10`（6 条新锚点 ＋ 3 条重铸针脚 ＋ 1 条同批），落库后应归零——`needle-audit-precommit.log`。
- `typecheck`：**0 条报错**（连隔壁会话那份未跟踪草稿的错也没了，不是我修的）。
- 顶包候选水位：改前读 **10 条＝帽 10**（`prose-needle.log`）。**这条取在提交之前**，而它按已提交态算分子 ⇒
  按第 297 页补立下的规矩，落库后必须重量一次，读数记在本页末尾的补记里；若涨到 11，修法照旧是改措辞拆共享字面量，不抬帽。

## 6 下游（改口径要同轮声明）

`scripts/eval/report.ts`（读 `readings.json` 的那个面）对 `verified` / `autoVerify*` / `assembly` / `heldOut` 的引用数现读 **0** ⇒
本簇新增/改写的字段没有既有消费者，不需要同轮改下游；今后若有消费者，装配面与拍数两格都在 JSON 里，不必再回去猜。

## 7 仍欠

1. **一次 `--auto-verify --auto-verify-repair` 的真跑**（对照臂：同任务、同种子、两副装配，报准确率与 ¥/成功任务）。要凭据与真钱 ⇒ **等人点头**。
2. 题形侧：闸的第一拍要判红，第二拍才有对象。现成的红种子题形是 `fixtures/bench/*` 的 as-shipped 态（上一簇已证 B1/B2 的隐藏面在 as-shipped 下偏红）——但"模型被红字提示后真去改盘"这一步只有真跑才知道。
3. `#7` 的原话「能产出 ≥2 拍 verify 的题形」现在**机制可达、读数可读**，缺的只是那次真跑。

## 8 补记（落库后重量）

- 待补：提交后的顶包候选水位读数、锚点在干净树逐条击杀的结果、本笔 HEAD 的认证读数。
