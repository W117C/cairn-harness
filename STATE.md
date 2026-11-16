# Cairn / DSH —— 现态

rev: ac43ad03（合流收口后的代码基线）

核对日期 2026-11-16（Asia/Shanghai）。本笔把两条同架构的线合流：`qoder/ui` 的键盘契约 / 焦点 /
弹层收尾（`683a2953`，第 1310–1313 页）与 `improve-bot-and-glass-wallpaper-content` 的 bot＋玻璃壁纸
（`1d66bfb6`，第 1299 页，协议 v79）。二者同基线 `2bdac46a`，代码面仅 `GeneralSection.tsx` 一处
import 相撞（键盘导航 ＋ 壁纸浏览器，两份都留）；其余自动并净。合流后 desktop 严格 tsc 抓到两处
语义回归并已收口（`ac43ad03`）：团队面档位名改读 `permission-labels.MODE_LABEL` 单一事实源（qoder 线
已把 `STR.permissions` 档位副本收编走）；删 `ModalSurface` 未接线的 occlusion 死 import（`native-view-occlusion`
模块 1261 页成形但接线未完成，留作积木）。**验证读数**：desktop 严格 tsc 0；desktop 判卷 425 文件 /
2766 条全绿；boundary-check 绿；四包真机重签全 PASS（新指纹 `1da27675…`，buildFresh=true）。分支与门禁状态见
[仓库状态与分支](docs/REPOSITORY-STATUS.md)，历史证据见 `PROGRESS.md` 与 `outputs/`，可复跑测量见 `pnpm facts`。

> 设计收敛线 `simplify-desktop-design`（R2–R5）基线是 `main`，设置区已重构掉 GeneralSection/Permissions/Provider，
> 与本线架构分叉，**未并入**，留待业主裁决走向。

## 当前工作

### bot ＋ 玻璃壁纸（improve-bot 线，已并入）

- **2026-11-16 协议 v59**（第 1250 页，`9ed09946`）：壁纸加系统休眠/锁屏暂停（`onWallpaperSuspend`），
  实机验到「锁屏推送 ⇒ 暂停」与「真系统选文件面板被调起」；bot 的成员档案接到底（团队事件日志 →
  投影、`teamRoster`/`teamMemberSave`、设置页「团队」面板、墓碑即移除）。ADR 0015 转 Accepted。
  面板族：侧栏成员区（只读）＋设置 › 团队（名单/改档/增删/排一轮/开新段/三维读数）＋团队窗格（⌘⇧K）。
  段的自动触发已落（压缩结尾 ⇒ 下一轮开新段，幂等）；发言权已接进**编排引擎**（每次 dispatch 波先仲裁：
  paused ⇒ needs_you、order ⇒ 改派发顺序，仲裁器坏了 fail-open）。
- **2026-11-16 bot 三件最小件 ＋ 壁纸真机四格**（第 1248 / 1249 页）：段/发言权/成员档案的纯逻辑与判卷；
  壁纸冒烟 36 条，关掉「视频失焦暂停」「降级点名」两格老账，修对比度常量漂移 9–10/通道，
  首帧底色决策抽成可判模块（含「窗口真铺上了」）。
- **2026-11-16 边界收口**（第 1299 页，`7860b300`）：WCAG 数学上移到 `src/wallpaper/contrast.ts`，
  收掉 `src/verification → apps/desktop` 的红线；四包重签，verify-all 七门全 pass。
- **2026-11-16 bot spec 第一篇 ＋ 壁纸首帧底色**（第 1247 页，`049fff94`）：bot 侧只补 ADR 0015
  「§九 未决」五口；壁纸把图片壁纸的 1×1 平均色当首帧底色，读不出回落主题底色。

### 键盘契约 / 焦点 / 弹层（qoder 线，已提交 683a2953）

