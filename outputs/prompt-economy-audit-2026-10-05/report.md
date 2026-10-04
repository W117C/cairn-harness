# Prompt 面静态成本取证（2026-10-05）

**取料面**：工作树（`git status` 计数：取证开始时 162 项未提交、结束时 168 项——隔壁会话在写；HEAD=`513d4d7d`）。全部读数由 `measure.ts` 从工作树源文件现算。**主树是活动靶**：本次取证期间隔壁会话又改了 5 个文件（`src/main/agent-runner.ts` 在 :1615 处 +6 行 ⇒ 我引用的行号已按 01:40 现读复核并就地更正；`scripts/mutate-verify.mjs` 也被改，但我点名的 6 条锚点行号复核后仍成立）；其余 `src/agent/*` 引用文件期间未被改动，脚本把根钉成仓库根、不读环境变量。未跑任何判卷/门/vitest；未跑 `scripts/prompt-cost.ts`（它模块顶层 `await main()`，import 即执行该门）——只复用它的常量 `CHARS_PER_TOKEN=3.6`（`scripts/prompt-cost.ts:32`）。

**尺子（一律复用仓内现成口径，不自造）**：字符账用 `src/agent/model-surface.ts:89,102`（`surfaceSpecChars`/`accountModelSurface`，帽 `MODEL_SURFACE_TOTAL_CHAR_LIMIT=24000` 就是这一单位）；token 用 `src/agent/text-budget.ts:45` 的 CJK 感知 `estimateTextTokens`（goal/记忆/skill 各家帽用它）；横向比较再给 `/3.6` 一档。

## 每轮固定开销（本工作区生产形状：default 档、未武装 goal、无 `.agent/lsp.json`）

**20 把工具 + 系统提示 = 12,520 字符/轮 = 24,000 帽的 52.2%**。同一面：`/3.6` 口径 **3,478 tok/轮**，CJK 口径 **5,852 tok/轮**（两把尺差 68%，本仓未裁决谁准——见「未实测」）。摘满（再摘 automation+记忆+子代理）＝ 11 把 / 6,378 字符，**每轮还能再省 6,142 字符**。

| 每轮重送块 | 产出函数 file:line | 帽（值 / 单位 / 出处） | 每轮 or 每会话 | 本次静态读数（工作树） | 有无总闸 |
|---|---|---|---|---|---|
| 系统提示 | `systemPromptFor` `src/agent/system-prompt.ts:60`；常量 `:22` | 字节 `<1600`，`tests/base-system-discipline.test.ts:52` | 每轮 | 679 字符 / **1,551 字节**（余量 49B）；read-only 面 563 字符／省 210B | 有（钉字节） |
| 工具规格 JSON | `sessionToolSpecs` `src/agent/glm-session.ts:512`；装配 `src/main/agent-runner.ts:704`（现读复核 01:40）；逐请求 `glm-session.ts:949,1008-1015` | 并入固定面 24,000 字符 `model-surface.ts:43`；单条 MCP 描述 2048 | 每轮（`requestFace` 重算） | default 挂满 22 把/12,947 字符；生产现读 20 把；`automation5=2,569`、`子代理3=2,484`（`spawn_agent` 单件 1,666，其中参数 schema 1,320）、`remember=1,092` | 有，但 **20/21 件 tier=core ⇒ 降配梯对基础面 0 刀可下**（`model-surface.ts:167`） |
| 技能路由清单 | `buildSkillRoutingList` `src/agent/plugins/skills.ts:194`，注入 `glm-session.ts:781` | `SKILL_ROUTING_CHAR_LIMIT=1536` 字符 `:11` | 每轮（run 起点算一次、逐轮重送 `agent-runner.ts:1724`） | 本工作区 1 条散装 skill＝153 字符/80 tok，未截断 | 有 |
| skill 压缩后重挂 | `plugins/index.ts:412`→`pluginContext` | 5,000/条、25,000 合计 tok `skills.ts:13-14` | 每轮（仅压缩后窗口） | 本轮 0（未触发） | 有 |
| goal 提醒块 | `goalReminder` `src/agent/goal.ts:191-211`，调用 `agent-runner.ts:2245` | 整块 `GOAL_REMINDER_TOKEN_CAP=700`、目标行 `400`（`goal.ts:20-22`） | **每轮（仅 goal 续跑轮）** | 逐证据态 192–215 字符 / 134–161 tok（远低于帽） | 有 |
| 记忆注入 | `buildMemoryInjectionSafe` `src/agent/memory/inject.ts:346`，块渲染 `:233` | `MEMORY_TOKEN_BUDGET_DEFAULT=6000` tok（`:28`）；ARCH 大纲 4,096 字符；DECISIONS 20 条 / LESSONS 10 条 | **每轮重读盘 + 重注**（`glm-session.ts:960-966`） | 本工作区 project/global 均 **null（0 字符）** | 有（按 token 判，非字符） |
| 符号地图 | `mapInjectText` `src/agent/map/build.ts:240`，预算 `map/render.ts:81`，注入 `glm-session.ts:668-672` | `MAP_TOKENS_DEFAULT=1024` tok（显式传值 `glm-session.ts:985`），MAX 4,096 | **仅首轮**（`history.length>2` 即不挂，`:972`） | 标签串 45 字符；正文我未跑（需真索引） | 有 |
| 插件 hook 上下文 | `HookEngine` `src/agent/plugins/hooks.ts:487`，经 `pluginContext` 入块 | `HOOK_CONTEXT_TOTAL_CHAR_LIMIT=24,000` 字符 `:24` | SessionStart 每 run 跑一次，**内容逐轮重送** | 本工作区 0（无插件运行时） | 单块有帽，**不在 24,000 固定面口径内** |
| 附件引用 | `formatAttachmentContext` `src/main/run-attachments.ts:151` | `ATTACHMENT_CONTEXT_CHAR_LIMIT=32,768` 字符 `glm-session.ts:493`；入口 32 个/路径总 16,384 | 每轮 | 表头 18 + 表尾 44 + 每附件一行（样例 23 字符） | 有（块级，不属固定面账） |

