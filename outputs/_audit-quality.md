# 工程质量审计（代码健康度面）

审计人：quality-auditor（task-2）· 审计对象：`m0-agent-loop`（core-only、event-sourced agent harness）
审计日期：2026-09-29 · 工作树未做任何改动（审计前后 `git status --porcelain | wc -l` 均为 37）

**审计方法（可复核）**

- 静态：自建 import 图脚本（`/tmp/qa-audit/graph2.mjs`，解析 `.js→.ts` 后缀与多行 import），算零入边、扇入/扇出、跨层边、从 `src/cli.ts` 的可达集；`grep`/`wc` 统计口径一律写进正文。
- 动态：单文件跑测试（不用全量 `pnpm test`，全量由 lead 另行验证：241 文件 / 3017 用例 / 222.27s / exit 0）。
- **变异探针**：把仓库只读复制到 `/tmp/qa-audit/repo`（含 `node_modules` 软链，原树零改动），注入 3 个人为缺陷后跑相关测试，看测试是否真变红。这是本报告"测试有没有分辨力"的硬证据。
- 唯一一次进入本仓 `outputs/` 的写入就是本文件。

---

## verdict（结论段）

**这是一棵"工程纪律远高于同规模项目、但结构债已经肉眼可见"的树。** 关键结论有三条：

1. **安全性不是口号，是可执行、可测、有编译期约束的机制。** 权限管线 `evaluate()` 四层短路、未知档位回落到 `default`（不是最松档）、MCP 无注解强制按"写"处理、非交互 ask 一律降为 deny、审批门未接线直接拒。路径包含用 `lstat` 逐段解软链再比对 `realpath(workspace)`，不是词法 `resolve` 糊弄。**我注入的 3 个安全缺陷（摘掉只读档 L0 硬边界、脱敏改空操作、包含校验改空操作）全部被现有测试当场判红**（见 §2.4）。
2. **测试质量是真的，但有局部水分。** 241 个测试文件里只有 9 处 `vi.mock(`，没有 `skip/only/snapshot`；抽样 12 个文件的绝大多数都在断言真实副作用（磁盘上的 JSONL、靶子文件内容、退出码、DENY 措辞）。水分集中在 **33 个用 `readFileSync` 读自己源码、用 `toContain` 断言源码字符串**的"结构断言"测试上——它们不验行为，重构就红、逻辑坏了却可能不红。
3. **最大的风险不是"代码写得差"，而是"验证机器比产品还重"。** `scripts/` 共 26,767 行（`src/` 35,000 行的 76%），其中 `scripts/mutate-verify.mjs` 单文件 8,936 行 + `scripts/lib/` 12,135 行；变异机有 936 条锚点、会变异自己的判据源码；而 `src/main/scheduler.ts`（1,016 行）+ `src/main/automations.ts`（325 行）**在 CLI 产品里没有任何启动调用点**，却被同一套门禁认真守护。**"未完成"与"坏掉"要分开：这棵树几乎没有"坏掉"，但有大量"为已删除的桌面层保留、由判卷机器维持生命体征"的代码。**

---

## 1. 结构质量：模块布局、耦合、god-file、死代码

### 1.1 布局与规模 ✅

| 层 | 文件数 | 行数 |
|---|---|---|
| `src/agent/` | 79 | 19,648 |
| `src/main/` | 22 | 6,987 |
| `src/tools/` | 23 | 2,797 |
| `src/providers/` | 12 | 1,656 |
| `src/permissions/` | 7 | 1,451 |
| `src/events/` | 1 | 925 |
| `src/routing/` | 4 | 511 |
| 顶层（`cli.ts` / `net.ts` / `frozen.ts` / `atomic-write.ts`） | 4 | 1,025 |
| 合计 | **152** | **35,000** |

✅ 分层是真的：跨层边统计（`agent→tools` 39、`agent→events` 31、`main→agent` 28、`agent→providers` 27），逆向边只有两条且都是 `import type`（`src/events/index.ts:9` → `../agent/recovery`、`src/providers/openai.ts:9` → `../agent/metering`），运行期无环。`src/tools/base.ts`（扇入 33）、`src/events/index.ts`（扇入 44）是稳定内核。

❌ **没有 CI、没有任何 git hook**：`ls .github` 为空、无 `.husky`、`package.json` 无 `lint-staged`。28 道门禁（`scripts/gate-manifest.ts:13-48`）全靠人手动 `pnpm gates` 触发。

### 1.2 最大的三个文件：谁是 god-file

- **`src/agent/orchestrator.ts`：2,533 行，但是"大而内聚"。** 之所以大是因为一个 `Orchestrator` 类有 **50 个方法**（方法体合计 1,216 行，最长 `spawnSupervise` 183 行、`runChain` 176 行）；注释占 16%（409/2534）、无 TODO。它管 worker 编排这一件事，属于"该拆但没拆坏"。⚠️
- **`src/main/agent-runner.ts`：2,502 行，是真正的 god-module。** 扇出 **56**（全仓第一）、`export` 行 **61** 条、70 个顶层函数，最长函数 `runAgent` **371 行**（`src/main/agent-runner.ts:1330`）+ `handleCardAction` 113 行（2016）+ `gatedTool` 103 行（469）+ `installAutomationTools` 97 行（1076）。它同时是：装配根、权限门包装、调度器生命周期、插件装载、会话状态持有者、审批留痕构造器。**这是重构优先级第一。** ❌
- **`src/main/scheduler.ts`：1,016 行，结构本身不坏**（`Scheduler` 类 22 个方法、方法体 302 行），但见 1.4：它在产品里跑不起来。

