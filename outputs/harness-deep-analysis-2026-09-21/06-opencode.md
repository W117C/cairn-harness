# 06 · anomalyco/opencode（dev 分支）源码级深挖

> **抓取对象**：`/tmp/dsh-deep/opencode-dev`（来源 `https://github.com/anomalyco/opencode`，dev 分支，tip `70a24697ea0028e19f22712fd63059538cb4bee7`，2026-09-21 抓取）
> **分析方式**：只读。所有 `path:line` 来自实读；无法验证的写【未证】；跨信息推断写【推测】。
> **环境事实**：快照**不含 `.git`**（`git log` → `fatal: not a git repository`），故只能给工作树路径，不能给提交历史/分支归属。各包版本号统一 `1.18.31`。
> **读数口径**：LOC 命令见 §C，全部排除 `.git/`、`node_modules/`、`dist/`；shell 侧一律 `-E`/`-w`（BSD grep 兼容）。

---

## 0. 三句话结论

1. **这不是"opencode 加了些功能"，而是一次正在进行中的整车重构**：仓库里同时存在两套会话内核、两套工具系统、两套 provider 注册机制、两套 CLI（V1 = `packages/opencode` 单体；V2 = `packages/core` + `packages/llm` + `packages/server` + `packages/schema` + `packages/protocol` + `packages/client` + `packages/sdk-next`）。V1 是运行时主线，V2 带着明确的未完成清单（`packages/core/src/session/runner/llm.ts:35-95`）。
2. **TUI 已经不是 Go**：全仓 `*.go` 计数 = **0**；终端界面是 TypeScript + SolidJS + `@opentui/*`（`packages/tui/package.json`），并刚抽成独立包（`specs/tui-package.md:1-24`）。桌面端 Electron（`packages/desktop/package.json`），浏览器端 SolidJS（`packages/app/package.json`）。
3. **归属已迁到 `anomalyco`，但没清干净**：README badge、安装脚本、CI 主体条件都是 `anomalyco/opencode`，而 `.github/workflows/docs-update.yml:13` 仍写 `github.repository == 'sst/opencode'`（该 job 在新仓库**永不触发**），`CONTRIBUTING.md:74` 仍指向 `github.com/sst/opentui`。见 §T。

---

## A. 定位与形态

### A.1 文档与自我定位

| 项 | 内容 | 证据 |
| --- | --- | --- |
| 定位语 | "The open source AI coding agent." | `README.md:4` |
| 多语言 README | **21 个** `README.*.md` | `ls README.*.md \| wc -l` → 21 |
| 主仓库 | `github.com/anomalyco/opencode`（badge / 安装脚本 / CI 三处一致） | `README.md:14`、`install:184`、`.github/workflows/publish.yml:37` |
| 默认分支 | `dev` | `AGENTS.md:4` |
| 许可 | MIT，"Copyright (c) 2025 opencode"（**版权行不含组织名**） | `LICENSE:1-3` |
| 安全策略 | 拒收 AI 生成安全报告（"automatic ban"）；威胁模型单列 **No Sandbox**；`security@anoma.ly` | `SECURITY.md:5-7`、`15-19`、`47` |
| 仓库级 Agent 指令 | 根 `AGENTS.md`（8.7KB）+ 子包 `AGENTS.md` ×10（`packages/llm` 24.6KB 最大） | `find . -maxdepth 3 -name AGENTS.md` |
| 术语表 | `CONTEXT.md`（32KB）：System Context / Context Epoch / Session Drain / Admitted Prompt / Model Tool Output 等**受控词表**，并标注 _Avoid_ 说法 | `CONTEXT.md:7-52` |

### A.2 packages/ 包名 + bin

`bin` 来自各 `packages/*/package.json`（脚本化读出全部 25 个包）：

