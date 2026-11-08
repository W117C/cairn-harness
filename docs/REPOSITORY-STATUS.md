# 仓库状态与分支

核对日期：2026-11-08（Asia/Shanghai）。对象是 `/Users/ze/.codex/worktrees/cairn-public-candidate/cairn` 与集成分支；同级 staging、备份与研究目录未纳入内容修改或删除。
这是现役入口。旧整理记录见[历史快照](../archive/repository-status-before-2026-11-02.md)。

## 当前结论

- 集成分支 `integration/main-dev-20261108` 已把 `main` 的 PR #18/#19 合入开发线（`22942160`），
  再合公开候选 `8d798077` 的打包与预览面；冲突按「安全实现取较新者、功能面保留双方」处理。
- `product/public-candidate-20261108` 保留公开门面与打包构建；最终收口以集成 tip 为准，未推送、未发布。
- 开发线与 `origin/main` 双向分叉已消除（集成提交同时包含双方祖先）；`main` 本身未改写，发布 tag 未动。
- 历史材料归档见 [`docs/history-evidence-migration.md`](history-evidence-migration.md)。

## 本地分支处置

| 分支 | 当前关系 | 决定 |
| --- | --- | --- |
| `main` | 与 `origin/main` 一致（`2e6ccd28`） | 保留；主线基准 |
| `fix/spec-summary-double-count` | 活跃开发线，已推送；与 main 分叉 | 保留；作为集成来源 |
| `integration/main-dev-20261108` | 开发线 + main 安全/漂移修复 + 公开候选打包面 | 保留；当前集成候选 |
| `product/public-candidate-20261108` | 公开门面与打包批；已快进到集成 tip `c0ba4c21` | 保留；公开候选 |
| `rescue/code-scanning-closure-wip-20261104` | 清理前从 code-scanning worktree 收编的未提交改动（1 笔） | 保留；未经判卷，未合入任何线 |
| `rescue/wip-20261025` | 相对主线与开发线均有独有提交 | 保留；救援快照 |

已删除（2026-11-04）：`fix/code-scanning-alerts`、`fix/code-scanning-closure`——两支 tip 均已是 `main` 的祖先，删除不丢提交。
已删除并确认并入开发线：`agent/修复-todo-的-completedcount-worker-12`、`agent/修复-todo-的-completedcount-2-worker-12`、`feat/task-carried-verify`（三笔提交 + merge 已在开发线上）。

## 远端分支

| 远端对象 | 状态与处置 |
| --- | --- |
| `main`、`fix/spec-summary-double-count` | 主线与开发线，保留 |
| `rescue/wip-20261025` | 救援快照，保留 |
| `doc-layer-migration` | 提交图中仍有独有历史，保留待内容等价性审计 |
| `integration/dev-line-with-standardization` | tip 是开发线祖先，已删除 |
| 六个 Dependabot 分支 | 对应开放 PR #9、#11、#20、#21、#22、#23；#6、#7（TypeScript 跨大版本）已关闭并删除分支 |

## 工作树与在途改动

- 主树 `/Users/ze/Downloads/Cairn/cairn`：29 项未提交（第 1041–1043 页桌面设计、思考与工具调用批次；
  17 个 tracked 改动 + 12 个未跟踪文件），**不在集成分支内**，需业主确认是否补提交并重做集成。
- 集成分支与公开候选工作树：0 项。
- `gate-mutate-verify`：1 项未提交（变异跑器残留，可重建）。
- `review-fixes-20261107`：38 项未提交（旧评审树，归属待确认）。
- 2026-11-04 清理后的 code-scanning 树处置记录保留如下：未跟踪的 3 份 head-cert 凭证移入 `outputs/` 并随 `33db88d0` 入库；未提交的源码与判卷收编为 `rescue/code-scanning-closure-wip-20261104`（`a16837a1`，未经判卷）。
- `gate-mutate-verify` 不再常驻：`pnpm mutate-verify` 缺树时自行 `worktree add`，存在时先 `checkout --detach --force` 到当前 HEAD，属于可重建的跑器目录。
- 同日清空 `.tmp/`（scratch，门禁与测试会重建）与 `.mimosa/hook-state` 的陈旧 baseline；`git prune-packed` 回收了已入包的重复松散对象。`outputs/desktop-permission-2026-11-03/` 内的五份 Chromium profile 运行缓存已删（截图与读数保留，见 `40ddb2c6`）。

## 仓库对象库（2026-11-04 已修复）

