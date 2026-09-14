# BLOCKED.md（待裁决清单）

## 裁决记录（2026-09-12，M4a 轮备案裁决；此前各轮见下方裁决记录节）

1. **M4a-1「校验走 zod」白名单冲突** → **追认手写严格校验为标准**：主对话核实 automations.ts 校验强度（判别联合 + 顶层与 schedule 内未知字段拒绝 + tests/schedule.test.ts A 段矩阵判卷）与 zod 同等保证；zod 仅是 MCP SDK 的传递依赖（根包不可导入），不为此破轻依赖纪律。后续任务书「校验走 zod schema」一律按「严格 schema 校验（实现形式不限）」理解。
2. **M4a-2 plugins-check F2 非密封抖动** → **采纳「克隆完整性抽查 + 重试一次，仍不完整 → 整段显式未证」**：主对话当轮落地（`--filter=blob:none` 浅克隆可被网络截断成部分检出，曾实测 SKILL.md 31<50 假红；现 MIN_SKILLS=40 抽查 + 失败 rm + 重试一次 + 仍不完整走 unverified 通道，不假红不静默绿）。落地当日即真实触发：网络两次截断 → 30✅/0❌/1 未证 exit 0——按「未证 ≠ 通过」口径在验收表标注。与 F8「不可达 → 未证」同口径。
3. **M4a-3 中断续跑采纳** → **追认**（M3c ③ 同款纪律：干净树基线复测 + stash pop 逐文件审查 + 全量重验；对中断期改动修正断言缺陷 6 处、采纳实现真缺陷修复 2 处的记录充分）。
4. **M4a-4 schedule-check C4 判据先加严后红** → **追认**（沿 M3b J7d「先加严再打红」先例，判据加严非放宽）。

## 立项备案（2026-09-12，H2 轮；**已于 2026-09-13 H3 轮结案**——RunScope 落地见 PROGRESS H3 段 P1，并发验收 tests/runscope + 反向验证实录，验收标准全部满足）

**D-2「run 并发覆写权限态」（审查报告 P1，`agent-runner.ts` 模块级单例）→ 立项待设计，本轮不做**。

定性：`handleAgentRun` 的 `session` / `activeOrchestrator` 等模块级单例在并发 run 下互相覆写——UI 交互 run 与定时 unattended run 并发时，后到者覆盖前者的编排器引用与权限/审批路由面。但**并发定时运行是 M4a 已支持的生产路径**（`scheduleConcurrencyCap` 1–8，schedule-check D 段判卷并发闸语义）：进程级 run 互斥会直接破坏该特性，属「修 A 破 B」，不采纳。

需设计轮：逐 run 上下文对象（RunScope）重构单例态的读写面（session / activeOrchestrator / TOOLS 注入面 / ask·clarify·plan 路由），涉及 `agent-runner.ts`（~1600 行）与 IPC decide 路由；回归面宽（ipc / panels / schedule / agents 四门 + 半托截图）。本轮已落的相邻防护：等人门可收束（A-2）、mode 白名单（D-5）、spawn aborted fail-closed（B-3）。**验收标准建议**：并发双 run（1 交互 + 1 unattended）下审批路由与 state 投影互不串门 + 四门全绿 + 反向验证（摘 RunScope 隔离 → 审批串门复现）。

## 待裁决（2026-09-12，H-1/H-2 门禁自检轮备案）

**背景**：审查报告 `outputs/code-review-report-2026-09-12.md` 的 H-1/H-2 指出「恒真式体检判据面远窄于宣称」与「`unverified` 不影响退出码」。本轮落地时新发现 **2 道永真假门**（旧体检因不识别 `||` 形态而完全漏网），一并备案。

**已落地（不阻塞）**：

1. 体检升级为 **AST 级析取式弱断言扫描**（`scripts/assertion-health.ts`，新文件；`gates.ts` 改为导入 + 再导出，对外接口不变）。规则：断言第一实参的 AST 中**任意位置**出现 `||` 即命中；豁免需显式注释 `// gates:disjunction-ok <理由>`（写在断言行尾或上方 3 行内，**必须给理由**）。抽成独立模块是因为 `gates.ts` 顶层有 `await main()`，直接 import 会跑起全套门禁——抽出去才有单测（`tests/gates-scan.test.ts` 13 条）。
2. `UNVERIFIED=<n>` 机器可读标记（H-2）：`plugins-check` / `compaction-check` 上报，`gates.ts` 汇总上浮；**有未证时禁止打印「全部通过」**；`DSH_STRICT_UNVERIFIED=1` 或 `--strict-unverified` 让未证直接判红（CI / 有凭据环境用）。默认仍 exit 0——离线开发不可用会拖垮日常门禁，但口径改为「断言全过，但有 N 项未证（不得宣称全绿）」。

**已裁决并落地（2026-09-12，本轮）**：

3. **`WORKER_FORBIDDEN_TOOLS` 缺 `shell_rw`**（`src/agent/orchestrator.ts:87`）→ **已采纳建议并落地**。该常量注释写明是「验收断言面」，含 `run_shell` 却不含 `shell_rw`——与 P0-1 同源（按字面名识别、漏 worker 的 shell 面）。已纳入 `shell_rw`（纯黑名单加法；`workerToolSpecs` 的 allow 列表本就不含它，**行为零变更**，但 J7a/J7c 由「碰巧为真」变为名单驱动可失败）。核对并行批次时间线：`orchestrator.ts` 最后修改 16:15，早于 `agents-check` 的 17:32 改动，未再撞车；若并行批次另有该文件改动，git 层会显式冲突而非静默覆盖。

5. **新增门禁清单漂移护栏 + `provider:check` 回归门禁**（本轮补，见 `.tmp/` 基线与 Step 1 汇报）：
   - `scripts/gate-manifest.ts`（新）：GATES 清单抽出为可测模块；`checkGateManifest()` 做 **scripts 侧无孤儿**校验——凡 `*-check` / `*:check` 形态的验收脚本必须在 GATES 或用例化的 `EXEMPT_SCRIPTS`（必须带理由）中，否则 `gates.ts` 在跑门前判红。补上「清单即事实源」缺的反向护栏（原缺口正是 `provider:check` 被静默冷落）。
   - `provider:check` 入列 GATES（原为孤儿脚本）并改为离线自洽：缺 `M0_API_KEY` 时记 `UNVERIFIED=1`、默认 exit 0、严格模式判红——不再因无凭据在离线环境硬红而被排除。门数 22 → **23**。
   - 反例验证：`tests/gate-manifest.test.ts` 覆盖孤儿 `*-check` / `*:check`、GATES 指向不存在 script、EXEMPT 空白理由等形态；`checkGateManifest(实际 scripts) === []` 锚住当前仓库零漂移。

**已裁决（2026-09-12，用户拍板；口径，不阻塞）**：

