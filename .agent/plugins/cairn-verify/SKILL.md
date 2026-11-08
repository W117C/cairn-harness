---
name: cairn-verify
description: Use when validating a Cairn change before handoff or a PR, especially when tests, renderer probes, or screenshots must demonstrate a user-visible result.
---

# Cairn verify

把本次验收条件变成可运行证据。复用仓库现有判卷、`scripts/gates.ts` 和 `apps/desktop/scripts/`，不另建验证框架。选门细节需要时读同仓 `.agent/plugins/cairn-gates/SKILL.md`。

## 验证记录

先把用户要求写成一个可观察结果，并定位真实入口和消费者。为每个结果记录：

| 字段 | 内容 |
| --- | --- |
| 目标 | 什么输入/操作应产生什么状态；涉及失败路径时也记录预期拒绝/恢复 |
| 身份 | workspace、branch、HEAD、owned paths、dirty 范围与是否含未跟踪文件 |
| 检查 | 实际命令、相关测试/断言、原始输出位置、退出码、测试数/并发/skip |
| 结论 | 通过、失败、未运行或受阻；证据是工作树、指定 commit、合成 API 还是真实服务 |
| 未证 | 尚未覆盖的用户结果、平台、provider、重启、发布或回退 |

## 选可执行证人

| 用户结果 | 复用入口与必须观察的内容 |
| --- | --- |
| core 行为变化 | 指定 `tests/` 测试：观察输入经真实入口到结果及副作用，检查必要的拒绝/取消/重试；跨模块才扩大 suite |
| 项目 skill 可用 | `tests/cairn-sdlc-skills.test.ts`：实际内容经项目加载、pending 拒绝、信任后路由与两面调用、重载、内容失效及 clone 隔离。临时 trust 不是用户已经批准 |
| UI 布局及该探针明确断言的交互 | desktop 相关测试 + build 后的 `apps/desktop/scripts/layout-smoke.cjs`，读取其 PASS/FAIL 与截图。该探针用真实 renderer、合成 AgentApi，不运行模型 |
| 其他 UI 结果 | 先找该功能已有的 smoke/探针，阅读其断言与假 API 边界；布局探针不会自动覆盖任意交互或真实 provider |
| 纯文档 | 人工核对路径、命令、结论与源码/一手来源；没有自动文档门，人工核对路径/命令不能证明设计正确或命令跑过 |

从仓库根运行新 skills 的实际机制验收：

```sh
pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=1 tests/cairn-sdlc-skills.test.ts
```

有 UI 布局变更时，可复用以下入口；未涉及 UI 时不必运行：

```sh
pnpm --filter cairn-desktop build
pnpm --filter cairn-desktop exec electron scripts/layout-smoke.cjs
```

构建成功后再跑 smoke，记录脚本打印的产物位置，实际查看相关截图。每一步都需断言支持；截图证明外观，无法独自证明数据流、持久化或重启恢复。需要新的证人时才补最小定向测试或探针，不弱化现有判据。

## 收束

完成修改后运行适用检查及仓库要求的根 typecheck。检查完整输出：零用例和 skipped 不算 passed；没有跑完要说明原因。先处理实际失败，再给交付结论；若源于其他 dirty 内容，保留现场并说明证据，不借此跳过本任务可验证的部分。

复查最终 scoped diff 和新文件全文；测试后内容又变了，重跑受影响检查。需要独立复审且工具可用、已获授权时，给新上下文精确的任务、diff 和必要契约；没做就记录未做。OCR 只作 `delegate preview` 选文件与 `delegate rule` 解析规则，由当前 agent 审查；不调用 `ocr review` / `ocr scan`，也不把 skill 自动当成派 agent 的授权。

交付记录带回退办法。共享工作树不做整树 reset/stash/清理；只有包含本次变化的提交才有资格被称为该任务的 HEAD 证据。合并、发布或真实外部写入仍按当次授权处理。

## Gotchas

- 现有 `autoVerify` 是运行时钩子，默认开启不证明这次开发改动已验过；`autoVerifyRepair` 默认关闭。回执必须能对上本次内容。
- scoped 测试、模拟 provider、合成 AgentApi、真实 Electron、真实 provider 是不同覆盖面，报告时明确区分。
- 不为拿一份绿日志反复重跑失败，先保留并解释首个失败；怀疑负载时用定向低并发复测。
- `outputs/` 只存本轮必要的 `.md`/`.json`/`.log` 等证据；不要复制 TS 源码进去，证据面也会被 typecheck。
- 本 skill 被发现、信任和成功展开，不等于真实模型会自主选择它，更不证明能提升多少质量。需要另做有基线的真实任务评估。
