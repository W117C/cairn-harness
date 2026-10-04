# 技术方案与代码架构评审（2026-10-03）

- 评审对象：本仓 HEAD `3306fd0` **＋ 未提交的工作树**（两者结论不同处已分别注明）。
- 评审方式：技术方案评审团三线并行独立分析（架构与扩展性 / 权限与安全 / 验收边界与质量），
  主理人复核成员引用并**亲自复现**其中的阻断级结论。
- 时点：2026-10-03 12:11–12:36（+0800）。期间**有并发会话在写同一棵树**，读数均带该时点。
- 一句话裁决：**内核可继续投入；产品面（桌面层）不可放行；验收证据链当前不成立。**

> 本页只写「此刻能确认的」。凡未执行的测试/门禁一律标「未执行」，不得读成通过。

---

## 1. 结论

1. **`src/` 内核（40,158 行 / 174 文件）架构健康，不建议任何"重构内核"的动议。**
   分层单向、零 electron/UI 反向依赖，门禁体系（33 道）成熟且有分辨力。
2. **桌面层（`apps/desktop/`，1,456 行）当前不可放行。** 桥面 39 个 invoke 通道只接 6 个，
   而 renderer **已经在调用其中 3 个未接通道**；且桌面层不在任何根门的编译面/判卷面/CI 面。
3. **验收证据链本身不成立（这一条与代码质量无关）。**
   `pnpm test` 当前跑不出绿；新落的体量门在 HEAD 上已红且不在认证面/CI；CI 的 22 道名单是手抄第二份。
4. **安全线有 3 项阻断级候选**，其严重度取决于一个**尚未裁决的事实**：
   v1 是否会在「不是自己写的仓库」里跑。若会 ⇒ S1/S3 阻断；若严格限定自有仓库 ⇒ 降为 Medium，
   但该前提必须写进信任模型。

---

## 2. 风险清单

严重度：🔴 阻断 ｜🟠 高 ｜🟡 中 ｜⚪ 低。「位置」为工作树现态。

### 2.1 阻断级

| 编号 | 位置 | 触发条件 | 影响 | 最小修复与验证 |
|---|---|---|---|---|
| **B1** | `tests/head-cert-deps.test.ts`（真机整表那格）；取料 `outputs/suite-refresh-2026-10-03/suite-quiet.json` | 直接跑 `pnpm test` | 该格把**冻结留档里的用例标题**对**当前盘上源码**取预算，任何合法改名都会漂 ⇒ `notResolved` 期望 0。主理人 12:25 实测为 **4**；同日 12:43 另一会话以"换取料"清掉（第三次刷新），但**红会随每次改名复发** | 已裁决并落地（**路 B**），见 §5 |
| **B2** | `scripts/repo-hygiene-check.ts`（帽 0.6）；登记在 `GATES`、**不在** `CERT_GATES` | 跑该门或 `pnpm gates` 全表 | 实测 `outputs/ 1699 / 已跟踪 2735 = 62.1%`（帽 60%）⇒ exit 1。帽按"当天实测值上取整"定，而 10-02 以来 110 笔提交中 62 笔动 `outputs/`、新增 299 个文件 ⇒ **门成立当天即被撞破**；它又不在认证面/CI，这道红不会被任何自动化跑出来 | 二选一：治理取料（`outputs/` 移出仓库或改不随源码入库）或按降帽流程重定帽并在同一笔登记新读数；并把该门补进 `CERT_GATES`（实测 385ms） |
| **B3** | `apps/desktop/src/main/index.ts`（接线循环）、`channels.ts`、`renderer/App.tsx` | 启动桌面壳即触发；提交澄清/决议时触发另两条 | 39 个通道被 preload 全部暴露，主进程只接 6 个，未接的被 `if (handler)` **静默跳过**；renderer 已在调用 `getProviderInfo`／`submitClarify`／`decidePlan` ⇒ Promise 拒绝被 `void` 吞掉。模型选择器恒回落演示；M2-5 三卡的提交与决议在真 Electron 里不生效。`CAIRN_SMOKE` 测不到 | 未接通道改为 **fail-loud** handler；判据遍历 `INVOKE_CHANNELS`，每条要么接真、要么在带理由的未接白名单（仿 `EXEMPT_SCRIPTS`）。反向验证：删掉一条已接通道必须转红 |
| **B4** | `tsconfig.json`、`tests/vitest.config.ts`、`.github/workflows/verify.yml`、`scripts/gate-manifest.ts` | 任何提交 | 桌面层不在根门编译面/判卷面/CI 面（根 vitest 只 `include tests/**`、CI 零 desktop、`desktop-boundary-check` 在 `GATES` 但不在 `CERT_GATES`）⇒ 桌面可编译不过、测试全红而根门全绿；而 `desktop-boundary-check` 自称"分层纪律的机器面"却只扫 `src/`，即分层红线唯一在自动化路径上的位置是**空的** | 新增 `desktop-check`（= `cairn-desktop typecheck + test`）进 `GATES`；`desktop-boundary-check` 升进 `CERT_GATES`；CI 名单同步 |
| **B5** | `.github/workflows/verify.yml` 与 `scripts/ci/README.md` 的可粘贴复跑块 | 任一侧增删门 | 同一张名单在仓里有**三份**：`CERT_GATES`（事实源）+ 两份手抄。README 原话「集合相等**由脚本核过**」是一次**人工核对**的记录，被写成常态性质的样子，而当时**并不存在**这样一份判据。**代价当场就出现了**：写这句话时 README 自己的复跑块已缺 `gate-check` 与 `mutate-needles-check`（20 项 vs 22 项）。且本仓无 git remote ⇒ workflow 从未真跑 | **本次已修 + 已落判据**，见 §4 |
| **S2** | `apps/desktop/src/main/index.ts`（默认工作区）、`src/permissions/risk.ts`、`src/tools/base.ts` | 桌面默认 `workspace=$HOME`（或 `--workspace ~`）；guided/auto 档；default 档下一次"总是允许"覆盖该工具全部路径（`scopeKey` 是工具级） | `staticRisk` 对 `edit_file`/`web_fetch`/`web_search` 与 shell 族都有条目，**对 `write_file`/`apply_patch` 没有任何条目** ⇒ `risk=none`。实测：guided/auto 档写 `~/.zshrc`、`~/.ssh/authorized_keys` 免批；`read_file`/`grep` 在四档（含 read-only）无审批读 `~/.ssh/id_rsa` 并进模型上下文与可重放 JSONL。shell 面本就有这张敏感路径表，**文件面没有** | ① 桌面默认工作区不取 `$HOME`；② 给写向工具补**路径级**风险通道，与 shell 面抽同一张表共用；③ read 面加敏感路径拒读或强制审批，与 `sandbox.ts` 的 SENSITIVE 同源。判据：guided 档写 `.zshrc` 必须非 approve |

