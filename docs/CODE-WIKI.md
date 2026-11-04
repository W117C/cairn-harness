# Core code wiki

This checkout is core-first: the agent kernel (`src/`) is electron-free. The former Electron shell, renderer, preload, desktop gates, and UI acceptance layers were removed on 2026-09-27 (`69fbb0d`); a new desktop shell has since been reintroduced under `apps/desktop/` (2026-10-02, M1 slices). Since 2026-10-12 that shell is **inside** the root gate manifest: `desktop-test` (desktop suite + `desktop-boundary-check`) is listed in both `GATES` and `CERT_GATES`. The [`adr/0001` scope ruling](adr/0001-core-only-vs-desktop.md) still governs **scope** — desktop is not a v1 delivery surface — but "not a delivery surface" no longer means "unscanned"; do not read the scope ruling backwards.

> 定位按**符号名**而非行号（沿用 `docs/m5-proposal.md` v3 修订的纪律：行号会腐，符号名不会）。
> 本文只写**已核实**的事实；未核实的推测一律不写进来。

## Runtime flow

`runLoop` receives a provider and tools, emits append-only events, and applies permission/security policy. Provider adapters live under `src/providers/`; tool implementations live under `src/tools/`; orchestration and recovery live under `src/agent/`.

`src/main/agent-runner.ts` remains as an electron-free application service used by headless checks and core integrations. It must not import Electron or renderer code.

## ① 事件流就是重放契约（改这里等于改兼容性）

真身：`src/events/types.ts`（`AgentEvent` 联合类型，约 42 个事件/载荷接口）；存储引擎
（`replay` / `forkSession` 等）住 `src/events/log.ts`——2026-10-17 拆分，公开面经 `src/events/index.ts` 逐名再导出。

**为什么它是契约而不只是日志**：`replay(path)` 必须能把一份 JSONL 原样读回来，
所以每条事件的字段都是重放面的一部分。三条由此推出的纪律：

1. **落盘前脱敏，但不改编事件形状**。`src/agent/loop.ts` 的 `redactValue` 只换**字符串叶子**，
   非字符串值原样返回——事件形状是重放契约，不能因为脱敏顺手改掉。
   命中即掩码而不是抛错：工具已经跑完、模型已经看过，抛错会吞掉一次真实结果。
2. **「缺席」与「零」不是一回事**，每个可选字段都写明了这一格代表什么。例：
   - `tool_result.exitCode` **缺席 = 这一笔不是跑进程的工具**，绝不等于 0，`null` 才是「进程没起来」；
   - `usage.cacheReadInputTokens` **缺字段 = 该 provider 没上报**，不等于 0，且不得与 `inputTokens` 再相加；
   - `tool_result.blockedBy` 缺席 = 走到了执行面；`tool_result.hold` 缺席 = 没人按住这次扩张。
   把这些缺席读成「零」，会让「没量到」冒充「量到了 0」。
3. **新增能力优先走既有字段的 origin 通道，而不是新增事件类型**。两处先例：
   `user_message.origin` 承载 sidechat 提升与 goal 续跑（`PromoteOrigin` / `GoalTurnOrigin`）；
   `tool_result.gate` 承载全部权限判定留痕。新增一种事件会让每条旧日志的重放都多一个分支。
4. **例外是「日志结构控制记录」**（`docs/adr/0005-log-structural-records.md`）：描述的是**日志本身被怎么了**
   （回退指针、会话元数据更新），不是「agent 做了什么」，也没有 origin 通道可挂。
   这类记录只允许 `session_meta` / `compaction` 那两种既有形状。
   配套三条协议（真身在 `src/agent/session-cursor.ts`、`src/events/session.ts`、`src/agent/submission-ledger.ts`）：
   - `replay()` 保持**笨且逐字**：控制记录原样读回，解释它是**投影**的活（`src/events/projection.ts`）。
   - **分叉是指针不是拷贝**：子会话只写一行血缘（`{parent, boundary}`），不拷父事件，也不继承父的在飞状态。
   - **游标不透明且 fail-closed**：kind 不认、载荷坏、位置越界、session 不对，一律拒——绝不用另一个游标顶上。
   - **提交带 `requestId` 幂等键**：同一个 `requestId` 再交一次，返回既有那次，不把活跑第二遍。

