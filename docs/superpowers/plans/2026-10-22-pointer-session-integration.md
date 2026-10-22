# 产品指针分叉与来源引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ADR 0005 的指针分叉接入 CLI 与生产桌面，同时保住原始行号、旧日志及全部已有操作。

**Architecture:** raw、带 EventRef 的 SessionView、模型协议投影各守自己的语义。先完成新旧引用解释与消费者，最后启用产品指针创建；跨文件压缩不在拼接数组上解释数字位置。

**Tech Stack:** 现有 TypeScript、Node 标准库、Electron/React、Vitest/tsx；不增加运行时依赖，不调用付费模型。

**Spec:** `docs/superpowers/specs/2026-10-22-pointer-session-integration-design.md`（已获业主书面审阅批准）。

## Global Constraints

- `EventRef = { workspace: string; sessionId: string; eventId: number }`，workspace 由可信注册根规范化；eventId 为正安全整数、所属文件的物理行号。
- raw replay 逐字返回原文件；原始游标只定位所属文件；gym 复制原语不迁移。worker 内存序号不解释为主日志行号。
- 新压缩采用 `reference_version: 1`、`compressed_event_refs`、`summary_anchor`、`superseded_summary_refs`；旧数字字段与新引用字段互斥，未知/混合/半套形状失败关闭。
- 父日志不写；父在飞、恢复状态、用量和旧交付不得继承为子当前 run 的事实。源引用不可使用显示位置。
- core 不引入 Electron/UI；renderer state/derived/component 边界保持，源文件上限 1200、App 900；需增长超过帽时先按职责拆出叶子模块。
- 不改冻结 judge/fixtures、不弱化断言、不降低验证要求；源文本 judge 继续读完整 app surface。新回归放新测试文件。
- 只修改/提交本批清单中的自有改动。先完成当前幂等、窗口和搜索修复的验收与独立收口，再以其明确提交为隔离工作树基线；`ab.py` 与另一会话的证据目录不复制、不提交。
- 此计划待审阅。审阅通过后再创建隔离检出并按选定方法实施；本文件不代表新协议已经上线。

## Review Focus

- 旧日志与新引用日志混用时，父压缩不排除子同号事件；Task 2 用相同数字 id 的反例钉住。
- 两个规范工作区同名会话且应答逆序时，队列/运行态/注释不能易主；Task 4/5 用延迟响应钉住。
- 父子 tool-call id 相同，结果不能跨来源配对或合并；Task 2 用真实 adapter 消息结构钉住。
- 父日志改名/删除与新建指针同时发生时，不能留下已成功创建的断链；Task 3 用受控并发临界区钉住。
- 旧摘要已覆盖的内容与新子摘要不能重复注入；Task 2 用多层摘要、裁剪与最终预算钉住。

---

## 文件职责

- `src/events/session-ref.ts`（新）：EventRef/SessionRef 与纯比较、键编码、形状校验。
- `src/events/session-view.ts`（新）：受信根内的来源视图读取、物理映射、分叉点定位；复用 session.ts 的血缘验证，不复制解析算法。
- `src/agent/session-view-context.ts`（新）：来源视图到合法模型消息；原 context.ts 保留本地旧格式入口。
- `src/main/session-repository.ts`（新）：明确 workspace 的会话根/sidecar 寻址及每根 mutation 临界区。
- `src/main/session-dependencies.ts`（新）：父依赖扫描、破坏性 mutation 拒绝；不引入数据库。
- 现有 `events/types.ts`、`agent/compaction.ts`、`agent/prune.ts`、`agent/session-provider.ts`：新增引用格式和生产装配。
- 现有 main handlers、KernelHost、IPC/preload 与 renderer：传播身份和来源；新增叶子模块承担纯键与协议转换，不把 IO 放进 derived。
- 新增的针对性测试与两个真机脚本见各任务；原既有测试保持。

### Task 1: 来源类型与物理视图

**Files:** Create `src/events/session-ref.ts`, `src/events/session-view.ts`, `tests/session-event-view.test.ts`; Modify `src/events/session.ts`, `src/events/index.ts`, `src/events/projection.ts`。

