# ZCode（zai-org/ZCode）接入评估（2026-09-21）

> **结论先行**：ZCode 是本仓同类（Electron + TUI + CLI 的编程 agent harness，同层可比）。
> 值得借的是**六个形状**，其中两个直接对准本仓已核实的缺陷；**一个都不涉及接它的模型或运行时**。
> 明确否掉四项（动态工作流编译器、1.9MB bash 注册表、prompt-trajectory 代理、跨平台三面），
> 另发现三处「本仓已有同构、别重复造」。评估只到「形状 + 成本 + 反转条件」，**不构成接线依据**。
> 缺陷复现另立一页：`outputs/shell-permission-bypass-2026-09-21.md`。

## 一、样本与规模

`git clone --depth 1 --filter=blob:none --sparse` 到 `/tmp/zcode-probe`，只取 `apps/zcode-cli`（Agent CLI 与
运行时源码，随仓库一起克隆、非 submodule）。规模：TypeScript 1322 个文件、284151 行；其中
`packages/core` 495 文件 95557 行，`bootstrap` 63533 行，`adapters` 51637 行，`contracts` 21427 行。
文档面很薄：全树 md 合计 1640 行，真正的东西在代码里。

它和 DSH 的可比点：**同一层问题**（agent loop / 事件流 / 工具 / 权限门 / 沙箱 / 编排 / 压缩 / 记忆 /
provider / 插件），所以能逐条对表而不是抽象借鉴。

## 二、值得采纳（六个形状）

### 1. `alwaysAsk`：工具级「任何宽松档都问」——对准本仓「自主档 ask 0%」

它的 `ToolPermissionSpec.alwaysAsk`（`packages/contracts/src/tools/contract.ts`）语义写得很干净：
越过 yolo 的直通和 plan 的只读直通，但**只覆盖 allow 分支，deny 分支照旧**；理由原文是「这活体量
太大，任何宽松设置都不该无人值守地跑」。本仓判断层的实测读数正是「默认档 ask 92% / 自主档 0%」
（见 `docs/judgment-layer-calibration-proposal.md`），中间档造不出来的原因是档位是会话级的、工具无从表态。
`spawn_agent`（派 worker = 写盘 + 花真钱）、merge、`verify` 各声明一条即可，渲染层零改动。
成本：一个必填声明字段 + `evaluate` 一处分支。**反转条件**：无（只会更严）。

### 2. `patternSources` + `askOptions.allowAlways`：allow 规则不许携带载荷

它的每条工具规则模式**从哪个字段来**由工具声明（`none|toolName|input|path|command|network|custom`），
`command` 档走解析后的 argv 前缀而非 raw 全串；并且 `askOptions.allowAlways: false | "session"`
专门给「每次输入都是不同代码」的工具——注释即本仓那句话的理由：记住决策等于永久关掉它的门。
本仓「总是允许」写的是整条命令字面量（`src/main/agent-runner.ts` 的 `rememberPermissionRule` 一侧），
且 allow 只让位于 critical ⇒ high 被 allow 吃掉。**实测复现见另一页。** 成本：与第 1 条同源，小。

### 3. 影子重放守恒对账门（含「可寻址性守恒」）——罩住本仓已核实的 P1 簇

`apps/zcode-cli/scripts/shadow-replay.mjs`（278 行）把本机真实会话库全量喂进冷恢复管线
（transcript 合成 → ProductProjection），逐会话做**守恒对账**：assistant text 多重集覆盖、可见 user 行下限、
goalVerify marker 计数，以及最有价值的一条——**可寻址性守恒**：每条投影行的 entity/turn/message target
和每个已发布 action（`canEdit/canRetry/canFork/canRewindFiles`）都必须由**同一次 cold materialization**
的 resolver 精确命中，否则「UI 显示按钮但命令必然 stale/reject」。
它的退出码只在 崩溃 + 两类可寻址失配 时红，文本计数只报不红，且注释里明写「全量重放 21 个 flag 全是
启发式误报，真实守恒失败 0」——这个「已知误报照样备案」的诚实度与本仓判卷纪律同构。
开库只读：默认把 db 连同 `-wal/-shm` 拷进临时目录再打开，因为打开会跑迁移。
对本仓匹配度高：已核实的 replay 分叉、sidechat 丢尾、以及刚做的子智能体行内动作 / 审批卡死列，都是同一类。
成本：一个 script + 现有 JSONL 语料（本仓已有 `scripts/diag-replay.ts` 同簇可并）。

