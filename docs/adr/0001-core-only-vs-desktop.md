# ADR 0001：桌面端的存废与 v1 受众

- 状态：**已接受（范围裁决）**——2026-10-04 业主拍板「桌面层不作 v1 交付面」，语义对应下方 D1 **方案 A**；
  与「推荐」段（B＋B1）不同，故本 ADR 以裁决记录为准（见文末「裁决记录」）
- 日期：2026-10-03（提出）／2026-10-04（结案）
- 决策者：仓库所有者
- 依据材料：README.md、AGENTS.md、BLOCKED.md、docs/CODE-WIKI.md、docs/DOCS-MAP.md、
  docs/superpowers/specs/2026-10-02-desktop-shell-design.md、apps/desktop/**、实测记录（见「实测证据」）

## 背景

本仓库出现过一次桌面层整体删除（`69fbb0d`，2026-09-27「移除 Electron 桌面层与 UI 原型资产
（core-only 迁移落地）」），此后多份治理文档按「桌面层已不存在」书写。但 2026-10-02 起，
`apps/desktop/` 以 M1-1/2/3 三个切片重新入库。

于是仓库处于**自我否定**状态：代码说有，文档说没有，而 BLOCKED.md 规定「任何桌面工作必须先有
新的显式设计决策」——该决策至今不存在（仓内无 `docs/adr/`）。本 ADR 即为那份缺失的决策。

## 现状事实（均已核实，非推断）

| # | 事实 | 定位 |
|---|------|------|
| 1 | 5 处文档宣称桌面层不存在，桌面层实际存在且已提交 | README.md:4、README.md:328、DOCS-MAP.md:3、CODE-WIKI.md:3、BLOCKED.md:3 |
| 2 | 39 个 invoke 通道声明，仅 6 个接线（15%） | apps/desktop/src/main/channels.ts vs index.ts:59-67 |
| 3 | 未接的 33 个通道在 src/main/ 均有已实现 handler（抽样 6 个全中） | settings-handlers.ts:53/101、session-handlers.ts:109/133、agent-runner.ts:893/2233 |
| 4 | 事件投影 4/30，error 等事件不进界面 | renderer/projections.ts:25 `default: break` |
| 5 | run 的 ok/error 被丢弃，失败在界面不可见 | renderer/App.tsx:36 |
| 6 | renderer 零引用 runCancel，界面无打断入口；交互 run 的审批门无超时 | agent-runner.ts:1794-1802（仅 unattended 注入 timeoutMs） |
| 7 | 首启工作区默认回落 $HOME | index.ts:29 |
| 8 | 桌面端不进任何根门与 CI | .github/workflows/verify.yml 全文 0 次 desktop |
| 9 | 无任何外部用户证据：private、无 git remote、无 LICENSE、telemetry 无实现 | package.json:4 等 |
| 10 | 桌面端**实际可运行**（实测通过，见下） | CAIRN_SMOKE 冒烟 PASS |
| 11 | **打包不可行**，且是结构性的 | 实测：entry.cjs 上溯 4 层找 tsx/cjs，包体布局下 MODULE_NOT_FOUND |

## 实测证据（本 ADR 新增，此前所有评审均为静态阅读）

1. **构建链是通的**：`pnpm run build`（esbuild preload + vite + tsc）三段全绿，exit 0。
2. **桌面端真能跑**：`CAIRN_SMOKE=1` 冒烟在真实 Electron 窗口里完成
   `window.agent` 探测 → createSession → demo run → 25 个事件 → `run: {"ok":true}`，
   1035 ms 收束，退出码判据已编码。**修正**：此前「M0 未通」「起不来」的疑虑不成立。
3. **打包必挂，且是设计取舍而非配置疏漏**：`entry.cjs` 刻意不打包 core 链（注释明写：esbuild
   打包会把 agent-runner 的 ROOT 漂到 `<repo>/apps`，fixtures 运行时静默落空）。对照实验：
   - 当前布局：`tsx/cjs` → RESOLVED
   - 包体布局（无 repo 根）：`MODULE_NOT_FOUND`
   即「打包」与「不打包 core 链」二者只能取一。
4. **冒烟未覆盖审批门**：`asks auto-approved: 0`，demo 剧本未触发审批 UI，
   故审批交互的运行时行为**仍未验证**。
5. 陷阱提示：`.worktrees/doc-layer` 含现成 `electron-builder.yml`，但该分支落后 trunk
   1098 个提交；且其 mac target 仅 arm64，与 spec §2 #6「macOS 先行（universal）」不一致。

## 决策点（需拍板）

### D1 桌面端存废
- **方案 A｜回归 core-only CLI**：删除或冻结 `apps/desktop`，把 5 处文档改对。
  代价≈T0；接线/投影/打包全部从范围表消失。已投入的 M1 切片作废。
- **方案 B｜桌面产品化**：本 ADR 即为推翻 `69fbb0d` 的显式决策，承认 M1 为 M0。
  代价：接线 T1 + 投影 T2 + 打包 T4（打包需重做构建链，冲突面未知）。

### D2 v1 受众
- spec §2 #3 写「面向公众的产品」，但事实 9 显示仓内零外部用户证据。
- **B1｜自用/内测开发者**：与现状一致，打包可降级为「源码 checkout 内运行」。
- **B2｜面向公众**：必须完成 BYOK 首启（#7）、打包分发、签名（#8）——T4 成为必选项。

## 推荐

推荐 **方案 B + B1**：保留桌面端，但 v1 受众定为自用/内测开发者，打包**先验证不排期**。

理由：事实 10 表明桌面端不是纸面资产（可运行、构建绿、有冒烟门），方案 A 会丢弃一条已跑通的
路径；而事实 9 表明「面向公众」缺乏证据支撑，此时把 T4 打包列为必选项属无依据投入。
B1 让首版能验收（「零手工配置完成一次真会话」），同时不承诺分发。

若选 B，本 ADR 同时确认：**首版不做打包分发**，交付形态为源码 checkout 内运行。

## 采纳后的必做项（与 D1/D2 独立）

无论选 A 还是 B，下列两项都必须做：
1. 修正 5 处文档，使其与代码一致（README.md:4、:328、DOCS-MAP.md:3、CODE-WIKI.md:3、BLOCKED.md:3）。
2. `index.ts:29` 首启工作区不得默认回落 $HOME。

若选 B，追加：
3. 把 `CAIRN_SMOKE` 冒烟接入 CI（当前 CI 0 次 desktop，冒烟门存在却无人跑）。
4. 接线按「凭据设置 → 会话管理 → 对话主链」三组推进，每条通道须有「调用 → 界面可见效果」断言，
   不接受「已注册 handler」（历史缺陷：agent-runner.ts:2468 handler 在、state 应答断、面板恒空）。
5. 补审批门的运行时验证（冒烟当前未触发）。

## 放弃什么

- 选 A：放弃已跑通的桌面路径与审批 GUI、会话浏览等最高价值产品面。
- 选 B+B1：放弃对外分发与任何「面向公众」承诺；打包不进首版。
- 两者都放弃：内核轴提案（m5 / SoL-Pi / judgment 层）进入产品首版范围——与首版不同轴。

## 推翻条件

本 ADR 应被推翻的信号：
- 出现一份真实外部用户名单或会话 JSONL ⇒ 事实 9 失效，D2 应从 B1 上修到 B2。
- 出现一条「不打包 core 链也能分发」的方案（如随包附带 tsx + 源码子集）⇒ 事实 11 失效，打包重估。

## 裁决记录（2026-10-04，业主）

**裁决**：桌面层**不作 v1 交付面**。这条是**范围裁决**，不是施工令——它说的是 v1 的验收边界，不是「删掉 `apps/desktop`」。

它撤出必修的东西（评审 `docs/review-2026-10-03-technical.md` 的桌面半）：

| 撤出 | 原严重度 | 撤出理由 |
|---|---|---|
| B3（preload 暴露 39 通道而主进程只接 6、renderer 已调未接通道） | 阻断级 | 不在 v1 交付面 ⇒ 不再阻断放行；**但作为桌面自身的缺陷仍然成立**，谁继续 M4 谁负责 |
| B4（`desktop-check` 进 GATES／`desktop-boundary-check` 进 CERT_GATES／CI 同步） | 阻断级 | 同上；「桌面不在任何根门的编译面/判卷面/CI 面」从今天起是**已裁决的状态**，不再是「文档与自动化互相矛盾」的缺陷 |
| A3（workspace 进程级全局不还原）、A4（取消单例） | 高危 | 都在 `apps/desktop`/桌面侧 IPC 面上，撤出 v1 必收清单 |
| 放行条件 4（「ADR 0001 结案」） | 阻断 | **本条由这份 ADR 的结案直接关闭**：现在放行声明可以写「认证面不含桌面面，这是决策不是漏洞」 |
| 必做项 3/4/5（冒烟接 CI、三组通道逐条接线断言、审批门运行时验证） | 采纳后必做 | 挂在「若选 B」之下；裁决为 A ⇒ 不再是 v1 必做 |

**仍然开着的两格，我没有替裁决扩大范围**：

1. **必做项 1（5 处文档与代码一致）与必做项 2（首启工作区不回落 `$HOME`）**：ADR 原文写「无论选 A 还是 B 都必须做」。
   必做项 2 的落点是 `apps/desktop/src/main/index.ts`，该文件 2026-10-04 现读仍在别的会话手里（桌面 M4-3～M4-6 正在推进），
   所以它的处置是「等让出」，不是「撤销」——尤其 S2（默认工作区＝`$HOME` 时的写向/读向暴露）在 core 侧仍然真实存在。
2. **D2（v1 受众：自用内测 B1 还是公众 B2）没有随本裁决回答**。裁决只说桌面不进 v1；
   v1 交付的是内核／CLI 那条链，它的受众与是否要求签名分发，仍是**未决**。别把这条读成已定。

**「现状事实」表未按 10-04 现读复核**（评审 G1 已点名它过期：表里写「投影 4/30、无打断入口」，而现态是 6 型含 error 且有打断按钮）。
我没有逐行重测那张表，所以**不在这里改它**——改了就是把没量过的东西写成量过。重测的判据是「逐行附复现命令」，见 G1。

- `apps/desktop` 在核心拆分（agent-runner.ts 2783 行，W4 波）完成后无法维持绿 ⇒ 方案 B 重估。