**枚举即事实源**：`TOOL_BLOCK_REASONS`、`HARNESS_HOLD_REASONS`、`GATE_VERDICTS`、`GATE_LAYERS`
都是**运行时数组**（不是只存在于类型里）。理由一致：复跑面按它铺矩阵，
新增一挡而少配一处时，只靠类型系统会在跨模块处漏掉（`HARNESS_HOLD_PROSE_TOKEN` 用
`Record<..., string>` 的穷尽性把这件事变成编译期错误）。

## ② 权限判定：四层固定序，先命中先短路

真身：`src/permissions/autonomy.ts` 的 `evaluate`（纯函数、零私有状态——规则库与放行集是仅有的两个输入源）。

```
L0-hard    硬边界：只读档摘除 + 方案门（deny 位次最前——摘除的工具规则库不能复活）
  ↓
L1-deny    显式 deny 规则
  ↓
L2-ask     显式 ask 规则（任何档位含自主档都绕不过）
  ↓
L3         档位层：L3-rule（规则库 allow）/ L3-scope（会话记忆）/ L3-mode（档位规定要问人）
  ↓
L4         风险层：L4-critical（任何档强制审批，allow 规则也批不掉）
                     / L4-risk / L4-mcp-unannotated / L4-network / L4-pass
```

- **每次判定都留痕**：`GateMeta{layer, verdict, risk?, mode?, scope?, ruleId?}`随 `tool_result` 落流，
  所以「当时判了什么、人怎么答的」可以从事件流回放（读数面：`scripts/replay/gate-outcomes.ts`）。
- **`mode` 宁缺不编**：档位机之外的判定（`X-distill`）没有档位可言，
  编一个就等于把不受档位管的量算进该档的免批率。
- **主 loop 有六道执行前闸**，共用 `TOOL_BLOCK_REASONS`：
  `tool-table`（白名单硬闸，摘表不是劝告）/ `skill-denial`（run 中途动态摘除）/
  `verify-unwired` / `hook` / `permission` / `unknown-tool`。
  ⚠️ 未知工具名是 **fail-closed**（记 `unknown-tool`），与「未知档位取问」方向相反，别改反。
- **沙箱与权限是两道独立的闸**：`run_shell` 在 macOS 走 Seatbelt（`src/main/sandbox.ts`），
  权限层管审批。网络默认全拒，三条同时成立才出网（判为网络类 + 真的问过并获批 + 非无人值守）。
  **没有「网络开关」**：不放行环境变量、不读配置项。

## ③ 编排：worker 生命周期长于父 turn

真身：`src/agent/orchestrator.ts` 的 `Orchestrator`。

会话级编排器在父 turn 收束后**继续存活**——这是审批解耦的前提：
worker 卡在审批上时，父 turn 已经结束，审批应答与取消必须还有路由可走
（`orchestratorForApproval` / `orchestratorForMerge`）。

四个**持有原因**要分清（`HARNESS_HOLD_REASONS`，刻意不并进 `blockedBy`）：

| 列 | 回答的问题 |
|---|---|
| `blockedBy` | 哪道闸拦下了一次**工具调用**（主 loop 六道执行前闸） |
| `hold` | harness 自己按住了哪一次**编排扩张**（成本闸／并发帽／取消／依赖链） |

折成一列就再也不能单独读出「因钱不起 worker」与「因人手不起 worker」。
`ok:false` 同样与 `hold` 不同款：worker 跑挂的回执也是 `ok:false`，而那一格没有 hold。

## ④ 门禁纪律（改任何判据前先读这一节）

- **清单即事实源**：门表在 `scripts/gate-manifest.ts` 的 `GATES`。
  `checkGateManifest` 兜底「scripts 侧无孤儿」——新增 `*-check` 脚本却忘了登记，
  会得到一道**从不运行的门**（历史实例：`provider:check`）。
- **未证 ≠ 通过**：`gates.ts` 的 `countUnverified` / `gateUnverified` 统计未证项；
  `DSH_STRICT_UNVERIFIED=1` 或 `--strict-unverified` 让未证直接判红。
  绿而零输出的门按未证计入——「查了没发现」与「没查」同形。
- **认证面 ≠ HEAD**：工作树可以替 HEAD 遮红（本仓实测过 86 笔提交跑在红灯上）。
  要 HEAD 认证必须在隔离 worktree 里跑整表。
