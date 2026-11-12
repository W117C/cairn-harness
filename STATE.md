# Cairn / DSH —— 现态

rev: ccf35864849f02fb7b0295effc532725c4479229

核对日期：2026-11-12（Asia/Shanghai）。`rev` 是本轮开工时的干净基线（第 1039 页十批切分提交后的 tip）；
本轮（第 1041 页）与其后第 1042–1168 页改动均**未提交**，在工作树。仓库与分支的现役入口是[仓库状态与分支](docs/REPOSITORY-STATUS.md)；
测量与历史证据放在 `outputs/`、`PROGRESS.md` 与 `archive/`，本页只写状态与下一步。

## 当前工作

- 桌面端对标 Codex / Claude 的持续优化按批推进（业主长期执行令）。第 1041 页：列宽／气沟收进 `.main` 单源、品牌标同屏一处、`layout-smoke` 改钉。
- **第 1042–1072 页**（settled，详见 PROGRESS）：QoderCN 失败回合续修 16 批（zcode 对标、思考体限高/流光、多视口走查、Tab 逃逸）；两处真回归修复（inert 被 React 18 丢弃、删演示半截移植）＋冒烟旧落位普查；死代码与 STR 零消费清理（1085→1064 叶子）；STR 绕过债收编（WorkStatusPanel／Inspector／shortcuts）；settings-sections 八段全拆到 settings/（monolith 943→74）；冒烟 profile 泄漏根因纠正＋共享 helper。
- **第 1073 页**：Composer 附件 chip 两处静默失败修为 toast＋STR（判卷 +1、变异恰红）；343/2388。
- **第 1074 页**：并行 worker 语义冲突雷达——纯内核 `conflict-radar.ts`＋合并塔 `[radar]` 告警／gate 拦截；core 665/8051、变异恰红两格。
- **第 1075–1078 页**：设置面五段 STR 收编＋判据 STR 形感知（样本 6→22、逐文件哨兵）；`strings.ts` 撞 I4 帽先拆 `strings-settings.ts`；五门绿、变异各恰红。
- **第 1079–1081 页**：冒烟 profile 清理 82 支＋覆盖率判卷；PaneDock 授权写收成带结果提交口（回滚＋fail-closed）；same-id 冒烟修好 8/8＋脚本语法哨兵；346/2396。
- **第 1082–1090 页**：同族「视图说成功、事实没发生」续扫——`cancelRunHeal` IPC 拒绝收口 `setLastError`；终端 ⌘C/⌘V 剪贴板拒绝收口 `showError`；弹出窗 `openSession` 拒绝收口「会话载入失败」；无宿主链接回落失败接「链接打开失败」；自定义供应商 `providerCustomList` 失败不再永远「正在读取配置」；设置读失败统一走 `readOrError` 上屏（密钥／联网免批／保存后回灌／供应商清单／getState／capabilities；能力失败的搜索/识图行显示「能力读取失败」）；工作台首读设置失败不再静默用默认档。各页先红后绿、变异恰红；380/2449、tsc0、1135/1136/1137/1138/1139/1140/1141/1142/1143/1144/1145/1146/1147/1148/1149/1150/1151/1152/1153/1154/1155/1156/1157/1158/1159/1160/1161/1162/1163/1164/1165/1166/1167/1168。
  续批登记：浏览器授权面真机交互未跑（第 1080 页边界）；`PopoutApp` 主题回落是安全默认；本族已无未收口项。
  待裁决沿用：正式未决两条、四选一剩余项 / C/D、Tab 倒跳、是否连 A/B 轻度一起撤、提交与 dev→main 集成。未提交。
- 共享工作树除本轮改动外无其他会话在飞改动；本轮不替任何他笔背书。
- 开发线与 `origin/main` 已分叉且双方各有对方没有的提交；直接合主线会在锁文件、CI 配置与核心源文件撞冲突，
  必须先做集成（见下一步）。

## 代码入口

- core 在 `src/`，应用服务在 electron-free 的 `src/main/`；desktop 在 `apps/desktop/`，依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约在 `apps/desktop/design/desktop-design-spec.md`（§4.9 竞品对照册、§4.10 层级与动效、§9 目验修订）；
  列宽/气沟单源与品牌补位的机器判卷在 `apps/desktop/tests/column-single-source.test.ts`、
  `app-toolbar-brand.test.tsx` 与 `quick-starts-ui.test.tsx`，几何证据在 `apps/desktop/scripts/layout-smoke.cjs`。
- 隐藏面隔离与演示标识的真机证据在 `apps/desktop/scripts/inert-hidden-face-smoke.cjs` 与
  `session-continuity-smoke.cjs`（隔离实例、离线 demo provider）；判卷在 `apps/desktop/tests/destination-workspace.test.tsx`、
  `demo-banner.test.tsx`、`contrast-gate.test.ts`。
- 符号和稳定契约见 [CODE-WIKI](docs/CODE-WIKI.md)；功能使用见 `README.md`。

## 未决（待业主裁，登记不动）

- 助手行 fluid stop 的作用层级：现作用于整行 `margin-right`，代码块/表格/交付卡右缘比输入卡内缩一截；
  上游 CDS 对 Card/Table/FileDiff 把 stop 重置 0（只给 prose 留右白）。反转第 862 页「四段同右缘」裁决需拍板。
- 设置页分段控件选中态的强调色边界（「中性用色」与「焦点环=强调色域」两条裁决的交界），第 910 页登记未动。

## 下一步

- 第 1041–1083 页收尾链跑完后按业主裁决决定是否提交；提交前 `gates` / `head-cert` / `mutate-verify` 不引用为本轮证据。
- 在隔离工作区做 dev → main 集成：先解 `pnpm-lock.yaml`、`package.json` 与 `.github/workflows`，
  再按 `src/main`、`src/agent`、`apps/desktop` 三组逐个核对，保留双方功能。
- 集成分支的判据：两套套件 + 根 typecheck + `docs-check`；任一项红不进 `main`。

## 验证与交付边界

- 本轮证据覆盖**工作树**（桌面与 core 全量、两支真机冒烟现跑）；`pnpm gates` / `head-cert-check` / `mutate-verify`
  量的是提交，未提交前不引用。
- 离屏假 API 截图与几何读数证明版式与状态属性；真机观感（字体渲染、拖拽、Radix 菜单手感）归业主目验。
- **业主真机 Electron 实例正在运行**（pnpm PID 3465 / Electron 3473）；第 1082–1083 页改渲染层源但**未重建 dist**（不在业主实例存活时重建），运行实例仍是 1082 前产物，修复经 vitest 直读源码验证。dist 重建待业主关实例后另批。隔离实例与临时取证目录收尾净归零。
