# 文档↔代码取证：`docs/m5-proposal.md` 与 `docs/solpi-port-proposal.md`

- 取证基线：HEAD `a6a87627b4520c05bb974a3c0dfeaf5586fabd79`（第 371 页）。
- 取料方式：`git archive HEAD` 解到 `/tmp/dshhead` 后直读（等价 `git show HEAD:<path>`）。工作树里两个会话正在改的文件一律不采信；两份提案文档在工作树只有 4 行 / 3 行的 env 改名（`M0_*`→`CAIRN_*`），且都是等行替换 ⇒ **文档行号在 HEAD 与工作树一致**，下表可直接在工作树里按行定位。
- 未跑任何判卷 / typecheck / head-cert / mutate-verify（认证在另一窗口跑）。表里所有「代码现状」都是本次真读到的路径:行号；未读到的写「查无此物」。
- 判定口径：
  - **成立** = 与 HEAD 代码一致（行号漂移会在现状列给出真行号）。
  - **陈旧** = 方向没错但已漂（文件搬了 / 数量变了 / 引用的文件不存在了）；照它去找会找不到或找错，但不会被引向错误的设计。
  - **说反了** = 方向与 HEAD 相反：把已接线的说成没接、把已修掉的坑说成还在那儿咬人、把不存在的文件当判据源。这一类会直接把后来的人带偏。

---

## 一、`docs/m5-proposal.md`

