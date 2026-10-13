# 第 482 页取料：桌面层第一次进变异表（此前 1556 条尽数落在 src/ 与 scripts/）

出证 2026-10-14；工作树 `/Users/ze/Downloads/Cairn/deepseek harness`，分支 `zcode`。

## 1. 缺口的量

`--check-needles` 现读 **1557 条**，按 `src` 分布：src/agent 391、scripts 277、scripts/lib 258、
src/main 125、src/tools 111、src/agent/plugins 81、src/permissions 54、src/providers 42 …
**指向 `apps/desktop/` 的：0 条**。

而桌面层此刻有 17 个判卷文件、173 条用例、独立 vitest 配置，且第 479/481 两页新逻辑
（发送队列、审批卡归属）全在这一层 ⇒ 它们是「有判据、无分辨力证据」的状态：判卷绿只说明
**它能通过**，不说明**它对坏改动能红**。

## 2. 为什么此前进不来（两处机械原因，都不是设计排斥）

1. `runTest` 把判卷配置写死成 `tests/vitest.config.ts`。桌面是独立配置
   （`apps/desktop/vitest.config.ts`，`include: tests/**`），拿核心那份去跑桌面判卷 ⇒ 一条都选不中。
2. 只改配置还不够：vitest 的 include/filter 相对**配置所在目录**解析，在仓库根跑
   `--config apps/desktop/vitest.config.ts apps/desktop/tests/…` ⇒ `No test files found`（退出码 1）。
   cwd 与相对路径都要跟着配置走。

修法：`runTest(testRel, pattern, configRel)` 增加可选第三参；锚点可自带 `config`，
cwd 取 `dirname(config)`、判卷路径按该目录做相对化。缺省路径完全不变 ⇒ 既有 1556 条零行为变化。

## 3. 首条桌面锚点

- `ask-card-owner-not-scoped`（src `apps/desktop/src/renderer/send-queue.ts`、
  test `apps/desktop/tests/send-queue.test.ts`、config `apps/desktop/vitest.config.ts`）。
- 变异：`askBelongsToSession` 的归属判定改成恒 `true`（= 退回「来者不拒」）。
- 结果：**被杀死**。`坏拍（选中≠1） 0`，判卷 spawn 2 拍。

## 4. 我自己踩的两个错（都当场验出来并订正）

1. **指针写错形状**：第一版 `expectFail` 写成了 `describe › it` 的形式（全表 1556 条里
   **只有我这一条**用 `›`）⇒ 选择子零命中、判红 `vacuous`。订正为纯 `it` 标题。
2. **动了别人的针脚**：改 `runTest` 签名时把既有锚点 `cost-run-test-uninstrumented`
   的针脚（`const started = Date.now();\n const args = [VITEST,`）一起改没了 ⇒ 该条判「针脚已不在源文件里」。
   已把它的 apply 改指新的注释行，本意（`runTest` 不再记时间 ⇒ #37 分母退回推算）不变。
   ⚠️ 这一格说明：**改动共享 runner 会牵动别人的锚点**，改完必须跑 `--check-needles` 而不是只看自己的那条。

## 5. 回归（核心锚点没被我的 runner 改动弄钝）

同一次在干净 worktree 里跑 `ask-gate-unattended-fail-closed` + `ask-gate-session-id-not-forwarded`
⇒ **全部被正确杀死**（2/2）。`--check-needles` 1557 条、阻断 0、钉在飞文本 0。

## 6. 未跑

- `mutate-verify` **全表未跑**（1557 条 ≈ 20+ 分钟）。
- 桌面层目前**只有 1 条锚点**；其余 16 个桌面判卷文件仍无分辨力证据（本页只是把门打开）。
