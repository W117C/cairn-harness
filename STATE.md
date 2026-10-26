# Cairn / DSH —— 现态

rev: f79077e2056dabb481a1ec9a7fd797bdb7d0bc08

本页描述 `cairn/` 当前工作树，不代表同级 staging、远端或已发布应用。
任务、阻塞与待开工统一见 [仓库整理与任务清单](docs/REPOSITORY-STATUS.md)；
逐批读数见 `PROGRESS.md` 第 713 页，历史证据保留在 `PROGRESS.md` 与 `outputs/`。
本页整体重写，台账只追加。

## 当前实现

- **core**：`src/agent/`、`src/tools/`、`src/providers/`、`src/permissions/`、`src/events/`；
  `src/main/` 是 electron-free 的应用服务。核心不得反向依赖 `apps/desktop/`。
- **desktop**：`apps/desktop/` 的 main / preload / renderer；渲染层分 `state/`、`derived/`、
  `components/`、`panes/` 与组合根 `App.tsx`。IPC 契约在 `src/main/ipc-protocol.ts`。
- **会话**：CLI 已调用 `createProductFork`；桌面 Stream 已有来源引用（`EventRef`），
  协议与行为以 ADR 0005 与对应测试为准。
- **编排**：`src/orchestration/` 与桌面控制面已有本地可执行纵切；P0–P4 已实现并判卷，
  P3 的 `race` / `gather any/quorum` / 远程 worker 未实现，静态展开显式 fail-closed。
- **记忆 / 自进化 / provider**：记忆强度与巩固、自进化账本/反思/补丁门/毕业/Assess、
  DeepSeek 专用适配均已入库；运行产物不入库（`.agent/evolution-*` 等已忽略）。

## 正在收口

- 真实 DeepSeek 连接需要 `DEEPSEEK_API_KEY`；wire 判卷只证明请求形状。
- 插话的端到端 smoke 受 gallery 桩限制（`running` 立不住），组件级判卷已绿。
- `mutate-verify` / `head-cert-check` / `pnpm gates` 需在目标提交上另行认证。
- 远程 worker、P5 真实评测、P6 SDK 与对外分发按任务清单的条件待开工。

## 待验与待决

- 同一活跃会话的取消/恢复、跨窗口与编排控制面真机交互。
- 自进化新接线的真实收益（配对读数），不能用判卷绿替代。
- Radix 首开延迟、长会话/长列表/大 diff 的渲染长尾、FilePane/设置的真机可发现性。
- 取料归档治理。

## 验证入口

命令与边界见 `AGENTS.md`；本轮读数见 `docs/REPOSITORY-STATUS.md` 第七节。
core 与 desktop 分开验证；`mutate-verify` / `head-cert-check` 只证明被测量的那个提交。
