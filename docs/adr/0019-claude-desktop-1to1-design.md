# ADR 0019：桌面端设计全面转向 Claude Desktop 一比一复刻

- **状态**：**Accepted**（2026-11-19，业主令「所有的桌面端设计全部按照claude桌面端来，我需要一比一复刻全部」）
- **日期**：2026-11-19

## 裁决

1. **设计方向翻转**：`dsh-claude-style` 从可选皮肤翻转为**唯一设计方向**——CDS 官方令牌薄
   （逐字节 vendored）+ 官方组件规则（components.css）+ 适配层成为全桌面的唯一视觉事实源；
   仓内自有设计线（设计收敛 R2–R5、玻璃观感、.reading 列宽体系）按面逐步退役。
2. **组件移植账是进度的事实源**：`component-map.json` 逐条裁决，`ported` 只增不减；
   迁移的验收单位 = 组件，不是截图心情。
3. **分面迁移**（按可见度排序，每面一个批次，每批带判卷与重签）：
   - **P1 对话面补齐**（已移植 10 件的查漏）：AskUserQuestion→ClarifyCard、TurnStatus/TurnStatusStep
     →agent_status 行、MessageAttachmentsFile/Quote→附件行；
   - **P2 编排器族**：ChatComposerDock/Chin/Editor/Notices + ModelSelector/Effort→Composer.tsx/ModelPicker.tsx
     （全桌面使用密度最高的面）；
   - **P3 词汇族**：Button/ButtonGroup/Surface/Card/Panel/Page/Banner/Accordion/Aside→侧栏/AppRail/设置面/弹窗；
   - **P4 数据族**：DataTable/Table/DiffIndicator/FileDiff/ChartContainer→DiffView/ChangesPane；
   - **P5 皮肤翻转收口**：`dsh-claude-style` 默认开、自有 styles.css 按面退休、截面对照验收
     （对照工具链 = ADR 0009/0010/0014 的 benchmark 证据面）。
4. **复刻依据的边界（不冒充）**：复刻依据是**官方渲染层 CSS 的抽取件**（tokens/components/组件账），
   不是官方源码；像素级验收用离屏截图对照官方真机截图。自有功能组件（团队/编排/通道/靶场面板）
   没有官方对应物的，用官方词汇（Button/Card/Panel/Banner 的 data-cds 选择器）组合实现，
   不凭空虚构官方没有的组件。

## 二阶影响（预先登记）

- `conversation-rail` 判卷钉的几何（列宽/间距）会随 1:1 复刻重测——**判据随设计裁定更新，不弱化**：
  几何真值的来源从「仓内设计稿」换成「官方 renderer CSS 抽取件」，判据改钉新真值时写明出处页/commit。
- 四份真机证据随每批 renderer 变更重签（既有纪律不变）。
- 令牌词汇收敛后 `cds-adapter.css` 只缩不涨（适配层是桥，不是第二事实源）。
