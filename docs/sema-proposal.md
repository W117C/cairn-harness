# SEMA 实施方案：模型驱动的全模块自进化架构（Self-Evolving Modular Architecture）

> 出具：2026-10-05。对表对象：cairn-harness 现有 gate 体系（`scripts/gate-manifest.ts`）、插件容器体系
> （`src/agent/plugins/`）、桌面单向依赖红线（`scripts/desktop-boundary-check.ts`）与 mutate-verify 的
> HEAD-in-worktree 纪律。
> **状态**：实施提案；Phase 0–3 已落地（§9–§12；Phase 2/3 按业主 2026-10-06「继续未竟线直到目标完成／继续开始」的指示施工），Phase 4 起逐阶段另立凭证页。
> 纪律沿用：判据冻结、三态（已证 / 未证 / 不做）、每道核心断言配一条反向验证、未在本文列的项不偷做。
> 与 CC 插件容器的关系：`src/agent/plugins/` 那套「plugin.json 超集」管**外挂容器**（skill/prompt/hook/agent），
> 本文的 CAP Bundle 管**自进化提案**（模型产出的、要装进本仓自身代码与内容面的模块包）。两套契约并存，
> 不互相替代；Phase 3 再决定外挂容器是否纳管进同一条流水线。

---

## 1. 目标与原则

**目标**：让本仓的所有模块（agent、tools、events、routing、providers、permissions、src/main 服务、插件）
与内容（prompt、skill、fixture、记忆 schema、桌面 UI 面板）都能由大模型驱动地
**规划—生成—安装—验证—回滚**，做到自我进化、自我组织、自动安装。

不可妥协的原则：

1. **核心冻结内核（TCB）**：调度、权限、验证、回滚本身（`src/permissions/`、闸门子集、gate 脚本、
   冻结判卷）构成受信根。模型可以提议修改它们，但变更必须过人工或强闸门审批，且修改程序本身不可被模型自行放宽。
2. **单向依赖不破**：`apps/desktop/` 依赖 `src/`，反之禁止。自组织器生成桌面代码时必须遵守同一边界，
   并在 manifest 契约层编码（Phase 0 已落：deps 边界校验）。
3. **一切变更可逆**：所有自修改以版本化「模块包」为单位，落地前快照，失败即回滚。
4. **验证先行**：未通过自动闸门的产物永不激活。

## 2. 目标架构（四平面）

```
┌────────────────────────────────────────────────────────────┐
│  Evolution Plane（模型驱动，不可信）                          │
│  Planner → Generator → Installer → Evaluator → Curator      │
│  只可写 modules/staging/，不能直接改运行面。                  │
├────────────────────────────────────────────────────────────┤
│  Control Plane（稳定内核，受信）                              │
│  Permission Broker · Gate Runner · Version Store · Rollback │
│  · Registry/Manifest Index · Boundary Checker               │
├────────────────────────────────────────────────────────────┤
│  Execution Plane（被进化对象）                                │
│  src/agent, tools, events, routing, providers, permissions, │
│  src/main 服务, plugins/*, apps/desktop/*, content packs    │
├────────────────────────────────────────────────────────────┤
│  Content Plane（内容包）                                     │
│  prompts, skills, fixtures, memory schemas, UI panel packs  │
└────────────────────────────────────────────────────────────┘
```

核心思想：**模型不直接改代码，而是产出「可安装的模块包提案」，由受信控制平面裁决**。
这与现有 plugin 体系天然兼容——把 Evolution Plane 当作一个「更高级的插件作者」。

## 3. 核心机制

### 3.1 模块与内容包的统一抽象：CAP Bundle

每个可进化单元是一个标准目录，带 `manifest.json`：

```json
{
  "id": "tool.web-fetch",
  "version": "0.3.0",
  "kind": "tool | service | plugin | content-pack | desktop-panel",
  "entry": "index.ts",
  "deps": ["src/tools/base"],
  "permissions": ["net.fetch"],
  "gates": ["typecheck", "tools-check"],
  "signedBy": "evolution-plane-pipeline-v1"
}
```

- 所有内容（prompt、skill、fixture）同样打包为 content-pack，走同一套 registry / gate / rollback。
- `kind: desktop-panel` 的包只允许在 `apps/desktop/` 内落代码，desktop-boundary-check 复核；
  其余 kind 的 deps 禁止伸进 `apps/desktop/`——单向依赖在 schema 层即红，不等运行期。