### 2.2 高危（不阻断放行，但需在对应批次收口）

| 编号 | 位置 | 影响 | 最小修复 |
|---|---|---|---|
| **S1** | `src/tools/lsp.ts`（配置读取/`spawn`/`prefetchLsp`）、`src/tools/read_file.ts` | 工作区内 `.agent/lsp.json` 的 `command` 被**无审批** `spawn`（`lsp` 从未被 `gatedTool` 包装，也不在 `SIDE_EFFECT_TOOLS`）；`read_file` 无条件调 `prefetchLsp` ⇒「读文件即执行」的单步链。对照：同目录 `.agent/plugins` 有信任门＋内容指纹，`lsp.json` 没有 | LSP 启动纳入权限管线或复用同一只信任门；`prefetchLsp` 默认关。判据：未批准的 `command` 不 spawn |
| **S3** | `src/agent/loop.ts`（verify 分支在权限门之前）、`src/agent/verify.ts`、`src/main/settings.ts` | verify 命令优先取 `.agent/config.json`，否则回落 `package.json` scripts ⇒ 模型先 `write_file` 写 `package.json` 再由自动补拍执行，等价 `run_shell` 的任意命令执行却绕过 shell 威胁表与网络审批。沙箱可用时仍被 Seatbelt 圈住，主要落在沙箱不可用/未接线的宿主 | verify 执行前过一遍权限判定；命令来自模型可写来源时强制出卡；`.agent/config.json` 进信任门 |
| **M1（合并闸）** | `src/main/settings.ts`（`safeMode` 默认 `report`）、`src/agent/orchestrator.ts`（仅在 gate 档调 `mergeGateVerdict`） | 优化计划 §7.5 声称"补上了唯一没有证人的安全判据"，但**默认配置下这段闸根本不生效**；"LLM 报 high 真的挡住合并"仍只有间接证人（仅 `terminal-sync-window.test.ts` 设 gate 档，且它断的是合并时序）。三支新模块 `merge-gate`/`repo-hygiene`/`goal-drift` 的变异锚点实测**各 0** | 裁决 gate 档是否该默认；补一条端到端 `mergeWorker(safeMode:"gate")` 用例；新模块提交后各补 ≥1 条杀手锚点 |
| **A3（workspace 全局）** | `src/main/runner-workspace.ts`、`src/main/agent-runner.ts`、`src/main/memory-handlers.ts` | workspace 是"最近一次 run"的**进程级全局**且从不还原，读方优先返回上次 run 的工作区 ⇒ 工作区切换或并发 run 时，记忆/插件/孤儿 worktree 面板全部指错仓；`handleMemoryDelete` 可能删到**另一个工作区**的记忆（不可逆）。这是 M3「并行不串流」真正会撞的面——它不在事件流上，而在侧路 IPC 上 | 面板类 IPC 入口收显式 workspace 或由 sessionId 派生，禁止走 `getLastWorkspace()`；`currentWorkspace()` 退化为缺省值 |
| **A4（取消单例）** | `src/main/agent-runner.ts`、`src/main/ipc-protocol.ts`、`apps/desktop/src/main/index.ts` | `activeOrchestrator`/`interactiveRunAbort` 是进程级单例、`handleRunCancel()` 无参 ⇒ 两个交互 run 并发时先开的不可取消，会出现"点 A 的打断、断的是 B"。M3 计划文件清单**漏了** `index.ts` | 走 `RunOverrides.signal`，并把 `runCancel` 加 `sessionId` 从 `ipc-protocol` 转发到 `index.ts`。判据：取消 A 不影响 B |

