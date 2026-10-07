# 第 424 页簇的干净树复认与认证读数（凭证页 425 用，2026-10-08）

## 1. 派生复认（`--changed-since`，不手点名单）

跑在自建干净树 `.worktrees/verify-d39f14e`（`git worktree add --detach`，`cp -al` 打依赖，建树后 `status --porcelain` = **0 项**）：

```text
改动面派生：rev=bea817ee → 变更文件 6 个 ⇒ 选中锚点 132/1492 条
[mutate-verify] 锁=本进程持有（.git/dsh-tool-locks/mutate-verify-judge-424.lock）
变异验证：132 条
```

逐条计数（现读，不是推算）：`grep -c '^✅'` = **131**；判红 **1** 条，且**不是本簇的**：

```text
❌ autoverify-ipc-override-ignored — 那一行改成「只读 settings」⇒ 调用方显式传的 false 被吞掉…
   变异存活：测试全绿 = 对该逻辑无分辨力（恒真等价）
```

本簇四根逐条 ✅（`plugin-data-root-assembly-falls-back-to-tmp`／`-env-override-ignored`／`-empty-env-used-as-path`／`-default-dir-dropped`）。

## 2. 那一条存活的归因（父子各跑一次，不靠猜）

| 取料面 | 结果 |
| --- | --- |
| 干净树 `d39f14e`（本簇，整跑派生 132 条） | 存活 |
| 同一棵树 `git checkout --detach bea817ee`（父提交）单跑这一根 | **同样存活**，`PARENT_EXIT=1`，原文同一句「变异存活：测试全绿」 |
| needle `autoVerify: over.autoVerify ?? (await store().get()).autoVerify,` | HEAD 出现 1 次、HEAD~1 出现 1 次 ⇒ **不是实现搬家**，是判卷零分辨力 |

⇒ 与本簇无关（我改的 3 行是 os import、plugins import、`pluginDataRoot` 装配行）。门自己给的出口提示指了修法：「函数里有 4 条 return ⇒ 先问判卷喂到了第几支」。这根不是我加的，动它要改别人的判卷文件，登记为工单、不代修。

## 3. `head-cert` 认证读数（`d39f14ee`，原文）

```text
已核：TREE=d39f14ee8e14fa5080769e827ad5528b5c147e1e｜判卷四面在飞 0 项
  TREE=d39f14e DIRTY_JUDGED=0 依赖完整=是 收尾复核=同一笔 认证树锁=本进程持有（.git/dsh-tool-locks/head-cert-head-cert-d39f14e.lock）
  Test Files 1 failed | 345 passed (346)｜Tests 1 failed | 4869 passed (4870)｜exit=1（退出码直接取，不接管道）
  并发判卷=起前 0 套／跑完 0 套（两端独占）
  本趟墙钟 231.50s
  贴帽读数（缺省＝config 里的 testTimeout=30000ms）：4870 条里 0 条用时 ≥ 有效预算 80%｜无显式预算按缺省算 4535 条
  认证门面=23 道（跑到 23）｜绿 23 道｜⚠️ 超预算 0
  依赖核对：该提交声明 10 项，缺 0 项
  import 面：3888 条边｜悬空 0（其中存量已豁免 0）
  门表：33 道，其中该笔 package.json 没有同名 script 的 0 道
  typecheck exit=0（0 报错）
  已回收认证树 .worktrees/head-cert-d39f14e（exit=0）
```

门读数里有两格与第 423 页不同，都是真的变了：`mutate-needles-check 14678ms`（表长 1488→1496）；`repo-hygiene-check exit=0`——**HEAD 侧那把门一直是绿的**，红只在含隔壁在飞改动的工作树面（`src/main/agent-runner.ts` 3107＞帽 3100）。

## 4. 唯一那条红的归因（不是本簇）

```text
FAIL tests/scratch-tree-naming.test.ts > 真仓面：注册表里的暂存树名字都没说谎 > 三类不一致都必须为 0，且报出来时要点名是哪棵树
AssertionError: 暂存树 gate-mutate-verify 的名字没编码提交（约定是 <前缀>-<sha>）⇒ 回收时无法从名字认出它钉在哪一笔
```

第 413 页登记过的那格常驻红：`gate-mutate-verify` 是常驻门在用的共享树名，豁免还躺在别人工作树里没落库 ⇒ **只要那笔不落，任何会话的 head-cert 都只能读到 exit=1**。本笔不动别人的判卷。

## 5. 条数核对式与清场

- `4870 = 4862（第 423 页认证）＋ 8（本簇新判卷文件）`；`Test Files 346 = 345 ＋ 1`（新文件）。
- 自建树核过后回收：`verify-d39f14e`（0 项在飞 ∧ detached ∧ `d39f14ee` 已入库）已 `git worktree remove --force`；`head-cert-d39f14e` 由门自回收。`.worktrees/` 现在只剩 `gate-mutate-verify`（常驻门，不属于我）。
- 一处实操修正：`rm <树>/node_modules` 在这一支 Skill 里假设的是软链，而本轮用的是 **`cp -al` 目录** ⇒ `rm` 报 `is a directory`。正确处置是直接 `git worktree remove --force <树>`（它连目录一起收），不需要先手工 `rm -rf`。
