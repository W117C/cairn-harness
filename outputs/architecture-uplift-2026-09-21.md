# 架构上行提案（对照六仓 harness 深挖 · 2026-09-21）

> 读物来源：`outputs/harness-deep-analysis-2026-09-21/`（六册：ZCode / 上游 deepseek-harness / oh-my-pi / cline / codex / opencode）。
> 本文是**结论层工件**：只登记「对照我们仓库的真缺口 + 本日实跑读数 + 判据 + 失效条件」，施工另起提交。
> 方法纪律：外部机制一律按**双向核验**判定有无——生产者与消费者两端都在才算已有；只在一端存在的，按本仓已知缺陷族（两头断）处理，不算已有也不算新能力。
> 行号仅作该日快照定位用，不作为找代码的唯一坐标（本仓规矩：指针禁写死行号）。

## 0. 结论先行

1. 六仓里被当作亮点的结构性机制，**大半我们已有等价物**（事件流先记账后执行、增量重放、命令静态判定、阈值摘要+prune 双级、CC 钩子兼容、MCP 分级入权限、清单即事实源的门禁、反事实回放靶场）。见 §1。
2. 真缺口共 6 条，其中 **3 条是「方案书已定稿、代码从未接」**（网络审批通道 §11.4 / 覆盖前快照 D7 §10.4 / 四模块禁区 §3.3）——不是新能力，是已入账承诺的空头。见 §2 的 1、2、6。
3. 架构层唯一值得动的复利改动 = **把执行面决策收成一份声明式契约 + 一条模型面预算闸**（§3）。它同时治本仓反复出现的两族缺陷：同族出口副本（超时 20 处/上限 20 处）与「规格与实现两处手写」。
4. code-mode / PTC（三家独立收敛）**方向接受、施工推迟**：现有靶面测不到它的收益（§2 第 5 条给出反向读数）。

## 1. 已有等价物（对照表，不必学）

| 外部机制（报告口径） | 我们的等价物 | 证据面 |
|---|---|---|
| 上游 DSH：tool/call 先落日志再执行、每次 dispatch 可从 session log 重建 | 同一不变量 + 事件 id = 1-based 行号 + **中段坏行必炸**（比上游更严） | `src/agent/loop.ts`（for-await 内先 append 再执行）、`src/events/index.ts` 的 `midBadLineError` / `replay` |
| codex rollout `reverse_jsonl_scanner`（resume 优化） | 按 (ino, 字节偏移) 的增量重放 + 按 path 串行链 + 有界缓存 | `src/events/index.ts` `replayIncremental` / `resolveHandle` |
| codex `execpolicy`（命令解析 + 前缀规则） | 链式拆分 + 归一 + 最长前缀匹配 + 解析失败按危险处理 | `src/permissions/rules.ts` `splitCommandChain` / `normalizeCommand` |
| 上游 compaction-basic + tool-result-pruner | 阈值摘要（三拒绝质量闸 + 降级链）+ 类型化裁剪（40k 保护区，原文落附件目录可回取） | `src/agent/compaction.ts` / `prune.ts` / `ledger.ts` + `obs_recall` |
| ZCode `architecture-policy.yaml` + 上游 ~40 verify 脚本 | `scripts/gate-manifest.ts` 清单即事实源 + 全量门 + 变异验证 + 恒真式/析取式体检（更强的可校验面） | `pnpm gates` 输出、`tests/gate-manifest.test.ts` |
| 上游 hooks 桥（吃 Claude Code hooks.json） | 同一兼容面（PreToolUse/PostToolUse/Failure + matcher + stdin JSON + 阻断回注） | `src/agent/plugins/hooks.ts`、`tests/hooks-*.test.ts` |
| 上游 subagent 委派 + workflow fan-out | spawn_agent 四模式 + worktree + 写租约 + sequencer + 崩溃恢复 + supervisor | `src/agent/orchestrator*.ts`、`worktree.ts`、`lease-conflicts.ts` |
| omp metaharness（experiment→run→trace + 凭据不出宿主） | gym 反事实回放（明卷/暗卷分套）+ fork 重跑 + 装配探针 + A/B 差分 | `src/agent/gym/*`、`scripts/gym-run.ts` |
| opencode 权限 schema 独立版本化 | 权限规则库 + scope 三档 + 双断路器 + 单调继承（判据面等价，形态不同） | `src/permissions/autonomy.ts` |