**Interfaces:**
- Produces `SessionRef = Pick<EventRef, "workspace" | "sessionId">`；`eventRefKey(ref: EventRef): string` 使用 JSON 元组，不用分隔符拼接。
- Produces `SessionViewEntry` / `SessionView`（与 spec 同形）；`readSessionView(session: SessionRef, sessionsRoot: string): Promise<SessionView>`。
- Produces `forkPointInView(view: SessionView, round: number): { source: SessionRef; boundaryEventId: number; totalRounds: number } | { error: string }`；round=0 供桌面全量分叉，CLI 正整数限制保留。

- [ ] Step 1：在新测试中建立父 4 行、子 2 行、孙子 1 行的真实 JSONL，断言 `view.entries.map(x=>x.ref)` 保留各文件原行号，`view.localEvents` 与 raw replay 相等；祖先边界截在其 raw 行号。加边界 0、缺失、环、软链越界、同名不同根、坏 EventRef 以及未收尾过滤；保留 worker 域配对反例。
- [ ] Step 2：`pnpm exec vitest run --config tests/vitest.config.ts tests/session-event-view.test.ts --maxWorkers=2`，确认缺能力断言真实红。
- [ ] Step 3：实现接口；让控制投影在保留来源的情况下筛选，而不是筛选后重编号。现有 `replaySession` 继续返回兼容投影，raw API 不变。分叉点选中祖先时返回祖先 source。
- [ ] Step 4：运行新测试及 `tests/session-semantics.test.ts tests/fork.test.ts`；要求原 raw/gym 契约和新视图同时通过。
- [ ] Step 5：只提交本任务文件，记录基线及通过命令；不得提交暂存树之外的残留。

### Task 2: 模型投影、压缩和裁剪的来源语义

**Files:** Create `src/agent/session-view-context.ts`, `tests/session-reference-compaction.test.ts`, `tests/session-reference-provider.test.ts`; Modify `src/events/types.ts`, `src/events/redact.ts`, `src/agent/context.ts`, `src/agent/compaction.ts`, `src/agent/prune.ts`, `src/agent/session-provider.ts` 及其直接编译调用点。

**Interfaces:**
- Consumes Task 1 的 SessionView、EventRef、eventRefKey。
- Produces `projectViewContext(view: SessionView, replacements?: ReadonlyMap<string, string>): ContextMessage[]`，替换键为 eventRefKey。
- CompactionEvent 支持 spec 的互斥新旧联合；共享 trigger/reason/summary/tokens/usage/model/agent_id 不变。来源形式的 `summary_anchor` 为 `{before: EventRef} | {end: true}`。
- `buildSessionHistory(logPath)` 保留公开签名，内部从日志对应的受信 session 根建立视图；`createSessionProvider` 的 assemble 同时保留 local raw 与逻辑模型历史。

- [ ] Step 1：新测试断言：父第 2 行=PARENT_ANSWER，子第 2 行=CHILD_USER；旧子压缩 `[2]` 只排除 CHILD_USER。新来源压缩只排除指定 EventRef；未知/混合/缺字段拒绝。再测父子同 raw tool id 的两组调用/结果，wire id 两组不同、各自一一配对。
- [ ] Step 2：运行 `tests/session-reference-compaction.test.ts tests/session-reference-provider.test.ts`（同 Task 1 的 core 命令和 workers），确认行为红。
- [ ] Step 3：实现来源投影与新格式 producer/validator；压缩输入按来源原子单元取料，旧摘要通过 superseded_summary_refs 取消重复注入。prune 附件按来源域命名；最终预算包含父历史。独立 local raw 的安全/当前轮读数不换成 view。
- [ ] Step 4：补并通过三层分叉的旧摘要→新子摘要→再次子压缩、父后续追加不越界、裁剪附件不跨删、空 tail 末尾锚点、预算拒绝发送的 transport 计数断言。运行现有 compaction/prune/provider/budget 测试及新测试，不修改冻结输入。
- [ ] Step 5：只提交本任务文件。此时仍不启用产品指针创建。

### Task 3: 明确会话根与父依赖保护

**Files:** Create `src/main/session-repository.ts`, `src/main/session-dependencies.ts`, `tests/session-reference-repository.test.ts`; Modify `src/main/sessions.ts`, `src/main/session-handlers.ts`, `src/main/session-liveness.ts`。

