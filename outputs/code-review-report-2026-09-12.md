# DSH 代码库多 Agent 交叉审查综合报告

> 项目：`/Users/ze/Downloads/deepseek harness`（Electron 桌面编程 Agent，M0–M4 已完成）
> 日期：2026-09-12
> 方法：代码库按模块切分为 8 个独立区块，每区块派 1 个只读子 Agent 深审，再由主审汇总、交叉验证、复核 P0 结论
> 覆盖：`src/**` 118 文件 + `scripts/**` 22 文件 + `tests/**` 46 文件 ≈ 42,000 行
> 结论：**共 96 条发现 —— P0×3 / P1×17 / P2×63 / P3×13**

---

## 一、执行摘要

这套代码库的整体工程质量**明显高于同类项目**：事件流作为唯一事实源、压缩只是投影、fail-closed 默认值、门禁"清单即事实源 + 逐道退出码透传"、沙箱降级 fail-visible 等纪律，在代码里都是**真实落地**的，不是文档口号。XSS 面经全仓 grep 确认为零，BYOK 密钥走 safeStorage 且不回显 renderer，license 真做了 Ed25519 验签。

但审查也暴露出一个**结构性问题**：项目在"正向路径"上极为严谨，在**"异常路径 / 边界输入 / 能力识别"**上存在系统性松懈。三条 P0 全部属于这一类——不是某个函数写错了，而是**同一类判据在两个模块里用了两套口径**，导致防线在最需要它的地方恰好失效。

最值得警惕的是：**三条 P0 中有两条，是被两个互不知情的子 Agent 从不同区块独立发现的同一根因**（子进程回收、密钥继承）。这说明它们不是偶发笔误，而是架构层面的盲点。

**立即处理清单（本周内）：**

| 优先级 | 问题 | 位置 | 一句话 |
|---|---|---|---|
| P0-1 | write worker 权限门失效 | `orchestrator.ts:2123` + `permissions/risk.ts:72` | 工具名 `shell_rw` 不被权限层识别，任意 shell 命令零风险直通 |
| P0-2 | deny 规则可被前置命令击穿 | `permissions/rules.ts:167` | `echo x && git push --force` 绕过用户显式 deny |
| P0-3 | frontmatter 原型污染 | `plugins/frontmatter.ts:47` | 未信任插件的 SKILL.md 即可污染 `Object.prototype` |
| P1-1 | 沙箱降级路径密钥泄漏 | `agent-runner.ts:1369` + `run_shell.ts:16` | `M0_API_KEY` 继承进子 shell，可被 `env` 读出并落进事件流 |
| P1-2 | 子进程组不回收 | 6 处 `.kill()` | 全部只杀直接子进程，`pnpm test` 的孙进程成孤儿 |

---

## 二、严重度总览

| 区块 | 模块 | 代码量 | P0 | P1 | P2 | P3 | 小计 |
|---|---|---|---|---|---|---|---|
| A | Agent 循环内核（loop/events/compaction/prune/verify） | ~2.0k | 0 | 2 | 8 | 2 | 12 |
| B | 多 Agent 编排内核（orchestrator/worktree/sequencer） | ~3.7k | 1 | 2 | 8 | 1 | 12 |
| C | 工具 / 权限门 / 模型适配 | ~2.8k | 1 | 3 | 8 | 0 | 12 |
| D | Electron 主进程 / IPC / 沙箱 / 商业化 | ~4.4k | 0 | 3 | 5 | 4 | 12 |
| E | 代码地图 / 记忆 / 插件与 MCP / 安全扫描 | ~3.8k | 1 | 2 | 9 | 0 | 12 |
| F | 渲染层核心（状态 / 事件投影 / 入口） | ~2.4k | 0 | 2 | 9 | 1 | 12 |
| G | 渲染层面板与卡片组件 | ~2.5k | 0 | 1 | 9 | 2 | 12 |
| H | 工程基建（门禁 / 测试 / 构建） | ~14k | 0 | 2 | 7 | 3 | 12 |
| **合计** | | **~42k** | **3** | **17** | **63** | **13** | **96** |

**严重度定义**
- **P0**：安全漏洞 / 数据损坏 / 崩溃，必须立即修
- **P1**：明确的功能性缺陷或安全弱点
- **P2**：健壮性 / 性能 / 可维护性问题
- **P3**：轻微改进

---

## 三、跨区块系统性问题（根因聚类）

这是本报告最有价值的部分：**8 个子 Agent 独立工作，却收敛到 6 条共同根因**。修根因的收益远大于逐条修 bug。

### 根因 1：子进程只杀直接子进程，不回收进程组（5 个区块独立发现）

**证据（全仓 `.kill()` 调用点，无一处 `detached: true`）：**

```
src/tools/run_shell.ts:35        child.kill("SIGKILL")
src/main/sandbox.ts:106          child.kill("SIGKILL")
src/agent/verify.ts:47           child.kill("SIGKILL")
src/agent/plugins/hooks.ts:167   child.kill("SIGKILL")
src/tools/lsp.ts:242,306         child.kill()
```

**后果**：`spawn("bash", ["-c", cmd])` 杀掉的只是 bash 本身。`pnpm test` / `tsc` / 任何派生 node 进程的**孙进程会继续运行**，且它们持有 stdout 管道时 `close` 事件永不触发 → Promise 可能**永不 settle** → 工具调用与 agent loop 挂起。取消一个 worker 后，其 shell 子进程最长还会再跑 60s。

**修复**：统一封装 `spawnDetached()` helper，`detached: true` + `process.kill(-child.pid, "SIGKILL")`，并给超时兜底一个"强制 settle + destroy 流"的分支。

---

### 根因 2：权限层按"字面工具名"识别能力，而非按"能力类别"（3 个区块独立发现）

三处独立缺口，同一个设计错误：

| 位置 | 缺口 |
|---|---|
| `orchestrator.ts:2123` + `permissions/risk.ts:72` | worker 的 shell 工具名是 `shell_rw`，权限层只认 `run_shell` → `staticRisk` 返回 `NONE`、`isSideEffectTool` 返回 false、命令级规则不生效（**P0-1**） |
| `permissions/rules.ts:167` | 链式判定"任一段未命中即整链 miss"，用户 deny 规则被前置无关命令击穿（**P0-2**） |
| `main/index.ts:151` + `permissions/autonomy.ts:196` | IPC 不校验 `agent:run` 的 `req.mode`，未知 mode 会跳过 `mode==="auto"` 的网络送审分支，落入比 auto 更宽松的路径 |

**修复**：权限层引入「能力映射表」（`shell_rw`/`shell_ro` → `run_shell` 能力），并给 `judgeChain` 加"deny 短路优先"语义 + 对所有 IPC 枚举参数做运行时白名单校验。

