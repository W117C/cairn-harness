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

## 二·补 这簇 ❌ 不止一个来源，其中一个是我自己造的（本页提交后当天查出并改掉）

页面第一版写"❌ 全集中在 `docs-check` 一族"——**那句是错的**，是我从"前 4 条同族"直接推的。
读完整段日志后：基线红有两个来源、两个 judge 文件，且都是"断言先于实现进了库"：

| HEAD 红灯 | 出处 | 谁的 |
| --- | --- | --- |
| `tests/docs-check.test.ts > 迁移后无存量豁免`（`LEGACY_WAIVERS` 应为 0，实得 10） | `02c4563` | 他人；清空表体的改动在他未提交 diff 里 |
| `tests/tools.test.ts > 结构化标记新建与覆盖`（`created.change` 应为 `"created"`，实得 `undefined`） | **`723f217`（第 69 页，我的提交）** | 我 |

第二条的成因：HEAD 的 `src/tools/write_file.ts` 返回 `{ ok, output, snapshotId? }`，**没有 `change` 字段**；
带 `change` 的那版在另一会话的在飞改动里（`src/tools/write_file.ts` 此刻 ` M`）。
我在那棵树里跑测试 ⇒ 绿；把断言单独提交 ⇒ **HEAD 上它必红**（`tsc` 也一样：`.change` 在 HEAD 的类型上不存在）。
⇒ 已在本次提交里改掉：那条用例改成断言"新建 → 覆盖 → 编辑之后**文件内容**逐字正确"（HEAD 就支持），
`change` 的断言留给那个字段的主人随实现一起入库。判卷价值没丢（覆盖/编辑仍被验），只是不再替别人实现记账。

**这条教训的通用形状**：写断言前必须问"它读的字段/行为在 **HEAD** 里存在吗"——
主树里别人的在飞改动会把红垫成绿，而我每次"全量 exit 0"报的都是主树。
落进复跑口径：**每次提交后，在同 HEAD 的隔离 worktree 里跑一次 `test` + `typecheck`**（本轮已补做，见 §验证口径）。

## 三、所以这条读数的两面用处

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

## 五、修法：把我那三条判据改成「判成因」（同轮落地）

§二·补 认下三条是我造的 HEAD 红之后，光改措辞不算收口——它们**读的是工作树状态**，
所以同一行代码在 HEAD 与本树里必然一边绿一边红。改法统一成一个形状：
**不写死此刻的清单，改成对每个成员问一句可机检的成因。**

| 判据 | 旧写法（状态耦合） | 新写法（成因） | HEAD 与本树是否同形 |
| --- | --- | --- | --- |
| `tests/tools.test.ts` | 断 `write_file` 结果里的 `change` 字段 | 断「新建 → 覆盖 → 编辑后文件内容逐字正确」 | 同形（HEAD 就支持） |
| `tests/src-execution-path.test.ts` | `缺口 == 手抄例外表` | 每个缺口必须命中：①纯类型面（运行时零导出，另有用例真 import 证明）或 ②Electron 入口（真去读源码确认它 `from "electron"`）；另加反向一条：例外名单里不许躺着「此刻已有执行路径」的文件 | 同形：HEAD 3 个缺口（`main/index.ts`＋`preload/index.ts` 走 ②、`ipc-protocol.ts` 走 ①）／本树 1 个走 ① |
| `tests/mutate-anchor-titles.test.ts` | `缺尺锚点 id 集合 == 手抄 6 条` | 登记表按**判卷文件**登记；每个 `unverified-file` 必须命中「HEAD 里有、盘上没有」＝别人的删除还没入库；HEAD 里也没有 ⇒ 红（表写错路径或锚点没摘）。另加：登记的文件一旦从 HEAD 消失就必须删名（僵尸登记） | 同形：HEAD 0 条 finding／本树 6 条全部由 `tests/updater.test.ts` 解释 |

配套：`checkAnchorTitles` 的 `Finding` 加了 `source` 字段——原先「是哪个文件读不到」只写在中文 `detail` 里，
消费方要按措辞反解路径 ⇒ 改一句文案就把判据拆掉（规则：钉在结构上，不钉在措辞上）。

### 两条新用例都当场造过红（规则 65），且不只有「红过一次」这一面

| 造红动作 | 结果 |
| --- | --- |
| 本树放一个没人 import 的 `src/main/zz-needle-probe.ts` | 缺口用例红并点名它，同文件另 6 条照常绿 ⇒ 不牵连 |
| 同一棵树里 `rm tests/updater.test.ts`（造出「HEAD 有、盘上没有」） | 成因用例**绿** ⇒ 这就是「两棵树同形」的那一半证据 |
| 再把 HEAD 探针改成不存在的 ref（模拟「HEAD 里也没有」） | 成因用例红，逐条点出 `tests/updater.test.ts（6 条锚点：updater-manifest-https-only、…、manifest-field-list-forgot-notes-again）` |
| 只把探针改回真 `HEAD:`、在登记表里塞一条从未存在过的文件 | 成因用例回到绿，登记表卫生用例**单独**红且只点名那条 ghost ⇒ 两条用例各吃各的输入，没有互相顶包 |

### 剩下的那条 HEAD 红仍然不是我欠的（复测过，不是引用旧结论）

同 HEAD 的隔离树里带上本次新码复跑，`真表：漂移必须为 0` 仍红，且红的内容是
`drift:renderer-hides-worker-spend`、`drift:panel-dirty-misses-review-and-progress-events`
——两条锚点在**本树的 `scripts/mutate-verify.mjs` 里已经不存在**（随渲染层一起被那笔未提交的删除摘掉），
所以它们既不可能由我在本树修，也不该登记成豁免（登记了就在本树变 stale-waiver，红只是换到另一边）。
这正是 §二·补 那句「HEAD 里也有一条已提交的红灯」的其余部分：`docs-check` 那族 1 条 + 这一族 1 条，都随入库自动清。

## 验证口径（本轮实跑）

| 面 | 命令 | 读数 |
| --- | --- | --- |
| 隔离树建立 | `git worktree add --detach .worktrees/mut-full-0926 HEAD` + `cp -al node_modules` | 顶层 10 个依赖目录全在（本仓非 pnpm 布局），vitest 可直连 |
| 整表 | `node scripts/mutate-verify.mjs`（在隔离树内） | 进行中：已判 ~193/804；❌ 全部落在 `docs-check` 一族，原因＝基线红 |
| HEAD 单跑复现 | 隔离树内 `vitest run … tests/docs-check.test.ts` | `1 failed \| 41 passed (42)`，失败在 LEGACY_WAIVERS 应为 0 而实得 10 |
| 归因 | `git log -S "迁移后无存量豁免"` / `git diff` | 断言出自 `02c4563`；清空表体的改动在别人未提交 diff 里 |
| 改后·本树三文件 | `vitest run … tests/{mutate-anchor-titles,src-execution-path,tools}.test.ts` | `32 passed (32)`，exit 0 |
| 改后·同 HEAD 隔离树（把新码 4 份复制进去） | 同命令 | `31 passed \| 1 failed`，唯一红＝§上面那条 `真表：漂移必须为 0`（红的是两条渲染层锚点，非我名下的三条已全部转绿） |
| 尺的取料读数 | `node --import tsx outputs/untested-core-2026-09-26/01-reach.mts`（两棵树各跑一次） | 本树 150 生产面／缺口 1；HEAD 树 147／缺口 3 ⇒ 缺口数不同而判据同形，就是「判成因」的效果 |
| typecheck | `node --import tsx scripts/typecheck.ts` | 0 报错（`Finding.source` 变必填后全树消费面一起编译过） |
