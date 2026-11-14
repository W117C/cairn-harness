# DS-Bot 调研裁决：证据（2026-11-15）

- 基线提交：HEAD `8d552446`（ADR 0015 的证据面；文档提交后代码未变）
- 结论文件：`docs/adr/0015-ds-bot-benchmark.md`（状态 Proposed）
- 上游参考：`Fei2411/DS-Bot`（Apache-2.0，只取问题/机制/代价，不复制实现）

## 一、12 面逐项复核（命令与命中）

方法：对每格跑 `grep -n '<symbol>' '<path>' | head -1`，命中即记；全部 12 面命中。
本文件只记「路径#符号」与命令形状，不抄行号（重排会漂）。

| # | 面 | 证据（path#symbol） |
|---|---|---|
| M1 | 长期成员/roster | `src/agent/roles/user-agents.ts#UserAgentRole`、`src/agent/local-agent-runtime.ts#LocalAgentRuntime` |
| M2 | 成员↔成员消息 | `src/tools/agent-lifecycle.ts#SEND_AGENT_TOOL` |
| M3 | 群聊 | `src/orchestration/engine.ts#OrchestrationEngine`（ControlGroup 是竞速/法定人数，不是群聊） |
| M4 | @接力/隐藏会话 | `src/agent/sidechat.ts#sidechat`、`src/agent/orchestrator-types.ts#agent_id` |
| M5 | 成员目录 | `src/agent/worktree.ts#worktree` |
| M6 | 成员权限 | `src/permissions/modes.ts#PermissionMode`、`src/agent/worker-report.ts#clampTier` |
| M7 | 私密成员 | `src/agent/memory/store.ts#projectMemoryDir`、`#globalMemoryDir` |
| M8 | 记忆作用域 | `src/agent/memory/store.ts#projectMemoryDir`、`inject.ts`、`distill.ts`、`consolidate.ts`、`retrieval.ts`、`src/tools/remember.ts#remember` |
| M9 | 上下文管家 | `src/agent/compaction.ts#shouldCompact` |
| M10 | 全文索引 | `src/main/session-search.ts#searchSessions`、`src/agent/history-search.ts#searchHistory` |
| M11 | 用量的成员维 | `src/agent/usage-attribution.ts`、`src/main/usage-analytics.ts#UsageLedgerBucketPayload` |
| M12 | 密钥按成员 | `src/agent/plugins/secrets.ts#getPluginSecret`、`src/main/provider-key-inject.ts`、`src/events/redact.ts#redactSecrets` |

## 二、平台硬约束复核

- 插件面：`src/agent/plugins/types.ts`、`src/agent/plugins/hooks.ts`；渲染窗格 `apps/desktop/src/renderer/pane-registry.ts#PaneKind`；IPC 表 `apps/desktop/src/main/channels.ts`。
- 事件联合：`src/events/types.ts#AgentEvent`（新增种类只允许日志结构控制记录，ADR 0005）。
- 核心边界：`scripts/desktop-boundary-check.ts`。
- 承载件：`src/events/types.ts#session_meta_update`、`src/events/projection.ts#sessionMetaPatch`、`src/agent/agent-thread-projector.ts#projectAgentThreads`、`src/events/session.ts#forkSessionPointer`、`src/main/sessions.ts#sidechats`、`src/main/session-mutation-lock.ts#withSessionMutation`、`src/agent/worker-tool-table.ts#buildWorkerToolTable`、`src/orchestration/store.ts#createEventLog`、`src/orchestration/project.ts#projectOrchestration`。

## 三、体量读数（HEAD `8d552446`，文件数；行数不在此复算）

| 面 | 文件数 |
| --- | --- |
| `src/agent` | 163 |
| `src/main` | 122 |
| `apps/desktop/src/renderer/state` | 34 |
| `apps/desktop/src/renderer/derived` | 23 |
| `apps/desktop/src/renderer/components` | 140 |
| `apps/desktop/src/renderer/panes` | 9 |

复算：`git ls-tree -r --name-only HEAD <dir> | wc -l`。
与调研计划 §3.4 的旧读数有差（`src/main` 121→122、state 33→34、derived 22→23、components 121→140），
说明那组数字按 2026-11-14 的快照记录；本文件只把**文件数**作为今天的读数，**不复用旧行数**。

## 四、未复核 / 边界

- 上游 DS-Bot 的 12 机制细节、36k 行客户端、33 篇设计文档：来自调研计划 §二（2026-11-14 的参考材料），
  本文件**没有**重新拉取上游仓库；ADR 的裁决只依赖「问题/机制/代价」，不依赖它的行数。
- 12 面只做「有没有」的命中复核；每面的行为细节（如记忆额度、权限继承）仍以引用点代码为准。
- 本目录不含任何 TS 制品；`outputs/` 的 typecheck 门不受影响。