### 2.3 中/低危

| 编号 | 位置 | 影响 | 最小修复 |
|---|---|---|---|
| **S4** | `src/permissions/rules.ts`、`src/main/agent-runner.ts` | 两层规则库按并集合并、无方向约束（注释却称项目层只能收紧）；**实测**「全局 deny + 项目更长 allow」＝ allow，全局 deny 被击穿。放大条件成立：本仓 `.agent/permissions.json` **已被 git 跟踪** ⇒ 授权记录随仓库分发 | 合并处加方向约束；always-allow 落点移出被跟踪文件 |
| **S5** | `src/permissions/command-shape.ts`、`rules.ts` | tokenize 不解析 `$()`/反引号/`${}` ⇒ **实测** deny 被 `echo $(…)` 等击穿。静态威胁表仍是全文正则，故是"用户显式拒绝失效"而非全通道失效 | 递归展开替换载荷（带上限）或对含元字符的段强制抬 ask |
| **S6** | `package.json`（无 SCA 项）、`scripts/security-check.ts` | 无依赖漏洞与凭据入库扫描；桌面层安全回归无机械判据；`security-check` 绿易被读成"仓库安全" | 新增 `deps-check` 与 `secrets-scan`（各带 `--self-test` 反向验证） |
| **A6（循环依赖）** | `worker-shell-tools` → `glm-session` → `memory/inject` → `memory/lessons` → `write-face` → 回起点 | **自写只读脚本 + Tarjan SCC 实测：只算运行时 import 时圈数＝1**（含 `import type` 会多出 4 个假圈）。今天不炸（跨圈符号全在函数体内），风险是后续有人在模块顶层使用被圈符号 ⇒ ESM TDZ。全仓无任何 intra-src 无环判据 | 二选一断圈；加 SCC 适应度函数把现有 1 圈白名单化并禁止新增 |
| **A10（事件契约孤儿）** | `tests/event-registry.ts`（`unionTypes()` **零消费者**，主理人复核为真）、`src/events/index.ts`（`KNOWN_TYPES` 是裸 `Set<string>`） | 三面清单闸（联合 ↔ 注册表 ↔ 渲染面）在删桌面层那笔被一并删除、重入时未恢复 ⇒ 往 `AgentEvent` 联合加新事件类型而忘了加 `KNOWN_TYPES`：编译通过、`append` 运行期抛错、**没有任何判据会红** | 恢复三面对齐判据；`KNOWN_TYPES` 改 `Record<AgentEvent["type"], true>` 把"忘了加"变成编译期错误 |
| **A7（体量帽）** | `scripts/repo-hygiene-check.ts`（帽 2800）、`src/main/agent-runner.ts`（2783 行，fan-in 最高） | 帽只剩 17 行余量，对该文件任何真改动都会撞红；纪律不许放宽帽 ⇒ 要么在多会话在飞时即兴拆分，要么绕过门。W4 计划自述未做 | 排独占窗口只切一个 `// ----` 段，沿用"拆分面再导出"先例，切完帽一次一档降到 1600 |
| **A9（M3 验收锚）** | `docs/superpowers/plans/2026-10-02-desktop-m3-sessions-workspaces.md` | 目标写"并发"，锚却写"不串流≠必须真并发" ⇒ 串行实现也能绿 | 追加重叠证据判据（barrier 式，非 `Promise.all`） |
| **G1（ADR 过期）** | `docs/adr/0001-core-only-vs-desktop.md` | 拿它拍板会被过期事实误导（事实表说"投影 4/30、无打断入口"，现态是 6 型含 error 且有打断按钮）。必做项 1（5 处文档对齐）只在工作树未提交——**HEAD 上仍宣称 core-only**；必做项 2（首启不落 `$HOME`）未做 | 事实表逐行重测、附复现命令；文档对齐先提交或明确裁决基线 |
| **G2（假绿 selfTest）** | `scripts/repo-hygiene-check.ts`、`tests/repo-hygiene-check.test.ts` | selfTest 硬编码 `{total:2443, outputs:1449}` 却命名为"**现状**占比在帽内" ⇒ 单测全绿而门本体红 | 改成"2026-10-02 读数（历史里程碑）"或读真仓并标注 |
| **G3（并发全局跑不可信）** | `scripts/mutate-verify.mjs`（就地改 `src/` 再还原）与任何全量 `pnpm test` 的互斥 | 主理人 13:00 那趟全量：`294/295` 文件绿，唯一红的 `mutate-verify-gates.test.ts` 有 20 条失败；**同一文件单跑 162/162 绿**，现场 `pgrep` 抓到另一会话正在跑 `mutate-verify`。⇒ 多会话在飞时，"全量判卷"这个放行口径本身会给**伪红**，而伪红会训练人忽略真红 | 不需要改代码：**跑全量前先确认 `pgrep -f "mutate-verify\|head-cert\|vitest"` 为空**，并把"这一趟是否独占"写进读数（`head-cert` 已有 `countConcurrentSuites` 这一格，可复用到全量口径上） |
| **G4（留档缺存证页）** | 最新留档 `outputs/suite-refresh-2026-10-03/`（只有两份日志 + json，**无 `readings.md`**），而上一份有 | 存证页是"为什么刷新、跑在哪棵树、独占证据"的唯一落点；缺了它，树号只能反从日志里捞 | 把"留档目录必须含 provenance 页"钉成判据（本次靠日志兜住了，但不该依赖这一点） |
| **R1（goal-drift 不落流）** | `src/main/agent-runner.ts` | 读数印 stderr、**不落事件流**（与优化计划 §1 W3 承诺相反）⇒ 对"事件溯源＝可审计"的主张，这条读数永远无法从 JSONL 回放；且随后再 `replay` 一次 ⇒ 收束路径对同一份日志两次全量解析 | 并入既有事件，或把计划措辞改成与实现一致；去掉重复 `replay` |
| **R2（engines 不符）** | `package.json`（`>=20.3.0`）vs 18 处 `import.meta.dirname`（需 ≥20.11） | 声明支持的版本区间上会 TypeError（未实机验证） | 抬下限或改写法；配一致性判据 |
| **S7** | `src/agent/loop.ts`（落盘脱敏）、`src/agent/security/scan.ts` | 脱敏是启发式，`aws_secret_access_key=` 这类形状不被覆盖 ⇒ 可能留在可重放 JSONL | 扩展赋值式键名匹配；已知凭据文件在 read 输出层强制脱敏 |
| **R4 / A11 / A12** | `tests/map-self-report.test.ts` + `src/agent/map/build.ts`；优化计划 W3 措辞；`apps/desktop/tsconfig.json` 的 `@core/*` | map 判据与 checkout 路径深度耦合（本仓 36 字符绿、嵌套 checkout 必红 ⇒ 同代码不同结论的假红，存量未修）；计划与实现互相矛盾；死配置 | 按 `BLOCKED.md` 请求换判据，不改被测代码；同步措辞；清死配置 |