---

### 根因 3：路径边界只做词法 `resolve/relative`，从不 `realpath`（3 个区块独立发现）

| 位置 | 绕过方式 |
|---|---|
| `tools/base.ts:59-63` | 工作区内软链接（含 `worktree.ts:133` 自己创建的 `node_modules` 软链）→ 读写工作区外文件 |
| `agent/prune.ts:100` | 附件名 `sessionId-callId.txt` 未做字符清洗，`callId` 含 `../` 时越出 `attachmentsDir` |
| `plugins/manifest.ts:135-145` | `commands/agents/skills/hooks` 路径未做越界校验，`../` 逃出插件根 |

项目**已经知道**这个陷阱（AGENTS.md 明确记录"macOS 沙箱规则里的路径必须是 realpath，`/tmp` 实为 `/private/tmp`"），但这条经验只应用到了沙箱层，没有推广到文件工具层。

**修复**：文件工具写路径对父目录 `realpath` 后校验归属；`lstat` 拒绝软链目标；所有拼接进路径的用户输入做白名单 + 哈希。

---

### 根因 4：所有出网调用都没有超时 / AbortSignal（3 个区块独立发现）

```
src/providers/anthropic.ts:127    doFetch(...)   ← 无 signal
src/providers/openai.ts:105       doFetch(...)   ← 无 signal
src/providers/gemini.ts:135       doFetch(...)   ← 无 signal
src/main/updater.ts:51            doFetch(...)   ← 无 signal
src/agent/plugins/mcp.ts:115-138  connect/listTools ← 无超时
```

**后果**：更新源或 MCP server 挂起 → IPC promise 永不 settle → UI 永久转圈；provider 网络停滞 → agent loop 卡死（且因为"轮界才检查 abort"，取消也救不回来）。

**修复**：`AbortSignal.timeout()` 统一注入；流式消费用 `try/finally { reader.cancel() }`；MCP 连接用 `Promise.race` 超时 + catch 中先 `close()` 再记失败态。

---

### 根因 5：无界增长 + 全量重算（O(n²)），跨 6 个区块

长会话/大仓库下性能退化的共同模式：**事件数组无上限增长，每次事件触发全量 O(n) 重算**。

| 位置 | 问题 |
|---|---|
| `renderer/store.ts:50` | `events: [...state.events, e]` 无界；每次 delta 触发 6 个 O(n) 投影重算 → O(n²) |
| `agent/loop.ts:66,77` | `seen` 累积整会话（含所有 delta），每轮 `projectContext(seen)` 全量扫描 |
| `agent/prune.ts:114-137` | `computePrune` O(n²)：每个候选重算边界 + `slice().reverse().find()` |
| `agent/orchestrator.ts:1973-1987` | 每次 spawn 读主会话 JSONL 全文逐行 parse 定位 `parent_event_id` |
| `main/scheduler.ts:748-799` | 每次 `getState` 都 replay 整个会话 JSONL |
| `agent/map/rank.ts:116-139` | 构图两处 O(N²)：每个 ref 遍历全部节点 |
| `tools/ripgrep.ts:33-63` | 先把 rg 全部 stdout 累积成字符串再 `slice(0,100)`，大仓库可 OOM |

**修复**：事件按帧批量 flush；投影改增量折叠；预建索引替代嵌套遍历；流式解析 + 达上限即 kill。

---

### 根因 6：门禁的"恒真式体检"判据面远窄于宣称（区块 H 独有，但影响全局）

`scripts/gates.ts:73-78` 的体检正则只能匹配字面 `, true)` 与 `|| true`，**无法识别析取式/条件式弱断言**。子 Agent 找到了 3 条真实漏网：

```ts
// compaction-check.ts:164 —— plan 不在 keep-first 集合时恒真，且标签语义写反
assert(st.event.compressed_event_ids.includes(4) === false || !kf.has(4), "plan 事件被压缩")

// agents-check.ts:736 —— 无 key 时退化为 rep !== undefined
check(rep !== undefined && (rep.llm_reviewed === true || !process.env.M0_API_KEY), "K5b…")
```

同时 `plugins-check.ts:284-289` 的 `unverified`（未证）项**只打印、不影响退出码**——联网失败时整段降级为"未证"，`pnpm gates` 仍计 22/22 绿。这与项目自己"fail-visible，不真空通过"的承诺相矛盾。

**修复**：体检升级为 AST 级（用 TS compiler API 判定 assert 首参是否可静态求值为真）；`unverified > 0` 必须影响退出码或至少让汇总禁止宣称"全绿"。

---

## 四、P0 问题详情（已由主审逐条复核源码确认为真）

### P0-1｜write worker 权限门失效：任意 shell 命令零风险直通

**位置**：`src/agent/orchestrator.ts:2123`、`2136` + `src/permissions/risk.ts:72` + `src/permissions/autonomy.ts:85-87`

**复核证据（主审实读源码确认）：**

```ts
// orchestrator.ts:2123  —— worker 的 shell 工具名是 shell_rw
table.shell_rw = gatedWorkerTool("shell_rw", shell_rw, w, orch, { autonomy: w.toolAutonomy });
// orchestrator.ts:2136
const d: EvaluateDecision = evaluate(name as never, args, opts.autonomy ?? w.autonomy);

// permissions/risk.ts:72  —— 非 run_shell 直接零风险
if (tool !== "run_shell") return NONE;

// permissions/autonomy.ts:85-87
export function isSideEffectTool(tool: string): boolean {
  return tool === "write_file" || tool === "edit_file" || tool === "run_shell";
}
```

**影响**：`shell_rw` 不匹配任何一处判据，导致**三道防线同时失效**：
1. `staticRisk` 返回 `NONE` → 静态威胁表（`rm -rf /`、`curl | bash`、`sudo`、`chmod 777`）全部落空
2. `isSideEffectTool` 返回 false → 副作用判定 / 沙箱判定 / 方案门判定全部跳过
3. `evaluate` 仅在 `tool === "run_shell"` 时取 `cmd` → 命令级 deny/ask 规则完全不生效

结果是 write worker 的**任意 shell 命令走 auto 档零风险直通**。代码注释却宣称"非 git 命令仍走 evaluate 管线（critical 强制审批）"，与实现相反。

**修复**：权限层改为按能力识别——给 `shell_rw`/`shell_ro` 显式映射到 `run_shell` 能力域，纳入 `staticRisk` 与 `isSideEffectTool`；补一条"write worker 执行 `curl x | bash` 必须触发 critical 审批"的断言。

---

### P0-2｜用户 deny 规则被前置无关命令击穿

**位置**：`src/permissions/rules.ts:167`

**复核证据：**

