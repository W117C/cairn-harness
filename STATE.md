# Cairn / DSH —— 现态

rev: f57fe7decef08831f15038ea4ca8c6d307b84997

核对日期：2026-11-07（Asia/Shanghai）。`rev` 是已推送的开发基线，不表示已合入 `main` 或完成发布认证。
仓库与分支的现役入口是[仓库状态与分支](docs/REPOSITORY-STATUS.md)；测量和历史证据放在 `outputs/`、`PROGRESS.md` 与 `archive/`，本页只写状态与下一步。

## 当前工作

- 开发分支 `fix/spec-summary-double-count` 有尚未推送的本地提交。共享工作树当前**不干净**：含此前设置面批次、点击蓝框修复、桌面/内核审计批次以及本次 **AGI 级系统提示词与工具规格全面演进批次**（全域对齐科学假设、全景架构保护与最小影响面、工具说明书工业级 SOTA 升维、行动优先解码与局部受阻自包含推进、认知诚实与信息经济，覆盖基座、会话工具规格、子代理、辅助对话、长程压缩、续跑导引、安全审查与编排），全部判卷、门禁与 typecheck 已过，未提交。
- 2026-11-05 系统提示词全英文 SOTA 与天枢 CVM 认知体系批次（第 1030、1031、1032、1033 页）：基于全球前沿 SOTA 正典、GitHub 开源项目 `huiliyi37/Tianshu-harness`（天枢，认知虚拟机 CVM 架构）与 `deepseek-ai/deepseek-harness`（DeepSeek 官方 dsh），全面将系统提示词体系升级为 100% 纯英文标准。提炼并注入 Prefix-Cache-First 提示词装配机制（首段静态提示词冻结自洽，4,899B < 5,000B）、TaskContract（任务契约）与防认知锚点塌缩（Anti-Anchor-Collapse）、交付与证据分离、科学假设因果溯源与特异性红绿实验、禁绝掩盖式防御（禁止 ?. / 伪默认值 / 空 catch 吞异常掩盖病灶）、架构守恒与手术刀精度。涵盖主基座、只读/可写 worker、旁路 sidechat、上下文压缩摘要（/compact 模板）、任务验收契约信封（acceptance-contract）、代码安全审查 llm-review 与智能补全 suggest-next。全部核心测试套件、`prompt-surface-check`（dead 0 / odd 0）、10 处变异针脚（100% 完好）、根 `typecheck` 与 `docs-check` 100% 全绿。
- 2026-11-05 审计批次：56 条 findings 已由三组只读核验复核；本批落地桌面 12 条、内核 11 条，另有 6 条在核验时已有工作树修复。权限/沙箱项（`#43–#49`）与性能/架构项延后，`#36` 受冻结语料约束。证据在 `outputs/desktop-core-audit-2026-11-05/`。
- 2026-11-06 zcode 收口批次（第 1036 页）：工具层补齐 worker `git_read` 三面同源与浏览器驾驶三件的权限/规格/实测；编排层落地 verify surface 与预测压缩取消、worker diff 失败 fail-visible、runAgent 异常收队、事件驱动 `waitAll`、B9 跨轮增量投影，并拆出 `worker-finish.ts` / `worker-runtime.ts`。桌面端重建 dist、新增可复跑设计画廊，产出 41 张唯一截图、拼图、`checks.json` 与 22 条分组问题清单；loop 质量档 A/B 与新增纯判据执行路径已落地。全量 core `654 文件 / 7909 条`、桌面 `331 文件 / 2280 条`、根 typecheck、tools-check、docs-check 均在工作树现跑全绿；未提交。
- 2026-11-07 桌面端设计集中修复（第 1037 页）：按第 1036 页 22 条问题清单统一 GateSlot 三卡骨架与语义 token、目的地页 chips/语义分组/空态密度、设置三档模板与警示语义、暗色表面与证据块、960/1200 容器断点、固定问候与低样本图表退化。重建 dist；主画廊与设计画廊均复跑通过（`shots=41 / unique=41 / duplicates=0 / misses=0 / pageErrors=0`）；全量桌面 `331 文件 / 2284 条`、core `654 文件 / 7909 条`、根 typecheck、docs-check、renderer-layer-check、desktop-boundary-check、gate-check、prompt-surface-check、tools-check 均在工作树现跑全绿。假 API 截图不代替真机 dev 验收；未跑 `pnpm gates` / `head-cert-check` / `mutate-verify`，未提交、未推送。
- 开发线与 `origin/main` 已分叉，且双方各有对方没有的提交。直接把开发线合进主线会在锁文件、CI 配置与核心源文件上撞冲突，必须先做集成。

## 代码入口

- core 在 `src/`，应用服务在 electron-free 的 `src/main/`；desktop 在 `apps/desktop/`，依赖方向与 IPC 规则见 `AGENTS.md`。
- 系统提示词体系集中在 `src/agent/system-prompt.ts`、`src/agent/worker-prompt.ts`、`src/agent/sidechat.ts`、`src/agent/compaction.ts`、`src/agent/security/llm-review.ts`、`src/orchestration/local-backend.ts`、`src/main/suggest-next.ts`。
- 符号和稳定契约见 [CODE-WIKI](docs/CODE-WIKI.md)；功能使用见 `README.md`。

## 下一步

- 在隔离工作区做 dev → main 集成：先解 `pnpm-lock.yaml`、`package.json` 与 `.github/workflows`，再按 `src/main`、`src/agent`、`apps/desktop` 三组逐个核对，保留双方功能。
- 集成分支的判据：两套套件 + 根 typecheck + `docs-check`；任一项红不进 `main`。

## 验证与交付边界

- 本轮落库证明的是当时工作树与合并后 HEAD 的套件读数；`pnpm gates`、`head-cert-check`、`mutate-verify` 未跑，历史认证不转移到新提交。
- 远端 CI 以本次推送产生的运行结果为准，不用历史运行推断当前提交。
