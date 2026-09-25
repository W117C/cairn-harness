# 61 · worker 的验证证据到底有没有走到主模型眼前（能力 5 并行面）

日期：2026-09-25 · 分支：`codex/dsh-structural-hardening` · 前置：第 58 页（主会话返修那一轮的第一条见证）
本页三件事：① 给「worker 证据 → 父模型正文」补一条走真产品入口的见证，并用**三处突变**划清它与既有观测者的分工；
② 顺手读出这一族里三处**代价/成因**读数（未提交的 verify 面、worker 少一个返修轮、报告在父正文里两份）；
③ 三处改法的落点全在热文件上 ⇒ 逐字块交在 §6，不在本轮动。

## 一、见证与三处突变（`tests/worker-evidence-parent-context.test.ts`，3 条）

形状与第 58 页同档：真产品入口（`handleAgentRun` → `runAgent` → `buildSessionOrchestrator` → `spawn_agent`）
+ 仓里既有剧本 `fixtures/agents/write-demo.jsonl`（worker 真写 `demo/config.ts`）
+ 目标仓 `verify.test` 是一条 **grep 那个文件** 的命令 ⇒ 验证结论取决于盘。全程 mock，零模型花费。

三格：绿拍 ⇒ 正文带 `"verified": "verified"`；只换命令 ⇒ 翻成 `"verified": "failed"`；只读 worker ⇒ 正文里**没有** `verified` 键。
父模型那一侧不是读事件，是读 `projectContext()` 投出来的**那一条 tool 消息**（并断它是配对好的 tool、没被降级成孤儿 user）。

突变在 `6c98d73` 的同 HEAD 隔离树里手注入（`cp -al node_modules` 真依赖，规则 52/103）：

| 突变 | 落点 | 全量/子集读数 | 判读 |
| --- | --- | --- | --- |
| A 摘掉父正文里那份证据（事件面留着） | `orchestrator.ts` 终态 body 的 `...(evidence ? { verified: evidence } : {})`（HEAD 行 2092，事件面 2069 留着） | 全量 **4 files / 6 tests 红**，其中 `m3b.test.ts` 2 红 + 本文件 2 红；另 2 红（`docs-check` D-8、`mutate-anchor-titles`）是 HEAD 固有——已把 `orchestrator.ts` 还原后单跑这两只确认：**2 failed / 53 passed** | 「证据在不在合成正文里」这一格**不空**：`tests/m3b.test.ts` 的 W4 三条早就断过 `parentOutput` |
| B 设置位不接到 worker | `agent-runner.ts:231` `...(s.autoVerify` → `...(false` | 本文件 + `m3b` + `worker-project-rules` + `supervise-evidence` 同跑 42 条：**只红本文件那 2 条，其余 40 条全绿** | 这一格此前**零观测者**——判卷自己 `new Orchestrator({... workerVerify})`，守不到产品那次构造（规则 123 第三次命中） |
| C 合成回执被归因成子流 | 在 `emitSyntheticResult` 的 emit 里插一行 `agent_id: w.agentId,` | 本文件 3 条全红 + `m3b` 1 条红 | 「父上下文唯一接收物」这条协议（§4.4.4）在本文件里是**双向**的：正侧要看得见，反侧（子流事件）不许漏进主上下文 |

顺带一个必须记账的事实：`tests/m3b.test.ts` 此刻在另一条线上被删（工作树显示 `D tests/m3b.test.ts`）。
它落地后，突变 A 那一格只剩本文件一个观测者——**这不是"我提前补了位"的功劳，是那条线删文件时应当一起看的账**（已在 §7 点名）。

## 二、读数 R1：未提交的 verify 面 ⇒ worker 静默零拍，而 `absent` 三种成因不分

同一条剧本、同一条 grep，只差「`.agent/config.json` 提没提交」：

| 靶子 | 自动拍 | 父模型正文 |
| --- | --- | --- |
| config 只在工作树（未提交） | `verify_result` **0 条** | `"verified": "absent"` |
| config 已提交 | 1 条（`auto:true, ok:true`） | `"verified": "verified"` |

