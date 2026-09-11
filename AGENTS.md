# M0 桌面编程 Agent（agent-plan.md 的实现）

一个 Electron 桌面编程 agent。`agent-plan.md` 是唯一权威方案；本仓库当前实现到 M2（已收口）。

## 怎么跑

- 安装：`pnpm install`
- 全部门禁：`pnpm gates`（**清单即事实源**，一条命令跑齐 19 道门并打印逐道退出码 + 恒真式体检；新增门只改 `scripts/gates.ts` 清单，任务书不再自报门数）
- 六道门禁：`pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build`
- 起界面：`pnpm start`（构建 + 启动 Electron）
- 单跑闭环：`pnpm e2e`（mock 模型驱动 loop 修 `fixtures/todo-app` 的 bug）
- 跑验收一律 `TERM=dumb`：`TERM=xterm-256color` 会让 vitest 输出 ANSI 序列，摘要正则假红（e2e/ipc-check 已内置 ANSI 剥离，但新脚本别再依赖调用者 TERM）

## 技术栈

Node 22 / TypeScript 5 / electron-vite 5 / Electron 44 / React 19 / vitest 5 / Tailwind CSS 4 + shadcn/ui（radix-nova preset，组件源码在 src/renderer/components/ui/，不跟上游自动升级）。

## 目录与约定

- `src/agent/`、`src/events/`、`src/tools/`、`src/permissions/`、`src/providers/` —— M0a 内核（agent loop / 事件流 / 工具 / 权限门 / 模型适配）
- `src/main/`、`src/preload/`、`src/renderer/` —— M0b Electron 壳（IPC 接线 / 审批门 / Seatbelt 沙箱）
- `fixtures/todo-app/` —— 验收靶子；`fixtures/mock/` —— 冻结的模型剧本
- `fixtures/todo-app/tests/**` 与 `fixtures/mock/**` 是**判卷文件**：sha256 冻结在 `scripts/frozen-sha256.json`，改它们等于作弊
- `agent-plan.md` 只读——那是方案，不是代码

## 环境注意

- 在 DSH 里跑时，pnpm 脚本内的 `node` 解析到 DSH 的 Electron-as-node（v24.18.1），不是 `/usr/local/bin/node`（真实 Node v24.19.0）。两套运行时下门禁实测都过；怀疑环境问题时用 `pnpm exec node -p "process.versions"` 确认。
- 沙箱内跑不了 `pnpm test`（pnpm 依赖检查失败）；用 `node node_modules/vitest/vitest.mjs run --pool=threads`。`src/main/agent-runner.ts` 已自动把 `pnpm test` 映射成这条。
- 沙箱三门（`sandbox:check` / `ipc:check` / `panels-check`）按宿主**自动选分支**，输出显式打印走了哪支（fail-visible，不真空通过）：沙箱可用 → **分支 A 真断言**（2026-09-11 ZCode 环境实测走 A）；宿主拒 apply 含 deny 规则的 profile（曾见于 DSH 宿主，`sandbox_apply: Operation not permitted`）→ **降级分支 B**（断言降级链正确而非沙箱生效）。反向验证通道：`pnpm sandbox:check -- --force-available`（强制 A）/ `-- --bogus-root`（A①必红）。
- Electron 在拒载 Chromium 沙箱的宿主必须 `--no-sandbox --disable-gpu`，否则窗口起不来（panels-check 会探测并自动附加；自写截图脚本需自加）。
- macOS 沙箱规则里的路径必须是 realpath（`/tmp` 实为 `/private/tmp`），否则规则静默失效。
- shadcn CLI 的 init 不识别 electron-vite 布局（框架检测只认 vite.config.*）：组件用 components.json（style=radix-nova）+ `npx shadcn add <name> -y` 管理；改过生成组件时在文件头加 `// @shadcn-modified`。
- renderer 的 CSP 是 `style-src 'self' 'unsafe-inline'`：dev 下 Tailwind 注入内联样式，收紧会被拦（构建产物是 <link> 文件，不受影响）。

## 判卷纪律

- 判卷标准（grep / 断言 / 验收脚本）是冻结的。**发现判据有缺陷 → 写 `BLOCKED.md` 要求换判据，不许改代码去绕**。
- 反面样例（已结案）：`theme.ts` 的 `DARK_QUERY` 曾被拆行避开 `grep "color-scheme: dark"`，2026-09-10 已还原为一行；正确精确判据是 `^\s*color-scheme:\s*dark`（锚定行首，不误伤合法用法）。
- 硬指标里的 grep 一律写精确模式（锚定行首/分号）；**扫描类判据（如 key 扫描）自此用词边界**（`\bsk-` 而非 `sk-`），消除 AskGate 类假阳性（裁决见 BLOCKED.md 裁决记录 §3）。

## 当前状态

**M0–M3 全部完成（2026-09-12 M3c 收口）**：M0–M2g（内核/沙箱/会话内核/三门/压缩/prune/地图/provider/记忆/插件/MCP/sidechat/安全 report，详见 `docs/m2-acceptance.md`）→ **M3 编排内核三轮交付**：M3a（spawn_agent 三 mode 原语 + 子流事件契约 + 审批解耦 + 取消链 + read mode + agents 面板，HEAD 8fb73f4）→ M3b（write mode：worktree 生命周期 + 写租约表 + 合并控制塔 + 评审闭环 + 产出代码安全 gate 模式 + edit_file 绝对行号，HEAD 3431e72）→ M3c（depends_on 依赖链 + pipeline 哑 sequencer（零 LLM/stages 冻结/verdict 标注）+ agents/*.md 插件角色采纳（§9.11-4 闭合）+ 卡死检测 + maxBudgetUsd 成本闸 + 崩溃恢复（重派）+ worker 压缩（§7.5）+ ≥3 worker 压力验收）。

- 门禁：`pnpm gates` **20 道全绿 + 恒真式体检零命中**；测试 40 files / 357 passed / 0 skipped；agents-check 233 断言（A–M + N 压力段）。
- M3 验收三态表（§14 M3 行 + §4.4.7/8/9 + §4.5 + §7.5 + §9.11-4 + §11.6，带证据指针）见 `docs/m3-acceptance.md`；自研抽象审计见 `docs/m3-audit.md`。
- BLOCKED.md 各轮备案已全部裁决（见其裁决记录节）。
- 下一步 = **M4 商业化**（`agent-plan.md` §12.2 定时任务 + safeStorage 打包/license/更新/引导；M4 任务书待出）。