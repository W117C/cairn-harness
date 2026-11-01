# open-claude-ui 接入 Cairn 桌面端 · 方案与批次

日期：2026-10-31
上游：https://github.com/Caho1/open-claude-ui（MIT，`c1f923ae0051a871941b98a0e2e3183a545e6a85`，2026-10-21）
目标：把该库中真正有价值、且 Cairn 尚缺的组件/交互物理接进桌面端，而不是整包换壳。

## 一、先把事实说清

`open-claude-ui` 不是一个可直接运行的应用，而是 **30 个 React 组件/Hook + 一套逆向设计手册 + Storybook**：

- `code-examples/` 36 个文件，约 7,700 行；组件大量使用 Tailwind 工具类，部分依赖 `framer-motion`。
- `code-examples/cds-theme.css` 提供 220 个 `--cds-*` 令牌；`cds-pure.css` / `tailwind.config.js` 是分发层。
- 它复刻的是 Claude Desktop 2.0（`v2.37337.1`）的一版形态；Cairn 已 vendored **官方 3.6556.2** 的 704 个令牌与 45 组 `data-cds` 组件规则（`src/renderer/vendor/cds-official/`），并有逐字节/逐条映射判卷。

因此 **不能用它的令牌层替换 Cairn 的官方令牌层**（220 个逆向近似值 vs 704 个官方值，属于降级，且会打断 `cds-parity` / `cds-components` 判卷）。同理，不能直接 `import` 它的组件：桌面端是纯 CSS + 自研设计系统，没有 Tailwind/Framer 运行时；整包引入会带来第二套样式系统与 30 个未接线组件。

正确接法是：**保留官方令牌与 IPC，按缺口移植行为/物理参数，并在 vendor 里留下上游出处与 MIT 许可**。

## 二、覆盖矩阵（2026-10-31 业主指令修订）

业主明确：**下面这些面不是「已覆盖」，全部按 open-claude-ui 重做**（保留 IPC/业务逻辑/判卷锚，UI 层换形态）：

- 输入框/下颌、模型与思考档、用量环、@ 与 / 菜单、IME 组字守卫
- 消息气泡、行操作、思考折叠、工具行、审批卡、会话锁与队列
- 粘底滚动与回底钮、会话滚动记忆、容器查询、窗格拖拽、标题栏拖拽区
- 代码块复制原位反馈、Diff unified + 行评注

重做方式：以参考库对应组件的 **DOM 解剖 / 几何 / 状态机 / 动效参数** 为准，移植到本仓纯 CSS 体系；
不引入 Tailwind/Framer 运行时，不推翻官方 CDS 令牌层。每批只换一个面族，判卷锚按新契约更新并保留原意。

仍然不适用/不建议搬运：

- `ClaudeAudioPlayer` / `LiveMicActivityBars`：需要完整音频链路，当前产品没有语音模式
- `EpitaxyIframeBridge`：桌面端用主进程 `WebContentsView` 浏览器窗格，架构不同
- `CdsMotionEngine` / Storybook：演示页，不是产品组件
- `tailwind.config.js` / `cds-pure.css`：与官方令牌层冲突
- `ContainerResponsiveBar`：桌面端已有容器查询，收益低

真实缺口（按可见度）：

| 缺口 | 现状 | 参考模块 | 代价 |
|---|---|---|---|
| 思考展开是 `display:none` 硬切，展开会跳高度；无推理氛围光 | `Stream.tsx` `ThinkingLive` + `.think-body` | `ReasoningAmbientGlow` | 小 |
| 图片只能看缩略，不能全屏/缩放/平移 | `markdown.tsx` `MarkdownImage` | `MediaLightboxViewer` | 中 |
| 附件是 40px chip，不是磁贴 | `Composer.tsx` `attach-chip` | `AttachmentCard` | 小 |
| 会话不能拖拽重排 | `Sidebar.tsx` 仅置顶/时间桶 | `DraggableSessionList` | 中 |
| Diff 只有 unified | `DiffView.tsx` | `StreamingDiffViewer` | 中 |
| 运行/等待状态只有品牌逐格标，没有呼吸点/骨架扫光 | 多处 | `StatusIndicators` | 小 |
| 分段控件没有滑片指示器 | `.th-row` 等 | `SegmentedControl` | 小 |

## 三、批次（按依赖序）

### 第 0 批（本笔已开工）：对话体感两件

1. **思考展开物理 + 陶土呼吸光晕**
   - `.think-body` 从 `display:none` 改为 CSS Grid `0fr → 1fr`，内层 `overflow:hidden`，展开/收起不再跳高度。
   - 运行中 (`data-running="true"`) 在思考行后加低透明度陶土径向光，2.8s 呼吸；`prefers-reduced-motion` 停动。
   - **保留** Cairn 现有裁决：逐格加载标不换回三点波；Normal 档默认折叠不强制展开。参考库这两条与现有产品裁决冲突，只取物理参数。
   - 判卷：SSR 结构 + CSS 源码钉 + `ThinkingLive` 视图档位；现有 `render-structure` / `a11y-activate` / `stream-process` 必须全绿。

