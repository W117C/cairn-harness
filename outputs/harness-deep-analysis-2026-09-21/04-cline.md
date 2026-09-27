# 04 · cline/cline 源码级深挖

> 抓取：`/tmp/dsh-deep/cline-main`（main，tip `4a56a43f`，2026-09-21）。Apache-2.0；bun 1.3.13；根包 `@cline/packages`（private）。

## 0. 一句话结论

**Cline 已完成「IDE 插件 → SDK 引擎」的重组**：同一引擎（`sdk/packages/core`）同时供 VS Code 扩展、CLI（`npm i -g cline`）、桌面端、cline-hub 四个宿主使用；扩展与内核之间是 proto/gRPC（`apps/vscode/proto/{cline,host}` + `descriptor_set.pb`）。

## A. 定位与形态

README："The open source coding agent in your IDE, terminal, & desktop"——三形态：CLI（交互 + headless for CI/CD）、IDE 扩展、桌面。工作区：`sdk/packages/*`（core/sdk/llms/agents/ui/shared）、`apps/{cli,cline-hub,examples,vscode,vscode-rollout}`、`evals/`。LOC：TS 2400 文件 768,281 行 + TSX 712 文件 182,738 行 + Rust 5 文件 2,759 行 + Python 15 文件 1,848 行（native/PTY 相关），共约 95 万行 TS。

## B. 工具链与 CI

- biome（biome.json/biome.jsonc）、bun --parallel 分包测试（根 package.json `test` 脚本对 4 组 filter 并行）、vitest 多配置（cli 有 interactive/tuistory e2e 配置）、playwright（扩展端 e2e）、knip、buf（proto 管理与 descriptor_set 生成）。
- CI 17 个 workflow：发布线 `cli-publish.yml`、`desktop-publish.yml`、`ext-vscode-publish-{stable,nightly,legacy}.yml`、`sdk-publish.yml`、`ui-publish.yml`；测试线 `ext-vscode-test{-e2e}.yml`、`ext-jb-test-integration.yml`（JetBrains！）、`desktop-test.yml`、`sdk-test.yml`；治理线 `repo-{delete-agent-promo-comments,strip-agent-badges,label-issues,stale-issues}.yml`（显式清理 AI 生成内容的自动化）。
- `skills-lock.json` 出现在 apps/cli 与 apps/vscode——技能以锁文件形式固定。

## C. SDK 内核（`sdk/packages/core/src/`）

顶层：`ClineCore.ts`（内核门面）+ `account/auth`（账号与认证）、`hub`、`remote/remote-config`、`cron`（定时任务）、`hooks`（含 hook-file-hooks 测试）、`extensions`（含 `config/user-instruction-config-loader.ts`——用户指令文件发现链，即 .clinerules 类机制的现位置）、`runtime`、`tasks`（agenda-task-api/manager）、`session`、`settings`、`services`、`logging`。

