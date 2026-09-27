# 项目全面评审报告：优点 / 缺点 / 路线发展 / 后续优化

> **出具**：2026-09-21　**性质**：只读评审，未改任何 `src` 代码、未跑门禁（环境陷阱多，见 §2.4，跑全表需 `TERM=dumb` 且注意 safe-delete 假红）。
> **快照口径**：文中所有数字均为 2026-09-21 HEAD（分支 `codex/dsh-structural-hardening`，HEAD `8f6dba1`）态快照，不回改；复跑命令随条给出。
> **事实源约定**（沿用仓规）：门数/测试数以 `scripts/gate-manifest.ts` 与 `tests/` 为准，本报告数字只作该日快照。

> **阅读前提**：§一至§六是 HEAD `8f6dba1` 的当日快照，读数不回改。同日 14:45 把其中**可重测的断言全部复跑了一遍**，
> 差异、口径问题、以及一条与其它工作项重叠的警报，集中在文末「七、同日复验与更正」「八、重叠与补条」。

---

## 一、项目是什么（一页纸）

**DSH（deepseek harness / 包名 `m0-agent-loop` v0.0.1）**：一个 Electron 桌面编程 Agent，产品卖点是「看得见的指挥」——用户像指挥官一样调度多个并行干活的 agent，每个动作以结构化卡片呈现，可点、可批、可回溯。

| 维度 | 现状 |
|---|---|
| 技术栈 | Node / TypeScript 5 / electron-vite 5 / Electron 44 / vitest 5；渲染层为**手写 vanilla**（`index.html` 单文件内联 CSS + `app.js` 纯 ESM），**无 React / Tailwind / shadcn 运行时** |
| 架构 | 事件溯源：**一条 append-only JSONL 事件流贯穿一切**（§3.1 总判据：任何「事件流之外的私有状态」= 设计错误）；M0a 内核（electron-free，可 headless 直跑）+ M0b Electron 壳 |
| 规模 | `src/` 128 个 ts/js 文件、约 2.85 万行；`tests/` 173 个测试文件（2026-09-18 快照：96 文件 / 919 passed，此后仍有增长） |
| 里程碑 | M0–M5 全收口（内核/沙箱/会话/编排/商业化/路由自适应）+ M6 已收（supervise 接线、真多 provider 价格表）；M7（economics/solpi 簇）与判断层校准**在飞** |
| 门禁 | `scripts/gate-manifest.ts` 清单 32 道门（快照值），含变异验证（mutate-verify 全表 110/110 全杀，2026-09-18 快照） |
| 商业形态 | BYOK 本地优先（key 入 safeStorage，不经第三方服务器）；macOS 官方支持（Seatbelt 沙箱）；unsigned V1 边界（无签名/公证） |


---

## 二、优点（带证据指针）

### 2.1 架构根基正：事件溯源是真纪律，不是口号

- 全系统单一事实源 = append-only JSONL 事件流；会话可重放、可分叉（forkSession 原文件字节不变）、崩溃可恢复。24+ 种事件类型有 `KNOWN_TYPES` 登记闸，旧日志重放逐字不变有测试钉住。
- 「投影层」与「事件层」分离干净：`projections.ts`（837 行纯函数）是渲染层、sidechat、多个 check 的共同读端；面板唯一数据源 = `projectPanelData(会话事件, 运行目录)`，渲染层**禁止挂演示常量**（曾因此移除假 REVIEW/终端 seeds）。
- M0a 内核不依赖 Electron，同一 `runLoop` 既服务桌面壳也服务 headless 验收脚本——这是 30+ 道 check 门能存在的前提。

### 2.2 验收文化是仓库最强的资产（业内罕见）

- **清单即事实源**：`scripts/gate-manifest.ts` 的 GATES 数组 + 孤儿脚本机械校验（任何 `*-check` 形态脚本必须进清单或显式豁免并写理由）；门数一律不写死，文档里只留「别写死」这条规矩——这是对「文档漂移」的结构性防御。
- **变异测试常态化**：`mutate-verify` 全表 110+ 条锚点「全杀」（注入行为突变必须被测试杀死），另有秒级静态预检 `mutate-needles-check` 防锚点随重构失效。大多数项目连变异测试的概念都没有，这里它是门禁的一部分。
- **判卷文件 sha256 冻结**（`scripts/frozen-sha256.json`）：改判卷 = 作弊，发现判据缺陷只能走 `BLOCKED.md` 申请换判据——评审/裁决留痕完整。
- **fail-visible / 「未证 ≠ 通过」**：三态验收表（已证/未证/留位）逐行带证据指针；9 项因联网/凭据未跑到的断言**如实标注**，并提供 `DSH_STRICT_UNVERIFIED=1` 严格模式让未证判红。降级不静默（如沙箱三门按宿主能力自动选分支 A/B 并显式打印走了哪支）。

