# 工作区清理记录（2026-10-21）

## 已清（可恢复/可重建）

| 对象 | 体量 | 处置 |
|---|---|---|
| `.venv/` | 12M | 删除（gitignore；`python -m venv .venv` 可重建） |
| `apps/desktop/preview/dist/` | 1.1M | 删除（gitignore 构建产物） |
| `.tmp/` 判卷残渣 | — | 清空（每次判卷可再生成） |
| 隔离实例 ws/userData/log | — | 删除（/tmp） |
| `codex-workbench-proto/`（仓库外） | 1.6M | 移入 `~/.Trash/codex-workbench-proto-2026-10-21`（无代码/文档引用；仅 PROGRESS 第 16191 页历史提到曾删其 node_modules） |

## 保留（有明确用途，不在「过期无用」栏）

- `outputs/` 66M：已跟踪证据，`repo-hygiene-check` 面①按 70% 帽度量；历史取料不追溯删除。
- `dsh-refs/` 59M、`pel-runs/` 1M、`agent-canon/`：PROGRESS 第 18715 页明定「参考面与实验证据，只读参考」。
- `node_modules/`、`fixtures/`：构建与判卷输入。
- `oh-src/README-moved.md`：指向 `dsh-refs/oh-src` 的迁移指针，文档历史引用仍可达。

## 工作树

- `git status` 的 `D`（未备案删除）为 **0**：并行会话删掉的 16 个已跟踪 PNG 已从 HEAD 恢复，
  `outputs/desktop-official-interactions-2026-10-20/REPORT.md` 的引用不再悬空。
- 仓库内没有 `.DS_Store`/`__pycache__`/空构建目录残留。
