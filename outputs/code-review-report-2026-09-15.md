# 代码审查报告（全面检查轮）— 2026-09-15 00:5x

- 仓库：/Users/ze/Downloads/deepseek harness，HEAD bbed562（G-2 结案提交）+ 未提交 M6 接线（pricing.ts 等 18 处脏，审查期间另一进程仍在写入 renderer）
- 方式：三个并行只读审查代理（内核正确性 / Electron 壳与分发 / 完成度对账）+ 主会话实跑门禁与交叉验证
- 排除项：已修的 106 条（outputs/code-review-report-2026-09-13.md）+ H4 的 29 条均不重复报；fixtures/mock、fixtures/todo-app/tests、frozen-sha256.json 冻结判卷文件不在建议修改范围
- 所有发现均带 file:line 证据；本报告未跑测试验证修复，修后需过 pnpm gates

## 1. 总评

- **健康度（实跑证据）**：TERM=dumb pnpm gates 26/26 全绿 + 体检零命中（00:33 实跑，含未提交 M6 接线一起过）；9 项未证如实标注。
- **文档-代码对账**：12 项抽查 11 项「一致」，留位项全部属实（bandit 接线、hourly/monthly、热恢复、license 服务端、遥测都没偷做）；唯一「落后」是 agent_spawned.model 发射了但渲染层不收。
- **最大主题**：**机制完备、入口缺失**——模型路由/bandit/价格表/4 家 provider 全部建好且有测试，但生产里一条都到不了用户（opts.routing 无构造点置 true，routingBandit 是零消费者死设置）。
- **新缺陷 15 条**（P1×5 / P2×3 / P3×4 / 分发 3），集中在 supervise 合并/清理路径与调度/IPC 边界。

## 2. 门禁健康度（主会话实跑）

- 26 道门逐道 exit=0，清单漂移校验通过，恒真式/析取式体检零命中。
- ⚠️ 未证 9 项（不等于通过）：testdino 远程 MCP、provider:check 真拨号、gym-run --model real、routing-check 暗卷、agents-check M 段等——全部卡 M0_API_KEY 缺席，orchestrator.ts:1002-1007 结构性 fail-closed 跑不到真连分支。

## 3. 新缺陷

### 内核（6 条）

| 级 | 位置 | 问题 | 最小修法 |
|---|---|---|---|
| P1 | src/agent/orchestrator.ts:1464-1467 | **supervise accept 后按 toolStats 启发式判「有真实写改动」，shell_rw 写面计数为 0（SIDE_EFFECT_TOOLS autonomy.ts:93）→ 已 accept 的成果走 cleanupWrite("rejected") 静默删光并返回 ok:true；反向 write_file 全失败也计数对空 worktree 走 merge**。功能成功 + 数据丢失，M6 新代码无回归覆盖 shell_rw 写面 | 改用 finishInner:1991-2018 已算出的 diff.files/patch 非空判定 |
| P1 | src/agent/orchestrator.ts:1470-1472 | supervise accept 后合并失败 → rejectRings 连最终环 worktree+分支一起删（cleanupWrite:2175 传 branch → worktree.ts:273 git branch -D），销毁 :2228-2231 刚承诺的「冲突在 worktree 内人工解决」与 gate force-merge 机会 | merge 失败分支 rejectRings 过滤 agentId，保留最终环 worktree |
| P1 | src/agent/orchestrator.ts:1408 | supervise.forbidden 以字符串塞 args.context，parseWorkerContext:2425 对非对象返回 {} → forbidden 全程零落地：提示词不见、工具表不过滤，审批卡却向人展示「forbidden=tests」 | forbidden 映射进 WorkerContext.constraints + stageRole.disallowedTools 过滤工具表 |
| P1 | src/permissions/index.ts:64 | planState 模块级全局（propose_plan.ts:67 写、gates.ts:120/126 写、checkPermission:97 读），RunScope 只隔离 session/orchestrator → 并发 run 互相污染：A 有未批准 plan → 定时/后台 run 所有写工具被 deny；A 批准即解除 B 的写禁 | planState 挂 RunScope（ALS）或改 per-orchestrator 实例态 |
| P2 | src/agent/orchestrator.ts:2173-2174 | cleanupWrite 成功后不清 w.worktree → 失败/取消环被 finishInner 与 rejectRings 各清一次，多落 ok:true「已清理」审计事件（审计失真） | cleanupWrite 尾部 w.worktree = undefined |
| P2 | src/routing/bandit.ts:150-152 | loadBanditState 把「文件损坏」与「首启无文件」同路静默重播种，学习历史无痕丢失（违背 fail-visible 纪律） | 损坏分支区分并落 warn/事件后再重播种 |