### 2.3 成本/Token 工程有实测闭环

- 影响面上下文从逐条注入（最坏 ≈2112 token）改为文件级汇聚摘要（≈168 token，**-92%**），完整清单仍留事件字段供面板消费。
- prompt cache 断点按「只标静态段」落 Anthropic `cache_control`，且价格表新增缓存价列（12 档 null = 待联网实测校准，不编数）。
- 靶场探针（`gym-run --model probe`）首次量出**装配成本**：prompt ≈8.4KB 中可缓存前缀 ≈90%，历史仅 ~400B ⇒ 得出「短任务的钱在工具面不在历史」「单轮任务缓存断点近乎零收益」两条此前无法得出的判断；工具面拆账（`rankToolSpecs`）定位 remember/spawn_agent/lsp 占 50%。

### 2.4 多 agent 编排是完整闭环而非 Demo

spawn_agent 原语（read/write mode）→ worktree 物理隔离 → **语义合并闸**（影响面分析升级成 spawn 准入判据，glob 租约抓不到的语义波及能抓）→ 合并控制塔（证据四态）→ 崩溃恢复/卡死检测 → bandit 在线学习路由（Thompson Sampling，代价按真钱 `pricing.costUsd` 折算）→ cascade 级联升档（客观判据 only，模型自报不算，预算整链共享）。每一环都有事件落流和验收断言。

### 2.5 性能优化按实测驱动

事件落盘从「每事件 open+write+close」（1930µs）改常驻 FileHandle（9.8µs，**196×**）；scheduler 日志 23.1s → 302ms；记忆预算 O(L²)→O(L)；`selectCut` 二分；callIdIndex 有界 32；渲染层虚拟滚动 DOM ≤300 节点。每项收益都有实测数字而非推测。

### 2.6 文档即历史，诚实性制度化

`AGENTS.md` 把踩过的坑（shell grep 的 `\b` 假 0、safe-delete 假红、TERM ANSI 假红、panels-check flake 判读法）写成判读规则；过期快照**标注但不改写**（「改写即伪造历史」）；每次「两头断」（模块/事件/消费端三层齐了但写路径没接，历史上发生过 7 次）都沉淀成可达性门禁（`ipc-reachability-check` 由此诞生）。

---

## 三、缺点与风险（按严重度排序）

### 3.1 【P0·安全】权限层存在已实测复现的绕过面（未施工）

`outputs/shell-permission-bypass-2026-09-21.md`（本报告出具当天的复现报告）：四条缺陷全部实测复现，探针 `scripts/probe-shell-bypass.ts` 当前 **红 24 / 绿 9**——

1. **用户手写的 deny 规则可被包装器击穿**：`git push --force` 能被 `sudo` / `env FOO=1` / `nohup` / `timeout` / `command` / 绝对路径 `/usr/bin/git` / `bash -c '…'` / 前置环境赋值绕过——11 个变体里 9 个不进 L1-deny，其中 7 条**零提示直接放行**。根因：`matchSegment` 是裸文本前缀匹配，没有「有效二进制」解析。
2. **「总是允许」落库存整条命令字面量**，且 allow 只在 critical 级才让位——`echo hi` 点过一次总是允许，`echo hi >> ~/.zshrc` 形状的追加不再被问。
3. **重定向写面在静态威胁表里零条目**（`cat > .git/hooks/pre-commit` 类）。
4. worker 层 `interceptDestructiveGit` 与权限层同根缺陷（包装器吞参）。

修法形状已在报告里写好（`effectiveBinary` 唯一实现上提 + 带值选项表 + allow 改 argv 前缀 + 威胁表补条目，60–90 行 + 4 条变异锚点），但**截至本报告出具时未施工**。这是当前仓库最大的安全风险：权限门是整个安全模型的地基，deny 规则可绕意味着「用户显式说不」不被尊重。

### 3.2 【P0·工程】渲染层是「长大的，不是设计的」