- 门名单的事实源是 `scripts/gate-manifest.ts` 的 GATES；权限词表的事实源在 `src/permissions/`。
  manifest 校验只注入前者、只查后者的形状——**名单不抄第二份**。

### 3.2 自组织闭环（ACE 循环）

- **Assess**：扫描 registry、gate 结果、运行指标（cost-per-progress、no-progress、prefix-churn），
  识别缺口或退化模块。
- **Construct**：Planner 产出 proposal（manifest、代码 diff、测试、文档），写入 `modules/staging/`。
- **Enforce/Evaluate**：Installer 仅在闸门全绿、权限匹配、边界检查通过后原子切换激活指针；
  观察期运行，失败自动回滚并记入 lesson（进 `memory/lessons.jsonl`，供下次 plan 参考）。

### 3.3 能力注册与发现

所有模块在启动时向 Registry 注册（能力声明、入口、权限需求）。模型规划新功能先查 Registry：
「已有能力？」避免重复造模块——模块树由模型按需重组，但总量受 Registry 约束，prune 淘汰未用包。

### 3.4 原子安装与热更新

`staging/` → 闸门 → 原子写切换 `active` 指针 → 新会话装载新版本，旧会话不强杀。
内容包可即时换指针；代码包需重启 runner 或走桌面层的 HMR / 重启钩子。

### 3.5 桌面端的纳入

桌面面板、preload API 面、IPC 协议（`src/main/ipc-protocol.ts`）的变更都以 desktop-panel 包提案形式进入，
必须通过 desktop-boundary-check 与 `pnpm --filter cairn-desktop test`；renderer 侧生成物约束在
`apps/desktop/` 内，且只经 IPC 协议类型访问核心服务。

## 4. 安全与权限边界

| 层级 | 谁能做什么 | 强制机制 |
|---|---|---|
| L0 内核（permissions、gates、registry 指针、原子写） | 模型只读；修改需人工审批 + 双重闸门 | TCB，白名单不可由模型放宽 |
| L1 模块包提案 | 模型可写 `modules/staging/` | manifest 声明权限；signedBy 标识产出管线 |
| L2 安装决策 | Control Plane 裁决；高权限包（net、fs、exec）默认需人工确认 | Permission Broker 按 manifest 的 permissions 比对会话授权 |
| L3 内容包 | 模型可自由生成 prompt / skill / fixture | prompt-surface-check、prefix-churn-check |
| L4 桌面 | 仅限 `apps/desktop/` | desktop-boundary-check + vite 边界约束 |

硬规则：模型产出的代码不得造成 `src/` ↔ `apps/desktop/` 反向 import；高权限能力必须在 manifest 显式
声明，未授权即拒装；进化平面自身的系统提示、工具集、权限由 TCB 冻结；按风险等级提供
「建议 → 自动装 → 定时自进化」的 autonomy 分级（挂 `scripts/autonomy-check.ts` 的审计面）。

## 5. 版本管理与回滚

- 每个 bundle 独立 semver；registry 记录 active / previous / deprecated / pruned 四态（Phase 0 落前三态，prune 事件随 Phase 1 补齐）。
- 可逆性由「版本目录不可变 + previous 指针 + previous 文件仍在盘上」达成：`installed/<id>/<version>` 拒绝覆写
  （重装必须 bump version），回滚 = 指针对换，且拒绝把指针切向盘上没有的文件。没有就地覆写就不存在需要
  快照的时刻——初稿的快照机制**不落地**，这笔偏离在 §10 立案。
- 与 mutate-verify 同纪律：自进化代码的验证在隔离 worktree 中跑，不污染主检出。
- 灰度：新版本先在 canary 会话启用，指标（cost-per-progress、no-progress）通过才推广；
  失败样本钉入 fixtures 作回归。

## 6. 典型工作流

1. **新增工具**：Assess 发现无对应 tool → Planner 生成 `tool.wechat-fetch` 包（代码 + fixture + 测试
   + manifest 声明 `net.fetch`）→ 闸门全绿 → canary → 指标正常 → active。
2. **桌面面板自进化**：用户反馈成本面板看不出趋势 → Planner 在 `apps/desktop/` 内改 panel →
   desktop-boundary-check 与桌面判卷全绿 → canary 窗口重载。
