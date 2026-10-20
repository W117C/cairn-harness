# 工程质量审计（代码健不健康）

- **审计人**：quality2（teammate）
- **时间**：2026-10-01
- **仓库**：`/Users/ze/Downloads/deepseek harness`，分支 `zcode`，HEAD `bd5ec44`
- **纪律**：**全程只读**。所有动手实验都在 `/tmp/q2audit/lab/` 的临时工作区做（`mktemp`/`ln -s` 造软链靶子），
  只 `import` 仓库源码、从不写回。开工前 `git status --short` 17 条，收工时 18 条 —— 多出的
  `?? tests/impact-persistence.test.ts` 是**其它会话**新写的，不是本审计产生的（对照开头/结尾两次
  `git status` 可见）。未执行任何 reset / stash / checkout，未跑全量测试。

---

## 0. 一句话结论（给非技术业主）

**这是我在真实项目里见过的、工程纪律最严的一档代码**：类型 100% 干净、测试零造假、安全门是真机制不是口号。

但它的**风险不在代码里，在流程外**：整套门禁（26 道）**没有 CI、没有 git hook 兜底**——全靠人记得手动跑。
而且**此刻就有一道门是红的**，`pnpm gates` 跑不出全绿。另有约 6% 的源码（2,164 行）**根本不在产品运行路径上**，
包括「无进展检测」「成本/进展比」「可复现性」这几项对外宣称的能力。

一句话：**代码是 A 档，流程是 C 档，宣称与接线之间有 B 档的缺口。**

---

## 1. 结构与耦合

### 1.1 各目录体量（细分）

| 目录 | 文件 | 行数 | 占比 | 最大文件 |
|---|---:|---:|---:|---|
| `src/agent/` | 83 | 20,367 | 56.3% | `orchestrator.ts` 2,565 |
| `src/main/` | 22 | 7,030 | 19.4% | `agent-runner.ts` 2,534 |
| `src/tools/` | 25 | 3,240 | 9.0% | `lsp.ts` 664 |
| `src/providers/` | 12 | 1,668 | 4.6% | `anthropic.ts` 304 |
| `src/permissions/` | 7 | 1,477 | 4.1% | `autonomy.ts` 525 |
| `src/`（根 4 文件） | 4 | 1,071 | 3.0% | `cli.ts` 770 |
| `src/events/` | 1 | 967 | 2.7% | `index.ts` 967 |
| `src/routing/` | 4 | 515 | 1.4% | `bandit.ts` 163 |
| **合计 src** | **158** | **36,177** | 100% | |

配套面（不含 node_modules/.git）：

| 面 | 文件/条目 | 行数 / 体量 |
|---|---:|---:|
| `tests/` | 258 `.test.ts` | 48,270 行 |
| `scripts/` | 87（顶层 50 `.ts`） | 31,773 行 |
| `fixtures/` | 1,133 | 36 MB |
| `outputs/` | 261 | 13 MB |
| `PROGRESS.md` | 1 | 8,473 行 / 1,128,195 字节 / 328 次提交 |
| `.worktrees/` | 20（`git worktree list` 共 24） | 364 MB |

> **读法**：写产品的代码 3.6 万行，**验证它的代码 8 万行**（tests 4.8 万 + scripts 3.2 万）＝ 2.2 倍。
> ✅ 这是罕见的验证投入；⚠️ 但也意味着这个仓库的**主体其实是验证装置**，产品本身只占三分之一。
> 对新接手的人是实打实的学习成本。

### 1.2 最大的文件 —— 谁是「上帝文件」

用脚本统计每个大文件的顶层函数数、导出数、`import` 行数（扇出）、被引用次数（扇入）：

| 文件 | 行 | 顶层函数 | 导出 | import 行(扇出) | 扇入 | 判定 |
|---|---:|---:|---:|---:|---:|---|
| `src/agent/orchestrator.ts` | 2,565 | 6（+1 个大 class） | 18 | 38 | 2 | ❌ 单类承担编排全责 |
| `src/main/agent-runner.ts` | 2,534 | **71** | **62** | **58** | **1** | ❌ 教科书级上帝文件 |
| `src/main/scheduler.ts` | 1,017 | 18 | 38 | 5 | 2 | ⚠️ 偏大 |
| `src/events/index.ts` | 967 | 14 | **69（含 44 个 interface）** | 3 | **44** | ⚠️ 全仓枢纽 |
| `src/agent/glm-session.ts` | 890 | 8 | 10 | 21 | 5 | ⚠️ |
| `src/cli.ts` | 770 | 18 | 1 | 12 | 0 | ✅ 入口文件，正常 |
| `src/agent/compaction.ts` | 733 | 19 | 30 | 3 | 9 | ⚠️ |

**证据**：
- `src/main/agent-runner.ts`：**一个文件里 71 个顶层函数、62 个导出、依赖 58 个模块，而全仓只有 `src/cli.ts` 一个文件引用它**（扇入 1）。
  这是「什么都往里塞、没人从外面拆」的典型形状。它是整个产品最脆的一块：改一处影响面 58 个模块。
- `src/events/index.ts`：**扇入 44**（全仓最多）。44 个模块依赖它，它自己只依赖 3 个 —— 这是健康的「底层被依赖」形状，
  但它把 **44 个 interface + 69 个导出**塞进一个 967 行文件，事件契约一改，44 个消费方一起动。

### 1.3 跨层依赖环

用 Tarjan 强连通分量算法跑完 158 个文件的完整 import 图：

```
❌ 一个 20 文件的环（跨 5 个目录）：
   src/events/index.ts (967)  ←→  src/tools/base.ts (228)  ←→  src/permissions/autonomy.ts (525)
   ←→  src/permissions/index.ts (130)  ←→  src/permissions/risk.ts (175)  ←→  src/permissions/rules.ts (285)
   ←→  src/tools/{read_file,write_file,edit_file,run_shell,grep,glob,lsp,index}.ts
   ←→  src/agent/verify.ts (313)  ←→  src/providers/stop-reason.ts  ←→  src/agent/recovery.ts
   ←→  src/tools/{propose_plan,clarify}.ts  ←→  src/tools/output-ring.ts

⚠️ 3 个 2 文件小环：
   src/agent/impact/persist.ts  ←→  src/agent/impact/index.ts
   src/agent/plugins/manifest.ts ←→ src/agent/plugins/types.ts
   src/agent/worker-tool-table.ts ←→ src/agent/orchestrator.ts
```

**跨层边（次数）**：`agent→tools` 39、`agent→events` 31、`main→agent` 29、`agent→providers` 27、
`main→providers` 17、`agent→permissions` 15、`main→tools` 14、**`tools→agent` 10**、`tools→permissions` 1、
**`events→agent` 1**、`providers→agent` 1。

> ❌ **分层只是名义上的**。`tools` 反过来 import `agent` 10 次、`events` import `agent`，
> 而 `agent` 又 import `tools`/`events` —— 那个 20 文件的环就是这么来的。
> 实际结构是「一张网」而不是「金字塔」。**好消息**：这个环是**编译期可解析的纯类型/常量环**，
> 不是运行时初始化环（`tsc --noEmit` 通过、`pnpm e2e` 绿），当前不产生 bug。
> **坏消息**：任何「把某一层单独拿出来复用/测试」的想法都会撞上这个环。
> 代码里的注释显示作者**知道**这件事（`src/permissions/index.ts:80-82` 明确写了「本文件正 re-export autonomy 的符号 = 循环」，
> 并为此把 `plan-state.ts` 抽出来打破一环）—— 是「知情接受的债」，不是疏忽。

### 1.4 死代码（真死 / 半死）

**真死（全仓零引用）：0 个。** 158 个文件全部至少被引用一次。

**半死（只被测试/脚本引用，生产路径上没有任何调用点）：9 个**，共 2,164 行。
以 `src/cli.ts`（`package.json` 里 `bin: {"m0": "./bin/m0.mjs"}` 指向的唯一入口）为起点做可达性分析：

