### 1. 命令面板切项目不清当前会话，下一次发送会把同一 sessionId 写进新工作区
- area: desktop-code | severity: high | effort: small
- file: apps/desktop/src/renderer/panes/WorkbenchView.tsx:1076
- problem: 切项目只改 activeWorkspace，activeId/events 仍指向原会话；send 把新的 activeWorkspace 与旧的 activeId 一起送进 run，kernel-host 以显式 workspace 为准生成新日志路径，导致旧 session id 在新工作区被重建、事件混进当前转录。
- fix: 切项目时先走 `newSession()`/清 `activeId` 与 `events`，或让 send 以会话归属工作区为准并在 workspace 不匹配时拒绝；命令面板的项目项应改成「切换并新建任务」。

### 2. 后台会话每个非终态事件都 force 整棵工作台重渲染
- area: desktop-code | severity: high | effort: small
- file: apps/desktop/src/renderer/state/session-subscription.ts:97
- problem: 活动会话之外任意会话的每条非终态事件（assistant_delta、thinking_delta、tool_call、tool_result、usage…）都调用 force，根状态更新会让 WorkbenchView 及 Sidebar/Composer/PaneDock/Inspector 全量重渲染；用户只是切到另一个会话或让定时任务在后台跑，就会按 token 频率整树重画。
- fix: 只在 running 状态发生转变时 force；其余事件用 rAF/16ms 合并，或把「后台运行中」状态搬到独立的外部 store/Context 分片，避免穿透整个工作台。

### 3. 每个流式 delta 都重跑全量转录投影，Stream 的 memo 在流式期间恒失效
- area: desktop-code | severity: high | effort: large
- file: apps/desktop/src/renderer/state/workbench.ts:778
- problem: 每条 assistant_delta 先执行 `setEvents((prev) => [...prev, e])`（整数组复制），随后对整条转录重跑 mergeViewEvents、数组 map、refs Map、inherited Set、projectStream，以及 usage/count 等全量扫描；projectStream 每次返回全新行对象，Stream 的 memo 对流式更新无法命中，长会话逐 token 的成本随历史长度线性增长。
- fix: 按事件序号做增量投影（只追加/改写最后一行，未变行保持对象同一性）；非分叉会话跳过 mergeViewEvents（用本地 events 直接构造 refs）；把 usage/count 结果 memo 到事件数组变更上；Stream 的行组件按稳定 row 引用比较。

### 4. openSession 对同一份 JSONL 读三遍，并把转录以三份副本跨 IPC 送回
- area: core | severity: high | effort: medium
- file: src/events/log.ts:242
- problem: 打开会话时 kernel-host 先 replay 整份日志，再 refreshSnapshot 数行读第二遍，再 readSessionView 解析链文件读第三遍；返回值同时携带 events、view.entries（每条事件再包一层 ref）和 view.localEvents（原始事件），非分叉会话三份内容完全相同，IPC 结构化克隆和渲染层常驻内存都被放大数倍。
- fix: 只读一次：以 `readSessionView(...).localEvents` 作为 events，不再调 replay；只返回分叉描述（parent/boundary/localCount），非分叉会话不返回 entries/localEvents；需要 refs 时在渲染层按 index 懒构造，并对超长会话分页。

### 5. 每次 run 收束都整份读 JSONL 数行，最长可连读 8 遍
- area: desktop-code | severity: medium | effort: small
- file: apps/desktop/src/main/kernel-host.ts:443
- problem: 漂移基线刷新用 `readFile` + `split` 统计非空行，在每场 run 的 finally 和每次 openSession 都执行；stableSessionSnapshot 连续 8 次重试时每次重跑整份读取。会话日志到 20MB 时主进程要读/分配最多 160MB 字符串与多份行数组，Electron 主线程单线程被阻塞，所有窗口 IPC 和界面响应一起卡住。
- fix: 复用 core 的增量 `countSessionLines`，或直接维护 `baseline.lines + ownAppends` 计数；openSession 已有 replay 结果时用 `events.length` 作基线行数，不再读文件。

### 6. 默认收起的 Inspector 与隐藏窗格仍对每条事件跑全量投影
- area: desktop-code | severity: medium | effort: medium
- file: apps/desktop/src/renderer/panes/WorkbenchView.tsx:963
- problem: 右侧 Panel 收起时 Inspector 仍挂载并在每次 WorkbenchView 渲染时计算 changedFilesOf/projectPlans/timelineItems 三个全量投影；默认布局下每条流式 delta 都产生这些 CPU 成本，却没有任何可见内容。PaneDock 也同时渲染所有已开 tab（包括隐藏 tab），ChangesPane/PlanPane/TasksPane 各自再扫整条事件流。
- fix: Inspector 在 `inspectorCollapsed` 期间不渲染正文（或把三个投影 useMemo 并把内容拆到选中 Tab 才计算）；PaneDock 只渲染 active pane，terminal/browser 用 keep-alive 单独保留。

### 7. 运行状态同屏两处重复，步数口径不同，且 aria-live 每秒播报
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/components/Composer.tsx:730
- problem: 运行中同一状态同时显示在工具栏 WorkStatusPill 和 Composer 的 cc-phase 条：两处都显示 phaseLabel 与 elapsedSec，但步数一处是全会话累计 `steps`、一处是本轮 `runSteps`，没有口径标注，用户会看到两个不同的「步」数；cc-phase 还是 `role="status" aria-live="polite"`，elapsedSec 每秒变化会让读屏器每秒播报整条状态。
- fix: 只保留一处运行状态（建议 pill 只承载 todo，状态条留在输入区）；两处都标清「本轮/累计」；把 aria-live 从含秒表的容器移到只包含阶段文案的静态节点，或改为 `aria-live="off"` 并在阶段变化时显式播报。

### 8. ⌘↩ during a run steers the message into the turn and then cancels that turn — the message is silently dropped
- area: desktop-code | severity: critical | effort: small
- file: apps/desktop/src/renderer/components/Composer.tsx:603
- problem: The documented shortcut “⌘↩ 运行中 = 入队并打断本轮” does not queue at all. For a running, attachment-free message `send()` takes the steer path, and `submit()` then calls `onCancel()` in the same tick. The steering message is either consumed by the turn that is immediately aborted or left unconsumed and discarded with the run, so the user's text never becomes the next task.
- fix: Pass `forceQueue: true` on the interrupt path (`submit({ interrupt: true, forceQueue: true })`), or make `send()` treat the interrupt intent as queue-first so the message is persisted to the session queue before `onCancel()` is issued. Add a regression test for the running + ⌘Enter case that asserts the message survives the cancel.