## 2. 真缺口（按「便宜读数先做」排序）

### 2.1 沙箱网络：审批面已经点了头，执行面从未放行（§11.4 悬空行）

- **外部原型**：codex `seatbelt_network_policy.sbpl` + `tools/network_approval.rs`（网络单独成面）；上游 DSH「被拒调用可经用户一次性批准升级重试」。
- **我们现状**：`src/main/sandbox.ts` 的 `buildSandboxProfile` 零条 network 规则（注释自陈「无任何 network 放行」）；`src/main/agent-runner.ts` 里 `run_shell` 只要沙箱可用就一律走 `runInSandbox`。权限层却认网络命令、并强制网络审批只能 `once`（`autonomy.ts` 的 `L4-network` 层 + `isNetworkCommandCall` 把 effScope 收成 once）。⇒ 用户批准了网络命令，OS 层仍拒。
- **本日实测（含负控）**：

  ```sh
  # 沙箱内 vs 不套沙箱，同一命令
  node --import tsx -e '…runInSandbox("curl -sS -m 8 … https://example.com")…'
  # IN-SANDBOX: curl: (6) Could not resolve host: example.com / rc=6
  # CONTROL(no sandbox): http=200 rc=0
  ```

- **判卷状态（本条有一处误读，已更正）**：⚠️ 初稿写「全站零网络断言」**是错的**——`scripts/sandbox-check.ts` 分支 A 第 ④ 段就是断网断言（`connect 1.1.1.1:80` 必须失败，且先断言 `applied(...)` 再断言被拒）。错因：只 grep 了「网络/network/curl」三个词就没读正文，而该段用的字面是「断网」与 `net.connect`。**真实的判卷缺口只有一半**：断言只钉了「默认必拒」，**没有钉「批准后必放行」**——因为放行通道本身不存在。
- **修法形状**：profile 两支——`buildSandboxProfile(root)`（现形态，默认必拒）与带 `{ network: "allow" }` 的放行支；**放行只由「人工批准过的网络命令」触发**（`verdict === "ask"` → approved 且 `isNetworkCommandCall`），auto 档自动放行与无人值守一律不得拿到网络（§11.4 红线：「任何档位下网络全开都不是免批条件」）；模型侧收到 harness 注记而不是裸 OS 串。
- **判据**：① 默认 profile 下本地回环连接失败（不出网，用进程内 listener 当靶）；② 放行支下同一连接成功；③ 判定为「网络被拦」的分类函数抓得住真实 OS 串；④ 反向对照：auto 档 / 未批准路径必须走默认支（放行面不得免批）。
- **失效条件（挂在可判读事实上）**：`sandbox-check` 出现「放行支连接成功」断言 ⇒ 本条作废；宿主拒 apply profile（降级分支 B）时以分支 B 的断言口径为准，不得当作通过。
- **未做项（留尾，附理由）**：`NETWORK_RE`（`src/permissions/risk.ts`）不认 `git clone/fetch/pull`、`npm i <pkg>`（非 -g）、`pip install <pkg>` ⇒ 这些命令拿不到放行资格（行为与今日一致，只是不改善）。**刻意不并入本单元**：分类面与在飞的 shell 绕过修复（`outputs/shell-permission-bypass-2026-09-21.md`，红 24/绿 9）同邻居，两个会话同时改 `risk.ts` 会互相盖掉判定。
- **成本**：小（一个 profile 参数 + 一处审批回灌 + 三条门断言）。

### 2.2 覆盖前快照（D7）：三处引用，零实现，且未入账

