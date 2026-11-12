# Cairn / DSH —— 现态

rev: be41e26b

核对日期 2026-11-13（Asia/Shanghai）。`rev` 是开发线现役基线：第 1041–1181 页多会话在飞工作已随
`be41e26b` 入库。仓库与分支入口见[仓库状态与分支](docs/REPOSITORY-STATUS.md)；测量与历史证据在
`outputs/`、`PROGRESS.md` 与 `archive/`，本页只写状态与下一步。

## 当前工作

- **入库**：主工作树 414 个脏路径（290 修改＋124 新增）随 `be41e26b` 一次性入库，工作树归零。
  入库前本机现跑（`--maxWorkers=2`）：core 665 文件 / 8052 条全绿、desktop 384 文件 / 2481 条全绿，
  均 exit 0；根 typecheck 0。台账页 1041–1181 维持各会话原文随页入库，不背书各页判卷结论。
- **集成**：开发线已合入本地集成入口 `integration/security-closure-20261112`（`2f7aa8de`，5 处冲突
  手工解完：prune 两侧互补取并、risk 取整段补丁 token、变异锚取新形状；`21d47ec9` 修自动合并复活的
  profile 老写法）。集成 tip 现跑：desktop 385 文件 / 2489 条全绿、docs-check 全绿；core 见读数表。
- **公开线**：AGPL 公开 `main` 已推 `6fb20860`（宿主联网免批贯通的公开移植，红绿独立取证；
  verify/CodeQL Actions 以该提交为准）。内测历史不入公开远端，集成线只在本地。
- **清理**：7 个工作树＋18 支分支删除，tip 均逐一验证已在集成线或公开 main 内保全；
  2 支在飞工作先行 rescue 快照（`rescue/wip-zcode-resume-20261110`、`rescue/wip-stream-perf-styles-20261109`，
  未经判卷）。

## 代码入口

- core 在 `src/`，应用服务在 electron-free 的 `src/main/`；desktop 在 `apps/desktop/`，依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约在 `apps/desktop/design/desktop-design-spec.md`；符号和稳定契约见 [CODE-WIKI](docs/CODE-WIKI.md)；功能使用见 `README.md`。

## 未决（待业主裁，登记不动）

- 权限规则链最长前缀：同一命令段内更长的本机 allow 盖过更短的项目 ask/deny，是否改为项目限制优先
  （2026-11-12 评审遗留 F5，设计裁决）。
- 显式配置的插件信任表文件（`M2E_TRUST_FILE`）可落项目控制目录：真边界、低危，fail-loud 修法需迁移
  多个测试夹具，随下一批安全批次。
- 助手行 fluid stop 的作用层级（第 862 页裁决是否反转）；设置页分段控件选中态强调色边界（第 910 页）。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。

## 下一步

- 冻结评测入口的 shell 写边界、真实模型验收、跨机器桌面预览（见 [ROADMAP](docs/ROADMAP.md) 待办表）。
- 需审计的独有内容分支 5 支（`chore/deps-*20261109` ×3、`chore/remove-internal-python`、
  `chore/public-repo-audit-20261108`、`fix/evolve-offline-evidence-20261109`）与 `rescue/*` 快照
  逐支核对后裁去留。

## 验证与交付边界

- 本页读数覆盖开发线工作树与集成 tip 现跑；`pnpm gates` / `head-cert-check` / `mutate-verify`
  量提交，按需另批。
- 离屏假 API 截图与几何读数证明版式与状态属性；真机观感（字体渲染、拖拽、Radix 菜单手感）归业主目验。
