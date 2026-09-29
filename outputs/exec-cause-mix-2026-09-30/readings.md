# 第 217 页 · `replay:verify-cause-mix` 的 exec 面 —— 现读与取证（2026-09-30）

任务 #38 原句：「exec 失败的可机器归因比例读数（等结构面试运行事件后才量得出）」。
这一页回答两件事：**这把尺现在量到什么**，以及**"等真会话"这句话里藏着哪三格不是"等"就能闭的**。

## 0. 复跑面（同一把尺、两个面；登记项没变，只把 `answers` 扩成两句）

```bash
node --import tsx scripts/replay/verify-cause-mix.ts   # exit 0 = 两面的年龄都归到「数据年龄」
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/replay-verify-cause-exec.test.ts
node outputs/exec-cause-mix-2026-09-30/probe-exec-shape.mjs        # 独立探针（不走尺的代码）
node outputs/exec-cause-mix-2026-09-30/probe-exec-red-shapes.mjs   # 五条红拍逐条原文
```

## 1. 现读（`after-both-faces.txt`，21 个 jsonl / **1,689.5 KB** 语料：outputs 1,687.3 KB ＋ 会话目录 2.2 KB）

> 就地更正（规则 289）：这一行原先写「11MB」，那其实是 `du -sh outputs` 整目录的字节数（含 png/json/非 jsonl 文件），
> 不是尺吃的取料面。上面这个数是 09-30 现读 21 个 `.jsonl` 各自 `stat().size` 之和，声明见 PROGRESS 第 217 页补⑵ 第 6 条。

```
[verify 面] verify_result 事件=19 红事件=3 红命令=3
今天可机器归因占比= 0.00 (0/3)
语料年龄= 2026-09-20 · cause 落盘= 9499a9f / 2026-09-23 ⇒ 数据年龄

[exec 面] shell 家族 tool_result=40（run_shell:26 shell_ro:8 shell_rw:6） · join 不上=9 · 红拍=5
带结构字段（exitCode／timedOut）的红拍= 0
结构栏: no-structure:5
文案栏: code-or-unknown:4 denied-by-readonly-filter:1
可机器归因占比（正证四类／红拍）= 0.00 (0/5) · 其中环境类= 0.00 (0/5)
语料年龄= 2026-09-20 · 结构字段落盘面= 9e2f15c / 2026-09-29 ⇒ 数据年龄
```

占比是 0，且**这个 0 有证人**：语料最新一条事件（2026-09-20）早于结构字段落到盘面那一笔
（`9e2f15c`，2026-09-29，由 `git log -S "result.exitCode !== undefined" -- src/agent/loop.ts` 现读）。
所以它是**数据年龄**，不是"归因路径没落地"——判据本身在 `datingVerdict`，四态各一格，
`newer-but-unattributed` 才红着退出。

改动前/后的 verify 面逐字相同（`before-verify-face.txt` vs `after-both-faces.txt` 前 6 行，
只多了一个 `[verify 面] ` 前缀；比对脚本：两边都 `sed 's/^\[verify 面\] //'` 后 `diff` 空）。

## 2. 独立探针（不信尺，先信原始事件）

`probe-shape.txt`：21 个 jsonl、`tool_call`=285、`tool_result`=286、**带 `ts` 的 result=0**、
`exitCode`/`timedOut` 在场=**0/40**、join 不上=9。
`tool_result` 的键形状只有两种：`callId,ok,output,type`(197) 与 `agent_id,callId,ok,output,type`(89)
⇒ **整批语料都没有结构字段**，与尺读到的 40/40 `no-structure` 一致（两条独立构造对得上）。

join 不上的那 9 条全在 `supervise.events.jsonl`，callId 是 `diff-worker-4`、`wt-cleanup-worker-4`、
`call_…-sup1` 这类 **harness 自己注入**的拍（`[diff]`、worktree 清理、worker 回传）——它们本来就不是
shell 红拍。尺的处理与 `gate-outcomes` 同一条纪律：**计数并印出来，不当没有**（锚点
`replay-exec-unmatched-swallowed`；不这么做的那次事故是 2026-09-21 的一片零假读数）。

