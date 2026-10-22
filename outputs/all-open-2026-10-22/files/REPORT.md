# 文件面板收尾 · 2026-10-22

本批完成 `outputs/desktop-files-2026-10-21/PLAN.md` 在文件面板白名单内的交付。工作树已修复并通过真实 Electron renderer 验证；没有提交，也不代表 HEAD / 全 gates 认证。

## 结果

计划最初列出的目录/预览请求序号保护、截断提示、原地重试、aria 状态和路径标题，在本批基线源码中已经存在。本批首先用真实 renderer + 生产 preload + Electron IPC 复验，确认它们的关键分支有效，没有把已有实现算作新增修复。

基线真实红测有 25 个断言：19 通过、6 失败。失败来自同一组实际交互：

1. 根树第一次加载有 11 个 `tabIndex=0`，修为一个根节点作为初始 Tab 停点。
2. 空目录按右方向键会跳兄弟节点，修为只进入当前目录的直属子行。
3. 加载中的目录同样误跳兄弟，使用同一个直属子行判断修复。
4. 读取失败的目录同样误跳兄弟，使用同一个判断修复。
5. 打开文件后只读提示消失，预览头持续显示“只读”。
6. 窄面板的完整相对路径仍被省略，改为换行阅读并保持完整 title。

另外将 FilePane 从 PaneDock 提取为独立组件；PaneDock 从 1,202 行降至 999 行，FilePane 为 211 行。目录或文件行点击显式保留该行焦点，避免收起子树时出现焦点脱离。原有路径右键菜单及其 IPC 参数均通过回归。

## 改动范围

- `apps/desktop/src/renderer/components/PaneDock.tsx`：提取并导入 FilePane，清理随之移动的导入。
- 新建 `apps/desktop/src/renderer/components/FilePane.tsx`：保留原数据和路径菜单契约，修复上述树键盘与预览问题。
- `apps/desktop/src/renderer/styles.css`：仅在末尾追加文件预览的 3 条选择器；本批之前的样式已备份至 `baseline/styles.css`，精确对比确认没有改动其他选择器。
- 新建 `apps/desktop/scripts/file-pane-renderer-smoke.{cjs,ts}`：可重复真实 Electron 回归，使用隔离 profile、真实临时文件、生产 `listDir` / `readTextFile`，只在 IPC 边界注入延迟/失败。
- 本目录：红绿读数、截图、OCR 选文件/规则结果、局部 diff 和源码指纹。

现有 `file-pane-improvements.test.ts` 的读取面由主线程迁移到 app-surface，保留原断言；不属于本子任务的文件修改。没有编辑 App、state、panes、projections、全局配置、规则、包或 gate 文件，没有 reset/stash 他人改动。

## 验证

命令均从仓库根执行，桌面 exec 自行切到包目录。

| 命令 | 退出码 | 证据 |
| --- | --- | --- |
| `env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron scripts/file-pane-renderer-smoke.cjs ../../outputs/all-open-2026-10-22/files/red` | 1，预期红测 | `red.log`、`red/checks.json`：25 断言，19 通过、6 失败 |
| 同一命令，输出目录改为 `files/green` | 0 | `green.log`、`green/checks.json`：25/25 通过 |
| `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/file-pane-improvements.test.ts tests/pane-persistence.test.ts tests/pane-shortcuts.test.ts tests/pane-open-reveals-inspector.test.ts tests/popout.test.ts` | 0 | `targeted-tests.log`：实际收集 4 文件、21 测试；`popout.test.ts` 不存在，没有计入测试数 |
| `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/popout-event-scope.test.ts tests/popout-title.test.ts tests/pane-disclosure.test.tsx tests/pane-rows.test.tsx tests/pane-close-order.test.ts` | 0 | `targeted-pane-tests.log`：5 文件、34 测试 |
| 主线程统一 `pnpm --filter cairn-desktop build` | 0 | `../build-current.log`，含生产 preload、Vite、桌面 `tsc --noEmit`；绿测使用该产物 |
| Impeccable detector（FilePane.tsx / PaneDock.tsx） | 0 | `design-detector.json`：`[]` |
| `git diff --check`（本批已跟踪文件） | 0 | 无空白错误；另已检查新增文件内容 |
| OCR `delegate preview --exclude …` + `delegate rule <本批文件>` | 0 | `ocr-preview.log`、`ocr-rules.log`；当前代理按规则审查，未调用 OCR review/scan |

真实回归覆盖：目录与预览反序成功响应、旧预览异常响应、目录/文本失败及重试、真实 501 项目录的 500 项截断提示、真实二进制拒绝、真实 512 KiB 文件截断、Home/End/上下/左右/原生 Enter/Space、aria 展开与选中状态、完整路径、持续只读、窄布局和右键路径动作。

旧预览异常用例故意使一次 IPC handler reject，因此 red/green 的主进程日志中有一条“旧文件失败响应”。这是被验证的受控错误；renderer 控制台错误数组为空。原生 Enter/Space 在 smoke 中发送 keyDown、char、keyUp；先前缺字符事件导致的验证脚本超时已修正，最终红绿数据来自同一完整路径。

## 视觉证据

已实际读取最终截图确认路径完整换行、只读提示和错误重试均可见：

- `green/04-long-path-narrow.png`：360 px viewport，路径 clientWidth / scrollWidth 均为 314 px，正文与文件树无横向溢出。
- `green/05-dark-narrow.png`：走真实系统主题跟随（nativeTheme → matchMedia → 生产主题逻辑），同一窄面板暗色状态。
- `green/02-directory-error.png`：目录错误与重试入口。
- `green/03-preview-error.png`：文件错误、完整短路径及持续只读提示。
- 对照：`red/04-long-path-narrow.png` 的路径 clientWidth 342 px、scrollWidth 489 px，内容被省略。

## 证据边界

- 证据覆盖当前共享工作树与当时构建的 renderer，不覆盖提交或部署。
- 本子任务按分工没有运行桌面全套、核心全套、根类型检查或 full gates；由主线程统一执行和记录，不能从这里的 55 条定向测试推断全仓通过。
- 目录失败和异步乱序由受控 IPC 注入；正常读取、目录上限、文本上限、二进制与路径解析使用生产纯 Node 实现。右键菜单验证到生产 preload 的准确 IPC 参数，未打开真实 Finder / 外部应用。
- 本批没有 `.codegraph/` 索引，未安装工具或创建索引。
- 跨窗口工作区归属仍由宿主共享 `workspaceContext` 决定（`apps/desktop/src/main/index.ts` 的 setWorkspaceContext、workspaceListDir、workspaceReadText、workspacePathAction）；已向主线程报告，由其另行处理。本批没有把单组件请求序号保护描述为跨窗口修复。
