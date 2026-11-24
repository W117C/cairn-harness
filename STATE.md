# Cairn / DSH —— 现态

rev: d6637c9e

核对日期 2026-11-22（Asia/Shanghai）。IM 通道线第 1320 页收口于 `9b5ef007`：**协议 v81**
（飞书长连接 + 邮件 IMAP/SMTP + 企业微信智能机器人 + 微信 iLink 扫码登录）。微信走官方 iLink
机器人：`get_bot_qrcode` 出码 → `get_qrcode_status` 轮询确认 → 建连；游标 `get_updates_buf` 与
每用户 `context_token` 存**连接运行态**（随 connections.json 持久化，重启不重放）；发送带
context_token、1800 字分片；出站 baseurl 钉死 https + `*.weixin.qq.com`。核心 `src/im/`
electron-free、零新依赖，连接记录只有 safeStorage 键名。验证：核心（maxWorkers=2）与桌面套件、typecheck、boundary/docs-check 全绿；
四包证据按本线现源重签（读数见 `pnpm facts` 与第 1337 页）。

> 设计收敛线 `simplify-desktop-design`（R2–R5）已摘取完毕（第 1315 页）；分支走向仍待业主裁决。

## 全仓体检（第 1323–1327 页）

- **四个根因修复**：原生视图让位接线（账本此前零消费者）／IM 入站空文本闸（空串会先建会话再空跑）／
  项目名规矩单源（`src/main/project-name.ts`，渲染层此前只查 `\ /`）／相对时间分档单源（差异收成参数）。
- **证据面危险码 12 → 0**，`DANGER_BASELINE = {}`（零容忍）；删掉一份违规的源码副本；变异门禁加 `--heal`。
- **主线存量失效针脚**按现源改形状（`buildWorkerSystemMessages` 五参），两态各证一次。
- **架构全量**：值依赖图 1081 边 / 0 环，`as any` 与 `@ts-ignore` 均 0，IPC 全键 Record、工具面双向闭合。
- **IM 发送队列两条静默丢消息**已修：连接窗口期补发、`retry` 停靠队列。
- **两处撤回**：「242 条报错降到 0」这个目标本身写坏；不加 `ImInboundMessage.attachments?`（无消费方的字段）。
- **真机探针面**：80 支冒烟只有 4 支进门禁；抽样 3 支有 2 支红，红因是**夹具过期**（不是产品缺陷）
  ⇒ 纪律：探针清单要可见、夹具从 `DEFAULT_SETTINGS` 派生、改设置/窗格面就必须重跑受影响的探针。

报告：`outputs/audit-2026-11-18/report.md`（缺陷分类）与 `architecture.md`（量具与模块表）；明细见台账 1323–1327。

## 当前工作

### 桌面 1:1 复刻（ADR 0019，第 1334–1337 页）

- 设计方向已翻转：CDS 官方令牌薄＋组件规则＋适配层是唯一视觉事实源；P1 四件如实
  `no-cairn-counterpart`，P2 编排器 dock、P3 左栏单栏化各落首刀。
- 性能：长会话行级 content-visibility **延迟武装**已入 `d6637c9e`（打开路径先无 c-v），
  打开与流式两预算由 `performance-smoke` 钉住；读数与阈值见第 1337 页。
- 当前提交：第 1339 页把首屏中央区改为官方项目卡组 / 本地环境 / 启动动作，Card/CardLink
  移植账 10→12；最近项目回落与刷新、当前项补位、长分支几何、dialog ARIA / 实际 opener 回焦、
  Card `0.99` 缩放 / `2px` 内缩、危险档确认与权限落盘均已收口。
  桌面 434/2823、layout-smoke 36/36、四份证据已按现源重签。**未做 HEAD 认证。**

### bot ＋ 通道（v81 已提交）

- **协议 v81**：v80 七件（imList/imAdd/imUpdate/imRemove/imPair/imUnpair/imRetry）＋扫码两段
  （imLoginStart/imLoginWait），channels 表 186 条 20 域（`im` 7→9）；wired 全接真；preload 泛型桥接自动带过。
- 设置 › 通道：表单平台（密钥=密码框）与扫码平台（二维码流：出码 / 轮询三态 / 确认即建连、
  扫码人直接进配对名单）两支；连接清单、待审请求、已配对解除不动。
- 二维码本地画：`apps/desktop/src/renderer/derived/qr-matrix.ts`（零依赖 ISO/IEC 18004，
  byte 模式 / 纠错 M / v1–10），iLink 回的是待编码文本而不是图片。
- 团队/派活/定时任务面不动（v59–v79 已收口，见第 1250/1315 页）。

键盘契约（`683a2953`）与桌面打磨批 1–6（`a9262bbb`）已完成，结论迁档见 `docs/archive/state-2026-11-16-merge.md`。

## 代码入口

- 核心在 `src/`（IM 通道核心在 `src/im/`），应用服务在 `src/main/`，桌面在 `apps/desktop/`。
  依赖方向与 IPC 规则见 `AGENTS.md`；IM 通道的密钥纪律：连接记录只有 safeStorage 键名。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)。
- 扫码登录：核心 `src/im/platforms/weixin.ts` + 宿主 `src/im/host.ts`；设置面
  `apps/desktop/src/renderer/components/settings/ChannelsSection.tsx`。

## 未决

- 微信扫码全流程真机目验待业主（扫码 → 确认 → 外部消息进主 bot 会话 → 回信出通道）。
- 图片/文件消息 V1 不收（weixin 只收文本与语音转写；图片走 CDN + AES 解密面，按需再做）。
- 玻璃观感与其余通道真机全流程待目验（第 1318 页 §五）；Telegram/Slack 为 V2 候选。
- 助手行 fluid stop 右缘、设置分段控件强调色边界仍待确认（沿第 1316 页）。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。

## 下一步

- 1:1 复刻按 [ADR 0019](docs/adr/0019-claude-desktop-1to1-design.md) 分面推进（P2/P3 已落首刀，余面见第 1334–1337 页）。
- 五支冒烟脚本缺省输出已收口为默认 mkdtemp（第 1338 页）；apps/desktop 下两份历史落盘 JSON 已退役。
- 重复 id metadata 归属按 [ADR 0016](docs/adr/0016-legacy-session-metadata-ownership.md) 裁决（第 1241 页）。
- 真机证据：四支判卷消费的读数已按本线现源重签；后续 renderer 改动仍需重建重签。