| 文件 | 行 | 唯一的引用方 | 它宣称的能力 |
|---|---:|---|---|
| `src/agent/tool-choice.ts` | 280 | 3 测试 + `scripts/{ga-strategy,tool-choice}.ts` | 工具选择策略 |
| `src/agent/no-progress.ts` | 249 | 1 测试 + `scripts/no-progress-check.ts` | **无进展检测（outcome-shaped）** |
| `src/agent/eval/task-set.ts` | 245 | 1 测试 + `scripts/loop-eval.ts` | 评测任务集 |
| `src/agent/gym/runner.ts` | 204 | 5 测试 + 3 脚本 | 自评测跑者 |
| `src/agent/gym/draft.ts` | 179 | 1 测试 + 2 脚本 | — |
| `src/agent/reproducibility.ts` | 153 | 1 测试 + 2 脚本 | **可复现性度量** |
| `src/agent/cost-per-progress.ts` | 152 | 1 测试 + `scripts/cost-per-progress-check.ts` | **成本/进展比** |
| `src/agent/gym/case.ts` | 116 | 仅 `scripts/gym-*.ts` | — |
| `src/agent/gym/{probe,score,script}.ts` | 535 | 仅脚本 | 自评测 |
| `src/providers/byok.ts` | 51 | 仅 `tests/providers.test.ts` | BYOK |

**这不是「废码」，而是「量具没接到机器上」**：
- `scripts/gate-manifest.ts:13` 的 `GATES` 里有 `no-progress-check`、`cost-per-progress-check`、`replay-determinism-check` 三道门 —— 
  **它们每次都跑绿，但生产 loop 里根本没有这些能力的调用点**。
- 我核对了生产路径：`src/agent/loop.ts` 只 import 了 `stuck.ts`（action-shaped：同动作重复），
  **没有 import `no-progress.ts`**（outcome-shaped）。两套检测的差别，作者在 `src/agent/no-progress.ts:1-17` 自己写清了。
- 旁证：`src/agent/no-progress.ts:22` 的写向工具表列了 `["write_file","edit_file","apply_patch","delete_file","move_file"]` ——
  **后三个工具在本仓根本不存在**（`src/tools/index.ts:16-26` 只注册 9 把）。`src/agent/write-face.ts:7` 把这张表
  当成「四份各自漂移的清单」的第 ④ 份记录下来。

> ⚠️ **给业主的直白版本**：宣传册上说「有停滞检测 / 成本效益度量 / 可复现性验证」，代码确实写了、也确实有门在跑绿，
> **但这些能力没有装到 agent 的主循环上**。跑起来的 agent 不会用它们。这是一条需要澄清的**宣称-接线缺口**。

### 1.5 `src/main/` 里的桌面残骸

`AGENTS.md` 说「桌面层已移除，只剩 electron-free 的 core」。事实是：

- ✅ 全仓 `src/` 里 `grep -iE 'ipcMain|BrowserWindow|electron|autoUpdater|renderer|preload'` **零个真实代码引用**，
  只有注释（`src/main/ipc-protocol.ts:1` 自称「main/preload/renderer 共享的类型」但内容是纯 type）。
- ⚠️ 但 `src/main/updater.ts`（159 行，自动更新检查）、`src/main/license.ts`（109 行，Ed25519 授权校验）、
  `src/main/{settings,settings-handlers,session-handlers,memory-handlers,onboarding-groups}.ts` **合计约 1,300 行**
  是**桌面 App 的处理器**，在 CLI-only 的核心里没有真实用户。它们被 `agent-runner.ts` 间接引用所以不算死码，
  但属于「为已删除的界面服务的代码」。`src/main/ipc-protocol.ts` 文件名本身就是证据。

---

## 2. 测试质量（不看数量看真假）

### 2.1 `tests/vitest.config.ts` —— **没有做手脚** ✅

```ts
// tests/vitest.config.ts:25-28
include: ["tests/**/*.test.ts"],
fileParallelism: false,
```

- ✅ **没有任何 `exclude`**。全仓 258 个 `.test.ts` 全部在判卷面内，一个都没被排除。
- ✅ 没有任何 `retry`、没有抬高 `testTimeout`、没有 `--passWithNoTests` 之类的逃生口。
- ✅ 前 20 行只做一件事：给 `PI_SCRATCH_DIR` / `M7_IMPACT_TAGS_DIR` 兜底到 `os.tmpdir()`，
  且注释写明理由是**「测试数据绝不落工作区，也绝不落用户家目录」**（`:18`）。这是加固，不是放水。
- ⚠️ `fileParallelism: false` 让全量测试**串行**跑。258 个文件串行是「跑一次全套很贵」的直接原因，
  也是「没人愿意每次改完都跑」的心理成因。

### 2.2 skip / only / snapshot —— **全部为 0** ✅

| 项 | 计数 |
|---|---:|
| `it.skip` / `describe.skip` / `test.skip` | **0** |
| `it.only` / `describe.only` | **0** |
| `it.todo` | **0** |
| `xit` / `xdescribe` | **0** |
| `toMatchSnapshot` / `toMatchInlineSnapshot` | **0** |
| 盘上 `__snapshots__` 目录 | **0** |
| `src/` 里的 `.skip(` | **0** |

> ✅ 一个 258 文件、3,256 个用例的测试套件，**零跳过、零隔离、零快照**。这在真实项目里几乎见不到。

### 2.3 是不是自己测自己

| 指标 | 数值 | 读法 |
|---|---:|---|
| `it`/`test` 块 | 3,256 | — |
| `expect()` | 9,387 | ✅ 平均 2.9 断言/用例 |
| `expect(true).toBe(true)` | 0 | ✅ |
| `expect(x).toBe(x)`（自反） | 1（正则误报） | ✅ |
| `vi.mock()` | 9（仅在 9 个文件） | ✅ 极低 |
| `vi.fn()` | 18 | ✅ 极低 |
| `vi.spyOn` | 13 | ✅ 极低 |
| `.toHaveBeenCalled*` | 10 | ✅ 不测 mock 调用，测真实返回值 |
| 断言分布 | `toBe` 4318 / `toContain` 1993 / `toEqual` 1161 / `toThrow` 226 / `rejects` 183 | ✅ 以精确值为主，`toBeTruthy` 只 22 次 |
| 导入 ≥1 个 `src/` 模块的测试文件 | **154 / 158 个 src 模块** | ✅ 97.5% 的源码模块有测试触碰 |

**没有任何一个测试文件是零断言的**（0 个）。**没有任何一个文件的用例数多于断言数**。

### 2.4 抽样细读（10 个文件）

我完整读了 3 个、逐条读了 7 个的用例标题与断言。结论：**真断言行为，而且是「双向对照」式的真断言**。

**样本 1 · `tests/event-log-redaction.test.ts`（162 行，真行为）** ✅
- 真的 `mkdtemp` 建临时工作区 → 真跑 `runLoop` → 真 `readFile` 读回 JSONL → 断言**原文不在盘上**（`:77-78`）。
- 关键设计：同一组既钉「落盘面脱敏」又钉「**执行面不脱敏**」（`:93-103` 断言工具拿到的仍是原值），
  注释写明「只钉一半会写出把模型命令改成掩码的假修复」。
- 还钉了「干净输出逐字不变」（`:105-110`），防止脱敏把无关字节改坏。

**样本 2 · `tests/write-face.test.ts`（199 行，真行为 + 覆盖棘轮）** ✅
- 真跑 `runLoop` 造「只经 shell 落盘」的剧本，断言**自动补了一拍 verify**（`:165-171`），
  并同时跑**反向剧本**「只跑 `ls` 不补拍」（`:173-198`）。
- `:88-105` 是一条**覆盖性棘轮**：`Object.keys(TOOLS)` 里每个工具名必须被显式归类，新增工具不登记就红。
  这是我这次审计里看到的**最强的一条防漏机制**。

