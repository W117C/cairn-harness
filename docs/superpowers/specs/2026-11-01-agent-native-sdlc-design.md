# Cairn agent-native SDLC

核验与执行日期：2026-11-02。文件名沿用本轮输入给定的 spec 路径。

## 目标与事实边界

让修改代码的 agent 能选择合适的现有检查、展示可复查的行为证据，并区分工作树、提交和真实产品验证。
本设计依据[事实核验报告](../../../outputs/agent-native-sdlc-2026-11-02/REPORT.md)。Anthropic 的自报吞吐量是研究背景，不能作为 Cairn 的收益承诺。

Cairn 已有 verify/autoVerify、worker diff 选择、安全 merge gate、门禁清单、独立 HEAD 认证与变异验证。
需要补的是开发工作流的可发现入口、验证选择和证据衔接；不能把已有机制重新实现一遍。

## 方案取舍

| 方案 | 收益与代价 | 本轮决定 |
| --- | --- | --- |
| 新建通用验证执行器、AI 审查平台 | 自动化范围大，但重复现有 gates/runtime，并引入远端权限与成本 | 不采用 |
| 直接写 `.agent/skills/` | 原生支持，但该目录被现有 Git 规则忽略，容易只在本机存在 | 不改忽略规则 |
| 在 `.agent/plugins/<name>/SKILL.md` 发布两个 loose skills | 已有发现、路由、两种调用面及信任机制；普通 Git 文件，无需 manifest | 采用 |

这是执行者根据代码作出的实现选择。用户已授权核实、修正并直接执行首批 spec 与 skills。
本轮不修改已有 `AGENTS.md`、全局 skill、配置、CI 或共享 dirty 文件。

## 本轮交付

- `cairn-gates`：验证选择参考。事实源仍是 `package.json`、`scripts/gate-manifest.ts` 和相关判卷；已有 `gates --only` 负责执行，无需新 runner。
- `cairn-verify`：把用户可观察结果映射到断言、命令、原始输出和覆盖边界。选择性复用已有测试、Electron smoke 与探针。
- 新 skills 的集成验收：真实内容经项目发现路径加载，未信任拒绝、信任后路由和两面调用成功、重载持久化、内容变化重新待审、另一 clone 不继承信任。
- 核验报告与运行记录。证据只覆盖当前工作树以及测试创建的临时工作区。

skills 的安装不代表模型一定主动调用，也不代表已经获用户信任。测试中的 trust 决议只写临时目录。
实际使用从项目的技能/插件信任入口批准内容后调用 `/cairn-gates`、`/cairn-verify`。
两个目录须随后续 scoped commit 一起入库才能随 Git clone 分发；`package.json.files` 排除 `.agent`，本轮不承诺 npm 分发。

## 分阶段流水线

| 阶段 | Cairn 落点 | 验收与后续边界 |
| --- | --- | --- |
| PR 前验证 | 本轮两个 skills，复用 verify/gates/现有测试 | 验收指定行为，不以退出 0 或一张截图替代断言；独立复审需在可用且获授权时执行 |
| PR bug 审查 | 后续复用 OCR delegate 选文件/解析规则，由当前 agent 审查 | finding 记录触发、文件行号、影响、引入/存量、修复或有理由关闭；多 agent 投票先做有标签评估，不能以票数充当正确性 |
| 安全审查 | 复用 worker 的 high/critical merge gate | worker 合并门不等于 GitHub PR 必需检查；不能声称目前所有 PR finding 都能阻塞 |
| CI | 复用现有 workflow 与 manifest | 检查数量不证明质量更严；核对远端运行的提交、平台、跳过项与覆盖面 |
| 按风险人审 | 后续定义区域 REVIEW 指导和路径风险 | 先用建议模式；需受信作者、敏感路径例外、提交级批准；不自动改变 GitHub 规则 |
| 合并、发布、反馈 | 后续评估 merge queue、flags、灰度、回滚 | 验证合并后的组合态；发布、远端写入与回滚分别授权、演练 |

快速检测与回滚贯穿发布后的阶段。以上后续工作均为设计，不是本轮已经部署的能力。
`src/agent/evolve/shadow.ts` 属于经验回放分析，不能用它推断 orchestration 的运行状态。
OrchestrationService 默认 shadow、有 execute 路径；前面的开发验证不依赖启用它。

## 度量

先建立以 PR 和 commit 为键的基线：human approvals（中位/P95）、human comments、明确的等待人工区间、revert 与 incident。
同时保留样本量、窗口、风险档、模型成本、CI 耗时和 finding 精度。等待人工不能直接用创建到合并时长替代；incident 也不能靠 Git revert 记录推算。
观察到吞吐量变化后再比较同风险档数据；缺少 incident 数据就报告缺失。本轮不伪造收益、默认阈值或自动熔断。

## 实施与验收顺序

1. 核对网页原文、仓库身份、dirty 内容和复用方案，记录修正。
2. 先写实际技能内容的发现/信任/调用测试，观察缺少交付物时失败，再逐一添加技能。
3. 运行 skill 格式校验、指定机制测试、`pnpm docs-check`、根 typecheck；阅读结果和覆盖边界。
4. 用独立上下文试用指导，当前 agent 按 OCR delegate 规则复审 scoped 文件。比对原 dirty 文件哈希，交付可复查结果。

本轮做定向验收，不跑全表 gates。HEAD 认证与变异验证也不跑：尚未提交的新文件不在提交级验证的证明范围内。
文档检查不会验证设计正确性，根 typecheck 不会编译 Markdown 或 desktop renderer，集成测试不证明真实 provider 或新桌面会话中的模型选择质量。

## 回退

后续提交只应包含本轮明确文件。若需撤销，可针对那笔 scoped commit 做 revert；当前尚无该提交。
未提交态只移除本轮新增且未再被他人修改的文件，不清理 `.agent` 其余内容，不回滚已有 dirty 改动，不删除用户信任数据。