---

## 3. 主理人独立复核台账

只读命令；结果与成员材料一致者标「一致」，不一致或新增者单列。

| 我执行的命令 | 实测读数 | 核验对象 |
|---|---|---|
| `node --import tsx scripts/typecheck.ts` | 0 报错，exit 0 | 验收线一致；五条放行条件里当前唯一满足的一条 |
| `node --import tsx scripts/repo-hygiene-check.ts` | 面①红 `1699/2735 = 62.1%`（帽 60%）｜面②绿（最大 2783 ≤ 2800），exit 1 | 验收线 + 架构线一致 |
| `git log --since=2026-10-02` ＋ `git ls-files -z -- outputs` | 110 笔提交、62 笔动 `outputs/`、新增 299 个文件 | **新增证据**：量化了"帽成立当天即被撞破"的机制 |
| `vitest run tests/head-cert-deps.test.ts` | 12:25：`1 failed / 114 passed`：`notResolved` 期望 0、**实测 4**；12:56（路 B 落地后）：**121/121 绿**、该文件 43.7s → 5.7s | B1 一致；见 §5 |
| 全量 `vitest run`（13:00–13:05，309.45s） | `1 failed / 294 passed`（295 文件）；`20 failed / 4118 passed`（4138 条）。**这 20 条全部落在 `mutate-verify-gates.test.ts`**，而该文件单跑 **162/162 绿** | **并发伪红**：跑的同时另一会话正在跑 `mutate-verify`（`--in-worktree=gate-mutate-319`，现场 `pgrep` 可证），它**就地改 `src/` 再还原**。见 §5 的遗留观察与 §7 |
| 复现 `suiteRows` + `budgetFromTestSource` 逐行重数 | 4 条全部落在 `tests/promise-recall-inventory.test.ts`，`why` 全是"标题不在那份判卷里"，文件存在 | **B1 真因**：`b4b4db3`（第 317 页）一次**有意改名**（"绑定通道三件加到五件"）更新了判卷锚点却没同步冻结留档——与 10-01 那次同族 |
| `node --import tsx scripts/docs-check.ts`（12:24 与 12:36 各一次） | 均 exit 0 全绿（`UNVERIFIED=3`） | 验收线报告的 4 条红**已自愈**（并发会话未提交页造成），**不列为放行阻断项** |
| `grep/read` 复核：`index.ts:58-70`、`App.tsx:35/143/150`、`risk.ts`、`runner-workspace.ts`、`event-registry.ts`、`.agent` 跟踪面、`git remote`、`tsconfig`/`vitest`/CI 覆盖面 | 桥面 6/39 且 renderer 调 3 条未接通道**属实**；`staticRisk` 无 `write_file` 条目**属实**；workspace 全局不还原**属实**；`unionTypes` 零消费者**属实**；`.agent/permissions.json` 被跟踪**属实**；`git remote` 为空**属实** | 架构线 A1/A3/A10、安全线 S2/S4、验收线 B4/B5 抽点复核全部成立 |
| 逐行解析 `scripts/gate-manifest.ts` 的三张表 | `GATES=33`、`CERT=22`；`desktop-boundary-check` 与 `repo-hygiene-check` 都在 `GATES`、都**不在** `CERT_GATES`，也都不在 CI 的 22 道名单里 | 架构线/验收线一致（我第一次用 awk 区间解析写错，已用逐行解析纠正后确认） |

