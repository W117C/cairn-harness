# 会话与工作台 · 2026-11-01

本轮按用户选定的「会话与工作台」路径，完善列表读取、失败恢复和状态一致性。目标目录为 `/Users/ze/Downloads/Cairn/cairn`；检查起点 HEAD 为 `be9c0be5`，结果覆盖当前工作树，未提交或发布。

## 实现

- 桌面：后台更新失败继续显示缓存会话；错误与重试同行，完整原因用原生 details 按需展开，超长路径换行并在限定高度内滚动。重试期间按钮禁用、列表带忙碌状态，已有会话仍可打开。
- 状态模块：从 `state/workbench.ts` 提取 `state/session-list.ts`。仅最新请求可提交成功、失败和忙碌状态；卸载清理使旧请求失效。首次失败不放行会话恢复，也不把缓存列表改成空列表。
- 后端：`listSessions` 与 `listSessionIds` 共用目录读取边界。仅 ENOENT 返回空数组；ENOTDIR、EACCES 等原始错误保留错误码和路径并向上传递。单个文件竞态跳过策略保持原有口径。

没有新增依赖、IPC 或日志格式。共享工作区的其他改动未归入本轮；`scoped.patch` 记录相对本轮开始时文件内容的改动，补充新文件。

## 验证

| 检查 | 当前结果 |
| --- | --- |
| 新增后端回归 | 6 项通过；改前 ENOTDIR/EACCES 的 4 项失败，改后通过 |
| 新增桌面回归 | 3 项通过；改前全部失败，改后通过 |
| 聚焦 core：列表与存储 | 2 文件 / 40 项通过，`--maxWorkers=2` |
| 指针会话仓库 | 1 文件 / 7 项通过，`--maxWorkers=2` |
| 聚焦 desktop：恢复、交互与词表 | 3 文件 / 21 项通过，`--maxWorkers=2` |
| 完整 core：`pnpm test:capped` | 600 文件通过、1 文件失败；7531 项通过、1 项失败，`--maxWorkers=2` |
| 完整 desktop：`pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts --maxWorkers=2` | 292 文件通过、1 文件失败；1977 项通过、1 项失败 |
| Electron 恢复冒烟 | 17/17 通过；首读、缓存、打开缓存会话、重试、旧成功/失败、忙碌态、真实空结果、亮暗 1440/880 宽、键盘展开、长路径、控制台 |
| 既有错误详情冒烟 | 5/5 通过；展开后仍保留完整路径、原因和修复出路 |
| 根与桌面类型检查 | 均通过，无类型错误 |
| 隔离 Vite 生产构建 | 通过；产物位于 `/tmp/cairn-session-list-after-20261101` |
| renderer-layer-check / desktop-boundary-check / docs-check | 通过 |
| Impeccable 检测 | 两条既有 `transition: width` 警告（styles.css 159/174），本轮未涉及这些规则；本轮样式无新增命中 |

Electron 使用真实 renderer、合成 AgentApi 和临时 profile。新冒烟发送完整键盘字符事件，并断言 details.open，避免把「能聚焦」误报为「已展开」。这不是生产 preload、真实 Provider、安装包或跨平台认证。日志中的 Electron sandbox-extension 系统提示未造成 renderer/preload 错误。

## 两项未通过

1. `apps/desktop/tests/stream-rework.test.tsx:63`：仍期待工具折叠行出现 `run_shell`；当前行已有摘要、图标和耗时，未显示原始工具名。这一项在本轮改动前的完整桌面基线已经失败（1974 通过 / 1 失败），改后同项失败，没有放宽断言。
2. `tests/promise-recall-inventory.test.ts:333`：能力断言的 noNeedle 清单为 6，超过帽 5。独立复跑同样失败。将本轮唯一修改的 core 文件 `src/main/sessions.ts` 在扫描输入中替换为改前内容后，完整 claimWitnessFindings 结果相同，见 `inventory-attribution.json`；涉及其他模块，本轮没有修改文案、登记表或帽。

没有运行 gates、head-cert-check、mutate-verify；后两者测提交，不能拿当前未提交内容冒充 HEAD 验证。

## 审查与证据

OCR 使用 delegate preview 的排除范围与指定路径 delegate rule；由当前代理按解析出的规则审查本轮差异，未调用 OCR review/scan 或模型审查服务。关注了错误传播、请求乱序、启动恢复闸、XSS 转义、键盘默认行为与临时 profile 清理；本轮差异未留下需要修改的审查发现。规则原文在 `ocr-rules.md`。

改前：`before/02-cached-error-light.png`。改后：`after/02-cached-error-light.png`、`after/03-error-details-light.png`、`after/03-error-details-dark.png`。截图均已目视检查。

复现恢复冒烟：先从 `apps/desktop/` 用 Vite 构建到隔离目录，再从仓库根执行：

```sh
env -u ELECTRON_RUN_AS_NODE CAIRN_RENDERER_DIST=/tmp/cairn-session-list-after-20261101 pnpm --filter cairn-desktop exec electron scripts/session-list-recovery-smoke.cjs /tmp/cairn-session-list-recheck
```

技术参考：[React 的异步结果清理建议](https://react.dev/learn/synchronizing-with-effects#fetching-data)、[VS Code 文件系统错误处理](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/browser/htmlFileSystemProvider.ts)、[Electron sendInputEvent](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent)。仅作实现参考，未下载或引入第三方代码。
