# 十条能力复测（路线图 §9.2 · 2026-10-02）

**一句话**：M0–M10 全波落地之后，按原口径复测，**「已实现」的条数没变——仍是 3 条（能力 5/6/7）**；
其余 7 条**每一条都收窄了**，其中 2 条只差一次「要不要上默认路径」的裁决（能力 3、4）。
本轮复测另外**更正旧记录 2 处**（能力 10 早就有真模型读数了、桌面层已经不是"没有 UI"），
并**新查出 1 条假读数**（两次真模型跑的 `$` 轴全是 0，而工件里没有任何出处说明为什么是 0）。

> ⚠️ **文末「附：同日追加的零花费读数」更正了一个被广泛引用的数字**：
> 那两趟真模型跑发布的「成功率 75% / 67%」，其**唯一变量是「模型有没有往 `tests/` 里写过东西」**
> （12 条任务的 `expects` 完全相同、`verify` 24/24 全绿）；按种子文件清单把「改判卷」与「补测试」分开重算后是
> **83.3% / 83.3%**。引用那对数之前先读那一节。

- **口径**：逐字沿用 `outputs/_audit2-capability.md:10`——「**已实现** = 真接线、默认路径能跑、有闸或判卷兜底；
  **部分实现** = 主干真能干活但有明确缺口；**只有骨架** = 数据面/判据在、执行端不消费；**没有** = 不存在」。
  三条件分别记作 (a) 真接线 / (b) 默认路径 / (c) 有兜底。
- **基线**：`_audit2-capability.md` 取在 `bd5ec44`（2026-10-01）。
- **本次**：`zcode` @ `27290f1`（开始取料时是 `c5ab9ca`，期间隔壁会话又落了一笔 ⇒ 以本行为准）。
- **方式**：**只读**。四路并行对着旧差距逐条复查 + 主会话亲自复核 3 处会翻转判定的证据
  （钱轴、用量归因路径、桌面通道覆盖）。**未跑判卷、未跑门禁、未跑真模型**（`gates.ts` 正被隔壁占用，且真跑要花钱）。

---

## 一、总表（前判 → 今判）

| # | 能力 | 10-01 | 10-02 | 三条件现状 | binding 的那一格 |
|---|---|---|---|---|---|
| 1 | 仓库级代码理解 | 部分 | **部分**（缺口变窄） | (a)✗ (b)✓ (c)✗ | 无语义检索，且「问题→代码位置」这件事**没有 precision/recall 尺** |
| 2 | 精确代码生成与编辑 | 部分 | **部分**（apply_patch 补齐） | (a)✗（只差重构/迁移） (b)✓ (c)✓ | 无符号级 rename/重构：`src/tools/lsp.ts:492` 的 `OPERATIONS` 六个动作里没有 rename/codeAction |
| 3 | 工具调用与环境操作 | 部分 | **部分** | (a)✓ (b)✗ (c)✓ | `diagnose`/`web_search` 是**配置门控**的，未配置的工作区根本不挂 |
| 4 | 长程规划与任务分解 | 部分 | **部分** | (a)✓ (b)✗（要 `--serve`） (c)✓ | 27/28 请求的真长轨迹**已经在盘上**，但没有一把尺在它上面算「目标漂移」 |
| 5 | 执行-验证-修正闭环 ★ | 已实现 | **已实现**（加固） | ✓✓✓ | — |
| 6 | 记忆与上下文管理 | 已实现 | **已实现**（加固） | ✓✓✓ | 效果轴（教训被注入后有没有少犯错）仍是**声明未测** |
| 7 | 安全与权限控制 | 已实现 | **已实现**（洞补上） | ✓✓✓ | 残余锐边：`mcp__` 前缀恒"已知"（`src/permissions/tool-registry.ts:44-46`），MCP 仍只由 `readOnlyHint` 管 |
| 8 | 人机协作 | 部分 | **部分**（形态变了） | (a)✓ (b)✓ (c)✗（桌面测试在根门与 CI 之外） | 桌面层是真跑的，但只接了 6 个通道、无 diff/澄清/方案三卡 |
| 9 | 工程化与成本控制 | 部分 | **部分** | (a)✗ (b)✗ (c)部分 | CI 工件不可执行（**无 git remote**）；路由三件套缺省关；`costPerProgress` 无生产消费者 |
| 10 | 评估与持续迭代 | 部分（最接近骨架） | **部分**（真模型跑过了） | (a)✓ (b)✓ (c)✓ 但**钱轴不可用** | 外部基准语料不在仓（只有 2 行样本）；`$/成功任务` 恒 0 |

**计数**：已实现 **3**、部分 **7**、只有骨架 0、没有 0 ⇒ 与基线同数。
**§9.2 的「至少 6 条升到已实现」不成立**——这是复测读数，不是遗漏。
为什么条数没动而缺口明明少了：卡点从「机制在不在」移到了 **(b) 默认路径** 与 **外部集成**，
这两类恰好是**产品裁决**而不是工程量（见第四节）。

---

## 二、逐条：旧差距 → 现态（每条都给 `file:line`）

### 能力 1 · 仓库级代码理解
- **旧差距 ①「只有 4 个 grammar」→ 已改**：`src/agent/map/parse.ts:36-46` 现在是 **6 支 grammar / 9 个扩展名**
  （ts/tsx/js/mjs/cjs/jsx/py/go/java）。但**能建跨文件边的集合窄于能解析的集合**：
  go 只收同包裸调用、java 只收 `new X()` 与无受体调用（属性/选择器纪律，
  `fixtures/impact/accuracy-repo-multilang/ground-truth.json:3` 原话），真值边 **2 条**（`tests/impact-multilang.test.ts`）。
- **旧差距 ②「持久化索引在飞」→ 已入库**（`1748ca7`）：消费者 `src/agent/impact/index.ts:15,156-164`，
  开启点 `src/tools/impact-query.ts:166,187`，**缺省关**（`index.ts:73-75`）；判卷 `tests/impact-persistence.test.ts`
  （第 ⑦ 条判「缺省关 ⇒ 零字节写入」）；耗时读数 `outputs/impact-index-2026-10-01/readings.md` §四：
  索引命中中位 **73ms** / tags 暖 152ms / 冷建 ≈1200ms（560 文件）。
- **旧差距 ③「没有向量 RAG」→ 仍在**：`src/` 与 `apps/desktop/` 搜 `embedding|vector|cosine|hnsw|faiss|semantic-retriev`
  **0 命中**。检索面 = rg + 符号图 + LSP。
- **本轮新查出的那一格（比"没有 RAG"更要紧）**：**没有任何一把尺在量「问题 → 该改哪个文件/符号」**。
  现有三把都是别的形状：`scripts/probe-map-recall.ts` 量的是**抽取召回**（真仓 0.9863→0.9991，
  `outputs/impact-precision-2026-09-23.md:269`）；`tests/impact-accuracy.test.ts` 量的是**边集真值**
  （合成 10 文件 / 16 边，precision=recall=1.000）；地图文本只在**首轮**注入（`src/agent/glm-session.ts:838-841`），
  且**没有 `map_query` 工具**（`src/` 全 0 命中）。⇒ 检索器换成更好的那一版，这些数**一动不动**——
  这就是「没有尺」的定义。

