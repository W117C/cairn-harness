# BLOCKED.md（待裁决清单）

无阻塞事项。

## M1c 轮新增待裁决（2026-09-09）
1. ~~M0_API_KEY 缺失 → 暗卷（任务 7）走观察项路径~~ **已解决（2026-09-09 领导提供 key）**：真实 GLM（glm-5.3-flash）在 requires_approval 约定下输出了标记 → 解析映射 high + 管线任何档位强制审批，两断言绿、autonomy-check 全绿 exit 0（暗卷正路径，未动用观察项）。环境教训修正：M0_ENDPOINT 必须是**含路径的完整 URL**（https://api.b.ai/v1/chat/completions）——glm.ts 不自行拼 /chat/completions，裸 v1 根路径会被代理 403 拒（M1a 轮的「M0_ENDPOINT=https://api.b.ai/v1」记法不准）。key 只进当次进程环境变量，全仓字面量 0 命中。
2. **「最长前缀」与「deny>ask>allow 固定序」的取舍**：§11.7.3 同时采纳 Roo「同段取最长前缀」与 Claude「规则特异性不改评估序」，两者在「短 deny + 长 allow 同段命中」场景冲突。本轮按任务书验收④实现为：同段多规则命中取最长前缀（其行为生效），同长才按 deny>ask>allow；管线层序 deny→ask 不变。若领导希望 deny 恒压 allow（特异性无效），匹配函数一行可改，但验收④的『git push origin main → allow』会随之翻红，需先换判据。
3. **session_kind 记忆键粒度**：run_shell 按归一化命令全串（同命令免二次审批，不同命令仍问——出网审计不放宽）、write_file 按工具级（批准一次写 = 本会话写类放行，「此类」语义）。write_file 的粒度偏宽，若领导认为应按路径前缀（更细但记忆几乎不命中），M1c 只改 scopeKey() 一处。
4. **verify 在只读/审批面的位置**（沿袭 M1b 备案 3）：verify 执行 lint/test（读为主），本轮维持不拦；toolTableFor 含 verify（与 gateToolSpecs 同源）。如需 verify 也过 ask，autonomy.ts 的 isSideEffectTool 加一个名字即可。
5. **审批卡降档提示形态**：critical 连拒 3 次的降档提示本轮走主进程 console.warn（审批行内 UI 提示需改 renderer 状态流，归 M1d 设置页一起做）。
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
1. ~~【真阻塞】M0_API_KEY 缺失 → 联网验收无法执行~~ **已解决（2026-09-09 领导提供 key）**：`pnpm provider:check` 真连 exit 0（148 delta / usage 22/754 / tool_call 解析成功 / 151 条事件重放一致）；反向验证 stream:false 红（1 delta，exit 1）→还原→绿（exit 0）完成；docs/m1a-stream.png 已更新为真模型流式版。key 只进当次进程环境变量，全仓 grep 字面量零命中，未落任何文件、未入库。注意：该 key 端点绑定代理（M0_ENDPOINT 必须同传，打默认 bigmodel 端点会 401）。
2. **scripts/ipc-check.ts 白名单矛盾**：任务 6 明确要求「`pnpm ipc:check` 扩展为重放验收」，但界限清单未列该文件（只列了 provider-check.ts / fork-check.ts 两个新脚本）。按任务执行且改动压到最小（import replay + logPath 提取 + 7 行重放比对断言）。待追认；若判违规可整体 revert 该文件，把比对逻辑迁进 src/main（白名单内）。
3. **registry 文件后缀偏差**：任务书写 `src/renderer/cards/registry.ts`，卡片组件含 JSX 必须 .tsx（现为 registry.tsx），功能与验收不受影响。
4. ~~流式截图的演示通道~~ **已解决（2026-09-09 真模型版交付）**：docs/m1a-stream.png 现为真模型（glm-5.3-flash）流式中间态（捕获瞬间气泡 = 「我是Z.ai开发的GLM▍」，模型仍在生成）。mock 演示通道（M0A_MOCK_DELTA=1）保留为无 key 时的演示路径，与真模型共用同一条 delta 合成管线；真模型 UI 通道走 M0A_PROVIDER=glm（env 门控、单轮、无 tools，完整 loop 接线归 M1b）。
## M1b 轮新增待裁决（2026-09-09）
1. ~~【真阻塞】M0_API_KEY 缺失 → 暗卷（任务 6）无法执行~~ **非阻塞，走任务书规定跳过路径**：`pnpm gate-check` 检测无 key → 打印「暗卷跳过（无 M0_API_KEY）」退出码 0，其余断言全绿。暗卷通道已备好（src/agent/glm-session.ts：从事件日志重建 OpenAI 兼容对话历史含 tool 角色反馈回模型；gate-check 暗卷段断言模型至少各调一次 clarify 与 propose_plan + 判卷 sha256 不破）。**领导提供 key 后重跑 `pnpm gate-check` 即自动执行暗卷**（注意 M1a 教训：代理 key 必须 M0_ENDPOINT 同传）。
2. **verify 配置来源取舍**：任务书「verify 配置读 .agent/config.json 的 verify 字段，缺省探测 package.json 的 scripts」已按序实现；propose_plan 的 verify 字段仅作计划卡展示（未作为执行器第三来源）——若领导希望 plan.verify 覆盖 config，M1c 一行改动即可（loadVerifyConfig 加一层入参）。
3. **verify 在 read-only 档不拦**：verify 执行的是仓库自身配置的 lint/test 命令（读为主），权限层按非副作用工具放行；若领导认为 verify 命令也要过 ask，M1c 在 checkPermission 增加 verify 分支即可。
4. **registry 文件后缀**（沿袭 M1a 备案）：registry.tsx 含 JSX 必须 .tsx；本轮新增三个卡片文件同为 .tsx。