- **方案书原文**：`agent-plan.md` §10.4「主会话写文件前，工具执行器把被覆盖文件存 `.agent/snapshots/` 并在事件中记 snapshot_id」；§10.10 用它作为不做全量影子 git 的理由；§11.2/§11.9 用它作为 **Windows/Linux 无沙箱的数据丢失兜底**。
- **核验**：全仓 `.agent/snapshots`、`snapshot_id` 只出现在方案书两份文件里；`git log -S ".agent/snapshots"` 只命中那一笔 docs 提交。`src/tools/write_file.ts` 读旧内容只为算行增减（注释自陈「写盘本身不依赖它」）。`worker-tool-table.ts` 的 `w.snapshots` 是 worker 行号锚点（内存态、随 worker 释放），不是磁盘备份。
- **入账状态**：四份验收三态表与 BLOCKED 均无该条 ⇒ **属「未入账的假绿」**，比未实现更严重。
- **修法形状**：覆盖「已存在文件」前写 `.agent/snapshots/<session>/<n>/<rel>`（只堵这一条路径，不做影子 git，与 §10.10 一致）；`tool_result` 带 `snapshot_id`（增量字段，零新事件类型，与 origin/skill 同思路）；面板/命令给一个「还原到本次覆盖前」出口。
- **判据**：① 覆盖一个已有文件后，事件里能取回被覆盖原文且逐字一致；② 新建文件不发快照（无意义）；③ 非 git 仓库工作区同样成立（这是 Windows/Linux 兜底的前提）；④ 反向对照：把写入改坏 ⇒ ① 必红。
- **失效条件**：`write_file` 路径出现快照写入 + 事件带 `snapshot_id` 字段 ⇒ 本条作废。
- **成本**：小-中（写入点两处 + 一个还原出口 + 事件字段 + 门断言）。

### 2.3 模型面（每请求固定成本）无人记账

- **本日直测**（可复跑：`node --import tsx` 里 import `BASE_SYSTEM` 与 `sessionToolSpecs({mode:"default"})` 量字节）：
  - `BASE_SYSTEM` = 1,542 B；13 条工具规格 = 8,179 B ⇒ **每请求固定面 9,721 B，其中工具规格占 84%**。
  - 单条排行：`remember 1,345`、`spawn_agent 1,301`、`grep 914`、`lsp 777`、`propose_plan 654`…（前两条 = 全表 32%）。
- **未收口的成本面**：`sessionToolSpecs` 把插件/MCP 工具**无总量闸**地追加进同一张表（`glm-session.ts`），只有 2 KB/条的描述上限（`plugins/mcp.ts`）。⇒ 用户多装几个 MCP server，每轮固定成本按工具数线性抬。同仓的 skill 侧已有总闸（`SKILL_REMOUNT_TOKENS_TOTAL` = 25k），hook 侧也有（`HOOK_CONTEXT_TOTAL_CHAR_LIMIT`）⇒ **同一族三处口径，两处有总闸、模型面那一处没有**。
- **反向读数（限制收益，必须先读）**：既有真跑记录 75 条 `usage` 全带 cacheRead，`sumCacheRead / sumInput = 144,256 / 279,947 = ` **51.5%**（缓存断点缺省已开）⇒ 「少发一轮」类改动的真钱收益要按这个折扣看。可复跑：对 `outputs/loop-eval-*/**.events.jsonl` 汇总 usage 的 cacheRead/inputTokens。
- **待测假设（不在本轮施工）**：prune 会改写前缀中段的旧工具结果 ⇒ 每触发一次把那之后的缓存命中打掉。测法：用 `diffAssembly` 对齐 prune 事件点，看 `cacheReadInputTokens` 逐轮 dips。若成立，「prune 阈值」就不是纯省 token 的开关。
- **修法形状**：一条**模型面总预算**（system + 工具规格 + MCP + skill 重挂 + 记忆注入同池），由既有装配探针（`src/agent/gym/probe.ts` 的 `classifyAssembly` / `rankToolSpecs`）出数；超预算按优先级梯降配（先降描述长度，再降可选工具），并在面板显示装配账。**不是**先动提示词措辞。
- **判据**：装配后首轮固定面字节数有上限断言 + 一条「加一个话痨 MCP server 必红」的反向对照。
- **失效条件**：出现「模型面总预算」这一门（或探针进 gate-manifest）⇒ 本条作废。

### 2.4 长命令没有出口（60s 硬顶 + 无常驻进程句柄）