```ts
for (const seg of segments) {
  const hit = matchSegment(applicable, seg);
  if (!hit) return { verdict: "miss" };        // ← 任一段未命中即整链 miss
  if (hit.rule.behavior === "deny") {
    return { verdict: "deny", ruleId: hit.rule.id ?? "" };
  }
  ...
}
```

**影响**：链式判定遇第一个未命中段立即返回 `miss`，整链落回档位/风险层。`echo x && git push --force` 中 `echo x` 无规则命中 → 整链 miss → auto 档且 `git push` 不在静态威胁表 → **直接 approve，用户显式 deny 失效**。这是最典型的"加一条无害前缀即可绕过"模式，攻击面极低门槛。

**修复**：deny 段应"短路即 deny"——任一段命中 deny 即全链 deny；仅当**所有段都无规则**时才 miss。或对未命中段默认按最严行为处理。

---

### P0-3｜插件 frontmatter 原型污染（未信任插件即可触发）

**位置**：`src/agent/plugins/frontmatter.ts:42-51`

**复核证据：**

```ts
const fm: Record<string, unknown> = {};        // 普通对象字面量
...
const cur = fm[lastTop];                        // lastTop === "__proto__" 时取到 Object.prototype
if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
  (cur as Record<string, unknown>)[nested[1].trim()] = parseScalar(nested[2]);
}
```

**影响**：`fm` 是普通对象，`fm["__proto__"]` 走 `Object.prototype` 的访问器返回 `Object.prototype` 本身，满足 `typeof === "object" && !== null && !Array.isArray` 三个条件 → 嵌套行直接写入 `Object.prototype`。子 Agent 已**实证复现** `Object.prototype.polluted_by_dsh = yes`。

关键在于：**发现期即触发**（`discover.ts:44/82/94/114` 对未信任插件也解析 frontmatter），无需用户信任、无需执行任何 hook。任何克隆到本地的仓库，只要含一个恶意 `SKILL.md`，就能污染整个进程的对象原型。

**修复**：用 `Object.create(null)` 或 `Map` 承载 frontmatter；显式拒绝 `__proto__` / `constructor` / `prototype` 键；写入统一走 `Object.defineProperty`。

---

## 五、P1 问题详情（17 条）

| # | 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| A-1 | `agent/loop.ts:97` | verify 钩子异常未捕获（工具执行有 try/catch，verify 没有） | `.agent/config.json` 损坏或 sandbox exec 抛错 → 整轮任务中止，而非一次"验证失败" | try/catch 包住 `verify.run()`，异常转 `ok:false` 并计入 `verifyAttempts` |
| A-2 | `agent/gates.ts:16-20,47-51` | clarify/plan 的 `wait()` 无超时、无 AbortSignal 监听 | 等人状态下 `runTimeoutMs` 与取消完全失效，pending 解析器永久泄漏 | 加 `timeoutMs` + signal 监听，abort/超时即 resolve 拒绝值并清 pending |
| B-1 | `orchestrator.ts:182-199` | `interceptDestructiveGit` 只按"链段首词精确等于 `git`"判定 | `/usr/bin/git`、`command git`、`bash -c 'git'`、**换行分隔**均可绕过 → 对主 checkout 执行 merge/commit/push | 改行为判定（`git rev-parse --show-toplevel`）；先把换行归一化为分号再切段 |
| B-2 | `orchestrator.ts:850-851,962-978,1084-1108` | `runChain` 逐环之间不检查 `signal.aborted`；`addEventListener` 对已 abort 的 signal 不再触发 | `cancelAll()` 后若链停在两环之间，会 spawn 出一个**永不被取消**的 worker 并跑完 | 每轮开头加 aborted 检查；`spawnInternal` 入口对已 abort 直接 fail-closed 拒绝 |
| C-1 | `tools/edit_file.ts:38` | `content.replace(oldString, newString)` 中 `$&`/`` $` ``/`$'`/`$1` 被当作**替换模式** | 静默写入错误内容（`replace_all` 分支用 split/join 反而是安全的，口径不一致） | 统一用 `split().join()` 或 `replace(old, () => new)` 回调形式 |
| C-2 | `tools/base.ts:52-65` | 路径边界只做词法 `resolve/relative`，从不 realpath | 软链接穿透读写工作区外文件（见根因 3） | realpath 后校验归属；`lstat` 拒绝软链目标 |
| C-3 | `tools/run_shell.ts:33-48` | 超时只 `child.kill("SIGKILL")`，未建进程组 | 孙进程持有 stdout 时 `close` 不触发 → Promise 永不 settle（见根因 1） | `detached: true` + `process.kill(-pid)` |
| D-1 | `agent-runner.ts:1369` + `run_shell.ts:16` + `verify.ts:28` | BYOK key 解密后写入 `process.env.M0_API_KEY`；沙箱降级时 `spawn` 未传 `env`，子 shell 继承该 key | `env` / `printenv` / 恶意 verify 脚本即可把明文 key 写进 `tool_result` → 落 JSONL → 回传模型。env 消毒只在沙箱可用分支生效 | 脱敏 env 抽成公共函数，`run_shell`/`defaultExec` 无条件使用；或 key 不落 `process.env` |
| D-2 | `agent-runner.ts:142,808,845,973-983` | `session`/`activeOrchestrator`/`TOOLS` 为模块级单例，`handleAgentRun` 无互斥 | UI 交互 run 与定时 unattended run 并发时互相覆写权限态 → **破坏"无人值守 fail-closed"** | 加进程级 run 互斥（队列/锁）；权限态改 run 参数显式透传 |
| D-3 | `sandbox.ts:104-107`、`run_shell.ts:33-36`、`verify.ts:45-48` | 同根因 1（沙箱/工具/verify 三处） | 定时任务 `controller.abort()` 也不终止已起的 shell | 见根因 1 |
| E-1 | `security/scan.ts:374-377` | `redactSecrets` 每条规则只取**首个**匹配 | 同行第二个同模式密钥不被掩码 → 明文外泄。该函数被 worker 回传、子流落 JSONL、sidechat promote、安全报告**共用** | 改 `matchAll` 全局逐个替换 |
| E-2 | `memory/inject.ts:31,147` | 记忆块包裹标签 `</memory>` 不在 `CONTROL_TAG` 白名单 | 恶意仓库的 `.agent/memory/*.md` 可提前闭合数据块，后续文本冒充系统指令，**跨会话持久** | 把 `memory` 加入转义名单；或对块内文本做 HTML 实体化 |
| F-1 | `renderer/main.tsx:936-942` | `send()` 全程无 try/catch | IPC invoke 被拒绝时 `running:false` 永不执行，UI 永久停在"运行中"，输入框禁用且无恢复入口 | try/catch/finally 包裹，finally 无条件复位 |
| F-2 | `renderer/main.tsx:1340-1344` | 无任何错误边界（全仓 grep `ErrorBoundary` 零命中） | 任一张卡/投影渲染期抛错 → 整页白屏，无重载出口 | 顶层加 ErrorBoundary + "重新加载"按钮；卡片再包细粒度边界 |
| G-1 | `cards/clarify-form.tsx:18,106-107` | `submitted` 冻结机制**整条链路是死代码**：卡片读 `p.submitted` 但 EventView 从不传该字段；store 的 `clarifySubmitted` 是空实现且无人 dispatch | 提交后表单不禁用、无"已提交"回执，可反复提交 | 由 `callId` 派生已提交投影传入 payload，或把 action 落成 `submittedClarifies: Set<string>` |
| H-1 | `scripts/gates.ts:73-78,117-126` | 恒真式体检正则只匹配 `, true)` 与 `\|\| true`，无法识别析取式/条件式弱断言 | 已有 3 条真实漏网（见根因 6）→ **假绿风险** | 体检升级为 AST 级；每条断言要求"否定后必须变红"的反向自检 |
| H-2 | `scripts/plugins-check.ts:284-289,380-383` | `unverified`（未证）只打印、不影响退出码 | 联网失败时整段降级为"未证"，`pnpm gates` 仍计 22/22 绿 | 未证项计入退出码，或汇总时禁止宣称"全绿" |