`outputs/renderer-refactor-proposal-2026-09-19.md` 的诊断（当时基线 5936 行，现已 app.js 3837 + index.html 2302）：

- **分派靠覆写而非接口**：桥接段对原型段 7 处函数整份覆写（`send`/`selectSession`/`deleteSession`…），同一函数名两个定义，静态阅读不可判定，无编译器或门禁保证两套 DOM 契约一致。
- **状态三源分散**，无单一事实源；`index.html` 1500+ 行内联 CSS 单文件承担全部设计系统。
- 测试脆弱性：`renderer-startup.test.ts` 用 vm 跑 app.js 切片，对函数作用域是隐式依赖——已在 HEAD 上炸过一次「断言全绿但门红」。
- 好处：诊断已完成、提案已写，**欠的是施工排期**（见 §四路线）。

### 3.3 【P1·可靠性】门禁环境脆弱点仍然多

- `panels-check` 是真实 Electron + CDP 探针，宿主高负载下有实测时序 flake（同一代码三连跑：1 红 / 5 红 / 全绿）；假红主因已根治一轮，但 B2 徽标时延类残余 flake 仍靠「单跑复验」判读——**没有纳入 CI 的话，这会持续消耗信任**。
- 环境陷阱密集：safe-delete 守卫假红（需 `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR=` 逃生舱）、`TERM` ANSI 假红、沙箱内 pnpm test 不可跑、macOS 沙箱 realpath 要求。每条都有文档判读法，但**新人/新机器第一次跑全表大概率撞墙**。
- 9 项断言长期未证（testdino 远程 MCP、provider:check 真连、各 check 暗卷段）——不是缺陷，但意味着「全绿」声明永远带脚注；缓存价格表 12 档未校准（等联网实测）。

### 3.4 【P1·产品完整性】已发货能力与用户可见性之间仍有欠账

- `ipc-reachability-check` 建门时实测 **20 条 preload 桥在渲染层零入口**（能力已发货、用户点不到 = 零价值），目前以基线棘轮形式挂账（只减不增），逐条裁决归 R1c，未排期。
- 面板留位演示数据：`WORKSPACES`（工作区切换器）与 `BRANCHES`（分支列表）仍是假数据，真化需连 IPC，属 R2 范围。
- `promptCache` 开关无渲染层入口；supervise 环合并语义扩展、worker 热恢复、schedule 的 hourly/monthly kind 均留位。

### 3.5 【P2·工程卫生】并发多会话工作区的结构性风险

- 仓库历史上多次出现「拆开提交致 HEAD 悬空」（删被引用模块但 importer 改指未同提交）；AGENTS.md 为此写了「提交前相交检查」规矩。当前工作区仍有 5 个已跟踪文件的在飞 diff（judgment-layer 校准簇 + scheduler/app.js/distill）+ 55 个未跟踪项（多为 outputs/ 调研产物与探针脚本）——**在飞面大，收口纪律依赖人**。
- `agent-plan.md`（223k 字符）与 `PROGRESS.md`（235k 字符）是巨型单文件，检索与维护成本在涨；BLOCKED.md 也已 101k。

### 3.6 【P2·商业边界】V1 明确取舍（备案，非缺陷）

unsigned 包（无签名/公证，首次打开需右键→打开）、license 仅离线 Ed25519 无服务端、遥测零上报通道、官方仅 macOS（Windows/Linux 无 OS 沙箱）。这些是 P16/任务书拍板的边界，**但每一条都是 GA 前的必办项**。


---

## 四、路线发展建议（按依赖序，非愿望清单）

### 第 0 批：还安全债（本周内，阻塞一切对外分发）

1. **收口 shell 权限绕过四条**（§3.1）：修法形状已写在 `outputs/shell-permission-bypass-2026-09-21.md` 末节（`effectiveBinary` 上提为权限层与 worker 层共用的唯一实现 + 带值吞参表 + allow 落库改 argv 前缀 + 威胁表补重定向写面），自带 4 条变异锚点计划与反向对照判据。**施工前按仓规重核相交文件**（`permissions/rules.ts`、`autonomy.ts`、`risk.ts`、`worker-shell-tools.ts`、`agent-runner.ts`）。
2. **在飞改动成组提交**：当前 5 文件 diff（judgment-layer 校准簇）按「新定义位置 + 所有 importer 改指 + 配置变更」同提交原则收口，提交前用 `git worktree add <tmp> HEAD` + `tsc --noEmit` 实测 HEAD 自洽。

