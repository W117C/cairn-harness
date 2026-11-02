# Agent-native SDLC：事实核验与首批交付

核验日期：2026-11-02。结论：方向成立，但原研究低估了 Cairn 已有机制，遗漏了发布后的控制，并把吞吐量与质量/生产率混在了一起。

## 外部来源核验

| 原结论 | 核验与修正 |
| --- | --- |
| Claude 写 Claude Code 自身约 90%；合并 PR 翻倍、回滚占比下降 40%+ | [Claude Code 团队原文](https://claude.dev/blog/solving-code-review-at-anthropic/)支持，限定该团队和 6–9 月窗口；属于团队自报，不能推出全部 Anthropic 或 Cairn 的质量收益 |
| monorepo 每日约 2,500 → 30,000+ | [源代码管理原文](https://www.anthropic.com/research/redesigning-source-control)支持，窗口为 2026 年 5 月至 9 月；这里是 merged code changes，不应换算成 PR 数或生产率 |
| 9 月 90%+ 贡献由 Claude 写、Q3 人均日代码量为 2024 年 45 倍以上 | 找到更强的一手材料：[Anthropic S-1](https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm)，检索 `45 times` / `September 2026`。原 Business Insider 链接本轮无法读取。数字成立，但量纲是代码贡献量，不是价值、生产率或质量 |
| 季度代码量 8 倍、80% 合并代码由 AI 撰写 | [2026-07-21 安全生命周期原文](https://claude.com/resources/articles/how-anthropic-secures-its-ai-native-software-development-lifecycle)支持，比较期 2021–2025；与 9 月数字的时间、口径不同 |
| 五层流水线，人力只守领域专业 | 原文还列出 merge queue/flags/渐进发布及快速发现/回滚；人审明确分 0/1/2 人，并有受信作者、敏感路径和提交级批准约束。人仍负责变更与事故。不能只搬前五项或理解为零责任自动合并 |
| 并行找 bug，另一组投票验证，finding 必须回应 | 团队原文支持，也支持 Important/Nit/Pre-existing 标签。A/B 说明针对过滤器；未公布投票阈值、通用提质幅度，不应编造或保证迁移收益 |
| 数百个 skills、九类、产品验证效果最大、Gotchas 与脚本复用 | [skills 经验原文](https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/)支持，属于内部经验，缺少可直接迁移的对照数据 |
| 16 agent、近 2,000 session、约 $20,000、10 万行、Linux 6.9、Git 抢任务 | [编译器实验原文](https://www.anthropic.com/research/building-c-compiler)支持；产物是用 Rust 写的 C 编译器，研究原型的长跑循环不等于可直接用于桌面的生产方案 |
| Boris 5–10 本地 tab、几十个 loop、隔夜上千 agent、每个改动都浏览器验证 | [给出的二手笔记](https://www.bryanwhiting.com/ideas/how-boris-uses-claude/)没有支持整段细节；原 X 链接本轮 403。保留“提供验证手段/后台验证”的有限支持，删去未核实的规模和绝对说法 |
| JIT、dogfood、扁平化、允许淘汰旧流程 | [组织经验原文](https://claude.com/resources/articles/running-an-ai-native-engineering-org)大体支持；主要是 Claude Code/Cowork 团队经验，“manager 先做 IC”不能无条件外推成全公司非谈判制度 |

## Cairn 当前实测

实际目录 `/Users/ze/Downloads/Cairn/cairn`，分支 `fix/spec-summary-double-count`，HEAD `fc834f9e8ab7d5e53c573f32d0838534c3ad734d`，origin 为 `W117C/cairn-harness`。无 `.codegraph/`，本轮用 `rg` 和定向读取。
起始 dirty 文件哈希快照含 97 个普通文件，原报告“约 30”已过时；后续内容保护结果见 [VALIDATION.json](VALIDATION.json)。

| 原对照 | 实际情况与影响 |
| --- | --- |
| 35 个 check + manifest | 当前 package 中 `-check`/`:check` 形态确为 35 项，`GATES` 为 40 项。数量不能证明比 Anthropic 更严，也不证明全部有意义或全部执行过 |
| 完全缺自我验证 | 不成立。`src/agent/verify.ts`、`src/agent/loop.ts` 已有执行/补拍/返修路径；`src/main/settings.ts` 默认 `autoVerify: true`、`autoVerifyRepair: false`。开发时如何选验证、如何交证据仍值得补 |
| 完全缺审查层 | 过度概括。`src/agent/diff-review.ts` 是 worker diff 的逐文件选择，不是独立 AI bug 审查；已有 `src/agent/security/llm-review.ts` 与 `merge-gate.ts`。worker 安全门不等于每个 GitHub PR 的强制多 agent 审查 |
| `.agent/skills/` 空 | 成立，但 `.gitignore` 主动忽略该目录。已有 `discover.ts` 支持 `.agent/plugins/` 中 loose skill，生产装配 `pluginRuntimeOpts` 也扫描该根；本轮复用它，保持内容信任门 |
| 编排仍 shadow，必须先打开才让前六项多 agent 生效 | 后半不成立。`OrchestrationService` 默认 `enabled: false`，有显式 execute 与 backend 校验；desktop 已接 backend factory。`evolve/shadow.ts` 是另一套经验回放。开发侧验证/宿主独立 agent 不依赖启用产品编排 |
| 缺区域 REVIEW、PR rollback 模板和人时指标 | 未发现 `REVIEW.md` 或 PR 模板；本轮未找到 approvals/P95/等待人工的维护工具。只能说未发现，不能据此断言远端所有设置/数据不存在 |
| 第 4 层已经很强 | 有静态、测试及 HEAD 认证基础；本轮查到远端最近两次运行失败、再前一次成功，不能宣称当前 CI 全绿，具体运行不等于本地 HEAD 的判定 |

远端快照（仅只读查看）：[41302438899](https://github.com/W117C/cairn-harness/actions/runs/41302438899) 为 `f9fc87e8` failure；[41299822672](https://github.com/W117C/cairn-harness/actions/runs/41299822672) 为 `461768ca` failure；[40542828589](https://github.com/W117C/cairn-harness/actions/runs/40542828589) 为 `2e6ccd28` success。本轮不修无关 CI，也未核实 GitHub branch protection。

## 复用方案与本轮范围

考察了 [anthropics/skills 的 webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)（Python/Playwright 与 server helper；许可证指向该 skill 的 LICENSE.txt，本轮未做独立商用许可确认）和 [claude-code-security-review](https://github.com/anthropics/claude-code-security-review)（MIT；需 Claude API 凭据、API 成本及 PR 评论权限，上游还说明不具备 prompt injection 加固）。它们分别偏通用网页和远端安全评论，不取代本仓 Electron 探针、门禁选择或信任机制；本轮未安装、执行或复制第三方代码，未增加依赖。

采用[设计稿](../../docs/superpowers/specs/2026-11-01-agent-native-sdlc-design.md)中的首批范围：两个可跟踪 loose skills + 复用既有 runner/探针 + 实际内容加载验收。没有新增一套运行器，没有修改已有规则或全局配置。
PR 投票审查、区域 REVIEW、PR 回退模板、指标、远端必需检查、merge queue/灰度都保留为后续设计；不是本轮已实现的功能。编排默认态保持原样。

## 验收与限制

基线独立试用已能正确指出 docs/typecheck、untracked、信任和证据边界问题；没有观测到可据以宣称“skill 显著提质”的失败对照。本轮把 skills 定位为项目参考入口，未编造提质幅度。

实际运行记录、指定测试数、首次缺工件失败、复测与内容保护见 [VALIDATION.json](VALIDATION.json) 及同目录日志。所有测试使用当前工作树；技能信任只在测试临时目录写入，没有替用户批准真实项目内容。

独立前向试用分别检查了 docs/skill 选门与 UI 证据边界；据此明确了最小 frontmatter 验收入口和 layout-smoke 的交互覆盖限制。它们是可用性检查，不是证明效果提升的实验。
OCR 已使用 `delegate preview --exclude` 收窄范围及 `delegate rule <明确路径>` 解析规则；默认 preview 把本轮 Markdown/日志列为 unsupported_ext、测试列为 default_path，未自动选入。当前 agent 据显式规则复审本轮五个主要文件，不能把 OCR 的文件选择或规则解析说成 AI 审查已通过；未调用 `ocr review`/`ocr scan`。

未做：全量 core/desktop、Electron UI smoke、真实 provider、完整桌面重启、跨机/跨平台、打包/发布、真实新模型会话选择率、HEAD 认证或变异验证。本轮新工件尚未提交/推送，Git clone 分发也尚未完成。
