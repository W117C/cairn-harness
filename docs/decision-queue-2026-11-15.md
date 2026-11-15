# 待裁决队列（2026-11-15）

- **状态**：索引，不是裁决本身；各项各自有独立裁决输入，本文件只把「要你选什么、推荐什么、选完解锁什么」
  放在一页，避免四份文档分散。
- **基线**：代码 `42050518`（HEAD 的文档提交 `46be5bb7` 之后只有文档）；各文件里的证据不重复抄。

## 一、F4：GLM 三档怎么填价

- **裁决输入**：`docs/glm-pricing-decision-2026-11-15.md`
- **要选**：A（standard=5.2、strong=5.3，同价 8/28/2 CNY）／B（standard=5.1、strong=5.3，另立 5.2 价）／
  C（只修模型名，价表继续占位——模型名已修，价表仍未动）。
- **推荐 A**：官方 5.2 与 5.3 同价；strong=5.3 是唯一不改变「strong=最强」语义的映射。选 A 后
  `routing-check` F2c 要从「三档两两不等」改成「cheap 严格最低、standard/strong 允许同价」，并同步
  10 条价格/路由测试；价表三行转 `calibrated: true`（缓存写价仍无官方数，按 `null` 标未标定）。
- **选完解锁**：F4 关闭；美元闸从「上界」变「可核对实付」；不改变默认模型/端点。

## 二、F6：搜索还差哪一块

- **裁决输入**：`docs/web-search-self-host-2026-11-15.md`（A1/B 已落）、`docs/searxng-self-host-2026-11-15.md`（B 指南）
- **已落**：`html` provider 端到端（`9b1a50d4`）、HTML 抽取（`8927d23f`）、测试连接接受 HTML（`42050518`）、
  B 的 SearXNG 运维指南（`0bdb2289`）。
- **还要选**：A2（带一个默认 HTML 搜索页）／C3（自有 crawler + 本地索引）／两者都不做。
- **推荐：两者都不做（本轮）**。A2 是供应商/ToS 决定；C3 是新存储面 + 后台抓取 + 非离线判卷，应独立立项。
  保持「没配即 fail-closed」；用户可用 A1 的 HTML 端点或 B 的 SearXNG。
- **选完解锁**：F6 可按「A1+B 已交付，A2/C3 明确不做」关闭，不再每轮挂起。

## 三、F3：桌面组件栈

- **裁决输入**：`docs/component-stack-decision-2026-11-15.md`
- **要选**：A（Radix Themes 进主应用）／**B（推荐：Radix Primitives + CDS）**／C（全手写）／D（Ant/MUI）。
- **B 的代价**：建 `components/ui/` 薄封装 + boundary 判据，先收 DropdownMenu（14 处直接 import），
  再迁 Dialog/Select/Tooltip；无新主题层，视觉仍由 CDS token 钉住。
- **选完解锁**：F3/ADR 0003 可关闭；后续组件迁移有明确边界；不改变现有视觉。

## 四、ADR 0015：bot 团队落点

- **裁决输入**：`docs/adr/0015-ds-bot-benchmark.md`（Proposed）
- **要选**：批准形态 A（核心内建）/要求改 B/C/D/暂缓。
- **推荐 A**：插件面封闭、事件种类封闭、核心/桌面边界三条硬约束都指向核心内建；骨架三件与五条不变量
  已在 ADR §四/§五。批准后下一步是 Phase 4 spec（先判据后实现），不是直接写代码。
- **选完解锁**：bot 团队项目进入 spec；当前不写实现代码。

## 五、ADR 0016：重复 id 历史 metadata 归属（已裁）

- **裁决输入**：`docs/adr/0016-legacy-session-metadata-ownership.md`（**已接受**，2026-11-15）
- **要选**：自动按启发式选边／批量迁移／**不猜 + 可枚举 + 显式认领**／直接删除旧卷。
- **已裁**：第三项。无 `workspaceScoped` 的重复 id 记录永不自动选边；`listUnattributedSessionMetadata`
  可枚举，`claimSessionMetadata(id, root)` 经已登记根闸显式认领；装配根读面也过滤未决记录。
- **选完解锁**：`STATE.md` 那条「需业主裁决」关闭；本轮不新增 IPC/UI/协议版本，桌面认领入口另立裁决。

## 六、如果只想先答一个

F4 已落 A、ADR 0016 已裁；现在先答 **F6 的 A2/C3** 或 **F3 的 A/B/C/D**；ADR 0015 批准后可进 Phase 4 spec。

## 七、参考

- `docs/glm-pricing-decision-2026-11-15.md`
- `docs/web-search-self-host-2026-11-15.md`、`docs/searxng-self-host-2026-11-15.md`
- `docs/component-stack-decision-2026-11-15.md`
- `docs/adr/0015-ds-bot-benchmark.md`
- `docs/adr/0016-legacy-session-metadata-ownership.md`（已接受）
