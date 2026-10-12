# 桌面端 UI 产品化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（本计划由计划作者本会话内联执行——六板块共享 styles.css，跨代理并行会互踩）。

**Goal:** 按 spec（`docs/superpowers/specs/2026-10-07-desktop-ui-productization-design.md`）把桌面端六板块做到产品形态。

**Architecture:** 仅动 renderer 层：新增自研 `icons.tsx` + `markdown.tsx` 两个零依赖模块；`Stream/Composer/ModelPicker/SettingsPanel/App` 重排版式与控件；`styles.css` 扩展 token 与组件样式。核心 `src/` 零改动。

**Tech Stack:** React 18 + 原生 CSS（现有 token 体系），vitest 纯函数判卷（react-dom/server 先例）。

**Spec:** docs/superpowers/specs/2026-10-07-desktop-ui-productization-design.md

## Global Constraints

- 零新增 npm 依赖（renderer 只用 react/react-dom）。
- 明文 key 零进 state（SettingsPanel 纪律线不动）；`panelPatch` 白名单五键不动。
- 纯函数出口保留：`flattenModels/groupModels/tierBadge/formatCtxWindow/shortModelName/describeSelection/pickerKeyNotice/THINKING_LEVELS/panelPatch/providerOptions/providerNeedsKey/providerStatusLabel/clarifyFormValues/planFileLines` 及 projections 全部投影函数。
- 没有的 IPC 不摆按钮；placeholder 与能力一致。
- IME 守卫、事件驱动刷新、运行态三闸、赞/踩/回滚语义不动。
- 保留他人未提交改动：只做叠加编辑，不 reset/stash。

---

### Task 1: 统一图标库 icons.tsx

**Files:** Create `apps/desktop/src/renderer/components/icons.tsx`

**Interfaces:** Produces `Icon`(name, size?, strokeWidth?) 与具名导出 `Ic.plus, Ic.search, Ic.filter, Ic.folderPlus, Ic.settings, Ic.sidebarLeft, Ic.panelRight, Ic.send, Ic.stop, Ic.spark, Ic.copy, Ic.check, Ic.thumbUp, Ic.thumbDown, Ic.revert, Ic.alert, Ic.clock, Ic.shield, Ic.shieldAlert, Ic.brain, Ic.chevronDown, Ic.chevronRight, Ic.x, Ic.pencil, Ic.trash, Ic.pause, Ic.play, Ic.target, Ic.book, Ic.plug, Ic.timer, Ic.brainCircle, Ic.key, Ic.eye, Ic.globe, Ic.bolt, Ic.arrowUp, Ic.loader, Ic.sliders`。全部 16 viewBox、stroke 1.5、currentColor。

- [ ] 实现 `Icon` 基座 + 路径表；每个图标 `<Icon/>` 即 `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden>{paths}</svg>`；fill 类（send 实心箭头）单独处理 `fill="currentColor" stroke="none"`。
- [ ] 无新测试（纯展示）；由后续任务使用时判卷覆盖。

### Task 2: markdown.tsx（自研渲染器）

**Files:** Create `apps/desktop/src/renderer/markdown.tsx`；Test Create `apps/desktop/tests/markdown.test.ts`

**Interfaces:** Produces `parseBlocks(src: string): Block[]`（纯函数，判卷面）与 `<Markdown text={string} onCopy?={(code:string)=>void}/>`。`Block` 联合：`{type:"heading",level:number,text}` | `{type:"code",lang:string|null,content:string,open:boolean}` | `{type:"ul",items:string[]}` | `{type:"ol",items:string[]}` | `{type:"quote",text}` | `{type:"hr"}` | `{type:"table",header:string[],rows:string[][]}` | `{type:"p",text}`。行内解析 `renderInline(text): ReactNode[]` 支持 `` `code` ``、`**bold**`、`*em*`、`~~del~~`、`[label](url)`（仅 http/https，rel noreferrer）。

- [ ] Step 1 写失败判卷：parseBlocks 对（标题分级/围栏含语言/未闭合围栏 open:true/无序列表连续行合并/有序列表/引用/分隔线/表格首二行定列/段落聚合/行内要素）断言。
- [ ] Step 2 跑判卷确认 FAIL（模块不存在）。
- [ ] Step 3 实现：逐行扫描状态机（inCode/inQuote/list 缓冲）；XSS 纪律：**全部文本节点，不 dangerouslySetInnerHTML**。
- [ ] Step 4 判卷 PASS。
- [ ] `<Markdown>`：块级 memo 渲染；code 块带语言标签 + 复制钮（icons.copy）；table 用现成 `.md-table` 样式。

### Task 3: styles.css token 与基础升级

**Files:** Modify `apps/desktop/src/renderer/styles.css`

