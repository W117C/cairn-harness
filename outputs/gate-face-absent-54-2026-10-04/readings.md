# #54 落地的读数（2026-10-04，取料＝干净 detached 树 `.worktrees/verify-head-0d41eff` @ `0d41eff2`）

`gateFaceDiff` 从两档改成三档：门本体（HEAD 里有、盘上也改了）／**HEAD 里根本没这支门**／非门。
动机是第 345 页我自己踩的那格——在干净 HEAD 树里跑了一支只存在于隔壁暂存面的门，拿到
`ERR_MODULE_NOT_FOUND`，被旧口径（「差异 21 支 ⇒ 门本体 9」）读成了"那道门在飞"。

| 跑法（逐字） | 退出码 | 读数 |
|---|---|---|
| `node --import tsx scripts/typecheck.ts`（干净树＋本笔三支文件） | 0 | `tsc --noEmit 通过（0 条报错）` |
| `vitest run tests/commit-surface-check.test.ts`（基线） | 0 | `Test Files 1 passed (1)｜Tests 27 passed (27)` ⇒ 该文件 **22 → 27 条**（＋5） |
| **造红 B**：把实现退化回两档（`absentInHead.push(p)` → `gates.push(p)`） | 1 | `Tests 3 failed \| 24 passed (27)`，红在三条**不同**用例：「HEAD 里没这门 ⇒ 单列」／「同一支门在 HEAD 里有／没有 ⇒ 两档各一条，两半互斥」／「分母守恒」 |
| 复原校验 `cmp` 对主树那份 | 0 | `RESTORED_BYTE_IDENTICAL`（残骸 `.mutbak` 0 支——变异是在验证树里做的，主树从头到尾没被就地改过） |

## 现读订正：那一句「9 道门在飞」里其实混着两件事

主树跑 `node --import tsx scripts/commit-surface-check.ts`（`scripts` 面差异 **23** 支）：

- 旧口径（第 339 页与第 344 页都引过）：`门本体 9 ｜非门 12`
- 新口径：`门本体 8 ｜非门 14 ｜HEAD 里没这门 1（scripts/repo-hygiene-check.ts）`

⇒ 被单列出去的那一支正是**体量门**：它在 HEAD 里连文件都没有（第 343 页已量：`git ls-tree HEAD` 0 行／`HEAD:package.json` 0 命中／`HEAD:gate-manifest.ts` 0 命中）。
所以「9 道门在飞」这句话里，一直有 1 道是「还没入库」——这两件事的修法完全不同（前者：等它落库后跟着挪针脚；后者：等它落库，而不是怀疑它在飞时读错了）。
差值不守恒的那两格（非门 12 → 14、差异 21 → 23）是这两小时里别人新增的在飞文件，不是本笔造成的。