3. **prompt 自整理**：prefix-churn-check 发现前缀不稳 → Planner 重写 prompt-pack（content-pack 闸门：
   prompt-surface-check）→ 切换。
4. **模块淘汰**：prune 判据发现某版本废弃超期 → 确认无依赖 → 移除（回滚就绪先行）。

## 7. 工程落地路径

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | manifest schema、Registry（JSONL + 可重建索引）、staging 约定 | **已落地**（§9） |
| Phase 1 | Permission Broker、Gate Runner（执行面注入）、原子安装、指针对换回滚、清退落账 | **核心已落地**（§10）；`evolution-check` 门待真实 staging 流量另立 |
| Phase 2 | 进化平面 v1（人辅）：只产 proposal，人工审批后安装；先跑通 tool / content-pack | **核心已落地**（§11）；「运行面装载」不在 v1（§11 立案） |
| Phase 3 | 桌面纳入：desktop-panel 包进同一流水线；ipc-protocol 版本化 | **核心已落地**（§12）；运行面装载待 Phase 4 |
| Phase 4 | 自治分级：按风险等级放开自动安装；canary 指标闸门与观察期 | 待批 |
| Phase 5 | 自我组织：周期 Assess 驱动重组、prune、跨 pack 依赖重排；lesson 库喂 Planner | 待批 |

## 8. 风险与验证

| 风险 | 缓解 | 验证方式 |
|---|---|---|
| 模型自改权限 / 绕闸门 | TCB 冻结 + signedBy + autonomy 审计 | security-check、边界扫描（模型是否触碰 TCB 路径） |
| 无限生成膨胀 | prune 判据、Registry 容量上限、人工审计周期 | registry 体积告警、模块周期清单 |
| 安装后退化 | canary + 指标闸门 + 自动回滚 | cost-per-progress、no-progress、prefix-churn 对比 |
| 依赖破坏 | manifest deps + 类型检查 | typecheck、desktop-boundary-check |
| 回滚失效 | 快照强校验、回滚演练 | 定期回滚演练通过率、fixtures 回归 |
| Planner 行为漂移 | 输出 schema 校验（本文 manifest 契约）、固定管线版本 | proposal schema 校验通过率、replay-determinism-check |

**核心验收标准**：在不触碰 TCB 的前提下，Evolution Plane 能端到端产出并安装一个新 tool 包、一个
prompt content-pack、一个 desktop-panel，且回滚在 30 秒内恢复旧版本，全部闸门自动判定。

## 9. Phase 0 落地记录（2026-10-05）

已落三个文件，全部 electron-free，测试数据只落 OS 临时目录：

- `src/main/evolution/manifest.ts` —— CAP Bundle manifest 契约：kind/id/version/entry/deps/permissions/
  gates 的 fail-closed 校验；单向依赖边界在 deps 层编码（desktop-panel 只许 `apps/desktop/` 内，
  其余 kind 禁入）；未知顶层字段即红；knownGates 由调用方注入，名单只活在 `scripts/gate-manifest.ts`。
- `src/main/evolution/registry.ts` —— 模块注册表：`modules/registry.jsonl` 追加式事件日志为事实源，
  `registry.index.json` 为可重建投影（与在线操作共用同一套 foldEvent，篡改日志在重建时红）；
  状态机 = register → gate → activate → rollback/deprecate，未过全门永不激活、激活位不可直接废弃、
  回滚为 active/previous 对换；索引写走 `src/atomic-write.ts` 的原子写；判卷与 `project-registry.ts` 同款串行队列。
- `tests/evolution-registry.test.ts` —— 判卷：正向链路（注册→全门→激活→回滚→废弃→淘汰候选）+
  每条不变量的反向验证（未过门激活、重复注册、路径逃逸、越界 deps、坏行日志、伪造 activate 事件）。

**与门禁的关系**：Phase 0 是库 + 判卷，由既有的 `test` / `typecheck` 两道门覆盖，**不**新增空转的
`evolution-check` 脚本（一道没有实质判据的门等于没有门）；该门待真实 staging 流量出现后另立（见 §10）。

复跑口径：

```sh
node --import tsx scripts/typecheck.ts
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/evolution-registry.test.ts
```

## 10. Phase 1 落地记录（2026-10-06）

控制平面三件套 + 账本扩展，全部 electron-free、纯增量文件；判卷 `tests/evolution-install.test.ts`（20 条）。

