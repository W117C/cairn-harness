# Cairn / DSH —— 现态

rev: bddf2f94

核对日期 2026-11-18（Asia/Shanghai）。IM 通道线收口于 `bddf2f94`（台账第 1318/1319 页）：
**协议 v80**（飞书长连接 + 邮件 IMAP/SMTP + 企业微信智能机器人；核心 `src/im/` electron-free
零新依赖，密钥只存 safeStorage 键名；外部消息进绑定会话、run 收束取 assistant_message 回信）
与**玻璃材质升级**（暗釉主题化 / blur×saturate / 分层内阴影＋景深）。验证：核心 713 文件 /
8379 条全绿（maxWorkers=2）；桌面 **427 文件 / 2783 条全绿**（外部删除的字体/icns 已按 HEAD
字节恢复，见第 1319 页 §二）；typecheck 0；boundary/docs-check 绿；四包证据重签 MATCH。

> 设计收敛线 `simplify-desktop-design`（R2–R5）已摘取完毕（第 1315 页）；分支走向仍待业主裁决。

## 当前工作

### bot ＋ 通道（本线，工作树待提交）

- **协议 v80**：IM 通道七件（imList/imAdd/imUpdate/imRemove/imPair/imUnpair/imRetry），
  channels 表 184 条 20 域（新 `im` 域）；wired 全接真；preload 泛型桥接自动带过。
- 设置 › 通道：平台表单（密钥=密码框）、连接清单（状态点名/启停/重连/移除走 ConfirmDialog）、
  待审请求允许/拒绝、已配对解除。
- 团队/派活/定时任务面不动（v59–v79 已收口，见第 1250/1315 页）。

### 键盘契约 / 焦点 / 弹层（qoder 线，已提交 683a2953）

- 第 1313 页授权宿主/菜单归还/快速打开落点；第 1310 页键盘契约并回一份（radio-nav 单源）。

### 桌面打磨（批 1–6，已提交 a9262bbb）

- 流面动效与弹层质感、布局/插件市场/bot 团队面、设置面五条、搜索直达行＋保存闪条退场。

## 代码入口

- 核心在 `src/`（IM 通道核心在 `src/im/`），应用服务在 `src/main/`，桌面在 `apps/desktop/`。
  依赖方向与 IPC 规则见 `AGENTS.md`；IM 通道的密钥纪律：连接记录只有 safeStorage 键名。
- 桌面视觉契约见 `apps/desktop/design/desktop-design-spec.md`，稳定符号见 [CODE-WIKI](docs/CODE-WIKI.md)。

## 未决

- 外部会话删了 tracked 二进制资产（两支字体 + cairn.icns）：桌面套件 3 红，等在飞写入者收口。
- 玻璃观感与通道真机全流程待业主目验（第 1318 页 §五）；企业微信/Telegram/Slack 为 V2 候选。
- 助手行 fluid stop 右缘、设置分段控件强调色边界仍待确认（沿第 1316 页）。
- 内测许可和第三方素材外部分发权限需在发版前单独确认。

## 下一步

- 本页与第 1318 页工作树待提交（提交后四包证据与 STATE rev 同步推进）。
- 微信通道 V2 候选排序（企业微信 callback / 参照仓现成协议）待业主裁决。
- 重复 id metadata 归属按 [ADR 0016](docs/adr/0016-legacy-session-metadata-ownership.md) 裁决（第 1241 页）。
- `native-view-occlusion`（第 1261 页）接线未完成：ModalSurface / BrowserPane 尚未消费。
- 真机证据：四支判卷消费的读数已按本线现源重签；后续 renderer 改动仍需重建重签。
