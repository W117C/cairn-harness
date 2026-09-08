# Claude Code / Claude Agent SDK 多 agent（subagent）机制调研

版本基线：@anthropic-ai/claude-agent-sdk@0.3.263（与 Claude Code v2.1.263 对齐）。证据源缩写：
- **SDT** = npm 包 sdk.d.ts（行号）；**ST** = sdk-tools.d.ts；**SCL** = anthropics/claude-agent-sdk-typescript CHANGELOG；**CCL** = anthropics/claude-code CHANGELOG（行号）；docs = code.claude.com/docs/en/...

## 1. 生成原语与生命周期
- 程序化定义：`Options.agents: Record<string, AgentDefinition>`（SDT:1427）。AgentDefinition：description、prompt（=子代理系统提示）、tools/disallowedTools、model、mcpServers、skills、maxTurns、background、memory、effort、permissionMode、observer（SDT:38-98）。
- 文件式定义：`.claude/agents/*.md` frontmatter（name/description/tools/disallowedTools/model/permissionMode/maxTurns/hooks/skills/memory/background…，docs /sub-agents "Supported frontmatter fields"）。
- 调用工具：模型发 tool_use，name="Agent"（v2.1.63 前叫 "Task"；system:init 的 tools 列表仍显示 "Task"，检测需双匹配）（docs /agent-sdk/subagents#detect-subagent-invocation）。输入 ST AgentInput（ST:662-693）：description、prompt、subagent_type、model、run_in_background（描述原文 "Agents run in the background by default"）、name（可用 SendMessage 定址）、**isolation:"worktree"|"remote"**、mode（已废弃）。
- 并行：一条 assistant 消息多个 Agent tool_use 即扇出；并发上限默认 20（CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS），超限 tool_result 返回 "Concurrent subagent limit reached"（docs /sub-agents "Concurrent subagent limit"；CCL:1206）。会话累计 200 上限已移除（CCL:1019）。
- 前台/后台：前台阻塞主会话、权限提示透传；后台并发、权限提示浮到主会话并标注发起 subagent、用更小内建工具集（docs /sub-agents "Run subagents in foreground or background"）。SDK 交互式会话默认后台（CCL:856）。task_started.is_backgrounded（SDT:5272）。
- 生命周期事件：system 流 task_started → task_progress → task_updated → task_notification(status: completed|failed|stopped, output_file)（SDT:5200-5345）；Agent tool 结构化 Output 有 status "completed"/"async_launched" + agentId（ST:103-159）。
- 发现：system:init `agents` 字段（SDT:5151）+ `Query.supportedAgents()`（SDT:2755）。
**借鉴**：spawn_agent 返回 task_id + 三态终结事件；工具签名直接抄 AgentInput（prompt 自包含 + subagent_type + run_in_background + isolation）；init 暴露 agents 清单给 UI。**避免**：mode=write 靠 prompt 约定隔离——官方已做成一等参数 isolation:"worktree"，Output 回带 worktreePath/worktreeBranch。

## 2. 上下文隔离与回传协议
- 非 fork 子代理 context 全新：无父对话、无父系统提示；父→子唯一通道是 Agent prompt 字符串；子收到：自己的系统提示+prompt、项目 CLAUDE.md（经 settingSources）、工具定义；父只收到子的 **final message** 作为 tool result（docs /agent-sdk/subagents "What subagents inherit" 附继承表）。fork（subagent_type:"fork"）继承完整对话与 prompt cache（CCL:856）。
- 输出扫描（v2.1.210+）：父读取前中和 `<system-reminder>` 类控制标签仿冒、转义 `Human:`/`Assistant:` 行、加 `[harness: ...]` 标记；不改写其余文本（docs /sub-agents "Subagent output scanning"）。
- `forwardSubagentText`（SDT:1727；SCL:707）：默认只转发子代理 tool_use/tool_result（心跳）；开启后转发文本/thinking 且全部带 parent_tool_use_id，深度 2+ 嵌套亦转发（CCL:1128）。
- 结构化回传：tool_use_result 对 Agent 工具 = final report + 运行统计（SDT:5374）。
**借鉴**：「只回 final summary」是协议而非副作用；结果双通道 = 文本 final message + 结构化 trailer（agentId/usage/toolStats）；宿主默认只订阅心跳，按需开全文转发防上下文爆炸。**避免**：把子代理中间输出并回父上下文；父可能转述丢原文——官方建议在 prompt 里要求逐字保留。

