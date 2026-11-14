# Cairn / DSH —— 现态

rev: 962548a9

核对日期 2026-11-15（Asia/Shanghai）。`rev` 是开发线现役基线：第 1195 页的判卷面 shell 收口与第 1198 页的依赖/标定闸在它之上。
分支与门禁状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见 `PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-15 依赖与路由标定闸**（`4240634c` / `962548a9`，第 1198 页）：主包摘掉未使用的
  `@radix-ui/themes`（预览侧保留）；`routing-check` F2d 不再要求线上留占位行，改用合成表自证；
  GLM 官方价与价梯冲突写成裁决输入 `docs/glm-pricing-decision-2026-11-15.md`（未改价表）。
- **2026-11-15 判卷面 shell 绕过收口**（`01d2ae2`，第 1195 页）：词法取料搬成
  `src/permissions/shell-write-targets.ts`（16 条形状 14 deny，解释器与变量间接交给执行层）；
  Seatbelt profile 为每个冻结文件追加 literal 写拒绝（真机 20 形状全拒）；`run_shell` 跑前基线 +
  跑后逐字节复原（无沙箱宿主的地板）；冻结表自身进集合（改基线不再可能）。取证件
  `outputs/judge-integrity-2026-11-15/`。
- **2026-11-14 全仓普查**（`b8cefbb3`，第 1194 页）：八条发现；F2/F5 已收口，F3/F4/F6 待业主裁决。
- **2026-11-15 壁纸 CSP 批**（`8d278985`，第 1193 页）：真 Electron 冒烟 23/23，修掉三个真机缺陷。
- 更早的死代码清理、扫描收口、fs-race、变异与 HEAD 认证见第 1183–1192 页。
- 公开线仍是 AGPL `main`，内测开发历史只留本地；公开移植走「移植＋公开门禁」的老规矩。

## 代码入口

- 核心在 `src/`，应用服务在 `src/main/`，桌面在 `apps/desktop/`。依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)，
  启动与使用说明见 `README.md`。

## 未决

- 权限规则链按最长前缀匹配：同一命令段内，更长的本机 allow 会盖过更短的项目 ask/deny；是否改成
  项目限制优先属设计裁决。
- 助手行 fluid stop 的右缘、设置页分段控件强调色边界仍待确认。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。
- GLM 档位映射：官方 5.2 与 5.3 同价，standard/strong 怎么填见
  [裁决输入](docs/glm-pricing-decision-2026-11-15.md)；改表前需裁决。
- F6 `web_search` 仅第三方后端——自研方向待裁决（第 1194 页）；F3 的 ADR 0003 组件栈裁决仍未做。

## 下一步

- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、交付证据收口。
- 判卷面：解释器形状靠执行层；后台 `timeout`/`stop` 未接跑后复查；`fs_ops` 的整树 move 未做同族普查
  （第 1195 页边界）。
- F4 官方价已读，等 §四/§五 裁决后标定价表与美元闸口径；F6 不代替业主裁决。
- ADR 0015（bot 团队调研裁决）未写；计划在 `docs/superpowers/plans/2026-11-14-ds-bot-benchmark.md`。
