# 修复与 SoL-Pi 优化执行计划

## 依据与边界

承接 docs/solpi-port-proposal.md、outputs/solpi-integration-review-2026-09-17.md、outputs/solpi-fix-progress-2026-09-17.md。不改 agent-plan.md，不覆盖已有未提交改动，不创建提交。

本次全面检查的全量门禁仅 panels-check 失败；联网/凭据分支仍有未证项。87 秒是含前序等待及错误状态探针的观察结果，不是已验证的渲染延迟，不作为性能基线。

## 执行顺序与验收

| 阶段 | 工作 | 验收与边界 |
| --- | --- | --- |
| R1，立即执行 | 启动等待真实会话列表，失败/空列表不打开 mock 会话；用户已选会话时不抢回选择 | 新增独立回归测试：延迟成功、失败、空列表、用户已选；先红后绿；定向测试、typecheck；独立只读审查 |
| R2 | 复核并按 BLOCKED 流程提交 panels-check 判据裁决：明确选择压测会话、会话级统计、非空节点、滚动位移、对应 askId 的首次可见时间 | 不修改冻结脚本来制造绿灯；真实 Electron 交互验证，审批观察在事件推送前开始；未裁决不宣称该门修复 |
| R3 | 将消息窗口化移植到 vanilla；保留审批、流式输出、工具卡和会话切换语义 | 使用 R2 有效判据验证长会话、实际滚动及审批响应；通过之前不归档 React 遗留；分批渲染不冒充虚拟化 |
| A 补验 | 核对已落地 SoL-Pi 阶段 A：生产工具反馈、工作区 UI 接线、真实 IPC 连发/重开/重启、最终组装硬预算 | 已有离线测试与真实模型/IPC证据分列；文档称已完成不能替代代码与测试；日志句柄和调度并发边界独立补审 |
| B1 计量 | 保留 legacy 剧本指标，另记录真实请求次数、发送量、usage/cache、摘要/回取成本、墙钟时间、验证结果；从不可变初始快照重跑 | 未知 cache/价格不当零；不拿工具调用数当模型轮次；未校验的中途 fork 不用于反事实结论 |
| B2 ObservationPack | 有界观测归档与 recall，采集和请求投影分离，默认关闭 | 会话隔离、配额/生命周期、UTF-8 分页、hash、失效/磁盘满/删除恢复可见降级；明确脱敏后授权文本与原始字节区别 |
| C1 Action Fusion | 受控 write/edit 后检查，独立保留写入与检查结果，默认关闭 | 命令由既有配置派生，仍走审批、沙箱和取消；明确写成功但检查失败，不更改权限策略或冻结判卷 |
| C2 Evidence-Preserving Reducer | 先做确定性收据，含来源 hash、退出状态、精确引文与回取，默认关闭 | 引文真实不等于摘要完整；首轮不新增 reducer 外发；单机制试验后再测组合 |
| D Online Context Compact | 可信进度边界、horizon、缓存重建成本和压缩债务 | 经济拒绝不能阻断硬窗口保护；恢复后状态一致；未知价格不伪造收益 |

## 优化晋级规则

冻结任务、初始快照、模型配置、预算和验证器；区分开发集与留出集。先单机制消融，再组合，真实模型重复试验并报告区间。正确率及新鲜验证证据不下降，净成本计入摘要、归档、recall 与检查开销。未经实测不声称节省 token 或费用，不照搬上游阈值和价格比例。

## 本轮执行范围

先完成 R1 的最小补丁与验证，输出剩余阻塞；不把全部优化阶段塞入同一改动。后续阶段按依赖与裁决状态推进。测试临时日志全部放 session scratch。

## R3 续跑记录

- `history-window.js` 已加入显式滚动锚点修正：关闭原生 overflow anchoring，测量高度后更新占位与节点顺序，最后恢复修正后的 scrollTop。
- 修复后真实 Electron 独立探针：万条事件历史顶部 `任务 0`，中段 `任务 4988`，底部助手文本 `回复 9997：已处理该步骤。`；三个位置消息 DOM 分别 24 / 35 / 24，完整历史数据保留。
- 审批观测器在注入前启动，读取待审批弹层 `#askPop`：sentAt=1789647607935、firstSeen=1789647607998，本次观测延迟 63ms（包含轮询间隔，不是普遍时延保证）。
- 探针输出 scrollMaxMs=16.9，但该段从底部向下滚动，未证明 scrollTop 移动；**不将该数值作为实际滚动性能通过证据**。顶部/中段/底部消息恢复与 DOM 有界分别成立。
- 验证：`node --check`、`pnpm build`、定向回归通过；完整 `TERM=dumb pnpm test` 退出码 0（本次 69 文件 / 641 测试）。类型检查最初被未跟踪一次性原型脚本 `scripts/tmp-proto-check.ts` 阻塞；该文件完整移到 session scratch 的 `tmp-proto-check.ts.backup` 后，`pnpm typecheck` 退出码 0。
- 本次日志：session scratch 下 `window-probe-fixed.log`、`window-full-test.log`、`window-typecheck-final.log`。独立审查及 panels-check 结果另行追加；冻结判据仍未修改，不宣称全部门禁通过，不推进 React 归档或默认开启 SoL-Pi 优化。

