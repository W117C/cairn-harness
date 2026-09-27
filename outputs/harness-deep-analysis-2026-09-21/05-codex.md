# 05 · openai/codex 源码级深挖

> 抓取：`/tmp/dsh-deep/codex-main`（main，tip `f585f13a`，2026-09-21）。只读；〔未证〕处已标注。根 package name `codex-monorepo`，Cargo workspace 版本字段为占位 `0.0.0`（发布时注入）。

## 0. 一句话结论

**Codex 是一个 114-crate 的 Rust 单体工作区**：核心 agent 循环在 `codex-rs/core`，外挂 TUI（ratatui，991 个 .rs 文件）、`exec` 无头 CLI、`app-server`（IDE/桌面共用协议）、云任务、多代理 v2、插件与技能体系，外加独立的安全二进制（linux-sandbox / windows-sandbox-service）。

## A. 定位与形态

- README：本地运行的 coding agent；三形态——CLI（`curl chatgpt.com/codex/install.sh | sh` 或 `npm i -g @openai/codex`、Homebrew cask）、IDE 扩展（VS Code/Cursor/Windsurf，走 developers.openai.com/codex/ide）、桌面 `codex app`；云端形态为 Codex Web（chatgpt.com/codex）（README.md:1-40）。
- 安装器从 `releases.openai.com/codex` 下载、GitHub Releases 兜底（env 开关 `CODEX_INSTALLER_USE_RELEASES_OPENAI_COM`）。
- 顶层布局：`codex-rs/`（Rust 工作区，114 crates）、`codex-cli/`、`sdk/`（TS SDK，3.1 万行）、`scripts/`、Bazel（`MODULE.bazel`+`BUILD.bazel`）与 cargo 双轨、`justfile`、`flake.nix`、Python 运行时（ruff.toml + python-sdk）。
- LOC 读数：Rust 4697 文件 **1,870,737 行**（含测试与生成物）、Python 198 文件 63,753 行、TS 750 文件 11,373 行。

## B. 技术栈与工具链

- Rust 工具链锁定 `codex-rs/rust-toolchain.toml`；`deny.toml`（cargo-deny 依赖策略）、`clippy.toml`、`rustfmt.toml`。
- CI 30+ workflow：`rust-ci{,-full,-full-nextest-platform}.yml`、`bazel.yml`、`blocking-ci.yml`、`postmerge-ci.yml`、`cargo-deny.yml`、`python-sdk{,-cli}-release.yml`、`rusty-v8-release.yml`、`r2-release.yml`、`rust-release{,-windows,-zsh,-provisioned-macos}.yml` 等（.github/workflows/）。
- V8：`rusty-v8-release.yml` + `codex-rs/v8-poc` + `code-mode-runtime`——**code-mode**（与 DSH 的 PTC 同思路：模型写代码调工具）已工程化：`code-mode`、`code-mode-host`、`code-mode-protocol`、`code-mode-runtime` 四个 crate。
- 测试：cargo test + nextest（`rust-ci-full-nextest-platform.yml`），大量 `*_tests.rs` 同文件内联。

## C. Rust 工作区结构（114 crates，分组概述）

- **内核**：`core`（agent 循环 + 工具 + 沙箱挂接 + compaction + unified_exec）、`protocol`、`core-api`、`core-plugins`、`state`、`thread-store`、`thread-manager-sample`、`rollout`（会话日志）、`context-fragments`、`agent-graph-store`、`agent-identity`、`agent-roles`。
- **模型接入**：`model-provider-info`、`models-manager`、`codex-api`、`codex-backend-openapi-models`、`backend-client`、`responses-api-proxy`、`chatgpt`（ChatGPT 登录后端）、`aws-auth`、`ollama`、`realtime-webrtc`、`voice-host`、`websocket-client`。
- **安全/隔离**：`sandboxing`（Seatbelt `.sbpl` 策略文件 + Landlock）、`linux-sandbox`（独立二进制，landlock.rs + suite 测试）、`windows-sandbox-rs`、`windows-sandbox-service`、`mxc-sandbox`、`network-proxy`、`execpolicy`（命令解析 + 规则 + 沙箱迁移）、`process-hardening`、`secrets`、`workload-identity`、`user-verification`、`bwrap`。
- **执行**：`exec`（无头 CLI：human 输出与 JSONL 事件两种 event_processor）、`exec-server{,-protocol}`、`shell-command`、`shell-escalation`、`apply-patch`、`worktree`、`stdio-to-uds`、`uds`、`tcp-tunnel`。
- **交互**：`tui`（991 文件，ratatui + ratatui-macros）、`app-server{,-client,-daemon,-protocol,-transport}`（IDE/桌面协议族）、`ansi-escape`、`terminal-detection`、`elicitation`（`core/src/elicitation.rs`）。
- **扩展**：`codex-mcp`、`rmcp-client`、`plugin`、`skills`、`connectors`、`external-agent-migration`。
- **云与协作**：`cloud-tasks{,-client,-mock-client}`、`cloud-config`、`collaboration-mode-templates`、`multi-agent`（core 内）。
- **支撑**：`config{,-schema}`、`codex-home`、`otel{,-trace-websocket}`、`analytics`、`diagnostics`、`arg0`（多调用二进制分发）、`build-info`、`test-binary-support`、`vendor`。

