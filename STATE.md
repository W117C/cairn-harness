# Cairn / DSH —— 现态

rev: f465f66f

核对日期：2026-11-08（Asia/Shanghai）。`rev` 是现役集成分支基线；本轮把 `main` 的 PR #18/#19
与公开候选的打包批合入开发线，提交后以新 tip 为现役基线。仓库与分支入口见
[仓库状态与分支](docs/REPOSITORY-STATUS.md)；历史与证据在 `PROGRESS.md`、`outputs/`、`archive/`，
本页只写状态与下一步。

## 当前工作

- 分支整合：`integration/main-dev-20261108` 以开发线 `ccf35864` 为底，已含五笔安全移植；本轮再合
  `main` 与公开候选 `8d798077`（运行依赖锁、`release.json`/`SHA256SUMS`、预览说明）。冲突按
  「安全实现取较新者、功能面保留双方」处理，IPC 与桌面边界未放宽。
- 历史材料：`outputs/` 已生成可恢复归档（`/Users/ze/Downloads/Cairn-archives/` 下按提交命名的目录，
  含逐文件清单与 `SHA256SUMS`）；归档内全部文件经解包回读与哈希核对，源文件未删、未改。
  逐文件引用与隐私审阅状态见归档 `inventory.jsonl`。
- 真实模型验收：使用本机 `~/.config/cairn/env` 的既有端点做最小真实任务（凭据不写入仓库）；
  范围、费用档与结果见 `outputs/` 对应证据。未做跨机器与下载路径验收。

## 代码入口

- core 在 `src/`，应用服务在 electron-free 的 `src/main/`；desktop 在 `apps/desktop/`，
  依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约在 `apps/desktop/design/desktop-design-spec.md`；列宽/气沟单源与品牌补位的判卷见
  `apps/desktop/tests/column-single-source.test.ts`、`apps/desktop/tests/app-toolbar-brand.test.tsx`。
- 打包与预览说明见 `docs/desktop-preview.md`；符号和稳定契约见 [CODE-WIKI](docs/CODE-WIKI.md)；
  功能使用见 `README.md`。

## 未决（待业主裁，登记不动）

- 助手行 fluid stop 的作用层级：现作用于整行 `margin-right`，代码块/表格/交付卡右缘比输入卡内缩一截；
  反转第 862 页「四段同右缘」裁决需拍板。
- 设置页分段控件选中态的强调色边界（「中性用色」与「焦点环=强调色域」两条裁决的交界），
  第 910 页登记未动。
- 公开许可与第三方素材分发权限：`LICENSE` 为 proprietary；外部分发前需单独确认，
  不以仓库可见性替代授权。

## 下一步

- 对集成 tip 跑 core/desktop/typecheck/boundary/build 与现行门禁；红项修到绿再谈合并/发布。
- 在隔离工作区处理 `product/public-candidate-20261108` 与集成 tip 的收口；不直接改 `main`，
  不推送、不发布。
- 预览包按 `docs/desktop-preview.md` 在另一台受支持机器做解压/首次允许/启动/退出与真实任务；
  本机临时目录结果不替代跨机器验收。

## 验证与交付边界

- 本页所在工作树已跑根 typecheck；core/desktop 全量与 `docs-check` 的读数按对应提交现跑，
  不把历史认证转移到新树。
- `pnpm gates` / `head-cert-check` / `mutate-verify` 量的是提交，未提交前不引用；提交后补跑再登记。
- 离屏假 API 截图与几何读数证明版式与状态属性；真机观感（字体渲染、拖拽、Radix 菜单手感）归业主目验。