### Electron 壳（6 条）

| 级 | 位置 | 问题 | 最小修法 |
|---|---|---|---|
| P1 | src/main/scheduler.ts:472-474 | `void this.tick()` 异步链未捕获拒绝：:610 appendJournalEntry / :617 createEventLog 落盘 IO 可抛无包裹、:539 tickMutex 原样上抛，全仓无 unhandledRejection 兜底 → 一次 journal 写失败（磁盘满/目录被清）主进程整个崩溃 | 两处 void 调用加 .catch(warn)（或折进 TickReport.error） |
| P2 | src/main/index.ts:60-75 | createWindow 无 setWindowOpenHandler / will-navigate 守卫（全 src 零命中）：window.open 默认继承 preload + sandbox:false，导航逃逸即把整套 window.agent IPC 面暴露给远程页——这是 sandbox:false 备案取舍的缓解缺口 | setWindowOpenHandler(() => ({action:"deny"})) + will-navigate 仅放行 loadFile 目标 |
| P3 | src/main/provider-keys.ts:95、src/main/settings.ts:175 | 固定名 tmp（`p + ".tmp"`）并发覆写——S2-11 同类问题修了 memory store 漏这两处 | 同款 .tmp-pid-Date.now() |
| P3 | src/main/index.ts:213 + agent-runner.ts:1139/1168 | D4 残余：card-action/sidechat/plugin:decide 无 null/形状守卫（req=null 直接 TypeError）；handleCardAction 先 emit 落流后校验，非法 payload 进会话 JSONL 审计面 | 边界补同款守卫；校验通过后再 emit |
| P3 | src/main/index.ts:169 | 交互 run 无取消/超时入口（preload 无 cancel 通道，card cancel 仅限 worker :1225）；网络停滞有 stallGuard 兜底故仅 P3 | 新增 ipc cancel 通道 → AbortController 注入 handleAgentRun |
| P3 | src/main/agent-runner.ts:1243-1248 | handlePlanDecide 对 settle=false 也落 plan_approved 事件 → 陈旧/重复/未知 callId 在 JSONL 留「已批准」假记录（实际未解锁） | ok=false 跳过 emit（或事件带 settled 字段） |

### 分发/更新缺口（3 条）

1. **打包产物缺执行面**：实测解析 dist/mac-arm64/M0 Agent.app/app.asar——fixtures=0、vitest=0，而构建产物硬编码 WORKSPACE=<asar>/fixtures/todo-app 与 VITEST_DIRECT=<asar>/node_modules/vitest/... → 交付包里一切 run（含定时无人值守）默认落在不存在的工作区。需 workspace 选择器或显式声明「验收包边界」。
2. **license 测试公钥**：src/main/license.ts:16 内置公钥即测试密钥对（:13-14 自述），真实分发前必须换公钥并作废测试签发链，否则持测试私钥者可签有效 license。
3. **下载页白名单放行 http**：src/main/updater.ts:159 允许 `http:` 且 manifest 无签名校验——D5 只收紧了拉取侧（https+1MB 帽已实装），更新源被劫持仍可导去 http 钓鱼页。建议 openExternal 收 https。

### 已核缓解到位（不立项）

prod CSP 硬化实测生效（构建产物无裸 ws:）；preload 31 具名方法无 ipcRenderer 泄漏；会话/记忆路径 whitelist 实读确认；safeStorage 双后端 fail-closed；Seatbelt realpath 纪律完整（real() 覆盖 writableRoot/homedir）；will-quit 组杀 tracked+LSP；renderer 零 dangerouslySetInnerHTML/window.open；M6 in-flight renderer diff 为纯样式改动零安全面。

## 4. 完成度对账（12 项）

