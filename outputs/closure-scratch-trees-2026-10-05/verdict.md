# 残留树归属判定（契约 A2）

判据本体是本仓自己的 `staleScratchTrees`（`scripts/lib/head-cert-deps.ts`），本目录**不重抄一份**"哪些能回收"——
同目录 `probe-stale-trees.mts` 只喂它 git 的取料面，读数是它的输出。回收判据与命名判据刻意不合并
（两把尺问的是两件事，合成一把会互相掩盖）。

## 判定读数

`stale = 0`／`unmeasured = 0`／`foreign = 0`（`stale-readings.txt`，取自主树根，HEAD `95e0b96c`）。

## 逐棵结论

| 树 | 形状 | 在飞项 | 判据结论 | 本轮处置 |
|---|---|---|---|---|
| `.worktrees/probe-head-e0b9bc7b` | detached，`e0b9bc7b` **已在 HEAD** | **1** | `stale` 第②格「0 项在飞」**不满足** ⇒ 不进残留名单 | **不删**，转登记（见下） |
| `.worktrees/verify-c7f2ea0f` | detached，`c7f2ea0f` **已在 HEAD** | **9** | 同上，第②格不满足 ⇒ 不进残留名单 | **不删**，转登记（见下） |
| `.qoder/worktrees/agent-general-purpose-*`（11 棵） | **带分支** | 0–4 | 第①格「detached」**不满足** ⇒ 一棵都不进名单 | 归属 harness 自己，不属本仓暂存面，不碰 |
| 主树 | 带分支 | — | 第①格不满足 | 不碰 |

**为什么一棵都不回收**：`staleScratchTrees` 的四个条件是**缺一不可**，而这两棵树各自卡在第②格
（有在飞改动）。契约写明的处置是「含在飞内容的**不删**，改登记为『归属谁、卡在哪、让出后怎么落』」——
所以正确动作是登记，不是回收。**回收条件与命名条件是两件事**：名字诚实（`probe-head-e0b9bc7b` /
`verify-c7f2ea0f` 都带提交号且与实际 HEAD 对得上，`name-not-head` 不响）**不构成**可以删的理由。

## 两棵树的登记条目

### ① `.worktrees/probe-head-e0b9bc7b` — 内容已在 HEAD，卡在 1 项未跟踪取料

- **在飞项**：`?? outputs/plan-persist-2026-10-05/`（1 项，未跟踪）。
- **归属**：我方（`e0b9bc7b`＝「#62 收口：head-cert-deps 那句归因改正」那笔，已在 HEAD）。
- **内容零丢失已核实**：该目录 5 件（`green-9of9.log`／`probe-head-clean-tree.log`／`probe-stall.mts`／
  `probe-unattended-arm.log`／`red-machine-mutation.log`）**已全部入库在 HEAD**，主树同一份齐。
  ⇒ 这一项不是"独有内容"，是**同一份内容的一份额外未跟踪副本**。
- **解锁条件**：删掉那棵树的未跟踪副本后 `dirty=0`（`e0b9bc7b` 已是 HEAD 祖先、detached、住本仓 scratch 面，
  四格余三格全满足）⇒ 判据会把它列进 `stale`，并给出回收命令。**本轮不做**：删工作树属破坏性动作，
  且契约的处置条款对"含在飞内容"给的是登记不是删除；这一项由业主点头后执行。

### ② `.worktrees/verify-c7f2ea0f` — 9 项真在飞活，是 `#69`／`#71` 的备妥簇

- **在飞项**（9 项）：`src/agent/loop.ts`（`+18`）、`src/agent/no-progress.ts`（`+23/-8`）、
  `src/tools/run_shell.ts`（`+16/-1`）、`scripts/no-progress-check.ts`（`+19`）、
  `tests/no-progress.test.ts`（`+20/-1`）、`tests/shell-family-cause.test.ts`（`+10/-1`）、
  `fixtures/no-progress/synth-red-repeat-readonly-shell.events.jsonl`（`+9`）、
  `fixtures/no-progress/synth-red-repeat-shell-write.events.jsonl`（`+9`）、
  未跟踪 `tests/cap-hit-verify.test.ts`。
- **归属**：我方上一轮备妥的簇（台账第 361／364 页：`#69` 撞 `maxSteps` 那条路从来走不到收束闸、
  `#71` 无进展阶梯 R1 的门与判卷）。**它是一份已造红→实现→反证过的补丁**，不是垃圾。
- **卡在哪**：同批要落的 9 项里有 `src/agent/loop.ts`——**在飞面**。
- **让出后怎么落**：主树现读 `src/agent/loop.ts` **不在**在飞清单（`git status -- src/agent/loop.ts` 空），
  ⇒ 前置已解除，可整簇并入；并入时按原子簇补齐 `scripts/frozen-sha256.json` 冻结登记
  （**这一步本仓写明只能由人做**，不由我代劳），再在干净树跑 `--check-needles` 与全量。
- **本轮不并的理由**：这 9 项与主树已落的相邻改动（`#93` 的 `verify.ts` 第三结局、`#99` 的
  `run_shell` 快照）动的是同一簇文件的两面，pathspec 提交会把隔壁 hunk 一起吞进去
  （第 334 页记过这条事故：`8 行`被卷进 HEAD，靠逐字节退回去才发现）。

## 未跑的读数（不写成绿）

本目录只跑了这一个探针（秒级，只读文件系统与 git 取料面）。**没跑**全量、认证、`mutate-verify`；
**没做**回收动作。页面不宣布任何「绿了」。