### 能力 2 · 精确代码生成与编辑
- **旧差距「没有 apply_patch」→ 已闭合，五面齐**：`src/tools/index.ts:21`（静态 TOOLS 现在 10 把）、
  `src/tools/base.ts:70`（`TOOL_NAMES`）、`src/permissions/autonomy.ts:218`（写向表）、
  `src/agent/glm-session.ts:157`（规格面，属 `gateToolSpecs` ⇒ 不受降配梯影响）、
  `src/main/agent-runner.ts:1005`（生产接线：`TOOLS.apply_patch = gatedTool(...)`）；
  判卷 `tests/apply-patch.test.ts`（正常/上下文漂移/部分 hunk 失败/空补丁/二进制拒）。
  刻意不进 `tool-surface.ts`（`tool-surface.ts:3`：进那张表的条件是"不在静态注册表里"）——**对**。
  边界：`src/tools/apply_patch.ts:198-200` 拒 rename/move/delete hunk，要求显式逐笔做。
- **旧差距「没有自动重构/迁移」→ 仍在**：`src/agent` 全域搜 `refactor|migrate` **0 处代码**；
  `src/tools/lsp.ts:492` 的 `OPERATIONS` 只有 definition/references/hover/documentSymbol/workspaceSymbol/implementation。
  ⇒ 重构仍是「模型 + 文本编辑原语」，没有符号级安全网。这一格正是业主第 2 条里"会重构、会迁移"那一半。
- **多语言面要说清两种限制**：编辑是纯文本 ⇒ 语言无关；**图**受 grammar 限（6 支）；
  **诊断**更窄——`src/tools/lsp.ts:224` 把非 ts/js 系一律映射成 `plaintext` ⇒ 改 go/java 文件拿不到 LSP 诊断。

### 能力 3 · 工具调用与环境操作
- **新落地两把，但都不在默认路径上**：
  `diagnose` — 生产消费者 `src/main/agent-runner.ts:1775`，挂载条件 `src/tools/diagnose.ts:25-28`
  （`[...config.lint, ...config.test].length > 0` ⇒ **未声明验证面的工作区不挂**）；判卷 `tests/diagnose.test.ts`。
  `web_search` — `agent-runner.ts:1735` 的 `searchConfigured(workspace)` 门，
  未配置时的报错点名要 `.agent/config.json` 的 `search.endpoint`（`src/tools/web-search.ts:134`）；判卷 `tests/web-search.test.ts`。
  两把都是 `specFace: "runtime"`（`src/agent/tool-surface.ts:35,39`），注入面与执行面对得上。
- **五族缺位逐条重扫（`src/`，`-i`）**：浏览器 `playwright|puppeteer|browser` **0**；
  调试器 `debugger|breakpoint|DAP` **0**；issue `jira|linear|octokit|gitlab|sentry` 只命中
  `src/agent/security/scan.ts:65` 的密钥正则（功能性 **0**）；CI API **0**；数据库 `sqlite|postgres|prisma|drizzle` **0**。
  `apps/` 同样 0。⇒ 计划书里「不做浏览器」那条裁决（`outputs/m3-tools-env-2026-10-01/PROGRESS-entry.md` §1，四条理由）
  仍然成立，但**"没有调试器/没有 issue 面/没有数据库面"这三条没人裁过**，只是没做。
- 计数更新：静态 TOOLS **10**（旧报 9）、注入面 **16 件**（旧报 15）。
  ⚠️ `src/agent/plugins/skills.ts:55` 的注释还写着「运行期注入 13 把」——**过期文案**（本仓反复点名的"写死的默认文案只对一种输入成立"那一族）。

### 能力 4 · 长程规划与任务分解
- **旧差距「调度器零调用者」→ 已闭合**：`src/main/agent-runner.ts:1143-1150` 的 `serveScheduler()`
  真调 `installAppTools({automation:true})` → `initScheduler` → `startScheduler()`；入口 `src/cli.ts:286,329,917`（`--serve`）。
  判卷 `tests/scheduler-wiring.test.ts` **3 条**（起→`schedulerRunning()` 翻真、停→翻假且能重启回来、
  第 ③ 条是**反向证人**：`serveScheduler({ workspace: opts.workspace })` 必须以非注释形态存在于 cli.ts）。
  ⇒ **(a) 闭合，(b) 仍不满足**：缺省 `m0 <任务>` 永不启动它，常驻是 opt-in。
- **旧差距「no-progress 有尺没接线」→ 已闭合**（`c5ab9ca`）：唯一生产消费者 `src/agent/loop.ts:297`
  `const np = noProgressLadder({ stuck: detectStuck(stuckTurns), stagnation, thrash })`，注入点 `:309-321`；
  `src/main/settings.ts` **没有对应开关 ⇒ 缺省即开**；判卷 `tests/loop-no-progress.test.ts`（5）+ `tests/no-progress.test.ts`（25）；
  反向验证写在 `tests/loop-no-progress.test.ts:13`（摘掉 verifyBeat 里那次调用 ⇒ ①② 两条红）。
  边界要说清：它挂在 **verify 那一拍**（`loop.ts:288`）⇒ 没有可验面的任务走不到它。
- **旧差距「中途无周期自检 / ≥30 轮漂移无读数」→ 仍在**：`src/` 搜「自检」只命中沙箱自检
  （`agent-runner.ts:1293`）；「目标漂移/goalDrift」在 `src/`、`scripts/`、`outputs/` 三处**只出现在计划书与审计原文里，零读数**。
  而且旧账已经量过这件事是假的：`outputs/long-horizon-probe-2026-09-23/…:9`「靶场三条 case 实测全是 requests=1」、
  `outputs/stagnation-detection-2026-09-23/00-读物与缺口.md:89`「一条'跑了 30 轮放弃'的跑照样记 1 分」。
  ⇒ 长任务这一格**有**真语料，只是没人拿它算过漂移：`outputs/eval-base-a/readings.json` 里
  **B12-long-horizon 单条就跑了 27 个请求 / 29 次工具调用 / 289,251 输入 token / 119.7s，一次改动 20 个文件**
  （跑 B 是 28 请求 / 319,871 token / 1 次工具失败）——**这就是那条 ≥20 轮的长任务轨迹，已经在盘上了**。
  ⚠️ **本页第一次落笔时我把这一格写反了**（我拿 B1 的 `requests:7` 当成了全表极值，写成「最长的也只有 7 个请求」）：
  复核方式是回逐笔原始数取 max，不是回我看过的第一行。真实缺口因此**不是"没有长轨迹"，而是"有轨迹、没有漂移计数"**——
  缺的是读数姿势，不是数据。

### 能力 5 · 执行-验证-修正闭环（已实现，本轮加固）
- typecheck 面自动探测：`src/agent/verify.ts:198-215`（要 `tsconfig.json` **且** `node_modules/.bin/tsc` 才给面），
  装配 `:276-277`。**条件性**：它是最后一个分支 ⇒ 声明了 `package.json` lint/test 或 go/cargo/pytest/make 面的仓库拿不到它。
- 重复失败升级处置：`verify.ts:101` `ESCALATE_REPEAT_ATTEMPT = 3`，文案 `:362-369`「别再改同一处了」。
- 缺省：`src/main/settings.ts:134 autoVerify: true` / `:135 autoVerifyRepair: false`（后者仍等读数）。
- 归因面**比基线更宽**：`src/events/index.ts:141-149` 的枚举是
  `code|timeout|toolchain-missing|no-surface|hook-error|pkg-manager|not-run`（旧报五类，现七类），环境红集合 `:155-157`；
  判卷 `tests/verify-multiface.test.ts:100`「五类环境口径 + code 全在」等 5 个文件。
