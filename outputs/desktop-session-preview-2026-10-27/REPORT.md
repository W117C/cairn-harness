# 会话预览可继续（2026-10-27）

范围：把 `⌘+点击侧栏` 打开的只读会话预览，补成可继续交互的窗格。
设计依据：`apps/desktop/design/desktop-design-spec.md` §3.7「分屏看会话，落点=窗格层」。
本目录只放 md/json/png，不放源码副本、不放 TS。

## 一、缺口

预览窗格（2026-10-25 第一层）能看另一场会话的实时流，但底部没有输入：
用户看到预览里的任务需要补充时，只能「切到会话」把主体换过去，或者回主输入框操作。
第 714 页与预览组件头注都把「完整双会话输入/队列」列为欠账。

## 二、交付

- `useRunQueue.sendTo(sid, workspace, text, attachments, { running })`：与主发送共用
  插话 / 队列 / `runOn` 管线；`resumeQueueFor(sid, workspace)` 供队列停表后续发。
- 队列键与 `queueSet` 按**目标会话的工作区**算；`runOn` 不再改写主会话的 `workspaceRef`，
  预览另一工作区的会话不会把主会话的队列/running 键串过去。
- `runOn` 返回首轮 `RunResponse`：预览的事件态晚一拍时，主进程答「已在运行」会回落到
  插话、再回落到入队，不丢字。
- `SessionPreviewPane` 底部紧凑输入框：Enter 发送、Shift+Enter 换行；运行中显示停止钮；
  插话被拒显示「已加入队列」，本轮结束后可「继续发送队列」；发送中不禁止输入（焦点不丢）。
- 接线经 `WorkbenchView → PaneDock → SessionPreviewPane`；没有新增 IPC 通道。

## 三、读数

| 检查 | 读数 |
|---|---|
| 预览真机 smoke | **19/19 PASS**；`checks.json` 为机器原文 |
| 桌面套件 | **225 文件 / 1493 条全绿**（`--maxWorkers=2`；收尾复跑含同树他笔新增测试）；boundary 绿 |
| `run-queue-session` 判卷 | 9/9（新增 3 条：跨工作区起跑键、插话被拒入队、already-running 回落插话） |
| 根 typecheck | tracked 面 0；唯一报错在**他笔未跟踪草稿** `tests/acp-server-cli.test.ts`，已按四档归因 |
| `renderer-layer-check` | 绿（135 个渲染层源文件） |
| `docs-check` | 受检项全绿 |
| 桌面 build | 绿；最终 dist `assets/App-CQbaJl55.js`、`assets/index-*.css` |

smoke 关键明细：

- 空闲：输入「预览里继续」+ Enter → `run` 记录 `{sessionId:"s2", message:"预览里继续"}`，回执「已发送」；
- 运行中：注入 `assistant_delta` → 运行标记与停止钮出现；Enter → `runSteer("s2","插一句话")`，回执「已插话到本轮」；
- 插话被拒：`runSteer` 回 `{ok:false}` → 回执「已加入队列，本轮结束后发送」；
- 终态后：待发送队列可见；点「继续发送队列」→ `run` 记录 `{sessionId:"s2", message:"排队这句"}`；
- 停止：停止钮 → `runCancel("s2")`，回执「已请求停止」；
- 初始徽标为「不切主会话」（不再写「只读」）；发送后主体仍停在 s1；
- 预览打开后从侧栏直接打开同一场会话 → 预览与标签自动收起（不留同内容副本）；
- 880 窄窗：右栏自动收 0（保正文）但页面无横向溢出（主区 621）；变宽后若仍收起，⌘⌥I 恢复预览（pane 420 / preview 404 / 输入框 356）；
- 原有 ⌘+点击不切主体、切到会话、行菜单预览、无控制台错误全部保持。

截图：`01-session-preview.png`（含底部输入框）、`02-switched.png`。

## 四、未验边界

- 预览只发**纯文本**；附件、@引用、技能菜单、goal/plan 开关仍归主输入框。
- 预览发送使用当前窗口的权限档与 Plan 默认值，没有独立的 preview 模型/思考档选择。
- 跨工作区只在 hook 判卷里钉了起跑/队列键；真机 smoke 的两个夹具会话同属一个工作区。
- 窄窗只钉 880 一个样本；720 探针同形（右栏 0、无溢出），未纳入 smoke。
- 排队 sidecar 复用主发送的 `queueSet`；若预览会话在另一工作区，主界面的队列条要等
  该会话在工作区打开后才显示同一条队列（数据在盘上，不在预览里另存）。
- smoke 用合成 `AgentApi` + 隐藏窗口；真实模型、生产 preload、业主应用重开未覆盖。
- 工作树未提交，保留其他会话在飞改动；本笔不改 PROGRESS 页，避免与并发页号相撞。