### 4. 工具契约声明化：消掉权限层里的第二份名字表

它的 `ToolContractDeclaration` = `inputSchema`/`outputSchema`/`permission`/`resultBudget`/`timeout`/
`cancellation`/`trace` 一个对象，`ToolMetadata` 里 `readOnly`/`destructive`/`concurrentSafe`/
`sideEffectScope`/`maxOutputBytes` 全**必填**（忘填是编译错）。`sideEffectScope` 的取值
`none|workspace|git|network|system|session|userInteraction`，且 fail-closed 语义写在函数里：
范围缺席 = 按「会改写」处理（`isWorkspaceMutatingToolCall`）。
本仓现状是权限层自持两份字面工具名表（`autonomy.ts` 的 `SIDE_EFFECT_TOOLS`、`risk.ts` 的 `SHELL_FAMILY`），
而它的事故史正好在这条线上（M0 复盘 P0-1「按能力不按名」、审查 C6 worker plan 门没刷、worker 权限规则
接线 P1、`isMcpScopedName` 那段「把少传一个参数读成这不是 MCP」）。
顺带可借的两粒：`resultBudget` 把 `maxInlineBytes`（UI 面）与 `maxModelBytes`（provider 面）分成两个数
（本仓 `tools/base.ts` 的截断是一个数两面共用）；`trace.recordInput: summary|full|none` 按工具声明
「什么进轨迹」，比事后脱敏前置一层。成本：中等（触及每个工具声明）。

### 5. 结构化收单 + 违规可修（`ask<T>` → JSON Schema 的**那一小片**）

它 `packages/dynamic-workflow/src/schema/` 的产物形状是：违规以 `path / expected / got` 回给模型做**有界修复**，
而不是把整段答案退回重说。编译器（taint 图、类型驱动 schema 合成）**不采纳**（见第四节），但
「一次 ask 有一个 schema，答歪了给出是哪一条路歪、期望什么、实得什么」是纯运行期形状、不需要编译器。
本仓 worker → orchestrator 现在靠正则从自由文本里抠 id（`src/agent/worker-report.ts` 的
`parseSpawnedAgentId` / `scanWorkerOutput`），一条手写 per-profile 的 JSON Schema + 子集校验器即可。

### 6. 来源留痕：记忆条目与门禁策略都要能回指

`core/src/memory/origin-session.ts` 在写盘时把 `metadata.originSessionId` 盖进记忆文件 frontmatter
（**只在缺失时盖，不覆盖**）；`WorkspaceHookPolicy` 带 `policyRevision: "builtin:user-decides:v1"`，
把**决策依据的版本号**随决策一起记。本仓：`src/agent/memory/` 三个文件 grep origin 为空；
`GateMeta` 有 `layer/risk/mode/ruleId` 但没有策略版本；`PermissionRule.id` 是
`behavior:tool:pattern#序号`，两层文件合并后序号会撞（`origin` 只进了报错文案，merge 就丢）。
这条直接服务「可标分母」那堵墙：哪次会话沉淀出这条记忆、那次会话后来失败了没有，才有得算。

## 三、已有同构，**别重复造**