机制：write worker 的钩子挂在 worktree 上（`orchestrator.ts` `workerVerify?.(loopWorkspace)`——验的是「即将被合并的那份代码」，这个取向是对的），
而 `createVerifyHook` 的 `surface()` 从**那个目录**读 `.agent/config.json`；`surface()` 为 false 时收束闸整段跳过（连一次 `no-surface` 的拍都不落）。
后果两条，都落在能力 5 正中央：
① 用户刚给自己项目配上验证面、还没提交 ⇒ 主会话拍得到、worker 拍不到（主会话跑在主工作树），**同一设置两位读数不同源**；
② `absent` 这一个词同时代表「仓库没配验证面」「配了但没提交」「有面但模型那轮没改盘」三种成因——父模型与合并控制塔都无从收窄（同规则 95：一个字段多成因 ⇒ 交外部旗标，别拿措辞硬盖）。
本轮只落读数与判卷（本文件第一条的 `beats` 前提断言会在这一格变红），改法在热文件上，见 §6 的块 2。

## 三、读数 R2：worker 没有返修那一轮（`autoVerifyRepair` 只给主会话）

第 58 页给主会话补上的返修支，在 worker 这一支**根本没有接线材料**：
`orchestrator.ts` 的 `runLoop(...)` 只递 `{ verify: workerVerify, autoVerify: true }`，没有 `autoVerifyRepair`——
而 `agent-runner.ts` 的 `autoVerifyRepair` 只出现在主会话那一次 `runLoop` 的参数里。
⇒ 同一份红拍：主会话可以再要一轮去修，worker 只能带着 `failed` 直接终态，把「修」这件事全推给合并控制塔后面的人。
这条取向本身有理由（`mergeWorker` 的「合并权永远在人」），但它**从来没有名字**：全仓 `grep -r autoVerifyRepair outputs/ docs/` 只找到主会话的句子。
本页给它定名（规则 57：「刻意不做」要有名字与判卷）：**worker 无返修轮**。
代价上界（不建就是这笔）：每 worker 每次红拍多 1 次模型往返 + 一拍重验，最坏 4 个并发 worker 同轮 ⇒ 4×(一次往返 + 一次 verify)；
按 `replay:latency` 那次读到的 8.7–42s/次往返，就是最坏 ~170s 与相应 token。
重判条件：`replay:run-scorecard` 的 worker 子流里出现「红拍之后还有人改过盘」的样本（今天 = 0，剧本压根没这一支）⇒ 那时再裁接不接。

## 四、读数 R3：worker 的报告在父模型正文里是**两份**

`emitSyntheticResult` 的 body 同时带 `summary: clipped.text` 与 `artifacts.report: clipped.text`——同一份文本、同一条 tool 消息。
探针实测（本页 §一 的绿拍那一格）：60 字的报告 ⇒ 正文 760 字里出现 **2 份**，多付 ≈41 token。
按真语料规模读：`outputs/**/*.jsonl` 里 10 条 `agent_result` 的 `summary` 长度中位 **1045 token**、p90 1750（上限帽 `SUMMARY_TOKEN_CAP=2000`），
合计 9796 ⇒ 去重最多省 **≈9.8k token/这 10 次交付**（每次派活多付一整份报告）。
限定要连读：样本只有 10 条、其中含剧本态会话（同第 55 页对语料的口径），这个数只能当**量级**，不能当"实测线上节省"。
`artifacts.report` 的下游读者只有 `orchestrator.ts` 自己两处（`term.result.artifacts.report ?? term.result.summary`，读的是**事件**不是正文）
⇒ 父正文里去掉一份不丢信息；落点在热文件，见 §6 的块 1。

## 五、判卷与牙

