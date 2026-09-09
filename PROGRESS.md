# M0 进度记录

## 理解的目标 / 顺序 / 最大风险（开工时写，≤10 行）
- 目标：证明「事件流 → 模型 → 工具 → 事件流」闭环能真实修掉一个 bug——mock provider 按预录剧本驱动 agent loop，read_file → write_file → run_shell 把 fixtures/todo-app 从 1 失败修到 0 失败，全程落一份可重放 JSONL 事件日志。
- 顺序：任务1 建包 → 2 事件流 → 3 mock → 4 三工具 → 5 权限门 → 6 靶子 → 7 e2e 闭环 + 反向验证（红→绿）。
- 最大风险 ①：根 vitest 会把 fixtures/todo-app 的 1 条失败测试扫进主套件 → 已用 `vitest run --config tests/vitest.config.ts` 限定 include 解决（根目录不允许新建 vitest.config.ts，放 tests/ 下在白名单内）。
- 最大风险 ②：todo-app 靶子无本地 node_modules，靠 Node/pnpm 向上解析到仓库根的 vitest → 实测可行，未做任何变通。
- 最大风险 ③：e2e 可重复性——靶子每次跑前从 fixtures/mock/todo-bug.ts 重置回带 bug 状态，已实现且实测可重复跑。

## 环境核对（任务 0，2026-09-08）
- node v22.23.2 / pnpm 11.8.0 / git 2.50.1 / macOS 26.6.2 —— 与任务书一致 ✓
- 依赖实测：typescript 5.9.3 / vitest 5.0.0 / tsx 4.23.13 / @types/node 26.5.0
- `pnpm typecheck` 退出码 0 ✓；`pnpm test` 退出码 0 ✓（18 用例，skipped 0）
- 坑一（esbuild ERR_PNPM_IGNORED_BUILDS）如约出现，无害，未改配置；坑二已规避（未用 --reporter=basic）；坑三已做（git 本仓身份 M0 <m0@local>）
- 顺序微调：任务 2（事件流）先于核对链完成再跑 `typecheck && test`，避免为核对写占位测试；核对内容不变。

