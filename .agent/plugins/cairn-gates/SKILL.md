---
name: cairn-gates
description: Use when choosing checks for a Cairn repository change, investigating gate coverage, or deciding whether working-tree results apply to a commit.
---

# Cairn gates

验证选择参考；命令事实源是仓库根 `package.json`、`scripts/gate-manifest.ts` 和适用 `AGENTS.md`。先读实际定义再执行，门数和耗时不在本 skill 里抄一份。

## 从改动选检查

从仓库根检查分支、HEAD、`git status --short` 和本次拥有的路径。用 scoped `git diff HEAD -- <paths>`；新文件需直接读全文，diff 不包含 untracked 内容。共享 dirty 树的所有改动不自动属于本任务。

下表是选门起点；根据调用方、边界和具体失败补充行为测试，无法归类的路径需读消费者后判断。

| 修改区域 | 优先检查 |
| --- | --- |
| 文档、规则、skill 指导 | 人工核对路径与命令；skill 还需格式与真实加载/调用验证。纯文档无需自动跑全量产品测试 |
| `src/` core 与 `tests/` | 先跑涉及行为的指定 core 测试；跨模块再跑 `pnpm test:capped` |
| core/desktop 依赖、IPC | `pnpm desktop-boundary-check`，两侧相关测试；协议变更还需消费者断言 |
| renderer | `pnpm renderer-layer-check`、desktop 相关测试；行为或视觉变化再 build 与真实 renderer 探针 |
| 事件、replay、fork、session | 阅读相关判卷，按触及契约选 `event-semantics-check`、`replay-determinism-check`、`fork-check`、`session-semantics-check`、`session-search-check` |
| provider、plugin、工具、权限 | 对应 `provider:check`、`plugins-check`、`tools-check`、`security-check`、`sandbox:check`，加该入口的信任/失败路径测试 |
| 模型提示、路由、工具可见面 | 按契约选 `prompt-surface-check`、`model-surface-check`、`routing-check` |
| gate/CI/验证脚本 | 对应脚本的行为测试、manifest/CI parity 测试；检查改动是否需要整表验收，不修改冻结靶子 |

交付前始终按仓库要求运行：

```sh
node --import tsx scripts/typecheck.ts
```

本仓 skill 的最小 frontmatter（name 与非空 description）及加载/调用验收命令如下。它不代替完整的通用 skill 格式校验；宿主提供独立格式校验器时可另跑并记录范围，也不证明所有 core 行为：

```sh
pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=1 tests/cairn-sdlc-skills.test.ts
```

desktop 使用自己的配置。相关测试仍应经过其 package test 链（链尾含 boundary check）；检查本地 Vitest 版本支持的过滤参数：

```sh
pnpm --filter cairn-desktop test
```

静态门可复用现有子集执行器，例如：

```sh
pnpm gates --only=typecheck,desktop-boundary-check
```

它是子集，并保留 runner 的检查；不能报成全表通过。不要默认选 `test` 来替代 capped suite。完整验收确有需要时才跑 `pnpm gates`，先确认里面的 HEAD 检查和资源代价。

## Gotchas

- `pnpm mutate-verify` 与 `pnpm head-cert-check` 验提交；尚未提交的改动不能借它们背书。变异只走既有隔离 worktree 入口。
- 根 typecheck 覆盖根 tsconfig 的面，不能替代 desktop typecheck/build；也不编译 Markdown。文档检查不会执行设计稿命令。
- core 测试不收 desktop；全套 core 在小内存机器上用 `pnpm test:capped`，结果同时记录并发数。负载嫌疑需定向重跑证实，不能直接归为环境。
- 零测试、skip、缺凭据、超时、未运行各自记录；退出 0 不会把它们变成行为通过。
- 新 SKILL 放在被忽略的 `.agent/skills/` 不会自然随 Git 分发。本 skill 复用可跟踪的 `.agent/plugins/` loose 布局；需项目内容信任后才进模型路由，不用恒 trusted 的 env 入口绕过它。

输出本次路径 → 风险/契约 → 选定检查及理由 → 还需的行为证据。检查结果记录准确命令、退出码、测试数/断言、跳过项、工作树或 commit；选择计划本身不是验收结果。