### 第 1 批：判断层校准（已在飞，按既有四步顺序走）

`docs/judgment-layer-calibration-proposal.md` 已定序：第 0 步 **verify 归因**（先能回答「这次红是真红还是环境红」）→ ask 落盘（§5 已实现）→ 校准阈值（概率 + 代码阈值，造出 default 与 auto 之间的连续地带）。这条线的收益不是「少问几次人」，而是让自主性可调、且阈值能被判卷。**与 §3.1 第 3 条（allow 让位阈值）是同一处取舍，必须一起裁决，别单独改。**

### 第 2 批：把「已发货但用户点不到」变成价值

3. **R1c：20 条孤儿 IPC 桥逐条裁决**——每条三选一：接 UI 入口 / 明确降为内部 API 并标注 / 删。棘轮保证只减不增，差的是一轮集中裁决。
4. **R2：WORKSPACES / BRANCHES 演示数据真化**（连 IPC），`promptCache` 设置开关上屏。

### 第 3 批：渲染层结构偿还（提案已备）

按 `outputs/renderer-refactor-proposal-2026-09-19.md` 施工：消灭 7 处覆写式分派（改注册/注入接口）、状态收单一事实源、CSS 从 1500 行单文件切令牌层（`outputs/learn-from-v0.1.6-2026-09-20.md` 已从 v0.1.6 提炼五条可落地设计语言：三层令牌命名 / 偏蓝灰中性色 / alpha 边框 / 0.5px 发丝线 / superellipse 圆角——其中前三条与重构正交，可先行）。**先加结构性门禁再动手**（renderer-arch-check 扩展），防止重构期间行为漂移。

### 第 4 批：让花钱的能力证明「划算」

5. **cascade 升档的价值实测**（m5-acceptance B5b 未证②）：`$ / 成功任务` 读数需要 M0_API_KEY 联网实测——接上 ≠ 划算，`routingCascade` 缺省关正是为此；拿到读数再决定是否转默认。
6. **缓存价格表 12 档联网校准**（`uncalibratedCachePrices()` 已把「待校准」做成可审计清单）；**gym 多轮 case 裁决**（BLOCKED 裁决 3 待拍板：新增 ≥10 轮冻结 case 或给探针加 `--long`）——现有三条 case 全是单轮，压缩/缓存/跨轮检索在靶场内一次都触发不到。

### 第 5 批：GA 前必办（V1 边界解除）

签名/公证（Apple 开发者账号）、license 服务端、opt-in 遥测上报通道、Windows/Linux 沙箱故事（审批制全开 + 只读档兜底的产品化表述）、`pnpm dist` 进 CI。

### 第 6 批：已验证「刻意不做」的（防止重启争论）

laya/JEV 类 System 1 模型接入（评估结题：锦上添花不接入，见 `outputs/laya-evaluation-2026-09-21.md`）；团队版协作（P17 留 V1.1）；electron-updater 自动安装（V1 轻量检查已够）。


---

## 五、后续优化清单（机会点，按投入产出比排序）

### 5.1 工程效率

| # | 项 | 依据 | 预期收益 |
|---|---|---|---|
| O1 | **CI 化**：`pnpm gates --direct` + `DSH_STRICT_UNVERIFIED=1` 进 CI（有凭据环境），panels-check 失败自动单跑复验一次再判红 | §3.3 flake 判读法目前全靠人 | 消除「全表跑一遍 15 分钟才知红绿」的反馈延迟；未证项在有凭据环境首次闭合 |
| O2 | panels-check B2 徽标时延断言改为「读数连续两次稳定」同款 settle（B1 已这么修过） | AGENTS.md 记载的根治方案已在 B1 验证 | 残余 flake 清零 |
| O3 | 巨型文档切片：`PROGRESS.md`（235k）按里程碑归档为 `docs/progress/m*.md`，现行段保留最近两轮 | §3.5 | 检索与 agent 上下文成本下降 |
| O4 | `orchestrator.ts`（2410 行）与 `agent-runner.ts`（2192 行）按既有 `orchestrator-config`/`orchestrator-join` 的拆分先例继续抽纯函数模块 | 仓库已证明「判据放纯函数模块才能单测」的模式有效 | 单测面扩大，diff 撞车减少 |

### 5.2 运行时/成本