## D. 入口链路〔代码证实〕

- 交互式：`codex-rs/cli`（arg0 分发）→ `tui` → `core` 会话线程（`core/src/codex_thread.rs`、`codex_delegate.rs`）。
- 无头：`codex-rs/exec/src/main.rs` → `cli.rs` → `event_processor_with_human_output.rs`（人读）或 `event_processor_with_jsonl_output.rs`（`--json` 机器读）。
- IDE/桌面：`app-server`（JSON-RPC over stdio/uds，`app-server-protocol` 定义 schema）。

## E. Agent 主循环与工具面（`codex-rs/core/src/tools/`）

- **工具 handler 全集**（core/src/tools/handlers/）：`apply_patch`（+spec）、`shell`（+spec）、`unified_exec`（PTY 会话复用的统一执行工具，runtimes/zsh_fork 子进程分叉）、`view_image`、`plan`、`current_time`、`sleep`、`wait_for_environment`、`mcp` + `mcp_resource`、`tool_search`（动态工具发现）、`dynamic`、`extension_tools`、`get_context_remaining`、`new_context_window`、`multi_agents`(+v2)、`request_permissions`、`request_user_input`(+async)、`send_message_to_user_async`、`request_plugin_install`、`list_available_plugins_to_install`、`permission_preapproval`。router/registry/orchestrator/parallel/sandboxing/approvals/network_approval 均为独立模块（tools/ 目录）。
- **多代理**：`tools/handlers/multi_agents{,_v2}/` + `core/src/agent_communication.rs`、`agent_message_board.rs`——agent 间消息板与编排（v2 为新一代）。
- **compaction**：core/src/compact*.rs 六个文件——本地压缩 + `compact_remote_v2`（远端历史压缩，含 image budget 控制），`compact_token_budget.rs` 管 token 预算。
- **上下文工程**：`agents_md.rs` + `agents_md_manager.rs`（AGENTS.md 发现/合并）、`context/`、`context_manager/`、`turn_diff_tracker.rs`、`turn_metadata.rs`、`environment_selection.rs`。

## F. 权限、审批与沙箱〔代码证实〕

- 审批模板：`mcp_tool_approval_templates.rs`、`tools/approvals.rs`、`network_approval.rs`（网络访问单独审批面）、`request_permissions.rs`。
- **macOS**：`codex-rs/sandboxing/src/seatbelt*.rs` + 三个内嵌 `.sbpl` 策略文件（`seatbelt_network_policy.sbpl`、`seatbelt_read_only_platform_defaults.sbpl`、`seatbelt_preferences_policy.sbpl`）+ `seatbelt_daemon.rs`（守护进程化签发）。
- **Linux**：`linux-sandbox` 独立二进制（setuid/助手模式）+ `landlock.rs`；`bwrap` crate 提供容器后端；`mxc-sandbox` 备选。
- **Windows**：`windows-sandbox-rs` + `windows-sandbox-service`（服务进程隔离）+ core 内 `windows_sandbox.rs`、`windows_sandbox_read_grants.rs`（细粒度读授权）。
- **execpolicy**：自带命令解析器（parser.rs/policy.rs/rule.rs），对命令做静态策略判定（`execpolicycheck` 子命令），并有 `sandbox_migration.rs`。
- docs/sandbox.md 与 docs/skills.md 已收窄为外链 developers.openai.com——**官方文档外迁，仓库内只剩代码级真相**。
DCHUNK1
echo p1 ok; wc -l "$F"

## G. 模型适配层

- `model-provider-info` 独立 crate（含 wire_api 协议选择与 provider 定义；细项〔未证——本轮未逐行核对该 crate〕）。
- `codex-api` + `codex-backend-openapi-models`（OpenAPI 模型生成的后端类型）、`backend-client`、`responses-api-proxy`（Responses API 代理）、`chatgpt`（ChatGPT 账号后端/登录）、`aws-auth`（Bedrock 凭据）、`ollama` crate（本地模型）、`models-manager`（模型元数据管理）。
- 认证：`core/src/config/auth_keyring.rs`（OS keyring 存凭据）。

## H. 会话持久化（`codex-rs/rollout/`）

- rollout = 会话日志子系统：`recorder.rs`（写）、`reverse_jsonl_scanner.rs`（反向扫 JSONL，做 resume 读取优化）、`compression.rs`（压缩）、`persistence_metrics.rs`、`rollout_file_name.rs`、`policy.rs`、`maintenance.rs`（清理）、`list.rs`。
- `state`/`thread-store` 承担运行态与线程存储；`compact_remote_v2` 表明压缩已分本地/远端两条路径。

