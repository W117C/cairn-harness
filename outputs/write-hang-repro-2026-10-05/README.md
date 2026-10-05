# 台账 #96 · 交互档写向「无回执即悬挂」的机理（2026-10-05 取证）

**一句话裁决：类 (b)。** 写向工具**按设计**在等一张审批卡；卡之所以永不到来，是因为
`handleAgentRun` 的门由 `over.unattended` **单边**决定（`src/main/agent-runner.ts:2293`），
而卡片投递口是一只**没注册就是空转的可选钩子**（`:1123` → `:519`）。不是死锁（有 60s 定时器，实测
60010ms 自己收），也不是纯测试假象（两个生产入口都自己武装了应答人：`src/cli.ts:1105-1113`、
`apps/desktop/src/main/kernel-host.ts:141`）。

复现于本 worktree HEAD `2efeb197`（`c4ccf4da` 的直接下一笔；`git diff --name-only c4ccf4da HEAD -- src tests`
**空输出** ⇒ 判卷面与 `src/` 面与 `c4ccf4da` 逐字同源，第 381 页那条读数今天仍然成立，没有任何东西修掉它）。

---

## 1. 症状（复刻自第 381 页）

一次 `write_file`，`unattended:false` + `mode:"auto"`：`tool_call` 落流，`tool_result` 不落，
run 不前进也不报错。两支 e2e 控制用例双双 30s 超时（`tests/vitest.config.ts:41` 的
`testTimeout: 30_000`）——**这个 30s 与门那只 60s 看门狗的差，就是症状的全部算绪**：
判卷在被度量物自己规定的等待预算之前先死。

## 2. 旧读数的两处失效（本页最值钱的一格）

第 381 页用它排除了审批通道，两条读数都不支持那个结论：

| 旧读数 | 现读 | 证据 |
| --- | --- | --- |
| 「注入一个立刻批准的 askGate，那一臂没打印 ASK ⇒ 悬挂不在审批通道」 | 注入的门**根本没被调用**：`RunOverrides` 没有 `askGate` 这个键（`src/main/agent-runner.ts:2133-2180` 全列过），门在 `:2293` 被硬编码成交互面那只 | 臂 `F-injected`：注入门的计数器 0 次命中，卡照旧出自 `appAskGate`（`logs/F-injected.log`）；判卷 ③ 同形钉住 |
| 「没打印 ASK ⇒ 没到门」 | 卡的投递口是 `notify: (req) => hooks.onAsk?.(req)`（`:1123`），而 `hooks` 是只由 `setAppHooks`（`:519`）填充的模块对象。**「没打印 ASK」与「没人在答」是同一件事的两种说法，不是排除证据** | 臂 `B-hookonly`：只注册钩子不作答 ⇒ ASK 在 7ms 到达（`tool=write_file risk=high`），随后与无钩子臂逐字同 stall（`logs/B-hookonly.log`） |

另：`unattended:true` 那条 8ms 收束的旧读数（`tool_result:ok=false`）不足以区分「ask 被自动拒」与
「deny 直接拦」。现读靠 `gate` 留痕分开了：臂 `E-unattended` 落的是
`gate={"layer":"L4-risk","mode":"auto","risk":"high","verdict":"unattended"}` —— **verdict 是
`unattended`（问过、当场拒），不是 `denied`（不用问）**。这张卡确实出过。

## 3. 插桩：零 `src/` 改动

所有观测点都是已导出的公开缝，没打补丁、没改文件（`git status --porcelain` 只有两处未跟踪新路径，见第 9 节）：

- `setAppHooks({onAsk,onAskOutcome})`（`:519`）= 边界 3/4 的进出口；
- `handleAgentDecide(askId,…)`（`:2459`）= 唯一的人工决议口（桌面经 `agent:decide` 触达：
  `apps/desktop/src/main/channels.ts:16` → `src/main/ipc-protocol.ts:153`；CLI 直调：`src/cli.ts:584/590`）；
- `handleRunCancel()`（`:2613`）= 交互 run 取消口（读 `interactiveRunAbort`，`:1697` 挂上）；
- `initSandbox()`（`:1357`）= 单独一臂，用来分辨「未自检」与「自检过但降级」；
- `evaluate()`（`src/permissions/autonomy.ts:333`）纯函数直调 = 边界 3 的判定表，不经任何装配。

