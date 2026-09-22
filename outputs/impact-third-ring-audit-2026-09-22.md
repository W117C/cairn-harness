# 影响面（M7）全链路审计 + 第三环补测 · 2026-09-22

能力轴 1「不只看懂单个函数，而是理解这个改动会影响哪里」的实现是 M7 影响面。
本审计回答一个问题：**这条能力今天真到用户/模型手上了吗**，并把缺的那一环补上判据。

## 链路逐环取证（走 `runAgent` 真实入口，不看单测自建的那份）

| 环 | 事实 | 证据 |
| --- | --- | --- |
| 设置 | `impactAnalysis` 存在、**默认 false**、非 true 一律回落 false | `src/main/settings.ts` 的 schema 字段、默认值表、读侧校验 |
| 设置⇒run | `over.impactAnalysis ?? store().get().impactAnalysis` 进 RunOptions | `src/main/agent-runner.ts` L1558（工作树行号） |
| 构造钩子 | `opts.impactAnalysis === true ? defaultImpactHook(workspace) : undefined` | 同文件 L1287 |
| 透传 runLoop | `...(impactHook ? { impact: impactHook } : {})` | 同文件 L1307 → `src/agent/loop.ts` L322 进每次工具调用的 ctx |
| 写侧消费 | `write_file` / `edit_file` 落盘成功后 `appendImpact(ctx, rel, …)` | `src/tools/write_file.ts` L59、`src/tools/edit_file.ts` L89、`src/tools/base.ts` L167-L178 |
| 事件 | `impact_report` 先于 `tool_result` 落流；进 `AgentEvent` 联合与 `KNOWN_TYPES` | `src/events/index.ts` L181-L189 / L462 / L494 |
| 读端工具 | 同开关下注入 `impact_query` 实例 + 规格；worker 侧「规格/实例/白名单」三处同源 | `agent-runner.ts` L1290-L1293、`orchestrator.ts` L1669-L1672、`worker-tool-table.ts` L36 |
| 消费端 | sidechat 压成一行；渲染层经通用记录卡显示（标签「影响面报告」） | `src/agent/sidechat.ts` L134-L135、`src/renderer/app.js` L3080-L3105 |

**结论：第三环（设置⇒构造⇒事件）本来就是通的**，此前只是没人能证明；本审计没找到「两头断」，
但找到了它一直**不可证**——见下。

## 补的那一环：`tests/impact-runner-wiring.test.ts`（2 条，0.8s）

既有 `tests/impact-wiring.test.ts` 是**手搭 `ToolContext.impact`** 验的，所以「runner 里那行构造被删」
它照绿。新测试走 `runAgent`，并**成对**钉开关：开 ⇒ 必须有 `impact_report` 且摘要回进 `tool_result`；
关 ⇒ 一条都不许有，**且同一条写盘仍必须成功**（否则"关"那半边会被"根本没写盘"满足，等于没测）。

锚点 +2（`scripts/mutate-verify.mjs`）：`runner-impact-hook-never-constructed`（构造永不出钩子 ⇒ 开 case 红）、
`runner-impact-hook-always-constructed`（不看设置位永远注入 ⇒ 关 case 红）。

## 顺手量出来的一条假红（对后续所有影响面测试都成立）

第一版测试拿 `fixtures/todo-app` 当工作区，结果**零事件**，看着像"第三环断了"。实测：

```
buildImpact(fixtures/todo-app).files = ["tests/todo.test.ts"]     ← 没有 src/todo.ts
```

原因：扫描层是 `rg --files`（尊重 `.gitignore`），而 `.gitignore:18` 显式忽略
`fixtures/todo-app/src/todo.ts`（跑完留下的状态不进 git，由 `fixtures/mock/todo-bug.ts` 重置）。
⇒ 被改的文件压根不在图内，`fileImpact` 按契约返回 `null`、不发事件。**判据没错，是取料面选错了。**
修法：测试自建临时工作区（`src/todo.ts` + 一个跨文件调用它的 `src/app.ts`），并在文件头把这条写成注释，
免得下一个人再拿靶子量一次假红。

⚠️ 这条不只是测试技巧：对真实用户仓库同样成立——**被 `.gitignore` 忽略的源码（如生成物、
`src/` 被 ignore 的老项目）对影响面永久不可见**，且表现是"静默无报告"（与"没有跨文件调用点"
两种语义共用一次 null/空 up）。留作待裁：是否要在 `impact_query` 的"不在图内"文案里点出
「被 .gitignore 忽略」这一因（工具面对不在图内已有一句 ok:false，见 `src/tools/impact-query.ts` L22）。

## 仍未接的两环（明确记账，不偷偷做）

1. **右栏面板不读 `impact_report`**：`projectPanelData`（`src/renderer/projections.ts` L993-L1037）
   四个投影里没有 impact 分支 ⇒ 波及面只能在会话流的通用记录卡里看，面板读数不随它变。
   影响：「开设置跑一轮 ⇒ 面板读数变化」这条端到端断言现在**不可写**，panels-check 对 impact 零断言。
2. **worker 写侧不接钩子**（`orchestrator.ts` L1708 的 runLoop 不传 `impact`）：
   这是**有名字的刻意取舍**（`src/agent/orchestrator-types.ts` L191-L195：worktree 是仓库副本，
   缓存按绝对路径键 ⇒ 每个 worker 冷启动重建整图，代价随 worker 数线性放大；波及真正有意义在合并回主树那一刻）。
   worker 拿到的是读端 `impact_query`。若日后要求 worker 也写后回注，需先解掉"每 worker 重建整图"的代价。

## 验证

- 新测：2 passed（1.3s，全量里最便宜的端到端一环）
- 全量 `pnpm test`：**196 files / 1970 tests 全绿**
- `pnpm typecheck`：HEAD 内 0 错（唯一红是别人在飞的 `scripts/sidebar-probe.ts`）
- `mutate-needles-check`：645 条针脚阻断 0，改法语法体检全过
- 两支新锚点的真杀死验证在同 HEAD 的 worktree 里补跑（`agent-runner.ts` 正被别的会话改着，变异器拒变在飞文件）