**样本 3 · `tests/tool-surface-parity.test.ts`（122 行，源文本对账）** ⚠️
- 它确实是「读源码字符串当契约」那一类（`:18` `readFileSync(src/main/agent-runner.ts)` + 正则扒注入名）。
- **但它是这个模式里最好的一种**：作者自己写了失效方向分析和反向对照 ——
  `:6` 「文本对账的失效方向是**假绿**，所以最后一条测是它自己的反向对照」，
  `:109-121` 真的构造假工具名验证对账器能报错，`:100-107` 专门钉「解析器别静默 0 命中」。
- 残余脆弱性：三个解析器里只有 `tableInjectedNames()` 有 0 命中自证（`:100`）；
  `globalInjected()` / `runLoopInjected()` **没有**。我实测当前三个解析器分别命中 6 / 6 / 2 个工具
  （`agent-runner.ts` 的正则），但**如果 `agent-runner.ts` 改了注入写法的格式，前两个会静默退化成空数组**，
  这门就变成「扫空气还报绿」。这是一条**已知但未封口**的脆点。

**样本 4 · `tests/budget-price-key.test.ts`（95 行，源文本契约）** ⚠️
- `:73-93` 全部是 `readFileSync` 拉 `src/main/agent-runner.ts` 后跑正则：
  `expect([...t.matchAll(/resolveMainModel\(/g)].length).toBe(1)`。
- ⚠️ **这是典型的「重构就红、语义坏了却不红」**：数的是**文本出现次数**，不是语义。
  把变量改名、把调用挪行、把一个正确实现换成另一个名字的正确实现 —— 都可能无意义地红；
  反之，一个语义已坏但文本形状没变的改动可以照样绿。
- 缓解：`:92-93` 有反向断言（旧写法回来必须红），`:1-10` 有非常具体的事故复盘。所以它「脆但有用」。

**样本 5 · `tests/replay-readings-registry.test.ts`（80 行，元测试）** ⚠️→✅
- 测的是「`scripts/replay/*.ts` 里不许有未登记又没人 import 的孤儿」。`:70` 有一句值得抄下来的断言：
  `expect(files.length, "取料清单为空 ⇒ 这条判据是瞎的").toBeGreaterThan(0)` —— **分母自己要有读数**。

**样本 6-10（逐条读用例标题）**
- `tests/permissions.test.ts`（348 行）：`read-only 档 write_file→deny`、`非交互 ask 被拒（fail-closed）`、
  `前置无关命令不得击穿 deny：'echo x && git push --force' 整链 deny`（`:94`）—— 断言具体攻击串，非泛泛而谈。
- `tests/shell-bypass-composition.test.ts`（404 行）：`① 用户手写的 deny：11 种包装写法`、
  `:57` 「清单不收窄：九类包装写法各至少一条（**把清单改窄就是把自己判绿**）」—— **防自绿的元断言**。
- `tests/cli-surface.test.ts`（672 行）：真 `spawnSync` 跑 `bin/m0.mjs`（不是 import 源码），
  逐个断言退出码 0/1/2 与 help 文本。`--help 里列出这个 flag（没进 help 的选项等于不存在）`。
- `tests/impact-query.test.ts`（629 行）：`:175` 「三条具名成因互不同形（同形就等于没分诊）」，
  要求错误原因必须**可区分**，而不是笼统报错。
- `tests/assertion-health-scan.test.ts`（192 行）：`尺子本身不是恒绿的：已知病样必须报出来`（`:43`）、
  `反面对手：清单里已不再命中的条目必须删掉（豁免名单不许自己烂着）`（`:160`）。

### 2.5 测试体量的真相：**23% 的断言在测「测试装置」**

以「是否 import 了 `../src/`」区分：

| | 文件 | 行数 | 用例 | 断言 | 断言占比 |
|---|---:|---:|---:|---:|---:|
| **产品测试** | 221 | 38,672 | 2,374 | 7,211 | 76.8% |
| **元测试**（测门禁/脚本/文档，不 import src） | 37 | 9,710 | 882 | 2,176 | **23.2%** |

最大的元测试：`tests/mutate-verify-gates.test.ts` **1,802 行 / 403 断言**、
`tests/head-cert-deps.test.ts` 1,082 行 / 279 断言、`tests/prose-needle-scan.test.ts` 802 行 / 187 断言、
`tests/mutate-shards.test.ts` 633 行 / 166 断言、`tests/docs-check.test.ts` 520 行 / 133 断言。

> ⚠️ 这**不是造假**，而是一种「把验证装置本身也当产品来验证」的极端投入（`mutate-verify-gates.test.ts` 测的是
> 「证明测试会红的工具」，即二阶验证）。质量上值得尊敬，但读数字时必须知道：
> **「3,256 个测试 / 9,387 条断言」里约四分之一不在验证产品，而在验证验证器。**

### 2.6 「读源码字符串当契约」的规模

258 个测试文件中 **14 个（5.4%）** 用 `readFileSync` 读生产源码做正则断言，其中 **11 个**读的是
`agent-runner.ts` / `orchestrator.ts` / `loop.ts` / `glm-session.ts` 这类大文件：

```
tests/head-cert-deps.test.ts        1082 行
tests/prose-needle-scan.test.ts      802 行
tests/cli-surface.test.ts            673 行
tests/orchestrator-hold.test.ts      377 行
tests/usage-attribution.test.ts      375 行
tests/prompt-surface-check.test.ts   347 行
tests/goal-stop-decision.test.ts     246 行
tests/wiring-coverage.test.ts        210 行
tests/automation-tool-surface.test.ts 198 行
tests/tool-block-witness.test.ts     148 行
tests/main-provider-runtime.test.ts  125 行
tests/tool-surface-parity.test.ts    123 行
tests/budget-price-key.test.ts        96 行
tests/verify-exec-sandbox.test.ts     81 行
```

**判定：⚠️ 有意的、被反复反省过的取舍，不是无知。** 代码里能读到明确的理由
（`tool-surface-parity.test.ts:4-6`：实例面为何走源文本而不是执行 `installAppTools()` —— 那会拉起半个主进程）。
**代价**：这 14 个文件对「重命名/搬家/格式化」敏感，对「语义悄悄改坏」不敏感 —— 与理想契约测试的失效方向相反。
**收益**：它们确实在别的门都看不见的地方抓到了真实事故（每处注释都指名了具体事故与日期）。

---

## 3. 类型与卫生

### 3.1 `strict` 开了吗 —— **开了，而且是全仓最干净的一档** ✅✅

`tsconfig.json`：

```json
{ "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext",
  "moduleResolution": "Bundler", "isolatedModules": true,
  "include": ["src", "scripts", "tests"] }
```

✅ `include` 覆盖 `src` + `scripts` + `tests` 三面 —— **测试文件也在类型检查内**（很多项目不这么做）。
✅ 独立跑 `node --import tsx scripts/typecheck.ts`：**24.6 秒，0 条报错，exit 0**。
✅ `scripts/typecheck.ts:18` 用的是项目本地 `tsc --noEmit`，`:24` `const code = run.status ?? 1`（拿不到状态码按失败算）、
`:31` `process.exit(code)` —— **退出码原样转发，没有任何掩饰**。`:11` 还有一句「git 不可用 ⇒ 空集：所有报错都按『HEAD 内』处理（保守，绝不为草稿开脱而掩盖真错）」。

### 3.2 `any` / `@ts-ignore` / TODO 计数 —— **全 0**

| 项 | src 计数 |
|---|---:|
| `as any` | **0** |
| `: any` 类型标注 | **0** |
| `<any>` 泛型 | **0** |
| `@ts-ignore` | **0** |
| `@ts-expect-error` | **0** |
| `@ts-nocheck` | **0** |
| `eslint-disable` | **0** |
| `TODO` / `FIXME` / `HACK` / `XXX` | **0** |
| 非空断言 `!` | 14 |

