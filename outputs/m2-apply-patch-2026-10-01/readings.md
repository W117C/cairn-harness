# M2 基线读数 · 补丁级输入 vs 逐处替换（2026-10-01）

命令与出处（两条都退 0）：

```
node --import tsx outputs/m2-apply-patch-2026-10-01/measure-payload.mts 60   # exit=0，全文存 baseline-n60.log
node --import tsx outputs/m2-apply-patch-2026-10-01/measure-payload.mts 200  # exit=0，全文存 baseline-n200.log
```

取料 = 本仓 HEAD（`5e0c859`）往回 N 笔**非 merge 提交**的 `git diff -U3`，同一批 hunk 拆给两侧（同分母）。
两侧字符都是「模型必须逐字打出的正文」的下界模型：patch 侧每 hunk 上下文出现**一遍**，
edit 侧同一份上下文要在 `old_string` 与 `new_string` 里各出现一次（**两遍**），再加每次调用的固定开销。
**调用次数不依赖这些假设**，所以它是承重读数；字符读数只当量级看。

## 读数 1 · 调用次数（硬读数）

| 语料 | 提交数 | 统一 diff 一侧 | edit_file 一侧 | 倍数 |
|---|---|---|---|---|
| 全部文件 n=60 | 60 | **60 次**（一笔一次） | **680 次**（一处一次） | 11.3× |
| 全部文件 n=200 | 200 | 200 次 | 2,035 次 | 10.2× |
| 仅源码文件 n=60 | 40 | 40 次 | 219 次 | 5.5× |
| 仅源码文件 n=200 | 132 | 132 次 | 979 次 | 7.4× |

每笔提交的 hunk 数：全体 n=60 中位 10、最大 38；n=200 中位 7、最大 122。仅源码 n=60 中位 3。

## 读数 2 · 字符量（模型相关，两侧同分母）

| 语料 | 统一 diff | edit_file | 逐笔 edit/patch 中位 |
|---|---|---|---|
| 全部文件 n=60 | 3,522,659 字符 | 3,531,492 字符 | **0.99×** |
| 全部文件 n=200 | 10,664,807 | 10,731,322 | **1.00×** |
| 仅源码 n=60 | 297,179 | 338,918 | **1.11×**（每 hunk 归一 1,357 vs 1,548 字符） |
| 仅源码 n=200 | 1,608,337 | 1,809,663 | **1.16×**（每 hunk 归一 1,643 vs 1,848 字符） |

**这条读数否掉了 PLAN 的一句话。** PLAN §M2 目标写「让改动更小」，全量语料上两侧字符量是平的
（0.99×/1.00×），因为本仓提交以 `PROGRESS.md` 的长中文段落为主——那种改动里上下文占比极低，
「上下文抄两遍」的代价被长行淹没。**只看源码时补丁侧确实省**：11–16%（中位），来源就是那份只抄一遍的上下文。
⇒ apply_patch 的价值按证据排：**① 一次调用替掉 5–11 次；② 跨文件一笔原子落地；③ 逐 hunk 归因；
④ 源码侧字符省 11–16%**。④ 不能当主打，①③才是。

## 读数 3 · 行数口径分歧（决定 apply_patch 的行数读数怎么产）

现口径 `src/tools/line-delta.ts:25` 的 `lineDelta` 是**多重集差**（文件注释自己声明了与 git 的口径差）。
逐文件比对「该文件 git 的 +/− 行数」vs「多重集差」：

- n=60：可比 140 个文件（跳过新建/删除/改名 428）→ **分歧 5 处（3.6%）**
- n=200：可比 546 个文件（跳过 973）→ **分歧 15 处（2.7%）**

逐条（n=60 全部 5 条，两侧都偏低 1–2 行，方向一致）：

```
73ed49d tests/prose-needle-scan.test.ts｜git +22 −3 vs 多重集 +20 −1
e42b4af scripts/docs-check.ts｜git +43 −10 vs 多重集 +42 −9
e384b65 scripts/lib/evidence-typecheck.ts｜git +55 −9 vs 多重集 +54 −8
8689734 scripts/prose-needle-scan.ts｜git +36 −10 vs 多重集 +34 −8
e02b87f tests/docs-check.test.ts｜git +41 −18 vs 多重集 +40 −17
```

⇒ PLAN §M2 验收要求「行数读数与 `git diff --stat` 一致」，用现口径做不到（约 3% 的文件上差 1–2 行）。
补丁自带每 hunk 的 +/- 计数，**apply_patch 用 hunk 计数报数**，与 git 天然同口径；
`lineDelta` 保持原样（它是既证判卷的被测对象，且它的口径回答的是另一个问题：「这次写盘丢了几行内容」）。

## 量不了的事（不写成分，也不写 0）

- 「少返工 / 成功率提升」：本仓没有可用的真会话 edit 失败语料——`.agent/sessions` 为空目录（实测 `du` 0B）。
  这条要等一次带真模型凭据的会话才有分母，登记为**缺语料**，不做推算。
- 「省了多少秒」：调用次数 × 单位时长 是模型不是读数（本仓已点过账），这里不换算。

## 探针自曝（记下来，规则适用到下一次）

第一版探针的哨兵只数了 hunk 个数，**路径解析整块坏掉（568 个文件全停在 `"?"`）却没被抓住**，
产出一段「分歧 568 处 / 多重集 +0 −0」的假读数。改法：哨兵逐字段钉（路径、每 hunk 的 add/rem/ctx、
binary 位、两侧字符模型非 0），坏立刻退 1。第二处真缺陷是同因抓出来的——二进制段没有 `+++` 行，
路径只能从 `Binary files a/… and b/… differ` 取。另发现 1 个文件的 diff 段既无 `+++` 也无 Binary 行
（`a5197eb outputs/inflight-index-witness-2026-09-30/tsc-probes.log`，仅模式变更），
不是解析缺陷，但**生产解析器必须能吃下 `old mode/new mode` 这种无内容段而不报错**。