- `src/main/evolution/permission-broker.ts` —— 安装裁决语义层：授权词与 manifest.permissions 同口径
  （`<命名空间>.<能力>`，支持 `<命名空间>.*` 通配、不支持裸 `*`）；高危命名空间（缺省 shell/net/fs，
  可注入）即便已授权也要求 approvedBy 的人工确认。授权缺口的修法是补授权配置，不是逐次放行。
  grants 的取料面（从哪份配置读）是 Phase 2 接线。
- `src/main/evolution/gate-runner.ts` —— **纯编排层**：按注册时定格的门清单（账本为事实源，不回读
  staging）逐道跑闸、结论经 recordGate 落账、缺省首红即停、重跑＝全量重验。本文件不做任何子进程调用：
  真实执行面（runGate）由 scripts/ 侧（TCB）注入，src 不抄命令面；失败 detail 剥控制字符取尾巴落账。
- `src/main/evolution/installer.ts` —— staging → installed → 激活指针的安全序：先裁决、再查账、
  后动文件、最后切指针。staging manifest 在安装前**重验**（staging 是不可信面的写入口，注册后被改过
  不许装进去）；部署后校验 manifest 字节一致与 entry 是常规文件；切指针失败即清退本次部署。
  rollbackInstalled 拒绝把指针切向盘上没有的文件；pruneInstalled 移除超龄废弃版本并落 prune 事件。
- `src/main/evolution/registry.ts` 扩展 —— prune 事件进账本（未废弃 / 在 active·previous 位 /
  已清退都拒）；pruneCandidates 跳过已清退；paths 增 installed 根；暴露 knownGates 供安装前重验。
- 判卷覆盖：裁决（全授权 / 缺授权 / 命名空间通配 / 高危人工档 / 名单可注入 / 空权限包）、门跑器
  （全绿 / 首红即停 / detail 净化落账 / 重跑翻账 / 未注册拒）、安装序（正向 / 未过门拒且无半成品 /
  未授权拒 / 高危无 approvedBy 拒 / 版本不可变拒 / staging 篡改被重验拦下）、回滚前置（目标缺文件拒）、
  清退账实一致（移除且落账、索引重建后仍在、双跑无操作、非法清退三态全拒）。

**与方案初稿的偏离（立案）**：⑴ 快照机制不落地——版本目录不可变后不存在就地覆写，可逆性由
「不可变 + 指针对换 + previous 文件仍在盘上」给足，且比快照少一类可坏的东西（快照自身的完整性）。
⑵ src 面零子进程——Gate Runner 只编排，真实执行面归 scripts/ 侧（TCB）注入，比初稿「Gate Runner
复用现有 gate 注册表直接 spawn」多收了一格：命令怎么跑永远不过 src/ 信任边界。
`evolution-check` 门仍不立：等真实 staging 流量出现，它量「staging 集合与账本的一致性」这一实质判据
时再进门面；在那之前一道空转门等于没有门。

## 11. Phase 2 落地记录（2026-10-06）

进化平面 v1（人辅档）+ grants 取料面接线，全部 electron-free、纯增量文件；判卷 `tests/evolution-plane.test.ts`（19 条）。落地依据：业主 2026-10-06 指示「继续未竟线直到最终目标完成」——本文批准状态随之落定：Phase 2 按该指示施工。

- `src/main/evolution/grants.ts` —— grants 取料面（§10 立案的「从哪份配置读」）：授权面 = 控制平面自管的
  `<root>/modules/grants.json`，人补授权就改这份文件，每次现读不缓存。授权词与 manifest.permissions
  同一份形状（`isPermissionWord` 单一口径），通配只放 `<ns>.*`（broker 的 grantsCover 认的只有这一种）；
  裸 `*`、深通配 `a.b.*`、单段裸命名空间一律红——写一条永远不会被匹配的授权词比写错更危险，它制造
  「已授权」的错觉。文件缺失 = 空授权面（fail-closed 缺省）；坏 JSON / 未知顶层字段 / version 漂移 /
  重复词红（registry 账本同款纪律：宁可空转不拿错账走）。
