# 项目路线与 GitHub 仓库状态

更新日期：2026-10-26（Asia/Shanghai）。本页是带日期的远端盘点与待办入口；
默认分支的当前实现见 [STATE.md](../STATE.md)，实时运行结果见 [Actions](https://github.com/W117C/cairn-harness/actions)。
这次整理基于 `main@41f226e53f37c5809ae130ac568f90f5cb6c4336`，不代表本地未提交功能已上传。

## 分支各放什么

| 分支 | 盘点时状态 | 处置 |
|---|---|---|
| `main` | 默认分支，已有治理文件与 B1 门面 | 继续作为默认入口；开发线集成前不把本地新功能写成 main 已支持 |
| `fix/spec-summary-double-count` | `014ac0e3`，相对 main 多 138 个提交、少 3 个治理提交 | 保留完整开发线；独立处理代码集成、冲突和同一提交的验证 |
| `integration/dev-line-with-standardization` | 与上述开发分支同一个 tip，实际尚未包含 main 的治理提交 | 保留，集成后再决定是否收口这个别名 |
| `chore/repo-standardization` | 本轮开始时与 main 完全相同，复用为此次整理的评审分支 | 仅放本批整理差量，不混入整条开发线 |
| `doc-layer-migration` | 相对 main 仍有 5 个独有提交，已有同 tip 的 rescue 标签 | 历史归档候选；先核对恢复凭证再决定是否删分支 |
| `rescue/wip-20261025` | 相对 main 仍有 2 个独有提交 | 保留恢复用途，不按“旧分支”删除 |

[B1 发布记录](https://github.com/W117C/cairn-harness/releases/tag/v0.1.0) 有自己的 tag，
不能把后来开发分支的功能或本地读数追认为该发布已经包含。
这里的 ahead/behind 是盘点快照，复核请看
[main 与开发线比较](https://github.com/W117C/cairn-harness/compare/main...fix/spec-summary-double-count)。

## 已完成的仓库整理

- 补齐 Dependabot 配置实际使用的 `dependencies`、`npm`、`github-actions`、`desktop` 标签。
- 去掉相同 ecosystem / directory / target branch 的重复 Actions 更新配置，保留每周分组更新。
  约束来源：[GitHub Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#directories-or-directory)。
- 补上 README 已引用的 `test:capped`，使用既有 Vitest 配置并限制两个 worker；不改 lockfile 或判据。
- README 与文档索引接入本页，CodeQL 改为如实说明的手动入口。
- 移除四份无执行消费者的根目录残留：`gen_legs.py`、`pel_verify.py`、
  `pelican_gen.py`、`pelican-bike.html`。几何与渲染测试读取的 `pelican-bicycle.html` 保留。
- 规则、已有测试、fixture、许可、仓库可见性、发布 tag、恢复分支和历史台账原文保持原样。
- 单分支 checkout 最初报出缺失历史引用；完整获取远端 ref 与 tag 后 docs-check 通过，未改判据或添加豁免。

配置和文件整理通过评审分支提交；合并前 default branch 仍是整理前版本。
标签属于已经生效的远端元数据。

## 未完成：先把已有工作收口

| 优先级 | 事项 | 当前证据与完成条件 |
|---|---|---|
| P0 | 恢复 GitHub Actions 执行 | `main@41f226e5` 的 verify 任务未启动。check annotation 明确指出账户付款失败或支出额度限制，runner_id 为 0；需所有者处理 [Billing & plans](https://github.com/settings/billing)，之后再跑当前提交。不可把未启动写成代码测试失败或通过 |
| P0 | 依赖告警处置 | GitHub 当前有 24 条开放 Dependabot 告警：6 high、14 medium、4 low。涉及 electron、body-parser、undici、vite、hono、zod、fast-uri、@vitest/mocker。按实际路径逐项确认影响和兼容修复，更新依赖需独立 PR 和回归；告警数不等于已验证可利用漏洞数 |
| P0 | 开发线与治理线集成 | 多 138 / 少 3 的分叉不能用一次覆盖推送解决。先列代码与治理差量、处理冲突，再对包含实现的同一提交跑 core、desktop、build 和门禁 |
| P1 | 本地未提交功能入库 | 记忆、自进化、DeepSeek、品牌/设置/用量与研究工具在本地另有成果；分别检查文件归属、依赖和测试后集成，不能把它们算成 GitHub main 的现状 |
| P1 | 编排设计与实现对账 | 开发线已有本地纵切，但动态 Flow、远程 worker、并发能力和真实桌面验收仍有边界；先对齐设计、实现提交和交付报告，再补缺口或正式缩范围 |
| P1 | 会话与桌面真实验收 | 连续发送、指针分叉、插话、取消/恢复、多窗口、编排控制面要在拟交付构建复验；单元测试不替代真实会话证据 |
| P1 | 分支保护能力 | 当前分支未受保护；rulesets API 返回 403，要求升级 GitHub Pro 或改为公开。保持私有，不擅自变更付费计划；PR 与本地门禁不能冒充服务端保护已启用 |

[本次 main verify 诊断](https://github.com/W117C/cairn-harness/actions/runs/40205529261)、
[Dependabot 告警](https://github.com/W117C/cairn-harness/security/dependabot)、
[全部分支](https://github.com/W117C/cairn-harness/branches)。

## 待开工：满足条件再启动

| 事项 | 启动条件 |
|---|---|
| 远程 worker、动态 Flow、更高并发 | 从现有编排缺口拆独立任务，先定权限强制、取消与断线恢复协议 |
| 编排 P5 真实评测 | 独立验收、明确费用预算和完整失败回执；scripted 运行不证明真实收益 |
| 元认知扩大确认试验 | 开发线有界 pilot 与大样本采用结论分别记账；更多未见任务、固定预算和重复配对后再决定默认启用 |
| SDK/API、A2A、其他领域包 | P6 留门，先确认真实使用需求 |
| 对外分发、Windows、官网 | 依 [B2 清单](b2-checklist.md) 的触发条件重开范围、安装和平台验收 |
| 历史工件与恢复分支归档 | 先建立台账/判据依赖清单和可恢复凭证，再决定清场；不整片删 outputs 或 rescue |

## 需要优化：有读数后做最小改动

- **文档同步**：main、开发线、本地工作树、发布 tag 各写自己的事实；旧计划空勾不自动变成新任务。
- **证据检索**：给现役任务短索引，再讨论归档；旧日志仍可能是门禁和审计依赖。
- **长会话与大 diff**：测真实规模的投影/渲染长尾后，再选增量或虚拟化。
- **首屏与下拉依赖**：同时量 bundle、首次展开延迟，再决定延迟加载。
- **设置、文件面板与无障碍**：围绕失败恢复、键盘和焦点做真实路径验收。
- **成本统计**：缺失或部分 usage 保留 unknown，核对取消/恢复、缓存和跨模型价格。
- **验证成本**：按风险先跑相关检查，完整认证绑定可归属提交；账户限制解除前不反复触发无法启动的任务。

## 维护入口

- 当前实现：[STATE.md](../STATE.md)；历史：[PROGRESS.md](../PROGRESS.md)。
- 开发与验证：[CONTRIBUTING.md](../CONTRIBUTING.md)、[AGENTS.md](../AGENTS.md)。
- 缺陷/功能请求：[Issues](https://github.com/W117C/cairn-harness/issues/new/choose)；
  漏洞报告先看 [SECURITY.md](../SECURITY.md)。

