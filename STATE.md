# Cairn / DSH —— 现态

rev: 8e94d99b07351f6334e2551e4b7f8ccd6f28c179

本页描述 `cairn/` 当前工作树，不代表同级 staging、远端或已发布应用。
C（互操作）批次在当前工作树**未提交**；`rev` 仍是它落笔前的基线提交。
任务、阻塞与待开工统一见 [仓库整理与任务清单](docs/REPOSITORY-STATUS.md)；
逐批读数见 `PROGRESS.md`，历史证据保留在 `PROGRESS.md` 与 `outputs/`。
本页整体重写，台账只追加。

## 当前实现

- **core**：`src/agent/`、`src/tools/`、`src/providers/`、`src/permissions/`、`src/events/`；
  `src/main/` 是 electron-free 的应用服务。核心不得反向依赖 `apps/desktop/`。
- **desktop**：`apps/desktop/` 的 main / preload / renderer；渲染层分 `state/`、`derived/`、
  `components/`、`panes/` 与组合根 `App.tsx`。IPC 契约在 `src/main/ipc-protocol.ts`。
- **会话**：CLI 已调用 `createProductFork`；桌面 Stream 已有来源引用（`EventRef`），
  协议与行为以 ADR 0005 与对应测试为准。
- **本地 agent 生命周期**：逻辑 thread 与 run 分离；`send_agent`、`list_agents`、`resume_agent`、
  `close_agent` 共用 fenced `AgentRuntime`，重复 send/close 按消息 id 幂等。spawn 路径保留模型
  工具调用 id，worker 终态回执能与原始 `spawn_agent` 调用配对。
- **编排**：`src/orchestration/` 已有 P0–P4 本地纵切、动态 `race` / `gather any/quorum`、
  确定性取消与迟到结果隔离；崩溃后无活动执行器的 `running/verifying/merging` 运行转为
  `needs_you`，重复恢复不追加状态。
- **远程执行适配器**：已实现带能力、fence、契约摘要、deadline、heartbeat 与幂等键的
  outbound JSON-RPC 适配器；断线投影为 `needs_you`。当前只接收只读/无副作用任务，
  尚无受控远程交付与回滚通道，也没有经过真实外部 worker 部署认证。
- **记忆 / provider**：历史检索、预测压缩、hybrid memory adapter 与固定配对评测已入库；
  DeepSeek 专用适配已入库。确定性夹具读数不等于真实 provider 任务收益。
- **互操作**：`src/interop/` 提供延迟工具检索（`tool_search`）、`AgentClientV1` SDK、
  ACP JSON-RPC 适配器与 stdio 传输、A2A 任务桥与 loopback HTTP 传输、Harbor/Terminal-Bench
  形态的任务适配与运行记录；`scripts/external-bench.ts` 可把外部证据落成 JSONL。
  `src/main/interop-host.ts` 把 SDK run 接到 `handleAgentRun` 的产品装配，
  `scripts/acp-server.ts` / `a2a-server.ts` 提供真实 stdio / loopback HTTP 服务；
  A2A 产品运行时只接受只读任务。均只做边界映射，不绕过既有权限门。ACP stdio 并发分派请求，
  prompt 运行中可收到 cancel；SDK 的工具表由宿主注入，缺省空表 fail-closed，不回落到静态 `TOOLS`。
- **自进化**：账本、反思、补丁门、毕业与 Assess 已入库；运行产物不入库。

## 正在收口

- A/B/C 三批实现与定向判卷已落。C 的公开接口是传输中立内核 + JSON-RPC 分派，
  不是打包好的 ACP stdio 服务或 A2A HTTP 服务；外部跑器仍需仓库外的执行面。
- 真实 DeepSeek 连接需要 `DEEPSEEK_API_KEY`；wire 判卷只证明请求形状。
- 同一活跃会话的插话、取消后继续发送与跨窗口 smoke 已接通；空屏首发的 running key 由单测钉住。
- FilePane 与设置页已有真实 renderer / 生产 preload 的键盘、失败恢复与窄窗补测。
- `head-cert-check` 与 `mutate-verify` 的最新完整证据仍绑定历史提交；当前 A/B/C 工作树需独立验证。

## 待验与待决

- 编排控制面的真实用户交互；当前只有组件/服务面判卷。
- 远程 worker 的真实外部部署、跨机器取消、网络分区与受控写回；本地 fake server 不证明外部互操作。
- A 的真实 provider 任务成功率、成本节省与对话质量收益。
- C 的外部认证：真实 ACP 客户端握手与权限桥、A2A 认证/TLS/SSE、Harbor/Terminal-Bench
  真实执行；stdio/loopback HTTP 产品服务已用 demo provider 端到端判卷，但外部客户端/网络面
  与真实 provider 仍未认证。
- 自进化新接线的真实收益；不能用判卷绿替代。
- 长会话/大 diff 的跨机器长尾与 Radix 是否值得懒加载；当前本机读数不足以支持重构。
- FilePane 已在 500 项目录下通过真机 smoke，设置页已在真实 main/preload 下通过；仍需真实用户可发现性样本。
- 取料归档治理。

## 验证入口

命令与边界见 `AGENTS.md`；逐轮读数见 `PROGRESS.md` 与 `docs/REPOSITORY-STATUS.md`。
core 与 desktop 分开验证；`mutate-verify` / `head-cert-check` 只证明被测量的那个提交。