## 3. 权限与审批
- 评估顺序（docs /agent-sdk/permissions "How permissions are evaluated"）：①hooks（allow 不跳过后续）②deny 规则 ③allow/组织 ask ④permission mode（bypassPermissions 到此放行，除 rm/rmdir 关键路径；dontAsk 直接拒）⑤auto 分类器 ⑥canUseTool 回调。
- 子代理模式：AgentDefinition.permissionMode 可覆盖；父为 bypassPermissions/acceptEdits 时优先且不可覆盖；父为 auto 时子继承 auto 且忽略 frontmatter（docs /sub-agents "Permission modes"）。AgentInput.mode 废弃，语义="继承父会话模式，frontmatter 可覆盖"（ST:707-711）。
- 审批路由：canUseTool options.agentID 标识请求来自哪个子代理（SDT:244）；后台子代理提示浮到主会话，Esc 拒绝单次调用不杀 subagent；session 级授权同时作用于主会话（docs）。拒绝落 SDKPermissionDeniedMessage.agent_id（SDT:4855-4862）+ result.permission_denials。
- hooks：HOOK_EVENTS 含 SubagentStart/SubagentStop（SDT:873）。SubagentStopHookInput：agent_id/agent_type/agent_transcript_path/last_assistant_message/stop_hook_active（SDT:8459-8480）。frontmatter hooks 仅该子代理活跃期生效，其 Stop 运行时转为 SubagentStop；settings/managed/plugin hooks 在子代理内照常触发 PreToolUse/PostToolUse（docs /sub-agents "Define hooks for subagents"）。SDK HookCallbackMatcher{matcher,hooks,timeout}（SDT:866）；includeHookEvents 把 hook 事件注入消息流（SDT:1720）。
**借鉴**：canUseTool(toolName,input,{agentID}) 单审批口 + agentID 路由 UI；「拒绝单次调用不杀 agent」的粒度；宽模式从父向下单调不可提权。**避免**：让子代理绕过 hooks——官方 hooks 在子代理内同样触发，是审计防线。

## 4. 状态与可观测
- parent/child 区分：SDKAssistantMessage.parent_tool_use_id（SDT:3316-3324）、subagent_type（SDT:3352）；partial 流同（SDT:4832）。task_started.tool_use_id 关联发起调用；**spawn_depth**（1=顶层，N+1=嵌套，SDT:5276）。
- 进度：task_progress.usage{total_tokens,tool_uses,duration_ms}+last_tool_name；agentProgressSummaries 每 ~30s fork 生成一行摘要（SDT:1908-1918）。
- 取消：Options.abortController（SDT:1401）；Query.interrupt()（interrupt_receipt_v1 回执 still_queued，SDT:2600-2615）；Query.stopTask(taskId)→task_notification stopped（SDT:2923）；Query.backgroundTasks(toolUseId)（SDT:2928）；Query.close()。未声明 perTaskStopAffordance 时 interrupt fail-closed 连后台任务一起杀（SDT:4022、1660-1667）。
- 超时：**未找到** per-subagent 墙钟超时；上限手段为 maxTurns（Options+AgentDefinition 两级）、maxBudgetUsd、深度/并发。TaskOutputInput{block,timeout} 为收割输出的等待方式（ST:732-742）。
- 落盘：~/.claude/projects/<dir>/<sessionId>/subagents/agent-<agentId>.jsonl；listSubagents()/getSubagentMessages()（SDT:1038-1056、834）。
**借鉴**：task_started/progress/notification 三段式 + spawn_depth/is_backgrounded 可直接复用进 append-only 事件流；取消分三层（单任务/turn/进程）。**避免**：默认 interrupt 连后台任务一起杀的 fail-closed 语义需在 UI 显式告知。

## 5. 嵌套
- 允许，默认 3 层（CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3；=1 关闭）。到深度上限时直接从工具列表摘除 Agent（fork 例外：保留但调用返回错误）——沉默降级而非报错（docs /sub-agents "Let subagents spawn their own subagents"）。历史：≤v2.1.172 默认 5 层不可配 → 2.1.217/218 默认 1 → 2.1.219 起 3（docs Note；CCL:1146；SCL:249）。动机：中间输出止于中间层，只有顶层摘要回主会话。
**借鉴**：默认 2-3 层可配；用「摘工具」实现深度上限比运行时报错对模型更友好；配合预算闸门。

