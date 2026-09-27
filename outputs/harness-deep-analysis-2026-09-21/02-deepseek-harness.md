# 02 · deepseek-ai/deepseek-harness 源码级深挖

> **抓取对象**：`/tmp/dsh-deep/deepseek-harness-master`（master 分支，tip `ddefc45f`，2026-09-21 抓取）
> **方法**：只读源码 + 官方 docs/subsystems + 包 README 交叉验证；显式区分〔代码证实〕与〔仅文档〕；快照不含 `.git`。
> **元信息**：`@deepseek-ai/dsh` v0.1.6-alpha.2，MIT，Node `^22.19.0 || >=24.0.0`，pnpm `11.7.0`，self-describe "Everything is a Plugin"，引 arXiv:2608.25512（`README.md:7-9`）。

## 0. 一句话结论

**DSH 不是"又一个 coding CLI"，而是把 agent harness 拆成 60+ 个可热插拔的 Cordis 插件**：模型适配器、工具注册表、会话日志、连 agent loop 本身都是插件；运行时 = profile（命名组合）+ bundle（分发单元）+ 有序 patch 文件叠加出来的插件树（`docs/architecture.md:9-33`）。

## A. 定位与形态

- 定位：开源 agent harness（不止 coding），入口 `npx @deepseek-ai/dsh web`，Web UI 默认 `127.0.0.1:3080`（`README.md:22-26`）。
- 形态：pnpm monorepo —— `apps/`(cli, desktop, desktop-host, web) + `packages/`(60+ 包) + `python/`(SDK) + `vendor/`(内嵌 cordis 框架) + `benchmarks/` + `snapshots/`。
- 发行物：npm `@deepseek-ai/dsh`（bin `dsh` → `apps/cli`）、按平台 Python SDK wheel（内嵌 dsh CLI）、Electron 桌面包、vendor 独立发布（`release-vendor.yml`）。
- 文档密度异常高：`docs/` 60+ 主题 ×三语（`*.md` + `*.zh.md` + `*.i18n.yaml` 机器可校验配对），含 2490 行 `tool-catalog.md`、623 行 `capability-seams.md`，配整套校验脚本（`scripts/verify-doc-budgets.ts`、`verify-translation-pairing.ts`）保证文档与代码同步——文档即门禁。

## B. 技术栈与工具链

| 项 | 事实 | 证据 |
|---|---|---|
| 构建 | host/client 双面：`tsc -b tsconfig.host.json` + tsdown（`--env.DSH_BUILD_FACE host\|client`） | 根 `package.json` scripts |
| Lint | oxlint（`scripts/run-oxlint.ts`） | 同上 |
| 测试 | vitest；`scripts/*.spec.ts` 连门禁脚本自身都有单测 | scripts/ 目录 183+ spec |
| CI | 20 个 workflow：`ci.yml`、`e2e.yml`、`sandbox.yml`、`pi-ai-provider-e2e.yml`(真连 provider)、`node-addon-system{,-release}.yml`、`build-exe-for-python-sdk.yml`、`python-release.yml`、`release{,-publish,-vendor}.yml`、`docs-pages.yml`、`issue-lifecycle/policy.yml`、`weighted-approval{,-review-event}.yml`、`expected-filenames.yml` 等 | `.github/workflows/` |
| 架构即代码 | `verify-application-entrypoints.ts`（禁止绕过 dsh profile 的启动路径）、`verify-no-bare-dispatcher.ts`、`verify-runtime-closure.ts`、`verify-package-invariants.ts` 等 ~40 个 verify 脚本 | scripts/ |
| 桌面 | Electron + electron-builder（`package:desktop:mac:arm64` 等） | 根 package.json |
| Python | py 27 文件 10,875 行（SDK + sdk-runtime + smoke），`build-python-release.py` | python/ |

**规模读数**（排除 .git/node_modules/dist）：TS 3904 文件 **839,822 行**、TSX 425 文件 106,783 行、CSS 164 文件 24,620 行 —— 约 **98 万行 TS**。

## C. 仓库结构与包地图

