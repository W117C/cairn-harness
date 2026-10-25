# 跨会话用量账本 · 真机读数（2026-10-21 批 131）

隔离实例：`CAIRN_DESKTOP_WORKSPACE=/tmp/cairn-b131-ws`，CDP 9350，userData `/tmp/cairn-b131-udd`；
dist 真产物，业主实例零扰动。种子工作区 = 8 个会话 + pins/feedback 两个 sidecar 文件。

## 协议与接线

- `window.agent.protocolVersion()` → **14**
- `typeof window.agent.usageLedger` → **function**（preload 已重建）
- 账本：`sessions=8` / `workspaces=1` / `skipped=0` / `badLines=0`
  （sidecar 未混入；计数与目录里的 8 个会话文件一致）

## 数字（全部会话口径）

| 维度 | 读数 |
|---|---|
| 输入 | 121.6k |
| 输出 | 1.4k |
| 缓存读取 | 79.9k |
| 工具步数 | 30 |
| 对话轮数 | 19 |
| 用量次数 | 19 |
| 会话 | 8 |
| 工作区 | 1 |

当前会话口径 6 行；切「全部会话」后 8 行在 300ms 内到位。

## 几何与主题

- 面板 184 × 329.75 @ (7.5, 460.25)；right 191.5 < 侧栏 199.5；`overflowX=false`（1200×800）。
- 亮色卡面 `rgb(252,252,251)`；暗色 `rgb(30,30,29)`，文字 `rgb(250,249,245)`。
- 选中段：亮色 `rgb(222,220,210)` 描边、字重 600；暗色 `rgba(255,255,255,.18)` 描边、字重 600。
- Esc 关闭面板后 `document.activeElement` 回到 `.avatar`；控制台 0 异常。

## 截图

- `usage-all-light.png`
- `usage-all-dark.png`
