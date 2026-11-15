# Cairn / DSH —— 现态

rev: 907deda7

核对日期 2026-11-15（Asia/Shanghai）。`rev` 是开发线现役基线；第 1200 / 1203 / 1204 页的判卷面与桌面改动在
它之上的工作树里，尚未提交。分支与门禁状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见
`PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-15 占位价只当上界**（`907deda7`）：`bucketsSpendUsd`/`goalWindowSpend` 带 `calibrated`；
  续跑提醒与美元停止理由写「含未标定上界，不是实付」；成本闸对未标定行出声一次。价表未改，
  F4 档位映射仍待裁决。第 1207 页；认证 `907deda` 25/25、核心 678/8145。
- **2026-11-15 HEAD 认证**（`d8bf4c6c`）：25/25 门绿，核心 678 文件 / 8142 条（`--maxWorkers=2`），exit 0；
  GLM 强档修复的三红一绿链路见第 1205 页；凭证 `outputs/head-cert-d8bf4c6-2026-11-15-0456/`。
- **2026-11-15 ⌘↩「打断并发送」先发这一条**（第 1203 页，工作树）：新增纯函数
  `enqueueQueued(list, item, front)`；`send`/`sendWithGoal` 透传 `front`，⌘↩ 插队首后再打断，
  不再排在老消息后面。速查文案改为「运行中 = 打断本轮，先发这条」。
- **2026-11-15 退出也等后台任务复查**（第 1204 页，工作树）：`settleAllBackgroundTasks()` 在
  `before-quit` 与持久执行器、安装任务一起等完才 `app.quit()`；`will-quit` 的同步组杀退化为
  第二次清扫。SIGINT/强杀仍是硬边界。
- **2026-11-15 GLM 强档模型名修正**（`18495794`）：`glm-strong` 从不存在的 `glm-5.2-pro` 改为官方旗舰
  `glm-5.3`（1M 上下文）；价表仍占位，F4 的价梯映射仍待裁决（`docs/glm-pricing-decision-2026-11-15.md`）。
- **2026-11-15 ADR 0015（bot 团队调研裁决，Proposed）**：落点 A（核心内建）＋骨架三件（成员档案/
  成员线程/团队会话）＋数据模型 B3/G2/P2/R1/S1/C2/L1＋五条不变量；12 面在 HEAD `8d552446` 复核。
  文件 `docs/adr/0015-ds-bot-benchmark.md`；待业主批准后进 Phase 4 spec，批准前不写实现代码。
- **2026-11-15 判卷面收束与证据保质期**（第 1200 页，工作树）：后台任务四条终止路径（close /
  timeout / stop / 会话取消）汇进一条 `settle` 链，`done` 只在跑后复查之后置真，`task_stop`
  回执当场带守卫结论；`fs_ops` 拒收「含冻结文件的目录整树搬走」；桌面四支真机判卷共用一份
  renderer 摘要 + 同构建判据，queue-key 冒烟改到 11-04 形制（点第二条「立即」才真正量改序）。
- **2026-11-15 依赖与路由标定闸**（`4240634c` / `962548a9`，第 1198 页）：主包摘掉未使用的
  `@radix-ui/themes`（预览侧保留）；`routing-check` F2d 不再要求线上留占位行，改用合成表自证；
  GLM 官方价与价梯冲突写成裁决输入 `docs/glm-pricing-decision-2026-11-15.md`（未改价表）。
- **2026-11-15 判卷面 shell 绕过收口**（`01d2ae2`，第 1195 页）：词法取料搬成
  `src/permissions/shell-write-targets.ts`（16 条形状 14 deny，解释器与变量间接交给执行层）；
  Seatbelt profile 为每个冻结文件追加 literal 写拒绝（真机 20 形状全拒）；`run_shell` 跑前基线 +
  跑后逐字节复原（无沙箱宿主的地板）；冻结表自身进集合。取证件
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
  [裁决输入](docs/glm-pricing-decision-2026-11-15.md)；强档模型名已修（`18495794`），美元闸已标「上界」
  （`907deda7`），价表仍待裁决。
- F6 `web_search` 仅第三方后端——自研方向待裁决（第 1194 页）；F3 的 ADR 0003 组件栈裁决仍未做。

## 下一步

- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、交付证据收口。
- 判卷面：解释器形状交给执行层；正常退出已等后台任务复查（第 1204 页），SIGINT/强杀仍是硬边界。
- 核心全量首轮偶发 2 条并发假红（`mutate-anchor-titles` / `mutate-verify-gates` 的「真表」各 1 条），
  单跑 190/190、同命令重跑 678/678 全绿；第 1204 页已登记，尚未定位共享状态。
- 真机证据：四支被判卷消费的读数已带保质期章；其余冒烟只做诊断，改 renderer 后按需重跑。
- 发送队列：入队次序已收口（队尾＝加入队列/回车，队首＝立即/⌘↩）；`/goal` 配 ⌘↩ 的窄竞态
  登记在第 1203 页，未处理。
- F4 官方价已读，等 §四/§五 裁决后标定价表与美元闸口径；F6 不代替业主裁决。
- ADR 0015 已写为 Proposed（`docs/adr/0015-ds-bot-benchmark.md`），待业主批准；批准前不写实现代码。
  Phase 4 spec 未开始。
