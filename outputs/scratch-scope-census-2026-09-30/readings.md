# 「哪些树算本仓 scratch」裁决的现读事实（2026-09-30 21:1x，主树 @`62111a1`）

为第 230 页凭证 §6-② 与第 231 页登记的裁决准备。**只取事实，不替裁决。**
取料方法：`git worktree list --porcelain` 全量 24 棵，逐棵 `git -C <树> status --porcelain`（脏项数）＋
`git merge-base --is-ancestor <HEAD> 主HEAD`（入库性）。只读，未动任何树。
注意两格的时效性：**在飞**（谓词条件②）与**脏项数**随时会变——本快照冻结在 2026-09-30 21:1x。

## 一、全量清单（按位置分面）

### scratch 面（主树 `.worktrees/`）＝本仓工具自己建的 —— 21 棵

| 树 | detached | HEAD 入库性 | 脏项 | 现行谓词判定（①②③④，不含位置） |
| --- | --- | --- | --- | --- |
| gate-head-cert | ✓ | 已入库 | 0 | **四条全中 ⇒ stale** |
| gate-mutate-verify | ✓ | 已入库 | 0 | **四条全中 ⇒ stale** |
| head-cert-d2958b2 | ✓ | 已入库 | 1 | ②挡（脏 1 项） |
| head-audit-0924 | ✓ | 已入库 | 5 | ②挡 |
| ui-codex-bench | ✗ feat/ui-codex-bench | 已入库 | 16 | ①挡（分支树） |
| r1b | ✗ codex/r1b-renderer-subtraction | 已入库 | 0 | ①挡 |
| goal-plan | ✗ feat/goal-plan-mode | 已入库 | 0 | ①挡 |
| doc-layer | ✗ doc-layer-migration | 未入库 | 0 | ①挡 |
| opt | ✗ opt/agent-v2 | 未入库 | 0 | ①挡 |
| p169-staging | ✓ | **未入库** | 0 | ③挡（回收前必查 merge-base） |
| p170-tighten | ✓ | **未入库** | 0 | ③挡 |
| p187-a／b／c／d | ✓ | **未入库** | 0 | ③挡 ×4 |
| verify-5116b3f／6d06519／a7370a6／b248068／dd3af4e／f31e89e | ✓ | **未入库** | 0 | ③挡 ×6 |

### 第三方（`.claude/worktrees/…`）＝别的工具/会话的地盘 —— 2 棵

| 树 | detached | HEAD 入库性 | 脏项 | 备注 |
| --- | --- | --- | --- | --- |
| goofy-satoshi-0edc69 | ✗ claude/goofy-satoshi-0edc69 | 已入库 | 0 | Claude 会话树，分支头 |
| …/audit-zcode（嵌套） | ✓ | 已入库（@`d2d44a6`） | **7** | **在飞活会话**；第 230 页那条红里被点名的就是它 |

### 主树 —— 1 棵
`zcode` @`62111a1`，脏 11 项（第 231 页在飞：`scripts/lib/head-cert-deps.ts` 等）。

## 二、口径裁决实际在定什么

1. **第 231 页的修法（在飞，已读到 diff）是"分格"不是"放宽"**：`staleScratchTrees` 增第五格 `foreign`——
   四条硬条件全中但不住 scratch 面的树，照样报出来（不静默丢条），只是不配那句「可以去收」。
   前缀匹配按目录边界（`.worktrees-backup` 撞名防住了），主根问 `--git-common-dir` 要。
2. **本快照下，两种口径的实际差别只有一行**：现行谓词（不看位置）＋判卷喂真清单时，
   `…/audit-zcode` 这类外来树一旦脏项归零就会被点名并配上回收命令；分格后它们进 `foreign` 行，点名但不配命令。
   scratch 面**内部**的 stale 名单两种口径完全一致（外来树都在面外）。
3. **"回收授权"与"口径裁决"是两笔独立账**：即使口径定了，scratch 面里今天配得上「可以去收」的也只有
   `gate-head-cert`、`gate-mutate-verify` 两棵；**11 棵 verify/p187/p169/p170 树 HEAD 未入库**——
   其中 verify-* 是当时认证目标的 checkout（那笔多半已入库、树头漂了），p187/p169 簇按项目记忆
   `dsh-landing-1c40df7-voucher` 有**本地独有提交**，逐棵查 merge-base 之前回收就是丢数据。
   分支树 5 棵与脏树 2 棵无论如何都受①②保护。
4. **建议的裁决问句（供用户一句话回答）**：`.claude/worktrees/` 这类**别的工具建的**树，
   永远只报不收（第 231 页在飞的 `foreign` 格），还是也纳入本仓回收射程？
   ——若选"永远只报不收"，第 231 页修法落地即结案；若选"纳入"，需要先回答"本仓工具凭什么往别的工具的目录里发回收命令"。

## 三、事后交叉印证（补于第 231 页凭证 `220c230` 落库后）

本普查独立判定的「scratch 面内四条全中 ⇒ stale」名单（`gate-head-cert@ae80d6e`、`gate-mutate-verify@27ffb30` 两棵），
与第 231 页凭证认证跑原样印出的 `常驻残留树=2（…完全相同两棵…）` 逐字一致——两份独立实现、两次现读，同一结论。
时效漂移也如期出现：本快照时 `audit-zcode` 脏 7 项，第 231 页探针（约半时后）读到 **18 项**——印证本页开头那句「在飞/脏项数只在读的那一刻有效」。