- **恒真式体检**：`scripts/assertion-health.ts` 扫空断言 / `|| true` / 暗卷段零断言 /
  AST 级析取式弱断言。**让门说的话等于门测的事。**
- **反向验证是硬要求**：每条核心判据都要有一条能证明它**会红**的用例
  （`no-progress-check --self-test`、`routing-check` 的 F4 换价对照同族做法）。
- **判据有缺陷 ⇒ 换判据，不许改代码去绕**（见 `BLOCKED.md` 的 `map-self-report` 一例）。

## Desktop renderer 的三个自研底座（2026-10-07 UI 产品化）

桌面端（`apps/desktop/src/renderer/`）的**分层**（2026-10-22 App 拆分批落地）：
`state/`（state-cluster hooks）→ `derived/`（纯投影）→ `components/` ＋ `panes/`（props in, events out）→
`App.tsx`（组合根）。机器面是 `pnpm renderer-layer-check`（它钉：组件层不回流 `App.tsx`、
状态层不 import 组件层、派生层纯、每源文件 ≤1,200 行且 `App.tsx` ≤900 行）。
**判卷读渲染层源码时读整个面**（`apps/desktop/tests/helpers/app-surface.ts`）——
指着一个文件做 `not.toContain` 的断言，代码一搬就空转通过；空转不是通过，是断言被削弱了。

按 spec
[`docs/superpowers/specs/2026-10-07-desktop-ui-productization-design.md`](superpowers/specs/2026-10-07-desktop-ui-productization-design.md)
重排后，有三个"只有一处"的底座，动 UI 前先认路：

- **图标唯一事实源：`components/icons.tsx` 的 `Ic` 表**。16px 网格、stroke 1.5、currentColor；
  组件一律 `import { Ic }`，不许再内联 `<svg>` 路径或用 emoji 当图标（render-structure 判卷
  豁免的 `⚠`/`✓` 字面量除外）。`providerHue(id)` 给 provider 品牌色相（确定性哈希）。
- **markdown 渲染：`markdown.tsx` 的 `parseBlocks`（纯函数，apps/desktop/tests/markdown.test.tsx 判卷）+
  `<Markdown>`**。零依赖、零 `dangerouslySetInnerHTML`（全部 React 文本节点转义，链接只放行
  http(s)）；未闭合围栏按"开放代码块"渲染（流式不闪烁）。样式全部前缀 `.md-*`——不许裸选
  `pre`，会漏进 `.kv pre`（工具行展开体）。
- **粘底滚动：`useStickyScroll.ts`**。`.stream` 有 `scroll-behavior:smooth`，程序化滚动必须
  `behavior:"instant"`（否则高频写入排队成动画、"近底"判定抖动）；「回到底部」浮钮挂
  `.zone-stream`（不挂滚动容器内，否则随内容滚走）。消息重排必须保留 `.row user/assistant`、
  `.toolcluster`、`data-round-anchor` 这些锚——TurnRail 的跳轮/flash 靠 DOM 查询它们。

判卷雷区：`apps/desktop/tests/render-structure.test.tsx` 用 react-dom/server 钉了大量用户可见
字符串与计数（分组头、`标准 · 窗口 128.0k`、`class="check">✓<`、disabled 计数、设置导航六分区
顺序唯一、`<Switch` 恰 3 处、CustomProviderForm 源码级 `allowLocalEndpoint: true`）。重排 UI
先读它，别把钉子当冗余拔了。视觉自查走 `apps/desktop/scripts/ui-gallery.cjs`（离屏 capturePage + 假
AgentApi，不跑真模型、不触发系统录屏权限）。

## ⑤ LSP 的 `languageId` 契约（2026-10-23，第 675 页）

`src/tools/lsp.ts` 的 `didOpen` 必须送**服务器声明的那一个** `languageId`：
`LspServerConfig.extensionToLanguage`（`.py → python`）优先，缺格回落 `defaultLanguageId()`
（六个 JS/TS 后缀 ⇒ `typescript`，其余 ⇒ `plaintext`）。两个入口——宿主 `.agent/lsp.json`
（`loadLspConfig` 解析）与插件 `.lsp.json`（`plugins/index.ts` 的 `activateLsp`）——**都必须把这一格的值带到运行时**；
只传键（当扩展名清单用）而丢值，非 JS 语言的 server 会整条静默失效：六操作无一处出声。

