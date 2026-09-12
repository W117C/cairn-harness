# 系统性优化改动记录（可读性 / 去重 / 性能 / 错误处理）

> 日期：2026-09-12
> 范围：**性能瓶颈、重复逻辑、错误处理与边界**四个方向
> 纪律：保持原有功能与接口不变（仅新增可选参数、新增导出，无签名破坏）；判据缺陷不自行改判据

---

## 0. 前置说明：与并行工作的切分

工作开始时工作区已有**另一位执行者的未提交改动**（11 个源文件 + 2 个新文件，内容为审查报告的 P0/P1 安全面：权限能力映射、deny 短路、frontmatter 原型污染、密钥掩码、记忆标签、进程组回收）。工作期间对方继续推进，又新增 `src/net.ts` 并改动 `providers/*`、`main/updater.ts`、`plugins/mcp.ts`（根因 4：出网超时）。

因此本次刻意选择**互补切片**，文件集与对方**零重叠**：

| 归属 | 文件 |
|---|---|
| 对方（未触碰） | `permissions/*`、`plugins/{frontmatter,hooks,mcp}`、`security/scan`、`agent/verify`、`main/{sandbox,updater}`、`providers/*`、`tools/{lsp,run_shell,process}`、`net.ts` |
| 本次改动 | `agent/{loop,prune,worktree,orchestrator,map/rank}`、`tools/{edit_file,read_file}`、`tests/{edge-cases,m3b,m3c}` |

---

## 1. 性能：消除 O(n²) 与无界累积

### 1.1 `src/agent/prune.ts` —— computePrune O(n²) → O(n)

**原因**：`computePrune` 对每个候选索引调用 `isPruneExempt`，而后者内部（a）每次重算 `recentRoundBoundaries`（反向全扫），（b）用 `[...events.slice(0, index)].reverse().find(...)` 定位 tool_call（每次分配一个新数组并全扫）。两个 O(n) 叠在外层候选循环上 = **O(n²)**，且伴随大量临时数组分配。

**改动**：新增 `buildPruneIndex(events, config)` 单遍扫描产出 `{ boundary, callTool }`；`isPruneExempt` 新增**可选**第 4 参复用索引（不传则就地建索引，旧调用点语义不变）；`computePrune` 建一次索引后复用。

**收益**：组装路径上最大的一处平方开销降为线性。长会话（数百轮）下每次上下文组装从 O(n²) 降到 O(n)。

**验证**：新增等价性断言——预建索引路径与就地建索引路径对全部索引**逐位一致**（`tests/edge-cases.test.ts`）。

### 1.2 `src/agent/prune.ts` —— 附件名目录穿越（边界）

**原因**：`attachmentName` 直接把 `sessionId`/`callId` 拼进路径。`callId` 来自 provider、可被模型影响，含 `../` 时越出 `attachmentsDir`；注释声称"sha1 前缀防碰撞"但代码里没有。

**改动**：`safeSegment()` 清洗到 `[A-Za-z0-9._-]` 并限长；文件名加**原值 sha1 前 8 位**（清洗会把不同原值映射到同一串，如 `a/b` 与 `a:b`，digest 消除碰撞，同时保证名字不会退化成 `..`）。

**收益**：封堵穿越面；三处命名（`computePrune` / `writePruneAttachments` / `attachmentPathFor`）仍共用同一函数，回取口径一致。

### 1.3 `src/agent/map/rank.ts` —— 构图两处 O(N²) → O(N)

**原因**：
- 每个 ref 节点遍历**全部**节点找同名 def → O(refs × nodes)；
- 每个 def 节点用 `nodes.some(...)` 找入边 → O(defs × nodes)。

400 文件规模下是 ~10^8 量级比较。

**改动**：一次线性扫描建 `defsByName: Map<name, defKey[]>`；构图时顺带记录 `referencedDefs: Set<defKey>`（收到过 ref 入边的 def），自环判定改查集合。**边的插入顺序与权重累加顺序均保持不变**，故 PageRank 迭代结果逐位不变。

