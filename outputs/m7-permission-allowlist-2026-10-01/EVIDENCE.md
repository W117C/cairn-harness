# M7 · 安全与权限：未登记工具名从「默认放行」翻成 fail-closed

- 分支：`feat/m7-permission-allowlist`（自 `zcode` @ `5e0c859` 起，工作树 `.worktrees/m7-perm`）
- 范围：**只做 M7**（业主确认；M5 验证加固 / M6 记忆跨会话不夹带）
- 一句话交付：`evaluate()` 里新增一条 fail-closed 守卫——规则库与注解都没判过的工具名，按写处理并逐次审批。

---

## 1. 改前读数（实测，不是照抄计划书）

路线图 §4 M7 点名 `src/permissions/index.ts:106` 的 `if (!isSideEffectTool(tool)) return "allow"`：
`isSideEffectTool` 是**黑名单**，所以任何没登记的名字都放行；而同一函数下一行是「未列出的档位取 ask」（保守）。
**未知档位=ask（安全） vs 未知工具=allow（不安全）**，两条默认方向相反。

```
evaluate("brand_new_write_tool", read-only) → approve/L4-pass
evaluate("brand_new_write_tool", default)   → approve/L4-pass
evaluate("brand_new_write_tool", guided)    → approve/L4-pass
evaluate("brand_new_write_tool", auto)      → approve/L4-pass   ← 四档全放行
```

**说清楚不夸大：今天没有可利用的洞。** 26 个在册工具名逐个核对过都登了记。
这是**默认值**问题不是当前漏洞——以后新增一族工具忘了登记 `SIDE_EFFECT_TOOLS`，
就会静默绕过只读档与方案门。

---

## 2. 计划书指错了主犯（我自己的核查结论）

计划书把 `checkPermission` 当主犯。实测它**近乎死代码**：

```
$ grep -rn --include='*.ts' -E '\b(gate|checkPermission)\(' src/ | grep -v '^src/permissions/'
src/agent/loop.ts:401:      const decision = gate(mode, name, interactive);
```

**全仓唯一的生产调用点**。`src/main/agent-runner.ts:42` import 了 `checkPermission` 却**零调用**。
真正的门是 `evaluate()`（autonomy.ts 的四层管线），四个生产出口都走它：
`gatedTool`(agent-runner:538) / `gatedMcpTool`(:646) / `gatedWorkerTool`(worker-tool-table:103)。

---

## 3. 实施过程中撤回的一处（**本轮最值得记的结论**）

第一版按原计划在 `checkPermission` 也加了守卫。**全量套件红了 4 条**，根因是它顶掉了本仓**已经存在**的
未知工具闸，而且违反了本仓明文写死的约束：

- `src/agent/loop.ts:423` 已经有那道闸：`const tool = (opts.tools ?? TOOLS)[name]` →
  `unknown tool: <name>` + `blockedBy:"unknown-tool"`（`TOOL_BLOCK_REASONS` 第 6 个成员就是它）。
- `tests/registry-rung.test.ts` 开宗明义：「注册表判定只看**本会话**工具表 `opts.tools ?? TOOLS`，
  **不许拿静态 TOOLS 当唯一源**」——它点名了本仓栽过的形状（「模型看得见、一调就 unknown tool」）。
- `checkPermission` 收不到会话工具表，在那里做任何 `KNOWN_TOOL_NAMES` 判断都必然误拒运行期注入的工具。

红掉的四条：`loop.test.ts` ×1、`registry-rung.test.ts` ×1、`tool-block-witness.test.ts` ×2
（后者最后一条是「分母证人：出口名单与 `TOOL_BLOCK_REASONS` 逐字相等」，少印一种 `blockedBy`）。

**因此撤回 `checkPermission` / `denyReason` 两侧的守卫**，只保留 `evaluate` 那一刀。
撤回理由**留在源码原地**（`src/permissions/index.ts` 的 `checkPermission` 注释），
并由 `tests/permissions-tool-registry.test.ts` 的 **C3** 用例钉住「别被加回来」。