**核验**：`grep -rn 'any' src --include=*.ts` 全仓只有 **2 处**命中，两处都是 `AbortSignal.any([...])` 这个**真 Node API**
（`src/providers/retry.ts:72`、`src/main/agent-runner.ts:1395`）。即**类型层面零 `any`**。
`as unknown as` 20 处 / `as unknown` 40 处 —— 断言都集中在「事件形状往返」这类确实需要的地方。

> ✅ 一个 3.6 万行的 TS 代码库，**零 any、零 ts-ignore、零 TODO**。这是本次审计里最硬的一条优点。

### 3.3 严格档位仍有缺口 ⚠️

`tsconfig.json` **没有开**：

| 缺失的开关 | 它防的是什么 |
|---|---|
| `noUncheckedIndexedAccess` | `arr[i]` 在越界时返回 `undefined` 却不报错（本仓有大量数组下标访问） |
| `exactOptionalPropertyTypes` | `{a?: string}` 被显式赋 `undefined` 时不报错 |
| `noUnusedLocals` / `noUnusedParameters` | 死变量（本仓有 9 个「半死模块」，这个开关会帮忙） |
| `noImplicitOverride` / `noFallthroughCasesInSwitch` | 继承与 `switch` 穿透 |
| `skipLibCheck: true` | 跳过 `.d.ts` 检查（常规取舍，但它会掩盖依赖里的类型冲突） |

> ⚠️ 这几项不是「错了」，而是**还有更严的空间**。对一个已经零 `any` 的库，开 `noUncheckedIndexedAccess`
> 会是收益最大的一步 —— 它抓的正是「数组下标可能 undefined」这类**运行期才炸**的问题。

### 3.4 错误有没有被吞 —— **fail-closed 为主，138 处静默但大多有理**

- 全仓 `catch` 块 **340** 个。
- **完全空的 `catch {}`（一个字都不写）：0 个** ✅。
- **不绑定错误对象（`} catch {`，错误信息整条丢弃）：138 个**。
- 不重抛且 ≤2 条语句的「疑似静默」catch：184 个（占 54%）。
- **但有错误变量却不使用它的：0 个** ✅ —— 说明命名后的错误都被用上了。

**逐点核查了分布最密的几个文件**（`src/main/agent-runner.ts` 11、`src/main/sessions.ts` 10、
`src/tools/lsp.ts` 8、`src/agent/worktree.ts` 7、`src/main/scheduler.ts` 6），结论：
**绝大多数是「可选资源读不到就当不存在」的正确语义**，且**都写了注释说明为什么**。

实例（`src/main/sessions.ts:38-70` 的 `readHeadMeta`）：注释先写清旧实现的 bug（「固定 1024 字节：首行超过它就 JSON.parse 失败
⇒ 徽标/父归属静默丢失」），然后 `catch { return null }` —— 这里的 null 是**契约里的 fail-safe 值**，不是吞错。
`finally { await fh.close().catch(() => undefined) }` 也是正确的清理写法。

**但仍有值得点名的静默点**：
- ⚠️ `src/main/scheduler.ts:89`：`await writeFile(file, text, "utf8").catch(() => {})` ——
  注释写「rename 失败退直写（不吞数据）」，但这里的 `.catch(() => {})` 是**真把写入失败吞掉了**。
  调度器的落盘若失败，没有任何出口告诉用户。
- ⚠️ `src/agent/worktree.ts:154`：`symlink` 失败降级为警告（注释自称 fail-visible）——
  但「警告」的去处是 `symlinkWarnings: string[]` 数组，**是否真的浮到用户面前没有门在保证**。

---

## 4. 安全模型：「默认拒绝」是真机制还是口号

### 4.1 路径包含 —— 真解软链，而且是**比 `realpath` 更严的实现** ✅✅

**机制**（`src/tools/base.ts`）：
- `:102-109` 第一道：词法 `resolve`/`relative` 边界检查（挡 `../../etc/passwd`）。
- `:117-160` `resolveDeepest()`：**逐段 `lstat` + `readlink` 手动解析软链**，层数上限 40（`SYMLINK_DEPTH_CAP`）。
- `:133-136` 明确写了**为什么不用 `realpath`**：
  > 「realpath 要求**整条路径存在**。末段是悬空软链（指向不存在的目标）时它抛 ENOENT，
  > 于是「末段是软链」这个事实被一并丢掉，祖先回溯退到词法父目录——父目录在界内，真实落点却在界外，门就这么放行了。」

这是**教科书级的洞见**：普通 `realpath(workspace) + startsWith` 的写法恰好漏掉悬空软链。
- `:162-173` `assertRealContainment()`：对照 `realpath(workspace)` 判归属；workspace 不可解析时 **throw**（fail-closed）。
- `:177-181` `assertNotAgentArea()`：词法层拒写 `.agent/`（权限/记忆/插件配置区）。
- `:186-193` `assertNotAgentAreaReal()`：**再按软链解析后的真实落点复查一遍**，
  注释 `:183-185` 说明为什么必须两道：「`foo -> .agent` 的 rel 里没有 ".agent" 字样，两道既有闸都放行，
  写入落到 `.agent/lsp.json`（任意 command → RCE）或 `.agent/permissions.json`（跨会话提权）」。

**我做了实证攻击**（在 `/tmp/q2audit/lab/` 造软链靶子，只 import 仓库代码）：

| 攻击路径 | `assertRealContainment` | `assertNotAgentAreaReal` | 结果 |
|---|---|---|---|
| `ws/escape` → `/tmp/q2audit/lab/out`（界外目录） | `THROW 路径经软链解析后越出 workspace 边界` | — | ✅ 拦住 |
| `ws/dangling` → `/nonexistent/target`（**悬空软链**） | `THROW 路径经软链解析后越出 workspace 边界` | — | ✅ 拦住 |
| `ws/sneaky` → `.agent`（名字里没有 `.agent`） | PASS（词法看不见） | `THROW .agent/ 是系统区…落点在 .agent/ 内` | ✅ 拦住 |
| `ws/subdir/rel` → `../../.agent`（相对软链） | `THROW` | `THROW` | ✅ 拦住 |
| `ws/normal/ok.txt`（正常路径） | PASS | PASS | ✅ 不误伤 |

**5/5 判定正确**（4 拦 1 放）。这是**真机制**。

**调用点核查**（谁会漏调其中一道）：

| 调用方 | `assertRealContainment` | `assertNotAgentAreaReal` |
|---|---|---|
| `src/tools/write_file.ts:22-24` | ✅ | ✅ |
| `src/tools/edit_file.ts:54-56` | ✅ | ✅ |
| `src/tools/read_file.ts:77` | ✅ | —（只读，不需要） |
| `src/tools/lsp.ts:625` | ✅ | — |
| `src/tools/glob.ts:22` / `grep.ts:90` | ✅ | — |
| `src/tools/impact-query.ts:160-161` | ✅ | —（只有词法 `assertNotAgentArea`） |

> ⚠️ 两道闸是**两个必须分别调用的函数**，不是一次调用同时给两个保证。目前**所有写工具都调了两道**（我逐个核对了），
> 但这是**靠人记得**的约定，没有类型系统或覆盖测试强制。新加一个写工具时漏掉
> `assertNotAgentAreaReal` ⇒ 软链绕 `.agent` 的洞重新打开。`tests/write-face.test.ts:88-105` 的棘轮能抓「新工具没登记」，
> **抓不到「登记了但漏调第二道闸」**。

### 4.2 MCP 的 fail-closed —— **真机制** ✅

`src/permissions/autonomy.ts:275-281`：

```ts
export function isWriteCall(tool: string, mcp?: McpGrade): boolean {
  if (mcp === undefined) return isSideEffectTool(tool);
  return !(mcp.annotated && mcp.readOnly === true);
}
```