**附带**：`personalizedPageRank` 的 dangling 判定是循环不变量，改为预计算 `hasOut[]`，去掉每次迭代为每个节点重建 key 字符串。

**附带（去冗余）**：删除 `defSitesOf()`——全仓（`src/` / `tests/` / `scripts/`）零引用的死代码，且其实现正是上面被消除的那类 O(n) 全扫。

**验证**：`tests/map-rank.test.ts` 5 项全过（含"相同输入两次结果逐字一致"的确定性断言与收敛判定）。

### 1.4 `src/tools/read_file.ts` —— 大文件 OOM（边界）

**原因**：`readFile(abs)` 先整文件读进内存再截断。输出本身已限 50KB，但一个 GB 级文件会把 Electron 主进程读爆。而 `stat` 结果**早已取过**（用于判目录），只是没用来判大小。

**改动**：`st.size > 16MB` 时改用 `readPrefix()` 只读前 16MB（零额外系统调用，复用已有 `stat`），并在输出显式追加截断声明（fail-visible，含"建议用 grep 定位后再按 offset 读"）。

**收益**：把一次 OOM 崩溃换成一次有说明的降级读。≤16MB 的文件路径**逐字节不变**。

**注**：前缀边界可能切断多字节 UTF-8 序列，末尾解码为替换字符；输出已显式声明截断，故不做修补（避免误改文件本身合法的 U+FFFD）——已在代码注释中说明。

---

## 2. 错误处理与边界

### 2.1 `src/tools/edit_file.ts` —— 替换走字面量语义

**原因**：`content.replace(oldString, newString)` 中 `newString` 的 `$&` / `$1` / `` $` `` / `$'` 会被当作**替换模式**解释（把匹配原文插回去），**静默写入错误内容**。而 `replace_all` 分支用 `split/join` 反而是安全的——同一函数两个分支口径矛盾。

**改动**：单次替换改回调形式 `content.replace(oldString, () => newString)`（回调返回值不做 `$` 展开）。

**收益**：消除一类静默数据损坏（改代码时写入 `$&` 这类字符并不罕见，尤其在处理正则/模板字符串的代码库里）。两分支口径统一。

