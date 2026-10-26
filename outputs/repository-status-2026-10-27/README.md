# 2026-10-27 仓库现态补测

这批文件是 `docs/REPOSITORY-STATUS.md` 的复核取料，记录真实 Electron、IPC 和生产 preload
下得到的读数；不替代已提交的 HEAD 认证。

## 运行命令

```sh
pnpm --filter cairn-desktop build
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/session-continuity-smoke.cjs /tmp/continuity
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/steer-smoke.cjs /tmp/steer
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/cancel-resume-smoke.cjs /tmp/cancel
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/file-pane-renderer-smoke.cjs /tmp/file-pane
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/settings-process-smoke.cjs /tmp/settings
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/performance-smoke.cjs /tmp/performance.json 400 40
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/radix-open-latency.cjs /tmp/radix.json 20
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/diff-render-latency.cjs /tmp/diff.json
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/cross-workspace-restore.cjs /tmp/cross-ws
ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/workspace-owner-smoke.cjs /tmp/workspace-owner.json
```

## 读数边界

- `performance-smoke` 使用合成 AgentApi 和合成流式增量，量的是 renderer 生命周期与 DOM，
  不是模型吞吐或计费。
- `radix-open-latency` 用 `sendInputEvent` 发真实鼠标输入；首开与后续复开分开记录。
- `diff-render-latency` 的 4000 行对应 core 的 `MAX_PATCH_LINES` 帽，量的是 renderer 挂载
  时间，不含主进程生成 diff 的耗时。
- 设置、文件窗格、工作区和跨窗口 smoke 使用临时 profile / workspace，不触碰产品用户数据。
- `settings-process-smoke` 的本地搜索请求打 loopback；没有真实模型请求，也不证明真实计费。

## 最终认证

全表变异与最终 HEAD 认证分开取料：

```sh
pnpm mutate-verify
pnpm head-cert-check
```

- `mutate-verify` 在 `fc056d0` 上跑满 1621/1621，exit 0；原文摘要见
  [`mutate-verify.md`](mutate-verify.md)。
- `head-cert-check` 在同一提交上先留下 24/25 的并发红样本，再在两端独占时得到 25/25：
  `../head-cert-fc056d0-2026-10-26-1651/provenance.md` 与
  `../head-cert-fc056d0-2026-10-26-1656/provenance.md`。
- 首趟红样本的 3 条失败名随认证树回收而不可补回；文档只把它当不可归因的并发污染样本，
  不据此推断产品回归，也不删除该样本。
- 这些认证只覆盖 `fc056d0` 的提交树，不证明真实 DeepSeek、真实用户、打包发布或跨机器长尾。
