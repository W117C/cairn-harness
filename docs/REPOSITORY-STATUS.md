# 仓库状态与分支

核对日期：2026-11-04（Asia/Shanghai）。对象是 `/Users/ze/Downloads/Cairn/cairn`；同级 staging、备份与研究目录未纳入内容修改或删除。
这是现役入口。旧整理记录见[历史快照](../archive/repository-status-before-2026-11-02.md)。

## 当前结论

- 开发基线为 `fix/spec-summary-double-count@5f9e4433`，同名远端分支已同步。
- 共享工作树已清空：此前多会话留下的在飞改动经一次落库提交入库，依据是当时工作树上的两套套件与根类型检查全绿，不是逐笔审阅每个改动。
- 开发线与 `origin/main` 双向分叉。只读 merge-tree 预演给出约 30 个冲突文件，含 `pnpm-lock.yaml`、`package.json`、`.github/workflows/verify.yml` 与核心源文件；因此**不在主树上直接合并**。
- 本轮新增：任务自带判据（`--verify`）、`env-fs` 归因、失败路径读数、`verify-census` 命令、拒单文案统一。

## 本地分支处置

| 分支 | 当前关系 | 决定 |
| --- | --- | --- |
| `main` | 与 `origin/main` 一致 | 保留；主线基准 |
| `fix/spec-summary-double-count` | 活跃开发线，已推送；与 main 分叉 | 保留；等隔离集成 |
| `fix/code-scanning-alerts` | 提交已在 main，worktree 仍有未跟踪证据 | 保留现场 |
| `fix/code-scanning-closure` | 提交已在 main，worktree 仍有未提交源码与判卷 | 保留现场 |
| `rescue/wip-20261025` | 相对主线与开发线均有独有提交 | 保留；救援快照 |

已删除并确认并入开发线：`agent/修复-todo-的-completedcount-worker-12`、`agent/修复-todo-的-completedcount-2-worker-12`、`feat/task-carried-verify`（三笔提交 + merge 已在开发线上）。

## 远端分支

| 远端对象 | 状态与处置 |
| --- | --- |
| `main`、`fix/spec-summary-double-count` | 主线与开发线，保留 |
| `rescue/wip-20261025` | 救援快照，保留 |
| `doc-layer-migration` | 提交图中仍有独有历史，保留待内容等价性审计 |
| `integration/dev-line-with-standardization` | tip 是开发线祖先，已删除 |
| 六个 Dependabot 分支 | 对应开放 PR #9、#11、#20、#21、#22、#23；#6、#7（TypeScript 跨大版本）已关闭并删除分支 |

## 工作树与在途改动

- 主树：0 项。
- `.worktrees/code-scanning-alerts-855b5ebe`：只有未跟踪的 head-cert 证据目录。
- `.worktrees/code-scanning-closure-82199500`：`apps/desktop/tests/kernel-host.test.ts`、`src/events/log.ts` 未提交。
- `.worktrees/gate-mutate-verify`：0 项，detached HEAD。

## 下一步

- 在隔离工作区做 dev → main 集成，顺序：`pnpm-lock.yaml` / `package.json` / CI 配置 → `src/main` → `src/agent` → `apps/desktop`。
- 集成分支判据：两套套件 + 根 typecheck + `docs-check`；任一项红不进 `main`。