| ZCode 件 | 本仓现状 | 差值 |
|---|---|---|
| `compact/microcompact.ts`（清旧 tool result、留最近 5、min savings 256 token、0.9 触发） | `src/agent/prune.ts` 同一件事，**连占位串 `[Old tool result content cleared]` 都逐字相同**，且更强（被裁原文写会话附件目录可回取，它单向丢弃） | 只多一个 60min idle 触发，属可选旋钮 |
| `skills-lock.json` 的 `computedHash` pin | `src/agent/plugins/trust.ts` 全量文件 sha256 指纹 + 三态信任门 | 无 |
| `dependencies/native-search/` vendored rg/ugrep/bfs + SHA256SUMS + 禁下载回退 | 走 npm `@vscode/ripgrep`，`rgBinary()` 懒解析 | 它的成本是为跨平台 SEA 打包付的，本仓不需要 |

## 四、明确不采纳（理由 + 证据 + 反转条件）

- **`dynamic-workflow` 编译器**（`ask<T>` → JSON Schema、taint 不动点、因果图 / phase quotient，
  90 文件 19878 行纯分析 + 兄弟包 `dynamic-workflow-runtime` 的子进程 vm cell + NDJSON host bridge）：
  让 agent 写**可编译的编排脚本**，方向是真的，但代价是在 harness 里嵌一个虚拟 TS 编译 host——连
  stdlib `.d.ts` 都要生成期内联（其 README「Embedded libs」：`lib.es2022.d.ts` 闭包写进
  `compiler/libs.generated.ts`，无磁盘回退）。与「只改 harness、报数看 $/成功任务」的前提冲突，
  且本仓连 `spawnRace` 都裁成不接线。**反转条件**：worker 编排脚本成为主交付面、且需要静态依赖图 /
  重放幂等时。
- **1.9MB bash 命令注册表**（`scripts/generate-bash-command-registry.mjs` 从 `@withfig/autocomplete`
  确定性生成，版本双锁 + 源目录 sha256 + `registry:check` 漂移门）：想要的只是「哪些 flag 是写向」的语义，
  代价是一个版本一 pin 一审计的巨型生成物。本仓取它的 `WRAPPER_OPTIONS_WITH_VALUES`（约 40 行包装器
  带值选项表）就够，见复现页。
- **`tools/prompt-trajectory`**（代理真 provider 请求 → 逐请求 body 快照 + OpenAI/Anthropic 双投影 +
  忽略 `cache_control` 漂移的连续性判定）：这是本树里唯一能**量化**提示税与缓存命中的工具，但它要求架一层
  provider 代理。先用现有 `usage` 事件与 ledger 出数。**反转条件**：cache_read / cache_write 进入路由或
  压缩的决策变量。
- **跨平台三面（Win/mac/Linux）、`.agents Protocol` 兼容、TUI 键盘优先**：本仓沙箱前提是 Seatbelt、
  渲染层是 vanilla 单文件，与这三条不是同一取舍。
- **「单文件不超 400 行」当规矩**：见下节——它自己没做到，属宣言不属门禁。

## 五、方法论警告（借形状，不借读数）

这份发布树**零测试文件**（`find` 匹配 `*.test.ts` / `*.spec.ts` = 0，`tests/` 目录亦不存在），
而 `dynamic-workflow/README.md` 通篇在讲 `pnpm test`、fixture 判卷、`// error` 标记双向匹配、
`pnpm charts` —— 在这份树里**都无对应物**。它的 AGENTS.md 同样没有配套强制件（除 `registry:check` /
`typecheck` / `lint` 外没有门禁面）。
自违证据：AGENTS.md 写「单个源文件默认不能超过 400 行」，实量 1302 个非生成 ts 文件里
**155 个超线**，最大 `bootstrap/src/zcode-protocol-v4/product-projection.ts` 5459 行。
⇒ 本文所有「它这样做」的陈述只能支撑**形状**（字段怎么设计、边界放在哪），**不能**支撑
「这样做被验证过有效」——那份证据没随仓库发布。

## 六、同轮已落地的复现

本次评估顺手把「借来的第 1、2 条对准的本仓缺陷」做成了可重跑探针，含四条缺陷的逐条读数与根因归并：
`outputs/shell-permission-bypass-2026-09-21.md` + `scripts/probe-shell-bypass.ts`。
**判修未施工**（截至本文落笔 HEAD `0e1b504`）。
