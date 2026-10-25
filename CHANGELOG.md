# 变更日志 / Changelog

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录，
版本号按 [语义化版本](https://semver.org/lang/zh-CN/)。

> **这个文件记什么、不记什么**
>
> 本文件记**对外交付面变了什么**——命令、行为、边界、可见的产物。
> 每一轮「发生了什么、为什么这么裁」的实录在 [`PROGRESS.md`](PROGRESS.md)（台账层，只追加）。
> **两者不是同一件事，不要互相搬运**：把一轮实录抄进这里会把变更日志变成流水账；
> 把对外行为的变化只记进台账，则读者从本文件看不到任何东西变化过。

---

## [未发布]

### 新增

- **仓库治理面**：贡献指南 [`CONTRIBUTING.md`](CONTRIBUTING.md)（四层文档怎么落、改了什么跑哪些门、
  提交面纪律、PR 自检清单）、行为准则 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)、
  安全策略 [`SECURITY.md`](SECURITY.md)（私密报告通道、支持范围表、响应口径）、
  支持说明 [`SUPPORT.md`](SUPPORT.md)（按问题类型选渠道）。
- **GitHub 协作面**：Issue 表单（Bug / Feature 两个结构化模板 + 指向私密漏洞通道的 contact link）、
  PR 模板（自检清单与贡献指南 §8 同一套判据）、[CODEOWNERS](.github/CODEOWNERS)、
  [Dependabot](.github/dependabot.yml)（npm 与 GitHub Actions，分组升级减少锁文件碎片 PR）。
- **静态安全分析**：[CodeQL 工作流](.github/workflows/codeql.yml) 覆盖 `src/`、`apps/desktop/src/`、
  `bin/`、`scripts/`（取料面与夹具不进分析面）。**告警不自动阻断合并**——
  本仓的沙箱与 fail-closed 路径天生长成「看起来危险」的样子。
- **工程规范文件**：`.editorconfig`（跨编辑器统一换行与缩进）、
  `.gitattributes`（统一 LF；二进制与取料面单独标注）。

### 变更

- **CI 最小权限**：`verify` 工作流由默认写权限收紧为 `contents: read`。
- **CI 并发组**：`verify` 按 `workflow + ref` 分组，同一 ref 上**被取代**的旧趟被取消，
  最新那趟仍跑完并给出读数。连续推送时不再叠出多趟并行——省的是计费分钟，判读口径不变。
- **默认分支更名**：`zcode` → `main`（`zcode` 作为默认分支名非常规，且落后活跃线）。

> ⚠️ 本节只记**对外可见**的变化。门禁读数、判卷条数、当前状态一律不进本文件——
> 它们属于现态层（[`STATE.md`](STATE.md)）或台账层（[`PROGRESS.md`](PROGRESS.md)）。

---

## [0.1.0] - 2026-10-06

首个内测版（B1：自用/内测开发者先行；受众与范围裁决见
[`docs/adr/0002-v1-audience-b1-internal-beta.md`](docs/adr/0002-v1-audience-b1-internal-beta.md)）。

### 新增

- CLI 交付面：`cairn <任务>` 目标轮、`--goal` 目标模式、四档 `--mode`、`--replay`/`--fork`/`--compact`、
  `--serve`（调度器常驻）、`--provider demo`（零凭据预录剧本）
- 本版新增：`--version`、`--doctor`（环境自检：Node/凭据在位/沙箱/工作区可写，不回显密钥值）、
  `scripts/install.sh`

### 不在本版交付面

- 桌面端（`apps/`，ADR 0001/0002 裁决）
- npm 发布（B2 门，见 [`docs/b2-checklist.md`](docs/b2-checklist.md)）

<!--
  链接区：Keep a Changelog 的惯例。增版本时同步加一行 [x.y.z] 链接。
  首版没有 compare 基准（仓库创建时的提交即 0.1.0 的落点）。
-->
[未发布]: https://github.com/W117C/cairn-harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/W117C/cairn-harness/releases/tag/v0.1.0