`packages/` 分组（`AGENTS.md:20-60`）：
- **core/**：`session`（append-only SessionEvent log）、`system-prompt`、`tools`（scoped registry + guarded pipeline）、`agent`、`agent-loop`（默认驱动）、`scope`（per-agent scoped-registration 原语）、`agent-default-model`、`agent-tool-presentation`。
- **执行面**：`shell`、`subprocess`、`ssh`、`terminal`（持久终端）、`ptc-runtime`（模型写程序、host 函数变普通 async 调用）、`sandbox/`(4 包)、`fs`、`lsp`。
- **模型面**：`llm/llm`（中立服务）、`llm-deepseek`、`llm-pi-ai`、`llm-retry`、`token-meter`、`deepseek-llm-api-extensions`。
- **能力工具**：`web`、`computer-use`、`browser-use`(Stagehand native)、`todo`、`plan`、`goal`、`schedule`、`skill`、`spill`、`attachment`、`document`、`deliverables`。
- **编排**：`subagent/`(多包)、`jobs`、`workflow`、`guard`（repeat-tool-reminder + timeout-policy）、`preset`。
- **平台**：`boot/`（app-boot、plugin-manager）、`bundle/`（base、web-app、headless、sdk-app、acp-app、sdk-minimal）、`web`、`acp`、`api`(remote BFF)、`webhook`、`settings`、`credentials`、`identity`、`storage`、`workspace`、`session/`(持久化族)、`session-query`、`compaction/`(5 包)、`hooks/`(3 包)、`extensions`、`feedback`、`sdk`、`context`、`typert`、`runtime-diagnostics`。
- **vendor/**：cordis、cosmokit、schemastery、hmr、loader、logger-console、timer —— 框架本体是内嵌源码。

## D. 入口链路〔代码证实〕

`apps/cli/src/bin.ts` → `args.ts`（解析 `--profile <name>` / 子命令）→ `profile-boot.ts`（按 profile 组装 Cordis 树）→ `dump-config.ts`（`dsh --profile web --dump-config` 打印整棵配置行树，每行皆可被 patch 替换，`docs/architecture.md:31-33`）→ `plugin.ts`（插件管理命令）。**任何 package bin/可执行源/根 demo 都被 `verify-application-entrypoints.ts` 归类管控，绕过 `dsh` 启动 Node 应用是违规**（`docs/architecture.md:47-51`）。

## E. 插件模型（本仓最大看点）

三层概念（`docs/architecture.md:9-33`）：
1. **插件**：向共享 context 贡献服务、类型化事件、可回滚效果（registration 是 effect，插件卸载自动 unwind）。没有特权内核——模型适配器、工具注册表、会话日志、agent loop 全是普通插件。
2. **profile**：命名组合，存于 Harness home；列出叠加的 bundle、树外插件、用户 `cordis.patch.yml`。内置模板 `web`/`headless`/`sdk`/`sdk-minimal`/`acp`。
3. **bundle**：Cordis 配置行 + 所挂代码的分发格式；`package.json` 里 `dsh.profile`（列 bundles）与 `dsh.bundle`（指向 patch 文件）声明。

**叠加顺序**：空 entry 列表 → 按序各 bundle → profile 级 `cordis.patch.yml` → home 级 → `--patch` 覆盖；patch 按 id 定位一行配置整体替换或插入。HMR 由 YAML 控制（base 开 `dsh-hmr`，headless/sdk/acp 关，`sdk-minimal` 不含）。

## F. Agent 主循环（`packages/core/agent-loop/`）

- 文件面〔代码证实〕：`agent.ts`、`assistant-stream.ts`、`inbox.ts`、`tool-calls.ts`、`runtime-context.ts`、`invariant.ts`、`constants.ts`。
- 每 step：发送派生历史（最新非空 `system/message` 为有效 prompt）+ 可见工具 schema → 流式返回 → 工具走守卫管线 → **每个被接受的事实先追加进 session log，下一步从 log 派生**（agent-loop README "What a step does"）。
- 并发：`maxParallelToolCalls` 默认 **10**，parallel-safe 可重叠；exclusive 调用作为排序屏障独跑。
- 取消：协作式；已流式送达用户的文本保留落定；除非 `keepInbox`，pending 清空。
- 收件箱：每次 mutation 提交一条规范化 `agent/inbox/spliced` 事件，投影同步折叠——`Session.append()` 返回时活投影已更新。
- 声明式 agent：配置 `agents[]` 插件加载即启动（id/provider/model/reasoningEffort/maxTokens/cwd/sessionId/resumeSessionId）；`ctx.agents.create()/resume()` 程序化创建返回 `AgentHandle`。
- 启动顺序：先串行 await 全部 `agent/created` 初始化再开始排队工作，初始化失败回滚创建。

## G. 工具系统：30+ 工具包 + 守卫管线

**工具包清单**（`docs/tool-catalog.md` 章节，30 个）：`tool-ask-user`、`tools`、`tool-bash`、`tool-pwsh`、`tool-bash-persistent`、`tool-pwsh-persistent`、`tool-str-replace-editor`、`tool-fs`、`tool-fs-search`、`tool-terminal`、`tool-present`、`tool-cordis`(自省 Cordis 树)、`tool-goal`、`tool-lsp`、`tool-ralph`、`tool-skill`、`tool-session-query`、`tool-subagent`、`tool-subagent-control`、`tool-jobs`、`tool-todo`、`tool-workflow`、`tool-web`、`plan-mode`、`schedule`，外加深水区 `plugin-manager`、`mcp-resources`、`experimental-browser-use-stagehand-native`、`experimental-tool-agent-team`。

**执行管线**（`docs/tool-execution-pipeline.md` 生成图 + 文字）：

```text
模型 tool-call 块 → tool/call 事件（先落日志）→ UI pending 卡
→ tools/pre-execute 瀑布（hooks、permission、sandbox；allow/deny/ask）
→ [ask → ctx.approval 一次性询问；缺席或不可答 = deny]
→ 单调 guard（deny/abstain；身份保护）
→ tools/execute 瀑布（timeout、retry、metrics 的 around 分发）
→ 工具体 → fs/write-intent·fs/edit-intent（仅 tool-fs 突变）
→ 工具自有事件（todo/write、fs/observed、hook/invoked、tool/ptc-dispatch）
→ tools/post-execute 瀑布（accept/block/replace/add-context）
→ 注册表快照归一化（异常 → isError）→ ToolDefinition.finalizeContent
→ tools/result（冻结权威结果）→ tool/result 会话事件 → UI 完成卡
→ 批结算 → additionalContexts FIFO 以 user/message 注入
```

要点：`tool/call` 在执行**之前**记账；三层瀑布都可变换调用；PTC 的 `run_code` 与其序列化子调用同走管线（子调用带父 token、去 additionalContexts 保 call/result 相邻）。

## H. 权限与沙箱（`packages/sandbox/`）

- 三档文件效果策略：`read-only` / `workspace-write` / `danger-full-access`；共享策略解析器 `sandbox-policy`（部署默认 + per-session 覆盖）。
- 平台后端 `sandbox-local`：**Linux bwrap 优先、Landlock 兜底；macOS Seatbelt；Windows 受限 token（sandbox-windows-acl，写限 workspace + 私有 temp）**；被拒调用可经用户一次性批准升级重试；fail-closed。
- 明确边界："same-world only"——共享宿主内核/文件系统，容器/microVM/远程执行器是替换整层能力而非注册进此 seam（`sandbox/README.md`）。
- `SAFETY.md:5-27` 明说未做安全审计、不可当唯一安全控制。

## I. 模型适配层（`packages/llm/`）

- **`dsh-llm`**：provider 中立服务（`ctx.llm`），唯一进 provider 的合法路径；请求 dispatch 前 **deep-freeze**（扩展只读不可改写）；每条流 = 一次 provider 尝试；流必以终态结束（成功/失败/取消统一）；**每次 dispatch 都可从 session log 重建**。
- **`dsh-llm-deepseek`**：`deepseek-official` 路由，默认 Messages 协议、可选 Chat Completions；凭据/端点/图像/模型目录共享；Web 上是可编辑 base+key 的单一 DeepSeek provider。
- **`dsh-llm-pi-ai`**：基于 **pi-ai** 目录的多 provider 适配器 + 手写声明 gateway（零代码新路由）；OAuth/交互式 key 登录 + 跨进程刷新锁；与 deepseek 适配器可并存（路由名不冲突，撞名即插件加载失败）。
- **`dsh-llm-retry`**（默认 5 次重试）、**`token-meter`**（compaction 触发依据）、**`deepseek-llm-api-extensions`**（官方 API 顶层字段的插件贡献注册表：声明合并 + 校验，base 序列化后注入）。

## J. 会话持久化（`packages/session/`）

- 核心：**append-only `SessionEvent` log**；事件分三域——持久事实走 session log（`session/event`），进行中观察走 `agent/*`，能力挂接走 `fs/*`、`tools/*`、`telemetry/*`（`docs/architecture.md:71-77`）。
- 后端：`session-persistence-jsonl`——每 Session 不可变 canonical generation 文件名 + 独占 successor 发布，可选 **Zstandard 压缩**。
- **格式迁移链**：`session-format-v0-to-v1`、`v1-to-v2` 冻结解码器；"只新增后继版本，绝不移动/覆盖/删除已提交 generation；前代不 imply 回退支持"（AGENTS.md:9-12）；SQLite 单调 `SCHEMA_VERSION`。
- checkpoint：`session-checkpoint-policy` 保证模型请求、顶层工具副作用、完成 step 在下一动作前落盘。
- 投影：`session-projection`（事件折叠成当前值）+ `session-projection-cache`（冷读免全量加载）；`session-query` 浏览/搜索/导出（含工具形态）；`session-log-deepseek` 把增量日志作为官方请求元数据 `dsh_session_log` 上传。
- compaction 族：`compaction-basic`（token 压力自动摘要）+ `/compact` 命令 + `tool-result-pruner`（先剪超大工具输出）+ `image-offload`（超预算图片换占位符）。

## K. 扩展机制

- **MCP**：`mcp/` + `mcp-resources`；CLI 有 memory-mcp-configs 测试。
- **插件管理**：`boot/plugin-manager`（Web 与 agent 可用），CLI `dsh plugin`；creator mode 持久安装；`extensions/` 提供 agent 运行时 API 自省。
- **hooks 桥**（独特）：`hooks-claude-code` / `hooks-codex` 直接吃现有 Claude Code / Codex 的 `hooks.json`，在会话开始/prompt 到达/工具运行/运行停止时执行命令钩子，可阻断并回给模型可见消息（`packages/hooks/README.md`）。
- **skills**：`skill-filesystem`（项目/自定义/用户目录发现）+ `tool-skill`（排序持久会话目录 + `skill` 工具 + `/name` 直调）+ `skill-office`（Word/PPT/Excel）。
- **PTC**：模型写程序调 host 函数；TS 后端 = 沙箱策略下的新 Node 进程，实验 Python 后端；每次运行无先前状态。
- **对外 SDK**：TS SDK（解析同版本 dsh 依赖、选 `sdk` profile）+ Python SDK（wheel 内嵌 CLI `deepseek-harness-sdk-runtime-<platform>-<arch>`，JSON-RPC 服务器）；`sdk-minimal` 是自带完整显式 SDK 树、不叠 `dsh-base` 的独立 bundle。

## L. 多智能体与编排

- `ctx.subagents` 委派服务：**in-process 新生子代理 / 历史播种 fork 子代理 / 进程外子代理（ACP、Codex、Claude Code、另一 harness runtime）**；父可见全部子代理状态；工具可向相邻 agent 发消息、打断、列状态（`subagent/README.md`）。
- `workflow`：模型自写编排脚本 fan-out 子代理并返回终值，跑在共享 PTC Node 进程、会话文件策略之下；`ralph` 工具 = 固定序列的新 agent。
- `agent-team`（实验）+ `jobs`（后台任务）+ `schedule`（定时跟进）+ `goal`（每会话一个持久目标，跨重启/续跑/fork；Rounds 自动续跑需另开）。

## M. UI 与协议

- **Web**：`apps/web`（Vite，`@deepseek-ai/dsh-web-frontend`），RPC 与流由 Web 层持有；有 `stress-tests/`。
- **Desktop**：Electron 壳 → 私有 Desktop Host（Electron Node 模式）→ 调共享 CLI profile runner + 完整 Web 应用；窗口加载打包 Web 资产、等 boot 注入后激活 client 插件；Node IPC 载 boot 注入/就绪/致命错误/关停；默认端口 19387；签名资源携带生产 runtime；保留 `$DSH_HOME/profiles/desktop`，公共 CLI 不得管理该 profile（`docs/architecture.md:53-63`）。
- **协议**：SDK JSON-RPC server（`dsh-sdk-app`）、自动化 ACP server（`dsh-acp-app`）、webhook 入口（鉴权投递 + Workspace Session 创建）、`api/` remote BFF。SSH 启动只打印 URL（本地转发地址归 SSH 客户端所有）。

## N. 测试、质量与发布

- 测试金字塔：单测 + `scripts/*.spec.ts`（连脚本自身 183 个 spec）+ e2e（`apps/cli/tests/web-auth.e2e.ts`、`built-bin.e2e.ts`、`desktop-host.e2e.ts`）+ snapshot 语料（`snapshots/{acp,sdk,session,web}` + corpus 策略脚本）+ coverage 分区（`run-coverage-partitions.ts`）。
- 基准目录：`benchmarks/{session-open, conversation-fold, active-stream-reconnect, agent-continuation, long-session-browser, terminal-io}`——针对真实痛点（长会话开箱、折叠、断流重连）。BENCHMARK.md 仅 3 行：Python SDK + `jsonrpc-agent` 最小变体、独立 workspace/session id。
- 发布：npm 包、Python 三平台 wheel、desktop 各平台、vendor 单独发版；`expected-filenames.yml` 守发布物文件名清单。

## O. 亮点（带证据）

1. **真插件化内核**——连 agent loop 都可替换；`--dump-config` 让用户看到并 patch 自己机器启动的整棵树。
2. **显式多级工具瀑布**：钩子/权限/沙箱/审计在不变 loop 的前提下跨工具族工作；`tool/call` 先记账、结果冻结后广播。
3. **持久化纪律严苛**：append-only 日志 + 邻接迁移链 + "绝不改写已提交 generation" 写进 AGENTS.md 硬规则。
4. **兼容性吞并**：hooks 桥兼容 Claude Code / Codex 现有 hooks.json；子代理可直接委派给 Codex / Claude Code 进程——把竞品生态变成自己的能力面。
5. **文档即门禁**：三语配对、doc budget、生成的 config/tool catalog、~40 个 verify 脚本把架构约束变成 CI。
6. **LLM 服务面**：请求 deep-freeze、dispatch 可从日志重建、适配器可并存、provider 扩展字段走注册表——可审计性与可扩展性同时要。

## P. 弱点/风险

1. developer preview 自认不稳："THERE WILL BE COMPATIBILITY-BREAKING CHANGES"（README.md:14）。
2. 沙箱同世界，无容器/microVM；官方自认非唯一安全控制。
3. 复杂度税：60+ 包 × profile × bundle × patch 组合面，理解成本极高。
4. vendor 内嵌自有框架（cordis），第三方深度贡献门槛高、生态绑定。
5. `pi-ai` 适配器把模型路由/目录外包给外部目录的维护方。
6. alpha 版本号 + 无安全审计 + 高热度（抓取日 23.2 万 star）之间的落差需用户自查。

## Q. 事实清单

1. 包名 `@deepseek-ai/dsh`，bin `dsh`，版本 0.1.6-alpha.2（`apps/cli/package.json`）。
2. 引擎 `^22.19.0 || >=24.0.0`，pnpm 11.7.0（根 package.json）。
3. agent-loop 默认 `maxParallelToolCalls: 10`（agent-loop README 配置表）。
4. Web 默认端口 3080，Desktop 默认 19387（README.md:26、architecture.md:63）。
5. 内置 5 个 profile：web/headless/sdk/sdk-minimal/acp。
6. 会话格式迁移链 v0→v1→v2，解码器逐个独立成包。
7. JSONL 会话后端支持 Zstandard 压缩。
8. 沙箱 Linux 双后端 bwrap→Landlock。
9. Windows 用原生 ACL 受限 token 而非 AppContainer。
10. 工具 catalog 文档 2490 行、30 个工具包章节。
11. guard 族默认两守卫：重复工具提醒 + 工具超时策略。
12. compaction 默认在 dsh-base 启用。
13. hooks 桥支持 Claude Code 与 Codex 的 hooks.json。
14. CI 20 个 workflow，含真连 provider 的 `pi-ai-provider-e2e.yml`。
15. Python SDK wheel 名 `deepseek-harness-sdk-runtime-<platform>-<arch>`。
16. benchmarks/ 六个真实负载场景基准。
17. 文档站 deepseek-harness.github.io，`docs-pages.yml` 发布。

〔未证〕：各包内部实现的行级细节（agent-loop 状态机逐行、bwrap 参数集）、测试总数精确值、Web RPC 具体消息 schema——超出本轮抓取深度，需定点复核。