- [ ] token 追加：`--ease-spring:cubic-bezier(.34,1.4,.44,1)`；`.pop` 加 `transform-origin` + fade/scale 过渡（`.pop.show`）；`.md-*` 全套样式（body/h1-h4/code 块深底 #1d1b18 常暗/列表/引用/table/链接色）；用户消息块 `.msg-user`；阶段指示 `.phase-chip`；思考分段控件 `.think-seg`；provider 卡 `.prov-card/.prov-dot/.prov-detail`；设置导航图标行 `.sp-item .si`；`.jump-latest` 已有样式校准；按钮按压态统一 `.btn:active{transform:scale(.97)}`。
- [ ] 深色主题对照补齐（md-code 块两主题同暗）。

### Task 4: Stream/App 对话区重做

**Files:** Modify `Stream.tsx`、`App.tsx`、（CSS 已在 Task 3）

**Interfaces:** App 产出 `useStickToBottom(ref)` → `{ stuck, scrollToBottom() }`；Stream 消费 `<Markdown>` 与 `StreamActions`（不变）。

- [ ] App：`useStickToBottom` 挂 `.stream`，滚动近底(≤48px)自动粘底，非粘底显示 `.jump-latest` 浮钮；运行读数（开始时间 ref + 秒表 interval）进 `phaseLabel` 行；EmptyState 增加无 key 时的「接入模型」引导卡（props 传 `providerKeys` 与 `onOpenSettings`）。
- [ ] Stream：user 行 → `.msg-user` 块（右对齐、浅底、hover 动作：复制/回滚，图标化）；assistant 行 → 头像 spark + `<Markdown text={r.text}/>`，流式期末尾 `.cursor` 换细竖条动画；动作条 emoji → icons；工具行 head 用 icons（loader 旋转= pending、check= ok、x= failed）。
- [ ] ThinkingLive：图标化 + 保留走秒；文案「先准备下…」→「思考中」；展开体 markdown 化（plain 段落即可）。

### Task 5: Composer + ModelPicker 重做

**Files:** Modify `Composer.tsx`、`ModelPicker.tsx`；Test Modify `apps/desktop/tests/model-picker.test.ts`（新增 filterModelOptions 判卷）

**Interfaces:** ModelPicker 新增纯函数 `filterModelOptions(options, query): ModelOption[]`（大小写不敏感，匹配 label/provider，演示项仅在空查询时出现）；`ModelMenu` 增加 `search` 受控渲染分支。Composer 新增 `<ThinkingControl supported level onChange disabled/>`（内置 popover 分段，档位说明文案表 `THINKING_HINT: Record<level,string>`，纯函数判卷）。

- [ ] model-picker.test 增判：filterModelOptions 空查询=原列表；"ds" 命中 provider deepseek 与 label；演示项过滤规则。
- [ ] ModelPicker：触发条升级（家色点 + 名 + chevron 图标）；popover 顶部搜索框自动聚焦、↑↓ 选择、Enter 确认、Esc 关闭；分组行家名 + 色点；行内 tier 徽标 chip + 窗口 + 识图 eye 图标（capability 从 spec 传入——扩展 `ModelOption` 可选 `vision?: boolean`，flattenModels 填充）；底部「在设置中管理模型」行（onOpenSettings）。**既有纯函数签名只增不改**。
- [ ] Composer：ModelPicker 菜单内原「思考档位」四行**移除**（移入 ThinkingControl）；控件行布局＝权限档 / 思考 / spacer / meter / 发送；发送按钮箭头→icons.send、停止→icons.stop；状态行加 phase-chip（运行时旋转 loader + 「运行 12s · 输出 1.2k tok」）；placeholder 改「发消息或创建任务，/ 调用指令」。
- [ ] phase-chip 数据源：props 新增 `phase: RunPhase` 与 `elapsedSec`、`outputTokens`（App 计算）。

### Task 6: 设置页 provider 卡片化 + 导航图标

**Files:** Modify `SettingsPanel.tsx`、`CustomProviderForm.tsx`（样式容器微调）

**Interfaces:** SettingsPanel props 增加 `initialSection?: SectionId`；新增纯函数 `providerDotState(stored: readonly string[], envProviders: readonly string[], id: string): "stored"|"env"|"none"`（判卷出口）。SectionId 导出。

- [ ] 判卷：providerDotState 三态（stored 优先于 env）。
- [ ] provider 分区重构：卡网格（demo 免 key 卡单独诚实标注）→ 选中卡展开详情（key 输入非受控纪律不动、保存/删除、env 变量提示、模型清单点击设默认、能力徽标）；CustomProviderForm 包进折叠卡。
- [ ] sp-nav 每项加 icons；App 传 `initialSection="provider"`（来自空态引导）。
- [ ] 「关于」分区版本行补 `--doctor` 一致性说明不引入新事实源（保持 0.1.0 字面量，与 CLI 对齐问题不在本计划）。

