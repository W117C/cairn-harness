# SoL-Pi 融合前修复进度

本记录承接 `solpi-integration-review-2026-09-17.md`，不替代原提案或只读计划。当前仍在阶段 A，不代表 SoL-Pi 集成完成。

## 已落地

- F3：loop 统一先持久化事件再加入本轮上下文；工具结果、错误和权限拒绝可进入下一次请求，避免重复插入用户与模型事件。
- F2 部分：renderer 发送请求携带当前会话 ID。测试执行实际发送处理器，但不是 Electron IPC 端到端验收。
- F1 部分：主 GLM 分支使用已有日志型 session provider，传入工作区与按权限过滤的基础工具 schema。每次请求恢复历史并消费工具反馈；演示覆盖分支和缺省 mock 保持兼容。
- F5 部分：session provider 直接转发流式输出与取消信号，提供压缩事件 emit 注入点。主 run 的合成取消信号不再被调用方 signal 覆盖，clarify/plan 等待复用合成信号。
- 自动压缩主事件管线：session provider 每轮从事件日志重建投影，自然触发阈值后先发非流式摘要请求，再重新组装压缩后历史；compaction 事件经 emit 进入实时管线与持久事件日志，且两份事件序列一致。组装时计入 system、tool schema、memory 与用户传入的组装开销；摘要请求透传主 run 取消信号，取消发生在重试或网络请求中的任一阶段都会中止压缩。
- 沉淀轮消息契约：主 GLM 沉淀分支消费调用方传入的历史与 DISTILL_INSTRUCTION，每次调用创建新请求，只暴露 remember schema。沉淀指令不作为 user_message 持久化。
- 沉淀取消：网络、工具上下文、合并审批均接主 run 的 signal；开始调用前、消费输出时和审批返回后检查取消，避免取消后继续写记忆。
- 插件重挂接线：主入口将 skillsRouting、hookContext 和 runtime.remountFromEvents 的 text 投影传给 session provider，不再重复拼进基座 system。已有插件上下文计入压缩前估算，压缩落盘后重新计算重挂内容。新产生的重挂开销及符号地图尚未构成最终请求硬预算校验，不宣称总请求预算已完全闭合。

## 验证证据

- GLM 集成回归修复前：预期两次请求，实际一次，失败。
- GLM 集成回归修复后：历史恢复、工具 schema、下一请求工具反馈、日志与实时事件一致、同会话第二次发送均通过。网络使用离线 fetch SSE 替身，不访问真实模型。
- 取消回归修复前：界面取消被接受，但请求 signal 未中止，失败；修复后通过，调用方原始 signal 不受影响。
- `TERM=dumb pnpm test`：65 files / 614 passed，退出码 0。
- `TERM=dumb pnpm typecheck`：退出码 0。
- 压缩接线修复前：60 条长会话只产生一次模型请求，live 与 replay 日志均无 compaction 事件，失败。
- 压缩接线修复后：正常分支先收到非流式摘要请求，下一次主请求包含 COMPACTED_HISTORY 与最新用户消息；live 与 replay 日志的 compaction 事件一致；tokens_after 小于 tokens_before。取消分支在摘要 fetch 替身中触发 UI 取消，run reject，只发生一次摘要请求、没有后续主请求，live 与 replay 日志均无 compaction 事件。该参数化测试不是两个取消时机测试。
- 定向 loop/session-provider/session-wiring/renderer-session/compaction：5 files / 33 passed。
- 最后一次单跑 session-wiring：1 file / 2 passed。
- 早先未指定仓库配置的测试运行误纳入第三方目录，其失败不作为项目门禁结论；以上完整测试使用 package.json 的正式测试命令。
- 沉淀集成回归：第二次请求含原用户任务、主回复及末尾专用沉淀指令，工具面恰好只有 remember，传入有效 AbortSignal，沉淀指令未污染用户事件。
- 审批取消回归红到绿：修复前 UI 取消后 pendingCount=1，需等超时；补传审批 signal 后 pendingCount=0，决议原因为 user 而非 timeout，remember.run 未调用。另有单元测试覆盖审批回调取消后返回批准仍不写入。
- 重挂接线回归：替换 PluginRuntime.remountFromEvents 的返回值，确认压缩前后两次投影，压缩后的主请求包含 REMOUNTED_SKILL。证明主入口接线，不等同于真实受信插件端到端验收。
- 最新完整复核（上述源码改动后，11:50）：`TERM=dumb pnpm test` 为 65 files / 619 passed，退出码 0；`TERM=dumb pnpm typecheck` 退出码 0。此前 614 项是历史基线，不是最新结果。

## 下一顺序