| # | 项 | 依据 | 预期收益 |
|---|---|---|---|
| O5 | 工具表瘦身按 `rankToolSpecs` 实测动刀：remember 1710B / spawn_agent 1302B / lsp 778B 占工具面 50%——按会话阶段裁剪工具表面（如纯问答阶段不带 lsp） | §2.3 靶场拆账 | 短任务 prompt 直接降一档（短任务的钱 ≈90% 在工具面） |
| O6 | 事件落盘微批（32 条缓冲已在 FileHandle 层，流式 delta 段可再合并落盘） | overview.md 实测微批可再快 35× | 长流式回答磁盘 I/O 再降一个量级（注意：append-only 崩溃窗口语义需先裁决） |
| O7 | spawn 语义闸的端到端测试补齐（起真 git repo + 两个 write worker 的审批卡测，m3b 有现成 harness） | PROGRESS B1 段自陈留位 | 语义合并闸从「单测间接覆盖」升「端到端已证」 |

### 5.3 产品体验

| # | 项 | 依据 | 预期收益 |
|---|---|---|---|
| O8 | 设计令牌三层化（static→alias→specific）+ 0.5px 发丝线 + alpha 边框 | learn-from-v0.1.6 已验证五条原则可落地（当时 build/门禁/测试全过） | 观感升档且为渲染层重构铺底 |
| O9 | sidechat/审批/记忆等「后端早就在、渲染层零入口」的能力上屏节奏表 | 96ef76f、eaaa748 等提交证明单点上屏模式已跑通 | 已付开发成本的能力开始兑现用户价值 |
| O10 | 新手引导增加「第一次并行编排」引导（当前只覆盖设置七组） | 卖点是「看得见的指挥」，但引导不教指挥 | 核心卖点的激活率 |

---

## 六、总评

**这是一个工程纪律显著高于平均水平的项目**：事件溯源架构被真正贯彻（不是装饰）、变异测试和冻结判卷把「测试真实性」当一等公民、成本优化有实测闭环、「未证 ≠ 通过」的诚实性制度化。它最大的风险不在架构而在三处：**权限层的包装器绕过（已复现未修）**、**渲染层的结构性欠账（已诊断未施工）**、**以及大量已发货能力与用户可见性之间的最后一跳**。三处的共同点令人乐观——诊断、修法、判据全部写好了，欠的只是排期。建议路线：先还安全债（第 0 批），判断层校准与渲染层重构并行（第 1/3 批），GA 边界最后解（第 5 批）。

> **本报告未证边界**：未跑门禁（只读评审）；`tests/` 173 文件为文件计数，非全量运行读数；§3.1 探针红绿数以该报告落笔时为准（`pnpm exec tsx scripts/probe-shell-bypass.ts` 可复跑）。

---

## 七、同日复验与更正（14:45、HEAD `acbdd7c`；不回改上文）

| 报告断言 | 报告值 | 复测值 | 判读 |
|---|---|---|---|
| §一 规模 | `src/` 128 文件 / 约 2.85 万行 | 128 文件 / `.ts` 28161 + `.js` 4151 = **32312** | **口径混用**：文件数含 `.js`、行数只算 `.ts`。补口径即自洽，量级没错 |
| §一 测试数 | `tests/` 173 | **174** | 在飞新增 +1，非回归 |
| §一 门数 | 清单 32 道（快照值） | **32**（`gate-manifest` 的 `GATES.length`） | 一致 |
| §3.2 渲染层 | app.js 3837 / index.html 2302 | **3840** / 2302 | 在飞 +3 行，诊断结论不受影响 |
| §一 `projections.ts` 837 行 | 837 | **837** ✓ | — |
| O4 `orchestrator.ts` 2410 / `agent-runner.ts` 2192 | 同 | **2410 / 2192** ✓ | O4 仍准确 |
| §3.5 巨型文档 223k / 235k / 101k | 同 | **223451 / 234884 / 101215 B** ✓ | — |
| §3.5 在飞面 | 5 个已跟踪 + 55 未跟踪 | **2 个已跟踪**（judgment 提案页、`memory/distill.ts`）+ 51 未跟踪 | **第 0 批第 2 条部分完成**：scheduler / app.js / mutate-verify 簇已入库（`0a7dcb2`、`0ff209e`、`92ad7ee`、`acbdd7c`），judgment 簇与 distill 仍在飞 |
| §3.1 探针 | 红 24 / 绿 9 | **红 24 / 绿 9** | 四条缺陷**未施工**，读数一字未变 |
| §2.6 「两头断 7 次」 | 7 | 记忆侧记到**第 9 次** | 报告低报 2 次。这类计数本就不该写死进任何文档（仓规：以机器面为准） |
| §3.4 孤儿 IPC 桥 | 20 条（建门时实测） | **4 条**（`ipc-reachability-check` 基线，全是 `agent:sidechat-*`）；该门复跑退出码 0 | 棘轮是双向的（新增红、接上没删基线也红），门绿 ⇒ 基线 = 现值。**报告那句「建门时 20 条」仍是真历史**，但现行挂账只剩 4 ⇒ §四第 2 批第 3 条的量已从「20 条逐条裁决」缩到「4 条 sidechat 桥」，**R1c 已大半完成** |