**Interfaces:**
- Produces `resolveSessionRef(input: {sessionId: string; workspace?: string}, allowedWorkspaces: readonly string[]): Promise<SessionRef>`：无 workspace 时仅唯一存在可兼容；歧义报错。
- Produces `withSessionMutation<T>(sessionsRoot: string, operation: () => Promise<T>): Promise<T>`，按规范根串行；复用已有锁/忙状态机制，不再另建互相绕过的锁。
- 现有 session-liveness 仅进程内；该统一入口还须用 Node `open(..., "wx")` 在根内持有 `.session-mutation.lock`，覆盖 CLI 与 desktop 两个进程。已占用或崩溃遗留的锁均显式报 busy/需恢复，不凭超时自动删锁；错误提供具体锁路径，不静默假装无竞争。此限制不影响普通读取与对话。
- Produces `dependentSessions(session: SessionRef): Promise<SessionRef[]>`，读取失败抛错；rename/delete 在同一 mutation 临界区中执行依赖检查和动作。

- [ ] Step 1：新测试创建 A/B 同名日志，断言无 workspace 的解析拒绝、显式解析分别正确；祖先有直接/传递子依赖时 rename/delete 拒绝，独立叶子仍可正常操作。
- [ ] Step 2：运行 `tests/session-reference-repository.test.ts`，确认红。
- [ ] Step 3：实现精确根与 sidecar 寻址、依赖扫描、临界区；未知或损坏依赖日志不当成“无依赖”。保持既有 busy 拒绝和排他创建保护。
- [ ] Step 4：受控暂停一次删除检查，同时请求新建指针，断言只能“创建先成则删除拒绝”或“删除先成则创建拒绝”，不允许两者都成功留下断链；再用两个 Node 子进程验证根级排他，及遗留锁报错而不删除。另测 metadata/目标撞名失败后的清理。运行现有 sessions/metadata/liveness 测试。
- [ ] Step 5：提交本任务文件；产品 fork 尚不切换。

### Task 4: IPC、KernelHost 与主进程身份接线