| # | 模块 | 文档声称 | 代码实际 | 判定 |
|---|---|---|---|---|
| 1 | bandit 运行时接线 | m5 B6 留位 M6 | settings.routingBandit 仅定义/持久化（settings.ts:48,68,124,155）零消费者；updatePriced 仅 scripts/routing-check.ts:295 与测试调用 | 一致（留位属实） |
| 2 | 静态路由产品入口 | m5 B3「编排器接入已证」 | opts.routing（orchestrator.ts:617）缺省 false，全 src 无构造点置 true ⇒ 生产连静态路由都不可达 | 一致但需知：已证仅在 opt-in 注入下成立 |
| 3 | supervise 接线/环合并 | m5 C4 已证；扩展留位 | spawnSupervise:1341 + 审批双轨:1361 在；只合并最终环（:1462 不建合并塔） | 一致 |
| 4 | hourly/monthly kind | plan §12.2.1 V1 四 kind | 数据模型七 kind（automations.ts:11）+ croner 计算已支持（scheduler.ts:211,217）；FORM_KINDS 四 kind 双拒（automations.ts:14 + agent-runner.ts:691,697） | 一致（计算层就绪，开闸即用） |
| 5 | worker 热恢复 | m3 九.3 明文不做 | orchestrator.ts:790 重派=全新 agent_id | 一致 |
| 6 | license 服务端 | m4 离线 Ed25519 | license.ts 107 行零网络 | 一致 |
| 7 | 遥测上报 | m4 无上报通道 | 仅 settings 布尔 + UI 开关（main.tsx:706-725 自注 V1 无上报通道） | 一致 |
| 8 | 签名/公证 | m4 unsigned 边界 | electron-builder.yml:25 identity: null | 一致 |
| 9 | 档位/价格校准 | m5 C5=M6 占位 | pricing.ts:3-4 自注占位；providerInfo 硬编码 GLM/mock（agent-runner.ts:1440-1443）——BYOK 存了 4 家 key 设置页也不反映 | 一致（占位属实） |
| 10 | 真连拨号暗卷 | 未证 9 项 | orchestrator.ts:1002-1007 无 key fail-closed 拒 spawn | 一致 |
| 11 | spawnRace 无入口 | H4 有意备案 | 仅 orchestrator.ts:809 + supervisor-check.ts | 一致（有意保持） |
| 12 | agent_spawned.model 渲染 | 文档未声称 | orchestrator.ts:1115 填 model，renderer agent-card payload（main.tsx:206-220）不含 model ⇒ 用户看不到 worker 用哪个模型 | **落后**（展示面，轻） |

## 5. 建议新增模块/能力（6 条）

1. **P0 路由/多 provider 用户入口**：把「会话/任务级选 provider+档位 + routingBandit 开关」接进设置与会话创建。机制全建好但产品零入口，是 M5/M6 产生用户价值的最后一步。
2. **P0 worker 卡显示 model 与真实 usage**：agent_spawned.model 已发射无人渲染，一处 payload 改动闭合；多 worker 场景用户最关心「谁用什么模型花了多少钱」。
3. **P1 hourly/monthly kind 开闸**：FORM_KINDS 放行 + 表单联动字段 + 校验断言补齐，纯开闸不做新机制；「每小时/每月 1 号」是自动化刚需。
4. **P1 supervise 失败环产出喂回**：前序环全弃（orchestrator.ts:1462）、lastFailure 只带 300 字符（:1493）→ 多环失败 token 成本翻倍；retry 时喂前环 report/diff 摘要，不改合并语义。
5. **P2 macOS 签名+公证**：unsigned 首开右键是对外分发第一屏流失点（商业化必经，连带换 license 公钥）。
6. **P2 真连凭据轮**：9 项未证全卡 M0_API_KEY 缺席；key 在场跑 TERM=dumb M0_API_KEY=<key> pnpm gates 即闭合，零代码改动。

## 6. 现在的难点

1. **凭据缺席墙**：9 项未证 + 档位「token 用量降 ≥20%」校准全部卡 M0_API_KEY；无 key 环境 these 永远「未证 ≠ 通过」。
2. **工作树并发写入（正在发生）**：审查期间 00:31→00:37 脏文件 13→18，renderer 三文件 00:37 仍在被另一进程写——提交/审查/门禁都可能与 in-flight 改动撞车（G-1 并发隔离机理未证继续挂）。
3. **3 条待确认挂项**：worktree index.lock 缺并发复现入口 / sandbox 取消收杀本机走降级分支 B / fh.read 短读缺真实短读源。
4. **无签名公证**：分发链第一屏流失 + license 测试公钥不能对外。
5. **机制-入口断层**：路由/bandit/pricing/spawnRace 全部「测试可证、用户不可达」，下一里程碑的主矛盾不是能力而是接线。

## 7. 建议修复顺序