### 1.3 隐藏耦合：进程级单例状态 ⚠️

`src/` 里模块级可变单例约 **76 处**（`^let` + 模块级 `Map/Set`）：`src/main/agent-runner.ts:192` `let session`、`:988` `let scheduler`、`src/permissions/plan-state.ts:26` `let planState`、`src/agent/plugins/index.ts:518` `let current`、`src/agent/orchestrator.ts:103` `let globalAgentSeq`。

后果被作者自己写进了代码：`installAppTools` 用模块级 `installed` 守卫，并在第二场 run 参数不一致时当场抛错（`src/main/agent-runner.ts:905-914`）。**"一个进程 = 一场会话"是硬约束**，这解释了为什么测试必须大量 `vi.resetModules()`（如 `tests/automation-tool-surface.test.ts:157-163`），也是嵌入式复用/并行会话的长期障碍。

### 1.4 "看起来没接线"的模块：逐个用 import 验证

⚠️ **任务书假设需要更正**：`src/agent/automation-surface.ts` **不是死代码**——它被 `src/agent/glm-session.ts:16`、`src/main/agent-runner.ts:33` 与测试引用，规格面/执行面共用同一个 `automationTools` 字段。

从 `src/cli.ts` 做可达性闭包：**140/152 文件可达，12 个不可达**（`node /tmp/qa-audit/graph2.mjs`）：

- `src/agent/gym/*`（case/draft/probe/runner/score/script，6 个）→ 被 `scripts/gym-check.ts` 等门禁使用，属"验证脚手架住在 src/"。
- `src/agent/{cost-per-progress,no-progress,reproducibility,tool-choice}.ts`、`src/agent/eval/task-set.ts`、`src/providers/byok.ts` → 同上，被 `scripts/*-check.ts` 与单测使用。
  → **判断：不是死代码，但也不是产品面**；这 12 个文件（约 2,000+ 行）说明 `src/` 里混着"判卷工具链"。

❌ **`src/main/scheduler.ts` + `src/main/automations.ts`（1,341 行）是产品级死代码**：

- `initScheduler` / `startScheduler` / `stopScheduler` 在**全仓（src+tests+scripts+bin）只有定义、没有调用点**：定义在 `src/main/agent-runner.ts:992 / 1026 / 1037`，全仓 grep 无第三处调用。
- CLI 显式关掉这条面：`src/cli.ts:728` `automationTools: false`。
- 它只被 `tests/schedule.test.ts:325` `new Scheduler(deps)` 直接实例化测试（该文件 764 行 / 186 条断言，质量不低）。
- 代码注释直言原因：`src/main/agent-runner.ts:897` "**为什么 CLI 要摘**：它们要 `initScheduler`…"。
  → **定性：unfinished / 为已删除的桌面层保留**，不是 broken。但它让门禁、变异锚点、文档持续为一段跑不到的代码付费。

---

## 2. 测试质量（不是数量）

### 2.1 配置有没有做手脚 ✅

`tests/vitest.config.ts`：`include: ["tests/**/*.test.ts"]`、`fileParallelism: false`（理由是 `fixtures/todo-app` 共用靶子，文件级串行避免竞争）、**无 exclude、无 retry、无 bail、无 timeout 放宽、无 snapshot 目录**。前两段还把 `PI_SCRATCH_DIR` / `M7_IMPACT_TAGS_DIR` 指到 `tmpdir()`——这是**防污染**（避免测试往用户家目录写），不是逃避判卷。

唯一"在 include 之外"的测试是靶子应用自己的 `fixtures/todo-app/tests/todo.test.ts`（属独立靶子，由 `tests/gated-tools.test.ts` 经 `run_shell` 真跑断言 `3 passed`，`tests/gated-tools.test.ts:65`）。合规 ✅

### 2.2 弱点口径的量化

| 模式 | 命中数（tests/，241 个文件） | 判读 |
|---|---|---|
| `vi.mock(` | **9** | ✅ 极低；且集中在 `memory/inject` 与 `node:fs/promises` 两族 |
| `.toMatchSnapshot` | 0 | ✅ |
| `it.skip` / `describe.skip` / `it.only` | 0 / 0 / 0 | ✅ |
| `expect(true)` / `expect.assertions` | 0 / 0 | ✅ |
| `toBeDefined()` | 62 | ⚠️ 抽样看多为 `env.PATH`、`spec` 之类存在性检查，非空转 |
| `toBeTruthy()` | 21 | ⚠️ 个别弱（`tests/schedule.test.ts:560`、`tests/chain-lease-held.test.ts:205`） |
| `readFileSync` 读源码做断言 | **33 个文件** | ❌ 见 §2.3 |
| `catch {` | 25 | ⚠️ 多为清理/容错路径 |

补充：仓库自己就有一把"断言体检"的尺子——`tests/assertion-health-scan.test.ts` 扫描脚本里的空断言/恒真式/暗卷段零断言，并**自带反向对照**（`:43` "尺子本身不是恒绿的：已知病样必须报出来"）✅ 这是很成熟的元测试实践。