| 项 | 命令 | 读数 |
| --- | --- | --- |
| 新判卷（3 条） | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/worker-evidence-parent-context.test.ts` | 第一次 2 红（缺 shell_rw 批条 ⇒ worker 卡 `waiting_approval`；补批条后又红在「自动拍没落流」⇒ config 未提交）；两处前提补齐后 **3 passed** |
| 突变取证 | 同 HEAD 隔离树 + `cp -al node_modules`，三次单行注入（A/B/C） | 见 §一 表；隔离树已 `git worktree remove --force` |
| 全量表（未突变） | 同树全量 | 258 files / 2751 tests；突变 A 下 4 files / 6 tests 红 |
| 相邻回归 | 本文件 + `m3b` + `worker-project-rules` + `supervise-evidence` 同跑 | 42 passed（未突变） |
| typecheck | `node --import tsx scripts/typecheck.ts` | 见提交前台账 |

待入库锚点（`mutate-verify.mjs` 在飞，逐字块见第 38 页同一批次）：

```
{ id: "worker-evidence-in-parent-body", src: "src/agent/orchestrator.ts", test: "tests/worker-evidence-parent-context.test.ts",
  desc: "父模型正文里摘掉那份证据 ⇒ 必须红", expectFail: "worker 写了盘、verify 在 worktree 里真过 ⇒ 正文带 `\"verified\": \"verified\"`，且它是配对好的 tool 消息" },
{ id: "worker-autoverify-setting-wiring", src: "src/main/agent-runner.ts", test: "tests/worker-evidence-parent-context.test.ts",
  desc: "设置位不接到 worker ⇒ 必须红（这一格 09-25 实测此前零观测者）", expectFail: "同一条剧本、只换 verify 命令（盘上没那么写）⇒ 字段跟着盘翻成 `failed`：它不是常量" },
```

## 六、交接锚点/逐字块（三处落点全在热文件，本轮不动）

**块 1（§4 去重，`orchestrator.ts` 终态 body）**——把 `"artifacts.report"` 那一行从**父正文**里去掉，事件面保留：

```ts
        body: {
          agent_id: w.agentId,
          status: "done",
          summary: clipped.text,
          ...(clipped.truncated ? { summary_truncated: true } : {}),
          artifacts: {
            // 父正文里 report 与 summary 是同一份文本 ⇒ 只留 summary 一份（事件面不动，supervise/sequencer 仍读 artifacts.report）
            ...(filesChanged.length > 0 ? { files_changed: filesChanged } : {}),
            ...(diffRef ? { diff_ref: diffRef } : {}),
            ...(evidence ? { verified: evidence } : {}),
            ...spentFields,
          },
```

反向哨兵（改完必须仍绿）：`tests/m3b.test.ts` 断 `parentOutput` 含 `"verified": ...`、`tests/stream-redaction.test.ts:109` 断 `out.artifacts.report`——
后者读的是**事件**，不该被这块动到；若它红了，说明这块错删到了 `doneResult`。

**块 2（§2 cause）**：`workerVerificationEvidence` 返回 `absent` 时，父正文需要能区分「无面 / 面未提交 / 那轮没改盘」。
最小形状：`WorkerEvidence` 保持四态不动，另在 body 的 artifacts 里带 `verify_surface: "committed" | "missing"`（读 `surface()` 那一次的结果），
落点 `src/agent/worker-report.ts` + `orchestrator.ts` 两处。**先量再改**：`absent` 的三成因占比现在只有「未提交 ⇒ 100%」这一格是实测的（§二），
真语料里各占多少还没有尺——等 `replay:run-scorecard` 或 `replay:verify-cause-mix` 加上这一位再动。

**块 3（§3 定名）**：若要接返修轮，`orchestrator.ts` 的 `runLoop(...)` 那一次递参需要 `autoVerifyRepair`，
且它只能来自设置位（与主会话同口径：`agent-runner.ts` 里 `...(s.autoVerifyRepair ? { autoVerifyRepair: true } : {})`），
不许新增 override 槽——这条是第 58 页 §刻意不做 的同族纪律。

## 七、刻意不做（署名 + 重判条件）

- **不接 worker 返修轮**（§3）：代价已量、真轨迹为零、且合并权在人。重判条件写在 §3 末句。
- **不去重父正文里的报告**（§4）：落点在热文件 `orchestrator.ts`，且它同时被别人的 W4/脱敏断言读着 ⇒ 交块 1，随热窗过来一起做（附反向哨兵）。
- **不给 `absent` 加 cause**（§2）：先补分母尺再改字段（规则 95 要求多成因先交外部旗标，但旗标的占比现在只量到一格）。
- **不撤 `tests/m3b.test.ts` 的既有断言**：那条线删文件时若不同时接住突变 A 那一格，本文件的 2 条就是唯一的守者——已在本页 §一 点名，属对方线的账，不是我的改动面。
- **本轮不新增复跑面**：§2/§3/§4 三个读数各只有一条命令与一次性探针支撑，够立案不够复跑；等要复审时再按第 57 页的形状装面（装面就得同提交登记进 `REPLAY_READINGS`——这条纪律本身有洞，见第 62 页）。