1. 先修 P1×5（supervise 丢成果/合并自毁/forbidden 落地/planState 隔离/scheduler 崩溃）+ 各补一条回归断言——约半天；
2. 再修 P2×3 + P3×4 + 窗口守卫（P2）——约半天；
3. 分发三项：license 换钥与 updater https 是小改，打包 WORKSPACE 需产品决策（工作区选择器）；
4. 全程另进程在写树：提交前 git status 复核，勿混入 in-flight 文件。

## 8. P1 修复轮实录（2026-09-15 01:1x–01:4x，已收口）

**改动 10 文件**（全程只读审查其余；orchestrator.ts 与并发会话的 M6 接线同文件不同区块）：

1. **supervise 丢成果（P1）**：accept 判定从 toolStats 调用计数改为 finishInner 的 worktreeDiff
   `files_changed`（orchestrator.ts accept 块）——shell_rw 改动不再被静默清理，失败写入不再误触发合并。
2. **merge 失败自毁现场（P1）**：合并失败只 reject 前序环，最终环 worktree+分支保留（冲突卡/gate
   force 合并仍可达），返回文案改为「worktree 已保留」。
3. **forbidden 零落地（P1）**：双层——提示词层 constraints 进 WorkerContext（buildWorkerSystemMessages
   渲染）；强制层 accept 时 diff ∩ forbidden（globIntersects）判违反，注入 fail 走既有有界决策机
   （maxStages/防死循环兜底不变，报告 verdict 不采信）。注：forbidden 语义是禁改路径（A3/E1 用例），
   审查原建议的工具表过滤不适用，已按实际语义改为路径面强制。
4. **planState 跨 run 污染（P1）**：permissions 挂 run 级 ALS（enterPlanRunScope 与 RunScope 同点接线；
   runWithPlanScope 供测试/工具）；解锁从 gates.ts settle 移到 propose_plan 工具内（决议处理器不在
   run 异步链，谁的 plan 谁解锁）。run 外遗留路径回落模块态，脚本/测试行为不变。
5. **scheduler tick 崩主进程（P1）**：新增 tickGuarded（void this.tick 两处调用就地 .catch 走 onWarn）；
   手动 tick 的 await 拒绝语义不变。

**回归断言**：supervisor-check E 段 +12（E6 shell_rw-only 改动→合并落盘+成果真实落盘；E7 forbidden
触碰→verdict 不采信→有界中止+零合并+constraints 可见，60/60）；permissions.test 并发 run 隔离 ×2；
plan-gate.test run 内解锁/模块态不动 ×1；schedule.test tick 拒绝护栏 ×2。

**验证**：typecheck 干净；相关单测 100/100；supervisor-check 60/60；全量门禁 **25/26 绿 + 断言体检
零命中**——唯一红 map-check 为环境并发问题（并发会话 01:12 起的 codegraph daemon socket 被 map-check
临时区拷贝撞上，与本次改动无关，已按判卷纪律记入 BLOCKED.md「G-1 首个实锤机理」，不改判据不碰 daemon）。

## 9. P2/P3 + 壳修复轮实录（2026-09-15 01:5x–02:0x，已收口）

**改动 9 文件**：

1. **cleanupWrite 双清审计失真（P2）**：removeWorktree 成功即 `w.worktree = undefined`——失败环不再被
   二次清理出重复「已清理」事件；失败路径保留句柄供重试（orchestrator.ts）。
2. **bandit 损坏静默重播种（P2）**：loadBanditState 区分 ENOENT（首启正常）与损坏（经 onCorrupt 可选
   回调显式告警），学习历史丢失不再无痕（bandit.ts）。
3. **窗口导航/弹窗逃逸面（P2）**：createWindow 加 setWindowOpenHandler(deny) + will-navigate 仅放行
   本应用 renderer 目标（pathToFileURL 精确比对）——sandbox:false 备案取舍的缓解缺口闭合（index.ts）。
4. **固定名 tmp 并发覆写（P3）**：provider-keys.ts / settings.ts / bandit.ts 三处对齐 scheduler.ts:147
   同款 `.tmp-pid-时间戳`（S2-11 同族收尾）。
5. **IPC 边界形状守卫（P3）**：agent:card-action（handleCardAction 顶部必备字段校验，先于落流）、
   plugin:decide、agent:sidechat-ask 三通道 D4 同族 fail-visible 拒绝；路由级失败仍照常落流（审计语义）。