| 文档 file:line | 断言原文（截到 40 字） | 代码现状 file:line 或 "查无此物" | 判定 |
|---|---|---|---|
| m5:38 | 「模型路由层不存在」 | `src/routing/policy.ts:72` `routeFor`；`src/agent/orchestrator.ts:597` 已在 spawn 内消费路由结果 | 说反了 |
| m5:38 | `src/providers/index.ts` 只有接口定义（`Provider.stream`） | `src/providers/index.ts:33-34` 接口在；另有 `streamFromNextSource`（:44）非纯接口 | 成立 |
| m5:38 | 主会话硬编码 GLM：`agent-runner.ts:providerInfo` 读 `M0_MODEL ?? "glm-5.2"` | `providerInfo` 在 `src/main/settings-handlers.ts:83-91`，读 `M0A_PROVIDER`＋settings.provider＋settings.model；`M0_MODEL` 只是 legacy 兜底，`?? "glm-5.2"` 那式子在 `src/providers/glm.ts:19` | 说反了 |
| m5:38 | 四适配器已实现但从未接入运行时，全项目只装配 GLM 一条链路 | `src/providers/registry.ts:149/162/170` 三家都进 `toWorkerModel`；`src/main/agent-runner.ts:1380` 按选中的 spec 装配 | 说反了 |
| m5:38 | `OrchestratorOptions.modelFor`（在 `src/agent/orchestrator.ts`）是可选回调 | 字段仍是可选回调，但定义在 `src/agent/orchestrator-types.ts:195` | 陈旧 |
| m5:39 | `docs/m3-acceptance.md` 九之 2 明确留位（gate 不重跑） | 该文件不存在；HEAD 的 `docs/` 只有 CODE-WIKI/DOCS-MAP/README/adr/judgment-layer-calibration-proposal/m5-proposal/review-2026-10-03-technical/solpi-port-proposal/superpowers | 陈旧 |
| m5:40 | `verify_result`/`usage`/`approval_resolved`/`card_action`/`diff_comment` 全部落流 | `src/events/index.ts:682/677/691/692/693`（`KNOWN_TYPES` 起于 :671） | 成立 |
| m5:40 | 没有一个字节回到策略层 | `src/agent/orchestrator.ts:16` import `loadBanditState/saveBanditState/updatePriced`；:1933 真加载状态；`src/routing/bandit.ts:101-111` 用 verify 全绿当 reward | 说反了 |
| m5:48 | append-only 事件流，重放＋逐行容错 | `src/events/index.ts:916-936` `replay` 坏行按位置容忍 | 成立 |
| m5:49 | `forkSession(sessionPath, eventId)` 已在 `src/events/index.ts` 实现 | `src/events/index.ts:1086`（第三参 `targetDir?` 可选，签名兼容） | 成立 |
| m5:51 | `.agent/config.json` 的 verify 配置在 `src/agent/verify.ts` | `src/agent/verify.ts:219-236` `loadVerifyConfig` 读 `.agent/config.json`，收 `verify.{typecheck,lint,test}` | 成立 |
| m5:59 | 编排失败自愈率基线 = 0（失败即终态） | `src/agent/supervisor.ts:14,66` `retry` 动作 + verdict=fail 分支；`src/agent/orchestrator.ts:381` `spawnRace` | 说反了 |
| m5:60 | 路由可审计性基线 = 无（100% spawn 有 `routing_decision` 是目标） | `src/events/index.ts:440` 段注释「M5a 路由决策」、`:442` `RoutingDecisionEvent`、`:694` 已进 `KNOWN_TYPES`、`:651` 已进联合 | 说反了 |
| m5:62,80 | 折算沿用现有 `budgetPricePerMTok` 单值 | `src/main/settings.ts:50`（字段）/`:109`（缺省 0）/`:193`（校验） | 成立 |
| m5:82 | 复用现有 `shape.ts`/`compaction.ts` 模板 | `src/agent/shape.ts:36`、`src/agent/compaction.ts:30` | 成立 |
| m5:99 | 新接口放在 `// ---- M3a 多 agent 编排 ----` 段之后并标 M5a 段 | `src/events/index.ts:279`（M3a 段）与 `:440`（M5a 段）——已照做 | 成立 |
| m5:117 | 不在 `KNOWN_TYPES` 的类型，`createEventLog.append` 抛「未知事件类型」 | `src/events/index.ts:828-829` | 成立 |
| m5:118 | 项目有词边界密钥扫描（`\bsk-`） | `src/agent/security/scan.ts:62` | 成立 |
| m5:145 | `fixtures/gym/cases/**` 与 `index.json` 登记进 `scripts/frozen-sha256.json` | `scripts/frozen-sha256.json` 内 `fixtures/gym/*` 共 35 项（含 `index.json`、各 case 的 `expect.json`） | 成立 |
| m5:162 | 复用 `scriptedWorkerModel`（明卷）/`defaultWorkerModel`（暗卷） | `src/agent/worker-model.ts:18` `defaultWorkerModel`；`src/agent/orchestrator.ts:2551` 再导出 `scriptedWorkerModel` | 成立 |
| m5:176 | 不登记进 `GATES` 会触发漂移护栏 `orphan-acceptance-script` | `scripts/gate-manifest.ts:238`（kind 枚举）、`:245`、`:266` | 成立 |
| m5:177 | `scripts/gym-check.ts` 体例仿 `scripts/agents-check.ts` | 查无此物：HEAD 的 `scripts/` 无 `agents-check.ts` | 陈旧 |
| m5:178 | `assertion-health` 禁恒真/空断言，析取式需 `// gates:disjunction-ok` | `scripts/assertion-health.ts:10-13`（`X \|\| true` AST）、`:47` `scanEmptyAsserts`、`:78` `DISJUNCTION_OK`、`:123` `scanDisjunctions` | 成立 |
| m5:180,434 | 门数 23（→24→25→26） | `scripts/gate-manifest.ts:13` 的 `GATES` 现读 32 条（含 `gym-check`/`routing-check`/`supervisor-check`） | 陈旧 |
| m5:199 | `PROVIDER_IDS = ["glm"]` 本期不改 | `src/providers/registry.ts:22` = `["glm","openai","anthropic","gemini"]` | 说反了 |
| m5:200 | `WorkerModel` 签名在 `src/agent/orchestrator.ts` | 签名逐字成立但在 `src/agent/worker-model.ts:7`；orchestrator 只是 import（:86） | 陈旧 |
| m5:200 | `GlmMessage = ProviderMessage` 类型别名在 `src/providers/glm.ts` | `src/providers/glm.ts:22` | 成立 |
| m5:224 | `agent_spawned.model` 字段已存在 | `src/events/index.ts:316`（`AgentSpawnedEvent` 起于 :294） | 成立 |
| m5:226 | `agent_result.artifacts.respawn` 已携带 `tier`/`model` | `src/events/index.ts:371`（`respawn?: RespawnArgs`）+ `src/agent/recovery.ts:13-14` | 成立 |
| m5:227 | `SpawnArgs` 已有 `model`/`tier`（unknown 透传），在 `orchestrator.ts` | 字段在 `src/agent/orchestrator-types.ts:21,23`；`orchestrator.ts:87` 只 import 类型 | 陈旧 |
| m5:236 | bandit 持久化到 `<appData>/routing-bandit.json` | `src/main/agent-runner.ts:345` 实际落在 `join(ROOT, ".agent", "routing-bandit.json")`（工作区，非 appData） | 陈旧 |
| m5:243-247 | `AppSettings` 要新增 `routingBandit`（三处 + set() 手工白名单） | 三处都已在：`src/main/settings.ts:60`/`:114`/`:199`；四个 SolPi 开关同表（`:119-124`） | 陈旧（已落地） |
| m5:247,376 | `SettingsStore.set()` 内有手工字段 `\|\|` 白名单，漏加会把 patch 静默吞成 `{}`，是「最容易踩且最难查的坑」 | 该陷阱已被拆掉：`src/main/settings.ts:261-266` 改为类型驱动浅合并（`const { layout: layoutPatch, ...scalars } = patch;`），:262-265 注释明写「旧写法把 26 个键名手抄成一条布尔表达式…名单由类型本身覆盖」；`set()`（:254）只是排队调 `applyPatch`。仍可静默丢字段的地方只剩 `validateSettings`（:149 起逐键取值） | 说反了 |
| m5:263,460 | settings 白名单漏加 `routingBandit` ⇒ `routing-check` B3 必须红 | `scripts/routing-check.ts:185-195`（B3a 缺省 false / B3b set 持久化「白名单未吞」/ B3c 非布尔回退）——门已在，但它钉的是 `validateSettings`，不是 `set()` | 陈旧 |
| m5:284 | 复用 `src/agent/sequencer.ts:parseVerdict` | `src/agent/sequencer.ts:179` | 成立 |
| m5:285 | 有界性三重保险：`maxStages` 默认 6 + 预算 + 同 `(role,task-hash)` 重复 ≥2 强制 escalate | `src/agent/supervisor.ts:50`（`ctx.maxStages ?? 6`）、`:52` budgetBlocked、`:56` `repeatCount >= 3`（`repeatCount` = 出现次数，`src/agent/orchestrator.ts:1100` 从 1 起算 ⇒ 第 3 次出现＝重复 2 次，与 B2「第三次出现」一致） | 成立 |
| m5:298 | `MAX_CONCURRENT_WORKERS = 4`（在 `orchestrator.ts`） | 值成立，定义在 `src/agent/orchestrator-config.ts:5` | 陈旧 |
| m5:299 | 复用 M3b `worktreePathFor` | `src/agent/worktree.ts:102` | 成立 |
| m5:302 | 成本闸复用 M3c `budgetBlocked`（`orchestrator.ts`） | `src/agent/orchestrator.ts:236` | 成立 |
| m5:361 | `scripts/agents-check.ts` N5 断言「stages 批准后冻结」 | 查无此物（文件不在 HEAD） | 陈旧 |
| m5:367 | `AgentMode` 联合类型需扩 `"supervise"` | 已扩：`src/events/index.ts:285` = `"read"\|"write"\|"pipeline"\|"supervise"` | 陈旧（已落地） |
| m5:408 | worker 压缩 ratio 现为 0.95（`WORKER_COMPACTION_CONFIG`） | `src/agent/orchestrator-config.ts:57`（`{ ratio: 0.95 }`） | 成立 |
| m5:436 | 测试基线 57 files / 513 passed / 0 skipped | 未取：本轮禁止跑判卷（认证在另一窗口）。缺的取证步骤＝一次 `pnpm test` 或读 `outputs/*/` 认证件里的 vitest 摘要 | 无法判定 |
| m5:446 | vitest 配置 `include: tests/**/*.test.ts`、`fileParallelism: false` | `tests/vitest.config.ts:27`、`:28` | 成立 |
| m5:12,14-16 | 「另一个 M5」的实现在 `verify.ts`/`memory/lessons.ts`，判卷 `verify-multiface`/`memory-lessons`，口径面脚本 `scripts/replay/lessons-offline.ts` 等 | `src/agent/verify.ts:287`、`src/agent/memory/lessons.ts` 存在、`tests/verify-multiface.test.ts`、`tests/memory-lessons.test.ts`、`scripts/replay/lessons-offline.ts`、`:lessons-round-ab.ts`、`:verify-cause-mix.ts` | 成立 |
| m5:11 | 路线图 `outputs/agent-capability-roadmap-2026-10-01/PLAN.md` | 该文件在 HEAD 树内存在 | 成立 |
| m5:143 | 恒真式体检那条裁决原文放在 `outputs/blocked-ledger-recovered-2026-09-27/BLOCKED-ledger-1187.txt` | 该文件在 HEAD 树内存在 | 成立 |
| m5:495-498 | 门清单在 `gate-manifest.ts` 的 `GATES`；冻结判卷在 `scripts/frozen-sha256.json`；体检在 `assertion-health.ts`；`runVerifyOutcome` 在 `verify.ts` | `scripts/gate-manifest.ts:13`、`scripts/frozen-sha256.json`、`scripts/assertion-health.ts:88`、`src/agent/verify.ts:287` | 成立 |