1. 完成阶段 A 剩余：完整工具 schema（含 worker remember 去重）、明确 demo/真实配置、工作区绑定、最终组装预算与真实插件重挂验证。自动压缩事件管线、摘要取消、沉淀消息契约和插件投影接线已有本轮离线证据。
2. 验证真实 IPC 连续发送、重开与重启恢复，执行剩余适用门禁。当前未跑完整 gates、Electron 交互验收或真实模型请求。
3. 阶段 B：真实请求计量和有效初始快照，再做默认关闭的有界观测归档及 recall。
4. 阶段 C、D：受控融合与确定性收据，最后评估经济压缩。没有实测证据前不声称节省 token 或费用。

本轮不修改冻结判卷或用户原提案；保留工作区已有改动。没有创建提交。

---

# 续轮（同日晚些时候接手，另一会话 429/模型名错误中断后）

承接上文「下一顺序」第 1–2 项，把 **阶段 A 收口**。本段只记本轮增量，不覆盖上文结论；
上文已证项不在本段重复。**仍不修改冻结判卷（`fixtures/**` 本轮 `git status` 零命中）。**

## A-1 工具面与执行面同源（此前是两套）

| 缺陷（都在代码里实测，不是推断） | 证据 | 修法 |
|---|---|---|
| 模型可见面缺 `lsp`，而 `lsp` 在执行面真实存在 | `toolTableFor()`（`src/permissions/autonomy.ts:258-262`）含 lsp；`gateToolSpecs()` 不含 → 模型永远调不到一个已接线的工具。旁证：sidechat 白名单 `SIDECHAT_TOOL_WHITELIST` 也写了 lsp，实际规格表把它过滤掉了（白名单一条死项） | `gateToolSpecs` 补 lsp 规格（6 个操作 + 1-based 行列），与 `toolTableFor` 对齐 |
| 插件/MCP 工具**可执行但不可见** | `installPluginTools()`（`agent-runner:362-380`）把 `skill` 与 `mcp__plugin_*` 装进 `TOOLS` 执行表，但 `createProvider` 传给 provider 的仍是 `gateToolSpecs(mode)` → 模型看不到这些工具 | 新增 `sessionToolSpecs({mode, pluginTools})`（`glm-session.ts`）：基础规格按 mode 摘除写向工具后，叠加运行时注入规格；MCP 参数**直接复用 server inputSchema 原文**（不翻译不裁剪，避免两套 schema 漂移）；同名冲突 fail-visible 记入 `skipped` 并告警，不静默覆盖基础工具 |
| worker 规格出现重复 `lsp` 的风险 | `workerToolSpecs` 原本自己 push 一份 lsp 规格（因 gate 表不含它） | 补齐后改为**按名字去重**再追加 shell 家族；测试断言「每个可执行工具恰好一条」 |

**测试**：`tests/session-tools.test.ts`（新建，12 条）
——①三个档位的模型可见面 ⊇ `toolTableFor(mode)`，且只读档不带写向工具与 remember；
②MCP `inputSchema` 逐字段复用 + 同名冲突被跳过且不覆盖；③worker 规格无重复。

## A-2 明确 demo / 真实通道（不再「未设 env 就静默 mock」）

- `AppSettings` 新增 `provider: "demo" | "glm"`、`model: string`（进 `validateSettings` 白名单与 `set()` 合并键）。
- `resolveProviderKind()`：`M0A_PROVIDER` env 覆盖优先（既有 check/演示脚本不受影响），否则读 settings；
  **缺省 `demo` = 显式演示档**，设置页/providerInfo 显示为「demo（冻结剧本，非真实模型）」。
- `provider=glm` 且无 `M0_API_KEY` → **显式报错**（不静默回落 mock）；`providerInfo()` 改为与 run 同源
  （此前只认 env ⇒ 设置页永远显示 mock）。
- `model` 从 settings 串到请求：`createGlmSessionProvider({model})` / `createGlmSummarizer(model)` / 沉淀支的
  `streamGlm(..., {model})`。

**测试**：无 key 的 glm 档 `runAgent` 必须 reject 且错误含 `M0_API_KEY`；`validateSettings` 反向断言
（非法 provider 回退 demo、非法 workspace 回退 null）。

## A-3 工作区与会话归属（两处静默丢弃）

