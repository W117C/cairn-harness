# 仓库与分支整理凭证

核对日期：2026-11-02（Asia/Shanghai）。开发基线 `3ffcbeac3911e1d7a6d5061d4bac5e6c733d9085`，远端主线 `2e6ccd282577b1670f9caae23990fec811ef39d9`。
本轮复用 Git、GitHub CLI、现有 neat-freak inventory 与仓库门禁，没有引入依赖或修改运行时代码。范围是 cairn；同级项目仅枚举名称，未做内容清理。

## 已执行的整理

- `git fetch --no-prune origin` 更新远端信息，未删除跟踪引用。
- 验证本地 main 为远端 main 的祖先，且没有 worktree checkout main 后，使用无 force 的 `git fetch origin refs/heads/main:refs/heads/main` 安全快进 main；设置其 upstream 为 `origin/main`。原 tip 为 `3a6d63c1db6829e1aa1bc629b1d7d9e5340b695b`，无本地独有提交，快进前落后 1721 笔。
- 当前 checkout 和产品源码保持在开发线；未 merge、rebase、reset、stash、gc、prune 或删除 branch/worktree。
- 将原 `docs/REPOSITORY-STATUS.md` 完整保存在 `archive/repository-status-before-2026-11-02.md`，重写现役状态入口与 STATE，修正文档索引。已有 AGENTS、skills、全局配置、记忆与在途 PROGRESS 没有改写。

## 分支矩阵

`behind / ahead` 分别是目标独有、本 ref 独有的提交数；不是代码行为等价性或漏洞结论。真实远端与缓存引用分开核对，见 [remote-heads.txt](remote-heads.txt) 与 [branches.json](branches.json)。

| 本地分支 | tip | 相对 origin/main | 相对开发基线 |
| --- | --- | --- | --- |
| `agent/修复-todo-worker-11` | `781fabee` | 37 / 187 | 11 / 0 |
| `agent/修复-todo-的-completedcount-2-worker-12` | `be9c0be5` | 37 / 190 | 8 / 0 |
| `agent/修复-todo-的-completedcount-worker-10` | `781fabee` | 37 / 187 | 11 / 0 |
| `agent/修复-todo-的-completedcount-worker-12` | `49ea7686` | 15 / 0 | 198 / 22 |
| `fix/code-scanning-alerts` | `855b5ebe` | 14 / 0 | 198 / 23 |
| `fix/code-scanning-closure` | `82199500` | 4 / 0 | 198 / 33 |
| `fix/codeql-finalize` | `4910ae3d` | 3 / 0 | 198 / 34 |
| `fix/session-drift-snapshot` | `89d6d1b3` | 1 / 0 | 198 / 36 |
| `fix/spec-summary-double-count` | `3ffcbeac` | 37 / 198 | 0 / 0 |
| `main` | `2e6ccd28` | 0 / 0 | 198 / 37 |
| `rescue/wip-20261025` | `f347479e` | 37 / 2 | 198 / 2 |

真实远端 11 个，本地分支 11 个；另有两个 stale tracking refs：`origin/fix/code-scanning-closure`、`origin/fix/session-drift-snapshot`。`git remote prune origin --dry-run` 确认它们会被 prune；实际未执行。
PR #18/#19 已合并。开放 Dependabot PR 为 #4/#6/#7/#9/#11/#12，本轮未操作 PR 或实际远端分支。

## 集成风险

主线与开发线分叉为 37 / 198 笔。`git cherry -v HEAD origin/main` 列出 25 个主线非 merge 提交，均未找到相同 patch-id；这不能排除开发聚合提交独立实现了部分相同机制，需逐项核对。
主线现有 `.github/PULL_REQUEST_TEMPLATE.md`、`.github/CODEOWNERS`、`.github/workflows/codeql.yml`、`CONTRIBUTING.md`、`SECURITY.md` 等，开发线未完整承接。
因此“Cairn 缺这些能力”必须标明分支；下一步是隔离集成与安全契约回归，不是直接再造一套。

只读预演命令 `git merge-tree --write-tree --name-only --no-messages origin/main HEAD` 返回 1，生成临时对象但不更新分支、index 或工作树；24 个冲突路径在 [merge-preview.json](merge-preview.json)，原文在 [merge-preview.log](merge-preview.log)。
冲突涉及依赖、主进程、renderer、插件信任、事件/工具与文档，不能在活跃共享 dirty 树里直接合并。

## 工作区与对象库

主 checkout 初始逐文件 dirty 哈希为 102 项；[dirty-baseline.json](dirty-baseline.json) 与 [worktree-details.json](worktree-details.json) 记录范围。目录折叠的 status 行数与逐文件数不是同一口径。
在途改动按路径粗分 UI、session-id、LSP、CI 引用、evolve 判卷及其他；这是排期提示，不是确认作者或可安全提交的批次。

- alerts worktree：3 个 untracked provenance，保留待归档核对。
- closure worktree：日志源码与 kernel-host 判卷有独有差分，保留；未评价或应用这两处安全相关修改。
- gate-mutate-verify：干净 detached 工作树，仍是 package 中的认证入口，作为基础设施保留。

