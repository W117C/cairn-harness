# 评审修复 · 真机读数（2026-10-21 批 138）

隔离实例 9367（dist 真产物，1440×900）。

## Critical：设置返回点不到（已修）

- 原因：`ModalSurface.isolateOutside` 把 titlebar 兄弟子树标成 inert；批 137 的工具栏「返回」
  只对脚本 `.click()` 有效，真人鼠标点不到。
- 修后：返回按钮在 `.sp-page` **surface 内部**（`.sp-back`，rect 8,50,57×26），
  `elementFromPoint` 命中按钮内元素；真实 CDP 鼠标 press/release 后面板关闭。
- 设置打开时 titlebar 不摆侧栏开关，也不摆 `.tb-back`；分区说明「外观、文字与输入习惯。」在位。

## 其他评审修（行为）

- 坏行：每一行都 parse；不含关键词的坏行也计数；最后一行无尾换行且解析失败 = 在飞半行，不冒充损坏。
- 用量/日志：新增 `listSessionIds` / `isSessionInRoot`（只 stat + 首行），不再为看日志整份读所有会话；
  用量账本不再依赖 metadata sidecar（metadata 损坏也出账）。
- 命令面板技能：同一 invoke 去重（插件技能/命令同名只留首条）。
- 检查器 resize：effect 只挂窗口 resize；侧栏状态用 ref 读，冷启动判一次。
- `workspaceSearch`：`/tmp` ⇒「工作区未经登记，已拒绝」；已登记工作区 ⇒ 正常返回。
- 16 个被并行会话删除的已跟踪证据 PNG 已从 HEAD 恢复（报告引用不再悬空）。

## 截图

- `settings-back-in-surface.png`