### 2.3 抽样 12 个文件：真断言 vs 同义反复

| 文件 | 断言的是真行为吗 | 证据 | 单跑结果 |
|---|---|---|---|
| `tests/event-log-redaction.test.ts`（162 行） | ✅ 真 | 真跑 `runLoop` → 真写 JSONL → 读回盘上原文断言 `not.toContain(凭据)` 且 `toContain("AKIA****")`，另配"干净输出逐字不变"与"执行面不脱敏"两条反向对照（`:76-105`） | 6 passed / 0s |
| `tests/path-boundary.test.ts`（23 用例） | ✅ 真 | 覆盖软链越界、`.agent` 软链绕过等；**变异探针 C（包含校验改空操作）→ 8 条红** | 23 passed / ~1s |
| `tests/gate-audit.test.ts`（33 用例） | ✅ 真 | 铺 `layer × verdict` 全矩阵；**变异探针 A → 3 条红** | 33 passed / ~1s |
| `tests/autonomy.test.ts`（17 用例） | ✅ 真 | 档位策略矩阵；**变异探针 A → 1 条红** | 17 passed / 0s |
| `tests/gated-tools.test.ts`（117 行） | ✅ 真 | 真 `runAgent` 打 `fixtures/todo-app`：批准 → 盘上文件真的被修好（`:64` `toContain("filter((t) => t.done)")`）；拒绝 → 断言 `[permission denied]` **且 bug 原文保留**（`:87-91`）；沙箱不可用 → auto 档也拒（`:96-116`） | 未单跑（属全量） |
| `tests/events.test.ts`（352 行 / 68 断言） | ✅ 真 | append-only、未知事件类型拒收（`:42`）、坏行"中段不静默跳过"（`:151`）、增量与全量同判（`:172`） | 未单跑 |
| `tests/schedule.test.ts`（764 行 / 186 断言） | ✅ 真（但测的是跑不到的代码） | 注入 clock 的 cron/补跑去重/双轨存储；`tests/schedule.test.ts:325` 直连 `new Scheduler` | 未单跑 |
| `tests/cli-surface.test.ts`（663 行） | ✅ 真 | `spawnSync(process.execPath, [bin/m0.mjs, ...])` 真起 CLI（`:28-33`），断言退出码 0/1/2 与 stderr 提示（`:37-103`） | 未单跑 |
| `tests/assertion-health-scan.test.ts`（192 行） | ✅ 真 | 自带反向对照病样；扫描面用 `git ls-files` 而非磁盘遍历（`:56-76`） | 未单跑 |
| `tests/command-shape.test.ts`（36 用例） | ✅ 真 | 命令形状/包装器识别 | 36 passed / 0s |
| `tests/sandbox.test.ts`（9 用例） | ✅ 真 | profile 真值表 + env 白名单 | 9 passed / ~1s |
| `tests/automation-tool-surface.test.ts`（197 行） | ⚠️ 混合 | 规格面断言是真的（`:110-126` 比对真实工具清单），但 `:129-135` 直接 `readFileSync(agent-runner.ts)` 断言源码字符串 `toContain("installAppTools({ automation: opts.automationTools })")` | 19 passed / ~1s |

**结论：12 个抽样里 11 个是真行为断言，1 个混合。** 水分不是普遍的，而是集中在结构断言族。

### 2.4 变异探针（本报告最强证据）

方法：只读复制到 `/tmp/qa-audit/repo`，注入 3 个人为缺陷，跑 6 个相关测试文件，再还原（`cmp` 校验还原成功）：

| 注入的缺陷 | 结果 |
|---|---|
| A：`src/permissions/autonomy.ts:330` 只读档 L0 硬边界改成 `if (false && …)` | ❌ 被抓住：`autonomy.test.ts` 1 failed、`gate-audit.test.ts` 3 failed |
| B：`src/agent/loop.ts:116` 脱敏 `redactValue` 变空操作 | ❌ 被抓住：`event-log-redaction.test.ts` 1 failed |
| C：`src/tools/base.ts:157` `assertRealContainment` 变空操作 | ❌ 被抓住：`path-boundary.test.ts` 8 failed |

→ **三处安全语义全部有测试守着，"测试是摆设"的假设被证伪** ✅

### 2.5 测试面的两个真问题 ❌

1. **33 个文件用"读源码字符串"当契约**（`readFileSync(new URL("../src/main/agent-runner.ts"))` 之类，如 `tests/usage-attribution.test.ts:313`、`tests/tool-surface-parity.test.ts:18`）。这类断言对**重构零容忍、对语义错误零分辨力**：把实现换成任意等价写法即红，把逻辑写错但字符串还在即绿。它们的作用更像"接线存在性指纹"，建议逐步换成运行时断言。
2. **文档指针漂移**：`src`/`scripts` 里引用的 201 个测试路径中，**5 个文件不存在**：`tests/permission-mode-guided.test.ts`（被 `src/permissions/autonomy.ts:129` 指名"见…"）、`tests/m3b.test.ts`（`scripts/mutate-verify.mjs:2861`）、`tests/event-type-coverage.test.ts`（`mutate-verify.mjs:4609`）、`tests/renderer-terminal-liveness.test.ts` 与 `tests/renderer-truncation-label.test.ts`（桌面层已删，属历史残留）。⚠️ 前三个是活引用。

