# Cairn 任务自带判据（task-carried verification）设计

核验日期：2026-11-04（Asia/Shanghai）。分支 `fix/spec-summary-double-count`。
本稿只定机制，不含实现代码。§1 的读数已经在核验中修正过一次，修正过程留在原处。

## 1. 目标与事实边界

**目标**：每一笔真实开发任务在收束前都带一条可执行的验收命令和一条 `verify_result` 证据，
使"agent 自己证明自己做完了"从可选能力变成流程事实，并为下一步"真实失败冻结成 eval case"
提供有出处的语料。

**对照 Anthropic 的做法**：最看重的一条是"给 Claude 一件能跑的东西，让它贴输出，而不是
说做完了"（Boris Cherny 称这能让结果好 2–3 倍）。Cairn 已有验证执行器与事件，缺的是让这条
链在真实任务里稳定成立，以及让读数覆盖到开发流程实际走的那条路径。

**实测事实**（本机现读）：

| 读数 | 值 | 出处 |
| --- | --- | --- |
| 验证配置的入口 | 只按仓库静态读：`.agent/config.json` 的 `verify` 或探测 `package.json` | `src/agent/verify.ts:245` `loadVerifyConfig(repoDir)`，无任务级入参 |
| 本工作区静态判据 | `verify.test` 四条全部指向同一个产物 `pelican-bicycle.html` | `.agent/config.json:9-12` |
| 近期会话日志里跑过 verify 的比例 | 25 份中 2 份（8%） | `.agent/sessions/*.jsonl`，2026-10-25 至 11-04 |
| 全部会话日志里跑过 verify 的比例 | 57 份中 7 份（12%） | 同上，2026-10-07 至 11-04 |
| 其中收敛在末轮的比例 | 7 份中 5 份（4 绿 1 红）；另 2 份的 verify 落在更早轮次，按"只读当前轮"口径记 `none` | `src/agent/evolution/signal.ts:48` `eventsForCurrentRun` |
| 账本里的 verify 结果 | 491 条非测试 run：`none` 490、`red` 1、`green` 0 | `.agent/evolution-ledger.jsonl`（已剔除 914 条 provider 冒烟记录） |
| 账本的覆盖面 | **CLI 也入账**（实测）：CLI → `handleAgentRun` → `runAgent` → `emitPostRunReadings`；一条 demo run 追加了 `verifyOutcome:"green"` | 本稿配套报告 §三；`src/main/post-run-readings.ts:37`；`src/main/agent-runner.ts:1809` |
| 账本与日志不一致的实例 | 会话 `2026-11-03 12:32:49 #4` 复算为 `green`，账本两条记录均为 `none` | 会话日志复算 vs 账本按 session 名比对 |
| 自进化补丁产出 | 账本内 491 条累计 `patches` = 0 | `src/agent/evolution/index.ts:175` 写的是过门后的 `patches.length` |
| 补丁的外部回放位 | 只有定义，生产调用点只传 `reflect` | `src/main/post-run-readings.ts:100`；`src/agent/evolution/patch-gates.ts:29` |
| 靶场语料 | 4 条合成 case，均为玩具 bug-fix | `fixtures/gym/index.json` |

**核验中修正的两处**：①初稿把"账本 490/491 为 `none`、0 绿"当成真实使用的全量读数；复算会话日志后
改为只用会话日志作覆盖率读数、账本只作逐轮行为读数，两者不并排。
②初稿断言"账本只覆盖桌面路径、CLI 不入账"——**已被实测推翻**：demo provider 的 CLI 跑完，
账本追加了一条 `verifyOutcome:"green"`。CLI 经 `handleAgentRun → runAgent → emitPostRunReadings` 入账。
仍有一例未解释：2026-11-03 12:32:49 #4 复算为绿、账本记 `none`；成因未查清，按"账本可能漏记"登记，
不据此推断 CLI 整体缺失。

**三种成因的结论**（诊断已做，纯离线复算，未花钱）：

- (a) **没跑**：成立且是主因。近 11 天 23/25 份会话日志里没有任何 `verify_result`。
- (b) **跑了但没归到本轮**：存在，但**不是缺陷**。`eventsForCurrentRun` 只让当前用户轮发言；
  更早轮次的 verify 不替最后一轮表态，这是正确语义。2 份会话因此记 `none`，读数本身没错。
- (c) **跑了但归因没落**：未发现。有 verify 的会话里 `cause` 与结果都对得上。

⇒ 因此本轮做机制 (a)，并把账本覆盖面补到 CLI（否则开发流程自己走的路径永远不产生读数）。

## 2. 方案取舍

| 方案 | 收益与代价 | 决定 |
| --- | --- | --- |
| 按 diff 猜该跑哪个测试（测试影响分析） | 覆盖面最大，但本仓没有这套分析；猜错产生**假红**，会把唯一的结果信号污染成噪音 | 不采用（留作后续，需单独的证据面） |
| 把静态配置改宽，每轮跑全量 | 实现最省事；本仓全量 `pnpm test` 实测 219s 起，8GB 上每轮不可行 | 不采用 |
| **任务书声明一条判据，harness 照跑** | 人与 agent 读同一份；判据在开工前定，不能事后挑一条永远绿的；成本由声明者控制 | **采用** |

