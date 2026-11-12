# 仓库状态与分支

核对日期 2026-11-12（Asia/Shanghai）。公开仓库为 [W117C/cairn-harness](https://github.com/W117C/cairn-harness)。
旧分支盘点与对象库修复记录可以在 `bcfff3f2` 的本页与[早期快照](../archive/repository-status-before-2026-11-02.md)回查。

| 分支 | 角色 | 状态 |
| --- | --- | --- |
| `main`、`origin/main` | AGPL 公开主线 | 远端与本地均已快进到 `750913ef` |
| `integration/security-closure-20261112` | 本地内测集成入口 | 开发线已提交变更、权限修复、离线评估证据校验与宿主联网免批贯通，代码基线 `a7a1a03c`（旧集成 `integration/main-dev-20261108` 的历史在其祖先里） |
| `fix/spec-summary-double-count` | 本地开发工作树 | 已提交的 `b9f2ce0c` 在集成历史中，未提交改动仍在原工作树 |
| `product/public-candidate-20261108` | 旧集成候选 | tip `bcfff3f2` 是本地集成的祖先 |
| `rescue/*` | 恢复引用 | 保留独有历史 |

远端只公布 `main`。公开修复从 `120d4a87` 移植，内测提交、证据和许可保留在本地。GitHub
运行记录见 [verify](https://github.com/W117C/cairn-harness/actions/runs/43229246034) 和
[CodeQL](https://github.com/W117C/cairn-harness/actions/runs/43229245734)。`v0.2.0` 是已有预览版本，
本轮交付的是仓库提交。历史材料见[证据归档](history-evidence-migration.md)。

## 工作树与后续

- 其他工作树的未提交改动、独有提交与恢复引用保持原地。分支和工作树的删除候选以本次清理预览为准，执行前复查 tip 与工作树状态。
- 当前工作范围与未决事项见 [STATE](../STATE.md) 和[路线图](ROADMAP.md)。真实模型、跨机器安装与发版认证需按拟交付版本单独取证。

## 读数与新旧

当日读数绑定到代码提交和实际命令。更早的读数随原日期保留，供回查历史证据。

| 优先级 | 事项 | 读数（每条自带日期） |
|---|---|---|
| P1 | 判卷面（core + 桌面） | core 现读（2026-11-13，`pnpm test:capped`）：**672 文件 / 8104 条全绿**（exit 0）。桌面现读（2026-11-13，`VITEST_MAX_WORKERS=2`）：**385 文件 / 2489 条全绿**（exit 0）。旧读（2026-11-02）：core 619 文件 / 7620 条、桌面 312 文件 / 2125 条（当时 4 条红为真 Electron e2e 并发假红灯，`--maxWorkers=1` 单跑 6/6 绿） |
| P1 | 认证面（HEAD） | 旧读（2026-11-04，`aeb577c7`，`maxWorkers=2`）：**25/25 道门绿、635 文件 / 7770 条全绿、exit 0**；修前 `d40962f` 同套 1 条 30s 假超时（35.8s），同用例单跑 1.9s 绿 |
| P1 | 证据占比与检索噪声 | 旧读 `outputs/` **4960 / 已跟踪 7708 = 64.3%**（2026-11-02，`pnpm repo-hygiene-check` 面①；帽 70%，只准调低） |
| P1 | 单文件体量 | 旧读 `src` 最大单文件 **2023 行**、`scripts` 最大 **2177 行**（2026-11-02，同一道门的面②/②-b；帽 2600） |
| P1 | 台账体量 | 旧读 PROGRESS **1041 张页标题**、重复号 106 个（登记帽，只准调低）、新撞 0（2026-11-02，`pnpm docs-check`） |
| P2 | LSP 能力面 | 旧读 LSP 相关判卷 **21 文件 / 296 条全绿**（2026-11-02）；`lsp-*` 变异锚点 **25 条逐条先红**（同日，用仓库自己的归因尺 `killerAttributionOk`） |
| P2 | 门禁成本 | 旧读 `pnpm facts`（2026-11-02，子集 1/40 道门，不是整跑）：`mutate-verify` 最近 1930.2s、`head-cert-check` 116.0s、`typecheck` 8.3s、`desktop-test` 11.3s |
| P2 | 长会话/长列表/大 diff | 真实 renderer（**2026-11-01 复核，五跑**，取料 `outputs/perf-recheck-2026-11-01/`；**本页 2026-11-02 重写时未重量**，所以这条按那一轮读）：400 轮会话启动 **187.7–311.8 ms（中位 270.1，离散度 1.66×）**、首开 **503.0–656.9 ms（中位 551.9）**；流式帧 p50 28.9–34.8、p95 36.1–44.8、max 36.2–47.8 ms；DOM **42,807** 节点（五跑一致）。三档预算（p95 200 / max 500 / 启动 1500）五跑全过。FilePane 500 项目录 smoke 通过；4000 行 diff 挂载 191.1 ms（2026-10-27 读数，未重量）。长尾仍只覆盖一个本机样本，不足以支持重构。 |

被本页重写删掉而不重量的其余读数（Radix 依赖、FilePane/设置可发现性、用量与成本、大入口行数）留在
`archive/repository-status-before-2026-11-02.md`，要引用必须带各自日期与快照身份。
