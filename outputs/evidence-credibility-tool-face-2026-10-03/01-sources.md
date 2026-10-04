# 来源可信度登记表 · 2026-10-03

> 职责：研究证据综合（证据可信度与来源）。只做分析评审，不改任何代码。
> 本文件登记**每条被引用主张的来源、日期、一手/二手、适用范围与不可外推边界**。
> 结论正文见 `02-conclusions.md`。

## 0. 检索执行声明

- **已执行**：本地文件实读（路径与行号逐条给在下方）、外部 `advanced_search` / `web_fetch`。
- **未执行**：任何代码修改、任何实测跑批、laya 在本机的安装与调用、npm/PyPI 安装验证。
  凡「未执行」项在表中显式标注，不得当作已证。
- 引擎可用性：`exa` 在本轮全程 429（配额）；`bing` 间歇性 unknown error，多次检索降级为 tavily 单引擎。
  ⇒ **本轮跨引擎交叉验证的实际强度低于计划**，下表已按实际命中引擎标注。
- 检索中出现的无关结果（LayaAir 3D 引擎、Windows 音频帮助、Teams 深链文档）与本题无关，已剔除，
  但保留此说明以免被当作「检索到但忽略」。

## A. 一手来源（可直接引用）

| # | 主张 | 来源 | 日期 | 取值/定位 | 适用范围 | 备注 |
|---|---|---|---|---|---|---|
| A1 | 工具检索把 MCP 工具选择准确率从 13.62% 提到 43.13%，prompt token 降 >50% | arXiv [2505.03275](https://arxiv.org/abs/2505.03275) 摘要（Gan & Sun） | 2025-05-06 提交 | 摘要原文 | 学术基准 + MCP 压力测试 | 作者自测；未见第三方复现 |
| A2 | Tool Search Tool 官方触发线：工具定义 >10k token **或** 10+ 把工具；收益是准确率而非只省钱 | Anthropic《Introducing advanced tool use》 | 2025-11-24 | 「When to use the Tool Search Tool」节 | Claude Developer Platform 内部评测 | 官方文档，含其自身局限声明 |
| A3 | Opus 4 MCP 评测 49%→74%；Opus 4.5 79.5%→88.1%；上下文由 ~77K token 降到 ~8.7K（省 85%） | 同上 A2 | 同上 | 「Our solution」节 | 同上 | **厂商内部评测，非同行评审**，作一手厂商声明引用 |
| A4 | `defer_loading` 的延迟工具**不进初始 prompt**，故不破坏 prompt caching | 同上 A2 | 同上 | 「Prompt caching note」段 | 同上 | 与本仓「可缓存前缀 = 首条 system + 工具面」口径**方向一致**，见 C1 |
| A5 | 工具定义爆炸的真实量级：5 个 server 58 把工具 ≈55K token；Anthropic 自身见过 134K token | 同上 A2 | 同上 | 「The challenge」节 | 同上 | |
| A6 | 渐进披露按需装载 3–5 把工具 ≈3K token 而非 72K | 同上 A2 | 同上 | 「Our solution」节 | 同上 | |
| A7 | 内在自我纠错（无外部反馈）不能提升推理，**有时性能反而下降** | arXiv [2310.01798](https://arxiv.org/abs/2310.01798)（Huang, Chen, Mishra, Zheng, Yu, Song, Zhou），ICLR 2024 | v1 2023-10-03；v2 2024-03-14 | 摘要原文 | 推理任务，**受限自我纠错（intrinsic）** | 同行评审；**是 Q2 的直接反证** |
| A8 | LLM 评估者能识别自己的输出并系统性给更高分（self-preference），且自我识别能力与偏好强度线性相关 | arXiv [2404.13076](https://arxiv.org/abs/2404.13076)（Panickssery, Bowman, Feng），NeurIPS 2024 | 2024-04-15 | 摘要原文 | LLM-as-judge / 自评自判 | 同行评审；**是「被约束方自评自判」的直接反证** |
| A9 | 函数调用对**函数文档格式**敏感：JSON > Python > XML；对**返回格式**敏感：Python/JSON > XML；加 `<TOOLCALL>` 包裹普遍略降 | Berkeley BFCL V4 · Format Sensitivity（Mao, Li, Wu, Patil, Gonzalez） | 发布 2025-07-17，更新 2025-07-20 | §4.1/§4.2/§4.3；39 个模型、26 种配置 × 200 用例 | 单轮 simple/multiple/parallel | 一手基准；**与本题的关系：工具面「怎么呈现」与「给几把」同等重要** |
| A10 | 提示词换写成 markdown/改写语气**无一致趋势**（模型对此稳健） | 同上 A9 | 同上 | §4.4 | 同上 | **部分是 Q2 的反证**：事后措辞约束的边际收益可能很小 |
| A11 | laya 官方定位与形态：非自回归 System 1 决策引擎，单次前向 33ms，choice / score / noul 三类类型化问题，无文本生成、无可解析失败面 | laya README（raw.githubusercontent.com/NandhaKishorM/laya/main/README.md） | 抓取于 2026-10-03 | 「What's new in 0.3.24」与基准节 | 官方仓库 README（自述） | **权威版本已从简报的 v0.3.4 推进到 0.3.24** |
| A12 | `choice` 是**单选语义**（返回单一标签），非多标签 | 同上 A11 | 同上 | 示例 `result["answers"]["department"]["choice"]  # billing` | 核心 API | 用户 Q4 的硬约束由此确立 |
| A13 | 高基数选项**精度崩塌**：Banking77 77 标签 0.425（Jev 0.870）；官方解释为 `head_max_len` 预算被选项摊薄，每标签仅 ~3–4 token | 同上 A11 | 同上 | 「Where Jev leads」节 + 「Honest limits」表 | 单问选项数 ≳20 | **官方自认**，非第三方批评 |
| A14 | 存在 `predict_shortlist` / `laya_shortlist`：用**编码器自身嵌入**做相似度 top-k 短名单，再单次前向定答案；>20 选项的工具护栏指向它 | 同上 A11 | 同上 | MCP 节 + 「Honest limits」 | 高基数选择 | **这是「检索 + 排序」形状的原生对应物**，是 laya 唯一能承接工具选择的形态 |
| A15 | 短名单收益**未经仓库复测**：issue #102 报告 BANKING77 top-20 从 54.3% 到 60.8%，且「Those figures are the reporter's; this repository has not remeasured them」 | 同上 A11 | 同上 | 「Honest limits」原话 | 同上 | **必须按二手/未复测处理**，不得当作已证收益 |
| A16 | 基础 checkpoint **零样本低于多数类基线**（0.362 / 0.352 vs 多数类 0.461）；0.766 全部来自在基准自身训练集上微调 | 同上 A11 | 同上 | 「typed-decisions, measured on all three checkpoints」表 + 「Honest limits」 | 领域内类型化决策 | **「直接零样本用」的路径被官方数据否掉** |
| A17 | `noul` 会跟着**选项标签**而非状态走（英文 checkpoint 尤甚）；`score` 在 multilingual 上存在位置偏差；`action.act_probability` 无可信信号（AUROC 0.30） | 同上 A11 | 同上 | 「Honest limits」 | 三类原语 | 原语级可靠性缺口，官方自述 |
| A18 | 提示注入检测能力：英文 0.698 / multilingual 0.578（held-out, n=116） | 同上 A11 | 同上 | 「English tasks」表 | 判别式注入检测 | **若要 laya 读工具描述，它会读攻击者可控文本** —— 相关但未在本任务中评估 |
| A19 | 上下文与形态：`laya` 512 / `multilingual` 1024（`max_len=8192` 可扩）/ `typed-decisions` 1024；`multilingual` **出厂不带拟合温度**，用其概率前须自行拟合 | 同上 A11 | 同上 | 「Three checkpoints」表 + 「Calibration」节 + 长文档 Quickstart 提示 | 部署前必读 | 仅 `multilingual` 支持 8192；长文本准确率官方标注「beyond that results vary (8 to 17 of 20)」 |
| A20 | 官方现提供 TS/Node/browser 路径 `laya-ts/`，npm 包名 `laya-ts`，由 `laya-ts-v*` 标签发布 | 同上 A11 | 同上 | 「Installation」节 | 分发形态 | **README 自述**；npm 注册页本轮 403 未能独立核验（见 B5） |
| A21 | 官方现提供 ONNX 导出与量化：`laya[onnx]`、`scripts/export_onnx.py --quantize`、`laya-evals run --onnx`；另有 TileLang GPU 快速路径 `laya[fast]` | 同上 A11 | 同上 | 「Installation」节 + 「What's new in 0.3.21」 | 推理路径 | **直接推翻旧结题「等官方 ONNX/量化导出」的未满足状态** |
| A22 | 官方提供 MCP stdio server（`laya-mcp-server`）与 HTTP server（`laya[serve]`），工具含 `laya_predict` / `laya_route` / `laya_decide` / `laya_shortlist` 等 | 同上 A11 | 同上 | MCP 节 | 与 DSH 的对接形态 | 意味着不必自写 Python sidecar 协议，**但仍是 Python 运行时**（见 B3） |

## B. 二手来源（转述/摘要，仅作旁证）

| # | 主张 | 来源 | 日期 | 一手出处 | 为何仅作旁证 |
|---|---|---|---|---|---|
| B1 | 「Anthropic 的 RAG-MCP 显示 13%→43%」 | Red Hat Emerging Technologies 博客 | 2025-11-26 | A1 | **署名错误**：RAG-MCP 作者是 Gan & Sun，与 Anthropic 无关。**正是「同源转述 + 归属错误」的活样本** |
| B2 | 「引入语义相关干扰函数会显著降低函数调用准确率」 | EmergentMind 主题页《BFCL v4》 | 页脚 2026-02-10 更新 | 未能定位一手出处（BFCL 博客页 18 返回 404） | 二手聚合，且一手未定位 ⇒ **本报告不据此下结论**，登记为缺口 |
| B3 | laya 需要 Python 3.10+ / torch 2.14 / transformers 5.x；421M 参数权重 | A11 自述 + 外部博客（知乎/CSDN/AI 工具集等） | 2026-09-22~23 | A11 | 技术栈结论**以 A11 为准**；中文博客仅印证「热度与时间线」，且存在 CSDN/AI 工具集等聚合站，**不计为独立验证** |
| B4 | 「Laya 比 Jev 快 6–7×」「ECE 0.466→0.081」 | 中文博客（知乎/CSDN） | 2026-09-22~23 | A11（官方基准节亦有） | 与 A11 同源（都源于项目自测）⇒ **不构成独立交叉验证** |
| B5 | `laya-ts` npm 包存在且已发布 | 检索摘要 + A11 自述 | — | A11 | npmjs.com 本轮 **HTTP 403**，未能独立核验版本与是否携带权重 |

## C. 本地一手（本仓实读，可复跑定位）

| # | 主张 | 路径:行 | 性质 |
|---|---|---|---|
| C1 | 可缓存前缀**字面包含工具面**：`cacheableFace` = 首条 system + tools；工具面一变即重写该层 | `src/agent/prefix-churn.ts:20-25` | 代码实读 |
| C2 | 工具面变化**必须点名**，否则违规（PC3） | `src/agent/prefix-churn.ts:120-137` | 代码实读 |
| C3 | 同时超帽时装配必须**逐字确定**（PC4），因为抖动本身不免费 | `src/agent/prefix-churn.ts:139-148` | 代码实读 |
| C4 | 既有降配梯：先压非 core 描述到 600 字符，再从**尾部**整条丢；**core 永不自动砍**，走完仍超则 `unresolvable` 报红交人裁 | `src/agent/model-surface.ts:134-201` | 代码实读 |
| C5 | 总帽 24,000 字符；单位是**字符**（中文按 chars/4 会低估 3–4 倍） | `src/agent/model-surface.ts:17-21`；`outputs/model-surface-budget-2026-09-23/01-装配账读数.md` §单位说明 | 代码+读数 |
| C6 | 缺省档固定面 9,721 B / **7,067 字符**，其中工具面占 **90.5% 字符**（13 把） | `outputs/model-surface-budget-2026-09-23/01-装配账读数.md` §1 | 本仓实跑读数（可复跑 `pnpm model-surface-check`） |
| C7 | MCP 追加斜率：单 server 25 工具 → +178%；三 server 各 20 → +427%；四话痨 80 工具 → +2,279%（194,569 B） | 同上 §3 | 本仓合成靶面实测 |
| C8 | 该窗口内**未命中即整段归零**（命中均值 86.6%，未命中 0%），且我们这侧装配基本 append-only（p50 Δuncached = 86 tok） | `outputs/prefix-churn-2026-09-23/00-实测发现.md` §1–2 | 本仓实跑读数 |
| C9 | **`src/`、`docs/` 无 `tool_search` / `deferred tool` / 动态工具筛选任何命中**（本轮独立复跑，0 命中） | grep 全仓 `*.ts` | 已复核主理人结论 |
| C10 | 第一方工具模块 **30 个** | `ls src/tools/` | 已复核 |
| C11 | 既有 `sessionToolFace` 在**合法**情形下变工具面并带 `note`（skill 摘除 / MCP 装载 / `automationTools` 开关） | `src/main/agent-runner.ts:697-728` | 代码实读 |
| C12 | 降配梯已实际接线（`coreNames` 由 `gateToolSpecs()` 派生，不另抄一份清单） | `src/agent/glm-session.ts:42-52, 832` | 代码实读 |
| C13 | 知识沉淀闭环已存在：`distill.ts`（沉淀轮，白名单只允许 `remember`）+ `lessons.ts`（带**证据指针 callId**的失败教训，无指针不出条目）+ `inject.ts` | `src/agent/memory/{distill,lessons,inject,store}.ts` | 代码实读 |
| C14 | skill 是**按需加载的说明文本**，路由清单常驻但有独立预算 1,536 字符、超限显式回显 | `src/agent/plugins/skills.ts:11, 143-155` | 代码实读 |
| C15 | 旧结题全文（三条否决理由、试点实测、`0.2985` 阈值读数、复评触发条件 1–3） | `outputs/laya-evaluation-2026-09-21.md` | 文档实读 |
| C16 | 判断层路线明文「只迁理念，不接模型」 | `docs/judgment-layer-calibration-proposal.md`（旧结题 §七 指明第 4 步与裁决段） | 文档实读（经旧结题指引） |

## D. 冲突与过时项（本轮核实结论）

| # | 项 | 旧口径（C15） | 现行口径（A11，2026-10-03 抓取） | 判定 |
|---|---|---|---|---|
| D1 | 版本 | pip v0.3.4 | **0.3.24**（README「What's new」链至 0.3.24） | **过时**。旧结题的读数对应 0.3.4，不可直接当现行值 |
| D2 | TS/Node 路径 | 「TS 侧使用必须常驻 Python sidecar」 | 官方有 `laya-ts/` 与 npm `laya-ts`（A20） | **部分过时**。README 自述存在 TS 路径；但 **README 未说明 laya-ts 是否避开 Python 或是否携带权重**，且 B5 未能独立核验 ⇒ 结论只能到「可能缓解」 |
| D3 | ONNX/量化 | 「等官方 ONNX/量化导出」列为**未满足**的复评触发条件 | 官方已有 `laya[onnx]` + `--quantize` + ONNX 评测路径（A21） | **过时**。触发条件 2 的「免除 Python sidecar」半条已满足、半条（权重 <200MB）未核 |
| D4 | 上下文容量 | 512 / 1024 | 512 / 1024，**但 multilingual 可 `max_len=8192`**；且官方给出「长文 16–18/20 正确（≤4000 token），更长为 8–17/20」 | **补充**。容量不再是硬墙，但长文准确率**不稳定**是官方自认 |
| D5 | 端口形态 | 自建 `scripts/laya-sidecar.py` stdio 协议 | 官方已内置 MCP stdio + HTTP server（A22） | **过时（利好）**。协议层不必自研，维护面缩小 |
| D6 | 「能力重叠」理由 ③ | `routing/policy.ts` + bandit 已解决 laya Router 同款问题，不该重复建设 | 仍成立：本轮未发现 `routing/` 有工具面能力 | **仍成立** |
| D7 | 「架构摩擦」理由 ② | laya 决策须落事件流，等于新增事件类型走门禁 | 仍成立，且**本轮新增一条更强的摩擦**：C1–C3 显示工具面本身就长在可缓存前缀里 | **仍成立且加重** |
| D8 | 「语言栈错位」理由 ① | 纯 TS/Node 自研，引入 Python 运行时 + ~1GB 权重 | **部分松动**：官方有 TS 包与 ONNX 路径；Python 3.10+/torch/transformers 依赖（A11）与 ~1GB 权重（C15 实测 38 文件 1GB+）仍在 | **部分过时**，扣分但未清零 |
| D9 | 中文/混合文本判分质量 | 「全部候选共依赖的未验证假设」（C15 §5.3） | **仍未验证**：A11 新增了中文基准（飞书式职场决策、中文短指令路由）但其入参是「能否用」，非「判分一致率」 | **缺口仍在**，且**本任务未执行任何实测** |
| D10 | 命名登记 | 简报称 laya 为「本地决策模型 laya」 | A11 自述「non-autoregressive System 1 decision engine」，HuggingFace 组织为 `convaiinnovations` | 无冲突，但注意检索中存在同名 **LayaAir** 3D 引擎噪声，引用时须带仓库/组织名 |