## 二、`docs/solpi-port-proposal.md`

| 文档 file:line | 断言原文（截到 40 字） | 代码现状 file:line 或 "查无此物" | 判定 |
|---|---|---|---|
| solpi:23 | 组装型 provider 只被 `gate-check.ts:233` 与 `compaction.test.ts:413` 消费 | 消费者另有产品与靶场侧：`src/main/agent-runner.ts:1394`、`src/agent/gym/runner.ts:86`、`src/agent/gym/probe.ts:177`（验收侧两处也已漂到 `scripts/gate-check.ts:242`、`tests/compaction.test.ts:462`） | 说反了 |
| solpi:23,71 | `runAgent` 用的是单轮、无工具面的演示 provider（`agent-runner.ts:797-826`） | `createProvider` 现读 `src/main/agent-runner.ts:1360-1414`：真 provider 分支返回 `createGlmSessionProvider`，工具面经 `requestFace`（:1367,1397）传入 | 说反了 |
| solpi:71 | `streamGlm(…, {}, undefined, call)` ⇒ `tools` 实参 `undefined` ⇒ 无工具面（:822） | `src/main/agent-runner.ts:1385` 的 transport 收 `tools` 并转交 `modelTransport(messages, tools ?? [], …)`；`src/agent/glm-session.ts:483` 由 `gateToolSpecs(mode)` 组面 | 说反了 |
| solpi:71 | 生成器只造一次 ⇒ 第 2 轮拿到已耗尽的同一迭代器 ⇒ 单轮 | `src/agent/glm-session.ts:708` 注释即「turnGenerator 每次 `stream()` 都是新的生成器」；:897 `stream()` 每请求重跑 `assemble()`（:758-760 `replayIncremental`） | 说反了 |
| solpi:72 | 该 provider 自述契约「忽略入参沿用构造时的 opts」（`glm-session.ts:350-352`） | 契约原话在 `src/agent/glm-session.ts:827-829`（另有 :610-611） | 成立（行漂） |
| solpi:72 | `src/main/**` 只从该模块导入 `createGlmSummarizer` | `src/main/agent-runner.ts:16-17` 同时 import `createGlmSessionProvider` 与 `createGlmSummarizer` | 说反了 |
| solpi:73 | 现行渲染层唯一调用点是 `api.run({message, mode})`（`src/renderer/app.js:1954`），不传 sessionId | 查无此物：HEAD 无 `src/renderer/`（该目录只有 `fixtures/impact/mini-repo/app.js`）。现行渲染层 `apps/desktop/src/renderer/App.tsx:199-201` 传的正是 `{ message, mode, sessionId: sid, model }` | 说反了 |
| solpi:73 | 非会话支 ⇒ `logPath` 是 `<tmp>/m0b-agent-events.jsonl` 且开头 `rm` 掉它（:877）⇒ 跨轮无历史、会话 JSONL 恒空 | `src/main/agent-runner.ts:1603` 仍保留 `if (!opts.sessionId) await rm(...)`，但带 sessionId 走 append（:426-427 `pathOf(sessionsDir, …)`）⇒「恒空」这一结论不再成立 | 说反了 |
| solpi:73 | `M0A_PROVIDER` 全仓无人写入 ⇒ 打包后主对话走冻结 mock 剧本 | 缺省确实仍是剧本通道，但来源换了：`src/main/settings.ts:116` `provider: "demo"`，而 `M0A_PROVIDER` 是覆盖通道（`src/main/agent-runner.ts:277`、`src/main/provider-runtime.ts:50-55`），且渲染层可经 settings 选真实 provider（`App.tsx:199` 的 `model` 选择态） | 陈旧 |
| solpi:73 | BYOK 启动注入只写 `M0_API_KEY`（`provider-key-inject.ts:10-13`） | `src/main/provider-key-inject.ts:14-30` 遍历 `PROVIDER_IDS` 逐家注入各自 env；env 名表在 `src/providers/env-keys.ts:7-12`（四家） | 说反了 |
| solpi:84 | `computePrune({events})` 两个生产调用点均不传 `attachmentsDir`/`sessionId` | 组装路径已传：`src/agent/glm-session.ts:769`；仍不传的是演示/非会话通道 `src/main/agent-runner.ts:1845` | 说反了 |
| solpi:84 | `writePruneAttachments` 全仓唯一调用点在验收脚本（`prune-check.ts:63`） | 生产侧已调：`src/agent/glm-session.ts:789`（import 在 :13）；验收侧那处现在在 `scripts/prune-check.ts:75`，④ 的「读回且逐字一致」在 `:74-78` | 说反了 |
| solpi:90 | `collect()` 在 `out.length >= 32KB` 后 `truncated=true; return`——chunk 直接丢弃 | `src/tools/run_shell.ts:19,23` 改为 `createOutputRing(SHELL_OUTPUT_LIMIT)` + `collect = chunk => ring.push(chunk)`；`src/tools/output-ring.ts:11-12` 语义是「溢出 ⇒ 头部＋省略提示＋尾部」 | 说反了 |
| solpi:90 | stdout/stderr 混采同一缓冲（:74-75） | 仍混采，同一 ring：`src/tools/run_shell.ts:78-79` | 成立（行漂） |
| solpi:92 | 上限常量 `SHELL_OUTPUT_LIMIT = 32*1024`、`SHELL_TIMEOUT_MS = 60_000`（:5-6） | `src/tools/run_shell.ts:7-8` | 成立（行漂） |
| solpi:96 | 全仓 `cache_control\|cacheControl\|prompt_cache\|ephemeral` 零命中，无注入点 | 命中遍地：`src/providers/anthropic.ts:120,129` 真打 `cache_control:{type:"ephemeral"}`，开关 `promptCache` 经 `src/providers/registry.ts:164` 注入，且 `src/main/settings.ts:120` 缺省为 `true` | 说反了 |
| solpi:96 | 四家 provider 都不解析 cache 字段；`anthropic.ts:32,41` 的 usage 类型只有 in/out | `src/providers/anthropic.ts:40,49` 类型已含 `cache_read_input_tokens`/`cache_creation_input_tokens`，解析在 :198-199,235-236，产出 `cacheReadInputTokens`（:289）；`src/providers/openai.ts:74,97-102` 同理 | 说反了 |
| solpi:96 | `UsageEvent` 只有 `inputTokens/outputTokens/agent_id?`（`events/index.ts:25`） | `src/events/index.ts:85-92` 已增 `cacheReadInputTokens?`/`cacheWriteInputTokens?` 与 `model?` | 说反了 |
| solpi:96 | 接缓存的目标值本身是抄文档（Anthropic 是否真回传 = 未证） | 锚点属实：`PROGRESS.md:420` 写「fixture 按官方文档手写并逐条断言」；本仓 `tests`/`fixtures/providers/**` 为剧本驱动 | 无法判定（缺带真凭据的响应样本，静态读码无法证实/证伪） |
| solpi:105 | 明卷 token = 冻结剧本字节的纯函数（`gym/runner.ts:35-49,95`） | `src/agent/gym/runner.ts:42-49` `scriptedUsageOf`，消费点 :119-120 | 成立（行漂） |
| solpi:105 | 靶场跑的 `runLoop` 路径不经过压缩/prune | 暗卷档已走装配链（`src/agent/gym/runner.ts:86` 用 `createGlmSessionProvider`，其 :758 的 `assemble()` 含 prune/压缩）；明卷档仍是剧本；且 P3 提议的 `assemblyChars` 采样没进靶场（`assemblyChars` 只在 `src/agent/compaction.ts:108,119` 自用） | 陈旧 |
| solpi:41 | 靶场量不到投影侧节省 ⇒ §1.3 指标全部记未证 | 投影侧计量已另有出口：`surface_account` 事件（`src/agent/glm-session.ts:867`、`src/events/index.ts:701`）＋读数器 `scripts/observe-surface.ts:65`；但它不落在靶场对比里（`scripts/gym-run.ts:137-139` 仍比 tokens） | 陈旧 |
| solpi:107 | `assemblyChars` 是已有纯函数（`compaction.ts:76`） | `src/agent/compaction.ts:108` | 成立（行漂） |
| solpi:111 | `PlanProposal = {goal, files, approach?, verify?}`，无 per-step 状态（`events:53-58`） | `src/events/index.ts:120-125` 字段逐字一致，确无 steps | 成立（行漂） |
| solpi:113 | SoL-Pi 靠模型调 `update_plan`（外部仓 `plan.ts:6-14,55-75`） | 外部 scratch clone，不在本仓 HEAD 树内 ⇒ 无法在本仓取证 | 无法判定（缺 `NVlabs/SoL-Pi@2b79168` 的本地取料） |
| solpi:120 | 四个开关各一、缺省全 false = 零行为（对齐 `routingBandit` 先例） | 已落地：`src/main/settings.ts:119-124`（`actionFusion`/`promptCache`/`observationPack`/`evidenceReceipts`/`economicCompaction`），先例 `routingBandit: false` 在 :114；注意 `promptCache` 缺省是 `true` 不是 false | 陈旧（已落地） |
| solpi:120 | 新增键必须进 `validateSettings` 白名单，漏加会静默吞（引 m5 §5.3 的 `set()` 陷阱） | `validateSettings` 逐键校验仍在（`src/main/settings.ts:149`起）；但它引用的 m5 §5.3 那个 `set()` 手工名单已不存在（见 m5:247 行） | 陈旧 |
| solpi:128 | `projectContext` 的白名单式跳过表已列此类协议事件（`context.ts:91-97`） | 跳过面在 `src/agent/context.ts:275` 起的 `e.type ===` 串判 + `:318`（`surface_account` 显式归类），不是 :91-97 的表 | 陈旧 |
| solpi:31 | `projectContext(events, replacements?)` 已有「按 id 替换投影文本」槽位（`context.ts:54-57`） | `src/agent/context.ts:232-235` | 成立（行漂） |
| solpi:32 | `atomicUnits`/`selectCut` 二分回退已在（`compaction.ts:243-292`） | `src/agent/compaction.ts:145`（`atomicUnits`）、`:276`（`selectCut`）、`:291`（二分吸附注释） | 成立（行漂） |
| solpi:33 | `attachmentName` 清洗 + sha1 前 8 位（`prune.ts:132-139`）、`attachmentPathFor`（:221） | `src/agent/prune.ts:149-150`、`:270` | 成立（行漂） |
| solpi:35 | 靶场 fork@event（`gym-run.ts:69-71`）＋基线回退线（:119-121） | fork 分支 `scripts/gym-run.ts:69`；回退线实际在 `:137-139`（成功率 −2% / tokens +5%） | 成立（半数行漂） |
| solpi:36 | `createVerifyHook(repoDir,{exec})`（`verify.ts:151`）+ `verifyExec(sandbox)`（`agent-runner.ts:977`） | `src/agent/verify.ts:325`、`src/main/agent-runner.ts:1428` | 成立（行漂） |
| solpi:149 | 静态注册表保持 9 工具；`tools-check.ts:55` 断言 `names.length === 9` | 静态注册表是 10 把（`src/tools/index.ts:17-28`，含 `lsp`/`propose_plan`），断言已改成 `names.length === 10`（`scripts/tools-check.ts:55`）；`ToolName` 静态 11 名含 verify（`src/tools/base.ts:69-72`） | 说反了 |
| solpi:152-160 | Ledger 的常量与句柄形状（`LEDGER_THRESHOLD_BYTES` 10KB / `RECALL_MAX_BYTES` 16KB / `FULL_SENDS` 2 / `observeId`） | 全部落地在 `src/agent/ledger.ts:7-10,54`（另有 `ObservationLedger` :77、`createObservationLedger` :383）；判卷 `tests/ledger.test.ts` | 陈旧（已落地） |
| solpi:170-178 | 收据前缀 / `MAX_EVIDENCE_ITEMS=12` / `MAX_QUOTE_CHARS=600` / `buildReceipt` / `validateReceipt` | 全部落地在 `src/agent/evidence.ts:9,12,13,64,128`（校验态原因见 :34）；判卷 `tests/evidence.test.ts` | 陈旧（已落地） |
| solpi:185 | 含收据前缀行的 tool_result 永不进 prune 替换集，需在 `isPruneExempt`（`prune.ts:102-139`）加一条 | 接缝函数在 `src/agent/prune.ts:115`（消费点 :207） | 成立（行漂） |
| solpi:192-198 | 需新纯函数 `deriveBoundaries(events)`（落在 `compaction.ts`），从 `plan_approved`/写动作/`verify_result(ok)`/`user_message` 派生 | 已实现但在 `src/agent/economics.ts`：`deriveProgressBoundaries` :161、`deriveBoundaries` :240、`snapToProgressBoundary` :246；判卷 `tests/economics.test.ts` | 陈旧（已落地，落点换文件） |
| solpi:201-216 | 经济闸公式与九态 reason、常量 `windowReserveTokens=16_384` 等 | 已实现：`src/agent/economics.ts:111` `economicGate`、`:94-96` reason 枚举、`:130-144` deferred 各态、`:10` `DEFAULT_ECONOMIC_CONFIG` | 陈旧（已落地） |
| solpi:218 | `CompactionEvent.reason` 现是 threshold / hard_buffer / user_request 三值窄联合（`events:82`，声明体 :79-94） | `src/events/index.ts:198`（接口 :195-208），三值未扩 | 成立（行漂） |
| solpi:218 | 现行运行时 UI 的 `case 'compaction'` 只有一句 toast（`src/renderer/app.js:1870-1872`），`default:` 静默吞 | 查无此物：HEAD 无 `src/renderer/`，全仓无 `app.js` 渲染层 | 陈旧 |
| solpi:218 | 富压缩卡在 React 树 `src/renderer/cards/compaction-card.tsx`，该树不在当前运行时路径 | 查无此物：全仓无 `compaction-card.tsx`；`compactionCardPayload` 只在 `src/agent/compaction.ts:847` | 说反了 |
| solpi:265 | vanilla 渲染层已入库（提交 `e259113`，作用域 `src/renderer/`），React 树已不在运行时路径 | 关系倒了过来：`src/renderer/` 整体不存在，唯一运行时渲染层是 React 的 `apps/desktop/src/renderer/`（`App.tsx`/`components/*.tsx`），并由 `scripts/desktop-boundary-check.ts`＋`GATES` 第 32 条 `desktop-boundary-check` 守着 | 说反了 |
| solpi:258 | `scripts/frozen-sha256.json` 28 项，冻结在 `fixtures/mock/**`、`fixtures/todo-app/tests/**`、`fixtures/gym/**` | 现读 66 项，分布 `fixtures/gym` 35 / `fixtures/impact` 21 / `fixtures/no-progress` 7 / `fixtures/mock` 2 / `fixtures/todo-app` 1 | 陈旧 |
| solpi:263,324 | 渲染层 29 个文件有 sha256 基线（`scripts/ui-baseline-sha256.json`，含 `cards/compaction-card.tsx`）＋`panels-check` 截图门 | 查无此物：HEAD 的 `scripts/` 只有 `frozen-demo-sha256.json` 与 `frozen-sha256.json`；无 `ui-baseline-sha256.json`，`GATES` 里也没有 `panels-check` | 陈旧 |
| solpi:259 | `KNOWN_TYPES` 26 项（`events:375-402`），写侧校验 :477-491，读侧容错 :546-606 | `src/events/index.ts:671-704` 现读 33 项；写侧抛错 :828-829；读侧容错 :916-936 | 陈旧 |
| solpi:259 | 新增事件必须同步接口/联合/`KNOWN_TYPES`，且 `sidechat` 只读投影 switch 要补（`sidechat.ts:112-127`） | 三处同步纪律成立（见 m5:117 行）；`src/agent/sidechat.ts:112-152` 的 switch 里 `surface_account` 已是显式 case（:152） | 成立（行漂） |
| solpi:263 | 恒真/析取体检是 AST 级（`assertion-health.ts:8,18,28-45,68-105`） | 实际入口在 `scripts/assertion-health.ts:5,16,47,88,123` | 成立（行漂） |
| solpi:306 | `ToolResult` = `{ok, output}`，无结构化 details 槽位（`tools/base.ts:39-42`） | `src/tools/base.ts:47-61` 已含 `snapshotId?`/`change?`/`exitCode?`/`timedOut?` 等；run_shell 正在填（`src/tools/run_shell.ts:38-41`） | 说反了 |
| solpi:308 | read 上限 50KB / 2000 行 / 行截 2000 字符（`read_file.ts:7-9,111-119`） | `src/tools/read_file.ts:9-11`（另有整读前缀帽 :15） | 成立（行漂） |
| solpi:315 | 压缩参数表：ratio 0.9 / tail 2k-15k / cap 4096 / tool 截 2000 / minProgress 0.1 / 连续失败 2（`compaction.ts:27-40`） | `src/agent/compaction.ts:30-42` 逐字对上 | 成立（行漂） |
| solpi:319 | prune 参数：保护 40k / 最小 20k / 近 2 轮 / 免剪 skill,remember,memory（`prune.ts:11-33`） | `src/agent/prune.ts:16-37` | 成立（行漂） |
| solpi:310 | turn 顺序：verify 门 → 白名单摘除 → PreToolUse → 权限门 → 执行 → PostToolUse → append；`verify.ok` 即 `return`（`loop.ts:86-231`，:118） | 顺序仍在 `src/agent/loop.ts:378`（摘除）→`:426-430`（PreToolUse 先于权限门）→`:527-531`（PostToolUse）；「verify 通过即收束」在 `:254`/`:422` | 成立（行漂） |
| solpi:314 | worker 侧 verify 是禁用的（`orchestrator.ts:806` 注释） | 该说法仍在，但位置是 `src/agent/orchestrator.ts:378` | 成立（行漂） |
| solpi:225 | `runVerifyOutcome` 只读 `loadVerifyConfig(repoDir)`，全文无地方消费 `plan.verify` ⇒ 模型命令到不了 `exec`（`verify.ts:119-121`） | `src/agent/verify.ts:287-288`；不变量还被钉住：`src/agent/action-fusion.ts:68`「never model params or plan.verify」＋`tests/action-fusion.test.ts:259` | 成立 |
| solpi:227-229 | 落点在 `gatedTool` 包装层（`agent-runner.ts:263-324`），写成功后跑 lint 并入 output 尾，标记 `[fused_lint:*]` | 已实现：`src/agent/action-fusion.ts:39-46`（三态标记在 :46）；`gatedTool` 现在 `src/main/agent-runner.ts:511`；判卷 `tests/action-fusion.test.ts` | 陈旧（已落地，行漂） |
| solpi:235 | 写后融合 lint 与 worker 侧是否开启须单独拍板，提案默认不开（留位） | 开关在 `src/main/settings.ts:119` `actionFusion: false`（缺省关＝与提案一致） | 成立 |
| solpi:239 | V7 沙箱：融合 lint 走 `verifyExec(sandbox)` | `src/main/agent-runner.ts:1428` 定义，消费点 :340/:1731/:1804 | 成立（行漂） |
| solpi:332 | opt-in 先例：`routingBandit: false`（`settings.ts:48,68,124,155`）＋反向断言先例 `routing-check.ts:184-195` | `src/main/settings.ts:60,114,199`；`scripts/routing-check.ts:185-195` | 成立（行漂） |
| solpi:337 | 规格授权面在 `agent-plan.md` §5.4:480-482 / §6.2:548-555 / §7.3-7.4:649-724 / §7.7:744-753 | 查无此物：HEAD 树里没有 `agent-plan.md`（全仓 `find` 零命中）；本文 §1.1/§1.4/§3/§4 十余处引用同一文件同一批行号 | 陈旧 |
| solpi:218,324 | 「按 `overview.md` 裁决，React 树不在运行时路径」 | 查无此物：HEAD 树里没有任何 `overview.md` | 陈旧 |
| solpi:293 | 本仓路径写作 `/Users/ze/Downloads/deepseek harness` | 实际工作区是 `/Users/ze/Downloads/Cairn/deepseek harness` | 陈旧 |

