# M0 桌面编程 Agent（agent-plan.md 的实现）

一个 Electron 桌面编程 agent。`agent-plan.md` 是唯一权威方案；本仓库当前实现到 M2（已收口）。

## 怎么跑

- 安装：`pnpm install`
- 全部门禁：`pnpm gates`（**清单即事实源**，一条命令跑齐当前 23 道门并打印逐道退出码 + 恒真式/析取式体检 + 未证项汇总；新增门只改 `scripts/gate-manifest.ts` 清单，任务书不再自报门数；`DSH_STRICT_UNVERIFIED=1` 或 `--strict-unverified` 让未证判红，CI/有凭据环境用）
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

**计划全部完成（2026-09-14 M5 收口，M0–M5 六里程碑）**：M0–M2g（内核/沙箱/会话内核/三门/压缩/prune/地图/provider/记忆/插件/MCP/sidechat/安全 report，详见 `docs/m2-acceptance.md`）→ **M3 编排内核三轮**（M3a spawn_agent 原语/read mode/agents 面板，HEAD 8fb73f4 → M3b write mode/worktree/合并控制塔/安全 gate，HEAD 3431e72 → M3c 依赖链/pipeline sequencer/卡死/崩溃恢复/≥3 worker 压力验收，详见 `docs/m3-acceptance.md`）→ **M4 商业化两轮**（M4a 定时任务全链路 §12.2：双轨存储 + 1min tick + 三闸 + 无人值守 fail-closed + 工具五件 + schedule 面板 → M4b 可安装包/BYOK key 入 safeStorage/license 离线 Ed25519/轻量更新检查/新手引导走通 §13 七组，详见 `docs/m4-acceptance.md`）→ **M5 结果信号回流策略层**（M5a 反事实靶场：routing_decision 事件 + fixtures/gym 冻结判卷 + 回放跑器 + 基线；M5b 模型路由：档位表 + 纯函数路由 + orchestrator 接入 + 可播种 bandit + verify 门控级联；M5c 编排自适应：受限纯规则 Supervisor + Best-of-N spawnRace，详见 `docs/m5-acceptance.md`）。

- 门禁：`pnpm gates` **26 道全绿 + 恒真式/析取式体检零命中 + 清单漂移校验通过**；⚠️ 未证 9 项如实标注（testdino 远程 MCP、provider:check 均需联网凭据 + 各 check 暗卷段——**未证 ≠ 通过，不宣称全绿**）；测试 59 files / 531 passed / 0 skipped；agents-check 252 断言、gym-check 19、routing-check 25、supervisor-check 32。M4 后加固轮（审查 96 条修复 + 门禁自检升级）已收口，详见 PROGRESS.md「H」段与 `outputs/*-2026-09-12.md`。
- **2026-09-13 审查修复轮**：`outputs/code-review-report-2026-09-13.md`（106 条：6 P0/20 P1/61 P2/19 P3）逐项修复收口——只读 bash 硬闸（分隔符归一 + 参数面校验）、worker 权限规则接线、agents-check D2 时序 + CANARY 哨兵 + checkFatal、replay 逐行容错、4 处 spawn env 消毒、指纹 bounded fail-closed、loose skill 信任门、单实例锁、renderer 会话归因/缓冲收束、门禁体检网（label-first/扩展名/递归）等；两道红门（test/agents-check）根因是验收侧时序缺陷（重载下确定性红，闲时偶绿），已按"等状态不等事件"修法收口。
- **已声明取舍（备案）**：renderer `webPreferences.sandbox: false`（ESM preload 需要，contextIsolation 仍开启；后续可改 CJS preload 恢复）。
- 可安装包：`pnpm dist` → `dist/*.dmg`（macOS arm64，**unsigned V1 边界**——无签名/公证，首次打开需右键→打开；`electron-builder.yml identity: null`）。
- 四份验收三态表（带证据指针）+ 三份 ponytail-audit 见 `docs/m{2,3,4,5}-acceptance.md` 与 `docs/m{3,4}-audit.md`；BLOCKED.md 各轮备案已全部裁决（见其裁决记录节）。
- **计划完成**：§14 里程碑表 M0→M5 全行收口；**M6 已收**：supervise 模式运行时接线与审批卡双轨（spawnSupervise + requestSuperviseApproval，渲染卡零改动，supervisor-check 段 E 16 断言）+ 真多 provider 白名单与价格表接线（PROVIDER_IDS 四家 + toWorkerModel 按 provider 路由 + pricing 真钱代价接进 bandit，routing-check 段 F）；M6+ 候选（bandit 运行时接线、supervise 环合并语义扩展、档位模型/价格联网实测校准、hourly/monthly kind、worker 热恢复、license 服务端、签名公证、遥测上报）均留位未偷做（见 m5-acceptance「未证/留位」节与 m5-proposal §1.4）。