---

## 六、分区块完整问题清单

### 区块 A：Agent 循环内核

**覆盖**：`src/agent/{loop,context,gates,compaction,prune,verify,recovery,shape}.ts` + `src/events/index.ts`

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| A-1 | P1 | 错误处理 | `loop.ts:97` | verify 钩子异常未捕获，整轮任务中止 | try/catch 转 `ok:false` tool_result |
| A-2 | P1 | 状态机/泄漏 | `gates.ts:16-20,47-51` | clarify/plan `wait()` 无超时无取消，pending 永久泄漏 | 加 timeoutMs + signal 监听 |
| A-3 | P2 | 契约不一致 | `compaction.ts:249-259,502` | 压缩范围与摘要序列化未过滤 `agent_id` 子流事件，违反"父上下文唯一接收物 = agent_result" | `selectCut`/`serializeConversation` 统一跳过 |
| A-4 | P2 | 契约不一致 | `compaction.ts:491-492` | `priorSummary` 未排除 worker 压缩事件 | 取 `!isWorkerCompaction(e)` 的最后一条 |
| A-5 | P2 | 健壮性 | `events/index.ts:394-398,381-384` | 事件日志读写无容错：半行损坏使整个会话不可打开；append 不校验 payload | replay 逐行 try/catch；append 加轻量 schema 校验 |
| A-6 | P2 | 路径穿越 | `prune.ts:100-102,155` | 附件文件名未清洗，`callId` 含 `../` 可越出 `attachmentsDir`；注释声称有 sha1 前缀但代码无 | sha1 + 字符白名单后再拼名 |
| A-7 | P2 | 性能 | `prune.ts:114-137,82-97` | `computePrune` O(n²)（每个候选重算边界） | 循环外预计算 boundary 与 callId 索引 |
| A-8 | P2 | 性能/无界 | `loop.ts:66,77` + `context.ts:58,84` | `seen` 累积整会话，每轮全量投影 → O(n²) | 增量投影缓存，仅处理新增事件 |
| A-9 | P2 | 安全/泄漏 | `verify.ts:26-48` + `agent-runner.ts:791` | `defaultExec` 继承全量 env（含 API key）；超时只杀直接子进程 | 最小化 env；`detached` + 杀进程组 |
| A-10 | P2 | 终止条件 | `loop.ts:220-222` | 达 `maxSteps` 直接 throw，不落终态事件、不返回部分结果 | 落显式终态事件再返回 |
| A-11 | P3 | 死代码 | `compaction.ts:173` vs `234-240` | "最近 typed 用户消息永不吞"分支恒不可达（被 keepFirstSet 兜住） | 删除死分支或改判据 |
| A-12 | P3 | 契约 | `loop.ts:85` vs `129` | verify 分支先于 `allowedTools` 硬闸，白名单不覆盖 verify | 把 verify 纳入白名单判定或显式声明为系统门 |

### 区块 B：多 Agent 编排内核

**覆盖**：`src/agent/{orchestrator,sequencer,stuck,worktree,sidechat,glm-session}.ts`

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| B-1 | **P0** | 安全/权限绕过 | `orchestrator.ts:2123,2136` + `risk.ts:72` | `shell_rw` 不被权限层识别，三道防线同时失效 | 按能力映射 `shell_rw`→`run_shell` 能力域 |
| B-2 | P1 | 安全/合并闸 | `orchestrator.ts:182-199` | git 拦截可被 `/usr/bin/git`、`command`、`bash -c`、换行绕过 | 行为判定替代字符串判定 |
| B-3 | P1 | 并发/取消泄漏 | `orchestrator.ts:850-851,962-978,1084-1108` | 取消后仍能派发不可取消 worker | 每轮开头检查 aborted |
| B-4 | P2 | 功能 Bug | `worktree.ts:209` | 合并冲突清单解析错误，用户恒看到 `- Merge`（测试只断言 `length > 0` 故漏过） | 改 `git diff --name-only --diff-filter=U`；断言具体文件名 |
| B-5 | P2 | 功能 Bug/漏判 | `orchestrator.ts:1312-1323,1439` | 静默卡死计时器只在收到子流事件后武装，worker 启动即挂起则永不触发 | `runLoop` 前调用一次 `armStuckSilence` |
| B-6 | P2 | 资源回收 | `run_shell.ts:16,35` + `orchestrator.ts:1418` | 取消/超时不真正 kill 子进程与在途模型请求 | signal 透传进 `run_shell` 与 `streamGlm` |
| B-7 | P2 | 可观测性 | `orchestrator.ts:1730-1738` | 清理失败被吞，日志无条件谎报"worktree 已清理" | 按 `r.removed` 生成文案与 ok 字段 |
| B-8 | P2 | 性能 | `orchestrator.ts:1973-1987` | 每次 spawn 读主会话 JSONL 全文逐行 parse → O(spawn × 日志行) | 维护 callId→行号内存索引 |
| B-9 | P2 | 可维护性 | `orchestrator.ts:909-941,1051-1081,1805-1849` | 三处审批等待逐字重复 ~30 行模板 | 抽 `requestApproval()` 单一实现 |
| B-10 | P2 | 并发竞态 | `orchestrator.ts:741,796-846` | 并发上限是 check-then-act，`await createWorktree` 窗口内可突破上限 4 | 判定处先占位登记 |
| B-11 | P2 | 竞态（窄窗口） | `orchestrator.ts:1254-1263,1480,1556` | `finished` 早于 `lastResult` 置位，可能把成功 stage 误判为 failed | 终态标志与结果原子一致 |
| B-12 | P3 | 安全/边界 | `worktree.ts:115-139` + `tools/base.ts:59-64` | `node_modules` 软链回主 checkout + 不做 realpath → 可穿透写入 | 写路径加 realpath 归属校验 |