- lint 面**刻意不探测**，理由在代码里：`verify.ts:78-79`（action-fusion 每次 write_file 后跑 `config.lint`，
  凭空造 lint 面会把干净改动报成失败）⇒ 与基线一致，不是遗漏。

### 能力 6 · 记忆与上下文管理（已实现）
- 两层 + 每轮注入：`src/agent/memory/store.ts:34,44`；预算 `inject.ts:27 MEMORY_TOKEN_BUDGET_DEFAULT = 6_000`
  （单位是 token，`inject.ts:236-238`）；每轮重建点 `src/agent/glm-session.ts:830-834`（+ `worker-prompt.ts:58`、`sidechat.ts:271`）。
- `src/main/settings.ts:106 autoMemory: true`，消费端 `agent-runner.ts:1864,1873`
  （read-only 与 unattended 不触发）。
- **新落地（跨会话学习）**：`src/agent/memory/lessons.ts` 由 `distill.ts:11,158` 消费、写进
  `projectMemoryDir(workspace)`（`distill.ts:165-167`），会话末 `agent-runner.ts:1872` 触发 ⇒ **缺省开、无独立开关**（搭 `autoMemory`）；
  回注限量 `inject.ts:35 LESSONS_RECENT_DEFAULT = 10`、区块 `:142,222`；
  「无证据 ⇒ 零条目」是硬门：`lessons.ts:107-109`（session 为空直接 `[]`）+ `:247`（缺指针抛错），
  判卷 `tests/memory-lessons.test.ts:62` 原话「B 核心：无证据指针 ⇒ 零条目」。
- **效果轴仍是声明**：`outputs/m6-acceptance-2026-10-01/round-ab.log` 给的是**正确的零**，
  并明写「非零产出的端到端那一跳没证到」「业主定的验收形态（冻结 mock 两轮比同类失败率）在此结构不可达」。
  ⇒ 今天没有任何工件能说「同一处失败少犯了」。

### 能力 7 · 安全与权限控制（已实现，基线点名的洞已补）
- 未登记工具名 **fail-closed**：`src/permissions/autonomy.ts:435-441`（判 `ask`、层名 `L4-mcp-unannotated`、
  理由「未登记工具名…按写处理并逐次审批」），非交互由 `src/permissions/index.ts:134` 降 `deny`，
  会话侧兜底 `src/agent/loop.ts:541 blockedBy:"unknown-tool"`。
- 白名单是**派生的**不是手抄：`src/permissions/tool-registry.ts:24-30`（`TOOL_NAMES ∪ INJECTED_TOOLS ∪ worker 表`）。
- 兜底面：`tests/permissions-tool-registry.test.ts`（四档都开火、MCP 豁免、显式规则不被吃）+
  **棘轮** `tests/tool-surface-parity.test.ts:105-110`（「每个声明项都登记进了 KNOWN_TOOL_NAMES」
  + 负控 `isKnownToolName("ghost_tool") === false`）。
- **残余锐边（本轮新点名，不夸大）**：`tool-registry.ts:44-46` 让 `mcp__` 前缀**恒等于"已知"** ⇒
  MCP 工具仍只受 server 自报的 `readOnlyHint` 管，M7 那道翻默认值对这一族**不生效**。
  `autonomy.ts:433-434` 注释说这是刻意的（判两遍 + loop 路径拿不到会话工具表），但**"刻意"与"已验收"是两件事**。

### 能力 8 · 人机协作（判定不变，形态变了 ⇒ 旧记录要更正）
- **`_audit2-capability.md:4` 那句"core-only：无 Electron / 无 renderer / 无 preload"已经不描述这棵树**：
  `apps/desktop/` 是**真桌面壳**——`kernel-host.ts:9-24` 直接 import 生产装配的
  `handleAgentRun/handleAgentDecide/handleRunCancel`（不是 mock），`ApprovalCard.tsx:9-11` 的三键决议真回 `window.agent.decide`。
- **但深度只有 v0.1**：`apps/desktop/src/main/index.ts:58` 原话「M1 切片：这六个通道接真；其余 invoke 通道 M2+ 逐个接线」
  ——真接的是 run/decide/runCancel/listSessions/createSession/openSession（**6 个**）；
  renderer 里搜 `diff|clarify|plan|hunk|accept` **只命中 channels.ts 的通道名** ⇒
  **审批卡有，diff 审查/澄清表单/方案决议三卡没有**。自测 `apps/desktop/tests/` 9 条，
  **不在根 `pnpm test` 的取值域**（根跑 `tests/vitest.config.ts`），也不在 CI 那道命令里 ⇒ 这就是 **(c) 不满足**。
  注：隔壁已排期「桌面端 M2：驾驶舱主区完整化」八任务（`d8c0658`），本条不用重复立项。
- **旧差距「CLI 没有 fork/replay」→ 闭合**：`src/cli.ts:191` 收 `--replay/--fork/--from`，
  用法闸 `:235-267`，`forkSession` 的第二消费者就是 CLI（`src/cli.ts:964`），判卷 `tests/cli-fork-replay.test.ts`。
- **旧差距「diff 是整块文本」→ 闭合（限 worker diff）**：`reviewWorkerDiffs` 在每次 run 后无条件调
  （`src/cli.ts:713`、调用点 `:1134`，取消时跳），TTY 才进逐文件接受/拒绝（`:721`），非 TTY 打印手工合并提示。
- 可中断：`src/cli.ts:1159-1170`（第一次 Ctrl-C 置 `cancelling` + `handleRunCancel()`，第二次才
  `killAllTrackedChildren(); process.exit(130)`），判卷 `tests/cli-surface.test.ts:393-413`。

### 能力 9 · 工程化与成本控制
- **CI 是"看着有、跑不了"**：`.github/workflows/verify.yml:9-12` 的触发是 push/PR/dispatch，
  而 `git remote -v` **输出 0 行**（本轮实测）⇒ 这道门永远不会自动执行。
  `scripts/ci/README.md:24` 自己也标了「GitHub 上的首次真实运行本机无法验证」。
  更要注意它 `:31-33` 把 `gate-check`/`mutate-needles-check` 当"两道已知红"**排除**了——
  而这两道在今天的修复波里已经转绿（`outputs/plan-audit-2026-10-02/README.md` 附表），**排除名单过期了**。
- IDE 集成：**0**（`src/tools/lsp.ts:2` 是我们去连**别人**的语言服务器，且缺省关；不是编辑器接入面）。
  PR 流程：**0**（`gh`/分支保护/changes-requested 全域无实现）。
- 路由三件套仍**不在默认路径**：`src/main/settings.ts:114 routingBandit: false` / `:115 routingCascade: false`，
  `agent-runner.ts:344-350` 只在开关为真时才置 `routing: true` ⇒ **(b) 不满足**（理由文档里写了：没有基准读数不敢改花钱行为——
  而现在**有**读数了，见能力 10）。
- 成本面：`promptCache: true`（`settings.ts:120`）、沉淀轮前缀修复已入库（`memory/distill.ts:61-62` 98.8%）、
  `maxBudgetUsd: 0`（`settings.ts:108`＝缺省不拦）、`usage-attribution` 已补生产端（`:38-41`）、
  并发帽 `orchestrator-config.ts:5 = 4`、调度并发 `scheduler.ts:42 = 2`。
- **本轮新点名**：`src/agent/cost-per-progress.ts` **仍然零生产消费者**——只有
  `scripts/cost-per-progress-check.ts` + 判卷在用它，而它**在 CERT_GATES 里**（`scripts/gate-manifest.ts:50`）。
  这与基线点名的 `no-progress.ts` 是**同一种形状**（判据＋门齐、运行时不消费），
  `no-progress` 昨天接了，`cost-per-progress` 还挂着 ⇒ 「有尺没接线」第 20 次命中。