2. **图片灯箱**
   - 图片缩略点击打开全屏灯箱：滚轮以光标为锚缩放（1–4x）、放大后拖拽平移、双击 1x/2x、`+/-/0` 键盘、Esc 关闭、焦点陷阱与返回焦点。
   - 复用 `ModalSurface`（焦点隔离/Esc/返回焦点），`createPortal` 到 body，避免深层层叠上下文。
   - 缩放/平移数学抽成纯函数（`clampLightboxScale` / `anchoredOffset` / `clampLightboxOffset`），按本仓无 jsdom 的判卷方式做纯函数 + SSR + 源码哨兵。
   - 外部图片仍遵守既有门闩：未点击不请求；灯箱只对已显示图片开放。

### 重做批次（2026-10-31 业主指令，按依赖序）

**R1 · 消息流（下一批）**：`ChatMessageBubbles` / `ThinkingAccordion` / `McpToolDecisionCard` / `StatusIndicators` / 行操作。

- 用户气泡：18px 圆角、85% 量度、12/16 内距、长文折叠遮罩；助手正文：4px 内缩 + 流体右留白；行操作 reveal 只动 opacity。
- 思考行：状态条三态、Grid 展开、生成中互斥锁（保留 Cairn 逐格标作为品牌等待标）；工具行：三态授权/运行/成功失败、折叠摘要。
- 审批卡：三阶决议（批准/拒绝/编辑）、payload 审查、危险态红实底。
- 判卷：SSR 结构 + 纯函数状态机 + 现有 `render-structure` / `tool-rows` / approval 判卷升级（保留原意）。

**R2 · 输入区**：`ChatComposer` / `RichComposerWithMentions` / `ChatComposerChin` / `ModelSelectorEffort` / `ModelSwitcherWithTokenGauge` / IME guard。

- 输入卡 20px（v1）/ 12px（v2）二选一需裁决；先按参考库 v2 的 12px 扁平卡 + 28px 下颌，保留现有多行输入/附件/IPC。
- 模型与思考档：5 档 Effort（Low/Medium/High/Extra/Max）+ Thinking 开关 + 用量环中心水位；@ / 菜单按参考库的行高、图标、面包屑、键盘循环。
- IME：Enter 判定仍收在 `ime.ts` 单源；新增输入框全部接入。
- 判卷：`model-picker-axis` / `composer-rework` / `ime-enter-coverage` / `model-menu-interaction` 升级。

**R3 · 外壳**：`DraggableSessionList` / `ClaudeDesktopHeader` / `useClaudeScrollPinning` / `ScrollFadeContainer` / `ContainerResponsiveBar` / `useClaudeRovingFocus` / `ArtifactsSplitPaneResizer`。

- 侧栏 28px 高密行、四态分组、拖拽重排（4px 死区、落点线、乐观重排）；拖拽顺序持久化方案需裁决。
- 标题栏 hiddenInset + 交通灯补偿 + drag/no-drag 安全区；滚动：150ms 冷却 + 40px 容差 + 7 档遮罩；容器查询 4 阶压缩；窗格分割 4px 死区 + 双击 50/50。
- 判卷：`sidebar` / `interaction-smoke` / `layout-smoke` / `scroll-behavior` / `stream-fade` 升级。

**R4 · 代码与 Diff**：`CodeBlock` / `StreamingDiffViewer`。

- 代码块：12px 圆角、暗色壳、36px 头、语言标识、复制 2.5s 衰减；Diff：unified/split 双模式、行号硬锁、增删底色、流式追加。
- 判卷：markdown 代码块 + 新增 diff-split 纯函数/SSR。

### 第 2 批（原计划，并入 R1/R3）：附件与状态

- 附件磁贴（128×96 缩略、扩展名徽章、文件名中间截断）替换 40px chip；保留现有附件引用/IPC 形状。
- `StatusIndicators` 的呼吸点/骨架扫光只落在运行中与加载态，不引入新状态机。

### 第 3 批：交互基建

- 会话拖拽重排：4px 死区、落点线、乐观重排；持久化位置需要先裁决「写 session-metadata 还是 renderer 偏好」——这是协议面，单独出方案。
- Diff 分屏：基于现有 `DiffHunkView` 的 old/new 行号做 split 视图，不改 core 数据结构。
- 429 退避：先查 core 是否已有；若没有，属 agent 运行时改动，不混进 UI 批。

## 四、验收与边界

- 不换官方令牌、不改 IPC 协议、不新增 Tailwind/Framer 依赖。
- 每批：桌面套件（`--maxWorkers=2`）+ 双 tsc + `renderer-layer-check` + `docs-check`；UI 变更补真实 renderer/隔离实例截图。
- vendor 出处：`src/renderer/vendor/open-claude-ui/UPSTREAM.json` 记录 commit、许可、被移植文件与落点；原文件以 `.source.txt` 留档，不参与编译。
- 未做项逐条登记在 PROGRESS 页面；不把「参考库有」当成「必须做」。

## 五、需要业主裁决的点（不阻塞第 1 批）

1. 第 3 批的会话拖拽顺序持久化：写 `session-metadata`（跨窗口一致，但要协议 bump）还是 renderer `localStorage`（零协议，但只在本机本窗口）？推荐前者，单独一批做。
2. Diff 分屏是否引入语法高亮依赖？参考库用 Worker/Shadow DOM；本仓当前零高亮依赖。推荐先做分屏布局，不引依赖。
3. 参考库的暗色代码块（`#0d0d0c`）与 Cairn 现有浅色代码块不一致；是否要统一到暗色？推荐先不动，等代码面专项裁决。
