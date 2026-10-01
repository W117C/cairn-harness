# M9 台账 · 工程化与集成：CI 兜底（2026-10-01，qoder 会话）

**一句话**：L1 自动兜底落地（`.github/workflows/verify.yml`：install → typecheck → 全量判卷 → 快门面 20 道）；
取舍与成本在 `scripts/ci/README.md`（L2 pre-commit 属业主拍板，**本笔不做**）；本地按同组命令全绿复现 +
"故意类型错被同款命令抓到"的反向验证。**不新增任何本地阻塞**。

## 交付

| 文件 | 动作 | 说明 |
|---|---|---|
| `.github/workflows/verify.yml` | 新 | `push`/`pull_request`/`workflow_dispatch`；`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test` → 快门面 `pnpm gates --only=…`（= `CERT_GATES` 减 `gate-check`/`mutate-needles-check` 两道已知红） |
| `scripts/ci/README.md` | 新 | 动因（86 笔红灯 / 钩子是空壳）；L1 覆盖与**排除项逐条登记**（两道已知红 + head-cert 123.7s / mutate-verify 18–25min 为何不进）；runner 选 macos-latest 的理由与"换 ubuntu 前先做什么"；L2 pre-commit 的代价与验收前提；本地复现命令；反向验证做法 |

## 读数与验证

| 证据 | 文件 | 读数 |
|---|---|---|
| YAML 可解析（不是"看着像"） | `yaml-parse.log` | `yaml.safe_load` 结构化成读：name=verify / jobs=verify / steps=7 / runner=macos-latest / on=push,pull_request,workflow_dispatch |
| CI 链本地复现 | `ci-chain-local.log` | `pnpm install --frozen-lockfile`：`Already up to date`（锁文件同步）exit=0；快门面 **20/20 绿 exit=0**；全量判卷 **269 文件 / 3613 条全绿 exit=0**（`../m8-fork-replay-2026-10-01/full-suite.log`） |
| 证据面门复跑（写完 LEDGER/PROGRESS 之后） | `gates-post-evidence.log` | `evidence-typecheck-check` + `docs-check` ✅ exit=0（防"新内容、旧绿灯"） |
| 反向验证（故意类型错） | `reverse-verify-typecheck-probe.log` | `src/__ci-typecheck-probe.ts(1,7): error TS2322` ⇒ **exit=2**（CI 里跑的正是这条 `pnpm typecheck`） |
| 反向验证复原 | `reverse-verify-typecheck-restored.log` | 删探针 ⇒ `tsc --noEmit 通过（0 条报错）` exit=0 |

## 为什么这两道门被排除（是登记不是遗漏）

- `gate-check`：H7 冻结表与 `fixtures/impact/accuracy-repo/*` 双向不一致——**任务 #9**（`1748ca7`）；
- `mutate-needles-check`：4 条锚点针脚被 `d1371dd` 搬走实现（门自己点了 `4c10272`/`404249c`/`e76ed13`）——**任务 #23**。
两道都不是当前可绿的账；放进 CI 只会训练人忽略红灯（那正是要治的病）。workflow 里留了"修好加回"的注释行。

## 诚实标注（未验证项）

- **GitHub 上的首次真实运行本机验证不了**：本机验到"YAML 可解析 + 同组命令全绿"这一层；
  首次推上去视作一次联调，不预先宣称 CI 已绿（README 同口径）。
- runner 选 `macos-latest` 是为与开发环境同构（沙箱/平台分支判卷按 macOS 写）；
  **ubuntu 未做任何验证**，迁移前要先跑一轮真实 CI（README 写了这一步）。

## 开放项

1. **L2 pre-commit 未落地**：只跑 `pnpm typecheck`（约 5–8s）的最小子集，但钩子作用于本机**所有并行会话**
   的每次提交 ⇒ 必须业主点头（路线图 §M9 禁区原文）。做的话验收前提（可一键关、反向验证、实测耗时）已写进 README。
2. 两道已知红修好后，把 `gate-check`/`mutate-needles-check` 加回 workflow（注释行指了位置）。
3. `head-cert-check` / `mutate-verify` 的"按需触发"目前只写了 `workflow_dispatch` 这一条路；
   要不要给它们单开一个"收尾/合并前"workflow（跑在 merge 前的窗口），属裁决。
4. 合并由集成 owner/业主执行；本笔只提交到工作分支，一笔一事。