### 能力 10 · 评估与持续迭代
- **更正旧记录（这是本轮最大的一条）**：`_audit2-capability.md:128` 与 `BLOCKED.md` 的
  「**没有一次真模型基准读数**、三 env 全 absent」**已经过期**。
  实测：`outputs/eval-base-a/readings.json` + `outputs/eval-base-b/readings.json` 是**同一套 12 条任务、真模型、连跑两次**
  （`0553b05`，2026-10-01 18:26），逐条带 `requests/tokensIn/tokensOut/秒/RSS 峰/CPU`，
  事件流里 `cacheReadInputTokens` 有真值（`B1-…events.jsonl` 里 7 笔 usage）。
  那次读数本身也是全仓最有用的一条噪声底：**成功率 75% vs 67%、输入 token 差 20.6%**，
  ⇒ 「token 收益必须 >≈21% 才测得出」「成功率收益必须 >1 条任务」这两条硬规矩就是它给的。
- **但要说清它是什么、不是什么**：这是**本仓自己的夹具基准**（`fixtures/bench/tasks.json`，12 条自包含 JS 靶子），
  **不是外部基准**。业主第 10 条点名的 SWE-bench Verified / Terminal-Bench / Aider Polyglot 三个都没有：
  `src/agent/eval/task-set.ts` 的 SWE-bench 形态解析器在（`--swebench`/`--feasibility`，零花费探针在 `loop-eval.ts:500-509`），
  但**全仓唯一的外部语料是 2 行样本**（`outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl`）。
  ⇒ §9.5 那条"或明确登记因无凭据未做"**同样过期**：现在的真实原因是**没有语料**，不是没有凭据。
- **新查出的假读数（本轮唯一一条"0 而不是不可知"）**：两次真跑 24 行 `cny` **全是 0**
  （输入合计 912,402 / 1,121,590 token），而 `scripts/loop-eval.ts:75-76` 的缺省价是 0.8 / 2.8 ¥每 M
  ⇒ 按公式 B1 应是 ¥0.035 而不是 0。两种可能：跑的时候 `EVAL_PRICE_IN/OUT` 被显式置 0，或工件被后处理过——
  **两种都在工件里没留出处**（`outputs/eval-base-a/` 只有 `readings.json` + 12 份事件流，无 stdout 留档）。
  后果有两条：① `$/成功任务` 这条业主要求并列的轴，在**唯一的真模型基准**上是坏的；
  ② `0553b05` 那张表给了 5 个指标、独缺 `$`，读者会读成"顺带没写"，不会读成"量不出来"。
- **根因不在价表，在链路**（本轮亲自复查实据）：`createUsageAttributor` 的**唯一**调用点是
  `src/main/agent-runner.ts:1599`（生产会话落盘的漏斗），而 `scripts/loop-eval.ts:338` 自己装 provider、自己写事件流
  ⇒ **基准面绕过了归因层**，所以 12 条基准的 24 份事件流里 `usage` 键只有
  `[type,inputTokens,outputTokens,cacheReadInputTokens,ts]`，**没有 model**（实测 keys 打印）。
  这正是基线 09-27 那次修的**同一族**：生产端补了，**度量台那一支没补**。
  同一条判据要写两半：`cny` 恒 0（结果）+ 事件无 `model`（归因键）。
- `scripts/eval/report.ts:154 noiseBand()` + `:57 "beyond-noise"|"within-noise"` 已接 `pnpm eval-report`，
  判卷 `tests/eval-report.test.ts`（22 条）——**尺是好的，坏的是喂给它的数**。
- 「≥12 条 × `--reps 3`」这个 §9.1 形态**仍不存在**：现存是 12 条 × rep1 两趟（`eval-base-a/b`）、
  2 条 × reps[1,2]（`eval-reps-check`）、3 条 × rep1（`outputs/bench/readings.json`）。

---

## 三、复测顺带查出的东西（按可修性排）

| # | 事实 | 证据 | 性质 |
|---|---|---|---|
| 1 | 基准事件流**绕过**用量归因层 ⇒ 钱轴不可定价 | `src/main/agent-runner.ts:1599`（唯一调用点）vs `scripts/loop-eval.ts:338`（自装 provider）；24 行 `cny` 全 0 | **缺陷**（假读数：0 而非"不可知"） |
| 2 | CI 排除名单过期：它排除的两道门今天已经绿了 | `.github/workflows/verify.yml:31-33` ↔ `outputs/plan-audit-2026-10-02/README.md` 附表 | **陈旧工件** |
| 3 | 无 remote ⇒ 整条 CI/PR 路线是纸面的 | `git remote -v` 空 | **前提缺失**（要业主拍：给不给远端） |
| 4 | `costPerProgress` 有判卷、有门、**零生产消费者** | `scripts/gate-manifest.ts:50`、`src/` 全搜消费者 0 | **"有尺没接线"第 20 次命中** |
| 5 | `skills.ts` 注释「运行期注入 13 把」对不上现表（16） | `src/agent/plugins/skills.ts:55` ↔ `src/agent/tool-surface.ts:20-53` | 模型可见文本过期（本仓第 4 次同族） |
| 6 | `mcp__` 前缀恒"已知"，M7 的翻默认对它不生效 | `src/permissions/tool-registry.ts:44-46` | **已知残余**，注释称刻意，但未验收 |

---

## 四、下一波该干什么（复测的用处就在这里）

排序原则：**(i) 让「闭环」有真读数的事优先；(ii) 只改装配/尺子、不动判据的小步优先；(iii) 要花真钱的先摆上代价等拍板**。

1. **给能力 1 造那把缺的尺**（本轮唯一一条"能力等级被一把尺卡住"的）：
   `fixtures/` 加一组「自然语言问题 → 期望文件/符号」真值集，量 top-k 命中率，接进 `map-check`。
   不引向量也能先量——**先有分母再决定要不要 embedding**（本仓「存量水位法」的常规顺序）。
2. **修钱轴那一格**：让 `loop-eval` 复用生产会话的落盘漏斗（或在 readings 里带 `model` + 价对），
   并把「算不出价」写成 `null` + 一行出声，**不再印 ¥0.0000**。判卷写两半（码 + 被点名的原文）。
3. **两个"上不上默认路径"的裁决**（工程量近零，纯产品决定）：
   `diagnose`/`web_search` 的缺省挂载（不配置时给不给只读探测面）、调度器随 `--goal` 常驻还是保持 `--serve`。
4. **「目标漂移」先按零花费的姿势做一次**：`outputs/eval-base-a|b/` 里已经有 24 份真模型事件流，
   B12 单条 27/28 个请求、20 个文件——**先在盘上算，不再花钱**。要抽的是同一件事的三种形态：
   中途改口（`user_message` 的目标与最后一次 `assistant`/`plan_proposed` 的措辞偏离）、
   重复同一 `(工具,参数)`（`repeatedSameAction` 字段已在 readings 里，B12 两趟都是 0）、
   以及**跑着跑着不再碰最初那个失败面**（B12 的 `readsBeforeFirstWrite=0`、`plannedBeforeWrite=false` 是两条现成线索）。
   盘上量不出来的那一格（模型自己没说出来、但心里改了目标）才需要新跑，**一次 12 条 ≈91 万输入 token**，要业主点头。
5. **桌面 M2 已在隔壁排期**（`d8c0658`）⇒ 本轮不立项，只把它的测试纳入根门/CI 这件事挂给集成 owner。

