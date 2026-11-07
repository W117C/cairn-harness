# OpenCode 优化任务续接

日期：2026-11-05（Asia/Shanghai）。工作树基线：`fix/spec-summary-double-count` @ `fc6e3638`。

## 原任务与中断点

本地 OpenCode 会话 `ses_e55df519dffeRYH74itfsMU1q8`，标题「项目多层架构与提示词优化」。原始要求：优化压缩层、长任务执行层、工具调用层与系统提示词。该会话停在只读调研，压缩/工具子会话遇到上游 endpoint unavailable，主会话最终收到免费额度 429；没有该轮实现或验收记录。长任务子会话的调研结果可以作为线索，仍逐项核对现代码。

## 处理方案与验收

沿用项目已有的事件日志、工具注册表、provider 装配和租约。相比接入新的 agent/workflow 框架，这一方案能够保留现有权限、事件和回放契约，不增加依赖。已查 [OpenCode 压缩源码](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts) 与[官方压缩说明](https://dev.opencode.ai/v2/docs/compaction/)作为模式参照，未下载或执行第三方代码；本次实现使用现有项目代码。

1. 压缩：复现常规摘要被 overflow marker 覆盖后的失忆，以及父/worker 重号造成的事实归因污染；验证重复压缩和分叉来源投影。
2. 长任务：核实固定五分钟租约；只允许有真实执行进展的同一 run 续约，保持静默到期取消、显式 deadline、取消和旧日志语义。
3. 工具：未知名称不能命中 JavaScript 原型链；默认工具表、普通调用方工具表、动态 resolver 与合法别名均需有行为覆盖。
4. 提示词：主请求与会话结束沉淀复用同一完整系统前缀，保留权限档位、自定义指令与演进注记；通过真实装配路径捕获模拟 transport 请求，比较实际发送内容。

验收采用定向红绿回归、core `--maxWorkers=2` 全量、桌面套件、根 typecheck、相关结构/文档门。OCR 只提供文件选择与规则，由当前主代理审查实际 diff；不使用 `ocr review` 或 `ocr scan`。

## 落实与红绿证据

| 面 | 最小修复 | 回归证据（工作树） |
| --- | --- | --- |
| 压缩 | overflow marker 继承旧主摘要；失败/拒绝清单按 `(agent_id, callId)` 匹配；主摘要的工具整形与 Files 兜底过滤 worker 子流 | 新增 10 条：首批 5/5 红，扩面另 4 条红，修后六文件 70/70，`--maxWorkers=1` |
| 长任务 | 进展驱动租约续期，窗口仍为 300 秒且每分钟至多落一次；deadline 截顶；过期/取消/终态拒绝续约；过期取消前核对最新同 run 租约；重建 stamp，保证已发事件不被事后修改 | 新增 11 条：初始 3 红/1 绿；sandbox 进展、旧快照竞态、observer/JSONL 一致性分别先红后绿；九文件 113/113，`--maxWorkers=1` |
| 工具 | 别名和执行表只查自身属性，再走动态 resolver；未知 `constructor` / `__proto__` 不再误命中原型链 | 新增 6 条：5 红/1 绿 → 五文件 68/68，`--maxWorkers=1` |
| 提示词 | 主轮/沉淀轮复用包含档位、自定义指令与演进注记的完整系统前缀；反思保留档位与自定义指令 | 新增 1 条：实际 transport 请求中沉淀轮缺少指令时红，修后五文件 57/57，`--maxWorkers=1` |

压缩、长任务、工具三组定向由对应子代理执行并回报；提示词定向和下方整体验证由主代理直接执行。

提示词首个探针使用一次性短问答，被现有 trivial-session 策略正确跳过沉淀；改用含明确记忆线索的输入后，才在系统前缀不一致处复现真实红灯。没有为触发测试而关闭该生产优化。

长任务进展源：local 已落盘事件、受信 sandbox 显式报告的进展、remote 已确认的 fenced heartbeat。没有用“Promise 仍未完成”作为续约依据。使用既有 `agent_status` 与可选字段，没有新增事件 kind、修改默认 shadow 模式或启动自动重派。

主代理已按 OCR delegate 解析的规则审查本批源代码与测试。审查中补上旧快照取消竞态、长验收命令的进展透传，以及已发 spawn 事件被续约修改的问题。OCR 本身未执行模型审查。

## 整体验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:capped` | 最终 645 文件 / 7833 条通过，`--maxWorkers=2`，191.06 秒，exit 0 |
| 四个新增回归文件，`--maxWorkers=1` | 4 文件 / 28 条通过，exit 0 |
| `pnpm --filter cairn-desktop test --maxWorkers=2` | 327 文件 / 2267 条通过，exit 0，含 desktop boundary |
| `node --import tsx scripts/typecheck.ts` | 最终 0 条报错，exit 0；首次检查指出新增租约测试缺 `assistant_delta.callId`，已补合法事件字段 |
| `pnpm docs-check` | 受检项全绿，exit 0 |
| `pnpm renderer-layer-check` / `pnpm desktop-boundary-check` | 均通过，exit 0 |
| `pnpm prompt-surface-check` | dead 0 / odd 0，exit 0 |
| `pnpm tools-check` | 实际 45 条检查通过，exit 0；结构性不适用项按脚本原口径列为 n/a |
| `pnpm evidence-typecheck-check` | 危险码 12/12、未入库新增危险码 0，exit 0；这是 ratchet，不是证据目录零类型错误 |
| `pnpm compaction-check` | mock 明卷通过；真实 GLM 暗卷无 `CAIRN_API_KEY`，`UNVERIFIED=1`，不记作全绿 |
| `pnpm mutate-needles-check` | exit 1，三条既有针脚漂移，详见下方 |

核心首轮为 645 文件 / 7832 通过、1 失败（`--maxWorkers=2`）：`tests/prompt-surface-check.test.ts` 的旧形状接线锚点不认识共用 `sessionSystem` 变量。已改为逐段验证 `systemPromptFor → baseSystem → sessionSystem → createProvider`，另有实际 transport 前缀比较覆盖行为；相关两文件 33 条通过后重跑全量。未删除断言或放宽匹配。

日志：`core-initial.log`（首轮失败）、`core.log`（最终）、`desktop.log`、`targeted.log`、`typecheck.log`、`docs-check.log`、`evidence-typecheck.log` 均在本目录。
本批涉及的 15 个源代码/测试文件内容已记录在 `verified-files.sha256`，全量收束后再次校验全部一致；它标识共享工作树实际验证的文本，不替代提交认证。测试产生的临时 worktree 已回收，收束时只剩原工作树。

三条失效针脚位于本批未修改的源文件，保留原状并单列，未通过删除锚点或弱化检查取得绿灯：

- `prompt-surface-readonly-text-not-applied`：`src/agent/system-prompt.ts` 的自定义指令装配已改变原 `if (mode !== "read-only") return BASE_SYSTEM;` 形状。
- `atomic-rename-dropped`、`atomic-direct-write-no-tmp`：`src/atomic-write.ts` 的既有实现已改变旧 `writeFile(tmp, text, "utf8")` 针脚。

## 验证边界

本批改动留在共享工作树，未提交、未推送。没有 reset/stash，没有修改 agent 规则或全局配置。模拟 transport、模拟时钟、真实 JSONL 与本地 HTTP 服务不代表真实 provider 的长时间运行、跨机器、打包发布或故障恢复已经认证。`head-cert-check` / `mutate-verify` 测的是提交，未用于认证本次未提交改动；没有运行完整 `pnpm gates`，不宣称仓库所有门禁全绿。

明确保留的限制：

- 新编排内核默认仍是 shadow，本批没有开启执行或调整权限。
- sandbox 必须主动报告真实进展；沉默超过租约的命令仍会取消。新内核的 local producer 目前不暴露 `run_shell`；现有普通 `run_shell` 有自己的 60 秒超时，本批未改。
- 若旧摘要本身已超过输入预算，完整保留事实后由最终 `context_budget_exceeded` 硬闸拒绝发送；回归确认只尝试一次 overflow，transport 调用为 0。不会用丢弃旧事实来伪装压缩成功。
- 重复 overflow 会追加降级 marker；没有新增 marker 重写、预算策略、日志缓存、provider 令牌桶或框架依赖。