| 包目录 | name | bin | 角色 |
| --- | --- | --- | --- |
| `packages/opencode` | `opencode`（**private: true**） | `opencode` → `./bin/opencode` | V1 单体 CLI + V1 运行时（≈180k LOC） |
| `packages/core` | `@opencode-ai/core` | `opencode` → `./bin/opencode` | V2 内核（session/db/tool/system-context/plugin） |
| `packages/cli` | `@opencode-ai/cli` | **`lildax`** → `./bin/lildax.cjs` | 新 CLI（Effect + daemon + serve），bin 名与产品名不一致 |
| `packages/tui` | `@opencode-ai/tui` | 无 | 终端 UI（SolidJS + @opentui，102 个 `.tsx`） |
| `packages/desktop` | `@opencode-ai/desktop` | 无 | Electron 桌面端 |
| `packages/app` | `@opencode-ai/app` | 无 | 浏览器/桌面共用前端（SolidJS + Vite） |
| `packages/ui` / `packages/session-ui` | `@opencode-ai/ui` / `-session-ui` | 无 | 共享组件库 / 会话渲染组件库 |
| `packages/web` | `@opencode-ai/web` | 无 | 官网 + 文档站（Astro/Starlight） |
| `packages/console/*` | `console-app`/`-core`/`-function`/`-mail`/`-resource`/`-support` | 无 | 商业化控制台（账号/计费/订阅/quota） |
| `packages/enterprise` | `@opencode-ai/enterprise` | 无 | 企业版（Hono + Nitro + SolidStart） |
| `packages/llm` | `@opencode-ai/llm` | 无 | V2 自研 LLM 协议层（105 文件 / 20.5k LOC） |
| `packages/schema` / `protocol` | 同名 | 无 | 跨端 schema / 协议定义 |
| `packages/server` | `@opencode-ai/server` | 无 | V2 服务端（HttpApi + SessionExecution 装配） |
| `packages/client` | `@opencode-ai/client` | 无 | 生成式客户端（`src/generated` 禁改，`AGENTS.md:2`） |
| `packages/sdk-next` | `@opencode-ai/sdk-next` | 无 | "组合 Client+Core+Server"的新 SDK（6 文件 / 342 行） |
| `packages/sdk/js` | `@opencode-ai/sdk`（1.18.31） | 无 | 已发布 JS SDK（含 `/v2` 生成客户端） |
| `packages/plugin` | `@opencode-ai/plugin` | 无 | 插件类型与 hook 契约（`./tool`、`./tui`、`./v2/*`） |
| `packages/codemode` | `@opencode-ai/codemode` | 无 | `execute` 代码模式工具后端 |
| `packages/slack` / `function` / `stats` | 同名 | 无 | Slack 集成 / Cloudflare Worker / 下载统计站 |
| `packages/effect-drizzle-sqlite`、`effect-sqlite-node` | 同名 | 无 | Drizzle/Effect SQLite 适配 |
| `packages/http-recorder`、`httpapi-codegen`、`script` | 同名 | 无 | HTTP 录制回放 / HttpApi 代码生成 / 发布脚本库 |
| `packages/docs` | 无 workspace 包 | 无 | 文档内容（`docs.json`、`*.mdx`，**0 个 .ts**） |
| `packages/containers`、`identity`、`storybook` | — | 无 | CI 镜像 / 品牌资产（只有 png/svg）/ Storybook |

- 发布到 npm 的 CLI 包名是 **`opencode-ai`**：`packages/opencode/script/publish.ts:41-58` 把 `dist/<name>` 改名 `${name}-ai` 后 `npm publish`（对应 `README.md:53`）；`packages/opencode` 自身 `private: true`。
- 安装矩阵（`README.md:47-84`）：`curl -fsSL https://opencode.ai/install | bash`、`npm i -g opencode-ai`、`scoop`/`choco`、`brew install anomalyco/tap/opencode`、`brew install opencode`、`pacman -S opencode`、`paru -S opencode-bin`、`mise`、`nix run nixpkgs#opencode`。
- 安装脚本本体是仓库根 **`install`**（无扩展名，13.7KB）：默认装到 `$HOME/.opencode/bin`（`install:68-69`），按需改 shell rc（`install:414-427`），支持 `--version`/`--binary`/`--no-modify-path`、`OPENCODE_INSTALL_DIR`、`XDG_BIN_DIR`（`README.md:96-97`）；下载源 `https://github.com/anomalyco/opencode/releases/...`（`install:184-201`）。
- 桌面端标 **BETA**，产物见 `README.md:67-84`（dmg×2 / exe / deb / rpm / AppImage）。