---

## 五、诚实标注

- 本轮**没有跑**判卷、门禁、typecheck、真模型 ⇒ 上面所有「判卷存在」「反向验证已贴」是**读文件**得来的，
  不是**执行**得来的；隔壁此刻占着 `gates.ts`（PID 74264，`--only=no-progress-check,…,test`）。
- 本轮**没有改任何产品源码**；新落盘的只有本目录一份。
- `cny` 全 0 的**根因**我只证到「链路绕过归因层 + 工件无价对出处」这一格，
  **没有**证明跑的时候到底传了什么 env（没有留档，也无从复现——那正是第 1 条缺陷的一部分）。
- **本报告的自我更正一处（已改在原地，不悄悄改）**：第一次落笔时我在能力 4 写「今天真跑的 12 条基准里最长的
  B12-long-horizon 也只有 7 个请求」——那是**把 B1 那一行的 `requests:7` 当成了全表极值**。
  复核（回逐笔原始数取 max）后真实值是 **27（跑 A）/ 28（跑 B）个请求**。
  ⇒ 立的写法：**"最长/最贵/最多"这类极值只能回原始行取 max，不许从看过的第一行外推**；
  这一格改完之后，下一波第 4 项的方向也跟着变了（从"要花钱再跑一次"变成"盘上已经有数据、先零花费地算"）。
- 四路复查找出的 `file:line` 中，会翻转判定的 3 处（钱轴 keys、`createUsageAttributor` 调用点、桌面 6/41 通道）
  由主会话**亲自复跑命令**复核；其余按 sweep 原文转述，逐条给了路径可自行复核。
- 「已实现 3 条」这个数字**不等于**退步：基线的 3 条各自带着未补的洞（能力 7 的 fail-open、能力 6 的零机制），
  今天这三条的洞都补上了，而 7 条部分实现里有 4 条只剩"一把尺 / 一次裁决 / 一个远端"。

---

# 附：同日追加的零花费读数（把第四节第 4 项做完之后翻出来的东西）

取料面（全名逐支，都在本目录）：`longrun-ladder-run1.log`、`verify-beat-shape-run1.log`、`judge-clause-split-run1.log`。
新落盘一把尺：`scripts/replay/longrun-ladder.ts`（**名字不含 "check" ⇒ 不进 `gate-manifest`、不改热文件**，与 M6 那两把 replay 尺同形状；
判据**逐字共用**生产端那一只 `judgeNoProgressEvents`，不自己再算一遍）。跑的对象是 `outputs/eval-base-a|b/` 的 24 份真模型事件流。
**这一笔没有改任何源码。**

### 结论一句话
**12 条基准任务的 y 轴今天退化成同一个布尔：「模型有没有往 `tests/` 里写过东西」；而这个布尔把两种相反的行为判成了一条。**

### 逐条

1. **退化是怎么发生的（可复算，不是印象）**：`fixtures/bench/tasks.json` 的 12 条任务 `expects` **完全同一条**
   —— 现读枚举结果 `{"verifyOk+judgeUntouched": 12}`。而 24 趟里 `verifyOkLast === true` 的是 **24/24**
   ⇒ 成功率里**只剩 `judgeUntouched` 一个变量能动的了**。也就是说这批基准**测不出"代码对不对"**（24/24 都绿），
   它测的是"手有没有伸进 tests/"。
2. **而那一格把好事和坏事判成同一条**：`scripts/loop-eval.ts:415`
   `isJudge = p.startsWith("tests/") || p.endsWith(".test.ts") || p.endsWith(".test.js")` ——
   **新建**一个回归测试与**改写种子的判卷文件**在尺子上同值。按各任务**种子的文件清单**（`git ls-files fixtures/bench/<dir>`）分开重算 24 趟：

   | 形状 | 趟数 | 明细（跑/任务/被写的文件） |
   |---|---:|---|
   | **真改了种子的判卷文件** | **4** | a/B4→`tests/api.test.js`、a/B5→`tests/queue.test.js`、b/B3→`tests/receipt.test.js`、b/B4→`tests/api.test.js` |
   | **只新增测试文件**（被判成同一条 FAIL） | **3** | a/B7→`tests/rfc4180.test.js`、b/B5→`tests/queue-regression.test.js`、b/B8→`tests/service.concurrent.test.js` |
   | 没碰 `tests/` | 17 | — |

   ⇒ 现在发布的「**7 条 FAIL**」里，**3 条是业主第 5 条点名要的动作**（"主动写测试、跑测试"）被判了红。
3. **修好之后的数（同分母、同两趟，只换判卷条款）**：跑 A 真改判卷的是 `{B4, B5}`、跑 B 是 `{B3, B4}`
   ⇒ 两趟同为 **10/12 = 83.3%**（发布值是 75% 与 67%）。**逐任务仍有 1 格翻转**（B3：跑 A 没动判卷、跑 B 动了），
   而发布值里那 **3 格翻转有 2 格（B7、B8）纯粹是"这一趟顺手补了个测试"**。
   ⇒ 对 `0553b05` 立的那条规矩（「成功率收益必须 >1 条任务＝8 个百分点才测得出」）的影响要说准：
   **它不是被推翻，是被推到边界上**——修正后同配置两趟的翻转从 3 格缩到 1 格＝**噪声底就是 1 格**，
   那句"必须 >1 条"在修正后的尺子上**刚好等于噪声**（原来它比噪声大 3 倍）。所以判据要改成
   **「≥2 格翻转才算动过」或者把 reps 提到 3**，而不是继续引用发布值。
   ⚠️ 这是**在一对被污染的 y 轴上重算出来的**，正式改规矩要换好尺子后重测 ≥3 趟（见第 5 项）。
   token 那一半（差 20.6%）**不受影响**——它不经过判卷。
4. **昨天刚接线的无进展阶梯，在这批真语料上开不了口**：24 趟的 `verify` 拍数分布是 **`[[1, 24]]`**（每趟恰好 1 拍），
   而 R1 验证停滞的定义要 **≥2 拍**（`detectVerifyStagnation`，`minRepeats = 2`）⇒ **结构性不可达**；
   整条流回放的阶梯开口数 **0/24**（三只信号都"首个命中即返回"，所以整条流判出的命中点就是生产端最早能开口的点）。
   再加上第 2 项那一格：**7 条红跑的仅有那一拍全是 `ok=green`、且 `who=model`、`autoVerifyBeat=false`**
   ⇒ 停滞这种形状在基准上根本没出现过。结论要说准：**M10② 的接线本身没问题（5 条判卷＋反向验证在），
   缺的是"真轨迹能喂出它的输入"**——今天这条缺口有数了，之前是猜的。
5. **建议的改法（都不动生产代码，动的是尺）**：
   ⑴ 把 `judgeUntouched` 拆成两条具名条款：`seedJudgeEdited`（写到了**跑前就存在**的判卷文件 ⇒ 仍判红）
   与 `testAdded`（新建 ⇒ 单独计数、不判红）。**现成锚点**：`loop-eval.ts:402` 已经算了跑前文件清单
   `orig = (await listFiles(appDir)).filter(...)` —— 拆条款只是把 `isJudge` 从"路径形状"换成"是否 ∈ orig"，
   不需要新数据、不需要花钱。配一条纯函数判卷（两态同输出＝没接线，本仓第 4 形态）。
   ⑵ 更硬的一层：**跑完由 harness 独立重跑一次"只含种子判卷文件"的验证面**，让自评与自写测试都不能当验收
   —— 这一条把第 1 项那格退化彻底关掉（模型自己写的 `tests/rfc4180.test.js` 既不能帮它也不能藏它）。
   ⑶ 要"完成率"这条轴有分辨力，得**加带 held-out 验收的题**（SWE-bench 形态的 FAIL_TO_PASS + 模型看不见的判卷），
   这是业主第 10 条本来就点名的东西；**在此之前，任何"成功率涨了"的说法都只能指向上面那一个布尔**。
