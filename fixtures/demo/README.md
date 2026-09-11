# fixtures/demo — 演示通道剧本（M2g 任务 6 fixture 化）

> **不进验收链**：本目录只服务 `docs/*.png` 截图的重跑入口。全部通道 env 门控、缺省零行为。
> **冻结表独立**：`scripts/frozen-demo-sha256.json`（**不是** `scripts/frozen-sha256.json`——
> 后者是判卷区基线，`src/frozen.ts:sha256MatchesFrozen` 按 flat map 逐个校验，往里加演示条目
> 等于把演示剧本升格成判卷文件。演示区用独立文件。）

## 通道 → 剧本映射

| env 通道 | 剧本 | 说明 |
|---|---|---|
| `M0A_MOCK_DELTA=1` | 沿用 `fixtures/mock/todo-fix.jsonl` | **不复制**：该文件在判卷冻结区，复制会产生两份事实源。本通道只把剧本里的 assistant_message 拆成 assistant_delta 逐段吐出（src/providers/mock.ts） |
| `M0B_SCREENSHOT=<path>` | 沿用默认 mock | 截图钩子（src/main/index.ts），无剧本 |
| `M2A_LSP_DEMO=1` | `fixtures/demo/lsp-demo.jsonl` | 2026-09-11 由 `fixtures/lsp/demo-lsp.jsonl` 迁入（write_file → 真实诊断回流） |
| `M2A_LSP_DEMO=<path>` | 显式路径（旧行为保留） | 向后兼容 |
| `M2B_MAP_DEMO=1` | 沿用默认 mock | 事件流跑真实 buildMap + computePrune，结果以 tool_result 气泡上屏 |
| `M2F_SIDECHAT_DEMO=1` | `fixtures/demo/sidechat-demo.jsonl` | 原为 agent-runner 里的内联常量，本轮外置为 fixture；读不到时回退内联（fail-visible 告警） |

## 校验

```bash
node --import tsx -e "import {sha256MatchesDemoFrozen} from './src/frozen'; console.log(await sha256MatchesDemoFrozen(process.cwd()))"
```

演示区 sha 表与判卷区**互不干扰**：改演示剧本不会动到判卷基线，反之亦然。