---

## 三、汇总

| | 条数 |
|---|---|
| 总计 | 110 |
| 成立 | 51 |
| 陈旧 | 30 |
| 说反了 | 26 |
| 无法判定 | 3 |

（按文档分：`docs/m5-proposal.md` 48 条＝成立 27 / 陈旧 12 / 说反了 8 / 无法判定 1；`docs/solpi-port-proposal.md` 62 条＝成立 24 / 陈旧 18 / 说反了 18 / 无法判定 2。计数由脚本按「未转义竖线切列」现读上表得出，不是手抄。）

### 最严重的一格

**`docs/m5-proposal.md:247`＋`:376`（§5.3 全节）：「`SettingsStore.set()` 里有一个手工字段 `||` 白名单，新字段不加进去会被静默吞掉，是本方案最容易踩且最难查的坑」——这个坑已经在代码里被拆掉了。** 现状是 `src/main/settings.ts:261-266` 的类型驱动浅合并，且 :262-265 的注释正是针对这条旧写法写的（「旧写法把 26 个键名手抄成一条布尔表达式…名单由类型本身覆盖，没有可漂移的副本」）。它的危害是双向的：照 m5 步骤 9 第 4 点去「加进 `||` 链」会无处可加；照 §6.3 第 7 条去写那条反向验证（「settings 白名单漏加 `routingBandit` ⇒ 必红」）会造出一条恒真的假尺。`docs/solpi-port-proposal.md:120,263` 又把这同一个坑当既有事实转引了一次，所以两篇文档一起把后来的人指向同一个已消失的陷阱。

