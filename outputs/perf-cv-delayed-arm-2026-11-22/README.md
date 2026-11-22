# 长会话 c-v 延迟武装 · 两跑原样读数（2026-11-22）

- **被测**：`d6637c9e` 的 `WorkbenchView.tsx` + `styles.css`（`.stream[data-cv="on"] .row` 一条规则）。
- **命令**（从仓根）：`cd apps/desktop && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/performance-smoke.cjs <out.json> 400 40`
  - 本会话 shell 带 `ELECTRON_RUN_AS_NODE=1`，不清掉时 Electron 以 Node 身份启动，`app.setPath` 直接抛；
  - `run1.json` / `run2.json` 即该命令两次原样输出，未手改。
- **预算**（脚本内默认）：打开 1500ms / 帧 p95 200ms / max 500ms / 启动 1500ms。
- **读表**（两跑）：打开 862.4 / 926.4ms；p95 140.6 / 134.9ms；max 141.2 / 145.8ms；启动 356.3 / 210.2ms；DOM 58452；控制台错误 0。
- **基线**：p95 218.6ms 取自 `PROGRESS.md` 第 1336 页（同一支 `performance-smoke`；本批未重跑基线，撤 c-v 重跑属另一次改动）。
