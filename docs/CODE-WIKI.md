# Core code wiki

This checkout is core-first: the agent kernel (`src/`) is electron-free. The former Electron shell, renderer, preload, desktop gates, and UI acceptance layers were removed on 2026-09-27 (`69fbb0d`); a new desktop shell has since been reintroduced under `apps/desktop/` (2026-10-02, M1 slices) and is **not** scanned by the root gates. Its status and disposition are decided in [`adr/0001-core-only-vs-desktop.md`](adr/0001-core-only-vs-desktop.md).

> 定位按**符号名**而非行号（沿用 `docs/m5-proposal.md` v3 修订的纪律：行号会腐，符号名不会）。
> 本文只写**已核实**的事实；未核实的推测一律不写进来。

## Runtime flow

`runLoop` receives a provider and tools, emits append-only events, and applies permission/security policy. Provider adapters live under `src/providers/`; tool implementations live under `src/tools/`; orchestration and recovery live under `src/agent/`.

`src/main/agent-runner.ts` remains as an electron-free application service used by headless checks and core integrations. It must not import Electron or renderer code.

## ① 事件流就是重放契约（改这里等于改兼容性）

真身：`src/events/types.ts`（`AgentEvent` 联合类型，约 42 个事件/载荷接口）；存储引擎
（`replay` / `forkSession` 等）住 `src/events/log.ts`——2026-10-17 拆分，公开面经 `src/events/index.ts` 逐名再导出。

**为什么它是契约而不只是日志**：`replay(path)` 必须能把一份 JSONL 原样读回来，
所以每条事件的字段都是重放面的一部分。三条由此推出的纪律：

1. **落盘前脱敏，但不改编事件形状**。`src/agent/loop.ts` 的 `redactValue` 只换**字符串叶子**，
   非字符串值原样返回——事件形状是重放契约，不能因为脱敏顺手改掉。
   命中即掩码而不是抛错：工具已经跑完、模型已经看过，抛错会吞掉一次真实结果。
2. **「缺席」与「零」不是一回事**，每个可选字段都写明了这一格代表什么。例：
   - `tool_result.exitCode` **缺席 = 这一笔不是跑进程的工具**，绝不等于 0，`null` 才是「进程没起来」；
   - `usage.cacheReadInputTokens` **缺字段 = 该 provider 没上报**，不等于 0，且不得与 `inputTokens` 再相加；
   - `tool_result.blockedBy` 缺席 = 走到了执行面；`tool_result.hold` 缺席 = 没人按住这次扩张。
   把这些缺席读成「零」，会让「没量到」冒充「量到了 0」。
3. **新增能力优先走既有字段的 origin 通道，而不是新增事件类型**。两处先例：
   `user_message.origin` 承载 sidechat 提升与 goal 续跑（`PromoteOrigin` / `GoalTurnOrigin`）；
   `tool_result.gate` 承载全部权限判定留痕。新增一种事件会让每条旧日志的重放都多一个分支。
4. **例外是「日志结构控制记录」**（`docs/adr/0005-log-structural-records.md`）：描述的是**日志本身被怎么了**
   （回退指针、会话元数据更新），不是「agent 做了什么」，也没有 origin 通道可挂。
   这类记录只允许 `session_meta` / `compaction` 那两种既有形状。
   配套三条协议（真身在 `src/agent/session-cursor.ts`、`src/events/session.ts`、`src/agent/submission-ledger.ts`）：
   - `replay()` 保持**笨且逐字**：控制记录原样读回，解释它是**投影**的活（`src/events/projection.ts`）。
   - **分叉是指针不是拷贝**：子会话只写一行血缘（`{parent, boundary}`），不拷父事件，也不继承父的在飞状态。
   - **游标不透明且 fail-closed**：kind 不认、载荷坏、位置越界、session 不对，一律拒——绝不用另一个游标顶上。
   - **提交带 `requestId` 幂等键**：同一个 `requestId` 再交一次，返回既有那次，不把活跑第二遍。