### 区块 C：工具 / 权限门 / 模型适配

**覆盖**：`src/tools/**`（13 文件）、`src/permissions/**`（4 文件）、`src/providers/**`（6 文件）

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| C-1 | **P0** | 安全/权限绕过 | `permissions/rules.ts:163-181` | deny 规则被前置无关命令击穿 | deny 段短路即 deny |
| C-2 | P1 | 数据损坏 | `tools/edit_file.ts:38` | `replace` 的 `$&`/`$1` 被当作替换模式 | 统一 `split/join` 或回调形式 |
| C-3 | P1 | 沙箱逃逸 | `tools/base.ts:52-65` | 路径边界不做 realpath，软链可读写工作区外 | realpath 后校验归属 |
| C-4 | P1 | 健壮性/挂起 | `tools/run_shell.ts:33-48` | 超时不杀进程组，孙进程持有 stdout 则 Promise 永不 settle | `detached` + 杀进程组 |
| C-5 | P2 | 编码 | `tools/run_shell.ts:20-30`（`sandbox.ts:90-100` 同） | `chunk.toString("utf8")` 逐块解码 → 多字节字符跨 chunk 乱码；上限按 UTF-16 length 计 | 用 `StringDecoder`；上限按 `Buffer.byteLength` |
| C-6 | P2 | 性能 | `tools/ripgrep.ts:33-63`、`grep.ts:38-42`、`glob.ts:18-45` | 全量累积后再 `slice(0,100)`，大仓库可 OOM | 流式解析 + 达上限即 kill；加 `-m` |
| C-7 | P2 | 功能缺陷 | `tools/lsp.ts:265` | 每个 arg 都 `resolve(root, a)`，`--stdio` 被改写成 `<root>/--stdio` → 真实语言服务器无法启动 | 以 `-` 开头的 flag 原样透传 |
| C-8 | P2 | 计量准确性 | `providers/openai.ts:101-103` | 未设 `stream_options.include_usage` → usage 事件永不产出，token 恒为 0 | 流式补该字段 |
| C-9 | P2 | 资源泄漏 | `tools/lsp.ts:242,313` | `closeAllLspClients` 应用退出路径无回收；`shutdown()` 只 SIGTERM 无兜底 | app `will-quit` 接线；SIGTERM 后加超时 SIGKILL |
| C-10 | P2 | 健壮性 | `providers/anthropic.ts:127`、`openai.ts:105`、`gemini.ts:135` | 无 fetch 超时/AbortSignal；消费方提前 return 时未 `reader.cancel()`；`JSON.parse` 无 try（`data: [DONE]` 会断流） | 注入 signal；`try/finally { reader.cancel() }` |
| C-11 | P2 | 权限提升 | `tools/write_file.ts:17-23` + `lsp.ts:49-78` | 工具层无 `.agent/` 黑名单，模型可写 `permissions.json`（跨会话提权）与 `lsp.json`（任意 command → RCE 面） | 对 `.agent/` 敏感文件设显式拒写或独立审批 |
| C-12 | P2 | 性能 | `tools/read_file.ts:71` | 先整文件读入内存再截断，GB 级文件 OOM；二进制嗅探只采样前 8KB | 先 `stat` 判大小，超阈值用流式读 |

### 区块 D：Electron 主进程 / IPC / 沙箱 / 商业化

**覆盖**：`src/main/**`（12 文件）+ `src/preload/index.ts`

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| D-1 | P1 | 安全/密钥 | `agent-runner.ts:1369` + `run_shell.ts:16` + `verify.ts:28` | 沙箱降级路径 `M0_API_KEY` 继承进子 shell，可被 `env` 读出落进事件流 | 脱敏 env 抽公共函数并无条件使用 |
| D-2 | P1 | 并发/权限态 | `agent-runner.ts:142,808,845,973-983` | 模块级单例无互斥，交互 run 覆写 unattended run 权限态 | 进程级 run 互斥；权限态参数透传 |
| D-3 | P1 | 资源泄漏 | `sandbox.ts:104-107`、`run_shell.ts:33-36`、`verify.ts:45-48` | 超时只杀直接子进程；`controller.abort()` 不终止已起 shell | `detached` + 杀进程组 |
| D-4 | P2 | 性能 | `scheduler.ts:748-799` + `agent-runner.ts:1236-1241` | 每次 `getState` 都 replay 整个会话 JSONL；journal 无轮转无上限 | 缓存终态到索引文件；journal 轮转 |
| D-5 | P2 | IPC 校验 | `main/index.ts:151-153` + `autonomy.ts:196-212` | 不校验 `agent:run` 的 `req.mode`，未知 mode 落入更宽松路径 | 枚举参数运行时白名单校验 |
| D-6 | P2 | 安全/license | `license.ts:71,87` | 到期判断用 `Date.now()`，时钟回拨可让 `expired` 变 `valid` | 记录上次校验水位并在回拨时告警 |
| D-7 | P2 | 健壮性 | `updater.ts:41-55` | `fetch` 无超时，更新源挂起则 IPC promise 永不 settle；manifest URL 未强制 https | `AbortSignal.timeout()`；强制 https |
| D-8 | P2 | 性能 | `sessions.ts:71` + `agent-runner.ts:1198-1204,1607-1632` | 每次 `getState` 全量读盘（会话列表/sidechat/memory 快照） | mtime+size 增量缓存 |
| D-9 | P3 | IPC 一致性 | `main/index.ts:201` vs `preload/index.ts` | `agent:license-status` 是死通道（main 注册但 preload 从未暴露） | 删除或补齐 |
| D-10 | P3 | 安全/沙箱 | `sandbox.ts:49-52` | SBPL profile 字符串拼接路径，含 `"` 的工作区路径会破坏语法 | 校验/转义引号 |
| D-11 | P3 | 数据完整性 | `scheduler.ts:80-83` | `rename` 失败时退化为非原子直写，崩溃可损坏任务定义 | 失败即抛，不做非原子兜底 |
| D-12 | P3 | 健壮性 | `scheduler.ts:422-424,474-476,618-623` | tick 错误被静默吞；`cap` 实际限制 queued+running 而非并行度 | tick 异常走 warn；澄清 cap 语义 |