查表按**原样键**，不做大小写归一——静默归一会把"配错了扩展名"藏起来。
判卷：`tests/lsp-language-id.test.ts`（探针 server 把 didOpen 的 languageId 原样交回，判的是真发出去的值）＋
`tests/plugin-lsp-activation.test.ts` 的同名断言。**两个入口各有一条**：只钉一个入口的判据是半个判据。

## ⑥ LSP 的能力协商两头都要用（2026-11-01，第 920 页）

`initialize` 是本框架里唯一一次双方对齐"能说什么话"的机会，**任何一头不用都会静默降级**：

- 客户端发 `capabilities: {}` ⇒ 服务器按最保守形状回包。要 `linkSupport` 才拿得到 `LocationLink`，
  要 `contentFormat` 才保证 `MarkupContent`，要 `hierarchicalDocumentSymbolSupport` 才有嵌套符号表。
  `CLIENT_CAPABILITIES` 只声明**真的消费了**的面——声明了却不实现（如 `didChangeWatchedFiles`）
  等于把服务器引到一条我们不走的路，它据此认为自己的索引是新的。
- 服务器的应答丢掉 ⇒ 看不见 `textDocumentSync` 与各 provider。`openFile` 的 `didChange` 形状必须按
  声明走：`change:2`（增量）只认带 `range` 的编辑，**不带 range 的整篇替换会被沉默丢掉**——于是文档模型
  停在旧文本，六操作回旧结果，看着像"代码没变"，比报错更坏；`change:0` 不接受 didChange，改盘后只能
  didClose+didOpen 重送。`capabilities` 整个为空 = 服务器没报，这时**不门控**（把能用的一支判死更糟）。
- 回传形状按协议允许的三种都收：`SymbolInformation`（带 location）、`DocumentSymbol`（带
  selectionRange，可嵌套）、`WorkspaceSymbol`（**可以只有名字**）。少认第三种就是把一条合法回包
  打成 TypeError。符号 kind 名与 `symbolKind.valueSet` 一律从协议的 `SymbolKind` 枚举派生——手抄表
  是第二事实源，历史教训是它把 25 抄成了 `TypeParameter`（协议里 25 是 `Operator`）。

- **路由与"没答上"是两件事**。`workspaceSymbol` 没有 path 可路由，所以它**必须逐台问**
  （`Object.keys(cfg.servers)[0]` 那种"问排第一的"实现，在多语言仓库里让其余语言的符号静默缺席，
  而模型看到的「无结果」是一个**错答案**——它会判定"这个符号不存在"）。合并结果每条标来源；
  起不来/报错的服务器点名说出来；**一台能答的都没有**时 fail loud，不许退化成「无结果」。
  信任门（pending/declined）不在这里降级成一行注脚——那台的 `ToolError` 原样上抛。

- **状态是第三个面，不是查询的副产品**。`lspServerStatus(workspace)` 一份事实三面读（`lsp` 工具的
  `operation:"servers"`、`scripts/lsp-status.ts`、以后的桌面）。两条口径写死在形状里：
  **读状态绝不起进程**（`getLspClient` 是唯一 spawn 入口，状态面一次都不碰——否则评审 S1 那条
  "默认不预热"从后门破掉，判卷用留痕脚本钉这条）；**没起过的服务器 `providers` 缺格而不是空数组**
  （"还没验过"与"它什么都不支持"是两句话，写成后者模型就信了）。实测能力与 broken 原因存在模块级
  （`adoptedCaps` / `brokenNotes`）而不是只挂在 client 上：进程一掉，那份答案也该还问得出来。
  但它们是**进程内**事实：换进程读同一份工作区只会看到"没起过"。所以 `formatLspStatus` 的头行自己
  把这条口径说在明处（配置与授权跨进程真，运行态不跨进程）；要把运行态也变成可读事实，得落盘并带
  pid 存活判定——别用"读出来一堆没起过"当结论。

判卷：`tests/lsp.test.ts` 的「能力协商」「workspaceSymbol 问全部服务器」「lspServerStatus：状态面」三节，
加 `tests/lsp-status-cli.test.ts`（CLI 面）；stub 的协商开关见 `fixtures/lsp/README.md`。

## ⑦ 进程外的状态：落点与三态（2026-11-02，第 996 页）

