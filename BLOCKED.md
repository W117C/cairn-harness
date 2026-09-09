# BLOCKED.md（待裁决清单）

无阻塞事项。

## 待裁决（非阻塞，不影响交付）
1. **pnpm-workspace.yaml 的去留**：`pnpm add` 期间 pnpm 11 自动生成（内容仅 ignoredBuiltDependencies: [esbuild]，即任务书"坑一"的官方记录方式）。不在任务书白名单内，故未提交 git；也未删除（删文件属不可逆操作）。建议：领导拍板后 `git add pnpm-workspace.yaml` 入库或直接删除，二选一即可，删除后下次 install pnpm 会重新生成。
2. **pnpm-lock.yaml 已随任务 1 入库**：lockfile 不在白名单字面列表中，但它是 `pnpm add`（任务 1 明确要求）的直接产物，为可复现性随 package.json 一并提交。若不允许，`git rm --cached pnpm-lock.yaml` 即可。

## 背景注记（已解决的环境坑，无需裁决）
- 根目录不允许新建 vitest.config.ts → 改由 package.json 脚本显式 `--config tests/vitest.config.ts`（根 vitest 默认 include 会扫进 oh-src/ 的 772 个外部测试文件）。
- pnpm 11.8 下 tsx CLI 包装吞子进程 stdout/stderr 且丢退出码 → scripts 统一 `node --import tsx`（tsx 官方推荐用法）。
## M0b-UI 轮新增待裁决（2026-09-09）
1. ~~pnpm-workspace.yaml~~ **已解决（2026-09-09 管理者复核）**：坏占位行已清除，文件已入库（`onlyBuiltDependencies: [electron, esbuild]`，electron postinstall 必需）。
2. ~~start 脚本偏离~~ **已解决（2026-09-09 管理者复核）**：实测 `pnpm exec electron .` 正常启动（v44.2.0），start 已改回标准写法 `electron-vite build && electron .`；`pnpm start` 实测起得来。
3. ~~环境怪癖备案~~ **原诊断有误，已更正（2026-09-09 管理者复核）**：`/usr/local/bin/node` 是**真实 Node v24.19.0**（234MB universal binary，`process.versions.electron === undefined`）。pnpm 脚本链内出现的 Electron-as-node（v24.18.1，electron=43.3.0）来自 DSH 自己的 pnpm 运行链，与该二进制无关。**无需清理任何系统文件**；六道门在真实 Node v22.23.2 下复跑同样全绿。详见 `AGENTS.md` 环境注意。
4. **UI 自动化**：拍板否了 Playwright；本轮截图与交互演示改用（a）应用内 capturePage 截图钩子（M0B_SCREENSHOT env 门控）与（b）macOS AX + 键盘事件（需辅助功能授权，已由领导现场授予）。两者均为交付手段，不进验收链。
5. **mock 提示**：UI 发送的任意消息都驱动同一份冻结 mock 剧本（剧本内容与消息文本无关），这是 M0b 的既定边界；真实模型接入后此差异自然消除。
## M0c 轮新增待裁决（2026-09-09）
1. **shadcn init 框架检测不识别 electron-vite 布局**：CLI 只认 vite.config.*（任务书现状说实测成功，本机复现失败——检测代码 chunk-B2MD6U5O.js 只 startsWith("vite.config.")）。已改走官方 manual 路线（手写 components.json + nova token CSS，组件仍由 CLI add 产出，非手抄）。待裁决：接受 manual 路线为标准，或给 shadcn 提 electron-vite 支持 issue。
2. **反向验证前提偏差**：strict CSP 下构建应用样式不失效——Tailwind v4 构建产物是 <link> 同源文件，style-src 'self' 本就放行；坑二只约束 dev 注入路径。机制级红→绿已用构建产物注入内联 <style> 证明（'self' 拦截 / 'unsafe-inline' 放行）。待裁决：验收口径是否改为 dev 模式或机制级证明（本轮两者都留了证据）。
3. **System Events AX 窗口枚举再次失效**（invalid index，授权后一度可用）：UI 驱动与截图改用 CDP（Runtime.evaluate 真实 DOM 事件 + Page.captureScreenshot）。待裁决：是否需要稳定的 AX 环境（影响后续自动化验收方式）。
4. **pnpm-workspace.yaml 曾被外部提交 61a2b94 固化**：本轮 pnpm 又自动追加 allowBuilds 占位行，已按白名单还原。pnpm add 时 ERR_PNPM_IGNORED_BUILDS 警告仍会让 shadcn add 误判失败（重跑即可），根治需 onlyBuiltDependencies 增补或 pnpm 配置调整，待裁决。
5. **组件源码不跟上游**：本轮未改任何 components/ui 生成文件，故无 @shadcn-modified 标记；后续改动时按拍板加标记。

## M1a 轮新增待裁决（2026-09-09）
1. **【真阻塞】M0_API_KEY 缺失 → 联网验收无法执行**：环境变量与 .env.local 均不存在。受影响验收：①`pnpm provider:check` 真连三断言（≥2 delta / usage input>0 且 output>0 / 带 tools 解析出 tool_call）②反向验证 stream:false 红→绿 ③真模型流式截图。GLM provider（src/providers/glm.ts）实现与离线解析单测（stub fetch 3 条）已完成；key 就绪后跑 `pnpm provider:check` 即可补验。key 只进环境变量，不落文件、不入库。
2. **scripts/ipc-check.ts 白名单矛盾**：任务 6 明确要求「`pnpm ipc:check` 扩展为重放验收」，但界限清单未列该文件（只列了 provider-check.ts / fork-check.ts 两个新脚本）。按任务执行且改动压到最小（import replay + logPath 提取 + 7 行重放比对断言）。待追认；若判违规可整体 revert 该文件，把比对逻辑迁进 src/main（白名单内）。
3. **registry 文件后缀偏差**：任务书写 `src/renderer/cards/registry.ts`，卡片组件含 JSX 必须 .tsx（现为 registry.tsx），功能与验收不受影响。
4. **流式截图的演示通道**：key 缺席时，UI 逐字流式用 mock 演示通道（M0A_MOCK_DELTA=1，env 门控、默认关闭、M0 事件流字节不变）驱动，与 GLM 真流式共用同一条 delta 合成管线（mergeAssistantDeltas + toTimeline）；docs/m1a-stream.png 为该通道中间态（半托项，领导亲验），真模型版截图待 key。
