# Cairn / DSH —— 现态

rev: a7a1a03c

核对日期 2026-11-12（Asia/Shanghai）。`rev` 指本地集成的代码基线。分支、GitHub CI
与清理状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见 `PROGRESS.md` 与 `outputs/`。

## 当前工作

- `integration/security-closure-20261112` 是本地集成入口。`a404c825` 汇入开发线已提交的桌面变更
  与权限修复，`c0a227ad` 补入离线评估证据校验，`a7a1a03c` 贯通宿主联网免批——2026-11-05 业主裁的
  设置总闸此前被 L4-risk 裸 allow 守卫拦回审批（评审遗留 F4，其余四条评审遗留的处置见台账评审页）。
  主工作树的未提交改动保留在各自工作树。
- GitHub `main` 是 AGPL 公开主线，`750913ef` 更新权限与审批行为，该提交的 verify 与 CodeQL Actions
  均绿。内测开发历史保留在本地集成线；`a7a1a03c` 的公开线移植未做。
- 集成判据四件套在 tip `a7a1a03c` 工作树现跑全绿：core 663 文件 / 8006 条（`pnpm test:capped`，exit 0）、
  desktop 334 文件 / 2321 条（`VITEST_MAX_WORKERS=2`，exit 0）、根 typecheck 0、`docs-check` 全绿；
  desktop build 绿。`a7a1a03c` 修复本体另有红绿证明：gate-audit 两格先红后绿（43/43）＋相邻权限面 136/136。
- 历史证据已按[归档记录](docs/history-evidence-migration.md)做过解包和哈希回读。原始材料继续保留。

## 代码入口

- 核心在 `src/`，应用服务在 `src/main/`，桌面在 `apps/desktop/`。依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)，
  启动与使用说明见 `README.md`。

## 未决

- 权限规则链按最长前缀匹配：同一命令段内，更长的本机授权 allow 会盖过更短的项目 ask/deny。是否改为
  项目限制优先属设计裁决（2026-11-12 评审遗留 F5，源码注释记着现行约定），登记不动。
- 显式配置的插件信任表文件（`M2E_TRUST_FILE`）可落在项目控制目录内：真边界、低危——生产路径由主机
  装配面给出，缺口需主机误配置才成立；fail-loud 修法需迁移多个测试夹具，登记不动、修法随下一批安全批次。
- 助手行目前对整行使用 fluid stop，代码块、表格与交付卡右缘内缩。是否调整第 862 页的四段同右缘裁决仍待确认。
- 设置页分段控件选中态的强调色边界见第 910 页。
- 内测许可和第三方素材外部分发权限仍需在发版前单独确认。

## 下一步

- `a7a1a03c` 的公开线移植（公开 main 的同一守卫缺口仍在 `750913ef` 上）按公开仓库门禁另批处理。
- 按[路线图](docs/ROADMAP.md)继续处理冻结评测入口的 shell 写边界、真实模型验收和跨机器预览。
  预览验证步骤见[桌面预览](docs/desktop-preview.md)。
- 待确认本地清理清单后移除冗余引用与已经归档的工作树。测试与发布证据按对应提交复核，门禁读数见 `pnpm facts`。