## 3. 五条红拍的原文与"今天谁能看出它不是代码错"（`probe-red-tails.txt`）

| 文件 | 工具 | 盘面键 | 结尾 64 字 | 今天能说什么 |
| --- | --- | --- | --- | --- |
| supervise.events.jsonl | run_shell | `callId,ok,output,type` | `4 项断言失败\n\n[exit code: 1]` | 真·代码错 |
| fanout.events.jsonl | shell_ro | `agent_id,callId,ok,output,type` | `… 不在只读白名单（允许：…）` | **不是失败，是被静态只读过滤拒绝**——它连进程都没起 |
| I2-rep1-base.events.jsonl | run_shell | 同 1 | `…tests\n\n[exit code: 1]` | 退出码只在正文里 |
| I2-rep1-base.events.jsonl | run_shell | 同 1 | `…===\n\n[exit code: 1]` | 同上 |
| I3-rep1-base.events.jsonl | run_shell | 同 1 | `…tests\n\n[exit code: 1]` | 同上 |

五条的盘面键**全都不含** `exitCode`/`timedOut` ⇒ 结构栏一条也归不了因；只有第二条在文案栏有证人
（`denied-by-readonly-filter:1`），而按产品谓词它会连同其余四条一起被读成"代码错了"。

## 4. 造这把尺时量出来的三格（都不是"等真会话"能闭的）

① **权限拒绝落盘时既不带 `gate` 也不带结构字段**（`src/agent/loop.ts:409-414` 那条
`[permission denied]` 的 `tool_result` 只写 `callId/ok/output`）。⇒ 在结构栏里它和"旧日志"同形
（`no-structure`），今天只有文案栏看得见。同族第三处：`unknown tool:`（loop.ts:421）也是裸红拍。

② **`exitCode:null + timedOut:false` 在产品谓词里落到缺省 `"code"`**（`classifyVerifyFailure`，
`src/agent/verify.ts:25-30`）。到这一格的真路径有两条：`run_shell` 的**取消**支（`exitCode: cancelled ? null : code`）
与被信号杀后的 `close(null)`。⇒ 把"没有退出码"说成"代码错了"。本尺因此**比谓词多印一格** `no-exit-code`，
并把两边各说什么钉在同一用例里（谓词哪天补上这态，用例立刻红着提醒收敛）。

③ **spawn 的 `error` 出口不经过 `annotateExecCause`**（`src/tools/run_shell.ts:78-83` 直接 `settle`
一个裸对象）⇒ 那条红在盘上与前两格同样不可分。

## 5. 判卷与针脚

`tests/replay-verify-cause-exec.test.ts`：27 条 = 分母 4 ＋ 结构栏 11（7 行 it.each ＋ 4 条具名）＋ 文案栏 9
＋ 年龄名词 2 ＋ 取料失败 1。其中三格是**负控**：非 shell 的红带 127 也不许进分母、`no-structure` 不许进分子、
同一段文字缩进在正文中间不许算线索。
整面判卷（工作树，改动未入库时）：`249 files passed / suite_exit=0`，见 `full-suite.log`。
新增 6 条锚点（表 1038→1044）：`replay-exec-unmatched-swallowed`、`replay-exec-nonshell-in-denominator`、
`replay-exec-no-structure-read-as-code`、`replay-exec-no-exit-code-folded-into-code`、
`replay-exec-text-anchor-lost`、`replay-call-index-type-check-dropped`（最后一条在 `scripts/replay/corpus.ts`：
join 索引收成一只共用函数之后，"只认 `tool_call`"这一格是**全族**的，不只 exec 面）。
入库前 `--check-needles` 印 阻断 12 = 钉在飞文本 6 ＋ 未入库面 6（正是"锚点与实现尚未同笔落库"那一态；
落库后必须回到 0）。
