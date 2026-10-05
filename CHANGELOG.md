# Changelog

## 0.1.0 — 2026-10-06

首个内测版（B1：自用/内测开发者先行；受众与范围裁决见
`docs/adr/0002-v1-audience-b1-internal-beta.md`）。

- CLI 交付面：`cairn <任务>` 目标轮、`--goal` 目标模式、四档 `--mode`、`--replay`/`--fork`/`--compact`、
  `--serve`（调度器常驻）、`--provider demo`（零凭据预录剧本）
- 本版新增：`--version`、`--doctor`（环境自检：Node/凭据在位/沙箱/工作区可写，不回显密钥值）、
  `scripts/install.sh`
- 不在本版交付面：桌面端（`apps/`，ADR 0001/0002 裁决）、npm 发布（B2 门，见 `docs/b2-checklist.md`）