第 995 页的状态面读的是**本进程内存**，所以换进程读同一份工作区只会看到"没起过"。把运行态抄到进程外时，
两条让步会直接变成缺陷：

- **状态文件不许落在工作区里**。落在 `<repo>/.agent/…` 意味着它被 clone 携带 ⇒ 一个仓库能自报
  "语言服务器健康"，与 #58/S1 那条"仓库内容决定宿主执行什么"同源。落点照全局账那一族：
  `CAIRN_LSP_HOME ?? ~/.config/cairn/lsp-runtime`，按工作区路径哈希分文件；**指进工作区就拒写**。
  读的时候还要核对文件里写的 `workspace` 与当前一致——哈希撞了或树被搬走时，宁可可缺，不许串号。
- **探活是三态，展示面不许压成布尔**。`src/process-liveness.ts` 只有 `ESRCH` 能证明已退出，
  `EPERM` 算活着，其余 `unknown`。锁那边用 `!== "dead"`（多等无害）；展示面照搬就是把"判不出来"
  报成"现值"，等于新造一盏假绿灯。三档分别是 `disk-alive / disk-stale / disk-unknown`，
  陈旧与判不出来都要在文案里自称陈旧。
- 记录里判活的是**写方 agent 进程的 pid**，不是语言服务器的 pid：本进程内存才是权威，进程一没了，
  它留下的那份实测答案就只是"上次它说过"。
- 写是尽力而为的旁路：失败只 `console.error` 一次，不进 agent 的关键路径，也不进模型上下文。

判卷：`tests/lsp-runtime-state.test.ts`（九条，含"没有实测事实不落空文件""别的工作区的记录不当数"）。

## ⑧ MCP 断线：要么自己回来，要么说清回不来（2026-11-02，第 999 页）

`src/agent/plugins/mcp.ts` 的 transport `onclose` 此前只标失败并摘工具，注释写着"重连入口留位，本轮不自动
重连"——于是 server 崩一次，它那批工具**整个会话**消失。现在它会自己重试（上限 `MAX_RECONNECTS = 2`）。三条
口径别破：

- **重连必须原样重放那一轮握手**：走 `connectOnce`，因此 `include/exclude` 裁剪与 `mcpGradeOf` 分级会重过一遍。
  绕过它去"快速恢复连接"＝把当初被权限面摘掉的工具带回来。
- **状态是三档不是两档**：`connected / reconnecting / failed`。「重连中」不是绿灯（它随时可能变"重连 2 次仍
  失败"），也不是失败；压成任意一档面板就开始说假话。停手时原因必须留在 `error` 里。
- **恢复要恢复到模型那一面**：`onServerDown` 摘工具，`onServerUp` 必须把工具放回注册表**并恢复崩溃前的激活集**
  （`PluginRuntime` 记 `mcpActiveBeforeDown`）。只恢复连接不恢复激活态＝连接绿着而工具看不见，比不修更坏。
  恢复走正常激活入口，超过工具帽就失败出声——重连不是走后门扩容。

判卷：`tests/mcp-reconnect.test.ts`（manager 侧六条）＋ `tests/plugins-mcp.test.ts` 的"重连成功后工具要回到
模型面"（运行时侧一条）。

## ⑨ hook handler 的声明域＝执行域（2026-11-02，第 1000 页）

`src/agent/plugins/types.ts` 的 `HookHandlerType` 写了五档（`command / http / mcp_tool / prompt / agent`），
而 `src/agent/plugins/hooks.ts` 的 `run()` 只认 `command`，其余"本轮不支持，跳过 + 警告"。更糟的是
`HookHandlerDef` 只有 `command`/`timeout` 两个字段——**http 档连 URL 都无处写**：作者写的 `url` 在 schema 层
就被丢掉，钩子在运行时静默缺席。现在按类型判别，兑现的三档真跑，没兑现的两档装载期点名。四条口径别破：

- **一份 payload 契约，三种传输**：`hookPayloadJson` 是唯一事实源；`hookStdinJson` 是它的 stdin 形态，
  http 档的 POST 请求体是它的**同一份字节**。给 http 另起一套字段名，两个通道就会开始各说各话。
