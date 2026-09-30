# 影响面精度只读探针（能力 1 底账，2026-09-30 23:2x，主树 @`beaa6f0`）

方法：对 4 个**真值已知**的符号跑 `upward(谁调用我)`（`buildImpact` 全仓建图 → `upward`），
与 word-boundary grep 的调用点真值并排，逐处差异人工归类。探针 `probe.mts`／原句 `probe.log` 同目录。
真值符号全是本会话亲手碰过的函数——调用点真值来自本轮工作记忆＋grep 双源，不是印象。

## 一、图的基础盘

`files=537 · candidates=537 · cap=5000 · partial=false` —— 覆盖诚实：候选全收、没有截断，"图非全量"判据（`graphIsPartial`）这一格有真值可依。

## 二、逐符号结果

| 符号 | 定义点 | graph upward | grep 真值（主树） | 判定 |
| --- | --- | --- | --- | --- |
| `appendRun` | scripts/facts.ts | **1**：gates.ts:164 | 1 处调用（＋.claude 外域拷贝 1） | **精确率/召回率全对**；外域拷贝被正确排除 |
| `staleScratchTrees` | scripts/lib/head-cert-deps.ts | **10**：head-cert.ts:301 ＋ 9 处判卷调用 | 10 处调用 ＋ 1 处字符串断言（:899 `toContain("staleScratchTrees…")`） | **全对**；字符串里的名字被正确排除（不是调用） |
| `runInSandbox` | src/main/sandbox.ts:116 | **12**：sandbox-check.ts ×10 ＋ agent-runner.ts ×2 | 12 处跨文件调用 ＋ **1 处同文件内部调用**（sandbox.ts:170 自检） | 跨文件全对；同文件那 1 处不入图（见下） |
| `insideScratchFace` | scripts/lib/head-cert-deps.ts:251（模块私有，未导出） | **0** | 1 处调用（:294，同文件 `staleScratchTrees` 内） | **盲区**：同文件调用边不入图 |

## 三、两条结论

1. **跨文件调用边：精确率与召回率 23/23 全对**（10＋12＋1）。生产调用点、判卷调用点、多文件同名人、字符串假调用、
   外域树拷贝（`.claude/worktrees/…/audit-zcode` 的整份副本）——五种干扰全部处理正确。能力 1 的「这个改动会影响哪里」
   在跨文件维度上，今天实测是**可信的尺**。
2. **系统盲区（设计边界，要登记不要装没看见）**：同文件调用边不入图——`insideScratchFace` 这类模块私有辅助函数的
   upward 查询返回空（0/1），`runInSandbox` 在自己文件里的内部自用（0/1）同样不在。「谁调用我」对**私有函数**默认空手。
   工具层（`impact-query`）是否用同文件文本搜索补过这一格，属读端行为，本探针只测了图层。要不要补同文件边（或工具层兜底出声）属下一笔裁决。

## 四、探针方法论的自我修正（记下来防重犯）

第一跑把输出接进 `| head -60`——head 提前关流，SIGPIPE 把 `appendRun` 段整个截掉，差点把「空段」当「零命中」读。
证据管道里不接 head，全程落盘再读——这条与「退出码直接取，不接管道」同族。