### Task 7: 卡片组件与细节收口

**Files:** Modify `ClarifyCard.tsx`（重写进 `.card` 体系：q-block/q-head/opts/opt 既有样式）、`ApprovalCard.tsx`（图标化 + note-net 图标）、`PlanCard.tsx`（图标化）、`ChangeSummaryCard.tsx`、`GoalPanel.tsx`、`Sidebar.tsx`、`TitleBar.tsx`（emoji/字符形→icons；ClarifyCard 移除旧 `card-approval` 裸样式路径）

- [ ] ClarifyCard 重写用 `.card` + `.q-block/.q-head/.q-text/.opts/.opt/.q-free`（CSS 已有），必答校验沿用 `clarifyFormValues`；提交/跳过按钮进 `.card-actions`。
- [ ] 全局扫尾：`grep -n "👍\|👎\|⚠\|⧉\|⟲\|✕\|⌁\|⌛\|⊘\|⏸"` renderer 目录清零（SVG 域内 aria 语义保留）。

### Task 8: 全量验证

- [ ] `pnpm --filter cairn-desktop test`（vitest + boundary check）全绿。
- [ ] `node --import tsx scripts/typecheck.ts` 零错。
- [ ] `pnpm --filter cairn-desktop smoke` PASS。
- [ ] 视觉自查：`pnpm --filter cairn-desktop dev` 起 electron 截图六板块（浅/深两主题），对照 spec 逐条核验；发现的问题回修。
- [ ] 更新 `docs/CODE-WIKI.md` 桌面端节（icons/markdown 两个新模块一段话）。

## Self-Review

- Spec 覆盖：①→Task 6+空态引导(Task 4)；②→Task 5；③→Task 2/4；④→Task 1/7；⑤→Task 4；⑥→Task 6/7。无缺口。
- 占位符：无 TBD/「适当处理」；代码契约以接口块给出。
- 类型一致：`StreamActions`/`ModelOption`/`PanelPatch` 均只增不改；`RunPhase` 从 projections 导入。

## 审查修订（2026-10-07 独立审查后补）

1. **`tests/render-structure.test.tsx` 是真正的 JSX 判卷雷区**（react-dom/server 渲染，仅此一个 .tsx 测试；此前清单漏列）。约束进任务：
   - Task 4/5 同步改写其中被钉块：`⚠ OpenAI 未配置 key` 警示行、`思考档位` 菜单块（随功能迁至 ThinkingControl 的 SSR 判卷 + THINKING_HINT）、ThinkingLive（`先准备下…` 文案可改「思考中」但 `think-live`/`aria-expanded`/走秒/默认展开判据必须保留语义）、分组头/徽标文案（`>openai<`/`标准 · 窗口 128k` 序列保持逐字）、`class="check">✓<`、disabled 计数（keyNotice 在场 0 / running 3）、空目录两串文案。
   - ModelMenu 新增搜索框必须用 `<input>`（不增 button 计数）；「管理模型」行 running 时不得 disabled。
2. **Sidebar 判卷出口入冻结清单**：`groupByWorkspace/OTHER_WORKSPACE/SESSION_FILTERS/SESSION_FILTER_NOTE/filterSessions` 及三枚 `iconbtn sm`+aria-label 计数；Task 7 只换字形不动结构。
3. **useStickToBottom 滚动规则**：`.stream` 有 `scroll-behavior:smooth`——程序化粘底一律 `scrollTo({behavior:"instant"})`；仅用户真实上滚（wheel/touch/显著上移）解除粘底；TurnRail 跳轮动画期间不抢滚动。`.jump-latest` 挂 `.zone-stream` 下（非滚动容器内）。
4. **消息重排保留锚**：新类叠加在 `.row user`/`.row assistant` 与 `data-round-anchor` 之上，不替换（TurnRail 查询依赖）。
5. **emoji 清零范围修正**：含 TurnRail.tsx/RightPanel.tsx/CustomProviderForm.tsx/ErrorStrip.tsx 注释；ModelPicker 警示行 `⚠ ` 因判卷钉死**豁免**（保留字面量）。
6. **CSS 作用域**：markdown 样式全部前缀 `.md-body`/`.md-code`（不得裸 `pre`，防漏进 `.kv pre`）；`.pop` 过渡用 `.pop.show` 挂 popIn keyframes（不改 display 模型）；`.md-table` 随 Task 3 落地后 Task 2 才引用。
7. **ClarifyCard 重写保留 `cards.ts` import 面**（cards.test 钉死）；icons 换字形不动类名/aria-label。
