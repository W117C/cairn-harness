# 复跑面可信赖（D-8）：把「可直接粘贴复跑」从一句话变成一条会红的门（2026-09-23）

来源：`outputs/gap-fix-proposal-2026-09-23.md` 的 **P0-1**（它排在全提案最前，理由是
「判卷跑不起的项排在前面试图施工 = 在没有尺的情况下量东西」）。本页 = 主张、判据、施工回执。

## 一、实测的腐（不是推测）

`docs/judgment-layer-calibration-proposal.md` 附录 A 写着「下面这段可直接粘贴复跑」。原样抽出照跑：

```
$ awk '/^## 附录 A/{f=1} …' docs/judgment-layer-calibration-proposal.md > /tmp/appendixA.sh && bash /tmp/appendixA.sh
src/permissions/autonomy.ts:290
TypeError: s.planBlocked is not a function
    at evaluate (src/permissions/autonomy.ts:290:9)
```

根因**不是有人改坏了脚本**：`planBlocked` 从 `boolean` 变成 `() => boolean`（评审 C6——快照布尔只有主会话
三处刷新，worker 那条路从不刷，于是「先批后写」对 spawn 出的 worker 整条失效），而文档里手搭的 fixture
与产品形状**没有任何编译期关系**。heredoc 的源码住在 `.md` 里 ⇒ tsc 看不见 ⇒ 判卷读数静默死亡，
没有任何门知道。§7 第 1 步的判卷读数（ask 密度从 92% 动起来）**就是这条命令**——所以它排在别人前面。

## 二、修法：搬进编译面，再让登记表两侧都能红

1. **两段 heredoc 变成真脚本**：`scripts/replay/ask-density.ts`、`scripts/replay/corpus-inventory.ts`。
   进 tsc 覆盖面只是第一层，第二层是 fixture 不再手搭——改走 `newAutonomySession(mode, init)`，
   会话形状由构造器持有。**搬的过程中类型系统当场教了两件事**（都是原先 `as any` 掩掉的）：
   - `EvaluateDecision` 是判别联合，**deny 支上没有 `risk`** ⇒ 旧写法 `d.risk ?? "deny"` 靠 `as any` 混过，
     现在按分支读（`d.verdict === "deny" ? "deny" : String(d.risk)`），语义逐字不变；
   - `PermissionMode` 住在 `src/permissions`、`ToolName` 住在 `src/tools/base`（我起初按语义猜了个
     `src/permissions/types` ⇒ TS2307 当场抓住）。
2. **登记表 + 合取判据**：`scripts/replay-readings.ts`（纯函数）+ `docs-check` 新条 **D-8**，四格各能红：
   ① 文档引用了没登记的 `replay:<id>`（无源）；② 登记了没文档引用（陈旧登记）；③ 登记项的脚本不在盘上；
   ④ 仍有内联 heredoc 复跑块（存量走 `LEGACY_WAIVERS` 按文件豁免，**只降不升**，不再命中即 stale 红）。
   取料一律从**真实 `.md` 文本**扫（不读登记表自陈）——借登记表判登记表就是"未登记项静默漏在机制外"。
3. **扫描面明写**：`docs/` 递归 + `AGENTS.md`/`PROGRESS.md`/`STATE.md`；面为 0 ⇒ 记 **未检**，不记通过。

## 三、回执

| 读数 | before | after | 同口径命令 |
|---|---|---|---|
| 附录 A 那条复跑 | `TypeError: s.planBlocked is not a function` | 跑出 `default sandbox=null 受管=97 ask=89 risk=none:39 medium:57 high:1` | `TERM=dumb node --import tsx scripts/replay/ask-density.ts` |
| ask 密度 | 读不出（门是死的） | **89/97 = 91.8% ≈ 该页写的 92%** ⇒ 口径与 2026-09-20 那次可比 | 同上 |
| 附录 B | 未跑（同一段 heredoc 形态） | `会话文件=19 tool_call=282 受管=97 受管含非ASCII=27` / `失败结果=15 无配对result=16 失败后仍调同一工具=7 其中参数一字不变=0` | `… scripts/replay/corpus-inventory.ts` |
| docs-check | 无 D-8 | 受检项全绿，存量豁免 18 → **19**（新增 `D-8|docs/PROJECT-REPORT-2026-09-22.md`，理由：dated 报告＝当日证据快照，不迁成常态读数） | `TERM=dumb node --import tsx scripts/docs-check.ts` |
| tests | — | `tests/docs-check.test.ts` 42 条全绿（D-8 新增 7 条，正反两相） | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/docs-check.test.ts` |
| 锚点 | 786 | **788**（`replay-unregistered-refs-blinded` / `replay-unreferenced-ids-blinded`，各钉一格） | `node --import tsx scripts/mutate-verify.mjs --check-needles` |

⚠️ **语料从 20 个文件变 19 个**（`tool_call` 285→282、失败 16→15）：两天里 `outputs/**` 与 app 会话目录被别的轮次改过，
是**语料**变了不是口径变了——本页只报新读数，不假装旧数还能复现（旧数留在该页原文，当日快照）。

**当场造红两次（跑完即撤销）**：① 把 `ask-density.ts` 暂时挪走 ⇒ `❌ D-8 scripts/replay/ask-density.ts`；
② 新建一页含内联 heredoc ⇒ `❌ D-8 docs/tmp-d8-probe.md`；两次撤销后均回绿。
针脚体检在提交前如实报 **未入库面 2**（我这两个锚点的被测面 `scripts/replay-readings.ts` 还没进 git）——
这条红是门自己的正确行为，不是回归（规则 97：门读盘 ⇒ 对 HEAD 里没有的东西零信号）。

**留位**：`PROJECT-REPORT-2026-09-22.md` 的那条内联块按上述理由豁免，未迁；`outputs/**` 里 dated 页的
复跑命令不在本判据面内（它们是证据不是现役页），要管得另立一面。