**枚举即事实源**：`TOOL_BLOCK_REASONS`、`HARNESS_HOLD_REASONS`、`GATE_VERDICTS`、`GATE_LAYERS`
都是**运行时数组**（不是只存在于类型里）。理由一致：复跑面按它铺矩阵，
新增一挡而少配一处时，只靠类型系统会在跨模块处漏掉（`HARNESS_HOLD_PROSE_TOKEN` 用
`Record<..., string>` 的穷尽性把这件事变成编译期错误）。

## ② 权限判定：四层固定序，先命中先短路

真身：`src/permissions/autonomy.ts` 的 `evaluate`（纯函数、零私有状态——规则库与放行集是仅有的两个输入源）。

```
L0-hard    硬边界：只读档摘除 + 方案门（deny 位次最前——摘除的工具规则库不能复活）
  ↓
L1-deny    显式 deny 规则
  ↓
L2-ask     显式 ask 规则（任何档位含自主档都绕不过）
  ↓
L3         档位层：L3-rule（规则库 allow）/ L3-scope（会话记忆）/ L3-mode（档位规定要问人）
  ↓
L4         风险层：L4-critical（任何档强制审批，allow 规则也批不掉）
                     / L4-risk / L4-mcp-unannotated / L4-network / L4-pass
```

- **每次判定都留痕**：`GateMeta{layer, verdict, risk?, mode?, scope?, ruleId?}`随 `tool_result` 落流，
  所以「当时判了什么、人怎么答的」可以从事件流回放（读数面：`scripts/replay/gate-outcomes.ts`）。
- **`mode` 宁缺不编**：档位机之外的判定（`X-distill`）没有档位可言，
  编一个就等于把不受档位管的量算进该档的免批率。
- **主 loop 有六道执行前闸**，共用 `TOOL_BLOCK_REASONS`：
  `tool-table`（白名单硬闸，摘表不是劝告）/ `skill-denial`（run 中途动态摘除）/
  `verify-unwired` / `hook` / `permission` / `unknown-tool`。
  ⚠️ 未知工具名是 **fail-closed**（记 `unknown-tool`），与「未知档位取问」方向相反，别改反。
- **沙箱与权限是两道独立的闸**：`run_shell` 在 macOS 走 Seatbelt（`src/main/sandbox.ts`），
  权限层管审批。网络默认全拒，三条同时成立才出网（判为网络类 + 真的问过并获批 + 非无人值守）。
  **没有「网络开关」**：不放行环境变量、不读配置项。

## ③ 编排：worker 生命周期长于父 turn

真身：`src/agent/orchestrator.ts` 的 `Orchestrator`。

会话级编排器在父 turn 收束后**继续存活**——这是审批解耦的前提：
worker 卡在审批上时，父 turn 已经结束，审批应答与取消必须还有路由可走
（`orchestratorForApproval` / `orchestratorForMerge`）。

四个**持有原因**要分清（`HARNESS_HOLD_REASONS`，刻意不并进 `blockedBy`）：

| 列 | 回答的问题 |
|---|---|
| `blockedBy` | 哪道闸拦下了一次**工具调用**（主 loop 六道执行前闸） |
| `hold` | harness 自己按住了哪一次**编排扩张**（成本闸／并发帽／取消／依赖链） |

折成一列就再也不能单独读出「因钱不起 worker」与「因人手不起 worker」。
`ok:false` 同样与 `hold` 不同款：worker 跑挂的回执也是 `ok:false`，而那一格没有 hold。

## ④ 门禁纪律（改任何判据前先读这一节）

- **清单即事实源**：门表在 `scripts/gate-manifest.ts` 的 `GATES`。
  `checkGateManifest` 兜底「scripts 侧无孤儿」——新增 `*-check` 脚本却忘了登记，
  会得到一道**从不运行的门**（历史实例：`provider:check`）。
- **未证 ≠ 通过**：`gates.ts` 的 `countUnverified` / `gateUnverified` 统计未证项；
  `DSH_STRICT_UNVERIFIED=1` 或 `--strict-unverified` 让未证直接判红。
  绿而零输出的门按未证计入——「查了没发现」与「没查」同形。
- **认证面 ≠ HEAD**：工作树可以替 HEAD 遮红（本仓实测过 86 笔提交跑在红灯上）。
  要 HEAD 认证必须在隔离 worktree 里跑整表。
