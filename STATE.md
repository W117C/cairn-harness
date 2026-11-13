# Cairn / DSH —— 现态

rev: 744132fc

核对日期 2026-11-13（Asia/Shanghai）。`rev` 是开发线现役基线：安全批次与桌面修复已随集成线
`744132fc` 回并。分支与门禁状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见
`PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-13 安全批次**（全部先红后绿）：F5 项目层 ask/deny 优先于更长本机 allow（`99662be7`，
  修前探针：项目 ask/deny「git push」＋本机 allow「git push --force」⇒ 判 allow）；显式信任表
  落工作区 fail loud 拒载（`4858ca78`＋`741d23f4` 夹具迁移 17 文件 25 站点）；冻结判卷闸关闭
  ⑥号声明的 shell 写边界（`6c82de60`，重定向/tee/cp/mv/rm/sed -i 目标进闸，非冻结目标零打扰）。
- **2026-11-13 桌面修复**：`PluginDiscover` 两个 useMemo 曾排在三个早退之后，真实 app 插件屏
  loading→ready 翻转即 React #310 整屏崩进错误边界（design-audit 23-plugins 起 15 miss/13 dup
  实证）；`30f70887` 上移 hooks＋源序判卷钉，design-audit 复原 41 shots / 41 unique / 0 dup /
  0 miss / 0 pageErrors。
- **2026-11-13 续批**：`c56b7523` 用 workspace override 把 `@hono/node-server` 抬到补丁线 2.1.7
  （GHSA-qv5m-9pm6-hqp3／GHSA-jpvv-r467-5p4w，MCP SDK 传递依赖；公开线 `98ed97a1`——该线旧 override
  钉死 2.1.3 正是两条开放告警的根源）；`0ad71cc1` 锁文件读取 race 加固（stat-read-stat inode 三明治）
  ＋scheduler 两格显式 await（CodeQL 真类告警里唯一当场可修的；其余 12 条 race 多为保守失效/工具脚本，
  登记专项批次）。锁定分支裁决表：deps-20261109 留（React 19 候选）、esbuild-20261109 留（工具升
  级可用 `pnpm up` 达成，整支合并会拖全史）、deps-batch-20261108 删除候选（271 笔旧 churn 被精选
  支覆盖意图）、public-repo-audit 留（谱系审计属深水区）。
- **2026-11-13 race 加固批**（`f19d8ade`，三线同源）：CodeQL 14 条 file-system-race 逐条 triage——
  4 条真暴露已修（mutation-lock 句柄内读＋inode 对照；preferences/registry 读后复查字节上限；
  diagnostics 双分支走单句柄有界读）；10 条登记不动（保守失效/已有读后复查/只读工具）。
  同批清掉 Mimosa 两个 blocking high（抽取脚本落点收口＋smoke 走临时文件程序）。
- **批内全量读数**（tip `741d23f4` 现跑）：core 673 文件 / 8111 条全绿、desktop 385 文件 / 2490 条
  全绿（均 `--maxWorkers=2`，exit 0）；tsc 0；docs-check 全绿；desktop build 绿。
- GitHub `main` 是 AGPL 公开主线：F4（`6fb20860`）与本批移植 `a95c2147`（trust guard `c37bd78b`、
  F5 `00ec8be0`、冻结闸 `2297543e`、夹具迁移）已推；公开树红绿独立取证＋全量 core 647 文件 /
  7353 条全绿。内测开发历史只在本地（集成线不推公开远端）。
- 历史证据已按[归档记录](docs/history-evidence-migration.md)做过解包和哈希回读。原始材料继续保留。
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

- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、扫描与依赖告警处置。
- 4 支独有内容分支（React 19 升级支、依赖批支 ×2、公开仓构建支）逐支核对后裁去留。
- 集成分支 `integration/security-closure-20261112` 只在本地；公开线改动走移植＋公开门禁。