---

## 4. 本次已落地（B5）

三处改动，全部有反向验证：

| 文件 | 性质 | 内容 |
|---|---|---|
| `scripts/lib/head-cert-deps.ts` | 新增纯函数 | `onlyListsIn`（抽所有**付得起名字的** `--only=` 名单；至少 2 项才算一份，散文里的省略号是在**引用**机制不是第二份清单；抽不到返回 `null`＝取不到，不许读成"没漂"）、`onlyListDiff`（集合差异；**两侧皆空不算对齐**） |
| `tests/cert-gate-face.test.ts` | 新增判据（21 条，本文件由 17 → 21） | 对**仓里真实存在的两份手抄件**（workflow 与 `scripts/ci/README.md`）逐份对齐 `CERT_GATES`；三态分开；一条"有牙"用例（从 workflow 正文摘掉一道门必须当场判定不对齐）；一条差异函数的自证 |
| `scripts/ci/README.md` | 修**实测存在的漂移** | 复跑块 20 项 → 22 项（补回 `gate-check`、`mutate-needles-check`）；把"由脚本核过"那句改成点名现在的判据，并留下勘误 |

**判据真的有牙（用真数据，不是合成样本）**：对改动前的 `HEAD` 版 `scripts/ci/README.md` 跑这份新判据
⇒ `❌ 漂了 第 19 行：20 项（缺 gate-check、mutate-needles-check）`；对修好的工作树版 ⇒ `✅ 对齐 22 项`。
即：**这条判据如果早就在，那次漂移当天就会被抓住。**

**验证读数**（本次实跑）：`assertion-health` 面 `prose-needle-scan` **exit 0**（断言水位棘轮未被顶起，
这次刻意用结构断言与变量实参，没写裸名字）；`docs-check` **exit 0**；`typecheck` **0 报错**；
`cert-gate-face` ＋ `docs-check` ＋ `prose-needle-scan` 三份判卷 **205/205 绿**。
（过程中 `docs-check` 的 D-3 抓到我自己在源码注释里写的 `.md:NNN` 指针 ⇒ 已按本仓纪律改掉，
而不是加豁免。）