### 区块 E：代码地图 / 记忆 / 插件与 MCP / 安全扫描

**覆盖**：`src/agent/map/**`、`src/agent/memory/**`、`src/agent/plugins/**`、`src/agent/security/**`（19 文件）

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| E-1 | **P0** | 安全 | `plugins/frontmatter.ts:42-51` | frontmatter 原型污染，未信任插件发现期即触发 | `Object.create(null)`；拒绝 `__proto__` 等键 |
| E-2 | P1 | 安全 | `security/scan.ts:374-377` | `redactSecrets` 只掩码首个匹配，同行第二密钥明文外泄 | 改 `matchAll` 全局替换 |
| E-3 | P1 | 安全 | `memory/inject.ts:31,147` | `</memory>` 不在转义白名单，记忆可提前闭合冒充系统指令 | 加入转义名单或整体实体化 |
| E-4 | P2 | 健壮/性能 | `map/parse.ts:45-58` | `loadLanguage` 无 try/catch，失败不写缓存 → 单文件抛错即整图降级为空 | 失败时 `langCache.set(lang, null)`；逐文件 try/catch |
| E-5 | P2 | 性能 | `map/rank.ts:116-139` | 构图两处 O(N²)，400 文件可达 10^8 量级比较 | 预建 `name → def节点[]` 索引 |
| E-6 | P2 | 健壮 | `plugins/mcp.ts:115-138` | `connect`/`listTools` 无超时；失败时 client 未 close 且被 `undefined` 覆盖引用 → 泄漏 | `Promise.race` 超时；catch 中先 close |
| E-7 | P2 | 安全 | `security/llm-review.ts:35-42` | 被审 diff/context 原样拼进 user 消息（输入侧零中和）；contexts 无总预算 | 输入侧也过 `escapeControlTags`；设总字符预算 |
| E-8 | P2 | 安全 | `security/scan.ts:138,147,165` | 词法快筛可绕过：大小写敏感、多行拼接、`.concat()` 不命中；注释里的 `eval(` 又误报 | 加 `i` 标志；补 `unsafe_load`；明确文档化为启发式 |
| E-9 | P2 | 健壮 | `map/build.ts:216` | 单文件 `readFile` 失败无局部 catch → 整张地图降级为空；400 文件全串行 | 逐文件 try/catch；`Promise.all` 限并发 |
| E-10 | P2 | 安全 | `plugins/trust.ts:54-82` | 信任按绝对路径存储，不绑定内容哈希 → 路径下插件被替换仍自动 trusted | 信任记录附加内容指纹 |
| E-11 | P2 | 健壮 | `plugins/hooks.ts:165-168` | 超时只杀直接子进程，孙进程持有 stdout 时 Promise 可能永不 resolve | `detached` + 杀进程组 |
| E-12 | P2 | 安全 | `plugins/manifest.ts:135-145` | `commands/agents/skills/hooks` 路径未做越界校验，`../` 逃出插件根 | `resolve` 后校验 `relative` 不以 `..` 开头 |

> 另有 P3 级细节：`render.ts:14-18` `clampBudget` 在 `maxInput<8192` 时预算回弹突破上限；`build.ts:153-167` `mapFingerprint` 遗漏 `contextFiles` 导致陈旧缓存；`secrets.ts:81-84` 存储文件非原子写；`hooks.ts:93-97` 密钥剥离循环是空转死代码；`skills.ts:67-72` `substituteArgs` 先换 `$ARGUMENTS` 再换 `$1` 导致二次展开。

### 区块 F：渲染层核心（状态 / 事件投影 / 入口）

**覆盖**：`src/renderer/{main.tsx,projections.ts,store.ts,conversation.tsx,onboarding.tsx,theme.ts,styles.css,index.html}`

> 注：题述"zustand store 更新粒度"与事实不符——`store.ts` 是 `useReducer` + 纯 reducer，renderer 全仓无 zustand。

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| F-1 | P1 | Bug/健壮性 | `main.tsx:936-942` | `send()` 无 try/catch，IPC 拒绝则 UI 永久停在"运行中" | try/catch/finally 包裹 |
| F-2 | P1 | 健壮性 | `main.tsx:1340-1344` | 无错误边界，任一处渲染抛错即整页白屏 | 顶层 + 卡片级 ErrorBoundary |
| F-3 | P2 | Bug/竞态 | `main.tsx:835-841,886-890` | 会话切换无请求序号守卫，A→B 连点可被 A 的迟到响应覆盖；重放期事件被 `reset` 丢弃 | 引入递增 requestId 校验 |
| F-4 | P2 | 性能 | `main.tsx:753-761` + `store.ts:50` | 每次事件替换整个 state → 6 个 O(n) 投影每个 delta 全量重算 → O(n²) | 按帧批量 flush；投影改增量折叠 |
| F-5 | P2 | 内存/性能 | `store.ts:50,57` | `events` 无界增长，全程无裁剪/上限 | 滑动窗口 + 折叠态快照 |
| F-6 | P2 | 性能 | `main.tsx:1046-1058` | `panelPayload` 内联构造未 memo，面板关闭时也照算 | `useMemo` 缓存；关闭时短路 |
| F-7 | P2 | Bug/健壮性 | `main.tsx:769-773,776-781` | 设置走"乐观 setState + 静默吞错"，失败后 UI 与磁盘不一致且无提示；同 tick 连续 patch 互相覆盖 | 失败回滚并提示；改函数式 setState |
| F-8 | P2 | Bug/健壮性 | `main.tsx:870-892` | 启动 `Promise.all` 无 catch，任一 reject 即半初始化（设置页空、无会话、向导不弹） | 拆独立 try/catch |
| F-9 | P2 | 主题/FOUC | `index.html:1-14` + `main.tsx:913-921` | 无首帧前主题脚本，主题值来自异步 IPC → 深色系统用户冷启动白闪 | `index.html` 内联同步脚本按 `matchMedia` 先落 `.dark` |
| F-10 | P2 | 可维护性 | `main.tsx`（1344 行） | `EventView`/`SettingsDialog`/`App` 三类职责混居单文件 | 按职责拆分；事件渲染改注册表分派 |
| F-11 | P2 | Bug（存疑） | `main.tsx:1243-1249` | 面板用非受控 `defaultSize` 而 settings 异步到达，右栏宽度"重启还原"可能不生效 | 用受控 API 显式应用；需实机验证 |
| F-12 | P3 | 安全（加固） | `index.html:7` | CSP `connect-src 'self' ws:` 允许向任意主机建 WebSocket | 生产构建剔除 `ws:`（`style-src` 属设计取舍，保留） |