## 4. 逐边界读数（provider 流 → loop 派发 → 权限/门决议 → 执行器 → 落事件）

| 边界 | 读数 | 位置 |
| --- | --- | --- |
| provider 流 | `tool_call` 7-10ms 到达（九臂同形） | `src/agent/loop.ts:374-377` |
| loop 档位门 | **放行**：runner 把 loop 钉在 `mode:"auto"`（`:1919`），而 `SIDE_EFFECT_DECISION.auto = "allow"`（`src/permissions/index.ts:20`）。六臂落出的 `tool_result` 全带 `blockedBy=-`（另三臂 stall 无回执）⇒ 这一层一条都没拦 | `src/agent/loop.ts:459` |
| 权限决议（细档） | `evaluate(write_file, …, auto)` ⇒ **`verdict=ask, layer=L4-risk, risk=high`**，但**只有 `sandboxAvailable===false` 时**；`null` 与 `true` 都是 `approve/L4-pass`（`logs/G-evaluate.log` 全表六行） | `src/permissions/autonomy.ts:477`，风险线 `:151`，抬风险的通道 `src/permissions/risk.ts:244-245` |
| 门请求 | 卡 7ms 送达、`askId=ask-1`，此后 8s（A/B/F 臂）与 60s（A-full60）内**零事件** | `src/main/agent-runner.ts:575` |
| 执行器 | 未被进入；臂 C-approve 答完之后才出现 `impact_report`（174ms）紧随 `tool_result:ok=true` ⇒ 执行器在卡**下游**，不在上游 | `src/agent/loop.ts:496` |
| 落事件 | 无应答 ⇒ 60010ms 才落第一条 `tool_result`（`verdict:"timeout"`） | `src/main/ask-gate.ts:76-81` |

**卡是被谁武装的**（第二个装配事实，与悬挂独立但同源）：模块级
`sandboxState = { available: false, reason: "尚未自检" }`（`src/main/agent-runner.ts:1353`）。
类型上第三态存在（`sandboxAvailable: boolean | null`，`src/permissions/autonomy.ts:171`），
而 `sandboxRisk` 只把 `=== false` 当降级（`src/permissions/risk.ts:244`）⇒
**「没自检过」被读成「自检过且不可用」**，于是自主档的每一次写都强制出一张卡。
`initSandbox()` 之后（臂 D，本机 `available=true`）同一条写直接 `auto-approved`，144ms 落回执、不出卡。

## 5. 最后观测到的事件，与那个不 settle 的 await

```
最后事件 = tool_call（臂 A-nopump：STALLED 8000ms 最后事件=tool_call）
永不 settle（在任何判卷预算内）的 await：
  src/agent/loop.ts:496        result = await tool.run(output.args, ctx)
    └ src/main/agent-runner.ts:575   const r = await s.askGate.request(name, args, { … })
         └ src/main/ask-gate.ts:67    return new Promise<AskOutcomeResult>((resolve) => {
              ├ :76  const timer = setTimeout(… 60_000)   ← 唯一会自己响的东西
              └ :100 this.opts.notify?.({askId, tool, args, …})  ← hooks.onAsk 未注册 = 空转
```
为什么它等：`AskGate` 的决议只有三个来源（`decide()` / 60s 定时器 / `ctx.signal` abort）。
第一个要有人点，第三个要有人取消，第二个默认 **60_000ms**（`src/main/ask-gate.ts:45`）。
`handleAgentRun` 选门只看 `over.unattended`（`:2293`），所以「交互装配但没人应答」这一格
拿到的是**逐笔问人 + 60s 才 fail-closed** 的那一支。

## 6. 三类裁决，以及分辨它们各自的证据

- **(a) 真死锁 / 缺超时 —— 否。** 有定时器且真响：臂 A-full60 在 `60010ms` 落
  `tool_result … verdict:"timeout"` 后 run 正常 `{"ok":true}` 收场（`logs/A-full60.log`）。
  也可提前打断：臂 H-cancel 在 2003ms `handleRunCancel()`，2004ms 就落回执（`logs/H-cancel.log`）。
  「挂死」是 30s 观测窗截在 60s 预算之前的形状。