---

## 5. B1：已裁决并落地（路 B）

**裁决**：2026-10-03 业主选定**路 B**（按被认证那棵树解析 + 懒回落），而非仓里原先写下的"换取料"。

**这条裁决是被现场证据推着做的**：评审期间（12:11–12:36）主理人实测该格因 `b4b4db3` 的一次**有意改名**
而 `notResolved=4`；同日 **12:43 另一会话以"换取料"清掉了它**（第三份语料
`outputs/suite-refresh-2026-10-03/`，树 `e8a8ed5`）——**一天之内同一格被三份语料对齐**
（10-02 语料 → `9dd1e8a` → `e8a8ed5`）。即：路 A 能让这格转绿，但红每次改名都会回来。

**为什么原口径是错的**：它是**混合**的——标题取自某一份留档 json，预算却按**脚下工作树**取。
而生产侧本来只按**一棵树**取（`scripts/head-cert.ts` 的 `readTest` 读 `TREE`，判卷里有用例逐字钉着这一行），
因为留档与它那棵树才是同一个时点的快照。判卷侧读工作树 ⇒ **连生产语义都没复现**，
才把"仓库在往前走"读成了"这道门红了"。

**落地内容**（`scripts/lib/head-cert-deps.ts` + `tests/head-cert-deps.test.ts`）：

| 件 | 作用 |
|---|---|
| `archiveRevFromProvenance` | 从留档同目录的存证文本里读它跑在哪棵树上（`readings.md` 的「checkout 到 `<sha>`」与日志里 vitest 的「detached HEAD `<sha>`」两种实测形状都认）。**要求众数唯一**，不唯一或读不到一律返回 `null`——不许静默挑一个，也不许折成 HEAD |
| `archivedBudgetReader` | 懒回落：盘上那一份优先，只有该文件里**一个留档标题都取不到**时才回落到留档那棵树（按文件记忆化）。返回 `needsRev` 供调用方判"有漂移却回落不可用" |
| 判卷侧 | 断言**一格未动**（`notResolved===0` 仍在）；新增一条守卫：有漂移而 `archiveRev` 读不出来 ⇒ 判"没量到"、不许判绿 |

**验证（全部实跑）**：

- **自然实验**（最有说服力的一条）：拿那份**曾被判定为红**的旧留档 `outputs/judge-timeout-2026-10-03`（树 `9dd1e8a`）
  喂进新口径 ⇒ `not-resolved` **4 → 0**，且 `implicit` 3687 → **3691**（多出的正好是那 4 条
  —— 是**口径补齐**，不是把量不到的东西丢掉）；触发回落的文件 **1** 份、`git show` 实际调用 **1** 次。
- **常态零代价**：对新留档（已与树对齐）`needsRev = 0`、`git show` **0 次**；那格的耗时从 18.8s 降到 **191ms**
  （全量按 rev 取要 5.07s / 286 次 `git show`，会顶穿本格预算——这是选"懒"而非"全量"的实测依据）。
- **判据自身有证人**：新增 5 条口径用例（两种存证形状、众数不唯一、盘上命中时零回落、
  真缺时用留档补上、**非字面量标题不算漂移**）。最后一条是踩出来的：第一版谓词写成"标题在不在文本里"，
  把 116 条 `it.each`／插值标题算成漂移 ⇒ `needsRev` 24 份、白付 24 次 `git show`（≈15s），
  而真漂移只有 1 份；改成复用 `budgetFromTestSource` 这只**同一的**谓词后归 0。
- `tests/head-cert-deps.test.ts` **121/121 绿**（该文件整体 43.7s → 5.7s）；`typecheck` 0 报错；
  `prose-needle-scan` exit 0；`docs-check` exit 0。

**遗留观察（新增，供裁定）**：最新那份留档目录**没有 `readings.md`**（只有两份日志与 json），
而上一份有——那是记录"为什么刷新、跑在哪棵树、独占证据"的存证页。**存证页缺失本身是纪律回退**：
`archiveRevFromProvenance` 因此必须连日志一起读才拿得到树号（本次靠日志兜住了）。
建议：把"留档目录必须含 provenance 页"也钉成判据，而不是靠下一次评审再看一眼。

---

## 6. 放行条件

当前**只满足第 1 条**：

1. ✅ `pnpm typecheck` 绿（本次实测）。
2. 🟡 `pnpm test` 连跑两次全绿 —— **一次全量为 `294/295` 文件绿**，唯一红是并发 `mutate-verify` 造成的**伪红**
   （同文件单跑 162/162 绿，见 §3）；**"连跑两次"未做**，且必须在独占窗口重跑才作数（G3）。
