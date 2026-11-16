# Bot 侧对照报告（生成物）

生成于 2026-11-16T08:57:46.685Z｜总判：**pass**

覆盖：12 / 共 12｜partial 0｜out 0｜missing 0

| 能力 | 状态 | 证人 | 边界 |
|---|---|---|---|
| 团队状态的真源可重放（`bot.replay-authority`） | covered | `tests/team-members.test.ts`、`apps/desktop/tests/team-store.test.ts` | 事件日志补丁 + 投影 |
| 成员档案增删改可审计（`bot.member-profiles`） | covered | `tests/team-members.test.ts`、`apps/desktop/tests/team-store.test.ts` | 补丁 + 墓碑 |
| 一轮发言秩序（`bot.speech-order`） | covered | `tests/orchestration-speech.test.ts`、`tests/orchestration-round-arbiter.test.ts` | planRound + 引擎仲裁 |
| 分段与压缩后换段（`bot.segments`） | covered | `tests/segments.test.ts`、`tests/segments-auto.test.ts` | 事件行号 + 自动触发 |
| 成员线程（身份=member:<id>）（`bot.member-thread`） | covered | `tests/team-identity.test.ts` | spawn_agent 带 member |
| 三档记忆作用域（读+写）（`bot.memory-scopes`） | covered | `tests/memory-scope.test.ts`、`tests/remember-member-scope.test.ts` | project/team/member + 作用域过滤 |
| 群里的 @ 路由（点名并行）（`bot.mention-routing`） | covered | `tests/team-mentions.test.ts`、`apps/desktop/tests/team-round.test.ts` | parseMemberMentions（整名匹配/长者优先/认不出进 unknown）+ 群轮次按被点名人成批 |
| 用量按成员归集（`bot.usage-by-member`） | covered | `tests/team-insights.test.ts` | usageByOwner + 跨会话上限 |
| 面板族（成员区/团队/设置）（`bot.panels`） | covered | `apps/desktop/scripts/wallpaper-csp-smoke.cjs`、`apps/desktop/tests/memory-panel.test.ts`、`apps/desktop/tests/team-pane.test.tsx`、`apps/desktop/tests/team-section.test.tsx`、`tests/memory-panel.test.ts`、`tests/team-stream.test.ts` | 成员区/团队/设置/团队窗格 + 群聊共享流（v70）+ 记忆面板（v71，三层主题数/字节，缺层点名） |
| 从 UI 给成员派活（`bot.member-dispatch-ui`） | covered | `apps/desktop/tests/team-dispatch.test.ts`、`apps/desktop/tests/team-pane.test.tsx`、`apps/desktop/scripts/wallpaper-csp-smoke.cjs` | 团队窗格「派活」/「派活并开跑」（后者交给正常 run 通道） |
| 群聊共享流与轮次（`bot.group-chat`） | covered | `apps/desktop/scripts/wallpaper-csp-smoke.cjs`、`apps/desktop/tests/team-group.test.ts`、`apps/desktop/tests/team-pane.test.tsx`、`apps/desktop/tests/team-round.test.ts`、`apps/desktop/tests/team-wave.test.ts`、`tests/team-round-context.test.ts` | 群会话（group=1）+ 共享流 + 轮次（@ 命中即一批，否则轮转）+ **波次**（v76：被 @ 的人顺序跑，每人开跑前重读共享流 ⇒ 后面的人看得见前面刚说的）+ 轮到谁就交给谁开跑 + 带上下文 |
| 密钥按成员申请/授权（`bot.secrets-cards`） | covered | `apps/desktop/scripts/wallpaper-csp-smoke.cjs`、`apps/desktop/tests/member-run-lock.test.ts`、`apps/desktop/tests/team-dispatch.test.ts`、`apps/desktop/tests/team-section.test.tsx`、`tests/team-secrets.test.ts` | 申请卡（pending）→ 人审批（allow/deny 并置终态）→ 起跑前注入（只 allow、只注有值的）→ **串行闸**（v75：一次一个成员，注入窗口不重叠，不串）→ 输出脱敏 |