## 6. 失败/恢复
- maxTurns 到限：输出标记 partial + SendMessage 续跑提示（CCL:526）。
- API 错误：中途截断先自动 continue（CCL:232）；终止时前台返回 partial+截断注记或 "Agent terminated early due to an API error"，后台标 failed 且通知带最后输出；错误文本绝不冒充子代理结果（docs /sub-agents "API errors in subagents"）。fallback model chain 可救活（同节）。
- 恢复：Agent tool result 文本含 `agentId: <id>` trailer；resume:<sessionId> + prompt 指名 agentId + 同一 agents 定义即续跑；Explore/Plan 内建为一次性无 agentId（docs /agent-sdk/subagents "Resume subagents"）。恢复的子代理总是后台注册（SDT:5274）。嵌套后台结果存进父 transcript，resume 不丢（CCL:181）；transcript>5MB 曾致 resume 失败（CCL:245）。
- 预算：maxBudgetUsd 超限 → 拒绝再 spawn + 停后台 + error_max_budget_usd（SDT:4959；docs "Cap subagent depth, concurrency, and spend"）。
**借鉴**：稳定 agentId + transcript 文件，恢复=resume+指名；错误与结果严格分型。**避免**：把错误文本当结果喂父模型。

## 7. Token/成本计量
- 关键：SDKResultMessage.usage 注释 "MAIN AGENT LOOP ONLY — excludes Task subagent"；正确口径是 modelUsage: Record<model, ModelUsage>，覆盖主循环+Task 子代理+sidechain+压缩（SDT:4970-4976、5033-5039）；total_cost_usd 累计含子代理（SDT:4966）。
- per-subagent：task_started/progress/notification 均带 usage{total_tokens,tool_uses,duration_ms}（SDT:5212-5280）；Agent Output 含完整 API usage + toolStats（read/search/bash/edit 计数、linesAdded/Removed）+ totalTokens + resolvedModel/modelsUsed（ST:103-159）。
**借鉴**：聚合用 modelUsage（按模型分桶），单 agent 用 task usage 流；toolStats 行为计数对 UI 很值。**避免**：拿 result.usage 当全量（漏掉全部子代理开销）。

## 8. 反面模式（官方承认的坑）
- 后台子代理权限通道随父 turn 结束被关闭："Tool permission request failed: Error: Stream closed"/"AbortError: Stream closed"——claude-agent-sdk-typescript **#361/#376/#384/#438**（全 open）。宿主必须保活父会话并开新 turn 应答。
- 并行写同一仓库：官方答案是一等 isolation:"worktree"；补丁史显示坑多——worktree 隔离曾漏破坏性 git 命令打到主 checkout（CCL:1053）、后台会话不能编辑自建 worktree（CCL:332）、hook 建 worktree 识别失败（CCL:165）。
- 上下文污染/注入：子代理输出仿冒 system-reminder/Human: 被官方做成扫描器（v2.1.210）——该攻击真实发生过。
- 无界增长：并发 20 + 深度 3 均为踩坑后补（CCL:1206/1146）；长会话内存靠"结果离开显示窗口即释放"修（CCL:679）。
- 权限答复丢失：session 级答复（含 deny）曾在后台子代理提示中被丢弃（CCL:786）；PreToolUse auto-allow hook 曾绕过后台 agent 工具限制（CCL:1054）。
- 模型覆盖链反复修：CLAUDE_CODE_SUBAGENT_MODEL 从"覆盖一切"改为"默认值"（CCL:364），另有 _FORCE（CCL:196）与 per-spawn/definition 覆盖优先级。
- 回信路由：SendMessage 给 subagent 的回复投递到父会话而非该 subagent（CCL:433；issue #92016）。
- 结果过早汇报：v2.1.211 前后台子代理未完成即被汇报（docs）。

## 对 spawn_agent(task, mode) 的映射
- write：isolation:"worktree" 一等参数 + 回传 worktreePath/Branch；隔离面必须含 git 破坏命令。
- read：tools 白名单（Read/Grep/Glob…）+ 后台默认 + maxTurns 兜底。
- pipeline：agentId+resume 原语驱动 实现→审查→测试 角色流水线；partial 标记触发续跑。
- 审批：canUseTool(agentID) 单口路由 + 单次拒绝不杀 + 宽模式单调不可提权。
- 事件流：task_* 事件 + parent_tool_use_id + spawn_depth 与 append-only 架构天然契合。
- 三闸门（深度/并发/预算）默认全开。最大前车之鉴：不要让子代理权限通道依赖父 turn 存活（#361-#438）。