- **(b) 装配决定：故意等一件从没被武装的事 —— 是。** 三条同向：
  ① `:2293` 的门选择以 `unattended` 为**唯一**自变量，同一个 overrides 上另一件「现场没人应答」
  的事实 `noAnswerer`（`:2179`）只喂 goal 续跑闸（`:2296`），从不喂门。
  注：`RunOverrides` 收窄是**刻意的**（`:2132` 那句注释——「新增一个 override 槽必须显式写在这里，
  那时它就得上判据」），所以改法不该是「把注入门打开」，而是把已有那个事实接到门上；
  ② 卡的投递是一只可选钩子（`:1123` + `:519`），没注册就静默丢弃，且这条等待**不落任何事件**
  （`approval_requested` 这个事件型存在，但只有编排器四处会落：`src/agent/orchestrator.ts:889/1240/1265/2424`；
  主会话写门这条路一次都不落）；
  ③ 注入通道在入口就被丢掉（臂 F）。三者任缺其一，症状都不会以「静默 60 秒」的形状出现。
- **(c) 判卷假象（无 stdin、无泵） —— 否（但不等价于「产品没问题」）。** 生产入口确实做了判卷没做的事：
  `src/cli.ts:972` `initSandbox()`、`:1041-1042` 用 `stdin.isTTY` 现算 `interactive/unattended`、
  `:1105-1113` `setAppHooks({onAsk})` 里要么 `handleAgentDecide(…, false)` 当场结算、要么
  `promptForApproval(rl,…)` 真去读 readline；桌面 `kernel-host.ts:141` 把卡 push 进 renderer。
  也就是说：入口把 (b) 那三处缝**用手绕开了**。而 `handleAgentRun` 的第一行自陈「不经 UI 也可直调」，
  它的类型又不要求调用者提供应答人 —— 这条「可直调」的口子就是 #96 剩下的那一格。

## 7. 最小改法提案（**本笔不落产品码**，交主线程拍）

按代价从小到大：

1. **一行（装配面，收掉「没人应答还等 60s」）**
   `src/main/agent-runner.ts:2293`：
   `askGate: (over.unattended || over.noAnswerer) ? unattendedAskGate : appAskGate,`
   把 overrides 上**已经存在**的那个「现场没人能答」事实接到门上（`:2179` 的注释本来就写着它与
   `unattended` 取或，只是目前只在 goal 闸兑现）。代价：CLI 管道档（`noAnswerer:true`）从此不等卡；
   留痕的 `verdict` 由 `timeout` 换成既有的 `unattended`（与 goal 那句停机理由「无人值守 run
   不自动续跑」同向，不是新口径）。要复量的邻面判卷：
   `tests/goal-continue.test.ts:127-165`（它的**散文**正钉着「这两个槽为什么不合并」，且两支只差
   `noAnswerer`；本笔剧本不写盘 ⇒ 现读不会红，但注释那条理由得同步）、
   `apps/desktop/tests/approval-e2e.test.ts`（`default 档 appAskGate` 那条 e2e，桌面套件、根门不扫）。
   **不管**像我探针那样两个键都不给的调用者（它没有自证没人应答）。
2. **约 3 行（可观测面，收掉「静默」这一半，也是能力 8 的直接兑现）**
   在 `appAskGate` 构造处（`:1122`）给 `AskGateOptions` 加一只 `hasAnswerer: () => boolean`，
   `request()` 进 pending **之前**判一次：投递口空转 ⇒ 当场按既有 `reason:"unattended"` 拒并落
   `notifyOutcome`。代价：不新增词汇（`AskOutcomeReason` 已含 `unattended`＝`src/main/ask-gate.ts:25`；
   `GATE_VERDICTS` 已含＝`src/permissions/autonomy.ts:45` ⇒ `gate-audit` / `scripts/replay/gate-outcomes`
   的 `layer × verdict` 分母一格不动，也不新增 `GATE_LAYERS` 行），判卷只需新增一条
   「未注册钩子时不 pending」。这一条把「不可验证」变成「不可验证但可见」。