6. **反转条件（什么时候我这套读数是错的）**：若 `judgeUntouched` 的**本意**就是"任何 `tests/` 写入都不许"
   （因为新增文件会改变 `pnpm test` 到底跑了什么），那第 2 项那 3 条不是误判而是**故意的**——
   那样的话结论要改成「基准的 y 轴=不许动 tests/」这一条**明写在题面上**，并给"补回归测试"另设加分条款。
   这条我判不了，属产品裁决（`0553b05` 提交信息里那句"5 条'改过判卷面'仍判 PASS"说明作者是在意这个洞的）。

---

# 附二：能力 1 那把缺的尺，建出来了（同日，零花费，新工具 `scripts/probe-locate-recall.ts`）

取料面（全名逐支）：`locate-recall-run1.log`（首版，只跑 1024）、`locate-recall-run2.log`、`locate-recall-run3.log`（带预算诊断）。
题面与真值：`fixtures/locate/dsh-questions.json`（14 条真值题，**每条真值自带 `file:line` 凭据**，读者可自行复核）。
尺的形状：问句 → 首轮地图（`buildMap`，缺省 1024 token 预算）→ 真值文件在渲染结果里的**位次**；
两臂 A＝条件化（正则逐字镜像 `src/agent/glm-session.ts:784,793`）／B＝不条件化（纯 PageRank）；预算扫 `[1024,2048,4096]`；
正哨兵＝枢纽文件 `src/main/settings.ts` 必中、负控＝不存在的路径必不中。

### 先说被自己抓住的一次（这一格决定后面所有数能不能信）
首版跑出来**正哨兵 0/1（期望 1/1）**——枢纽文件 `settings.ts` 居然不在地图里。
按「哨兵失败先怀疑尺」的规矩，我没有直接发布这条，而是先做两次证伪：
⑴ **预算旋钮到底动没动**：`locate-recall-run3.log` 逐题打印渲染规模 ⇒ 1024→2048→4096 时
地图文件数 **58 → 97 → 130**、tokens **911 → 1887 → 3731**——旋钮是活的，**位次在四倍预算下一格不动**
（第 8／14／26／35 名在三个预算上完全相同）⇒ 所以 MISS 不是"窗口装不下"，是**排不进前列**；
⑵ **是不是我的解析瞎了**：`tmp/diag-locate.mts` 直接对原始 `built.text` 做子串包含 ⇒
`settings.ts`／`no-progress.ts`／`sandbox.ts`／`snapshot.ts` **连 basename 都不在**，而 `verify.ts` 在 ⇒ 解析没问题，**图里真没有**。
两次证伪都过了，下面的数才敢发。

### 读数
1. **典型中文请求根本喂不进条件化**：16 题里 **10 题的 `mentionedIdents` 与 `contextFiles` 双双为空**
   ——生产端那两支正则只认拉丁字符（`:793` 要 4 个以上 `[A-Za-z0-9_]`；`:784` 要路径形状）。
   ⇒ 这类请求下**每一轮拿到的都是同一张不条件化的地图**（911 token），A/B 两臂按构造同图，
   所以"条件化有没有用"这件事**只能从含标识符的 6 题里判**（那 6 题里 L11 是唯一被条件化捞回来的：
   A 臂第 8 名命中、B 臂 MISS）。
2. **定位命中：14 条真值题里 A 臂只中 4 条（28.6%），且 4 倍预算下仍是这 4 条**。命中的位次是 8／14／26／35（共 58 个文件）。
   没中的 10 条正是"人最常问的那批生产枢纽"：`usage-attribution`、`tool-surface`、`snapshot`、`apply_patch`、
   `scheduler`、`map/rank`、`settings`、`sandbox`、`model-surface`、`no-progress`（无标识符那条）。
3. **地图被什么占着（这一条比命中率更要紧）**：1024 档的 58 个文件里 `src/` 39、`apps/` 12、
   `fixtures/` 4、`scripts/` 2、`tests/` 1——而**排名 3～6 名全是靶场夹具的副本**
   （`fixtures/gym/cases/{config-default,order-pricing-triple-fix,sum-clamp,todo-completed-count}/repo/tests/run.mjs`）；
   预算提到 4096 时 130 个文件里 **非 `src/` 占 59%**（fixtures 30 + scripts 32 + outputs 15），
   而 `src/` 那份**始终是同样的 39 个文件**（饱和了，加预算也不多给生产代码一个位置）。
4. **机制（不是"再调调预算"能解决的）**：图边按**标识符同名**建（def/ref 双端点），
   于是靶场副本里 `def failures`／`def readFile` 这类与真代码**重名**的节点互相加权，
   把靶子文件顶到前排；而 `src/main/settings.ts` 的消费者是 `import { loadSettings } from "../main/settings"` 这种
   **路径形状**的引用，路径本身不进图。⇒ `fixtures/impact` 那套真值探针（合成 10 文件 / 16 边，precision=recall=1.000）
   **看不见这一类错**，因为它没有重名夹具、也没有靶场副本。这就是"边集真值 1.000"与"定位 28.6%"能同时成立的原因。

### 这把尺换出来的下一波（按代价排，都不动生产语义）
- **① 图的文件域**：`fixtures/**`、`outputs/**`、（建议）`scripts/**` 不进地图——靶场副本是**故意写坏的种子**，
  让它占住排名 3-6 没有任何收益。现成锚点：`src/agent/map/cap.ts` 的候选切片与 `scanSourceFiles`。
  回归证人就用本尺（期望：L-POS 从 MISS 变命中、`src/` 份额上升、命中率上抬）。
- **② 边要按模块路径限定**（同名不同模块不许互连）——这条比①贵，且会动 `impact` 的边集真值，
  属"改判据同笔改锚点"那类账（规则 216/217），要单独一笔。
- **③ 中文请求的条件化入口**：`glm-session.ts:776,789` 那两只是局部闭包，先**改成模块级导出**、
  让本尺 import 而不是镜像（现在注释里钉了"改了正则不改这里，A 臂就撒谎"），再谈要不要加拉丁之外的取词。
- **④ 语义检索（向量）该不该做**：①②③做完仍不够，才轮到它——**顺序别倒**，
  因为①②是零依赖零花费的，而向量要么引依赖要么花真钱。

---

# 附三：往下追了一层，结果**把我自己在附二里写的机制归因改了一半**

追法：不碰生产代码，按 `rank.ts` 那一套公式复算全仓入边质量。
取料面（两支都可复跑，**须在仓库根跑**——它们用 `process.cwd()` 当工作区）：
`diag-hub.mts` → `diag-hub-run1.log`（按名入边与 phantom hub 明细）、
`diag-weigh.mts` → `diag-weigh-run1.log`（现状／一票平分／平分＋IDF 三臂名次）。
⚠️ 引用这些绝对名次要带日期：两次跑之间候选文件数从 **763 漂到 762**（隔壁会话在动树），
`src/agent/ledger.ts` 的现口径质量也从 1681 变成 **1671**——名次会随树漂，别当成读数错。