**验证**：新增 2 项断言（`$&`/`$1`/`` $` `` 原样写入；`replace_all` 同口径）。

### 2.2 `src/agent/loop.ts` —— verify 钩子异常兜底

**原因**：`await opts.verify.run()` 未捕获异常。`.agent/config.json` 损坏或沙箱 exec 抛错时，异常会**穿透整个 agent loop**，把"一次验证失败"升级成"整轮任务中止"。而工具执行路径早有同族 try/catch——同一类外部故障，两处口径不一致。

**改动**：`try/catch` 包住钩子调用，异常合成 `{ ok: false, results: [] }` 走**既有失败路径**（照常落 `verify_result`、照常计入 `verifyAttempts`、达上限照常收口），并把**异常原文**放进 `tool_result`（fail-visible，不让模型只看到 `failureDigest` 的"无详细输出"）。

**收益**：外部配置故障从"炸掉整轮"降级为"一次可重试的验证失败"，与工具路径口径一致。

**验证**：新增断言——钩子抛错两次 → `verify_result` 两次 `ok:false`、首次 `tool_result` 含异常原文、达上限走原收口文案、模型不再被调用。

### 2.3 `src/agent/worktree.ts` —— 合并冲突清单取权威来源

**原因**：从 git 文案 `CONFLICT (content): Merge conflict in <path>` 里取 `m[1].split(/\s+/)[0]` → 恒得 **`"Merge"`**。用户在冲突卡上看到的是一份假文件清单，无法定位要解哪个文件。原有测试只断言 `length > 0`，故漏过。

**改动**：改从 git 的权威输出取 `git diff --name-only --diff-filter=U`（未合并项），**必须在 `merge --abort` 之前取**（abort 会清掉冲突状态）；保留文案解析作兜底（覆盖 diff 无 U 项但报 CONFLICT 的情形），并显式滤掉 `"Merge"` 伪路径。顺带删除该分支里一个从未被使用的 `stderr` 绑定。

**验证**：把原弱断言收紧为**真实路径断言** `expect(outcome.conflictedFiles).toEqual(["README.md"])`——这一行即该缺陷的回归防线。

### 2.4 三处测试竞态（同一根因：等 A 事件、立刻断言 B 事件）

**共同根因**：源码按"先落 UI 数据、再落终态"的顺序 emit（`triggerStuck` 先落 `agent_status(stuck)` 再落提醒消息；`finishInner` 先落 diff 再落 `agent_result`——后者源码注释明确写为"面板先有 diff"的有意设计）。而测试等到**第一个**事件就立刻 `find`/计数**第二个**事件 → 第二个尚未落盘 → 重负载下假红（本次实测稳定复现）。

| 位置 | 等待的事件 | 立刻断言的事件 | 处置 |
|---|---|---|---|
| `tests/m3c.test.ts:616` | `agent_status(stuck)` | `agent_message("[stuck] 静默超过")` | 对消息再 `waitFor` |
| `tests/m3c.test.ts:599` | `agent_status(stuck)` | `agent_message("[stuck]")` + `same_action_obs_x4` | 对消息再 `waitFor` |
| `tests/m3b.test.ts:493` | `tool_result(diff#2)` | `agent_result` 恰好两拍 | 对 `agent_result` 再 `waitFor` |

**改动原则**：对目标事件本身再 `waitFor` 一次。**断言强度一律不变**（仍要求消息存在且含指定文本 / 仍要求恰好两拍），只去掉时序假设——不是把断言改松。

---

## 3. 消除重复逻辑与可读性

### 3.1 `src/agent/orchestrator.ts` —— 抽取审批等待内核

**原因**：三处审批协议（租约相交 spawn / pipeline 整链 / worker 工具）各自逐字重复同一段"生成 id → 登记等待 + 超时定时器 + 所有者路由 → 超时 fail-closed"模板，约 30 行 × 3。三份拷贝里超时语义还不一致（前两处丢弃 `scope`/`note`）。

**改动**：抽出私有 `waitForApproval(id, agentId)` 承载登记/超时/路由，超时统一解析为 `{ approved: false, scope: "once", note: "审批超时（fail-closed 拒绝）" }`；三处调用点各自只保留自己的 `approval_requested` / `approval_resolved` 载荷。**坑十六纪律（先登记等待、再 emit 请求）在注释中显式保留**。

**收益**：净减 14 行（18 增 / 32 删），三处语义收敛为一份；未来改审批超时策略只需改一处。前两处此前丢弃 `scope`/`note` 但只读 `.approved`，行为不变。

**验证**：`m3b.test.ts`（合并/安全 gate）、`agents.test.ts`、`gated-tools.test.ts` 全过。

---

## 4. 验证与基线

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **通过**（exit 0，改动前后各跑一次） |
| 定向测试（本轮改动覆盖的模块） | `prune` / `map-rank` / `tools` / `grep-glob-edit` / `read-shape` / `verify` / `m3b` / `edge-cases` / `plan-gate` / `clarify` / `gated-tools` / `agents` —— **全过** |
| `tests/m3b.test.ts` 单跑 | **27 / 27 通过**（含被收紧的冲突路径断言与去竞态后的评审闭环用例） |
| `tests/m3c.test.ts` 单跑 | **22 / 23 通过**（仅剩 `:406`，既有失败，见下） |
| `tests/edge-cases.test.ts` | **6 / 6 通过** |
| 新增测试 | `tests/edge-cases.test.ts`（6 用例） |
| 收紧的断言 | `tests/m3b.test.ts` 冲突清单 → 真实路径 |
| `pnpm gates`（22 道） | **未取得结论**——沙箱内单次全量门禁实测 >18 分钟未结束（vitest 单跑 575s，其中 import 占 64%），前台多次超时。建议由本机（非沙箱）在并行改动合并后重跑。 |

### 剩余失败：`tests/m3c.test.ts:406`（**与本次改动无关**，已 A/B 证实）

唯一未解的失败：**依赖链事件驱动触发**——`前环 done → 后环自动 spawn`，测试等到 `agent_spawned` 数达 2。

- `waitFor` 的默认预算已是 **10 秒**（不是 1 秒），10 秒内未触发**不像单纯负载抖动**，**疑似真实行为缺陷**，指向 `resolveDependents` / `validateDependsOn` 的路径（`orchestrator.ts:1554` 调用点）。**留作待查，不自行改判据。**

**A/B 证据（关键）**：把本次对 `orchestrator.ts` 的改动临时移出（`cp` 备份 + `git checkout --`），单跑 `tests/m3c.test.ts` → `:406` **同样失败**。证明与本次改动无关；本次未触碰依赖链逻辑（仅动审批等待登记）。

另：改动前的全量 vitest 基线为 `2 failed | 432 passed`，其中一条是 `tests/provider-keys.test.ts` 的 `safeStorage` 用例 5s 超时（疑似沙箱无钥匙串访问权限）。该基线在本次改动前即不绿——**因此"22 道门全绿"这一前提在当前工作区并不成立**，最终门禁结论需在并行改动合并后重取。

### 未做与原因

- **`:406` 不加长超时**：10s 预算内未触发是行为信号，不是预算不足；加长超时等于用"改判据"绕开真实问题（项目明令禁止）。已作为待查项列出。
- **未动 `providers/*`、`main/updater.ts`、`plugins/mcp.ts`**：对方已在其上工作（根因 4 出网超时，新增 `src/net.ts`），避免冲突。
- **未动门禁脚本判据**：`scripts/*-check.ts` 的判据缺陷（如恒真式体检面窄、`unverified` 不计退出码）属"换判据"范畴，按纪律应写 `BLOCKED.md` 而非自行修改。
- **未拆 `orchestrator.ts`（2232 行）**：结构性拆分风险高、收益长期，且在并行编辑期不宜大动。

---

## 5. 改动清单速查

| # | 文件 | 类别 | 一句话 |
|---|---|---|---|
| 1 | `src/agent/prune.ts` | 性能 | computePrune O(n²) → O(n)（预建索引） |
| 2 | `src/agent/prune.ts` | 安全/边界 | 附件名清洗 + sha1 前缀，封堵目录穿越 |
| 3 | `src/agent/map/rank.ts` | 性能 | 构图两处 O(N²) → O(N)；dangling 判定预计算 |
| 4 | `src/agent/map/rank.ts` | 去冗余 | 删除死代码 `defSitesOf` |
| 5 | `src/tools/read_file.ts` | 性能/边界 | 大文件只读前缀，替换整读 OOM |
| 6 | `src/tools/edit_file.ts` | 正确性 | 替换改字面量语义（`$&`/`$1` 不再被展开） |
| 7 | `src/agent/loop.ts` | 错误处理 | verify 钩子异常兜底，不炸整轮 |
| 8 | `src/agent/worktree.ts` | 正确性 | 冲突清单取 `--diff-filter=U` 权威来源 |
| 9 | `src/agent/orchestrator.ts` | 去重 | 抽取 `waitForApproval`，三处模板合一 |
| 10 | `tests/edge-cases.test.ts` | 测试 | 新增 6 项边界回归 |
| 11 | `tests/m3b.test.ts` | 测试 | 冲突断言由"非空"收紧为真实路径 |
| 12 | `tests/m3c.test.ts` | 测试 | 修静默超时用例的可证明竞态 |