`:332-334`：名字带 `mcp__` 但调用方没递注解 ⇒ **按「无注解」处理**，注释写明：
> 「把『少传一个参数』读成『这不是 MCP』，等于把本次要修的洞换成另一种形状再埋一遍。」

**实测**（`/tmp/q2audit/lab/perm3.mts`，`auto` 档）：

| MCP 注解 | 裁决 | 层次 |
|---|---|---|
| 不传注解 | `ask` | `L4-mcp-unannotated` ✅ |
| `{annotated:false}` | `ask` | ✅ |
| `{annotated:true}`（只给了 title） | `ask` | ✅ |
| `{annotated:true, readOnly:true}` | `approve` | ✅ 唯一放行的形状 |
| `{annotated:true, readOnly:false}` | `approve` | ⚠️ 见下 |

> ⚠️ **一处不对称**：`{readOnly:false}`（服务器**主动声明「我不是只读工具」**）在 `auto` 档得到 `approve`，
> 而**什么都不声明**得到 `ask`。逻辑上，一句明确的「我会写」不该比沉默更宽松。
> 影响有限（`auto` 档本来就是全放行档，且 `destructive:true` 会经 `annotationRisk`
> 单独抬成 `high` 送审，见 `:266-268`），但这个方向是反的，值得改。

### 4.3 ❌ **`gate()` / `checkPermission()` 对未知工具名默认放行 —— 这是一处真的 fail-open**

`src/permissions/index.ts:105-123`：

```ts
export function checkPermission(mode: PermissionMode, tool: ToolName): Decision {
  if (!isSideEffectTool(tool)) return "allow";     // ← 不在 5 名单里 = 一律放行
  if (planBlocks()) return "deny";
  return SIDE_EFFECT_DECISION[mode] ?? "ask";
}
export function gate(mode, tool, interactive): Decision {
  const decision = checkPermission(mode, tool);
  if (decision === "ask" && !interactive) return "deny";   // ← ask 降 deny 只对"已列入"的工具发生
  return decision;
}
```

`isSideEffectTool` 查的是一张**手写的 5 名字集合**（`src/permissions/autonomy.ts:212-221`）：
`write_file` / `edit_file` / `run_shell` / `shell_rw` / `spawn_agent`。

**实测**（`/tmp/q2audit/lab/perm4.mts`）：

```
gate("read-only", "ghost_tool",   interactive=false) = allow   ❌ 未知工具在只读档放行
gate("read-only", "web_fetch",    interactive=false) = allow
gate("read-only", "remember",     interactive=false) = allow
gate("read-only", "automation_create", false)        = allow
gate("read-only", "snapshot", "process", "cancel_agents", "skill", "lsp", "verify") = allow
gate("read-only", "write_file",   interactive=false) = deny    ✅ 已列入的才拦
```

**同时**，`src/agent/glm-session.ts:388-394` 把只读档的**工具面**也按同一张 5 名单摘除 ——
所以「模型看不见」这道主防线，同样建立在「记得把新工具加进 5 名单」上。

**当前的实际风险（不要让业主恐慌，但要说清）**：
- ✅ 目前**没有可利用的洞**。生产面上 18 个工具名我逐个跑过：5 个被拦，其余 13 个里
  `remember` / `wait_for_agents` / `cancel_agents` / 定时五件 / 编排原语都在 `glm-session.ts` 里**逐个显式点名摘除**了；
  `web_fetch` 是**有意保留**的（`src/agent/tool-surface.ts:41-44` 写了理由：「不落盘、不改仓库 ⇒ 只读会话查文档是正当的」）。
- ❌ 但**默认方向是开的**。一个 `src/permissions/index.ts:108-110` 里精心处理的「未知档位取 ask」
  （fail-closed）与 `:106` 的「未知工具取 allow」（fail-open）在**同一个函数里并存**，方向相反。
- ⚠️ 缓解存在但不完整：`tests/tool-surface-parity.test.ts:76` 会对比
  `isSideEffectTool(name) !== surface.mainSessionSideEffect`，`:94-98` 会抓「源文本里出现但没登记的注入名」。
  这两条能抓住**已声明的注入工具**漂移，**抓不住一个全新的工具族**（新族若也走源文本注入则能抓）。
- **改造建议**：把这行改成 `if (!isSideEffectTool(tool)) return READ_ONLY_TOOLS.has(tool) ? "allow" : "ask";`
  —— 从「黑名单外的都放行」翻成「**白名单外的都问**」。这是本次审计里**性价比最高的一处安全改动**。

### 4.4 密码脱敏覆盖了哪些落盘面

**机制**：`src/agent/security/scan.ts:433-461` `redactSecrets()` —— 7 条正则密钥规则（`:54-79`）+ Shannon 熵扫描，
掩码保留前后缀（`AKIA****`）以便**留痕**。`:445-452` 明确修过「一行两个同模式密钥只掩第一个」的旧 bug。

**已覆盖的落盘面**（逐个核对了调用点）：

| 落盘面 | 位置 | 状态 |
|---|---|---|
| 主会话事件日志 `tool_call.args` | `src/agent/loop.ts:117, 319` | ✅ |
| 主会话事件日志 `tool_result.output` | `src/agent/loop.ts:488` | ✅ |
| 主会话 `verify_result`（命令 + 输出） | `src/agent/loop.ts:142-143, 271` | ✅ |
| worker 子流投影 | `src/agent/worker-projection.ts:124, 146` | ✅ |
| worker 报告 | `src/agent/worker-report.ts:54` | ✅ |
| 记忆写入 (`remember`) | `src/tools/remember.ts:56` | ✅（且遇 critical 直接抛错拒绝） |
| 安全报告 findings 的 title/description/suggestion | `src/agent/security/scan.ts:473-474`、`orchestrator.ts:2232-2234` | ✅ |
| 子 agent diff / patch / stat | `src/agent/orchestrator.ts:2069-2070` | ✅ |
| Solpi 经济性报告 | `src/agent/solpi-runtime.ts:87` | ✅ |
| 所有子进程 env | `src/tools/process.ts:21-32` 白名单 7 个变量 + 名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL 再剥一次 | ✅ |

`src/agent/loop.ts:109-113` 的注释精确写出了**为什么 `sanitizedEnv` 不够**：
> 「`run_shell` 的 `cat ~/.aws/credentials` 于是把凭据永久留在盘上 —— `sanitizedEnv` 只挡 `process.env` 泄漏，
> 挡不住工具**读出来的文件内容**。」

**未覆盖 / 有缺口的面**：

1. ❌ **`collectChangeSet()` 只认 `write_file` 与 `edit_file`，漏掉 shell 与 MCP 写入。**
   `src/agent/security/scan.ts:26-45`：

   ```ts
   if (e.name === "write_file" && ...) { ... }
   else if (e.name === "edit_file" && ...) { ... }
   ```

   **实测**（`/tmp/q2audit/lab/sec.mts`）：给 5 条工具调用（`write_file`/`edit_file`/`run_shell`/`shell_rw`/`mcp__srv__put`），
   `collectChangeSet()` 只返回 **`['a.ts','b.ts']`** —— 后三条**完全不在安全扫描的变更集里**。
   后果：**用 shell 把密钥写进文件，事后安全报告不会有任何 finding**（写入的命令本身会被 `redactValue` 脱敏，
   但**落盘的文件内容从来没被扫描过**）。这是「审计覆盖面」缺口，不是明文外泄 —— 但它正好是
   `src/agent/write-face.ts:1-15` 自己诊断过的**同一个漂移模式**，而那一次只修了证据闸（②③④），**漏修了安全扫描器**。
   现成的修法就在旁边：`mayHaveWrittenDisk()`。

