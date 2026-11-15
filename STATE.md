# Cairn / DSH —— 现态

rev: 8927d23f

核对日期 2026-11-15（Asia/Shanghai）。`rev` 是开发线现役基线；第 1200 / 1203 / 1204 页的判卷面与桌面改动在
它之上的工作树里，尚未提交。分支与门禁状态见[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见
`PROGRESS.md` 与 `outputs/`。

## 当前工作

- **2026-11-15 web_search HTML 结果抽取**（`8927d23f`）：非 JSON HTML 端点先试保守抽取（≥3 条、≥2 主机、
  每条有摘要），失败才回原文；无新 provider/默认页。第 1213 页；认证 `8927d23` 25/25、678/8150。
- **2026-11-15 F3 组件栈裁决输入**：`docs/component-stack-decision-2026-11-15.md`；现状 Radix 原语
  ＋手写＋CDS，非 ADR D2 的 Themes；建议 B（Primitives + CDS），待选 A/B/C/D。第 1209 页。
- **2026-11-15 F6 自研搜索裁决输入**：`docs/web-search-self-host-2026-11-15.md` 区分 C1 代码自研 / C2
  自托管 / C3 自有索引；建议 A1（自研 HTML 适配器）+ B（SearXNG 运维文档），C3 另立项；待业主回答四问。
  第 1208 页。
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
- **2026-11-15 GLM 强档模型名修正**（`18495794`）：`glm-strong` 改为官方旗舰 `glm-5.3`（1M）；价表仍占位，F4 映射待裁决。
- **2026-11-15 ADR 0015（bot 团队调研裁决，Proposed）**：落点 A（核心内建）＋骨架三件＋数据模型
  B3/G2/P2/R1/S1/C2/L1＋五条不变量；文件 `docs/adr/0015-ds-bot-benchmark.md`；待批准后进 Phase 4 spec。
- **2026-11-15 判卷面收束与证据保质期**（第 1200 页，工作树）：后台四条终止路径汇进 `settle` 链；
  `fs_ops` 拒收含冻结文件的整树搬走；桌面四支真机判卷共用 renderer 摘要 + 同构建判据。
- **2026-11-15 依赖与路由标定闸**（`4240634c` / `962548a9`，第 1198 页）：主包摘掉未使用的
  `@radix-ui/themes`；`routing-check` F2d 改用合成表自证；GLM 价梯冲突写成裁决输入（未改价表）。
- **2026-11-15 判卷面 shell 绕过收口**（`01d2ae2`，第 1195 页）：词法取料抽成
  `shell-write-targets.ts`；Seatbelt 对每个冻结文件 literal 写拒绝；`run_shell` 跑前基线 + 跑后复原。
  取证件 `outputs/judge-integrity-2026-11-15/`。
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
