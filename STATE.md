# Cairn / DSH —— 现态

rev: 52e2b28a

核对日期 2026-11-17（Asia/Shanghai）。两条同架构的线已合流（closeout 归档见
[docs/archive/state-2026-11-16-merge.md](docs/archive/state-2026-11-16-merge.md)）：`qoder/ui` 键盘契约 /
焦点 / 弹层（`683a2953`）＋ bot／玻璃壁纸（`1d66bfb6`），合流回归收口 `ac43ad03`；随后桌面打磨
批 1–6 提交至 `a9262bbb`。验证读数：desktop 严格 tsc 0；判卷 425 文件 / 2766 条全绿；
boundary 绿；四包真机重签全 PASS（`1da27675…`，buildFresh=true）。分支与门禁见
[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见 `PROGRESS.md` 与 `outputs/`，可复跑测量见 `pnpm facts`。

> 设计收敛线 `simplify-desktop-design`（R2–R5）基线 `main`，设置区已重构掉 GeneralSection/Permissions/Provider，
> 与本线架构分叉，**未并入**，留待业主裁决走向。

## 当前工作

### bot ＋ 玻璃壁纸（improve-bot 线，已并入）

- **协议 v59**（第 1250 页，`9ed09946`）：壁纸系统休眠/锁屏暂停；成员档案接底（团队事件日志 → 投影、
  团队面板、墓碑即移除）。ADR 0015 Accepted。面板族：侧栏成员区＋设置 › 团队＋团队窗格（⌘⇧K）。
  段自动触发已落（幂等）；发言权已接编排引擎（dispatch 波先仲裁，仲裁器坏了 fail-open）。
- **三件最小件＋壁纸真机四格**（第 1248/1249 页）；**边界收口**（第 1299 页，`7860b300`）：
  WCAG 数学上移 `src/wallpaper/contrast.ts`，收掉验证层 → apps 红线；**spec 第一篇＋首帧底色**（第 1247 页）。

### 键盘契约 / 焦点 / 弹层（qoder 线，已提交 683a2953）

- 第 1313 页授权宿主/菜单归还/快速打开落点；第 1312 页预览与放大态 Esc 主权；第 1311 页内联确认卡与
  标签焦点；第 1310 页键盘契约并回一份（radio-nav 单源）；第 1301–1310 页弹层对话/快照身份/判卷面收口。

### 桌面打磨（批 1–6，本线，至 `a9262bbb`）

- 批 1+2 流面动效与弹层质感（`3cc4dddf`）；批 3+4+5 布局/插件市场/bot 团队面（`0c4549c2`）；
  批 6 设置面最小五条（`903207a6`）、搜索直达行＋保存闪条退场（`973f41fd`）、Mimosa 误报收口（`a9262bbb`）。
- 批 6 余下项（About 三段拆分）与设计收敛 R3/R4 A/B 档移植在工作树，待复跑证据后提交。

### 更早（两条线共有）

- 2026-11-15 起第 1183–1303 页：同 id 跨工作区收口、web_search HTML 解析、会话 metadata 按根分卷、
  ADR 0016、macOS 打包资产等；公开线仍 AGPL `main`。

## 代码入口

- 核心在 `src/`，应用服务在 `src/main/`，桌面在 `apps/desktop/`。依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)，
  启动与使用说明见 `README.md`。

## 未决

- 助手行 fluid stop 的右缘、设置页分段控件强调色边界仍待确认。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。
- F6 的 A2 默认页 / C3 自有索引、F3 的 A/B/C/D 未启动；ADR 0015 已 Accepted，段与发言权的调用方仍未接（第 1250 页）。
- **设计收敛线（simplify-desktop-design）与本线架构分叉，走向待业主裁决。**

## 下一步

- 第 1243 页清理前副本在 `/tmp/cairn-cleanup-20261115-2134/`。
- 重复 id metadata 归属按 [ADR 0016](docs/adr/0016-legacy-session-metadata-ownership.md) 裁决（第 1241 页）；
  桌面认领 UI 另立裁决并同步协议。
- 单文件否定断言余 5 处（`negative-assertion-surface.test.ts`，第 1306 页）。
- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、正式签名/公证与交付证据收口。
- 判卷面：解释器形状交给执行层；正常退出已等后台复查（第 1204 页），SIGINT/强杀仍是硬边界。
- 全量套件的瞬时红先查在飞写入者（`git status` 与最近提交），再重跑；判据继续读工作树。
- 真机证据：四支被判卷消费的读数带保质期章、缺席由台账判红；工作树改动 renderer 后需**重建重签**。
- `native-view-occlusion`（第 1261 页）模块已就位但接线未完成：ModalSurface / BrowserPane 尚未消费。
- F4 已按 A 落价；F6 / F3 的未决项不代替业主裁决；ADR 0015 批准前不写实现代码。