---

## 3. 类型安全与卫生

### 3.1 强类型纪律 ✅（同规模项目里罕见）

- `tsconfig.json`：`"strict": true` + `noEmit` + `isolatedModules` + `forceConsistentCasingInFileNames`；`include: ["src","scripts","tests"]`（**脚本与测试同样在 strict 下**）。
- **`any` 计数 = 0**——唯一的 2 处 `\bany\b` 命中是 `AbortSignal.any`（`src/providers/retry.ts:72`、`src/main/agent-runner.ts:1363`）。
- `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` = **0**；`TODO/FIXME/HACK/XXX` = **0**（`grep -rnE "\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b" src` → 0）。
- `pnpm typecheck` exit 0 / 0 errors（lead 已验）。`throw new` 276 处 vs 大量返回式错误对象，风格统一。

### 3.2 代价与空洞 ⚠️

- `as unknown as` **19 处**（类型逃逸口），典型如 `src/main/agent-runner.ts:618` 把 `TOOLS` 表强转成 `Record<string, Tool>`（总表 ↔ 动态注入的桥），以及测试里的 `as never`。
- **完全没有 lint/format 基建**：`ls -a | grep -iE "eslint|prettier|biome"` 为空，`package.json` 无 lint 脚本。约束全靠自研扫描器（`scripts/assertion-health.ts`、`scripts/lib/dead-script-refs.ts`、`wiring-coverage.ts`）与 review 纪律。**新人/外部贡献者没有任何自动化的风格护栏。**
- 注释密度 13%–31%（`loop.ts` 最高 31%），注释质量极高（写"为什么"与失败史），这既是优点也意味着**知识大量锁在中文注释里**，对非中文协作者是门槛。

### 3.3 失败是响的还是被吞的

**响的（fail-loud）** ✅：

- `src/agent/loop.ts:292-296`：非取消类异常 → 落 `error` 事件（进事件流，可回放）。
- `src/agent/loop.ts:421`：未知工具名 → `{ ok: false, output: "unknown tool: …" }`，**不会静默按成功继续**。
- `src/providers/openai.ts:246`：SSE 半帧 → 抛 "拒绝静默丢字"。
- `src/providers/openai.ts:125`：缺 key → 抛错（key 只从环境变量读，不落文件）。
- `src/cli.ts:57-65, 756-767`：退出码 0/1/2 有明确语义；SIGINT 先让 run 收束、再收子进程，**不直接 `process.exit(130)`** 以免事件流断在半路。

**吞的（degrade + `console.warn`）** ⚠️（都不把失败伪装成成功，但用户看不见）：

- Hook 引擎失败只打日志：`src/agent/loop.ts:389-392`（PreToolUse）、`:475-477`（PostToolUse）、`src/main/agent-runner.ts:1472,1482,1585,1688`（SessionStart/UserPromptSubmit/Stop/SessionEnd）——**hook 全挂掉时 run 照常绿**。
- 自动验证探测失败 → 跳过验证拍：`src/agent/loop.ts:510-513`。
- 安全快筛失败：`src/main/agent-runner.ts:818-819`（注释自称"不阻断主流程"）。
- 影响面钩子失败：`src/tools/base.ts:207-209`（写入已成功，不回滚——这个取舍是合理的）。
- `src/main/agent-runner.ts` 共 37 个 `catch` / 20 个 `console.warn`，是全仓降级面最密的地方。

---

## 4. 权限与安全模型：fail-closed 是实现了的，不是标语

### 4.1 管线与"未知输入"的默认方向 ✅

`evaluate()`（`src/permissions/autonomy.ts:316-475`）四层固定序短路：L0 硬边界 → L1 deny 规则 → L2 ask 规则 → L3 档位 → L4 风险。逐条核对"缺省往哪边倒"：

- ✅ 档位策略表是 `Record<PermissionMode, ModePolicy>`（`autonomy.ts:145-151`），**少一档编译不过**；运行时兜底 `MODE_POLICY[mode] ?? MODE_POLICY.default`（`:158-161`）——**未知档位落 default，不落 auto**。
- ✅ 粗档表同样 `Record` 且兜底为 ask：`SIDE_EFFECT_DECISION[mode] ?? "ask"`（`src/permissions/index.ts:110`）。
- ✅ 非交互把 ask 降 deny：`gate()`（`src/permissions/index.ts:119-123`）。
- ✅ MCP：`isMcpScopedName(tool)` 为真但调用方没传注解 → 强制 `{ annotated: false }`，按"写"处理；`isWriteCall` 只有 server 明确 `readOnlyHint === true` 才当读（`autonomy.ts:269-272, 323-325`）。注释直接写："把'少传一个参数'读成'这不是 MCP'，等于把本次要修的洞换成另一种形状再埋一遍"。
- ✅ 工具门未接线 → 直接拒：`gatedTool`（`src/main/agent-runner.ts:473-475`）、`gatedMcpTool`（`:578-579`）。
- ✅ critical 风险任何档位强制审批，allow 规则也豁免不了（`:394-402, 432-434`）。
- ✅ 会话内断路器：连续自动放行 50 次触发后降为逐次审批（`:123, 408`）。
- ✅ 只读档 → 写向 L0 直接 deny（`:330-336`）；方案门（先批后写）与冻结判卷文件同层（`:339-348, 354-365`），**规则库不许复活被硬闸摘掉的动作**。

