# 03 · can1357/oh-my-pi 源码级深挖

> 抓取：`/tmp/dsh-deep/oh-my-pi-main`（main，tip `d49918fa`，2026-09-21）。**badlogic/pi-mono（@mariozechner 的 Pi）的 fork**（README badge 明示），`@oh-my-pi/pi-coding-agent` v18.2.7，bin `omp`，bun >=1.4。

## 0. 一句话结论

**omp 是 Pi 的深度工业化 fork**：TS（160 万行）+ Rust 原生层（pi-natives 等 10 crates）+ Bun 运行时，招牌是把「上下文压缩」「记忆」「评测」做成了子系统——尤其 **snapcompact：把被丢弃的历史渲染成位图 PNG 喂给视觉模型读回**，这是六仓中独一份的压缩思路。

## A. 形态与技术栈

- monorepo：`packages/`（agent、ai、browser-relay、catalog、coding-agent、collab-web、metaharness、mnemopi、natives、omptype、snapcompact、stats、tui、typescript-edit-benchmark、utils、wire）+ `crates/`（pi-ast、pi-builtins、pi-diff、pi-edit、pi-iso、pi-natives、pi-shell、pi-vcs、pi-voice、pi-walker + vendor）+ `python/robomp`（另一 agent 形态，Dockerfile.robomp 单独打包）+ `infra/`。
- LOC：TS 5134 文件 1,620,262 行 + Rust 500 文件 275,277 行 + Python 179 文件 92,028 行 —— 总量六仓第一（约 200 万行）。
- 构建：Bazel（MODULE.bazel/BUILD.bazel）与 bun 双轨；deny.toml、rust-analyzer.toml、flake.nix；测试 `bun scripts/ci-test-ts.ts local`。

## B. coding-agent 内部（`packages/coding-agent/src/`）

目录面即能力面：`activity`、`advisor`（watchdog，docs/advisor-watchdog.md）、`auto-thinking`、`autolearn`、`autoresearch`、`blob-broker`（blob 工件架构）、`cleanse`、`collab`、`compress`、`cursor-bridge-tools.ts` + `cursor.ts`（Cursor 桥接）、`dap`（调试适配协议！）、`discovery`、`edit`、`eval`、`exa`（搜索集成）、`exec`、`extensibility`、`goals`、`hindsight`、`if-bench`、`irc`、`commands`、`config`、`export` 等。docs/ 30+ 设计文档逐主题配套（approval-mode、bash-tool-runtime、compaction、context-files、handoff-generation-pipeline、lsp-config、marketplace、local-models、auth-broker-gateway…）。

## C. 三个招牌子系统

1. **snapcompact（位图压缩）**：被丢弃的会话历史 → 序列化 → 按 provider 定形的像素字体位图 PNG（Anthropic `11on16-bw`、Google `8on22-bw`@2048、OpenAI `8on22-bw` original）→ 视觉模型直接读回；**全程本地确定性，零 LLM 调用**；栅格化在 Rust 原生层（pi-natives），字形回退用内嵌 Silver TrueType；shape 选择基于 SQuAD recall 评测与真实计费（snapcompact/README.md）。CVK/东亚字形全宽处理。
2. **mnemopi（记忆引擎）**：Mnemosyne 的 Bun/TS 移植，SQLite 本地记忆（BeamMemory 工作/情景记忆），remember/recall/stats/sleep 工作流 + MCP 工具定义；可选 fastembed ONNX 本地嵌入或 OpenAI 兼容远端；无 LLM 时走确定性启发式（mnemopi/README.md）。
3. **metaharness（评测中枢）**：Harbor/TS-edit/SnapCompact 共用 experiment→run→trace 模型 + SQLite + REST/SSE + 仪表盘；跑 Harbor 时把仓库只读 bind-mount 进容器、直接跑 `packages/coding-agent/src/cli.ts`（改 TS 即生效零重建）、凭据经宿主 pm2 auth-gateway 解析、**凭据不进容器**（metaharness/README.md）。

## D. Rust 原生层与 IDE 接线

- crates 覆盖 AST 解析（pi-ast）、diff（pi-diff）、编辑（pi-edit）、shell（pi-shell）、VCS（pi-vcs）、语音（pi-voice）、文件遍历（pi-walker）、内建（pi-builtins）——把性能敏感面沉到 Rust，经 napi（@napi-rs/cli）供 Bun 调用。
- "IDE wired in" 的实现面：`dap/`（DAP 调试适配）、LSP 配置（docs/lsp-config.md）、cursor-bridge、browser-relay、collab-web、`tui/` 包。〔DAP/LSP 的具体接线深度未逐行验证〕

## E. 主循环、工具与安全

- 主循环在 `packages/agent` + `packages/ai`（pi 系内核：pi-agent-core、pi-ai 是 catalog 中的独立包名——**DSH 的 llm-pi-ai 适配器正是接这套 pi-ai 目录**，两仓形成上下游）。
- 安全：docs/approval-mode.md、auth-broker-gateway.md（凭据经网关代理）、macos-signing-notarization.md；crates/pi-iso 命名暗示隔离能力〔未深入验证〕。
- robomp（python/robomp）是另一条产品线（带独立 Dockerfile 与 web 前端）。

## F. 亮点 / 风险

亮点：1) snapcompact 把压缩问题转化为「渲染+视觉读回」，成本模型 provider-aware 且有评测支撑；2) 记忆/评测/压缩三大子系统独立成包可复用；3) Rust 原生层让单进程 Bun 也有原生性能面；4) metaharness 的「凭据不出宿主」评测安全设计；5) docs/ 密度与命名纪律（每机制一文档）。
风险：1) fork 身份——上游 Pi 与 omp 的关系、贡献分流需自行判断；2) 200 万行单仓的评审压力；3) 位图压缩依赖视觉模型读回保真度，对文本细节（代码缩进/符号）的还原度是本质风险；4) Babel/transformers 等 catalog 依赖宽；5) 私有 infra/pm2 依赖使第三方复现 metaharness 有门槛。

## G. 事实清单

1. bin `omp`，包 `@oh-my-pi/pi-coding-agent` v18.2.7。
2. 明示 fork 自 badlogic/pi-mono。
3. 10 个自有 Rust crates + vendor。
4. snapcompact shape：Anthropic 11on16-bw / Google 8on22-bw@2048 / OpenAI 8on22-bw。
5. 位图栅格化在 pi-natives（Rust）。
6. mnemopi = Mnemosyne 移植，SQLite + BeamMemory。
7. metaharness 仪表盘端口 4700。
8. Harbor 评测默认 bind-mount 源码跑 src/cli.ts，零重建。
9. robomp 为独立 Python 线产品。
10. catalog 统一锁 `@oh-my-pi/*` 18.2.7 全家。
11. dap/cursor-bridge/irc/exa 等能力目录直接可见。
12. TS 162 万行 + Rust 27.5 万行 + Python 9.2 万行。
