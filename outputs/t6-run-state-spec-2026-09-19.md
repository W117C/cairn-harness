# T6 定案 · 运行状态 7 态编码（2026-09-19 用户拍 7 态）

**结论先说**：7 态**可实现且零新增生产者**，但**不能照 `ui-v3-forge` 那 7 个名词直接建**——
本仓真实状态模型是 `AgentStatus`（6 值）× `reason` 分型。文档那 7 个里有 **1 个没有生产者**、
**1 个跨域混用**。下面每个态都附实测出处。

## 一、权威状态源（实测，非文档）

- `src/events/index.ts:175` ⇒ `AgentStatus = "running" | "waiting_approval" | "waiting_input" | "done" | "failed" | "cancelled"`
- 卡死**不是** status：`orchestrator.ts:1865` 发 `waiting_input` + `reason:"stuck"`（`:1821` resume 时回 `running`）。
- `failed` 带 `reason` 分型（`max_turns` / `interrupted` / 异常摘要，见 `AgentStatusEvent.reason` 注释）。
- 审批结果 `approved|rejected` 属 `approval_resolved` 事件（另一个域）；定时任务是第三套词汇
  （`scheduler.ts`：`succeeded|failed|skipped|running|queued`，重启无终态记 `interrupted`）。

## 二、7 态定义（每态都有生产者；三通道编码：色 + 形 + 字）

| # | 态 | 判据（事件层） | 形（内联 SVG，非 `⊘/⏸` 字符） | 色（既有令牌，**不新增色相**） |
| --- | --- | --- | --- | --- |
| S1 | 完成 | `status=done` | ✓ 对勾 | `--st-done` |
| S2 | 运行中 | `status=running` | ● 实心点（带脉冲；reduced-motion 下停脉冲） | `--st-run` |
| S3 | 等审批 | `status=waiting_approval` | ⧉ 盾/锁形 | `--st-wait` |
| S4 | 等输入 | `status=waiting_input` 且 `reason≠stuck` | ？问号 | `--st-wait` |
| S5 | 卡死 | `status=waiting_input` 且 `reason=stuck` | ‖ 双竖线（暂停） | `--st-stuck` |
| S6 | 失败 | `status=failed` | ✗ 叉 | `--st-fail` |
| S7 | 已中断 | `status=cancelled` | ◌ 空心圈 | `--st-fail`（共享色相，靠形区分） |

**可辨性判据（沿用轮 1 已确立、且是本轮要守的那条）**：删掉颜色后 S1–S7 仍两两可辨——
S3/S4 同色不同形（盾 vs 问号）、S5/S7 靠「双竖线 vs 空心圈」、S6/S7 同色不同形（叉 vs 空心圈）。
⇒ **任意两态不得同色同形**；写验收测试时逐对枚举这 21 组。

## 三、对文档原 7 态的两处纠偏（都因"无生产者"）

1. **「被拒」不是运行态**。`rejected` 只存在于 `approval_resolved`，是**审批记录**的状态；
   worker 被拒后走 `failed`/`cancelled`，内核从不发 `rejected` 的 `agent_status`。
   ⇒ 建 `--st-rejected` 就是第 8 个"文档称施工、代码不存在"。**改放审批卡的态词表，不混进运行态。**
2. **文档把「等待」当一态，内核其实是三态**（`waiting_approval` / `waiting_input` / `+reason=stuck`）。
   这正好补足 7 个：S3/S4/S5。原 `卡死` 之所以悬着，就是没读到这层 `reason` 编码。

## 四、令牌缺口（实施时要一并处理，但**别顺手删**）

- 现有 `--st-*` 只有 9 个：`done/run/wait/stuck/fail` + `run-fg/stuck-fg/fail-fg/wait-fg` ⇒ **缺 `--st-done-fg`**。
- 形状通道**至今 0 落地**：`data-st`、`.st-dot` 实测各 0 次（台账 C2）。⇒ S1–S7 的形全靠这次补。
- ⚠️ 别在这轮顺带清理零引用令牌：实测 **28/79 名零引用**（`--sp-*` 缺 10/12、`--r-*` 全 8，
  见 `docs/ui-fact-baseline.md` F13），那是另一件事、另一个提交面。

## 五、验收口径（可判定）

- 7 态各有事件序列可造：给 `runLoop`/`orchestrator` 灌对应 `agent_status`，断言渲染出对应 `data-st`。
- 断言「删色后仍可辨」：对 7 对形做唯一性检查（21 组两两比较）。
- 对比度沿用已实测口径：任何 `-fg` 对其允许出现的每个面 ≥ 4.5:1，
  复算脚本与逐面值见 `outputs/design-contradictions-2026-09-18.md` 第三部分（T9 矩阵）。
- **两套渲染器都要落**：live `renderEvent` + replay `projectHistory`/`renderHistoryRow`
  （P0-T2 已证明只补 live 等于没修）。

## 六、为什么这份定案**不是代码**（施工面冲突）

实现要动 `src/renderer/index.html`（令牌 + 7 个内联 SVG glyph）与 `app.js`（badge 渲染 + `data-st`）。
而按协调调度：**`app.js`/`history-window.js` 现归 `316c75f9` 的 R1b**（`2671e18` 正把两套渲染器收敛成一套），
且我被要求本轮不再动 `src/renderer/`。⇒ 本文只交付裁决与映射；**施工排在 R1b 合回之后**，
好处是那时只剩一套渲染器，形状通道做一次就行。若要在 R1b 之前做，就得准备在两条渲染路径上各写一遍。
