# 会话正文检索运行时收口

基线提交：`f8b86e4`。下列结果覆盖本轮未提交工作树与重建的桌面产物，不能当作该提交的认证结果。

## 已复现并修复

- 首跑 21 项中 20 项通过，`unavailable` 只显示原始 ENOENT，缺少可理解的不可用状态。先补组件红测（1 failed / 3 passed），再让界面始终显示「当前项目的对话正文暂时无法搜索」，保留诊断与重试。
- 目验首次打开结果的截图发现：虽然正文读取的是 A，顶栏标题和侧栏高亮却借用了 B 的同名 id。新增真机两项均红；新增侧栏 SSR 两项也均红。复用既有 `findSessionByRef`，标题、复制/导出标题、F2 初始标题带活动工作区；同 id 切项目也关闭旧改名框；侧栏仅把当前工作区行标为 active。
- 冒烟保存的 detail 采用快照，避免后续数组修改改写先前断言的证据；截图等待有限动画结束，不把淡入中间帧当最终画面。

## 当前验证

- 真实 Electron 脚本：**23 / 23**，0 skipped，15 次生产核心扫描请求。`checks.json` 为机器结果，`runtime.log` 为原始输出。受控 IPC 错误在主进程 stderr 留痕是故意注入；renderer console errors = 0。
- 定向桌面测试：**9 文件 / 72 测试**，`--maxWorkers=2`，exit 0；见 `targeted-tests.log`。
- `pnpm --filter cairn-desktop build`（preload、Vite、desktop tsc）exit 0；见 `build.log`。
- `pnpm renderer-layer-check` exit 0；117 个 renderer 源文件，状态层/组件层/派生纯度及 1200/900 行数帽通过。
- 相关 diff 的 `git diff --check` exit 0。OCR 仅执行 delegate preview/rule，由当前 agent 审查；未执行模型型 `ocr review` / `ocr scan`。
- 已目验 `04-unavailable.png` 与最新 `06-opened-correct-workspace.png`：不可用提示完整、重试可见，打开 A 的正文时顶栏回落到它自己的 id，B 的同名行没有被选中。

真机命令（启动前删除环境中的 `ELECTRON_RUN_AS_NODE`）：

```sh
apps/desktop/node_modules/.bin/electron apps/desktop/scripts/session-search-renderer-smoke.cjs outputs/open-task-reconciliation-2026-10-22/search-runtime
```

测试命令：

```sh
pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/session-search-ui.test.tsx tests/command-palette.test.tsx tests/session-identity-ui.test.tsx tests/session-target.test.ts tests/session-open-workspace.test.ts tests/sidebar-highlight.test.tsx tests/sidebar-arrow-nav.test.ts tests/sidebar-session-context-menu.test.ts tests/transcript.test.ts --maxWorkers=2
```

## 验证边界

真实部分：生产 renderer、生产 preload、Electron IPC 传输、生产 `searchSessions`、临时 JSONL 文件、实际键盘事件、实际 DOM 与截图。正文检索 IPC 的脚本 handler 调用生产核心扫描，并在扫描后注入延迟、失败、预算或缺失根，验证 UI 应答边界。项目/会话列表、openSession handler 等非目标接口是隔离 fixture；打开 handler 用真实 `replay` 读取临时日志。因此本报告不声称验证了生产 main 的注册根闸或 KernelHost 生命周期。

覆盖：空/空白查询、中英文与大小写、旧正文会话不在标题列表、200ms debounce、迟到成功/失败/清空、隐藏思考内容不命中、完整零命中、partial、unavailable、IPC 失败及两类重试、同名 id 的 workspace 传递、键盘打开、正确正文/标题/侧栏归属。

不包括：所有会话级运行态/队列/审批 map 的跨项目命名空间、生产 mutation API 的跨项目寻址、工作区切换期间的迟到请求专门场景、付费模型能力收益、HEAD 或全量 gates 认证。本轮未调用模型或网络服务，未修改规则、main、events、loop、STATE 或 PROGRESS，未提交。

## 修改文件

- `apps/desktop/scripts/session-search-renderer-smoke.ts`
- `apps/desktop/src/renderer/components/SessionSearchResults.tsx`
- `apps/desktop/src/renderer/components/Sidebar.tsx`
- `apps/desktop/src/renderer/state/workbench.ts`
- `apps/desktop/tests/session-search-ui.test.tsx`
- `apps/desktop/tests/session-identity-ui.test.tsx`（新增）

红证据：`red/`（首次 unavailable）与 `identity-red/`（标题和侧栏）。