- panels-check 已完成，退出码 1：历史 DOM 初始 28、中段 35，布局落盘及重启还原通过；仍有两项失败：`#eventCount` 重放统计实测 0、旧审批探针 72135ms。对应 R2 已登记的计数语义与测量口径问题，未修改冻结脚本；不能将该审批数字作为产品真实延迟。
- 只读 code-reviewer 委派因耗时过长停止，未取得最终报告；**独立审查未完成，R3 不标记全面收口**。后续先补会话切换/实时流混合边界审查与有实际位移的滚动测试，再推进 SoL-Pi A 补验及 B1 计量。


## 2026-09-17 收口轮（SoL-Pi A–D + R1–R3 终局记录）

- **状态**：R1/R2/R3、A、B1、B2、C1、C2、D 全部落地并离线验收；新优化默认关闭。
- **变更文件**（本轮新增/修改）：`src/agent/{solpi-runtime,ledger,evidence,prune,metering,economics,action-fusion}.ts`、`src/tools/observation-capture.ts`、`src/main/agent-runner.ts`（solpi 接线 + 开关透传）、`src/main/scheduler.ts`（准入互斥）、`src/main/settings.ts`（三开关）、`src/renderer/app.js`（workspace 接线 + 历史/实时流归因）、`src/renderer/history-window.js`、`src/agent/glm-session.ts`（D 经济输入 + B1 计量）、`tests/`（solpi-runtime、solpi-receipt-integration、solpi-review-regression、renderer-history-live、session-tools 追加、schedule 追加、action-fusion、ledger、evidence、metering、economics、final-budget 等）。
- **命令与日志指针**（session scratch = `/Users/ze/.pi-desktop/scratch/ad9fdd7e-8ce1-4a18-9985-600f57654fc2/`）：
  - 完整测试 `final-full-tests.log/.exit`：80 文件 / 756 测试全过（exit 0）。
  - `TERM=dumb pnpm e2e` `final-e2e.log/.exit`：exit 0（判卷冻结校验 + mock 闭环修复）。
  - `TERM=dumb pnpm build` `final-build.log/.exit`：exit 0。
  - `TERM=dumb pnpm gates` `final-gates.log/.exit`：exit 1，绿 27/28；唯一红 typecheck=2（并发 tmp-proto-check.ts TS5097，见 BLOCKED.md 备案 1）；其余 27 门 exit=0（panels-check 131s 真实 Electron 相含 1 万条压测）；未证 9 项如实标注。
  - 真实 IPC 探针 `ipc-min-probe.log`（连发×2、跨会话隔离、createSession IPC、实时回复、重启还原 5 断言 PASS）；离线对照 `offline-comparison.log` + `offline-comparison.json`（冻结快照 byte-identical rerun，legacy 指标保留）。
  - 定向：`review-fixes-tests.log`（57 过）、`scheduler-admission-tests.log`（35 过）、`renderer-history-live-tests.log`（30 过）、`flags-production-tests.log`（13 过）、`solpi-runtime-recheck.log`（8 过）。
- **离线对照结果**：B1 计量结构 + 冻结快照重跑一致；D 未知成本恒 null 不伪造收益；C2 收据 hash/引文/回取失效测试全过；C1 写入与检查结果分离、取消不假成功。
- **真实模型未证项**（合同要求如实标注）：真实模型 A/B、token/成本/正确率改善、cache 价格收益——全部未证；计量与对照均为离线/合成结构证据。
- **遗留清单**：typecheck 红门待并发工作流移除其临时脚本后自愈；renderer 同载荷重叠去重依赖 IPC 有序（代码注明，主进程事件 ID/watermark 为后续设计项）；D 生产接线当前为保守策略（经济候选在未知成本下拒绝、硬窗口兜底不变），真实收益需真实模型实验授权。