### 4.2 我找到的"未知输入 → ALLOW"缺口清单（诚实清点）

1. ❌ **`checkPermission` 对"不在表里的工具名"默认放行**：`src/permissions/index.ts:106` `if (!isSideEffectTool(tool)) return "allow";`，写向表只有 5 个名字（`autonomy.ts:212-221`：write_file / edit_file / run_shell / shell_rw / spawn_agent）。今天**不是活漏洞**（未注册名字在 `loop.ts:421` 会被 `unknown tool` 挡下；动态注入的只有 `skill` 与 `mcp__*`，后者在 `evaluate` 里被强制按写处理）。但这是全模型里唯一"默认方向朝 ALLOW"的一格：**将来新增一个内置写工具而忘了登记，粗档门会静默放行**。缓解：确有对账测试在钉（`tests/tool-surface-parity.test.ts:83-97` 校验每个注入名在应有面在场、`tests/write-face.test.ts`、`tests/permission-mode-single-source.test.ts`）。
2. ⚠️ **冻结判卷表"文件缺席"= 静默失效**：`src/frozen.ts:20-26` 表不存在 → 返回空集 → L0 判卷面硬闸零行为（设计上为了不强加给用户仓库）；但表**存在却为空/坏格式**会显式抛（`:27-33`）。在**本仓**这个缺口由 `tests/frozen-drift.test.ts` + 50 条基线（`scripts/frozen-sha256.json`）兜着。
3. ⚠️ **`skill` 工具不算写向**（不在 5 名单里）→ auto 档不经审批即可调用 skill。设计使然（skill 本体只做提示词展开，其内部再调工具仍要过门），且有 `tests/skill-tool-policy.test.ts`（399 行）守着。
4. ⚠️ **用户级插件默认 trusted**：`src/agent/plugins/discover.ts:61,279`（"用户自己装的"）。项目级插件走内容指纹 + 信任卡，指纹不完整（超帽/软链）时**拒绝复用旧信任**（`src/agent/plugins/trust.ts:30-40`），`discover.ts:272` 的缺省 `trustOf` 是 `() => "pending"` ✅ fail-closed。

### 4.3 路径包含：真做了 realpath/软链（不是口号）✅

`src/tools/base.ts`：

- 词法层：`resolve` + `relative` 越界检查（`:100-106`）。
- **真身层**：`assertRealContainment`（`:157-168`）先 `realpath(workspace)`，再把落点交给 `resolveDeepest`（`:133-155`）**逐段 `lstat` + `readlink` 手动解软链**，软链层数上限 40（`:114`，防 `readlink` 成环）、单段 `lstat` 失败按"不存在"处理（`:116-123`）。
- 为什么不用现成 `realpath` 的理据写在 `:128-131`：`realpath` 要求整条路径存在，**悬空软链会让"末段是软链"这个事实被丢掉**，从而退回词法父目录而放行——这是个真实的绕过形状。
- 系统区 `.agent/`（权限/记忆/插件配置）词法拒写（`:172-176`）+ **软链解析后复查归属**（`:181-188`，防 `foo -> .agent` 绕过）。
- 证据强度：变异探针 C（把 `assertRealContainment` 改空操作）→ `tests/path-boundary.test.ts` **8 条判红**。

### 4.4 run_shell 沙箱与秘密脱敏 ✅

- **主路径真套 Seatbelt**：`gatedTool` 里 `run_shell` 且 `sandbox.available` → 走 `runInSandbox`（`src/main/agent-runner.ts:544-561`），profile 由 `buildSandboxProfile` 生成（`src/main/sandbox.ts:44`），**缺省不写 network 规则 = 闭箱断网**（`agent-runner.ts:549-550`）；放行网络必须"问过且人批了"（`networkProfileFor`，`sandbox.ts:87`）。沙箱缺失时降级为"写工具强制审批"，`tests/gated-tools.test.ts:96-116` 已证 auto 档无交互也拒。
- **env 消毒**：`run_shell` 不继承 `process.env`（`src/tools/run_shell.ts:41` `sanitizedEnv()`；`src/main/sandbox.ts:100` `sandboxEnv`），注释点名了"一条 `env` 就能把明文 key 读进事件流"（`:38-40`）。
- **落盘面脱敏**：`tool_call.args` 与 `tool_result.output` 的字符串叶子过 `redactSecrets`（`src/agent/loop.ts:116-136`），`verify_result` 的 command/output 同办（`:139-144`）。掩码保留痕迹（`AKIA****`），且"执行面不脱敏"（模型发什么原样执行）——两者都有测试（`tests/event-log-redaction.test.ts:70-105`）。变异探针 B 已证其分辨力。
- Provider key：只从环境变量读（`src/providers/openai.ts:125`）；持久化走 `safeStorage`，**后端不可用则拒存、不落明文**（`src/main/provider-keys.ts:1-22`）。

**§4 小结**：头条宣称属实且可验证。唯一"默认朝 ALLOW"的结构性一格是 §4.2.1，且有对账测试兜底。评级：✅ 强，⚠️ 一处结构隐患。

---