**Files:** Modify `src/main/ipc-protocol.ts`, `apps/desktop/src/main/kernel-host.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `src/main/session-handlers.ts`；Create `apps/desktop/tests/session-reference-host.test.ts`。

**Interfaces:**
- IPC_PROTOCOL_VERSION 从当前 18 升到 19；通道名保持，版本测试和文档中的版本按新协议一致更新，不能只改测试期望常量。
- `openSession(id, workspace?)` 返回现有 `events`（本地 raw）并附 `view`（SessionView）与 `session`（SessionRef）；对仅有旧 fixture 形状的兼容只允许在明确工作区可证明时本地构造，生产响应必须附真实来源。
- fork/revert/compact、rename/delete、队列、annotations 等会话操作补 workspace 传播；保留旧参数入口的唯一归属兼容，内部归一到 SessionRef。接收祖先事件选择的请求增加 `eventRef`，旧 `eventId` 仅定位目标本地文件。

- [ ] Step 1：新 host 测试建立两个注册根的相同 id，显式 open/fork/revert/compact/queue/annotation 调用只接触目标根；无归属且歧义时不执行 mutation。加入晚到应答不改别的根的用例。
- [ ] Step 2：运行 `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/session-reference-host.test.ts --maxWorkers=2`，确认红。
- [ ] Step 3：KernelHost 使用 Task 3 仓库寻址，不读裸 id 的首个 owner；main 从可信 sender 给隐式 workspace，显式参数经已登记根闸；preload 逐字段透传新引用，不代替 renderer 猜来源。
- [ ] Step 4：运行新 host 测试、已有 workspace/open/session-lifecycle/channel/protocol 测试，检查生产每条 mutation 都到正确仓库；运行 typecheck 与 desktop-boundary-check。
- [ ] Step 5：提交本任务。旧客户端通过版本握手失败关闭；所有产品调用仍未启用新指针创建。

### Task 5: UI 来源与会话状态键

**Files:** Modify renderer `state/workbench.ts`, `state/sessions.ts`, `state/session-subscription.ts`, `state/message-actions.ts`, `state/conversation-navigation.ts`, `state/run-queue.ts`, `state/drafts.ts`, `state/app-commands.ts`, `derived/stream.ts`, `derived/timeline.ts`, `components/Stream.tsx`, `components/TimelinePane.tsx`, `components/Sidebar.tsx`, `components/PopoutApp.tsx`, `components/SidechatPane.tsx`, `panes/WorkbenchView.tsx`；Create `state/session-identity.ts`, `derived/event-reference.ts`, `apps/desktop/tests/session-reference-ui.test.tsx`。

**Interfaces:**
- `sessionRefKey(ref: SessionRef): string` 使用 JSON 元组（与 eventRefKey 同族），供所有 session maps/ref/timer 使用；UI 没有可信 workspace 时不写入裸 id 键。
- 行和 TimelineItem 分离 view 顺序与 EventRef；DOM/jump 键使用 eventRefKey，反馈/置顶/回放/回滚事件传来源结构。祖先行标明来源，不能变成当前子 raw 数字 id。
- 初始 view 与实时本地事件合并：实时 event 的物理序号从 production snapshot 的本地 raw 水位推进，不使用合成历史长度。

- [ ] Step 1：新 UI 测试以父子同数字 id、A/B 同 session id 渲染；点击祖先回复反馈与本地回复反馈得到不同 EventRef；时间线跳各自行；切 A→B 后迟到的 A queue/status/feedback 不覆盖 B，旧改名框收起。
- [ ] Step 2：运行 `tests/session-reference-ui.test.tsx`（desktop 命令、maxWorkers=2），确认 DOM/事件断言红。
- [ ] Step 3：实现来源键、props 传播和 map/timer 身份。若 workbench 或 Stream 增长触帽，先把对应状态/动作拆进列出的叶子模块；derived 只收值不读 IO。
- [ ] Step 4：运行新 UI 测试及现有会话导航/队列/stream/timeline/feedback/sidebar/搜索测试；跑 renderer-layer-check。真实 renderer 复验 popout 与主窗同时打开不同项目同名会话时的归属。
- [ ] Step 5：提交本任务；源文本 judge 仍使用 app-surface 全面。

### Task 6: 注释、侧聊与卡片来源持久化

**Files:** Modify `src/main/feedback.ts`, `src/main/pins.ts`, `src/main/session-handlers.ts`, `src/main/sidechat-handlers.ts`, `src/main/card-action-handlers.ts`, `src/agent/sidechat.ts`, `src/events/types.ts` 及 diff 注释直接引用消费者；Create `tests/session-reference-annotations.test.ts`。

**Interfaces:**
- 当前子会话作为注释 store 的 owner；新 feedback/pin 记录存 `eventRef`，旧数字记录按原 owner 解释。list 结果保留来源，UI 不自行丢成 number。
- sidechat promotion/card/diff 的跨来源选择增加引用形式；旧纯本地数字形式继续支持，混合歧义拒绝。既有事件型不增加新 kind。

- [ ] Step 1：新测试在 child 给 parent 行点赞/置顶，重开后 child 能读回来源、parent sidecar 和日志 sha 不变；旧 number 注释仍指向旧 owner。侧聊提升选父来源时内容准确，伪造别工作区或视图外来源拒绝。
- [ ] Step 2：运行新 annotation 测试确认红。
- [ ] Step 3：实现 append-only 新旧形状解析和来源验证；撤销/互斥语义沿用现有 store。卡片审计记下真正来源，不把显示位置写进事件。
- [ ] Step 4：运行新测试及现有 feedback/pin/sidechat/card-action 测试；检查序列化后的重新读取，不只验证内存对象。
- [ ] Step 5：提交本任务。

### Task 7: 来源搜索、回滚与文件恢复

**Files:** Modify `src/main/session-search.ts`, `src/agent/file-revert.ts`, `src/main/session-handlers.ts`, `src/main/change-diff.ts`, `src/events/types.ts`、对应 renderer 结果/动作 props；Create `tests/session-reference-search-revert.test.ts`。

**Interfaces:**
- search match/snippet 附来源 EventRef，结果所属 SessionRef 保留；三态和现有预算选项继续兼容。
- 回滚 planner 消费 SessionView，内部 entries 的 sourceEventId 升级为 EventRef；旧 raw 调用通过明确本地 owner 的适配保留。
- file_restored 仍写当前 child，来源以可选引用字段记录；父 bytes 不变。

- [ ] Step 1：新测试：关键词只在祖先时 child 可命中且结果带 child owner+parent source；超祖先预算 partial、断链 unavailable/partial、thinking 不命中。回滚父轮后 child 再写同路径时拒绝自动覆盖。
- [ ] Step 2：运行新 search/revert 测试确认红。
- [ ] Step 3：搜索复用受信视图读取并计入祖先读取预算；单次请求可缓存已验证前缀。回滚扫描完整有效后续写入，源快照 containment 验证不变，restore 留痕写 child 仓库。
- [ ] Step 4：通过真实临时文件断言恢复后盘上内容、child file_restored 来源与 parent sha；运行现有 search/diff/revert/restore 测试，不能把 failed/partial 折成空成功。
- [ ] Step 5：提交本任务。

### Task 8: 最后启用产品指针创建和回放

**Files:** Modify `src/cli.ts`, `src/agent/fork-cli.ts`, `src/events/session.ts`, `src/main/session-handlers.ts`；Create `tests/session-pointer-product.test.ts`。

**Interfaces:**
- `createProductFork(source: SessionRef, round: number, target: SessionRef): Promise<{session: SessionRef; eventsPath: string}>` 位于 `src/main/session-repository.ts`，使用 Task 1 的 forkPointInView 和 Task 3 的 mutation 临界区，底层复用 forkSessionPointer。
- CLI/desktop 走同一创建服务；CLI replay 输出来源和物理边界，不能把显示序号广告成 raw id。gym 继续 forkSession。

- [ ] Step 1：真实 `bin/cairn.mjs --fork/--from/--replay` 与 production host 的测试断言：初始 child 仅一行、parent sha 不变；嵌套截在祖先轮时 fork 元信息指向正确祖先物理边界。
- [ ] Step 2：新产品测试在当前复制实现上应红，且旧 raw/gym fork 测试仍绿。
- [ ] Step 3：在 Task 1–7 全部完成后切换两个产品入口；创建排他、失败清理对称、unique 命名与继承标题沿用现有规则。
- [ ] Step 4：运行产品/CLI/会话语义测试及 session-semantics-check。验证子没有恢复父在飞 worker、没有重复计父 usage、旧父交付不满足子当前轮交付。
- [ ] Step 5：提交本任务。

### Task 9: 真机、整体验收和文档收口

**Files:** Create `apps/desktop/scripts/session-reference-smoke.cjs`（生产 main + preload + renderer 的临时项目入口）；Modify `scripts/session-semantics-check.ts`、相关协议说明、`STATE.md`（整体重写）、`PROGRESS.md`（只追加新页）；证据仅非 TS 文件进入 outputs。

- [ ] Step 1：先让真机脚本在切换前实现上证明父子历史/来源动作会失败；脚本创建隔离 profile、A/B 同名日志、父/子/孙，拒绝调用模型或外站，错误/超时退出非零并清理其自有临时目录。
- [ ] Step 2：切换后的脚本验证真实 fork→搜索→打开→时间线→反馈/pin→回滚→父依赖拒绝与窗口隔离；断言实际文件、DOM 和重新读取的 sidecar。保存真实截图并目验，不把夹具 handler 当生产贯通。
- [ ] Step 3：统一跑 `pnpm test:capped`、`pnpm --filter cairn-desktop test`、`pnpm --filter cairn-desktop build`、`node --import tsx scripts/typecheck.ts`、边界/layer/docs 及全部相关契约门。记录真实计数/并发/exit；失败定位后只修实际原因，不改判据求绿。
- [ ] Step 4：OCR delegate preview 按该分支 refs 限范围，delegate rule 解析后独立审查整个实现；不用 ocr review/scan。完成所选执行方法要求的独立复核，处理发现再定向验证。
- [ ] Step 5：仅提交本批实现与证据。在确实包含所有改动的同一 commit 上跑隔离的 mutate-verify 和 head-cert-check，再跑 pnpm gates；工作树/HEAD、failed/skipped/UNVERIFIED 明确区分。全量 gate 的旧未证项不能被改名成通过。
- [ ] Step 6：STATE 写清实际启用状态、现行设计/计划与仍需凭据的外部边界；PROGRESS 新页记录本批来源与证据。只在完整验收满足后将本批/总目标标完成。

## 计划自审

- spec 的 raw/视图/模型三面由 Task 1/2 覆盖；身份与生命周期由 Task 3–5 覆盖；既有来源操作由 Task 6/7 覆盖；两个产品入口最后在 Task 8 启用；真实验收与记录归 Task 9。
- 五项 Review Focus 均有明确反例，接口中的 EventRef/SessionRef/SessionView 名称一致；显示顺序不进入写回字段。
- 计划不宣称已完成，任务框均未勾选。新协议实施前还需业主审阅计划并选择执行方法。
