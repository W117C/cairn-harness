# M0 桌面编程 Agent（agent-plan.md 的实现）

一个 Electron 桌面编程 agent。`agent-plan.md` 是唯一权威方案；本仓库当前只实现到 M0。

## 怎么跑

- 安装：`pnpm install`
- 六道门禁：`pnpm typecheck && pnpm test && pnpm e2e && pnpm ipc:check && pnpm sandbox:check && pnpm build`
- 起界面：`pnpm start`（构建 + 启动 Electron）
- 单跑闭环：`pnpm e2e`（mock 模型驱动 loop 修 `fixtures/todo-app` 的 bug）

## 技术栈

Node 22 / TypeScript 5 / electron-vite 5 / Electron 44 / React 19 / vitest 5 / Tailwind CSS 4 + shadcn/ui（radix-nova preset，组件源码在 src/renderer/components/ui/，不跟上游自动升级）。

## 目录与约定

- `src/agent/`、`src/events/`、`src/tools/`、`src/permissions/`、`src/providers/` —— M0a 内核（agent loop / 事件流 / 工具 / 权限门 / 模型适配）
- `src/main/`、`src/preload/`、`src/renderer/` —— M0b Electron 壳（IPC 接线 / 审批门 / Seatbelt 沙箱）
- `fixtures/todo-app/` —— 验收靶子；`fixtures/mock/` —— 冻结的模型剧本
- `fixtures/todo-app/tests/**` 与 `fixtures/mock/**` 是**判卷文件**：sha256 冻结在 `scripts/frozen-sha256.json`，改它们等于作弊
- `agent-plan.md` 只读——那是方案，不是代码

## 环境注意

- 在 DSH 里跑时，pnpm 脚本内的 `node` 解析到 DSH 的 Electron-as-node（v24.18.1），不是 `/usr/local/bin/node`（真实 Node v24.19.0）。两套运行时下六道门实测都过；怀疑环境问题时用 `pnpm exec node -p "process.versions"` 确认。
- 沙箱内跑不了 `pnpm test`（pnpm 依赖检查失败）；用 `node node_modules/vitest/vitest.mjs run --pool=threads`。`src/main/agent-runner.ts` 已自动把 `pnpm test` 映射成这条。
- macOS 沙箱规则里的路径必须是 realpath（`/tmp` 实为 `/private/tmp`），否则规则静默失效。
- shadcn CLI 的 init 不识别 electron-vite 布局（框架检测只认 vite.config.*）：组件用 components.json（style=radix-nova）+ `npx shadcn add <name> -y` 管理；改过生成组件时在文件头加 `// @shadcn-modified`。
- renderer 的 CSP 是 `style-src 'self' 'unsafe-inline'`：dev 下 Tailwind 注入内联样式，收紧会被拦（构建产物是 <link> 文件，不受影响）。

## 判卷纪律

- 判卷标准（grep / 断言 / 验收脚本）是冻结的。**发现判据有缺陷 → 写 `BLOCKED.md` 要求换判据，不许改代码去绕**。
- 反面样例：`theme.ts` 的 `DARK_QUERY` 被拆成 `"(prefers-color-" + "scheme: dark)"`，只为避开 `grep "color-scheme: dark"`——正确的精确判据是 `^\s*color-scheme:\s*dark`。
- 硬指标里的 grep 一律写精确模式（锚定行首/分号），避免误伤合法用法。

## 已知待清理

- `src/renderer/theme.ts` 的 `DARK_QUERY` 还原为一行（1 行改动，行为不变）。

## 当前状态

M0 完成（M0a 内核 + M0b 界面/沙箱 + M0c shadcn/ui 组件层与系统主题，六道门全绿，32 测试）。下一步 = M1 会话内核（见 `agent-plan.md` §14）。