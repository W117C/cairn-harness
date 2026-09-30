# 第 221 页 · 待办 #39：「没有退出码」第一次有自己的名字（2026-09-30）

取料命令（两棵树一字不差，同一份语料、同一分母）：

```
node --import tsx scripts/replay/verify-cause-mix.ts        # 工作树（改后）
cd .worktrees/head-cert-70eab48 && node --import tsx scripts/replay/verify-cause-mix.ts   # 改前（HEAD 侧的老树）
```

两份逐字输出：`ruler-after.log` / `ruler-before-at-70eab48.log`。

## 1. 同分母 A/B：真语料上**只有文字在变，数一个没变**

`diff` 三条差异行（全部是标签/说明，数值零差）：

| 行 | 改前（`70eab48` 那棵树） | 改后（本笔） |
| --- | --- | --- |
| 结构栏标签 | 「本尺口径：把 no-exit-code 从缺省 code 里分出来」 | 「与产品谓词同形：`not-run`＝没有退出码，第 221 页 #39 之后两边收敛」 |
| 分子标签 | 「正证**四**类／红拍」 | 「正证**五**类／红拍」 |
| ⚠️ 成因② | 「门拒绝 / unknown tool / 只读静态过滤——这三条落盘时既不带 gate 也不带结构字段」 | 「主会话门拒绝与 unknown tool 落盘时连 `gate` 都不带；worker 门拒绝带 `gate.verdict=denied`，但那是另一格判据，本面不读它」 |

数值面两侧逐字相同：`shell 家族 tool_result=40（run_shell:26 shell_ro:8 shell_rw:6）· join 不上=9 · 红拍=5`、
`带结构字段的红拍= 0`、`结构栏: no-structure:5`、`可机器归因占比= 0.00 (0/5)`、`其中环境类= 0.00 (0/5)`；
verify 面同样 8 行全等（`事件=19 红事件=3 红命令=3`、占比 `0.00 (0/3)`）。

**这条 A/B 的结论要说反**：真语料**分辨不了**这一笔的语义差——5 条红拍全部 `withStructure=0`，
两只版本都在第一道闸（`!hasCode && !hasTimeout`）就返回 `no-structure`，压根走不到我改的那一格。
所以「这一格有没有被守住」只能由**合成输入**判（`tests/replay-verify-cause-exec.test.ts` 那张七态表
＋那条「两边同形」用例＋六条锚点）。语料要等到有 #24 之后的新会话才有分子（挂在 #17：缺模型凭据）。
读数解释按尺自己印的那句：这个 0 是**数据年龄**，不是归因失效。

## 2. 改前原状：从 git 取字节，不凭记忆

`pre-state-from-git.txt`（`git show HEAD:…` 三段）里最要紧的两条：

- HEAD 的 `classifyVerifyFailure` 只有四道判据（`timeout`→`127`→`pkg-manager`→缺省 `code`）⇒
  `timedOut:false + exitCode:null` 落到 **`code`**：一次取消或被信号杀的命令被记成「代码错了」。
- HEAD 的尺自己在 `execStructKind` 里多插了一格 `no-exit-code`，注释原文写着
  「（谓词本身改不改另立任务）」——那句「另立任务」就是 #39，本笔兑现它。

## 3. 判卷与门（本笔实际跑过的）

| 项 | 命令 | 读数 |
| --- | --- | --- |
| 三个判卷文件 | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/shell-family-cause.test.ts tests/replay-verify-cause-exec.test.ts tests/verify-cause.test.ts` | `exit=0`，61 passed（19/15/27） |
| 类型 | `node --import tsx scripts/typecheck.ts` | `exit=0`，0 条报错 |
| 针脚自检（改前跑） | `node scripts/mutate-verify.mjs --check-needles` | `exit=1`：阻断 6 ＝ 钉在飞文本 5 ＋ HEAD 侧 expectFail 指针 1 |
| 表长 | `node scripts/mutate-verify.mjs --list \| wc -l` | 1051（1046−1＋6） |

针脚那 6 条红是**设计中的状态**：锚点与实现同一笔入库，落库后在干净树复跑应归零（复跑读数见本笔凭证页）。

## 4. 本笔新加的一条现读发现（登记为 #44，未动手）

同一个文件里，exec 面的文案栏（`execTextKind`）第 219 页起改成**行首锚定**，
而 verify 面的文案栏（`textualKind`）仍用 `out.includes("[exit code: 127]")` 这类**无锚**匹配。
两面读的是同类正文（被跑命令自己的输出），判据宽度却不同＝本仓点名的「同一判据四份副本、宽度各不同」。
不在本笔动它的原因：verify 面的现存读数（`文案栏: code-or-unknown:3`）已被第 217 页引用过，
改判据要连那张 A/B 一起重做，属另一笔。