- 旧对象库混着不可达的破损历史：37 个缺失对象（其一为 `b8033ca8` 的父对象），引用它们的树/提交没有一条可从 refs 到达；`git gc` / `git prune` 会在遍历这些对象时停住。
- 修法：把 refs 可达的对象（26,949 支）重新打成单一 pack（`bc6fcee2`），退役全部旧 packs 与松散对象；`git fsck --full`、`git commit-graph verify`、`git prune --dry-run`、`git gc --prune=now` 均 exit 0。
- 台账另有 27 条引用指向 rebase 前提交（对象还在、父提交与部分树已缺）；为了让 D-5 的「引用必须是真提交」继续成立，这 27 个提交对象单独收进一个 promisor pack（`b022fb3c`），不进入任何分支历史，gc 不会回收。
- 代价：全部 reflog 已清空——它们都引用了缺对象的旧历史。修复前完整 `.git`（含 reflog 原文与旧对象）备份在 `../cairn-git-backup-20261104/`，确认后即可删除。

## 下一步

- 集成 tip `f6bece63` 已跑：core `7977/7977`、桌面 `332` 文件 / `2298` 条、typecheck、boundary、docs-check、
  desktop build 全绿；`head-cert-check` 25/25 道绿。完整 `mutate-verify` 变异跑未执行。
- `product/public-candidate-20261108` 已快进到集成 tip；未直接改 `main`，未推送、未发布。
- 真实 provider 验收被账户实名认证阻塞，证据见 `outputs/real-provider-2026-11-08/`；认证完成后重跑。

## 读数与新旧

> 本节由判据 `tests/status-readings-dated.test.ts`（第 953/956 页）钉住：标「现读」的行必须带
> `YYYY-MM-DD`，性能类读数必须给区间与中位。2026-11-02 本页整页重写时这些行被一并删掉，判据当场喊红——
> 补回来时**只用当天重量的数**，旧数一律标自己的日期与"未重量"，不冒充刚测过。

| 优先级 | 事项 | 读数（每条自带日期） |
|---|---|---|
| P1 | 判卷面（core + 桌面） | core 现读（2026-11-02，`pnpm test:capped`＝`--maxWorkers=2`，exit 0）：**619 文件 / 7620 条全绿**——含本判据自己（此前因本页缺读数连红三轮）。桌面现读（2026-11-02，`--maxWorkers=2`）：**312 文件 / 2125 条**，其中 4 条红落在 `approval-e2e` 与 `sandbox-init`（真 Electron/子进程 e2e），`--maxWorkers=1` 单跑 **6/6 绿** ⇒ 判为并发负载假红灯而非回归（读数按两档并列，不择好写） |
| P1 | 认证面（HEAD） | 现读（2026-11-04，`aeb577c7`，`maxWorkers=2`）：**25/25 道门绿、635 文件 / 7770 条全绿、exit 0**；修前 `d40962f` 同套 1 条 30s 假超时（35.8s），同用例单跑 1.9s 绿 |
| P1 | 证据占比与检索噪声 | 现读 `outputs/` **4960 / 已跟踪 7708 = 64.3%**（2026-11-02，`pnpm repo-hygiene-check` 面①；帽 70%，只准调低） |
| P1 | 单文件体量 | 现读 `src` 最大单文件 **2023 行**、`scripts` 最大 **2177 行**（2026-11-02，同一道门的面②/②-b；帽 2600） |
| P1 | 台账体量 | 现读 PROGRESS **1041 张页标题**、重复号 106 个（登记帽，只准调低）、新撞 0（2026-11-02，`pnpm docs-check`） |
| P2 | LSP 能力面 | 现读 LSP 相关判卷 **21 文件 / 296 条全绿**（2026-11-02）；`lsp-*` 变异锚点 **25 条逐条先红**（同日，用仓库自己的归因尺 `killerAttributionOk`） |
| P2 | 门禁成本 | 现读 `pnpm facts`（2026-11-02，子集 1/40 道门，不是整跑）：`mutate-verify` 最近 1930.2s、`head-cert-check` 116.0s、`typecheck` 8.3s、`desktop-test` 11.3s |
| P2 | 长会话/长列表/大 diff | 真实 renderer（**2026-11-01 复核，五跑**，取料 `outputs/perf-recheck-2026-11-01/`；**本页 2026-11-02 重写时未重量**，所以这条按那一轮读）：400 轮会话启动 **187.7–311.8 ms（中位 270.1，离散度 1.66×）**、首开 **503.0–656.9 ms（中位 551.9）**；流式帧 p50 28.9–34.8、p95 36.1–44.8、max 36.2–47.8 ms；DOM **42,807** 节点（五跑一致）。三档预算（p95 200 / max 500 / 启动 1500）五跑全过。FilePane 500 项目录 smoke 通过；4000 行 diff 挂载 191.1 ms（2026-10-27 读数，未重量）。长尾仍只覆盖一个本机样本，不足以支持重构。 |

被本页重写删掉而不重量的其余读数（Radix 依赖、FilePane/设置可发现性、用量与成本、大入口行数）留在
`archive/repository-status-before-2026-11-02.md`，要引用必须带各自日期与快照身份。