## I. 扩展机制

- **MCP**：`codex-mcp` + `rmcp-client`（Rust 官方 MCP SDK 客户端）+ handlers 里 `mcp`/`mcp_resource`/`tool_search`（工具多时先搜索再调用）。
- **插件**：`plugin` crate + `request_plugin_install`/`list_available_plugins_to_install` 工具（模型可主动请求装插件，走审批）。
- **技能**：`skills` crate（文档外链 developers.openai.com/codex/skills）。
- **连接器**：`connectors.rs` + `connectors/` crate。
- **迁移**：`external-agent-migration` crate——从其它 agent 工具迁移会话/配置。

## J. UI（`codex-rs/tui/`）

- ratatui + ratatui-macros，991 个 .rs 文件（含大量内联测试），是六仓中最大的单体 TUI。
- 桌面/IDE 走 `app-server` 协议族；`realtime-webrtc` + `voice-host` 表明语音通道已在仓内。

## K. 亮点

1. **安全纵深最重**：Seatbelt SBPL 策略文件 + Seatbelt 守护进程、Landlock 独立二进制、Windows 沙箱服务、网络代理与网络审批单独成面、execpolicy 静态命令判定、process-hardening、secrets、workload-identity——六仓中唯一把
整个 OS 安全栈当作一等公民对待，独立沙箱二进制 + 服务进程 + 网络代理的组合是独一档的。
2. **unified_exec + zsh_fork**：PTY 会话复用 + shell 分叉执行，工具面为长交互命令专门建模。
3. **code-mode 四 crate 工程化**（模型写代码调工具），与 DSH 的 PTC 互相印证这是行业方向。
4. **多代理 v2 已内嵌**（agent 通信 + 消息板 + 编排模板），不只是外挂 MCP。
5. **rollout 设计成熟**：反向 JSONL 扫描、压缩、维护策略、持久化指标——resume 性能被显式工程化。
6. arg0 多调用二进制 + Bazel/cargo 双轨 + Nix：分发工程为超大规模贡献者设计。

## L. 弱点/风险

1. 114 crates 的组合爆炸：跨 crate 变更面大，新人极难定位（core/src 已 100+ 文件）。
2. 官方文档外迁 GitHub 仓（sandbox/skills/config.md 只剩外链），仓库自描述性下降。
3. Rust 187 万行中含生成物/测试，真实核心逻辑占比需另行核算〔未证〕。
4. `docs/config.md` 在仓内被清空为指针，离线用户拿不到完整配置参考。
5. provider 生态以 OpenAI 系为主（responses-api-proxy/chatgpt/aws-auth/ollama），第三方 provider 路径远不如 cline/opencode 宽。
6. v8-poc / realtime-webrtc / voice-host 等实验 crate 与主线混在同一 workspace，边界噪音大。

## M. 事实清单

1. Rust 工作区 114 个 crate（`ls -d codex-rs/*/ | wc -l`）。
2. Rust 4697 文件 1,870,737 行；Python 198 文件 63,753 行；TS 750 文件 11,373 行。
3. TUI 991 个 .rs 文件，ratatui + ratatui-macros（tui/Cargo.toml:93-99）。
4. Seatbelt 策略为三个内嵌 .sbpl 文件（sandboxing/src/）。
5. Landlock 在独立 `linux-sandbox` 二进制（linux-sandbox/src/landlock.rs + tests/suite/landlock.rs）。
6. Windows 沙箱拆两个 crate：windows-sandbox-rs + windows-sandbox-service，core 内另有 windows_sandbox_read_grants.rs。
7. unified_exec 与 zsh_fork 在 core/src/tools/runtimes/。
8. multi_agents 与 multi_agents_v2 双代并存（core/src/tools/handlers/）。
9. compaction 有本地 + remote_v2（含图片预算）两条路径（core/src/compact_remote_v2*.rs）。
10. exec CLI 提供人读与 JSONL 两种事件处理器（exec/src/event_processor_with_*.rs）。
11. app-server 协议族共 6 个 crate（app-server*）。
12. code-mode 4 crate：code-mode{,-host,-protocol,-runtime}。
13. plugin 安装是模型可调用的工具（request_plugin_install.rs）。
14. rollout 有 reverse_jsonl_scanner.rs 与 compression.rs。
15. CI 含 rusty-v8-release.yml 与 r2-release.yml（自托管 V8 与 R2 分发）。
16. 根目录还有 `announcement_tip.toml`（产品公告配置进仓库）。

〔未证〕：model-provider-info crate 的内置 provider 全集、app-server 协议消息 schema 细节、tui 内部组件树、approval_policy 枚举的现行取值。
