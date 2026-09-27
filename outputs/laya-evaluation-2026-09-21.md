# laya 接入评估与试点结题（2026-09-21）

> **结论先行**：laya 定位为**锦上添花，不是必需品**——不接入生产热路径。试点代码已全部清除，
> typecheck HEAD 态干净（归因报告确认剩余报错均为在飞草稿 `sidebar-probe.ts` 的既有问题），
> 相关测试 4 文件 31 用例全过。本文沉淀评估结论与试点实测数据，供未来复评时取用，**不构成接线依据**。

> **阅读前提**：§一至§四是 2026-09-21 试点**当日快照**，其中读数不回改（改写即伪造历史）；
> 同日复验发现的过期项与判据写法更正，集中记在文末「七、复验与更正」。

## 一、laya 是什么

[NandhaKishorM/laya](https://github.com/NandhaKishorM/laya)（pip 包 `laya` v0.3.4）：多语言、非自回归的
System 1 决策引擎。对任意状态（文本/邮件/JSON）回答**类型化问题**（choice / score / noul），
单次前向传播出结构化答案（T4 上单问 33ms、批量 7.2ms/问），无文本生成、无可解析失败面。

- 三个 checkpoint + Router 自动分发：`laya`（ModernBERT-large 421M / 512 ctx / 英文）、
  `laya-multilingual`（mmBERT-base 322M / 1024 ctx / 100+ 语言）、`laya-typed-decisions`（421M / 1024 ctx）
- 纯 Python 库（torch + transformers），TS 侧使用必须常驻 Python sidecar
- 本地权重合计 ~1GB+（`~/.cache/huggingface/hub/models--convaiinnovations--laya`）

## 二、适合度评估（试点前结论）

**契合点**（都是「用 <10ms noul 代替一次 LLM 轮」的省钱分诊）：

| 接入点 | 现状痛点 | laya 方案 |
|---|---|---|
| 记忆沉淀闸门（`memory/distill.ts`） | 每次会话结束跑一轮 LLM 判「有无值得沉淀」，多数答案是「无」 | noul 预筛，判无直接跳过沉淀轮 |
| 安全审查预筛（`security/llm-review.ts`） | 全量 diff 都送 LLM 两段流水 | noul 分诊无关 diff |
| 审批紧急度（§11） | 审批卡片无优先级 | score 打分排序 |
| sidechat 澄清判定 | 每次澄清动用 LLM | choice 判「澄清还是直接做」 |

**不契合点**（为什么最终定为锦上添花）：

1. **语言栈错位**：DSH 纯 TS/Node 从零自研（决策 #2/#4），laya 引入 Python 运行时 + ~1GB 权重，
   对 BYOK 本地优先桌面产品是显著的分发与维护负担
2. **架构摩擦**：laya 决策须落事件流（§3.1「事件流外私有状态 = 设计错误」），等于新增事件类型走门禁
3. **能力重叠**：`routing/policy.ts`（tier 表 + bandit Thompson Sampling）已解决 laya Router 同款问题，不该重复建设

**收益量级的诚实账**：distill 每会话只跑**一次**，省的是一轮低成本 LLM 调用；
安全审查有静态快筛在前，laya 插进去是第三道。单会话节省以「分」计——这是「锦上添花」定性的直接依据。

## 三、试点做了什么（已清除，留档）

试点范围 = 最小闭环：distill 前置 noul 预筛，失败显式降级回原 LLM 路径（fail-visible）。

| 试点产物（均已删除） | 内容 |
|---|---|
| `scripts/laya-sidecar.py` | stdio 行分隔 JSON sidecar（`ping`/`screen`），lazy 加载 Router，输入截 4096 字符 |
| `src/agent/memory/laya.ts` | 单例 spawn 管理器：请求排队串行、超时/崩溃重建、一切失败显式 `ok:false` |
| `distill.ts` 预筛分支 | projectContext + failureDigest 拼接为预筛输入（截 20k），判无 → `no_content`；失败 → 留痕后照走原路径 |
| `LayaScreenEvent` | `laya_screen` 事件（where/worth/score/error），判与败都落流可审计 |

**设计要点**（复评时仍适用）：
- **失败 ≠ 无价值**：sidecar 缺席/超时/异常一律显式降级走原 LLM 路径并落事件留痕，绝不静默判无——与 DSH fail-visible 纪律对齐
- **事件流纪律**：预筛的判与败都必须落 `laya_screen` 事件，否则违反 §3.1
- **sidecar 生命周期**：随会话生灭（finally 回收），python 解释器经 `LAYA_PYTHON` 环境变量可覆盖
- **阈值留痕调参**：noul 原始分数落事件，跑真实会话拿数据再调 0.5 阈值，不改代码结构

## 四、试点实测数据

| 实测项 | 结果 |
|---|---|
| sidecar 协议 | `ping`（ready:false）/ 空文本（直接判无不烧模型）/ 真实文本三条响应正确 |
| 英文偏好类文本 noul 分数 | **0.2985**（<0.5 判无价值）⇒ 阈值偏严，会把「用户偏好」误判为不值得沉淀 |
| 权重下载 | 38 文件 ~1GB+，无 HF_TOKEN 限速约 8 分钟；完成后秒级加载 |
| typecheck（试点时） | 本次改动文件全绿；剩余报错为 `sidebar-probe.ts`/`sidechat.ts` 既有问题 |
| 相关测试（试点时） | 3 文件 14 用例全过 |
| 未验证 | 真实会话端到端触发（含冷启动首次加载数十秒）——试点清除前未跑到这一步 |

**0.2985 这个数值得记**：说明 laya noul 对「值得沉淀的判断」口径偏保守，若复评须先在真实会话日志上
校准阈值，否则预筛会把高价值沉淀（用户偏好/纠正）整体漏掉——那不是省钱，是静默降智。

## 五、复评清单（2026-09-21 补充：六轮讨论收敛的候选用法全表）

> 试点清除后经六轮讨论重新定位：laya 的强项不是「替代 LLM 判断」（DSH 的封闭集合判断几乎全是
> 不容错、需可解释的安全/权限/路由面，属确定性代码），而是「承受 LLM 承受不了的频率」——
> 33ms/次、零 token 成本、可并发。按此视角收敛出下列候选，**均已论证、均未实现**。

### 5.1 候选总表（按价值排序）

| # | 用法 | 位置 | 形状 | 频率 | 错误模式 | 判定 |
|---|---|---|---|---|---|---|
| ⑤ | **tool_result 注入筛查** | 工具结果进上下文前 | noul：「是否含指挥 agent 的指令性内容？」 | 每条 tool_result（高） | 漏报=现状不变；误报=多一次 LLM 复核 → **只会更安全** | **最佳候选**。语义级注入（无控制标签的自然语言指令）现有 `escapeControlTags`/`redactSecrets` 防不住，laya 与现防线叠加而非替换；multilingual 版可抓中文注入 |
| ④ | **记忆注入相关性排序** | `memory/inject.ts` 组装上下文时 | choice：候选记忆 × 当前任务打相关分，token 预算内按分排序注入 | 每回合 × N 条候选（高） | 丢一条记忆，下轮还有 → 温和 | **提质复利**：同样的预算注入更相关的记忆，每轮上下文质量都变好。前置：先验证中文记忆条目的判分质量 |
| ② | **gym 自动判分器** | `src/agent/gym/`（case/score/runner） | noul/choice：case 过没过、失败归类、回归是否复现 | 每评测轮 × 几十 case（最高） | 离线场景，判错只影响评测效率 | **第一块试金石**：离线零风险、效果可量化（与现有判分的一致率）、同时回答「laya 中文判分靠不靠谱」这一全部候选共依赖的未知数 |
| ③ | **bandit reward 信号** | `routing/policy.ts` bandit 学习上下文 | score：每轮产出廉价质量分当密集 reward | 每轮 | 学慢一点 → 天然容错 | 依附②的成熟度；现状 reward 只能取 verify 终态（太稀疏），laya 可加速收敛 |
| ⑥ | **工具/技能呈现排序**（不打折） | 工具表组装时 | choice：任务文本 × 候选 skill/工具打相关分，高分排前 | 每任务 × 几十候选 | 全表保留，判错=顺序没帮上忙 → **严格不劣于现状** | 与「laya 决定给什么工具」相对：**裁剪工具表 ❌**（该用工具不在桌面=任务失败且难诊断，与 stage 白名单/斜杠命令等确定性契约冲突），**仅重排 ✅**（few-shot 位置效应是成熟优化方向，插件增长后工具表变长时价值显现） |
| ① | 事件流实时分诊 | 事件流消费者 | assistant 偏离计划分 / 工具输出失败聚类 / worker 进度信号 | 每事件（最高） | 晚发现 | 新能力但**要动事件流消费架构**，等②验证判分质量后再评估 |
| — | distill/审查预筛（试点） | 已清除 | noul 分诊 | 每会话 1-2 次 | 漏沉淀/漏审查（不可降级） | 维持不接入：收益以「分」计且失败模式不可降级 |

### 5.2 已否决的方向（留档防回潮）

- **laya 决定给什么 skill/工具/插件（裁剪工具表）**：错误模式最贵（任务静默失败）+ 与确定性契约（stage 白名单、promote 斜杠命令）冲突 + 输入面（只见任务文本）撑不起决策的信息需求。仅⑥的「重排不打折」变体成立。
- **A 类确定性判断换 laya**（风险分级 THREAT_TABLE / 权限裁决 / 档位路由 / 压缩触发 / prune / goal 停止 / join 状态机）：全部维持现状。`risk.ts` 头注「不做 LLM 风险分析器 V1（§11.7.4 拍板）」——该决定已拍板过一次。
- **用户显式指令过模型**：`/plan`、pin 档位等用户意志直达，概率层不得插在中间。

### 5.3 共同前置：判分质量未知数

全部候选共依赖一个未验证的假设：**laya 对中文/混合文本的类型化判断足够可靠**。
试点唯一实测数据点（英文偏好类文本 noul=0.2985）提示其口径偏保守。因此任何复评的第一步都是
**离线评测脚本**：拿真实会话日志 / gym case 离线跑 laya，量化各候选点上与基准（人工标注或现有
确定性判分）的一致率——数据过关再谈接线，不过关则归档。

### 5.4 原复评触发条件（仍有效）

1. distill/审查的 LLM 成本在账面（`economics.ts`/metering）上被证实为可感知负担
2. laya 出现官方 ONNX/量化导出或 TS 推理路径，权重 <200MB，免除 Python sidecar
3. 出现**高频**分诊场景（每轮多次而非每会话一次），使 <10ms 预筛的收益从「分」变「元」

## 六、环境残留（无害，可留可清）

- Python venv：`~/.venv`（laya + torch + transformers，~2GB 磁盘）
- 模型权重：`~/.cache/huggingface/hub/models--convaiinnovations--laya`（~1GB+）
- 仓库内无任何 laya 残留（全仓 grep 确认）；试点两文件已删，三处源文件改动已逐字还原

## 七、复验与更正（同日追注，不回改上文）

基线：本文追注于 2026-09-21、HEAD `8f6dba1`。前六节的当日读数原样保留。

**1. 「全仓 grep 确认零残留」这句的判据写法不成立，但结论成立。**
裸 `grep -i laya` 实测 13 命中，其中 **10 处在 `fixtures/todo-app/node_modules` 里**
（8 行文本子串：`displayable`、`malayalam`、`displayAnnotations` 都含 `laya`；另 2 个二进制文件匹配）。
按 AGENTS.md 的扫描纪律改用词边界重测——命令行用 `-w`，不用 `\b`（BSD grep 不支持且静默返回空）：

```sh
grep -rniw "laya" src scripts tests fixtures --exclude-dir=node_modules   # 代码面 0 命中
grep -rniw "laya" docs                                                   # 3 处提及
```

文档面那 3 处在 `docs/judgment-layer-calibration-proposal.md`（第 4 步与裁决段），属**引用**不属残留。

**2. §四表里「剩余报错为 `sidebar-probe.ts`/`sidechat.ts` 既有问题」，今日只剩前者。**
复跑 `pnpm typecheck`，归因行为「HEAD 内 0 个 / 未跟踪草稿 1 个」，报错全在 `scripts/sidebar-probe.ts`。
⇒ 属过期读数，不是当时写错；引用本节前先看这条。

**3. 两个用例计数并存，且都不可当现行值。**
「4 文件 31 用例」（结论先行段）是结题时点，「3 文件 14 用例」（§四表，已自标「试点时」）是试点时点，
不是同一批。试点清除后无从复测，两值各按当时保留。⚠️ 二者**都不**是现行测试面读数——
现行一律以 `pnpm gates` 输出与 `scripts/gate-manifest.ts` 为准。

## 八、相关档案与一条区分

- 同 genre（外部形状评估，同一判读纪律「借形状不借读数」）：
  `outputs/zcode-study-2026-09-21.md` 与 `outputs/shell-permission-bypass-2026-09-21.md`。
- **别把两件事并成一栏**：本页否掉的是「用 laya **替代**确定性判断」（§5.2 的 A 类清单），
  而从 ZCode 借来的 `alwaysAsk` 是**工具对自身风险表态**——不引入任何模型，也不动判据强度。
  两者都落在判断层路线上，但一个是换判断主体、一个是加一层声明，复评时不要互相替代；
  共同的上游是 `docs/judgment-layer-calibration-proposal.md`。