6. **plan_decide 假批准记录（P3）**：settle=false（陈旧/重复/未知 callId）直接返回，不再落
   plan_approved 事件（agent-runner.ts）。
7. **交互 run 无取消入口（P3）**：新增 agent:run-cancel 通道 + preload runCancel + AgentApi.runCancel；
   runAgent 内建 AbortController（interactive 限定），信号沿 runLoop 轮界/门等待/长驻工具透传；
   run 收束即摘句柄，unattended run 取消仍归超时闸。

**留位（需 owner 决策/密钥材料，本轮不修）**：license 测试公钥更换（需真实密钥对）；打包产物
WORKSPACE 硬编码（需 workspace 选择器产品方案）。

**判据立案（不改代码）**：updater isSafeExternalUrl 的 http 放行被两处冻结判据锁定
（tests/updater.test.ts:87 + commercial-check B6），按判卷纪律记入 BLOCKED.md「下载页白名单 http
放行判据」待裁决。

## 10. 分发留位处置实录（2026-09-15 02:1x，已收口）

**① license 测试公钥轮换（分发缺口 2，已修）**：重新生成 Ed25519 密钥对，LICENSE_PUBLIC_KEY 换新
（license.ts），旧测试签发链作废（旧钥签发的 license 一律 invalid）；新私钥落
.tmp/license-test-private.pem（gitignore，mode 600）。安全边界如实声明：正式发行前应由发行方自行
重新生成（.tmp/license-keygen.ts 现成）并把私钥移出本机。判据零破坏：license.test 16/16 +
commercial-check 45/45（license 段本就自带 keypair 注入，A3 还专门断言内置公钥验不了外来签名）。

**② 打包 WORKSPACE 缺失 fail-visible（分发缺口 1，最小修法落地）**：打包启动时
app.isPackaged 且 fixtures/todo-app 缺失 → dialog.showErrorBox 显式告警（run/定时/verify 不可用），
不再静默落空；workspace 选择器仍留产品决策（index.ts）。

**环境注记**：并发会话 02:12 起新增 src/agent/impact/ 半成品（import '../events' 坏路径）——
typecheck 全仓红点唯一落在此文件（非本轮改动，不处置）。本轮验证：license.test 16/16、
commercial-check 45/45、typecheck 本轮文件零错误。

## 11. 优化轮实录（2026-09-15 02:2x，已收口）

1. **worker 卡显示 model（P0 建议 2，已修）**：agent_spawned.model 早已发射但渲染 payload 缺字段——
   main.tsx agent-card payload 透传 model + AgentCardPayload 加字段 + 卡片标题渲染 model 徽标
   （与 permission_mode 同排）。路由开启后用户可见 worker 用哪个模型。
2. **supervise 失败环 diff 喂回（P1 建议 4，最小落地）**：effectiveReport 尾部追加「已改文件
   （worktree diff）」清单——随 lastReport 进 concatStageTask（8000 帽）拼进下一环任务书，下一环
   不再从零猜波及面；追加在尾部不干扰 parseVerdict 行首锚点。合并语义未动（不建合并塔，符合备案）。
3. **hourly/monthly 开闸 → 判据立案（不偷改）**：schedule-check A6 冻结判据断言「hourly 表单面拒」，
   开闸需同步改 FORM_KINDS + A 段断言 + renderer 表单 + 单测四处（双冻结面），记入 BLOCKED.md 待裁决。
4. **路由用户入口 → 留位 M7（不偷做）**：settings.routingBandit 仍是零消费者死设置、opts.routing
   仍无生产构造点——但 bandit 运行时接线是 m5-proposal §1.4 明确留位 M6+ 的项，纪律上不偷做；
   建议作为 M7 候选（与并发会话的 impact 层并列），入口语义（静态路由开关 vs bandit 学习开关分置）
   留 owner 拍板。

**验证**：typecheck 全仓唯一错误仍在对方 impact 半成品（本轮文件零错误）；supervisor-check 60/60、
agents-check 252/252。提交：92eefe8（P2/P3+分发轮）、本轮单独成笔。

**验证**：typecheck 干净；全量门禁 **26/26 绿 + 断言体检零命中**（02:0x 实跑，含本轮全部改动）。
map-check 上一轮的红（codegraph daemon socket 撞拷贝）本轮自愈转绿——BLOCKED.md「G-1 首个实锤机理」
的备案仍成立：该环境抖动与仓库改动无关，daemon 存活期间可复现。