### A.3 形态画像
**平台级单体仓**：CLI / TUI / 桌面 / Web / 控制台 / 统计站 / 官网文档 / i18n / 发布矩阵 / CICD 全在一个 monorepo 内，TS 68 万行，Bun workspace + Turbo，`bun test` + Playwright，Bun 编译分发单文件二进制。不是"轻量 agent 库"，是**完整商业产品线**源码。

---

## B. 技术栈与工具链

| 维度 | 事实 | 证据 |
| --- | --- | --- |
| 语言 | TypeScript 为主；**无 Go / Rust 源码**（Rust 只在 `packages/containers/rust` 是 CI 镜像名） | `find . -name '*.go' \| wc -l` → 0 |
| 运行时/包管理器 | **Bun 1.3.14**（`packageManager`），`bun.lock` 879KB | `package.json:5` |
| workspace | `packages/*`、`packages/console/*`、`packages/stats/*`、`packages/sdk/js`、`packages/slack`；版本集中在 **catalog**（`workspaces.catalog`，100+ 钉版本条目） | `package.json:31-40` 起 |
| 依赖卫生 | `bunfig.toml`：`exact = true` + **`minimumReleaseAge = 259200`（新版本发布满 3 天才可安装）**，白名单 `minimumReleaseAgeExcludes` 列出 `@ai-sdk/*`、`@opentui/*`、`electron-builder` 等 | `bunfig.toml:1-6` |
| 类型检查 | 全仓 `bun turbo typecheck`；包内用 **`tsgo --noEmit`**（TS 原生预览编译器 `@typescript/native-preview`） | `package.json:12`、`packages/opencode/package.json:7` |
| Lint / 格式 | **oxlint**（`.oxlintrc.json`）+ prettier 3.6.2 | `package.json:11`、`packages/opencode/package.json` |
| 单测 | **`bun test`**（包内跑，常带 `--only-failures`）；根目录**故意不可跑**：`test` 脚本 `echo 'do not run tests from root' && exit 1`，且 `bunfig.toml` 的 `[test] root = "./do-not-run-tests-from-root"` 硬拦 | `package.json:21`、`bunfig.toml:8-9`、`AGENTS.md:145` |
| 构建 | Turbo（`turbo.json` 只对 `typecheck`/`build` 与少数包 `test` 建图，`build.outputs=dist/**`）；CLI 二进制由 `packages/opencode/script/build.ts` 产：导入 `@opentui/solid/bun-plugin`、把 Web UI **编译期内嵌**（`createEmbeddedWebUIBundle`），TUI 的 tree-sitter worker 也内联，按 `os × arch × musl × avx2` 矩阵多目标 | `turbo.json:6-30`、`packages/opencode/script/build.ts:1-60` |
| 桌面构建 | `electron-vite build` + `electron-builder`（mac/win/linux 分档脚本） | `packages/desktop/package.json` |
| e2e | Playwright：`packages/app/playwright.config.ts` + `e2e/{smoke,regression,reproduction,user-story,performance}` | `ls packages/app/e2e` |
| 推送钩子 | husky `pre-push`：先校验 bun 版本 == `packageManager`，再 `bun typecheck` | `.husky/pre-push:1-20` |
| 密钥扫描 | gitleaks，`.gitleaksignore` 按 `repo:file:rule:line` 粒度忽略 recorder 测试假 key | `.gitleaksignore:1-4` |
| 可复现构建 | Nix：`flake.nix`、`nix/{opencode,desktop,node_modules}.nix`、`nix/hashes.json`；CI `nix-eval.yml` + `nix-hashes.yml` | `ls nix/`、`.github/workflows/nix-*.yml` |
| 依赖补丁 | `patches/` **21 个补丁**（`@ai-sdk/{anthropic,openai,google,groq,mistral,amazon-bedrock,xai}`、`effect@4.0.0-beta.83`、`solid-js`、`@modelcontextprotocol/sdk`、`pacote`、`@tanstack/virtual-core`…） | `ls patches/` |
| 效果系统 | **Effect v4 beta**（`effect`、`@effect/platform-node`、`@effect/sql-sqlite-bun`、`@effect/opentelemetry`）；服务用 `Context.Service` + `Layer`/`LayerNode`；V2 全量 Effect 化 | catalog、`packages/core/src/effect/` |