> 一般性教训：**「本仓没有的东西」和「本仓已经有但你翻错了地方」是两回事。**
> 判卷比人的记忆可靠——若当时只跑我自己的新测试，这 4 条红不出来。

---

## 4. 改后读数（逐格实测，原始 JSON 见同目录 `before.json` / `after.json`）

32 格 = 8 个工具名 × 4 档。**变化 16 格，全部且仅是未登记名**：

| 工具 | 档位 | 改前 | 改后 | |
|---|---|---|---|---|
| `brand_new_write_tool` | read-only | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `brand_new_write_tool` | default | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `brand_new_write_tool` | guided | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `brand_new_write_tool` | auto | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `ghost_tool` | ×4 | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `totally_made_up` | ×4 | approve/L4-pass | **ask/L4-mcp-unannotated** | 变 |
| `shell_ro` | ×4 | approve/L4-pass | approve/L4-pass | — |
| `automation_list` | ×4 | approve/L4-pass | approve/L4-pass | — |
| `impact_query` | ×4 | approve/L4-pass | approve/L4-pass | — |
| `mcp__srv__x` | ×4 | deny/L0-hard … ask/L4-mcp-unannotated | 同左 | — |

**在册 26 名逐格零回归**：26×4 = 104 格 `verdict`/`layer` 逐字不变，
判卷是 `tests/permissions-tool-registry.test.ts` 的 **B1 金标准表**（不是通则——每格点名期望值，
因为通则会跟被改对象一起漂）。

---

## 5. 关键设计决定

1. **派生而非手抄**（`src/permissions/tool-registry.ts`）：写向工具这个事实本仓已有三处所有者，
   再手抄第四份就是本仓反复判死的「第二个事实源」形态。新表**只做并集，一个名字都不新增**。
   来源：`TOOL_NAMES` + `INJECTED_TOOLS` + worker 两张表 + `WORKER_IMPACT_TOOL`（全部实测无 import 环）。
2. **裁决 `ask` 而非 `deny`**（业主确认）：`evaluate` 的 ask 会**真出审批卡**，交互时人看得见；
   无人值守 askGate 缺席自动降 unattended-deny。
3. **复用 `L4-mcp-unannotated` 层，不新增层**：两件事同源——「工具面没为自己作证」。
   autonomy.ts 早已把这个原则写给 MCP（「让一个自报家门的 server 比沉默的 server 拿到更少审批，
   等于奖励不写注解」），未登记工具是「什么都没说」的极端情形。
   **代价（已知并接受）**：该层读数此后不再只关于 MCP，两种情形在同一格并进。
4. **`mcp__` 前缀豁免**：未知名规则答的是「从没听说过这个工具」；MCP scoped 名答的是
   「这个工具存在、server 主动报备过」。套用会**摧毁 readOnlyHint 白名单**
   （`annotated && readOnly===true` 仍走 `L4-pass` 放行）。
5. **位置**：在 L1/L2/L3-rule **之后**、L4 风险层**之前**，且在 `!policy.writeAsk` 块**之外**
   （否则 read-only/default 档收不到）。

---

## 6. 反向验证（6 个变异，每个都杀掉了它该杀的那几条）

| # | 变异 | 杀掉断言 |
|---|---|---|
| M1 | `evaluate` 守卫 → `if (false && …)` | **3** |
| M3 | 派生集漏掉两张 worker 表 | **3** |
| M4 | 派生集漏掉 `INJECTED_TOOLS` | **5** |
| M5 | `isKnownToolName` 去掉 `mcp__` 豁免 | **1** |
| M6 | **把撤回的 `checkPermission` 守卫加回来** | **5 条 / 4 个文件** |

