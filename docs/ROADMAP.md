# 项目路线与 GitHub 仓库状态

更新日期 2026-11-12（Asia/Shanghai）。本地实现见 [STATE](../STATE.md)，分支与当前 CI 见
[仓库状态](REPOSITORY-STATUS.md)。[产品化四项执行清单](superpowers/plans/2026-11-08-productization.md)
保留 2026-11-08 的方案与当时的签名决定。

## 早期仓库整理记录

- 补齐 Dependabot 配置实际使用的 `dependencies`、`npm`、`github-actions`、`desktop` 标签。
- 去掉相同 ecosystem / directory / target branch 的重复 Actions 更新配置，保留每周分组更新。
  约束来源：[GitHub Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#directories-or-directory)。
- 补上 README 已引用的 `test:capped`，使用既有 Vitest 配置并限制两个 worker；不改 lockfile 或判据。
- README 与文档索引接入本页；CodeQL 对 main 推送/PR 自动运行，并保留手动入口。
- 移除四份无执行消费者的根目录残留：`gen_legs.py`、`pel_verify.py`、
  `pelican_gen.py`、`pelican-bike.html`。几何与渲染测试标本归入 `fixtures/artifacts/cycling-animation.html`。
- 已有测试、fixture、许可、发布 tag、恢复分支和历史台账原文保持原样；公开可见性由仓库所有者修改。
- 单分支 checkout 最初报出缺失历史引用；完整获取远端 ref 与 tag 后 docs-check 通过，未改判据或添加豁免。
- 公开后已启用密钥扫描、推送保护、私密漏洞报告和 Dependabot 安全更新；main 防强推/防删除规则已生效，不新增必需评审人数或改变普通提交方式。
- CodeQL 改为 main 推送/PR 自动分析，修复与上游不符的 `language` 输入为 `languages`；具体成功状态以 Actions 为准。

首批配置和文件整理已随 PR #2 进入默认分支；后续 PR #3、#8、#13 也已合并；后续整理将回归标本归入 `fixtures/artifacts/`。
标签、安全功能和 main 防强推/防删除规则属于已经生效的远端设置。

此前也已去除仓库自检中固定的动画任务命令，并将 render_image 的动画说明改为通用轨迹与循环检查；测试标本和检查器保留。

## 未完成：先把已有工作收口

| 优先级 | 事项 | 当前证据与完成条件 |
|---|---|---|
| P1 | 交付证据收口 | 公开 `main` 的 verify 与 CodeQL 见[仓库状态](REPOSITORY-STATUS.md)。完整 HEAD 认证、变异复验、安装与跨机器 Electron 交付证据按拟交付版本取证 |
| P0 | 扫描与依赖告警处置 | 对照 GitHub 的 Code Scanning 和 Dependabot 开放项核验实际影响，按更新范围运行回归 |
| P0 | 开发线后续集成 | 已提交的开发历史与权限修复已合入本地集成。未提交改动与独有功能继续按原工作树复核，公开移植先核对许可与文件范围 |
| P0 | 冻结评测的 shell 写边界 | 尚需在执行层验证冻结路径写保护，保留现有判据 |
| P1 | 本地成果发布与集成 | 本地成果已另行入库，仍需与远端逐批核对文件归属、依赖、测试和发布状态；本地提交不等于 GitHub main 已支持 |
| P1 | 编排设计与实现对账 | 开发线已有本地纵切，但动态 Flow、远程 worker、并发能力和真实桌面验收仍有边界；先对齐设计、实现提交和交付报告，再补缺口或正式缩范围 |
| P1 | 会话与桌面真实验收 | 连续发送、指针分叉、插话、取消/恢复、多窗口、编排控制面要在拟交付构建复验；单元测试不替代真实会话证据 |

[Code Scanning](https://github.com/W117C/cairn-harness/security/code-scanning)、
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
| 公开历史材料审阅与归档 | 盘点到 129 份会话/评测事件日志，其中 31 份含用户主目录路径文本；尚未逐段完成隐私审阅。先查自然语言内容、台账/判据依赖与恢复凭证，再裁保留/归档；不整片删 outputs 或 rescue、不擅自重写公开历史 |

## 需要优化：有读数后做最小改动

- **文档同步**：main、开发线、本地工作树、发布 tag 各写自己的事实；旧计划空勾不自动变成新任务。
- **证据检索**：给现役任务短索引，再讨论归档；旧日志仍可能是门禁和审计依赖。
- **长会话与大 diff**：测真实规模的投影/渲染长尾后，再选增量或虚拟化。
- **首屏与下拉依赖**：同时量 bundle、首次展开延迟，再决定延迟加载。
- **设置、文件面板与无障碍**：围绕失败恢复、键盘和焦点做真实路径验收。
- **成本统计**：缺失或部分 usage 保留 unknown，核对取消/恢复、缓存和跨模型价格。
- **验证成本**：本地核心套件用 `pnpm test:capped` 限制为两个 worker。完整认证绑定提交，CI 未证条目随运行记录保留。

## 维护入口

- 当前实现：[STATE.md](../STATE.md)；历史：[PROGRESS.md](../PROGRESS.md)。
- 开发与验证：[CONTRIBUTING.md](../CONTRIBUTING.md)、[AGENTS.md](../AGENTS.md)。
- 缺陷/功能请求：[Issues](https://github.com/W117C/cairn-harness/issues/new/choose)；
  漏洞报告先看 [SECURITY.md](../SECURITY.md)。