- **2026-11-16 授权宿主 / 菜单归还 / 快速打开落点**（第 1313 页）：关闭浏览器标签同时撤掉该标签的
  未决授权；`PathMenu` 关闭只在焦点丢失时交还右键那一刻的控件；命令面板快速打开在行渲染且窗格前台后
  把焦点落到目标行（`FilePane` 收 `active`）。
- **2026-11-16 预览与放大态的 Esc 主权**（第 1312 页）：改动卡预览在场时卡片自持 Esc（只收预览）、
  焦点离开收预览、Esc 取消未到点的排期；浏览器放大态在全局 Esc 上无条件让路；浮层选择器收进
  `floatingSurfaceOpen()` 一处。
- **2026-11-16 内联确认卡与标签焦点**（第 1311 页）：危险档确认卡打开即聚焦「取消」，Esc 只退一层、
  Tab 在两颗按钮间成环，取消回列表按行归还焦点；弹层在确认态把 role / haspopup 从 menu 换成
  alertdialog / dialog。
- **2026-11-16 键盘契约并回一份**（第 1310 页）：单选组 / 模板网格 / 浏览器标签 / 供应商 tablist /
  检查器 / 窗格标签 / 菜单共用 `renderer/radio-nav.ts`（方向键沿组轴循环 + Home/End + 组内单个 Tab 停点），
  平行下标副本删除；供应商 tablist 只装 tab、详情挂 tabpanel。
- **2026-11-16 弹层对话与焦点收尾 / 快照身份去时钟 / 判卷空过与归属 / 判卷面收口**（第 1310 / 1308–1307 /
  1301–1307 页）：插件导入弹层 dialog 语义；快照目录名改 `<callId>--<原件摘要>`；空过第三批补分母；
  证据缺席改独立断言、单文件否定断言迁 30 处。

### 更早（两条线共有）

- 2026-11-15 同 id 跨工作区收口、目标与旁路、web_search HTML 解析、会话 metadata 按根分卷、
  重复 id 归属裁决（ADR 0016）、macOS 打包资产等见第 1183–1303 页；公开线仍是 AGPL `main`，
  内测开发历史只留本地。

## 代码入口

- 核心在 `src/`，应用服务在 `src/main/`，桌面在 `apps/desktop/`。依赖方向与 IPC 规则见 `AGENTS.md`。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)，
  启动与使用说明见 `README.md`。

## 未决

- 助手行 fluid stop 的右缘、设置页分段控件强调色边界仍待确认。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。
- F6 的 A2 默认页 / C3 自有索引、F3 的 A/B/C/D 未启动；ADR 0015 已 Accepted，成员档案接通，
  发言权与段的调用方仍未接（第 1250 页）。
- **设计收敛线（simplify-desktop-design）与本线架构分叉，走向待业主裁决。**

## 下一步

- 第 1243 页清理前副本在 `/tmp/cairn-cleanup-20261115-2134/`。
- 重复 id metadata 归属按 [ADR 0016](docs/adr/0016-legacy-session-metadata-ownership.md) 裁决（第 1241 页）；
  桌面认领 UI 另立裁决并同步协议。
- 单文件否定断言余 5 处，上限与理由在 `negative-assertion-surface.test.ts`（第 1306 页）。
- 按[路线图](docs/ROADMAP.md)继续：真实模型验收、跨机器桌面预览、正式签名/公证与交付证据收口。
- 判卷面：解释器形状交给执行层；正常退出已等后台任务复查（第 1204 页），SIGINT/强杀仍是硬边界。
- 全量套件的瞬时红先查在飞写入者（`git status` 与最近提交），再重跑；判据继续读工作树。
- 真机证据：四支被判卷消费的读数带保质期章、缺席由台账判红；本次合并改了 renderer，**四包已重建重签**
  （cds/ime/overlay/queue 真机探针全 PASS，统一新指纹，buildFresh=true）。
- `native-view-occlusion`（1261 页）模块已就位但接线未完成：ModalSurface / BrowserPane 尚未消费，另立收尾。
- F4 已按 A 落价；F6 / F3 的未决项不代替业主裁决；ADR 0015 批准前不写实现代码。