## 3. 机制

### 3.1 覆盖核对（已实测，无需新增）

CLI 收束经 `handleAgentRun → runAgent → emitPostRunReadings` 入账：demo run 写入了
`verifyOutcome:"green"` 的 `run`。本轮**不新增**读数通道；只登记 §1 那一条未解释的例外。

### 3.2 判据声明

1. **入口**：CLI `--verify "<cmd>"`，可重复（多条按顺序跑，全绿才 `ok`）。
   第一轮不提供桌面端入口：`apps/**` 当前有并发在飞的改动。
2. **落盘**：`SessionMetaEvent` 增加可选字段
   `verify?: { commands: string[]; timeoutMs?: number; note?: string }`。
   依据 ADR 0005，这是**日志结构控制记录**（关于这次会话将如何被判定），不是"agent 做了什么"，
   因此不新开事件类型、只给既有事件加可选字段。
3. **解析优先级**：会话声明 > `.agent/config.json` > `package.json` 探测。
   无声明时行为与今天逐字相同。
4. **证据**：`VerifyResultEvent` 增加可选 `source: "task" | "config" | "probed"`。
   同一条红，读者能立刻分清是"任务书定的判据没过"还是"仓库自带判据没过"。
5. **执行面复用**：`runVerifyOutcome` / `createVerifyHook` / `classifyVerifyFailure` 的判据不改；
   本稿只加一层配置解析。任何"顺手优化"验证器行为的改动都不在本稿范围。
6. **安全**：
   - 命令只从**人手输入**进入（CLI 参数）。第一轮不接受 agent 自提判据——能自己挑判据的
     agent 可以挑一条永远绿的。
   - `timeoutMs` 受 `MIN_VERIFY_TIMEOUT_MS` / `MAX_VERIFY_TIMEOUT_MS` 夹取，越界报错不静默收下。
   - 命令字符串原样落进事件流，重放可见。

## 4. 本轮不做

- 桌面端 UI 与设置页入口（`apps/**` 在飞）。
- 真实失败冻结成 gym case、`PatchReplay` 接线（下一轮，依赖本轮的语料）。
- 自动判据选择（见 §2）。
- `verify` 判据语义的改动（归因、超时策略、重试拍数）。

## 5. 验收

1. `cairn --verify "node --import tsx scripts/typecheck.ts" "<任务>"` ⇒ 事件流含
   `session_meta.verify.commands`，且收束时有 `verify_result{source:"task"}`。
2. 故意给一条必败命令（如 `node -e "process.exit(1)"`）⇒ `ok:false`、`cause:"code"`，
   且该红能在下一轮被模型看到（走既有的红回流通道）。
3. 不给 `--verify` ⇒ 与今天逐字相同，`source:"config"`。
4. `cairn --replay <id>` 能读到那条判据及其结果。
5. **反向验证**：把优先级实现改反（config 压过 task）⇒ 判卷必须红；复原后逐字节核对。
6. CLI 收束后在 `.agent/evolution-ledger.jsonl` 追加一条 `run`，其 `verifyOutcome` 与事件流一致（已实测：绿、红各一例）。

## 6. 度量

先测基线，改后同口径再测，不许把不同分母的数字并排。

| 指标 | 口径 | 当前基线 |
| --- | --- | --- |
| 判据覆盖率 | 有 `verify_result` 的会话 / 会话总数 | 近 11 天 2/25；全期 7/57 |
| 首次绿率 | 收束轮首次 verify 即 `ok:true` 的比例 | 4/7（全期有 verify 的会话：4 绿、1 红、2 记 none） |
| 人工介入 | 每笔活的 `user_message` 条数（不含 `origin.kind === "goal"` 的代发轮） | 未测 |
| 账本覆盖面 | 入账 run / 实际收束会话 | 桌面路径覆盖，CLI 为 0 |

护栏：任何"覆盖率上升"的读数，必须同时报同窗口的 `red` 占比与返工轮次；
只报绿的提升等于把成本挪到下一层。

## 7. 实施顺序

1. 覆盖核对（§3.1）：CLI 跑一次会追加一条 `run`——已由 demo 端到端证明，不再改代码。
2. 加 `session_meta.verify`、解析优先级、`verify_result.source`，配判卷。
3. 用一笔真实任务走完全链：任务书 → 落码 → 自证 → 独立复审 → 交笔 → 账本一页。
4. 把这笔活里出现的每个红冻结成 case（先 3 条）。
5. 出读数：覆盖率、首次绿率、人工介入条数、账本覆盖面。

若第 1 步暴露读数本身不可靠（例如 CLI 收束拿不到事件流），先修读数再继续，不加机制。

## 8. 回退

- 不给 `--verify` 即旧行为；`session_meta.verify` 与 `verify_result.source` 均为可选字段，
  旧日志读取路径零改动。
- 需要撤销时按单个 scoped commit revert；未提交态只移除本稿新增且未被他人修改的文件。
- 不清理 `.agent/` 其余内容，不回滚既有 dirty 改动，不删除用户信任数据。