3. ❌ `pnpm gates` 全表绿，或认证面 22 道 + 新门绿且未跑的门被显式列出（B2 的体量门面①红）。
4. ❌ ADR 0001 结案（桌面去留），或放行声明显式排除桌面面（现仍 Proposed）。
5. ❌ 新增的 5 个文件（intent-to-add）提交后跑一次 `mutate-verify`（三支新模块锚点为 0）。

若把桌面面纳入 v1，另加：B3（未接通道 fail-loud + 通道级判据）、B4（`desktop-check` 进 `GATES`/CI）；
安全侧 S1/S2/S3 三项处置，或在信任模型里写明"只在自有仓库里跑"的前提。

**结论使用纪律**：任何一次 `pnpm test` 的结论都必须带时点与"工作树是否含他人在飞页"的说明——
本仓多会话在飞，本次已实测同一棵树 12:11 红、12:24 转绿。

---

## 7. 覆盖缺口（不得读成通过）

- **未执行**：`pnpm gates` 全表、`mutate-verify`、`head-cert-check`、`gate-check`、`security-check` 本体、
  `e2e`、`pnpm bench`、Node 20.x 实机、**任何 HEAD-vs-工作树基线对照**。
  三位成员与主理人均按只读约束未跑这些。
- **未覆盖的面**：`src/main/scheduler.ts` 与 `src/agent/compaction.ts` 的内部职责边界、
  `src/providers/*` 适配器一致性、桌面 renderer 的 CSP/XSS 面（`contextIsolation` 与
  `nodeIntegration` 已设正确，但未见 CSP）、`.worktrees/` 下 9 棵旧树与 15 个分支的陈旧资产治理、
  打包/发布面。

---

## 8. 推翻条件

- 出现"v1 受众＝不可信仓库里的用户"的证据 ⇒ S1/S3 **上修**为阻断（现在是取决于该事实的候选）。
- `apps/desktop` 被裁决不作 v1 交付面（选 ADR 方案 A）⇒ B3/B4 与其后的接线/投影全部移出范围。
- 出现一条"不打包 core 链也能分发"的方案 ⇒ ADR 事实 11 失效，打包与分发需重估。
- `outputs/` 被移出仓库（B2 选治理路）⇒ 取料占比帽与其"红无人见"的问题一并消失。

---

## 9. 2026-10-04 复核订正（评审后一天，逐条现读；原表一字未改）

**为什么这一节是追加而不是改写**：上面各表的读数是**当时那趟的取料面**（HEAD `3306fd0` ＋ 那天的工作树），
把今天的数涂上去＝伪造证据（第 341 页同一条）。本节只做三件事：标出被现读推翻的**结论**、记下已落地的**修法**、
把本文档自己的一条纪律回补（它长期**未入库**——见 §9.6）。

### 9.1 §8 的推翻条件命中了一条

- 「`apps/desktop` 被裁决不作 v1 交付面」⇒ **2026-10-04 业主裁决落地**（`docs/adr/0001-core-only-vs-desktop.md` 已结案为范围裁决）。
  ⇒ **B3、B4 与 A3/A4 移出阻断/必收清单**（这是移出验收面，不是"已修复"：三条缺陷本身仍然成立，只是不在 v1 交付面上）。
  放行条件 4 由该结案关闭。桌面侧 M4-3～M4-6 在裁决之后仍在继续入库，与本裁决不冲突。

### 9.2 被现读推翻的三条结论

| 本文原话 | 10-04 现读 | 订正 |
|---|---|---|
| §2.1 B2：体量门「登记在 `GATES`、**不在** `CERT_GATES`」⇒ 所以这道红不会被自动化跑出来 | `git ls-tree HEAD scripts/repo-hygiene-check.ts` **0 行**、`HEAD:package.json`／`HEAD:gate-manifest.ts` 各 **0 命中** | 真实成因是**这道门当时还没入库**（连文件都不在 HEAD）。「不在 CERT_GATES」那句取的是**工作树面**。今天它仍是未入库状态，所以这道红仍然无人跑——但归因换了，修法也就换了（不是补 `CERT_GATES`，是先让它入库） |
| §3/§2.1 引用的 `--check-needles 1421 条／阻断 7` | 同一把尺在**干净 HEAD 树**现读：**阻断 0／killer 指针失效 0（HEAD 侧 0）／钉在飞文本 0**，退 0 | 那 7 条是**主树（脏）面**：`loop.ts`（2）、`verify.ts`（1）、`providers/glm.ts`（1）与三支判卷的标题漂移（3，`CAIRN` 改名族）。⇒ 「HEAD 上有 7 条针脚坏」不成立；这条数字在引用时必须带面 |
| 「gate-check 因 H7（`fixtures/impact/accuracy-repo/*` 未登记）是 **HEAD 常驻红**，属隔壁 `1748ca7`」（第 336~338 页同口径） | 干净 HEAD 树 `gate-check` **退 0**，H7 三格逐字 `{"onDiskNotInTable":[],"inTableNotOnDisk":[],"tableDirsNotSwept":[]}`；而 `src/frozen.ts` 最后一次改是 `14d27369`（09-27，HEAD 祖先） | 在当前 HEAD **不可复现**，且**不是登记表后来赶上的**。机制无证人（最可能：当时盘上有未入库的 accuracy-repo 探针文件，后被清掉）⇒ 记为「归因要重做」，不写成结论 |

