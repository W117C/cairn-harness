# 工作区清理记录（2026-10-25）

范围：`/Users/ze/Downloads/Cairn`（工作区）＋ `/Users/ze/Downloads/Cairn/cairn`（git 仓）。

| 时点 | workspace | repo | 说明 |
|---|---:|---:|---|
| 清理前（22:00） | 3.3G | 2.6G | `du -sh` |
| 第一段结束（22:01） | 1.8G | 1.6G | 孤儿树/缓存/基线 |
| 第二段结束（22:08） | 1.6G | 1.4G | 含 `archive-stale-worktrees-2026-10-25/` 100M 归档；不含归档约 1.5G |

并发说明：22:02–22:07 另一会话先新建 `.worktrees/verify-100fc3b`（124M）又自行回收，并提交了一笔（HEAD `146743c` → `ae33e09`）。`git status` 从 160 M / 116 ?? 变为 **162 M / 168 ??**（其中两条是本记录 README 与 patch，其余为另一会话在飞文件）；非本清理造成。

## 已清（可重建 / 无引用 / 已核对）

| 对象 | 体量 | 判据 | 恢复方式 |
|---|---:|---|---|
| `.worktrees/gate-mutate-verify/` | 711M | 未注册的孤儿树：`.git` 指向已不存在的旧仓路径 `/Users/ze/Downloads/Cairn/deepseek harness/...`，`git worktree list` 无此树，`git worktree prune --dry-run` 为空 | `pnpm mutate-verify` 会重建 |
| `.worktrees/pointer-plan/` | 123M | 同上（未注册孤儿树）；对 `agent/pointer-session-refs` 树做临时索引 diff，`git diff --quiet` 退出 0（**已跟踪文件**逐字一致） | 分支仍在：`agent/pointer-session-refs` |
| `/private/tmp/cairn-metacognition-work-2026-10-25/` | 163M | 已注册工作树，但内容与主树逐文件一致（`rsync -rcn` 0 差异）；唯一不同的 `scripts/metacognition-study.ts` 主树版本更新（10:51 > 01:56） | 重跑 metacognition 批次；主树已有同内容 |
| `.code-review-graph/` | 572M | 生成物（`graph.db` 464M + `graph.html` 107M），最后写入 2026-10-23 21:00，无进程占用，仓内无代码引用 | 由对应工具重新生成 |
| `.codegraph/`（工作区根） | 411M | codegraph 索引缓存，daemon 已于 2026-10-25 19:46 干净退出（SIGINT）；gitignore 已覆盖 | `codegraph index` |
| `.mimosa/hook-state/*.baseline`（仓内 3 个 + 工作区 4 个） | 354M | 会话文件基线；无 zcode/mimosa 进程；同目录 `session_*.json` 会话账本均保留 | 基线随下一次会话重建 |
| `.tmp/` 内容 | 1.2M | 判卷/脚手架残渣（与第 495 页同口径，保留目录） | 每次判卷再生成 |
| `.playwright-mcp/` | 128K | 浏览器 MCP 日志/页面快照 | 工具再生成 |
| `prov-probe{1..4}.png`、`pelican_gen.py.removed`、`.DS_Store` | ~0.2M | 调试截图、已退役脚本、系统垃圾 | 无 |
| `~/.codex/worktrees/pointer-closeout/deepseek harness/node_modules/` | 592M | 陈旧 worktree 的依赖目录 | `pnpm install` |
| 同上，源码整体 | 149M | 归档后才删；相对 `codex/pointer-final-closeout` 有 12 个未提交文件（+180/−65），另有 246 个未跟踪 `outputs/` 文件与 2 个未跟踪测试——不能只用 patch 代表 | 见下方归档 |
| `.worktrees/wt-evo-registry-replay/` | 93M | 未注册孤儿树；分支 `agent/evo-registry-replay` 的 tip `beb22976` 存在，但树内 `0b0446…` 子树对象缺失，可能是唯一完整副本 | 见下方归档 |

### 第二段的两份全量归档

目录：`/Users/ze/Downloads/Cairn/archive-stale-worktrees-2026-10-25/`（仓外，不计入 git）

| 归档 | 体量 | 文件数 | 校验 |
|---|---:|---:|---|
| `codex-pointer-closeout-worktree-2026-10-25.tar.gz` | 63M | 5708（源 5710，排除 `.git` 文件等） | `gzip -t` 通过 |
| `wt-evo-registry-replay-worktree-2026-10-25.tar.gz` | 36M | 4975（源 4976，排除 `.git` 文件） | `gzip -t` 通过 |

恢复：`tar -xzf <归档> -C <目标目录>`。codex 的 12 个已跟踪改动另存 `codex-pointer-closeout-uncommitted.patch`（617 行 / 40K），`git apply --cached --check` 对 `845486d6` 通过。

删除方式：`git worktree remove --force` 因该树 `.git` 指向旧仓路径报 `validation failed ... is not a .git file` ⇒ 手工 `rm -rf` 工作树 + 删 `.git/worktrees/deepseek-harness` + `git worktree prune`；`wt-evo` 未注册，直接删除目录。

## 保留（有明确用途）

- `outputs/` 145M：证人档案；`repo-hygiene-check` 面①按已跟踪文件占比度量，历史取料不追溯删除。
- `node_modules/` 575M：构建与判卷所需。
- `.worktrees/orchestration-kernel/` 409M（27 项脏）：唯一剩余的在飞工作树；`orchestration-platform` / `verify-100fc3b` 已由另一会话自行回收。
- `agent-canon/` 36M、`cairn-refs/` 54M：已裁「留」的只读参考面。
- `.git/` 228M：仓库对象库，未做 gc/repack。
- `archive-stale-worktrees-2026-10-25/` 100M：上面两份归档，确认不再需要后可整目录删。

## 未动 / 待裁决

1. **工作树 162 modified + 168 untracked**：来自其他会话的在飞改动（apps、src、tests、outputs、docs…），按 AGENTS.md「保留无关脏改动」未触碰。
2. **仓根已跟踪散件**：`de.md`（32K）、`jev.html`（732K）、`pelican-bike.html`（16K，无引用；第 495 页曾裁「删除」但仍在库）。删/移都需一笔提交，暂不动。
3. **`.graphflow/` 56M**：AST 缓存，可重建，体量不大，暂留。

## 已知问题（清理前既有，本轮未动 `.git`）

- `git fsck --connectivity-only` 报 **40 条** broken link / invalid reflog：来自旧分支与旧 reflog（如 `d0708a0` 的父提交 `76712668…` 缺失；`5056b21c` 子树缺 blob）。`d0708a0` 不是 HEAD 的祖先；在现 HEAD `ae33e09` 上 `git archive HEAD` 成功（116M tar），当前树完整可读。
- 未做 `git gc` / `reflog expire`：共享仓多会话在飞，改写对象库需独占窗口。

## 复验命令

```sh
git -C /Users/ze/Downloads/Cairn/cairn status --porcelain | awk '{print $1}' | sort | uniq -c
du -sh /Users/ze/Downloads/Cairn /Users/ze/Downloads/Cairn/cairn
du -sh /Users/ze/Downloads/Cairn/cairn/.worktrees/*
ls -lh /Users/ze/Downloads/Cairn/archive-stale-worktrees-2026-10-25/
```