---

# 验收实证（2026-10-01 · 本会话补：接线 + 真仓验证 + 反向验证）

> 上面三节是**基线与口径**（为什么做、行数读数怎么产）；这一节是**验收读数**（工具本身对不对、门接没接上）。

## 一、真仓验证（`verify-real-git.mts`，本仓真实提交，HEAD=4518981）

命令（两条都退 0）：

```
TERM=dumb node --import tsx outputs/m2-apply-patch-2026-10-01/verify-real-git.mts 60   # 全文 verify-real-git-n60.log
TERM=dumb node --import tsx outputs/m2-apply-patch-2026-10-01/verify-real-git.mts 200  # 全文 verify-real-git-n200.log
```

取料：HEAD 往回 N 笔非 merge 提交的 `git diff -U3`，在一次性 scratch 树里重建「改前」状态再应用；
逐文件比 ① 落盘内容与 `git show <sha>:<path>` 逐字节；② 回执 +a −b 与 `git diff --numstat`（同 `--stat` 口径）。

| 档 | 合格提交（≥3 hunk） | 应用成功 | 应用失败 | 超 256KB 上限（设计边界） | 覆盖 hunk | 逐字节比对文件 | 字节不符 | 行数不符 | exit |
|---|---|---|---|---|---|---|---|---|---|
| n=60 | 50 | 49 | **0** | 1 | 720 | 588 | **0** | **0** | 0 |
| n=200 | 162 | 156 | **0** | 6 | 2,086 | 1,424 | **0** | **0** | 0 |

**探针自身的两处假读数（修复前，已作废重跑）**：
- 回执清单按 20 个文件截断，旧版把「没打印」读成「行数不符」⇒ 39 处假读数（逐条核对全部是第 21+ 位文件；总数格另核）。
- `git` 默认 `core.quotePath=true` 把非 ASCII 路径转义 ⇒ 中文路径整个退出分母（同 `cfa91e1` 踩过的坑）。
  已全部 `-c core.quotePath=false`，并打印「多字节路径文件」计数自证（**本窗口实测 0 条**——已复核窗口内本就
  没有中文路径，不是探针瞎；换语料即显形）。

## 二、反向验证（两条，各自「拆掉 → 判卷红 → 复原 → 绿」）

| 机制 | 拆法 | 读数 | 复原 |
|---|---|---|---|
| hunk 上下文逐字校验 | `locate()` 的 `matches` 改成恒真 | `reverse-verify-guard-off.log`：**6 条红**（含「上下文漂移」），exit=1 | `reverse-verify-restored.log`：28 绿 exit=0；sha256 前后同为 `35b1672…`（逐字节复原） |
| 写向工具的门包装 | 摘掉 `TOOLS.apply_patch = gatedTool(...)` | `reverse-verify-wrap-off.log`：**接线棘轮 1 条红**，exit=1 | `reverse-verify-wrap-restored.log`：14 绿 exit=0；runner sha256 前后同为 `52d2006…` |

## 三、接线与判卷/门读数

- 五面接线（`TOOL_NAMES` / `TOOLS` / `glm-session` 规格 / `SIDE_EFFECT_TOOLS` / `agent-runner` 门包装）
  + `tools-check` 9→10 + `prompt-surface-check` 判卷水位（61→62、19→20；只读档 16 **不动**）。
  明细与「任务书口径修正（tool-surface 只收注入工具）」见 `LEDGER.md`。
- 新增判卷：`tests/apply-patch.test.ts` 28 条；`tests/write-face.test.ts` +1 条「接线棘轮」（TOOLS 里每个写向
  工具必须被 `gatedTool` 包装；防未来漏包——正是 M7 审计点名的「新工具族静默绕过写禁」的另一半）。
- **全量判卷**：`full-suite.log` = `Test Files 265 passed (265)｜Tests 3563 passed (3563)｜exit=0｜171.32s`
  （基线 3512 ⇒ 只增不减）。
- **门**：`tools-check` ✅ exit=0（「注册表含 10 个工具」；`gate-tools-check.log`）、
  `prompt-surface-check` ✅ exit=0（`gate-prompt-surface.log`）。
- **typecheck**：`typecheck-2.log` = `tsc --noEmit 通过（0 条报错）✅`，exit=0。中途一跑曾红 4 处、
  全部归因隔壁在飞的 `scripts/docs-check.ts`（本簇文件从未出现在报错面）；隔壁修好后复跑全绿。

## 四、局限与开放项（不写成分）

- 「补丁比逐处替换少返工 / 提成功率」仍缺真会话 edit 失败语料（`.agent/sessions` 空）⇒ 不推算。
- `staticRisk` 里 `edit_file`=medium、`write_file`=none；`apply_patch` 现与 write_file 同（none）。guided/auto 档
  会有"兄弟分叉"——不是洞（默认/只读档 `writeAsk=true` 照问；沙箱通道已按 `isSideEffectTool` 覆盖它），
  建议 M7 重写权限表时一并裁决（已记 `LEDGER.md` 开放项 1）。
- 真仓验证的「非 ASCII 路径」格在本窗口无样本（0 条）；探针已带 `-c core.quotePath=false` 与计数格，
  换中文路径语料即显形。
