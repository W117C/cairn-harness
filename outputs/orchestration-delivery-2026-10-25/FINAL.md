# 多智能体编排交付证据（2026-10-25）

基线 HEAD：`f4bffa3a3a399459c84d4c2dcf50ec2e62155560`
提交：`9b666204`（`ace0a0e3` 实现 + `cf0f8e09` 设计稿 + `a0ee6b73` 常量 + `4a1e9950` 读数 + `ec199d56` 暂停/租约加固 + `c47a014a` 会话地址授权 + `9b666204` 清掉 kernel-host 混入的他批 hunk）；工作树仍保留其他会话改动。

## 结论

P0–P4 的本地可执行纵切已落地：领域/Flow 校验、事件投影与调度、JSONL 持久化、本地受限后端、独立 verifier、内容寻址工件、桌面控制面与 IPC v24。P5/P6 未冒充完成。

## 复跑读数

| 面 | 命令 | 读数 |
|---|---|---|
| 编排内核 | `npx vitest run --config tests/vitest.config.ts tests/orchestration-*.test.ts --maxWorkers=2` | 提交树 9 files / 144 tests passed；共享主树 10 files / 154（含 provider 深测） |
| 桌面控制面 | `cd apps/desktop && npx vitest run tests/orchestration-host.test.ts tests/orchestration-pane.test.tsx tests/notification-open-wiring.test.ts tests/plan-mode-wiring.test.ts tests/protocol-version.test.ts` | 5 files / 15 tests passed |
| 根类型 | `node --import tsx scripts/typecheck.ts` | 0 errors |
| 桌面类型/构建 | `cd apps/desktop && npx tsc -p tsconfig.json --noEmit && pnpm build` | tsc 0；build green |
| 边界 | `node --import tsx scripts/desktop-boundary-check.ts` | green |
| 渲染分层 | `node --import tsx scripts/renderer-layer-check.ts` | green |
| 架构环 | `node --import tsx scripts/arch-cycle-check.ts` | registered debt 1 / new cycles 0 |
| 全量 core | `pnpm test:capped` | 6927 passed / 32 failed / 6959 |

全量 core 的 13 个失败文件均不引用 orchestration：`docs-check`（D-5 21 条业主保留红 + STATE D-1）、`motion-policy`、`mutate-anchor-titles`、`mutate-needles-check`、`mutate-verify-gates`、`permission-mode-single-source`、`permissions-tool-registry`、`projection-invariant`、`promise-recall-inventory`、`prompt-surface-check`、`session-tools`、`src-execution-path`、`web-search`。均为共享工作树其他在飞改动或 HEAD 既有债。

## 全量 core

`pnpm test:capped` → **6937 passed / 33 failed / 6970**；13 个失败文件均不引用 orchestration。

## 未测边界

- 真实模型凭据未实测：provider 测试用 stub fetch，验证的是 wire 限额/成本闸/断言，不是真实厂商延迟与账单。
- 桌面只有组件/主机测试与 build；未做真实 Electron 指针冒烟（P4 的真机命中测试不在本笔）。
- 本地后端 `max_concurrency: 1`（串行）；引擎对具备并发能力的后端可到 plan 上限（120 任务用例用 3 并发假后端）。
- P3 的 `race`、`gather any/quorum`、动态控制与远程 worker 未实现；静态展开不支持的节点显式 fail-closed。
- 未提交；未写 PROGRESS 页（共享树有 276 项其他会话改动，先避免混笔）。

## 关键修（本轮收尾）

- `src/orchestration/local-backend.ts`：真实 provider 只发 `assistant_delta`，摘要改为最后一轮 delta 聚合；rollback 恢复文件 mode。
- `src/orchestration/engine.ts`：write 任务 spawn 事件 `permission_mode` 按 lane 区分。
- `src/main/orchestration-backend.ts`：请求体 `BodyInit` 收窄。
- IPC v24 同步：桌面版本钉、README invoke 通道数 108。
