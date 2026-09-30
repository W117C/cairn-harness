# `--direct` 重标定的实测对比：18 道门双模式全脸（2026-09-30 22:4x，主树 @`a30a96d`）

第 232 页裁决选项①的数据集。同 18 道门（20 道门面剔除 `gate-check`——它会跑 vitest，隔壁正改判卷文件；
剔除 `mutate-needles-check`——它会把在飞文本计成钉在飞文本）、同树、同分钟窗口，
两种执行器各跑一趟整脸。机器原句在同目录 `direct-face.log`／`pnpm-face.log`。

| 门 | direct（本体） | pnpm（认证同款） | 差值 |
| --- | --- | --- | --- |
| no-progress-check | 72ms | 521ms | +449 |
| prune-check | 121ms | 587ms | +466 |
| fork-check | 66ms | 531ms | +465 |
| compaction-check | 207ms | 662ms | +455 |
| docs-check | 400ms | 722ms | +322 |
| memory-check | 245ms | 735ms | +490 |
| head-import-check | 258ms | 683ms | +425 |
| autonomy-check | 488ms | 783ms | +295 |
| sandbox:check | 388ms | 909ms | +521 |
| security-check | 392ms | 801ms | +409 |
| provider:check | 94ms | 525ms | +431 |
| routing-check | 255ms | 728ms | +473 |
| model-surface-check | 295ms | 710ms | +415 |
| prefix-churn-check | 408ms | 838ms | +430 |
| prompt-surface-check | 293ms | 758ms | +465 |
| replay-determinism-check | 139ms | 558ms | +419 |
| cost-per-progress-check | 95ms | 533ms | +438 |
| gym-check | 917ms | 1377ms | +460 |
| **18 道合计** | **5133ms** | **12961ms** | **+7828（60%）** |

## 三条结论

1. **第 234 页的平税在 18 道全脸上成立**：差值全部落在 +295~521ms（中位 ≈ +437ms），与门本体大小无关；
   两趟全程负载 3-5，无一扇门红，读数干净。
2. **外推 20 道门面**：把认证里的 `gate-check`（4609ms）与 `mutate-needles-check`（11002ms）按"本体 ≈ 复合 −0.5s 税"拆回，
   20 道 direct 脸 ≈ **19.7s vs pnpm 脸 ≈ 28.6s ⇒ 每趟认证省 ≈ 8.9s（31%）**——与第 234 页"8s/趟（三成）"的外推吻合。
3. **重标定后的帽空间**：direct 本体全部 ≪ 现帽（最大的 gym-check 917ms 对帽 2400）——
   若按选项①迁移，帽可以定在"本体中位 × margin"而不再是"单次复合样本 × 2"，
   附带收益是认证读数不再随并发 suite 漂移（第 231/232 页两次超帽的根都在包装层）。

## 口径注意

- 各一趟、单点非中位（同 234 页口径注意）；主树非认证树——认证树里包装层只会更贵，本表对省量是**下界**、对帽是**上界**。
- 两条子集跑已按 `scope:{ran:18,total:29}` 进耗时账本侧信道。
- `gate-check`／`mutate-needles-check` 两道的本体读数留待干净窗口补（届时可整表重标定，属裁决后动作）。