- **现状**：`SHELL_TIMEOUT_MS = 60_000` 写死在 `src/tools/run_shell.ts`；无 background/watch/dev-server 句柄；唯一长通道是 verify 钩子（60s 默认、探测语言 300s、上限 900s），且只跑配置里的 lint/test。全仓超时常数 **20 处分布在 11 个文件**（复跑：`grep -rEoh "[A-Z_]*TIMEOUT_MS = [0-9_]+|_MS = [0-9_]+" src --include=*.ts | wc -l`）。
- **后果**：本仓自己的全量门禁链路里 test 门 ~800s ⇒ 真实仓库的测试套件，模型经 `run_shell` **跑不了**；只能塞进 verify 或吃 60s 强杀。
- **外部原型**：codex `unified_exec` + `runtimes/zsh_fork`（PTY 会话复用）；上游 `tool-bash-persistent` / `tool-terminal`（持久终端）。
- **诚实边界**：现有靶面测不出这条——`outputs/loop-eval-2026-09-20-base/I2-rep1-base.events.jsonl` 16 条 tool_result 里含「超时」字样的 **0 条**（run_shell 被调 10 次、4 次失败，失败原因是 pnpm 模块目录与判卷面，不是时长）。⇒ 先加一个「测试命令 >60s」的 gym case，再谈接不接。这是靶面缺陷不是方向缺陷（与 memory 里「靶面结果饱和」同族）。
- **失效条件**：出现带句柄的后台执行工具（start/poll/kill）或 `run_shell` 超时可配 ⇒ 本条作废。

### 2.5 code-mode / PTC（三家独立收敛）：方向接受，施工推迟

- **外部事实**：上游 `ptc-runtime/run_code`、codex 四 crate（code-mode/-host/-protocol/-runtime）、opencode `tool/code-mode.ts` 三家独立收敛；omp 亦有等价面。
- **本日反向读数（决定推迟）**：短任务基线 `I1-rep1-base` 逐轮 input = 2,966→5,230（10 请求合计 42,106），逐轮增量仅 300–500 tok；装配探针里 `order-pricing-triple-fix` 十请求 prompt 合计 132,143 B，其中可缓存前缀 8,266 B/请求（≈63% 字节份额）、历史 48,676 B。⇒ 在本仓靶面（两文件 fixture / 三文件 fixture）上，**exploration 与中间结果几乎不进上下文**，code-mode 的主要机制（「程序里批量读、结果留在堆里」）没有可观测对象；再叠加 §2.3 的 51.5% 缓存折扣，收益上限目前无法证实也无法证伪。
- **前置任务**：给 gym 加一个多文件、真实仓库规模的 case（`probeAssembly` 已给好分层分子分母），把「历史字节/请求数/中间结果量」量出来，再决定接不接。
- **接的硬约束（照上游）**：子调用走同一条权限瀑布、带父 token 归因、`tool/call` 与 `tool/result` 相邻（不被 additionalContexts 插队）；执行体外置于主进程（现成件：`runInSandbox` + `sanitizedEnv` + `spawnTracked`）。
- **失效条件**：gym 出现「大仓库 case」且其装配账显示 historyBytes 占比 > 前缀 ⇒ 本条的推迟理由失效。

### 2.6 §3.3 四模块「禁区」零道门守

- **现状**：方案书声明 agent-core「零 Electron 依赖，可 headless 跑」，shell「不碰 UI 逻辑」，ui「不持有私有业务状态」。实测今天成立：`grep -rE 'from "electron"' src/agent src/events src/tools src/providers src/permissions src/routing` → **0 命中**。但**没有任何门守它**，而 e2e / gym / loop-eval / 全部 `scripts/*.ts` 门禁都依赖这条成立——一次 `import { app } from "electron"` 就能让整套 headless 判卷链在不可读的报错上崩掉（本仓已有实例：`scripts/loop-eval.ts` 头注记录过一次误判「import agent-runner 会拉起 electron」）。
- **外部原型**：ZCode `architecture-policy.yaml`（逐模块 id / roots / requires / publicEntrypoints / owner，机器可校验）。
- **修法形状（取形状不取 YAML）**：一条 `arch-boundary-check` 门，规则以 JS 侧数组表达：`src/{agent,events,tools,providers,permissions,routing}` 不得 import `electron` / `src/main` / `src/renderer`；`src/events` 不得 import `src/tools|providers|agent`（事件层是叶子）；`src/renderer` 不得 import `src/main`。反向对照 = 临时注入一条违规 import 必红。
- **失效条件**：门进 `scripts/gate-manifest.ts` 的 GATES ⇒ 本条作废。
- **成本**：最小（一个脚本 + 一行清单 + 一条 package script + 单测）。

