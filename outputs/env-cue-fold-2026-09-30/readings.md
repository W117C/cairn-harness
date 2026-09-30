# 第 222 页 · 待办 #44：环境线索的匹配器从三处收成一份（2026-09-30）

取料命令（三处都可复跑，退出码由命令自己印）：

```
node --import tsx scripts/replay/verify-cause-mix.ts     # 一把尺两个面
node --import tsx scripts/replay/cascade-traffic.ts      # 占比分子的另一位消费者
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/env-cue-single-source.test.ts tests/replay-corpus.test.ts tests/replay-cascade-traffic.test.ts tests/replay-verify-cause-exec.test.ts tests/replay-verify-cause-dating.test.ts
```

## 1. 折之前有几份？——现读位点表 + 一把新尺数得出/数不到的那半

`pre-state-sites-at-head.txt`（对 `git show HEAD:scripts/replay/*.ts` 逐文件数「这行在定义匹配器」）：

```
verify-cause-mix.ts 127=1 超时=1 ERR_PNPM=1      ← 其余 11 个文件全 0
```

但这张表**只数得出一条正则**。本笔真正折掉的三处副本里，有两处是那种它数不到的形状：

| 副本 | 形状 | 锚定 | 新尺看得见吗 |
| --- | --- | --- | --- |
| `verify-cause-mix.ts` exec 面 `T_TIMEOUT/T_EXIT_127/T_PKG` | 正则字面量 | 行首 | 看得见 |
| `verify-cause-mix.ts` verify 面 `textualKind` | `out.includes("[exit code: 127]")` | **无锚** | 看不见 |
| `cascade-traffic.ts` `ENV_TEXTUAL` 数组 | 四条字符串 + `.some(includes)` | **无锚**，还混进 `(none)` | 看不见 |

⇒ 结论要分开说：**收成一份是真的**（现在正则/字面串都只剩 `corpus.ts` 那一只表 + `src/agent/verify.ts` 那一只 pkg 正则），
但"只有一份"这句话由新普查尺**证不全**——它的盲区写在尺自己的用例里（`尺的盲区自己讲出来` 那条，规则 261），
那两处的证人是行为面上的跨面用例：**同一条输入喂三个出口**（`textualKind` / `scanStreamTraffic` / `firstEnvTextCue`）必须给同一个答案。

## 2. 折的过程中抓到的一条：合成一只表时最容易犯的错是"表里那条只认识自家出口"

第 219 页留下的 exec 面超时判据是 `^\[error: \S+ 超时`。照搬成共享那一份会**当场漏掉 verify 自己那句**
（`[error: verify 命令超时（Ns）…` 里 `\S+` 后面还跟着一个词）。这条不是猜的，是用现成句子跑出来的：

```
/^\[error: \S+ 超时/mu .test "[error: verify 命令超时（2s）"      => false
/^\[error: [^\n]*超时/mu .test "[error: verify 命令超时（2s）"    => true
同一把表对 run_shell / glob 那两句同为 true；对正文中间与缩进那两种形状同为 false
```

所以表里那条写成"行首 + `[error: ` 起头 + 同一行里出现超时"，并由 `replay-corpus.test.ts` 里那条
`只认「工具名紧跟超时」的写法会漏掉 verify 那一句` 钉住宽度（它先断言旧写法**不成立**，再断言表里那条成立）。

## 3. 两侧读数（同分母，改前 vs 改后）

`ruler-after.log` / `cascade-after.log`（改前的同一对读数在第 217/221 页那两份产物里，语料与文件数没变）：

- verify 面：`事件=19 红事件=3 红命令=3`、`文案栏: code-or-unknown:3`、占比 `0.00 (0/3)` —— 逐字不变；
- cascade 面：`取料 = 21 个 jsonl`、`红拍=3 其中带 cause 字段=0 环境因（结构∪文案）=0` —— 逐字不变。

⇒ 又是一次**真料零差**（规则 307）：这批语料的红拍里没有一条带着这三句 harness 文案。
所以本笔的效果只能由合成输入与锚点认账；真语料要等带新落盘形状的真会话（同挂 #17）。

## 4. 判卷与门

| 项 | 读数 |
| --- | --- |
| 五个判卷文件（尺 3 支 + 新普查 1 支 + dating 1 支） | `judges.log`：`Tests 61 passed (61)`、`judges_exit=0`（corpus 9→14、cascade 6→9、新普查文件 5 条、exec 27、dating 6） |
| 全量套件 | `full-suite.log`：`Test Files 251 passed (251)｜Tests 3243 passed (3243)｜118.99s`，`full-suite-exit.txt` 印 `suite_exit=0`（比第 221 页认证的 3230 多 13 条＝本笔新增） |
| 类型 | `typecheck.log`：`0 条报错 ✅` |
| 针脚自检（提交前） | `needles-before-commit.log`：阻断 6 ＝ 钉在飞文本 5 ＋ 判卷未入库 1（`tests/env-cue-single-source.test.ts` 还没提交，规则 303 那一格） |
| 表长 | `--list` 现读 1055（1051 −1 撤重复条目 ＋5 新增） |

一处口径要说在前面：那 5 个判卷文件与全量套件**有一段并发重叠**（我起了全量之后又跑了单文件）。
并发只会造成假红而不会造成假绿（本仓已知那只撞点是 `/tmp/m1e-default-settings.json`），两侧当时都给出 exit=0 ⇒
结论不受影响，但墙钟数（118.99s）不许当单价引用。


锚点：撤 `replay-exec-text-anchor-lost` 的旧条目（针脚 `T_EXIT_127 = /^` 随收敛消失）、用同一 id 重指到表本身，
另加 4 条（`textualKind` 不吃表／cascade 少按 command 判／cascade 少吃表／把 pkg 正则再抄一遍）。
最后那条**行为完全等价**（两条正则同字），只有普查尺抓得到——规则 259 点名的"突变不可观察"那一类。