其余三格同样是「方向反了」而不是「数字漂了」：

- `solpi:71-73`（P-1 整节）：把「组装型 provider 不在生产热路径」当全案最上游缺口，但 `src/main/agent-runner.ts:1360-1414` 已经在真 provider 分支返回 `createGlmSessionProvider`，渲染层也已传 sessionId（`apps/desktop/src/renderer/App.tsx:199-201`）。整个 P-1 与它挂着的 §1.3 指标表、§6 分期「P-1（最上游）」都还在被当成待办读。
- `solpi:96`（P2）：「全仓 `cache_control` 零命中 / 四家都不解析 cache 字段 / `UsageEvent` 只有 in/out」三条，`src/providers/anthropic.ts:120,129,40,49,198-199` 与 `src/events/index.ts:88` 逐条反着。且 `src/main/settings.ts:120` 的 `promptCache` 缺省已经是 `true`。
- `solpi:149,258`（R1）：把「静态注册表 9 工具」当四机制的硬约束并据此设计 `obs_recall` 的注入方式；`scripts/tools-check.ts:55` 现在钉的是 `=== 10`。约束形状没错（新工具仍须运行时注入）但数字与判卷都变了，照抄「保 9」会当场把 `tools-check` 写红。

### 没收的有几条、为什么

m5 收了 48 条、solpi 收了 62 条；没收的是三类，共约 40 处：**①纯愿景/排期/权衡句**（如 m5 §0「先造尺子再改引擎」、§4 四张权衡表、§1.3 目标百分比、solpi §4 六条取舍、§7 一句话结论、§6 分期工作量表）——代码既不证实也不证伪；**②外部仓断言**（solpi §1.4/§3.1-§3.3/§8 尾表 16 行 `SoL-Pi@2b79168` 的 `observation.ts`/`economics.ts`/`receipt.ts`/`SECURITY.md`/`README.md` 常量与行号）——不在本仓 HEAD 树内，本轮无取料途径，只能整批挂到「未取证」；**③「本提案要求新增」的字段清单本身**（如 m5 `RoutingDecisionEvent` 的 8 个字段、solpi §3.0 `context_assembly` 的 7 个字段）——这些是待办而非现状断言；顺带记一句读数：m5 那 8 个字段后来被逐字实现（`src/events/index.ts:442-456`），而 solpi 自造的 `context_assembly` / `compaction_deferred` 两个事件名全仓零命中，同类观测面实际落成了 `surface_account`（`src/events/index.ts:701`）。另有一条明知的缺口：m5:436 的「57 files / 513 passed」本轮按纪律没跑判卷，标了无法判定。