**复跑命令**（除最后一条外全部只读）：`wc -c AGENTS.md PROGRESS.md BLOCKED.md agent-plan.md`、
`find src -name '*.ts' -o -name '*.js'`、`node_modules/.bin/tsx -e "import('./scripts/gate-manifest.ts').then(m=>console.log(m.GATES.length))"`、
`pnpm exec tsx scripts/probe-shell-bypass.ts`、`git diff HEAD --name-only`、
`node -e "console.log(require('./scripts/ipc-reachability-check-baseline.json').orphans.length)"`。
本轮**未跑全表 `pnpm gates`**——「未跑门禁」这条边界只有一处收窄：单跑了 `pnpm ipc:check`（退出码 0，
分支 A 靶子修复全断言通过），其余门未动。

## 八、重叠与补条

**1. 【重叠警报】O3 与已立任务 #1 是同一件事，别各做一遍。**
O3 提议「`PROGRESS.md` 按里程碑归档、现行段保留最近两轮」，而分支 `doc-layer-migration` 已经做过
`PROGRESS.md`/`BLOCKED.md` → `archive/` + 新建 `STATE.md`（L1 现态整体重写），并已立独立任务收口
（任务 #1，含基线 `fc531e5` / 主树 +171 提交 / 3 文件冲突与验收判据）。两笔并行 = 本仓反复点名的
「同一条能力两个入口」。**顺序：先合迁移任务 #1，O3 只保留迁移没覆盖的面（`agent-plan.md` 223k 不在其范围内）再单议。**

**2. 【新增硬约束】往 `AGENTS.md` 加规矩前必须先量字节。**
D-1 的存量豁免水位 = **30_000B**，现态 **27094B** ⇒ **只剩约 3KB 追注余量**；豁免理由原文是
「spec §8 迁移提交须整条删除（届时 >8000B 即红）」。⇒ 在迁移合入前，任何 L0 追注都可能把 docs-check 顶红，
而红的根因是「迁移没做」，不是那条追注。§3.5 与 O3 的处置都受这条约束。

**3. 【路线补条】同日另一份评估没进本报告，其六条形状中有三条正对本报告的缺点。**
`outputs/zcode-study-2026-09-21.md`（外部同类 harness 的形状评估，含否掉项与理由）：
- `alwaysAsk`（工具级「任何宽松档都要问」）＝ **第 1 批「造中间档」的工具级实现**，比在会话档位上加档便宜，
  且直接对 §3.1 第 2 条那个「allow 只让位 critical」的取舍——报告说这条必须与判断层一起裁决，`alwaysAsk` 正是
  能单独落地的那半（它不放宽任何既允许）。
- **影子重放守恒对账门**（含「可寻址性守恒」：每个已发布动作必须被同一次冷物化的 resolver 精确命中）
  ＝ §3.3「门全绿而产品坏着」与 §3.4「点了真不生效」那两簇的**系统性捕网**，比逐条补判据划算。
- **工具契约声明化**（`sideEffectScope` / `patternSources` 由工具声明、缺席按最保守）
  ＝ §3.5「在飞簇反复出的名字表副本」的结构解：把权限层自持的两份工具名表变成编译期必填字段。

**4. 【形状统一】** 本报告与同日另三份同为 dated 档案页（`outputs/zcode-study-2026-09-21.md`、
`outputs/shell-permission-bypass-2026-09-21.md`、`outputs/laya-evaluation-2026-09-21.md`）：
顶部标基线与「不回改」声明、文末带复验与更正、不采纳项一律给理由 + 证据 + 反转条件。