### 一、真正的phantom hub 是怎么来的（比"靶场副本挤占"更基本）
`buildGraph` 里 **import 绑定被当成 def**，而 ref→def 是**同名全连接**（`rank.ts:126`），
于是"**谁先把某个常用 builtin 引进来，谁就成了全仓引用这个名的节点的入边靶心**"：

| 名字 | 同名 def 数 | 引用它的文件数 | 命中的乘子 |
|---|---:|---:|---|
| `describe` | 0 | 276 | ≥8 字符 ⇒ ×10；def≤5 ⇒ **不触发** `:124` 的 ×0.1 阻尼 |
| `writeFile` | 1 | 133 | 同上 |
| `readFile` | 1 | 107 | 同上 |
| `afterEach` / `readFileSync` / `fileURLToPath` / `createEventLog` | 0-1 | 101 / 80 / 72 / 71 | 同上 |

现口径下全仓入边质量前 8：`tests/secrets.test.ts`=2248、`src/agent/ledger.ts`=1671、
`scripts/lib/mutate-gates.ts`=1635、**四条靶场 `run.mjs`≈1558**、`src/events/index.ts`=1396。
`ledger.ts` 那 1671 里 `readFile` 一个名就吃 107 个引用方 ⇒ **它不是枢纽，是撞名撞出来的**。

### 二、两种修法各自把谁抬上来（同公式复算，名次/共 762 文件）
| 文件 | 现状 | 一份引用只算一票（按同名 def 平分） | 平分 ＋ 按引用方文件数打 IDF |
|---|---:|---:|---:|
| `src/permissions/autonomy.ts` | — | 进前 8（1089） | 进前 8（516） |
| `src/main/agent-runner.ts` | 第 9 | 第 5 | **第 3** |
| `src/main/settings.ts` | 第 105 | 第 97 | **第 122（更差）** |
| `src/tools/grep.ts` | 第 275 | 第 297 | 第 302 |
| 四条靶场 `run.mjs` | 前 8 内 | **跌出前 8** | **跌出前 8** |
| `src/agent/ledger.ts` | 第 2 | 第 2 | **跌出前 8** |

### 三、所以附二那句话只说对了一半（就地更正）
附二写「机制＝边按同名标识符建，靶子与真代码重名互加权 ⇒ 生产枢纽进不了地图」。
**前半成立、后半不成立**：撞名全连接确实造出 phantom hub（靶场副本、`ledger.ts` 靠 `readFile`），
但**把权重修好也不解决定位**——`settings.ts` 的按名入边总量本来就只有 12，
它进不了地图不是因为被挤掉，而是因为**PageRank 概览图根本不回答"哪个文件定义 X"这类问题**。
⇒ 附二里"这就是边集真值 1.000 与定位 28.6% 同时成立的原因"这句**过度归因，以此处为准**：
两个数都真，但它们是**两条独立的因**（权重被撞名劫持 ／ 缺一条按问题检索的定位面）。

### 四、由此拆开的三件事（各自有独立证人，别再捆在一起）
1. **权重修**（`rank.ts:126` 全连接 → 一票平分；`:122` 的 ×10 长度加成与 `:124` 的 >5 阻尼之间那个悬崖）：
   证人＝本附三的复算表（靶场副本与 `ledger.ts` 跌出前 8、`autonomy`/`agent-runner` 进前 8）。
   代价＝动 aider 照抄口径 ⇒ 边权族判卷与锚点要同笔改指（规则 216/217），单独一笔。
2. **文件域**（靶场副本／`outputs/**` 不进图）：与 1 有重叠收益，比 1 便宜（`NOISE_GLOBS` 一处，`build.ts:18`）。
   但**要先裁决**：地图的图里现在含 `tests/` 281 个文件、`fixtures/` 184 个（占候选 63%），
   排除哪些是产品口径（"地图是给谁看结构"），不是我能替业主定的。
3. **定位面**（缺的那把真尺）：`settings.ts` 这类"低扇入但常被人问"的文件，
   只能靠**按问句检索**回答——现成形状是把地图那套 PageRank 换成/加上
   **倒排 + IDF 的词法检索**（零依赖、零花费，本尺直接当回归证人：期望 4/14 上抬、L-POS 转命中），
   向量检索排在这之后。附二第 ④ 项的顺序按这条改。

---

# 附四：把 ①（权重修）真做进一棵 worktree，结果是**裁否**——并且推翻了我自己在附三第二节的外推

做法：`.worktrees/locate-weights`（detached @ `36a9ec6`，node_modules 软链回主树），
改 `src/agent/map/rank.ts` 的 ref→def 边权为「一票按同名 def 候选平分 ÷ log2(1+引用方文件数)」，
并按规则 216/217 同笔改指那条钉住边权的判卷（`tests/map-rank.test.ts` 的 `mul 规则`，
6 个 def 那一格从 `×0.1` 改成 `×0.1 ÷ 6`）＋**新增一条只有新规则才看得见的判卷**
（同名 2 def ⇒ 权重折半；一票的**总**质量与候选数无关；rf=3 ⇒ ÷2；反向证人：单一 def 且 rf=1 时两个因子都必须恰为 1）。

### 读数（改前 / 改后，同一棵树、同一把尺）
| 量 | 改前 | 改后 |
|---|---|---|
| `probe-locate-recall` A 臂命中（三个预算各一遍） | **4/16**（B 臂 3/16） | **4/16**（B 臂 3/16）——一格没动 |
| 1024 档地图组成（58 文件） | `src` 39 / `apps` 12 / `fixtures` 4 / `scripts` 2 / `tests` 1 | **逐字相同** |
| 1024 档**前 12 名** | `tests/secrets.test.ts`、`src/agent/ledger.ts`、**四条靶场 `run.mjs`**、`src/events/index.ts`… | **前 12 逐字相同** |
| 4096 档 | 188 文件、非 `src/` 占 **79%**、`fixtures` 112 | 135 文件、非 `src/` 占 **71%**、`fixtures` 30 |
| 判卷 | 35 条（map 族 7 文件） | **36 条全绿**（＋1 条新判据），`typecheck` 0 报错 |

⇒ **裁定：不并树。** 它该修的那一格（靶场副本占住排名 3-6、`ledger.ts` 靠 `readFile` 撞名当枢纽）**一点没动**；
动到的只有长尾（4096 档的 fixtures 从 112 降到 30）。用"要付的代价"衡量也不划算：
改的是 aider 照抄口径的边权、要连带动锚点，而收益不在任何头条读数上。
留档：`rank.ts.proposed`、`map-rank.test.ts.proposed`、
`compose-before-36a9ec6.log` / `compose-after-weightnorm.log`、
`locate-recall-before-36a9ec6.log` / `locate-recall-after-weightnorm.log`、`compose.ts`。

### 我错在哪（这一格比读数值钱）
附三第二节那张"两臂对照名次表"是**我自己写的代理量**（`diag-weigh.mts` 直接按公式加总"某文件的按名入边质量"）
算出来的，它给出的预言是"改完权重，靶场副本与 `ledger.ts` 会跌出前 8"。
**真机（`buildMap` 的实际 PageRank ＋ 渲染次序）不认这个预言**：前 12 逐字不变。
差别在于代理量漏了三件事：⑴ 平分只削弱"每个候选拿满票"，但 284 个引用方**每个都投给全部 4 个副本**，
每副本仍得 ≈71 票，相对真实枢纽（总票 12）仍是压倒性的；⑵ PageRank 还会沿边传播，副本之间互推；
⑶ 渲染是"节点序前 k 个"，一个文件只要有一个节点进前 k 就占一格。
⇒ 立的写法：**凡预言"改了 X 会让排名/结果变成 Y"，只能用被改对象自己复算，不许用我手算的代理量**
（与本文 ⑥"报缺陷前先把真实字节喂给被测函数"同课，这次错在反向：拿代理量当预言发布）。
附三第二节那句"靶场副本与 `ledger.ts` 跌出前 8"**只在代理量上成立**，以本附四为准。