2. ⚠️ **`src/agent/prune.ts:262`** 把 `e.output` 原文写进附件目录，注释说「附件正文与事件日志里是同一段原文」
   —— 这句话在脱敏修复后**已过时**（`loop.ts:488` 现在会先脱敏）。行为上大概率仍安全（事件流已是脱敏版），
   但**注释与事实不符**，且**历史遗留的旧附件**不受新逻辑保护。

3. ⚠️ **`.agent/memory/` 之外的运行产物**（`src/main/agent-runner.ts` 的会话 JSONL、`outputs/` 里的探针日志）
   是否全部经手 `loop` 那条脱敏路径，**取决于每条写入路径是否复用同一个 `EventLog`**。
   我抽查的 `scheduler.ts:694,841`、`agent-runner.ts:1911` 都是直接 `createEventLog(...).append(...)`，
   **没有独立的第二道脱敏**。这是一条「纵深不足」：一旦某条路径绕开了 loop 的包装，脱敏就整条失效。

### 4.5 另一项治理机制：**冻结判卷表**（值得单列）✅

- `scripts/frozen-sha256.json` 冻结 **50 个判卷文件**的 sha256。
- `src/frozen.ts:17-35` `frozenJudgePathSet()` 把冻结表变成集合；**表存在但为空 ⇒ 显式抛错**（`:28-30`），
  注释写明「清空一张表比改一行代码安静得多」。
- `src/permissions/autonomy.ts:363-366` 把这张集合接到**权限层 L0 硬闸**上：
  冻结文件**任何档位、任何 allow 规则都写不了**。
- 生产接线已核实在位：`src/agent/orchestrator.ts:693,698`、`src/main/agent-runner.ts:1390`。
- `src/frozen.ts:43-105` 还有**冻结覆盖漂移**双向比对（`onDiskNotInTable` / `inTableNotOnDisk` / `tableDirsNotSwept`），
  `:49-55` 把三个方向的语义差别写清了（含一次真实踩坑复盘）。

> ✅ **这是一条真正的「agent 不能改判自己的考卷」机制**，在同类项目里极少见。

---

## 5. 工程风险排序

### 5.1 ❌ **`pnpm gates` 现在是红的**（我实测）

`node --import tsx scripts/evidence-typecheck-check.ts` → **exit 1**：

```
❌ evidence-typecheck：证据面危险码 16 条／帽 12 条（登记 8 个文件；全量报错 51 条）
   ｜⚠️ 涨了 2 个文件（只准调低）：
     outputs/selector-uniqueness-2026-09-30/diagnose.mts 3>0、
     outputs/sequencer-dynamic-2026-10-01/probe-prod.mts 1>0
```

这两条是 `git status` 里那两个 `??`（**其它会话在飞的未跟踪探针**）。`scripts/gate-manifest.ts:139-141`
自己也记着这件事（「现读 51 条报错／危险码 16 条／帽 12 条——多出的 4 条是隔壁在飞」）。

> ❌ **结构性缺陷**：`tsconfig.evidence.json` 把整个 `outputs/`（261 条目、13 MB 的临时探针目录）纳入类型检查，
> **且不区分已跟踪/未跟踪**。于是**任何人往 `outputs/` 丢一个探针脚本，就可能把整条门禁打红**。
> 对一个「多会话并行、每轮都往 outputs/ 写取料」的仓库，这是**必然反复发生的假红**，
> 而假红会训练人忽略红灯 —— 这是门禁体系最大的慢性病。

### 5.2 ❌ **没有 CI、没有 git hook —— 26 道门全部靠人记得跑**

| 检查 | 结果 |
|---|---|
| `.github/` 目录 | **不存在** |
| `.git/hooks/post-checkout` | 内容仅 `#!/bin/sh`（10 字节，空壳） |
| `.git/hooks/post-commit` | 内容仅 `#!/bin/sh`（10 字节，空壳） |
| `package.json` 的 `husky` / `lint-staged` / `simple-git-hooks` | **全部 false** |
| `git config core.hooksPath` | **未设置** |

而 `scripts/gate-manifest.ts:13` 的 `GATES` 有 **26+ 道门**，其中：

- `head-cert-check` 自报 **123.7 秒**（`gate-manifest.ts` 注释实测）
- `mutate-verify` 自报 **1,085–1,472 秒（18–25 分钟）**（同上）
- `test`（全量 258 文件，`fileParallelism: false` 串行）

> ❌ **整套门禁是「手动一键」的。** 没有任何机制阻止一次红着门的提交落地。
> `gate-manifest.ts` 的注释里自己提到过后果：「**第 123 页数过：86 笔提交跑在红灯上**」——
> 这已经不是假设，是**已发生的既成事实**。这是本审计给业主的**头号风险**：
> 代码质量极高，但**质量没有任何自动保险丝**。

### 5.3 ⚠️ `PROGRESS.md`（1.1 MB）**确实是门禁输入** —— 但代价可接受

**是真输入，不是猜测**：
- `scripts/docs-check.ts:119` `export const LEDGER_FILE = "PROGRESS.md";`
- `scripts/docs-check.ts:113-119` D-5 规则：台账里每一句「凭证 @`abc1234`」都要指得到一笔**真提交**。
- `scripts/docs-check.ts:363` `REPLAY_DOC_FILES = ["AGENTS.md", "PROGRESS.md", "STATE.md"]`
- `tests/docs-check.test.ts:412-413`：**读真 `PROGRESS.md`** 并要求「分母 ≥ 200 且除豁免外零红」。
- `tests/docs-check.test.ts:505` 再读一次。

**实测代价**：`node --import tsx scripts/docs-check.ts` → **1.009 秒**，绿（抽到 270 条候选、可比对 117 个读数、红 0）。

> ⚠️ **判定**：**改了 PROGRESS.md 确实可能让门变红**（引用写错的 commit、格式不合 D-5、分母跌破 200），
> 所以它**是门禁输入，不是纯文档**。但**性能代价只有 1 秒，不构成问题**。
> 真正的隐患是**别的**：
> - 328 次提交动过同一个文件 ⇒ 并行会话**必然在这一个文件上串行化 / 频繁冲突**（本审计期间 `git status` 就变了）。
> - 1.1 MB 单文件、8,473 行、无分页 ⇒ 新人不可能读，agent 每次读都烧 context。
> - 它同时是「文档」和「判卷取料面」两种身份，改文档会在意想不到的地方红。

### 5.4 ⚠️ 依赖面与供应链 —— **声明面极小，装机面很大（不一致）**

**声明面（`package.json`）—— 优秀** ✅：

| 运行时依赖（6 个） | 版本 |
|---|---|
| `@modelcontextprotocol/sdk` | ^1.30.0 |
| `@vscode/ripgrep` | ^1.18.0 |
| `croner` | ^10.0.1 |
| `tree-sitter-wasms` | 0.1.13（**精确钉版**） |
| `vscode-languageserver-protocol` | ^3.18.3 |
| `web-tree-sitter` | 0.25.10（**精确钉版**） |

开发依赖 4 个（`@types/node`、`tsx`、`typescript`、`vitest`）。**共 10 个直接依赖**。
✅ 检查了全部 10 个的 `package.json`：**没有一个带 `preinstall`/`install`/`postinstall` 脚本**（供应链最优形态，无安装期代码执行面）。
✅ `src/` 里全部外部 import 都已声明（无幽灵依赖）：`@modelcontextprotocol/sdk`(4)、`web-tree-sitter`(1)、`croner`(1)、
`vscode-languageserver-protocol/node`(1)，其余全是 `node:*` 内置模块。
✅ `pnpm-lock.yaml`（lockfileVersion 9.0，60 KB，**334 个包条目**）**零 `electron` 引用**。
✅ 无 `.npmrc`（没改 registry，走官方源）。

**装机面（盘上实际）—— 陈旧且不一致** ❌：

