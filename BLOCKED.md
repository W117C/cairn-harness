# BLOCKED.md（待裁决清单）

## M2e 轮备案（2026-09-10）

1. **任务书门数口径**：任务书写「十七道门（六道门 + fork/gate/autonomy/compaction/panels/tools/map/prune/providers/memory-check）」，括号清单实为 6+10=**16 道**。按清单逐个跑齐 16 道全绿，不多不少；「第十七道」无法对应到任何现有脚本（provider:check 在无 key 时按冻结契约 exit 1，不属「继续全绿」集合）。请裁决：门数口径以括号清单（16）为准。
2. **hook 命令环境变量「只给 PLUGIN_ROOT/PLUGIN_DATA/PROJECT_DIR」的读法**：严格执行「只有三个变量」会导致 hook 子进程连 `node`/`sh` 都无法解析（PATH 缺失），插件生态不可用。按「插件相关变量只给这三个」实现：env = 消毒基础集（PATH/HOME/LANG/TMPDIR/SHELL/USER）+ 三插件变量，且显式剥离含 KEY/TOKEN/SECRET 字样的宿主变量（M0_API_KEY 等）。安全边界（不泄密）保留，可用性修复。请追认。
3. **hook JSON decision「allow」不绕过权限门**：CC 语义 hook allow 可 bypass 权限系统；按任务书「工具进统一注册表、走同一权限门、无特权」让步序（CC 格式兼容 > 纯声明式边界），格式兼容但安全语义从本地：hook deny/exit2 阻断，allow 继续走原权限管线。请追认。
4. **插件信任卡决议通道未接线（preload 白名单外）**：主进程 `plugin:decide` IPC handler 已就绪、`AgentApi.pluginDecide` 类型已声明（optional）；但 `src/preload/**` 不在本轮白名单，桥接层无法加通道。插件面板决议按钮按 deleteMemory 同款先例**禁用并注明**（BLOCKED 备案），未信任不激活的安全语义不受影响（D1–D5 明卷实证）。下轮放开 preload 后接线即可用。

无阻塞事项（上述为备案待追认，不阻塞推进）。

## 裁决记录（2026-09-10，此前各轮备案全部裁决完毕）

以下为管理者对 M0c–M2c 各轮备案事项的逐条裁决；历史原文在本文件下方各轮小节，保留作审计轨迹。agent-plan.md 只读不改，本节即裁决的唯一记录。

### 裁决（含处置）

