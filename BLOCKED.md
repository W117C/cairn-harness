# BLOCKED.md（待裁决清单）

无阻塞事项。

## 待裁决（非阻塞，不影响交付）
1. **pnpm-workspace.yaml 的去留**：`pnpm add` 期间 pnpm 11 自动生成（内容仅 ignoredBuiltDependencies: [esbuild]，即任务书"坑一"的官方记录方式）。不在任务书白名单内，故未提交 git；也未删除（删文件属不可逆操作）。建议：领导拍板后 `git add pnpm-workspace.yaml` 入库或直接删除，二选一即可，删除后下次 install pnpm 会重新生成。
2. **pnpm-lock.yaml 已随任务 1 入库**：lockfile 不在白名单字面列表中，但它是 `pnpm add`（任务 1 明确要求）的直接产物，为可复现性随 package.json 一并提交。若不允许，`git rm --cached pnpm-lock.yaml` 即可。

## 背景注记（已解决的环境坑，无需裁决）
- 根目录不允许新建 vitest.config.ts → 改由 package.json 脚本显式 `--config tests/vitest.config.ts`（根 vitest 默认 include 会扫进 oh-src/ 的 772 个外部测试文件）。
- pnpm 11.8 下 tsx CLI 包装吞子进程 stdout/stderr 且丢退出码 → scripts 统一 `node --import tsx`（tsx 官方推荐用法）。
## M0b-UI 轮新增待裁决（2026-09-09）
1. **pnpm-workspace.yaml（再次出现）**：electron 的 postinstall（下载二进制）必须放行，本仓无它则 electron 装不上（本轮实测：onlyBuiltDependencies: [electron, esbuild]）。不在白名单 → 未提交；建议领导拍板入库或接受每次 install 手动放行。
2. **start 脚本偏离**：`pnpm exec electron .` 在 DSH 环境被其 pnpm shim（Electron-as-node + clear-env）破坏，start 改为直启 node_modules/electron/dist/Electron.app 二进制。脱离 DSH 环境后可改回标准写法。
3. **环境怪癖备案**：/usr/local/bin/node 实为 Electron-as-node（245MB，v24.18.1）；pnpm 脚本链内 `node` 解析到它，沙箱内 vitest 实际运行其上（实测功能正常）。如介意，建议领导清理该符号链接。
4. **UI 自动化**：拍板否了 Playwright；本轮截图与交互演示改用（a）应用内 capturePage 截图钩子（M0B_SCREENSHOT env 门控）与（b）macOS AX + 键盘事件（需辅助功能授权，已由领导现场授予）。两者均为交付手段，不进验收链。
5. **mock 提示**：UI 发送的任意消息都驱动同一份冻结 mock 剧本（剧本内容与消息文本无关），这是 M0b 的既定边界；真实模型接入后此差异自然消除。