> 另有 P3：`layoutDebounce` timer 未在卸载时清理；`clarifySubmitted` 是恒等返回的死 action；`askDone` 先于 `ask` 到达则决议丢失；向导直接关闭不持久化 `onboarded`。

### 区块 G：渲染层面板与卡片组件

**覆盖**：`src/renderer/panels/registry.tsx`（1226 行）、`src/renderer/cards/**`（7 文件）、`src/renderer/components/ui/**`（29 文件，略读）

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| G-1 | P1 | 功能缺陷/死代码 | `cards/clarify-form.tsx:18,106-107` + `main.tsx:147` + `store.ts:79-82` | `submitted` 冻结机制整条链路未接线 | 派生已提交投影或落 `Set<string>` |
| G-2 | P2 | 性能 | `panels/registry.tsx:97-132` + `main.tsx:754` | TokenPanel effect 依赖 `payload.tokens`（每次 delta 变身份）→ 每个流式增量触发一次 `getState()` IPC；其他面板都用 `eventCount` 防抖，唯独此处不一致 | 依赖改 `payload.eventCount` |
| G-3 | P2 | 状态丢失 | `main.tsx:1060,1292-1301` + `panels/registry.tsx:458-461,968-977` | 单面板挂载模型下切走再切回即卸载重挂，输入框与半填表单重置 | 状态上提到宿主按 panelId 缓存 |
| G-4 | P2 | 健壮性 | `panels/registry.tsx:669-678,762-771,485-527,1036-1051` | 多处 IPC 调用无 catch → unhandled rejection 且 UI 无错误提示 | 统一 try/catch 落到各自 note |
| G-5 | P2 | 健壮性 | `panels/registry.tsx:656-663,749-756,983-990,772-774` | 异步面板无 loading/error 态，`catch { setSnap(null) }` 把失败与空混为一谈；reload 无序号防护可乱序覆盖 | 增加 loading/error 状态位 + 请求序号 |
| G-6 | P2 | 表单校验/注入面 | `cards/clarify-form.tsx:26-42` + `events/index.ts:48` | 提交无校验（空值可交、`extra` 无长度上限）；`answers` 以问题原文为 key，同文问题互相覆盖丢答案 | 校验必答项与长度；主进程按索引而非文本作键 |
| G-7 | P2 | 崩溃风险 | `cards/plan.tsx:18-19,39`、`verify-result.tsx:15,28`、`compaction-card.tsx:32,59` | `payload as unknown as X` 强转后直接解引用，损坏/旧版日志会让整个时间线抛 TypeError | 复用 `registry.tsx:27-32` 的 `str()/num()` 防御读取 |
| G-8 | P2 | 可维护性 | `panels/registry.tsx:39,1210-1219` + `main.tsx:81-90` + `main/settings.ts:10,82-90` | 新增面板需同步改 ≥4 处字面量；registry 自定义 `PanelId` 而未从 settings 导入，存在类型漂移 | 以 `PANEL_IDS` 为唯一事实源 |
| G-9 | P2 | 可维护性 | `panels/registry.tsx`（1226 行） | 8 个面板组件与注册表挤在一个文件 | 按面板拆文件，registry 仅留映射表 |
| G-10 | P2 | 性能 | `main.tsx:1046-1058,1292-1301` | `panelPayload` 内联字面量每次重建 + 面板未 memo → 每个 delta 全量重渲染当前面板 | payload 分片 memo；面板 `React.memo` |
| G-11 | P3 | 可访问性 | `cards/registry.tsx:84-95` | DiffCard 行级评论是 `<div onClick>`，无 role/tabIndex/onKeyDown，键盘用户无法选行 | 改 `<button>` 或补 role + 键盘处理 |
| G-12 | P3 | 性能/细节 | `cards/registry.tsx:136-146`、`panels/registry.tsx:373-378`、`cards/plan.tsx:42,61,64` | `commentPath` 每次 render 做 split+正则；PlanCard 用可能重复的 `f.path`/命令字符串作 key | `commentPath` 并入 memo；key 改 `path+i` |

### 区块 H：工程基建（门禁 / 测试 / 构建）

**覆盖**：`scripts/**`（22 文件）、`tests/**`（46 文件）、`package.json`、`electron-builder.yml`、`electron.vite.config.ts`、`tsconfig.json`

| # | 严重度 | 类别 | 位置 | 问题 | 改进建议 |
|---|---|---|---|---|---|
| H-1 | P1 | 假绿/判据强度 | `scripts/gates.ts:73-78,117-126` + `compaction-check.ts:164`、`agents-check.ts:736,684` | 恒真式体检正则只匹配 `, true)` 与 `\|\| true`，无法识别析取式/条件式弱断言，已有 3 条真实漏网 | 体检升级为 AST 级；加"否定后必须变红"反向自检 |
| H-2 | P1 | 假绿 | `scripts/plugins-check.ts:284-289,380-383` | `unverified` 只打印不影响退出码，联网失败时整段降级仍计 22/22 绿 | 未证项计入退出码或汇总标黄 |
| H-3 | P2 | 判据盲区 | `scripts/gates.ts:96-113` | 暗卷段规则只认名字/注释含"暗卷"的**顶层 function**，而实际暗卷段全是顶层 `if/else`，规则形同虚设 | 扩展到顶层 `if/else` 与 else 分支；扫描 `tests/` 与 `src/` |
| H-4 | P2 | 静默跳过 | `scripts/autonomy-check.ts:322-334` | 暗卷核心断言是条件断言，模型未按约定打标时只打印"观察项"，核心约定未被验证 | 变为无条件断言或明确降级为 BLOCKED |
| H-5 | P2 | 可维护性/盲区 | `scripts/gates.ts:18-41` vs `package.json:20` | GATES 清单与 package.json 已漂移：`provider:check` 存在但不在 GATES，`pnpm gates` 永不执行 | 加自检：GATES 必须等于全部 `*-check` 脚本集合 |
| H-6 | P2 | 数据完整性 | `scripts/map-check.ts:59-71` | 门禁运行期改写受版本控制的源码 `src/agent/map/rank.ts`，仅靠 `finally` 还原；崩溃会留下污染 | 改在 tmp 目录构造副本仓库 |
| H-7 | P2 | 可移植性 | `scripts/panels-check.ts:154`、`gates.ts:54`、`sandbox-check.ts` | 门禁强绑定 macOS：Electron 路径硬编码 `.app/Contents/MacOS`；`spawn("pnpm")` 未用 shell；sandbox 依赖 Seatbelt | 按 `process.platform` 分支；非 darwin 显式走分支 B |
| H-8 | P2 | 判据覆盖 | `scripts/frozen-sha256.json`（仅 3 条） | 多个门禁的判据来源剧本未冻结：`fixtures/gate/`、`fixtures/autonomy/`、`fixtures/agents/`、`fixtures/providers/*.sse` 等 | 纳入冻结或显式声明"非判卷文件" |
| H-9 | P2 | Flaky 风险 | `tests/agents.test.ts:248,366,399`、`m3c.test.ts:125-132`、`sessions.test.ts:71` 等 | 依赖真实时钟轮询 + 固定上限（40×25ms≈1s）等待并发状态；耗时断言留白有限，重负载 CI 下可能假红 | 改可注入时钟/事件驱动等待；耗时断言改相对基线 |
| H-10 | P3 | 断言了错误的东西 | `tests/plugins-hooks.test.ts:105-111` | 用例名声称验证"缺省 timeout 30s"，断言只检查 `blocked===false` 与 `additionalContext==="fast"`，完全没验证 30s | 暴露并断言实际生效的 timeout 值 |
| H-11 | P3 | 输出误导 | `scripts/compaction-check.ts:113` | `assert` 成功分支打印 `✅ <msg>`，而此处 msg 是失败语义 → 绿时输出自相矛盾 | 改为成功语义文案 |
| H-12 | P3 | 判据强度/自检缺失 | `providers-check.ts:204-207`、`sandbox-check.ts:80,96`、`gates.ts:88` | ①"三家适配器互不 import"用文件名 `includes` 判定（注释含即假红）；②"写被拒"用 `!ok \|\| /operation not permitted/`，任何失败都算通过；③`scanAssertionHealth` 标"可单测"却无测试 | ①改 AST 检查真实 import；②收紧为必须含拒绝指纹；③补单测 |