6. **未证项是否默认判红** → **追认现状**：本地默认宽松——未证项警告 + exit 0，但禁止宣称「全部通过」（`UNVERIFIED=<n>` 机器可读上浮到 gates 汇总）；`DSH_STRICT_UNVERIFIED=1` / `--strict-unverified` 判红，供 CI 与有凭据环境写死。取舍依据：默认严格会让离线开发环境的 `provider:check` / 联网插件暗卷恒红，拖垮日常门禁；未证的可视化（禁止假宣称全绿）已消除宽松口径的失真面。CI 侧接入时须显式开严格模式（写进 CI 配置，非本仓代码）。
4. ~~**plan 事件应否被 `keepFirstSet` 识别**~~ → **已结案（2026-09-12 同轮查清，非 src 缺陷）**：原 `compaction-check.ts:164` 为 `includes(4) === false || !kf.has(4)`，实测 `kf={1,2,3,763}` **不含 4** → 恒为 `A || true`，这道门从未生效。根因是**断言指错了 id**：`eventIdAt(i)=i+1`，fixture 里 plan_proposed/plan_approved 在 index 1/2 → **id 2/3**，而 **id 4 是第 0 轮的 assistant 消息（say）**；763 是中段 user 消息。**`keepFirstSet` 本身正确**（确实保留了 2/3）。已改为按类型推导 plan id 后断言「plan 事件必须被 keep-first 保留」，`compaction-check` 复跑 `UNVERIFIED=0` 全绿。无需改 src。

## M2g 轮备案（2026-09-11 收口执行轮）

无阻塞事项。以下为备案（不阻塞推进）：

1. **环境口径修正**：M2f 备案的「宿主拒 apply 含 deny 规则的 sandbox-exec profile」为 **DSH 宿主特有限制**；收口执行轮实测当前 ZCode 环境 sandbox-exec **可用**（deny profile 正常 apply，`/bin/echo` exit 71 是 profile 正确拒绝 exec——当时把「沙箱生效」误读成「apply 失败」）。终版 gates 三门（sandbox:check / ipc:check / panels-check）走**分支 A 真断言**。AGENTS.md 已改为「按宿主自动选分支 + 输出显式打印走哪支」的口径。
2. **收口补验发现并修复 3 个真缺陷**（均属实现缺陷非判据缺陷，不触发换判据；以四通道真机点击 E2E 为证据，详见 PROGRESS「收口执行轮补验」）：
   ① `agent:run` IPC 把 renderer 传入的 `sessionId` 丢弃（`handleAgentRun(req)` 未转 `over`）→ **UI run 从不落会话 JSONL**、重放恒空、promote 归因断链——M1e 会话模式的接线缝，panels-check 直种 JSONL 的路径未覆盖它；修复 = 按 `RunOverrides` 转交（src/main/index.ts）。
   ② 面板快照**挂载后不刷新**（Sidechat/Memory/Plugins 三面板同款：只在挂载时取一次 getState）——boot 即挂载的面板对 run 期间的变化永久失明；M2f 截图均为「run 后才开面板」故未暴露；修复 = 以 `payload.eventCount` 为刷新信号 + 500ms 防抖 reload（纯投影、零私有状态）。
   ③ 信任卡**运行间隙点击静默失效**（`handlePluginDecide` 无活 runtime 时返回 `{ok:false}`，而 runtime 在 run 结束即回收）→ 补回退路径：按 run 同款配置轻量发现 + 决议落信任文件（下次 load 生效）+ 留档快照同步改写。运行中点击语义不变（D4 同路径）。
   三者皆无单测覆盖（IPC 边界 / renderer 时序），候选后续：给 `agent:run` 的 over 转交补一条 ipc:check 断言。
3. **恒真式体检 3 命中修复**（收口基线复跑发现，与对表文档「零命中」声明矛盾）：plugins-check F8 `assert(true,…)` 空断言 → 真断言（scoped 名形态校验，连接成功分支走到即实测）；gates.ts 两条为体检扫到自己（文档注释 + 日志头含字面模式）→ 剥行内块注释 + 日志头去字面模式。修复后体检零命中、gates exit 0。
4. **测试计数偏差**：对表文档记 286，收口实测 **285**（37 files / 285 passed / 0 skipped，≥ 任务书硬底线 279 ✓）——以实测为准，对表文档已同步。
5. **RV4 说明**：任务书建议的反向验证④「`--force-available` 强制分支 A 而沙箱实际不可用 → 红」在本环境**不可构造**（沙箱真实可用，分支 A 正当通过）；改用同族反向通道 `--bogus-root`（可写根换成不存在路径 → 分支 A 断言①红 exit 1 ✓，还原绿 ✓），同为「分支 A 断言不真空通过」的证明。`--force-available` 通道保留给沙箱不可用宿主。
6. **未证项状态**：testdino 远程 http MCP **实际连接**仍未证（401 需凭据，对表文档保持「未证」标注）；真机 GUI 四通道点击链路截图**已补齐**（docs/m2g-preload.png，2×2 实录 + 逐通道点击断言），对表文档 §五-2 已关闭。

## 裁决记录（2026-09-11，M2f 轮备案九条全裁）

以下为审查方任务书（.workbuddy-ai/taskbook-M2g.md §2）对 M2f 轮九条备案的逐条裁决，按其要求转录进本节；历史原文见下方 M2f 轮备案小节。agent-plan.md 只读不改，本节即裁决记录。