### 9.3 已落地的修法（两条安全项）

- **S4 已修**（`582ec74b`，台账第 344 页）。本文说的「两层按并集合并、无方向约束」量得更准的形状是：
  **段内取最长词元前缀，`deny>ask>allow` 只在等长时生效**，且合并后的数组**没有层归属字段**——所以「谁放宽了谁」在数据结构上不可判。
  落地内容：`PermissionRule.layer?: "global"|"project"`（只在加载面存在，`savePermissionRules` 落盘剥掉，防仓内文件自称全局层）＋
  全局层 deny 命中即压过任何 allow（业主裁决：地板）。实测凭据：新判卷配 HEAD 版生产 ⇒ `5 failed`，配修好后 ⇒ `39 passed`。
  **本文 §2.1 S2 那一半（写向工具的路径级风险通道）由隔壁的 S2/S5 簇另行落地**，不在本节范围内。
- **S1 拆成两半，只落了静的那半**（`0d41eff2`，第 345 页）。已落：`read_file → prefetchLsp → spawn` 这条「读文件即执行仓库带来的二进制」的链
  **默认断开**（要恢复须宿主显式设 `CAIRN_LSP_PREFETCH=1`），且旧代码上判卷现场就红（marker 出现＝真 spawn 过）。
  未落：`lsp` 进 `SIDE_EFFECT_TOOLS` 这一半**被本仓自己的判卷拦下**——`write-face` 已钉着「lsp 不该被算成改盘」（既有裁决），
  而其接线棘轮要求「进表」与「`gatedTool` 包装（`agent-runner.ts` 的 `GatedName`）」**同笔**，那支文件正被别的会话持有。
  ⇒ 本文 §2.2 S1 保持开放，修法二选一记在任务 **#58**（改判据 / 复用插件那只内容指纹信任门）。

### 9.4 §1 结论 3「验收证据链当前不成立」——今天变成了可数的形状

10-04 跑了三趟 `head-cert`（每趟起前／跑完各现读 0 套并发、`收尾复核=同一笔`）：
`74254586`＝门 **22/22 绿**、全量 `3 failed | 4116 passed (4119)` → `b7c0c34`＝`2 failed | 4117 passed (4119)` → `582ec74`＝`2 failed | 4125 passed (4127)`。
⇒ 这一格从「**没人跑过**」变成「**跑过、门全绿、只剩 2 条判卷红，且两条都在别人手里的判卷文件上**」（`head-cert-deps` 的 `notResolved=2`、
`mutate-needles-check` 把 `%h` 缩写长度当字面量钉）。这是实质推进，但不是"证据链成立"——**#39 仍开**，绿色认证仍未拿到过一次。

### 9.5 我没有重测的部分（别把本节读成全文复核）

§3 复核台账里其余各行、§2.2 S3（`verify.ts` 当时在飞，现在**仍在飞**）、§2.3 的 S6/R2/G2/G3/A7/A9，
以及 §7 列出的未覆盖面（`scheduler.ts`/`compaction.ts` 职责边界、providers 适配器一致性、renderer CSP、
`.worktrees` 与分支陈旧资产、打包分发面）——**只有一例外**：陈旧资产今天清了（17 棵验证树按业主点头回收，`.worktrees` 1.8G→0B）。

### 9.6 本文档自身的 G4 同族问题

它写完之后**一直是未跟踪文件**，而第 343／345／346 页已在按它做订正——引用一个 HEAD 里追不到的证人，与本仓
「证人要与页同笔落库」（`docs-check` D-11）相悖。本节随该文档一起入库，问题就此闭合；教训是同一族的第 N 次：
**产出的判断如果不入库，和没产出只差一次误删。**