| 缺陷 | 实测 | 修法 |
|---|---|---|
| 主对话工作区恒落在 `fixtures/todo-app` | `handleAgentRun` 只有 `over.workspace ?? M0B_WORKSPACE ?? WORKSPACE` 三条，UI/设置无从指定 | 新增 `resolveRunWorkspace()` 解析链：**overrides > IPC 请求 > M0B_WORKSPACE > settings.workspace > 内置靶子**；`RunRequest` 增 `workspace?`，IPC 边界做形状/长度校验（renderer 不可信） |
| **`req.sessionId` 被静默忽略**（本轮新发现） | `handleAgentRun` 用 `over.sessionId` 判会话模式；`RunRequest.sessionId` 若不额外塞进 overrides，就落到 tmp 日志 + 每轮 rm ⇒ 会话 JSONL 恒空、跨轮无历史。IPC 层恰好**同时**传了两处才没暴露 | 取并集 `over.sessionId ?? req.sessionId`；`RunRequest` 补 `sessionId?` 类型 |

**测试**：①纯函数钉住解析链优先级；②**真实端到端**：请求带 `workspace=<临时目录>`，模型（离线 fetch 替身）
调 `read_file`，断言第二轮请求回灌里出现只存在于该工作区的哨兵 ⇒ 工作区绑定真的生效；
③带 `sessionId` 走 IPC 入口连发两轮，收句柄后读会话 JSONL：两轮文本都在（append 语义，未被 rm）。

## A-4 组装预算闭合 + 真实插件重挂端到端

- 符号地图文本此前**在压缩判定之后**才构建 ⇒ 硬预算判定少算这一块；现改为**先构建地图**再把
  `mapChars` 计入 `AssemblyOverhead`（连同 system/重挂、tool schema、记忆），压缩后重组装时一并重算。
- **真实受信插件端到端**（此前只有「替换 `remountFromEvents` 返回值」的桩测试）：
  `tests/session-tools.test.ts` 把冻结样本 `fixtures/plugins/project/echo-suite` 复制进临时工作区 →
  未受信时 `skills()` 为空（信任门是硬闸）→ `trustDecide` 后 `/echo-suite:greet` 进路由 →
  预置「skill 已触发、随后被压缩摘除」的会话日志 → 跑主会话 → 断言**本次请求的 system 面同时含
  真实 skill 路由与重挂全文（`Greet Skill`）**，且 `skill` 工具在模型可见面里。

## 本轮顺手修掉的跨会话红

`tests/renderer-session.test.ts` 在本轮开始时是**红的**：另一并发会话（前端 P0）往 `app.js` 的 `send`
里加了 `syncStatusbar()`，而该测试的 vm 桩面没跟上 ⇒ 整段被 try/catch 吞掉、断言退化成「一次都没调」。
修法：桩面补齐 `syncStatusbar` / `loadSessions`（**测试是自家 tests/，非冻结判卷**）。

## 验证证据（本轮实跑，逐道退出码）

| 门 | 退出码 | 备注 |
|---|---|---|
| `typecheck` | **0** | |
| `test` | **0** | **67 files / 634 passed**（接手时基线是 66 files / 622 passed / **1 红**） |
| `e2e` | **0** | mock 分支未动（W4 口径） |
| `ipc:check` | **0** | |
| `sidechat-check` / `tools-check` / `compaction-check` | **0** | lsp 进规格后 sidechat 白名单不再有死项 |
| `map-check` | **0** | **先按 AGENTS.md 预案把 `.codegraph/daemon.sock` 临时 mv 出仓库再跑**（否则 `cp EINVAL` 假红，与代码无关），跑完原样移回 |
| `agents-check` / `plugins-check` / `schedule-check` | **0** | |
| `prune-check` / `commercial-check` / `memory-check` / `autonomy-check` | **0** | settings 新增键未破坏白名单类断言 |
| `build` | **0** | 用 AGENTS.md 记的垫片逃生舱 `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR=` 跑（`out/renderer/index.html` 124.33 kB / `assets/index-D4dO_QZy.js` 95.95 kB）；preload 的 `run(req: RunRequest)` 类型同步收窄 |

**未跑/未证（不得当作通过）**：`pnpm gates` 全量（含 `panels-check` —— 该门此刻的红属另一并发会话的前端轮，
与 SoL-Pi 无关）、`gate-check` 暗卷（需真实凭据）、`provider:check` 联网分支，以及
`sandbox:check` / `fork-check` / `providers-check` / `gym-check` / `routing-check` / `supervisor-check` /
`security-check` / `renderer-arch-check` / `a11y-check` 本轮未跑。

## 仍未做（阶段 B/C/D，按提案留位）

计量与观测（F4 靶场投影级计量、有界归档与 recall）、单机制试验（Action Fusion / 确定性收据）、
经济压缩（缓存计量与 horizon）。另外两条留位：renderer 侧尚未把 `workspace` 填进 `api.run`
（`src/renderer/app.js` 由并发会话持有，本轮不越界改），故 `RunRequest.workspace` 目前只有测试与
内部调用方在用；UI 接线待该文件交回。

本轮未创建提交（工作树同时含另一会话的前端改动，按隔离纪律不混合入库）。