## 3. 架构层主张：把执行面收成一份契约（复利项）

`runLoop` 现在 399 行里串了 6 段执行面决策，次序本身靠注释与一条测试钉住（`allowedTools` → `skillDenial` → `verify` 系统门 → `PreToolUse` → `gate` → `tool.run` → `PostToolUse`），`LoopOptions` 已堆到 19 个旋钮；每加一个横切能力就多一个字段 + 一个分支。同族副本的另一半在工具内：超时 20 处、输出/尺寸上限 20 处（`grep -rEoh "(OUTPUT_LIMIT|_LIMIT_(BYTES|CHARS)|_CHAR_LIMIT|_TOKENS_TOTAL|TOKEN_CAP) ?= ?[0-9_]+" src --include=*.ts | wc -l`），截断提示有 `truncationNotice` 与 `middleTruncationNotice` 两只（语义相反，故分立——这是对的，但说明「出口」确实在各处自写）。

**主张**：把工具改成一份**声明式契约**，单源同时供三方消费——

```
ToolContract { name, spec(描述+JSON schema), 并行安全, 超时, 输出上限与截断形态,
               是否写向 / 副作用类, 风险线索, 沙箱需求, 归属(§3.3 模块) }
```

- 消费方 1：模型面规格（今天手写住在 `glm-session.gateToolSpecs`，实现住在 `src/tools/*.ts`，两处分离）；
- 消费方 2：loop 的瀑布（超时/重试/截断/取消由管线按契约施加，不再各工具抄一份）；
- 消费方 3：门禁（`tool-surface` / `workerToolSpecs` / `buildWorkerToolTable` 三处同源对账，改成从同一张表投影；§2.6 的归属闸也读它）。

这与上游 `tools/pre-execute / execute / post-execute` 三瀑布、codex 的 `router/registry/orchestrator/parallel/sandboxing/approvals` 模块分立同形，但**不必引入插件树**：一张 TS 数组 + 一条不变量断言即可，符合「只改 harness / 清单即事实源」的既有纪律。它不新增能力，只把已经存在的 20 处出口收进 1 处——正是本仓「同族出口与接缝副本」缺陷族的构造级解法。

## 4. 明确不采纳（附理由与反转条件）

| 项 | 不采纳理由 | 反转条件 |
|---|---|---|
| 上游 60+ 包 Cordis 插件树 / profile + bundle + patch 叠加 | 复杂度税与「清单即事实源」冲突；我们 28 道门 + 变异验证已覆盖同等治理面 | 真要发可嵌入 SDK 给别人二开时 |
| ZCode `architecture-policy.yaml` 的 YAML 形态 | 判据写在 shell/YAML 侧正是本仓踩过的坑（BSD grep 静默空命中 4 次）；JS 侧数组可被单测消费 | 出现必须跨工具共享政策时 |
| omp snapcompact 位图压缩 | 我们 provider 层**零图像支持**（`src/providers/*.ts` 无 image/vision/base64 命中），前提不存在 | 接图像输入通道之后 |
| embedding / 向量检索 | 决策 #13 定稿不做（M3+ 评估位） | 索引召回成为可测瓶颈时 |
| React/Tailwind/shadcn 回摆 | 渲染层已按 vanilla 收口并归档，CSP `script-src 'self'` + 单文件内联 CSS | 无（除非交付形态改） |
| ACP / 进程外子代理（把活委派给 Codex/Claude Code） | §10.10 定稿 V1 不做；且与「BYOK 本地优先」正交 | 要吃竞品生态获客时 |
| 容器 / microVM / 跨世界隔离 | 发布范围 = macOS（P16），同世界边界已声明 | 企业形态 / 远端执行器立项时 |
| 大评测基建（对标 metaharness 仪表盘） | 真墙是「可标分母 + 靶面饱和」，不是基建不够；再加基建只增读数面 | 出现第二个需要共用 experiment→run→trace 的产品线时 |

