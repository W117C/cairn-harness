# 会话日志查看器 · 真机读数（2026-10-21 批 132）

隔离实例：`CAIRN_DESKTOP_WORKSPACE=/tmp/cairn-b132-ws`，CDP 9351，userData `/tmp/cairn-b132-udd`；
dist 真产物。种子：一个 315.9 KB / 421 行的长会话（末行是 error 事件）+ 一个短会话 + pins sidecar。

## 接线

- `window.agent.protocolVersion()` → **15**
- `typeof window.agent.sessionLog` → **function**
- `sessionLog("pins")` → `{ ok:false, error:"会话不存在: pins" }`（sidecar 不当会话）
- `sessionLog("nope")` → `{ ok:false, error:"会话不存在: nope" }`
- 命令面板搜索「日志」→ 操作组「查看当前会话日志」→ 点击打开对话框。

## 内容与截断

- 对话框标题「会话日志 · 日志排障」；路径为真实落点
  `/private/tmp/cairn-b132-ws/.agent/sessions/会话 2026-10-21 11:00:00 #1.jsonl`。
- 尾部：**341 行**（256 KiB 字节窗口），首行是「第 80 条诊断输出」，末行是
  `{"type": "error", "message": "模拟失败：写入被拒", ...}`。
- 提示：「只显示日志尾部；更早的内容请复制路径后在编辑器里打开。」+「341 行 · 文件大小 315.9 KB」。
- 复制路径 → toast「日志路径已复制」。

## 几何与主题

- 对话框 **760 × 594.25** @ (220, 102.875)，窗口 1200×800（水平/垂直居中）。
- 日志视口 708 × 414；内容 6180 × 7150（横向不折行，双向可滚）。
- 亮色：卡面 `rgb(255,255,255)`、日志底 `rgb(252,252,251)`。
- 暗色：卡面 `rgb(30,30,29)`、日志底 `rgb(20,20,19)`、文字 `rgb(176,174,165)`。
- Esc 关闭对话框；控制台 0 异常。
- 错误条「查看日志」按钮由 SSR 判卷覆盖（需要真实 run 失败态才能亮，本轮未制造失败轮）。

## 截图

- `log-light.png`（顶部）
- `log-dark.png`（暗色 + 复制路径 toast）
- `log-tail-error.png`（滚到底部，末行 error 在场）