### B.1 CI 工作流逐个列（`.github/workflows/`，共 **28** 个）

| 工作流 | 触发 | 作用（要点 + 证据） |
| --- | --- | --- |
| `test.yml` | push(dev) / PR / 手动 | `unit` job：linux+windows 矩阵，`blacksmith-4vcpu-*`，`bun turbo test`（`timeout-minutes: 20`，`GITHUB_ACTIONS=false`）；随后 **仅 Linux** 跑 `packages/client` 的 `check:generated` 与 `packages/opencode` 的 `test:httpapi`（`test.yml:66-80`）。`e2e` job：Playwright，Node 锁 **24.15**，注释写明"1.59 在 Node 24.16 装 Chromium 会 hang"（`test.yml:103-137`） |
| `typecheck.yml` | push/PR(dev) | `bun typecheck` |
| `publish.yml` | push(ci/dev/beta/snapshot-*/`fix/npm-native-binary-install`) / 手动（major/minor/patch/version） | 见 §Q：版本 → CLI 产物 → **Windows 签名+校验+重打包** → 桌面 6 目标 → Docker(ghcr) → AUR → release 资产与 `latest*.yml` |
| `deploy.yml` | push(dev/production) 且仓库=`anomalyco/opencode` | 部署（SST/AWS 链） |
| `generate.yml` | — | 代码生成（client/schema 生成物） |
| `models-snapshot.yml` | 定时/手动 | models.dev 快照（对应 `Flag.OPENCODE_MODELS_PATH` / 编译期 `OPENCODE_MODELS_DEV`） |
| `docs-update.yml` | — | **条件仍是 `sst/opencode`，且 `uses: sst/opencode/github@2c14fc5…`** → §T |
| `docs-locale-sync.yml` | push(dev) 且英文文档变更 | **当前 `if: false`（禁用）**；启用时的做法是用自家 CLI 跑 agent 翻译（`opencode run --agent docs --model opencode/gpt-5.3-codex`，要求必须经 `translator` 子代理、并行 Task） |
| `opencode.yml` | issue_comment / PR review comment 命中 `/oc`、`/opencode` | 用 `anomalyco/opencode/github@2c14fc5…` 跑 self-hosted agent，并显式 `OPENCODE_PERMISSION: '{"bash": "deny"}'`（`opencode.yml:29-36`） |
| `review.yml`、`pr-standards.yml`、`pr-management.yml`、`triage.yml`、`duplicate-issues.yml`、`compliance-close.yml`、`close-issues.yml`、`close-prs.yml`、`unlock.yml` | issues/PR 事件 | 仓库治理自动化（重复 issue 检测、PR 规范、合规关闭、上锁/解锁） |
| `containers.yml`、`nix-eval.yml`、`nix-hashes.yml`、`storybook.yml`、`stats.yml`、`notify-discord.yml`、`publish-vscode.yml`、`publish-github-action.yml`、`release-github-action.yml` | — | 容器镜像 / Nix 评估与哈希守护 / Storybook / 统计 / Discord / VS Code 扩展 / GitHub Action 发布 |

