# Cairn / DSH —— 现态

rev: 2fa56173141291959013539c2b9a5a9ae9f3bf7d

本页描述 GitHub 默认分支的实现基线。开发线、本地成果与发布 tag 分别取证。
未完成、待开工和优化事项见 [项目路线与仓库状态](docs/ROADMAP.md)，
验证结果须核对对应提交和 GitHub Actions。

## 现在在哪

- core 位于 `src/`；`src/main/` 是 electron-free 的应用服务，核心不反向依赖桌面壳。
- desktop 位于 `apps/desktop/`；IPC 契约在 `src/main/ipc-protocol.ts`，层级由 desktop-boundary-check 检查。
- 默认分支保留 B1 核心/CLI 定位与桌面开发壳，交付范围裁决见 `docs/adr/`。
- 仓库已公开；密钥扫描、推送保护、私密漏洞报告与 main 防强推/防删除保护已启用。
- 仓库入口、Dependabot 配置、CodeQL 自动分析和受限并发测试入口已整理；
  运行结果见 PR #2 及其合并提交的 Actions，认证面仍有未证条目。

## 正在收口

- 旧动画任务的仓库级绑定已经清除；本批将仍有回归用途的动画标本归入
  `fixtures/artifacts/cycling-animation.html`，根目录保留项目入口、配置与治理文档。
- Electron 补丁和 Actions 运行时更新已随 PR #3、PR #8 合并；组合后的 CI 与 CodeQL 已验收，
  认证未证项和实际交付边界仍按台账记录。
- 开发线和默认分支仍有各自独有提交；本地另有已提交成果，发布与集成按文件归属逐批核对。

## 待验与待决

- main 的桌面路径授权与自进化接线债见 PROGRESS 第 618、619 页，先核对开发线实现再补缺口。
- 依赖升级、公开日志隐私审阅、真实会话/桌面验收及开发线集成仍按路线图推进。
- 历史工件和恢复分支保留用途与凭证；未发现执行消费者不单独证明历史证据可以删除。

## 怎么验

命令与边界见 AGENTS.md。core、desktop、build 与真实交互分别取证。
仓库配置检查自身代码与页面入口；任务产物使用对应检查器按需验证。
完整门表见 `scripts/gate-manifest.ts`，实测用 `pnpm facts` 和对应证据。
`mutate-verify`、`head-cert-check` 仅证明其测量提交，不把退出码全零等同于全部已证。