观察到的目录分配量：`.git` 365M、`.tmp` 68M、`.worktrees` 2.5G、`outputs` 177M、`archive` 32K；这是当次 `du -sh` 口径，可共享硬链接，不能直接相加当独占可回收空间。
`git count-objects -v` 报 1 个临时 pack garbage（`.git/objects/pack/tmp_pack_HxsbSU`）及 loose/prune-packable 对象；未据此删除对象。
`git fsck --connectivity-only --no-reflogs` 返回 0，列出 dangling 对象，未报可达对象缺失。它不是完整散列校验；未审计全部不可达恢复历史。未运行 gc/对象 prune，保留恢复线索。
根 AGENTS 为 7996 / 8000 字节，接近项目预算；本轮保持原样，新增规则前应先处理预算与授权。

## 事实面状态

| 面 | 状态 | 边界 |
| --- | --- | --- |
| Git refs/分支/worktree | changed-and-verified | main 已安全快进；分支与现场已盘点，删除待确认 |
| 代码/测试实现 | out-of-scope | 不修改产品代码，不重新认证所有产品行为 |
| 文档 | changed-and-verified | 现役入口重写，旧说明保存在 archive；门禁见 VALIDATION |
| 规则 | verified-current | 已读取适用规则，未修改；未证明所有历史实践都合规 |
| 生成记忆 | out-of-scope / generated-read-only | 无记忆写入授权，未修改 |
| 发布/真实运行态 | out-of-scope | 无部署、签名、provider、完整重启或外部用户验收 |
| 清场 | pending | 保留用户复核现场，未执行删除 |

## CI 与验收

开发提交的 [Actions run](https://github.com/W117C/cairn-harness/actions/runs/41367783174) 在本次读取时仍为 in_progress，见 [latest-ci.json](latest-ci.json)；主线历史成功不能替它背书。
本轮检查文档规则、类型面、归档原文一致性、文件链接与改动范围，结果见 [VALIDATION.json](VALIDATION.json)。没有全量 core/desktop、产品 smoke 或提交级认证。

## 待确认清理

仅提出以下六个本地 ref 和两个失效 tracking ref：

- `agent/修复-todo-worker-11`
- `agent/修复-todo-的-completedcount-worker-10`
- `agent/修复-todo-的-completedcount-2-worker-12`
- `agent/修复-todo-的-completedcount-worker-12`
- `fix/codeql-finalize`
- `fix/session-drift-snapshot`
- `refs/remotes/origin/fix/code-scanning-closure`
- `refs/remotes/origin/fix/session-drift-snapshot`

其中前三者的 tip 已由已推送开发线覆盖，另外三个本地 tip 已由 main 覆盖；所有候选不被 worktree checkout。删除前必须再次检查对象、远端现状与活动工作区。实际远端分支、所有 worktree、救援/迁移 ref、开放 PR、源码与历史证据不在该清理范围内。
依据 neat-freak 的顺序要求，先交付完整清单与结果，用户在看过报告后明确确认才清场。本轮不替未来删除签发空白授权。

## 用户确认后的清理结果

2026-11-02，用户在阅读上述清单后回复“执行”，已完成所列六个本地分支及两个失效远端跟踪引用的删除。原始盘点与候选清单保留为历史上下文；现态以 `docs/REPOSITORY-STATUS.md` 和 [CLEANUP.json](CLEANUP.json) 为准。

- 删除前重新验证各 tip 未改变、已由保留的主线/开发线覆盖、未被 worktree checkout，且两个真实远端分支确实不存在。
- 使用带原 SHA 的 ref 事务执行八项删除，并清除已删本地分支自身的 tracking 配置。没有修改真实远端分支。
- 删除后再次验证八个 ref 已不存在、所有本地 tip 仍可达；HEAD 与四个 worktree 保持原位，未执行对象 prune/gc。
- 与清理前逐文件快照相比，`tests/lsp.test.ts` 在操作期间发生并发修改；操作只写 Git refs/config 与本轮证据，未覆盖或回退该文件。
- 剩余五个本地分支见 [branches-after-cleanup.json](branches-after-cleanup.json)。保留的 closure 分支旧 upstream 已 gone，等独有差分处理时再决定跟踪；共享在途源码与主线集成仍待处理。

清理后 docs-check 通过。根 typecheck 返回 2：`tests/lsp.test.ts` 的 `lspServerStatus` / `formatLspStatus` 导入未被当前模块导出，另有两处隐式 any；日志为 [cleanup-typecheck.log](cleanup-typecheck.log)。这些路径正在并发修改，本轮未更改或回退该批源码；类型面保持失败状态，不用前一轮绿灯替代。

本轮状态文档及清理凭证仍未提交或推送。

## 提交前复核

用户要求提交、推送后，再次运行 `pnpm docs-check` 与 `node --import tsx scripts/typecheck.ts`，两者均退出 0；根类型检查报告零错误。清理时的 LSP 失败日志继续保留，未用绿结果覆盖红样本。本次不提交其他会话仍在修改的 LSP/UI/会话源码；复核结果属于共享工作树，不是隔离 HEAD 认证。

`refs-before-docs.txt` 中空 upstream 显示为 `(none)`，`worktrees.txt` 去掉末尾空行；均为提交时的空白格式整理，结构化原始快照仍在对应 JSON 中。