1. **M2c-1 loop 保留 legacy `{next()}` 分支** → **保留，定位为长期兼容而非技术债**。冻结的 gate-check.ts 永久注入 `{next()}` 形态 scripted provider，该分支是真实契约；scripts/ 只读界限不变，不为此放开。新适配器一律走 stream 分支（M2c 已执行）。
2. **M2c-2 会话型 provider 忽略 stream 入参 messages/tools** → **追认**。EventLog 只 append、logPath 为唯一事实源是压缩/裁剪/符号地图的既定架构前提，会话 provider 从日志重建对话历史正确；中立 messages 形态供无状态适配器（M2c openai/anthropic/gemini 已按此实现）。
3. **M2c-3 key 扫描判据误伤** → **判据修正成立**：扫描类硬判据自此用 `\bsk-`（词边界，消除 AskGate / ask-done 假阳性），`AIza` 与 `api[_-]?key\s*=` 模式不变。本裁决适用于后续所有含扫描判据的任务书；本轮「真实 key 0 命中」的扫描结论维持有效，不因判据缺陷翻案。
4. **M2b-1 web-tree-sitter@0.25.10 无 @types** → **追认**。最小结构类型（局部 interface + 断言）是当前正确做法，DT 出配套 types 后再迁移，不引入 any。
5. **M2b-2 / M2a-3 演示通道（M2B_MAP_DEMO、M2A_LSP_DEMO，连同同族 M0A_MOCK_DELTA / M0B_SCREENSHOT）** → **全部保留**：env 门控、缺省零行为、不进验收链，留作重跑截图/演示的入口。M2 收口任务中把演示剧本整理为带冻结 sha 的回归 fixture；在那之前不删不改。
6. **M2a-1 src/permissions 三行分类改动** → **追认为不违规**：edit_file 是写工具，权限层必须有分类，否则 read-only 档可写、方案门失效——这是任务书界限清单的遗漏而非执行越界。三处分类行 + risk.ts 评级按现状保留，界限争议就此关闭。
7. **M2a-2 M0 旧用例更新** → **追认**：规格演进（行截断 2000 先于 50KB 字节帽）驱动的测试同步，断言强度只增不减，不属放宽。
8. **M1c-2 「最长前缀」vs「deny>ask>allow 固定序」** → **按本轮实现定为规范**：同段多规则命中取最长前缀（其行为生效），同长才按 deny>ask>allow；管线层序 deny→ask 不变。验收④『git push origin main → allow』场景维持绿。
9. **M1c-3 session_kind 记忆键粒度** → **维持现状**：run_shell 按归一化命令全串、write_file 按工具级。路径前缀粒度待 M3 多工作区场景出现真实需求再议，届时只改 scopeKey() 一处。
10. **M1c-4 / M1b-3 verify 不拦于只读/审批面** → **维持**：verify 读为主，toolTableFor 含 verify 不变。M2「产出代码安全 report 模式」落地时统一重审 verify/lint 类命令的门面。
11. **M1c-5 审批卡降档提示走 console.warn** → **维持，归入后续 UI 打磨**。非阻塞；renderer 状态流改造随交互打磨里程碑另开任务，不追补到已收口轮次。
12. **M1a-2 scripts/ipc-check.ts 白名单矛盾** → **追认为不违规**：任务 6 明确要求 ipc:check 扩展为重放验收，脚本改动是任务本身，最小改动成立。界限清单遗漏就此关闭。
13. **M1a-3 / M1b-4 registry 文件后缀** → **规范修正**：含 JSX 的卡片组件一律 .tsx，任务书 `cards/registry.ts` 视为笔误。
14. **M1b-2 verify 配置来源** → **追认**：config.json verify 字段 > package.json scripts 探测；plan.verify 仅展示。需要 plan 覆盖时给 loadVerifyConfig 加入参一层即可，暂不做。
15. **M0c-1 shadcn init 不识别 electron-vite** → **采纳 manual 路线为标准**：手写 components.json（radix-nova）+ `npx shadcn add -y` 产组件，写进 AGENTS.md 约定（已写入）。给上游提 issue 选手自选，不作要求。
16. **M0c-2 反向验证口径** → **采纳机制级证明为验收口径**：strict CSP 约束 dev 内联注入路径；构建产物是同源 `<link>` 文件本就不受 style-src 约束。两类证据均已留存，验收不再要求构建产物样式失效。
17. **M0c-3 AX 窗口枚举失效** → **采纳 CDP 为标准自动化路径**（Runtime.evaluate 真实 DOM 事件 + Page.captureScreenshot）。不再追求稳定 AX 环境；macOS AX 键盘事件仅作现场授权场景的备选。
18. **M0c-4 pnpm-workspace.yaml allowBuilds 占位行** → **已过期失效**：M0b-UI 轮已拍板入库（onlyBuiltDependencies: [electron, esbuild]），现文件内容 `allowBuilds: esbuild=true` + onlyBuilt 随现状追认，门禁全绿即证。
19. **M1a 备案（pnpm-workspace.yaml / pnpm-lock.yaml 去留）** → **追认两文件入库**：前者 M0b-UI 轮已解决，后者为可复现性保留。git rm 议案作废。
20. **M1d-2 preload compact 未接线** → **已解决**：M1e 补上 `compact: () => ipcRenderer.invoke("agent:compact")` 与 renderer 入口（src/preload/index.ts:29 实测在场），本项关闭。
21. **M1d-3 压缩切点纪律 2 实现口径** → **采纳 CC/CL 先例口径为定稿**：全部 user_message 事件进固定回注名单（永不压缩、永在投影可见），tail 保持 clamp 有界，用户输入零丢失。后续若要字面口径（tail 必含最近 user 消息）需重开任务，不接受静默切换。

