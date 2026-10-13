# 第 481 页取料：审批卡给归属（sessionId 进 AskPayload）

出证 2026-10-14；工作树 `/Users/ze/Downloads/Cairn/deepseek harness`，分支 `zcode`。

## 1. 缺陷成因（静态形核 + 判据验证，见第 3 节的诚实口径）

- `AskPayload` 键 = askId / tool / args / reason / risk / riskReasons / sentAt —— **无 sessionId**
  （`src/main/ipc-protocol.ts`）。
- 卡经模块级共享面 `appAskGate`（`src/main/agent-runner.ts`）发出，其 `pending` 键只有
  `askId`（进程内自增序号，**不带会话维度**）。
- 渲染层吃单一 `useState<AskPayload | null>` ⇒ 结构上只能画「最后到达的那张卡」。

同一文件里错误条与提示条**是按会话键控的**（`sessionErrors` / `sessionNotices`），审批卡不是 ——
同一个功能面里的两套口径。

⚠️ **我没能用真窗口把「跨会话串台」跑出来**：脚本化冒烟一轮约 2.4s 收束、无并发实例，
插不进第二个会话同时卡在审批门上。本页缺陷是**结构推导 + 判据验证**，不是运行时复现。

## 2. 改法（三层各一处）

1. `src/main/ask-gate.ts`：`AskRequest` 加可选 `sessionId`，`request` 的 ctx 接受并透进 notify 载荷。
   缺省 = **键缺席**（不是 undefined 属性）⇒ 渲染层能分清「归属未知」与「归属于当前会话」。
2. `src/main/agent-runner.ts`：发卡边界用既有 `currentSession()?.sessionId` 盖章（AsyncLocalStorage
   的 run 作用域；工具闭包签名零改动）。headless／无 sessionId 的 run ⇒ 留空，不猜。
3. `apps/desktop/src/renderer/`：新增纯函数 `askBelongsToSession`（`send-queue.ts`，唯一判定出口），
   App 用它筛「这张卡是不是本会话的」。归属未知 ⇒ 沿用旧行为照旧显示（不静默吞卡）。

载荷形状变了 ⇒ `IPC_PROTOCOL_VERSION` 2→3（握手套路与 vite define 保证新老不同源即 fatal）。

## 3. 红-绿与反向验证（红→绿→红 各看过）

| 面 | 用例 | 基线 | 变异后 |
|---|---|---|---|
| core | `tests/ask-gate.test.ts`「ctx.sessionId 透进 notify 载荷」 | 11 passed | **1 failed**（剥掉 sessionId 那一句） |
| desktop | `tests/send-queue.test.ts`「askBelongsToSession 三态」 | 173 passed | **1 failed**（归属判定改成恒 true） |

第一版判据我写错过：`{askId, tool, args, ...notifyCtx}` 天然把 sessionId 摊进去，
导致「剥掉显式那行」与「从签名摘掉 sessionId」两种变异都**照样绿**（类型擦除 + 展开冗余）
⇒ 那是**伪绿**。订正后核的是 `Object.keys(载荷)` 有无该键，才有了杀伤力。写在这里是因为
「写了判据」和「判据有牙」不是一回事。

## 4. 变异锚点

- `ask-gate-session-id-not-forwarded`（`scripts/mutate-verify.mjs`，＋12 行）。
  `--check-needles` 1555→**1556 条**，阻断 0。
- 桌面侧的 `askBelongsToSession` **没进变异表**：`--check-needles` 现读 0 条入口指向
  `apps/desktop/src`（整表 1556 条尽数落在 src/ 与 scripts/）。给它开一条等于由我立先例，
  本页不做；其判据由上面的桌面用例与 `pnpm --filter cairn-desktop test` 迭代压着。

## 5. 冒烟那一趟假红（不是本页改动造成的，留档以免重踩）

第一趟 `pnpm --filter cairn-desktop smoke` **红**（侧栏 0 行、`text:""`、ModelPicker 缺席）。
归因：`git stash` 掉本笔七个文件后重跑**仍红** ⇒ 与本笔无关；只把 `askForActive` 退回
`ask` 也**仍红**。真因是 `apps/desktop/dist/` 停在旧构建（index.html 为 10-13 23:42），
之后所有 renderer 改动都没进产物 ⇒ `pnpm run build` 后 **PASS in 2412 ms**。

读法：**`smoke` 吃的是 `dist/` 产物而不是源码；改了 renderer 不重新 build，冒烟测的是上一版。**
这一格此前没人写下过。

## 6. 本次读数

核心判卷 371 文件 **5302 条全绿**（5301→5302，＋1＝本页新用例）；桌面 **17 文件 173 条全绿**
（170→173，＋3）；`pnpm typecheck` 与桌面 `tsc --noEmit` **0 条报错**；`desktop-boundary-check` 绿；
`security-check` 54 断言 0 红、`repo-hygiene-check` 三面全绿；真窗口冒烟 **PASS in 2412 ms**。

## 7. 未跑（不许读成绿）

- `mutate-verify` **全表未跑**（1556 条 ≈ 20+ 分钟）。
- 真模型／生产行为未跑（无凭据）。
- 跨会话审批并发的**运行时读数**：需要两个会话同时卡在审批门上，当前 demo 面做不到（第 1 节）。
