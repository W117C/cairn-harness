# M7 在飞改动的收口约束地图（2026-09-18 全面检查轮）

**用途**：把 76 个未提交文件之间的隐性提交约束写成显性事实，供 M7 收口时直接照做。
**方法**：依赖图静态分析（工作树 import 关系）+ worktree 隔离实验（上一轮）+ 进度文档核对。
**结论一句话**：这批改动是**一个原子单元**，无法拆开提交；且作者已明确「仍在阶段 A、未创建提交」
（见 `outputs/solpi-fix-progress-2026-09-17.md`），故本轮不落地，只记录约束。

## 1. 未跟踪源模块（8 个）

| 模块 | 有测试 | 说明 |
|---|---|---|
| src/agent/solpi-runtime.ts | ✅ solpi-runtime | 簇中枢 |
| src/agent/economics.ts | ✅ economics | 经济/预算 |
| src/agent/evidence.ts | ✅ evidence | 证据 |
| src/agent/ledger.ts | ✅ ledger | 观察账本 |
| src/agent/metering.ts | ✅ metering | 计量 |
| src/tools/observation-capture.ts | ✅ **本轮补** observation-capture | 47 行安全闸 |
| src/agent/action-fusion.ts | ✅ action-fusion | 动作融合 |
| src/renderer/history-window.js | ✅ history-window + renderer-history-live | 历史窗口 |

本轮新增 `tests/observation-capture.test.ts`（8 条）补上簇内唯一覆盖缺口，
守三个安全不变量：只捕获已授权脱敏输出（EAUTH）、obs_recall 参数白名单（EINVAL）、
错误码消毒防注入（`/^[A-Z0-9_]+$/` 白名单，其余回落 EIO）。

⚠️ **该测试不能单独提交**：它 import 未跟踪模块，单独入 HEAD 会造成悬空 import
（正是本次修复了两轮的那类 HEAD 断裂）。随簇一起落地。

## 2. 原子性约束：被修改的已跟踪文件 → 未跟踪模块

```
src/agent/compaction.ts    → economics
src/agent/glm-session.ts   → economics, metering, solpi-runtime
src/main/agent-runner.ts   → action-fusion, solpi-runtime
src/providers/glm.ts       → metering
src/providers/openai.ts    → metering
src/agent/solpi-runtime.ts → economics, evidence, ledger, metering, observation-capture
```

**推论**：上面 6 个已跟踪文件的工作树版本**不能单独提交**——必须与它们依赖的未跟踪模块
同一次提交落库，否则 HEAD 立刻悬空。换言之，收口提交的最小范围是：

> 8 个未跟踪源模块 + 16 个未跟踪测试 + 上述 6 个已跟踪文件的改动
> + 其余在飞改动（renderer/history-window 相关、docs、fixtures/impact 等）

## 3. 已验证的「可以单独提交」部分（本轮已落库）

以下与 M7 簇**无耦合**，已独立提交且 HEAD 自洽：

- React 树归档收尾（删 .tsx + 移除 react 依赖 + vite 去 react() + onboarding-groups 抽取）
- commercial-check 改指 live 模块
- panels-check 超时不再杀进程
- orchestrator 无效动态导入消除 + bandit 运行时接线
- 覆盖重建：tests/sidechat.test.ts（15 条）、tests/projections.test.ts（4 条）

## 4. HEAD 已知失败（3 个，精确归因）

| 测试 | 修复来源 | 状态 |
|---|---|---|
| gated-tools / runner-gates | 未提交的 agent-runner.ts（+314 行） | 测试先于实现提交 |
| agents（worker 工具表缺 lsp） | 未提交的 base.ts 接线（lsp.ts 已提交） | 同上 |

worktree 隔离实验：换入工作树 agent-runner.ts ⇒ 2 个立刻转绿。本质是 M7 实现未落地，
**M7 收口时自然转绿**，不要为此单独掐实现。

## 5. 收口检查清单（给收口人）

1. [ ] 簇内 8 个模块全部有测试（本轮后 ✅）
2. [ ] 6 个耦合已跟踪文件与未跟踪模块**同一次提交**
3. [ ] 提交后 worktree 实测：`git worktree add <tmp> HEAD && tsc --noEmit && build && 全量 test`
4. [ ] 3 个 HEAD 失败测试转绿
5. [ ] frozen-sha256 零漂移复核
6. [ ] 阶段 A 剩余项（进度文档「下一顺序」）与阶段 B/C/D 的取舍确认