M2（原计划的 `checkPermission` 守卫变异）随该守卫一并作废，由 M6 取代——M6 证明撤回这件事本身被钉住了：
红的不只是我新写的 C3，还有 `registry-rung` / `loop` / `tool-block-witness` 三份既有判卷。

全部变异后逐个还原，还原后残留扫描为 0（`if (false` / `dropped` / 守卫缺失均已确认）。

---

## 7. 语料漂移：原计划担心的那一条，**结构性不可能**（实测）

原计划留了条遗留：「`scripts/replay/ask-density.ts` 用历史语料里的工具名过 `evaluate`，
若语料含早于工具面的旧名字，改动后 ask 密度读数会漂」。

实测结论：**不可能漂。** 复跑面在喂给 `evaluate` 之前先过 `isGatedTool`
（`scripts/replay/corpus.ts:29`），而受管面是 `SHELL_FAMILY ∪ {write_file, edit_file} ∪ mcp__*`——
全部已在 `KNOWN_TOOL_NAMES` 内：

```
复跑面 gated 名字数: 5
其中未登记(=会被新守卫改判): 0 []
mcp__ 豁免生效: true
```

`gate-outcomes.ts` / `corpus-inventory.ts` 走同一个 `isGatedTool`，同一条结论覆盖三个复跑面。

---

## 8. 认证

| 项 | 基线（`5e0c859`） | 改后 | |
|---|---|---|---|
| Test Files | 263 passed | **264 passed** | +1（新判卷文件） |
| Tests | 3512 passed | **3523 passed** | **+11**（测试数只增不减） |
| 退出码 | 0 | **0** | |
| typecheck | 0 报错 | **0 报错** | |

新增判卷 `tests/permissions-tool-registry.test.ts` **9 条**，分 A / B1 / B2 / C / C2 / C3 / D1 / D2 / E 组
（B1、B2 各含 104 格与 104 格的金标准表，逐格点名期望值）。
另有既有判卷增量：`gate-audit.test.ts` +1 条 `LAYER_CASES`（不加则该文件的穷尽断言必红）、
`tool-surface-parity.test.ts` +2 条（三面对账扩成四面 + 分母自证）。
逐文件实测增量 9 + 1 + 1 = **+11**，与套件读数吻合。

### 门禁全表（31 道，`scripts/gates.ts` 清单即事实源）

**绿 26 ／ 红 5**，逐道退出码都实测过：

| 结果 | 门 | 退出码 |
|---|---|---|
| ✅ | `typecheck` `test` `e2e` `sandbox:check` `fork-check` `autonomy-check` `docs-check` `compaction-check` `tools-check` `map-check` `prune-check` `provider:check` `memory-check` `plugins-check` `security-check` `gym-check` `routing-check` `supervisor-check` `model-surface-check` `prefix-churn-check` `prompt-surface-check` `replay-determinism-check` `no-progress-check` `cost-per-progress-check` `head-import-check` `evidence-typecheck-check` | 0 |
| ❌ | `head-cert-check` | 1 |
| ❌ | `gate-check` | 1 |
| ❌ | `mutate-needles-check` | 1 |
| ❌ | `mutate-verify` | **124（超时，非内容红）** |
| ❌ | `mutate-needles-check`（已列） | — |

**五道红逐条归因，没有一条是本轮引入**（证明方式写在括号里，不是推断）：

1. **`gate-check`** — H7「冻结表与判卷区目录双向一致」报 `fixtures/impact/accuracy-repo/*`
   十个文件 `onDiskNotInTable`。
   （我的提交零触及 `src/frozen.ts` / `scripts/frozen-sha256.json` / `fixtures/`：
   `git show --stat HEAD -- src/frozen.ts scripts/frozen-sha256.json fixtures/` 输出为空；
   那十个文件由 **`1748ca7`** 引入；父提交 `5e0c859` 的提交信息**自己就记着这道门红**并归因给同一笔。）

