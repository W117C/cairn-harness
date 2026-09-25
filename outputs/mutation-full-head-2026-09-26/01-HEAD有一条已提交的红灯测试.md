# 第 83 页 · 整张变异表里那一簇 ❌ 不是"不变量没人守"——是 HEAD 上有一条**已提交的红灯测试**污染了基线

来路：本线程一直没跑过 `mutate-verify` 整表（804 条、就地改源，共享工作树跑不得）。
这轮在 HEAD 的隔离 worktree 里真跑（`git worktree add --detach` + `cp -al node_modules` 真依赖，规则 103），
跑到第 190 多条时连续出现 ❌，而且**全集中在 `tests/docs-check.test.ts` 那族锚点上**。

## 一、❌ 的原文不是"存活"，是"基线就不是全绿"

```
❌ docs-budget-comparison-flipped — 字节预算比较符翻成 >= …
   基线就不是全绿（不应发生）:
     × 迁移后无存量豁免：内联复跑块直接判红
   Test Files  1 failed (1)
   Tests  1 failed | 41 passed (42)
```

这条**跟变异无关**：runner 施加变异之前先要基线全绿，基线红它就无法判定，于是点名"不应发生"。
所以那一簇 ❌ 是**一个因**长出来的多条果——把它们逐条读成"四条不变量失去守护"就完全读反了。

## 二、基线为什么红：一句关于未来的断言先于它的事实进了库

同 HEAD worktree 单跑那道判卷复现（125ms，非计时断言，不受并发影响）：

```
FAIL tests/docs-check.test.ts > D-8 复跑面登记表与引用对账 > 迁移后无存量豁免：内联复跑块直接判红
AssertionError: expected [ 'D-1|AGENTS.md', …(9) ] to have a length of +0 but got 10
```

- 断言 `expect(Object.keys(LEGACY_WAIVERS)).toHaveLength(0)` 由 **`02c4563` 测试：对齐 core-only 豁免与运行时工具面契约** 提交进来；
- 而 HEAD 那份 `scripts/docs-check.ts` 里 `LEGACY_WAIVERS` 仍有 **10 条**（就是断言收到列表里那 10 个 key）
  ⇒ **HEAD 的 `test` 这道门是红的**，红在"文档层迁移已完成"这句话上——事实还没跟上。
- 修法已在别人手里：主树的未提交 diff 里 `scripts/docs-check.ts` 正是
  `+export const LEGACY_WAIVERS: Readonly<Record<string, Waiver>> = {};`
  ⇒ 那两个文件都是别人的在飞改动（`M`），我不动、也不重复修；这里只把"HEAD 红"这件事定名并留下复跑口径。

## 三、这条读数的两面用处

1. **读整表时**：同一个 judge 文件基线一红，它名下所有锚点都变 ❌（本例 4 条起）
   ⇒ 看到"同族多条 ❌"先查基线，别一条条去补判卷（规则 45/58 的又一形状：一条缺陷会伪装成 N 条缺口）。
2. **认证门时**：我这几轮每次跑全量都是**主树**（那两条未提交改动在场），所以每句"全量 exit 0"都是真的——
   但只对外说"全量绿"就会把这条 HEAD 红整段藏掉。要 HEAD 认证必须同 HEAD 开 worktree 跑（本轮就是这么撞见的）。
   ⇒ 记一条硬口径：**凡报"全量绿"，同时说明跑的是哪棵树**；本线程接下来每次全量都补一次同 HEAD 单跑该文件。

## 四、待办与边界

- 复跑判据（等那笔入库后）：`git worktree add --detach .worktrees/head-check HEAD && cp -al node_modules .worktrees/head-check/node_modules && cd .worktrees/head-check && node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/docs-check.test.ts` ⇒ 应 42/42 绿。
- 整表这一轮的结果**不作结论**：基线红期间，`docs-check` 那族锚点的判定被污染（其余条目不受影响，可先读 ✅/存活分布）。
  等那条红清掉再跑一次完整表，才有"存活清单"可引用（任务 #14 记这两步）。
- 不改 `scripts/docs-check.ts`、不改 `tests/docs-check.test.ts`、不改 `scripts/mutate-verify.mjs`：三者都在别人手里。

## 验证口径（本轮实跑）

| 面 | 命令 | 读数 |
| --- | --- | --- |
| 隔离树建立 | `git worktree add --detach .worktrees/mut-full-0926 HEAD` + `cp -al node_modules` | 顶层 10 个依赖目录全在（本仓非 pnpm 布局），vitest 可直连 |
| 整表 | `node scripts/mutate-verify.mjs`（在隔离树内） | 进行中：已判 ~193/804；❌ 全部落在 `docs-check` 一族，原因＝基线红 |
| HEAD 单跑复现 | 隔离树内 `vitest run … tests/docs-check.test.ts` | `1 failed \| 41 passed (42)`，失败在 LEGACY_WAIVERS 应为 0 而实得 10 |
| 归因 | `git log -S "迁移后无存量豁免"` / `git diff` | 断言出自 `02c4563`；清空表体的改动在别人未提交 diff 里 |