| | 数值 |
|---|---:|
| `node_modules/.pnpm` 包数 | **686** |
| `node_modules` 体积 | **687 MB** |
| 其中 electron 相关包 | **20 个**（`@electron/asar`、`@electron/fuses`、`@electron/notarize`、`electron-winstaller`…） |
| lockfile 里的包 | 334 |
| **磁盘上有、lockfile 里没有的包** | **≈ 352 个** |

> ❌ **这台机器上的 `node_modules` 是从「桌面层还没删」的时代留下来的**，从没重装过。
> 后果：(a) 687 MB 磁盘 / 352 个幽灵包；(b) **幽灵依赖风险** —— 一个未声明在 `package.json` 的裸 import
> 在这台机器上会**静默成功**，在别人 `pnpm install` 出来的干净树上才炸。
> 修法：`pnpm install --frozen-lockfile`（本审计**未执行**，因为会写盘）。

**另外一处配置脏** ⚠️：`pnpm-workspace.yaml` 第 2 行是

```yaml
allowBuilds:
  electron-winstaller: set this to true or false
```

`set this to true or false` 是**没填完的占位符**（不是合法布尔值），而且引用的是**已删除的桌面层**的包。
同文件 `onlyBuiltDependencies: [esbuild]` 是对的，说明这一块是**生成器留下的未清理填充**。

### 5.5 ⚠️ 其它环境卫生问题（每条都有盘上证据）

| 项 | 证据 |
|---|---|
| **2 个游离根目录** | `32768/`（内含空的 `.agent/sessions/`）与 `工作区/`（同）。git 看不见（空目录），`git status` 不报 ⇒ **静默堆积** |
| **20 个 worktree / 364 MB** | `git worktree list` 共 24 条；`.worktrees/{verify-*,head-cert-*,p187-*,port,port2,opt,doc-layer,p169-staging,p170-tighten}`，最早的 `doc-layer` 停在 9-20。`head-cert-check` 每跑一次建一棵 ⇒ 需要定期 GC（PROGRESS.md 第 258 页显示作者已在手动回收） |
| **仓库总体积 1.7 GB** | `node_modules` 687 M + `.worktrees` 364 M + `.git` 76 M + `fixtures` 36 M + `outputs` 13 M |
| **`.agent/` 在仓库根** | `permissions.json` 18 字节 mode 600（有意跟踪，`.gitignore` 里有专门说明） |
| **`oh-src/`、`.mimosa/`、`.pi/`、`.qoder/`、`.workbuddy/`** | 4 个不同 AI 工具的运行时目录并存 |

### 5.6 ⚠️ 环境敏感的测试（已有人踩坑并记录）

`BLOCKED.md:8-12` 记录了一条**当前仍红**的测试：

> `tests/map-self-report.test.ts:95` 判据依赖 checkout 路径深度
> **现象**：`地图降级要出声，并且不许被读成「仓库没有结构」` 这一条红，
> `expected '[map] 仓库地图本次不可用（原因：spawn …）' to contain 'rg'`。
> 本轮在嵌套 worktree（前缀 104 字符）下必红。

我读了源码（`tests/map-self-report.test.ts:87-97`）：它给 `buildMap()` 传一个不存在的 workspace，
然后断言降级文案里有 `"rg"`。这个断言**依赖 ripgrep 在那个路径深度下恰好以某一种方式失败**。
> ⚠️ **判定**：这是「测试依赖环境细节」的真实案例（不是造假，是脆）。
> 它自己在 `BLOCKED.md` 里诚实登记了「未改代码，待换判据」—— 加分；但**红灯还挂着**。

### 5.7 ⚠️ 3 道门在当前环境**永远跑不了**（诚实登记为 UNVERIFIED）

```
$ node --import tsx scripts/autonomy-check.ts
[autonomy-check] 暗卷跳过（无 M0_API_KEY）
UNVERIFIED=1
$ node --import tsx scripts/gate-check.ts
[gate-check] 暗卷跳过（无 M0_API_KEY）
UNVERIFIED=1
$ node --import tsx scripts/docs-check.ts
docs-check: 受检项全绿（另有 3 项未检，见上）
UNVERIFIED=3
```

> ✅ **设计上这是优点**：跳过 ≠ 通过，未检项有独立计数器（`UNVERIFIED=n`），
> 门会主动说「STATE.md 不存在 ⇒ 该页未受检，**不等于通过**」。这在同类项目里非常罕见。
> ⚠️ **但事实是**：本机上**真实模型路径（需要 API key 的那部分）从未被验证过**。
> 业主如果听到「全门绿」，需要知道**这里面有 3 项是跳过的**。

---

## 6. 优缺点排行榜

### 🏆 优点 Top 10（按价值排序，全部带证据）

| # | 优点 | 证据 |
|---|---|---|
| **1** | **路径包含是真机制，而且比教科书实现更严 —— 手写逐段软链解析，连「悬空软链」这个 `realpath` 的盲区都堵了** | `src/tools/base.ts:117-160`（`resolveDeepest`），`:133-136` 写明为何不用 `realpath`；`:186-193` 软链绕 `.agent` 的第二道闸。**我实测 4 种攻击 4 种全拦住**（含悬空软链、相对软链、无名 `.agent` 软链） |
| **2** | **类型卫生满分：3.6 万行 TS，零 `any`、零 `@ts-ignore`、零 TODO、零空 `catch`** | 全仓 `grep 'any'` 只命中 2 次，都是 `AbortSignal.any()` 真 API；`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable` 全 0；`TODO/FIXME/HACK` 全 0；空 `catch {}` 0 个。`strict: true` + `include` 覆盖 tests |
| **3** | **测试零造假：258 文件 / 3,256 用例，零 skip、零 only、零快照、零排除，且极低 mock** | `tests/vitest.config.ts:25` `include` 无 `exclude`；skip/only/todo/xit/snapshot 全 0；`vi.mock` 仅 9 处、`toHaveBeenCalled` 仅 10 处；测试以真 `mkdtemp` + 真 `runLoop` + 真读回盘为主 |
| **4** | **「双向对照」是默认写法 —— 几乎每条判据都配了反向用例，防的正是「测试恒绿」** | `tests/write-face.test.ts:165/173`（补拍 vs 不补拍）、`:88-105`（新增工具没登记就红的覆盖棘轮）；`tests/event-log-redaction.test.ts:93-103`（落盘脱敏 vs 执行面不脱敏）；`tests/assertion-health-scan.test.ts:43`「尺子本身不是恒绿的」；`tests/shell-bypass-composition.test.ts:57`「清单不收窄＝把自己判绿」 |
| **5** | **脱敏覆盖面到「落盘面」级别，且有事故复盘驱动的逐面补齐** | `src/agent/loop.ts:109-118` 注释写明 `sanitizedEnv` 挡不住 `cat ~/.aws/credentials`；脱敏已覆盖 10 个落盘面（事件日志/verify/worker 子流/记忆/报告/patch/经济性）；`src/agent/security/scan.ts:445-452` 修过「一行两个密钥只掩第一个」 |
| **6** | **「agent 改不了自己的考卷」有硬机制：50 个判卷文件 sha256 冻结，接在权限层 L0** | `scripts/frozen-sha256.json`（50 条）；`src/frozen.ts:17-35`（表被清空 ⇒ 显式抛错）；`src/permissions/autonomy.ts:363-366`（任何档位、任何 allow 规则都写不了）；生产接线核实于 `orchestrator.ts:693,698`、`agent-runner.ts:1390` |
| **7** | **子进程供应链与 env 消毒做到底** | `src/tools/process.ts:17-32` env 白名单只放行 7 个变量 + 名字含 `KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL` 再剥一遍；`killGroup` 用负 pid 收整棵进程树（`:35-50`）；**6 个运行时依赖、全部无 install 脚本** |
| **8** | **门禁自省机制罕见地成熟：跳过关 ≠ 通过，「恒真式体检」会扫自己的门** | `UNVERIFIED=n` 独立计数器（autonomy-check / gate-check / docs-check 实测可见）；`scripts/gates.ts:5-7` 的恒真式体检（空断言 / `\|\| true` / 暗卷段零 check 都报警）；`scripts/typecheck.ts:28-30`「绿而零输出」按未证计 |
| **9** | **97.5% 的源码模块有测试触碰，且断言是精确值不是"非空"** | 158 个 src 模块中 **154 个**被 ≥1 个测试 import；9,387 条断言里 `toBe` 4,318 / `toEqual` 1,161 / `toContain` 1,993，而 `toBeTruthy` 只有 22；零断言文件 0 个 |
| **10** | **主动发现并消灭「同族清单漂移」，而不是等它咬人** | `src/agent/write-face.ts:1-18` 把「会不会改盘」的**四份各自漂移的清单**（权限门 / loop 收束闸 / worker 报告 / no-progress）收成一份 `mayHaveWrittenDisk`；`tests/tool-surface-parity.test.ts` 把注入工具的「规格面/实例面/worker 面」三面对账；`src/permissions/modes.ts:1` 权限档位唯一事实源 |