**runtime/**：`agent-runtime.ts`、`turn-queue/`（回合队列）、`orchestration/`、`safety/`、`capabilities/`、`process-start-token.ts`、`tools/`（`tool-approval.ts`、`subprocess-sandbox.ts` + lifecycle——**子进程沙箱内建在 SDK**）。

**session/**：`checkpoint-diff.ts`、`checkpoint-restore.ts`（检查点 = diff 计算 + 恢复）、`session-snapshot.ts`、`session-versioning-service.ts`（会话版本化）、`history-origin.ts`、`persisted-tool-result-content.ts`、`search/`、`stores/`、`team/`（团队会话）、`models/`。

**llms/**（`@cline/llms`）：基于 **Vercel AI SDK**（`ai-sdk.ts` 系列 + tool-calls/retry-empty-response 测试）、`gateway.ts`（Cline 网关计费：billing.ts + cline-client-headers.ts）、`providers.ts`/`providers.browser.ts`（双环境 provider 注册）、`factory-registry.ts`、`error-classification.ts`、`transcription.ts`（语音转写）、`catalog/`、`builtins.ts` + `builtins-runtime.ts`（内建 provider：local-cli、gateway 等）。

**agents/**：多代理/编排（`orchestration/`、`tools/`、`host/`、`safety/`）。

## D. 工具面

从 core 源码 `name:` 注册提取的真实工具（已剔除测试假名）：`bash`、`exec`/`execute_command`、`edit`、`apply_patch`、`fs`、`fetch_web_content`、`ask_question`、`goal`、`memory_tool`、`image_generation`、`commit`、`docs`，加 MCP 工具（`mcp__*` 命名空间动态注册）与用户自定义工具。审批：`runtime/tools/tool-approval.ts` + allowed/blocked 工具名单语义（allowed_tool/blocked_tool 出现在配置面）。沙箱：`subprocess-sandbox.ts`（子进程沙箱 + 生命周期管理）。

## E. 宿主接线

- **VS Code**：`apps/vscode`（esbuild 打包、webview UI、buf 管理 proto；proto 分 `cline`（内核服务）与 `host`（宿主服务）两组、`descriptor_set.pb` 预生成）；`standalone/`（脱离 VS Code 运行内核的宿主实现）；`testing-platform/`。
- **CLI**：`apps/cli`（bin、bun.mts、tuistory 交互 e2e、skills-lock）。
- **cline-hub**：桌面/控制台形态（含自己的 webview）。
- **vscode-rollout**：发布灰度/rollout 工具仓。

## F. 会话、权限与商业化

- 会话持久化以 session/stores + versioning-service 为中心；checkpoint 走 diff/restore（对工作区做文件级快照恢复）。
- 账号/计费：`account/` + llms/gateway + billing——Cline 自有 provider 网关（点数/订阅）与 BYOK 并存。
- remote/remote-config：远端配置下发（feature flag 类）。

## G. 亮点

1. **SDK 化最彻底**：引擎即库（`import { Agent } from "@cline/sdk"`），四宿主共用一内核，职责分离干净。
2. proto/gRPC 宿主边界 + buf 管理 + 预生成 descriptor：扩展与内核跨进程协作的工程化样板。
3. checkpoint 体系（diff/restore + versioning）与会话版本化服务独立成模块。
4. 子进程沙箱与工具审批在 SDK 层（而非宿主层）实现，嵌入方自动获得。
5. 治理自动化（strip-agent-badges 等 CI）说明其仓库自身就在用 agent 大规模开发。
6. 评测独立成 `evals/` 顶层目录。

## H. 弱点/风险

1. TSX 18 万行的 webview UI + 四宿主多目标，回归面大（CI 也要跑 JetBrains 集成）。
2. AI SDK 抽象层重：provider 行为差异被中间层吞掉，排查协议级问题成本高（middleware/compat/factory-registry 多层）。
3. 商业网关与开源内核耦合点（client-headers、billing）需持续维护中立性。
4. 工具 schema 分散在多包（core/runtime、extensions、shared），一致性靠约定〔未证有统一校验〕。
5. bun 工作区较新，生态兼容（patches/ 目录存在）仍有摩擦。

## I. 事实清单

1. bun 1.3.13 锁定；根包 private `@cline/packages`。
2. CLI 发布为 npm `cline`；SDK 独立发布线 sdk-publish.yml。
3. 扩展 gRPC proto 两组：cline + host，descriptor_set.pb 预生成。
4. 内核门面 ClineCore.ts；turn-queue 管回合。
5. session/checkpoint-{diff,restore}.ts 是检查点实现位置。
6. llms 层基于 Vercel AI SDK（ai-sdk.ts）。
7. gateway.ts + billing.ts = 自有商业 provider 网关。
8. subprocess-sandbox.ts 在 SDK 内核而非宿主。
9. JetBrains 有独立集成测试 workflow（ext-jb-test-integration.yml）。
10. cron 包 = 定时任务能力进内核。
11. user-instruction-config-loader.ts 管用户指令文件发现。
12. 17 个 CI workflow，含 4 条独立发布线。
13. transcription.ts 表明语音输入通道在 llms 层。
14. team/ 目录 = 团队/共享会话能力。
15. evals/ 顶层评测目录 + apps/examples 内嵌示例宿主。

〔未证〕：provider 全集清单（providers/ 未逐个列出）、webview 状态管理细节、checkpoint 存储路径格式、工具 schema 统一校验机制。
