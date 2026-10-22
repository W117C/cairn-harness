# Core 评审 Important 三条收口（2026-10-21）

承接 `PROGRESS.md` 第 626 页登记的三条 Important。全部先红后绿（变异验证），无协议/渲染层改动。

## 1. action-fusion 的 lint 红不再吞掉落盘事实

- 形状：融合把「写已落盘 + 配置 lint 红」编码为写工具 `ok:false`（输出含 `[fused_write:succeeded]`）。
  loop 的收束闸只看 `result.ok` ⇒ `wroteThisRun` 不置位 ⇒ auto-verify 整段跳过。
- 修法：`src/agent/loop.ts` 的写盘判据改为 `result.ok || output.includes("[fused_write:succeeded]")`；
  `wroteThisRun / wroteSinceAutoBeat / wroteSinceVerifyBeat` 三位同源。融合自身的 `ok` 语义与既有用例不动。
- 判卷：`tests/action-fusion.test.ts` 新增「configured lint failure still counts as a persisted write
  ⇒ auto-verify runs」：lint 红写仍产生恰好 1 条 `verify_result{auto:true}`。
- 变异：把判据退回 `result.ok` ⇒ 新用例红（auto 拍 0 ≠ 1）；已复原。
- 读数：该文件 23/23 绿。

## 2. sidechat 读工具有自己的只读门（两种时序同一答案）

- 形状（首场主 run 前）：sidechat 用全局 `TOOLS` 的裸实现 ⇒ `read_file .env` 绕过敏感路径判据，
  凭据可进旁路上下文。
- 形状（首场后）：`installAppTools` 已把 `TOOLS.*` 换成 `gatedTool` 闭包，而旁路没有 run scope
  ⇒ 每次读都 `[permission denied] … 工具门未接线（fail-closed）`。
- 修法：
  - `src/main/tool-gates.ts`：`GateSession` 提为导出类型；`gatedTool(..., fixedSession?)` 可带显式会话；
    新增 `readOnlyGateSession(workspace)`（read-only 档 + 同源规则库 + 无 askGate = 需问人即拒）。
  - `src/main/sidechat-handlers.ts`：`sidechatToolTable(workspace)` 从**原始实现**建四把只读工具，
    显式带只读会话；`runSidechatTurn` 接 `tools` 执行面。
  - `src/agent/sidechat.ts`：`SidechatTurnOptions.tools` 透传 loop 的 `tools`（缺省行为不变）。
- 判卷：`tests/sidechat-tool-gate.test.ts` 2 例：
  1. 首场前正常读成功；`.env` 被拒且输出无密钥；回执含 `[permission denied]`。
  2. `installAppTools` 之后旁路正常读仍成功，不再出现「工具门未接线」。
- 变异：移除显式 `tools` 传参 ⇒ 两例均红（`.env` 被执行；安装后读被门未接线拒绝）；已复原。
- 读数：该文件 2/2 绿；`sidechat-core` 既有 15 例不动且绿。

## 3. remember 审批卡随取消收束

- 形状：`createGatedRemember.getAsk` 只收 args，`ctx.signal` 在门口丢掉 ⇒ 取消后卡驻留到 60s 超时。
- 修法：`getAsk(args, signal?)`；run 传 `ctx.signal`；生产闭包把它交给 `AskGate.request({signal})`。
- 判卷：`tests/remember.test.ts` 新增「审批等待带上运行取消信号」，断言 ask 收到的 signal
  与工具上下文是同一对象。
- 读数：`remember` 全绿；`worker-remember-scope` 全绿（既有调用形状兼容）。

## 全量读数

| 面 | 结果 |
|---|---|
| 根套件 | **451 文件 / 6214 用例全绿**（上一轮 450/6210：+1 文件，+4 例） |
| 桌面套件 | **160 文件 / 1192 用例全绿** |
| typecheck | 根 0；桌面 0 |
| boundary / docs-check / repo-hygiene | 全绿 |
| 未跑 | `pnpm gates` / `mutate-verify` / `head-cert`；改动未提交 |

无 IPC / 协议版本 / 渲染层改动 ⇒ 不重建桌面 dist；桌面端无需重启加载。