## 5. 最大的工程风险

### 5.1 自指变异机：设计很硬，代价很大 ⚠️

- **体量**：`scripts/mutate-verify.mjs` **8,936 行**；`scripts/lib/*.ts` 合计 **12,135 行**（其中 `mutate-gates.ts` 860 行）；`scripts/` 全量 **26,767 行 / 79 文件**——是 `src/`（35,000 行）的 **76%**。变异表有 **936 条锚点**、覆盖 **133 个源文件**（`grep -cE '^\s{2,4}id: "'`）。

- **自我保护的宣称逐条核对——基本属实** ✅：
  - 主检出拒跑：`mutateTreeGuard`（`scripts/lib/mutate-gates.ts`）比对 `git rev-parse --git-dir` 与 `--git-common-dir`，同指一处即 `refused`，理由写明"被外层超时杀掉就收不回来，突变体与 .mutbak 会留在 src/ 里"。
  - 一次性树重定向：`--in-worktree=<树名>` 只认连写（`scripts/mutate-verify.mjs:8579-8592`），指向当前树则 exit 2；`package.json:44` 的门命令已按此接线。
  - 源头在飞拒变异：`entryDisposition`（`mutate-gates.ts`）对"未跟踪/相对 HEAD 有改动"的源文件 `refused` 抛死，对在飞的判卷测试文件记 `unverified`（不伪装成"变异存活"）。
  - 卫生：`--check-needles` 只读体检（`package.json:14`）、`.mutbak` 残留上报（`mutate-verify.mjs:4320-4323`）、同树占锁防两个实例抢 `.mutbak`（`:8746-8763`）。
  - 承认的局限：SIGTERM 后 1.5s 内无动静，靠 `.mutbak` + 三条证据还原（`:8415-8424`）。

- **自指风险**：门表确实会**变异自己的判据源码**（`src: "scripts/lib/mutate-gates.ts"` 出现在 `:1653, 2396-2464` 等多条），且 `head-cert` 等门再读它的读数。缓解是 `tests/mutate-verify-gates.test.ts`（**1,342 行**，全仓最大的测试文件）+ 针脚审计。这是"用复杂度换可信度"的典型：**可信度是真换来了，但只有原作者维护得动。**

- **时间成本**（作者自报，`scripts/gate-manifest.ts:43-45`）：`head-cert-check` **123.7s**、`mutate-verify` **16.9 分钟**、整张门表更长；`scripts/lib/gate-failure-log.ts:4` 记载定位一次"7 条存活"要 **1,007s**。全量 `pnpm test` = **222.27s**（lead 实测）。⚠️ 对外部贡献者/CI 而言，反馈环太长。

### 5.2 766KB 的 PROGRESS.md 与 outputs/ 是**承重墙**，不只是文档负担 ❌

- `PROGRESS.md`：**5,705 行 / 766,102 字节 / 384 处"第 N 页"标记 / 237 次提交**。
- **它被门禁读**：`scripts/docs-check.ts:194` `REPLAY_DOC_FILES = ["AGENTS.md", "PROGRESS.md", "STATE.md"]`、`scripts/lib/judge-input-face.ts:21` 把它列为判卷输入面根文件、`scripts/facts.ts` / `scripts/replay-readings.ts` / `mutate-verify.mjs` 也引用它。→ **改文档格式可能让门变红**，文档因此不能自由整理。
- 作者自己写过担心的形状：`scripts/facts.ts:47` "环形上限：账本自己不许长成第四份 PROGRESS.md"。
- `outputs/`：**207 个条目 / 7.9MB / 348 个文件已入 git**；`.worktrees/` **23 个目录 / 1.2GB**（含 `gate-head-cert`、`gate-mutate-verify`、多个 `head-cert-*` 快照树）；仓库总计 1.4GB。
- 判断：**可读性债务 + 磁盘/克隆成本**；"每笔改动都写进 766KB 流水账"是流程文化问题，不是代码问题，但它确实降低了新人的进入速度。

### 5.3 其余风险（按严重度）

- ❌ **README 有 3 处与事实不符**：`README.md:221` 称 "33k 行 `src/`"（实测 **35,000**）；`README.md:4,9`（及 `:37,86,97,105`）给出 `npm install` + `npx m0 "…"` 的全局安装路径，但 `package.json:4` 是 `"private": true`，且 `bin/m0.mjs:7` `import { register } from "tsx/esm/api"` —— **tsx 是 devDependency**（`package.json:48`），作为 npm 包安装后该 CLI 起不来；`README.md:230` 说 `src/main/` 是"electron-free 应用服务（装配根）"，实际 `ipc-protocol.ts`（15 个导出、纯类型）已无 IPC 宿主。
- ⚠️ **门禁与 HEAD 绑定**：`AGENTS.md` 明说 `pnpm mutate-verify` 量的是 HEAD、必须先提交；而本仓常态是"33 个文件未提交"（`git status --porcelain`）。**"改完即验"在这棵树上是走不通的流程**，需要"先提交再验"或开树。
- ⚠️ **残留的桌面层配置**：`pnpm-workspace.yaml` 里 `allowBuilds: electron-winstaller: set this to true or false` 是 pnpm 生成的占位串，从未填；`onlyBuiltDependencies: [esbuild]`。
- ⚠️ **历史测试文件引用失效**（§2.5.2），活引用 3 处。
- ⚠️ **单测里 `as unknown as ModelOutput` / `as never`** 制造假 provider（如 `tests/event-log-redaction.test.ts:31,58`）——可接受，但它意味着**测试不覆盖真实 provider 的参数校验面**（那由 `providers.test.ts` + `provider:check` 门覆盖）。