1. **M2f-1 环境限制：三门在 HEAD 基线即红** → **采纳方案 (c)**：M2f 按「15 道门 + 2 道新门全绿 + 3 门环境阻塞备案」记为有效交付，不改历史判据、不改代码绕。**并授权** M2g 给三门加「降级路径断言」→ 已执行（M2g 任务 5：分支 A/B 化 + fail-visible）。
2. **M2f-2 门数口径（自报 18 / 清单 17）** → **追认以括号清单为准**，并**规范**：M2g 起新增 `pnpm gates` 一条命令跑齐全部门并打印清单，**清单即事实源**，任务书不再自报门数 → 已执行（scripts/gates.ts）。
3. **M2f-3 src/preload 不在白名单 → 4 条通道未接线** → **追认现状**（与 M1d/M2d/M2e 同款先例）。M2g **放开 src/preload 白名单**，接通通道并清掉 UI「待接线」禁用注记 → 已执行（任务 4：六条通道 + 注记清零）。
4. **M2f-4 sidechat 会话型 provider 忽略 loop 入参 messages/tools** → **追认**（沿 M2c-2 口径：logPath 为唯一事实源是既定架构前提）。
5. **M2f-5 TERM 环境敏感导致假红** → **判据修正成立，修在脚本里**：e2e.ts / ipc-check.ts 自行剥离 ANSI / 自设 NO_COLOR，不依赖调用者 TERM → 已执行（任务 5）。
6. **M2f-6 edit_file findings 行号相对变更集** → **追认本轮口径**；绝对行号需写前快照，M3 gate 模式若需行级定位再引入。
7. **M2f-7 sidechat 目录布局（sidechats/<id>/events.jsonl，主列表只扫顶层）** → **追认**。主会话列表不被污染是正确取舍。
8. **M2f-8 M2F_SIDECHAT_DEMO 演示通道** → **保留**（env 门控、缺省零行为、不进验收链），并按裁决记录第 5 条整理演示剧本为带冻结 sha 的回归 fixture → 已执行（任务 6：fixtures/demo/** + 独立冻结表 frozen-demo-sha256.json）。
9. **M2f-9 fixtures/security/audit-demo.ts 判卷样例入库** → **追认入库**（仅被 security-check 读取，不进运行路径）。

## M2f 轮备案（2026-09-11）

### 【环境限制·基线不符，需领导裁决】sandbox-exec 受限 → 三道具在 HEAD 基线即红

任务 0 要求「跑十八道门确认基线全绿，对不上就停」。实测**基线对不上**，根因在宿主环境而非代码：

- 本机 macOS 26.6.2（25G83）下，**任何含 `deny` 规则的 `sandbox-exec` profile 都无法 apply**：
  `sandbox-exec -p '(version 1)(deny default)(allow file-read*)' /bin/echo hi` → `sandbox_apply: Operation not permitted`（exit 71）；
  而 `sandbox-exec -p '(version 1)(allow default)'` 正常（exit 0）。即：只允许「纯放行」profile，禁止「收紧」profile。
  （与 WorkBuddy 工具沙箱无关：加 `dangerouslyDisableSandbox` 结果相同；`codesign` 显示应用无 `app-sandbox` 权限。）
- 连锁后果：`src/main/sandbox.ts` 的 `checkSandbox()` 返回 `{available:false}` → `sandboxRisk` 判 side-effect 工具为 high →
  `evaluate` 在 auto 档返回 **ask** → 非交互路径下 `AskGate` 等 60s 超时后拒绝 → 写动作不落盘。
- 受影响三门（**已用 clean worktree 在 HEAD 复现，证明与 M2f 改动无关**）：
  1. `pnpm sandbox:check` — ①工作区内写失败（sandbox_apply 被拒）→ exit 1。
  2. `pnpm ipc:check` — handleAgentRun 的 write_file/run_shell 各等 60s 超时被拒 → 靶子未修复 → 断言②红 → exit 1。
  3. `pnpm panels-check` — B 相 handleAgentRun 同样 60s×2 超时；C 相 Electron 也因宿主拒 sandbox 起不来（`sandbox initialization failed: Operation not permitted`）
     → `phaseElectron` 的 `waitFor 超时`（scripts/panels-check.ts:226）→ exit 1。
     *clean worktree（`git worktree add /tmp/m2f-base HEAD`）复跑结果与工作树**逐字同点失败**（同一行号），M2f 改动不背此锅。*
- 其余十五道门（typecheck / test / e2e / build / fork / gate / autonomy / compaction / tools / map / prune / providers / memory / plugins）
  + 本轮新增 `sidechat-check` / `security-check` 全部 exit 0。
- **请裁决**：这三道门的环境阻塞如何处置——（a）在能跑 `sandbox-exec` 的机器上复跑验收；
  （b）判据改为「沙箱不可用时按降级路径断言」（需改 `scripts/sandbox-check.ts` / `ipc-check.ts` / `panels-check.ts`，本轮不在白名单）；
  （c）本轮按「十五道门 + 两道新门全绿 + 三门环境阻塞备案」交付。
  本轮按 (c) 交付，未改任何判据、未改代码去绕。

### 其余备案（非阻塞）

1. **任务书门数口径**：任务书写「十八道门（六道门 + fork/gate/autonomy/compaction/panels/tools/map/prune/providers/memory/plugins-check）」，
   括号清单实为 6+11=**17 道**（沿 M2e「十七道门」口径偏差同源）。本轮按「17 道 + 2 道新增」逐道跑齐，请追认门数以括号清单为准。
2. **`src/preload/**` 不在 M2f 白名单**：`/promote` 的「按钮」与「composer 命令」两个 renderer 入口、sidechat 面板的提问/提升通道，
   主进程侧（`agent:sidechat-create|ask|promote|state` + `AgentApi.sidechat*` optional 声明）已就绪，
   但 `src/preload/index.ts` 无法加桥接行 → 面板按钮/输入框禁用并注明「通道待 preload 接线（BLOCKED 备案）」。
   与 M1d compact / M2d deleteMemory / M2e pluginDecide 同款先例；放开 preload 后补 4 行即可用。截图已按此现状呈现（docs/m2f-sidechat.png）。
3. **sidechat 会话型 provider 忽略 loop 传入的 messages/tools**（同 M2c 备案 2 的口径）：own 上下文（自身历史 + 主会话只读投影 + @ 引用 + 两层记忆）
   必须在日志投影上组装，loop 拿不到主会话日志，故 `createSidechatProvider` 以 `logPath` 为唯一事实源、忽略入参。请追认。
4. **`TERM` 环境敏感**：本机 `TERM=xterm-256color` 时 vitest 会输出 ANSI 转义序列，`e2e.ts` / `ipc-check.ts` 的
   `^\s*Tests\s+...` 摘要正则失配 → 假红。实测 `TERM=dumb` 全绿。本轮所有验收均在 `TERM=dumb` 下跑（未改判据；建议在判据或脚本里显式 `NO_COLOR=1`）。
5. **edit_file 的 findings 行号口径**：变更集从事件流重建（不引入快照、不用 git diff），edit_file 只有 `old_string`/`new_string`，
   拿不到原文件绝对行号 → findings 行号一律相对**变更集条目自身**（1-based），`SecurityChangeRef.lines` 即该条目行数，
   验收断言「行号落在变更集内」按此口径。若领导要绝对行号，需引入写前快照（本轮明确不做）。
6. **sidechat 目录布局**：主会话仍为 `sessionsRoot/<id>.jsonl`；sidechat 为 `sessionsRoot/sidechats/<id>/events.jsonl`（每会话一目录 = 独立 JSONL 文件组），
   `listSessions` 只扫顶层 `*.jsonl`，故主会话列表不被 sidechat 污染。若领导要 sidechat 也进主列表，改 `listSidechatSessions` 的呈现层即可。
7. **`M2F_SIDECHAT_DEMO` 演示通道**（沿 M0B_SCREENSHOT / M2A_LSP_DEMO / M2B_MAP_DEMO 同族先例）：env 门控、缺省零行为、不进验收链；
   仅用于产出 docs/m2f-sidechat.png。若领导认为应删，删 `src/main/agent-runner.ts` 的 `runSidechatDemo` 调用与函数即可。
8. **`fixtures/security/audit-demo.ts` 是判卷样例**（故意含六类危险 API + 密钥 + 一句「忽略以上指令」），
   仅被 `scripts/security-check.ts` 读取，不进任何运行路径；若领导认为样例不应入库，可改为脚本内联字符串。

无阻塞事项（上述为备案待追认，不阻塞推进）。

## M2e 轮备案（2026-09-10）

1. **任务书门数口径**：任务书写「十七道门（六道门 + fork/gate/autonomy/compaction/panels/tools/map/prune/providers/memory-check）」，括号清单实为 6+10=**16 道**。按清单逐个跑齐 16 道全绿，不多不少；「第十七道」无法对应到任何现有脚本（provider:check 在无 key 时按冻结契约 exit 1，不属「继续全绿」集合）。请裁决：门数口径以括号清单（16）为准。
2. **hook 命令环境变量「只给 PLUGIN_ROOT/PLUGIN_DATA/PROJECT_DIR」的读法**：严格执行「只有三个变量」会导致 hook 子进程连 `node`/`sh` 都无法解析（PATH 缺失），插件生态不可用。按「插件相关变量只给这三个」实现：env = 消毒基础集（PATH/HOME/LANG/TMPDIR/SHELL/USER）+ 三插件变量，且显式剥离含 KEY/TOKEN/SECRET 字样的宿主变量（M0_API_KEY 等）。安全边界（不泄密）保留，可用性修复。请追认。
3. **hook JSON decision「allow」不绕过权限门**：CC 语义 hook allow 可 bypass 权限系统；按任务书「工具进统一注册表、走同一权限门、无特权」让步序（CC 格式兼容 > 纯声明式边界），格式兼容但安全语义从本地：hook deny/exit2 阻断，allow 继续走原权限管线。请追认。
4. **插件信任卡决议通道未接线（preload 白名单外）**：主进程 `plugin:decide` IPC handler 已就绪、`AgentApi.pluginDecide` 类型已声明（optional）；但 `src/preload/**` 不在本轮白名单，桥接层无法加通道。插件面板决议按钮按 deleteMemory 同款先例**禁用并注明**（BLOCKED 备案），未信任不激活的安全语义不受影响（D1–D5 明卷实证）。下轮放开 preload 后接线即可用。

无阻塞事项（上述为备案待追认，不阻塞推进）。

## 裁决记录（2026-09-10，此前各轮备案全部裁决完毕）

以下为管理者对 M0c–M2c 各轮备案事项的逐条裁决；历史原文在本文件下方各轮小节，保留作审计轨迹。agent-plan.md 只读不改，本节即裁决的唯一记录。

### 裁决（含处置）

1. **M2c-1 loop 保留 legacy `{next()}` 分支** → **保留，定位为长期兼容而非技术债**。冻结的 gate-check.ts 永久注入 `{next()}` 形态 scripted provider，该分支是真实契约；scripts/ 只读界限不变，不为此放开。新适配器一律走 stream 分支（M2c 已执行）。
2. **M2c-2 会话型 provider 忽略 stream 入参 messages/tools** → **追认**。EventLog 只 append、logPath 为唯一事实源是压缩/裁剪/符号地图的既定架构前提，会话 provider 从日志重建对话历史正确；中立 messages 形态供无状态适配器（M2c openai/anthropic/gemini 已按此实现）。
3. **M2c-3 key 扫描判据误伤** → **判据修正成立**：扫描类硬判据自此用 `\bsk-`（词边界，消除 AskGate / ask-done 假阳性），`AIza` 与 `api[_-]?key\s*=` 模式不变。本裁决适用于后续所有含扫描判据的任务书；本轮「真实 key 0 命中」的扫描结论维持有效，不因判据缺陷翻案。
4. **M2b-1 web-tree-sitter@0.25.10 无 @types** → **追认**。最小结构类型（局部 interface + 断言）是当前正确做法，DT 出配套 types 后再迁移，不引入 any。
5. **M2b-2 / M2a-3 演示通道（M2B_MAP_DEMO、M2A_LSP_DEMO，连同同族 M0A_MOCK_DELTA / M0B_SCREENSHOT）** → **全部保留**：env 门控、缺省零行为、不进验收链，留作重跑截图/演示的入口。M2 收口任务中把演示剧本整理为带冻结 sha 的回归 fixture；在那之前不删不改。
6. **M2a-1 src/permissions 三行分类改动** → **追认为不违规**：edit_file 是写工具，权限层必须有分类，否则 read-only 档可写、方案门失效——这是任务书界限清单的遗漏而非执行越界。三处分类行 + risk.ts 评级按现状保留，界限争议就此关闭。
7. **M2a-2 M0 旧用例更新** → **追认**：规格演进（行截断 2000 先于 50KB 字节帽）驱动的测试同步，断言强度只增不减，不属放宽。
8. **M1c-2 「最长前缀」vs「deny>ask>allow 固定序」** → **按本轮实现定为规范**：同段多规则命中取最长前缀（其行为生效），同长才按 deny>ask>allow；管线层序 deny→ask 不变。验收④『git push origin main → allow』场景维持绿。
9. **M1c-3 session_kind 记忆键粒度** → **维持现状**：run_shell 按归一化命令全串、write_file 按工具级。路径前缀粒度待 M3 多工作区场景出现真实需求再议，届时只改 scopeKey() 一处。
10. **M1c-4 / M1b-3 verify 不拦于只读/审批面** → **维持**：verify 读为主，toolTableFor 含 verify 不变。M2「产出代码安全 report 模式」落地时统一重审 verify/lint 类命令的门面。
11. **M1c-5 审批卡降档提示走 console.warn** → **维持，归入后续 UI 打磨**。非阻塞；renderer 状态流改造随交互打磨里程碑另开任务，不追补到已收口轮次。
12. **M1a-2 scripts/ipc-check.ts 白名单矛盾** → **追认为不违规**：任务 6 明确要求 ipc:check 扩展为重放验收，脚本改动是任务本身，最小改动成立。界限清单遗漏就此关闭。
13. **M1a-3 / M1b-4 registry 文件后缀** → **规范修正**：含 JSX 的卡片组件一律 .tsx，任务书 `cards/registry.ts` 视为笔误。
14. **M1b-2 verify 配置来源** → **追认**：config.json verify 字段 > package.json scripts 探测；plan.verify 仅展示。需要 plan 覆盖时给 loadVerifyConfig 加入参一层即可，暂不做。
15. **M0c-1 shadcn init 不识别 electron-vite** → **采纳 manual 路线为标准**：手写 components.json（radix-nova）+ `npx shadcn add -y` 产组件，写进 AGENTS.md 约定（已写入）。给上游提 issue 选手自选，不作要求。
16. **M0c-2 反向验证口径** → **采纳机制级证明为验收口径**：strict CSP 约束 dev 内联注入路径；构建产物是同源 `<link>` 文件本就不受 style-src 约束。两类证据均已留存，验收不再要求构建产物样式失效。
17. **M0c-3 AX 窗口枚举失效** → **采纳 CDP 为标准自动化路径**（Runtime.evaluate 真实 DOM 事件 + Page.captureScreenshot）。不再追求稳定 AX 环境；macOS AX 键盘事件仅作现场授权场景的备选。
18. **M0c-4 pnpm-workspace.yaml allowBuilds 占位行** → **已过期失效**：M0b-UI 轮已拍板入库（onlyBuiltDependencies: [electron, esbuild]），现文件内容 `allowBuilds: esbuild=true` + onlyBuilt 随现状追认，门禁全绿即证。
19. **M1a 备案（pnpm-workspace.yaml / pnpm-lock.yaml 去留）** → **追认两文件入库**：前者 M0b-UI 轮已解决，后者为可复现性保留。git rm 议案作废。
20. **M1d-2 preload compact 未接线** → **已解决**：M1e 补上 `compact: () => ipcRenderer.invoke("agent:compact")` 与 renderer 入口（src/preload/index.ts:29 实测在场），本项关闭。
21. **M1d-3 压缩切点纪律 2 实现口径** → **采纳 CC/CL 先例口径为定稿**：全部 user_message 事件进固定回注名单（永不压缩、永在投影可见），tail 保持 clamp 有界，用户输入零丢失。后续若要字面口径（tail 必含最近 user 消息）需重开任务，不接受静默切换。

### 顺手清账

- **AGENTS.md「已知待清理」DARK_QUERY** → **本轮已还原为一行**（`"(prefers-color-scheme: dark)"`，行为不变；全部门禁复跑全绿，无任何判据引用该常量），AGENTS.md 对应条目删除。该串接是 M0c 判据误伤的遗产，正确判据 `^\s*color-scheme:\s*dark` 锚定行首本就不误伤，还原即是回到正轨。
- 各轮已标 ~~已解决~~ 项（M0_API_KEY 三轮、start 脚本、环境怪癖、流式截图）不重复裁决。

## M2c 轮新增待裁决（2026-09-10）

无阻塞事项。全部 7 项任务 + 反向验证红→绿 + 十四道门 + providers-check + 暗卷跳过路径完成。备案三点（非阻塞）：
1. **loop 保留 legacy {next()} 分支**（src/agent/loop.ts + streamFromNextSource）：任务书界限把 scripts/** 全列只读（仅 providers-check.ts 可写），而冻结的 gate-check.ts 向 runLoop 注入 {next()} 形态 scripted provider、autonomy/provider-check 直接 import streamGlm——故 Provider 本体已改为 stream() 统一接口，loop 以「stream 优先、next() 兼容」双形态收敛；新适配器全部走 stream 分支。若领导允许动 scripts/，可删兼容分支（loop.ts 一处 + streamFromNextSource）。
2. **会话型 provider 忽略 stream 入参 messages/tools**（glm-session.ts）：loop 无事件日志读权限（EventLog 只 append），compaction/prune/符号地图组装都在日志投影上；会话 provider 以 logPath 为唯一事实源、沿用构造时 opts.tools（gate-check 冻结契约）。中立 messages 形态留给无状态适配器（openai/anthropic/gemini 直连场景）。
3. **key 扫描判据误伤**：任务书硬指标 grep "sk-|AIza|api[_-]?key\s*=" 命中 7 行，全部为合法标识符 AskGate / ask-done（"As**k-**Gate" 被无词边界的 sk- 模式误伤）。按判卷纪律不改代码绕判据，如实备案：真实 API key 0 命中，建议判据收紧为 \bsk-。半托截图 docs/m2c-providers.png = providers-check 全绿输出（见 PROGRESS.md）。

## M2b 轮新增待裁决（2026-09-10）

无阻塞事项。全部 7 项任务 + 反向验证①②红→绿 + 十二道门 + map-check/prune-check + 半托截图（docs/m2b-map.png）完成。备案两点（非阻塞）：
1. **web-tree-sitter@0.25.10 无 @types**（DefinitelyTyped 无配套包）：parse.ts 以最小结构类型（WtsModule 局部 interface + 断言）声明用到的 API 面；tsc 全绿，无 any 泄漏到图/渲染层。
2. **M2B_MAP_DEMO 演示通道**（沿 M2A_LSP_DEMO 同族备案）：env 门控（缺省零行为）留在 src/main/agent-runner.ts（+M2B_MAP_WORKSPACE 覆盖扫描工作区）；若领导认为应删，删该段即可，验收链不依赖它。截图脚本（.tmp/m2b-screenshot.mjs）用后已删。

## M2a 轮新增待裁决（2026-09-10）
1. **src/permissions 的三行分类改动**：界限原文把 src/permissions/** 列为「只读（只调用）」，但 M2a 新增 edit_file（字符串替换式写工具）必须在权限层有分类——isSideEffectTool（autonomy.ts + index.ts）不认它则 read-only 档可写、方案门失效；toolTableFor 不列它则 read-only 档工具表缺工具。已按最小改动执行（3 处分类行 + risk.ts 一条 medium 评级），全部在「src/agent/**、src/main/**、src/tools/**、src/permissions/**」的字面交集争议内，如实备案：若判违规可整体 revert 这 3 处，代价是 edit_file 退化为 read-only 档可写（建议追加到白名单而不是 revert）。
2. **M0 旧用例更新**：tests/tools.test.ts「60KB 单行→已截断」与新规格「行截断 2000 先于 50KB 字节帽」冲突（单行 60KB 经行帽输出 ~2KB，不再触发字节帽）——已按任务书规格拆成两层断言（单行触发行截断标记、多行 90KB 触发 50KB 帽），断言强度只增不减（新增行截断与字节两层各自独立验证）。属规格演进的测试同步，非放宽。
3. **M2A_LSP_DEMO 演示通道**：截图用的 env 门控通道（缺省零行为）+ 演示剧本 fixtures/lsp/demo-lsp.jsonl 留在仓库（重跑截图的入口）。若领导认为应删，删 src/main/agent-runner.ts 的 M2A_LSP_DEMO 三行 + fixtures/lsp/demo-lsp.jsonl 即可，验收链不依赖它。

## M1c 轮新增待裁决（2026-09-09）
1. ~~M0_API_KEY 缺失 → 暗卷（任务 7）走观察项路径~~ **已解决（2026-09-09 领导提供 key）**：真实 GLM（glm-5.3-flash）在 requires_approval 约定下输出了标记 → 解析映射 high + 管线任何档位强制审批，两断言绿、autonomy-check 全绿 exit 0（暗卷正路径，未动用观察项）。环境教训修正：M0_ENDPOINT 必须是**含路径的完整 URL**（https://api.b.ai/v1/chat/completions）——glm.ts 不自行拼 /chat/completions，裸 v1 根路径会被代理 403 拒（M1a 轮的「M0_ENDPOINT=https://api.b.ai/v1」记法不准）。key 只进当次进程环境变量，全仓字面量 0 命中。
2. **「最长前缀」与「deny>ask>allow 固定序」的取舍**：§11.7.3 同时采纳 Roo「同段取最长前缀」与 Claude「规则特异性不改评估序」，两者在「短 deny + 长 allow 同段命中」场景冲突。本轮按任务书验收④实现为：同段多规则命中取最长前缀（其行为生效），同长才按 deny>ask>allow；管线层序 deny→ask 不变。若领导希望 deny 恒压 allow（特异性无效），匹配函数一行可改，但验收④的『git push origin main → allow』会随之翻红，需先换判据。
3. **session_kind 记忆键粒度**：run_shell 按归一化命令全串（同命令免二次审批，不同命令仍问——出网审计不放宽）、write_file 按工具级（批准一次写 = 本会话写类放行，「此类」语义）。write_file 的粒度偏宽，若领导认为应按路径前缀（更细但记忆几乎不命中），M1c 只改 scopeKey() 一处。
4. **verify 在只读/审批面的位置**（沿袭 M1b 备案 3）：verify 执行 lint/test（读为主），本轮维持不拦；toolTableFor 含 verify（与 gateToolSpecs 同源）。如需 verify 也过 ask，autonomy.ts 的 isSideEffectTool 加一个名字即可。
5. **审批卡降档提示形态**：critical 连拒 3 次的降档提示本轮走主进程 console.warn（审批行内 UI 提示需改 renderer 状态流，归 M1d 设置页一起做）。
## 待裁决（非阻塞，不影响交付）
1. **pnpm-workspace.yaml 的去留**：`pnpm add` 期间 pnpm 11 自动生成（内容仅 ignoredBuiltDependencies: [esbuild]，即任务书"坑一"的官方记录方式）。不在任务书白名单内，故未提交 git；也未删除（删文件属不可逆操作）。建议：领导拍板后 `git add pnpm-workspace.yaml` 入库或直接删除，二选一即可，删除后下次 install pnpm 会重新生成。
2. **pnpm-lock.yaml 已随任务 1 入库**：lockfile 不在白名单字面列表中，但它是 `pnpm add`（任务 1 明确要求）的直接产物，为可复现性随 package.json 一并提交。若不允许，`git rm --cached pnpm-lock.yaml` 即可。

## 背景注记（已解决的环境坑，无需裁决）
- 根目录不允许新建 vitest.config.ts → 改由 package.json 脚本显式 `--config tests/vitest.config.ts`（根 vitest 默认 include 会扫进 oh-src/ 的 772 个外部测试文件）。
- pnpm 11.8 下 tsx CLI 包装吞子进程 stdout/stderr 且丢退出码 → scripts 统一 `node --import tsx`（tsx 官方推荐用法）。
## M0b-UI 轮新增待裁决（2026-09-09）
1. ~~pnpm-workspace.yaml~~ **已解决（2026-09-09 管理者复核）**：坏占位行已清除，文件已入库（`onlyBuiltDependencies: [electron, esbuild]`，electron postinstall 必需）。
2. ~~start 脚本偏离~~ **已解决（2026-09-09 管理者复核）**：实测 `pnpm exec electron .` 正常启动（v44.2.0），start 已改回标准写法 `electron-vite build && electron .`；`pnpm start` 实测起得来。
3. ~~环境怪癖备案~~ **原诊断有误，已更正（2026-09-09 管理者复核）**：`/usr/local/bin/node` 是**真实 Node v24.19.0**（234MB universal binary，`process.versions.electron === undefined`）。pnpm 脚本链内出现的 Electron-as-node（v24.18.1，electron=43.3.0）来自 DSH 自己的 pnpm 运行链，与该二进制无关。**无需清理任何系统文件**；六道门在真实 Node v22.23.2 下复跑同样全绿。详见 `AGENTS.md` 环境注意。
4. **UI 自动化**：拍板否了 Playwright；本轮截图与交互演示改用（a）应用内 capturePage 截图钩子（M0B_SCREENSHOT env 门控）与（b）macOS AX + 键盘事件（需辅助功能授权，已由领导现场授予）。两者均为交付手段，不进验收链。
5. **mock 提示**：UI 发送的任意消息都驱动同一份冻结 mock 剧本（剧本内容与消息文本无关），这是 M0b 的既定边界；真实模型接入后此差异自然消除。
## M0c 轮新增待裁决（2026-09-09）
1. **shadcn init 框架检测不识别 electron-vite 布局**：CLI 只认 vite.config.*（任务书现状说实测成功，本机复现失败——检测代码 chunk-B2MD6U5O.js 只 startsWith("vite.config.")）。已改走官方 manual 路线（手写 components.json + nova token CSS，组件仍由 CLI add 产出，非手抄）。待裁决：接受 manual 路线为标准，或给 shadcn 提 electron-vite 支持 issue。
2. **反向验证前提偏差**：strict CSP 下构建应用样式不失效——Tailwind v4 构建产物是 <link> 同源文件，style-src 'self' 本就放行；坑二只约束 dev 注入路径。机制级红→绿已用构建产物注入内联 <style> 证明（'self' 拦截 / 'unsafe-inline' 放行）。待裁决：验收口径是否改为 dev 模式或机制级证明（本轮两者都留了证据）。
3. **System Events AX 窗口枚举再次失效**（invalid index，授权后一度可用）：UI 驱动与截图改用 CDP（Runtime.evaluate 真实 DOM 事件 + Page.captureScreenshot）。待裁决：是否需要稳定的 AX 环境（影响后续自动化验收方式）。
4. **pnpm-workspace.yaml 曾被外部提交 61a2b94 固化**：本轮 pnpm 又自动追加 allowBuilds 占位行，已按白名单还原。pnpm add 时 ERR_PNPM_IGNORED_BUILDS 警告仍会让 shadcn add 误判失败（重跑即可），根治需 onlyBuiltDependencies 增补或 pnpm 配置调整，待裁决。
5. **组件源码不跟上游**：本轮未改任何 components/ui 生成文件，故无 @shadcn-modified 标记；后续改动时按拍板加标记。

## M1a 轮新增待裁决（2026-09-09）
1. ~~【真阻塞】M0_API_KEY 缺失 → 联网验收无法执行~~ **已解决（2026-09-09 领导提供 key）**：`pnpm provider:check` 真连 exit 0（148 delta / usage 22/754 / tool_call 解析成功 / 151 条事件重放一致）；反向验证 stream:false 红（1 delta，exit 1）→还原→绿（exit 0）完成；docs/m1a-stream.png 已更新为真模型流式版。key 只进当次进程环境变量，全仓 grep 字面量零命中，未落任何文件、未入库。注意：该 key 端点绑定代理（M0_ENDPOINT 必须同传，打默认 bigmodel 端点会 401）。
2. **scripts/ipc-check.ts 白名单矛盾**：任务 6 明确要求「`pnpm ipc:check` 扩展为重放验收」，但界限清单未列该文件（只列了 provider-check.ts / fork-check.ts 两个新脚本）。按任务执行且改动压到最小（import replay + logPath 提取 + 7 行重放比对断言）。待追认；若判违规可整体 revert 该文件，把比对逻辑迁进 src/main（白名单内）。
3. **registry 文件后缀偏差**：任务书写 `src/renderer/cards/registry.ts`，卡片组件含 JSX 必须 .tsx（现为 registry.tsx），功能与验收不受影响。
4. ~~流式截图的演示通道~~ **已解决（2026-09-09 真模型版交付）**：docs/m1a-stream.png 现为真模型（glm-5.3-flash）流式中间态（捕获瞬间气泡 = 「我是Z.ai开发的GLM▍」，模型仍在生成）。mock 演示通道（M0A_MOCK_DELTA=1）保留为无 key 时的演示路径，与真模型共用同一条 delta 合成管线；真模型 UI 通道走 M0A_PROVIDER=glm（env 门控、单轮、无 tools，完整 loop 接线归 M1b）。
## M1b 轮新增待裁决（2026-09-09）
1. ~~【真阻塞】M0_API_KEY 缺失 → 暗卷（任务 6）无法执行~~ **非阻塞，走任务书规定跳过路径**：`pnpm gate-check` 检测无 key → 打印「暗卷跳过（无 M0_API_KEY）」退出码 0，其余断言全绿。暗卷通道已备好（src/agent/glm-session.ts：从事件日志重建 OpenAI 兼容对话历史含 tool 角色反馈回模型；gate-check 暗卷段断言模型至少各调一次 clarify 与 propose_plan + 判卷 sha256 不破）。**领导提供 key 后重跑 `pnpm gate-check` 即自动执行暗卷**（注意 M1a 教训：代理 key 必须 M0_ENDPOINT 同传）。
2. **verify 配置来源取舍**：任务书「verify 配置读 .agent/config.json 的 verify 字段，缺省探测 package.json 的 scripts」已按序实现；propose_plan 的 verify 字段仅作计划卡展示（未作为执行器第三来源）——若领导希望 plan.verify 覆盖 config，M1c 一行改动即可（loadVerifyConfig 加一层入参）。
3. **verify 在 read-only 档不拦**：verify 执行的是仓库自身配置的 lint/test 命令（读为主），权限层按非副作用工具放行；若领导认为 verify 命令也要过 ask，M1c 在 checkPermission 增加 verify 分支即可。
4. **registry 文件后缀**（沿袭 M1a 备案）：registry.tsx 含 JSX 必须 .tsx；本轮新增三个卡片文件同为 .tsx。

## 2026-09-09（M1d 阈值摘要压缩）

1. **M0_API_KEY 缺失 → 暗卷无法执行（任务书任务 6 的 A 路）**。已按任务书规定路径处理：`pnpm compaction-check` 与九道门里打印「暗卷跳过（无 M0_API_KEY）」并退出 0；通道本身已实现并单测（`createGlmSummarizer` 非流式单轮，断言非空/未膨胀/最小进度），key 在场重跑即自动真跑。需要领导在配 key 的环境复跑一次确认。
2. **src/preload/** 不在 M1d 白名单（任务书冻结）**，renderer 无法调用 `window.dshAgent.compact()`（preload 的 AgentApi 不认识该字段）。已按判据处理：`src/main/ipc-protocol.ts` 声明 `AgentApi.compact?`（optional，一行激活点）、main 进程 handler 与 mock 明卷压缩通道就绪；等 preload 白名单放开后加一行 `compact: () => ipcRenderer.invoke("agent:compact")` 即可接通 UI 入口。**不属改判据，仅列清地界**。
3. **切点纪律 2 实现口径需要领导确认（非缺陷，是解释选择）**：任务书「最近一条 typed user 消息永不吞」若实现为「tail 覆盖最近 user 消息」，在 agent 形会话（用户中途一句 + 数百工具轮）会把全部后续事件拖进 tail，压缩失效。已采用 CC/CL 先例口径：**全部 user_message 事件进固定回注名单**（永不压缩、永在投影可见），纪律 2 因此平凡成立且 tail 保持 clamp 有界；用户输入零丢失。PROGRESS.md 坑二十有记录；若领导要求字面口径（tail 必须含最近 user 消息），需重开任务确认.

## M1e 轮新增待裁决（2026-09-09）

无阻塞事项。全部 7 项任务 + 反向验证红→绿 + 十一道门（十道门 + panels-check）完成。过程中发现并修复的两个实现 bug（右栏开关未写 open 映射、panels-check 曾测 out/ 旧 bundle）见 PROGRESS.md「任务结果」条目——均属代码缺陷而非判据缺陷，不触发换判据。

## M2d 轮新增待裁决（2026-09-10）

1. **src/preload/ 不在 M2d 白名单**，两处 renderer→main 通道未接线（main 侧已就绪）：① `AgentApi.deleteMemory?`（ipc-protocol 已声明 optional，main handler `agent:memory-delete` 已挂）——记忆面板删除按钮当前禁用并注明「待 preload 接线」；记忆快照经 getState 透传不受影响。② 外部引用「首次批准对话框」当前为 main 侧回调通道（memoryLayerSnapshot fail-closed 停用 + external-refs.json 落账），GUI 批准入口等 preload 白名单放开后一行接通（M1d compact 同款先例）。均不属改判据，仅列清地界。
2. **反向验证摘除的判据补强**：原 memory-check 只有「顶层 scope 合法 + metadata 混入」用例（B5），摘除顶层检查（改 metadata 兜底）不会红——因顶层在场时本来就赢。已补 B5b「无顶层只塞 metadata.scope」用例后反向验证红→绿成立（判据加严，非放宽）。
3. **BLOCKED.md 无其他阻塞**。十六道门 + memory-check 全绿后随本轮 commit 提交。

## M3b 轮新增备案（2026-09-12）

无判据阻塞。六项偏离任务书的实现决定已全部显式备案于 PROGRESS.md「M3b 偏离任务书的决定」（逐条含理由）：
① 原暗卷段 H 改序 M（新段 H–L 字母让位）；② B1 判据随 write 接入更新为 pipeline 拒绝（断言 79→165 只增）；
③ 评审闭环以「评审重启」承载 done 后评论修正（不属 §4.4.9 崩溃热恢复范围）；④ write worker 文件面/shell 面
独立 auto 档（§4.4.5「worktree 完全可写」的机制化，critical/deny/ask 规则不变）；⑤ diff 本体以子流
tool_result（callId=diff-<id>）承载（零新事件类型、主上下文零泄漏、面板可重建）；⑥ security_report 扩
mode/agent_id/llm_reviewed/suggestion 与 llm_review 类别（可缺省、旧日志零影响）。
另发现并修复 3 个实现真缺陷（agent_id 跨 run 撞 worktree / waitAll 在 write finish 中途提前返回 /
card_action emit 缺 merge 路由回退），均由本轮新增验收断言抓出，判据零改动（PROGRESS 坑五十五~五十九）。
反向验证 4 条红→绿实录见 PROGRESS M3b 段（第 3 条先加严判据 J7d 再打红，属判据加严非放宽）。

## M3c 轮新增备案（2026-09-12）

无判据阻塞。偏离任务书的决定已全部显式备案于 PROGRESS.md「M3c 偏离任务书的决定」（逐条含理由）：
① B1 / tests/agents.test 的 pipeline 口径随本轮接入更新为「缺 stages 解析口拒绝、整链由 N 段判卷」（断言 165→233 只增，M3b ② 同款先例）；
② tests/plugins-discover 的 pendingPlugins 期望随新增 pipeline-crew fixture 由 ["echo-suite"] 扩为 ["echo-suite","pipeline-crew"]
   （任务 3 新 fixture 使插件集合合法增长；「散装 skill 不进 trust pending」的原断言语义不变）；
③ 本轮系中断续跑：上一执行轮在任务 1–7 内核完成后被中断（未提交），主对话以 HEAD 3431e72 重新实测基线（20/20 门 +
   39 files/334 tests + 冻结 sha 3/3）后采纳续作，全部内核/测试改动在续跑轮内重新验证（typecheck + 40 files/357 tests +
   agents-check 233 断言 + 反向验证 4 条），无任何「未验证即收口」的改动。
另发现并修复 2 个实现真缺陷（均非判据缺陷，判据零改动）：parseVerdict 捕获组未归一小写（verdict: PASS 被判 fail，
单测抓出）；pipeline stage 角色解析改批准时冻结（主 run 结束 setCurrentPluginRuntime(null) 后，异步 sequencer 的后环
插件角色 stage 断链，半托演示抓出）——详见 PROGRESS 坑六十~六十一。
反向验证 4 条红→绿实录见 PROGRESS M3c 段。

## M4a 轮新增备案（2026-09-12）

无判据阻塞（判卷文件零改动）。以下备案待裁决，均不阻塞推进：

1. **「校验走 zod」与依赖白名单冲突（偏离任务书 ①）**：任务书 §1/§2.7 要求「校验走 zod schema」，但 §4 白名单限定 package.json 只可加 croner 一个依赖；实测 pnpm 严格布局下 zod 仅作为 @modelcontextprotocol/sdk 的传递依赖存在（node_modules/.pnpm/zod@3.25.76），根包 `import "zod"` MODULE_NOT_FOUND。按「白名单外不写」纪律，未追加 zod，以手写严格校验实现同等 durable 边界保证（顶层+schedule 内未知字段拒绝 / 判别联合 per-kind 字段白名单 / prompt 非空 ≤4k / interval ≥5 / IANA 规范化非法拒绝 / 枚举收窄 / 错误全量返回，tests/schedule.test.ts A 段矩阵判卷）。待裁决：追认手写校验为标准，或授权追加 zod 依赖重写校验层（automations.ts 单点替换面小）。
2. **plugins-check F2 非密封判据瞬时抖动**：本轮全量门禁两次复跑间出现一次 F2 红（实仓 SKILL.md 解析 31 < 50）+ 一次绿（51 ≥ 50）。该断言实时克隆 anthropics/skills 与 claude-plugins-community（`--depth 1 --filter=blob:none`）计数，依赖上游实时内容与网络完整性，红点为部分克隆截断而非本仓代码。待裁决：是否给 F2 增加重试/缓存或降级为「不可达即未证」通道（与 F 段其余联网断言同口径）。
3. **中断续跑采纳备案（M3c ③ 先例）**：本轮任务 1–6 内核为上一被中断执行轮的未提交改动（16 修改 + 3 新增文件：automations.ts/scheduler.ts/schedule.test.ts；未含 gates/schedule-check）。主对话按任务书处置纪律执行：干净树基线复测（20/20 门 + 40 files/357 tests + exit 0）→ stash pop → 逐文件审查 → 续作 → 全量重验。审查修正中断期测试断言缺陷 6 处（月度短月断言问错日期[1月31日本身合法] / catchUp=skip 边界测试漏传 UTC 时区 / 卡死靶漏传 createdAt 使断言空转 / once 决策标签期望错档[启动 tick 补跑=catchup 而非 triggered] / run_now 去重测试用 hang executor 被重叠闸干扰 / sidechat 面板计数未随注册表增长），修复实现真缺陷 2 处（坑六十三/六十四，见 PROGRESS M4a 段）。全部最终改动在本轮重验，无「未验证即收口」。
4. **反向验证暴露的新门判据缺陷先修后红（判据加严非放宽）**：schedule-check C4（occurrenceKey 去重）原断言仅锚错误串，摘除 pipeline 去重后可经「重叠闸 → decideSkip 内层 key 查重」链路误绿——先加严为「错误串含去重 + journal 零增长 + 会话数不变」三重断言，再执行反向打红（实录见 PROGRESS M4a 段）。沿 M3b J7d「先加严再打红」先例。

## M4b 轮新增备案（2026-09-12）

无判据阻塞（判卷文件零改动）。备案两项：

1. **pnpm-workspace.yaml 白名单外必要越界**：任务书白名单未含 pnpm-workspace.yaml，但 `pnpm add -D electron-builder` 引入传递依赖 electron-winstaller 后，pnpm 11 自动追加占位行 `allowBuilds.electron-winstaller: "set this to true or false"`——该坏值使**全部 pnpm 命令**（含既有门的 pnpm test 探针）以 ERR_PNPM_IGNORED_BUILDS 失败（tests/gated-tools.test.ts 两用例假红即此因）。唯一修复 = 显式置 `electron-winstaller: false`（macOS 打包不需要其 Windows 安装器 postinstall）。已由主对话执行、验证（pnpm 恢复 + 两用例回绿）；主对话在 BLOCKED 留此备案备查。
2. **BYOK 真连未证**：可安装包 BYOK 全流程的「真实 GLM 拨号」一跳需要 M0_API_KEY（本机无 key）；存储/解密/注入/设置链路全部已证（commercial-check C 段 + 打包冒烟），真连按「未证 ≠ 通过」标注于 docs/m4-acceptance.md §一-1，key 在场重跑 `pnpm provider:check` 即闭合。沿 M1a-1/M2g 先例。

## 立项备案（2026-09-14，H4 收口轮）

**G-1「pnpm gates 并发运行不保证隔离」→ 待裁决是否立项修**。

实测：同一 checkout 内两会话同时跑 gates，我方一次得 绿 22/26，红 test/e2e/ipc:check/gate-check；
独立 worktree（HEAD）同窗口跑同样 4 门同样红；对方跑完后同一批门单跑全部绿（554 passed / e2e 闭环 /
ipc:check 分支 A / gate-check 全过 / panels-check 全过）⇒ 红不由被测内容产生。

机理候选（未钉死：双跑 gate-check 实测 A exit=0 / B exit=0 不复现，需更长交错窗口）：

1. 共享可变靶子：scripts/e2e.ts:15、scripts/gate-check.ts:26 与 ipc-check 都以 join(ROOT, fixtures, todo-app)
   为活工作区，两个 run 同时重置/改写同一 src/todo.ts 与 tests 视图 ⇒ verify 事件与判卷 sha256 断言互相踩。
   可抄先例：map-check ⓪「工作区为临时副本」（scripts/map-check.ts:36 断言 workspace.startsWith(tmpdir())）。
2. 固定 tmp 路径（跨进程同键）：gate-check.ts:30-31 m1b-gate-events.jsonl / m1b-dark-events.jsonl、
   panels-check.ts:21-22 m1e-panels-*.json、agent-runner.ts:1091 m0b-agent-events.jsonl、:1360 m2e-plugin-data。
   同族前例：本轮之上那条「plugins-check F2 非密封判据瞬时抖动」。

待裁决：(a) 按候选 1 把 e2e/ipc:check/gate-check 的靶子改 per-run 临时副本（改动面 3 脚本 + 判卷 sha256
断言仍成立的核对）；(b) 只做候选 2 的 mkdtemp/pid 化（机械低风险，但已实测不足以单独复现红）；
(c) 只立规矩「一台机器一次只跑一套 gates」。本轮不擅自扩范围，先记账。

### G-1 更正 + G-2 立项（同轮 23:55，判别实验后）

**G-1 更正**：上面把 map-check 红算进「并发争抢」是错的。单跑 map-check 一样红；把 HEAD 拉到
独立 worktree（不含他处 in-flight 文件）跑 map-check **全部通过**。⇒ 该红由脏树内容触发，与并发无关。
G-1 保留的部分：同一 checkout 的两个 run 在逻辑上确实共享 `fixtures/todo-app` 活靶子、`out/` 构建产物
与若干固定 tmp 路径（`gate-check.ts:30-31`、`panels-check.ts:21-22`、`agent-runner.ts:1091/1360`），
但**我没有用它解释任何一次观测到的红** ⇒ 状态记为「机理未证」，不升级为已证缺陷。23:15 的四红同样未定因。

**G-2 立项（判据缺陷，按纪律要求换判据而非改代码绕）**：`scripts/map-check.ts:81` 的 ⑤b
`check("⑤b 结果变化（新符号入图）", after.text !== first.text, "")` 用**渲染文本**是否变化来断言新符号
入图，而渲染受 1024 token 帽截断（①正是这条上限的断言）。实测：索引 235 文件时绿、238 文件时红
（tokens 873/921），红的那次 `⑤改一个文件 → 重算（parsed=1）` 与 `④未改文件 → tags 缓存全命中`
都绿 ⇒ 解析与入图都正常，只有文本比对失败 = **假红**。仓库每加几个文件就会自己踩到，且踩到后
永远回不来（只增不减）。建议二选一（都不动产品代码）：

1. 断言换成「tags/entries 集合含探针符号 `__map_check_probe_symbol_x9`」（查结构不查渲染尾部）；
2. 或把探针注入渲染必然靠前的固定文件（如 `src/agent/map/build.ts` 首位符号），并在①的帽内留水位余量。

待裁决；本轮不改判据（改判据=动冻结面，需 leader 侧确认）。