2. **`mutate-needles-check`** — 4 条锚点针脚失效，分布在
   `src/agent/orchestrator-config.ts`（×2）、`src/main/agent-runner.ts`、`src/providers/openai.ts`。
   （门自己印出了「谁搬走的」：`4c10272` / `404249c` / `e76ed13`。实测这三笔
   **都是父提交 `5e0c859` 的祖先**⇒ 都在我开工前就存在；我的提交文件列表里没有这四个文件。）

3. **`head-cert-check`** — 它内层重跑 22 道门，把上面 1、2 两条红**继承**进来；
   它自己的读数是全绿：`Test Files 264 passed (264)｜Tests 3523 passed (3523)｜exit=0`，
   `认证门面=22 道（跑到 22）｜❌ 红 2 道｜⚠️ 超预算 0`。⇒ **不是新红，是转述。**

4. **`mutate-verify`** — `exit=124` = **超时**（预算 1200s，实测 1215021ms），
   不是内容红：日志里所有可见断言都是 ✅，超时信息自己写着
   「超时：SIGTERM 宽限 15s 内未退出，已整组 SIGKILL」。
   全表 5 条 ❌ 全部是上面那批**同一批失效锚点**（`worker-budget-window-ignored` /
   `worker-budget-clamp-removed` / `sandbox-mapping-copy-reintroduced` /
   `openai-never-reads-finish-reason` / `selector-scan-fed-empty-table`），
   **没有一条涉及我的文件**（`grep -cE "permissions|tool-registry|evaluate|checkPermission"` = 0）。

5. ⚠️ **超时留下了一个突变（已清理）**：`SIGKILL` 那条消息明写「子进程未自还原」。
   实测 `.worktrees/gate-mutate-verify/src/agent/prompt-surface.ts` 确实被改了一半
   （`if (allModes.length === 0) throw …` 被摘成 `return []`——把一条 fail-closed 弄成静默空数组），
   并留下 `.mutbak`。已用该 `.mutbak` 原样还原，复核 `git status` 为空、
   全树零 `.mutbak`。**发生在门自己的临时工作树，不在本分支**；本分支全程 `git status` 干净。

> 记忆里那条「`pnpm gates` 超时会留下 `src/` 里的突变」这次又应验了——
> 与其相信日志里那句「未自还原」的说明，不如直接查那棵树有没有 `.mutbak`。

---

## 9. 局限与遗留（**不偷做**）

1. **`src/main/agent-runner.ts:3` 的注释与事实不符**：写着「真实门…复用 `checkPermission`」，
   实际真实门是 `evaluate`，`checkPermission` 在该文件里零调用。
   属集成 owner 写范围（路线图 §5.1），本轮**只改注释不动逻辑也不越界**——但它会误导下一个读代码的人。
2. **不改 `SIDE_EFFECT_TOOLS` 写向判定本身**（另有 4 个消费者 + 各自变异锚点）。
   `shell_ro` 刻意不计入写向是既有设计（靠执行期静态白名单），新表只答「认得吗」不答「危不危险」。
3. **`L4-mcp-unannotated` 层读数不再单一**：见 §5.3 的代价，已知并接受。
4. **五道红的归属**：见 §8 的逐条归因——全部在我开工前就存在（`gate-check` H7 属 `1748ca7`；
   `mutate-needles-check` 四条锚点属 `4c10272`/`404249c`/`e76ed13`；
   `head-cert-check` 转述前两者；`mutate-verify` 是超时而非内容红）。
   修它们要改 `src/frozen.ts` 的 areas 与四条变异锚点的落点，属路线图 §5.1 划给**集成 owner** 的共享面，
   本轮不越界修，也不写成"全绿"。
5. **`mutate-verify` 只跑到超时**：预算 1200s，本机 1215021ms 被 SIGKILL。
   全表 5 条 ❌ 均为上述同批失效锚点，无一条属我的文件，但**这不等于它跑完了**——
   它没有跑完这件事本身照贴。