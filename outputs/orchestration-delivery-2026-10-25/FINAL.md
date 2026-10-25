# 多智能体编排交付证据（2026-10-25，独立提交树）

基线 HEAD：`f4bffa3a3a399459c84d4c2dcf50ec2e62155560`
提交树：`feat/orchestration-platform`（从基线单笔落地，工作树干净）。

## 结论

P0–P4 的本地可执行纵切已落地：领域/Flow 校验、事件投影与调度、JSONL 持久化、本地受限后端、独立 verifier、内容寻址工件、桌面控制面与 IPC v20。P5/P6 未冒充完成。

## 复跑读数（本树）

| 面 | 命令 | 读数 |
|---|---|---|
| 编排内核 | `npx vitest run --config tests/vitest.config.ts tests/orchestration-*.test.ts --maxWorkers=2` | 9 files / 143 tests passed |
| 事件兼容 | `tests/events.test.ts tests/event-type-coverage.test.ts tests/stream-redaction.test.ts tests/projection-invariant.test.ts` | 7 files / 71 tests passed |
| 桌面控制面 | `cd apps/desktop && npx vitest run tests/orchestration-host.test.ts tests/orchestration-pane.test.tsx tests/protocol-version.test.ts` | 3 files / 8 tests passed |
| 根类型 | `node --import tsx scripts/typecheck.ts` | 0 errors |
| 桌面类型/构建 | `cd apps/desktop && npx tsc -p tsconfig.json --noEmit && npx esbuild … && npx vite build` | tsc 0；build green |
| 边界 | `node --import tsx scripts/desktop-boundary-check.ts` | green |
| 渲染分层 | `node --import tsx scripts/renderer-layer-check.ts` | green |
| 架构环 | `node --import tsx scripts/arch-cycle-check.ts` | registered debt 1 / new cycles 0 |
| 通道计数 | `tests/readme-invoke-channel-count.test.ts` + `tests/ipc-protocol-version.test.ts` | 104 = 101 + 3；v20 |

## 未测边界

- provider wire gateway 的深测（真实 DeepSeek/Anthropic SSE 形状、tariff 精确值）留在工作树的 `tests/orchestration-provider.test.ts`，依赖尚未提交的 DeepSeek provider 批；本树只保留 `tests/orchestration-backend-wiring.test.ts` 的 fail-closed 覆盖。
- 本地后端 `max_concurrency: 1`（串行）；引擎对具备并发能力的后端可到计划上限（120 任务用例用 3 并发假后端）。
- P3 的 `race`、`gather any/quorum`、动态控制与远程 worker 未实现；静态展开不支持的节点显式 fail-closed。
- 桌面只有组件/主机测试与 build；未做真实 Electron 指针冒烟。