## 条件面清单

**已经省掉的**：lsp 未配 → 摘（本工作区 −763）；未武装 goal → 摘 `refine_goal`（−342）；`read-only` 档另摘写向+编排+定时并换 `propose_plan` 描述（固定面 5,363 字符，仅为 default 的 43%）；`settings.subagentTools/autoMemory` 两个可关旋钮；MCP 超帽时尾丢（core 永不砍）。
**还在无脑重送的**：`automation_*` 五件——只有 CLI 传 `automationTools:false`（`src/cli.ts:1124`），交互/desktop 路径缺省全挂，而调度器没初始化时它们**必然** fail-closed（`agent-runner.ts:1184,1190`）；子代理三件套缺省 `subagentTools:true`（`src/main/settings.ts:107`）；`remember` 缺省 `autoMemory:true`（`:106`）；记忆块每轮重读盘重注；hook/附件/skills 文本每轮重送却不进固定面帽的判定。

## 前 3 个可减点

1. **automation 五件按「调度器实况」摘**：省 **2,569 字符/轮**（最大单项）。撞：`tests/automation-tool-surface.test.ts:96`（五件合计 ≤2,600 字符，**余量仅 31**）、`:109-147` 三条「两面同摘」＋对 runner 源码的正则（`:133/:135/:137`）、锚点 `automation-face-dropped`/`automation-face-in-read-only`/`automation-specs-become-core`（`scripts/mutate-verify.mjs:7034,7042,7050`）。不减的代价：注释已自认「唯一白烧的一轮是 `automation_create`」——每轮还另付 2,569 字符。
2. **`spawn_agent` 参数 schema 瘦身 / 子代理三件套按会话实况挂**：schema 1,320 字符（整件 1,666），三件套 2,484。撞：锚点 `role-spec-desc-hides-user-form`(`:349`)、`supervise-spec-loses-a-declarable-field`(`:639`)、`chain-lease-promise-says-reject`(`:7025`)，以及 `prompt-surface-check` 的 desc/param 两族（`scripts/prompt-surface-check.ts:62,97`，参数描述是递归逐条取面的）＋ `tests/optional-tool-surface.test.ts:39-60` 的摘除形状。不减的代价：固定面 20% 押在本轮可能不派 worker 的能力上。
3. **易变侧并入「每轮」账**（记忆+skills 块+hook+附件）：本工作区现读 0，故**这项今天省不出字节**，但敞口是 hook 一项 24,000 字符＝整顶固定面帽、附件满额约 17.4k（`run-attachments.ts:32` 文档值）。撞：`model-surface-check` MS1 语义随分母改变（`scripts/model-surface-check.ts:68`）、`tests/surface-account.test.ts:98-99`（declared=sent 相等）、锚点 `ms-fixed-face-forgets-system`/`plugin-context-routing-part-dropped`/`memory-degraded-composer-note-not-pushed`；`model-surface.ts:20-28` 已明写「不接进判定是有理由的」＋要重跑 MS1–MS6 基准。不减的代价：降配对基础面 0 刀可下，压力只能由压缩（多烧一次摘要）或 `finalChars` 硬闸（整轮失败）承担。

**顺带一句不能碰的**：`BASE_SYSTEM` 1,551 字节距 1,600 帽只剩 49 字节，且 8 条锚点钉在字面量上（`mutate-verify.mjs:1870,1878,1886,2694,2702,2710,2718,8954`）——它不是好的下手处。

## 没能实测（推算≠读数）

- **真实 tokenizer 与真实每轮 usage**：未跑任何真请求，也没读事件流的 `usage`。表中 3,478 / 5,852 tok 都是**两把估算尺的推算**，出处为上述文件行；本仓两把尺互相差 68%，没有裁决。
- **符号地图正文**：未跑 `createMapBuilder`（要真索引）。「3,978 字符／1,047 tok」是 2026-10-03 别的会话留下的读数（`outputs/tool-face-repo-rebaseline-2026-10-03/00-读数.md`），**我没有复现**。
- **含插件/MCP 的面**：未建 `PluginRuntime`（会装载、可能建信任库），也没喂 `--plugin-tools`。真实安装量下 1,536 帽会截到什么，我只复用了台账第 368 页的记录（406 条、平均 193 字符/行）。
- **记忆块非零形状**：本工作区 `.agent/` 无 ARCHITECTURE/DECISIONS/lessons，`buildMemoryInjectionSafe` 实调返回 project/global 均 null（这一步是我这轮真跑的，且我显式注入 `persistRefDecision:()=>{}` 以免写 external-refs 决议）。有记忆文件的仓库要多大，我没量。
- **缓存命中后的实际付费**：`prefixStableChars`／98.8% 命中等都属厂商侧读数，本轮未测。