- `src/main/evolution/evolution-plane.ts` —— 进化平面 v1 前门，刻意只开两个动作：
  `submitProposal`（proposal 进账唯一入口：只写 `modules/staging/<id>/<version>/`，契约校验在边界、
  `manifest.json` 最后落盘不留「可注册半成品」、写完即 `registerStaged` 把门清单与权限面定格进账本；
  版本不可变从 staging 起，重提必须 bump；任何一步红都清退本次落盘——拒绝即无痕）与
  `installApprovedProposal`（人工审批后的安装：v1 全量人工档，零权限包也要 approvedBy，且不得是管线
  自签；授权面从 GrantsStore 现读；安装序原样复用 Phase 1 Installer）。signedBy 由管线落盘时盖戳
  （`evolution-plane-pipeline-v1`），提案不得自带。
- v1 边界：kind 只收 tool / content-pack，submit 与 install 两头都闸。`manifest.ts` 补三个纯校验出口
  （canonicalRelPath / isPermissionWord / PERMISSION_NAMESPACE_RE）、`registry.ts` 出口 assertActor
  ——皆既有逻辑的 export，零语义改动。

**与方案的偏离/边界（立案）**：⑴ 「运行面装载」（installed → src/agent 生效、桌面挂载）不在 Phase 2
落——它的接线位是 canary 观察期与自治分级（§7 Phase 4），v1 的「跑通 tool / content-pack」定义到
「指针切上、账本可回滚」为止；Installer 头注里「Phase 2 接线」的旧说法以本格为准。⑵ staging 与
grants 的膨胀护栏（文件数/单文件/总量/授权词数四道帽）是 v1 管线策略，常量随各文件走——真实流量出现
后再决定是否上移进门面。

复跑口径：

```sh
node --import tsx scripts/typecheck.ts
node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/evolution-plane.test.ts tests/evolution-registry.test.ts tests/evolution-install.test.ts
```

## 12. Phase 3 落地记录（2026-10-06）

桌面纳入（§7 Phase 3）：desktop-panel 包进同一流水线 + IPC 协议版本化。判卷：`tests/evolution-plane.test.ts` 的 Phase 3 段（4 条）、`tests/ipc-protocol-version.test.ts`（2 条）、`apps/desktop/tests/protocol-version.test.ts`（5 条）。落地依据：业主 2026-10-06 指示「继续开始」。

- **desktop-panel 进流水线**：`evolution-plane.ts` 的 kind 集从 `V1_KINDS` 扩为 `PIPELINE_KINDS`
  （tool / content-pack / desktop-panel）；新增 `requiredGatesByKind` 注入面——按 kind 的必需门，
  fail-closed：缺一即拒，且 submit 与 install 两头都查（install 对**账本定格的门清单**再核一遍，
  注册后策略加严的存量 staged 包拒装、重提须 bump version）。产线形状：desktop-panel →
  ["desktop-boundary-check", "desktop-test"]。service / plugin 仍不收。
- **desktop-test 门登记**：桌面判卷（`pnpm --filter cairn-desktop test`）此前不在 GATES——而
  manifest.gates 只认 GATES 名单里的门 ⇒ desktop-panel 提案声明不了桌面判卷，必需门注入面无从钉死
  （缺席当通过比跳过更坏）。登记进 GATES + package.json script；分钟档，不进 CERT_GATES。
- **IPC 协议版本化**：`IPC_PROTOCOL_VERSION = 1`（ipc-protocol.ts 唯一运行时出口）是协议兼容面
  唯一事实源；`AgentApi.protocolVersion()` 通道把主进程实况递给 renderer，renderer 的期望版本经
  vite define **构建期**注入（产物零运行时 import src——「renderer 只经 IPC 协议类型访问核心」
  红线不破），挂载即比对，失配/查询失败 fail-closed 亮 fatal 早退面。改协议形状 = bump 常量 +
  desktop-panel 提案走同一流水线。
- **棘轮换防**：`src-execution-path.test.ts` 的纯类型面豁免表随版本化撤名（ipc-protocol.ts 长出
  运行时出口 ⇒ 按棘轮自己的规矩：补执行路径并删名，豁免表现空）；channels.test 的通道计数钉与
  wired 名单补齐至现盘 45 条（含在飞会话的 revertTurn / submitFeedback / listFeedback 三键）。

**边界（立案）**：⑴ desktop-panel 的「运行面装载」（挂进桌面壳）仍不在本笔——接线位是 canary
观察期与自治分级（§7 Phase 4），到「指针切上、账本可回滚」为止。⑵ requiredGatesByKind 的产线取值
（desktop-panel → 边界 + 判卷两道）此刻只活在判卷与本文：scripts/ 侧构造 EvolutionPlane 的真实提案
管线待真实流量出现时接线。
