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