### ⚠️❌ 问题 Top 10（按严重度排序）

| # | 问题 | 严重度 | 证据 |
|---|---|---|---|
| **1** | **没有 CI、没有 git hook —— 26 道门全靠人手动跑，没有任何东西阻止红着门提交** | ❌ 最严重 | `.github/` 不存在；`.git/hooks/post-{checkout,commit}` 都是 10 字节空壳 `#!/bin/sh`；`husky`/`lint-staged`/`simple-git-hooks` 全 false；`core.hooksPath` 未设。而 `gate-manifest.ts` 注释自承「**第 123 页数过：86 笔提交跑在红灯上**」 |
| **2** | **`gate()` / `checkPermission()` 对未知工具名默认 `allow`（fail-open），与同函数内「未知档位取 ask」的方向相反** | ❌ | `src/permissions/index.ts:106` `if (!isSideEffectTool(tool)) return "allow";`；`src/permissions/autonomy.ts:212-221` 是手写 5 名字集合。**实测** `gate("read-only","ghost_tool",false)==="allow"`、`evaluate(...)` 对未知工具返回 `approve/L4-pass`。当前无可利用洞（其余工具在 `glm-session.ts:388-394` 逐个点名摘除），但**默认方向是开的** |
| **3** | **安全报告的变更集只认 `write_file`/`edit_file`，shell 与 MCP 写入完全不在扫描面内** | ❌ | `src/agent/security/scan.ts:26-45`。**实测**：5 条调用（write_file/edit_file/run_shell/shell_rw/mcp__srv__put）→ `collectChangeSet()` 只返回 2 个路径。用 shell 写密钥进文件 ⇒ **零 finding**。而 `write-face.ts` 已提供现成修法 `mayHaveWrittenDisk()`，只是没接到这里 |
| **4** | **`pnpm gates` 此刻就是红的：`evidence-typecheck-check` 16 条 > 帽 12 条** | ❌ | 实跑 exit 1。根因是 `outputs/` 两个**未跟踪**探针（`selector-uniqueness-2026-09-30/diagnose.mts`、`sequencer-dynamic-2026-10-01/probe-prod.mts`）。`tsconfig.evidence.json` 把 261 条目的临时目录整体纳入且不分已跟踪/未跟踪 ⇒ **任何人丢个探针就能打红门禁**，必然反复假红 |
| **5** | **约 6%（2,164 行 / 12 文件）的源码不在产品运行路径上，其中包括三项对外能力** | ⚠️❌ | 以唯一入口 `src/cli.ts`（`bin.m0`）做可达性分析：`agent/no-progress.ts`（249 行，无进展检测）、`cost-per-progress.ts`（152 行）、`reproducibility.ts`（153 行）、`agent/gym/*`、`eval/task-set.ts`、`providers/byok.ts` 全部不可达；对应的 `no-progress-check`/`cost-per-progress-check` 门**照样跑绿**。旁证：`no-progress.ts:22` 的写向表列了 3 个本仓不存在的工具名 |
| **6** | **`src/main/agent-runner.ts` 是教科书级上帝文件：2,534 行 / 71 个顶层函数 / 62 导出 / 依赖 58 模块 / 扇入 1** | ⚠️ | 自写脚本统计（`/tmp/q2audit/god.mjs`）；`orchestrator.ts` 2,565 行紧随其后；`events/index.ts` 967 行里 44 个 interface + 69 导出、扇入 44 |
| **7** | **分层名义存在、实际是一个 20 文件的跨 5 目录依赖环** | ⚠️ | Tarjan SCC：`events/index.ts ↔ tools/base.ts ↔ permissions/{index,autonomy,risk,rules}.ts ↔ tools/* ↔ agent/verify.ts ↔ providers/stop-reason.ts ↔ agent/recovery.ts`。跨层边含 `tools→agent` 10 次、`events→agent`。是纯类型/常量环，当前不出 bug，但毁掉了任何「单独复用某一层」的可能 |
| **8** | **装机面与声明面严重不一致：盘上 686 包 / 687 MB / 20 个 electron 包，lockfile 只有 334 包且零 electron** | ⚠️ | `ls node_modules/.pnpm \| wc -l` = 686；`grep -c electron pnpm-lock.yaml` = **0**。≈352 个幽灵包 ⇒ 未声明的裸 import 在本机静默成功、干净树才炸。另：`pnpm-workspace.yaml:2` 留着未填的占位符 `electron-winstaller: set this to true or false` |
| **9** | **5.4% 的测试（14 个文件）拿生产源文本当契约 —— 重构会红、语义坏却可能不红** | ⚠️ | 如 `tests/budget-price-key.test.ts:75` `expect([...t.matchAll(/resolveMainModel\(/g)].length).toBe(1)`（数文本次数）。其中 `tool-surface-parity.test.ts` 三个源文本解析器里**只有 1 个有「0 命中自证」**（`:100`），另两个格式一变就静默退化成空数组 ⇒ **假绿** |
| **10** | **环境卫生：2 个游离根目录、20 个 worktree 364 MB、1.7 GB 仓库、一条环境敏感的常红测试** | ⚠️ | `32768/` 与 `工作区/` 各含空的 `.agent/sessions/`（git 看不见、静默堆积）；`git worktree list` 24 条；`BLOCKED.md:8-12` 记录 `tests/map-self-report.test.ts:95` 在嵌套 worktree（前缀 104 字符）下必红（断言降级文案含 `"rg"`），**当前仍红** |

### 附：本审计实测读数汇总

| 命令 | 结果 | 耗时 |
|---|---|---:|
| `scripts/typecheck.ts` | ✅ exit 0，0 条报错 | 24.6 s |
| `scripts/docs-check.ts` | ✅ 全绿（3 项未检） | 1.0 s |
| `scripts/security-check.ts` | ✅ 43 ✅ / 0 ❌ | — |
| `scripts/autonomy-check.ts` | ✅ 通过（UNVERIFIED=1，暗卷跳过） | — |
| `scripts/gate-check.ts` | ✅ 通过（UNVERIFIED=1，暗卷跳过） | — |
| `scripts/evidence-typecheck-check.ts` | ❌ **exit 1**（16 > 帽 12） | 21.8 s |
| 路径包含攻击探针（5 例） | ✅ 4 拦 1 放，判定全对 | — |
| 权限裁决矩阵（18 工具 × 4 档 + 7 种 MCP 注解） | ⚠️ 未知工具默认 allow | — |
| 安全变更集覆盖探针（5 条调用） | ❌ 只覆盖 2/5 | — |

**还原保证**：所有实验在 `/tmp/q2audit/`（脚本）与 `/tmp/q2audit/lab/`（靶子工作区）内完成；
仓库只被 `read`/`grep`/`import`，从未被写。开工/收工两次 `git status --short` 对比：
多出的 `?? tests/impact-persistence.test.ts` 是并行会话新增，非本审计产物。
