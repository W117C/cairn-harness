# Cairn / DSH —— 现态

rev: 41f226e53f37c5809ae130ac568f90f5cb6c4336

本页描述 GitHub 默认分支的实现基线。开发线、本地未提交成果与发布 tag 分别取证，
不把一边的实现或绿灯写成另一边已经交付。分支快照、未完成/待开工/优化事项统一见
[项目路线与仓库状态](docs/ROADMAP.md)；实时验证见 GitHub Actions。

## 现在在哪

- **core**：`src/agent/`、`src/tools/`、`src/providers/`、`src/permissions/`、`src/events/`；
  `src/main/` 是 electron-free 的应用服务，核心不得反向依赖 `apps/desktop/`。
- **desktop**：`apps/desktop/` 的 main / preload / renderer，可 import core；
  IPC 契约在 `src/main/ipc-protocol.ts`，边界由 `scripts/desktop-boundary-check.ts` 检查。
- **交付与受众**：默认分支保留 B1 核心/CLI 定位与桌面开发壳；范围裁决在 `docs/adr/`。
- **事实入口**：门表是 `scripts/gate-manifest.ts`，实测用 `pnpm facts` 和对应证据；
  历史保留在 `PROGRESS.md` 与 `outputs/`，不搬走台账或删除历史来使门禁变绿。

## 正在收口

- GitHub 治理文件已经具备；本轮补齐依赖标签、修复重复更新配置与缺失验证命令，整理任务入口和闲置样本。
- 开发线与默认分支已经分叉，开发线的新功能尚未因此进入 main；集成要保留两边有效改动并单独验证。
- 本地仍有未提交的功能批次，需逐批检查归属与依赖，不能用共享工作树的结果替代远端提交认证。
- 当前 CI 的执行受账户付款/支出限制阻塞；先解除账户限制，再对拟交付提交跑完整验证。

## 待验与待决

- main 基线保留的桌面根路径授权与自进化接线债见 `PROGRESS.md` 第 618、619 页；
  开发线是否已修及最终集成证据另行核对，不能仅凭旧状态重复施工。
- 文档引用检查须获取完整远端 ref 与 tag；台账页号重复与依赖告警仍保留，本轮不修改冻结判据或擅自升级依赖。
- 连续发送、分叉、插话、多窗口与编排控制面须在拟交付构建真实复验；收益与真连测量另立受控任务。
- 远程编排、开放面、B2 分发及性能优化按路线图的启动条件推进；恢复分支和历史工件保持可回取。

## 怎么验

命令与边界见 `AGENTS.md`；core 与 desktop 分开验证。`test:capped` 是同一核心套件的并发受限入口。
`mutate-verify` / `head-cert-check` 只证明测量提交。账户限制或既有红未解除时，不声称完整 gates 通过。