3. **哨兵正名（真正的武装因，代价最高，建议单列）**
   `:1353` 的缺省值把「未自检」写成 `available:false`，与「自检后不可用」共用一个读数；
   改成第三态需动 `SandboxStatus` 与 `handleAgentState` 的投影面（`:2670`）以及沙箱卡。
   这与第 393 页刚量出的「写侧 unknown 哨兵被读成有身份」是同一族。

提案 1 + 2 合起来才让 #96 这一格真正合上：1 让**声明过没人应答**的 run 不等待，2 让**没声明**的 run
在第一个 tick 就把等待变成一条带理由的回执。

## 8. 复跑

```
node --import tsx outputs/write-hang-repro-2026-10-05/probe-96.mts G-evaluate     # 纯函数全表
for a in A-nopump B-hookonly C-approve C-reject D-initsandbox E-unattended F-injected H-cancel; do
  node --import tsx outputs/write-hang-repro-2026-10-05/probe-96.mts "$a"          # 各臂 8s 上界
done
node --import tsx outputs/write-hang-repro-2026-10-05/probe-96.mts A-full60        # 唯一一条要 60s
```
读数已随档：`logs/*.log`（已脱 ANSI）。九臂 + 一表，全部为**同一次会话内**取的数。

## 9. 判卷与验证台账

新增（两处未跟踪路径，本笔未提交；`git diff --stat` 空）：
- `outputs/write-hang-repro-2026-10-05/{README.md,probe-96.mts,logs/}`
- `tests/write-hang-repro.test.ts` —— **有界**诊断判卷四条：
  ① `evaluate` 表（沙箱读数 = 自主档出卡的唯一变量）；② 真实入口 `handleAgentRun`：
  卡到达时 `tool_call` 在流上而 `tool_result` 不在，答完即出且 `gate.verdict="approved"`；
  ③ 装配口对照：`runAgent` 收 `askGate` 注入，`handleAgentRun` 的第二参**不收**；
  ④ 无人值守基线当场收束（`verdict="unattended"`，且整场 < 5s）。
  每条 `{timeout: 20_000}`（选项式，非位置参数字），且每条在自己的 `finally` 里把卡答掉、
  异常路径经 `handleRunCancel()` 收束 ⇒ **60s 看门狗不会留给进程**，本文件不会把 CI 挂住。

跑过的：
- 单支：`Test Files 1 passed (1)`、`Tests 4 passed (4)`、221ms、`EXIT=0`（`/tmp/dsh-96-judge1.log`）。
- 邻面六支（`write-hang-repro`/`ask-gate`/`gated-tools`/`runner-gates`/`wiring-coverage`/`judge-frozen-gate`）：
  `Test Files 6 passed (6)`、`Tests 50 passed (50)`、`EXIT=0`（`/tmp/dsh-96-neighbors2.log`）。
  六支文件名逐条 `[ -f ]` 过，均存在。
- `tests/prose-needle-scan.test.ts`（收料含全部 `tests/**/*.test.ts`，注释不参与取料）：
  `Test Files 1 passed (1)`、`Tests 91 passed (91)`、`EXIT=0` ⇒ 新文件没推顶包水位。
- `node --import tsx scripts/typecheck.ts`：`typecheck: tsc --noEmit 通过（0 条报错）✅`、`EXIT=0`。
- 全量核心判卷（`--config tests/vitest.config.ts`，起跑前 `pgrep` 为空）：
  `Test Files 1 failed | 335 passed (336)`、`Tests 1 failed | 4706 passed (4707)`、`EXIT=1`、218.91s。
  **唯一那条红不是我推的**，且落在 HEAD 提交态上：
  `tests/repo-hygiene-check.test.ts:152` 钉 `expect(SRC_FILE_LINE_CAP).toBe(2900)`，
  而 `git show HEAD:scripts/repo-hygiene-check.ts:67` 现读是 `= 3000`
  （HEAD 那笔 `2efeb197` 的正文正是「2900 → 3000」，钉 2900 的那格没跟着改）。
  我这两处改动全在未跟踪路径内，未触碰该常量与判卷。
- 没跑：`head-cert`（并发认证由主线程掌握）、`mutate-verify`（本笔无产品码可量）、`pnpm gates`、桌面套件
  （未动 `apps/`）。

恢复：`src/` 一行未改（无 `.mutbak`、无需 `cmp`；`git status --porcelain` 只列上述两处未跟踪新路径）。
