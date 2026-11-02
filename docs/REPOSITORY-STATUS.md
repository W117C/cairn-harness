# 仓库状态与分支

核对日期：2026-11-02（Asia/Shanghai）。对象是 `/Users/ze/Downloads/Cairn/cairn`；同级 staging、备份和研究目录未纳入内容修改或删除。
这是现役入口。旧整理记录已保存到[历史快照](../archive/repository-status-before-2026-11-02.md)，历史测试数字与发布声明以各自提交和证据为准。

## 当前结论

- 本页核对的开发基线为 `fix/spec-summary-double-count@3ffcbeac`，同名远端已包含该提交；后续提交以 Git 记录为准。共享工作树仍有其他会话的在途改动。
- 本地 `main` 已从 `3a6d63c1` 安全快进到 `origin/main@2e6ccd28`，并设置 upstream；未切换 checkout、未改工作树源码。
- 以该开发基线为准，主线独有 37 笔提交、开发线独有 198 笔；只读 merge-tree 预演给出 24 个冲突文件。提交图与 patch-id 不是漏洞判定，不能仅凭未合并就声称产品有漏洞。
- `origin/main` 已有 PR 模板、CODEOWNERS、CodeQL、贡献/安全文档及安全修复提交。当前开发线缺失其中的文件或未按提交图集成；先处理集成，再决定新增治理能力。
- 用户确认后已删除六个本地冗余分支和两个失效跟踪引用；当前保留 5 个本地分支、11 个真实远端分支与 4 个 worktree。清理结果见[清理凭证](../outputs/repository-organization-2026-11-02/CLEANUP.json)，初始快照见[整理凭证](../outputs/repository-organization-2026-11-02/REPORT.md)。

## 本地分支处置

| 分支 | 当前关系 | 决定 |
| --- | --- | --- |
| `main` | 与 `origin/main` 一致 | 保留；主线基准 |
| `fix/spec-summary-double-count` | 活跃开发线，已推送；与 main 分叉 | 保留；在隔离树解决集成，暂不重命名 |
| `fix/code-scanning-alerts` | 提交已在 main，worktree 仍有未跟踪证据 | 保留分支与现场 |
| `fix/code-scanning-closure` | 提交已在 main，worktree 仍有未提交源码与判卷 | 保留分支与现场 |
| `rescue/wip-20261025` | 相对 main 与开发线均有独有提交，远端也保留 | 保留，不以年龄判为冗余 |

已清理对象的 tip、保留分支与用户确认记录见清理凭证；删除前已重新验证祖先关系和 worktree 占用，使用带预期 SHA 的 Git ref 事务删除。
`git branch --merged` 只相对一个分支，不能据此批量删除另一条开发线。

## 远端分支

| 远端对象 | 状态与处置 |
| --- | --- |
| `main`、`fix/spec-summary-double-count` | 分别为主线与开发线，保留 |
| `integration/dev-line-with-standardization` | tip `014ac0e3` 是开发线祖先；作为历史集成锚点保留，本轮不删远端 |
| `rescue/wip-20261025` | 保留救援快照 |
| `doc-layer-migration` | 提交图中仍有独有历史；保留待内容等价性审计 |
| 六个 Dependabot 分支 | 对应开放 PR #4、#6、#7、#9、#11、#12，继续逐 PR 判断，未合并/升级/关闭 |
| 原失效缓存 `origin/fix/code-scanning-closure`、`origin/fix/session-drift-snapshot` | PR #18/#19 已合并且真实远端分支已不存在；已按确认删除本地缓存，未操作真实远端分支 |

盘点阶段使用 `fetch --no-prune` 保留复核现场，用户确认后仅删除上述两个失效缓存。远端跟踪引用与真实远端分支分别计数。保留的 `fix/code-scanning-closure` 原 upstream 已不存在，暂显示 gone；待该工作区差分处理时再决定跟踪关系。

## 工作树与在途改动

| 工作区 | 现场 | 决定 |
| --- | --- | --- |
| 主 checkout | 初始逐文件快照 102 个 dirty 文件；后续仍有并发写入 | 保留，按 UI、session-id、LSP、CI 引用与 evolve 判卷分组交回原会话；本次未提交它们 |
| `.worktrees/code-scanning-alerts-855b5ebe` | 未跟踪的三份 head-cert provenance | 保留；先核对主树是否有等价副本，再归档和确认清理 |
| `.worktrees/code-scanning-closure-82199500` | `src/events/log.ts`、`apps/desktop/tests/kernel-host.test.ts` 有独有差分 | 保留；涉及日志安全和漂移判卷，不能当临时文件删除或自动合入 |
| `.worktrees/gate-mutate-verify` | detached、干净；路径仍被 package 脚本引用 | 作为认证基础设施保留 |

`.tmp/`、`outputs/` 和 `.git` 的体量见整理凭证。它们有历史证据或恢复用途，本轮未删除，也未运行 `git gc` / 对象 prune。
`git count-objects` 发现临时 pack 残留，connectivity-only 检查未报可达对象缺失；这不等于完整对象散列校验，也不授权清除 dangling 恢复线索。

## 验证状态与下一步

- 本轮：Git 关系/引用/工作树已核实，文档检查与提交前根 typecheck 复核通过；清理过程曾在在途 LSP 判卷中失败，原始失败日志和复核边界见清理凭证。本轮未改产品源码、平台规则、全局配置与生成记忆。
- 当前开发提交的远端 CI 以具体 Actions run 为准；本轮不将历史主线 CI 绿灯转移到开发线。
- 优先完成开发线与 main 的隔离集成方案与冲突验证，再做自动审查或规则扩展。
- 真实 provider、外部 worker、跨机分区、签名公证、跨平台、真实客户端和发布验收仍需独立任务。本次仓库整理不认证产品发布。
- 现役事实不再追加历史补记；每次更新直接改本页，旧记录留在 archive/PROGRESS/outputs。

## 清理结果

首批清理已按用户确认完成：六个本地冗余分支、两个失效远端跟踪引用均已删除，提交仍由保留分支覆盖。
当前开发线、main、救援/迁移锚点、开放 PR、所有 worktree、在途改动和历史证据继续保留。
清理过程中观察到 LSP 判卷的并发写入，未覆盖或回退；具体路径和校验记录见清理凭证。主线集成与旧工作区独有差分仍待处理。