- **折叠语义只有一套**：三档的结果一律折进同一个 `HookExecOutcome`（决策 `parseHookDecision`、上下文回注、
  10k 帽与溢出落盘、非阻塞错误）。分档各写一遍必漂。**措辞按传输区分**是另一回事：把 HTTP 503 报成
  「非零退出 503」、把请求中止报成「SIGKILL 强杀」，都是在把两种失败说成一种。
- **闸放在闸的位置**：只读档拒 `http`（网络写同样是副作用）；`mcp_tool` 在只读档只放行标注了 `readOnly`
  且非 `destructive` 的工具——与模型可见面 E6/E6b 同一条纪律。形态校验 `hookShapeRejection` 是装载期
  （`discover.ts`）与执行期（`gateHook`）共用的同一个纯函数，不留第二份规则。
- **裁剪是权限面，不是显示面**：`McpManager.callTool` 现在只认裁剪后的表，表外的名字直接拒。只在建表那一步
  过滤＝任何绕过注册表的调用方（`mcp_tool` 钩子是第一个）都能点到用户明确关掉的那把工具。

去重键也从 `handler.command` 换成了按类型分域的身份：非 command 档从前算出的是同一个 `undefined`，
两条不同的 http 钩子里第二条被**静默吞掉**。

判卷：`tests/plugins-hook-handlers.test.ts`（21 条）＋ `tests/mcp-bounds.test.ts` 的"表外工具调不动"一条；
`src/agent/plugins/hooks.ts` 里未兑现的两档由装载期拒载负责出声，不再依赖运行时那行会被面板刷掉的警告。

## ⑩ prompt 档：把判定交给模型时，纪律必须在接缝上（2026-11-02，第 1001 页）

第 1000 页兑现了三档，`prompt` 仍空着。现在它也真跑：`src/agent/session-provider.ts` 的
`createHookModelCall` 复用摘要器那条 `SessionTransport` 事件折法，但**transport 由装配层给**——
`src/main/provider-assembly.ts` 的 `sessionModelTransport(selection, …)` 是全仓唯一"给一次模型调用取家/取档"
的出口（`createProvider` 与钩子都从它取），绑定点在 `src/main/agent-runner.ts` 里 `modelSelection` 定死之后
（`PluginRuntime.bindModelCall`，晚绑定：`load` 在那之前）。四条纪律：

- **旁路不自己取料**：第 1001 页第一版把注入写在 `PluginRuntime.load` 处并自带 `streamGlm` +
  `CAIRN_API_KEY` 门 ⇒ 用户配的是别家时，钩子要么被"没注入"拒掉，要么把判定发给一个他没在用的家。
  家没配 key ⇒ `hookModelCallFor` 返回 null、不绑，钩子在闸上如实拒（不抛，不拖垮这一场 run）。
- **一份 payload 契约**：送给模型的 user 内容仍是 `hookPayloadJson` 那份字节（stdin / http 体 / mcp args 展开源 / 模型 user 同源）。
- **出站前过 `src/events/redact.ts` 那把唯一的密钥尺**：命中 critical（私钥块一类）**整条不出站**，不是"脱敏后照发"；
  剥了几处必须进可见回执（`notes`），否则读者以为模型看到了原文。
- **半份结论与空白回文都不许当好结论用**：`turn_truncated` 带 stop_reason 进 `notes`；空回文 = **失败**
  （把"没内容"折成"模型没意见"等于钩子被静默放行）。

`agent` 档（子代理型钩子）仍未兑现：装载期按「未兑现」拒载并点名。

判卷：`tests/plugins-hook-prompt.test.ts`（16 条，其中 4 条直接量 `createHookModelCall` 那层接缝，用替身 transport，
不碰网络也不碰 key）。

## Verification

Use the root `typecheck` and Vitest commands. The gate manifest contains only core checks in this checkout.

```sh
node --import tsx scripts/typecheck.ts                                    # tsc --noEmit
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts   # 核心套件
node --import tsx scripts/gates.ts                                       # 全部门 + 恒真式体检
node --import tsx scripts/repo-hygiene-check.ts                          # 仓库体量（取料占比 + 单文件体量）
node --import tsx scripts/repo-hygiene-check.ts -- --self-test           # 反向验证
pnpm mutate-verify    # 变异测试：量的是 HEAD，不是工作树（未提交的改动要先提交）
```

完整优化计划与逐波验收口径见 `docs/optimization-plan-2026-10-02.md`。