## 5. 本日读数台账（全部实跑，可复跑）

| 读数 | 值 | 复跑 |
|---|---|---|
| 每请求固定面 | 9,721 B（BASE_SYSTEM 1,542 + 工具规格 8,179；工具占 84%） | tsx 内 import `BASE_SYSTEM` / `sessionToolSpecs` 量字节 |
| 工具规格条数与排行 | 13 条；remember 1,345 / spawn_agent 1,301 / grep 914 / lsp 777 | 同上 |
| 装配探针（4 case） | order-pricing：10 请求 / 132,143 B / 前缀 8,266 B / 历史 48,676 B；其余三 case 3 请求 / 28–29 KB | `TERM=dumb node --import tsx scripts/gym-run.ts --all --model probe` |
| 实跑缓存命中份额 | 51.5%（144,256 / 279,947，75 条 usage 全带 cacheRead） | 汇总 `outputs/loop-eval-*/**.events.jsonl` 的 usage |
| 短任务逐轮 input | I1 base 2,966→5,230（10 请求合计 42,106，13 次工具调用） | 解析同名 events.jsonl |
| 沙箱网络 | 沙箱内 `curl example.com` → `(6) Could not resolve host`；不套沙箱 → `http=200`。**不出网版**：进程内 listener + `curl 127.0.0.1:<port>` → 默认 profile `(7) Failed to connect` rc=7，不套沙箱 `LOOPBACK-OK` rc=0 | `runInSandbox` + 同命令负控 |
| 超时/上限副本 | 超时 20 处 / 11 文件；输出与尺寸上限 20 处赋值 | §2.4 / §3 里的 grep 命令 |
| agent-core 零 electron 依赖 | 0 命中（六目录） | §2.6 的 grep |

## 6. 并发窗口与施工顺序

- 主树 HEAD `65e499f`，分支 `codex/dsh-structural-hardening`；`pgrep -fl "electron|vitest|tsx"` 当前为空（无并发跑门）。
- **同邻居的在飞工作**：`outputs/shell-permission-bypass-2026-09-21.md` + `scripts/probe-shell-bypass.ts`（红 24 / 绿 9，判修未施工，基线 `0e1b504`）住在权限层（`rules.ts` / `autonomy.ts` / `worker-shell-tools.ts`）。本提案 §2.1 只在 `sandbox.ts` 与 `agent-runner.ts` 的 run_shell 出口施工，**不改 deny 规则解析**；若两侧都要动 `agent-runner.ts`，按文件交集判窗口，不 stash 硬合。
- 施工序（成本与碰撞面升序）：**2.6 方向门 → 2.1 网络通道 → 2.2 覆盖前快照 → 2.3 模型面预算 → 2.4/2.5（先补靶面）**。§3 契约化在 2.3 之后起，因为它需要 2.3 的装配账作为验收读数。
- 本工件的失效方式：任一 §2 条目对应实现落进 HEAD ⇒ 划掉该条并附提交号；不重写整篇（该日快照不回改）。

## 7. 施工回执（同日，均未提交；HEAD 仍 `65e499f`）

**已落（在飞改动集，未 commit）**

1. **§2.6 模块方向门** — 新增 `scripts/arch-boundary-check.ts`（五条规则 B1–B5，纯函数 `findBoundaryViolations` + `--self-test` 反向对照）+ `tests/arch-boundary.test.ts`（5 条：真仓现状 / 五规则皆可抓 / 类型豁免边界 / 归属判定 / 规则表可审计）+ 登记进 `scripts/gate-manifest.ts` 的 GATES 与 `package.json`。
   实测：门绿（扫描 129 文件，5/5 通过，`--self-test` 5/5 可抓且类型豁免不误伤）；**真实注入实验**（临时写一个 `src/agent/tmp-archgate-negative.ts` 引 electron）当场 exit=1 且指到 `file:line`，同文件里的 `import type` 未被误判；删除后复绿。`pnpm gates --only=arch-boundary-check` exit=0。
