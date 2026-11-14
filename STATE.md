# Cairn / DSH —— 现态

rev: 18738ade

核对日期 2026-11-14（Asia/Shanghai）。`rev` 是开发线现役基线：第 1182 页死代码清理与第 1183 页
扫描告警收口第一批都在它之上。分支与门禁状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史
证据见 `PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-14 死代码批**（`50cae991`）：以 `tsc --noUnusedLocals` 为判卷清掉 CodeQL 死代码面；
  几条候选挂起等业主裁决（判卷钉住的 `draftIds`、`RESOURCE_MAX_DEPTH`、registry 注入时钟），
  明细见第 1182 页。
- **2026-11-14 扫描收口批**（`18738ade`）：`hono` 抬到补丁线，`pnpm audit` 两个面全清；A2A
  鉴权头改线性切分（ReDoS），五个错误出口不再回内部消息。其余开放告警逐条登记理由，见第 1183 页。
- **2026-11-14 测试面清理**（`7ad88cb1`）：核心与桌面测试的未用绑定清零（保留 1 条编译期断言），
  明细见第 1186 页。
- 公开线仍是 AGPL `main`，内测开发历史只留本地；公开移植走「移植＋公开门禁」的老规矩。

## 代码入口

- 核心在 `src/`，应用服务在 `src/main/`，桌面在 `apps/desktop/`。依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)，
  启动与使用说明见 `README.md`。

## 未决

- 三条死代码候选等业主一句话：`draftIds`（判卷钉住）、`RESOURCE_MAX_DEPTH`（声明与实现不符）、
  `plugin-install-registry` 的注入时钟（谁盖时间戳）。
- 置顶消息进对话目录仍未实现：第 1182 页删掉的是没人消费的死计算，功能本身没接。
- 权限规则链按最长前缀匹配：同一命令段内，更长的本机 allow 会盖过更短的项目 ask/deny；是否改成
  项目限制优先属设计裁决。
- 助手行 fluid stop 的右缘、设置页分段控件强调色边界仍待确认。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。

## 下一步

- 剩余 CodeQL 告警：file-system-race 的产品侧路径逐条复核；判为误报的是否在 GitHub 上 dismiss，
  由业主决定（第 1183 页登记了理由，没有代替业主动手）。
- 四条失效变异锚点已改指并复杀（第 1185 页）；HEAD 认证复跑只剩桌面套件的宿主条件一道红
  （Claude.app CDS 漂移＋Electron 装不起来）。CDS 重抽要走「重抽＋真渲染器 getComputedStyle 探针」
  的完整验收，单独成批，不在这里顺手改记录。
- 测试面未用绑定已清零（第 1186 页；保留 1 条编译期 Equal 断言，删了等于删判据）。
- 4 支独有内容分支（React 19 升级支、依赖批支 ×2、公开仓构建支）逐支核对后裁去留。
- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、交付证据收口。