### 顺手清账

- **AGENTS.md「已知待清理」DARK_QUERY** → **本轮已还原为一行**（`"(prefers-color-scheme: dark)"`，行为不变；全部门禁复跑全绿，无任何判据引用该常量），AGENTS.md 对应条目删除。该串接是 M0c 判据误伤的遗产，正确判据 `^\s*color-scheme:\s*dark` 锚定行首本就不误伤，还原即是回到正轨。
- 各轮已标 ~~已解决~~ 项（M0_API_KEY 三轮、start 脚本、环境怪癖、流式截图）不重复裁决。

## M2c 轮新增待裁决（2026-09-10）

无阻塞事项。全部 7 项任务 + 反向验证红→绿 + 十四道门 + providers-check + 暗卷跳过路径完成。备案三点（非阻塞）：
1. **loop 保留 legacy {next()} 分支**（src/agent/loop.ts + streamFromNextSource）：任务书界限把 scripts/** 全列只读（仅 providers-check.ts 可写），而冻结的 gate-check.ts 向 runLoop 注入 {next()} 形态 scripted provider、autonomy/provider-check 直接 import streamGlm——故 Provider 本体已改为 stream() 统一接口，loop 以「stream 优先、next() 兼容」双形态收敛；新适配器全部走 stream 分支。若领导允许动 scripts/，可删兼容分支（loop.ts 一处 + streamFromNextSource）。
2. **会话型 provider 忽略 stream 入参 messages/tools**（glm-session.ts）：loop 无事件日志读权限（EventLog 只 append），compaction/prune/符号地图组装都在日志投影上；会话 provider 以 logPath 为唯一事实源、沿用构造时 opts.tools（gate-check 冻结契约）。中立 messages 形态留给无状态适配器（openai/anthropic/gemini 直连场景）。
3. **key 扫描判据误伤**：任务书硬指标 grep "sk-|AIza|api[_-]?key\s*=" 命中 7 行，全部为合法标识符 AskGate / ask-done（"As**k-**Gate" 被无词边界的 sk- 模式误伤）。按判卷纪律不改代码绕判据，如实备案：真实 API key 0 命中，建议判据收紧为 \bsk-。半托截图 docs/m2c-providers.png = providers-check 全绿输出（见 PROGRESS.md）。

## M2b 轮新增待裁决（2026-09-10）

无阻塞事项。全部 7 项任务 + 反向验证①②红→绿 + 十二道门 + map-check/prune-check + 半托截图（docs/m2b-map.png）完成。备案两点（非阻塞）：
1. **web-tree-sitter@0.25.10 无 @types**（DefinitelyTyped 无配套包）：parse.ts 以最小结构类型（WtsModule 局部 interface + 断言）声明用到的 API 面；tsc 全绿，无 any 泄漏到图/渲染层。
2. **M2B_MAP_DEMO 演示通道**（沿 M2A_LSP_DEMO 同族备案）：env 门控（缺省零行为）留在 src/main/agent-runner.ts（+M2B_MAP_WORKSPACE 覆盖扫描工作区）；若领导认为应删，删该段即可，验收链不依赖它。截图脚本（.tmp/m2b-screenshot.mjs）用后已删。

## M2a 轮新增待裁决（2026-09-10）
1. **src/permissions 的三行分类改动**：界限原文把 src/permissions/** 列为「只读（只调用）」，但 M2a 新增 edit_file（字符串替换式写工具）必须在权限层有分类——isSideEffectTool（autonomy.ts + index.ts）不认它则 read-only 档可写、方案门失效；toolTableFor 不列它则 read-only 档工具表缺工具。已按最小改动执行（3 处分类行 + risk.ts 一条 medium 评级），全部在「src/agent/**、src/main/**、src/tools/**、src/permissions/**」的字面交集争议内，如实备案：若判违规可整体 revert 这 3 处，代价是 edit_file 退化为 read-only 档可写（建议追加到白名单而不是 revert）。
2. **M0 旧用例更新**：tests/tools.test.ts「60KB 单行→已截断」与新规格「行截断 2000 先于 50KB 字节帽」冲突（单行 60KB 经行帽输出 ~2KB，不再触发字节帽）——已按任务书规格拆成两层断言（单行触发行截断标记、多行 90KB 触发 50KB 帽），断言强度只增不减（新增行截断与字节两层各自独立验证）。属规格演进的测试同步，非放宽。
3. **M2A_LSP_DEMO 演示通道**：截图用的 env 门控通道（缺省零行为）+ 演示剧本 fixtures/lsp/demo-lsp.jsonl 留在仓库（重跑截图的入口）。若领导认为应删，删 src/main/agent-runner.ts 的 M2A_LSP_DEMO 三行 + fixtures/lsp/demo-lsp.jsonl 即可，验收链不依赖它。

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

## 2026-09-09（M1d 阈值摘要压缩）

1. **M0_API_KEY 缺失 → 暗卷无法执行（任务书任务 6 的 A 路）**。已按任务书规定路径处理：`pnpm compaction-check` 与九道门里打印「暗卷跳过（无 M0_API_KEY）」并退出 0；通道本身已实现并单测（`createGlmSummarizer` 非流式单轮，断言非空/未膨胀/最小进度），key 在场重跑即自动真跑。需要领导在配 key 的环境复跑一次确认。
2. **src/preload/** 不在 M1d 白名单（任务书冻结）**，renderer 无法调用 `window.dshAgent.compact()`（preload 的 AgentApi 不认识该字段）。已按判据处理：`src/main/ipc-protocol.ts` 声明 `AgentApi.compact?`（optional，一行激活点）、main 进程 handler 与 mock 明卷压缩通道就绪；等 preload 白名单放开后加一行 `compact: () => ipcRenderer.invoke("agent:compact")` 即可接通 UI 入口。**不属改判据，仅列清地界**。
3. **切点纪律 2 实现口径需要领导确认（非缺陷，是解释选择）**：任务书「最近一条 typed user 消息永不吞」若实现为「tail 覆盖最近 user 消息」，在 agent 形会话（用户中途一句 + 数百工具轮）会把全部后续事件拖进 tail，压缩失效。已采用 CC/CL 先例口径：**全部 user_message 事件进固定回注名单**（永不压缩、永在投影可见），纪律 2 因此平凡成立且 tail 保持 clamp 有界；用户输入零丢失。PROGRESS.md 坑二十有记录；若领导要求字面口径（tail 必须含最近 user 消息），需重开任务确认.

## M1e 轮新增待裁决（2026-09-09）

无阻塞事项。全部 7 项任务 + 反向验证红→绿 + 十一道门（十道门 + panels-check）完成。过程中发现并修复的两个实现 bug（右栏开关未写 open 映射、panels-check 曾测 out/ 旧 bundle）见 PROGRESS.md「任务结果」条目——均属代码缺陷而非判据缺陷，不触发换判据。

## M2d 轮新增待裁决（2026-09-10）

1. **src/preload/ 不在 M2d 白名单**，两处 renderer→main 通道未接线（main 侧已就绪）：① `AgentApi.deleteMemory?`（ipc-protocol 已声明 optional，main handler `agent:memory-delete` 已挂）——记忆面板删除按钮当前禁用并注明「待 preload 接线」；记忆快照经 getState 透传不受影响。② 外部引用「首次批准对话框」当前为 main 侧回调通道（memoryLayerSnapshot fail-closed 停用 + external-refs.json 落账），GUI 批准入口等 preload 白名单放开后一行接通（M1d compact 同款先例）。均不属改判据，仅列清地界。
2. **反向验证摘除的判据补强**：原 memory-check 只有「顶层 scope 合法 + metadata 混入」用例（B5），摘除顶层检查（改 metadata 兜底）不会红——因顶层在场时本来就赢。已补 B5b「无顶层只塞 metadata.scope」用例后反向验证红→绿成立（判据加严，非放宽）。
3. **BLOCKED.md 无其他阻塞**。十六道门 + memory-check 全绿后随本轮 commit 提交。