2. **§2.1 网络审批通道** —
   - `src/main/sandbox.ts`：`buildSandboxProfile(root, { network })`（缺省 `deny` 与旧形态**逐字节一致**；`allow` 只多两行 network 放行，写收敛/拒读一字不动）、`runInSandbox(..., { network })`、纯函数 `networkProfileFor({wantsNetwork, asked, approved})`（§11.4 红线的唯一实现点）、`looksLikeNetworkDenial` + `NETWORK_DENIED_NOTE` + `annotateNetworkDenial`（两条出口共用一只判据，不再各抄）。
   - `src/main/agent-runner.ts`：网络命令在**问过且批了**的分支上记 `humanApproved`，run_shell 的两条沙箱出口（`runInSandbox` 与融合分支的 `sandbox-exec` 前缀）按 `networkProfileFor` 选支；审批卡理由追加「批准 = 本次命令放行网络出网（一次性，不记忆）」（`autonomy-check` 用 `includes("默认档")` 断言，追加不破）。
   - `scripts/sandbox-check.ts`：新增 ④b（靶子 = **本进程回环端口**，一次性哨兵串；缺省支连不上、allow 支拿得到）与 ④c（同一份真实 EPERM 原文，缺省支贴提示、allow 支不贴）。反向对照 `--bogus-root` 仍恰红 1 项。
   - `tests/sandbox.test.ts`：+4 条（缺省=显式 deny 逐字一致 / allow 只加两条 / 真值表 6 行 / 断网判据三抓两不误伤 + 提示合成分支）。
   - 变异针脚：`scripts/mutate-verify.mjs` +3 条（`sbx-network-branch-dropped`、`sbx-network-escort-ors-conditions`、`sbx-note-gate-dropped`）；`--check-needles` 报 0 阻断、改法语法体检全通过。
3. **§2.2 覆盖前快照 D7** —
   - 新模块 `src/tools/snapshot.ts`：`snapshotIdOf`（`.agent/snapshots/<毫秒>--<callId>/<原相对路径>`，callId 过文件名安全化）、`snapshotBeforeOverwrite`（`copyFile` 按字节抄、保留 mtime、**best-effort**：任何失败只 `console.warn`，绝不改写已成功的写入 —— 与 `appendImpact` 同一条纪律）、`snapshotNote`。
   - 写工具接入：`write_file` 在落盘前抄；`edit_file` 排在「0 处 / 多处匹配」两道拒绝**之后**（被拒的编辑不许留脏快照）。正文追加「｜覆盖前原件已存 <path>」给模型看，`ToolResult.snapshotId` 给事件流看。
   - `src/tools/base.ts`：`ToolContext.snapshot?: boolean`（**缺省开**）。`src/agent/loop.ts` 把它透进 `tool_result` 的增量字段 `snapshotId`（`src/events/index.ts`，零新事件类型，旧日志重放逐字不变）。
   - **worker 写侧显式关**：`src/agent/worker-tool-table.ts` 两个包装传 `{ ...ctx, snapshot: false }`。理由不是审美——见下条。
   - `tests/snapshot-d7.test.ts` 7 条：覆盖可取回原文且逐字一致 / 新建不占快照 / `edit_file` 同口径 / 被拒编辑不留快照 / 快照失败不改写盘结果（ENOTDIR 注入）/ worker 关掉 / **字段穿过 loop 落进事件流**。
   - 变异针脚 +3（`d7-snapshot-taken-for-new-file`、`d7-worker-optout-ignored`、`d7-snapshot-id-not-in-event`）。
   - **全表针脚条数与逐道读数一律以 `pnpm mutate-needles-check` / `pnpm gates` 输出为准**（本仓规矩：滚动数不写进 dated 页）。
   - 两处既有断言随之校正（都是「整串相等」被新尾巴撞到，改为剥尾巴后严格相等 + 保住原意图）：`tests/lsp.test.ts`「LSP 未配置：输出保持不变」、`tests/write-line-delta.test.ts`「大文件不统计时不许冒充新建」。