---

## 6. 依赖与供应链

✅ **面很小**：运行期依赖 6 个（`package.json:52-58`），实际被核心 import 的只有 4 族（自带 import 统计）：`@modelcontextprotocol/sdk`（5 个子路径）、`croner`、`vscode-languageserver-protocol/node`、`@vscode/ripgrep` + `web-tree-sitter`/`tree-sitter-wasms`（后三者经 `createRequire` 运行时解析）。

| 依赖 | 版本声明 | 判读 |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.30.0` | ⚠️ 浮动；已装 1.30.0 |
| `@vscode/ripgrep` | `^1.18.0` | ⚠️ 浮动；已装 1.18.0 |
| `croner` | `^10.0.1` | ⚠️ 浮动；纯 JS；已装 10.0.1 |
| `vscode-languageserver-protocol` | `^3.18.3` | ⚠️ 浮动 |
| `web-tree-sitter` | `0.25.10` | ✅ 精确锁定（与 wasm grammar 版本强耦合） |
| `tree-sitter-wasms` | `0.1.13` | ✅ 精确锁定 |

- ✅ **锁文件已入库且有完整性哈希**：`git ls-files --error-unmatch pnpm-lock.yaml` 通过；`grep -c "integrity:"` = **207**；`lockfileVersion: '9.0'`。
- ✅ **原生二进制不需要运行时下载**：`node -e "require('@vscode/ripgrep').rgPath"` →
  `node_modules/.pnpm/@vscode+ripgrep-darwin-arm64@1.18.0/…/bin/rg`（`exists=true`）。1.18.0 走 optional 平台包，不依赖 postinstall 下载；`pnpm-workspace.yaml` 的 `onlyBuiltDependencies: [esbuild]` 印证了构建脚本白名单很窄。
- ✅ **WASM 全离线**：`src/agent/map/parse.ts:19,29,49` 用 `createRequire.resolve("web-tree-sitter/…")` 与 `tree-sitter-wasms/out/tree-sitter-<lang>.wasm` 从磁盘加载，**无 CDN、无 fetch**；已确认 `node_modules/tree-sitter-wasms/out/*.wasm` 在盘上。该模块对 grammar 缺失有 `TreeSitterUnavailableError` 显式降级（地图功能）。
- ✅ **核心代码零网络**：`grep -rn "fetch(" src` → **0 命中**（唯一 fetch 在 `src/main/updater.ts:68` 且可注入、默认不跑）。更新检查是 opt-in：需 `settings.updateManifestUrl`，仅 https（`updater.ts:60-68`），**不做自动下载**，且 `checkUpdate` 只被 `settings-handlers.ts:147` 调用，CLI 路径根本不经过。
- ⚠️ **MCP stdio = 任意本地命令执行面**：`src/agent/plugins/mcp.ts:161-166` `new StdioClientTransport({ command: cfg.command, args, env })`，命令来自插件配置（`.mcp.json` 同款）。**缓解是有的**：项目级插件未信任不激活、信任绑定内容指纹、指纹不完整则 pending（`trust.ts:30-40`、`discover.ts:272`）。但用户级插件默认 trusted（§4.2.4），属需要用户知情的边界。
- ⚠️ 4/6 依赖用 caret 浮动：靠 lockfile + `pnpm install --frozen-lockfile`（无 CI，故实际约束弱）。
- ✅ 无 `npx`/`npm install`/下载器字符串出现在 `src/`；提供商 key 只从 env 读。

**供应链结论：风险低。** 小依赖面、锁文件+完整性哈希、二进制与 WASM 均可离线解析、网络面只有 opt-in 更新检查与用户自配的 MCP。主要瑕疵是"浮动版本声明 + 无 CI 冻结校验"。

---

## Top 10 弱点（按严重度排序）

1. ❌ **`src/main/agent-runner.ts` 是 god-module**：2,502 行 / 扇出 56 / 61 个 export / 单函数 371 行（`:1330`），且持有 `let session`（`:192`）等进程级单例——装配、权限、调度、插件、会话状态全挤在一处，是改动风险与理解成本的第一来源。
2. ❌ **1,341 行产品级死代码**：`src/main/scheduler.ts`（1,016）+ `src/main/automations.ts`（325）被 import、被 186 条测试守护、被门禁与变异锚点覆盖，但**没有任何生产调用点**（`initScheduler` 全仓无调用；`src/cli.ts:728` 显式 `automationTools: false`）。
3. ❌ **验证机器比产品重**：`scripts/` 26,767 行 ≈ `src/` 的 76%；`mutate-verify.mjs` 8,936 行 + `lib` 12,135 行、936 锚点、会变异自己的判据源码；一道门 16.9 分钟、`head-cert` 123.7s、定位一次失败 1,007s——只有原作者维护得动。
4. ❌ **766KB `PROGRESS.md` 是承重墙**：5,705 行 / 384 页 / 237 次提交，且被 `docs-check.ts:194`、`judge-input-face.ts:21`、`facts.ts` 读作判卷输入——文档不可自由整理，构成长尾维护债（外加 7.9MB `outputs/`、1.2GB `.worktrees/`）。
5. ⚠️ **33 个测试文件用源码字符串当契约**（`tests/automation-tool-surface.test.ts:129-135`、`tests/tool-surface-parity.test.ts:18` 等）：重构即红、语义错误不红。
6. ❌ **粗档权限对"未登记工具名"默认 ALLOW**（`src/permissions/index.ts:106`）：全模型唯一默认朝放行的一格；今天被 `loop.ts:421` 的 unknown-tool 拒绝与对账测试兜住，但默认方向本身是隐患。
7. ⚠️ **README 与事实不符 3 处**：`src/` 行数 33k vs 实测 35,000；`npx m0` 全局安装路径不可用（`private: true` + tsx 是 devDependency，`bin/m0.mjs:7`）；`src/main/` 仍留 `ipc-protocol.ts` 这类无宿主的 IPC 面。
8. ⚠️ **静默降级面偏宽**：hook 引擎（`loop.ts:389,475`）、自动验证探测（`:510`）、安全快筛（`agent-runner.ts:818`）失败都只 `console.warn`——用户可能在"没有 hook、没有自动验证"的状态下拿到一个绿色 run。
9. ⚠️ **零 lint/format 基建 + 无 CI/无 hook**：28 道门禁全靠手动触发，外部贡献者没有任何自动风格护栏；19 处 `as unknown as` 无静态检查兜底。
10. ⚠️ **流程与门禁互相别扭**：变异门只认 HEAD，而本仓常态是 33 个未提交文件（`AGENTS.md` 自述）——"改完即验"不可行；另有过期测试引用 5 处（3 处是活引用）。

## Top 10 优点（按证据强度排序）

1. ✅ **测试真有分辨力，且被我的变异探针独立证实**：3/3 安全缺陷（L0 只读硬边界、脱敏、软链包含校验）当场被现有测试判红；241 文件里 `vi.mock(` 只有 9 处，0 个 skip/only/snapshot。
2. ✅ **fail-closed 是机制不是标语**：四层短路管线 + `Record` 编译期完备性 + 未知档位回落 default（`autonomy.ts:158`）+ 非交互 ask→deny（`index.ts:121`）+ 门未接线即拒（`agent-runner.ts:475`）+ 无人值守立即拒（`ask-gate.ts:61-64`）。
3. ✅ **路径包含真做软链解析**：`lstat` 逐段解链 + `realpath` 比对 + 深度上限 + `.agent` 真身复查（`src/tools/base.ts:133-188`），并有 23 条边界测试；改空操作立刻 8 条红。
4. ✅ **秘密脱敏覆盖全部落盘面**：`tool_call.args` / `tool_result.output` / `verify_result.command+output` 字符串叶子过 `redactSecrets`（`loop.ts:116-144`），掩码留痕、执行面不改写，正反两向都有测试。
5. ✅ **类型卫生顶级**：strict（含 scripts/ 与 tests/）、`any`=0、`@ts-ignore`=0、`TODO`=0，`pnpm typecheck` 0 error；注释密度 13–31% 且写的是"为什么"与失败史。
6. ✅ **供应链风险低**：6 个运行期依赖、锁文件 + 207 条完整性哈希、ripgrep 原生二进制与 tree-sitter WASM 全部离线可解析、`src/` 内 0 处 `fetch(`、更新检查 opt-in 且仅 https。
7. ✅ **事件溯源纪律落到测试**：append-only、未知事件类型拒收、坏行"中段不静默跳过"、增量与全量同判（`tests/events.test.ts:42,151,172`）。
8. ✅ **判卷自我体检**：`tests/assertion-health-scan.test.ts` 扫空断言/恒真式并**自带反向对照**（`:43`）；`scripts/gate-manifest.ts:13` 是门数（28）唯一事实源，另有 orphan 脚本护栏。
9. ✅ **判卷文件冻结机制**：`scripts/frozen-sha256.json`（50 条基线）+ L0 硬闸禁止用 allow 规则复活（`autonomy.ts:354-365`），且"表存在却为空"显式抛错（`frozen.ts:27-33`）。
10. ✅ **产品面有端到端契约测试**：`tests/cli-surface.test.ts` 真 `spawnSync` 起 `bin/m0.mjs`、断言退出码 0/1/2 与可操作 stderr；`tests/gated-tools.test.ts` 真跑 `runAgent` 打靶子并断言盘上文件被修复/未被破坏。

---

### 附：本报告用到的关键命令

```bash
node /tmp/qa-audit/graph2.mjs                         # import 图 / 零入边 / 可达性
node /tmp/qa-audit/comments.mjs                       # 大文件注释密度
node /tmp/qa-audit/class.mjs                          # 类的 god-object 度量
bash /tmp/qa-audit/probe.sh                           # /tmp 副本上的 3 组变异探针（含还原校验）
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/<name>.test.ts
grep -rn "@ts-ignore\|@ts-expect-error\|@ts-nocheck" src tests   # → 0
grep -rnE "\bany\b" src                                # → 2（均为 AbortSignal.any）
node -e "require('@vscode/ripgrep').rgPath"            # 原生二进制可解析
```