- **恒真式体检**：`scripts/assertion-health.ts` 扫空断言 / `|| true` / 暗卷段零断言 /
  AST 级析取式弱断言。**让门说的话等于门测的事。**
- **反向验证是硬要求**：每条核心判据都要有一条能证明它**会红**的用例
  （`no-progress-check --self-test`、`routing-check` 的 F4 换价对照同族做法）。
- **判据有缺陷 ⇒ 换判据，不许改代码去绕**（见 `BLOCKED.md` 的 `map-self-report` 一例）。

## Desktop renderer 的三个自研底座（2026-10-07 UI 产品化）

桌面端（`apps/desktop/src/renderer/`）的**分层**（2026-10-22 App 拆分批落地）：
`state/`（state-cluster hooks）→ `derived/`（纯投影）→ `components/` ＋ `panes/`（props in, events out）→
`App.tsx`（组合根）。机器面是 `pnpm renderer-layer-check`（它钉：组件层不回流 `App.tsx`、
状态层不 import 组件层、派生层纯、每源文件 ≤1,200 行且 `App.tsx` ≤900 行）。
**判卷读渲染层源码时读整个面**（`apps/desktop/tests/helpers/app-surface.ts`）——
指着一个文件做 `not.toContain` 的断言，代码一搬就空转通过；空转不是通过，是断言被削弱了。

按 spec
[`docs/superpowers/specs/2026-10-07-desktop-ui-productization-design.md`](superpowers/specs/2026-10-07-desktop-ui-productization-design.md)
重排后，有三个"只有一处"的底座，动 UI 前先认路：

- **图标唯一事实源：`components/icons.tsx` 的 `Ic` 表**。16px 网格、stroke 1.5、currentColor；
  组件一律 `import { Ic }`，不许再内联 `<svg>` 路径或用 emoji 当图标（render-structure 判卷
  豁免的 `⚠`/`✓` 字面量除外）。`providerHue(id)` 给 provider 品牌色相（确定性哈希）。
- **markdown 渲染：`markdown.tsx` 的 `parseBlocks`（纯函数，tests/markdown.test.tsx 判卷）+
  `<Markdown>`**。零依赖、零 `dangerouslySetInnerHTML`（全部 React 文本节点转义，链接只放行
  http(s)）；未闭合围栏按"开放代码块"渲染（流式不闪烁）。样式全部前缀 `.md-*`——不许裸选
  `pre`，会漏进 `.kv pre`（工具行展开体）。
- **粘底滚动：`useStickyScroll.ts`**。`.stream` 有 `scroll-behavior:smooth`，程序化滚动必须
  `behavior:"instant"`（否则高频写入排队成动画、"近底"判定抖动）；「回到底部」浮钮挂
  `.zone-stream`（不挂滚动容器内，否则随内容滚走）。消息重排必须保留 `.row user/assistant`、
  `.toolcluster`、`data-round-anchor` 这些锚——TurnRail 的跳轮/flash 靠 DOM 查询它们。

判卷雷区：`apps/desktop/tests/render-structure.test.tsx` 用 react-dom/server 钉了大量用户可见
字符串与计数（分组头、`标准 · 窗口 128k`、`class="check">✓<`、disabled 计数、设置导航六分区
顺序唯一、`<Switch` 恰 3 处、CustomProviderForm 源码级 `allowLocalEndpoint: true`）。重排 UI
先读它，别把钉子当冗余拔了。视觉自查走 `scripts/ui-gallery.cjs`（离屏 capturePage + 假
AgentApi，不跑真模型、不触发系统录屏权限）。

## Verification

Use the root `typecheck` and Vitest commands. The gate manifest contains only core checks in this checkout.

```sh
node --import tsx scripts/typecheck.ts                                    # tsc --noEmit
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts   # 核心套件
node --import tsx scripts/gates.ts                                       # 全部门 + 恒真式体检
node --import tsx scripts/repo-hygiene-check.ts                          # 仓库体量（取料占比 + 单文件体量）
node --import tsx scripts/repo-hygiene-check.ts -- --self-test           # 反向验证
pnpm mutate-verify    # 变异测试：量的是 HEAD，不是工作树（未提交的改动要先提交）
```

完整优化计划与逐波验收口径见 `docs/optimization-plan-2026-10-02.md`。