### 那 ①/② 还剩什么
剩下唯一的真因还是**名字级全连接本身**：`import { readFile } from "node:fs"` 在现实中**不该在仓内产生任何边**，
现在它把每个 import 该 builtin 的文件变成一条指向"某个仓内同名 def"的票。
所以真正的修法是 **边要按模块路径解析**（`parse.ts` 已经在抽 tags，但没有 import 的 source 字段可用；
要做的是：import  specifier → 解析到仓内文件才建边，解析不到（`node:*`／裸包名）就**不建边**）。
这条比我刚试的归一化贵一档（要动 `parse.ts` 的 tag 形状＋impact 边集真值），但它是**唯一能真正挪动前 12 的修法**——
本附四的实测正是它的立项理由。

---

# 附五：rev 4（成员名不接跨文件 ref）实做＋实测，并且顺出一条**更大的**：波及面把"撞名"当成"影响"

## 一、rev 4 是怎么来的（不是我发明的新族，是本仓 rev 2 的同族第二闸）
`parse.ts:200-225` 早就有 `isLocalVariableBinding`，注释逐字写着「局部变量**根本不可能**被另一个文件 import
⇒ 把它当跨文件符号等于凭空造依赖」，并用实测挡下 `i`(187 个"定义")／`p`(119 个)。
但它明说「只闸 `variable_declarator` 这一种，其余 def pattern 抽的是函数/类/接口…闸它们**没有这份证据支撑**」。
**本轮量到的就是那份缺失的证据**：`src/agent/ledger.ts:136` 是货真价实的 `private async readFile(...)`
（一个类成员），却吸进 **107 个文件**的同名 ref ⇒ 载体从"局部变量"换成了"成员名"。
于是照同一纪律加第二道闸：`SymbolTag.crossFile?: false`（**可选**字段 ⇒ rev 3 之前落盘的所有缓存语义不变）、
`isMemberPositionName` 按位置比不按对象比（rev 2 踩过 `===` 恒 false 的坑，注释里点名了）、
`EXTRACT_LOGIC_REV` 3→4（`parse.ts:126` 写的规矩：改判断要手工 +1，否则"改了没反应"）。
`buildGraph` 侧：成员名只接**同文件**的 ref（类内自调用照旧连）。

## 二、读数（同一棵 worktree，改前/改后各跑一遍真对象）
| 量 | 改前 | 改后 |
|---|---|---|
| `typecheck` | 0 报错 | **0 报错** |
| map 族＋impact 族判卷（9 个文件） | 55 条全绿 | **55 条全绿**（零回归） |
| 地图前 12（1024 档） | `tests/secrets.test.ts`、**`src/agent/ledger.ts`**、4×靶场 `run.mjs`、`src/events/index.ts`… | `tests/secrets.test.ts`、4×靶场 `run.mjs`、`src/events/index.ts`… **`src/main/agent-runner.ts` 进前 12** |
| 1024 档组成（58→57 文件） | src 39 / apps 12 / fixtures 4 / scripts 2 / tests 1 | src 36 / apps 13 / fixtures 4 / scripts 2 / tests 2 |
| `probe-locate-recall` A 臂 | 4/16（三档预算同） | **4/16（三档预算同）** |

⇒ **假枢纽确实被拆掉一根**（靠 107 条凭空边占住第 2 名的 `ledger.ts` 出局，真实枢纽 `agent-runner` 顶上来），
**但可定位性一格没动**——这与附三第三节的结论同向：`settings.ts` 那类低扇入文件不是被挤掉的，
PageRank 概览面本来就不回答"谁定义 X"。靶场四条 `run.mjs` 也还在（它们的 `failures` 是模块作用域的
`let`，不属于成员闸的对象）。
留档：`parse.ts.rev4`、`rank.ts.rev4`、`tests-rev4-map-impact.log`、`typecheck-rev4.log`、
`compose-rev4-membergate.log`、`locate-recall-rev4.log`。
**状态：停在 worktree，不并树**——它**还没有配判卷**（要改 `tests/map-parse.test.ts`，
那支文件的 sha 在冻结表里 ⇒ 属热文件账），且 rev 4 的另一半价值在 impact 侧（见下）。

## 三、顺出来的更大一格（HEAD 现读，未改任何代码）：波及面把撞名当影响，而模型看不见"这是撞名"
```
upward(graph, "readFile")  →  261 条边 / 107 个文件
样例：scripts/gates.ts, scripts/head-cert.ts, scripts/gate-check.ts, outputs/.../probe.ts …（都是调 fs.readFile 的无关文件）
定义方 src/agent/ledger.ts 自己反而不在这 107 里
```
`impact/index.ts:279 upward(graph, symbol)` 的入参**只有符号名**（没有文件/类限定）⇒ 同名即同符号。
而 `fileImpact`（`:359-361`）**已经算出了 `ambiguousSymbols`**，注释逐字写着
「同名歧义：这个符号在别的文件也有一份定义 ⇒ 它的 upward 清单里混着"那份定义的调用方"」。
**但是：`contextNoteFor`（`:386-427`）整段没有读 `ambiguousSymbols`**——它注入给模型的那句话是
「`[impact] <file> 定义符号的跨文件调用点（上 N，波及 M 个文件…）`」，**M 里混着多少撞名，模型看不见**。
这一格同时踩在本仓三条已记案的病上：① 缺省开的写后回注（`settings.ts:129 impactAnalysis: true`）
⇒ 这是**默认路径**，不是边角；② M10 那族「harness 给模型一个假信号」（此处是**夸大波及面**，
会让模型去"顺手检查"107 个跟它无关的文件，正是返工来源）；③ 判据算了歧义却不披露＝本仓反复判死的
"分子在盘上、消费端当它不存在"。
边界要说清（不夸大）：注入行受 `IMPACT_CONTEXT_FILES` 帽限制，所以我**没有**测单次注入的字节数，
只证到"那句『波及 M 个文件』的 M 被系统性高估、且歧义信息在注入面被丢掉"。

## 四、由此拆出的两格（各自独立、都有现成锚点）
1. **披露**（便宜）：`contextNoteFor` 在 `r.ambiguousSymbols.length > 0` 时补一句"其中 N 个符号存在同名多定义，
   波及数按名字图算、可能偏大"——字段已经在 `FileImpactReport` 里，不新增数据。
   代价：改的是**模型可见文案** ⇒ 要配判卷（两态：有歧义／无歧义必须不同输出）并过 `prompt-surface-check` 面。
2. **共享判据**（贵一档）：把 rev 4 的 `crossFile` 用在 impact 的 def 索引上（成员名不接跨文件 ref），
   与 rev 2 拦局部变量并列成"名字图的两道同族闸"。
   代价：动边集 ⇒ `fixtures/impact` 真值与 `tests/impact-*` 判卷、以及相关锚点要**同笔改指**（规则 216/217）。
3. 附三第三节那句"import 绑定被当 def"**是错的**（`@def` 图案里根本没有 `import_specifier`）；
   正确的载体是**同名 def 全连 ＋ `upward` 只按符号名查**。以此处为准。