### 9. Global Escape handler cancels the run from secondary text fields, before the field's own Esc behavior
- area: desktop-design | severity: high | effort: small
- file: apps/desktop/src/renderer/state/app-commands.ts:119
- problem: The window-capture Escape handler stops the active run whenever focus is not inside a modal/popover. It never checks `isEditableTarget`, so pressing Esc in the sidebar session search (whose own handler promises “clear query, then collapse”) or in the browser address bar both performs the field's action and cancels the in-flight turn. Because it runs in the capture phase it also pre-empts PaneDock's maximise-Esc listener, so one Esc both un-maximises the browser pane and kills the run.
- fix: In the Escape branch return early when `isEditableTarget(e.target)` and the target is not the composer textarea (the composer's own stop-on-Esc is deliberate); mark the sidebar search input `data-esc-owns="true"`; and make PaneDock's maximise handler consume the key (`stopImmediatePropagation`) or register it through one shared Escape-layer stack so only the top layer acts.

### 10. xhigh is rejected by the renderer's thinking-level guard: the control does nothing and the chip/request diverge
- area: desktop-code | severity: high | effort: small
- file: apps/desktop/src/renderer/state/thinking-selection.ts:14
- problem: The working-tree change that added `xhigh` to the shared capability list did not update the renderer's hardcoded list. `isThinkingEffort("xhigh")` is false, so choosing xhigh in the model menu returns null from `thinkingChangeTarget` and is silently ignored, while a session whose stored level is xhigh is displayed as “思考 关” by `composerThinking` even though `runOn` still sends the raw xhigh value. The effort panel (which gets `reconciled`) can show xhigh selected while the composer chip says off.
- fix: Derive the runtime guard from `THINKING_EFFORTS` exported by `src/providers/capabilities` instead of the local array, and update the stale test assertion. Add a regression case asserting that the chip label and `thinkingBySession` value are the same for every value in `THINKING_EFFORTS`.

### 11. Changes pane keeps review comments and expanded diff across session switches — comments can be sent to the wrong session
- area: desktop-code | severity: high | effort: medium
- file: apps/desktop/src/renderer/components/ChangesPane.tsx:45
- problem: The PaneDock is mounted once and is not keyed by session (unlike the Inspector next to it), so ChangesPane's local `comments` map, `openKey` and loaded diff survive a session switch. Switching from session A to session B leaves A's “N 条评注待提交” bar on screen; submitting it calls `send` for B, so A's file/line review text is posted as a message to B. If B also contains the same `round:path` key, the expanded row shows A's snapshot diff under B's file header.
- fix: Pass `sessionId` (and workspace) into ChangesPane and reset `comments`, `openKey`/diff and `openRound` when it changes, or wrap the session-scoped panes with `key={runKey(workspace, sessionId)}` so React unmounts their local state on every session switch.

### 12. “Switch project” from ⌘K re-homes an open session to another workspace — draft, run state and live events break
- area: desktop-code | severity: high | effort: small
- file: apps/desktop/src/renderer/panes/WorkbenchView.tsx:1076
- problem: Selecting a project in the command palette only calls `setActiveWorkspace(path)`; it leaves `activeId` pointing at the previous project's session. The Composer immediately re-keys its draft to the new workspace (the visible draft empties), the run indicator/stop button look up `runKey(newWorkspace, oldSession)` and go false, and `isStaleForActive` drops the old session's live events as belonging to another workspace.
- fix: Make project selection a new-task transition: after `setActiveWorkspace(path)` call `newSession()` (as the sidebar's `g-new` already does at `Sidebar.tsx:917-920`), or close the current session and show the empty surface. Never leave `activeId` bound to a session from a different workspace.

### 13. Opening a session or starting a new task while on a destination page is invisible
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/state/workbench.ts:474
- problem: `openSession` changes `activeId` and `activeWorkspace` but never leaves a non-chat destination. From the 插件/记忆/自动化 pages, choosing a session in ⌘K (or Ctrl+Tab, ⌘N, F2) operates on the chat surface that is currently hidden and inert, so the palette closes and nothing appears to happen.
- fix: Introduce one `goToSession(id, workspace)` that sets `destination = "chat"`, closes Settings and then calls `openSession`; route the palette, notifications, Ctrl+Tab and F2/new-task through it. `newSession` should also return to the chat destination.

### 14. Closing the last pane unmounts the dock and drops keyboard focus to document.body
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/components/PaneDock.tsx:890
- problem: The close handler schedules a focus move to the first remaining `.pane-nav-item` on the next frame. When the closed pane is the last one, `onClose` empties `paneTabs` and WorkbenchView unmounts the entire PaneDock, so `navRef.current` is null and focus falls to `document.body`. The keyboard user's next Tab restarts at the top of the app instead of returning to the toolbar control that opened the pane.
- fix: Give PaneDock an `onClosed(kind, remainingCount)` callback (or return focus through WorkbenchView): when `remainingCount === 0`, focus the opener in the toolbar (`[data-workbench-changes="true"]` or `[aria-label="工作台工具"]`); otherwise focus the newly active tab, not the first tab.

### 15. Journal compaction drops per-task watermarks and can re-run already-triggered automations
- area: core | severity: critical | effort: medium
- file: src/main/scheduler.ts:173
- problem: compactJournalIfLarge keeps only the last 4,000 entries globally (`entries.slice(-JOURNAL_KEEP_ENTRIES)`); a sparse task's last decision entry can be discarded while other tasks append noise. lastDecidedAt then falls back to `def.createdAt` (line 731), so the next tick re-enumerates the latest due occurrence and writes a new triggered/catchup entry because journalKeys no longer contains it. The same readFile→writeFileAtomic replacement is serialized only by the in-process journalChain, so a triggered entry appended by another instance (desktop + `cairn --serve`) between lines 171 and 174 is also erased, producing a duplicate run after restart.
- fix: Persist a per-task last-decided watermark separately (or retain at least the latest entry per task during compaction), and run compaction under the same cross-process admission lock while re-reading and merging entries immediately before replacement.

### 16. Settings writes are lossy: corrupt files are overwritten with defaults and unknown keys are dropped
- area: core | severity: high | effort: small
- file: src/main/settings.ts:434
- problem: When `readDisk` hits invalid JSON it returns `validateSettings(null)`, i.e. DEFAULT_SETTINGS (lines 369-382). `applyPatch` only refuses writes when the patch contains `customInstructions` (line 413), so a normal layout/theme/telemetry write builds `next` from the defaults and persists it (lines 429-440), destroying the only copy the user could repair. Even on a valid file, `persisted` is copied from the validated object and only `provider`/`model` are rescued from the raw file (lines 434-438), so any unknown top-level field from a newer version/provider is erased by every settings write.
- fix: Block all writes while `this.issue !== null` (or rename the bad file to a timestamped `.corrupt-*` backup before writing), and preserve all unknown raw keys in `persisted`, not just provider/model.

### 17. Session run lock can be double-acquired while its file is empty and stays stuck after PID reuse
- area: core | severity: high | effort: medium
- file: src/main/session-lock.ts:101
- problem: `open(path, 'wx')` creates a zero-byte lock before `fh.writeFile(body)` runs (lines 88-90). A second process that opens the same session in that window reads `''`, `readOwner` returns `{}`, `ownerPid` is null, the busy check at line 101 is false, and `again === raw` is true, so line 106 unlinks the first process's lock and acquires its own; both writers then append to the same JSONL and break the 1-based event-id contract. Separately, `sessionRunLockHeld` line 47 considers any existing live PID as the owner forever, so a crashed run whose PID is later reused permanently blocks resume/rename/delete.
- fix: Publish the lock body atomically (temp file + link/rename, or treat an empty/partial lock as busy for a grace period instead of unlinking it), and record process start time or validate lock age so a reused PID cannot keep a dead lock alive; return a distinguishable 'stale lock' error instead of permanent busy.

### 18. A complete final event without a trailing newline is visible to replay but deleted by the next append
- area: core | severity: high | effort: small
- file: src/events/log.ts:70
- problem: `repairPartialTail` assumes any file not ending in `\n` is half-written and truncates to the previous newline (line 70 sets cut=0 for a whole-file tail; line 72 truncates). But `replay()` parses every non-empty line, including a valid complete JSON event with no trailing newline (lines 247-262), while `replayIncremental()` drops the final segment unconditionally via `allParts.slice(0, -1)` (line 331). A crash after the JSON bytes but before the newline therefore yields one event from replay and zero from incremental; the next `createEventLog().append` silently deletes that event, shifting all subsequent event ids/line references.
- fix: If the unterminated tail parses as a complete AgentEvent, append `\n` and preserve it; only truncate an unparseable prefix. Make replayIncremental use the same complete-tail test as replay.

### 19. Custom schedules in east-of-UTC timezones fire one day early
- area: core | severity: medium | effort: small
- file: src/main/scheduler.ts:279
- problem: `zonedDate` already returns the UTC instant for the requested wall clock, but `anchorUtc` subtracts `tzOffsetMs` a second time. That shifts the anchor by the zone offset, so the `base.getUTCDate()` used for `zonedDate` often falls on the previous local day; everyDays stepping then lands one day early in positive-offset zones such as Sydney, Auckland and Tokyo.
- fix: Use the wall-clock epoch directly as the anchor (`Date.UTC(year, month-1, day, h, m)`) or advance calendar days in the task timezone; add Sydney/Auckland DST tests for everyDays > 1.

### 20. Session search indexes worker-internal assistant text as user-visible conversation
- area: core | severity: medium | effort: small
- file: src/main/session-search.ts:84
- problem: VisibleCorpus.push dispatches only on event.type and never checks `agent_id`; worker subflows write assistant_message/assistant_delta into the main session JSONL with `agent_id` (worker-projection withAgentId; orchestrator.ts:1373). Search therefore returns worker internal prose the user never saw in the main transcript, and matchCount/snippets point at worker lines. The file header says `agent_*（worker 子流内部）` is excluded, but these event types carry `agent_id` instead of an `agent_` type.
- fix: Skip any event with a non-null `agent_id` (including assistant_delta, whose type needs the optional field) before the type branches in VisibleCorpus.push; add a regression fixture with worker-attributed assistant events.

### 21. Session line-count cache credits bytes beyond the captured stat size, double-counting lines during live runs
- area: core | severity: low | effort: small
- file: src/main/sessions.ts:186
- problem: listSessions captures `stat` first (line 407) and then calls countSessionLines(p, st). On a cold cache, `readFile` can observe bytes appended after that stat; `foldSegments(0, raw, st.size, st.ino)` counts every line in `raw` but records `size: st.size`. On the next list call, `cached.size < st.size` makes the incremental branch reread the already-counted bytes from `st.size` and add those lines to `closed` again. Streaming assistant_delta appends make this common; `SessionInfo.lines` and the sidechat line badge drift upward permanently until the inode changes.
- fix: Pass `Buffer.byteLength(raw, 'utf8')` (the actual bytes read) as `endSize` on the cold path instead of `st.size`, and treat a short read in the incremental branch as partial rather than EOF.

### 22. 会话列表行高 48px、时间戳另起一行，密度只有规格的一半
- area: desktop-design | severity: high | effort: medium
- file: apps/desktop/src/renderer/styles.css:376
- problem: 默认会话行硬编码为 48px，并且 .s-summary 用 flex-direction:column 把标题和 .s-meta（相对时间）排成两行；41 条会话的列表在 900px 高窗口里只露出约 11 条。规范 §3.11 要求会话行 26px、状态图标 + 标题 + 右侧相对时间同一行；tokens.css 已定义 --h-row:26px，但这里没有消费，--size-scale 也完全到不了会话行。紧凑模式虽降到 28px，却用 .s-meta> :not(.s-pin){display:none} 把时间/项目/草稿全部隐藏。
- fix: 让 .session 使用 var(--h-row)（或新增 --h-session），并把 .s-summary 改为单行 flex：标题 flex:1，.s-time/.s-draft/.s-pin 作为行尾 meta 用 margin-left:auto；紧凑模式保留同一信息，不用隐藏时间。

### 23. 插件安装审查仍用六格能力大卡和英文键名，与详情抽屉不一致
- area: desktop-design | severity: high | effort: small
- file: apps/desktop/src/renderer/components/plugins/PluginReview.tsx:61
- problem: 审查页把 Object.entries(review.capabilities) 的每一项（包括 0 值）渲染成带边框的六格卡，并直接输出原始键名 skills/commands/agents/hooks/mcp/lsp。PluginDetail 已在 2026-11-05 改为紧凑的 plugin-capability-pills；同一份能力数据在详情是中文胶囊、在审查是英文六卡，而发现页卡片又用 PLUGIN_CATEGORY_LABEL（hooks 显示“钩子”）。这同时违反 PRODUCT.md:51 的 card-inside-card 禁令，并在 880px 审查时让权限/风险区被推到折叠线以下。
- fix: 审查页复用 labels.ts 的 PLUGIN_CATEGORY_LABEL 和 PluginDetail 的 plugin-capability-pills 逻辑：只渲染 count>0 的胶囊，全零时用一行 plugin-muted 文本；删除 .plugin-capability-grid 的六格结构。

### 24. 插件详情/审查抽屉从 48px 开始，38px 标题栏下留出 10px 页面缝
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/components/plugins/plugins.css:521
- problem: 插件抽屉使用 position:fixed; top:48px，但应用统一工具栏是 38px（styles.css:93 的 grid-template-rows:38px）。因此每次打开插件详情或安装审查，抽屉上方都会露出一条 10px 的底层页面，既像第二层被裁掉的头，也能看到/点到后面的内容；而设置页（styles.css:2363）和 mod 侧栏（styles.css:2789）都已按 38px 对齐。
- fix: 改为 top:38px（或新增 --titlebar-height 并在 .plugin-sheet/.sp-page 共用），并补一条抽屉与工具栏贴合的几何判据。

### 25. 模型菜单按 344px 夹取，但 CSS 已允许 420px，右缘会溢出
- area: desktop-code | severity: medium | effort: medium
- file: apps/desktop/src/renderer/components/ModelPicker.tsx:23
- problem: MODEL_MENU_WIDTH 仍写死 344，modelMenuLeft 用它计算右缘夹取；但 model-menu.css 已改为 width:fit-content; min-width:240px; max-width:420px，并明确注释“不再固定 344px”。当自定义 provider 的长 model 名把菜单撑到 >344px、触发条又靠近窗口右沿时，左沿会按 344 算，实际 420px 的右半会越过视口，被 .main 的 overflow-x:clip 裁掉，隐藏选中 ✓、识图徽标或右侧元数据。tests/model-menu-fit.test.ts:49 只断言 CSS 文本，把“344 的保守假设”当成不会溢出的证明。
- fix: 在 useLayoutEffect 内先读菜单实际 getBoundingClientRect().width 再计算 left（或把 CSS 宽度固定为单一 --model-menu-width token 并与 JS 共用），并在测试中模拟长名称/窄窗口的真实几何。

### 26. 设置页重复“设置”标题，页面标题又超出 20/22 的字阶
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/components/SettingsPanel.tsx:368
- problem: 打开设置后，工具栏中央先显示“设置”（WorkbenchView.tsx:390），左侧导航又显示一次“设置”（本行），而内容区第一个标题是 26px；用量统计页因为不走 .ss-head 选择器，仍吃 base .ss-title 的 28px，目的地页面又是 24px。规范 §4.4 的 title 档只有 20/22px，实际标题在 24/26/28 之间跳，且首屏出现两次同一个父级词，层级被无意义地撑高。
- fix: 两处标题只保留一处（推荐删导航栏的 sp-nav-title，或让工具栏在该全屏面板不显示上下文）；把 .ss-title 与 .page-frame-title 统一到 --fs-title-lg（22px）或 --fs-title-md（20px），用量页也改走同一个 page-title 类。

### 27. 局部 :focus-visible 规则叠在全局三层焦点环上，键盘焦点出现双环
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/components/plugins/plugins.css:15
- problem: 全局 :focus-visible（styles.css:46-52）已经用 box-shadow 画三层蓝色焦点环，并只留透明 outline 占位；插件页又给所有后代加 `outline: 2px solid var(--accent-control); outline-offset:2px`，且没有清掉全局 box-shadow ⇒ 实际同时出现硬 outline 和外发光，形成双环。集成页用同样的写法但 offset:-2px，编排面板则用品牌橙 var(--accent)，跨屏焦点语言不一致；橙色环还会被读成品牌/选中态。
- fix: 删除这些组件级 outline 覆盖，统一让全局三层环工作；确实需要内嵌环的容器，用同一个 --accent-control 值并显式 `box-shadow:none`，或抽一个共享的 focus-ring mixin/token。

### 28. 上下文容量面板的六桶色是整色值，且没有暗色变体
- area: desktop-design | severity: medium | effort: small
- file: apps/desktop/src/renderer/tokens.css:142
- problem: --ctx-seg-messages 等六枚令牌写成完整 hsl(214 90% 62%) 值，而不是本仓规定的 HSL 三元组；它们只定义在 :root，暗色主题没有覆盖。结果上下文容量浮层在暗色下继续使用 70–90% 高饱和的蓝/紫/青/黄，成为整个界面最鲜艳的一块，也失去 hsl(var(--ctx-seg-*)/α) 的统一透明度能力，违背 §4.1 的存储纪律与“克制的暗色主题”。
- fix: 把六枚改为 `214 90% 62%` 形式的三元组，组件改 `hsl(var(--ctx-seg-*))`；在 [data-theme="dark"] 提供降饱和/提亮的六枚值（或直接映射到已有 chart 色族并加暗色档）。

### 29. worker 模型请求不接收 AbortSignal，cancelAgent 无法中止在途生成
- area: core | severity: critical | effort: medium
- file: src/agent/orchestrator.ts:1737
- problem: createWorkerProvider 只在 yiel* model 之前和之后检查 opts.signal，实际调用没有把 w.controller.signal 传给 WorkerModel。生产路径的 defaultWorkerModel / toWorkerModel 都支持 ProviderCall，但这里按两参数调用；cancelAgent() abort 后 worker 仍阻塞在网络请求里，继续消耗 token 并占用并发名额，wait_for_agents 只能超时。
- fix: 给 WorkerModel 增加可选 ProviderCall 参数，runOneRound 调用 `model(msgs, tools, { call: { signal: opts.signal } })`；defaultWorkerModel 把 call 转发给 streamGlm；worker 压缩的 maybeCompactWorkerEvents 也把 w.controller.signal 传进 runCompaction，并补一条“延迟 provider 中 cancel”的用例。

### 30. runAgent 失败收束不取消 detached worker，锁与 live 标记却先释放
- area: core | severity: high | effort: large
- file: src/main/agent-runner.ts:1786
- problem: runAgent 的 catch 只写 goal_stopped 后原样 rethrow，不会调用 orchestrator.cancelAll()；onRunAbort 只挂在外部 signal 上。若主 loop 因 maxSteps、provider 异常或磁盘错误失败，已 spawn 的 worker 仍会继续运行。与此同时 finally 立即 unmarkSessionRunLive（1821），handleAgentRun 随后释放 runLock（2143）：新 run 可在旧 worker 还在写同一 JSONL 时启动，session 删除也能通过 busy/lock 检查。
- fix: 在 runAgent 的异常路径显式 cancelAll 并等待 worker 终态（或至少 finish(cancelled)）；把会话 live 标记/run lock 的生命周期延长到 orchestrator.waitAll() 与 registerSessionTailWork 结束，或引入独立的背景写租约，确保新 run/删除不会与旧 worker 并发写同一份 JSONL。

### 31. worker diff 失败被吞成 null，写 worker 仍以 done 收束并可能清掉真实改动
- area: core | severity: high | effort: medium
- file: src/agent/orchestrator.ts:1522
- problem: worktreeDiff 的任何非零 git 退出（index.lock、git 不可用、输出超过 32MB 上限、权限错误）都会被 .catch(() => null) 吞掉。finishInner 随后仍发出 agent_status done、files_changed 变为空；安全 diff 扫描整段跳过。spawnSupervise 的 accept 路径再用 files_changed.length 判断 hasChanges，false 时直接 cleanupWrite(finalHandle, "rejected")，会把 worker 实际写出的文件连同 worktree/分支一起删掉。
- fix: 不要 catch 成 null 后继续：把 diff 失败作为 failed 收束并保留 worktree/分支，同时落一条可见错误；把“空 diff”和“diff 读取失败”分开建模；supervise accept 不得在 diff 状态未知时自动 cleanup。

### 32. 孤儿 worktree 清理会对任意 .agents/wt-* 目录执行 rm -rf
- area: core | severity: high | effort: small
- file: src/agent/worktree.ts:358
- problem: removeWorktree 在 `git worktree remove --force` 失败时无条件 rm -rf `worktreePathFor(root, agentId)`。cleanOrphanWorktree 接收的 agentId 来自 listWorktreeDirs 的 wt-* 目录名，只检查名字白名单和 ownedAgentIds，没有先确认它是已登记的 worktree；用户自己在 .agents/wt-<id> 放的普通目录会被 orphanWorktrees 当成孤儿，worktreeDirty 在 .agents 被忽略时还可能报干净，点击清理即永久删除。
- fix: removeWorktree 的 rm 兜底必须先通过 isWorktreeRoot 或 `git worktree list --porcelain` 确认该路径是登记过的 worktree；unrecognized 目录一律拒绝清理并从 orphan 列表排除；补一条“非 worktree 的同名目录不被删除”的用例。

### 33. 自动验证的 surface 信任探测不带取消信号，Stop 会被 60s 审批卡住
- area: core | severity: high | effort: small
- file: src/agent/verify.ts:452
- problem: surface() 调用 trustOf() 时不传 signal，trustOf 生成的信任请求因此没有 signal；runLoop 在 985 行直接 net `await opts.verify.surface?.()`，此时取消信号无法打断。首次在未信任仓库跑 autoVerify（默认开）时，surface 会发 verify_trust 审批卡并等 AskGate 的 60s 超时，用户按 Stop 也要等满 60s 才能收束。
- fix: 给 VerifyHook.surface 增加 signal 参数并让 loop 传 opts.signal；trustOf(signal) 把 signal 透传给 resolver.requestTrust/AskGate.request；surface 等待期间用 abort 竞速，取消时立即 fail-closed 返回 false。

### 34. 预测性压缩未传取消信号且在请求前 await，Stop 不能中止
- area: core | severity: medium | effort: medium
- file: src/agent/session-provider.ts:1260
- problem: startPrediction 启动 coordinator.predict 时只传 overhead/view/config，不传 signal；而它启动的是一次完整 summarizer 请求。后续请求在 decision 为 auto 时先 `await predictionTask`（1431），之后才检查 `call.signal.throwIfAborted()`（1463/1525）。如果压缩摘要挂起，用户取消后 turnGenerator 仍卡在 await，预测任务甚至会在 run 结束后继续跑并 append usage 事件。
- fix: 把 ProviderCall.signal 传进 startPrediction → coordinator.predict({ signal }) → runCompaction/summarizer；在 await predictionTask 时与 abort 竞速，取消后立即返回并让预测任务自行收束；确保 run 结束后不再 append 预测 usage。

### 35. pipeline 的 runChain 脱离执行且吞掉所有异常，链会永久停在 running
- area: core | severity: medium | effort: small
- file: src/agent/orchestrator-approvals.ts:215
- problem: spawnPipeline 先把 chain.status 设为 running、返回 ok:true 的 spawn_agent 回执，然后 `void this.runChain(chain).catch(() => {})`。runChain 内任何未捕获异常（emit 落盘失败、spawnStage/findToolCallEventId 抛出等）都被空 catch 吞掉，没有 failChain、没有终态 tool_result/agent_status，chain.status 永远保持 running；父模型已经收到成功回执，用户只能看到永不结束的 pipeline。
- fix: 把 detached 启动改成 `void this.runChain(chain).catch((err) => this.failChain(chain, "sequencer 异常：" + message).catch(() => {}))`，并在 runChain 外层用 try/finally 保证 chain.status 终态；补一条“emit 在第 2 环抛错仍落整链 failed”的用例。

### 36. No-progress judge and live loop disagree on what counts as a write
- area: core | severity: high | effort: small
- file: src/agent/no-progress.ts:22
- problem: The replay judge used by `no-progress-check` and eval re-derives "did the agent write?" from a private five-name set instead of the repo's single write predicate, so shell edits count as progress in the live loop but as stagnation in the judge. The gate can therefore be green on inputs that production would classify differently.
- fix: Delete `WRITE_TOOLS`; have `verifyBeatsFromEvents` index each `tool_call`'s args alongside its name and call `mayHaveWrittenDisk(name, args)`. Re-label this fixture as silent under production semantics and add a positive case whose only inter-verify write is a `run_shell` redirection, so the gate pins the same predicate the loop uses.

### 37. One 229-prop model object makes every streamed event re-render the whole workbench
- area: desktop-code | severity: high | effort: large
- file: apps/desktop/src/renderer/state/workbench.ts:951
- problem: The renderer's state cluster is a single 1,109-line hook returning a fresh 229-field object, and `App.tsx` just spreads it into a pane that redeclares all 229 props. Because the object identity changes on every render, memoization is impossible and every streamed assistant delta re-renders the sidebar, pane dock and stream tree.
- fix: Split into feature-scoped providers (sessions, run queue, approvals, workspace/projects, chrome/layout) with narrow slice objects; reduce `WorkbenchView` to a handful of props; memoize `Sidebar`/toolbar and batch event appends (rAF or ~50 ms flush) instead of copying the full event array per delta.

### 38. 146 IPC calls sit inside presentational components, bypassing the state layer
- area: desktop-code | severity: high | effort: large
- file: apps/desktop/src/renderer/panes/WorkbenchView.tsx:758
- problem: Components and panes are documented as "props in, events out", but 152 `window.agent.*` call sites live there, including approval decisions, session deletion and settings writes. Each site invents its own pending/error/toast handling, and the layer checker only inspects imports, so the rule is unenforced.
- fix: Move each cluster behind a state hook (approvals, session mutations, settings writer, browser/terminal host) that owns pending/error/toast state; add a renderer-layer-check rule that rejects `window.agent` in `components/` and `panes/` (allowlisting the popout shell if needed).

### 39. The "single" session resolver is production-dead; three live resolvers diverge
- area: core | severity: medium | effort: medium
- file: src/main/session-repository.ts:26
- problem: `resolveSessionRef` is documented as the exact-addressing entry for sessions (ambiguity rejects, unknown rejects) but has no production caller. The desktop reimplements it, core handlers repeat inline existence checks, and the live path's unknown-id behavior differs: it falls back to the active workspace and `run` never verifies the session exists, so a stale or deleted id creates a new JSONL in the active workspace.
- fix: Make kernel-host and session-handlers call `resolveSessionRef` with the registered roots and delete the inline guards; make unknown ids fail closed before creating a log, and add the missing `run` unknown-session case to kernel-host.test.ts.

### 40. Electron main bootstrap is 1,903 lines with 156 IPC handlers in the same module
- area: desktop-code | severity: medium | effort: large
- file: apps/desktop/src/main/index.ts:674
- problem: App bootstrap, plugin registry/marketplace, path gates, notifications, the entire 156-channel IPC table and window/quit lifecycle all live in one file that imports Electron and therefore cannot be imported by tests. Every IPC addition lands in the same module as window management, and the table's own completeness comment is already stale.
- fix: Split into `main/ipc/{sessions,plugins,projects,settings,workspace}.ts` handler factories taking `(host, deps)`, plus `main/window.ts` and `main/boot.ts`; keep index.ts as a ~100-line bootstrap. The full-key `Record` already makes a missing handler a compile error, so per-domain tables preserve the guarantee.

### 41. The 48-name role token layer is dead and shadowed by the CDS sheet
- area: desktop-design | severity: medium | effort: medium
- file: apps/desktop/src/renderer/tokens.css:56
- problem: tokens.css introduces a full role layer (accent/danger/success/warning, light and dark) and its comments claim this removes per-theme duplication, but only the warning values reach a semantic token. The accent/danger/success names are also defined by the official CDS sheet, which loads later, so the Cairn definitions are both unused and overridden. A designer editing them sees no visual change.
- fix: Delete Cairn's accent/danger/success role declarations and consume the official role tokens through the adapter (as `--color-danger` already does via `--fill-danger`); if a local override is required, rename to `--cairn-role-*` and wire every semantic colour through it. Correct the dark-block comment and add a token test that fails on a defined-but-unreferenced role token.

### 42. `locale` is a write-only setting that no UI reads
- area: desktop-design | severity: low | effort: small
- file: apps/desktop/src/renderer/components/settings-sections.tsx:254
- problem: The settings page shows a static "中文（简体）" row, while `settings.locale` is validated, persisted, included in preference backups and accepted by the patch whitelist with no reader anywhere. A backup or migration carrying `en-US` is accepted and stored, but the entire UI stays Chinese and the row still claims Chinese.
- fix: Either remove locale from AppSettings/preferences/PANEL_PATCH_KEYS and the row (ship one language), or make the row a real selector and route strings through a locale lookup; add a test that every settings key has at least one reader so write-only settings cannot ship again.

### 43. 工作区自带的 allow 规则可绕过全部审批
- area: core | severity: critical | effort: medium
- file: src/permissions/rules.ts:94
- problem: loadPermissionRules 无条件把 `<workspace>/.agent/permissions.json` 里的 allow 条目当作项目规则加载；同时 `.agent/permissions.always.json` 只在 `isGitTracked` 判为 tracked 时跳过，而 `isGitTracked` 在非 git 工作区、git 不可用或超时（2s）时返回 false。恶意仓库/下载解压的工程只要带一条裸 allow（例如 `{"rules":[{"behavior":"allow","tool":"run_shell","scope":"always"}]}`），judgeChain 就会命中，evaluate 的 L3-rule 分支直接 approve；默认/引导/自主档都不出审批卡（只有 critical 例外）。
- fix: 把工作区来源的 allow 规则纳入与插件/verify 相同的信任门（按内容指纹或用户显式授权）；在未授权前只接受 deny/ask，或把 allow 降为 ask。非 git 工作区的 `permissions.always.json` 必须 fail-closed，不得因 `isGitTracked` 的 false 回退而并入。

### 44. run_shell 的非重定向写绕过 `.agent` 与冻结判卷硬闸
- area: core | severity: critical | effort: medium
- file: src/tools/snapshot.ts:148
- problem: `.agent/` 的硬拒只发生在 `redirectWriteTargets(command)` 返回的重定向操作数上：`for (const raw of redirectWriteTargets(command)) assertNotAgentArea(raw, "run_shell")`。`tee .agent/permissions.always.json`、`cp payload .agent/permissions.json`、`sed -i ... .agent/...`、`python -c "open('.agent/...','w')..."` 都不产生 `>`/`>>` 操作数，因此 `assertNotAgentArea` 根本看不到目标，命令照常 spawn。同一缺口也绕过判卷面：`judgeTargetsOf`（autonomy.ts:392-405）只读 `args.path` 与 `apply_patch.patch`，`run_shell {command:"sed -i ... tests/todo.test.ts"}` 的 targets 为空、unreadable=false，`frozenJudgePaths` 的 L0 检查（autonomy.ts:462-489）直接放行。auto/guided 无审批卡，full-access 更是 approve；sandbox 只把写入限制在 workspace 子路径内，`.agent` 与判卷文件都在该子路径内。
- fix: 为 shell 建立独立的写目标提取（`invocations` + 重定向 operand + 常见 `tee/cp/mv/install/sed -i` 形态），对 `.agent` 与 `frozenJudgePaths` 逐目标硬拒，认不出目标时 fail-closed；或在 Seatbelt profile 中直接 `deny file-write*` `.agent`（保留内部快照例外）与冻结文件 literal/subpath。

### 45. shell 家族绕过敏感路径读取审批
- area: core | severity: high | effort: medium
- file: src/permissions/risk.ts:255
- problem: 文件面的 `pathRisk` 只对 `PATH_TOOL_NAMES`（read_file/grep/glob/write_file/edit_file）和 `apply_patch` 生效；run_shell / shell_rw / shell_ro 只走 THREAT_TABLE（`hasThreatTableSurface`），而 shell_ro 还在 `hasThreatTableSurface` 早退。结果 `run_shell {command:"cat .env"}` 的 risk 是 none，auto/guided 的 writeAsk=false 直接 L4-pass；worker 的只读 `shell_ro` 静态白名单允许 `cat`/`grep`，read worker 无审批即可把 `.env`、`.git/config`、`.npmrc` 等读进模型上下文。对于 `read_file` 同一路径会因 pathRisk 变成 high 并出卡，两条出口结论相反。
- fix: 让 shell 命令的目标 token 走同一张 `SENSITIVE_PATH_SEGMENTS`（读和写都判），在 evaluate 里把 `cat .env`、`grep ... .git/config` 抬到 high/ask；`shell_ro` 至少拒绝绝对路径与敏感路径 token。只读 worker 不能以“命令名只读”代替“参数只读”。

### 46. verify 信任指纹绑定的是 pnpm run 启动串，不是实际 package.json 脚本
- area: core | severity: high | effort: medium
- file: src/agent/verify-trust.ts:109
- problem: verifySurfaceFingerprint 只把 `config.lint` / `config.test` 的字符串数组、provenance 与 timeout 入指纹；而 `loadVerifyConfig` 对 package.json 探测面返回的是固定的 `pnpm run lint` / `pnpm run test`，不是脚本正文。用户批准一次 `pnpm run test` 后，仓库把 `package.json` 的 `scripts.test`（或 `pretest` 等生命周期脚本）改成 `curl ... | sh`，指纹不变，`isTrusted` 仍命中，verify/diagnose 自动执行新脚本且不再出卡。信任卡文案“命令面一改就重新出卡”对这一来源是假的。
- fix: 对 `repo-probed` 来源把实际解析到的 `package.json` scripts（含 pre/post lifecycle）纳入指纹，或改为按 package.json 内容/脚本摘要绑定；最稳妥是每次自动执行前重新确认启动器解析结果，不能只信任启动串。

### 47. deny 规则可被反斜杠换行和 ANSI-C 引号绕过
- area: core | severity: high | effort: small
- file: src/permissions/rules.ts:195
- problem: splitCommandChain 在权限层直接按裸文本的换行拆分，而 bash 会先删除 `\` + 换行再执行。`git push \\n--force` 被拆成 `git push \` 与 `--force` 两段，既不以 `git push --force` 开头，也不形成 `commandForms` 的候选；`judgeChain` 对 deny 规则返回 miss，随后 auto/guided 档按 L4-pass 放行（default 档也只是问一次，用户手写的 deny 没有生效）。`normalizeCommandForMatch` 只处理 `$IFS` 和三个固定的 `$'...'` 转义，`git push $'--force'` 会被 tokenize 成 `$--force`，同样漏过。
- fix: 在 split/tokenize 前先按 bash 规则折叠 `\` + 换行、处理 `$'...'` 的 ANSI-C 转义（或对含这些构造的命令强制 ask）；不能只依赖 `normalizeCommandForMatch` 的 `$IFS` 特例。

### 48. action fusion 执行仓库 lint 命令未过 verify 信任门
- area: core | severity: high | effort: medium
- file: src/agent/action-fusion.ts:71
- problem: 开启 `settings.actionFusion` 后，每次成功写盘都会由 createActionFusion 读取 `loadVerifyConfig(ctx.workspace).lint` 并调用 `runShell` 执行。它没有 diagnose/verify 的 `authorize`/VerifyTrustResolver：auto/guided 下 `run_shell` 的 writeAsk=false，`pnpm run lint` 的 staticRisk 也不命中威胁表，所以仓库 `package.json` 的 `scripts.lint`（或 `.agent/config.json` 的 lint 数组）在普通写文件后被执行而不出审批卡。恶意仓库只需让用户编辑一次文件即可执行任意代码，即使模型从未主动调用 run_shell。
- fix: 给 createActionFusion 注入与 diagnose 相同的 `authorize`/VerifyTrustResolver，并在每次 lint 前调用；未获信任时跳过 lint 或要求用户批准，不能把仓库配置直接交给 run_shell 门（auto 档的 run_shell 门本身不放行审批卡）。

### 49. Seatbelt 读禁令漏掉应用配置和常见凭据目录
- area: core | severity: high | effort: small
- file: src/main/sandbox.ts:19
- problem: buildSandboxProfile 先写 `(allow file-read*)`，随后只 deny `.ssh`、`.aws`、`.config/gcloud`、`Library/Keychains` 四个 HOME 相对目录。run_shell（auto/guided 档）和 worker 的只读 `shell_ro` 因此可以读 `~/.config/cairn/plugin-data/mcp.json`（用户 MCP 的 headers/API key，user-mcp.ts:15-16）、`~/.claude/.credentials.json`、`~/.codex/auth.json`、`~/.npmrc`、`~/.netrc`、`~/.git-credentials`、`~/.docker/config.json`、`~/.kube/config` 等。读取结果会进入模型上下文和会话 JSONL；worker 只读档没有审批卡，auto 档也不出卡。`sensitive-paths.ts:23-31` 已把 `.npmrc`/`.netrc`/`.git-credentials` 当作敏感落点，两个安全层的口径不一致。
- fix: 扩充 `SENSITIVE`（至少 `.config/cairn`、`.claude`、`.codex`、`.npmrc`、`.netrc`、`.git-credentials`、`.docker`、`.kube`、`.gnupg`），并让 `shell_ro` 对 HOME 绝对路径做同样的拒绝；最好把 sandbox 的凭据目录表与 `sensitive-paths.ts` 的条目做可审计的派生/对账，避免两份列表继续漂移。

### 50. 模型声明的首选思考档被校验后丢弃
- area: core | severity: high | effort: small
- file: src/main/agent-runner.ts:2056
- problem: `validateThinkingEffort` 的返回值没有被接收，`reasoningDefault` 永远不会进入实际请求；只有客户端显式传 `thinking` 时才会生效。
- fix: 捕获 `const effectiveThinking = modelSelection.kind === "demo" ? undefined : validateThinkingEffort(modelSelection.spec, req.thinking)`，并把它传给 `runAgent` 的 `thinking` 选项；同时让 UI 初始选中该默认档。

### 51. Anthropic extended thinking 块从未回放，工具轮会 400
- area: core | severity: high | effort: medium
- file: src/providers/anthropic.ts:106
- problem: 适配器只在事件流里输出 thinking 文本，却既不保存签名也不在后续 assistant 消息中回放 thinking block；开启 thinking 的多轮工具调用无法继续。
- fix: 按 content block index 保存 `thinking` 文本与 `signature_delta`/`redacted_thinking` 数据，并在 `toAnthropicBody` 的 assistant 消息中按原顺序构造 `{type: "thinking", thinking, signature}` 或 redacted block。

### 52. 发现到的 OpenRouter 价格在 provider 草稿中丢失
- area: core | severity: high | effort: small
- file: src/providers/provider-draft.ts:211
- problem: `DiscoveredModel.priceInPerMTok/priceOutPerMTok` 被解析后从未消费，`mergeDiscoveredWithCatalog` 只取目录里的 `s.model.pricing`，导致发现的模型没有价格、美元闸失效。
- fix: 目录没有定价时用发现值构造 `{ inputPerMTok: m.priceInPerMTok, outputPerMTok: m.priceOutPerMTok }`，并把价格纳入 `anyDiscovery`/`origin` 判定。

### 53. Anthropic 截断的 tool_use 参数先抛错，截断证据永远到不了
- area: core | severity: high | effort: medium
- file: src/providers/anthropic.ts:293
- problem: `content_block_stop` 立即解析累积的工具参数；当 `stop_reason: max_tokens` 截断 JSON 时 `parseArgs` 抛错，后面的 `turnTruncatedEvent` 不会执行，循环看到的是普通 provider 错误。
- fix: 把 tool_call 的解析/冲刷推迟到 stop_reason 已确定之后，或先产出 `turnTruncatedEvent` 再 fail-loud 解析；与 `openai.ts:430-445` 的既有顺序保持一致。

### 54. ACP stdio 按块解码 UTF-8，跨块字符会损坏
- area: core | severity: high | effort: small
- file: src/interop/acp-stdio.ts:45
- problem: `readFrames` 对每个 `Uint8Array` 分块单独执行 `toString("utf8")`，多字节字符一旦跨 pipe/流分块就被替换为 U+FFFD，JSON-RPC 帧解析失败。
- fix: 使用一个跨 chunk 的 `TextDecoder("utf-8")` 并以 `{ stream: true }` 解码（或 `string_decoder`），不要对每个 Buffer 单独调用 `toString`。

### 55. 自定义 provider 的读写被钉在启动工作区，切换项目会写错文件
- area: desktop-code | severity: high | effort: medium
- file: apps/desktop/src/main/index.ts:1356
- problem: `.agent/providers.json` 是工作区级配置，但 `providerSave`/`providerCustomList` 使用启动时捕获的模块级 `workspace`，而不是当前窗口的 `workspaceContext()`；切换项目后保存会写到旧项目，启动时也只装载旧项目的 provider。
- fix: 两个 handler 都用发起 IPC 的窗口工作区（`workspaceContext() ?? resolveWorkspace()`）；`setWorkspaceContext`/窗口选择时重新 `loadCustomProviders` 并 `installCustomProviders`，避免 registry 继续持有旧工作区的 provider。

### 56. OpenAI 非流式 200 错误体被当成成功空回复
- area: core | severity: medium | effort: small
- file: src/providers/openai.ts:287
- problem: 非流式分支从不检查 `data.error`：HTTP 200 的错误对象会走完 usage/choices 读取并以 `meterOutcome="ok"` 返回，压缩摘要器只看到空文本。
- fix: 在读取 choices 前检查 `data.error`，按 `retryableStreamErrorFrame`/错误类型抛出带可重试性的错误；同时要求非流式成功响应必须有 `choices[0].message`。