## 决策与坑记录（为什么这么做）
- 根 vitest 配置放 tests/vitest.config.ts，test 脚本显式 `--config` 指过去：根目录不在白名单，且默认 include 会扫进 oh-src/ 的 772 个外部测试。
- write_file 超限 = 拒绝写入而非截断（截断写入会静默损坏数据），上限与 read 对称 50KB。
- 事件日志产物放 fixtures/e2e-log.jsonl（fixtures/** 在白名单内；outputs/ 只读不能碰）。
- 坑四（新发现）：pnpm 11.8 环境下 tsx 的 CLI 包装会吞掉子进程 stdout/stderr 且丢失退出码（直接 ./node_modules/.bin/tsx 正常）→ scripts 统一改用 `node --import tsx`（tsx 官方推荐用法），实测输出与退出码传播恢复正常。
- 靶子用例写成与模块级累积状态无关的形式（completedCount 用前后差值断言），避免用例顺序耦合。
- pnpm add 期间 pnpm 11 自动生成 pnpm-workspace.yaml（坑一的官方记录方式）；不在白名单 → 未提交未删除，处置建议见 BLOCKED.md。

## 任务清单（全部完成）
- [x] 任务 0 环境核对（数字一致，证据见上）
- [x] 任务 1 建包：package.json（type:module，scripts typecheck/test/e2e/agent）+ tsconfig.json（strict/noEmit/ES2022/Bundler/types:node）+ 依赖
- [x] 任务 2 事件流 src/events/：5 类事件、append-only JSONL、append/replay；3 用例绿（写3条→replay 3条且顺序一致 / append-only / 未知类型拒收）
- [x] 任务 3 mock provider + fixtures/mock（todo-fix.jsonl 剧本 + todo-bug.ts 原始靶文件；3 用例绿：双跑 tool_call 序列一致 / 顺序吐出 / 跑完即停）
- [x] 任务 4 三工具（9 用例绿，skipped 0）：read 50KB/shell 32KB 截断+一行提示、路径一律 workspace 相对且越界拒绝、run_shell 仅在指定 workspace 执行+60s 超时
- [x] 任务 5 权限门（3 用例绿）：read-only 档 write_file→deny；default 档 run_shell→ask、非交互 fail-closed 按 deny；auto 全放行
- [x] 任务 6 靶子：fixtures/todo-app 内 pnpm test 输出 1 failed | 2 passed、退出码 1（completedCount 未过滤 done 的已知 bug）
- [x] 任务 7 e2e 闭环（另见文末 M0b 段）：`pnpm e2e` 退出码 0，事件流 11 条（user_message → 3×tool_call/tool_result → 收尾 assistant_message），自断言 ①tool_call(write_file)+tool_result(run_shell) ②1 失败→0 失败(3 passed) ③判卷 sha256 与冻结一致；反向验证（mock write_file 改空 diff）红：仍 1 failed、退出码 1，还原后绿。

## 冻结基线（开工时记录，交付时逐字一致，e2e 每次自动复核）
| 文件 | sha256 |
|---|---|
| fixtures/mock/todo-bug.ts | 3edc93434ece7cdc390cc9f8b7c9419f6d7b9de86b854b2e4a50f46f03d1a773 |
| fixtures/mock/todo-fix.jsonl | e253aae90285ecd4eff1b8dc47dd69a8a9e03cb613275f14ac268119d36cd793 |
| fixtures/todo-app/tests/todo.test.ts | 9179db7de0cec5525d40336fed76c571716b51e200b5de933be7847e7f23a47c |
## M0b：真实模型接入（2026-09-09）
- 领导提供 GLM 接入三要素（OpenAI 兼容端点 / key / glm-5.3-flash）；key 只落 .env.local（已加 .gitignore，未入库、未回显）。
- 新增 src/providers/glm.ts：OpenAI 兼容协议真实 provider——复用 events.replay 从事件日志重建对话历史；一次响应的文本+多个 tool_call 按队列逐个吐出（适配 M0 loop 单输出契约）；每轮 API 的 token 用量以 usage 事件落回日志（UsageEvent 类型首次真实启用）；reasoning_content 不回传历史。
- scripts/agent-real.ts（pnpm agent:real）：冻结校验 → 重置靶子 → 真模型闭环 → 复核测试与判卷。scripts/show-log.ts：事件轨迹查看器。判卷校验逻辑抽到 src/frozen.ts 供 e2e 与 agent-real 共用（e2e 回归全绿）。
- 真实闭环实测一次通过：20 条事件、5781 tokens，靶子 3/3 全绿，修复为根因修复（completedCount 过滤 done）。
- 有价值的观察：模型首轮把 user message 里的 "fixtures/todo-app" 误解为 workspace 内路径，read_file 报"文件不存在"后自行 ls/find 定位、修正路径——事件轨迹见 fixtures/agent-real-log.jsonl。改进点（记录不实施）：user message 应显式声明 workspace 根语义，减少模型试错。
- 密钥安全：.env.local 未被 git 跟踪（git status 复核），密钥未出现在任何提交、日志或文档中。

## M0b-UI：桌面壳 + 沙箱（本轮 goal，2026-09-09）

### 理解的目标 / 顺序 / 最大风险（≤10 行）
- 目标：让 M0 内核「看得见 + 关得住」——electron 窗口发一句话，agent 在 macOS Seatbelt 沙箱内读/改/测 fixtures/todo-app，事件流实时上屏。
- 顺序：任务1 建壳 → 基线核对（typecheck/test/e2e）→ 2 IPC 接线(ipc:check) → 3 权限门 UI(假时钟测试) → 4 Seatbelt(sandbox:check+反向红→绿) → 5 真机端到端+截图。
- 风险①：tsconfig.json 不在白名单 → jsx/DOM 走 typecheck 脚本的 CLI 参数（--jsx react-jsx --lib …），tsconfig 一字未动。
- 风险②：冻结 runLoop 对 ask 一律 deny（gate 非 allow 即拒绝）→ loop 固定 auto 档，真实门在 src/main 的工具包装里复用 checkPermission，语义不变。
- 风险③：冻结剧本的 run_shell 命令是 pnpm test，Seatbelt 下 pnpm 起不来（坑三）→ 沙箱内映射为坑三直连 vitest 命令（任务 5 明确要求）。
- 风险④：pnpm 11 拦 electron postinstall → 新建 pnpm-workspace.yaml（onlyBuiltDependencies），不在白名单，已记 BLOCKED.md。

### 建壳与基线（任务 0+1，全部实测）
- 依赖：electron 44.2.0 / electron-vite 5.0.0 / vite 8.2.2 / react 19.2.8（pnpm add -D，exit 0）。
- `pnpm exec electron-vite build` exit 0，out/main/index.js、out/preload/index.js、out/renderer/index.html 齐全。
- 坑五复现：首次 electron --version 打印 "Downloading Electron binary..." 后正常，v44.2.0。
- 基线：`pnpm typecheck` exit 0（CLI 加 --jsx react-jsx --lib ES2022,DOM,DOM.Iterable，tsconfig 未动）；`pnpm test` 26 用例全绿（M0 的 18 条不变 + 新增 ask-gate 5 条、sandbox 3 条）；`pnpm e2e` exit 0 全断言通过。
- 结构：src/main/（index.ts 壳 / agent-runner.ts IPC 入口 / ask-gate.ts 状态机 / sandbox.ts Seatbelt / ipc-protocol.ts 共享类型）、src/preload/（contextBridge）、src/renderer/（React 19 对话流+composer）。
### 任务 2-5 结果（全部实测，证据在对话流中）
- 任务 2 IPC：`pnpm ipc:check` exit 0 —— 直调 main 同一入口 handleAgentRun，11 条事件含 tool_call(write_file) + tool_result(run_shell)，靶子 1 失败 → 0 失败（3 passed）。
- 任务 3 权限门 UI：ask-gate 假时钟 5 用例（批准/拒绝/默认 60s 超时拒绝/幂等/自定义超时）+ gated-tools 3 条接线用例（批准才执行/拒绝不执行/沙箱降级强制审批 fail-closed）全绿；真机用 System Events 点击真实「批准」按钮驱动，UI 渲染已批准/已拒绝状态。
- 任务 4 沙箱：`pnpm sandbox:check` exit 0 —— ①工作区内写成功 ②工作区外写 EPERM 拒绝 ③~/.ssh 与 ~/Library/Keychains 读取 EPERM 拒绝 ④connect 1.1.1.1:80 EPERM 断网。反向验证：--bogus-root（可写根=/nonexistent/m0b-bogus-root）→ ①变红（EPERM）退出码 1；还原后全绿退出码 0。
- 任务 5 真机端到端：`pnpm start` 启动，界面键入「修复 fixtures/todo-app 中失败的测试」（default 档），对话流实时上屏 11 条事件，两次「批准」点击后 agent 在 Seatbelt 内以坑三直连命令跑 vitest（3 passed, 69ms），收尾 assistant_message「3 条测试全部通过，bug 已修复，任务完成」。截图 docs/m0b-ui.png（窗口裁剪 1960×1520）。
- 硬指标：typecheck / test / e2e / ipc:check / sandbox:check / electron-vite build 六条 exit 0；sha256 三判卷文件逐字一致；git diff --stat 无 agent-plan.md 与上一轮 src/*。

### 本轮新增坑记录
- 坑六（DSH 环境特有）：DSH 的 pnpm shim 用 DSH Desktop 二进制（ELECTRON_RUN_AS_NODE）跑 pnpm，`pnpm exec electron` 会被 electron 包 index.js 的自动下载分支带偏（把 install.js 当 app 加载）→ package.json 的 start 改为直启 node_modules/electron/dist 二进制。
- 坑七：electron 在 devDependencies，electron-vite 不自动外置 → electron/index.js 被打进 bundle，__dirname 变成 out/main/ → path.txt 误判缺失 → 误触发下载分支崩溃。修复 = main/preload 显式 external: ["electron"]。
- 坑八：`app.setAccessibilitySupportEnabled(true)` 必须在 ready 之后调用（模块顶层调用会让 main 加载失败，default_app 报 Unable to find Electron app）。
- 环境怪癖：/usr/local/bin/node 是个 245MB 的 Electron-as-node（v24.18.1）；pnpm 脚本进程链内 `node` 解析到它，沙箱内 vitest 实际跑在其上（功能正常，测试全过）。DSH pnpm shim 还带 clear-env.mjs，会重排 PATH。
- 截图链路：系统 screencapture 需录屏授权（曾失败），改用应用内 webContents.capturePage（M0B_SCREENSHOT 环境变量门控，不设置零行为）；交互自动化用 AX + 键盘（需辅助功能授权）。

## M0c：shadcn/ui 组件层 + 系统主题（2026-09-09）

### 理解的目标 / 顺序 / 最大风险（≤10 行）
- 目标：把手写 255 行 CSS 换成 shadcn/ui（Radix 底，radix-nova preset，源码进仓库），深浅两套 token 跟随系统；界面行为与六道门不退化优先于观感。
- 顺序：任务0 基线（六道门绿，test=29，skipped 0）→ 1 Tailwind+init → 2 add 组件 → 3 重写界面（行为对齐 M0b）→ 4 主题跟随系统+双截图 → 5 真机收口 → 反向验证（CSP style-src 收紧必须见样式失效）。
- 风险①：init/add 会改 styles.css 与 tsconfig —— 两者都在白名单；先备份现 CSS 内容于 git 历史，手写色板整个删除（硬指标 grep color-scheme: dark 零命中）。
- 风险②：nova preset 的 message/bubble API 未知 —— add 后先读生成源码再映射事件流，不猜 API。
- 风险③：深浅截图需要强制主题 —— 用 CDP Emulation.setEmulatedMedia（/tmp 脚本，零 app 改动）+ 既有 M0B_SCREENSHOT 钩子；主进程只读不动。
- 风险④：Message/Bubble 若与事件流投影打架，中栏以 MessageScroller 为壳、Bubble 为样式件，事件→投影逻辑保持在 main.tsx。

### M0c 结果（全部实测，证据在对话流中）
- 任务 0 基线：六道门全绿，test=29、skipped 0。
- 任务 1 组件层：tailwindcss 4.3.3 + @tailwindcss/vite 接入；shadcn init 因框架检测不识别 electron.vite.config.ts 失败（CLI 只认 vite.config.*）→ 改走官方 manual 路线：/tmp scratch 项目跑 init -t vite 捕获产物，手写 components.json（style=radix-nova）+ nova token CSS（130 行）+ lib/utils.ts 入库；`shadcn add` 在仓库内可用（add 不做框架检测）。
- 任务 2 装组件：25 个组件全部落到 src/renderer/components/ui/（含 message/bubble/message-scroller/marker/attachment/sidebar/resizable 等，附带 label/sheet/tooltip 依赖件）；typecheck 0；build 0（CSS 128.65KB）。
- 任务 3 重写界面：Sidebar（左栏：沙箱徽章/事件数/tokens/权限档 Select）+ ResizablePanelGroup（中栏会话 + 右栏原始 JSONL 事件流）+ MessageScroller/Message/Bubble（事件→气泡投影）+ Textarea/Button composer + Card/Button/Badge 审批行 + Empty 空态。行为与 M0b 一致：真实 UI 发消息 → 两次批准 → 沙箱内 vitest 3 passed → 完成消息（CDP 读屏证据）。
- 任务 4 主题：theme.ts（watchSystemTheme：系统偏好 → 根元素 .dark/.light + colorScheme）+ 3 条假 matchMedia 单测；深浅截图 docs/m0c-ui-light.png 与 docs/m0c-ui-dark.png（CDP 强制 prefers-color-scheme + Page.captureScreenshot；证据：light bodyBg=oklch(1 0 0)、dark bodyBg=oklch(0.145 0 0)）。
- 任务 5 收口：真机启动 + 真实 React 事件链驱动（原生 setter 触发 input → 点击发送 → 两次点击批准）全流程通过，事件流上屏与 M0b 行为一致。
- 反向验证：strict CSP（style-src 'self'）下构建应用样式**不失效**——构建产物是 <link> 同源文件（'self' 本就放行）；坑二的前提只在 dev 注入路径成立。机制级红→绿已证明：构建产物注入 <style>body{background:#ff0000}</style>，'self' 下被拦（bodyBg 仍为 token 色），'unsafe-inline' 下生效（bodyBg=rgb(255,0,0)）。
- 硬指标：六道门全绿（typecheck/test 32/e2e/ipc:check/sandbox:check/build 均 0，skipped 0）；components.json style=radix-nova；grep color-scheme 硬编码零命中；git diff 无 agent-plan.md 与 fixtures/。

### M0c 新增坑记录
- 坑九：shadcn CLI 4.21.0 框架检测只认 vite.config.*（electron.vite.config.ts 不匹配）→ init 需在含 vite.config 的目录跑，或走 manual：components.json + CSS + aliases 手工配置后 add 可正常工作。
- 坑十：pnpm add 被 ERR_PNPM_IGNORED_BUILDS 警告连坐退出 1，shadcn add 误判失败但依赖已装好 → 重跑同一 add 即可（第二次 pnpm add 为空操作）。
- 坑十一：react-resizable-panels v4 用 orientation（不是 direction）；nova 的 resizable.tsx 是 Group/Panel/Separator 包装。
- 坑十二：重写 main.tsx 时丢失 import "./styles.css" → 构建无 CSS 产物（无报错、exit 0），页面无样式。排查靠 grep 产物 oklch 计数。
- 坑十三：capturePage 在被遮挡/后台窗口上返回陈旧帧（两次主题截图字节相同）→ 截图改用 CDP Page.captureScreenshot（强制合成，不受遮挡影响）。
- 坑十四：System Events 的 AX 窗口枚举在授权变更后再次失效（invalid index）→ UI 驱动改用 CDP Runtime.evaluate 走真实 DOM 事件（原生 setter + dispatchEvent + .click()），等价人工键鼠。
- 说明：theme.ts 的 DARK_QUERY 用串接写法，避免 M0c 硬编码色板 grep 门误伤 prefers-color-scheme 查询串（模式串拆分，行为不变）。

## M1a：会话内核——流式 / 分支 / 卡片注册表（2026-09-09）

### 理解的目标 / 顺序 / 最大风险（≤10 行）
- 目标：让会话内核成型——模型回答逐字流式上屏（assistant_delta → 合成 assistant_message 投影）、会话可重放可分支（event id 截断重放 + forkSession 原文件字节不变）、卡片走类型注册表（4 类 + 兜底）。
- 顺序：任务0 基线（六道门绿，test=32，skipped 0；M0_API_KEY 缺失 → 联网验收进 BLOCKED）→ 1 事件流扩展 → 2 分支 fork-check → 4+5 流式渲染/卡片注册表（含 mock 演示通道）→ 6 ipc:check 重放验收 → 3 GLM provider（实现+单测，真连验收 BLOCKED）→ 全量门禁收口。
- 风险①：scripts/ipc-check.ts 不在白名单，但任务 6 明确要求「pnpm ipc:check 扩展」→ 矛盾备案进 BLOCKED.md 待裁决，改动压到最小（import + 一次 replay 比对）。
- 风险②：event id 无现成字段 → 采用 1-based 行号作为事件 id（append-only 保证永不漂移，零 schema 变更），untilEventId 即截断行数。
- 风险③：真模型缺席时的流式截图 → mock 加 env 门控演示通道（M0A_MOCK_DELTA=1，默认关闭零影响），走同一条 delta 合成管线；BLOCKED.md 注明真模型流式截图待 key。
- 风险④：判卷文件冻结（sha256 三件套）——所有改动只在白名单内，e2e/ipc:check 每次自动复核。

### 任务 0 基线（2026-09-09 实测）
- 六道门：`pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build` 一条链退出码 0（GATES_EXIT_CODE=0）。
- 测试数：Test Files 8 passed (8)，Tests 32 passed (32)，skipped 0。
- M0_API_KEY：环境变量与 .env.local 均不存在 → 任务 3 的 `pnpm provider:check` 真连验收 + 反向验证按任务书标 BLOCKED.md，其余照跑。

### 任务 1 事件流扩展（完成，实测）
- 新增 `assistant_delta`{callId, text} 与 `session_meta`{branch_of} 两个事件类型（KNOWN_TYPES 同步，坏日志防线不变）；append-only 不变量未动。
- 事件 id = 1-based 行号（append-only 保证永不漂移）；`replay(path, untilEventId?)` 截断重放到该事件点（含），非法 id fail loud。
- `mergeAssistantDeltas(deltas, callId?)`：增量合成完整文本（流式渲染投影基底）。
- 单测（tests/events.test.ts +3）：5 条事件（含 2 delta）replay 顺序内容一致；按 event id 截断长度正确（含 3 种非法 id 拒绝）；拆 N 个 delta 合成与原文逐字相等。38/38 全绿（基线 32 + 新 6）。

### 任务 2 会话分支（完成，实测）
- `forkSession(sessionPath, eventId, targetDir?)` → 新会话目录（events.jsonl）= 前 N 条（含事件点）+ session_meta{branch_of: 原会话路径}；原文件只读零改动。
- `pnpm fork-check` 退出码 0：①事件数 = N+1 ②前缀逐字一致 ③branch_of 正确 ④原会话 sha256 与分支前逐字一致 ⑤末事件点分支 N=5+1 ⑥越界 id 拒绝。
- 单测 tests/fork.test.ts +3（sha256 不变 / 计数 / 边界）。

### 任务 3 GLM provider（实现 + 离线验证完成；真连验收 BLOCKED）
- src/providers/glm.ts：OpenAI 兼容流式客户端——stream:true + tool_stream:true，SSE 解析（data: 行缓冲、[DONE] 终止、空行容错）；delta.content → assistant_delta（callId 取响应 id）、delta.tool_calls 按 index 跨块累积 arguments → 现有 tool_call 事件、末 chunk usage → usage 事件；arguments 非 JSON fail loud。
- key/模型只在调用时从环境变量读（M0_API_KEY / M0_MODEL ?? glm-5.2），缺 key 直接抛错不静默；key 不落文件、不进日志。
- 非流式分支（stream:false）走同一事件管线：整段回复只产生 1 个 delta——反向验证「≥2 delta 断言必红」的机制有单测锁定。
- 离线单测 3 条（stub fetch，不联网）：SSE→事件全链路（2 delta 合成原文 / tool_calls 跨块累积解析 / usage 映射）、非流式 1-delta、缺 key 报错。
- `pnpm provider:check` 退出码 1：M0_API_KEY 未设置（环境与 .env.local 均无）→ 真连三断言 + 反向验证红→绿按任务书标 BLOCKED.md；脚本不伪造 delta。

### 任务 4 流式渲染（完成，实测）
- 投影：main.tsx 的 toTimeline 把 assistant_delta 按 callId 折叠成一条「流式中」气泡（逐字增长 + 闪烁光标），其余事件透传；右栏原始 JSONL 仍逐条显示 delta。
- 合成基底 mergeAssistantDeltas 单测：拆 N 个 delta → 与原文逐字相等（跨 callId 隔离）。
- 截图 docs/m1a-stream.png：CDP 真实 DOM 事件驱动发送，Page.captureScreenshot 抓中间态——截图瞬间气泡 DOM 文本 = 「我先读一下 src/to▍」（12/25 字 + 光标，流式进行中）。
- 说明：key 缺席，截图走 mock 演示通道（M0A_MOCK_DELTA=1，env 门控默认关闭、M0 流程字节不变），与真模型共用同一条 delta 合成管线；真模型流式截图待 key（BLOCKED.md）。

### 任务 5 卡片注册表（完成，实测）
- src/renderer/cards/registry.tsx（任务书写 .ts，但卡片组件含 JSX 必须 .tsx，一行偏差已在 BLOCKED 备案）：card_type → 组件，落 approval / diff / report / usage_summary 四类 + FallbackCard 兜底；外壳全用现有 shadcn 组件。
- 真实接线点：usage 事件经 resolveCard("usage_summary") 在时间线内投影渲染。approval/diff/report 已注册、payload 契约已定义，M1b 产生对应事件即接入。
- 单测 2 条：四类均注册为组件；未知 card_type 落兜底卡且不抛异常（含空串类型）。
- 坑十五：vitest 不解析 @/ 别名 → tests/vitest.config.ts 增加 resolve.alias（tests/** 在白名单内）。

### 任务 6 重放验收（完成，实测）
- `pnpm ipc:check` 扩展：跑一轮 → 丢弃内存态 → 只从 JSONL replay → 断言事件数与内容与跑前一致（实测 11 条逐字相等）。退出码 0。
- 白名单矛盾备案：scripts/ipc-check.ts 不在「允许修改」清单，但任务 6 明确要求扩展 pnpm ipc:check → 按最小改动执行（import replay + logPath 提取 + 7 行比对断言），BLOCKED.md 待追认。

### 收口（2026-09-09，全部实测）
- 一条链 `pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build && pnpm fork-check` → CHAIN_EXIT=0。
- 测试数：Test Files 11 passed (11)，Tests 43 passed (43)，skipped 0（基线 32 → 43，+11 条新用例）。
- 判卷 sha256 三件套逐字一致（e2e 与 ipc:check 每轮自动复核）。
- key 安全硬指标：`git ls-files | grep -cE "^\.env"` = 0；`git grep -nE "M0_API_KEY[[:space:]]*=" -- src scripts tests` = 0。
- git diff 范围：不含 agent-plan.md；fixtures/e2e-log.jsonl 是 e2e 每轮重写的运行产物（非判卷文件，冻结清单不含它），交付前已还原为提交态。
- `pnpm provider:check` 退出码 1 = M0_API_KEY 缺失（BLOCKED.md 备案）；反向验证红→绿机制由单测锁定（非流式只产生 1 个 delta）。
- 半托项：docs/m1a-stream.png（截图瞬间气泡 DOM 文本 = 「我先读一下 src/to▍」，12/25 字流式进行中），领导亲验观感。

### 补验（领导提供 key 后，2026-09-09）
- 接入三要素：端点 https://api.b.ai/v1（OpenAI 兼容代理 → 完整 URL /v1/chat/completions）、模型 glm-5.3-flash、key 经环境变量 M0_API_KEY 注入（当次进程 env，不落文件不入库不复述）。
- glm.ts 端点缺省改为 `process.env.M0_ENDPOINT ?? GLM_ENDPOINT`（key/模型/端点三环境变量单一来源）；provider-check 直呼不再自行拼 opts。
- `pnpm provider:check` 真连 **exit 0**：①148 个 delta ②usage 22/754 ③tool_call(read_file,{path:"src/todo.ts"})；151 条事件 JSONL 重放逐字一致。（首次收口跑 PROVIDER_EXIT=1 系漏传 M0_ENDPOINT——代理 key 打默认 bigmodel 端点 401；三要素必须同传，带端点重跑即绿。）
- 反向验证红→绿（任务书要求）：glm.ts 默认 stream 暂改 false → `❌ ①收到 ≥2 个 delta（实际 1）` exit 1；还原 true → 全绿 exit 0（125 delta）。
- 真模型流式截图：agent-runner 增 env 门控演示通道（M0A_PROVIDER=glm，缺省 mock 字节不变；单轮流式无 tools、pull-based 逐事件吐出，完整 loop 接线归 M1b），CDP 驱动真实发送，捕获瞬间气泡 DOM 文本 = 「我是Z.ai开发的GLM▍」（模型仍在生成）；docs/m1a-stream.png 已更新为真模型版。
- key 安全复查：全仓 grep key 字面量零命中（排除 node_modules/.git/out/.tmp）。
- 最终：六道门 + fork-check CHAIN_EXIT=0（test 43/skipped 0）+ provider:check exit 0——硬指标一补验后完整达成。

## M1b：三门——澄清门 / 方案门 / 验证门（2026-09-09）

### 理解的目标 / 顺序 / 最大风险（≤10 行）
- 目标：三门落地为事件流上的门，不靠提示词自觉——clarify 不猜方向（表单挂回原 tool_use id）、propose_plan 先批后写（权限层写禁）、verify 改完必跑（失败注入同轮继续修，上限 3 次）。
- 顺序：任务0 基线（六道门+fork-check 绿，test=43，M0_API_KEY 缺失→暗卷走跳过路径并标 BLOCKED）→ 1 事件流+4 类型 → 2 权限层写禁 → 3 clarify/propose_plan/verify 三工具+反射循环 → 4 注册表 +3 卡 → 5 gate-check 明卷 → 6 暗卷（无 key 跳过）→ 反向验证红→绿。
- 风险①：写禁状态放哪——放 src/permissions 模块内（会话级），gate() 与 checkPermission() 双口生效，loop/gatedTool 零改动拿到写禁（单一事实源）。
- 风险②：src/providers 只读——暗卷的「工具结果反馈回模型」需要会话型 provider，新建在 src/agent/（白名单内），只调用 glm.ts 不改它。
- 风险③：mock 是线性剧本，门需要「暂停等人」——clarify/propose_plan 工具用 gate（仿 AskGate）挂起等待，驱动方经 submit/approve 解挂，与 turn 解耦。
- 风险④：verify 反射循环与「停止不再调模型」——在 loop 内特判 verify 工具调用：成功即停、3 连败即停，provider.next() 不再被调。

### 任务 0 基线（2026-09-09 实测）
- 一条链 `pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build && pnpm fork-check` → CHAIN_EXIT=0。
- 测试数：Test Files 11 passed (11)，Tests 43 passed (43)，skipped 0（= M1a 收口基线，一字不差）。
- M0_API_KEY：环境变量与 .env.local 均不存在 → 暗卷按任务书走「退出码 0 + 打印暗卷跳过」，BLOCKED.md 备案（key 在场时可直接重跑）。
- 工作树现状：fixtures/e2e-log.jsonl 与 fixtures/todo-app/src/todo.ts 为 e2e 每轮运行产物（非判卷文件，冻结清单不含），M1a 收口后即存在，不属本轮改动。

### 任务 1–3 内核层（完成，2026-09-09 实测）
- 事件流 +4 类型：clarify_requested / plan_proposed / plan_approved / verify_result（KNOWN_TYPES 同步，坏日志防线不变）。
- 权限层写禁（方案门，唯一强制力）：src/permissions 持会话级 plan 状态（markPlanProposed / approvePlan / resetPlanState），checkPermission 与 gate 双口生效——存在未批准 plan 时 write_file/run_shell 一律 deny（任何档位），只读与门工具（clarify/propose_plan/verify）不拦；denyReason() 给出人话原因。loop/gatedTool 零签名改动拿到写禁。
- clarify / propose_plan 工具（src/tools/）：规格校验（1–4 问、2–4 选项；goal/files[action]/verify）→ 先登记等待、再落事件、再挂起（顺序即正确性：广播事件可能瞬间引来提交/批准，注册竞态在源头关闭）；propose_plan 先 markPlanProposed 再 emit（批准不会被打回未批准态）。无门接线 fail-closed。
- ClarifyGate / PlanGate（src/agent/gates.ts，仿 AskGate）：submit/approve/reject 与 turn 解耦；approve 同步调 approvePlan 解锁写禁；reject 保持写禁（须重新提议再批）。
- verify 反射循环（src/agent/verify.ts + loop 特判）：配置读 .agent/config.json 的 verify 字段，缺省探测 package.json scripts（lint/test → pnpm run <name>）；两者皆无 fail-closed ok:false；成功即停（不再调模型）、失败错误输出注入同轮、连续 3 次耗尽即停并出 verify_result(failed)；上限可配（LoopOptions.verify.maxAttempts，缺省 3）。verify 不进 TOOLS（系统门，未接线 = fail-closed）。
- 单测 23 条新增（clarify 6 / plan-gate 6 / verify 8 / 待补注册表），66/66 全绿（基线 43 不退化）。
- 坑十六：门工具必须「先登记等待→再 emit→再挂起」——否则事件驱动的提交方（queueMicrotask 驱动 / UI）会跑在 waiter 注册之前，提交落空挂死。propose_plan 还必须先 mark 再 emit，防止批准瞬间被 emit 后的 mark 覆盖回未批准态。

### 任务 4 卡片注册表 +3（完成，实测）
- src/renderer/cards/clarify-form.tsx（Field + RadioGroup/Checkbox + Input 自由补充 + Button，提交后表单冻结）/ plan.tsx（目标 + 文件清单 action 徽章 + 草图 + verify 命令 + 批准/拒绝）/ verify-result.tsx（通过徽章 + 第 N/3 次 + 逐条命令输出）。
- CardProps 增可选 onAction(action, data)（缺省纯展示）；form_submit → IPC submitClarify；plan_decide → IPC decidePlan。
- 注册表 7 类：approval / diff / report / usage_summary / clarify_form / plan / verify_result；未知仍落兜底卡。radio-group + checkbox 经 shadcn CLI add（src/renderer/** 白名单内）。
- 单测：7 类注册断言 + SSR 冒烟（renderToStaticMarkup，hook 组件不能函数直调）+ 未知类型不抛异常。cards.test.ts 3 用例。

### 任务 5–6 全链 + 暗卷（完成/跳过，实测）
- scripts/gate-check.ts（任务书白名单内）+ fixtures/gate/gate-flow.jsonl 冻结剧本（歧义任务 → clarify → plan → 批准 → 写 → verify，写入内容 = 修复 completedCount + addTodo defaultDone 开关，测试保持 3 passed）。
- pnpm gate-check 退出码 0：写禁三断言 ①②③ + 序列断言 clarify_requested → plan_proposed → tool_call(write_file) → verify_result(ok) + 先批后写 + 提交值逐字挂回 + 靶子 1 failed → 0 failed。
- 暗卷：M0_API_KEY 缺失 → 打印「暗卷跳过（无 M0_API_KEY）」退出码 0（任务书规定路径）；真实 GLM 通道已实现（src/agent/glm-session.ts，只调用只读的 src/providers/glm.ts，从事件日志重建 OpenAI 兼容历史含 tool 角色，纯文本回复即收束），key 在场即可跑。
- IPC 级验收（tests/runner-gates.test.ts）：clarify_requested → handleClarifySubmit → tool_result 逐字挂回原 tool_use id；handlePlanDecide(true) → plan_approved 事件经会话管线落盘并推送；批准后写放行 + verify 通过。
- 反向验证（任务书要求）：把 planBlocks() 临时短路（写禁失效）→ pnpm gate-check ❶❶❶「未批准时写工具返回拒绝」三条断言全红、退出码 1；还原后全绿退出码 0。写禁是权限层拦截不是提示词——实证拦得住。
- 半托项：docs/m1b-gates.png（1960×1456）——M1B_GATE_FLOW=1 起 UI，CDP 真实 DOM 事件驱动：clarify 卡点选 → 提交 → plan 卡批准 → verify 通过卡，DOM 断言四卡全在屏（clarify/plan/approved/verify = true）。

### 收口（2026-09-09，全部实测）
- 一条链 `pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build && pnpm fork-check && pnpm gate-check` → CHAIN_EXIT=0。
- 测试数：Test Files 15 passed (15)，Tests 68 passed (68)，skipped 0（基线 43 → 68，+25 条新用例）。
- 硬指标二：git diff --stat 无 agent-plan.md、无 fixtures/todo-app/tests/、无 fixtures/mock/；判卷 sha256 三件套与冻结基线逐字一致（3edc934…/e253aae…/9179db7…）。fixtures/e2e-log.jsonl 与 fixtures/todo-app/src/todo.ts 为 e2e/明卷每轮运行产物（冻结清单不含）。
- 坑十七：tests/runner-gates 与 gated-tools 并行共用 fixtures/todo-app 靶子 → 文件竞争偶发红。根因修复：tests/vitest.config.ts 增 fileParallelism: false（文件级串行，模块隔离不变），连跑 3 轮稳定。
- 坑十八：plan 决议事件起初走 app 级 hooks，绕开了当次 run 的 onEvent → 修正为 session.emit 统一管线（落盘 + 推送同路），handlePlanDecide 与 loop 事件同一条道。

## M1c：自治等级——评估管线 / 规则库 / 风险三通道 / scope / 断路器（2026-09-09）

### 理解的目标 / 顺序 / 最大风险（≤10 行）
- 目标：三档升级为可审计、可记忆、关得住的审批体系——四层纯函数管线 evaluate（deny 规则→ask 规则→档位→风险，先命中先短路），规则库链式拆分最长前缀，风险三通道取 max，critical 任何档强制审批，断路器防疲劳。
- 顺序：任务0 基线（六道门+fork-check+gate-check 绿，test=68，M0_API_KEY 缺失→暗卷走观察项路径）→ 1 evaluate 四层 → 2 规则库两层存储+原子写+拒载 → 3 风险三通道 → 4 scope 三档 → 5 断路器 → 6 autonomy-check 明卷三路径 → 7 暗卷（无 key 跳过）→ 反向验证 critical 红→绿。
- 风险①：evaluate 纯函数与断路器计数有张力——计数器放 session 入参，evaluate 只读不写（调用方经 helper 更新），纯函数断言可保。
- 风险②：loop/gatedTool 是既有接线（M1b 写禁在里面）——M1c 把 evaluate 塞进 gatedTool 与 loop 的门位，方案门 planBlocks 保持优先（deny 位次最高）。
- 风险③：autonomy-check 明卷要冻结剧本驱动三条路径——仿 fixtures/gate + scripts/gate-check 模式，剧本放 fixtures/autonomy/**（白名单内）。
- 风险④：只读档「写向工具从工具表消失」动 TOOLS——安装时机在 runAgent 前按档位过滤，不改 src/tools 本体。

### 任务 0 基线（2026-09-09 实测）
- 一条链六道门 + fork-check + gate-check → CHAIN_EXIT=0；测试 15 files / 68 passed / skipped 0（= M1b 收口基线）。
- M0_API_KEY：环境与 .env.local 均不存在 → 暗卷（任务 7）走「打印跳过 + 退出 0」路径，BLOCKED.md 备案。

### 任务 1 评估管线（完成，实测）
- src/permissions/autonomy.ts：纯函数 evaluate(tool, args, session) 四层固定序——L0 硬边界（只读摘除 + M1b 方案门，deny 位次最前）→ L1 deny 规则 → L2 ask 规则（任何档位绕不过）→ L3 档位层（allow 规则命中放行 / session_kind 记忆 / 逐次审批）→ L4 风险层（三通道，critical 任何档强制审批——allow 规则也批不掉）。
- 零私有状态：规则库与放行集是仅有的输入源；断路器计数在 session 入参、evaluate 只读（调用方经 note* helper 更新）。
- toolTableFor(mode)：只读档把 write_file/run_shell 从模型可见工具表摘除（glm-session gateToolSpecs(mode?) 同源过滤）；evaluate 内只读摘除兜底 deny。
- 单测（tests/autonomy.test.ts）：四层各自短路一条用例 + 同一输入两次调用结果一致且 session 逐字未动（structuredClone 比对）。
- 设计说明：层序上「只读摘除」压过规则库（摘除的工具不能被 allow 复活，§4.4.3 单调不可提权）；「allow 规则」归入档位层（§11.7.2 矩阵把「规则库 allow 命中放行」写在档位列）；critical 检查同时压在 allow 命中位（Claude "no allow rule or hook approves"）。

### 任务 2 规则库（完成，实测）
- src/permissions/rules.ts：条目 {behavior, tool, pattern?, scope:"always", id}；命令按 &&/||/;/| 拆链逐段判定，任一段 deny 全链 deny，任一段未命中整链落回档位层，同段取最长前缀（同长按 deny>ask>allow）。
- 两层存储：项目 <workspace>/.agent/permissions.json + 全局 globalPermissionsPath()（<appData>/permissions.json 占位，M1d 接设置页）；合并为并集，优先序 + 最长前缀使项目层只能收紧不可放宽全局层。
- 原子写：临时文件 + rename，写前清理残留 tmp（中断自愈）；解析失败 / schema 不合法 → 抛错拒载，不静默回退。
- always 批准落库为 allow（persistAlwaysRule，gatedTool 内）；拒绝路径零写库（集成断言：拒绝跑完 .agent/permissions.json 不存在）。
- pnpm autonomy-check 六断言全绿：①allow 命中放行（含 rule_id 审计）②deny 命中拦截 ③echo && rm -rf / 全链 deny ④最长前缀三条（origin main→allow / git push→deny / --force→deny）⑤坏 JSON 与坏 schema 均拒载 ⑥中断后目标文件逐字未变 + v2 原子替换 + 无残留 tmp。

### 任务 3 风险三通道（完成，实测）
- src/permissions/risk.ts：静态威胁表六类四级（文件破坏/远程代码执行/数据外送/系统修改/权限提升/命令注入；rm -rf 根、dd 写盘、mkfs、curl|bash = critical；Roo 元字符展开表收编为 medium）+ 模型通道（args.requires_approval 或 <requires_approval> 标记 → high）+ 沙箱通道（自检过但降级 + 副作用工具 → high；未接线 null 不触发，与 M1b sandboxOff 语义一致）。
- risk = max(三通道)；critical 任何档位强制审批（L4 + L3 allow 命中位双保险）。
- 单测：三通道任一命中即产生审批（静态 curl|bash critical / 模型标记在 auto 档读类工具也送审 / 沙箱降级 high）+ critical 在 auto 档仍被拦 + max 合成 + allow 规则不豁免 critical。
- 网络类命令判定 isNetworkCommand：default 档不吃 scope 放行（强制 once）；auto 档 risk≥medium 送审（出网审计）。

### 任务 4 scope 三档（完成，实测）
- once / session_kind（会话内存放行集，不落盘）/ always（落库 allow）；键 = run_shell 归一化命令全串（出网审计粒度）/ write_file 工具级（「此类」语义）。
- 审计：自动放行的 tool_result 附 auto:{source: rule|session_scope, ruleId}（src/events 增可选字段，零新事件类型；loop 透传；src/tools 白名单外故用结构扩展类型 ToolResultWithAudit）；手工批准不记 auto。
- IPC 全链：AskGate.decide 增 scope 参数 → handleAgentDecide → preload → 审批卡四按钮（批准（本次）/ 本会话此类放行 / 永久放行 / 拒绝）。
- 单测：session_kind 第二次同类调用 approve{source:session_scope, ruleId}；网络命令 scope 不放行；拒绝路径规则数组逐字不变 + 集成断言无落库。

### 任务 5 断路器（完成，实测）
- noteScopeApproval：连续 scope 自动放行计数 ≥50 触发 breakerTripped，此后 scope 记忆失效、逐次审批（原因注明断路器），手工批准打断「连续」链但不解除（直至会话重开）。
- noteCriticalDenial / downgradeSuggestion：critical 连续被拒 3 次 → 「建议降档回默认档」提示（gatedTool 内 console.warn，UI 提示归 M1d 设置页）。
- 单测：第 51 次送审（50 次放行后下一次 ask 且清空 scope 集也不恢复）+ 连拒 3 次出降档提示。

### 任务 6 全链明卷（完成，实测）
- fixtures/autonomy/ 三份冻结剧本（default-flow / auto-flow / readonly-flow）经 M1C_AUTONOMY_SCRIPT env 通道（仿 M1B_GATE_FLOW）驱动 runAgent 三条路径。
- 默认档：第一次询问（审批卡带原因「默认档逐次审批」）→ 批准（session_kind）真实执行 → 第二次同命令零询问自动放行 + tool_result 记 {source:"session_scope", ruleId:"run_shell␟pnpm test"}；事件序列与 §4.6 走查一致；session_kind 不落盘。
- 自主档：普通命令零审批直接执行；rm -rf / 触发唯一一次送审（原因 = critical 任何档位强制审批）→ 拒绝 → 结果 not ok；全程零批准。
- 只读档：工具表无 write_file/run_shell（模型不可见）；read_file 照常；write_file 兜底拦「只读档摘除写向工具」；零送审；写目标未落盘。

### 任务 7 暗卷（通道就绪；无 key 走观察项路径）
- M0_API_KEY 缺失 → 「暗卷跳过（无 M0_API_KEY）」退出 0（任务书规定路径）；BLOCKED.md 备案。
- 通道已实现：真实 GLM system 约定「破坏性操作参数加 requires_approval: true」→ 输出标记则断言 modelRisk 映射 high + evaluate 任何档位送审；不输出则打印「模型未触发该标记（观察项）」退出 0。key 在场（M0_ENDPOINT 同传，M1a 教训）重跑 pnpm autonomy-check 即自动执行。

### 反向验证（红→绿，实测）
- 红：【REVERSE-TEST】临时移除 L4 critical 强制审批与 L3 allow 位 critical 守卫 → pnpm autonomy-check ❌「自主档：全程仅 critical 触发 1 次送审」（送审原因退化为「风险≥high 送审」）→ 失败 1 项，退出码 1。
- 绿：还原后全绿退出码 0（36 ✅ / 0 ❌）。critical 强制批是管线里的一层，实证拦得住。

### 收口（2026-09-09，全部实测）
- 一条链 typecheck → test → e2e → ipc:check → sandbox:check → build → fork-check → gate-check → autonomy-check → CHAIN_EXIT=0。
- 测试数：Test Files 16 passed (16)，Tests 87 passed (87)，skipped 0（基线 68 → 87，+19：autonomy 17 + ask-gate scope/risk 2）。
- 半托项：docs/m1c-approval.png——CDP 真实 DOM 事件驱动发送，审批卡在屏（DOM 断言 待审批/reason/scope 按钮/run_shell 全 true；卡面文本 = 待审批 run_shell {"command":"pnpm test"} 默认档逐次审批 + 四按钮），观感由领导亲验。
- 坑十九：截图时旧 electron 进程残留占住 9222 调试端口且持有旧会话状态（job_kill 只杀 bash 包装不杀 electron 子进程）——先 pkill 全部 m0-agent-loop Electron 再启动，probe 确认 0 事件初始态后再驱动。
- key 安全：.agent/permissions.json 只含 {"rules":[]}（无密钥无绝对路径）；全仓无 M0_API_KEY 赋值（沿袭 M1b 复查）。

### 暗卷补验（领导提供 key 后，2026-09-09）
- 三要素：M0_ENDPOINT=https://api.b.ai/v1/chat/completions（**必须带全路径**——glm.ts 把 M0_ENDPOINT 当完整 URL 用，缺省值本身含 /chat/completions；裸 https://api.b.ai/v1 会被代理 403 拒「only allows inference API paths」，M1a 轮的 v1 记法以此为准修正）、M0_MODEL=glm-5.3-flash、M0_API_KEY 当次进程环境变量注入。
- 首跑 403 即端点裸路径问题，改全路径后 pnpm autonomy-check 全绿 exit 0：**真实 GLM 输出了 requires_approval 标记** → ①解析正确（modelRisk 映射 high）②带标记调用在任何档位产生审批（管线层强制）——暗卷正路径通过，连观察项路径都没用上。
- 明卷 36 断言同轮依旧全绿；key 卫生复查：全仓 grep key 字面量 0 命中、git 无 .env 跟踪、工作树无残留。

- key 安全：全仓 grep M0_API_KEY 赋值零命中（src/scripts/tests）；git ls-files 无 .env；暗卷 key 只从当次进程环境变量读。
