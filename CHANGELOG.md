# Changelog

## 0.2.0 — 2026-10-30

桌面端内测进入可用形态（仍为 ad-hoc、未公证；受众边界见 ADR 0002）。

- Electron + React 桌面壳：项目与会话、模型/权限档、插件/记忆/自动化、设置页与命令面板
- 数据可携带：偏好导出/导入/恢复默认、诊断包、许可证导入、记忆导出、用量 CSV
- 发布与支持：版本/构建来源（build-info）、启动更新提醒、DMG（含 Applications 快捷方式）、
  打包态冒烟、`--doctor` 诊断
- 安全与诚实：演示 provider 显式标识「演示模式」，未配置更新源/插件目录/许可证显示显式状态
- 不在本版：Apple 公证、自动下载/安装更新、英文界面

## 0.1.0 — 2026-10-06

首个内测版（B1：自用/内测开发者先行；受众与范围裁决见
`docs/adr/0002-v1-audience-b1-internal-beta.md`）。

- CLI 交付面：`cairn <任务>` 目标轮、`--goal` 目标模式、四档 `--mode`、`--replay`/`--fork`/`--compact`、
  `--serve`（调度器常驻）、`--provider demo`（零凭据预录剧本）
- 本版新增：`--version`、`--doctor`（环境自检：Node/凭据在位/沙箱/工作区可写，不回显密钥值）、
  `scripts/install.sh`
- 0.1.0 时不在交付面：桌面端（`apps/`，ADR 0001/0002 裁决；桌面端见 0.2.0）、npm 发布（B2 门，见 `docs/b2-checklist.md`）
