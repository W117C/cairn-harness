# Cairn / DSH —— 现态

rev: 741d23f4

核对日期 2026-11-13（Asia/Shanghai）。`rev` 指本地集成的代码基线。分支、GitHub CI
与清理状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见 `PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-13 安全批次**（全先红后绿）：F5 项目层 ask/deny 优先于更长本机 allow（`99662be7`，
  matchSegment 只对「项目限制 × 本机 allow」这对加优先，S4 全局地板原样）；显式信任表落工作区
  fail loud 拒载（`4858ca78`＋`741d23f4` 迁移夹具 17 文件 25 站点）；冻结判卷闸关闭 ⑥号声明的
  shell 写边界（`6c82de60`，重定向/tee/cp/mv/rm/sed -i 目标进闸，非冻结目标零打扰）。
- **2026-11-13 桌面修复**：`PluginDiscover` 两个 useMemo 排在三个早退后，loading→ready 翻转即
  React #310 整屏崩（design-audit 23-plugins 起 15 miss/13 dup 实证）；`30f70887` 上移 hooks＋
  源序判卷钉，design-audit 复原 41/41/0/0。
- `integration/security-closure-20261112` tip `741d23f4`＝dev `be41e26b` 合并（`2f7aa8de`）＋F4＋
  老写法修复（`21d47ec9`）＋本批五笔。开发线已回并（`744132fc`）。
- GitHub `main` 是 AGPL 公开主线：`6fb20860`（F4）与本批移植 `a95c2147`（trust guard `c37bd78b`、
  F5 `00ec8be0`、冻结闸 `2297543e`、夹具迁移）已推；公开树红绿独立取证（trust guard 还原跑红
  1 格、全量 core 647 文件 / 7353 条全绿）。内测历史只在本地。
- 批内全量读数（tip `741d23f4` 现跑）：core 673 文件 / 8111 条全绿、desktop 385 文件 / 2490 条
  全绿（均 `--maxWorkers=2`，exit 0）；tsc 0；docs-check 全绿；design-audit 41/41/0/0。
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