**无测试覆盖的源文件清单**：
`src/main/index.ts`、`src/main/ipc-protocol.ts`、`src/preload/index.ts`、`src/renderer/main.tsx`、`src/renderer/conversation.tsx`、`src/renderer/store.ts`、`src/renderer/hooks/use-mobile.ts`、`src/renderer/lib/utils.ts`、`src/renderer/components/ui/*.tsx`（29 个）、`src/renderer/cards/{agent-card,clarify-form,compaction-card,plan,promote,verify-result}.tsx`、`src/frozen.ts`

---

## 七、改进路线图

### 第一批：立即修（本周，安全与正确性）

1. **P0-1** 权限层按能力识别工具：`shell_rw`/`shell_ro` 映射到 `run_shell` 能力域，纳入 `staticRisk` 与 `isSideEffectTool`。补"write worker 执行 `curl x | bash` 必须 critical 审批"断言。
2. **P0-2** `judgeChain` 改 deny 短路语义。
3. **P0-3** frontmatter 改 `Object.create(null)` + 拒绝 `__proto__`/`constructor`/`prototype`。
4. **P1-1** 脱敏 env 抽公共函数，`run_shell`/`defaultExec` 无条件使用；key 不再落 `process.env`。
5. **P1-2** 统一 `spawnDetached()` helper（`detached: true` + `process.kill(-pid)`），替换全部 6 处 `.kill()`。
6. **E-2** `redactSecrets` 改全局匹配（密钥外泄面，一行改动）。
7. **E-3** `memory` 加入 `CONTROL_TAG` 转义名单。

### 第二批：本迭代（健壮性收口）

8. 根因 4：所有出网调用注入 `AbortSignal.timeout()`；流式消费加 `try/finally { reader.cancel() }`。
9. 根因 3：文件工具写路径加 realpath 归属校验；`.agent/` 敏感文件设显式拒写。
10. `orchestrator` 取消链补 aborted 检查；审批等待抽公共实现（同时消除 B-9 的重复）。
11. **H-1 / H-2** 门禁体检升级 + `unverified` 计入退出码——**这是元问题：门禁可信度决定其余修复的可验证性，优先级应高于多数 P2**。
12. `edit_file` 替换模式修复（C-2）+ `worktree` 冲突清单解析（B-4，测试断言同步加严）。

### 第三批：技术债（择期）

13. 根因 5：事件批量 flush + 增量投影 + 索引化查询，覆盖 7 个 O(n²) 点。
14. 渲染层拆分（`main.tsx` 1344 行、`panels/registry.tsx` 1226 行）+ ErrorBoundary + 会话切换序号守卫。
15. `orchestrator.ts` 2232 行按职责拆分（spawn / 审批 / 依赖链 / worktree / 合并塔 / 安全流水）。
16. 门禁跨平台化；`map-check` 停止改写工作树。

---

## 八、审查方法与局限

**方法**：8 个只读子 Agent 并行审查，各自独立完成"读源码 → 定位问题 → 取真实代码片段作证据"；主审汇总后做了三项交叉验证：

1. **根因聚类**：把 96 条发现按根因归并，识别出 6 条跨区块系统性问题。其中"子进程回收"被 5 个区块独立发现、"密钥继承"被 2 个区块独立发现——**多 Agent 独立收敛是比单点证据更强的置信信号**。
2. **P0 源码复核**：主审亲自 `Read` 了全部 3 条 P0 的关键代码段，确认 `risk.ts:72` 的 `if (tool !== "run_shell") return NONE;`、`rules.ts:167` 的 `if (!hit) return { verdict: "miss" };`、`frontmatter.ts:47` 的 `fm[lastTop]` 原型访问均属实。
3. **系统性扫描**：用 grep 验证了根因 1（6 处 `.kill()` 无一 `detached`）与根因 4（5 处 `doFetch` 无一传 signal）。

**局限**：

- 全部结论基于**静态代码证据**，未运行 `pnpm gates` / `pnpm test` / 实机复现（遵守只读纪律）。子 Agent 中仅区块 E 对两条安全结论做了 `node -e` 只读复现（原型污染、脱敏漏第二个密钥），其余为静态推断。
- 若干结论标注为"存疑"：F-9（FOUC）、F-11（`defaultSize` 还原）需实机截图验证；B-11（`finished` 与 `lastResult` 的时序窗口）为静态推演，未构造时序注入测试；E-4（wasm 加载）未在真实 Electron 中验证。
- 项目已声明为**设计取舍**的项未计入缺陷：unsigned V1 包（`identity: null`）、沙箱降级分支 B、`style-src 'unsafe-inline'`（dev 下 Tailwind 注入所需）、`recovery.ts` V1 无热恢复、安全报告 report 模式不阻断。
- 依赖供应链未审计（`cn@^0.2.6`、`@shadcn/react@^0.3.1` 的维护状态与可信度存疑，仅作提示未定性）。
- `fixtures/**` 判卷冻结文件不在审查范围（属靶子，不属代码库）。

---

*报告由 8 个只读子 Agent 并行产出 + 主审交叉验证汇总生成。所有问题条目均附 `文件:行号`，可直接定位。*