### B.2 i18n / 文档机制（多语言不只是 README）

三层：
1. **README**：21 个 `README.<lang>.md` + 顶部语言切换条。
2. **官网文档站**：`packages/web/src/content/docs/` 下 **53 个条目**（英文 `*.mdx` + 19 个语言目录），另有 `packages/web/src/content/i18n/*.json`（20+ 语言词条）；框架 **Astro + Starlight**（`packages/web/package.json`：`astro`、`@astrojs/starlight`、`@astrojs/cloudflare`）。
3. **术语治理**：`.opencode/glossary/` **17 个文件**，含 "Do Not Translate"（`OpenCode`/`OpenCode Zen`/`CLI`/`TUI`/`MCP`/`OAuth`）与 "Preferred Terms" 表（`.opencode/glossary/zh-cn.md:1-20`）；桌面端另有 `packages/desktop/AGENTS.md:1-20` 的翻译纪律（"NEVER hardcode user-visible English strings"、"English is intentional, designer-written source copy"、要求以 CLDR/Firefox/KDE/VS Code 语料校验），以及 `script/translate-app.ts:1-40`（用 CLI 自身驱动翻译）。


---

# 06 · 续章（C–S 补全，主笔人工复验）

## C. 结构与规模

packages/ 32 个（app 12 万行、console 4.4 万、ui 3.4 万、tui 3.2 万、sdk 3 万、core 2.4 万、session-ui 2.1 万、llm 2.05 万、opencode(V1 单体) 1.95 万、stats、codemode、desktop、web、client、schema、effect-drizzle-sqlite、httpapi-codegen、http-recorder…）。全仓 6572 文件；**V1（packages/opencode）与 V2（core+llm+server+schema+protocol+client+sdk-next）并存**是本仓最重要结构事实。

## E'. Agent 主循环（两代并存）

- V1 `packages/opencode/src/session/`：compaction.ts、instruction.ts、message{,-v2}.ts、overflow.ts、processor.ts、reminders.ts、retry.ts、revert.ts、run-state.ts、prompt/、llm/、prompt.ts——单体内核，运行时主线。
- V2 `packages/core/src/session/runner/`：runner/llm.ts 带明确未完成清单（分册前半已证）。
- code-mode 工具（tool/code-mode.ts）——模型写代码调工具的第三家（codex/DSH/omp 之后）。

## F'. 工具面（V1 `packages/opencode/src/tool/`）

`read/glob/grep/edit/apply_patch/shell/lsp/question/plan(+enter/exit)/external-directory/mcp-websearch/json-schema/registry/schema`，**每个工具配同名 .txt 提示词**（工具描述与实现同目录成对）。注册走 registry.ts。

## G'. 权限

`config/config.ts:561,577`：环境变量 `OPENCODE_PERMISSION`（JSON）与配置文件 mergeDeep 合并；schema 为 `ConfigPermissionV1`（`@opencode-ai/core/v1/config/permission`）——permission 是独立版本化 schema 面。

## P'. 测试/CI

741 个 TS 测试文件；CI 28 workflows（分册前半已列表）；gitleaks、turbo、husky pre-push typecheck、Nix 哈希守护。

## 补充结论

1. 迁移策略 = 平行重建而非原地改造：V1 仍在 dev 主线，V2 以 effect v4 + HttpApi + codegen client 逐包替换。
2. 权限配置已先于内核完成版本化（V1 schema），是 V2 边界成熟的信号。
3. TUI 为 SolidJS+opentui（非 Go），desktop 为 Electron，app 为浏览器端——TS 全栈单语言。
4. 归属迁移残留：docs-update.yml 条件仍指 sst/opencode（永不触发）等（§T，见前文）。
