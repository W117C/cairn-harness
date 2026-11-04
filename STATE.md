# Cairn / DSH —— 现态

rev: f57fe7decef08831f15038ea4ca8c6d307b84997

核对日期：2026-11-04（Asia/Shanghai）。`rev` 是已推送的开发基线，不表示已合入 `main` 或完成发布认证。
仓库与分支的现役入口是[仓库状态与分支](docs/REPOSITORY-STATUS.md)；测量和历史证据放在 `outputs/`、`PROGRESS.md` 与 `archive/`，本页只写状态与下一步。

## 当前工作

- 开发分支 `fix/spec-summary-double-count` 已与远端同步，共享工作树已清空。
- 此前多个会话留在共享树上的在飞改动已按一次落库提交入库；落库依据是当时工作树上的两套判卷与根类型检查全绿，不是逐笔审阅每个改动。
- 本会话新增：任务自带判据（`--verify` → `session_meta_update` → `verify_result.source`）、`env-fs` 归因、失败路径读数、`verify-census` 命令、三支拒单文案统一。
- 开发线与 `origin/main` 已分叉，且双方各有对方没有的提交。直接把开发线合进主线会在锁文件、CI 配置与核心源文件上撞冲突，必须先做集成。

## 代码入口

- core 在 `src/`，应用服务在 electron-free 的 `src/main/`；desktop 在 `apps/desktop/`，依赖方向与 IPC 规则见 `AGENTS.md`。
- 符号和稳定契约见 [CODE-WIKI](docs/CODE-WIKI.md)；功能使用见 `README.md`。

## 下一步

- 在隔离工作区做 dev → main 集成：先解 `pnpm-lock.yaml`、`package.json` 与 `.github/workflows`，再按 `src/main`、`src/agent`、`apps/desktop` 三组逐个核对，保留双方功能。
- 集成分支的判据：两套套件 + 根 typecheck + `docs-check`；任一项红不进 `main`。

## 验证与交付边界

- 本轮落库证明的是当时工作树与合并后 HEAD 的套件读数；`pnpm gates`、`head-cert-check`、`mutate-verify` 未跑，历史认证不转移到新提交。
- 远端 CI 以本次推送产生的运行结果为准，不用历史运行推断当前提交。
