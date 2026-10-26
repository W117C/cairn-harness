# Cairn / DSH —— 现态

rev: fc056d03915c9ad3a1568973fb7e87b92ef6517e

本页描述 `cairn/` 当前工作树，不代表同级 staging、远端或已发布应用。
任务、阻塞与待开工统一见 [仓库整理与任务清单](docs/REPOSITORY-STATUS.md)；
逐批读数见 `PROGRESS.md` 第 715 页，历史证据保留在 `PROGRESS.md` 与 `outputs/`。
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
- 同一活跃会话的插话、取消后继续发送与跨窗口 smoke 已接通；空屏首发的 running key 由单测钉住。
- FilePane 与设置页已有真实 renderer / 生产 preload 的键盘、失败恢复与窄窗补测。
- `head-cert-check` 已在 `fc056d03` 上最终跑满 25/25；首趟并发红样本与复跑绿样本都保留。
- `mutate-verify` 全表已在同一提交上 1621/1621 全杀死；完整 `pnpm gates` 仍未作为一条命令全跑。
- 远程 worker、P5 真实评测、P6 SDK 与对外分发按任务清单的条件待开工。

## 待验与待决

- 编排控制面的真实用户交互；当前只有组件/服务面判卷。
- 自进化新接线的真实收益（配对读数），不能用判卷绿替代。
- 长会话/大 diff 的跨机器长尾与 Radix 是否值得懒加载；当前本机读数不足以支持重构。
- FilePane 已在 500 项目录下通过真机 smoke，设置页已在真实 main/preload 下通过；仍需真实用户可发现性样本。
- 取料归档治理。

## 验证入口

命令与边界见 `AGENTS.md`；本轮读数见 `docs/REPOSITORY-STATUS.md` 第七节。
core 与 desktop 分开验证；`mutate-verify` / `head-cert-check` 只证明被测量的那个提交。
