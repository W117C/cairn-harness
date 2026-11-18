# Cairn / DSH —— 现态

rev: e096678e

核对日期 2026-11-18（Asia/Shanghai）。IM 通道线第 1320 页收口于 `9b5ef007`：**协议 v81**
（飞书长连接 + 邮件 IMAP/SMTP + 企业微信智能机器人 + 微信 iLink 扫码登录）。微信走官方 iLink
机器人：`get_bot_qrcode` 出码 → `get_qrcode_status` 轮询确认 → 建连；游标 `get_updates_buf` 与
每用户 `context_token` 存**连接运行态**（随 connections.json 持久化，重启不重放）；发送带
context_token、1800 字分片；出站 baseurl 钉死 https + `*.weixin.qq.com`。核心 `src/im/`
electron-free、零新依赖，连接记录只有 safeStorage 键名。验证：核心 **714 文件 / 8386 条全绿**
（maxWorkers=2）；桌面 **428 文件 / 2788 条全绿**；typecheck 0；boundary/docs-check 绿；
四包证据重签 MATCH（rendererDigest `02764f0c…`、buildFresh=true）。

> 设计收敛线 `simplify-desktop-design`（R2–R5）已摘取完毕（第 1315 页）；分支走向仍待业主裁决。

## 全仓体检（第 1323 页，`fb9fe76d`）

四项根因修复，同一个病：**同一语义存在第二份实现，一份动了另一份没跟**。

1. **原生视图让位**（第 1261 页那条「接线未完成」收口）：账本此前零消费者。现在 ModalSurface 恒持有 /
   CommandPalette 按 `open` / WorkbenchOverlays 按 `dragOverApp`，BrowserPane 订阅并收成零矩形。
2. **IM 入站空文本闸**：图片/文件 V1 不承载 ⇒ `text` 空串会先建会话再起一次空跑。闸设在唯一漏斗
   `host.onMessage`，四平台共同受益。
3. **项目名规矩单源**：`src/main/project-name.ts`（零依赖）同时供核心建目录与渲染层实时校验；
   此前渲染层只查 `\ /` 与控制字符，`a:b` / 65 字符 / `.hidden` / 尾随点四档「对话框绿、创建才被拒」。
4. **相对时间分档单源**：会话面 7 天 / 记忆页 30 天的差异收成 `absoluteAfterDays` 参数。

报告（刻意 / 遗漏 / 隐患三分类 + 工作区清单）：`outputs/audit-2026-11-18/report.md`。

第 1325 页按最优解收口：**证据面危险码 12 → 0**（`DANGER_BASELINE = {}`，零容忍）——那 12 条都是
「读数是有的、探针已经跑不起来」的真断链，逐条修到能编译；删掉一份 176 文件的 `git archive` 源码副本
（AGENTS.md 明令不许停在证据面，源 commit 与复原命令记在报告里）；变异门禁新增 `--heal`
（二十秒收掉残留突变，此前只挂在整表开跑那一拍）。**两处撤回**：「242 条报错降到 0」这个目标本身写坏了
（剩下 204 条是一次性历史探针的样式账），以及不加 `ImInboundMessage.attachments?`
（没有消费方的字段只是把「尚未兑现」挪进契约）。

## 当前工作

### bot ＋ 通道（v81 已提交）

- **协议 v81**：v80 七件（imList/imAdd/imUpdate/imRemove/imPair/imUnpair/imRetry）＋扫码两段
  （imLoginStart/imLoginWait），channels 表 186 条 20 域（`im` 7→9）；wired 全接真；preload 泛型桥接自动带过。
- 设置 › 通道：表单平台（密钥=密码框）与扫码平台（二维码流：出码 / 轮询三态 / 确认即建连、
  扫码人直接进配对名单）两支；连接清单、待审请求、已配对解除不动。
- 二维码本地画：`apps/desktop/src/renderer/derived/qr-matrix.ts`（零依赖 ISO/IEC 18004，
  byte 模式 / 纠错 M / v1–10），iLink 回的是待编码文本而不是图片。
- 团队/派活/定时任务面不动（v59–v79 已收口，见第 1250/1315 页）。

### 键盘契约 / 焦点 / 弹层（qoder 线，已提交 683a2953）

- 第 1313 页授权宿主/菜单归还/快速打开落点；第 1310 页键盘契约并回一份（radio-nav 单源）。

### 桌面打磨（批 1–6，已提交 a9262bbb）

- 流面动效与弹层质感、布局/插件市场/bot 团队面、设置面五条、搜索直达行＋保存闪条退场。

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

- 证据面 242 条 tsc 报错逐个降到 0（危险码帽 12，ratchet down only）。
- 变异门禁加独立自愈入口（现只有整表跑开跑时才自愈；`restore` 不是子命令）。
- 微信图片/文件消息按需开（CDN 下载 + AES 解密）——开之前先给 `ImInboundMessage` 留 `attachments?`。
- 重复 id metadata 归属按 [ADR 0016](docs/adr/0016-legacy-session-metadata-ownership.md) 裁决（第 1241 页）。
- 真机证据：四支判卷消费的读数已按本线现源重签；后续 renderer 改动仍需重建重签。