**施工中被推翻的一条判断（留档，别第二次踩）**
- 探针写错：`newAutonomySession(mode, init)` 的**第一个位置参数才是档位**，我按 `newAutonomySession({mode:"default"})` 传对象 ⇒ mode 成了陌生对象，`evaluate` 一路落到 `L4-pass`，于是得出「默认档 run_shell 根本不送审 ⇒ 网络通道不可达」的错结论。按真签名重测：默认档 `curl` → `ask @ L3-mode`（risk medium），自主档 → `ask @ L4-network`，只读档 → `deny @ L0-hard`；非网络的 `echo hi` 在自主档仍 `approve`（⇒ 拿不到放行，正是 §11.4「网络全开不是免批条件」要的形状）。⇒ **通道可达，无需改权限层判据**，与在飞的 shell 绕过修复零交集。
- 另已在 §2.1 更正初稿那句「全站零网络断言」——`sandbox-check` ④ 一直有断网断言，错因是只 grep 关键词没读正文。
- **D7 的 loop 集成用例第一次是假绿**：`runLoop` 用缺省 `mode: "default"` + `interactive` 缺省 false ⇒ 写工具被 fail-closed deny，`tool_result` 是拒绝文本、根本没有快照，而我把 `ok` 断言排在了 `snapshotId` 之后。改成 `mode:"auto"` + **把「写入本身成功」的断言提到最前**之后才真正测到东西。教训：新增字段的穿流断言，必须先断言承载它的那次动作真的发生了。
- **worker 写侧落快照会直接判红 `mergeWorker`**（`tests/m3b.test.ts` 「off 零行为」那一条）：worktree 里多出 `.agent/snapshots/**` 就进不了合并。⇒ 「主会话 vs worker 两套写面」不是纸面区分，是会被合并闸打回来的事实；已按 §10.10 的分工显式关掉并补了变异针脚。

**明确留尾（不假装收口）**

- **§2.2 覆盖前快照的剩余半条**：原件已可被 **agent 侧自取**（正文报路径 + 事件带 `snapshotId`，`read_file` 本就能读 `.agent/**`），但**人侧一键还原**（文件卡/审批卡上的「还原到覆盖前」）没做——它要动 `ipc-protocol` + preload + renderer 三个多会话热点文件，另立任务。**在它落地前，§10.4 这句话只能算半兑现**，别按已收口读。
- **快照无增长界**：同一文件被覆盖 N 次就留 N 份原件（`copyFile` 廉价，但长期会话会堆）。去重（同 size+同 mtime 即跳过）未做，理由是要多一次 stat 且语义上「每一次覆盖都是独立事实」——真嫌吵时按目录做保留策略，别改 id 语义。
- **`.agent/snapshots/` 会进用户仓库的 `git status`**（方案书定稿的位置，未擅改）。实测连带：就地改靶子的判卷路径（`scripts/gate-check.ts` 的 `APP = fixtures/todo-app`）现在也会在靶子里留下快照目录——本轮已手工清理，**根因是既有的「就地改靶子」污染，不是快照**。
- **§2.3 模型面总预算**：只做了读数，未施工（`sessionToolSpecs` 追加 MCP 仍无总量闸）。
- **§2.4 / §2.5**：按本文结论先补靶面（gym 加大仓库 case / 加 >60s 验证命令的 case），未施工。
- **`.agent/snapshots/` 会进用户仓库的 `git status`**（方案书定稿的位置，未擅改）；施工时要么同时给 `.gitignore` 建议，要么在验收文档里显式认这条噪音。

## 8. 对上游读物的两处更正

1. `05-codex.md` 第 55–56 行混入写入脚本残留（`DCHUNK1` 与 `echo p1 ok; wc -l "$F"`），非 codex 事实，应删。
2. 总报告 §3 第 5 点把 ZCode 的 `architecture-policy.yaml` 说成「现仓 gate-manifest 思路的 yaml 化」——方向反了：我们要取的是**依赖方向断言**那一格（§2.6），YAML 形态恰好与本仓「判据写在 JS 侧」的定稿冲突。
